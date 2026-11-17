"use strict";
/* ============================================================
   Liens sans compte (interface) :
   · fiche du voyage, onglet Documents : « Lien de dépôt » pour chaque commande (aller, retour) — le client envoie ses documents
     en photo ou en PDF depuis son téléphone ; les fichiers arrivent dans les photos du voyage et marquent les documents reçus ;
   · fiche du voyage, onglet Suivi : « Lien transitaire » — le transitaire marque les étapes de douane, appliquées au voyage ;
   · « Demander les documents » met le lien de dépôt dans le message, s'il y a un relais ;
   · relève toutes les 5 minutes tant que l'application est ouverte.
   Logique pure dans liens.js ; pages et fichiers servis par le relais (serveur/liens.js, serveur/page-lien.js).
   ============================================================ */

let derniereMajLiens = 0, majLiensEnCours = false;
const urlLien = (l) => { const r = partageRelais(); return r && l?.chemin ? r.base + l.chemin : ""; };
const cibleDocuments = (c) => { const l = typeof voyageDeCommande === "function" ? voyageDeCommande(c) : null; return l ? `voyage:${l.v.id}` : `commande:${c.id}`; };
const finLien = (l) => dateFr(new Date(l.expire * 1000).toISOString().slice(0, 10));

/** Lien de dépôt d'une commande (créé s'il n'existe pas ou expire bientôt) : son adresse, ou "" sans relais. */
async function lienDepotPour(c, { silencieux = true } = {}) {
  if (!partageRelais() || !c) return "";
  if (lienActif(c.lienDepot)) return urlLien(c.lienDepot);
  try {
    const r = await partageAppel("POST", "/api/liens", corpsLienDepot(c, { jours: 21 }));
    c.lienDepot = { id: r.id, chemin: r.chemin, expire: r.expire, cree: new Date().toISOString(), recus: 0 }; sauver();
    return urlLien(c.lienDepot);
  } catch (e) { if (!silencieux) toast(e.message, "danger"); return ""; }
}
async function lienTransitPour(v, { silencieux = true } = {}) {
  if (!partageRelais() || !v) return "";
  if (lienActif(v.lienTransit)) return urlLien(v.lienTransit);
  try {
    const r = await partageAppel("POST", "/api/liens", corpsLienTransit(v, { jours: Math.max(7, Math.min(60, joursEntre(today(), v.dateRetourPrevue || today()) + 5)) }));
    v.lienTransit = { id: r.id, chemin: r.chemin, expire: r.expire, cree: new Date().toISOString(), vus: 0 }; sauver();
    return urlLien(v.lienTransit);
  } catch (e) { if (!silencieux) toast(e.message, "danger"); return ""; }
}
/** Fenêtre d'envoi d'un lien : WhatsApp (au numéro connu, ou au choix), e-mail, copier ; révoquer. Renvoie true si révoqué. */
async function fenetreLien({ titre, url, message, tel = "", email = "", sujet = "", expire, aide = "" }) {
  const liens = [`<a class="btn" href="https://wa.me/${tel}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">WhatsApp${tel ? "" : " (choisir le contact)"}</a>`];
  liens.push(`<a class="btn ghost" href="mailto:${esc(email)}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(message)}">E-mail${email ? ` — ${esc(email)}` : ""}</a>`, `<button type="button" class="btn ghost" data-copier="${esc(url)}">Copier le lien</button>`);
  const r = await modale({ titre, valider: "Terminer", annuler: "", corps: `<p class="hint" style="margin-top:0">Lien actif jusqu'au <strong>${esc(finLien({ expire }))}</strong>, sans compte. ${esc(aide)}</p>
    <label class="f full">Lien<input value="${esc(url)}" readonly onclick="this.select()"></label><div class="liens-envoi" style="margin:12px 0">${liens.join("")}</div>
    <textarea rows="7" readonly style="width:100%">${esc(message)}</textarea>
    <label class="check" style="margin-top:10px"><input type="checkbox" name="revoquer"><span>Révoquer ce lien (la page ne s'ouvrira plus)</span></label>` });
  return !!r?.revoquer;
}
async function partagerLienDepot(c) {
  if (!partageRelais()) return toast("Le lien de dépôt demande le relais (Réglages → Général → Relais).", "warn");
  const url = await lienDepotPour(c, { silencieux: false }); if (!url) return;
  const cl = parId(S.clients, c.clientId) || {}, tel = typeof telInternational === "function" ? telInternational(cl.tel) : "";
  const revoquer = await fenetreLien({ titre: `Lien de dépôt — ${c.ref}`, url, message: messageLienDepot(c, url), tel, email: cl.email || "", sujet: `${c.refClient || c.ref} — documents`, expire: c.lienDepot.expire, aide: "Le client y voit la liste des documents et les envoie en photo ou en PDF ; ils arrivent dans les photos du voyage." });
  if (revoquer) { try { await partageAppel("DELETE", `/api/liens/${c.lienDepot.id}`); } catch (e) { if (!/introuvable/i.test(e.message)) return toast(e.message, "danger"); } delete c.lienDepot; sauver(); toast("Lien révoqué"); }
  rafraichir();
}
async function partagerLienTransit(v) {
  if (!partageRelais()) return toast("Le lien transitaire demande le relais (Réglages → Général → Relais).", "warn");
  const url = await lienTransitPour(v, { silencieux: false }); if (!url) return;
  const revoquer = await fenetreLien({ titre: `Lien transitaire — ${v.ref}`, url, message: messageLienTransit(v, url), sujet: `${v.ref} — étapes de douane`, expire: v.lienTransit.expire, aide: "Le transitaire marque chaque étape (référence, note) ; le voyage est mis à jour ici." });
  if (revoquer) { try { await partageAppel("DELETE", `/api/liens/${v.lienTransit.id}`); } catch (e) { if (!/introuvable/i.test(e.message)) return toast(e.message, "danger"); } delete v.lienTransit; sauver(); toast("Lien révoqué"); }
  rafraichir();
}

