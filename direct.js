"use strict";
/* ============================================================
   Suivi en direct (phase 3). Source des positions au choix :
     · relais  : le petit serveur de ce dépôt (serveur/relais.js), alimenté par vos balises ou par Traccar ;
     · traccar : l'API d'un serveur Traccar existant ;
     · démo    : camions fictifs, sans serveur, pour essayer.
   Les positions restent en mémoire sur l'appareil ; seule la configuration est conservée (hors sauvegardes : elle contient un jeton).
   Logique pure dans gps.js.
   ============================================================ */

const CLE_DIRECT = "logistique-direct";
const DIRECT_DEFAUT = { mode: "off", url: "", jeton: "", intervalle: 20, vitesseMax: 90, tuiles: true, tuilesUrl: "", ntfy: "" };
const directCfg = () => { try { return { ...DIRECT_DEFAUT, ...JSON.parse(localStorage.getItem(CLE_DIRECT) || "{}") }; } catch { return { ...DIRECT_DEFAUT }; } };
const directSauverCfg = (c) => { try { localStorage.setItem(CLE_DIRECT, JSON.stringify(c)); } catch { /* ignoré */ } };

const directDonnees = { hist: new Map(), derniere: new Map(), noms: new Map(), maj: null, erreur: "", enCours: false, internes: new Map() };
let directMinuteur = null, directSelection = "";
const maintenantS = () => Math.floor(Date.now() / 1000);

/* ---------- sources ---------- */
async function directFetch(url, jeton, signalMs = 12000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), signalMs);
  try {
    const r = await fetch(url, { headers: jeton ? { Authorization: `Bearer ${jeton}`, Accept: "application/json" } : { Accept: "application/json" }, signal: ctl.signal, cache: "no-store" });
    if (r.status === 401 || r.status === 403) throw new Error("Jeton refusé par le serveur.");
    if (!r.ok) throw new Error(`Réponse ${r.status} du serveur.`);
    return await r.json();
  } catch (e) { throw new Error(e.name === "AbortError" ? "Le serveur ne répond pas." : e.message === "Failed to fetch" ? "Serveur injoignable (adresse, réseau, HTTPS ou autorisation CORS)." : e.message); }
  finally { clearTimeout(t); }
}
const baseUrl = (u) => String(u || "").trim().replace(/\/+$/, "");

const SOURCES = {
  async relais(c, depuisPar) {
    const base = baseUrl(c.url), liste = await directFetch(`${base}/api/derniere`, c.jeton);
    const res = { derniere: liste, traces: {} };
    await Promise.all(liste.slice(0, 60).map(async (p) => {
      const depuis = depuisPar(p.id);
      try { res.traces[p.id] = await directFetch(`${base}/api/trace?id=${encodeURIComponent(p.id)}&depuis=${depuis}&max=3000`, c.jeton); } catch { res.traces[p.id] = []; }
    }));
    return res;
  },
  async traccar(c, depuisPar) {
    const base = baseUrl(c.url), appareils = await directFetch(`${base}/api/devices`, c.jeton);
    directDonnees.internes = new Map(appareils.map((d) => [d.uniqueId, d.id]));
    const derniere = directDepuisTraccar(appareils, await directFetch(`${base}/api/positions`, c.jeton));
    const res = { derniere, traces: {} };
    await Promise.all(derniere.slice(0, 60).map(async (p) => {
      const internal = directDonnees.internes.get(p.id); if (internal === undefined) return;
      const depuis = new Date(depuisPar(p.id) * 1000).toISOString(), jusqua = new Date(Date.now() + 60000).toISOString();
      try { res.traces[p.id] = directDepuisTraccar(appareils, await directFetch(`${base}/api/positions?deviceId=${internal}&from=${encodeURIComponent(depuis)}&to=${encodeURIComponent(jusqua)}`, c.jeton)); } catch { res.traces[p.id] = []; }
    }));
    return res;
  },
  async demo() { return directDemo(maintenantS()); },
};

/* ---------- démonstration : quatre camions fictifs qui montrent les cas utiles ---------- */
function trajetDemo(chemin, finT, v = 82) {
  let d = 0; const seg = chemin.slice(1).map((p, i) => { const l = gpsDistance([0, ...chemin[i]], [0, ...p]); d += l; return l; });
  const duree = d / (v / 3.6), debut = finT - duree, pts = [];
  for (let t = 0; t <= duree; t += 120) {
    let reste = t * (v / 3.6), i = 0; while (i < seg.length - 1 && reste > seg[i]) { reste -= seg[i]; i++; }
    const f = Math.min(1, reste / seg[i]), a = chemin[i], b = chemin[i + 1];
    pts.push([Math.round(debut + t), a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, v]);
  }
  return pts;
}
function directDemo(now) {
  const attente = (lat, lon, deb, fin) => { const r = []; for (let t = deb; t <= fin; t += 300) r.push([t, lat, lon, 0]); return r; };
  const c1 = trajetDemo([[34.0, -6.8], [35.2, -5.9]], now - 90);
  const c2 = [...trajetDemo([[34.0, -6.8], [35.889, -5.5]], now - 4800), ...attente(35.889, -5.5, now - 4800, now - 4200)]; // au port puis traversée : silence
  const c3 = trajetDemo([[39.8, -0.2], [41.0, 1.3], [42.42, 2.87]], now - 60, 84);                                           // plus de 4 h 30 sans pause
  const c4 = trajetDemo([[33.0, -8.0], [33.59, -7.62]], now - 7500);                                                                          // signal perdu sur l'autoroute
  const mk = (id, nom, pts) => ({ id, nom, pts });
  const flotte = [mk("DEMO-1", "Camion démo 1", c1), mk("DEMO-2", "Camion démo 2", c2), mk("DEMO-3", "Camion démo 3", c3), mk("DEMO-4", "Camion démo 4", c4)];
  return { derniere: flotte.map((f) => ({ id: f.id, nom: f.nom, t: f.pts[f.pts.length - 1][0], lat: f.pts[f.pts.length - 1][1], lon: f.pts[f.pts.length - 1][2], v: f.pts[f.pts.length - 1][3], cap: null })), traces: Object.fromEntries(flotte.map((f) => [f.id, f.pts.map((p) => ({ t: p[0], lat: p[1], lon: p[2], v: p[3] }))])) };
}

/* ---------- état de la flotte ---------- */
const camionDeBalise = (id) => S.camions.find((c) => c.balise && c.balise.trim() === id);
const voyageActif = (camionId) => camionId && S.voyages.find((v) => v.camionId === camionId && v.statut === "en_cours");
const libelleBalise = (id) => camionDeBalise(id)?.immat || directDonnees.noms.get(id) || id;

