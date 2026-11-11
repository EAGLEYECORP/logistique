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
  temp: ["temperature", "température", "temp", "temp1", "temperature (°c)", "temp (°c)", "temperature c"],
};
function gpsDetecterColonnes(entetes) {
  const h = entetes.map(gpsNorm);
  const trouver = (cands) => {
    for (const c of cands) { const i = h.indexOf(c); if (i >= 0) return i; }
    for (const c of cands) { if (c.length < 4) continue; const i = h.findIndex((x) => x.includes(c)); if (i >= 0) return i; }
    return -1;
  };
  const col = { lat: trouver(GPS_COLONNES.lat), lon: trouver(GPS_COLONNES.lon), temps: trouver(GPS_COLONNES.temps), vitesse: trouver(GPS_COLONNES.vitesse), temp: trouver(GPS_COLONNES.temp), date: -1 };
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
    const tp = col.temp >= 0 ? gpsNombre(l[col.temp]) : NaN;
    points.push([t, lat, lon, Number.isFinite(v) ? v : null, Number.isFinite(tp) && Math.abs(tp) < 100 ? tp : null]);
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

/** Températures de la trace réduites à une mesure toutes les 5 minutes : [[t, °C], …]. */
function gpsTemperatures(points, pasS = 300) {
  const r = []; let dernier = -Infinity;
  for (const p of points) if (Number.isFinite(p[4]) && p[0] - dernier >= pasS) { r.push([p[0], p[4]]); dernier = p[0]; }
  return r;
}

/** Séjour Schengen proposé d'après les traversées : entrée au débarquement en Europe, sortie à l'embarquement de retour. */
function gpsSejourSchengen(an) {
  const a = an.traversees.find((t) => t.sens === "aller"), r = an.traversees.find((t) => t.sens === "retour");
  if (!a) return null;
  return { entree: gpsIso(a.debarque).slice(0, 10), sortie: r ? gpsIso(r.embarque).slice(0, 10) : "" };
}

/** Trace → dessin SVG hors ligne (projection simple). Renvoie le balisage SVG. */
function gpsSVG(pts, zones = [], visites = [], { largeur = 640, hauteur = 320, marques = [] } = {}) {
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
  const reperes = marques.map((m) => `<g><circle cx="${X(m.lon).toFixed(1)}" cy="${Y(m.lat).toFixed(1)}" r="9" fill="var(--warn, #d97706)" stroke="#fff" stroke-width="1.5"/><text x="${X(m.lon).toFixed(1)}" y="${(Y(m.lat) + 3.5).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${String(m.label).replace(/[&<>"]/g, "")}</text></g>`).join("");
  return `<svg viewBox="0 0 ${largeur} ${hauteur}" class="gps-carte" role="img" aria-label="Tracé du voyage">${cercles}<path d="${d}" fill="none" stroke="var(--primary)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${X(a[2]).toFixed(1)}" cy="${Y(a[1]).toFixed(1)}" r="5" fill="var(--ok, #16a34a)"/><circle cx="${X(b[2]).toFixed(1)}" cy="${Y(b[1]).toFixed(1)}" r="5" fill="var(--danger, #dc2626)"/>${reperes}</svg>`;
}

/* ============================================================
   Phase 2 : gares de péage, péage mesuré par GPS, rapprochement avec le relevé Jawaz Pro
   ADM ne publie pas les coordonnées de ses gares : elles sont relevées sur vos propres traces.
   ============================================================ */

/** Simplification d'une trace (Douglas-Peucker, tolérance en mètres) en conservant l'heure : [[t, lat, lon], …]. */
function gpsSimplifier(points, tolM = 30, max = 2500) {
  const n = points.length;
  if (n <= 2) return points.map((p) => [p[0], Math.round(p[1] * 1e5) / 1e5, Math.round(p[2] * 1e5) / 1e5]);
  const lat0 = points[0][1], kx = Math.cos(gpsRad(lat0)) * 111320, ky = 111320;
  const X = points.map((p) => p[2] * kx), Y = points.map((p) => p[1] * ky);
  const garde = new Uint8Array(n); garde[0] = garde[n - 1] = 1;
  const pile = [[0, n - 1]];
  while (pile.length) {
    const [a, b] = pile.pop();
    let dmax = 0, imax = -1;
    const dx = X[b] - X[a], dy = Y[b] - Y[a], L2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let d;
      if (L2 === 0) d = Math.hypot(X[i] - X[a], Y[i] - Y[a]);
      else { const t = Math.max(0, Math.min(1, ((X[i] - X[a]) * dx + (Y[i] - Y[a]) * dy) / L2)); d = Math.hypot(X[i] - (X[a] + t * dx), Y[i] - (Y[a] + t * dy)); }
      if (d > dmax) { dmax = d; imax = i; }
    }
    if (imax > 0 && dmax > tolM) { garde[imax] = 1; pile.push([a, imax], [imax, b]); }
  }
  const res = [];
  for (let i = 0; i < n; i++) if (garde[i]) res.push(points[i]);
  return gpsReduire(res, max);
}

