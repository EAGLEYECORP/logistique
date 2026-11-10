"use strict";
/* ============================================================
   Traces GPS (phase 1) : import CSV / GPX, zones, jalons automatiques.
   Logique pure (testée) — aucune dépendance à l'interface.
   Fonctionne avec l'export de n'importe quelle plateforme de balises : les colonnes sont reconnues
   automatiquement (français ou anglais), sinon l'utilisateur les désigne.
   ============================================================ */

/* ---------- zones habituelles (coordonnées APPROXIMATIVES : à ajuster avec vos propres relevés) ---------- */
const TYPES_ZONE = [["port_maroc", "Port (Maroc)"], ["port_europe", "Port (Europe)"], ["frontiere", "Frontière"], ["douane", "Douane / contrôle"], ["depot", "Dépôt"], ["client", "Client / livraison"], ["autre", "Autre"]];
const ZONES_DEFAUT = [
  { id: "z-tmed", nom: "Port de Tanger Med", type: "port_maroc", lat: 35.889, lon: -5.5, rayon: 4500 },
  { id: "z-tanger-ville", nom: "Port de Tanger Ville", type: "port_maroc", lat: 35.789, lon: -5.8, rayon: 1500 },
  { id: "z-alg", nom: "Port d'Algeciras", type: "port_europe", lat: 36.13, lon: -5.44, rayon: 2500 },
  { id: "z-tarifa", nom: "Port de Tarifa", type: "port_europe", lat: 36.01, lon: -5.605, rayon: 1000 },
  { id: "z-sete", nom: "Port de Sète", type: "port_europe", lat: 43.4, lon: 3.699, rayon: 1500 },
  { id: "z-bcn", nom: "Port de Barcelone", type: "port_europe", lat: 41.35, lon: 2.16, rayon: 3000 },
  { id: "z-almeria", nom: "Port d'Almería", type: "port_europe", lat: 36.83, lon: -2.46, rayon: 1200 },
  { id: "z-jonquera", nom: "Frontière Espagne – France (Le Perthus)", type: "frontiere", lat: 42.42, lon: 2.87, rayon: 2500 },
];

/* ---------- utilitaires ---------- */
const gpsRad = (d) => (d * Math.PI) / 180;
/** Distance en mètres (haversine). */
function gpsDistance(a, b) {
  const dLat = gpsRad(b[1] - a[1]), dLon = gpsRad(b[2] - a[2]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(gpsRad(a[1])) * Math.cos(gpsRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(x)));
}
const gpsNorm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const gpsNombre = (v) => { const n = parseFloat(String(v ?? "").trim().replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };

/** Horodatage → secondes depuis 1970 (UTC). Les dates sans fuseau sont lues à l'heure locale décalée de offH heures par rapport à UTC. */
function gpsTemps(v, offH = 0) {
  const s = String(v ?? "").trim();
  if (!s) return NaN;
  if (/^\d{9,10}(\.\d+)?$/.test(s)) return Math.floor(Number(s));
  if (/^\d{12,13}$/.test(s)) return Math.floor(Number(s) / 1000);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    if (m[7]) { const t = Date.parse(s.replace(" ", "T").replace(/\s/g, "")); return Number.isFinite(t) ? Math.floor(t / 1000) : NaN; }
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000 - offH * 3600);
  }
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return Math.floor(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)) / 1000 - offH * 3600);
  return NaN;
}
const gpsIso = (t) => new Date(t * 1000).toISOString();

