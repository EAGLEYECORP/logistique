"use strict";
/* ============================================================
   Empreintes des fichiers préchargés pour le hors ligne (sans dépendance).
   À chaque publication, sw.js reçoit la version et l'empreinte (SHA-256, 16 caractères) de chaque fichier
   de sa liste FICHIERS : à la mise à jour, le téléphone garde les fichiers inchangés depuis sa copie
   hors ligne et ne télécharge que ceux qui ont changé (au lieu de toute l'application).
   Utilisé par la publication GitHub Pages (.github/workflows/pages.yml) et par le relais multi-utilisateur.
     node serveur/empreintes.js <dossier du site> <version>   → réécrit <dossier>/sw.js
   ============================================================ */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MARQUE_EMPREINTES = "/*__EMPREINTES__*/{}";

/** Liste FICHIERS de sw.js (chemins relatifs, "./" pour la page d'accueil). */
function fichiersPrecharges(sw) {
  const m = String(sw).match(/const FICHIERS = \[([\s\S]*?)\];/);
  if (!m) throw new Error("sw.js : liste FICHIERS introuvable");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}
/** Empreinte d'un contenu : SHA-256 en hexadécimal, 16 premiers caractères (comme le calcule sw.js). */
const empreinte = (octets) => crypto.createHash("sha256").update(octets).digest("hex").slice(0, 16);

/** sw.js prêt à servir : version posée, empreintes de chaque fichier préchargé tel qu'il sera servi (lire(chemin) → octets). */
function preparerSw(sw, version, lire) {
  const texte = String(sw);
  if (!texte.includes(MARQUE_EMPREINTES)) throw new Error("sw.js : emplacement des empreintes introuvable");
  const e = {};
  for (const f of fichiersPrecharges(texte)) {
    const o = lire(f === "./" ? "index.html" : f);
    if (!o) throw new Error(`Fichier préchargé absent : ${f}`);
    e[f] = empreinte(o);
  }
  return texte.replace("__VERSION__", version).replace(MARQUE_EMPREINTES, JSON.stringify(e));
}

module.exports = { fichiersPrecharges, empreinte, preparerSw, MARQUE_EMPREINTES };

if (require.main === module) {
  const [racine, version] = process.argv.slice(2);
  if (!racine || !version) { console.error("Usage : node serveur/empreintes.js <dossier du site> <version>"); process.exit(1); }
  const fichierSw = path.join(racine, "sw.js");
  const lire = (f) => { try { return fs.readFileSync(path.join(racine, f)); } catch { return null; } };
  fs.writeFileSync(fichierSw, preparerSw(fs.readFileSync(fichierSw, "utf8"), version, lire));
  console.log(`sw.js : version ${version}, ${fichiersPrecharges(fs.readFileSync(fichierSw, "utf8")).length} empreintes`);
}