/** Ralentissements isolés pendant une conduite rapide : candidats « gare de péage ». [{ t, lat, lon, vmin, dureeS }] */
function gpsRalentissements(points, zones = []) {
  const n = points.length, v = new Array(n).fill(0), r = [];
  for (let i = 0; i < n; i++) {
    if (points[i][3] != null) v[i] = points[i][3];
    else if (i > 0 && points[i][0] > points[i - 1][0]) v[i] = (gpsDistance(points[i - 1], points[i]) / (points[i][0] - points[i - 1][0])) * 3.6;
  }
  let i = 0;
  while (i < n) {
    if (v[i] >= 40) { i++; continue; }
    let j = i; while (j + 1 < n && v[j + 1] < 40) j++;
    const debut = points[i][0], fin = points[j][0];
    const avant = []; for (let k = i - 1; k >= 0 && debut - points[k][0] <= 600; k--) avant.push(v[k]);
    const apres = []; for (let k = j + 1; k < n && points[k][0] - fin <= 600; k++) apres.push(v[k]);
    if (Math.max(0, ...avant) >= 60 && Math.max(0, ...apres) >= 60 && fin - debut <= 480) {
      let m = i; for (let k = i; k <= j; k++) if (v[k] < v[m]) m = k;
      const z = zones.length ? gpsZoneDe(points[m], zones) : null;
      if (!z) r.push({ t: points[m][0], lat: points[m][1], lon: points[m][2], vmin: Math.round(v[m]), dureeS: Math.max(0, fin - debut) });
    }
    i = j + 1;
  }
  return r;
}

/** Distance (m) d'un point à un segment AB et position du point le plus proche (0..1). */
function gpsDistanceSegment(p, a, b) {
  const kx = Math.cos(gpsRad(p[0])) * 111320, ky = 111320;
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
  return { d: Math.hypot(ax + t * dx, ay + t * dy), t };
}

/** Passages devant les gares localisées. gares : [{ nom, lat, lon, rayon }]. Renvoie [{ gare, t, d }] triés par heure. */
function gpsPassagesGares(points, gares) {
  const res = [];
  for (const g of gares) {
    const rayon = g.rayon || 300, trouves = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (b[0] - a[0] > 900) continue; // trou de signal : on ne devine rien
      if (Math.abs(a[1] - g.lat) > 0.05 && Math.abs(b[1] - g.lat) > 0.05) continue;
      const { d, t } = gpsDistanceSegment([g.lat, g.lon], [a[1], a[2]], [b[1], b[2]]);
      if (d <= rayon) trouves.push({ gare: g.nom, t: Math.round(a[0] + t * (b[0] - a[0])), d: Math.round(d) });
    }
    for (const x of trouves) { const y = res.find((z) => z.gare === g.nom && Math.abs(z.t - x.t) <= 600); if (!y) res.push(x); else if (x.d < y.d) Object.assign(y, x); }
  }
  return res.sort((a, b) => a.t - b.t);
}

/**
 * Péage mesuré : chaque couple de passages successifs est une section de la grille ADM (le péage se règle à la gare d'arrivée).
 * Renvoie [{ de, vers, tDe, tVers, mad, type }] ; type : "section" | "liaison" (gares voisines sans tarif dans la grille) | "absente".
 */
