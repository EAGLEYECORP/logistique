#!/usr/bin/env node
"use strict";
/* ============================================================
   Relais de positions — Logistique Fret (phase 3, suivi en direct)
   Reçoit les positions de vos balises (directement ou via Traccar), les garde et les sert à l'application.
   Aucune dépendance : Node 18 ou plus.   Démarrer :  JETON_ECRITURE=… JETON_LECTURE=… node serveur/relais.js
   ============================================================ */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { charger } = require("./moteur.js");
const { page } = require("./page-client.js");

const VERSION = "1.1.0";
const NOEUD_KMH = 1.852;

/** Normalise une position reçue sous des formes variées. Renvoie null si inutilisable. */
function normaliser(brut, { unite = "kmh", maintenant = Date.now() / 1000 } = {}) {
  if (!brut || typeof brut !== "object") return null;
  const id = String(brut.id ?? brut.deviceId ?? brut.device_id ?? brut.imei ?? brut.unique_id ?? "").trim();
  const lat = Number(brut.lat ?? brut.latitude), lon = Number(brut.lon ?? brut.lng ?? brut.longitude);
  let t = brut.t ?? brut.timestamp ?? brut.time ?? brut.fixTime ?? brut.date;
  if (typeof t === "string" && /^\d+(\.\d+)?$/.test(t.trim())) t = Number(t);
  if (typeof t === "number") t = t > 1e11 ? t / 1000 : t; else if (typeof t === "string") t = Date.parse(t) / 1000; else t = maintenant;
  let v = brut.v ?? brut.vitesse ?? brut.speed;
  v = v === undefined || v === null || v === "" ? null : Number(v);
  if (v !== null && Number.isFinite(v)) { if (brut.vitesse === undefined && brut.v === undefined) v = unite === "noeuds" ? v * NOEUD_KMH : unite === "ms" ? v * 3.6 : v; } else v = null;
  const cap = Number(brut.cap ?? brut.course ?? brut.heading ?? brut.bearing);
  const tp = brut.temp ?? brut.temperature ?? brut.temp1 ?? brut.attributes?.temp1 ?? brut.attributes?.temperature;
  const temp = tp === undefined || tp === null || tp === "" || !Number.isFinite(Number(tp)) || Math.abs(Number(tp)) > 100 ? null : Math.round(Number(tp) * 10) / 10;
  if (!id || id.length > 64 || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0) || !Number.isFinite(t)) return null;
  if (t > maintenant + 600 || t < maintenant - 7 * 86400) return null; // horloge folle ou position trop ancienne
  return { id, t: Math.floor(t), lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, v: v === null ? null : Math.round(v * 10) / 10, cap: Number.isFinite(cap) ? Math.round(cap) : null, ...(temp !== null ? { temp } : {}) };
}