function directVoyageDepuis(id) { // historique à demander : 12 h, ou depuis le départ du voyage en cours (3 jours au plus)
  const v = voyageActif(camionDeBalise(id)?.id), h = directDonnees.hist.get(id), dernier = h?.length ? h[h.length - 1][0] : 0;
  if (dernier) return dernier;
  const debut = v?.dateDepart ? Math.floor(new Date(v.dateDepart + "T00:00:00").getTime() / 1000) : 0;
  return Math.max(maintenantS() - 12 * 3600, debut, maintenantS() - 3 * 86400);
}
function directIntegrer(res) {
  const D = directDonnees;
  for (const p of res.derniere) { if (p.nom) D.noms.set(p.id, p.nom); D.derniere.set(p.id, p); }
  for (const [id, liste] of Object.entries(res.traces)) {
    const h = D.hist.get(id) || [], fin = h.length ? h[h.length - 1][0] : 0;
    for (const p of liste) if (p.t > fin) h.push([p.t, p.lat, p.lon, p.v ?? null, p.temp ?? null]);
    if (!h.length) { const d = D.derniere.get(id); if (d) h.push([d.t, d.lat, d.lon, d.v ?? null, d.temp ?? null]); }
    const dernier = D.derniere.get(id); if (dernier && h.length && dernier.t > h[h.length - 1][0]) h.push([dernier.t, dernier.lat, dernier.lon, dernier.v ?? null, dernier.temp ?? null]);
    h.sort((a, b) => a[0] - b[0]); if (h.length > 4000) h.splice(0, h.length - 4000);
    D.hist.set(id, h);
  }
}
/** ETA du voyage en cours d'un camion, d'après son historique récent. */
function etaDuVoyage(v) {
  const cam = parId(S.camions, v.camionId), dest = destinationDe(v);
  const hist = cam?.balise && directDonnees.hist.get(cam.balise.trim());
  if (!hist?.length || !dest) return null;
  const e = etaVoyage(hist, maintenantS(), dest, { zones: zonesActives() });
  return e && { ...e, retardMin: etaRetardMin(e, v.livraisonPrevue) };
}
/** Pour chaque balise : état, alertes, voyage. */
function directFlotte() {
  const c = directCfg(), now = maintenantS(), zones = zonesActives(), res = [];
  for (const [id, hist] of directDonnees.hist) {
    const cam = camionDeBalise(id), etat = directEtat(hist, now, zones), nom = libelleBalise(id);
    const voyage = voyageActif(cam?.id), eta = voyage ? etaDuVoyage(voyage) : null, alertes = directAlertes(nom, etat, hist, { vitesseMax: Number(c.vitesseMax) || 90 });
    if (eta && eta.retardMin !== null && eta.retardMin > 60 && etat.code !== "hors_ligne") alertes.push({ niveau: "warn", cle: `retard:${nom}`, texte: `${nom} — retard probable de ${String(Math.round(eta.retardMin / 6) / 10).replace(".", ",")} h sur ${voyage.ref} (arrivée estimée ${new Date(eta.arrivee * 1000).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })})` });
    const froid = voyage && Number.isFinite(voyage.tempMin) && Number.isFinite(voyage.tempMax) ? froidEnCours(hist.map((p) => [p[0], p[4]]), voyage.tempMin, voyage.tempMax, now) : null;
    if (froid) alertes.push({ niveau: "danger", cle: `froid:${nom}`, texte: `${nom} — température ${String(froid.temp).replace(".", ",")} °C hors consigne (${voyage.tempMin} à ${voyage.tempMax} °C) depuis ${froid.depuisMin} min` });
    const chauffeur = (voyage && parId(S.chauffeurs, voyage.chauffeurId)) || S.chauffeurs.find((c) => cam && c.camionId === cam.id) || null;
    res.push({ id, nom, camion: cam, chauffeur, voyage, hist, etat, eta, derniere: hist[hist.length - 1], conduite: conduiteCourante(hist, now), alertes });
  }
  return res.sort((a, b) => (b.alertes.length - a.alertes.length) || a.nom.localeCompare(b.nom));
}
/**
 * Avant la connexion aux balises (ou tant qu'aucune position n'arrive) : la flotte telle qu'on la connaît déjà —
 * chaque camion avec sa dernière position tirée des traces importées, s'il y en a. La carte est prête, il ne manque que les positions en direct.
 */
function directFlotteAttente() {
  const zones = zonesActives(), res = [];
  for (const cam of S.camions) {
    let dern = null;
    for (const t of S.traces || []) { const cid = t.camionId || parId(S.voyages, t.voyageId)?.camionId; if (cid !== cam.id || !t.pts?.length) continue; const p = t.pts[t.pts.length - 1]; if (!dern || p[0] > dern[0]) dern = p; }
    const hist = dern ? [[dern[0], dern[1], dern[2], null, null]] : [];
    res.push({ id: `cam:${cam.id}`, nom: cam.immat, camion: cam, chauffeur: S.chauffeurs.find((c) => c.camionId === cam.id) || null, voyage: voyageActif(cam.id) || null, hist, derniere: hist[0] || null, eta: null, conduite: { serieH: 0, arretMin: 0 }, alertes: [], attente: true,
      etat: { code: "inconnu", libelle: dern ? "Dernière position connue" : "En attente de la balise", niveau: "neutral", zone: dern ? gpsZoneDe(hist[0], zones) : null, ageMin: null, arretMin: 0 } });
  }
  return res;
}
/** Ce que la page affiche : la flotte en direct dès qu'une position arrive, sinon la flotte en attente. */
function flotteAffichee() { const live = directFlotte(); return live.length ? live : directFlotteAttente(); }

