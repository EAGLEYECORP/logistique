"use strict";
/* ============================================================
   Prix du jour — logique pure, testée.
   · taux EUR → MAD du jour (Bank Al-Maghrib, par le relais) appliqué aux calculs ; chaque voyage terminé ou facturé garde le taux de son jour ;
   · prix du gazole : au Maroc, ce que vous avez réellement payé (pleins et cartes carburant des 14 derniers jours) ;
     en Espagne et en France, les prix officiels du jour (relais) et ceux de vos cartes ;
   · carburant d'un voyage prévu, tant qu'aucune dépense réelle n'existe : kilomètres × consommation × prix du jour.
   Dépend de noyau.js et pilotage.js.
   ============================================================ */

/** Médiane des prix au litre réellement payés sur les `jours` derniers jours : { MA: { prix (MAD/L), n, dernier }, ES/FR/… : { prix (EUR/L), n, dernier } }. */
function prixGasoilReels(auj = today(), jours = 14) {
  const depuis = dateISO(Date.parse(auj + "T00:00:00Z") - jours * 86400000), par = {};
  const noter = (pays, prix, date) => { if (!(prix > 0) || !date || date < depuis || date > auj) return; (par[pays] ||= []).push({ prix, date }); };
  for (const p of S.pleins) if (num(p.litres) > 0) noter("MA", num(p.prix), String(p.date || "").slice(0, 10)); // les pleins sont en MAD
  for (const v of S.voyages) for (const l of v.lignesCout || []) if (l.type === "carburant" && num(l.litres) > 0) noter(l.devise === "MAD" ? "MA" : (l.pays || "EU").toUpperCase(), num(l.montant) / num(l.litres), String(l.date || "").slice(0, 10));
  const r = {};
  for (const [pays, l] of Object.entries(par)) { const t = l.map((x) => x.prix).sort((a, b) => a - b), m = Math.floor(t.length / 2); r[pays] = { prix: Math.round((t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2) * 1000) / 1000, n: t.length, dernier: l.map((x) => x.date).sort().pop() }; }
  return r;
}
/**
 * Applique les prix du jour reçus du relais : taux EUR → MAD (s'il date de moins de 7 jours), prix du gazole par pays, prix marocain d'après vos pleins.
 * Renvoie la liste des changements (pour l'affichage). marches : réponse de /api/marches (facultatif : sans relais, seuls vos pleins comptent).
 */
function appliquerPrixDuJour(marches, auj = today()) {
  const changes = [], P = S.params;
  const t = marches?.taux;
  if (t?.eurMad > 5 && t.eurMad < 20 && (!t.date || joursEntre(t.date, auj) <= 7)) {
    if (Math.abs(num(P.tauxEUR) - t.eurMad) >= 0.0001) changes.push(`taux EUR → MAD : ${fmt(P.tauxEUR, 4)} → ${fmt(t.eurMad, 4)}`);
    P.tauxEUR = t.eurMad; P.tauxEURInfo = { date: t.date || auj, source: t.source || "", officiel: !!t.officiel, maj: new Date().toISOString() };
  }
  const reels = prixGasoilReels(auj), jour = { maj: new Date().toISOString() };
  if (reels.MA) { jour.MA = { prix: reels.MA.prix, unite: "MAD/L", n: reels.MA.n, dernier: reels.MA.dernier, source: "vos pleins et cartes carburant" }; if (Math.abs(num(P.prixGasoil) - reels.MA.prix) >= 0.005) changes.push(`gazole Maroc : ${fmt(P.prixGasoil, 2)} → ${fmt(reels.MA.prix, 2)} MAD/L`); P.prixGasoil = reels.MA.prix; }
  for (const pays of ["ES", "FR"]) {
    const o = marches?.carburant?.[pays], vous = reels[pays];
    if (o?.prix || vous) jour[pays] = { prix: o?.prix ?? vous.prix, unite: "EUR/L", date: o?.date || vous?.dernier || "", source: o?.prix ? o.source : "vos cartes carburant", ...(pays === "ES" && o?.algeciras ? { algeciras: o.algeciras } : {}), ...(pays === "FR" && o?.poidsLourds ? { poidsLourds: o.poidsLourds, pyreneesOrientales: o.pyreneesOrientales } : {}), ...(vous ? { paye: vous.prix, nPaye: vous.n } : {}) };
  }
  P.prixGasoilJour = jour;
  return changes;
}
/** Fige le taux des voyages terminés ou facturés qui n'en ont pas encore (leur marge ne bouge plus avec le taux du jour). Renvoie le nombre de voyages figés. */
function figerTauxVoyages() {
  let n = 0;
  for (const v of S.voyages) if (!(num(v.tauxEUR) > 0) && v.statut !== "annule" && (v.statut === "termine" || (typeof factureDuVoyage === "function" && factureDuVoyage(v)))) { v.tauxEUR = S.params.tauxEUR; n++; }
  return n;
}
/** Kilomètres d'un voyage au Maroc : saisis par pays si disponibles, sinon l'aller et le retour jusqu'au port (350 km par défaut chaque sens). */
function kmMarocVoyage(v, km) {
  const p = typeof lireKmPays === "function" && v.kmPays ? lireKmPays(v.kmPays) : null, ma = p && (p.MA ?? p.Maroc ?? p.ma);
  if (ma !== null && ma !== undefined && Number.isFinite(Number(ma))) return Math.min(km, Number(ma));
  return Math.min(km, 2 * (num(S.params.kmMarocParSens) || 350));
}
/** Carburant d'un voyage prévu ou en cours estimé au prix du jour : { mad, detail } ou null (pas de prix du jour, pas de kilomètres, voyage terminé). */
function estimationCarburantJour(v) {
  const j = S.params.prixGasoilJour; if (!j || v.statut === "termine" || v.statut === "annule") return null;
  const km = num(v.kmAller) + num(v.kmRetourCharge) + num(v.kmRetourVide); if (!(km > 0)) return null;
  const cam = parId(S.camions, v.camionId), conso = (cam && typeof consoMoyenne === "function" && consoMoyenne(cam.id)) || num(S.params.consoDefaut, 33);
  const prixMa = j.MA?.prix || num(S.params.prixGasoil), eu = [j.ES?.algeciras || j.ES?.prix, j.FR?.poidsLourds || j.FR?.prix].filter((x) => x > 0), prixEu = eu.length ? eu.reduce((a, b) => a + b, 0) / eu.length : null;
  const kmMa = kmMarocVoyage(v, km), kmEu = km - kmMa, taux = tauxVoyage(v);
  if (kmEu > 0 && !prixEu) return null;
  const mad = (kmMa * conso / 100) * prixMa + (kmEu * conso / 100) * (prixEu || 0) * taux;
  return { mad: Math.round(mad), detail: `${fmt(km)} km × ${fmt(conso, 1)} L/100 · Maroc ${fmt(prixMa, 2)} MAD/L${kmEu > 0 ? ` · Europe ${fmt(prixEu, 3)} €/L` : ""}` };
}
