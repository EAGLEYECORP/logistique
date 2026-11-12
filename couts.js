"use strict";
/* ============================================================
   Coûts de structure — logique pure, testée :
   · charges fixes et amortissement de chaque camion ;
   · charges générales de l'entreprise et leur répartition (au kilomètre, au chiffre d'affaires, par camion, à parts égales) ;
   · échéances datées (TVA, assurance, crédit…), ponctuelles ou récurrentes.
   Dépend de noyau.js (état S, num, dates).
   ============================================================ */

const CATEGORIES_CHARGE = [["loyer", "Loyer"], ["salaires_bureau", "Salaires du bureau"], ["assurance_bureau", "Assurance du bureau"], ["comptable", "Comptable"], ["telephone", "Téléphone, internet"], ["energie", "Énergie"], ["marketing", "Commercial, publicité"], ["autres", "Autres"]];
const CLES_ALLOCATION = [["km", "Au kilomètre"], ["revenue", "Au chiffre d'affaires"], ["camion_count", "Par camion"], ["equal", "À parts égales"]];
const TYPES_ECHEANCE = [["taxe_tva", "TVA"], ["taxe_is", "Impôt sur les sociétés"], ["assurance", "Assurance"], ["inspect_tech", "Visite technique"], ["visa", "Visa"], ["credit_leasing", "Crédit / leasing"], ["salaire", "Salaires"], ["loyer", "Loyer"], ["autre", "Autre"]];
const FREQUENCES = [["", "Une seule fois"], ["mensuel", "Chaque mois"], ["trimestriel", "Chaque trimestre"], ["annuel", "Chaque année"]];
const BUREAUX = [["maroc", "Maroc"], ["allemagne", "Allemagne"]];
const libDe = (liste, k) => liste.find((x) => x[0] === k)?.[1] || k || "";

/** Date ISO décalée de n mois ; le jour est ramené à la fin du mois s'il n'existe pas (31 janvier + 1 mois = 28 ou 29 février). */
function ajouterMois(iso, n) {
  const [a, m, j] = iso.slice(0, 10).split("-").map(Number), t = a * 12 + (m - 1) + n, a2 = Math.floor(t / 12), m2 = t % 12;
  const dernier = new Date(Date.UTC(a2, m2 + 1, 0)).getUTCDate();
  return `${a2}-${String(m2 + 1).padStart(2, "0")}-${String(Math.min(j, dernier)).padStart(2, "0")}`;
}
const moisEntre = (a, b) => { const [a1, m1, j1] = a.split("-").map(Number), [a2, m2, j2] = b.split("-").map(Number); return (a2 - a1) * 12 + (m2 - m1) - (j2 < j1 ? 1 : 0); };

/**
 * Amortissement d'un camion à une date : { mensuel, cumul, vnc (valeur nette comptable), termine }.
 * Linéaire : (prix − valeur résiduelle) / durée. Dégressif : taux linéaire × coefficient (1,5 pour 3–4 ans, 2 pour 5–6 ans, 3 au-delà) appliqué à la valeur restante,
 * avec passage au linéaire sur les années restantes dès qu'il devient plus élevé. Coefficients fiscaux marocains : à confirmer avec votre comptable.
 */
function amortissementCamion(c, date = today()) {
  const a = c?.amortissement || {}, prix = num(a.prix_acquisition), duree = num(a.duree_ans), resid = Math.min(num(a.valeur_residuelle), prix);
  if (!(prix > 0) || !(duree > 0) || !a.date_acquisition) return { mensuel: 0, cumul: 0, vnc: prix || 0, termine: false, renseigne: false };
  const base = prix - resid, ecoules = moisEntre(a.date_acquisition.slice(0, 10), date.slice(0, 10)), total = Math.round(duree * 12);
  if (ecoules < 0) return { mensuel: 0, cumul: 0, vnc: prix, termine: false, renseigne: true };
  if (ecoules >= total) return { mensuel: 0, cumul: base, vnc: resid, termine: true, renseigne: true };
  if (a.methode !== "degressif") { const m = base / total; return { mensuel: m, cumul: m * ecoules, vnc: prix - m * ecoules, termine: false, renseigne: true }; }
  const coef = duree <= 4 ? 1.5 : duree <= 6 ? 2 : 3, annee = Math.floor(ecoules / 12);
  let reste = base, cumul = 0, annuite = 0;
  for (let n = 0; n <= annee; n++) {
    annuite = Math.max(reste * (coef / duree), reste / (duree - n));
    if (n < annee) { cumul += annuite; reste -= annuite; }
  }
  const m = annuite / 12, dansAnnee = ecoules - annee * 12;
  return { mensuel: m, cumul: cumul + m * dansAnnee, vnc: prix - cumul - m * dansAnnee, termine: false, renseigne: true };
}