/* ---------- lecture CSV ---------- */
function gpsLignesCSV(texte) {
  const t = String(texte).replace(/^﻿/, "");
  const premiere = t.split(/\r?\n/, 1)[0] || "";
  const compte = (c) => premiere.split(c).length - 1;
  const sep = [";", "\t", ","].sort((a, b) => compte(b) - compte(a))[0];
  const lignes = [];
  for (const brute of t.split(/\r?\n/)) {
    if (!brute.trim()) continue;
    const cells = []; let cur = "", q = false;
    for (let i = 0; i < brute.length; i++) {
      const c = brute[i];
      if (c === '"') { if (q && brute[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === sep && !q) { cells.push(cur); cur = ""; }
      else cur += c;
    }
    cells.push(cur);
    lignes.push(cells.map((x) => x.trim()));
  }
  return lignes;
}
const GPS_COLONNES = {
  lat: ["latitude", "lat", "gps latitude", "y"],
  lon: ["longitude", "lon", "lng", "long", "gps longitude", "x"],
  temps: ["horodatage", "datetime", "date/heure", "date heure", "date et heure", "date & heure", "timestamp", "time", "heure gps", "gps time", "fix time", "positiontime", "date time", "dateheure", "heure", "date"],
  vitesse: ["vitesse", "vitesse (km/h)", "speed", "speed (km/h)", "vitesse km/h", "velocity", "gps speed"],
};
function gpsDetecterColonnes(entetes) {
  const h = entetes.map(gpsNorm);
  const trouver = (cands) => {
    for (const c of cands) { const i = h.indexOf(c); if (i >= 0) return i; }
    for (const c of cands) { if (c.length < 4) continue; const i = h.findIndex((x) => x.includes(c)); if (i >= 0) return i; }
    return -1;
  };
  const col = { lat: trouver(GPS_COLONNES.lat), lon: trouver(GPS_COLONNES.lon), temps: trouver(GPS_COLONNES.temps), vitesse: trouver(GPS_COLONNES.vitesse), date: -1 };
  // Date et heure dans deux colonnes distinctes
  const iDate = h.findIndex((x) => x === "date" || x === "jour"), iHeure = h.findIndex((x) => x === "heure" || x === "time" || x === "hour");
  if (iDate >= 0 && iHeure >= 0 && iDate !== iHeure) { col.temps = iHeure; col.date = iDate; }
  return col;
}
/**
 * Lit un export CSV. Renvoie { ok, points, entetes, colonnes, rejetes } ; ok=false si lat/lon/temps ne sont pas trouvés (l'appelant propose alors le choix manuel).
 * options : { offH, colonnes } — colonnes : indices imposés { lat, lon, temps, vitesse, date }.
 */
function gpsParseCSV(texte, { offH = 0, colonnes = null } = {}) {
  const lignes = gpsLignesCSV(texte);
  if (lignes.length < 2) return { ok: false, points: [], entetes: lignes[0] || [], colonnes: null, rejetes: 0, erreur: "Fichier vide ou sans ligne de données." };
  const entetes = lignes[0];
  const col = colonnes || gpsDetecterColonnes(entetes);
  if (col.lat < 0 || col.lon < 0 || col.temps < 0) return { ok: false, points: [], entetes, colonnes: col, rejetes: 0, erreur: "Colonnes introuvables." };
  const points = []; let rejetes = 0;
  for (const l of lignes.slice(1)) {
    const lat = gpsNombre(l[col.lat]), lon = gpsNombre(l[col.lon]);
    const brut = col.date >= 0 && col.date !== col.temps ? `${l[col.date]} ${l[col.temps]}` : l[col.temps];
    const t = gpsTemps(brut, offH);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(t) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) { rejetes++; continue; }
    const v = col.vitesse >= 0 ? gpsNombre(l[col.vitesse]) : NaN;
    points.push([t, lat, lon, Number.isFinite(v) ? v : null]);
  }
  return { ok: points.length > 0, points, entetes, colonnes: col, rejetes, erreur: points.length ? "" : "Aucune ligne exploitable (vérifiez les colonnes et le format de date)." };
}

/* ---------- lecture GPX ---------- */
function gpsParseGPX(texte) {
  const points = []; let rejetes = 0;
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>|<trkpt\b([^>]*)\/>/gi;
  for (let m; (m = re.exec(texte)); ) {
    const attrs = m[1] ?? m[3] ?? "", corps = m[2] ?? "";
    const lat = gpsNombre((attrs.match(/\blat\s*=\s*["']([^"']+)["']/i) || [])[1]), lon = gpsNombre((attrs.match(/\blon\s*=\s*["']([^"']+)["']/i) || [])[1]);
    const t = gpsTemps(((corps.match(/<time>\s*([^<]+?)\s*<\/time>/i) || [])[1] || "").replace(/\.\d+(?=Z|[+-]|$)/, ""));
    const sp = gpsNombre((corps.match(/<(?:\w+:)?speed>\s*([^<]+?)\s*<\/(?:\w+:)?speed>/i) || [])[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(t)) { rejetes++; continue; }
    points.push([t, lat, lon, Number.isFinite(sp) ? sp * 3.6 : null]); // la vitesse GPX est en m/s
  }
  return { ok: points.length > 0, points, rejetes, erreur: points.length ? "" : "Aucun point de trace avec heure dans ce fichier GPX." };
}

/** Détecte le format et lit le fichier. */
function gpsLire(texte, nomFichier = "", options = {}) {
  const gpx = /\.gpx$/i.test(nomFichier) || /<gpx[\s>]/i.test(String(texte).slice(0, 2000));
  return gpx ? { format: "gpx", ...gpsParseGPX(texte) } : { format: "csv", ...gpsParseCSV(texte, options) };
}

/* ---------- nettoyage et analyse ---------- */
/** Trie, supprime les doublons et les sauts impossibles (> 200 km/h entre deux points proches dans le temps). */
function gpsNettoyer(points) {
  const tri = [...points].sort((a, b) => a[0] - b[0]);
  const res = []; let ecartes = 0;
  for (const p of tri) {
    const q = res[res.length - 1];
    if (q) {
      const dt = p[0] - q[0];
      if (dt <= 0) { ecartes++; continue; }
      const d = gpsDistance(q, p);
      if (dt < 3600 && d / dt > 200 / 3.6 && d > 500) { ecartes++; continue; }
    }
    res.push(p);
  }
  return { points: res, ecartes };
}
const gpsZoneDe = (p, zones) => {
  let meilleure = null, dmin = Infinity;
  for (const z of zones) { const d = gpsDistance(p, [0, z.lat, z.lon]); if (d <= z.rayon && d < dmin) { dmin = d; meilleure = z; } }
  return meilleure;
};

const SEUIL_TROU_S = 30 * 60, SEUIL_ARRET_S = 20 * 60, SEUIL_MARCHE_KMH = 5, PAUSE_REGLEMENTAIRE_S = 45 * 60;

/**
 * Analyse d'une trace nettoyée : distance, durée, conduite estimée, arrêts, trous, visites de zones, traversées, jalons du voyage.
 * La conduite est une ESTIMATION d'après la vitesse (≥ 5 km/h) : ce n'est pas le tachygraphe.
 */
function gpsAnalyser(points, zones = []) {
  const n = points.length;
  const r = { nbPoints: n, debut: n ? points[0][0] : null, fin: n ? points[n - 1][0] : null, km: 0, dureeH: 0, vitMoyKmh: 0, conduiteH: 0, conduiteMaxSansPauseH: 0, arrets: [], trous: [], visites: [], traversees: [], jalons: [] };
  if (n < 2) return r;
  let conduite = 0, serie = 0, arretDebut = null, arretPos = null;
  const fermerArret = (fin) => {
    if (arretDebut !== null && fin - arretDebut >= SEUIL_ARRET_S) {
      const z = gpsZoneDe(arretPos, zones);
      r.arrets.push({ debut: arretDebut, fin, dureeMin: Math.round((fin - arretDebut) / 60), lat: arretPos[1], lon: arretPos[2], zone: z ? z.nom : "" });
    }
    arretDebut = null;
  };
  for (let i = 1; i < n; i++) {
    const a = points[i - 1], b = points[i], dt = b[0] - a[0], d = gpsDistance(a, b);
    r.km += d / 1000;
    if (dt > SEUIL_TROU_S) {
      r.trous.push({ debut: a[0], fin: b[0], dureeMin: Math.round(dt / 60), de: gpsZoneDe(a, zones)?.nom || "", vers: gpsZoneDe(b, zones)?.nom || "", distanceKm: Math.round(d / 1000) });
      fermerArret(a[0]);
      if (dt >= PAUSE_REGLEMENTAIRE_S) serie = 0;
      continue;
    }
    const v = b[3] ?? (dt > 0 ? (d / dt) * 3.6 : 0);
    if (v >= SEUIL_MARCHE_KMH) {
      fermerArret(a[0]);
      conduite += dt; serie += dt; r.conduiteMaxSansPauseH = Math.max(r.conduiteMaxSansPauseH, serie / 3600);
    } else {
      if (arretDebut === null) { arretDebut = a[0]; arretPos = a; }
      if (b[0] - arretDebut >= PAUSE_REGLEMENTAIRE_S) serie = 0;
    }
  }
  fermerArret(points[n - 1][0]);
  r.dureeH = (r.fin - r.debut) / 3600;
  r.conduiteH = conduite / 3600;
  r.vitMoyKmh = r.conduiteH ? r.km / r.conduiteH : 0;

  // visites de zones (séquence d'entrées / sorties)
  let courante = null;
  for (const p of points) {
    const z = gpsZoneDe(p, zones);
    if (z) {
      if (courante && courante.zoneId === z.id) { courante.sortie = p[0]; courante.n++; }
      else { courante = { zoneId: z.id, zone: z.nom, type: z.type, entree: p[0], sortie: p[0], n: 1 }; r.visites.push(courante); }
    }
  }
  // traversées : port du Maroc → port d'Europe (aller) ou l'inverse (retour)
  for (let i = 0; i + 1 < r.visites.length; i++) {
    const a = r.visites[i], b = r.visites[i + 1];
    const sens = a.type === "port_maroc" && b.type === "port_europe" ? "aller" : a.type === "port_europe" && b.type === "port_maroc" ? "retour" : null;
    if (sens) r.traversees.push({ sens, de: a.zone, vers: b.zone, embarque: a.sortie, debarque: b.entree, dureeH: (b.entree - a.sortie) / 3600 });
  }
  r.jalons = gpsJalons(r, points, zones);
  return r;
}

/** Jalons du voyage déduits de l'analyse : { type, date (ISO), source: "gps", detail }. */
function gpsJalons(an, points, zones) {
  const J = [];
  const ajouter = (type, t, detail) => { if (!J.some((j) => j.type === type)) J.push({ type, date: gpsIso(t), source: "gps", detail }); };
  const aller = an.traversees.find((t) => t.sens === "aller");
  const retour = an.traversees.find((t) => t.sens === "retour");
  const premierMaroc = an.visites.find((v) => v.type === "port_maroc");
  const depot = zones.filter((z) => z.type === "depot");
  if (points.length && (!depot.length || depot.some((z) => gpsDistance(points[0], [0, z.lat, z.lon]) <= z.rayon * 3))) ajouter("depart", points[0][0], "Début de la trace");
  if (premierMaroc) ajouter("port_tmed", premierMaroc.entree, premierMaroc.zone);
  const douaneAvant = an.visites.find((v) => v.type === "douane" && (!aller || v.entree < aller.embarque));
  if (douaneAvant) ajouter("douane_export", douaneAvant.entree, douaneAvant.zone);
  if (aller) { ajouter("embarque_aller", aller.embarque, aller.de); ajouter("debarque_alg", aller.debarque, aller.vers); }
  const client = an.visites.find((v) => v.type === "client" && (!aller || v.entree > aller.debarque));
  if (client) ajouter("livre", client.entree, client.zone);
  if (retour) {
    ajouter("embarque_retour", retour.embarque, retour.de); ajouter("debarque_tmed", retour.debarque, retour.vers);
    const douaneApres = an.visites.find((v) => v.type === "douane" && v.entree > retour.debarque);
    if (douaneApres) ajouter("douane_import", douaneApres.entree, douaneApres.zone);
  }
  const dernier = points[points.length - 1];
  if (retour && depot.some((z) => gpsDistance(dernier, [0, z.lat, z.lon]) <= z.rayon)) ajouter("retour", dernier[0], "Fin de la trace au dépôt");
  const ordre = JALONS_VOYAGE.map(([k]) => k);
  return J.sort((a, b) => ordre.indexOf(a.type) - ordre.indexOf(b.type));
}

/** Réduit une trace à au plus max points (début et fin conservés) pour le stockage : [[t, lat, lon], …]. */
function gpsReduire(points, max = 800) {
  if (points.length <= max) return points.map((p) => [p[0], Math.round(p[1] * 1e5) / 1e5, Math.round(p[2] * 1e5) / 1e5]);
  const pas = (points.length - 1) / (max - 1), res = [];
  for (let i = 0; i < max; i++) { const p = points[Math.round(i * pas)]; res.push([p[0], Math.round(p[1] * 1e5) / 1e5, Math.round(p[2] * 1e5) / 1e5]); }
  return res;
}

/** Séjour Schengen proposé d'après les traversées : entrée au débarquement en Europe, sortie à l'embarquement de retour. */
function gpsSejourSchengen(an) {
  const a = an.traversees.find((t) => t.sens === "aller"), r = an.traversees.find((t) => t.sens === "retour");
  if (!a) return null;
  return { entree: gpsIso(a.debarque).slice(0, 10), sortie: r ? gpsIso(r.embarque).slice(0, 10) : "" };
}

/** Trace → dessin SVG hors ligne (projection simple). Renvoie le balisage SVG. */
function gpsSVG(pts, zones = [], visites = [], { largeur = 640, hauteur = 320 } = {}) {
  if (pts.length < 2) return "";
  const lats = pts.map((p) => p[1]), lons = pts.map((p) => p[2]);
  const latMin = Math.min(...lats), latMax = Math.max(...lats), lonMin = Math.min(...lons), lonMax = Math.max(...lons);
  const k = Math.cos(gpsRad((latMin + latMax) / 2));
  const w = Math.max((lonMax - lonMin) * k, 1e-4), h = Math.max(latMax - latMin, 1e-4), pad = 18;
  const ech = Math.min((largeur - 2 * pad) / w, (hauteur - 2 * pad) / h);
  const X = (lon) => pad + ((lon - lonMin) * k) * ech + (largeur - 2 * pad - w * ech) / 2;
  const Y = (lat) => hauteur - pad - (lat - latMin) * ech - (hauteur - 2 * pad - h * ech) / 2;
  const metresParPx = 111320 / ech;
  const visitees = new Set(visites.map((v) => v.zoneId));
  const cercles = zones.filter((z) => visitees.has(z.id)).map((z) => {
    const rpx = Math.max(5, z.rayon / metresParPx);
    return `<circle cx="${X(z.lon).toFixed(1)}" cy="${Y(z.lat).toFixed(1)}" r="${rpx.toFixed(1)}" fill="var(--primary)" fill-opacity=".12" stroke="var(--primary)" stroke-opacity=".5"/><text x="${X(z.lon).toFixed(1)}" y="${(Y(z.lat) - rpx - 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="currentColor">${String(z.nom).replace(/[&<>"]/g, "")}</text>`;
  }).join("");
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p[2]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join("");
  const a = pts[0], b = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${largeur} ${hauteur}" class="gps-carte" role="img" aria-label="Tracé du voyage">${cercles}<path d="${d}" fill="none" stroke="var(--primary)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${X(a[2]).toFixed(1)}" cy="${Y(a[1]).toFixed(1)}" r="5" fill="var(--ok, #16a34a)"/><circle cx="${X(b[2]).toFixed(1)}" cy="${Y(b[1]).toFixed(1)}" r="5" fill="var(--danger, #dc2626)"/></svg>`;
}
