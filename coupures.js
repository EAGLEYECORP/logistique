"use strict";
/* ============================================================
   Coupures planifiées — logique pure, testée.
   Règlement CE 561/2006, version simplifiée : 4 h 30 de conduite puis 45 min de pause ; 9 h par jour (10 h deux fois par semaine) ;
   56 h par semaine ; 90 h sur deux semaines. ESTIMATION d'après le GPS (roulage ≥ 5 km/h) : le tachygraphe fait foi.
   · prochaines coupures d'un camion : pause et fin de journée (dans combien de temps, vers quelle heure, à combien de km) ;
   · journal de conduite par jour et par chauffeur, tenu avec ce que l'application voit ; compteurs de la semaine et des deux semaines ;
   · lieu estimé de la pause et aires poids lourds proches (OpenStreetMap, via Overpass) ; lien de carte.
   Dépend de gps.js (conduiteCourante, conduiteJour, vitesseMoyenne, gpsDistance) et noyau.js.
   ============================================================ */

const REGLES_CONDUITE = { serieH: 4.5, pauseMin: 45, jourH: 9, jourEtenduH: 10, etendusMax: 2, semaineH: 56, deuxSemainesH: 90 };
const dateLocale = (t) => { const d = new Date(t * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/**
 * Prochaines coupures d'après les points GPS [t, lat, lon, v] (secondes) :
 * { serieH, jourH, arretMin, enArret, vitesse, pause: { resteH, dansMin, heure, km, depasse }, finJour: { …, limiteH } }.
 * etendusSemaine : jours de plus de 9 h déjà faits cette semaine (deux au plus permettent d'aller à 10 h).
 */
function prochainesCoupures(points, maintenant, { etendusSemaine = 0, vitesseKmH = null } = {}) {
  const c = conduiteCourante(points, maintenant), jourH = conduiteJour(points, maintenant), v = vitesseKmH ?? vitesseMoyenne(points, maintenant) ?? 75;
  const enArret = c.arretMin >= 15;
  const bloc = (resteH) => ({ resteH: Math.max(0, resteH), dansMin: Math.max(0, Math.round(resteH * 60)), heure: maintenant + Math.max(0, resteH) * 3600, km: Math.max(0, Math.round(resteH * v)), depasse: resteH < 0 });
  const limiteJ = jourH > REGLES_CONDUITE.jourH && etendusSemaine < REGLES_CONDUITE.etendusMax ? REGLES_CONDUITE.jourEtenduH : REGLES_CONDUITE.jourH;
  return { serieH: c.serieH, jourH, arretMin: c.arretMin, enArret, vitesse: Math.round(v), pause: bloc(REGLES_CONDUITE.serieH - c.serieH), finJour: { ...bloc(limiteJ - jourH), limiteH: limiteJ, extensionPossible: etendusSemaine < REGLES_CONDUITE.etendusMax } };
}

/** Heures de conduite par jour (date locale) dans les points GPS : { "2026-11-17": 6.2, … }. */
function conduiteParJour(points) {
  const r = {};
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dt = b[0] - a[0]; if (dt <= 0 || dt > 15 * 60) continue;
    const v = b[3] ?? (gpsDistance(a, b) / dt) * 3.6;
    if (v >= SEUIL_MARCHE_KMH) { const j = dateLocale(a[0]); r[j] = (r[j] || 0) + dt / 3600; }
  }
  return r;
}
/** Journal d'un chauffeur complété par ce que montrent les points (une journée n'est jamais diminuée : le GPS vu plus tard complète). Garde 21 jours. */
function noterConduite(journal = {}, points, maintenant) {
  const j = { ...journal };
  for (const [d, h] of Object.entries(conduiteParJour(points))) j[d] = Math.round(Math.max(num(j[d]), h) * 100) / 100;
  const limite = dateLocale(maintenant - 21 * 86400);
  for (const d of Object.keys(j)) if (d < limite) delete j[d];
  return j;
}
const lundiDeLaSemaine = (iso) => { const d = new Date(iso + "T12:00:00"), k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const joursPlus = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/**
 * Compteurs depuis lundi et depuis le lundi précédent : { semaineH, deuxSemainesH, joursEtendus, resteSemaineH, resteDeuxSemainesH, joursSansDonnees }.
 * joursSansDonnees : jours de cette semaine (avant aujourd'hui) sans conduite vue — repos, ou application fermée : le compteur peut être sous-estimé.
 */
function compteursSemaine(journal = {}, aujourdhui) {
  const lundi = lundiDeLaSemaine(aujourdhui), lundiAvant = joursPlus(lundi, -7), sem = [], prec = [];
  for (const [d, h] of Object.entries(journal)) { if (d >= lundi && d <= aujourdhui) sem.push([d, h]); else if (d >= lundiAvant && d < lundi) prec.push([d, h]); }
  const s = (l) => l.reduce((n, [, h]) => n + num(h), 0), semaineH = s(sem), deuxSemainesH = semaineH + s(prec);
  const jours = []; for (let d = lundi; d < aujourdhui; d = joursPlus(d, 1)) jours.push(d);
  return { semaineH, deuxSemainesH, joursEtendus: sem.filter(([, h]) => h > REGLES_CONDUITE.jourH).length, resteSemaineH: Math.max(0, REGLES_CONDUITE.semaineH - semaineH), resteDeuxSemainesH: Math.max(0, REGLES_CONDUITE.deuxSemainesH - deuxSemainesH), joursSansDonnees: jours.filter((d) => !num(journal[d])).length };
}

/** Point à km de la position, en ligne droite vers la prochaine étape (ESTIMATION du lieu de la pause). */
function pointEstime(depuis, vers, km) {
  if (!depuis) return null; if (!vers) return depuis;
  const total = gpsDistance([0, depuis[0], depuis[1]], [0, vers[0], vers[1]]) / 1000; if (!(total > 0)) return depuis;
  const f = Math.min(1, Math.max(0, km / (total * 1.25))); // détour de la route : on avance un peu moins vite qu'à vol d'oiseau
  return [Math.round((depuis[0] + (vers[0] - depuis[0]) * f) * 1e4) / 1e4, Math.round((depuis[1] + (vers[1] - depuis[1]) * f) * 1e4) / 1e4];
}
/** Lien Google Maps : aires poids lourds autour d'un point. */
const lienAiresPL = (p) => `https://www.google.com/maps/search/aire+poids+lourds/@${p[0]},${p[1]},11z`;
/** Requête Overpass (OpenStreetMap) : parkings poids lourds, aires de service et de repos autour d'un point. */
const requeteAiresPL = (p, rayonM = 25000) => `[out:json][timeout:20];(nwr["amenity"="parking"]["hgv"~"^(yes|designated)$"](around:${rayonM},${p[0]},${p[1]});nwr["highway"~"^(services|rest_area)$"](around:${rayonM},${p[0]},${p[1]}););out center 40;`;
/** Réponse Overpass → aires triées par distance : [{ nom, type, km, lat, lon, poidsLourds, payant, places, sanitaires, douches, gardee }] (6 au plus). */
function lireAiresPL(json, p) {
  const vus = new Set();
  return (json?.elements || []).map((e) => {
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon, t = e.tags || {}; if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { nom: t.name || (t.highway === "services" ? "Aire de service" : t.highway === "rest_area" ? "Aire de repos" : "Parking poids lourds"), type: t.highway === "services" ? "service" : t.highway === "rest_area" ? "repos" : "parking",
      km: Math.round(gpsDistance([0, p[0], p[1]], [0, lat, lon]) / 100) / 10, lat, lon, poidsLourds: /yes|designated/.test(t.hgv || "") || t.highway === "services", payant: t.fee === "yes" ? true : t.fee === "no" ? false : null,
      places: num(t["capacity:hgv"]) || null, sanitaires: t.toilets === "yes", douches: t.shower === "yes", gardee: t.supervised === "yes" };
  }).filter((x) => x && !vus.has(`${x.nom}|${Math.round(x.lat * 200)}|${Math.round(x.lon * 200)}`) && vus.add(`${x.nom}|${Math.round(x.lat * 200)}|${Math.round(x.lon * 200)}`))
    .sort((a, b) => (b.poidsLourds - a.poidsLourds) || a.km - b.km).slice(0, 6);
}
/** Message au chauffeur avant la coupure (dans sa langue). */
const MESSAGES_COUPURE = {
  pause: { fr: (m, h) => `Pause de 45 min à prévoir dans ${m} min (vers ${h}).`, ar: (m, h) => `استراحة 45 دقيقة بعد ${m} دقيقة (حوالي ${h}).`, es: (m, h) => `Pausa de 45 min dentro de ${m} min (hacia las ${h}).`, en: (m, h) => `45-minute break due in ${m} min (around ${h}).` },
  finJour: { fr: (m, h) => `Fin de la conduite du jour dans ${m} min (vers ${h}) : prévoyez votre repos.`, ar: (m, h) => `نهاية السياقة اليومية بعد ${m} دقيقة (حوالي ${h}): خطط لراحتك.`, es: (m, h) => `Fin de la conducción diaria dentro de ${m} min (hacia las ${h}): prevea su descanso.`, en: (m, h) => `Daily driving ends in ${m} min (around ${h}): plan your rest.` },
};
function messageCoupure(type, dansMin, heure, langue = "fr", lien = "", fuseau = "") { // fuseau : heure dite à l'heure du bureau quand le relais (serveur en UTC) envoie le message
  const f = MESSAGES_COUPURE[type][langue] || MESSAGES_COUPURE[type].fr, h = new Date(heure * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", ...(fuseau ? { timeZone: fuseau } : {}) });
  return `${f(dansMin, h)}${lien ? ` ${langue === "ar" ? "مواقف الشاحنات" : langue === "es" ? "Áreas para camiones" : langue === "en" ? "Truck parkings" : "Aires poids lourds"} : ${lien}` : ""}`;
}
