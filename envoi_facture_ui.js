"use strict";
/* ============================================================
   Envoi des factures et relances (interface) :
   · « Envoyer » sur chaque facture : e-mail au client avec la facture, la preuve de livraison et les photos (CMR signé, livraison) ;
     par le relais (SMTP), sinon par le partage du téléphone (Gmail, WhatsApp… avec les fichiers), sinon e-mail + PDF à joindre ;
   · proposé dès qu'une facture est créée ; date d'envoi et prochaines relances sur la ligne de la facture ;
   · relances programmées dans le plan des notifications (fil de l'équipe ; e-mail au client si activé, envoyé par le relais) ;
   · Réglages : jours des relances, envoi automatique au client.
   Logique pure dans relances.js ; pièces jointes acceptées par le relais : serveur/courriel.js.
   ============================================================ */

const htmlPieceJointe = (titre, corps) => htmlImpression(titre, corps).replace(/<div class="barre-impression">[\s\S]*?<\/div>/, "").replace(/<script>[\s\S]*?<\/script>/, "");
const blobEnBase64 = (blob) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => ko(r.error); r.readAsDataURL(blob); });
const tailleLisible = (o) => (o > 1048576 ? `${fmt(o / 1048576, 1)} Mo` : `${fmt(Math.max(1, o / 1024), 0)} Ko`);
/** Pièces d'une facture : [{ id, nom, type, blob, taille, libelle }] — facture, preuves de livraison, photos (6 au plus). */
async function piecesFacture(f) {
  const r = [], fac = new Blob([htmlPieceJointe(f.numero, corpsFacture(f))], { type: "text/html" });
  r.push({ id: "facture", nom: `${f.numero}.html`, type: "text/html", blob: fac, taille: fac.size, libelle: `Facture ${f.numero}` });
  for (const v of voyagesFacture(f)) if (v.pod && typeof corpsPreuve === "function") { const b = new Blob([htmlPieceJointe(`Preuve de livraison ${v.ref}`, corpsPreuve(v))], { type: "text/html" }); r.push({ id: `pod:${v.id}`, nom: `Preuve de livraison ${v.ref}.html`, type: "text/html", blob: b, taille: b.size, libelle: `Preuve de livraison ${v.ref} (signature${v.pod.reserves ? ", réserves" : ""})` }); }
  let photos = [];
  for (const cible of ciblesPhotosFacture(f)) { try { photos.push(...(await photosDe(cible)).map((p) => ({ ...p, cible }))); } catch { /* photos indisponibles */ } }
  photos = photos.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6);
  photos.forEach((p, i) => r.push({ id: `photo:${p.id}`, nom: `${p.cible.startsWith("voyage") ? "Voyage" : "Commande"} photo ${i + 1}.jpg`, type: "image/jpeg", blob: p.blob, taille: p.blob.size, libelle: `Photo ${i + 1} — ${p.nom || "CMR / livraison"} (${dateFr(String(p.date).slice(0, 10))})` }));
  return r;
}
async function envoyerFacture(f) {
  const cl = parId(S.clients, f.clientId) || {}, t = texteEnvoiFacture(f), pieces = await piecesFacture(f), caps = typeof canauxRelais === "function" ? await canauxRelais() : [];
  const parRelais = caps.includes("email"), partage = !!navigator.canShare && navigator.canShare({ files: [new File(["x"], "x.txt", { type: "text/plain" })] });
  const r = await modale({ titre: `Envoyer ${f.numero} — ${nomClient(f.clientId)}`, valider: parRelais ? "Envoyer l'e-mail" : partage ? "Partager (e-mail, WhatsApp…)" : "Préparer l'e-mail", corps: `
    <div class="form-grid"><label class="f full">À<input type="email" name="a" value="${esc(cl.email || "")}" ${parRelais ? "required" : ""} placeholder="adresse du client"></label>
      <label class="f full">Objet<input name="sujet" value="${esc(t.sujet)}"></label></div>
    <label class="f full" style="margin-top:8px">Message<textarea name="texte" rows="8">${esc(t.texte)}</textarea></label>
    <div class="section-title">Pièces jointes</div>
    <div class="pieces-liste">${pieces.map((p) => `<label class="check"><input type="checkbox" name="p__${esc(p.id)}" checked><span>${esc(p.libelle)} <span class="sub">${esc(p.nom)} · ${tailleLisible(p.taille)}</span></span></label>`).join("")}</div>
    ${pieces.length === 1 ? `<p class="hint">Aucune photo ni preuve de livraison sur les voyages de cette facture : prenez le CMR signé en photo sur le voyage (bouton Photos) pour le joindre.</p>` : ""}
    <p class="hint">${parRelais ? "Envoyé par le relais, depuis l'adresse de l'entreprise." : partage ? "Le partage du téléphone s'ouvre avec les fichiers : choisissez Gmail, Outlook ou WhatsApp." : "Sans relais e-mail : le message s'ouvre dans votre messagerie et la facture s'ouvre en PDF, à joindre."} La facture est jointe en page web, lisible et imprimable dans tout navigateur.</p>` });
  if (!r) return;
  const choisies = pieces.filter((p) => r[`p__${p.id}`]);
  try {
    if (parRelais) {
      const b64 = await Promise.all(choisies.map(async (p) => ({ nom: p.nom, type: p.type, base64: await blobEnBase64(p.blob) })));
      await partageAppel("POST", "/api/notifications/document", { a: String(r.a || "").trim(), sujet: r.sujet, texte: r.texte, pieces: b64 });
      f.envoi = { date: new Date().toISOString(), a: String(r.a).trim(), pieces: choisies.length, via: "relais" };
    } else if (partage) {
      const files = choisies.map((p) => new File([p.blob], p.nom, { type: p.type }));
      await navigator.share({ title: r.sujet, text: r.texte, files });
      f.envoi = { date: new Date().toISOString(), a: String(r.a || "").trim(), pieces: choisies.length, via: "partage" };
    } else {
      location.href = `mailto:${encodeURIComponent(String(r.a || ""))}?subject=${encodeURIComponent(r.sujet)}&body=${encodeURIComponent(r.texte)}`; imprimerFacture(f);
      f.envoi = { date: new Date().toISOString(), a: String(r.a || "").trim(), pieces: 0, via: "messagerie" };
    }
  } catch (e) { if (e?.name === "AbortError") return; return toast(`Envoi impossible : ${e.message}`, "danger"); }
  sauver(); toast(`${f.numero} envoyée${f.envoi.via === "relais" ? ` à ${f.envoi.a} (${f.envoi.pieces} pièce${f.envoi.pieces > 1 ? "s" : ""} jointe${f.envoi.pieces > 1 ? "s" : ""})` : ""}`); rafraichir();
}
function infoEnvoiFacture(f) {
  const r = prochainesRelances(f), env = f.envoi ? `envoyée le ${dateFr(f.envoi.date.slice(0, 10))}` : f.statut !== "payee" ? "pas encore envoyée" : "";
  const rel = f.statut === "payee" ? "" : f.sansRelance || parId(S.clients, f.clientId)?.sansRelance ? "relances suspendues" : r.length ? `relance ${r[0].j < 0 ? "J" + r[0].j : "J+" + r[0].j} le ${dateFr(r[0].date)}${S.params.relancesAuto ? " (e-mail)" : ""}` : "";
  return env || rel ? `<span class="sub">${[env, rel].filter(Boolean).map(esc).join(" · ")}</span>` : "";
}
function actionsEnvoiFacture(f) {
  if (f.statut === "payee") return "";
  return `${btn("envoyer-facture", f.envoi ? "Renvoyer" : "Envoyer", { id: f.id, icone: "upload", cls: `btn ${f.envoi ? "ghost " : ""}sm` })}${btn("relances-facture", f.sansRelance ? "Reprendre les relances" : "Suspendre les relances", { id: f.id, cls: "btn ghost sm" })}`;
}

