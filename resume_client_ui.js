"use strict";
/* ============================================================
   Résumé hebdomadaire par client (interface) — logique dans resume_client.js.
   · bouton « Résumé » sur la page Clients : semaine dernière, cette semaine ou 4 dernières semaines ; chiffres et message dans la
     langue du client, modifiable ; « Envoyer maintenant » (par le relais, sinon WhatsApp ou e-mail en un geste) ;
   · l'envoi automatique du lundi (fiche du client : « résumé de sa semaine ») est confié au relais avec le plan (notifier.js).
   ============================================================ */

const PERIODES_RESUME = [["passee", "Semaine passée"], ["courante", "Cette semaine"], ["quatre", "4 semaines"]];
function periodeResume(k, maintenant = Date.now()) {
  const lundi = lundiDeLaSemaine(dateLocale(maintenant / 1000));
  if (k === "courante") return { debut: lundi, fin: joursPlus(lundi, 6) };
  if (k === "quatre") return { debut: joursPlus(lundi, -28), fin: joursPlus(lundi, -1) };
  return { debut: joursPlus(lundi, -7), fin: joursPlus(lundi, -1) };
}
function chiffresResume(r) {
  const retard = r.documents.filter((x) => x.statut === "en_retard").length, manque = r.documents.length - retard;
  const k = (titre, valeur, detail, niveau = "") => `<div class="kpi"><div class="l">${esc(titre)}</div><div class="v">${valeur}</div><div class="s ${niveau === "warn" ? "warn" : ""}">${detail}</div></div>`;
  return `<div class="kpis kpis-resume">
    ${k("Livraisons", r.livraisons.length, r.tauxPonctualite === null ? (r.livraisons.length ? "sans heure promise" : "aucune") : `${r.aLHeure} à l'heure · ${r.tauxPonctualite} %`, r.enRetard ? "warn" : r.livraisons.length ? "ok" : "")}
    ${k("Attente aux quais", r.attentes.length ? dureeResume(r.attenteMin) : "—", r.attentes.length ? `${r.attentes.length} passage(s)${r.auDelaMin ? ` · ${dureeResume(r.auDelaMin)} au-delà` : ""}` : "aucun passage", r.auDelaMin ? "warn" : "")}
    ${k("Documents", r.documents.length ? `${r.documents.length}` : r.chargementsSuivis ? "0" : "—", r.documents.length ? [retard && `${retard} en retard`, manque && `${manque} manquant(s)`].filter(Boolean).join(" · ") : r.chargementsSuivis ? "tous à temps" : "liste non tenue cette semaine", r.documents.length ? "warn" : "")}
    ${k("À préparer", r.aPreparer.length, r.aPreparer.length ? "documents encore attendus" : "rien en attente")}
  </div>`;
}
let periodeResumeSuivante = "";
async function ouvrirResumeClient(cl, k = "passee") {
  for (;;) {
    const p = periodeResume(k), r = resumeClient(cl.id, p), m = messageResumeClient(r), d = destinataireResume(cl);
    const langue = { fr: "français", en: "anglais", es: "espagnol" }[m.langue] || m.langue;
    const corps = `<div class="segmented periodes" role="tablist" aria-label="Période">${PERIODES_RESUME.map(([x, l]) => `<button type="button" role="tab" data-periode="${x}" aria-selected="${x === k}">${l}</button>`).join("")}</div>
      <p class="hint">Du ${dateFr(p.debut)} au ${dateFr(p.fin)}</p>${chiffresResume(r)}
      ${r.vide ? `<p class="hint">Rien à résumer sur cette période : pas de livraison, pas de passage aux quais, pas de chargement.</p>` : `<label class="f full">Message au client (${esc(langue)})<textarea name="texte" rows="12">${esc(m.texte)}</textarea></label>`}
      <p class="hint">${cl.resumeHebdo ? `Envoyé automatiquement chaque lundi à 8 h${d.manque ? ` — ${esc(d.manque)}` : ` (${d.canal === "email" ? "e-mail" : "WhatsApp"})`}, une fois la semaine finie.` : "Pour l'envoyer chaque lundi : cochez « résumé de sa semaine » sur la fiche du client (Modifier)."}</p>`;
    periodeResumeSuivante = "";
    const f = await modale({ titre: `Résumé — ${cl.nom}`, valider: r.vide || d.manque ? "Fermer" : "Envoyer maintenant", annuler: r.vide || d.manque ? "" : "Fermer", corps });
    if (periodeResumeSuivante) { k = periodeResumeSuivante; continue; }
    if (!f || r.vide || d.manque) return;
    const texte = String(f.texte || m.texte).trim();
    const res = await envoyerNotifications([{ id: `resume:${cl.id}:${p.debut}:manuel`, cle: `resume:${cl.id}:${p.debut}:${p.fin}:manuel`, canal: d.canal, destination: d.destination, sujet: m.sujet, texte, nom: cl.nom }], { forcer: true });
    if (res.envoyes) toast(`Résumé envoyé à ${cl.nom}`, "ok");
    else if (res.liens.length) window.open(res.liens[0].href, "_blank", "noopener");
    else toast(res.erreurs[0] || "Envoi impossible.", "danger");
    return;
  }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("#modale [data-periode]"); if (!b) return;
  periodeResumeSuivante = b.dataset.periode; $("#modale").close();
});
surAction("clients", ["resume"], async (act, id) => { const cl = parId(S.clients, id); if (cl) return ouvrirResumeClient(cl); });
