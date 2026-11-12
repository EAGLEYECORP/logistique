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
const { envoyerCourriel, adresseValide, motEntete } = require("./courriel.js");
const { creerCoffre, chargerCoffre, ecrireAtomique } = require("./coffre.js");
const { planPurge, appliquerPurge } = require("./purge-photos.js");
const { creerMulti } = require("./multi.js");
const { peutSuivre } = require("../comptes.js");
const { page } = require("./page-client.js");

const VERSION = "2.0.0";
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

function creer({ jetonEcriture, jetonLecture, dossier = null, retentionJours = 30, maxParAppareil = 6000, origine = "*", limiteParMinute = 900, racine = path.join(__dirname, "..") , canaux = {}, http_ = (...a) => fetch(...a), photosMaxMo = 2048, smtp = null, ntfyHotes = ["ntfy.sh"], courriel_ = envoyerCourriel, coffre = creerCoffre(null), journalAcces = false, purgePhotosMois = 0, multi = null } = {}) {
  if (!jetonEcriture || !jetonLecture) throw new Error("JETON_ECRITURE et JETON_LECTURE sont obligatoires.");
  const historique = new Map(); // id -> [positions triées]
  const noms = new Map();
  const compteurs = new Map();
  const egal = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  let total = 0;
  const moteur = charger(racine);
  const partages = new Map();
  let synchro = { version: 0, blob: "", appareil: "", t: 0 };
  const fichierSynchro = () => path.join(dossier, "synchro.json");
  if (dossier) { try { synchro = JSON.parse(coffre.lireTexte(path.join(dossier, "synchro.json"))); } catch { /* aucune synchro */ } }
  /* Photos synchronisées : un fichier chiffré par photo (le serveur ne peut pas les lire). Une suppression laisse une trace 90 jours pour les autres appareils. */
  const photos = new Map(), photosMem = new Map(); // id -> { t, taille, supprime } ; contenu en mémoire si aucun dossier
  const dossierPhotos = dossier ? path.join(dossier, "photos") : null, ID_PHOTO = /^[A-Za-z0-9_-]{6,40}$/, PHOTO_MAX = 6 * 1024 * 1024;
  const sauverPhotos = () => { if (dossier) { try { coffre.ecrire(path.join(dossier, "photos.json"), JSON.stringify([...photos.entries()])); } catch { /* ignoré */ } } };
  if (dossier) { fs.mkdirSync(dossierPhotos, { recursive: true }); try { for (const [k, v] of JSON.parse(coffre.lireTexte(path.join(dossier, "photos.json")))) photos.set(k, v); } catch { /* aucune photo */ }
    const limiteTombe = Date.now() / 1000 - 90 * 86400; for (const [k, v] of photos) if (v.supprime && v.t < limiteTombe) photos.delete(k); }
  /** Purge des photos plus vieilles que purgePhotosMois (marque, puis suppression 30 jours plus tard ; journal purge.log). */
  function purgerPhotos(maintenant = Date.now(), graceJours = 30) {
    if (!(purgePhotosMois > 0)) return null;
    const { bilan, journal } = appliquerPurge(photos, planPurge(photos, maintenant, { mois: purgePhotosMois, graceJours }), (id) => { if (dossierPhotos) fs.unlinkSync(path.join(dossierPhotos, `${id}.bin`)); else photosMem.delete(id); }, maintenant);
    if (journal.length) { sauverPhotos(); if (dossier) for (const l of journal) { try { fs.appendFileSync(path.join(dossier, "purge.log"), coffre.ligne(JSON.stringify(l)) + "\n", { mode: 0o600 }); } catch { /* ignoré */ } } }
    return bilan;
  }
  const photosTotal = () => { let n = 0; for (const v of photos.values()) if (!v.supprime) n += v.taille; return n; };
  // Au-delà de la limite, on cesse de garder les octets mais on laisse l'envoi se terminer pour pouvoir répondre proprement (413) ; coupure nette au-delà de 4 fois la limite.
  const corpsOctets = (req, max) => new Promise((ok, ko) => { let n = 0, trop = false; const b = []; req.on("data", (c) => { n += c.length; if (n > max) { trop = true; b.length = 0; if (n > max * 4) req.destroy(); } else if (!trop) b.push(c); }); req.on("end", () => (trop ? ko(new Error("trop gros")) : ok(Buffer.concat(b)))); req.on("error", ko); req.on("close", () => { if (trop) ko(new Error("trop gros")); }); });
  const fichierPartages = () => path.join(dossier, "partages.json");
  const sauverPartages = () => { if (dossier) { try { coffre.ecrire(fichierPartages(), JSON.stringify([...partages.values()])); } catch { /* ignoré */ } } };

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
      for (const l of fs.readFileSync(path.join(dossier, f), "utf8").split("\n")) { if (!l) continue; try { const p = JSON.parse(coffre.delire(l)); if (p.id && Number.isFinite(p.t)) ajouter(p); } catch { /* ligne abîmée */ } }
    }
  }
  if (dossier) { try { for (const p of JSON.parse(coffre.lireTexte(fichierPartages()))) partages.set(p.id, p); } catch { /* aucun partage */ } }
  const enregistrer = (positions, noms_ = []) => {
    let n = 0;
    positions.forEach((p, i) => { if (ajouter(p, noms_[i])) { n++; if (dossier) { try { fs.appendFileSync(fichierDuJour(p.t), coffre.ligne(JSON.stringify(p)) + "\n", { mode: 0o600 }); } catch { /* disque plein : on garde en mémoire */ } } } });
    return n;
  };

  const entetes = (extra = {}) => ({ "Access-Control-Allow-Origin": origine, "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra });
  const json = (res, code, obj) => { res.writeHead(code, entetes({ "Content-Type": "application/json; charset=utf-8" })); res.end(JSON.stringify(obj)); };
  const jetonDe = (req, url) => { const h = req.headers.authorization || ""; return h.startsWith("Bearer ") ? h.slice(7).trim() : url.searchParams.get("token") || url.searchParams.get("key") || ""; };
  const corps = (req, max = 262144) => new Promise((ok, ko) => { let n = 0; const b = []; req.on("data", (c) => { n += c.length; if (n > max) { ko(new Error("trop gros")); req.destroy(); } else b.push(c); }); req.on("end", () => ok(Buffer.concat(b).toString("utf8"))); req.on("error", ko); });

  /* ---------- alertes : transmises aux canaux configurés SUR LE SERVEUR (les secrets ne passent jamais par l'application) ---------- */
  const alertesVues = new Map(); let alertesHeure = { h: 0, n: 0 };
  async function diffuserAlerte({ texte, niveau, cle }) {
    const envoyes = [], erreurs = [];
    const poste = async (nom, url, opts) => { try { const r = await http_(url, { method: "POST", ...opts }); if (r.ok) envoyes.push(nom); else erreurs.push(`${nom} : réponse ${r.status}`); } catch (e) { erreurs.push(`${nom} : ${e.message}${e.cause?.code ? " (" + e.cause.code + ")" : ""}`); } };
    const urgent = niveau === "danger";
    if (canaux.ntfy?.url) await poste("ntfy", canaux.ntfy.url, { body: texte, headers: { Title: "Logistique Fret", Priority: urgent ? "high" : "default", Tags: urgent ? "rotating_light" : "warning" } });
    if (canaux.telegram?.token && canaux.telegram?.chat) await poste("telegram", `${canaux.telegram.api || "https://api.telegram.org"}/bot${canaux.telegram.token}/sendMessage`, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: canaux.telegram.chat, text: `${urgent ? "🚨 " : "⚠️ "}${texte}` }) });
    if (canaux.whatsapp?.token && canaux.whatsapp?.phoneId) for (const dest of canaux.whatsapp.destinataires || []) {
      const corps = canaux.whatsapp.modele ? { messaging_product: "whatsapp", to: dest, type: "template", template: { name: canaux.whatsapp.modele, language: { code: canaux.whatsapp.langue || "fr" }, components: [{ type: "body", parameters: [{ type: "text", text: texte.slice(0, 900) }] }] } } : { messaging_product: "whatsapp", to: dest, type: "text", text: { body: texte.slice(0, 3800) } };
      await poste(`whatsapp:${dest}`, `${canaux.whatsapp.api || "https://graph.facebook.com/v20.0"}/${canaux.whatsapp.phoneId}/messages`, { headers: { Authorization: `Bearer ${canaux.whatsapp.token}`, "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    }
    if (canaux.webhook?.url) await poste("webhook", canaux.webhook.url, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texte, niveau, cle, t: Math.floor(Date.now() / 1000) }) });
    return { envoyes, erreurs };
  }
  /* ---------- notifications par étape : messages rédigés par l'application, envoyés à l'heure par le relais ---------- */
  // Le relais ne lit pas les voyages : il reçoit le plan (heure, canal, destinataire, texte) et l'exécute, même application fermée.
  const hotesNtfy = new Set([...ntfyHotes, ...(canaux.ntfy?.url ? [(() => { try { return new URL(canaux.ntfy.url).hostname; } catch { return ""; } })()] : [])].filter(Boolean));
  let planif = { messages: [], etats: {} };
  const fichierPlanif = () => path.join(dossier, "scheduler.json");
  if (dossier) { try { const p = JSON.parse(coffre.lireTexte(fichierPlanif())); planif = { messages: Array.isArray(p.messages) ? p.messages : [], etats: p.etats || {} }; } catch { /* aucun plan */ } }
  const sauverPlanif = () => {
    const limite = Date.now() - 30 * 86400000; for (const [k, e] of Object.entries(planif.etats)) if (e.t < limite) delete planif.etats[k]; // états gardés 30 jours
    if (dossier) { try { coffre.ecrire(fichierPlanif(), JSON.stringify(planif)); } catch { /* garde en mémoire */ } }
  };
  const canauxNotif = () => [...(Object.keys(canaux).length ? ["equipe"] : []), "ntfy", ...(canaux.whatsapp ? ["whatsapp"] : []), ...(smtp ? ["email"] : [])];
  /** Message accepté depuis l'application (tout le reste est refusé) : renvoie le message nettoyé ou une raison. */
  function validerNotif(m) {
    if (!m || typeof m !== "object") return { refus: "message illisible" };
    const id = String(m.id ?? "").slice(0, 160), canal = String(m.canal ?? ""), destination = String(m.destination ?? "").trim(), texte = String(m.texte ?? "").slice(0, 2000).trim(), quand = Number(m.quand);
    if (!id || !texte) return { refus: "identifiant et texte obligatoires" };
    if (!["equipe", "ntfy", "whatsapp", "email"].includes(canal)) return { refus: `canal ${canal || "?"} non géré par le relais` };
    if (canal === "ntfy") { let u; try { u = new URL(destination); } catch { return { refus: "sujet ntfy invalide" }; } if (u.protocol !== "https:" || !hotesNtfy.has(u.hostname) || !/^\/[A-Za-z0-9_-]{6,64}$/.test(u.pathname)) return { refus: `serveur ntfy non autorisé (${u.hostname}) : ajoutez-le à NTFY_HOTES` }; }
    if (canal === "whatsapp" && !/^\d{8,15}$/.test(destination)) return { refus: "numéro WhatsApp invalide" };
    if (canal === "email" && !adresseValide(destination)) return { refus: "adresse e-mail invalide" };
    const r = { id, canal, destination: canal === "equipe" ? "" : destination, texte, sujet: String(m.sujet ?? "").slice(0, 200).replace(/[\r\n]+/g, " "), cle: String(m.cle ?? id).slice(0, 200), quand: Number.isFinite(quand) ? quand : Date.now(), voyageId: String(m.voyageId ?? "").slice(0, 60), niveau: m.niveau === "danger" ? "danger" : "warn" };
    if (m.repli && m.repli.canal === "email" && adresseValide(String(m.repli.destination ?? ""))) r.repli = { canal: "email", destination: String(m.repli.destination).trim() };
    return { message: r };
  }
  async function envoyerNotif(m) {
    const envoyes = [], erreurs = [];
    const poste = async (nom, url, opts) => { try { const r = await http_(url, { method: "POST", ...opts }); if (r.ok) envoyes.push(nom); else erreurs.push(`${nom} : réponse ${r.status}`); } catch (e) { erreurs.push(`${nom} : ${e.message}${e.cause?.code ? " (" + e.cause.code + ")" : ""}`); } };
    const parCourriel = async (a) => { if (!smtp) { erreurs.push("email : aucun serveur SMTP configuré sur le relais"); return; } try { await courriel_(smtp, { a, sujet: m.sujet || "Logistique Fret", texte: m.texte }); envoyes.push(`email:${a}`); } catch (e) { erreurs.push(`email:${a} : ${e.message}`); } };
    if (m.canal === "equipe") { const r = await diffuserAlerte({ texte: m.texte, niveau: m.niveau, cle: m.cle }); envoyes.push(...r.envoyes); erreurs.push(...r.erreurs); }
    else if (m.canal === "ntfy") await poste("ntfy", m.destination, { body: m.texte, headers: { Title: motEntete(m.sujet || "Logistique Fret"), Tags: "truck" } });
    else if (m.canal === "email") await parCourriel(m.destination);
    else if (m.canal === "whatsapp") {
      const avant = envoyes.length;
      if (!canaux.whatsapp?.token) erreurs.push("whatsapp : non configuré sur le relais");
      else {
        const c = canaux.whatsapp, corps = c.modele ? { messaging_product: "whatsapp", to: m.destination, type: "template", template: { name: c.modele, language: { code: c.langue || "fr" }, components: [{ type: "body", parameters: [{ type: "text", text: m.texte.slice(0, 900) }] }] } } : { messaging_product: "whatsapp", to: m.destination, type: "text", text: { body: m.texte.slice(0, 3800) } };
        await poste(`whatsapp:${m.destination}`, `${c.api || "https://graph.facebook.com/v20.0"}/${c.phoneId}/messages`, { headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" }, body: JSON.stringify(corps) });
      }
      if (envoyes.length === avant && m.repli) await parCourriel(m.repli.destination); // repli sur l'e-mail si WhatsApp échoue ou n'est pas configuré
    }
    return { envoyes, erreurs };
  }
  let notifHeure = { h: 0, n: 0 }; const notifsVues = new Map();
  const quotaNotif = (maintenant) => { const h = Math.floor(maintenant / 3600000); if (notifHeure.h !== h) notifHeure = { h, n: 0 }; return notifHeure.n++ < 300; };
  let tickEnCours = false;
  /** Envoie les messages programmés arrivés à échéance. Un message en retard de plus de 6 h n'est plus envoyé (« périmé »). */
  async function tick(maintenant = Date.now()) {
    if (tickEnCours) return []; tickEnCours = true; const faits = [];
    try {
      for (const m of planif.messages) {
        if (planif.etats[m.id] || m.quand > maintenant) continue;
        if (maintenant - m.quand > 6 * 3600000) { planif.etats[m.id] = { statut: "perime", t: maintenant }; faits.push({ id: m.id, statut: "perime" }); continue; }
        if (!quotaNotif(maintenant)) break;
        const r = await envoyerNotif(m), statut = r.envoyes.length ? "envoye" : "erreur";
        planif.etats[m.id] = { statut, t: maintenant, envoyes: r.envoyes, erreurs: r.erreurs.slice(0, 5) }; faits.push({ id: m.id, statut, ...r });
      }
      if (faits.length) sauverPlanif();
    } finally { tickEnCours = false; }
    return faits;
  }
  /* ---------- historique des alertes (7 jours) : un appareil revenu en ligne récupère ce qu'il a manqué ---------- */
  const histoAlertes = [], fichierAlertes = () => path.join(dossier, "alertes.jsonl");
  if (dossier) { try { const limite = Date.now() - 7 * 86400000; for (const l of fs.readFileSync(fichierAlertes(), "utf8").split("\n")) { if (!l) continue; try { const a = JSON.parse(coffre.delire(l)); if (a.t >= limite) histoAlertes.push(a); } catch { /* ligne abîmée */ } } ecrireAtomique(fichierAlertes(), histoAlertes.map((a) => coffre.ligne(JSON.stringify(a))).join("\n") + (histoAlertes.length ? "\n" : "")); } catch { /* aucun historique */ } }
  function noterAlerte(a) {
    histoAlertes.push(a); const limite = Date.now() - 7 * 86400000; while (histoAlertes.length && (histoAlertes[0].t < limite || histoAlertes.length > 5000)) histoAlertes.shift();
    if (dossier) { try { fs.appendFileSync(fichierAlertes(), coffre.ligne(JSON.stringify(a)) + "\n", { mode: 0o600 }); } catch { /* garde en mémoire */ } }
  }
  if (multi) multi.brancherAlertes((a) => { noterAlerte({ t: Date.now(), texte: a.texte, niveau: a.niveau, cle: a.cle, envoyes: [] }); diffuserAlerte(a).catch?.(() => {}); });
  /* ---------- journal d'accès (option JOURNAL_ACCES) : qui a lu quoi, adresse tronquée, 30 jours ---------- */
  const fichierAcces = (t) => path.join(dossier, `acces-${new Date(t).toISOString().slice(0, 10)}.jsonl`);
  const ipTronquee = (ip) => (ip.includes(":") && !/^::ffff:/.test(ip) ? ip.split(":").slice(0, 3).join(":") + "::" : ip.replace(/^::ffff:/, "").replace(/\.\d+$/, ".0"));
  if (dossier && journalAcces) { const limite = Date.now() - 30 * 86400000; for (const f of fs.readdirSync(dossier).filter((x) => /^acces-\d{4}-\d{2}-\d{2}\.jsonl$/.test(x))) if (Date.parse(f.slice(6, 16)) < limite) { try { fs.unlinkSync(path.join(dossier, f)); } catch { /* ignoré */ } } }
  const noterAcces = (req, res, p, ip, autorise) => { if (!dossier || !journalAcces) return; const t = Date.now(); try { fs.appendFileSync(fichierAcces(t), coffre.ligne(JSON.stringify({ t, m: req.method, p: p.replace(/\/suivi\/[^/]+/, "/suivi/…").slice(0, 120), code: res.statusCode, ip: ipTronquee(ip), jeton: autorise })) + "\n", { mode: 0o600 }); } catch { /* ignoré */ } };
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
    if (b.attentes !== undefined) { const a = b.attentes || {}, h = (x) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Math.max(0, Math.min(120, Number(x)))); o.attentes = { portH: h(a.portH), auPortH: h(a.auPortH), debarqH: h(a.debarqH), fourchetteMin: h(a.fourchetteMin / 60) === null ? 0 : Math.round(h(a.fourchetteMin / 60) * 60), source: ["operateur_calibre", "mesure", "saisie_manuelle"].includes(a.source) ? a.source : "estimation_generique" }; }
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
      if (dest) { const e = moteur.appeler("etaPrevision", h, maintenant, dest, p.attentes || null, { zones }); if (e) { out.eta = { arrivee: e.arrivee, min: e.min, max: e.max, fourchetteMin: e.fourchetteMin, source: e.source }; out.retardMin = p.livraisonPrevue ? moteur.appeler("etaRetardMin", e, p.livraisonPrevue) : null; } }
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

      // --- mode multi-utilisateur : comptes, données par enregistrement, application servie par le relais ---
      if (multi && await multi.traiter(req, res, url, p, ip, entetes, !!jetonLecture && egal(jetonDe(req, url), jetonLecture))) return;
      const jeton = jetonDe(req, url);
      const peutEcrire = egal(jeton, jetonEcriture), peutLire = peutEcrire ? false : egal(jeton, jetonLecture) || (!!multi && peutSuivre(multi.utilisateurDe(req))); // une session d'un rôle de suivi vaut le jeton de lecture
      if (journalAcces && p.startsWith("/api/")) res.on("finish", () => noterAcces(req, res, p, ip, peutLire ? "lecture" : peutEcrire ? "ecriture" : "aucun"));

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
        const mph = p.match(/^\/api\/sync\/photos(?:\/([^/]+))?$/);
        if (mph) {
          if (!peutLire) return json(res, 401, { erreur: "Jeton de lecture requis." });
          const id = mph[1];
          if (!id && req.method === "GET") return json(res, 200, { photos: [...photos.entries()].map(([k, v]) => ({ id: k, t: v.t, taille: v.taille, supprime: !!v.supprime })), octets: photosTotal(), maxOctets: photosMaxMo * 1024 * 1024 });
          if (!id || !ID_PHOTO.test(id)) return json(res, 400, { erreur: "Identifiant de photo invalide." });
          const fichier = dossierPhotos && path.join(dossierPhotos, `${id}.bin`), e = photos.get(id);
          if (req.method === "PUT") {
            let o; try { o = await corpsOctets(req, PHOTO_MAX); } catch { return json(res, 413, { erreur: "Photo trop volumineuse (6 Mo au plus)." }); }
            if (!o.length) return json(res, 400, { erreur: "Photo vide." });
            if (photosTotal() - (e && !e.supprime ? e.taille : 0) + o.length > photosMaxMo * 1024 * 1024) return json(res, 507, { erreur: `Espace photos plein sur le serveur (${photosMaxMo} Mo).` });
            if (fichier) { try { coffre.ecrire(fichier, o); } catch { return json(res, 500, { erreur: "Écriture impossible sur le serveur." }); } } else photosMem.set(id, o);
            photos.set(id, { t: Math.floor(Date.now() / 1000), taille: o.length }); sauverPhotos(); return json(res, 200, { ok: true });
          }
          if (req.method === "GET") {
            if (!e || e.supprime) return json(res, 404, { erreur: "Photo introuvable." });
            let o; try { o = fichier ? coffre.lireOctets(fichier) : photosMem.get(id); } catch { o = null; }
            if (!o) return json(res, 404, { erreur: "Photo introuvable." });
            res.writeHead(200, entetes({ "Content-Type": "application/octet-stream", "Content-Length": o.length })); return res.end(o);
          }
          if (req.method === "DELETE") {
            if (fichier) { try { fs.unlinkSync(fichier); } catch { /* déjà absente */ } } else photosMem.delete(id);
            photos.set(id, { t: Math.floor(Date.now() / 1000), taille: 0, supprime: true }); sauverPhotos(); return json(res, 200, { ok: true });
          }
        }
        if (p === "/api/sync") { // synchronisation entre appareils : le serveur ne voit qu'un bloc chiffré par l'application
          if (!peutLire) return json(res, 401, { erreur: "Jeton de lecture requis." });
          if (req.method === "GET") return json(res, 200, { version: synchro.version, appareil: synchro.appareil, t: synchro.t, blob: url.searchParams.get("meta") ? undefined : synchro.blob });
          if (req.method === "PUT") {
            let b; try { b = JSON.parse(await corps(req, 40 * 1024 * 1024)); } catch { return json(res, 400, { erreur: "JSON invalide." }); }
            if (typeof b.blob !== "string" || !b.blob || b.blob.length > 40 * 1024 * 1024) return json(res, 400, { erreur: "blob obligatoire (40 Mo au plus)." });
            if (Number(b.base) !== synchro.version) return json(res, 409, { erreur: "Le serveur a une version plus récente.", version: synchro.version });
            synchro = { version: synchro.version + 1, blob: b.blob, appareil: textes(b.appareil, 60), t: Math.floor(Date.now() / 1000) };
            if (dossier) { try { coffre.ecrire(fichierSynchro(), JSON.stringify(synchro)); } catch { /* garde en mémoire */ } }
            return json(res, 200, { ok: true, version: synchro.version });
          }
        }
        if (p === "/api/alertes/historique" && req.method === "GET") {
          if (!peutLire) return json(res, 401, { erreur: "Jeton de lecture requis." });
          const borne = (x, d) => { if (x === null || x === "") return d; const n = Number(x); return Number.isFinite(n) ? (n < 1e11 ? n * 1000 : n) : Number.isFinite(Date.parse(x)) ? Date.parse(x) : d; }; // secondes ou millisecondes ou date ISO
          const debut = borne(url.searchParams.get("debut"), Date.now() - 7 * 86400000), fin = borne(url.searchParams.get("fin"), Date.now() + 60000);
          return json(res, 200, { alertes: histoAlertes.filter((a) => a.t >= debut && a.t <= fin).map(({ t, texte, niveau, cle }) => ({ t, texte, niveau, cle })) });
        }
        if (p === "/api/alertes/test" && req.method === "POST") { // essai de chaque canal, résultat détaillé (pour vérifier un compte WhatsApp, un bot Telegram…)
          if (!peutLire) return json(res, 401, { erreur: "Jeton de lecture requis." });
          if (!Object.keys(canaux).length) return json(res, 200, { ok: false, envoyes: [], erreurs: [], note: "Aucun canal configuré sur le serveur (voir serveur/README.md)." });
          return json(res, 200, { ok: true, ...(await diffuserAlerte({ texte: "Essai : les alertes de Logistique Fret arrivent bien sur ce canal.", niveau: "warn", cle: "essai" })) });
        }
        if (p === "/api/alertes" && req.method === "POST") {
          if (!peutLire) return json(res, 401, { erreur: "Jeton de lecture requis." });
          let b; try { b = JSON.parse(await corps(req)); } catch { return json(res, 400, { erreur: "JSON invalide." }); }
          const texte = textes(b.texte, 500), cle = textes(b.cle, 120) || texte, niveau = b.niveau === "danger" ? "danger" : "warn", maintenant = Date.now();
          if (!texte) return json(res, 400, { erreur: "texte obligatoire." });
          if (!Object.keys(canaux).length) { if (!(alertesVues.get(cle) > maintenant - 6 * 3600000)) { alertesVues.set(cle, maintenant); noterAlerte({ t: maintenant, texte, niveau, cle, envoyes: [] }); } return json(res, 200, { ok: true, envoyes: [], erreurs: [], note: "Aucun canal configuré sur le serveur." }); }
          const h = Math.floor(maintenant / 3600000); if (alertesHeure.h !== h) alertesHeure = { h, n: 0 };
          if (alertesHeure.n >= 60) return json(res, 429, { erreur: "60 alertes par heure au plus." });
          if (alertesVues.get(cle) > maintenant - 6 * 3600000) return json(res, 200, { ok: true, envoyes: [], erreurs: [], note: "Déjà transmise il y a moins de 6 h." });
          alertesVues.set(cle, maintenant); alertesHeure.n++; if (alertesVues.size > 500) for (const [k, t] of alertesVues) if (t < maintenant - 6 * 3600000) alertesVues.delete(k);
          const r = await diffuserAlerte({ texte, niveau, cle }); noterAlerte({ t: maintenant, texte, niveau, cle, envoyes: r.envoyes });
          return json(res, 200, { ok: true, ...r });
        }
        const mpn = p.match(/^\/api\/notifications\/(plan|scheduler|manuelle|test)(?:\/(.+))?$/);
        if (mpn) {
          if (!peutLire) return json(res, 401, { erreur: "Jeton de lecture requis." });
          const [, quoi, idn] = mpn, maintenant = Date.now();
          if (quoi === "plan" && req.method === "PUT") { // remplace les messages à venir ; ce qui est déjà envoyé ou annulé le reste (un nouvel envoi du plan ne renvoie rien)
            let b; try { b = JSON.parse(await corps(req, 2 * 1024 * 1024)); } catch { return json(res, 400, { erreur: "JSON invalide." }); }
            if (!Array.isArray(b.messages) || b.messages.length > 2000) return json(res, 400, { erreur: "messages : liste de 2000 au plus." });
            const garder = [], refus = [];
            for (const m of b.messages) { const v = validerNotif(m); if (v.refus) refus.push({ id: m?.id, raison: v.refus }); else if (v.message.quand <= maintenant + 31 * 86400000) garder.push(v.message); }
            planif.messages = garder.sort((x, y) => x.quand - y.quand); sauverPlanif();
            return json(res, 200, { ok: true, programmes: garder.filter((m) => !planif.etats[m.id]).length, refus });
          }
          if (quoi === "scheduler" && req.method === "GET") {
            const borne = (x, d) => { if (x === null || x === "") return d; const n = Number(x); return Number.isFinite(n) ? (n < 1e11 ? n * 1000 : n) : Number.isFinite(Date.parse(x)) ? Date.parse(x) : d; }; // secondes ou millisecondes ou date ISO
            const debut = borne(url.searchParams.get("debut"), maintenant - 86400000), fin = borne(url.searchParams.get("fin"), maintenant + 7 * 86400000);
            return json(res, 200, { canaux: canauxNotif(), messages: planif.messages.filter((m) => m.quand >= debut && m.quand <= fin).map((m) => ({ id: m.id, quand: m.quand, canal: m.canal, destination: m.destination, sujet: m.sujet, texte: m.texte, voyageId: m.voyageId, ...(planif.etats[m.id] ? { statut: planif.etats[m.id].statut, envoyes: planif.etats[m.id].envoyes, erreurs: planif.etats[m.id].erreurs } : { statut: "a_venir" }) })) });
          }
          if (quoi === "scheduler" && req.method === "DELETE" && idn) { const id = decodeURIComponent(idn).slice(0, 160); planif.etats[id] = { statut: "annule", t: maintenant }; sauverPlanif(); return json(res, 200, { ok: true }); }
          if (quoi === "manuelle" && req.method === "POST") {
            let b; try { b = JSON.parse(await corps(req, 512 * 1024)); } catch { return json(res, 400, { erreur: "JSON invalide." }); }
            const liste = Array.isArray(b.messages) ? b.messages.slice(0, 50) : [], journal = [];
            for (const m of liste) {
              const v = validerNotif({ ...m, quand: maintenant }); if (v.refus) { journal.push({ id: m?.id, statut: "refuse", raison: v.refus }); continue; }
              if (!b.forcer && notifsVues.get(v.message.cle) > maintenant - 6 * 3600000) { journal.push({ id: v.message.id, statut: "deja_envoye" }); continue; } // deux appareils qui notifient la même étape
              if (!quotaNotif(maintenant)) { journal.push({ id: v.message.id, statut: "quota" }); continue; }
              notifsVues.set(v.message.cle, maintenant); const r = await envoyerNotif(v.message); journal.push({ id: v.message.id, statut: r.envoyes.length ? "envoye" : "erreur", ...r });
            }
            if (notifsVues.size > 2000) for (const [k, t] of notifsVues) if (t < maintenant - 6 * 3600000) notifsVues.delete(k);
            return json(res, 200, { ok: true, journal });
          }
          if (quoi === "test" && req.method === "POST") {
            let b = {}; try { b = JSON.parse((await corps(req)) || "{}"); } catch { /* corps vide */ }
            const r = { canaux: canauxNotif(), resultats: [] }, essai = "Essai : les notifications de Logistique Fret arrivent bien ici.";
            if (Object.keys(canaux).length) r.resultats.push({ canal: "equipe", ...(await diffuserAlerte({ texte: essai, niveau: "warn", cle: "essai-notif" })) });
            if (b.ntfy) { const v = validerNotif({ id: "essai", canal: "ntfy", destination: b.ntfy, texte: essai, sujet: "Essai" }); r.resultats.push(v.refus ? { canal: "ntfy", envoyes: [], erreurs: [v.refus] } : { canal: "ntfy", ...(await envoyerNotif(v.message)) }); }
            const mail = b.email || smtp?.de; if (smtp && mail) { const v = validerNotif({ id: "essai", canal: "email", destination: mail, texte: essai, sujet: "Essai — Logistique Fret" }); r.resultats.push(v.refus ? { canal: "email", envoyes: [], erreurs: [v.refus] } : { canal: "email", ...(await envoyerNotif(v.message)) }); }
            if (!smtp) r.resultats.push({ canal: "email", envoyes: [], erreurs: ["aucun serveur SMTP configuré (SMTP_HOTE, SMTP_DE…)"] });
            return json(res, 200, r);
          }
          return json(res, 405, { erreur: "Méthode non permise." });
        }
        if (p === "/api/etat") return json(res, 200, { version: VERSION, notifications: canauxNotif(), planifies: planif.messages.filter((m) => !planif.etats[m.id]).length, appareils: historique.size, positions: total, retentionJours, partages: partages.size, moteur: moteur.disponible, canaux: Object.keys(canaux), synchro: synchro.version, maintenant: Math.floor(Date.now() / 1000) });
      }
      return json(res, 404, { erreur: "Introuvable." });
    } catch (e) { return json(res, 500, { erreur: "Erreur du serveur." }); }
  });
  return { serveur, historique, enregistrer, partages, donneesPartage, tick, planif: () => planif, purgerPhotos, photos, multi };
}