/* ---------- branchements ---------- */
if (VUES.factures) {
  const agirFacturesAvantEnvoi = VUES.factures.agir;
  VUES.factures.agir = async function (act, id, b) {
    const f = parId(S.factures, id);
    if (act === "envoyer-facture" && f) return envoyerFacture(f);
    if (act === "relances-facture" && f) { f.sansRelance = !f.sansRelance; sauver(); toast(f.sansRelance ? `${f.numero} : relances suspendues` : `${f.numero} : relances reprises`); return rafraichir(); }
    return agirFacturesAvantEnvoi.call(this, act, id, b);
  };
}
// Une facture vient d'être créée (voyage, commande, retour, attente) : proposer de l'envoyer tout de suite.
for (const [vue, actes] of [[VUES.voyages, ["facturer-voyage", "retour-facturer", "attente-facturer"]], [VUES.commandes, ["facturer", "attente-facturer"]]]) {
  if (!vue) continue;
  const agirAvantEnvoi = vue.agir;
  vue.agir = async function (act, id, b) {
    const avant = S.factures.length, r = await agirAvantEnvoi.call(this, act, id, b);
    if (actes.includes(act) && S.factures.length > avant) { const f = S.factures[S.factures.length - 1]; if (await confirmer(`Envoyer ${f.numero} maintenant ?`, "La facture part avec le CMR signé et la preuve de livraison : le client n'a rien à réclamer, le paiement ne glisse pas.", "Envoyer")) await envoyerFacture(f); }
    return r;
  };
}
// Relances dans le plan des notifications (fil de l'équipe ; e-mails au client exécutés par le relais, application fermée).
if (typeof planNotifications === "function") { const planAvantRelances = planNotifications; planNotifications = function (o = {}) { return [...planAvantRelances(o), ...planRelances(o)].sort((a, b) => a.quand - b.quand); }; }

/* ---------- réglages ---------- */
enregistrerCarteReglages({
  onglet: "rappels", ordre: 22,
  rendu: () => `<div class="card" id="carte-relances"><div class="card-head"><h2>Relances des factures</h2></div>
    <form id="f-relances"><div class="form-grid">
      <label class="f">Jours par rapport à l'échéance (négatif = avant)<input name="relancesJours" value="${esc(S.params.relancesJours ?? "-3,7,15,30")}" placeholder="-3,7,15,30"></label>
      <label class="check full"><input type="checkbox" name="relancesAuto" ${S.params.relancesAuto ? "checked" : ""}><span>Envoyer aussi les relances par e-mail au client (relais avec serveur d'e-mail), dans sa langue</span></label>
    </div><div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn">Enregistrer</button></div></form>
    <p class="hint">Sans envoi automatique, l'équipe est prévenue dans le fil de l'application à chaque date. Une facture payée sort des relances ; « Suspendre les relances » sur une facture, ou « Pas de relance » sur la fiche d'un client, les arrête.</p></div>`,
  soumettre(fid, v) { if (fid !== "f-relances") return false; S.params.relancesJours = String(v.relancesJours || "").trim() || "-3,7,15,30"; S.params.relancesAuto = !!v.relancesAuto; sauver(); toast("Relances enregistrées"); rafraichir(); return true; },
});
