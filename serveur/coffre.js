"use strict";
/* ============================================================
   Chiffrement au repos des fichiers du relais (option CHIFFRER_DONNEES=true), sans dépendance.
   AES-256-GCM ; clé tirée d'une phrase secrète par scrypt (sel aléatoire propre à l'installation, non secret).
   Fichier chiffré : « LFC1 » + vecteur (12 octets) + étiquette (16 octets) + contenu. Ligne chiffrée : « ~ » + base64.
   Un fichier encore en clair (installation antérieure) est lu tel quel puis réécrit chiffré : la mise en place ne perd rien.
   Écritures atomiques (fichier temporaire puis renommage) : un arrêt brutal ne laisse pas de fichier à moitié écrit.
   Défense en profondeur : sur un serveur loué, chiffrez aussi le disque (LUKS) — voir docs/07-rgpd-deploiement.md.
   ============================================================ */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAGIE = Buffer.from("LFC1");
const estChiffre = (b) => Buffer.isBuffer(b) && b.length >= 32 && b.subarray(0, 4).equals(MAGIE);

function ecrireAtomique(fichier, donnees) {
  const tmp = `${fichier}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, donnees, { mode: 0o600 });
  fs.renameSync(tmp, fichier);
}

/** Coffre : avec une clé de 32 octets, chiffre ; sans clé, laisse passer (même interface). */
function creerCoffre(cle = null) {
  if (cle && (!Buffer.isBuffer(cle) || cle.length !== 32)) throw new Error("Clé de chiffrement : 32 octets attendus.");
  const chiffrer = (donnees) => {
    const b = Buffer.isBuffer(donnees) ? donnees : Buffer.from(String(donnees), "utf8");
    if (!cle) return b;
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", cle, iv), ct = Buffer.concat([c.update(b), c.final()]);
    return Buffer.concat([MAGIE, iv, c.getAuthTag(), ct]);
  };
  const dechiffrer = (b) => {
    if (!estChiffre(b)) return b; // fichier encore en clair
    if (!cle) throw new Error("Fichier chiffré : CHIFFRER_DONNEES et la clé sont nécessaires pour le lire.");
    const d = crypto.createDecipheriv("aes-256-gcm", cle, b.subarray(4, 16)); d.setAuthTag(b.subarray(16, 32));
    try { return Buffer.concat([d.update(b.subarray(32)), d.final()]); } catch { throw new Error("Fichier chiffré illisible : mauvaise clé ou fichier abîmé."); }
  };
  return {
    actif: !!cle, chiffrer, dechiffrer,
    lireTexte: (fichier) => dechiffrer(fs.readFileSync(fichier)).toString("utf8"),
    lireOctets: (fichier) => dechiffrer(fs.readFileSync(fichier)),
    ecrire: (fichier, donnees) => ecrireAtomique(fichier, chiffrer(donnees)),
    /** Une ligne d'un journal (positions, alertes) : chiffrée seule, pour pouvoir ajouter sans tout réécrire. */
    ligne: (texte) => (cle ? `~${chiffrer(texte).toString("base64")}` : String(texte)),
    delire: (l) => (l.startsWith("~") ? dechiffrer(Buffer.from(l.slice(1), "base64")).toString("utf8") : l),
  };
}

/** Clé de 32 octets tirée d'une phrase secrète (scrypt, N = 2^15). */
const cleDepuisPhrase = (phrase, sel) => crypto.scryptSync(String(phrase), sel, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

/**
 * Prépare le chiffrement au repos d'après l'environnement. Renvoie { coffre, nouvelle, fichierCle } (coffre passant si CHIFFRER_DONNEES n'est pas « true »).
 * Phrase secrète : CLE_DONNEES, sinon le fichier cle.env (CLE=…, mode 600), sinon générée au premier démarrage et écrite dans cle.env.
 * Conseil : gardez la phrase AILLEURS que les données (variable d'environnement, autre disque) et notez-la : sans elle, les données sont perdues.
 */
function chargerCoffre(dossier, env = process.env) {
  if (String(env.CHIFFRER_DONNEES || "").toLowerCase() !== "true") return { coffre: creerCoffre(null), nouvelle: false, fichierCle: null };
  fs.mkdirSync(dossier, { recursive: true });
  const fichierCle = env.FICHIER_CLE ? path.resolve(env.FICHIER_CLE) : path.join(dossier, "cle.env"), fichierSel = path.join(dossier, "sel.bin");
  let phrase = env.CLE_DONNEES || "", nouvelle = false;
  if (!phrase) { try { phrase = (fs.readFileSync(fichierCle, "utf8").match(/^CLE=(.+)$/m) || [])[1]?.trim() || ""; } catch { /* absent */ } }
  if (!phrase) { phrase = crypto.randomBytes(24).toString("base64url"); ecrireAtomique(fichierCle, `# Phrase secrète du chiffrement des données du relais. Sans elle, les données sont illisibles : sauvegardez-la ailleurs.\nCLE=${phrase}\n`); nouvelle = true; }
  if (phrase.length < 12) throw new Error("CLE_DONNEES : 12 caractères au moins.");
  let sel; try { sel = fs.readFileSync(fichierSel); } catch { sel = crypto.randomBytes(16); ecrireAtomique(fichierSel, sel); }
  return { coffre: creerCoffre(cleDepuisPhrase(phrase, sel)), nouvelle, fichierCle };
}

module.exports = { creerCoffre, chargerCoffre, cleDepuisPhrase, estChiffre, ecrireAtomique };