/** Étapes automatiques des voyages en cours d'après les passages dans les zones. */
function directMajVoyages(flotte) {
  let change = false;
  for (const f of flotte) {
    if (!f.voyage) continue;
    const depuis = f.voyage.dateDepart ? Math.floor(new Date(f.voyage.dateDepart + "T00:00:00").getTime() / 1000) : 0;
    const an = gpsAnalyser(f.hist.filter((p) => p[0] >= depuis), zonesActives());
    const nouveaux = an.jalons.filter((j) => j.type !== "depart" && j.type !== "retour" && !(f.voyage.jalons || []).some((x) => x.type === j.type));
    if (!nouveaux.length) continue;
    (f.voyage.jalons ||= []).push(...nouveaux.map((j) => ({ type: j.type, date: j.date, source: "gps" })));
    for (const tr of an.traversees) { const x = (f.voyage.traversees || []).find((z) => z.sens === tr.sens); if (x && x.statut !== "effectuee") { const iso = gpsIso(tr.embarque); x.date = x.date || iso.slice(0, 10); x.heure = x.heure || iso.slice(11, 16); x.statut = "effectuee"; } }
    change = true;
  }
  if (change) sauver();
}
/** Envoi gratuit sur le téléphone du bureau via ntfy (https://ntfy.sh/<sujet>) — le sujet est un secret : choisissez un nom long et imprévisible. */
async function alerteExterne(a) {
  const c = directCfg();
  if (c.mode === "relais" && baseUrl(c.url) && c.jeton) { // le relais diffuse sur ses canaux (ntfy, Telegram, WhatsApp, webhook) : les secrets restent sur le serveur
    try { const r = await (await fetch(`${baseUrl(c.url)}/api/alertes`, { method: "POST", headers: { Authorization: `Bearer ${c.jeton}`, "Content-Type": "application/json" }, body: JSON.stringify({ texte: a.texte, niveau: a.niveau, cle: a.cle }) })).json(); if (r.envoyes?.length || r.note) return; } catch { /* repli ci-dessous */ }
  }
  const url = c.ntfy; if (!/^https:\/\//.test(url || "")) return;
  try { await fetch(url, { method: "POST", body: a.texte, headers: { Title: "Logistique Fret", Priority: a.niveau === "danger" ? "high" : "default", Tags: a.niveau === "danger" ? "rotating_light" : "warning" } }); } catch { /* ignoré */ }
}
function directNotifier(flotte) {
  let vues; try { vues = new Set(JSON.parse(sessionStorage.getItem("logistique-direct-vues") || "[]")); } catch { vues = new Set(); }
  for (const f of flotte) for (const a of f.alertes) {
    if (vues.has(a.cle)) continue; vues.add(a.cle);
    toast(a.texte, a.niveau === "danger" ? "danger" : "warn"); alerteExterne(a);
    if (a.niveau === "danger" && typeof notifAfficher === "function" && notifConfig().actif && notifPermission() === "granted") notifAfficher({ titre: "Suivi en direct", corps: a.texte, tag: a.cle, onglet: "direct" });
  }
  // une alerte résolue peut se reproduire : on oublie celles qui ne sont plus actives
  const actives = new Set(flotte.flatMap((f) => f.alertes.map((a) => a.cle))); for (const k of [...vues]) if (!actives.has(k)) vues.delete(k);
  try { sessionStorage.setItem("logistique-direct-vues", JSON.stringify([...vues])); } catch { /* ignoré */ }
}

async function directRafraichir() {
  const c = directCfg(); if (c.mode === "off" || directDonnees.enCours) return;
  if (c.mode !== "demo" && !baseUrl(c.url)) return;
  directDonnees.enCours = true;
  try {
    if (c.mode === "demo") { directDonnees.hist.clear(); directDonnees.derniere.clear(); }
    const res = await SOURCES[c.mode](c, directVoyageDepuis);
    directIntegrer(res); directDonnees.maj = maintenantS(); directDonnees.erreur = "";
    const f = directFlotte(); directMajVoyages(f); directNotifier(f);
    if (typeof partagesSynchroniser === "function") partagesSynchroniser();
  } catch (e) { directDonnees.erreur = e.message || "Erreur inconnue."; }
  directDonnees.enCours = false;
  if (ongletActif === "direct") directMettreAJour();
}
function directDemarrer() {
  clearInterval(directMinuteur); directMinuteur = null;
  const c = directCfg(); if (c.mode === "off") return;
  directRafraichir();
  directMinuteur = setInterval(() => { if (document.visibilityState === "visible") directRafraichir(); }, Math.max(10, Number(c.intervalle) || 20) * 1000);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && directCfg().mode !== "off") directRafraichir(); });

/* ---------- rendu : carte Leaflet (open source, embarquée, sans clé ni facturation) + panneau de détail ---------- */
const COULEUR_ETAT = { ok: "#16a34a", warn: "#d97706", danger: "#dc2626", neutral: "#64748b" };
const ilYa = (s) => (s < 90 ? `${Math.max(0, Math.round(s))} s` : s < 5400 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} j`);
const TUILES_OSM = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const hmFr = (t) => new Date(t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const jhmFr = (t) => new Date(t * 1000).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const carte = { map: null, marqueurs: new Map(), traces: new Map(), zones: null, groupeTraces: null, vue: null, panneauOuvert: false, cadre: false };

/** Cap (degrés) de la dernière position : donné par la balise, sinon déduit des deux derniers points distants d'au moins 30 m. */
function capDe(f) {
  const d = directDonnees.derniere.get(f.id); if (d && Number.isFinite(d.cap)) return d.cap;
  for (let i = f.hist.length - 1; i > 0; i--) if (gpsDistance(f.hist[i - 1], f.hist[i]) >= 30) return gpsCap(f.hist[i - 1], f.hist[i]);
  return null;
}
function iconeCamion(f) {
  const c = COULEUR_ETAT[f.etat.niveau], cap = capDe(f), sel = f.id === directSelection;
  const fleche = cap === null ? `<circle cx="14" cy="14" r="4.5" fill="#fff"/>` : `<g transform="rotate(${cap} 14 14)"><path d="M14 4 L21 22 L14 18 L7 22 Z" fill="#fff"/></g>`;
  return L.divIcon({ className: `direct-marq ${sel ? "sel" : ""}`, iconSize: [30, 30], iconAnchor: [15, 15],
    html: `<svg viewBox="0 0 28 28" width="30" height="30"><circle cx="14" cy="14" r="13" fill="${c}" stroke="#fff" stroke-width="2"/>${fleche}</svg><span class="direct-nom">${esc(f.nom)}</span>` });
}
function directCarteInit() {
  const el = $("#direct-map"); if (!el) return;
  if (carte.map) { carte.map.remove(); carte.map = null; carte.marqueurs.clear(); carte.traces.clear(); }
  if (typeof L === "undefined") { el.innerHTML = `<p class="hint" style="padding:16px">La bibliothèque de carte n'a pas pu être chargée (vendor/leaflet).</p>`; return; }
  const c = directCfg();
  carte.map = L.map(el, { zoomControl: true, worldCopyJump: true, preferCanvas: false });
  if (carte.vue) carte.map.setView([carte.vue.lat, carte.vue.lon], carte.vue.zoom); else carte.map.fitBounds(CORRIDOR);
  const url = tuilesUrlValide(c.tuilesUrl) ? c.tuilesUrl : TUILES_OSM;
  if (c.tuiles) L.tileLayer(url, { maxZoom: 19, crossOrigin: true, attribution: url === TUILES_OSM ? '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' : "Fond de carte : fournisseur configuré" }).addTo(carte.map);
  carte.zones = L.layerGroup(zonesActives().flatMap((z) => [L.circle([z.lat, z.lon], { radius: z.rayon, color: "#2563eb", weight: 1, fillOpacity: 0.1 }), L.circleMarker([z.lat, z.lon], { radius: 5, color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }).bindTooltip(esc(z.nom), { direction: "top" })])).addTo(carte.map);
  carte.groupeTraces = L.layerGroup().addTo(carte.map);
  L.control.layers(null, { "Zones (ports, frontières, dépôts)": carte.zones, "Trajet des 3 dernières heures": carte.groupeTraces }, { collapsed: true }).addTo(carte.map);
  const Tout = L.Control.extend({ options: { position: "topleft" }, onAdd() { const b = L.DomUtil.create("button", "leaflet-bar direct-tout"); b.type = "button"; b.title = "Voir toute la flotte"; b.textContent = "Tout voir"; L.DomEvent.disableClickPropagation(b); b.onclick = () => directToutVoir(); return b; } });
  new Tout().addTo(carte.map);
  carte.map.on("moveend", () => { const m = carte.map.getCenter(); carte.vue = { lat: m.lat, lon: m.lng, zoom: carte.map.getZoom() }; });
  carte.map.on("dragstart zoomstart", () => { carte.cadre = true; });
  setTimeout(() => carte.map?.invalidateSize(), 50);
}
const CORRIDOR = [[29.5, -11], [50.5, 9.5]]; // Maroc → Espagne → France → Allemagne : vue par défaut tant qu'aucun camion n'est positionné
function directToutVoir(flotte = flotteAffichee()) {
  if (!carte.map) return;
  const pts = flotte.filter((f) => f.derniere).map((f) => [f.derniere[1], f.derniere[2]]);
  if (!pts.length) return carte.map.fitBounds(CORRIDOR);
  if (pts.length === 1) carte.map.setView(pts[0], 11); else carte.map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 12 });
}
function directCarteMaj(flotte) {
  if (!carte.map) return;
  const now = maintenantS(), ids = new Set(flotte.filter((f) => f.derniere).map((f) => f.id));
  for (const [id, m] of carte.marqueurs) if (!ids.has(id)) { m.remove(); carte.marqueurs.delete(id); carte.traces.get(id)?.remove(); carte.traces.delete(id); }
  for (const f of flotte) {
    if (!f.derniere) continue;
    const ll = [f.derniere[1], f.derniere[2]];
    let m = carte.marqueurs.get(f.id);
    if (!m) { m = L.marker(ll, { icon: iconeCamion(f), riseOnHover: true, title: f.nom }).addTo(carte.map); m.on("click", () => directSelectionner(f.id, { centrer: true })); carte.marqueurs.set(f.id, m); }
    else { m.setLatLng(ll); m.setIcon(iconeCamion(f)); }
    m.setZIndexOffset(f.id === directSelection ? 1000 : f.alertes.length ? 500 : 0);
    const l = f.hist.filter((p) => now - p[0] < 3 * 3600).map((p) => [p[1], p[2]]);
    let t = carte.traces.get(f.id);
    if (l.length > 1) { if (!t) { t = L.polyline(l, { weight: 3, opacity: 0.7 }).addTo(carte.groupeTraces); carte.traces.set(f.id, t); } else t.setLatLngs(l); t.setStyle({ color: COULEUR_ETAT[f.etat.niveau] }); }
    else if (t) { t.remove(); carte.traces.delete(f.id); }
  }
  if (!carte.cadre) { directToutVoir(flotte); carte.cadre = flotte.some((f) => f.derniere && !f.attente); }
}