/** Récupère ce qui est arrivé par les liens : fichiers des clients (rangés dans les photos, documents marqués reçus), étapes du transitaire. */
async function majLiens({ silencieux = true } = {}) {
  const r = partageRelais(); if (!r || majLiensEnCours) return null;
  majLiensEnCours = true; derniereMajLiens = Date.now(); const bilan = { fichiers: 0, etapes: 0, messages: [] };
  try {
    for (const c of S.commandes.filter((x) => x.lienDepot?.id && x.lienDepot.expire * 1000 > Date.now() - 86400000)) {
      let l; try { l = await partageAppel("GET", `/api/liens/${c.lienDepot.id}`); } catch (e) { if (/introuvable/i.test(e.message)) { delete c.lienDepot; sauver(); } continue; }
      const recus = [];
      for (const f of l.fichiers || []) {
        try {
          const rep = await fetch(`${r.base}/api/liens/${c.lienDepot.id}/fichiers/${f.n}`, { headers: r.jeton ? { Authorization: `Bearer ${r.jeton}` } : {}, credentials: "same-origin" });
          if (!rep.ok) continue;
          await documentAjouter(await rep.blob(), cibleDocuments(c), f.nom, f.type);
          await partageAppel("DELETE", `/api/liens/${c.lienDepot.id}/fichiers/${f.n}`); recus.push(f);
        } catch (e) { if (!silencieux) toast(e.message, "danger"); }
      }
      if (!recus.length) continue;
      const nouveaux = documentsRecusParLien(c, recus); c.lienDepot.recus = num(c.lienDepot.recus, 0) + recus.length; bilan.fichiers += recus.length;
      bilan.messages.push(`${nomClient(c.clientId)} a envoyé ${recus.length} document${recus.length > 1 ? "s" : ""} (${c.ref})${nouveaux.length ? ` : ${nouveaux.join(", ")}` : ""}`);
      try { await partageAppel("PUT", `/api/liens/${c.lienDepot.id}`, { docs: corpsLienDepot(c).docs }); } catch { /* la page se mettra à jour plus tard */ }
    }
    for (const v of S.voyages.filter((x) => x.lienTransit?.id && x.lienTransit.expire * 1000 > Date.now() - 86400000)) {
      let l; try { l = await partageAppel("GET", `/api/liens/${v.lienTransit.id}`); } catch (e) { if (/introuvable/i.test(e.message)) { delete v.lienTransit; sauver(); } continue; }
      const faits = appliquerEvenementsTransit(v, l.evenements);
      if (faits.length) { bilan.etapes += faits.length; bilan.messages.push(`Transitaire, ${v.ref} : ${faits.map((x) => `${x.lib}${x.annule ? " (annulée)" : ""}`).join(", ")}`); }
      const corps = corpsLienTransit(v), empreinte = JSON.stringify(corps.etapes);
      if (empreinte !== v.lienTransit.empreinte) { try { await partageAppel("PUT", `/api/liens/${v.lienTransit.id}`, { etapes: corps.etapes }); v.lienTransit.empreinte = empreinte; } catch { /* plus tard */ } }
    }
  } finally { majLiensEnCours = false; }
  if (bilan.fichiers || bilan.etapes) { sauver(); bilan.messages.forEach((m) => toast(m, "ok")); if (["voyages", "commandes", "passages"].includes(ongletActif) && !document.querySelector("dialog[open]")) rafraichir(); }
  else if (!silencieux) toast("Rien de nouveau sur les liens.");
  return bilan;
}
function liensDemarrer() {
  if (!partageRelais()) return;
  setTimeout(() => majLiens(), 4000);
  setInterval(() => { if (document.visibilityState === "visible") majLiens(); }, 5 * 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - derniereMajLiens > 2 * 60000) majLiens(); });
}

