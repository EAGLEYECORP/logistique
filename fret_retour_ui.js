"use strict";
/* ============================================================
   Recherche du fret de retour (interface) :
   · fiche du voyage : « Trouver un retour » — prix plancher, chargeurs proches de la livraison (historique, dernier contact),
     message WhatsApp ou e-mail dans la langue de chacun, message à coller dans vos groupes WhatsApp, « Rentrer à vide » ;
   · accueil : bloc « Retours à trouver » (jours avant livraison, prix plancher).
   Logique pure dans fret_retour.js ; la commande de retour elle-même : aller_retour_ui.js.
   ============================================================ */

async function chercherRetour(v) {
  const x = retoursATrouver().find((r) => r.v.id === v.id) || { v, livraison: livraisonAller(v), jours: joursEntre(today(), livraisonAller(v) || today()), livre: false, plancher: plancherRetour(v) };
  const ch = chargeursPour(v), generique = messageDisponibilite(v);
  const tete = `<div class="retour-tete"><div><span class="sub">Livraison de l'aller</span><strong>${esc(v.destination || "?")} · ${x.livre ? "livré" : dateFr(x.livraison)}${!x.livre && x.jours >= 0 ? ` (${x.jours === 0 ? "aujourd'hui" : `dans ${x.jours} j`})` : ""}</strong></div>
    <div><span class="sub">Prix plancher du retour</span><strong>${x.plancher.couvert ? "déjà couvert par l'aller" : `${fmt(x.plancher.eur)} € <span class="sub">(${fmt(x.plancher.mad)} MAD)</span>`}</strong></div></div>`;
  const ligne = (r) => { const m = messageDisponibilite(v, r.client), tel = typeof telInternational === "function" ? telInternational(r.client.tel) : "";
    return `<div class="retour-chargeur"><div><strong>${esc(r.client.nom)}</strong><span class="sub">${esc(r.ville)}${r.km ? ` · ${fmt(r.km)} km` : " · sur place"}${r.nb ? ` · ${r.nb} retour${r.nb > 1 ? "s" : ""}, dernier ${fmtDevise(r.dernierPrix, r.devise)} le ${dateFr(r.derniereDate)}` : ""}${r.dernierContact ? ` · contacté le ${dateFr(r.dernierContact.slice(0, 10))}` : ""}</span></div>
      <div class="r">${tel ? `<a class="btn sm" data-act="retour-contact" data-id="${v.id}|${r.client.id}" href="https://wa.me/${tel}?text=${encodeURIComponent(m.texte)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}${r.client.email ? `<a class="btn ghost sm" data-act="retour-contact" data-id="${v.id}|${r.client.id}" href="mailto:${esc(r.client.email)}?subject=${encodeURIComponent(m.sujet)}&body=${encodeURIComponent(m.texte)}">E-mail</a>` : ""}${!tel && !r.client.email ? `<span class="sub">ni téléphone ni e-mail</span>` : ""}</div></div>`; };
  const r = await modale({ titre: `Trouver un retour — ${v.ref}`, valider: "Nouvelle commande de retour", annuler: "Fermer", corps: `${tete}
    <div class="section-title" style="margin-top:12px">Chargeurs près de ${esc(v.destination || "la livraison")} · ${ch.length}</div>
    ${ch.length ? `<div class="retour-liste">${ch.map(ligne).join("")}</div>` : `<p class="hint" style="margin:0">Aucun chargeur de retour à moins de 300 km. Sur la fiche de vos clients en Espagne ou en France, cochez « Chargeur de fret de retour » et indiquez leurs villes : ils apparaîtront ici.</p>`}
    <div class="section-title">Message pour vos groupes WhatsApp</div>
    <textarea id="retour-message" rows="6" readonly>${esc(generique.texte)}</textarea>
    <div class="row" style="margin-top:6px">${btn("retour-copier", "Copier le message", { id: v.id, cls: "btn ghost sm", icone: "file" })}${btn("retour-avide", "Rentrer à vide", { id: v.id, cls: "btn ghost sm", titre: "Plus d'alerte pour ce voyage" })}</div>` });
  if (r) return VUES.voyages.agir("retour-nouveau", v.id);
}
/** Actions communes (fiche du voyage, accueil, fenêtre de recherche). */
async function agirRetour(act, id) {
  if (act === "retour-contact") { const [vid, cid] = String(id).split("|"), v = parId(S.voyages, vid), cl = parId(S.clients, cid); if (v && cl) { noterContactRetour(cl, v); sauver(); } return true; }
  if (act === "retour-copier") { const t = document.getElementById("retour-message"); try { await navigator.clipboard.writeText(t.value); toast("Message copié : collez-le dans vos groupes"); } catch { t.select(); toast("Sélectionné : copiez-le", "warn"); } return true; }
  if (act === "retour-avide") { const v = parId(S.voyages, id); if (!v) return true; v.retourAVide = !v.retourAVide; sauver(); document.querySelector("dialog[open]")?.close(); toast(v.retourAVide ? `${v.ref} : retour à vide, plus d'alerte` : `${v.ref} : recherche de retour reprise`); rafraichir(); return true; }
  if (act === "retour-chercher") { const v = parId(S.voyages, id); if (v) { voyagesOuverts.add(v.id); await chercherRetour(v); } return true; }
  return false;
}
surAction(["voyages", "tableau"], "*", async (act, id) => ((await agirRetour(act, id)) ? undefined : PASSER));

/* ---------- fiche du voyage : bouton dans « Chargement de retour » ---------- */
if (typeof blocRetour === "function") {
  const blocRetourAvantRecherche = blocRetour;
  blocRetour = function (v) {
    const h = blocRetourAvantRecherche(v);
    if (v.commandeRetourId || v.statut === "annule") return h;
    if (v.retourAVide) return `<div class="section-title">Chargement de retour</div><div class="trav vide"><div><strong>Retour à vide</strong><span class="sub">Décidé : plus d'alerte pour ce voyage.</span></div><div class="r">${btn("retour-avide", "Reprendre la recherche", { id: v.id, cls: "btn ghost sm" })}${btn("retour-nouveau", "Nouvelle commande de retour", { id: v.id, icone: "plus", cls: "btn ghost sm" })}</div></div>`;
    return chercheRetour(v) ? h.replace('<div class="r">', `<div class="r">${btn("retour-chercher", "Trouver un retour", { id: v.id, icone: "search", cls: "btn sm" })}`) : h;
  };
}

/* ---------- accueil : retours à trouver ---------- */
if (VUES.tableau) {
    blocPage("tableau", { position: "avant", ordre: 20, rendu() {
    const html = "", l = retoursATrouver().filter((x) => x.jours <= 7);
    if (!l.length) return html;
    const bloc = `<div class="card" id="bloc-retours"><div class="card-head"><h2>Retours à trouver</h2>${badge(`${l.length} camion${l.length > 1 ? "s" : ""}`, l.some((x) => x.livre || x.jours <= 1) ? "danger" : "warn")}</div>
      ${l.slice(0, 4).map((x) => `<div class="trav"><div><strong>${esc(x.v.ref)} · ${esc(x.v.destination || "?")} · ${x.livre ? "livré" : x.jours <= 0 ? "livre aujourd'hui" : `livre dans ${x.jours} j`}</strong><span class="sub">${x.plancher.couvert ? "L'aller couvre déjà l'aller-retour" : `Prix plancher ${fmt(x.plancher.eur)} €`} · ${chargeursPour(x.v).length} chargeur(s) à proximité</span></div><div class="r">${btn("retour-chercher", "Trouver", { id: x.v.id, cls: "btn sm", icone: "search" })}</div></div>`).join("")}</div>`;
    return bloc + html;
  } });
}
// Les clics dans une fenêtre (dialog) ne passent pas par le gestionnaire des pages : on les capte ici.
document.addEventListener("click", (e) => {
  const b = e.target.closest?.('dialog [data-act^="retour-"]');
  if (b && ["retour-contact", "retour-copier", "retour-avide"].includes(b.dataset.act)) agirRetour(b.dataset.act, b.dataset.id);
});