/* ---------- fiche complète d'un camion ---------- */
const ligneInfo = (k, v) => (v === "" || v === null || v === undefined ? "" : `<div class="fi"><span>${k}</span><b>${v}</b></div>`);
const echeanceBadge = (iso) => { const j = joursAvant(iso); return j === null ? badge("non renseigné", "neutral") : j < 0 ? badge(`expiré (${dateFr(iso)})`, "danger") : badge(`${dateFr(iso)} · J-${j}`, j <= S.params.alerteJours ? "warn" : "ok"); };
function directPanneauHtml(f) {
  const now = maintenantS(), cam = f.camion, ch = f.chauffeur, v = f.voyage, aPos = !!f.derniere, p = f.derniere || [now, 0, 0, null, null], d = directDonnees.derniere.get(f.id);
  const cap = capDe(f), km24 = f.hist.filter((q) => now - q[0] < 24 * 3600), dist = km24.reduce((s, q, i) => (i ? s + gpsDistance(km24[i - 1], q) / 1000 : 0), 0);
  const vmax = Math.max(0, ...km24.map((q) => q[3] ?? 0));
  const sec = (titre, corps) => (corps.trim() ? `<section class="fiche"><h4>${titre}</h4>${corps}</section>` : "");
  const acces = [];
  if (ch?.tel) acces.push(`<a class="btn sm" href="tel:${esc(ch.tel.replace(/\s/g, ""))}">${ic("phone")}Appeler</a>`);
  if (ch?.tel && lienWhatsApp(ch.tel, "")) acces.push(`<a class="btn ghost sm" href="${esc(lienWhatsApp(ch.tel, `Bonjour ${ch.nom.split(" ")[0]}, `))}" target="_blank" rel="noopener">WhatsApp</a>`);
  if (ch?.tel && lienSMS(ch.tel, "")) acces.push(`<a class="btn ghost sm" href="${esc(lienSMS(ch.tel, ""))}">SMS</a>`);
  const position = !aPos ? sec("Position", `<p class="hint" style="margin:0">Aucune position connue pour ce camion. Elle apparaîtra dès que sa balise enverra une position${cam?.balise ? "" : " — renseignez d'abord l'identifiant de sa balise"}.</p>`) : f.attente ? sec("Dernière position connue", [ligneInfo("Relevée", `il y a ${ilYa(now - p[0])} (${jhmFr(p[0])})`), ligneInfo("Coordonnées", `<a href="https://www.openstreetmap.org/?mlat=${p[1]}&mlon=${p[2]}#map=13/${p[1]}/${p[2]}" target="_blank" rel="noopener">${p[1].toFixed(5)}, ${p[2].toFixed(5)}</a>`), ligneInfo("Zone", f.etat.zone ? esc(f.etat.zone.nom) : ""), ligneInfo("Origine", "trace GPS importée — pas une position en direct")].join("")) : sec("Position et déplacement", [
    ligneInfo("Dernière position", `il y a ${ilYa(now - p[0])} (${hmFr(p[0])})`), ligneInfo("Vitesse", p[3] != null ? `${Math.round(p[3])} km/h` : ""), ligneInfo("Cap", cap !== null ? `${Math.round(cap)}°` : ""),
    ligneInfo("Coordonnées", `<a href="https://www.openstreetmap.org/?mlat=${p[1]}&mlon=${p[2]}#map=13/${p[1]}/${p[2]}" target="_blank" rel="noopener">${p[1].toFixed(5)}, ${p[2].toFixed(5)}</a>`),
    ligneInfo("Zone", f.etat.zone ? esc(f.etat.zone.nom) : ""), ligneInfo("État", `${f.etat.libelle}${f.etat.code === "traversee" ? " — silence normal en mer" : ""}`),
    f.etat.code === "arret" || f.etat.code === "arret_long" ? ligneInfo("Arrêt depuis", `${f.etat.arretMin} min`) : "",
    ligneInfo("Parcouru (24 h)", dist ? `${fmt(dist, 0)} km · vitesse max ${Math.round(vmax)} km/h` : ""),
    ligneInfo("Conduite sans pause de 45 min", `<span class="${f.conduite.serieH >= 4.5 ? "neg" : ""}">${dureeTxt(f.conduite.serieH)}</span> (estimation GPS)`), ligneInfo("Conduite du jour", `${dureeTxt(conduiteJour(f.hist, now))} (estimation)`),
    d?.batterie != null ? ligneInfo("Batterie balise", `${d.batterie} %`) : ""].join(""));
  const froid = aPos && f.derniere[4] != null ? (() => { const pts = f.hist.map((q) => [q[0], q[4]]).filter((q) => q[1] != null && now - q[0] < 12 * 3600); const a = v && Number.isFinite(v.tempMin) ? froidAnalyser(pts, v.tempMin, v.tempMax) : froidAnalyser(pts, -100, 100); const c = String(f.derniere[4]).replace(".", ",");
    return sec("Chaîne du froid", ligneInfo("Température actuelle", `${badge(`${c} °C`, f.alertes.some((x) => x.cle.startsWith("froid:")) ? "danger" : "ok")}`) + (v && Number.isFinite(v.tempMin) ? ligneInfo("Consigne", `${v.tempMin} à ${v.tempMax} °C`) : "") + (a ? ligneInfo("12 dernières heures", `${a.min.toFixed(1).replace(".", ",")} à ${a.max.toFixed(1).replace(".", ",")} °C${a.excursions.length ? ` · ${a.excursions.length} excursion(s)` : ""}`) : "")); })() : "";
  let voyageHtml = "";
  if (v) {
    const trav = ["aller", "retour"].map((s) => traversee(v, s)).filter(Boolean).map((t) => `${t.sens === "aller" ? "Aller" : "Retour"} : ${esc(libLigne(t.ligne))}${t.date ? " " + dateFr(t.date) : ""} · ${esc((STATUTS_TRAV.find(([k]) => k === t.statut) || [])[1] || "")}`).join("<br>");
    const jalons = (v.jalons || []).slice(-3).map((j) => `${esc(nomJalon(j.type))} <span class="sub" style="display:inline">${dateHeureFr(j.date)}</span>`).join("<br>");
    const cout = coutVoyage(v);
    voyageHtml = sec(`Voyage ${esc(v.ref)}`, [
      ligneInfo("Itinéraire", `${esc(v.origine)} ⇄ ${esc(v.destination)}`), ligneInfo("Client", v.clientId ? esc(nomClient(v.clientId)) : ""), ligneInfo("Marchandise", esc(v.marchandise || "")),
      ligneInfo("Départ → retour prévu", `${dateFr(v.dateDepart)} → ${dateFr(v.dateRetourPrevue)}`), ligneInfo("Livraison promise", v.livraisonPrevue ? jhmFr(Date.parse(v.livraisonPrevue) / 1000) : ""),
      f.eta ? ligneInfo("Arrivée estimée", `<strong>${jhmFr(f.eta.arrivee)}</strong> (${hmFr(f.eta.min)} – ${hmFr(f.eta.max)})${f.eta.retardMin !== null && f.eta.retardMin > 30 ? ` ${badge("retard probable", f.eta.retardMin > 60 ? "danger" : "warn")}` : ""}`) + ligneInfo("Reste à parcourir", `${fmt(f.eta.kmRestants)} km · ${f.eta.pauses} pause(s), ${f.eta.reposJournaliers} repos de 11 h${f.eta.traversee ? " · traversée du détroit comprise" : ""}`) : "",
      ligneInfo("Traversées", trav), ligneInfo("Dernières étapes", jalons),
      v.pod ? ligneInfo("Livraison", `Reçue par ${esc(v.pod.signataire || "?")} le ${dateHeureFr(v.pod.date)}`) : "",
      ligneInfo("Coût / marge", cout.prix ? `${fmt(cout.total)} MAD · marge ${fmt(cout.marge)} MAD (${fmt(cout.taux, 1)} %)` : `${fmt(cout.total)} MAD de coûts saisis`).replace('class="fi"', 'class="fi fin"'),
      `<div class="row" style="margin-top:8px">${btn("fiche-voyage", "Ouvrir le voyage", { id: v.id, icone: "ship", cls: "btn ghost sm" })}${btn("fiche-partager", v.partage ? "Lien client" : "Partager le suivi", { id: v.id, icone: "mail", cls: "btn ghost sm" })}</div>`].join(""))
  } else voyageHtml = sec("Voyage", `<p class="hint" style="margin:0">Aucun voyage en cours pour ce camion.</p>`);
  const chauffeurHtml = ch ? (() => { const e = etatChauffeur(ch), sc = schengenEtat(ch.sejours), tx = ch.tachy; return sec(`Chauffeur · ${esc(ch.nom)}`, [
    ligneInfo("Téléphone", ch.tel ? `<a href="tel:${esc(ch.tel.replace(/\s/g, ""))}">${esc(ch.tel)}</a>` : "non renseigné"), ligneInfo("Service", badge(e.texte, e.niveau)),
    ligneInfo("Permis", echeanceBadge(ch.permis)), ligneInfo("Carte conducteur", echeanceBadge(ch.carteConducteur)), ligneInfo("Passeport", echeanceBadge(ch.passeport)), ligneInfo("Visa", echeanceBadge(ch.visa)), ligneInfo("Visite médicale", echeanceBadge(ch.visiteMedicale)),
    (ch.sejours || []).length ? ligneInfo("Schengen 90/180", sc.depasse ? badge("limite dépassée", "danger") : badge(`${sc.restant} jour(s) restant(s)`, sc.restant <= 10 ? "warn" : "ok")) : "",
    tx ? ligneInfo("Tachygraphe", tx.infractions.length ? badge(`${tx.infractions.length} dépassement(s)`, tx.infractions.some((i) => i.gravite === "grave") ? "danger" : "warn") : badge("aucun dépassement", "ok")) : "",
    `<div class="row" style="margin-top:8px">${acces.join("")}${btn("fiche-chauffeur", "Fiche chauffeur", { icone: "users", cls: "btn ghost sm" })}</div>`].join("")); })() : sec("Chauffeur", `<p class="hint" style="margin:0">Aucun chauffeur affecté.</p>`);
  const camionHtml = cam ? sec(`Camion · ${esc(cam.immat)}`, [
    ligneInfo("Modèle", esc(cam.marque || "")), ligneInfo("Kilométrage", `${fmt(cam.km)} km`), ligneInfo("Essieux", cam.essieux ? `${cam.essieux} (péage classe ${classeADM(cam) || "?"})` : ""), ligneInfo("Remorque", esc(v?.remorque || "")),
    etatCamion(cam).filter((e) => e.pct !== undefined).map((e) => ligneInfo(e.type, badge(e.texte, e.niveau))).join(""),
    DOCS_CAMION.map(([k, lib]) => (cam[k] ? ligneInfo(lib, echeanceBadge(cam[k])) : "")).join(""),
    consoMoyenne(cam.id) ? ligneInfo("Consommation moyenne", `${fmt(consoMoyenne(cam.id), 1)} L/100 km`) : "",
    ligneInfo("Entretien (cumul)", `${fmt(coutEntretien(cam.id))} MAD`),
    `<div class="row" style="margin-top:8px">${btn("fiche-camion", "Fiche camion", { icone: "truck", cls: "btn ghost sm" })}</div>`].join("")) : sec("Camion", `<p class="hint" style="margin:0">Balise <strong>${esc(f.id)}</strong> non liée à un camion.</p><div class="row">${btn("lier-balise", "Lier à un camion", { id: f.id, icone: "truck", cls: "btn sm" })}</div>`);
  const alertesHtml = f.alertes.length ? sec("Alertes", `<ul class="ctl">${f.alertes.map((a) => `<li class="${a.niveau}">${ic(a.niveau === "danger" ? "alert" : "clock")}<span>${esc(a.texte)}</span></li>`).join("")}</ul>`) : "";
  return `<header><div><h3>${esc(f.nom)}</h3><div class="sub" style="margin:0">${cam?.marque ? esc(cam.marque) + " · " : ""}balise ${esc(f.id)}</div></div>${badge(f.etat.libelle, f.etat.niveau)}<button type="button" class="icon-btn" data-act="fermer-fiche" aria-label="Fermer">${ic("x")}</button></header>
    <div class="row" style="padding:0 14px 8px">${aPos ? btn("centrer", "Centrer", { icone: "pin", cls: "btn ghost sm" }) : ""}${aPos && f.hist.length > 1 ? btn("trace-complete", "Voir son trajet", { icone: "route", cls: "btn ghost sm" }) : ""}${cam && !cam.balise ? btn("balise-saisir", "Renseigner sa balise", { id: cam.id, icone: "radar", cls: "btn sm" }) : ""}</div>
    <div class="corps">${alertesHtml}${position}${voyageHtml}${chauffeurHtml}${camionHtml}${froid}</div>`;
}
function directPanneauMaj(flotte = flotteAffichee()) {
  const el = $("#direct-panneau"); if (!el) return;
  const f = flotte.find((x) => x.id === directSelection);
  if (!f) { el.hidden = true; el.innerHTML = ""; carte.panneauOuvert = false; $("#direct-zone")?.classList.remove("avec-panneau"); return; }
  const haut = el.querySelector(".corps")?.scrollTop || 0;
  el.innerHTML = directPanneauHtml(f); el.hidden = false; carte.panneauOuvert = true; $("#direct-zone")?.classList.add("avec-panneau");
  const c = el.querySelector(".corps"); if (c) c.scrollTop = haut;
  setTimeout(() => carte.map?.invalidateSize(), 30);
}
function directSelectionner(id, { centrer = false } = {}) {
  directSelection = id; const f = flotteAffichee().find((x) => x.id === id);
  directMettreAJour();
  if (centrer && f?.derniere && carte.map) { directCentrer(f, Math.max(carte.map.getZoom(), 9)); carte.cadre = true; }
}

