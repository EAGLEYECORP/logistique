"use strict";
/* ============================================================
   Pièces jointes des demandes (sans dépendance) : ce que la boîte e-mail reçoit avec une demande — bon de commande, facture,
   liste de colisage, certificat phytosanitaire — est gardé sur le relais jusqu'à ce que l'application le range sur la commande.
   · gardé : PDF, photos (JPEG, PNG, WebP, HEIC, TIFF), Excel, Word, CSV, jusqu'à 15 Mo la pièce et 10 par message ;
     le reste (archives, programmes, invitations…) n'est que nommé ;
   · chiffré au repos comme les autres données si le chiffrement est actif ; servi seulement avec le jeton de lecture ;
   · effacé quand l'application l'a rangé, quand la demande sort de la boîte (300 dernières), ou au bout de 30 jours ;
   · plafond total (PIECES_MAX_MO, 500 Mo par défaut) : au-delà, la pièce reste dans la messagerie, avec la raison.
   ============================================================ */
const fs = require("fs");
const path = require("path");

const TYPES_PIECES = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", ods: "application/vnd.oasis.opendocument.spreadsheet", csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword", odt: "application/vnd.oasis.opendocument.text",
};
const TYPES_GARDES = new Set(Object.values(TYPES_PIECES));
const ALIAS_TYPES = { "image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg", "application/x-pdf": "application/pdf", "application/acrobat": "application/pdf", "image/x-png": "image/png", "application/excel": "application/vnd.ms-excel", "application/x-excel": "application/vnd.ms-excel", "application/x-msexcel": "application/vnd.ms-excel", "text/comma-separated-values": "text/csv" };
const ID_DEMANDE = /^[A-Za-z0-9_-]{1,80}$/;

/** Type d'une pièce : celui annoncé s'il est gardé, sinon d'après l'extension du nom (« application/octet-stream » + « .pdf ») ; "" si non gardé. */
function typePiece(nom, type) {
  const t = ALIAS_TYPES[String(type || "").toLowerCase()] || String(type || "").toLowerCase();
  if (TYPES_GARDES.has(t)) return t;
  const ext = (String(nom || "").toLowerCase().match(/\.([a-z0-9]{2,5})$/) || [])[1];
  return ext && TYPES_PIECES[ext] ? TYPES_PIECES[ext] : "";
}

function creerPieces({ dossier = null, coffre, maxMo = 500, pieceMaxMo = 15, maxParMessage = 10, maintenant = () => Date.now() } = {}) {
  const index = new Map(), memoire = new Map(); // index : « demande/n » → { taille, t } ; memoire : contenu sans dossier (essais)
  const rep = dossier ? path.join(dossier, "pieces") : null, fichierIndex = () => path.join(dossier, "pieces.json");
  if (dossier) { fs.mkdirSync(rep, { recursive: true }); try { for (const [k, v] of Object.entries(JSON.parse(coffre.lireTexte(fichierIndex())))) index.set(k, v); } catch { /* aucune pièce */ } }
  const sauver = () => { if (dossier) { try { coffre.ecrire(fichierIndex(), JSON.stringify(Object.fromEntries(index))); } catch { /* garde en mémoire */ } } };
  const cle = (id, n) => `${id}/${n}`, chemin = (id, n) => path.join(rep, `${id}-${n}.bin`);
  const total = () => { let o = 0; for (const v of index.values()) o += v.taille; return o; };
  function effacerUne(k) {
    const [id, n] = k.split("/"); index.delete(k);
    if (dossier) { try { fs.unlinkSync(chemin(id, n)); } catch { /* déjà effacée */ } } else memoire.delete(k);
  }

  /**
   * Garde les pièces d'une demande ; renvoie la liste à montrer, sans le contenu : [{ n, nom, type, taille, garde, raison? }].
   * tronque : le message n'a pas pu être lu en entier (trop gros) — ses pièces sont seulement nommées ; sans : raison de n'en garder aucune.
   */
  function garder(id, pieces = [], { tronque = false, sans = "" } = {}) {
    if (!ID_DEMANDE.test(String(id))) return [];
    let gardees = 0;
    const liste = (pieces || []).slice(0, 20).map((p, i) => {
      const n = i + 1, nom = String(p.nom || "pièce jointe").replace(/[\u0000-\u001f\\/]/g, "_").slice(0, 120), type = typePiece(nom, p.type), taille = p.octets?.length ?? p.taille ?? 0;
      const o = { n, nom, type: type || String(p.type || "").slice(0, 100), taille, garde: false };
      if (sans) return { ...o, raison: sans };
      if (!type) return { ...o, raison: "type non gardé (seulement PDF, photos, Excel, Word)" };
      if (tronque || !p.octets) return { ...o, raison: "message trop volumineux : restée dans la messagerie" };
      if (taille > pieceMaxMo * 1048576) return { ...o, raison: `plus de ${pieceMaxMo} Mo : restée dans la messagerie` };
      if (gardees >= maxParMessage) return { ...o, raison: `plus de ${maxParMessage} pièces dans ce message : restée dans la messagerie` };
      if (total() + taille > maxMo * 1048576) return { ...o, raison: "espace du relais plein : restée dans la messagerie" };
      try { if (dossier) coffre.ecrire(chemin(id, n), p.octets); else memoire.set(cle(id, n), Buffer.from(p.octets)); }
      catch { return { ...o, raison: "enregistrement impossible sur le relais" }; }
      index.set(cle(id, n), { taille, t: maintenant() }); gardees++;
      return { ...o, garde: true };
    });
    if (gardees) sauver();
    return liste;
  }
  /** Contenu d'une pièce (Buffer) ou null. */
  function lire(id, n) {
    if (!index.has(cle(id, n))) return null;
    try { return dossier ? coffre.lireOctets(chemin(id, n)) : memoire.get(cle(id, n)) || null; } catch { return null; }
  }
  /** Efface une pièce (rangée par l'application). */
  function effacer(id, n) { if (!index.has(cle(id, n))) return false; effacerUne(cle(id, n)); sauver(); return true; }
  /** Efface les pièces des demandes sorties de la boîte, et celles gardées depuis plus de `jours`. Renvoie le nombre effacé. */
  function purger(idsGardes = null, jours = 30) {
    const limite = maintenant() - jours * 86400000; let k = 0;
    for (const [c, v] of [...index]) if ((idsGardes && !idsGardes.has(c.split("/")[0])) || v.t < limite) { effacerUne(c); k++; }
    if (k) sauver();
    return k;
  }
  const resume = () => ({ nombre: index.size, octets: total() });
  return { garder, lire, effacer, purger, resume, aPiece: (id, n) => index.has(cle(id, n)) };
}

module.exports = { creerPieces, typePiece, TYPES_PIECES, ID_DEMANDE };
