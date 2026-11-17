"use strict";
/* ============================================================
   Arrivée et départ des quais par le GPS — logique pure, testée.
   · le site d'un quai : coordonnées précises de la livraison du voyage, sinon un site du client APPRIS (la première fois que le chauffeur
     ou le bureau note l'arrivée pendant que le camion est arrêté sur place, l'endroit est retenu pour ce client et cette ville) ;
   · le passage du camion sur le site (entrée dans un rayon de 300 m, sortie au-delà de 400 m confirmée par deux positions) ;
   · appliqué à la commande : arrivée et départ posés s'ils manquent, jamais à la place d'une heure notée à la main.
   Dépend de noyau.js, quais.js, gps.js (gpsDistance), fret_retour.js (coordsVille), devis.js (memeLieu).
   ============================================================ */

const RAYON_QUAI_M = 300, SORTIE_QUAI_M = 400;
const distQuaiM = (a, b) => gpsDistance([0, a[0], a[1]], [0, b[0], b[1]]);
const villeQuai = (c, q) => (q === "chargement" ? c.origine : c.destination) || "";
/** Site d'un quai : { lat, lon, source: "voyage" | "client" | "commande" } ou null. */
function siteQuai(c, q, v = null) {
  const s = c?.sites?.[q]; if (s && Number.isFinite(s.lat) && Number.isFinite(s.lon)) return { lat: s.lat, lon: s.lon, source: "commande" };
  if (q === "livraison" && v && v.commandeId === c.id && Number.isFinite(v.destLat) && Number.isFinite(v.destLon)) return { lat: v.destLat, lon: v.destLon, source: "voyage" };
  const cl = parId(S.clients, c?.clientId), ville = villeQuai(c, q);
  const appris = (cl?.sites || []).filter((x) => x.quai === q && (!ville || !x.ville || memeLieu(x.ville, ville, 30))).sort((a, b) => num(b.n) - num(a.n))[0];
  return appris ? { lat: appris.lat, lon: appris.lon, source: "client" } : null;
}
/**
 * Passage du camion sur un site d'après les points [t, lat, lon, v] (secondes) : { arrivee, depart } (secondes, ou null).
 * Arrivée : première position à moins de 300 m ; départ : première de deux positions de suite à plus de 400 m après l'arrivée.
 */
function passageSite(points, site, { depuis = 0 } = {}) {
  let arrivee = null, depart = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]; if (p[0] < depuis) continue;
    const d = distQuaiM([p[1], p[2]], [site.lat, site.lon]);
    if (arrivee === null) { if (d <= RAYON_QUAI_M) arrivee = p[0]; continue; }
    const suivant = points[i + 1];
    if (d > SORTIE_QUAI_M && (!suivant || distQuaiM([suivant[1], suivant[2]], [site.lat, site.lon]) > SORTIE_QUAI_M)) { if (suivant) { depart = p[0]; break; } }
  }
  return { arrivee, depart };
}
/**
 * Pose l'arrivée et le départ d'un quai d'après le GPS (seulement ce qui manque ; une arrivée notée à la main est gardée).
 * Renvoie les effets : ["arrivée au chargement 08:12", …].
 */
function appliquerQuaiGps(c, q, points, { v = null, depuis = 0 } = {}) {
  const site = siteQuai(c, q, v); if (!site) return [];
  const x = quaiDe(c, q), effets = [], hm = (t) => new Date(t * 1000).toISOString();
  if (x?.arrivee && x.depart) return [];
  const debut = x?.arrivee ? Date.parse(x.arrivee) / 1000 - 600 : depuis, p = passageSite(points, site, { depuis: debut });
  if (!x?.arrivee && p.arrivee) { const y = arriveeQuai(c, q, hm(p.arrivee)); y.sourceArrivee = "gps"; effets.push(`arrivée ${AU_QUAI[q]}`); }
  const y = quaiDe(c, q);
  if (y?.arrivee && !y.depart && p.depart && hm(p.depart) > y.arrivee) { departQuai(c, q, hm(p.depart)); y.sourceDepart = "gps"; effets.push(`départ ${AU_QUAI[q]}`); }
  return effets;
}
/** Retient l'endroit où le camion est arrêté comme site du client pour ce quai et cette ville (moyenne avec un site proche déjà appris). */
function apprendreSiteQuai(c, q, pos) {
  const cl = parId(S.clients, c?.clientId); if (!cl || !pos) return null;
  const ville = villeQuai(c, q), sites = (cl.sites ||= []);
  const proche = sites.find((x) => x.quai === q && distQuaiM([x.lat, x.lon], pos) <= 600);
  if (proche) { const n = num(proche.n, 1); proche.lat = Math.round(((proche.lat * n + pos[0]) / (n + 1)) * 1e5) / 1e5; proche.lon = Math.round(((proche.lon * n + pos[1]) / (n + 1)) * 1e5) / 1e5; proche.n = n + 1; return proche; }
  const s = { quai: q, ville, lat: Math.round(pos[0] * 1e5) / 1e5, lon: Math.round(pos[1] * 1e5) / 1e5, n: 1 }; sites.push(s); return s;
}
/** Position d'arrêt récente du camion (moins de 15 min, quasi immobile) : [lat, lon] ou null. */
function positionArret(points, maintenant) {
  const der = points?.[points.length - 1]; if (!der || maintenant - der[0] > 15 * 60) return null;
  const avant = points.filter((p) => p[0] >= der[0] - 10 * 60);
  return avant.every((p) => distQuaiM([p[1], p[2]], [der[1], der[2]]) <= 150 && (p[3] === undefined || p[3] === null || p[3] < 8)) ? [der[1], der[2]] : null;
}