/** Centre la carte sur un camion en tenant compte de la fiche ouverte à droite (sur grand écran, elle recouvre une partie de la carte). */
function directCentrer(f, zoom) {
  const el = $("#direct-panneau"), recouvre = el && !el.hidden && getComputedStyle(el).position === "absolute" ? el.offsetWidth : 0;
  const z = zoom ?? carte.map.getZoom(), cible = carte.map.project([f.derniere[1], f.derniere[2]], z).add([recouvre / 2, 0]);
  carte.map.setView(carte.map.unproject(cible, z), z, { animate: true });
}
/* ---------- haut de page, liste, mise à jour ---------- */
function directEntete(flotte) {
  const c = directCfg(), D = directDonnees, now = maintenantS();
  const compte = (...codes) => flotte.filter((f) => codes.includes(f.etat.code)).length, alertes = flotte.flatMap((f) => f.alertes);
  const statut = D.erreur ? badge(D.erreur, "danger") : D.maj ? badge(`Mis à jour il y a ${ilYa(now - D.maj)}`, "ok") : badge("Connexion…", "neutral");
  return `<div class="row" style="justify-content:space-between;margin-bottom:12px"><div>${statut} <span class="sub" style="display:inline">${c.mode === "demo" ? "Démonstration (camions fictifs)" : c.mode === "traccar" ? "Source : Traccar" : "Source : relais"}</span></div>${btn("actualiser", "Actualiser", { icone: "clock", cls: "btn ghost sm" })}</div>
    <div class="kpis">
      <div class="kpi"><div class="l">${ic("truck")} Camions suivis</div><div class="v">${flotte.length}</div></div>
      <div class="kpi"><div class="l">En route</div><div class="v">${compte("en_route")}</div><div class="s">${compte("traversee")} en traversée · ${compte("au_port", "en_douane")} au port</div></div>
      <div class="kpi"><div class="l">À l'arrêt</div><div class="v">${compte("arret", "arret_long", "depot", "client")}</div></div>
      <div class="kpi"><div class="l">${ic("alert")} Alertes</div><div class="v">${alertes.length}</div><div class="s ${alertes.some((a) => a.niveau === "danger") ? "danger" : alertes.length ? "warn" : ""}">${compte("hors_ligne") ? `${compte("hors_ligne")} signal perdu` : alertes.length ? "à traiter" : "rien à signaler"}</div></div>
    </div>`;
}
function directListe(flotte) {
  const now = maintenantS();
  if (!flotte.length) return `<div class="card">${vide("pin", directDonnees.maj ? "Aucune position reçue" : "En attente de positions", directDonnees.maj ? "Le serveur répond mais n'a encore reçu aucune position. Vérifiez que vos balises ou Traccar envoient bien vers le relais." : "Les camions apparaîtront ici dès la première réponse du serveur.")}</div>`;
  return `${flotte.some((f) => f.alertes.length) ? `<div class="section-title">Alertes</div><div class="card"><ul class="ctl">${flotte.flatMap((f) => f.alertes.map((a) => { const msg = `${a.texte} — merci de confirmer.`, wa = f.chauffeur ? lienWhatsApp(f.chauffeur.tel, msg) : "", sms = f.chauffeur ? lienSMS(f.chauffeur.tel, msg) : ""; return `<li class="${a.niveau}">${ic(a.niveau === "danger" ? "alert" : "clock")}<span>${esc(a.texte)}${wa ? ` <a class="btn ghost sm" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp ${esc(f.chauffeur.nom.split(" ")[0])}</a> <a class="btn ghost sm" href="${esc(sms)}">SMS</a>` : ""}</span></li>`; })).join("")}</ul></div>` : ""}
    <div class="section-title">Camions · cliquez pour la fiche complète</div>
    ${flotte.map((f) => `<div class="card direct-camion ${f.id === directSelection ? "sel" : ""}" data-direct-camion="${esc(f.id)}" tabindex="0" role="button">
      <div class="card-head"><h2>${esc(f.nom)}${f.camion ? "" : ` <span class="sub" style="display:inline">· balise ${esc(f.id)}</span>`}</h2>${badge(f.etat.libelle, f.etat.niveau)}</div>
      <p class="hint" style="margin:0 0 8px">${[f.derniere[3] != null ? `${Math.round(f.derniere[3])} km/h` : "", `dernière position il y a ${ilYa(now - f.derniere[0])}`, f.etat.zone && esc(f.etat.zone.nom), f.chauffeur && esc(f.chauffeur.nom), f.voyage && `voyage ${esc(f.voyage.ref)} · ${esc(f.voyage.origine)} ⇄ ${esc(f.voyage.destination)}`].filter(Boolean).join(" · ")}</p>
      ${f.eta ? `<p class="hint" style="margin:0 0 8px"><strong>Arrivée estimée ${jhmFr(f.eta.arrivee)}</strong> (${hmFr(f.eta.min)} – ${hmFr(f.eta.max)}) · ${fmt(f.eta.kmRestants)} km restants${f.eta.retardMin !== null && f.eta.retardMin > 30 ? ` · ${badge("retard probable", f.eta.retardMin > 60 ? "danger" : "warn")}` : ""}</p>` : ""}
      <div class="row">${f.derniere[4] != null ? badge(`${String(f.derniere[4]).replace(".", ",")} °C`, f.alertes.some((a) => a.cle.startsWith("froid:")) ? "danger" : "ok") : ""}${badge(`Conduite : ${dureeTxt(f.conduite.serieH)} sans pause`, f.conduite.serieH >= 4.5 ? "danger" : f.conduite.serieH >= 4.25 ? "warn" : "neutral")}</div></div>`).join("")}`;
}
/** En-tête tant que les positions en direct n'arrivent pas : la carte est prête, voici ce qui manque. */
function directEnteteAttente(flotte) {
  const c = directCfg(), avecBalise = S.camions.filter((x) => x.balise).length, connues = flotte.filter((f) => f.derniere).length;
  const etapes = [[c.mode !== "off", "Source des positions réglée (relais, Traccar ou démonstration)"], [S.camions.length > 0 && avecBalise === S.camions.length, `Balise renseignée sur chaque camion (${avecBalise} sur ${S.camions.length})`], [false, "Première position reçue"]];
  return `<div class="card"><div class="card-head"><h2>La carte est prête : il ne manque que vos balises</h2>${c.mode === "off" ? badge("Non connecté", "neutral") : directDonnees.erreur ? badge(directDonnees.erreur, "danger") : badge("En attente de positions", "warn")}</div>
    <p class="hint" style="margin-top:0">Dès que les identifiants de votre plateforme GPS sont saisis, vos camions apparaissent ici en direct, avec leur fiche complète au clic. ${connues ? `En attendant, ${connues} camion(s) sont placés à leur <strong>dernière position connue</strong> (traces importées).` : "En attendant, la carte montre votre corridor et vos zones (ports, frontière, dépôts)."}</p>
    <ul class="ctl" style="margin-bottom:10px">${etapes.map(([ok, t]) => `<li class="${ok ? "" : "warn"}" ${ok ? 'style="color:var(--ok)"' : ""}>${ic(ok ? "check" : "clock")}<span>${esc(t)}</span></li>`).join("")}</ul>
    <div class="row">${btn("connecter", "Connecter mes balises", { icone: "radar" })}${btn("demo", "Voir une démonstration", { icone: "play", cls: "btn ghost" })}${c.mode !== "off" ? btn("actualiser", "Actualiser", { icone: "clock", cls: "btn ghost" }) : ""}</div></div>`;
}
function directListeAttente(flotte) {
  if (!S.camions.length) return `<div class="card">${vide("truck", "Aucun camion", "Ajoutez vos camions (page Camions) : ils apparaîtront sur la carte dès que leur balise enverra une position.", btn("fiche-camion", "Ajouter un camion", { icone: "plus" }))}</div>`;
  const now = maintenantS();
  return `<div class="section-title">Votre flotte · cliquez pour la fiche complète</div>
    ${flotte.map((f) => `<div class="card direct-camion ${f.id === directSelection ? "sel" : ""}" data-direct-camion="${esc(f.id)}" tabindex="0" role="button">
      <div class="card-head"><h2>${esc(f.nom)}${f.camion?.marque ? ` <span class="sub" style="display:inline">· ${esc(f.camion.marque)}</span>` : ""}</h2>${f.camion?.balise ? badge(`Balise ${f.camion.balise}`, "ok") : badge("Balise à renseigner", "warn")}</div>
      <p class="hint" style="margin:0 0 8px">${[f.derniere ? `dernière position connue il y a ${ilYa(now - f.derniere[0])}${f.etat.zone ? " · " + esc(f.etat.zone.nom) : ""}` : "aucune position connue", f.chauffeur && esc(f.chauffeur.nom), f.voyage && `voyage ${esc(f.voyage.ref)} · ${esc(f.voyage.origine)} ⇄ ${esc(f.voyage.destination)}`].filter(Boolean).join(" · ")}</p>
      ${f.camion?.balise ? "" : `<div class="row">${btn("balise-saisir", "Renseigner sa balise", { id: f.camion.id, icone: "radar", cls: "btn ghost sm" })}</div>`}</div>`).join("")}`;
}
/** Recalcule la flotte une fois et met à jour l'en-tête, la carte, la liste et la fiche ouverte. */
function directMettreAJour() {
  if (ongletActif !== "direct") return;
  const flotte = flotteAffichee(), attente = !flotte.length || flotte[0].attente;
  const h = $("#direct-entete"); if (h) h.innerHTML = attente ? directEnteteAttente(flotte) : directEntete(flotte);
  const l = $("#direct-liste"); if (l) l.innerHTML = attente ? directListeAttente(flotte) : directListe(flotte);
  directCarteMaj(flotte); directPanneauMaj(flotte);
}
const directFlotteRendu = directMettreAJour;