/* ---------- fiche du voyage ---------- */
function blocLiensDepot(v) {
  if (["annule", "termine"].includes(v.statut) || !partageRelais()) return "";
  const lignes = [["Aller", commandeAller(v)], ["Retour", commandeRetour(v)]].filter(([, c]) => c && etatDocuments(c).total && !["livre"].includes(c.statut));
  if (!lignes.length) return "";
  return `<div class="section-title">Lien de dépôt pour le client</div>${lignes.map(([sens, c]) => {
    const l = lienActif(c.lienDepot) ? c.lienDepot : null, e = etatDocuments(c);
    return `<div class="trav"><div><strong>${sens} · ${esc(c.ref)} · ${esc(nomClient(c.clientId))}</strong><span class="sub">${l ? `Actif jusqu'au ${esc(finLien(l))}${num(l.recus) ? ` · ${num(l.recus)} fichier(s) reçu(s)` : " · rien reçu pour l'instant"}` : e.complet ? "Tous les documents sont reçus." : "Le client envoie ses documents en photo ou en PDF depuis son téléphone, sans compte ; ils arrivent dans les photos du voyage."}</span></div>
      <div class="r"><div class="row">${l ? btn("lien-depot", "Renvoyer le lien", { id: c.id, icone: "upload", cls: "btn ghost sm" }) + btn("liens-verifier", "Vérifier", { id: v.id, cls: "btn ghost sm" }) : e.complet ? "" : btn("lien-depot", "Créer et envoyer le lien", { id: c.id, icone: "upload", cls: "btn sm" })}</div></div></div>`; }).join("")}`;
}
function blocLienTransit(v) {
  if (["annule", "termine"].includes(v.statut) || !partageRelais() || !(sensParDetroit(v, "aller") || sensParDetroit(v, "retour"))) return "";
  const l = lienActif(v.lienTransit) ? v.lienTransit : null, parLui = Object.entries(v.etapesPort || {}).filter(([, s]) => s.par === "transitaire").sort((a, b) => String(b[1].date).localeCompare(String(a[1].date)));
  return `<div class="trav lien-transit"><div><strong>Lien transitaire</strong><span class="sub">${l ? `Actif jusqu'au ${esc(finLien(l))}${parLui.length ? ` · dernière étape notée : ${esc(etapePort(parLui[0][0])?.lib || "")} (${esc(dateHeureFr(parLui[0][1].date))})` : " · aucune étape notée pour l'instant"}` : "Le transitaire marque lui-même les étapes de douane (référence, note) depuis son téléphone, sans compte."}</span></div>
    <div class="r"><div class="row">${l ? btn("lien-transit", "Renvoyer le lien", { id: v.id, icone: "upload", cls: "btn ghost sm" }) + btn("liens-verifier", "Vérifier", { id: v.id, cls: "btn ghost sm" }) : btn("lien-transit", "Créer et envoyer le lien", { id: v.id, icone: "upload", cls: "btn ghost sm" })}</div></div></div>`;
}
enregistrerBlocVoyage({ onglet: "documents", ordre: 12, rendu: blocLiensDepot });
enregistrerBlocVoyage({ onglet: "suivi", ordre: 21, rendu: blocLienTransit });

surAction("voyages", "*", async function (act, id, b) {
  if (act === "lien-depot") { const c = parId(S.commandes, id); return c ? partagerLienDepot(c) : undefined; }
  if (act === "lien-transit") { const v = parId(S.voyages, id); return v ? partagerLienTransit(v) : undefined; }
  if (act === "liens-verifier") return majLiens({ silencieux: false });
  return PASSER;
});