function creer({ jetonEcriture, jetonLecture, dossier = null, retentionJours = 30, maxParAppareil = 6000, origine = "*", limiteParMinute = 900, racine = path.join(__dirname, "..") } = {}) {
  if (!jetonEcriture || !jetonLecture) throw new Error("JETON_ECRITURE et JETON_LECTURE sont obligatoires.");
  const historique = new Map(); // id -> [positions triées]
  const noms = new Map();
  const compteurs = new Map();
  const egal = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  let total = 0;
  const moteur = charger(racine);
  const partages = new Map();
  const fichierPartages = () => path.join(dossier, "partages.json");
  const sauverPartages = () => { if (dossier) { try { fs.writeFileSync(fichierPartages(), JSON.stringify([...partages.values()]), { mode: 0o600 }); } catch { /* ignoré */ } } };

  const fichierDuJour = (t) => path.join(dossier, `positions-${new Date(t * 1000).toISOString().slice(0, 10)}.jsonl`);
  function ajouter(p, nom) {
    const liste = historique.get(p.id) || [];
    if (liste.some((x) => x.t === p.t)) return false;
    liste.push(p); liste.sort((a, b) => a.t - b.t);
    if (liste.length > maxParAppareil) liste.splice(0, liste.length - maxParAppareil);
    historique.set(p.id, liste);
    if (nom) noms.set(p.id, String(nom).slice(0, 80));
    total++;
    return true;
  }
  if (dossier) {
    fs.mkdirSync(dossier, { recursive: true });
    const limite = Date.now() / 1000 - retentionJours * 86400;
    for (const f of fs.readdirSync(dossier).filter((x) => /^positions-\d{4}-\d{2}-\d{2}\.jsonl$/.test(x)).sort()) {
      const date = Date.parse(f.slice(10, 20)) / 1000;
      if (date < limite - 86400) { try { fs.unlinkSync(path.join(dossier, f)); } catch { /* ignoré */ } continue; }
      for (const l of fs.readFileSync(path.join(dossier, f), "utf8").split("\n")) { if (!l) continue; try { const p = JSON.parse(l); if (p.id && Number.isFinite(p.t)) ajouter(p); } catch { /* ligne abîmée */ } }
    }
  }
  if (dossier) { try { for (const p of JSON.parse(fs.readFileSync(fichierPartages(), "utf8"))) partages.set(p.id, p); } catch { /* aucun partage */ } }
  const enregistrer = (positions, noms_ = []) => {
    let n = 0;
    positions.forEach((p, i) => { if (ajouter(p, noms_[i])) { n++; if (dossier) { try { fs.appendFileSync(fichierDuJour(p.t), JSON.stringify(p) + "\n"); } catch { /* disque plein : on garde en mémoire */ } } } });
    return n;
  };

  const entetes = (extra = {}) => ({ "Access-Control-Allow-Origin": origine, "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra });
  const json = (res, code, obj) => { res.writeHead(code, entetes({ "Content-Type": "application/json; charset=utf-8" })); res.end(JSON.stringify(obj)); };
  const jetonDe = (req, url) => { const h = req.headers.authorization || ""; return h.startsWith("Bearer ") ? h.slice(7).trim() : url.searchParams.get("token") || url.searchParams.get("key") || ""; };
  const corps = (req) => new Promise((ok, ko) => { let n = 0; const b = []; req.on("data", (c) => { n += c.length; if (n > 262144) { ko(new Error("trop gros")); req.destroy(); } else b.push(c); }); req.on("end", () => ok(Buffer.concat(b).toString("utf8"))); req.on("error", ko); });

  const nombre = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const textes = (v, max = 120) => String(v ?? "").slice(0, max).trim();
  /** Champs d'un partage acceptés depuis l'application (tout le reste est ignoré). */
  function lirePartage(b, base = {}) {
    const o = { ...base };
    if (b.balise !== undefined) o.balise = textes(b.balise, 64);
    for (const k of ["reference", "origine", "destination"]) if (b[k] !== undefined) o[k] = textes(b[k]);
    for (const k of ["destLat", "destLon", "origLat", "origLon"]) if (b[k] !== undefined) o[k] = nombre(b[k]);
    if (b.livraisonPrevue !== undefined) o.livraisonPrevue = Number.isFinite(Date.parse(b.livraisonPrevue)) ? new Date(b.livraisonPrevue).toISOString() : "";
    if (b.precision !== undefined) o.precision = ["approx", "exacte", "masquee"].includes(b.precision) ? b.precision : "approx";
    if (b.langue !== undefined) o.langue = ["fr", "en", "es", "ar"].includes(b.langue) ? b.langue : "fr";
    if (b.message !== undefined) o.message = textes(b.message, 400);
    if (b.statut !== undefined) { o.statut = b.statut === "livre" ? "livre" : "actif"; if (o.statut === "livre" && !o.livreLe) o.livreLe = Math.floor(Date.now() / 1000); if (o.statut === "actif") delete o.livreLe; }
    if (Array.isArray(b.etapes)) o.etapes = b.etapes.slice(0, 20).map((e) => ({ libelle: textes(e.libelle, 80), date: Number.isFinite(Date.parse(e.date)) ? new Date(e.date).toISOString() : "" })).filter((e) => e.libelle);
    if (Array.isArray(b.zones)) o.zones = b.zones.slice(0, 40).map((z) => ({ id: textes(z.id, 40), nom: textes(z.nom, 80), type: textes(z.type, 20), lat: nombre(z.lat), lon: nombre(z.lon), rayon: nombre(z.rayon) })).filter((z) => z.lat !== null && z.lon !== null && z.rayon);
    if (b.jours !== undefined || !o.expire) o.expire = Math.floor(Date.now() / 1000) + Math.max(1, Math.min(120, Number(b.jours) || 14)) * 86400;
    return o;
  }
  /** Ce que voit le client : état, ETA, position (selon la précision choisie), étapes. Aucune donnée interne. */
  function donneesPartage(p, maintenant = Math.floor(Date.now() / 1000)) {
    const h = (historique.get(p.balise) || []).filter((x) => x.t > maintenant - 12 * 3600).map((x) => [x.t, x.lat, x.lon, x.v]);
    const dest = p.destLat !== null && p.destLat !== undefined && p.destLon !== null && p.destLon !== undefined ? [p.destLat, p.destLon] : null;
    const orig = p.origLat !== null && p.origLat !== undefined && p.origLon !== null && p.origLon !== undefined ? [p.origLat, p.origLon] : null;
    const zones = p.zones || [];
    const out = { reference: p.reference, origine: p.origine, destination: p.destination, statut: p.statut, livreLe: p.livreLe || null, etat: "en_attente", maj: null, eta: null, retardMin: null, progression: null, position: null, orig, dest, etapes: p.etapes || [], message: p.message || "" };
    if (p.statut === "livre" || !h.length) return out;
    const last = h[h.length - 1];
    out.maj = last[0];
    if (moteur.disponible) {
      out.etat = moteur.appeler("directEtat", h, maintenant, zones).code;
      if (dest) { const e = moteur.appeler("etaVoyage", h, maintenant, dest, { zones }); if (e) { out.eta = { arrivee: e.arrivee, min: e.min, max: e.max }; out.retardMin = p.livraisonPrevue ? moteur.appeler("etaRetardMin", e, p.livraisonPrevue) : null; } }
    } else out.etat = maintenant - last[0] > 1800 ? "hors_ligne" : (last[3] ?? 0) >= 5 ? "en_route" : "arret";
    if (orig && dest) { const dist = (a, b) => { const r = Math.PI / 180, x = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); }; const d1 = dist(orig, [last[1], last[2]]), d2 = dist([last[1], last[2]], dest); out.progression = d1 + d2 > 0 ? Math.max(0, Math.min(100, Math.round((100 * d1) / (d1 + d2)))) : null; }
    const dec = p.precision === "exacte" ? 1e4 : 10;
    if (p.precision !== "masquee") out.position = [Math.round(last[1] * dec) / dec, Math.round(last[2] * dec) / dec];
    return out;
  }
  const ENTETES_PUBLICS = { "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:" };

  const serveur = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim(), minute = Math.floor(Date.now() / 60000), k = `${ip}|${minute}`;
      compteurs.set(k, (compteurs.get(k) || 0) + 1); if (compteurs.size > 5000) for (const x of compteurs.keys()) if (!x.endsWith(`|${minute}`)) compteurs.delete(x);
      if (compteurs.get(k) > limiteParMinute) return json(res, 429, { erreur: "Trop de requêtes." });
      if (req.method === "OPTIONS") { res.writeHead(204, entetes()); return res.end(); }
      const p = url.pathname.replace(/\/+$/, "") || "/";
      if (p === "/sante") return json(res, 200, { ok: true, version: VERSION });

      // --- lien de suivi public (identifiant secret dans l'adresse) ---
      const m = p.match(/^\/suivi\/([A-Za-z0-9_-]{16,64})(\/donnees)?$/);
      if (m && req.method === "GET") {
        const part = partages.get(m[1]), maintenant = Math.floor(Date.now() / 1000);
        if (!part) { res.writeHead(404, entetes({ "Content-Type": "text/plain; charset=utf-8", ...ENTETES_PUBLICS })); return res.end("Lien de suivi introuvable."); }
        if (part.expire < maintenant) { res.writeHead(410, entetes({ "Content-Type": "text/plain; charset=utf-8", ...ENTETES_PUBLICS })); return res.end("Ce lien de suivi a expiré."); }
        if (m[2]) { res.writeHead(200, entetes({ "Content-Type": "application/json; charset=utf-8", ...ENTETES_PUBLICS })); return res.end(JSON.stringify(donneesPartage(part, maintenant))); }
        const lang = url.searchParams.get("lang") || part.langue || "fr";
        res.writeHead(200, entetes({ "Content-Type": "text/html; charset=utf-8", ...ENTETES_PUBLICS })); return res.end(page(lang));
      }

      const jeton = jetonDe(req, url);
      const peutEcrire = egal(jeton, jetonEcriture), peutLire = peutEcrire ? false : egal(jeton, jetonLecture);

      // --- réception ---
      if ((p === "/api/positions" && req.method === "POST") || (p === "/traccar" && req.method === "POST") || (p === "/osmand" && (req.method === "GET" || req.method === "POST"))) {
        if (!peutEcrire) return json(res, 401, { erreur: "Jeton d'écriture invalide." });
        const unite = url.searchParams.get("unite") || "kmh";
        let positions = [], nomsP = [], recues = 0;
        if (p === "/osmand") { const q = Object.fromEntries(url.searchParams); if (req.method === "POST") { const t = await corps(req); try { Object.assign(q, JSON.parse(t)); } catch { Object.assign(q, Object.fromEntries(new URLSearchParams(t))); } } recues = 1; const x = normaliser(q, { unite }); if (x) positions.push(x); }
        else {
          let data; try { data = JSON.parse(await corps(req)); } catch { return json(res, 400, { erreur: "JSON invalide." }); }
          if (p === "/traccar") { // renvoi d'événements de Traccar : { position, device }
            const pos = data.position || data; const dev = data.device || {};
            recues = 1; const x = normaliser({ id: dev.uniqueId || pos.deviceId, t: pos.fixTime || pos.deviceTime, lat: pos.latitude, lon: pos.longitude, speed: pos.speed, course: pos.course, attributes: pos.attributes }, { unite: "noeuds" });
            if (x) { positions.push(x); nomsP.push(dev.name); }
          } else { const liste = Array.isArray(data) ? data : Array.isArray(data.positions) ? data.positions : [data]; if (liste.length > 2000) return json(res, 413, { erreur: "2000 positions au plus par envoi." }); recues = liste.length; for (const b of liste) { const x = normaliser(b, { unite }); if (x) positions.push(x); } }
        }
        const acceptees = enregistrer(positions, nomsP);
        return json(res, 200, { ok: true, recues, valides: positions.length, ajoutees: acceptees });
      }

      // --- lecture ---
      if (p.startsWith("/api/")) {
        if (!peutLire && !peutEcrire) return json(res, 401, { erreur: "Jeton de lecture invalide." });
        if (p === "/api/derniere") return json(res, 200, [...historique.entries()].map(([id, l]) => ({ ...l[l.length - 1], nom: noms.get(id) || "" })));
        if (p === "/api/trace") {
          const id = url.searchParams.get("id") || ""; const depuis = Number(url.searchParams.get("depuis") || 0), jusqua = Number(url.searchParams.get("jusqua") || 4e9), max = Math.min(Number(url.searchParams.get("max") || 3000), 6000);
          const l = (historique.get(id) || []).filter((x) => x.t > depuis && x.t <= jusqua);
          return json(res, 200, l.slice(-max));
        }
        const mp = p.match(/^\/api\/partages(?:\/([A-Za-z0-9_-]{16,64}))?$/);
        if (mp) {
          if (!peutLire) return json(res, 401, { erreur: "Jeton de lecture requis." });
          const id = mp[1];
          if (!id && req.method === "GET") return json(res, 200, [...partages.values()].map((x) => ({ id: x.id, reference: x.reference, balise: x.balise, destination: x.destination, expire: x.expire, statut: x.statut, creeLe: x.creeLe })));
          if (!id && req.method === "POST") {
            if (partages.size >= 500) return json(res, 429, { erreur: "Trop de liens actifs : supprimez les anciens." });
            let b; try { b = JSON.parse(await corps(req)); } catch { return json(res, 400, { erreur: "JSON invalide." }); }
            const o = lirePartage(b, { id: crypto.randomBytes(18).toString("base64url"), precision: "approx", langue: "fr", statut: "actif", etapes: [], zones: [], creeLe: Math.floor(Date.now() / 1000) });
            if (!o.balise || !o.reference) return json(res, 400, { erreur: "balise et reference sont obligatoires." });
            partages.set(o.id, o); sauverPartages(); return json(res, 201, { id: o.id, chemin: `/suivi/${o.id}`, expire: o.expire });
          }
          const part = id && partages.get(id);
          if (id && !part) return json(res, 404, { erreur: "Lien introuvable." });
          if (id && req.method === "PUT") { let b; try { b = JSON.parse(await corps(req)); } catch { return json(res, 400, { erreur: "JSON invalide." }); } partages.set(id, lirePartage(b, part)); sauverPartages(); return json(res, 200, { ok: true }); }
          if (id && req.method === "DELETE") { partages.delete(id); sauverPartages(); return json(res, 200, { ok: true }); }
          if (id && req.method === "GET") return json(res, 200, donneesPartage(part));
        }
        if (p === "/api/etat") return json(res, 200, { version: VERSION, appareils: historique.size, positions: total, retentionJours, partages: partages.size, moteur: moteur.disponible, maintenant: Math.floor(Date.now() / 1000) });
      }
      return json(res, 404, { erreur: "Introuvable." });
    } catch (e) { return json(res, 500, { erreur: "Erreur du serveur." }); }
  });
  return { serveur, historique, enregistrer, partages, donneesPartage };
}