module.exports = { creer, normaliser, VERSION, creerCoffre, chargerCoffre };

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
  const canaux = {};
  if (e.NTFY_URL) canaux.ntfy = { url: e.NTFY_URL };
  if (e.TELEGRAM_TOKEN && e.TELEGRAM_CHAT) canaux.telegram = { token: e.TELEGRAM_TOKEN, chat: e.TELEGRAM_CHAT, api: e.TELEGRAM_API || undefined };
  if (e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_ID) canaux.whatsapp = { token: e.WHATSAPP_TOKEN, phoneId: e.WHATSAPP_PHONE_ID, destinataires: String(e.WHATSAPP_DEST || "").split(",").map((x) => x.trim()).filter(Boolean), modele: e.WHATSAPP_MODELE || "", langue: e.WHATSAPP_LANGUE || "fr", api: e.WHATSAPP_API || undefined };
  if (e.WEBHOOK_URL) canaux.webhook = { url: e.WEBHOOK_URL };
  const { coffre, nouvelle, fichierCle } = chargerCoffre(dossier, e);
  if (nouvelle) console.log(`  ⚠ Chiffrement des données activé : phrase secrète créée dans ${fichierCle}. SAUVEGARDEZ-LA AILLEURS : sans elle, les données sont perdues.`);
  const smtp = e.SMTP_HOTE && e.SMTP_DE ? { hote: e.SMTP_HOTE, port: Number(e.SMTP_PORT || 0) || undefined, securite: e.SMTP_SECURITE || undefined, utilisateur: e.SMTP_UTILISATEUR || "", motDePasse: e.SMTP_MOT_DE_PASSE || "", de: e.SMTP_DE } : null;
  const ntfyHotes = String(e.NTFY_HOTES || "ntfy.sh").split(",").map((x) => x.trim()).filter(Boolean);
  const purgePhotosMois = Number(e.PURGE_PHOTOS_MOIS || 0), estMulti = String(e.MULTI_UTILISATEUR || "").toLowerCase() === "true";
  const multi = estMulti ? creerMulti({ dossier, coffre, version: VERSION, jetonLecture: jetons.jetonLecture, smtp, cookieSecurise: String(e.COOKIE_NON_SECURISE || "").toLowerCase() !== "true", retentionAuditJours: Number(e.RETENTION_AUDIT_JOURS || 730), urlPublique: e.URL_PUBLIQUE || "" }) : null;
  const { serveur, tick, purgerPhotos } = creer({ ...jetons, dossier, coffre, purgePhotosMois, multi, journalAcces: String(e.JOURNAL_ACCES || "").toLowerCase() === "true", retentionJours: Number(e.RETENTION_JOURS || 30), origine: e.ORIGINE || "*", canaux, photosMaxMo: Number(e.PHOTOS_MAX_MO || 2048), smtp, ntfyHotes });
  setInterval(() => { tick().catch(() => { /* réessayé à la minute suivante */ }); }, 60000); // notifications programmées
  if (purgePhotosMois > 0) { const purge = () => { const b = purgerPhotos(); if (b && (b.marquees || b.supprimees)) console.log(`Purge des photos : ${b.marquees} marquée(s), ${b.supprimees} supprimée(s)`); }; setTimeout(purge, 60000); setInterval(purge, 86400000); }
  const port = Number(e.PORT || 8787);
  serveur.listen(port, e.HOTE || "0.0.0.0", () => {
    console.log(`Relais de positions ${VERSION} sur le port ${port}`);
    console.log(`  Jeton d'écriture (balises, Traccar) : ${jetons.jetonEcriture}`);
    console.log(`  Jeton de lecture (application)      : ${jetons.jetonLecture}`);
    if (Object.keys(canaux).length) console.log(`  Alertes transmises à : ${Object.keys(canaux).join(", ")}`);
    console.log(`  Données au repos : ${coffre.actif ? "chiffrées (AES-256-GCM)" : "en clair (CHIFFRER_DONNEES=true pour chiffrer)"}${String(e.JOURNAL_ACCES || "").toLowerCase() === "true" ? " · journal d'accès actif (30 jours)" : ""}`);
    if (multi) console.log(`  Multi-utilisateur : application servie sur ce port, ${multi.comptes().length ? `${multi.comptes().length} compte(s)` : "aucun compte : ouvrez l'adresse du relais pour créer le premier (jeton de lecture demandé)"}`);
    console.log(`  Notifications programmées : ntfy (${ntfyHotes.join(", ")})${smtp ? `, e-mail (${smtp.hote})` : ""}${canaux.whatsapp ? ", WhatsApp" : ""}`);
    console.log(`  Réception : POST /api/positions · GET /osmand · POST /traccar    Lecture : /api/derniere · /api/trace`);
  });
}
