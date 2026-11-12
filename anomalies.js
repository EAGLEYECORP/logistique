"use strict";
/* ============================================================
   Détection d'anomalies par camion — logique pure, testée.
   Quatre mesures : coût direct au kilomètre, consommation (L/100 km), temps à l'arrêt (%), kilomètres à vide (%).
   Référence = moyenne des 90 jours précédents, recalculée une fois par semaine et mémorisée ; alerte quand les 7 derniers jours s'en écartent de plus de S.params.seuilAnomalie % (15 par défaut).
   Dépend de noyau.js, pilotage.js.
   ============================================================ */

const MESURES_ANOMALIE = [["coutKm", "Coût au kilomètre", "MAD/km", 2], ["conso", "Consommation", "L/100 km", 1], ["arret", "Temps à l'arrêt", "%", 0], ["vide", "Kilomètres à vide", "%", 0]];
const decalerJours = (iso, n) => dateISO(Date.parse(iso.slice(0, 10) + "T00:00:00Z") + n * 86400000);
/** Semaine ISO d'une date : « 2026-W46 ». */
function semaineISO(iso) {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z"), j = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - j + 3);
  const an = d.getUTCFullYear(), premier = new Date(Date.UTC(an, 0, 4)), n = 1 + Math.round(((d - premier) / 86400000 - 3 + ((premier.getUTCDay() + 6) % 7)) / 7);
  return `${an}-W${String(n).padStart(2, "0")}`;
}

/** Observations datées d'un camion pour une mesure : [{ date, valeur, poids, corridor? }] triées par date. */
function observationsCamion(camionId, mesure) {
  let r = [];
  if (mesure === "conso") { const c = consommations(camionId); r = S.pleins.filter((p) => p.camionId === camionId && c[p.id] > 0).map((p) => ({ date: p.date, valeur: c[p.id], poids: 1 })); }
  else if (mesure === "arret") r = S.traces.filter((t) => t.camionId === camionId && num(t.dureeH) > 0 && t.fin).map((t) => ({ date: dateISO(t.fin * 1000), valeur: Math.max(0, 1 - num(t.conduiteH) / num(t.dureeH)) * 100, poids: num(t.dureeH) }));
  else for (const v of S.voyages) {
    if (v.camionId !== camionId || v.statut === "annule" || !v.dateDepart) continue;
    const c = coutCompletVoyage(v); if (!(c.km > 0)) continue;
    if (mesure === "coutKm" && c.total > 0) r.push({ date: finVoyage(v), valeur: c.total / c.km, poids: c.km, corridor: corridorDe(v.origine, v.destination) });
    if (mesure === "vide") r.push({ date: finVoyage(v), valeur: (num(v.kmRetourVide) / c.km) * 100, poids: c.km });
  }
  return r.filter((o) => o.date && Number.isFinite(o.valeur)).sort((a, b) => a.date.localeCompare(b.date));
}
const moyennePonderee = (obs) => { const p = obs.reduce((s, o) => s + o.poids, 0); return p > 0 ? obs.reduce((s, o) => s + o.valeur * o.poids, 0) / p : null; };

/** Références d'un camion à une date : pour chaque mesure { valeur, n, pente } sur les 90 jours qui précèdent la dernière semaine. pente = hausse (%) du dernier tiers par rapport au premier. */
function referencesCamion(camionId, au = today(), { fenetre = 7, historique = 90 } = {}) {
  const fin = decalerJours(au, -fenetre), debut = decalerJours(fin, -historique), r = {};
  for (const [m] of MESURES_ANOMALIE) {
    const obs = observationsCamion(camionId, m).filter((o) => o.date > debut && o.date <= fin), valeur = moyennePonderee(obs);
    if (valeur === null) continue;
    const tiers = Math.max(1, Math.floor(obs.length / 3)), a = moyennePonderee(obs.slice(0, tiers)), b = moyennePonderee(obs.slice(-tiers));
    r[m] = { valeur, n: obs.length, pente: obs.length >= 3 && a > 0 ? ((b - a) / a) * 100 : 0 };
  }
  return r;
}
/** Recalcule et mémorise les références une fois par semaine (S.meta.references). Renvoie vrai si elles viennent d'être recalculées. */
function majReferences(au = today()) {
  const semaine = semaineISO(au);
  if (S.meta.references?.semaine === semaine) return false;
  S.meta.references = { semaine, date: au.slice(0, 10), camions: Object.fromEntries(S.camions.map((c) => [c.id, referencesCamion(c.id, au)])) };
  return true;
}
const prixLitreMoyen = (camionId, debut, fin) => { const p = S.pleins.filter((x) => x.camionId === camionId && x.date > debut && x.date <= fin && num(x.litres) > 0 && num(x.prix) > 0), l = p.reduce((s, x) => s + num(x.litres), 0); return l ? p.reduce((s, x) => s + num(x.litres) * num(x.prix), 0) / l : null; };

