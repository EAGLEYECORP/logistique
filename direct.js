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
const DIRECT_DEFAUT = { mode: "off", url: "", jeton: "", intervalle: 20, vitesseMax: 90, tuiles: true, ntfy: "" };
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
  if (ongletActif === "direct") { const z = $("#direct-live"); if (z) { z.innerHTML = directLive(); majSelectionCarte(); } }
}
function directDemarrer() {
  clearInterval(directMinuteur); directMinuteur = null;
  const c = directCfg(); if (c.mode === "off") return;
  directRafraichir();
  directMinuteur = setInterval(() => { if (document.visibilityState === "visible") directRafraichir(); }, Math.max(10, Number(c.intervalle) || 20) * 1000);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && directCfg().mode !== "off") directRafraichir(); });

/* ---------- rendu ---------- */
const COULEUR_ETAT = { ok: "#16a34a", warn: "#d97706", danger: "#dc2626", neutral: "#64748b" };
const ilYa = (s) => (s < 90 ? `${Math.max(0, Math.round(s))} s` : s < 5400 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} j`);

function directCarte(flotte) {
  if (!flotte.length) return "";
  const c = directCfg(), L = 800, H = 440, now = maintenantS();
  const pts = flotte.flatMap((f) => [[f.derniere[1], f.derniere[2]], ...f.hist.filter((p) => now - p[0] < 3 * 3600).filter((_, i) => i % 8 === 0).map((p) => [p[1], p[2]])]);
  const vue = directVue(pts, { largeur: L, hauteur: H, marge: 60, zMax: 13 });
  const P = (lat, lon) => vue.vers(lat, lon).map((x) => x.toFixed(1));
  const tuiles = c.tuiles && navigator.onLine !== false ? vue.tuiles.map((t) => `<image href="https://tile.openstreetmap.org/${vue.z}/${t.x}/${t.y}.png" x="${t.px.toFixed(1)}" y="${t.py.toFixed(1)}" width="256" height="256" opacity=".9" onerror="this.remove()"/>`).join("") : "";
  const zones = zonesActives().map((z) => { const [x, y] = vue.vers(z.lat, z.lon); const r = z.rayon / (156543.03 * Math.cos(gpsRad(z.lat)) / 2 ** vue.z); return x > -50 && x < L + 50 && y > -50 && y < H + 50 ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${Math.max(4, r).toFixed(1)}" fill="#2563eb" fill-opacity=".12" stroke="#2563eb" stroke-opacity=".5"/>` : ""; }).join("");
  const traces = flotte.map((f) => { const l = f.hist.filter((p) => now - p[0] < 3 * 3600); return l.length > 1 ? `<path d="${l.map((p, i) => `${i ? "L" : "M"}${P(p[1], p[2]).join(" ")}`).join("")}" fill="none" stroke="${COULEUR_ETAT[f.etat.niveau]}" stroke-width="2.4" stroke-opacity=".75" stroke-linejoin="round"/>` : ""; }).join("");
  const camions = flotte.map((f) => { const [x, y] = P(f.derniere[1], f.derniere[2]); const sel = f.id === directSelection;
    return `<g data-direct-camion="${esc(f.id)}" style="cursor:pointer"><circle cx="${x}" cy="${y}" r="${sel ? 13 : 9}" fill="${COULEUR_ETAT[f.etat.niveau]}" stroke="#fff" stroke-width="2.5"/>
      <text x="${(+x + 14).toFixed(1)}" y="${(+y + 4).toFixed(1)}" font-size="13" font-weight="700" fill="#111" stroke="#fff" stroke-width="3.5" paint-order="stroke">${esc(f.nom)}</text></g>`; }).join("");
  return `<svg viewBox="0 0 ${L} ${H}" class="direct-carte" role="img" aria-label="Carte de la flotte"><rect width="${L}" height="${H}" fill="var(--surface-2, #eef2f7)"/>${tuiles}${zones}${traces}${camions}
    ${tuiles ? `<text x="${L - 6}" y="${H - 6}" text-anchor="end" font-size="10" fill="#333" stroke="#fff" stroke-width="3" paint-order="stroke">© OpenStreetMap</text>` : ""}</svg>`;
}
function directLive() {
  const c = directCfg(), D = directDonnees, flotte = directFlotte(), now = maintenantS();
  const compte = (...codes) => flotte.filter((f) => codes.includes(f.etat.code)).length;
  const alertes = flotte.flatMap((f) => f.alertes);
  const statut = D.erreur ? badge(D.erreur, "danger") : D.maj ? badge(`Mis à jour il y a ${ilYa(now - D.maj)}`, "ok") : badge("Connexion…", "neutral");
  return `<div class="row" style="justify-content:space-between;margin-bottom:12px"><div>${statut} <span class="sub" style="display:inline">${c.mode === "demo" ? "Démonstration (camions fictifs)" : c.mode === "traccar" ? "Source : Traccar" : "Source : relais"}</span></div>${btn("actualiser", "Actualiser", { icone: "clock", cls: "btn ghost sm" })}</div>
    <div class="kpis">
      <div class="kpi"><div class="l">${ic("truck")} Camions suivis</div><div class="v">${flotte.length}</div></div>
      <div class="kpi"><div class="l">En route</div><div class="v">${compte("en_route")}</div><div class="s">${compte("traversee")} en traversée · ${compte("au_port", "en_douane")} au port</div></div>
      <div class="kpi"><div class="l">À l'arrêt</div><div class="v">${compte("arret", "arret_long", "depot", "client")}</div></div>
      <div class="kpi"><div class="l">${ic("alert")} Alertes</div><div class="v">${alertes.length}</div><div class="s ${alertes.some((a) => a.niveau === "danger") ? "danger" : alertes.length ? "warn" : ""}">${compte("hors_ligne") ? `${compte("hors_ligne")} signal perdu` : alertes.length ? "à traiter" : "rien à signaler"}</div></div>
    </div>
    ${flotte.length ? `<div class="card" style="padding:0;overflow:hidden">${directCarte(flotte)}</div>` : `<div class="card">${vide("pin", D.maj ? "Aucune position reçue" : "En attente de positions", D.maj ? "Le serveur répond mais n'a encore reçu aucune position. Vérifiez que vos balises ou Traccar envoient bien vers le relais." : "Les camions apparaîtront ici dès la première réponse du serveur.")}</div>`}
    ${flotte.some((f) => f.alertes.length) ? `<div class="section-title">Alertes</div><div class="card"><ul class="ctl">${flotte.flatMap((f) => f.alertes.map((a) => { const msg = `${a.texte} — merci de confirmer.`, wa = f.chauffeur ? lienWhatsApp(f.chauffeur.tel, msg) : "", sms = f.chauffeur ? lienSMS(f.chauffeur.tel, msg) : ""; return `<li class="${a.niveau}">${ic(a.niveau === "danger" ? "alert" : "clock")}<span>${esc(a.texte)}${wa ? ` <a class="btn ghost sm" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp ${esc(f.chauffeur.nom.split(" ")[0])}</a> <a class="btn ghost sm" href="${esc(sms)}">SMS</a>` : ""}</span></li>`; })).join("")}</ul></div>` : ""}
    <div class="section-title">Camions</div>
    ${flotte.map((f) => `<div class="card direct-camion ${f.id === directSelection ? "sel" : ""}" data-direct-camion="${esc(f.id)}">
      <div class="card-head"><h2>${esc(f.nom)}${f.camion ? "" : ` <span class="sub" style="display:inline">· balise ${esc(f.id)}</span>`}</h2>${badge(f.etat.libelle, f.etat.niveau)}</div>
      <p class="hint" style="margin:0 0 8px">${[f.derniere[3] != null ? `${Math.round(f.derniere[3])} km/h` : "", `dernière position il y a ${ilYa(now - f.derniere[0])}`, f.etat.zone && esc(f.etat.zone.nom), f.etat.code === "traversee" ? "silence normal en mer : le signal reviendra à l'arrivée" : "", f.etat.code === "arret" || f.etat.code === "arret_long" ? `arrêt de ${f.etat.arretMin} min` : "", f.voyage && `voyage ${esc(f.voyage.ref)} · ${esc(f.voyage.origine)} ⇄ ${esc(f.voyage.destination)}`].filter(Boolean).join(" · ")}</p>
      ${f.derniere[4] != null ? `<p class="hint" style="margin:0 0 8px">${badge(`${String(f.derniere[4]).replace(".", ",")} °C`, f.alertes.some((a) => a.cle.startsWith("froid:")) ? "danger" : "ok")}${f.voyage && Number.isFinite(f.voyage.tempMin) ? ` consigne ${f.voyage.tempMin} à ${f.voyage.tempMax} °C` : ""}</p>` : ""}
      ${f.eta ? `<p class="hint" style="margin:0 0 8px"><strong>Arrivée estimée ${new Date(f.eta.arrivee * 1000).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</strong> (${new Date(f.eta.min * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} – ${new Date(f.eta.max * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}) · ${fmt(f.eta.kmRestants)} km restants${f.eta.retardMin !== null && f.eta.retardMin > 30 ? ` · ${badge("retard probable", f.eta.retardMin > 60 ? "danger" : "warn")}` : ""}</p>` : ""}
      <div class="row">${badge(`Conduite : ${dureeTxt(f.conduite.serieH)} sans pause de 45 min`, f.conduite.serieH >= 4.5 ? "danger" : f.conduite.serieH >= 4.25 ? "warn" : "neutral")}
        ${f.camion ? "" : btn("lier-balise", "Lier à un camion", { id: f.id, icone: "truck", cls: "btn ghost sm" })}</div></div>`).join("")}`;
}
function majSelectionCarte() { /* la sélection ne change que le style : tout est redessiné par directLive */ }

