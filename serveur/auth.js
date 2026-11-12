"use strict";
/* ============================================================
   Authentification du relais multi-utilisateur, sans dépendance.
   · mots de passe : scrypt (N = 2^15, sel aléatoire par compte), comparaison à temps constant ;
   · sessions : jetons opaques aléatoires (seule leur empreinte SHA-256 est gardée), accès 12 h, renouvellement 30 jours avec rotation
     et détection de réutilisation (un jeton de renouvellement déjà utilisé révoque toute la famille) ;
   · double authentification : TOTP (RFC 6238, 30 s, 6 chiffres, ± 1 pas, code déjà utilisé refusé) ;
   · limites : 10 essais par minute et par adresse ; 5 échecs → compte bloqué 15 min ; 3 blocages → 1 h.
   ============================================================ */
const crypto = require("crypto");

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function hacherMotDePasse(mdp) {
  const sel = crypto.randomBytes(16), h = crypto.scryptSync(String(mdp), sel, 32, SCRYPT);
  return `scrypt$15$8$1$${sel.toString("base64")}$${h.toString("base64")}`;
}
const HACHE_LEURRE = hacherMotDePasse("leurre-pour-temps-constant");
/** Vérifie un mot de passe ; un compte inconnu passe aussi par scrypt (même durée : on ne devine pas les adresses). */
function verifierMotDePasse(mdp, hache) {
  const p = String(hache || HACHE_LEURRE).split("$");
  if (p.length !== 6 || p[0] !== "scrypt") return false;
  const attendu = Buffer.from(p[5], "base64"), calc = crypto.scryptSync(String(mdp), Buffer.from(p[4], "base64"), attendu.length, { N: 2 ** Number(p[1]), r: Number(p[2]), p: Number(p[3]), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(attendu, calc) && !!hache;
}

/* ---------- TOTP ---------- */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const base32 = (b) => { let bits = 0, v = 0, s = ""; for (const o of b) { v = (v << 8) | o; bits += 8; while (bits >= 5) { s += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) s += B32[(v << (5 - bits)) & 31]; return s; };
const debase32 = (s) => { const o = []; let bits = 0, v = 0; for (const c of String(s).toUpperCase().replace(/[\s=]/g, "")) { const i = B32.indexOf(c); if (i < 0) throw new Error("Secret TOTP invalide."); v = (v << 5) | i; bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const secretTotp = () => base32(crypto.randomBytes(20));
function hotp(secret, compteur) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(compteur));
  const h = crypto.createHmac("sha1", debase32(secret)).update(c).digest(), o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}
const totp = (secret, t = Date.now()) => hotp(secret, Math.floor(t / 30000));
/** Vérifie un code (± 1 pas de 30 s). Renvoie le pas accepté (à mémoriser pour refuser sa réutilisation), ou null. */
function verifierTotp(secret, code, t = Date.now(), dernierPas = -1) {
  if (!secret || !/^\d{6}$/.test(String(code || "").trim())) return null;
  const pas = Math.floor(t / 30000);
  for (const p of [pas, pas - 1, pas + 1]) if (p > dernierPas && crypto.timingSafeEqual(Buffer.from(hotp(secret, p)), Buffer.from(String(code).trim()))) return p;
  return null;
}
const uriTotp = (secret, compte, emetteur = "Logistique Fret") => `otpauth://totp/${encodeURIComponent(emetteur)}:${encodeURIComponent(compte)}?secret=${secret}&issuer=${encodeURIComponent(emetteur)}&algorithm=SHA1&digits=6&period=30`;

/* ---------- sessions ---------- */
const ACCES_MS = 12 * 3600000, RENOUV_MS = 30 * 86400000;
const empreinte = (jeton) => crypto.createHash("sha256").update(String(jeton)).digest("hex");
const jetonAleatoire = () => crypto.randomBytes(32).toString("base64url");
/** Gestion des sessions. `table` : objet { empreinte: { u, type, exp, fam, ip } } (persisté par l'appelant). */
function creerSessions(table = {}, { maintenant = () => Date.now() } = {}) {
  const usages = new Map(); // empreinte d'un renouvellement déjà utilisé → famille (détection de vol)
  const nettoyer = () => { const t = maintenant(); for (const [k, s] of Object.entries(table)) if (s.exp < t) delete table[k]; };
  function ouvrir(u, ip = "", fam = crypto.randomBytes(8).toString("hex")) {
    nettoyer(); const t = maintenant(), acces = jetonAleatoire(), renouv = jetonAleatoire();
    table[empreinte(acces)] = { u, type: "acces", exp: t + ACCES_MS, fam, ip };
    table[empreinte(renouv)] = { u, type: "renouvellement", exp: t + RENOUV_MS, fam, ip };
    return { acces, renouvellement: renouv, expireAcces: t + ACCES_MS, famille: fam };
  }
  const lire = (jeton, type = "acces") => { const s = table[empreinte(jeton)]; return s && s.type === type && s.exp > maintenant() ? s : null; };
  const revoquerFamille = (fam) => { for (const [k, s] of Object.entries(table)) if (s.fam === fam) delete table[k]; };
  /** Rotation : le jeton de renouvellement est consommé ; s'il a déjà servi, toute la famille est révoquée (jeton volé). */
  function renouveler(jeton, ip = "") {
    const e = empreinte(jeton), s = table[e];
    if (!s) { const fam = usages.get(e); if (fam) revoquerFamille(fam); return { erreur: fam ? "reutilise" : "inconnu" }; }
    if (s.type !== "renouvellement" || s.exp <= maintenant()) return { erreur: "expire" };
    delete table[e]; usages.set(e, s.fam); if (usages.size > 5000) usages.delete(usages.keys().next().value);
    for (const [k, x] of Object.entries(table)) if (x.fam === s.fam && x.type === "acces") delete table[k]; // l'ancien jeton d'accès cesse aussi
    return { u: s.u, ...ouvrir(s.u, ip, s.fam) };
  }
  const fermer = (jeton) => { const s = table[empreinte(jeton)]; if (s) revoquerFamille(s.fam); return !!s; };
  /** Révoque toutes les sessions d'un compte (mot de passe changé, compte clôturé), sauf éventuellement une famille. */
  const revoquerCompte = (u, sauf = null) => { for (const [k, s] of Object.entries(table)) if (s.u === u && s.fam !== sauf) delete table[k]; };
  return { ouvrir, lire, renouveler, fermer, revoquerCompte, table };
}

/* ---------- limites d'essais ---------- */
function creerLimites({ maintenant = () => Date.now() } = {}) {
  const parIp = new Map();
  /** Vrai si l'adresse a encore droit à un essai cette minute (10 par minute). */
  const essaiIp = (ip) => { const m = Math.floor(maintenant() / 60000), k = `${ip}|${m}`; const n = (parIp.get(k) || 0) + 1; parIp.set(k, n); if (parIp.size > 5000) for (const x of parIp.keys()) if (!x.endsWith(`|${m}`)) parIp.delete(x); return n <= 10; };
  /** Compte bloqué ? Renvoie la fin du blocage (ms) ou 0. */
  const bloqueJusqua = (c) => (c.verrouJusqua && c.verrouJusqua > maintenant() ? c.verrouJusqua : 0);
  /** Échec de connexion : 5 échecs → 15 min ; au 3e blocage (sur 24 h) → 1 h. Modifie le compte. */
  function echec(c) {
    const t = maintenant(); c.echecs = (c.echecs || 0) + 1;
    if (c.echecs >= 5) { c.echecs = 0; c.blocages = (c.blocagesDepuis && t - c.blocagesDepuis < 86400000 ? c.blocages || 0 : 0) + 1; if (c.blocages === 1) c.blocagesDepuis = t; c.verrouJusqua = t + (c.blocages >= 3 ? 3600000 : 15 * 60000); }
  }
  const succes = (c) => { c.echecs = 0; delete c.verrouJusqua; };
  return { essaiIp, bloqueJusqua, echec, succes };
}
/** Préfixe réseau d'une adresse (IPv4 : deux premiers octets ; IPv6 : deux premiers groupes) : sert à repérer une connexion depuis un réseau inhabituel. */
const prefixeReseau = (ip) => { const v = String(ip || "").replace(/^::ffff:/, ""); return v.includes(":") ? v.split(":").slice(0, 2).join(":") : v.split(".").slice(0, 2).join("."); };

module.exports = { hacherMotDePasse, verifierMotDePasse, secretTotp, totp, hotp, verifierTotp, uriTotp, base32, debase32, creerSessions, creerLimites, prefixeReseau, empreinte, ACCES_MS, RENOUV_MS };
