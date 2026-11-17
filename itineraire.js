"use strict";
/* ============================================================
   Itinéraire poids lourd — logique pure, testée.
   · tronçons routiers d'un voyage ou d'une commande : la traversée du détroit est à part (Tanger Med ⇄ Algeciras) ;
   · résultat du relais appliqué : kilomètres, durée de conduite, kilomètres par pays (péages d'Europe, consigne de plein),
     kilomètres à péage — sans écraser une valeur saisie à la main ;
   · liens Google Maps par tronçon (aucune clé, rien n'est envoyé par l'application).
   Dépend de noyau.js, devis.js (ports), fret_retour.js (villes), voyages.js (coordonnées du voyage).
   ============================================================ */

const auMaroc = (p) => !!p && p[0] > 27 && p[0] < 35.95 && p[1] > -13.5 && p[1] < -1;
const NOMS_PAYS_ROUTE = { MA: "Maroc", ES: "Espagne", FR: "France", PT: "Portugal", IT: "Italie", DE: "Allemagne", BE: "Belgique", NL: "Pays-Bas", CH: "Suisse", AD: "Andorre", LU: "Luxembourg", AT: "Autriche", GB: "Royaume-Uni", GI: "Gibraltar", PL: "Pologne", CZ: "Tchéquie", DK: "Danemark", SI: "Slovénie", HU: "Hongrie" };

/**
 * Tronçons routiers : [{ lib, points: [[lat, lon], [lat, lon]] }] ; { erreur } si une ville est inconnue ou la ligne maritime non gérée.
 * x : un voyage (origine, destination, traversées) ou une commande (origine, destination, pays).
 */
function tronconsRoute(x) {
  const o = (typeof origineDe === "function" && x.traversees ? origineDe(x) : null) || coordsVille(x.origine), d = (typeof destinationDe === "function" && x.traversees ? destinationDe(x) : null) || coordsVille(x.destination);
  if (!o || !d) return { erreur: `Ville inconnue : ${!o ? x.origine || "départ" : x.destination || "destination"} (précisez latitude et longitude dans le voyage).` };
  if (auMaroc(o) === auMaroc(d)) return [{ lib: `${x.origine} → ${x.destination}`, points: [o, d] }];
  const t = (x.traversees || []).find((y) => y.sens === "aller");
  if (t && !["tmed-alg", "alg-tmed"].includes(t.ligne)) return { erreur: `Traversée par ${LIGNES_TRAVERSEE[t.ligne]?.lib || t.ligne} : seul le détroit Tanger Med ⇄ Algeciras est découpé automatiquement ; saisissez les kilomètres.` };
  return auMaroc(o)
    ? [{ lib: `${x.origine} → Tanger Med`, points: [o, PORT_TMED] }, { lib: `Algeciras → ${x.destination}`, points: [PORT_ALG, d] }]
    : [{ lib: `${x.origine} → Algeciras`, points: [o, PORT_ALG] }, { lib: `Tanger Med → ${x.destination}`, points: [PORT_TMED, d] }];
}
/** Lien Google Maps (itinéraire en voiture : Google n'a pas de mode poids lourd ; restrictions à vérifier). */
const lienGoogleMaps = (points) => { const f = (p) => `${p[0]},${p[1]}`; return `https://www.google.com/maps/dir/?api=1&origin=${f(points[0])}&destination=${f(points[points.length - 1])}${points.length > 2 ? `&waypoints=${points.slice(1, -1).map(f).join("%7C")}` : ""}&travelmode=driving`; };
/** Kilomètres estimés sans service d'itinéraire : à vol d'oiseau × 1,25, par tronçon. */
const kmEstimesTroncon = (t) => Math.round(kmEntre(t.points[0], t.points[1]) * DETOUR_ROUTE);

/** Somme des tronçons calculés par le relais : { km, heures, kmPays, kmPeage, troncons, source, calcule }. */
function sommeTroncons(troncons, resultats) {
  const kmPays = {};
  for (const r of resultats) for (const [p, k] of Object.entries(r.kmPays || {})) kmPays[p] = (kmPays[p] || 0) + num(k);
  const s = (k) => resultats.reduce((n, r) => n + num(r[k]), 0);
  return { km: s("km"), heures: Math.round(s("heures") * 10) / 10, kmPays, kmPeage: s("kmPeage"), troncons: troncons.map((t, i) => ({ lib: t.lib, km: num(resultats[i]?.km), heures: num(resultats[i]?.heures) })), source: resultats[0]?.source || "", calcule: resultats[0]?.calcule || new Date().toISOString() };
}
/** Texte « ES 950, FR 28 » (pays d'Europe seulement : le péage marocain a sa propre grille). */
const texteKmPays = (kmPays) => Object.entries(kmPays || {}).filter(([p, k]) => !["MA", "GI"].includes(p) && k > 0).map(([p, k]) => `${p} ${Math.round(k)}`).join(", ");
/**
 * Applique l'itinéraire au voyage : km aller et km par pays remplis s'ils sont vides ou venaient déjà d'un itinéraire (une saisie n'est jamais écrasée).
 * Renvoie { kmAller: "rempli" | "garde" , kmPays: "rempli" | "garde" }.
 */
function appliquerItineraire(v, it) {
  v.itineraire = it; const r = {};
  if (!num(v.kmAller) || v.kmAllerAuto) { v.kmAller = it.km; v.kmAllerAuto = true; r.kmAller = "rempli"; } else r.kmAller = "garde";
  const t = texteKmPays(it.kmPays);
  if (t && (!String(v.kmPays || "").trim() || v.kmPaysAuto)) { v.kmPays = t; v.kmPaysAuto = true; r.kmPays = "rempli"; } else r.kmPays = t ? "garde" : "aucun";
  return r;
}
/** Une saisie à la main remplace l'itinéraire pour ce champ (appelé à l'enregistrement du formulaire du voyage). */
function noterSaisieKm(v, avant) {
  if (num(v.kmAller) !== num(avant.kmAller)) delete v.kmAllerAuto;
  if (String(v.kmPays || "") !== String(avant.kmPays || "")) delete v.kmPaysAuto;
}
/** Points d'un itinéraire pour la consigne de plein : { kmMA, kmES, kmFR } d'après l'itinéraire calculé, ou null. */
function kmPleinItineraire(v) {
  const k = v?.itineraire?.kmPays; if (!k || !(k.ES || k.FR)) return null;
  return { kmMA: Math.round(num(k.MA)), kmES: Math.round(num(k.ES)), kmFR: Math.round(num(k.FR)) };
}
