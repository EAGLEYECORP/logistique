"use strict";
/* ============================================================
   « Annuler » dans le message de confirmation, plutôt qu'une question avant d'agir.
   Après les gestes courants (étape d'un voyage ou d'un port, commande avancée, facture encaissée, étapes du chauffeur, quai), le message
   qui confirme l'action reçoit un bouton « Annuler » pendant 6 secondes : il remet les données comme avant le geste.
   Chargé en dernier : il enveloppe les actions des pages telles que les autres fichiers les ont laissées.
   ============================================================ */

const ACTES_ANNULABLES = { voyages: ["jalon", "annuler-jalon", "port-etape", "passage-fait"], passages: ["passage-fait"], commandes: ["avancer", "devis-accepte"], factures: ["payer"], demandes: ["dem-ignorer", "dem-retrier"], chauffeur: ["chf-etape", "chf-quai", "chf-service", "chf-fin"] };
function proposerAnnulation(avant, toastsAvant) {
  const zone = document.getElementById("toasts"), t = zone?.lastElementChild;
  if (!t || [...zone.children].indexOf(t) < 0 || toastsAvant.has(t) || t.querySelector(".toast-annuler")) return;
  clearTimeout(t._fin); t._fin = setTimeout(() => t.remove(), 6000); t.classList.add("annulable");
  const b = document.createElement("button"); b.type = "button"; b.className = "toast-annuler"; b.textContent = "Annuler";
  b.addEventListener("click", () => {
    const etat = JSON.parse(avant); for (const k of Object.keys(S)) if (!(k in etat)) delete S[k]; Object.assign(S, etat);
    t.remove(); sauver(); toast("Annulé : retour à l'état d'avant"); rafraichir();
  });
  t.append(b);
}
for (const [page, actes] of Object.entries(ACTES_ANNULABLES)) {
  autourAction(page, actes, async (suite) => {
    const avant = JSON.stringify(S), toastsAvant = new Set(document.getElementById("toasts")?.children || []);
    const r = await suite();
    if (JSON.stringify(S) !== avant) proposerAnnulation(avant, toastsAvant);
    return r;
  }, { ordre: 10, nom: "annuler" });
}
