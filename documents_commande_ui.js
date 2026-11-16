"use strict";
/* ============================================================
   Documents attendus du client (interface) :
   · une pastille par commande (« Docs 3/5 », rouge s'il manque un bloquant à l'approche du chargement), qui ouvre la liste ;
   · liste : reçu (référence), non requis ; « Demander les manquants » prépare le message au client (WhatsApp ou e-mail, dans sa langue) ;
   · sur la fiche du voyage : documents de l'aller et du retour, en une ligne.
   Logique pure dans documents_commande.js.
   ============================================================ */

function niveauDocuments(c) {
  const e = etatDocuments(c); if (!e.total) return null;
  if (e.complet) return { e, niveau: "ok" };
  const j = c.dateChargement ? joursEntre(today(), c.dateChargement) : 99;
  return { e, niveau: e.bloquantsManquants.length && j <= 3 && ["devis", "confirme"].includes(c.statut) ? "danger" : "warn" };
}
function puceDocuments(c) {
  const n = niveauDocuments(c); if (!n) return "";
  return `<button type="button" class="puce-docs ${n.niveau}" data-act="documents" data-id="${c.id}" title="${n.e.complet ? "Tous les documents sont reçus" : "Manque : " + esc(n.e.manquants.map((x) => x.lib).join(", "))}">${ic("file")}Docs ${n.e.recus}/${n.e.total}</button>`;
}
async function ouvrirDocuments(c) {
  const e = etatDocuments(c), cl = parId(S.clients, c.clientId);
  const ligne = (x) => `<div class="doc-ligne ${x.nonRequis ? "non-requis" : x.recu ? "recu" : x.bloquant ? "bloquant" : ""}">
    <label class="check"><input type="checkbox" name="recu__${x.id}" ${x.recu ? "checked" : ""}><span><strong>${esc(x.lib)}</strong><span class="sub">${esc(x.qui)}${x.bloquant ? " · bloque le départ" : ""}${x.recu ? ` · reçu le ${dateFr(x.recu.slice(0, 10))}` : ""}</span></span></label>
    <input type="text" name="ref__${x.id}" value="${esc(x.ref)}" placeholder="N° / référence" aria-label="Référence : ${esc(x.lib)}">
    <label class="check petit"><input type="checkbox" name="nr__${x.id}" ${x.nonRequis ? "checked" : ""}><span>Non requis</span></label></div>`;
  const f = await modale({ titre: `Documents — ${c.ref}`, valider: "Enregistrer", corps: `<p class="doc-tete">${esc(nomClient(c.clientId))} · ${esc(c.origine || "?")} → ${esc(c.destination || "?")} · chargement ${dateFr(c.dateChargement)}${e.frais ? " · marchandise fraîche" : ""}</p>
    <div class="doc-liste">${e.attendus.map(ligne).join("")}</div>
    <label class="check" style="margin-top:10px"><input type="checkbox" name="demander" ${e.manquants.length ? "checked" : ""}><span>Après l'enregistrement, préparer le message au client pour les manquants${cl?.tel || cl?.email ? "" : " (aucun téléphone ni e-mail sur la fiche du client)"}</span></label>
    <p class="hint">Liste selon le sens (${e.sens === "export" ? "export du Maroc" : e.sens === "import" ? "import au Maroc" : e.sens}) et la marchandise, à confirmer avec votre transitaire.</p>` });
  if (!f) return;
  for (const x of e.attendus) noterDocument(c, x.id, { recu: f[`recu__${x.id}`] ? (x.recu || true) : false, ref: f[`ref__${x.id}`] || "", nonRequis: !!f[`nr__${x.id}`] });
  sauver(); const apres = etatDocuments(c);
  toast(apres.complet ? `${c.ref} : tous les documents sont reçus` : `${c.ref} : ${apres.recus}/${apres.total} documents reçus`, apres.complet ? "ok" : "warn"); rafraichir();
  if (f.demander && apres.manquants.length) await envoyerDemandeDocuments(c);
}
async function envoyerDemandeDocuments(c) {
  const d = demandeDocuments(c), cl = parId(S.clients, c.clientId) || {};
  const r = await modale({ titre: `Demander les documents — ${c.ref}`, valider: "Préparer l'envoi", corps: `<label class="f full">Message (${{ fr: "français", en: "anglais", es: "espagnol" }[d.langue]}, langue du client)<textarea name="texte" rows="10">${esc(d.texte)}</textarea></label>` });
  if (!r) return;
  const texte = String(r.texte || d.texte), tel = typeof telInternational === "function" ? telInternational(cl.tel) : "", liens = [];
  if (tel) liens.push(`<a class="btn" href="https://wa.me/${tel}?text=${encodeURIComponent(texte)}" target="_blank" rel="noopener">WhatsApp — ${esc(cl.tel)}</a>`);
  if (cl.email) liens.push(`<a class="btn ${tel ? "ghost" : ""}" href="mailto:${esc(cl.email)}?subject=${encodeURIComponent(d.sujet)}&body=${encodeURIComponent(texte)}">E-mail — ${esc(cl.email)}</a>`);
  c.demandesDocs = [...(c.demandesDocs || []), { date: new Date().toISOString(), manquants: d.manquants.map((x) => x.id) }].slice(-10); sauver();
  await modale({ titre: "Envoyer au client", valider: "Fermer", annuler: "", corps: liens.length ? `<div class="liens-envoi">${liens.join("")}</div><p class="hint">Le message s'ouvre prêt à envoyer. La demande est notée sur la commande.</p>` : `<p>Aucun téléphone ni e-mail sur la fiche de ${esc(cl.nom || "ce client")}. Copiez le message :</p><textarea rows="8" readonly style="width:100%">${esc(texte)}</textarea>` });
}
if (VUES.commandes) {
  const agirCommandesAvantDocs = VUES.commandes.agir;
  VUES.commandes.agir = async function (act, id, b) { if (act === "documents") { const c = parId(S.commandes, id); return c ? ouvrirDocuments(c) : undefined; } return agirCommandesAvantDocs.call(this, act, id, b); };
}

