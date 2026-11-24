"use strict";
/* ============================================================
   Pièces jointes des demandes (interface) — logique dans pieces_demande.js, garde par le relais (serveur/pieces.js, relais 2.3).
   · sur chaque demande : les pièces jointes, le document reconnu (facture, colisage, phyto…), « Ouvrir » pour les lire ;
     celles que le relais n'a pas gardées sont nommées avec la raison (trop grosse, type, lettre d'information) ;
   · « Créer la commande » range les pièces sur la nouvelle commande et coche les documents reconnus ;
   · un e-mail du client qui cite une commande (« Re: CMD-2026-0087 — documents ») : pièces rangées seules sur cette commande ;
     sinon « Ranger sur une commande… » (la commande citée est proposée) ;
   · rangées dans les photos et documents du voyage (ou de la commande), puis effacées du relais ; jamais effacées avant d'être
     enregistrées sur l'appareil.
   ============================================================ */

const VISIBLES_PIECES = /^(application\/pdf|image\/(jpeg|png|webp|gif))$/;
const lienPieceRelais = (d, p) => `/api/demandes/${encodeURIComponent(d.id)}/pieces/${p.n}`;
const taillePiece = (o) => (!o ? "" : o >= 1048576 ? `${fmt(o / 1048576, 1)} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);

/** Télécharge une pièce gardée par le relais (Blob). Une pièce introuvable est notée effacée. */
async function telechargerPiece(d, p) {
  const r = partageRelais(); if (!r) throw new Error("relais non branché");
  let rep; try { rep = await fetch(r.base + lienPieceRelais(d, p), { headers: r.jeton ? { Authorization: `Bearer ${r.jeton}` } : {}, credentials: "same-origin", cache: "no-store" }); }
  catch { throw new Error("relais injoignable"); }
  if (rep.status === 404) { p.efface = true; throw new Error("déjà rangée ou effacée du relais"); }
  if (!rep.ok) throw new Error(`réponse ${rep.status} du relais`);
  return rep.blob();
}
/**
 * Range les pièces d'une demande sur une commande : enregistrées sur l'appareil (photos et documents du voyage, sinon de la commande),
 * puis effacées du relais ; documents reconnus cochés reçus. Renvoie { ranges, nouveaux, erreurs }.
 */
async function rangerPiecesDemande(d, c) {
  const reconnues = new Map(reconnaitrePieces(d).map((x) => [x.n, x])), ranges = [], erreurs = [];
  for (const p of piecesARanger(d)) {
    try {
      const b = await telechargerPiece(d, p);
      await documentAjouter(b, cibleDocuments(c), p.nom, p.type || b.type);
      p.rangee = c.id; ranges.push(reconnues.get(p.n) || p);
      partageAppel("DELETE", lienPieceRelais(d, p)).catch(() => { /* effacée au bout de 30 jours */ });
    } catch (e) { erreurs.push(`${p.nom} : ${e.message}`); }
  }
  const nouveaux = ranges.length ? cocherDocumentsPieces(c, ranges, d.date) : [];
  if (ranges.length || erreurs.length) sauver();
  return { ranges, nouveaux, erreurs };
}
const bilanRangement = (c, r, qui = "") => `${qui ? `${qui} : ` : ""}${r.ranges.length} pièce${r.ranges.length > 1 ? "s" : ""} jointe${r.ranges.length > 1 ? "s" : ""} rangée${r.ranges.length > 1 ? "s" : ""} sur ${c.ref}${r.nouveaux.length ? ` — reçu : ${r.nouveaux.join(", ")}` : ""}`;

/** Après chaque relève : les e-mails d'un client qui citent une de ses commandes voient leurs pièces rangées seules. */
async function rangerDemandesAuto() {
  if (!partageRelais()) return 0;
  let n = 0;
  for (const d of (S.demandes || []).filter((x) => x.statut === "a_trier" && Date.now() - Date.parse(x.date) < 30 * 86400000)) {
    const a = rangementAutomatique(d, lectureDemande(d)); if (!a) continue;
    const r = await rangerPiecesDemande(d, a.c); if (!r.ranges.length) continue;
    if (a.classer) classerDemande(d, "rangee", { commandeId: a.c.id }); else d.commandeId ||= a.c.id;
    n += r.ranges.length; sauver();
    toast(bilanRangement(a.c, r, `${nomClient(a.c.clientId)}, par e-mail`), "ok");
  }
  return n;
}

/* ---------- carte de la demande ---------- */
function blocPiecesDemande(d) {
  const l = reconnaitrePieces(d); if (!l.length) return "";
  if (!l.some((p) => Number.isInteger(p.n))) return `<p class="sub dem-pieces">${ic("file")}${l.map((p) => esc(p.nom)).join(" · ")} <span>(pièces jointes restées dans la messagerie — relais 2.3 ou plus pour les recevoir ici)</span></p>`;
  const cible = d.commandeId ? parId(S.commandes, d.commandeId) : commandePourDemande(d), relais = !!partageRelais();
  const ligne = (p) => {
    const c = p.rangee ? parId(S.commandes, p.rangee) : null;
    const etat = p.rangee ? `rangée sur ${c ? c.ref : "une commande"}` : !p.garde ? p.raison || "restée dans la messagerie" : p.efface ? "effacée du relais" : taillePiece(p.taille);
    return `<li class="${p.garde && !p.efface && !p.rangee ? "" : "pale"}">${ic("file")}<span class="dem-piece-nom">${esc(p.nom)}</span>
      ${p.docs.map((x) => badge(`${libDoc(x)}${p.devine ? " ?" : ""}`, "neutral")).join("")}<span class="sub">${esc(etat)}</span>
      ${p.garde && !p.efface && !p.rangee && relais ? `<button type="button" class="btn ghost sm" data-act="dem-piece" data-id="${esc(`${d.id}|${p.n}`)}">Ouvrir</button>` : ""}</li>`;
  };
  const aRanger = piecesARanger(d).length && relais;
  return `<div class="dem-pieces-bloc"><ul class="dem-pieces-liste">${l.map(ligne).join("")}</ul>
    ${aRanger ? `<div class="row">${btn("dem-ranger", cible ? `Ranger sur ${cible.ref}` : "Ranger sur une commande…", { id: d.id, icone: "box", cls: "btn ghost sm" })}</div>` : ""}</div>`;
}

/* ---------- actions ---------- */
async function ouvrirPiece(d, p) {
  let b; try { b = await telechargerPiece(d, p); } catch (e) { sauver(); rafraichir(); return toast(`${p.nom} : ${e.message}`, "warn"); }
  const url = URL.createObjectURL(new Blob([b], { type: p.type || b.type })), a = document.createElement("a");
  a.href = url; a.target = "_blank"; a.rel = "noopener"; if (!VISIBLES_PIECES.test(p.type || "")) a.download = p.nom;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function choisirCommandePieces(d) {
  const citee = commandePourDemande(d), depuis = dateISO(Date.now() - 120 * 86400000);
  const l = (S.commandes || []).filter((c) => (c.dateChargement || c.dateLivraison || today()) >= depuis).sort((a, b) => String(b.dateChargement || "").localeCompare(String(a.dateChargement || "")));
  if (!l.length) { toast("Aucune commande récente : créez d'abord la commande.", "warn"); return null; }
  const choix = d.commandeId || citee?.id || l[0].id, n = piecesARanger(d).length;
  const f = await modale({ titre: "Ranger les pièces jointes", valider: "Ranger", corps: `<label class="f full">Commande
      <select name="commande">${l.slice(0, 80).map((c) => `<option value="${esc(c.id)}" ${c.id === choix ? "selected" : ""}>${esc(`${c.ref} · ${nomClient(c.clientId)} · ${c.origine || "?"} → ${c.destination || "?"}${c.dateChargement ? ` · ${dateFr(c.dateChargement)}` : ""}`)}</option>`).join("")}</select></label>
    <p class="hint">${n} pièce${n > 1 ? "s" : ""} jointe${n > 1 ? "s" : ""} : rangée${n > 1 ? "s" : ""} dans les photos et documents du voyage (ou de la commande), documents reconnus cochés reçus.${citee ? ` L'e-mail cite ${esc(citee.ref)}.` : ""}</p>` });
  return f ? parId(S.commandes, f.commande) : null;
}
surAction("demandes", ["dem-piece", "dem-ranger"], async (act, id) => {
  const [did, n] = String(id).split("|"), d = (S.demandes || []).find((x) => x.id === did); if (!d) return;
  if (act === "dem-piece") { const p = (d.pieces || []).find((x) => x.n === Number(n)); if (p) await ouvrirPiece(d, p); return; }
  const c = await choisirCommandePieces(d); if (!c) return;
  const r = await rangerPiecesDemande(d, c);
  if (r.ranges.length) { if (d.statut === "a_trier") classerDemande(d, "rangee", { commandeId: c.id }); else d.commandeId ||= c.id; sauver(); toast(bilanRangement(c, r), "ok"); }
  if (r.erreurs.length) toast(r.erreurs[0], "warn");
  rafraichir();
});