/**
 * Anomalies en cours : [{ camionId, immat, mesure, lib, unite, reference, recent, ecart (%), allure: "brutale" | "progressive", categorie, cause, texte, niveau }].
 * Références : celles mémorisées cette semaine (S.meta.references), sinon calculées à la volée. Il faut au moins 3 observations de référence.
 */
function anomalies(au = today(), { fenetre = 7 } = {}) {
  const seuil = num(S.params.seuilAnomalie, 15), memo = S.meta?.references, res = [];
  for (const c of S.camions) {
    const dateRef = memo?.camions?.[c.id] ? memo.date : au, refs = memo?.camions?.[c.id] || referencesCamion(c.id, au, { fenetre }), debut = decalerJours(au, -fenetre), trouvees = [];
    for (const [m, lib, unite, dec] of MESURES_ANOMALIE) {
      const ref = refs[m]; if (!ref || ref.n < 3 || !(ref.valeur > 0)) continue;
      const tout = observationsCamion(c.id, m), obs = tout.filter((o) => o.date > debut && o.date <= au && o.date > decalerJours(dateRef, -fenetre)), recent = moyennePonderee(obs);
      if (recent === null) continue;
      const ecart = ((recent - ref.valeur) / ref.valeur) * 100;
      if (!(ecart > seuil) || (unite === "%" && recent - ref.valeur < 5)) continue;
      const allure = ref.pente > seuil / 2 ? "progressive" : "brutale";
      let categorie = m, cause;
      if (m === "conso") cause = allure === "brutale" ? "hausse brutale : fuite, vol de gasoil ou erreur de saisie à vérifier" : "hausse progressive : pneus, filtres, conduite ou charges plus lourdes";
      else if (m === "vide") { categorie = "retour_vide"; cause = "davantage de retours à vide : chercher du fret de retour"; }
      else if (m === "arret") cause = allure === "brutale" ? "attente inhabituelle (port, douane, panne)" : "temps d'arrêt en hausse régulière";
      else {
        const pRef = prixLitreMoyen(c.id, decalerJours(dateRef, -97), decalerJours(dateRef, -fenetre)), pRec = prixLitreMoyen(c.id, decalerJours(au, -30), au), hausse = pRef && pRec ? ((pRec - pRef) / pRef) * 100 : 0;
        const connus = new Set(tout.filter((o) => o.date <= decalerJours(dateRef, -fenetre)).map((o) => o.corridor));
        if (hausse > 5) { categorie = "prix_carburant"; cause = `le prix du gasoil a augmenté de ${fmt(hausse, 0)} %`; }
        else if (obs.some((o) => !connus.has(o.corridor))) { categorie = "itineraire"; cause = `nouveau corridor (${obs.find((o) => !connus.has(o.corridor)).corridor})`; }
        else if (trouvees.includes("conso")) { categorie = "consommation"; cause = "la consommation a augmenté"; }
        else cause = allure === "brutale" ? "dépense exceptionnelle à vérifier (amende, dépannage, péage)" : "dérive progressive des coûts";
      }
      trouvees.push(m);
      res.push({ camionId: c.id, immat: c.immat, mesure: m, lib, unite, reference: ref.valeur, recent, ecart, allure, categorie, cause, niveau: ecart > seuil * 2 ? "danger" : "warn",
        texte: `${c.immat} — ${lib.toLowerCase()} ${fmt(recent, dec)} ${unite} sur 7 jours, soit +${fmt(ecart, 0)} % par rapport à sa référence (${fmt(ref.valeur, dec)}) — ${cause}` });
    }
  }
  return res.sort((a, b) => b.ecart - a.ecart);
}