/**
 * Charges fixes mensuelles d'un camion (MAD). Détail (crédit, assurance, taxe routière, amortissement) s'il est renseigné ; sinon l'ancien montant global.
 * Le budget d'entretien n'est pas compté ici : l'entretien réel (interventions) l'est déjà dans la rentabilité ; il sert aux prévisions.
 */
function fixesMensuelsCamion(c, date = today()) {
  const f = c?.coutsFixes || {}, am = amortissementCamion(c, date);
  const leasing = num(f.leasing_mensuel), assurance = num(f.assurance_mensuel), taxe = num(f.taxe_routiere_annuelle) / 12;
  const detail = leasing + assurance + taxe > 0 || am.renseigne;
  const total = detail ? leasing + assurance + taxe + am.mensuel : num(c?.fixeMensuel);
  return { leasing, assurance, taxe, amortissement: am.mensuel, entretienBudget: num(f.entretien_mensuel_budget), total, detail };
}

/** Charges générales mensuelles (MAD) : la liste détaillée, sinon l'ancien montant « frais généraux » réparti par camion. */
function chargesGeneralesMois() {
  const l = (S.chargesGenerales || []).filter((g) => num(g.montant_mensuel) > 0).map((g) => ({ id: g.id, libelle: g.libelle || libDe(CATEGORIES_CHARGE, g.categorie), montant: num(g.montant_mensuel), categorie: g.categorie || "autres", cle: CLES_ALLOCATION.some((x) => x[0] === g.cle_allocation) ? g.cle_allocation : "camion_count" }));
  if (l.length) return l;
  const ancien = num(S.params.fraisGenerauxMois);
  return ancien > 0 ? [{ id: "ancien", libelle: "Frais généraux", montant: ancien, categorie: "autres", cle: "camion_count", projete: true }] : [];
}

/**
 * Répartit un montant entre des unités [{ id, km, ca, camionId }] selon une clé. Renvoie une Map id → part ; la somme des parts est exactement le montant.
 * km / revenue : au prorata (à parts égales si tous les poids sont nuls). camion_count : à parts égales entre camions, puis entre les unités de chaque camion. equal : à parts égales entre unités.
 */
function repartir(montant, cle, unites) {
  const r = new Map(); if (!unites.length) return r;
  let poids;
  if (cle === "camion_count") {
    const parCamion = new Map(); for (const u of unites) parCamion.set(u.camionId || "", (parCamion.get(u.camionId || "") || 0) + 1);
    poids = unites.map((u) => 1 / parCamion.size / parCamion.get(u.camionId || ""));
  } else {
    poids = unites.map((u) => (cle === "km" ? Math.max(0, num(u.km)) : cle === "revenue" ? Math.max(0, num(u.ca)) : 1));
    if (!(poids.reduce((a, b) => a + b, 0) > 0)) poids = unites.map(() => 1);
  }
  const somme = poids.reduce((a, b) => a + b, 0); let distribue = 0;
  unites.forEach((u, i) => { const part = i === unites.length - 1 ? montant - distribue : (montant * poids[i]) / somme; distribue += part; r.set(u.id, part); });
  return r;
}

/** Dates (ISO) auxquelles une échéance tombe entre deux dates comprises. */
function occurrencesEcheance(e, debut, fin) {
  if (!e?.date) return [];
  const pas = { mensuel: 1, trimestriel: 3, annuel: 12 }[e.recurs?.frequence], d0 = e.date.slice(0, 10), limite = e.recurs?.jusqu_a && e.recurs.jusqu_a < fin ? e.recurs.jusqu_a : fin;
  if (!pas) return d0 >= debut && d0 <= fin ? [d0] : [];
  const r = []; let n = Math.max(0, Math.floor(moisEntre(d0, debut) / pas));
  for (let d = ajouterMois(d0, n * pas); d <= limite && r.length < 500; d = ajouterMois(d0, ++n * pas)) if (d >= debut) r.push(d);
  return r;
}
/** Échéancier entre deux dates : [{ date, id, libelle, type, mad }] trié par date. */
function echeancier(debut, fin) {
  const r = [];
  for (const e of S.echeances || []) for (const date of occurrencesEcheance(e, debut, fin)) r.push({ date, id: e.id, libelle: e.libelle || libDe(TYPES_ECHEANCE, e.type), type: e.type || "autre", mad: e.devise === "EUR" ? num(e.montant) * S.params.tauxEUR : num(e.montant) });
  return r.sort((a, b) => a.date.localeCompare(b.date));
}