/* ---------- fiche du voyage ---------- */
function blocDocumentsVoyage(v) {
  if (v.statut === "annule") return "";
  const lignes = [["aller", commandeAller(v)], ["retour", commandeRetour(v)]].filter(([, c]) => c && niveauDocuments(c));
  if (!lignes.length) return "";
  return `<div class="section-title">Documents du client</div>${lignes.map(([sens, c]) => { const n = niveauDocuments(c);
    return `<div class="trav docs-voyage ${n.niveau}"><div><strong>${sens === "aller" ? "Aller" : "Retour"} · ${esc(c.ref)} · ${n.e.recus}/${n.e.total} reçus</strong><span class="sub">${n.e.complet ? "Tout est là." : "Manque : " + esc(n.e.manquants.map((x) => x.lib).join(", "))}${c.demandesDocs?.length ? ` · demandé le ${dateFr(c.demandesDocs[c.demandesDocs.length - 1].date.slice(0, 10))}` : ""}</span></div>
      <div class="r">${btn("docs-voyage", n.e.complet ? "Voir" : "Mettre à jour", { id: c.id, cls: `btn ${n.e.complet ? "ghost " : ""}sm`, icone: "file" })}</div></div>`; }).join("")}`;
}
if (typeof blocFacturation === "function") { const blocFacturationAvantDocs = blocFacturation; blocFacturation = function (v) { return blocDocumentsVoyage(v) + blocFacturationAvantDocs(v); }; }
const agirVoyagesAvantDocs = VUES.voyages.agir;
VUES.voyages.agir = async function (act, id, b) { if (act === "docs-voyage") { const c = parId(S.commandes, id); if (c) { const l = voyageDeCommande(c); if (l) voyagesOuverts.add(l.v.id); return ouvrirDocuments(c); } return; } return agirVoyagesAvantDocs.call(this, act, id, b); };