const cfgFormulaire = (c) => `<details class="card"><summary style="cursor:pointer;font-weight:600">Réglages de la source et de la carte</summary>
  <form id="f-direct" style="margin-top:12px"><div class="form-grid">
    <label class="f full">Source des positions<select name="mode">${[["off", "Désactivé"], ["relais", "Relais de ce projet (serveur à vous)"], ["traccar", "Serveur Traccar existant"], ["demo", "Démonstration (camions fictifs)"]].map(([k, l]) => `<option value="${k}" ${k === c.mode ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="f full">Adresse du serveur (https://…)<input name="url" value="${esc(c.url)}" placeholder="https://suivi.mon-entreprise.ma" autocomplete="off" inputmode="url"></label>
    <label class="f full">Jeton de lecture<input name="jeton" type="password" value="${esc(c.jeton)}" autocomplete="off" placeholder="affiché au démarrage du relais"></label>
    <label class="f">Actualisation (secondes)<input name="intervalle" type="number" min="10" max="300" value="${esc(c.intervalle)}"></label>
    <label class="f">Vitesse maximale (km/h)<input name="vitesseMax" type="number" min="60" max="130" value="${esc(c.vitesseMax)}"></label>
    <label class="f full">Alertes sur le téléphone du bureau (ntfy, gratuit) — adresse du sujet<input name="ntfy" value="${esc(c.ntfy || "")}" placeholder="https://ntfy.sh/mon-sujet-secret-long" autocomplete="off" inputmode="url"></label>
    <label class="check full"><input type="checkbox" name="tuiles" ${c.tuiles ? "checked" : ""}><span>Afficher le fond de carte (nécessite internet ; sans lui, seuls les camions, trajets et zones s'affichent)</span></label>
    <label class="f full">Fournisseur de fond de carte (facultatif — vide = OpenStreetMap)<input name="tuilesUrl" value="${esc(c.tuilesUrl || "")}" placeholder="https://…/{z}/{x}/{y}.png" autocomplete="off" inputmode="url"></label></div>
    <div class="row" style="justify-content:flex-end;margin-top:8px">${btn("tester", "Tester la connexion", { cls: "btn ghost" })}${btn("tester-alertes", "Tester les canaux d'alerte", { cls: "btn ghost", titre: "Envoie un message d'essai sur ntfy, Telegram, WhatsApp… configurés sur le relais" })}<button class="btn">Enregistrer</button></div></form>
  <p class="hint">Carte <strong>gratuite</strong> : bibliothèque Leaflet embarquée, fond OpenStreetMap. Le serveur public d'OpenStreetMap est <strong>réservé à un usage léger</strong> (quelques personnes qui consultent la carte) : les tuiles vues sont gardées sur l'appareil pour limiter les requêtes. Pour un usage intensif, indiquez le modèle d'adresse d'un autre fournisseur (offre gratuite avec clé, ou serveur de tuiles à vous), au format <code>https://…/{z}/{x}/{y}.png</code>. Le jeton et l'adresse restent sur cet appareil et ne sont jamais inclus dans une sauvegarde. Voir <code>serveur/README.md</code> (relais ou Traccar) ; une page <strong>https</strong> exige un serveur en <strong>https</strong>.</p></details>`;

VUES.direct = {
  titre: "Carte de la flotte",
  sous: "Carte de la flotte, fiche complète de chaque camion, alertes",
  actions: () => "",
  rendu() {
    const c = directCfg(), flotte = flotteAffichee(), attente = !flotte.length || flotte[0].attente;
    return `<div id="direct-entete">${attente ? directEnteteAttente(flotte) : directEntete(flotte)}</div>
      <div id="direct-zone" class="direct-zone ${directSelection ? "avec-panneau" : ""}"><div id="direct-map" class="direct-map"></div><aside id="direct-panneau" class="direct-panneau" ${directSelection ? "" : "hidden"}></aside></div>
      <div id="direct-liste">${attente ? directListeAttente(flotte) : directListe(flotte)}</div>${cfgFormulaire(c)}`;
  },
  apres() {
    directCarteInit(); directMettreAJour();
    if (directCfg().mode !== "off") directRafraichir();
  },
  async soumettre(fid, v) {
    if (fid !== "f-direct") return false;
    const c = { mode: v.mode, url: baseUrl(v.url), jeton: v.jeton, intervalle: Math.max(10, Math.min(300, Number(v.intervalle) || 20)), vitesseMax: Number(v.vitesseMax) || 90, tuiles: !!v.tuiles, tuilesUrl: tuilesUrlValide(v.tuilesUrl) ? v.tuilesUrl.trim() : "", ntfy: /^https:\/\//.test(v.ntfy || "") ? v.ntfy.trim() : "" };
    if (v.tuilesUrl && !c.tuilesUrl) { toast("Modèle de fond de carte invalide : il doit commencer par https:// et contenir {z}, {x} et {y}.", "danger"); return true; }
    if (c.mode === "relais" || c.mode === "traccar") { if (!/^https?:\/\//.test(c.url)) { toast("Adresse du serveur invalide (https://…).", "danger"); return true; } if (location.protocol === "https:" && /^http:\/\/(?!localhost|127\.0\.0\.1)/.test(c.url)) { toast("Une page https ne peut pas appeler un serveur http : utilisez une adresse https.", "danger"); return true; } }
    directSauverCfg(c); directDonnees.hist.clear(); directDonnees.derniere.clear(); directDonnees.maj = null; directDonnees.erreur = ""; carte.cadre = false;
    directDemarrer(); toast("Réglages enregistrés"); afficher("direct"); return true;
  },
  async agir(act, id, bouton) {
    if (act === "demo") { directSauverCfg({ ...directCfg(), mode: "demo" }); directDemarrer(); return afficher("direct"); }
    if (act === "actualiser") { await directRafraichir(); return; }
    if (act === "fermer-fiche") { directSelection = ""; return directMettreAJour(); }
    if (act === "connecter") { const d = document.querySelector("details:has(#f-direct)"); if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); d.querySelector("[name=mode]")?.focus(); } return; }
    if (act === "balise-saisir") {
      const cam = parId(S.camions, id); if (!cam) return;
      const f = await formulaire(`Balise GPS de ${cam.immat}`, [{ name: "balise", label: "Identifiant de la balise (IMEI ou nom dans la plateforme GPS)", value: cam.balise, required: true, placeholder: "ex. 865432100123456" }], { valider: "Enregistrer", aide: "C'est l'identifiant sous lequel la balise envoie ses positions : il relie chaque position au bon camion." });
      if (f?.balise) { cam.balise = f.balise.trim(); sauver(); toast(`Balise enregistrée pour ${cam.immat}`); directMettreAJour(); }
      return;
    }
    if (act === "centrer") { const f = flotteAffichee().find((x) => x.id === directSelection && x.derniere); if (f && carte.map) directCentrer(f, Math.max(carte.map.getZoom(), 12)); return; }
    if (act === "trace-complete") { const f = flotteAffichee().find((x) => x.id === directSelection); if (f && carte.map && f.hist.length > 1) { const el = $("#direct-panneau"), w = el && !el.hidden && getComputedStyle(el).position === "absolute" ? el.offsetWidth : 0; carte.map.fitBounds(L.latLngBounds(f.hist.map((q) => [q[1], q[2]])), { paddingTopLeft: [30, 30], paddingBottomRight: [w + 30, 30] }); carte.cadre = true; } return; }
    if (act === "fiche-voyage") { voyagesOuverts.add(id); return afficher("voyages"); }
    if (act === "fiche-partager") return ouvrirPartage(id);
    if (act === "fiche-camion") return afficher("camions");
    if (act === "fiche-chauffeur") return afficher("chauffeurs");
    if (act === "lier-balise") {
      const f = await formulaire(`Lier la balise ${id}`, [{ name: "camionId", label: "Camion", type: "select", options: optsCamions("— Choisir —"), required: true }], { valider: "Lier", aide: "L'identifiant de la balise est enregistré sur la fiche du camion." });
      if (f?.camionId) { parId(S.camions, f.camionId).balise = id; sauver(); toast("Balise liée"); directMettreAJour(); }
    }
    if (act === "tester-alertes") {
      const c = directCfg(); if (c.mode !== "relais" || !baseUrl(c.url) || !c.jeton) return toast("Réglez d'abord la source « Relais » (adresse et jeton).", "warn");
      try { const r = await (await fetch(`${baseUrl(c.url)}/api/alertes/test`, { method: "POST", headers: { Authorization: `Bearer ${c.jeton}` } })).json();
        if (r.note) return toast(r.note, "warn");
        toast(`Essai : ${r.envoyes.length ? "reçu sur " + r.envoyes.join(", ") : "aucun canal n'a répondu"}${r.erreurs.length ? " — ÉCHEC : " + r.erreurs.join(" ; ") : ""}`, r.erreurs.length || !r.envoyes.length ? "danger" : "ok"); }
      catch { toast("Serveur injoignable.", "danger"); }
    }
    if (act === "tester") {
      const v = lireForm($("#f-direct")), c = { ...directCfg(), mode: v.mode, url: baseUrl(v.url), jeton: v.jeton };
      if (c.mode === "demo") return toast("La démonstration n'a pas besoin de serveur.");
      if (c.mode === "off" || !c.url) return toast("Choisissez une source et saisissez l'adresse.", "warn");
      if (bouton) bouton.disabled = true;
      try {
        if (c.mode === "relais") { const e = await directFetch(`${c.url}/api/etat`, c.jeton, 8000); toast(`Relais joignable : ${e.appareils} balise(s), ${e.positions} position(s)`); }
        else { const d = await directFetch(`${c.url}/api/devices`, c.jeton, 8000); toast(`Traccar joignable : ${d.length} appareil(s)`); }
      } catch (e) { toast(e.message, "danger"); }
      if (bouton) bouton.disabled = false;
    }
  },
};
document.addEventListener("click", (e) => {
  if (ongletActif !== "direct") return;
  const g = e.target.closest(".direct-camion[data-direct-camion]"); if (!g || e.target.closest("[data-act], a")) return;
  directSelectionner(g.dataset.directCamion, { centrer: true });
});
document.addEventListener("keydown", (e) => {
  if (ongletActif !== "direct" || (e.key !== "Enter" && e.key !== " ")) return;
  const g = e.target.closest?.(".direct-camion[data-direct-camion]"); if (g) { e.preventDefault(); directSelectionner(g.dataset.directCamion, { centrer: true }); }
  if (e.key === "Escape") directSelection = "";
});
directDemarrer();