function gpsTrajetsPeage(passages, classe = 3, maxH = 6) {
  const res = [];
  for (let i = 1; i < passages.length; i++) {
    const a = passages[i - 1], b = passages[i];
    if (b.t - a.t > maxH * 3600) continue;
    const mad = admSection(a.gare, b.gare, classe);
    if (mad !== null) res.push({ de: a.gare, vers: b.gare, tDe: a.t, tVers: b.t, mad, type: "section" });
    else res.push({ de: a.gare, vers: b.gare, tDe: a.t, tVers: b.t, mad: 0, type: b.t - a.t <= 1800 ? "liaison" : "absente" });
  }
  return res;
}

/* ---------- relevé de péage (export Jawaz Pro ou autre) ---------- */
const admGares = () => [...new Set(ADM_GRILLE.flatMap((r) => [r[0], r[1]]))].sort();
const gareNorm = (s) => gpsNorm(s).replace(/\b(gare|de|du|d|peage|barriere|station|echangeur|ech|autoroute|sortie|entree)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
/** Nom ADM correspondant à un libellé libre (exact, sinon unique correspondance partielle). */
function admGareProche(nom) {
  const n = gareNorm(nom); if (!n) return null;
  const noms = admGares();
  const exact = noms.find((g) => gareNorm(g) === n); if (exact) return exact;
  const part = noms.filter((g) => { const m = gareNorm(g); return m.includes(n) || n.includes(m); });
  return part.length === 1 ? part[0] : null;
}
const gareIdem = (a, b) => { const x = admGareProche(a) || gareNorm(a), y = admGareProche(b) || gareNorm(b); return !!x && x === y; };

const RELEVE_COLONNES = {
  temps: ["date et heure", "date/heure", "horodatage", "datetime", "date heure", "date passage", "date de passage", "heure passage", "date operation", "date", "heure"],
  gareB: ["gare de sortie", "gare sortie", "sortie", "gare arrivee", "arrivee", "gare", "station", "peage", "lieu"],
  gareA: ["gare d'entree", "gare entree", "entree", "gare depart", "depart", "origine"],
  montant: ["montant", "tarif", "prix", "debit", "total", "amount", "cout"],
  ref: ["n pass", "numero pass", "pass", "tag", "badge", "plaque", "immatriculation", "vehicule"],
};
function releveDetecter(entetes) {
  const h = entetes.map(gpsNorm);
  const trouver = (cands, exclure = () => false) => {
    for (const c of cands) { const i = h.findIndex((x, k) => x === c && !exclure(x, k)); if (i >= 0) return i; }
    for (const c of cands) { if (c.length < 4) continue; const i = h.findIndex((x, k) => x.includes(c) && !exclure(x, k)); if (i >= 0) return i; }
    return -1;
  };
  const estEntree = (x) => /entree|depart|origine/.test(x);
  const col = { temps: trouver(RELEVE_COLONNES.temps), gareB: trouver(RELEVE_COLONNES.gareB, estEntree), gareA: trouver(RELEVE_COLONNES.gareA), montant: trouver(RELEVE_COLONNES.montant), ref: trouver(RELEVE_COLONNES.ref), date: -1 };
  const iDate = h.findIndex((x) => x === "date" || x === "jour"), iHeure = h.findIndex((x) => x === "heure" || x === "time" || x === "hour");
  if (iDate >= 0 && iHeure >= 0 && iDate !== iHeure) { col.temps = iHeure; col.date = iDate; }
  if (col.gareA === col.gareB) col.gareA = -1;
  return col;
}
/** Lit un relevé de péages CSV. Lignes : { t, gareA, gareB, mad, ref }. */
function releveParse(texte, { offH = 0, colonnes = null } = {}) {
  const lignes = gpsLignesCSV(texte);
  if (lignes.length < 2) return { ok: false, lignes: [], entetes: lignes[0] || [], colonnes: null, rejetes: 0, erreur: "Fichier vide ou sans ligne de données." };
  const entetes = lignes[0], col = colonnes || releveDetecter(entetes);
  if (col.temps < 0 || col.gareB < 0 || col.montant < 0) return { ok: false, lignes: [], entetes, colonnes: col, rejetes: 0, erreur: "Colonnes introuvables." };
  const res = []; let rejetes = 0;
  for (const l of lignes.slice(1)) {
    const brut = col.date >= 0 && col.date !== col.temps ? `${l[col.date]} ${l[col.temps]}` : l[col.temps];
    const t = gpsTemps(brut, offH), mad = gpsNombre(l[col.montant]);
    if (!Number.isFinite(t) || !Number.isFinite(mad)) { rejetes++; continue; }
    res.push({ t, gareA: col.gareA >= 0 ? l[col.gareA] : "", gareB: l[col.gareB], mad, ref: col.ref >= 0 ? l[col.ref] : "" });
  }
  return { ok: res.length > 0, lignes: res, entetes, colonnes: col, rejetes, erreur: res.length ? "" : "Aucune ligne exploitable (date, gare ou montant illisible)." };
}

/**
 * Compare les péages mesurés par GPS au relevé facturé.
 * Statuts : ok · ecart (montant différent) · non_facture (passage GPS sans ligne) · sans_passage (ligne facturée sans passage GPS : Pass prêté ? autre camion ?).
 */
function gpsRapprocher(trajets, lignes, { fenetreMin = 30, debut = null, fin = null } = {}) {
  const pris = new Set(), res = [];
  for (const tr of trajets) {
    if (tr.type !== "section") { res.push({ statut: "liaison", trajet: tr }); continue; }
    let meilleur = -1, ecart = Infinity;
    lignes.forEach((l, i) => { if (pris.has(i) || !gareIdem(l.gareB, tr.vers)) return; const d = Math.abs(l.t - tr.tVers); if (d <= fenetreMin * 60 && d < ecart) { ecart = d; meilleur = i; } });
    if (meilleur < 0) { res.push({ statut: "non_facture", trajet: tr }); continue; }
    pris.add(meilleur);
    const l = lignes[meilleur];
    res.push({ statut: Math.abs(l.mad - tr.mad) <= 1 ? "ok" : "ecart", trajet: tr, ligne: l, difference: Math.round((l.mad - tr.mad) * 100) / 100 });
  }
  lignes.forEach((l, i) => { if (!pris.has(i) && (debut === null || (l.t >= debut - 3600 && l.t <= fin + 3600))) res.push({ statut: "sans_passage", ligne: l }); });
  return res;
}
const gpsResumeRapprochement = (r) => ({ ok: r.filter((x) => x.statut === "ok").length, ecart: r.filter((x) => x.statut === "ecart").length, nonFacture: r.filter((x) => x.statut === "non_facture").length, sansPassage: r.filter((x) => x.statut === "sans_passage").length,
  manque: Math.round(r.filter((x) => x.statut === "non_facture").reduce((s, x) => s + x.trajet.mad, 0) * 100) / 100, surplus: Math.round(r.filter((x) => x.statut === "sans_passage").reduce((s, x) => s + x.ligne.mad, 0) * 100) / 100 });

/** Requête à coller dans overpass-turbo.eu (puis Exporter → GeoJSON) pour obtenir les gares de péage du Maroc. */
const OSM_REQUETE = `[out:json][timeout:90];
area["ISO3166-1"="MA"]->.a;
(
  node["barrier"="toll_booth"](area.a);
  way["barrier"="toll_booth"](area.a);
  node["highway"="toll_gantry"](area.a);
);
out center tags;`;

/** Lit un export OpenStreetMap (GeoJSON d'overpass-turbo, ou JSON d'Overpass) : [{ nom, lat, lon, osm }]. */
function osmGaresParse(texte) {
  let j; try { j = JSON.parse(texte); } catch { return { ok: false, gares: [], erreur: "Ce fichier n'est pas un JSON valide." }; }
  const centre = (g) => {
    if (!g) return null;
    if (g.type === "Point") return [g.coordinates[1], g.coordinates[0]];
    const pts = []; const walk = (c) => { if (typeof c[0] === "number") pts.push(c); else c.forEach(walk); }; walk(g.coordinates || []);
    return pts.length ? [pts.reduce((s, p) => s + p[1], 0) / pts.length, pts.reduce((s, p) => s + p[0], 0) / pts.length] : null;
  };
  const brut = [];
  if (Array.isArray(j.features)) for (const f of j.features) { const c = centre(f.geometry); if (c) brut.push({ lat: c[0], lon: c[1], tags: f.properties?.tags || f.properties || {}, osm: f.id || f.properties?.["@id"] || "" }); }
  else if (Array.isArray(j.elements)) for (const e of j.elements) { const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon; if (Number.isFinite(lat) && Number.isFinite(lon)) brut.push({ lat, lon, tags: e.tags || {}, osm: `${e.type}/${e.id}` }); }
  else return { ok: false, gares: [], erreur: "Format non reconnu (attendu : GeoJSON ou JSON d'Overpass)." };
  const gares = brut.map((b) => {
    const t = b.tags, libelle = t["name:fr"] || t.name || t["name:ar"] || t.ref || "";
    return { nom: libelle, adm: admGareProche(t["name:fr"] || "") || admGareProche(t.name || "") || admGareProche(t.ref || ""), lat: b.lat, lon: b.lon, osm: b.osm };
  });
  return { ok: gares.length > 0, gares, erreur: gares.length ? "" : "Aucune gare de péage dans ce fichier." };
}

/* ============================================================
   Phase 3 : suivi en direct
   Position normalisée : { id, t (secondes UTC), lat, lon, v (km/h ou null), cap (° ou null) }
   ============================================================ */

/** Positions « Traccar » (API /api/positions + /api/devices) → positions normalisées. Vitesse Traccar en nœuds. */
function directDepuisTraccar(appareils, positions) {
  const noms = new Map((appareils || []).map((d) => [d.id, d]));
  const res = [];
  for (const p of positions || []) {
    const t = gpsTemps(String(p.fixTime || p.deviceTime || "").replace(/\.\d+(?=Z|[+-]|$)/, ""));
    if (!Number.isFinite(t) || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
    const d = noms.get(p.deviceId);
    res.push({ id: d?.uniqueId || `traccar:${p.deviceId}`, nom: d?.name || "", t, lat: p.latitude, lon: p.longitude, v: Number.isFinite(p.speed) ? Math.round(p.speed * 1.852 * 10) / 10 : null, cap: Number.isFinite(p.course) ? p.course : null, temp: Number.isFinite(Number(p.attributes?.temp1 ?? p.attributes?.temperature)) && (p.attributes?.temp1 ?? p.attributes?.temperature) !== null ? Number(p.attributes.temp1 ?? p.attributes.temperature) : null });
  }
  return res;
}

/** Série de conduite en cours : heures de conduite depuis la dernière pause de 45 min, et durée de l'arrêt actuel. (Estimation GPS, pas le tachygraphe.) */
function conduiteCourante(points, maintenant = null) {
  let serie = 0, arret = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dt = b[0] - a[0];
    const v = b[3] ?? (dt > 0 ? (gpsDistance(a, b) / dt) * 3.6 : 0);
    if (dt > 15 * 60) { arret = dt; if (dt >= PAUSE_REGLEMENTAIRE_S) serie = 0; continue; }
    if (v >= SEUIL_MARCHE_KMH) { serie += dt; arret = 0; }
    else { arret += dt; if (arret >= PAUSE_REGLEMENTAIRE_S) serie = 0; }
  }
  if (maintenant !== null && points.length) { const trou = maintenant - points[points.length - 1][0]; if (trou > 15 * 60) { arret += trou; if (arret >= PAUSE_REGLEMENTAIRE_S) serie = 0; } }
  return { serieH: serie / 3600, arretMin: Math.round(arret / 60) };
}

const ETATS_DIRECT = {
  en_route: ["En route", "ok"], arret: ["À l'arrêt", "neutral"], arret_long: ["Arrêt prolongé", "warn"], au_port: ["Au port", "neutral"], en_douane: ["En douane / contrôle", "neutral"],
  depot: ["Au dépôt", "neutral"], client: ["Chez le client", "neutral"], traversee: ["En traversée", "ok"], hors_ligne: ["Signal perdu", "danger"], inconnu: ["Aucune position", "neutral"],
};
/**
 * État d'un camion à l'instant donné d'après son historique récent (points [t, lat, lon, v], triés).
 * Une absence de signal juste après un port est une TRAVERSÉE (pas de couverture en mer), jamais une alerte.
 */
function directEtat(hist, maintenant, zones = [], { signalMin = 30, arretMin = 45, traverseeMaxH = 8 } = {}) {
  if (!hist.length) return { code: "inconnu", ...libEtat("inconnu"), zone: null, ageMin: null, arretMin: 0 };
  const last = hist[hist.length - 1], age = maintenant - last[0], zone = gpsZoneDe(last, zones);
  const base = { zone, ageMin: Math.round(age / 60), arretMin: conduiteCourante(hist, maintenant).arretMin };
  const fin = (code, extra = {}) => ({ code, ...libEtat(code), ...base, ...extra });
  if (age > signalMin * 60) {
    if (zone && (zone.type === "port_maroc" || zone.type === "port_europe") && age <= traverseeMaxH * 3600) return fin("traversee", { attendu: true });
    return fin("hors_ligne");
  }
  const v = last[3] ?? (hist.length > 1 && last[0] > hist[hist.length - 2][0] ? (gpsDistance(hist[hist.length - 2], last) / (last[0] - hist[hist.length - 2][0])) * 3.6 : 0);
  if (zone) { const c = { port_maroc: "au_port", port_europe: "au_port", douane: "en_douane", depot: "depot", client: "client", frontiere: v >= SEUIL_MARCHE_KMH ? "en_route" : "arret" }[zone.type]; if (c && !(v >= SEUIL_MARCHE_KMH && c !== "en_route")) return fin(c); }
  if (v >= SEUIL_MARCHE_KMH) return fin("en_route", { v });
  return fin(base.arretMin >= arretMin && !zone ? "arret_long" : "arret", { v });
}
const libEtat = (c) => ({ libelle: ETATS_DIRECT[c][0], niveau: ETATS_DIRECT[c][1] });

/** Alertes en direct pour un camion. Renvoie [{ niveau, cle, texte }]. */
function directAlertes(nom, etat, hist, { vitesseMax = 90 } = {}) {
  const r = [], last = hist[hist.length - 1];
  if (etat.code === "hors_ligne") r.push({ niveau: "danger", cle: `signal:${nom}`, texte: `${nom} — aucun signal depuis ${etat.ageMin} min (hors port : à vérifier)` });
  if (etat.code === "arret_long") r.push({ niveau: "warn", cle: `arret:${nom}`, texte: `${nom} — à l'arrêt depuis ${etat.arretMin} min hors zone connue` });
  const c = conduiteCourante(hist, last ? last[0] : null);
  if (c.serieH >= 4.5) r.push({ niveau: "danger", cle: `conduite:${nom}`, texte: `${nom} — ${c.serieH.toFixed(1).replace(".", ",")} h de conduite sans pause de 45 min (estimation GPS)` });
  else if (c.serieH >= 4.25) r.push({ niveau: "warn", cle: `conduite:${nom}`, texte: `${nom} — ${c.serieH.toFixed(1).replace(".", ",")} h de conduite continue : pause à prévoir (estimation GPS)` });
  if (last && last[3] != null && last[3] > vitesseMax + 5) r.push({ niveau: "warn", cle: `vitesse:${nom}`, texte: `${nom} — ${Math.round(last[3])} km/h (limite ${vitesseMax})` });
  return r;
}

/* ---------- carte : projection Web Mercator et tuiles OpenStreetMap (facultatives, hors ligne = fond vide) ---------- */
const mercPx = (lat, lon, z) => { const n = 256 * 2 ** z, s = Math.sin(gpsRad(Math.max(-85, Math.min(85, lat)))); return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]; };
/** Cadrage : zoom et décalage pour afficher tous les points dans largeur × hauteur, et liste des tuiles utiles. */
function directVue(points, { largeur = 640, hauteur = 380, marge = 40, zMax = 14, zMin = 3 } = {}) {
  if (!points.length) return null;
  let z = zMax, bb;
  for (; z >= zMin; z--) {
    const px = points.map((p) => mercPx(p[0], p[1], z)), xs = px.map((p) => p[0]), ys = px.map((p) => p[1]);
    bb = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    if (bb.x1 - bb.x0 <= largeur - 2 * marge && bb.y1 - bb.y0 <= hauteur - 2 * marge) break;
  }
  z = Math.max(z, zMin);
  const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, ox = cx - largeur / 2, oy = cy - hauteur / 2;
  const tuiles = [], n = 2 ** z;
  for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + largeur) / 256); tx++) for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + hauteur) / 256); ty++) {
    if (ty < 0 || ty >= n) continue;
    tuiles.push({ x: ((tx % n) + n) % n, y: ty, px: tx * 256 - ox, py: ty * 256 - oy });
  }
  return { z, ox, oy, largeur, hauteur, tuiles, vers: (lat, lon) => { const p = mercPx(lat, lon, z); return [p[0] - ox, p[1] - oy]; } };
}

