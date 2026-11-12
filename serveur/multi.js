"use strict";
/* ============================================================
   Relais multi-utilisateur (MULTI_UTILISATEUR=true) : le relais devient le serveur de l'application.
   · comptes, connexion, double authentification, renouvellement de session, réinitialisation, clé de récupération ;
   · données par enregistrement, avec version (écriture refusée si quelqu'un a modifié entre-temps : 409) ;
   · droits appliqués à chaque appel (comptes.js) : un rôle ne reçoit jamais ce qu'il n'a pas le droit de voir ;
   · changements depuis un instant (appareils revenus en ligne), mises à jour en direct (SSE), verrous de 30 s ;
   · journal de chaque écriture (avant/après), des connexions et des refus — 24 mois par défaut ;
   · l'application elle-même est servie par le relais (un navigateur suffit).
   Stockage : fichiers JSON chiffrés au repos (coffre.js), écritures atomiques. Aucune dépendance.
   ============================================================ */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const C = require("../comptes.js");
const A = require("./auth.js");
const { envoyerCourriel } = require("./courriel.js");
const { creerCoffre, ecrireAtomique } = require("./coffre.js");

const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", png: "image/png", svg: "image/svg+xml", json: "application/json; charset=utf-8", webmanifest: "application/manifest+json", ico: "image/x-icon", txt: "text/plain; charset=utf-8" };
const VERROU_MS = 30000;

