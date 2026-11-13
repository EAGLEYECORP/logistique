"use strict";
/* ============================================================
   Prix du jour (interface) : taux EUR → MAD et gazole, actualisés seuls toutes les 6 h ; carte « Prix du jour » sur la page Gasoil et dans les Réglages.
   Avec le relais : Bank Al-Maghrib, Espagne, France (officiels). Sans relais : taux indicatif open.er-api.com, gazole d'après vos pleins.
   Logique pure dans prixjour.js.
   ============================================================ */

let prixJourEnCours = null;
async function actualiserPrixDuJour({ forcer = false, silencieux = false } = {}) {
  if (prixJourEnCours) return prixJourEnCours;
  prixJourEnCours = (async () => {
    let marches = null, note = "";
    if (typeof partageRelais === "function" && partageRelais()) { try { marches = await partageAppel("GET", `/api/marches${forcer ? "?actualiser=1" : ""}`); } catch (e) { note = e.message; } }
    if (!marches?.taux) { try { const j = await (await fetch("https://open.er-api.com/v6/latest/EUR", { cache: "no-store" })).json(); if (j?.rates?.MAD) marches = { ...(marches || {}), taux: { eurMad: Math.round(j.rates.MAD * 10000) / 10000, date: new Date((j.time_last_update_unix || Date.now() / 1000) * 1000).toISOString().slice(0, 10), source: "open.er-api.com (indicatif)", officiel: false } }; } catch { /* hors ligne */ } }
    const figes = figerTauxVoyages(); // les voyages terminés ou facturés gardent le taux de leur jour avant tout changement
    const changes = appliquerPrixDuJour(marches);
    sauver();
    if (!silencieux) toast(changes.length ? `Prix du jour : ${changes.join(" · ")}` : `Prix du jour à jour${note ? " (" + note + ")" : ""}`, note && !marches ? "warn" : "ok");
    else if (changes.length) toast(`Prix du jour : ${changes.join(" · ")}`);
    if (figes && !silencieux) toast(`${figes} voyage(s) terminé(s) gardent leur taux`);
    if (["carburant", "parametres", "voyages", "direction"].includes(ongletActif)) rafraichir();
  })();
  try { return await prixJourEnCours; } finally { prixJourEnCours = null; }
}
const prixJourAgeH = () => { const m = Date.parse(S.params?.prixGasoilJour?.maj || ""); return Number.isFinite(m) ? (Date.now() - m) / 3600000 : Infinity; };
setTimeout(() => { if (prixJourAgeH() > 6) actualiserPrixDuJour({ silencieux: true }).catch(() => {}); }, 4000);
setInterval(() => { if (prixJourAgeH() > 6) actualiserPrixDuJour({ silencieux: true }).catch(() => {}); }, 30 * 60000);
// à chaque enregistrement : un voyage qui vient de se terminer (ou d'être facturé) garde le taux du jour
if (typeof sauver === "function") { const sauverAvantTaux = sauver; sauver = function () { try { figerTauxVoyages(); } catch { /* ignoré */ } return sauverAvantTaux.apply(this, arguments); }; }

function cartePrixDuJour() {
  const P = S.params, j = P.prixGasoilJour || {}, t = P.tauxEURInfo, relais = typeof partageRelais === "function" && !!partageRelais();
  const madL = (eur) => `${fmt(eur * P.tauxEUR, 2)} MAD/L`;
  const ligne = (titre, valeur, sous, niveau = "") => `<div class="trav"><div><strong>${titre}</strong><span class="sub">${sous}</span></div><div class="r"><strong class="num ${niveau}">${valeur}</strong></div></div>`;
  return `<div class="card" id="carte-prix-jour"><div class="card-head"><h2>Prix du jour</h2>${btn("prix-jour", "Actualiser", { cls: "btn ghost sm" })}</div>
    ${ligne("1 € = " + fmt(P.tauxEUR, 4) + " MAD", t ? (t.officiel ? badge("officiel", "ok") : badge("indicatif", "warn")) : badge("saisi à la main", "neutral"), t ? `${esc(t.source)} · cours du ${dateFr(t.date)}` : "Branchez le relais pour le cours de référence de Bank Al-Maghrib.")}
    ${ligne("Gazole Maroc", j.MA ? `${fmt(j.MA.prix, 2)} MAD/L` : `${fmt(P.prixGasoil, 2)} MAD/L`, j.MA ? `ce que vous avez payé : médiane de ${j.MA.n} plein(s) des 14 derniers jours, dernier le ${dateFr(j.MA.dernier)}` : "aucun plein récent : prix saisi dans les réglages (le Maroc ne publie pas les prix en données ouvertes)")}
    ${j.ES ? ligne("Gazole Espagne", `${fmt(j.ES.prix, 3)} €/L`, `${esc(j.ES.source)}${j.ES.date ? " · " + dateFr(j.ES.date) : ""}${j.ES.algeciras ? ` · Algeciras ${fmt(j.ES.algeciras, 3)} €/L` : ""} · ${madL(j.ES.algeciras || j.ES.prix)}${j.ES.paye ? ` · vous avez payé ${fmt(j.ES.paye, 3)} €/L` : ""}`) : ""}
    ${j.FR ? ligne("Gazole France", `${fmt(j.FR.poidsLourds || j.FR.prix, 3)} €/L`, `${esc(j.FR.source)}${j.FR.date ? " · " + dateFr(j.FR.date) : ""}${j.FR.poidsLourds ? " · stations avec piste poids lourds" : ""}${j.FR.pyreneesOrientales ? ` · Pyrénées-Orientales ${fmt(j.FR.pyreneesOrientales, 3)} €/L` : ""} · ${madL(j.FR.poidsLourds || j.FR.prix)}${j.FR.paye ? ` · vous avez payé ${fmt(j.FR.paye, 3)} €/L` : ""}`) : ""}
    <p class="hint">${relais ? "" : "Sans relais : taux indicatif et prix d'après vos pleins seulement. "}Actualisé seul toutes les 6 heures${j.maj ? ` (dernière fois : ${dateHeureFr(j.maj)})` : ""}. Le taux du jour sert aux voyages en cours ; un voyage terminé ou facturé garde le taux de son jour. Tant qu'un voyage prévu n'a pas de dépense de carburant réelle, son carburant est estimé à ces prix.</p></div>`;
}
if (VUES.carburant) {
  const renduCarbAvant = VUES.carburant.rendu, agirCarbAvant = VUES.carburant.agir;
  VUES.carburant.rendu = function () { return cartePrixDuJour() + renduCarbAvant.call(this); };
  VUES.carburant.agir = async function (act, id, b) { if (act === "prix-jour") return actualiserPrixDuJour({ forcer: true }); return agirCarbAvant?.call(this, act, id, b); };
}
enregistrerCarteReglages({ onglet: "general", ordre: 2, rendu: cartePrixDuJour, agir(act) { if (act !== "prix-jour") return false; actualiserPrixDuJour({ forcer: true }); return true; } });