/* ============================================================
   Phase 4 : heure d'arrivée estimée (ETA)
   Estimation indicative : distance à vol d'oiseau × coefficient de détour, vitesse récente du camion,
   traversée du détroit, pauses et repos réglementaires (règlement CE 561/2006). Ce n'est ni un itinéraire ni un tachygraphe.
   ============================================================ */

/** Coordonnées [lat, lon] d'une ville connue (sans accents ni casse), sinon null. */
function villeConnue(nom) {
  const k = gpsNorm(nom).replace(/\(.*\)/, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!k) return null;
  if (VILLES[k]) return VILLES[k];
  const cle = Object.keys(VILLES).sort((a, b) => b.length - a.length).find((v) => k === v || k.startsWith(v + " ") || k.endsWith(" " + v));
  return cle ? VILLES[cle] : null;
}
/** Vitesse moyenne de roulage (km/h) sur les 6 dernières heures ; null si trop peu de roulage. */
function vitesseMoyenne(hist, maintenant) {
  let km = 0, s = 0;
  for (let i = 1; i < hist.length; i++) {
    const a = hist[i - 1], b = hist[i], dt = b[0] - a[0];
    if (b[0] < maintenant - 6 * 3600 || dt <= 0 || dt > 900) continue;
    const d = gpsDistance(a, b), v = (d / dt) * 3.6;
    if (v >= SEUIL_MARCHE_KMH) { km += d / 1000; s += dt; }
  }
  return s >= 1800 ? km / (s / 3600) : null;
}
/** Heures de conduite depuis le dernier repos d'au moins 9 h (estimation, pour la limite journalière). */
function conduiteJour(points, maintenant = null) {
  let jour = 0, arret = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dt = b[0] - a[0];
    const v = b[3] ?? (dt > 0 ? (gpsDistance(a, b) / dt) * 3.6 : 0);
    if (dt > 15 * 60) { arret += dt; if (arret >= 9 * 3600) jour = 0; continue; }
    if (v >= SEUIL_MARCHE_KMH) { jour += dt; arret = 0; } else { arret += dt; if (arret >= 9 * 3600) jour = 0; }
  }
  if (maintenant !== null && points.length) { const trou = maintenant - points[points.length - 1][0]; if (trou > 15 * 60) { arret += trou; if (arret >= 9 * 3600) jour = 0; } }
  return jour / 3600;
}

