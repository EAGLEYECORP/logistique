"use strict";
/* ============================================================
   Liens sans compte, servis par le relais, comme le lien de suivi :
   · lien de dépôt (/depot/<id>) : le client envoie les documents d'une commande (photos ou PDF) depuis son téléphone ;
     les fichiers attendent sur le relais (chiffrés au repos si le chiffrement est actif) jusqu'à ce que l'application les récupère ;
   · lien transitaire (/transit/<id>) : le transitaire marque les étapes de douane d'un voyage (« fait », référence, note) ;
     l'application applique ces étapes au voyage.
   Identifiant secret dans l'adresse (24 octets au hasard), date d'expiration, révocation, quotas. La page ne montre que le titre
   choisi par l'application (référence, client), la liste des documents ou des étapes et le nom de l'entreprise.
   ============================================================ */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ID_LIEN = /^[A-Za-z0-9_-]{24,64}$/, ID_COURT = /^[A-Za-z0-9_-]{1,40}$/;
const TYPES_FICHIERS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" };
const texte = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);

function creerLiens({ dossier = null, coffre, maxMo = 1024, fichierMaxMo = 12, maxFichiersParLien = 40, maxLiens = 300, maintenant = () => Date.now() } = {}) {
  const liens = new Map(), memoire = new Map(); // memoire : contenu des fichiers sans dossier (essais)
  const dossierFichiers = dossier ? path.join(dossier, "liens") : null, fichierListe = () => path.join(dossier, "liens.json");
  if (dossier) { fs.mkdirSync(dossierFichiers, { recursive: true }); try { for (const l of JSON.parse(coffre.lireTexte(fichierListe()))) liens.set(l.id, l); } catch { /* aucun lien */ } }
  const sauver = () => { if (dossier) { try { coffre.ecrire(fichierListe(), JSON.stringify([...liens.values()])); } catch { /* garde en mémoire */ } } };
  const chemin = (id, n) => path.join(dossierFichiers, `${id}-${n}.bin`);
  const ecrireFichier = (id, n, o) => { if (dossier) coffre.ecrire(chemin(id, n), o); else memoire.set(`${id}-${n}`, o); };
  const lireFichier = (id, n) => { try { return dossier ? coffre.lireOctets(chemin(id, n)) : memoire.get(`${id}-${n}`) || null; } catch { return null; } };
  const effacerFichier = (id, n) => { if (dossier) { try { fs.unlinkSync(chemin(id, n)); } catch { /* déjà effacé */ } } else memoire.delete(`${id}-${n}`); };
  const octetsTotal = () => { let n = 0; for (const l of liens.values()) for (const f of l.fichiers || []) if (!f.efface) n += f.taille; return n; };
  /** Liens expirés depuis plus de 7 jours : effacés avec leurs fichiers. */
  function purger() {
    const limite = maintenant() - 7 * 86400000; let n = 0;
    for (const l of [...liens.values()]) if (l.expire * 1000 < limite) { for (const f of l.fichiers || []) effacerFichier(l.id, f.n); liens.delete(l.id); n++; }
    if (n) sauver(); return n;
  }
  purger();

  /** Ce que l'application peut fixer à la création et le mettre à jour. */
  function lire(b, base) {
    const o = { ...base };
    if (b.titre !== undefined) o.titre = texte(b.titre, 140);
    if (b.entreprise !== undefined) o.entreprise = texte(b.entreprise, 100);
    if (b.message !== undefined) o.message = texte(b.message, 600);
    if (b.langue !== undefined) o.langue = ["fr", "en", "es", "ar"].includes(b.langue) ? b.langue : "fr";
    if (b.jours !== undefined) o.expire = Math.floor(maintenant() / 1000) + Math.round(Math.min(120, Math.max(1, Number(b.jours) || 14)) * 86400);
    if (o.type === "depot" && Array.isArray(b.docs)) o.docs = b.docs.slice(0, 30).map((d) => ({ id: texte(d.id, 40).replace(/[^\w-]/g, "") || "autre", lib: texte(d.lib, 120), recu: !!d.recu })).filter((d) => d.lib);
    if (o.type === "transit" && Array.isArray(b.etapes)) o.etapes = b.etapes.slice(0, 40).map((e) => ({ id: texte(e.id, 40).replace(/[^\w-]/g, ""), lib: texte(e.lib, 140), port: texte(e.port, 80), refLib: texte(e.refLib, 60), detail: texte(e.detail, 300), docs: (Array.isArray(e.docs) ? e.docs : []).slice(0, 8).map((x) => texte(x, 80)), fait: !!e.fait, date: texte(e.date, 30), ref: texte(e.ref, 80) })).filter((e) => e.id && e.lib);
    return o;
  }
  /** Ce que voit la page publique (jamais les fichiers ni les notes internes). */
  function publics(l) {
    const base = { type: l.type, titre: l.titre, entreprise: l.entreprise, message: l.message, langue: l.langue, expire: l.expire };
    if (l.type === "depot") return { ...base, docs: (l.docs || []).map((d) => ({ id: d.id, lib: d.lib, recu: d.recu, envoyes: (l.fichiers || []).filter((f) => f.doc === d.id).length })), autres: (l.fichiers || []).filter((f) => f.doc === "autre").length, envoyes: (l.fichiers || []).length, max: maxFichiersParLien };
    return { ...base, etapes: (l.etapes || []).map(({ id, lib, port, refLib, detail, docs, fait, date, ref }) => ({ id, lib, port, refLib, detail, docs, fait, date, ref })) };
  }
  const etat = (l) => ({ id: l.id, type: l.type, titre: l.titre, expire: l.expire, cree: l.cree, fichiers: (l.fichiers || []).filter((f) => !f.efface).map(({ n, doc, nom, type, taille, t }) => ({ n, doc, nom, type, taille, t })), evenements: l.evenements || [] });

  /** Pages et envois publics : /depot/<id>, /transit/<id>. Renvoie true si la requête est traitée. */
  async function traiterPublic(req, res, p, { json, corpsOctets, corpsJson, page, entetesPublics, entetes }) {
    const m = p.match(/^\/(depot|transit)\/([A-Za-z0-9_-]{24,64})(\/donnees|\/fichier|\/etape)?$/); if (!m) return false;
    const l = liens.get(m[2]);
    const refus = (code, cle) => { if (req.method === "GET" && !m[3]) { res.writeHead(code, entetes({ "Content-Type": "text/html; charset=utf-8", ...entetesPublics })); res.end(page(m[1], "fr", cle)); } else json(res, code, { erreur: cle }); return true; };
    if (!l || l.type !== m[1] || l.revoque) return refus(404, "introuvable");
    if (l.expire * 1000 < maintenant()) return refus(410, "expire");
    if (req.method === "GET" && !m[3]) { res.writeHead(200, entetes({ "Content-Type": "text/html; charset=utf-8", ...entetesPublics })); res.end(page(l.type, new URL(req.url, "http://x").searchParams.get("lang") || l.langue || "fr")); return true; }
    if (req.method === "GET" && m[3] === "/donnees") { json(res, 200, publics(l)); return true; }
    if (req.method === "POST" && m[3] === "/fichier" && l.type === "depot") {
      const url = new URL(req.url, "http://x"), doc = texte(url.searchParams.get("doc"), 40), type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!(l.docs || []).some((d) => d.id === doc) && doc !== "autre") return json(res, 400, { erreur: "document inconnu" }), true;
      if (!TYPES_FICHIERS[type]) return json(res, 415, { erreur: "type" }), true;
      if ((l.fichiers || []).length >= maxFichiersParLien) return json(res, 429, { erreur: "trop" }), true;
      let o; try { o = await corpsOctets(req, fichierMaxMo * 1024 * 1024); } catch { return json(res, 413, { erreur: "taille" }), true; }
      if (!o.length) return json(res, 400, { erreur: "vide" }), true;
      if (octetsTotal() + o.length > maxMo * 1024 * 1024) return json(res, 507, { erreur: "plein" }), true;
      const n = (l.dernier || 0) + 1, nom = texte(url.searchParams.get("nom"), 100).replace(/[\\/]/g, "_") || `document.${TYPES_FICHIERS[type]}`;
      try { ecrireFichier(l.id, n, o); } catch { return json(res, 500, { erreur: "ecriture" }), true; }
      l.dernier = n; (l.fichiers ||= []).push({ n, doc, nom, type, taille: o.length, t: maintenant() }); sauver();
      json(res, 201, { ok: true, envoyes: l.fichiers.length }); return true;
    }
    if (req.method === "POST" && m[3] === "/etape" && l.type === "transit") {
      let b; try { b = await corpsJson(req); } catch { return json(res, 400, { erreur: "illisible" }), true; }
      const e = (l.etapes || []).find((x) => x.id === b.etape); if (!e) return json(res, 400, { erreur: "etape" }), true;
      if ((l.evenements || []).length >= 300) return json(res, 429, { erreur: "trop" }), true;
      const ev = { n: (l.evenements || []).length + 1, etape: e.id, date: new Date(maintenant()).toISOString(), ref: texte(b.ref, 80), note: texte(b.note, 300), annule: !!b.annuler };
      (l.evenements ||= []).push(ev); Object.assign(e, ev.annule ? { fait: false, date: "", ref: "" } : { fait: true, date: ev.date, ref: ev.ref || e.ref }); sauver();
      json(res, 200, { ok: true, etape: e }); return true;
    }
    json(res, 405, { erreur: "methode" }); return true;
  }

  /** Routes de l'application (jeton de lecture) : /api/liens… Renvoie true si la requête est traitée. */
  async function traiterApi(req, res, p, { json, corpsJson, entetes }) {
    const m = p.match(/^\/api\/liens(?:\/([A-Za-z0-9_-]{24,64})(?:\/fichiers\/(\d+))?)?$/); if (!m) return false;
    const [, id, nf] = m;
    if (!id && req.method === "GET") { json(res, 200, [...liens.values()].filter((l) => !l.revoque).map(etat)); return true; }
    if (!id && req.method === "POST") {
      if ([...liens.values()].filter((l) => !l.revoque && l.expire * 1000 > maintenant()).length >= maxLiens) return json(res, 429, { erreur: "Trop de liens actifs : révoquez les anciens." }), true;
      let b; try { b = await corpsJson(req); } catch { return json(res, 400, { erreur: "JSON invalide." }), true; }
      if (!["depot", "transit"].includes(b.type)) return json(res, 400, { erreur: "type : depot ou transit." }), true;
      const l = lire({ jours: 14, ...b }, { id: crypto.randomBytes(24).toString("base64url"), type: b.type, cree: Math.floor(maintenant() / 1000), langue: "fr", titre: "", entreprise: "", message: "", docs: [], etapes: [], fichiers: [], evenements: [] });
      if (l.type === "depot" && !l.docs.length) return json(res, 400, { erreur: "Aucun document demandé." }), true;
      if (l.type === "transit" && !l.etapes.length) return json(res, 400, { erreur: "Aucune étape." }), true;
      liens.set(l.id, l); sauver(); json(res, 201, { id: l.id, chemin: `/${l.type}/${l.id}`, expire: l.expire }); return true;
    }
    const l = liens.get(id);
    if (!l || l.revoque) return json(res, 404, { erreur: "Lien introuvable." }), true;
    if (nf) {
      const f = (l.fichiers || []).find((x) => x.n === Number(nf) && !x.efface); if (!f) return json(res, 404, { erreur: "Fichier introuvable." }), true;
      if (req.method === "GET") { const o = lireFichier(l.id, f.n); if (!o) return json(res, 404, { erreur: "Fichier introuvable." }), true; res.writeHead(200, entetes({ "Content-Type": f.type, "Content-Length": o.length })); res.end(o); return true; }
      if (req.method === "DELETE") { effacerFichier(l.id, f.n); f.efface = true; sauver(); json(res, 200, { ok: true }); return true; }
    }
    if (req.method === "GET") { json(res, 200, etat(l)); return true; }
    if (req.method === "PUT") { let b; try { b = await corpsJson(req); } catch { return json(res, 400, { erreur: "JSON invalide." }), true; } liens.set(id, lire(b, l)); sauver(); json(res, 200, { ok: true, expire: liens.get(id).expire }); return true; }
    if (req.method === "DELETE") { for (const f of l.fichiers || []) effacerFichier(l.id, f.n); l.revoque = true; l.fichiers = []; sauver(); json(res, 200, { ok: true }); return true; }
    json(res, 405, { erreur: "Méthode non gérée." }); return true;
  }
  return { traiterPublic, traiterApi, purger, liens };
}

module.exports = { creerLiens, TYPES_FICHIERS, ID_LIEN, ID_COURT };