module.exports = { creer, normaliser, VERSION };

if (require.main === module) {
  const e = process.env;
  const aleatoire = () => crypto.randomBytes(18).toString("base64url");
  const dossier = e.DONNEES ? path.resolve(e.DONNEES) : path.join(__dirname, "donnees");
  let jetons = { jetonEcriture: e.JETON_ECRITURE, jetonLecture: e.JETON_LECTURE };
  if (!jetons.jetonEcriture || !jetons.jetonLecture) { // première exécution : les jetons sont générés et conservés
    fs.mkdirSync(dossier, { recursive: true }); const f = path.join(dossier, "jetons.json");
    let c = {}; try { c = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* absent */ }
    jetons = { jetonEcriture: jetons.jetonEcriture || c.jetonEcriture || aleatoire(), jetonLecture: jetons.jetonLecture || c.jetonLecture || aleatoire() };
    fs.writeFileSync(f, JSON.stringify(jetons, null, 2), { mode: 0o600 });
    console.log(`Jetons enregistrés dans ${f}`);
  }
  const { serveur } = creer({ ...jetons, dossier, retentionJours: Number(e.RETENTION_JOURS || 30), origine: e.ORIGINE || "*" });
  const port = Number(e.PORT || 8787);
  serveur.listen(port, e.HOTE || "0.0.0.0", () => {
    console.log(`Relais de positions ${VERSION} sur le port ${port}`);
    console.log(`  Jeton d'écriture (balises, Traccar) : ${jetons.jetonEcriture}`);
    console.log(`  Jeton de lecture (application)      : ${jetons.jetonLecture}`);
    console.log(`  Réception : POST /api/positions · GET /osmand · POST /traccar    Lecture : /api/derniere · /api/trace`);
  });
}