/**
 * ETA d'un camion vers une destination [lat, lon].
 * Le détroit est franchi par les ports des zones (Tanger Med ⇄ Algeciras) quand la position et la destination ne sont pas du même côté (latitude 35,95).
 * options : facteurRoute (détour, 1,3), vitesse (km/h, sinon vitesse récente, sinon 75), attentePortH (3), traverseeH (1,5), debarquementH (1), jourMaxH (9), zones.
 */
function etaVoyage(hist, maintenant, dest, { zones = [], facteurRoute = 1.3, vitesse = null, attentePortH = 3, traverseeH = 1.5, debarquementH = 1, jourMaxH = 9 } = {}) {
  if (!hist.length || !dest) return null;
  const last = hist[hist.length - 1], pos = [last[1], last[2]];
  const cote = (lat) => (lat < 35.95 ? "maroc" : "europe");
  const portMa = zones.find((z) => z.type === "port_maroc" && /med/i.test(z.nom)) || zones.find((z) => z.type === "port_maroc");
  const portEu = zones.find((z) => z.type === "port_europe" && /algeciras/i.test(z.nom)) || zones.find((z) => z.type === "port_europe");
  const km = (a, b) => (gpsDistance([0, ...a], [0, ...b]) / 1000) * facteurRoute;
  const etat = directEtat(hist, maintenant, zones);
  const traversee = cote(pos[0]) !== cote(dest[0]) && portMa && portEu;
  const legs = [];       // blocs de roulage (km) ou d'attente (heures)
  let kmTotal = 0;
  if (traversee) {
    const depart = cote(pos[0]) === "maroc" ? portMa : portEu, arrivee = cote(pos[0]) === "maroc" ? portEu : portMa;
    const enMer = etat.code === "traversee";
    const dejaAuPort = etat.zone && etat.zone.id === depart.id;
    if (enMer) { legs.push({ attente: Math.max(0, traverseeH - (maintenant - last[0]) / 3600) + debarquementH }); legs.push({ km: km([arrivee.lat, arrivee.lon], dest) }); }
    else {
      if (!dejaAuPort) legs.push({ km: km(pos, [depart.lat, depart.lon]) });
      legs.push({ attente: (dejaAuPort ? Math.max(1, attentePortH - 1) : attentePortH) + traverseeH + debarquementH });
      legs.push({ km: km([arrivee.lat, arrivee.lon], dest) });
    }
  } else legs.push({ km: km(pos, dest) });
  kmTotal = legs.reduce((s, l) => s + (l.km || 0), 0);
  const v = Math.max(55, Math.min(85, vitesse ?? vitesseMoyenne(hist, maintenant) ?? 75));
  let serie = conduiteCourante(hist, maintenant).serieH, jour = conduiteJour(hist, maintenant);
  let t = 0, courtes = 0, repos = 0, conduite = 0, attentes = 0;
  for (const l of legs) {
    if (l.attente !== undefined) { t += l.attente; attentes += l.attente; if (l.attente >= 0.75) serie = 0; continue; }
    let reste = l.km / v;
    while (reste > 1e-9) {
      const dispo = Math.min(4.5 - serie, jourMaxH - jour, reste);
      if (dispo > 1e-9) { t += dispo; conduite += dispo; serie += dispo; jour += dispo; reste -= dispo; }
      if (reste <= 1e-9) break;
      if (jour >= jourMaxH - 1e-9) { t += 11; repos++; serie = 0; jour = 0; } else { t += 0.75; courtes++; serie = 0; }
    }
  }
  const marge = Math.max(0.33, t * 0.12);
  return { kmRestants: Math.round(kmTotal), conduiteH: conduite, attentesH: attentes, dureeH: t, pauses: courtes, reposJournaliers: repos, traversee: !!traversee, vitesse: Math.round(v), etat: etat.code,
    arrivee: Math.round(maintenant + t * 3600), min: Math.round(maintenant + (t - marge) * 3600), max: Math.round(maintenant + (t + marge) * 3600) };
}
/** Retard probable (minutes) par rapport au créneau prévu ; négatif = en avance. */
const etaRetardMin = (eta, prevuISO) => (eta && prevuISO && Number.isFinite(Date.parse(prevuISO)) ? Math.round((eta.arrivee - Date.parse(prevuISO) / 1000) / 60) : null);

/** Cap initial (degrés, 0 = nord, sens horaire) de a vers b : points [t, lat, lon]. */
function gpsCap(a, b) {
  const p1 = gpsRad(a[1]), p2 = gpsRad(b[1]), dl = gpsRad(b[2] - a[2]);
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
