"use strict";
/* ============================================================
   Stockage « gros volumes » : IndexedDB
   - etat       : copie miroir de l'état (récupération si le stockage rapide est vidé)
                  + table de dédoublonnage des notifications
   - snapshots  : un instantané automatique par jour (7 conservés) + instantanés avant import/restauration
   - photos     : images compressées (Blob) indexées par « cible » ("commande:ID", "camion:ID"…)
   Aucun accès au DOM au chargement : ce fichier est aussi importé par le service worker.
   ============================================================ */

const IDB_NOM = "logistique-fret";
const IDB_VERSION = 1;
const SNAPSHOTS_AUTO_MAX = 7;
const SNAPSHOTS_MANUELS_MAX = 3;
let _idbOuverture = null;

const idbDisponible = () => typeof indexedDB !== "undefined";

function idbOuvrir() {
  if (!idbDisponible()) return Promise.reject(new Error("IndexedDB indisponible sur ce navigateur."));
  _idbOuverture ||= new Promise((ok, ko) => {
    const r = indexedDB.open(IDB_NOM, IDB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("etat")) db.createObjectStore("etat");
      if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots", { keyPath: "cle" });
      if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath: "id" }).createIndex("cible", "cible");
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => { r.result.close(); _idbOuverture = null; };
      ok(r.result);
    };
    r.onerror = () => { _idbOuverture = null; ko(r.error); };
  });
  return _idbOuverture;
}

const idbDemande = (req) => new Promise((ok, ko) => { req.onsuccess = () => ok(req.result); req.onerror = () => ko(req.error); });

/** Exécute fn(store…) dans une transaction ; résout une fois la transaction VALIDÉE (donnée réellement écrite). */
async function idbTx(stores, mode, fn) {
  const db = await idbOuvrir();
  const noms = [].concat(stores);
  return new Promise((ok, ko) => {
    const tx = db.transaction(noms, mode);
    let resultat;
    tx.oncomplete = () => ok(resultat);
    tx.onerror = () => ko(tx.error);
    tx.onabort = () => ko(tx.error || new Error("Transaction annulée."));
    Promise.resolve(fn(...noms.map((n) => tx.objectStore(n)))).then((r) => { resultat = r; }, (e) => { try { tx.abort(); } catch { /* déjà terminée */ } ko(e); });
  });
}

/* ---------- état : miroir + notifications ---------- */
const etatMiroirEcrire = (etat) => idbTx("etat", "readwrite", (st) => idbDemande(st.put({ ecrit: new Date().toISOString(), etat }, "courant")));
const etatMiroirLire = () => idbTx("etat", "readonly", (st) => idbDemande(st.get("courant")));
const notifiesLire = async () => (await idbTx("etat", "readonly", (st) => idbDemande(st.get("notifies")))) || {};
const notifiesEcrire = (map) => idbTx("etat", "readwrite", (st) => idbDemande(st.put(map, "notifies")));

let _tMiroir = null;
let _jourSnapshot = null;
/**
 * Appelé après chaque sauvegarde rapide. Écrit le miroir (différé) et prend, une fois par jour,
 * un instantané de l'état tel qu'il était AVANT la première modification de la journée.
 */
function miroirPlanifier(precedentBrut) {
  if (!idbDisponible()) return;
  const jour = dateISO(Date.now());
  if (_jourSnapshot !== jour && precedentBrut) {
    _jourSnapshot = jour;
    try { snapshotEcrire(JSON.parse(precedentBrut), "auto", jour).catch(() => {}); } catch { /* JSON illisible : ignoré */ }
  }
  clearTimeout(_tMiroir);
  _tMiroir = setTimeout(miroirVider, 1500);
}
function miroirVider() {
  clearTimeout(_tMiroir);
  if (idbDisponible() && typeof S !== "undefined") etatMiroirEcrire(S).catch(() => {});
}

/* ---------- instantanés ---------- */
/** type "auto" : un par jour (clé auto-AAAA-MM-JJ) · type "manuel" : avant un import/une restauration (clé avant-<horodatage>). */
async function snapshotEcrire(etat, type = "auto", jour = dateISO(Date.now())) {
  const cle = type === "auto" ? `auto-${jour}` : `avant-${new Date().toISOString()}`;
  return idbTx("snapshots", "readwrite", async (st) => {
    if (type === "auto" && (await idbDemande(st.get(cle)))) return false;
    st.put({ cle, type, ecrit: new Date().toISOString(), etat });
    const cles = (await idbDemande(st.getAllKeys())).filter((k) => k.startsWith(type === "auto" ? "auto-" : "avant-")).sort();
    const max = type === "auto" ? SNAPSHOTS_AUTO_MAX : SNAPSHOTS_MANUELS_MAX;
    cles.slice(0, Math.max(0, cles.length - max)).forEach((k) => st.delete(k));
    return true;
  });
}
async function snapshotsLister() {
  const tous = await idbTx("snapshots", "readonly", (st) => idbDemande(st.getAll()));
  return tous.map((x) => ({ cle: x.cle, type: x.type, ecrit: x.ecrit, resume: resumeDonnees(x.etat) })).sort((a, b) => b.ecrit.localeCompare(a.ecrit));
}
const snapshotLire = (cle) => idbTx("snapshots", "readonly", (st) => idbDemande(st.get(cle)));

