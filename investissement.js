"use strict";
/* ============================================================
   Simulateur d'investissement (achat d'un camion) — logique pure, testée.
   Compare la charge fixe ajoutée à la marge au kilomètre réellement observée sur vos corridors.
   Dépend de tresorerie.js (pnlPeriode).
   ============================================================ */

/** Tableau d'amortissement d'un crédit à mensualités constantes. { mensualite, total_interets, lignes: [{ mois, interet, capital, reste }] } */
function tableauCredit(capital, tauxAnnuelPct, dureeMois) {
  const n = Math.max(0, Math.round(dureeMois)), K = Math.max(0, num(capital)), t = num(tauxAnnuelPct) / 1200;
  if (!n || !K) return { mensualite: 0, total_interets: 0, lignes: [] };
  const mensualite = t > 0 ? (K * t) / (1 - Math.pow(1 + t, -n)) : K / n, lignes = []; let reste = K, total_interets = 0;
  for (let m = 1; m <= n; m++) { const interet = reste * t, cap = m === n ? reste : mensualite - interet; reste -= cap; total_interets += interet; lignes.push({ mois: m, interet, capital: cap, reste: Math.max(0, reste) }); }
  return { mensualite, total_interets, lignes };
}

/** Corridors réellement exploités sur les derniers `jours` jours : [{ nom, nb, km, kmMoyen, margeKm }] (marge directe par kilomètre parcouru, retours à vide compris). */
function corridorsObserves(jours = 365, jusqua = today()) {
  const p = pnlPeriode(ajouterJours(jusqua, -jours), jusqua);
  return { corridors: p.par_corridor.filter((c) => c.km > 0).map((c) => ({ nom: c.nom, nb: c.nb, km: c.km, kmMoyen: c.km / c.nb, margeKm: c.marge_directe / c.km })),
    flotte: { margeKm: p.km ? p.marge_brute / p.km : 0, km: p.km, kmMoisParCamion: p.km && S.camions.length ? p.km / p.mois / S.camions.length : 0 } };
}

/**
 * Simule l'achat d'un camion.
 * h : { prix, mode: "comptant" | "credit" | "leasing", apport, taux (% annuel), duree_mois, loyer, annexes_mensuel (assurance, taxe…), km_mois (kilomètres par mois à pleine charge),
 *       taux_charge (%), corridors: [{ nom, pct, margeKm }], duree_amort_ans, valeur_residuelle }
 * Renvoie la charge fixe mensuelle ajoutée, la marge attendue, le taux de charge d'équilibre, le délai de retour, l'effet sur la trésorerie mois par mois (36 mois) et un tableau de sensibilité.
 */
function simulerInvestissement(h) {
  const prix = num(h.prix), mode = ["credit", "leasing"].includes(h.mode) ? h.mode : "comptant", annexes = num(h.annexes_mensuel), kmMois = num(h.km_mois), tc = num(h.taux_charge, 100);
  const cor = (h.corridors || []).filter((c) => num(c.pct) > 0), totalPct = cor.reduce((s, c) => s + num(c.pct), 0);
  const margeKm = totalPct ? cor.reduce((s, c) => s + num(c.pct) * num(c.margeKm), 0) / totalPct : 0;
  const apport = mode === "credit" ? Math.min(num(h.apport), prix) : 0, duree = Math.round(num(h.duree_mois));
  const credit = mode === "credit" ? tableauCredit(prix - apport, h.taux, duree) : { mensualite: 0, total_interets: 0, lignes: [] };
  const amort = (prix - Math.min(num(h.valeur_residuelle), prix)) / (Math.max(1, num(h.duree_amort_ans, 5)) * 12);
  const financement = mode === "credit" ? credit.mensualite : mode === "leasing" ? num(h.loyer) : amort;
  const fixe_mensuel = financement + annexes;
  const marge = (charge, mk = margeKm) => (kmMois * charge * mk) / 100;
  const marge_mensuelle = marge(tc), resultat_mensuel = marge_mensuelle - fixe_mensuel;
  const seuil_charge = kmMois * margeKm > 0 ? (fixe_mensuel / (kmMois * margeKm)) * 100 : null;
  // trésorerie : ce qui sort et rentre réellement (l'amortissement comptable n'est pas une sortie d'argent)
  const sortie = (m) => annexes + (mode === "credit" ? (m <= duree ? credit.mensualite : 0) : mode === "leasing" ? (!duree || m <= duree ? num(h.loyer) : 0) : 0);
  const depart = mode === "comptant" ? -prix : -apport, tresorerie = [{ mois: 0, flux: depart, cumul: depart }];
  let cumul = depart, retour_mois = depart >= 0 && marge_mensuelle - sortie(1) >= 0 ? 0 : null;
  for (let m = 1; m <= 120; m++) { const flux = marge_mensuelle - sortie(m); cumul += flux; if (m <= 36) tresorerie.push({ mois: m, flux, cumul }); if (retour_mois === null && cumul >= 0) retour_mois = m; }
  const charges = [50, 60, 70, 80, 90, 100], scenarios = [{ nom: "Répartition prévue", margeKm }, ...cor.map((c) => ({ nom: `100 % ${c.nom}`, margeKm: num(c.margeKm) }))];
  const sensibilite = { charges, lignes: scenarios.map((s) => ({ nom: s.nom, margeKm: s.margeKm, resultats: charges.map((c) => marge(c, s.margeKm) - fixe_mensuel) })) };
  return { mode, prix, apport, mensualite: credit.mensualite, total_interets: credit.total_interets, tableau_credit: credit.lignes, amortissement_mensuel: amort, financement_mensuel: financement, fixe_mensuel, marge_km: margeKm, marge_mensuelle, resultat_mensuel,
    seuil_charge, atteignable: seuil_charge !== null && seuil_charge <= 100, retour_mois, tresorerie, impact_36: tresorerie[tresorerie.length - 1].cumul, point_bas: Math.min(...tresorerie.map((x) => x.cumul)), sensibilite };
}