function creerMulti({ dossier = null, coffre = creerCoffre(null), racine = path.join(__dirname, ".."), version = "", jetonLecture = "", smtp = null, courriel_ = envoyerCourriel, maintenant = () => Date.now(),
  cookieSecurise = true, noterAlerte = () => {}, retentionAuditJours = 730, urlPublique = "" } = {}) {
  let alerter = noterAlerte;
  const fichier = (n) => path.join(dossier, n), dossierBase = dossier ? path.join(dossier, "base") : null;
  if (dossierBase) fs.mkdirSync(dossierBase, { recursive: true });
  const lireJSON = (f, defaut) => { if (!dossier) return defaut; try { return JSON.parse(coffre.lireTexte(f)); } catch { return defaut; } };
  const ecrireJSON = (f, v) => { if (dossier) { try { coffre.ecrire(f, JSON.stringify(v)); } catch (e) { console.error("Écriture impossible :", f, e.message); } } };

  /* ---------- données ---------- */
  const base = {}; let seq = lireJSON(dossier && fichier("base-meta.json"), { seq: 0 }).seq || 0;
  for (const col of C.COLLECTIONS_SERVEUR) { base[col] = new Map(); for (const r of lireJSON(dossierBase && path.join(dossierBase, `${col}.json`), [])) if (r && r.id) base[col].set(String(r.id), r); }
  const sauverCol = (col) => { ecrireJSON(dossierBase && path.join(dossierBase, `${col}.json`), [...base[col].values()]); ecrireJSON(dossier && fichier("base-meta.json"), { seq }); };

  /* ---------- comptes et sessions ---------- */
  const etatComptes = lireJSON(dossier && fichier("comptes.json"), { comptes: [], recuperation: null, resets: {} });
  etatComptes.resets ||= {};
  const sauverComptes = () => ecrireJSON(dossier && fichier("comptes.json"), etatComptes);
  const tableSessions = lireJSON(dossier && fichier("sessions.json"), {});
  const sessions = A.creerSessions(tableSessions, { maintenant });
  let minuteurSessions = null; const sauverSessions = () => { clearTimeout(minuteurSessions); minuteurSessions = setTimeout(() => ecrireJSON(dossier && fichier("sessions.json"), tableSessions), 200); minuteurSessions.unref?.(); };
  const limites = A.creerLimites({ maintenant });
  const compteParId = (id) => etatComptes.comptes.find((c) => c.id === id);
  const compteParEmail = (e) => etatComptes.comptes.find((c) => c.email === String(e || "").trim().toLowerCase());
  const publicCompte = (c) => ({ id: c.id, nom: c.nom, email: c.email, role: c.role, office: c.office || null, chauffeurId: c.chauffeurId || null, cloture: !!c.cloture, clotureDate: c.clotureDate || null, dernierAcces: c.dernierAcces || null, deuxFA: !!c.totp?.actif, cree: c.cree });
  const exige2FA = (c) => c.role === "chef_entreprise" && !c.totp?.actif;
  const chefsActifs = () => etatComptes.comptes.filter((c) => c.role === "chef_entreprise" && !c.cloture);

  /* ---------- journal ---------- */
  const fichierAudit = () => fichier("audit.jsonl"); const auditMem = [];
  if (dossier) { try { const limite = maintenant() - retentionAuditJours * 86400000, garder = []; for (const l of fs.readFileSync(fichierAudit(), "utf8").split("\n")) { if (!l) continue; try { const a = JSON.parse(coffre.delire(l)); if (a.t >= limite) garder.push(l); } catch { /* ligne abîmée */ } } ecrireAtomique(fichierAudit(), garder.join("\n") + (garder.length ? "\n" : "")); } catch { /* aucun journal */ } }
  function auditer(entree) {
    const e = { t: maintenant(), ...entree };
    if (dossier) { try { fs.appendFileSync(fichierAudit(), coffre.ligne(JSON.stringify(e)) + "\n", { mode: 0o600 }); } catch { /* garde en mémoire */ } } else auditMem.push(e);
  }
  function lireAudit() {
    if (!dossier) return auditMem.slice();
    try { return fs.readFileSync(fichierAudit(), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(coffre.delire(l)); } catch { return null; } }).filter(Boolean); } catch { return []; }
  }

  /* ---------- temps réel ---------- */
  const clientsSse = new Set(), verrous = new Map();
  const envoyerSse = (client, evenement, donnees) => { try { client.res.write(`event: ${evenement}\ndata: ${JSON.stringify(donnees)}\n\n`); } catch { clientsSse.delete(client); } };
  const diffuser = (evenement, donnees, filtre = () => true) => { for (const c of clientsSse) { const u = compteParId(c.u); if (!u || u.cloture) { try { c.res.end(); } catch { /* fermé */ } clientsSse.delete(c); continue; } if (filtre(u)) envoyerSse(c, evenement, donnees); } };
  const battement = setInterval(() => { for (const c of clientsSse) { try { c.res.write(": battement\n\n"); } catch { clientsSse.delete(c); } } }, 25000); battement.unref?.();
  const verrouActif = (col, id) => { const v = verrous.get(`${col}/${id}`); if (v && v.exp <= maintenant()) { verrous.delete(`${col}/${id}`); return null; } return v || null; };
  const listeVerrous = () => [...verrous.entries()].filter(([, v]) => v.exp > maintenant()).map(([k, v]) => ({ cle: k, nom: v.nom, u: v.u, raison: v.raison, exp: v.exp }));

  /* ---------- périmètre de chaque compte ---------- */
  const ctxPour = (u) => ({ camionsDuChauffeur: u.role === "chauffeur" && u.chauffeurId ? [...base.voyages.values()].filter((v) => !v._suppr && v.chauffeurId === u.chauffeurId).map((v) => v.camionId).filter(Boolean) : [] });
  const sortie = (col, r, u) => { const f = C.filtrerEnregistrement(col, r, u); if (!f) return null; const { _par, _suppr, ...reste } = f; return reste; };
  function vuePour(u) {
    const ctx = ctxPour(u), collections = {};
    for (const col of C.COLLECTIONS_SERVEUR) { if (!C.droitsSur(u, col)) continue; collections[col] = [...base[col].values()].filter((r) => !r._suppr && C.peutVoir(col, r, u, ctx)).map((r) => sortie(col, r, u)); }
    return collections;
  }

  /* ---------- écriture d'un enregistrement ---------- */
  function ecrire(u, col, id, propose, siVersion, { forcer = false } = {}) {
    if (!C.COLLECTIONS_SERVEUR.includes(col) || !/^[A-Za-z0-9_:.-]{1,80}$/.test(id)) return { code: 400, corps: { erreur: "Collection ou identifiant invalide." } };
    const brut = base[col].get(id), avant = brut && !brut._suppr ? brut : null, ctx = ctxPour(u);
    if (avant && (siVersion === undefined || siVersion === null || siVersion === "")) return { code: 428, corps: { erreur: "En-tête If-Match obligatoire pour modifier un enregistrement existant." } };
    if (avant && siVersion !== "*" && Number(siVersion) !== avant._v) { auditer({ u: u.id, nom: u.nom, action: "conflit", col, id, details: { version_envoyee: Number(siVersion), version_serveur: avant._v } }); return { code: 409, corps: { erreur: "Modifié entre-temps par un autre utilisateur.", actuel: C.peutVoir(col, avant, u, ctx) ? sortie(col, avant, u) : null, par: compteParId(avant._par)?.nom || "" } }; }
    const v = verrouActif(col, id); if (v && v.u !== u.id && !forcer) return { code: 423, corps: { erreur: `${v.nom} est en train de modifier cet enregistrement.`, verrou: { nom: v.nom, exp: v.exp } } };
    const r = C.appliquerEcriture(col, avant, propose, u, ctx);
    if (!r.ok) { auditer({ u: u.id, nom: u.nom, action: "refus", col, id, details: { raison: r.raison } }); return { code: 403, corps: { erreur: r.raison } }; }
    const diff = C.diffEnregistrement(avant, { ...r.enregistrement, id });
    if (avant && !Object.keys(diff).length) return { code: 200, corps: { ok: true, enregistrement: sortie(col, avant, u), inchange: true } };
    seq++; const rec = { ...r.enregistrement, id, _v: (brut?._v || 0) + 1, _seq: seq, _maj: maintenant(), _par: u.id };
    base[col].set(id, rec); sauverCol(col);
    auditer({ u: u.id, nom: u.nom, action: avant ? "modification" : "creation", col, id, diff });
    diffuser("change", { col, id, seq, v: rec._v, par: u.nom }, (x) => !!C.droitsSur(x, col));
    return { code: avant ? 200 : 201, corps: { ok: true, enregistrement: sortie(col, rec, u) } };
  }
  function supprimer(u, col, id, siVersion, { forcer = false } = {}) {
    const brut = base[col]?.get(id); if (!brut || brut._suppr) return { code: 404, corps: { erreur: "Introuvable." } };
    const ctx = ctxPour(u);
    if (!C.peutSupprimer(col, brut, u, ctx)) { auditer({ u: u.id, nom: u.nom, action: "refus", col, id, details: { raison: "suppression non autorisée" } }); return { code: 403, corps: { erreur: "Suppression non autorisée pour votre rôle." } }; }
    if (siVersion !== undefined && siVersion !== null && siVersion !== "*" && Number(siVersion) !== brut._v) return { code: 409, corps: { erreur: "Modifié entre-temps par un autre utilisateur.", actuel: sortie(col, brut, u) } };
    const v = verrouActif(col, id); if (v && v.u !== u.id && !forcer) return { code: 423, corps: { erreur: `${v.nom} est en train de modifier cet enregistrement.`, verrou: { nom: v.nom, exp: v.exp } } };
    seq++; base[col].set(id, { ...brut, _suppr: true, _v: brut._v + 1, _seq: seq, _maj: maintenant(), _par: u.id }); sauverCol(col); // suppression douce : restaurable, tracée
    auditer({ u: u.id, nom: u.nom, action: "suppression", col, id, diff: C.diffEnregistrement(brut, {}) });
    diffuser("change", { col, id, seq, suppr: true, par: u.nom }, (x) => !!C.droitsSur(x, col));
    return { code: 200, corps: { ok: true } };
  }
  /** Changements depuis un numéro de séquence : enregistrements visibles modifiés, et suppressions (ou sorties du périmètre). */
  function changements(u, depuis) {
    const ctx = ctxPour(u), r = [];
    for (const col of C.COLLECTIONS_SERVEUR) {
      if (!C.droitsSur(u, col)) continue;
      for (const rec of base[col].values()) if (rec._seq > depuis) r.push(rec._suppr || !C.peutVoir(col, rec, u, ctx) ? { col, id: rec.id, supprime: true, seq: rec._seq } : { col, id: rec.id, seq: rec._seq, enregistrement: sortie(col, rec, u) });
    }
    return { seq, changements: r.sort((a, b) => a.seq - b.seq) };
  }

  /* ---------- import initial (données de l'appareil de l'opérateur) ---------- */
  function importer(donnees, u) {
    let n = 0;
    for (const col of C.COLLECTIONS_SERVEUR) {
      const liste = col === "reglages" ? C.REGLAGES_IDS.filter((k) => donnees?.[k] && typeof donnees[k] === "object").map((k) => ({ ...donnees[k], id: k })) : Array.isArray(donnees?.[col]) ? donnees[col] : [];
      for (const r of liste) { if (!r || typeof r !== "object" || !r.id) continue; seq++; base[col].set(String(r.id), { ...r, id: String(r.id), _v: 1, _seq: seq, _maj: maintenant(), _par: u.id }); n++; }
      sauverCol(col);
    }
    return n;
  }

  /* ---------- HTTP ---------- */
  const lireCookies = (req) => Object.fromEntries(String(req.headers.cookie || "").split(";").map((x) => x.trim().split("=")).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
  const cookie = (nom, val, ageS, chemin = "/") => `${nom}=${encodeURIComponent(val)}; Path=${chemin}; Max-Age=${ageS}; HttpOnly; SameSite=Strict${cookieSecurise ? "; Secure" : ""}`;
  const cookiesSession = (s) => [cookie("lf_acces", s.acces, Math.floor(A.ACCES_MS / 1000)), cookie("lf_renouv", s.renouvellement, Math.floor(A.RENOUV_MS / 1000), "/api/auth")];
  const effacerCookies = () => [cookie("lf_acces", "", 0), cookie("lf_renouv", "", 0, "/api/auth")];
  /** Compte de la requête : jeton d'accès (en-tête Authorization ou cookie). viaCookie : pour la protection contre les requêtes intersites. */
  function identifier(req) {
    const h = req.headers.authorization || "", bearer = h.startsWith("Bearer ") ? h.slice(7).trim() : "", ck = lireCookies(req).lf_acces || "";
    for (const [jeton, viaCookie] of [[bearer, false], [ck, true]]) { if (!jeton) continue; const s = sessions.lire(jeton); if (s) { const u = compteParId(s.u); if (u && !u.cloture) return { u, s, jeton, viaCookie }; } }
    return null;
  }
  const utilisateurDe = (req) => identifier(req)?.u || null;
  async function corpsJSON(req, max = 8 * 1024 * 1024) {
    const b = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error("trop gros"), { code: 413 }); b.push(c); }
    const t = Buffer.concat(b).toString("utf8"); if (!t) return {}; return JSON.parse(t);
  }
  const envoyer = (res, code, obj, entetes, extra = {}) => { res.writeHead(code, entetes({ "Content-Type": "application/json; charset=utf-8", ...extra })); res.end(JSON.stringify(obj)); };

  function servirStatique(req, res, p, entetes) {
    if (!["GET", "HEAD"].includes(req.method)) return false;
    const chemin = p === "/" ? "/index.html" : p;
    const ok = (/^\/[A-Za-z0-9_-]+\.(html|js|css|png|svg|json|webmanifest|ico|txt)$/.test(chemin) && !/^\/package(-lock)?\.json$/.test(chemin)) || /^\/vendor\/leaflet\/[A-Za-z0-9_./-]+\.(js|css|png)$/.test(chemin);
    if (!ok || chemin.includes("..")) return false;
    const f = path.join(racine, chemin); if (!f.startsWith(racine + path.sep)) return false;
    let o; try { o = fs.readFileSync(f); } catch { return false; }
    const ext = chemin.split(".").pop();
    if (chemin === "/sw.js") o = Buffer.from(o.toString("utf8").replace("__VERSION__", `relais-${version}-${crypto.createHash("sha1").update(o).digest("hex").slice(0, 8)}`));
    res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": ["html", "js", "css", "webmanifest"].includes(ext) ? "no-cache" : "public, max-age=86400", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
    res.end(req.method === "HEAD" ? undefined : o); return true;
  }

  /** Traite une requête du mode multi-utilisateur ; renvoie vrai si elle a été traitée. */
  async function traiter(req, res, url, p, ip, entetes, jetonLectureOk) {
    if (!p.startsWith("/api/")) return servirStatique(req, res, p, entetes);
    const m = p.match(/^\/api\/(auth|utilisateurs|donnees|records|changes|sse|verrous|journal)(?:\/(.*))?$/); if (!m) return false;
    const [, zone, reste = ""] = m, t = maintenant(), j = (code, obj, extra) => (envoyer(res, code, obj, entetes, extra), true);
    let corps = {};
    if (["POST", "PUT", "DELETE"].includes(req.method)) { try { corps = await corpsJSON(req); } catch (e) { return j(e.code === 413 ? 413 : 400, { erreur: e.code === 413 ? "Corps trop volumineux." : "JSON invalide." }); } }

    /* --- authentification (sans session) --- */
    if (zone === "auth") {
      if (reste === "etat" && req.method === "GET") return j(200, { multi: true, initialise: etatComptes.comptes.length > 0, version, reinitialisationParEmail: !!smtp });
      if (reste === "initialiser" && req.method === "POST") {
        if (etatComptes.comptes.length) return j(409, { erreur: "Déjà initialisé." });
        if (!jetonLectureOk) return j(401, { erreur: "Le jeton de lecture du relais est nécessaire pour créer le premier compte." });
        if (!C.emailCompteValide(corps.email) || !C.motDePasseValide(corps.motDePasse) || !String(corps.nom || "").trim()) return j(400, { erreur: "Nom, adresse e-mail et mot de passe (12 caractères au moins) obligatoires." });
        const chef = { id: crypto.randomBytes(9).toString("base64url"), nom: String(corps.nom).trim().slice(0, 80), email: corps.email.trim().toLowerCase(), role: "chef_entreprise", office: ["maroc", "allemagne"].includes(corps.office) ? corps.office : null, hash: A.hacherMotDePasse(corps.motDePasse), cree: t, reseaux: [] };
        const code = A.base32(crypto.randomBytes(15)).match(/.{4}/g).join("-");
        etatComptes.comptes.push(chef); etatComptes.recuperation = A.hacherMotDePasse(code); sauverComptes();
        const n = corps.donnees ? importer(corps.donnees, chef) : 0;
        auditer({ u: chef.id, nom: chef.nom, action: "initialisation", details: { enregistrements: n } });
        return j(201, { ok: true, codeRecuperation: code, importes: n });
      }
      if (reste === "login" && req.method === "POST") {
        if (!limites.essaiIp(ip)) return j(429, { erreur: "Trop d'essais : patientez une minute." });
        const c = compteParEmail(corps.email);
        if (c && limites.bloqueJusqua(c)) return j(423, { erreur: "Compte bloqué après plusieurs échecs : réessayez plus tard.", jusqua: c.verrouJusqua });
        const ok = A.verifierMotDePasse(String(corps.motDePasse || ""), c?.hash);
        if (!ok || !c || c.cloture) { if (c) { limites.echec(c); sauverComptes(); } auditer({ u: c?.id || null, nom: c?.nom || String(corps.email || "").slice(0, 80), action: "echec_connexion", details: { ip: A.prefixeReseau(ip) } }); return j(401, { erreur: "Adresse ou mot de passe incorrect." }); }
        if (c.totp?.actif) {
          if (!corps.code) return j(401, { erreur: "Code de double authentification requis.", exige: "code" });
          const pas = A.verifierTotp(c.totp.secret, corps.code, t, c.totp.dernierPas ?? -1);
          if (pas === null) { limites.echec(c); sauverComptes(); auditer({ u: c.id, nom: c.nom, action: "echec_connexion", details: { raison: "code" } }); return j(401, { erreur: "Code incorrect.", exige: "code" }); }
          c.totp.dernierPas = pas;
        }
        const reseau = A.prefixeReseau(ip), nouveau = (c.reseaux || []).length > 0 && !c.reseaux.includes(reseau);
        if (nouveau) { auditer({ u: c.id, nom: c.nom, action: "reseau_inhabituel", details: { reseau } }); alerter({ texte: `Connexion de ${c.nom} depuis un réseau inhabituel (${reseau}.x)`, niveau: "warn", cle: `reseau:${c.id}:${reseau}` }); diffuser("securite", { texte: `Connexion de ${c.nom} depuis un réseau inhabituel` }, C.estChef); }
        limites.succes(c); c.dernierAcces = t; c.reseaux = [reseau, ...(c.reseaux || []).filter((x) => x !== reseau)].slice(0, 5); sauverComptes();
        const s = sessions.ouvrir(c.id, A.prefixeReseau(ip)); sauverSessions();
        auditer({ u: c.id, nom: c.nom, action: "connexion", details: { reseau, nouveauReseau: nouveau } });
        return j(200, { ok: true, acces: s.acces, renouvellement: s.renouvellement, expire: s.expireAcces, utilisateur: publicCompte(c), droits: C.droitsRole(c.role), exige2FA: exige2FA(c) }, { "Set-Cookie": cookiesSession(s) });
      }
      if (reste === "refresh" && req.method === "POST") {
        const r = sessions.renouveler(corps.renouvellement || lireCookies(req).lf_renouv || "", A.prefixeReseau(ip)); sauverSessions();
        if (r.erreur) { if (r.erreur === "reutilise") auditer({ u: null, action: "jeton_reutilise", details: { reseau: A.prefixeReseau(ip) } }); return j(401, { erreur: "Session expirée : reconnectez-vous." }, { "Set-Cookie": effacerCookies() }); }
        const c = compteParId(r.u); if (!c || c.cloture) { sessions.revoquerCompte(r.u); return j(401, { erreur: "Compte clôturé." }, { "Set-Cookie": effacerCookies() }); }
        return j(200, { ok: true, acces: r.acces, renouvellement: r.renouvellement, expire: r.expireAcces }, { "Set-Cookie": cookiesSession(r) });
      }
      if (reste === "reinitialiser" && req.method === "POST") {
        if (!limites.essaiIp(ip)) return j(429, { erreur: "Trop d'essais : patientez une minute." });
        const c = compteParEmail(corps.email);
        if (c && !c.cloture && smtp) {
          const jeton = crypto.randomBytes(24).toString("base64url"); etatComptes.resets[A.empreinte(jeton)] = { u: c.id, exp: t + 3600000 }; sauverComptes();
          const lien = `${urlPublique || `https://${req.headers.host}`}/#reinitialiser=${jeton}`;
          try { await courriel_(smtp, { a: c.email, sujet: "Logistique Fret — nouveau mot de passe", texte: `Bonjour ${c.nom},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien dans l'heure :\n${lien}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.` }); } catch { /* même réponse : on ne révèle rien */ }
          auditer({ u: c.id, nom: c.nom, action: "reinitialisation_demandee" });
        }
        return j(200, { ok: true, note: "Si ce compte existe, un e-mail vient de partir." });
      }
      if (reste === "reinitialiser/confirmer" && req.method === "POST") {
        const e = A.empreinte(corps.jeton || ""), r = etatComptes.resets[e];
        if (!r || r.exp < t) return j(400, { erreur: "Lien expiré ou déjà utilisé." });
        if (!C.motDePasseValide(corps.motDePasse)) return j(400, { erreur: "12 caractères au moins." });
        const c = compteParId(r.u); delete etatComptes.resets[e]; if (!c) return j(400, { erreur: "Compte introuvable." });
        c.hash = A.hacherMotDePasse(corps.motDePasse); limites.succes(c); sauverComptes(); sessions.revoquerCompte(c.id); sauverSessions();
        auditer({ u: c.id, nom: c.nom, action: "mot_de_passe_reinitialise" }); return j(200, { ok: true });
      }
      if (reste === "recuperation" && req.method === "POST") {
        if (!limites.essaiIp(ip)) return j(429, { erreur: "Trop d'essais : patientez une minute." });
        const code = String(corps.code || "").toUpperCase().replace(/[^A-Z2-7]/g, "").match(/.{1,4}/g)?.join("-") || "";
        if (!etatComptes.recuperation || !A.verifierMotDePasse(code, etatComptes.recuperation)) { auditer({ u: null, action: "echec_recuperation", details: { reseau: A.prefixeReseau(ip) } }); return j(401, { erreur: "Clé de récupération incorrecte." }); }
        if (!C.motDePasseValide(corps.motDePasse)) return j(400, { erreur: "12 caractères au moins." });
        const c = (corps.email && compteParEmail(corps.email)?.role === "chef_entreprise" ? compteParEmail(corps.email) : null) || etatComptes.comptes.find((x) => x.role === "chef_entreprise");
        c.hash = A.hacherMotDePasse(corps.motDePasse); c.cloture = false; delete c.totp; limites.succes(c);
        const nouveau = A.base32(crypto.randomBytes(15)).match(/.{4}/g).join("-"); etatComptes.recuperation = A.hacherMotDePasse(nouveau); sauverComptes(); sessions.revoquerCompte(c.id); sauverSessions();
        auditer({ u: c.id, nom: c.nom, action: "recuperation" }); return j(200, { ok: true, email: c.email, codeRecuperation: nouveau });
      }
    }

    /* --- tout le reste exige une session --- */
    const id_ = identifier(req);
    if (!id_) return j(401, { erreur: "Connexion requise." });
    const { u, s, jeton, viaCookie } = id_;
    if (viaCookie && !["GET", "HEAD"].includes(req.method) && req.headers["x-lf"] !== "1") return j(403, { erreur: "Requête refusée (en-tête X-LF manquant)." });

    if (zone === "auth") {
      if (reste === "me" && req.method === "GET") return j(200, { utilisateur: publicCompte(u), droits: C.droitsRole(u.role), exige2FA: exige2FA(u), roles: C.ROLES_COMPTES });
      if (reste === "logout" && req.method === "POST") { sessions.fermer(jeton); sauverSessions(); auditer({ u: u.id, nom: u.nom, action: "deconnexion" }); return j(200, { ok: true }, { "Set-Cookie": effacerCookies() }); }
      if (reste === "mot-de-passe" && req.method === "POST") {
        if (!A.verifierMotDePasse(String(corps.ancien || ""), u.hash)) return j(401, { erreur: "Mot de passe actuel incorrect." });
        if (!C.motDePasseValide(corps.nouveau)) return j(400, { erreur: "12 caractères au moins." });
        u.hash = A.hacherMotDePasse(corps.nouveau); sauverComptes(); sessions.revoquerCompte(u.id, s.fam); sauverSessions(); // les autres appareils sont déconnectés
        auditer({ u: u.id, nom: u.nom, action: "mot_de_passe_change" }); return j(200, { ok: true });
      }
      if (reste === "2fa/initier" && req.method === "POST") { if (u.totp?.actif) return j(409, { erreur: "Déjà active." }); u.totp = { actif: false, secret: A.secretTotp() }; sauverComptes(); return j(200, { secret: u.totp.secret, uri: A.uriTotp(u.totp.secret, u.email) }); }
      if (reste === "2fa/activer" && req.method === "POST") {
        if (!u.totp?.secret) return j(400, { erreur: "Commencez par « initier »." });
        const pas = A.verifierTotp(u.totp.secret, corps.code, t, -1); if (pas === null) return j(400, { erreur: "Code incorrect : vérifiez l'heure du téléphone." });
        u.totp.actif = true; u.totp.dernierPas = pas; sauverComptes(); auditer({ u: u.id, nom: u.nom, action: "double_authentification_activee" }); return j(200, { ok: true });
      }
      if (reste === "2fa/desactiver" && req.method === "POST") {
        if (u.role === "chef_entreprise") return j(403, { erreur: "Obligatoire pour le chef d'entreprise." });
        if (!A.verifierMotDePasse(String(corps.motDePasse || ""), u.hash)) return j(401, { erreur: "Mot de passe incorrect." });
        delete u.totp; sauverComptes(); auditer({ u: u.id, nom: u.nom, action: "double_authentification_desactivee" }); return j(200, { ok: true });
      }
      return j(404, { erreur: "Introuvable." });
    }
    if (exige2FA(u)) return j(403, { erreur: "Activez d'abord la double authentification (obligatoire pour le chef d'entreprise).", code: "2fa_requise" });

    if (zone === "utilisateurs") {
      if (!C.estChef(u)) return j(403, { erreur: "Réservé au chef d'entreprise." });
      if (!reste && req.method === "GET") return j(200, { utilisateurs: etatComptes.comptes.map(publicCompte), roles: C.ROLES_COMPTES });
      const roleOk = (r) => C.ROLES_COMPTES.some(([k]) => k === r);
      if (!reste && req.method === "POST") {
        if (!C.emailCompteValide(corps.email) || !String(corps.nom || "").trim() || !roleOk(corps.role)) return j(400, { erreur: "Nom, adresse e-mail et rôle obligatoires." });
        if (compteParEmail(corps.email)) return j(409, { erreur: "Un compte existe déjà avec cette adresse." });
        if (!C.motDePasseValide(corps.motDePasse)) return j(400, { erreur: "Mot de passe provisoire : 12 caractères au moins." });
        const c = { id: crypto.randomBytes(9).toString("base64url"), nom: String(corps.nom).trim().slice(0, 80), email: corps.email.trim().toLowerCase(), role: corps.role, office: ["maroc", "allemagne"].includes(corps.office) ? corps.office : null, chauffeurId: corps.chauffeurId ? String(corps.chauffeurId).slice(0, 80) : null, hash: A.hacherMotDePasse(corps.motDePasse), cree: t, reseaux: [] };
        etatComptes.comptes.push(c); sauverComptes(); auditer({ u: u.id, nom: u.nom, action: "compte_cree", col: "utilisateurs", id: c.id, diff: C.diffEnregistrement({}, publicCompte(c)) });
        return j(201, { ok: true, utilisateur: publicCompte(c) });
      }
      const c = compteParId(reste);
      if (c && req.method === "PUT") {
        const avant = publicCompte(c), seulChef = c.role === "chef_entreprise" && !c.cloture && chefsActifs().length === 1;
        if (corps.role !== undefined && !roleOk(corps.role)) return j(400, { erreur: "Rôle inconnu." });
        if (seulChef && ((corps.role && corps.role !== "chef_entreprise") || corps.cloture === true)) return j(409, { erreur: "Il faut garder au moins un chef d'entreprise actif." });
        if (corps.email !== undefined) { if (!C.emailCompteValide(corps.email)) return j(400, { erreur: "Adresse invalide." }); const autre = compteParEmail(corps.email); if (autre && autre !== c) return j(409, { erreur: "Adresse déjà utilisée." }); c.email = corps.email.trim().toLowerCase(); }
        if (corps.nom !== undefined) c.nom = String(corps.nom).trim().slice(0, 80) || c.nom;
        if (corps.role !== undefined) c.role = corps.role;
        if (corps.office !== undefined) c.office = ["maroc", "allemagne"].includes(corps.office) ? corps.office : null;
        if (corps.chauffeurId !== undefined) c.chauffeurId = corps.chauffeurId ? String(corps.chauffeurId).slice(0, 80) : null;
        let revoquer = false;
        if (corps.cloture === true && !c.cloture) { c.cloture = true; c.clotureDate = t; revoquer = true; } else if (corps.cloture === false && c.cloture) { c.cloture = false; delete c.clotureDate; }
        if (corps.motDePasse !== undefined) { if (!C.motDePasseValide(corps.motDePasse)) return j(400, { erreur: "12 caractères au moins." }); c.hash = A.hacherMotDePasse(corps.motDePasse); limites.succes(c); revoquer = true; }
        if (corps.reinitialiser2FA === true) { delete c.totp; revoquer = true; }
        if (corps.role !== undefined && corps.role !== avant.role) revoquer = true;
        sauverComptes(); if (revoquer) { sessions.revoquerCompte(c.id); sauverSessions(); diffuser("deconnexion", {}, (x) => x.id === c.id); }
        auditer({ u: u.id, nom: u.nom, action: "compte_modifie", col: "utilisateurs", id: c.id, diff: { ...C.diffEnregistrement(avant, publicCompte(c)), ...(corps.motDePasse !== undefined ? { motDePasse: ["•••", "•••"] } : {}) } });
        return j(200, { ok: true, utilisateur: publicCompte(c) });
      }
      return j(404, { erreur: "Compte introuvable." });
    }
    if (zone === "donnees" && req.method === "GET") return j(200, { seq, collections: vuePour(u), verrous: listeVerrous(), utilisateur: publicCompte(u), droits: C.droitsRole(u.role), utilisateurs: etatComptes.comptes.filter((c) => !c.cloture).map((c) => ({ id: c.id, nom: c.nom, role: c.role, office: c.office || null })) });
    if (zone === "records") {
      const [col, id] = reste.split("/").map((x) => decodeURIComponent(x || ""));
      if (!C.COLLECTIONS_SERVEUR.includes(col)) return j(404, { erreur: "Collection inconnue." });
      const dr = C.droitsSur(u, col); if (!dr) { auditer({ u: u.id, nom: u.nom, action: "refus", col, id, details: { raison: "lecture non autorisée" } }); return j(403, { erreur: "Accès non autorisé pour votre rôle." }); }
      const forcer = req.headers["x-forcer"] === "1", siVersion = req.headers["if-match"]?.replace(/"/g, "");
      if (!id && req.method === "GET") { const ctx = ctxPour(u); return j(200, { enregistrements: [...base[col].values()].filter((r) => !r._suppr && C.peutVoir(col, r, u, ctx)).map((r) => sortie(col, r, u)) }); }
      if (req.method === "GET") { const r = base[col].get(id); if (!r || r._suppr || !C.peutVoir(col, r, u, ctxPour(u))) return j(404, { erreur: "Introuvable." }); return j(200, { enregistrement: sortie(col, r, u) }, { ETag: `"${r._v}"` }); }
      if (req.method === "PUT") { const r = ecrire(u, col, id, corps, siVersion, { forcer }); return j(r.code, r.corps); }
      if (req.method === "DELETE") { const r = supprimer(u, col, id, siVersion, { forcer }); return j(r.code, r.corps); }
    }
    if (zone === "changes" && req.method === "GET") return j(200, changements(u, Number(url.searchParams.get("since")) || 0));
    if (zone === "sse" && req.method === "GET") {
      res.writeHead(200, entetes({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" }));
      const client = { res, u: u.id }; clientsSse.add(client);
      res.write(`retry: 2000\nevent: bonjour\ndata: ${JSON.stringify({ seq, verrous: listeVerrous() })}\n\n`);
      req.on("close", () => clientsSse.delete(client)); return true;
    }
    if (zone === "verrous") {
      if (req.method === "POST") {
        const col = String(corps.col || ""), id = String(corps.id || "");
        if (!C.droitsSur(u, col)?.ecriture) return j(403, { erreur: "Écriture non autorisée pour votre rôle." });
        const v = verrouActif(col, id); if (v && v.u !== u.id) return j(423, { erreur: `${v.nom} est en train de modifier cet enregistrement.`, verrou: { nom: v.nom, exp: v.exp } });
        const n = { u: u.id, nom: u.nom, exp: t + VERROU_MS, raison: String(corps.raison || "").slice(0, 80) }; verrous.set(`${col}/${id}`, n);
        diffuser("verrou", { cle: `${col}/${id}`, nom: u.nom, u: u.id, raison: n.raison, exp: n.exp }); return j(200, { ok: true, exp: n.exp });
      }
      if (req.method === "DELETE") { const [col, id] = reste.split("/").map(decodeURIComponent), v = verrouActif(col, id); if (v && v.u === u.id) { verrous.delete(`${col}/${id}`); diffuser("verrou", { cle: `${col}/${id}`, libere: true }); } return j(200, { ok: true }); }
    }
    if (zone === "journal" && req.method === "GET") {
      if (!C.estChef(u)) return j(403, { erreur: "Réservé au chef d'entreprise." });
      const q = (k) => url.searchParams.get(k) || "", debut = Date.parse(q("debut") || "") || 0, fin = q("fin") ? Date.parse(q("fin")) + 86400000 : Infinity;
      const l = lireAudit().filter((a) => a.t >= debut && a.t < fin && (!q("utilisateur") || a.u === q("utilisateur")) && (!q("collection") || a.col === q("collection")) && (!q("action") || a.action === q("action"))).reverse().slice(0, 5000);
      if (q("format") === "csv") {
        const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const csv = ["date;utilisateur;action;collection;enregistrement;details", ...l.map((a) => [new Date(a.t).toISOString(), a.nom || "", a.action, a.col || "", a.id || "", JSON.stringify(a.diff || a.details || {})].map(cel).join(";"))].join("\r\n");
        res.writeHead(200, entetes({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="journal-${new Date(t).toISOString().slice(0, 10)}.csv"` })); res.end("﻿" + csv); return true;
      }
      return j(200, { journal: l });
    }
    return j(404, { erreur: "Introuvable." });
  }

  return { brancherAlertes: (f) => { alerter = f; }, traiter, utilisateurDe, ecrire, supprimer, changements, vuePour, importer, auditer, lireAudit, sessions, comptes: () => etatComptes.comptes, base, seq: () => seq, clientsSse };
}

module.exports = { creerMulti };
