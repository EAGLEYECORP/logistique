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

const VERSION = "1.0.0";
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
  if (!id || id.length > 64 || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0) || !Number.isFinite(t)) return null;
  if (t > maintenant + 600 || t < maintenant - 7 * 86400) return null; // horloge folle ou position trop ancienne
  return { id, t: Math.floor(t), lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, v: v === null ? null : Math.round(v * 10) / 10, cap: Number.isFinite(cap) ? Math.round(cap) : null };
}

function creer({ jetonEcriture, jetonLecture, dossier = null, retentionJours = 30, maxParAppareil = 6000, origine = "*", limiteParMinute = 900 } = {}) {
  if (!jetonEcriture || !jetonLecture) throw new Error("JETON_ECRITURE et JETON_LECTURE sont obligatoires.");
  const historique = new Map(); // id -> [positions triées]
  const noms = new Map();
  const compteurs = new Map();
  const egal = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  let total = 0;

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
  const enregistrer = (positions, noms_ = []) => {
    let n = 0;
    positions.forEach((p, i) => { if (ajouter(p, noms_[i])) { n++; if (dossier) { try { fs.appendFileSync(fichierDuJour(p.t), JSON.stringify(p) + "\n"); } catch { /* disque plein : on garde en mémoire */ } } } });
    return n;
  };

  const entetes = (extra = {}) => ({ "Access-Control-Allow-Origin": origine, "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra });
  const json = (res, code, obj) => { res.writeHead(code, entetes({ "Content-Type": "application/json; charset=utf-8" })); res.end(JSON.stringify(obj)); };
  const jetonDe = (req, url) => { const h = req.headers.authorization || ""; return h.startsWith("Bearer ") ? h.slice(7).trim() : url.searchParams.get("token") || url.searchParams.get("key") || ""; };
  const corps = (req) => new Promise((ok, ko) => { let n = 0; const b = []; req.on("data", (c) => { n += c.length; if (n > 262144) { ko(new Error("trop gros")); req.destroy(); } else b.push(c); }); req.on("end", () => ok(Buffer.concat(b).toString("utf8"))); req.on("error", ko); });

  const serveur = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim(), minute = Math.floor(Date.now() / 60000), k = `${ip}|${minute}`;
      compteurs.set(k, (compteurs.get(k) || 0) + 1); if (compteurs.size > 5000) for (const x of compteurs.keys()) if (!x.endsWith(`|${minute}`)) compteurs.delete(x);
      if (compteurs.get(k) > limiteParMinute) return json(res, 429, { erreur: "Trop de requêtes." });
      if (req.method === "OPTIONS") { res.writeHead(204, entetes()); return res.end(); }
      const p = url.pathname.replace(/\/+$/, "") || "/";
      if (p === "/sante") return json(res, 200, { ok: true, version: VERSION });

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
            recues = 1; const x = normaliser({ id: dev.uniqueId || pos.deviceId, t: pos.fixTime || pos.deviceTime, lat: pos.latitude, lon: pos.longitude, speed: pos.speed, course: pos.course }, { unite: "noeuds" });
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
        if (p === "/api/etat") return json(res, 200, { version: VERSION, appareils: historique.size, positions: total, retentionJours, maintenant: Math.floor(Date.now() / 1000) });
      }
      return json(res, 404, { erreur: "Introuvable." });
    } catch (e) { return json(res, 500, { erreur: "Erreur du serveur." }); }
  });
  return { serveur, historique, enregistrer };
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
