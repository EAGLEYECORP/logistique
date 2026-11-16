"use strict";
/* ============================================================
   Étapes de port posées par le GPS — logique pure, testée.
   · d'après les passages dans les zones des ports (sans rien apprendre) : arrivée au port d'Algeciras au retour (entrée avant
     l'embarquement), mainlevée et sortie de Tanger Med au retour (sortie du port après le débarquement) ;
   · d'après les arrêts du camion dans le port, appris sur vos propres voyages : quand une étape est notée pendant un arrêt du camion
     dans le port, la position de cet arrêt est retenue pour cette étape (« zone apprise ») ; à partir de 2 passages, un arrêt au même
     endroit pose l'étape seule, au départ de l'arrêt, dans l'ordre du passage. Aucune coordonnée inventée : seulement vos relevés.
   · chaque étape posée ainsi porte « gps » (affichée, annulable) ; une zone apprise peut être oubliée.
   Dépend de noyau.js (état S), gps.js (gpsDistance), portuaire.js, data.js (PORTS_PASSAGE).
   ============================================================ */

const PASSAGES_MIN_ZONE = 2, RAYON_MIN_ZONE = 120, RAYON_MAX_ZONE = 450;
const PORT_DE_ZONE = { port_maroc: ["tmed_export", "tmed_import"], port_europe: ["alg_entree", "alg_sortie"] };
const zonesEtapes = () => ((S.params ||= {}).zonesEtapes ||= {}); // dans les réglages : partagé entre appareils en mode multi-utilisateur
const distM = (a, b) => gpsDistance([0, a[0], a[1]], [0, b[0], b[1]]);
/** Retient la position d'un arrêt pour une étape (10 relevés au plus) ; centre et rayon recalculés. */
function apprendreZoneEtape(etapeId, lat, lon, t = Date.now()) {
  if (!etapePort(etapeId) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const z = (zonesEtapes()[etapeId] ||= { points: [] });
  z.points = [...z.points, [Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6, t]].slice(-10);
  const c = [z.points.reduce((s, p) => s + p[0], 0) / z.points.length, z.points.reduce((s, p) => s + p[1], 0) / z.points.length];
  z.lat = Math.round(c[0] * 1e6) / 1e6; z.lon = Math.round(c[1] * 1e6) / 1e6; z.n = z.points.length;
  z.rayon = Math.round(Math.min(RAYON_MAX_ZONE, Math.max(RAYON_MIN_ZONE, 1.3 * Math.max(...z.points.map((p) => distM(c, p))))));
  return z;
}
const oublierZoneEtape = (etapeId) => { delete zonesEtapes()[etapeId]; };
/** Zones prêtes (au moins 2 passages). */
const zoneEtapePrete = (etapeId) => { const z = zonesEtapes()[etapeId]; return z && z.n >= PASSAGES_MIN_ZONE ? z : null; };
const enSecondes = (iso) => Math.floor(Date.parse(iso) / 1000);
const isoDe = (s) => new Date(s * 1000).toISOString();
/** Arrêts courts (5 min au moins, dans un rayon de 60 m) à l'intérieur des zones de port, d'après les points GPS bruts [t, lat, lon…]. */
function arretsFinsAuPort(points, zones, seuilS = 300) {
  const ports = zones.filter((z) => PORT_DE_ZONE[z.type]), r = [];
  const zoneDe = (p) => ports.find((z) => gpsDistance(p, [0, z.lat, z.lon]) <= z.rayon);
  let i = 0;
  while (i < points.length) {
    const z = zoneDe(points[i]); if (!z) { i++; continue; }
    let j = i; while (j + 1 < points.length && gpsDistance(points[i], points[j + 1]) <= 60) j++;
    if (points[j][0] - points[i][0] >= seuilS) { const g = points.slice(i, j + 1); r.push({ debut: points[i][0], fin: points[j][0], dureeMin: Math.round((points[j][0] - points[i][0]) / 60), lat: g.reduce((s, p) => s + p[1], 0) / g.length, lon: g.reduce((s, p) => s + p[2], 0) / g.length, zone: z.nom }); }
    i = j + 1;
  }
  return r;
}
/** Arrêts du camion à l'intérieur d'une zone de port : arrêts courts si les points bruts sont là, sinon ceux de l'analyse (20 min et plus). */
function arretsAuPort(an, zones, points = null) {
  const types = new Map(zones.map((z) => [z.nom, z.type]));
  return (points?.length ? arretsFinsAuPort(points, zones) : an.arretsPort || an.arrets || []).filter((a) => a.zone && PORT_DE_ZONE[types.get(a.zone)]).map((a) => ({ ...a, typeZone: types.get(a.zone) }));
}
/** Apprentissage : pour chaque étape notée à la main pendant un arrêt du camion au port, retient la position de l'arrêt. Renvoie le nombre de positions apprises. */
function apprendreDepuisArrets(v, an, zones, points = null) {
  let n = 0; const arrets = arretsAuPort(an, zones, points);
  for (const [id, s] of Object.entries(v.etapesPort || {})) {
    if (!s?.date || s.gps || s.appris) continue;
    const e = etapePort(id); if (!e) continue;
    const t = enSecondes(s.date), a = arrets.find((x) => PORT_DE_ZONE[x.typeZone].includes(e.port) && x.debut - 600 <= t && x.fin + 1200 >= t);
    if (!a) continue;
    apprendreZoneEtape(id, a.lat, a.lon, a.debut * 1000); s.appris = true; n++;
  }
  return n;
}
/** Étapes que le GPS peut poser pour ce voyage : [{ etape, date, detail }]. */
function etapesDepuisGps(v, an, zones, points = null) {
  const refus = new Set(v.etapesGpsRefusees || []), r = [], fait = (id) => !!etatEtapePort(v, etapePort(id) || {}).fait, ajout = (etape, s, detail) => { if (!fait(etape) && !refus.has(etape) && !r.some((x) => x.etape === etape)) r.push({ etape, date: isoDe(s), detail }); };
  // 1. passages dans les zones (retour)
  const retour = (an.traversees || []).find((x) => x.sens === "retour");
  if (retour) {
    const avant = (an.visites || []).filter((x) => x.type === "port_europe" && x.sortie <= retour.embarque + 60).pop(); if (avant) ajout("ras_arrivee", avant.entree, `entrée dans ${avant.zone}`);
    const apres = (an.visites || []).find((x) => x.type === "port_maroc" && x.entree >= retour.debarque - 60);
    if (apres && (an.fin || 0) > apres.sortie + 600) ajout("tmi_mainlevee", apres.sortie, `sortie de ${apres.zone}`);
  }
  // 2. arrêts dans les zones apprises, dans l'ordre du passage
  const arrets = arretsAuPort(an, zones, points).filter((a) => (an.fin || 0) > a.fin + 120); // arrêt terminé : le camion est reparti
  for (const sens of ["aller", "retour"]) {
    const ch = chainePassage(v, sens); let dernier = 0;
    for (const x of ch) {
      if (x.s.fait) { dernier = Math.max(dernier, enSecondes(x.s.date) || 0); continue; }
      const p = r.find((y) => y.etape === x.e.id); if (p) { dernier = Math.max(dernier, enSecondes(p.date)); continue; }
      const z = zoneEtapePrete(x.e.id); if (!z) continue;
      const a = arrets.find((y) => PORT_DE_ZONE[y.typeZone].includes(x.port) && y.fin > dernier && distM([z.lat, z.lon], [y.lat, y.lon]) <= z.rayon);
      if (a) { ajout(x.e.id, a.fin, `arrêt de ${a.dureeMin} min à l'emplacement appris (${z.n} passages)`); dernier = a.fin; }
    }
  }
  return r;
}
/** Applique au voyage : apprend des étapes notées à la main, puis pose les étapes reconnues (marquées « gps »). Renvoie le nombre d'étapes posées. */
function appliquerPortsGps(v, an, zones, points = null) {
  if (!v || v.statut === "annule" || !an) return 0;
  apprendreDepuisArrets(v, an, zones, points);
  let n = 0;
  for (const p of etapesDepuisGps(v, an, zones, points)) { marquerEtapePort(v, p.etape, { date: p.date, gps: true, note: p.detail }); n++; }
  return n;
}
/** État de l'apprentissage par port : [{ port, lib, etapes: [{ id, lib, n, prete }] }]. */
function apprentissagePorts() {
  return Object.entries(PORTS_PASSAGE).map(([port, p]) => ({ port, lib: p.lib, etapes: p.etapes.filter((e) => !e.jalon && !e.sortiePort && !["ras_arrivee", "tmi_mainlevee"].includes(e.id)).map((e) => ({ id: e.id, lib: e.lib, n: zonesEtapes()[e.id]?.n || 0, prete: !!zoneEtapePrete(e.id) })) }));
}