/* ---------- photos ---------- */
const photoEnregistrer = (rec) => idbTx("photos", "readwrite", (st) => idbDemande(st.put(rec)));
const photosDe = (cible) => idbTx("photos", "readonly", (st) => idbDemande(st.index("cible").getAll(cible))).then((l) => l.sort((a, b) => a.date.localeCompare(b.date)));
const photoLire = (id) => idbTx("photos", "readonly", (st) => idbDemande(st.get(id)));
const photoSupprimer = (id) => idbTx("photos", "readwrite", (st) => idbDemande(st.delete(id)));
const photosToutes = () => idbTx("photos", "readonly", (st) => idbDemande(st.getAll()));
const photosVider = () => idbTx("photos", "readwrite", (st) => idbDemande(st.clear()));
const photosNombre = () => idbTx("photos", "readonly", (st) => idbDemande(st.count()));

/** Supprime toutes les photos d'une cible (à appeler quand l'élément est supprimé). Silencieux si IndexedDB est absent. */
async function photosSupprimerDe(cible) {
  if (!idbDisponible()) return;
  try {
    await idbTx("photos", "readwrite", async (st) => {
      const ids = await idbDemande(st.index("cible").getAllKeys(cible));
      ids.forEach((id) => st.delete(id));
    });
  } catch { /* sans gravité : photos orphelines */ }
}

/** Nombre de photos par cible, en un seul passage (clés d'index uniquement : pas de lecture des images). */
function photosComptes() {
  return idbTx("photos", "readonly", (st) => new Promise((ok, ko) => {
    const compte = {};
    const req = st.index("cible").openKeyCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return ok(compte);
      compte[c.key] = (compte[c.key] || 0) + 1;
      c.continue();
    };
    req.onerror = () => ko(req.error);
  }));
}

/** Redimensionne une image décodée vers un Blob JPEG dont le grand côté ne dépasse pas maxCote. */
function redimensionner(bmp, maxCote, qualite) {
  const k = Math.min(1, maxCote / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); // fond blanc pour les PNG transparents
  g.drawImage(bmp, 0, 0, w, h);
  return new Promise((ok, ko) => c.toBlob((b) => (b ? ok({ blob: b, w, h }) : ko(new Error("Compression impossible."))), "image/jpeg", qualite));
}
async function decoderImage(fichier) {
  try { return await createImageBitmap(fichier, { imageOrientation: "from-image" }); }
  catch { throw new Error("Format d'image non pris en charge (utilisez JPEG ou PNG)."); }
}
/** Image principale (1600 px, JPEG 72 %) + miniature (220 px). Une photo de téléphone de 4 Mo tient en ~250 Ko. */
async function compresserImage(fichier, { max = 1600, qualite = 0.72, miniMax = 220 } = {}) {
  const bmp = await decoderImage(fichier);
  try {
    const p = await redimensionner(bmp, max, qualite);
    const m = await redimensionner(bmp, miniMax, 0.7);
    return { blob: p.blob, mini: m.blob, w: p.w, h: p.h };
  } finally { bmp.close?.(); }
}
async function fabriquerMini(blob, miniMax = 220) {
  const bmp = await decoderImage(blob);
  try { return (await redimensionner(bmp, miniMax, 0.7)).blob; } finally { bmp.close?.(); }
}

async function photoAjouter(fichier, cible) {
  const c = await compresserImage(fichier);
  const rec = { id: uid(), cible, nom: fichier.name || "photo", date: new Date().toISOString(), w: c.w, h: c.h, taille: c.blob.size, blob: c.blob, mini: c.mini };
  try { await photoEnregistrer(rec); }
  catch (e) { throw new Error(e?.name === "QuotaExceededError" ? "Espace de stockage plein : exportez vos données puis supprimez des photos." : "Enregistrement de la photo impossible."); }
  return rec;
}

/* ---------- persistance et quota ---------- */
async function stockagePersistant() { try { return (await navigator.storage?.persisted?.()) || false; } catch { return false; } }
async function stockageDemanderPersistance() { try { return (await navigator.storage?.persist?.()) || false; } catch { return false; } }
async function stockageEstimation() {
  try { const e = await navigator.storage?.estimate?.(); return e ? { usage: e.usage || 0, quota: e.quota || 0 } : null; } catch { return null; }
}