const cfgFormulaire = (c) => `<details class="card" ${c.mode === "off" ? "open" : ""}><summary style="cursor:pointer;font-weight:600">Réglages de la source</summary>
  <form id="f-direct" style="margin-top:12px"><div class="form-grid">
    <label class="f full">Source des positions<select name="mode">${[["off", "Désactivé"], ["relais", "Relais de ce projet (serveur à vous)"], ["traccar", "Serveur Traccar existant"], ["demo", "Démonstration (camions fictifs)"]].map(([k, l]) => `<option value="${k}" ${k === c.mode ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="f full">Adresse du serveur (https://…)<input name="url" value="${esc(c.url)}" placeholder="https://suivi.mon-entreprise.ma" autocomplete="off" inputmode="url"></label>
    <label class="f full">Jeton de lecture<input name="jeton" type="password" value="${esc(c.jeton)}" autocomplete="off" placeholder="affiché au démarrage du relais"></label>
    <label class="f">Actualisation (secondes)<input name="intervalle" type="number" min="10" max="300" value="${esc(c.intervalle)}"></label>
    <label class="f">Vitesse maximale (km/h)<input name="vitesseMax" type="number" min="60" max="130" value="${esc(c.vitesseMax)}"></label>
    <label class="f full">Alertes sur le téléphone du bureau (ntfy, gratuit) — adresse du sujet<input name="ntfy" value="${esc(c.ntfy || "")}" placeholder="https://ntfy.sh/mon-sujet-secret-long" autocomplete="off" inputmode="url"></label>
    <label class="check full"><input type="checkbox" name="tuiles" ${c.tuiles ? "checked" : ""}><span>Fond de carte OpenStreetMap (nécessite internet ; sinon fond uni)</span></label></div>
    <div class="row" style="justify-content:flex-end;margin-top:8px">${btn("tester", "Tester la connexion", { cls: "btn ghost" })}${btn("tester-alertes", "Tester les canaux d'alerte", { cls: "btn ghost", titre: "Envoie un message d'essai sur ntfy, Telegram, WhatsApp… configurés sur le relais" })}<button class="btn">Enregistrer</button></div></form>
  <p class="hint">Le jeton et l'adresse restent sur cet appareil et ne sont jamais inclus dans une sauvegarde. Le suivi en direct a besoin d'un serveur : voir <code>serveur/README.md</code> (relais ou Traccar). Les pages <strong>https</strong> exigent un serveur en <strong>https</strong>.</p></details>`;

VUES.direct = {
  titre: "Suivi en direct",
  sous: "Position, état et alertes de vos camions en temps réel",
  actions: () => "",
  rendu() {
    const c = directCfg();
    if (c.mode === "off") return `<div class="card">${vide("pin", "Suivez vos camions en direct", "Positions de vos balises GPS, état de chaque camion (en route, au port, en traversée, signal perdu), conduite sans pause et alertes. Il faut un petit serveur : essayez d'abord la démonstration.", btn("demo", "Essayer la démonstration", { icone: "play" }))}</div>${cfgFormulaire(c)}`;
    return `<div id="direct-live">${directLive()}</div>${cfgFormulaire(c)}`;
  },
  apres() { if (directCfg().mode !== "off") directRafraichir(); },
  async soumettre(fid, v) {
    if (fid !== "f-direct") return false;
    const c = { mode: v.mode, url: baseUrl(v.url), jeton: v.jeton, intervalle: Math.max(10, Math.min(300, Number(v.intervalle) || 20)), vitesseMax: Number(v.vitesseMax) || 90, tuiles: !!v.tuiles, ntfy: /^https:\/\//.test(v.ntfy || "") ? v.ntfy.trim() : "" };
    if (c.mode === "relais" || c.mode === "traccar") { if (!/^https?:\/\//.test(c.url)) { toast("Adresse du serveur invalide (https://…).", "danger"); return true; } if (location.protocol === "https:" && /^http:\/\/(?!localhost|127\.0\.0\.1)/.test(c.url)) { toast("Une page https ne peut pas appeler un serveur http : utilisez une adresse https.", "danger"); return true; } }
    directSauverCfg(c); directDonnees.hist.clear(); directDonnees.derniere.clear(); directDonnees.maj = null; directDonnees.erreur = "";
    directDemarrer(); toast("Réglages enregistrés"); afficher("direct"); return true;
  },
  async agir(act, id, bouton) {
    if (act === "demo") { directSauverCfg({ ...directCfg(), mode: "demo" }); directDemarrer(); return afficher("direct"); }
    if (act === "actualiser") { await directRafraichir(); return; }
    if (act === "lier-balise") {
      const f = await formulaire(`Lier la balise ${id}`, [{ name: "camionId", label: "Camion", type: "select", options: optsCamions("— Choisir —"), required: true }], { valider: "Lier", aide: "L'identifiant de la balise est enregistré sur la fiche du camion." });
      if (f?.camionId) { parId(S.camions, f.camionId).balise = id; sauver(); toast("Balise liée"); directFlotteRendu(); }
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
const directFlotteRendu = () => { const z = $("#direct-live"); if (z) z.innerHTML = directLive(); };
document.addEventListener("click", (e) => {
  if (ongletActif !== "direct") return;
  const g = e.target.closest("[data-direct-camion]"); if (!g || e.target.closest("[data-act]")) return;
  directSelection = directSelection === g.dataset.directCamion ? "" : g.dataset.directCamion; directFlotteRendu();
});
directDemarrer();
