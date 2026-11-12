"use strict";
/* ============================================================
   Marge d'un voyage en direct — logique pure, testée.
   Coûts directs (lignes réelles, sinon estimations) + part des charges fixes du camion (au temps passé)
   + part des charges générales (selon la clé de chaque charge, entre les voyages partis le même mois).
   Dépend de noyau.js, pilotage.js et couts.js.
   ============================================================ */

/** Voyages (hors annulés) partis le même mois : c'est entre eux que se répartissent les charges générales du mois. */
function voyagesDuMois(mois) { return S.voyages.filter((v) => v.statut !== "annule" && (v.dateDepart || "").slice(0, 7) === mois); }
const uniteVoyage = (v) => { const c = coutVoyage(v); return { id: v.id, camionId: v.camionId || "", km: c.km, ca: c.prix }; };

/**
 * Marge complète d'un voyage (montants en MAD).
 * { revenu, couts_directs[], total_direct, marge_directe, couts_fixes_alloues[], charges_generales_allouees[], total_structure, marge_nette, taux,
 *   km, km_charge, km_vide, cout_total_par_km, cout_par_km_charge, cout_vide, jours, carburant_estime }
 */
function margeVoyage(voyageId) {
  const v = typeof voyageId === "string" ? parId(S.voyages, voyageId) : voyageId;
  if (!v) return null;
  const c = coutVoyage(v), carb = carburantVoyage(v), jours = joursVoyage(v);
  const couts_directs = lignesVoyage(v).map((l) => ({ id: l.id, type: l.type, montant: l.mad, source: l.source, ref: l.ref || "", date: l.date || "", sens: l.sens || "", libelle: l.libelle || "", projete: !!l.projete, origine: l.devise === "EUR" ? { montant: num(l.montant), devise: "EUR" } : null }));
  if (carb.estime) couts_directs.push({ type: "carburant", montant: carb.mad, source: "calcule", ref: "", date: "", sens: "", libelle: "Estimé d'après les pleins du camion", projete: true, origine: null });
  const total_direct = couts_directs.reduce((s, l) => s + l.montant, 0), revenu = c.prix;
  const cam = parId(S.camions, v.camionId), couts_fixes_alloues = [];
  if (cam) { const f = fixesMensuelsCamion(cam, v.dateDepart || today()); if (f.total > 0) couts_fixes_alloues.push({ camionId: cam.id, montant: (f.total * jours) / JOURS_PAR_MOIS, cle: "jours", mensuel: f.total }); }
  const charges_generales_allouees = [];
  if (v.dateDepart && v.statut !== "annule") {
    const unites = voyagesDuMois(v.dateDepart.slice(0, 7)).map(uniteVoyage);
    if (!unites.some((u) => u.id === v.id)) unites.push(uniteVoyage(v));
    for (const g of chargesGeneralesMois()) { const m = repartir(g.montant, g.cle, unites).get(v.id) || 0; if (m > 0) charges_generales_allouees.push({ id: g.id, libelle: g.libelle, categorie: g.categorie, montant: m, cle: g.cle }); }
  }
  const total_structure = [...couts_fixes_alloues, ...charges_generales_allouees].reduce((s, x) => s + x.montant, 0);
  const marge_directe = revenu - total_direct, marge_nette = marge_directe - total_structure, complet = total_direct + total_structure;
  const km_vide = num(v.kmRetourVide), km_charge = c.km - km_vide;
  return { revenu, couts_directs, total_direct, marge_directe, couts_fixes_alloues, charges_generales_allouees, total_structure, marge_nette, taux: revenu ? (marge_nette / revenu) * 100 : 0,
    km: c.km, km_charge, km_vide, cout_total_par_km: c.km ? complet / c.km : 0, cout_par_km_charge: km_charge > 0 ? complet / km_charge : 0, cout_par_km_vide: c.km ? complet / c.km : 0, cout_vide: c.km ? (complet / c.km) * km_vide : 0, jours, carburant_estime: carb.estime };
}

/**
 * Évolution de la marge directe à mesure que les coûts arrivent : [{ date, marge }].
 * Premier point : prix de vente moins les estimations (sans date) ; puis un point par jour où une ligne réelle a été enregistrée.
 */
function historiqueMarge(v) {
  const m = margeVoyage(v); if (!m) return [];
  const sansDate = m.couts_directs.filter((l) => !l.date), datees = m.couts_directs.filter((l) => l.date).sort((a, b) => a.date.localeCompare(b.date));
  let marge = m.revenu - sansDate.reduce((s, l) => s + l.montant, 0);
  const pts = [{ date: v.dateDepart || datees[0]?.date || today(), marge }];
  for (const l of datees) { marge -= l.montant; const d = l.date.slice(0, 10), der = pts[pts.length - 1]; if (pts.length > 1 && der.date === d) der.marge = marge; else pts.push({ date: d, marge }); }
  return pts;
}
/** Tracé d'une courbe miniature : points « x,y » dans un cadre l × h (le zéro est renvoyé pour tracer la ligne d'équilibre). */
function courbeMini(valeurs, l = 64, h = 20) {
  if (!valeurs.length) return { points: "", zero: h };
  const min = Math.min(0, ...valeurs), max = Math.max(0, ...valeurs), etendue = max - min || 1, y = (x) => Math.round((h - 1 - ((x - min) / etendue) * (h - 2)) * 10) / 10;
  const pas = valeurs.length > 1 ? l / (valeurs.length - 1) : 0;
  return { points: (valeurs.length > 1 ? valeurs : [valeurs[0], valeurs[0]]).map((x, i) => `${Math.round((valeurs.length > 1 ? i * pas : i * l) * 10) / 10},${y(x)}`).join(" "), zero: y(0) };
}

const ecouteursMarge = new Set();
/** S'abonner aux changements de marge : fn({ voyageId, marge }). Renvoie la fonction de désabonnement. */
function surMargeVoyage(fn) { ecouteursMarge.add(fn); return () => ecouteursMarge.delete(fn); }
/** À appeler après toute entrée de coût : recalcule, mémorise le résumé sur le voyage et prévient les abonnés. */
function recalculerMargeVoyage(voyageId) {
  const v = parId(S.voyages, voyageId), m = v && margeVoyage(v);
  if (!m) return null;
  v.marge = { directe: Math.round(m.marge_directe), nette: Math.round(m.marge_nette), couts: Math.round(m.total_direct), maj: new Date().toISOString() };
  for (const fn of ecouteursMarge) { try { fn({ voyageId: v.id, marge: m }); } catch { /* un abonné défaillant ne bloque pas les autres */ } }
  return m;
}
