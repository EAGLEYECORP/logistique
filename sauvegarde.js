"use strict";
/* ============================================================
   Sauvegarde, restauration et exports
   - ZIP (écriture/lecture sans bibliothèque) : donnees.json + photos
   - Chiffrement AES-256-GCM (clé dérivée du mot de passe par PBKDF2, 200 000 itérations)
   - Import des anciens formats (JSON brut des versions précédentes)
   - Exports CSV compatibles Excel français (séparateur « ; », virgule décimale, BOM UTF-8)
   Les fonctions de ce fichier ne touchent pas au DOM, sauf les téléchargements.
   ============================================================ */

const _enc = new TextEncoder();
const _dec = new TextDecoder();
const MAGIE_CHIFFRE = _enc.encode("LFS1");

/* ---------- octets ---------- */
function concat(morceaux) {
  const out = new Uint8Array(morceaux.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of morceaux) { out.set(p, o); o += p.length; }
  return out;
}

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(octets) {
  let c = 0xffffffff;
  for (let i = 0; i < octets.length; i++) c = TABLE_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------- ZIP (méthode « stockée » : les JPEG sont déjà compressés) ---------- */
function zipCreer(fichiers, date = new Date()) {
  const dosTemps = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const corps = [], central = [];
  let decalage = 0;
  for (const f of fichiers) {
    const nom = _enc.encode(f.nom), data = f.donnees, crc = crc32(data);
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true); // 0x0800 : noms en UTF-8
    loc.setUint16(10, dosTemps, true); loc.setUint16(12, dosDate, true); loc.setUint32(14, crc, true);
    loc.setUint32(18, data.length, true); loc.setUint32(22, data.length, true); loc.setUint16(26, nom.length, true);
    corps.push(new Uint8Array(loc.buffer), nom, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint16(12, dosTemps, true); cd.setUint16(14, dosDate, true); cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, nom.length, true);
    cd.setUint32(42, decalage, true);
    central.push(new Uint8Array(cd.buffer), nom);
    decalage += 30 + nom.length + data.length;
  }
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, fichiers.length, true); fin.setUint16(10, fichiers.length, true);
  fin.setUint32(12, central.reduce((s, p) => s + p.length, 0), true); fin.setUint32(16, decalage, true);
  return concat([...corps, ...central, new Uint8Array(fin.buffer)]);
}

async function inflater(octets) {
  if (typeof DecompressionStream === "undefined") throw new Error("Archive compressée : ce navigateur ne sait pas la décompresser.");
  const flux = new Blob([octets]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

/** Lit un ZIP (le nôtre, ou un ZIP standard compressé en « deflate ») → [{ nom, donnees }]. */
async function zipLire(octets) {
  const dv = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  let fin = -1;
  for (let i = octets.length - 22; i >= Math.max(0, octets.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error("Archive ZIP invalide.");
  const nb = dv.getUint16(fin + 10, true);
  let p = dv.getUint32(fin + 16, true);
  const sortie = [];
  for (let k = 0; k < nb; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Archive ZIP corrompue.");
    const methode = dv.getUint16(p + 10, true), tailleComp = dv.getUint32(p + 20, true);
    const nomLong = dv.getUint16(p + 28, true), extraLong = dv.getUint16(p + 30, true), comLong = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
    const nom = _dec.decode(octets.subarray(p + 46, p + 46 + nomLong));
    const debut = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    let donnees = octets.subarray(debut, debut + tailleComp);
    if (methode === 8) donnees = await inflater(donnees);
    else if (methode !== 0) throw new Error("Compression ZIP non prise en charge.");
    if (!nom.endsWith("/")) sortie.push({ nom, donnees });
    p += 46 + nomLong + extraLong + comLong;
  }
  return sortie;
}

/* ---------- chiffrement ---------- */
const estChiffre = (o) => o.length > 4 && MAGIE_CHIFFRE.every((b, i) => o[i] === b);

async function cleDepuisMotDePasse(mdp, sel) {
  const base = await crypto.subtle.importKey("raw", _enc.encode(mdp), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: sel, iterations: 200000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
/** Format : "LFS1" · sel (16) · iv (12) · données chiffrées (le GCM authentifie : une modification est détectée). */
async function chiffrer(octets, mdp) {
  const sel = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cleDepuisMotDePasse(mdp, sel), octets));
  return concat([MAGIE_CHIFFRE, sel, iv, c]);
}
async function dechiffrer(octets, mdp) {
  const sel = octets.slice(4, 20), iv = octets.slice(20, 32), c = octets.slice(32);
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await cleDepuisMotDePasse(mdp, sel), c)); }
  catch { throw new Error("Mot de passe incorrect ou fichier endommagé."); }
}

/* ---------- sauvegarde complète ---------- */
const nomSauvegarde = (ext) => `logistique-fret-${dateISO(Date.now())}.${ext}`;

/**
 * Construit la sauvegarde. photos=true → ZIP (donnees.json + photos/ + LISEZMOI.txt) ; sinon JSON seul.
 * Avec un mot de passe, le tout est chiffré (extension .lfs). La clé de l'assistant IA n'est jamais incluse.
 */
async function sauvegardeConstruire({ photos = true, mdp = "" } = {}) {
  const entete = { format: "logistique-fret", version: VERSION_SCHEMA, exporte: new Date().toISOString() };
  const json = _enc.encode(JSON.stringify({ ...entete, etat: S }, null, photos ? 0 : 2));
  let octets, ext = "json", type = "application/json", nbPhotos = 0;
  if (photos) {
    const liste = idbDisponible() ? await photosToutes() : [];
    const fichiers = [{ nom: "donnees.json", donnees: json }];
    const index = [];
    for (const p of liste) {
      fichiers.push({ nom: `photos/${p.id}.jpg`, donnees: new Uint8Array(await p.blob.arrayBuffer()) });
      index.push({ id: p.id, cible: p.cible, nom: p.nom, date: p.date, w: p.w, h: p.h, taille: p.taille });
    }
    fichiers.push({ nom: "photos/index.json", donnees: _enc.encode(JSON.stringify(index)) });
    fichiers.push({ nom: "LISEZMOI.txt", donnees: _enc.encode(`Sauvegarde Logistique Fret du ${dateFr(dateISO(Date.now()))}\r\n\r\ndonnees.json : toutes vos données\r\nphotos/ : ${index.length} photo(s)\r\n\r\nPour restaurer : Logistique Fret → Réglages → Importer.\r\n`) });
    octets = zipCreer(fichiers); ext = "zip"; type = "application/zip"; nbPhotos = index.length;
  } else octets = json;
  if (mdp) { octets = await chiffrer(octets, mdp); ext = "lfs"; type = "application/octet-stream"; }
  return { octets, nom: nomSauvegarde(ext), type, nbPhotos, chiffre: !!mdp };
}

/** Lit une sauvegarde (JSON, ZIP, ou fichier chiffré) → { etat (migré), depuis, tropRecent, photos: [{ meta, octets }] }. */
async function sauvegardeLire(octets, mdp = "") {
  if (estChiffre(octets)) {
    if (!mdp) throw Object.assign(new Error("Ce fichier est chiffré : saisissez son mot de passe."), { chiffre: true });
    octets = await dechiffrer(octets, mdp);
  }
  let brut, photos = [], avecPhotos = false;
  try {
    if (octets[0] === 0x50 && octets[1] === 0x4b) {
      const fichiers = await zipLire(octets);
      const f = (n) => fichiers.find((x) => x.nom === n);
      const d = f("donnees.json");
      if (!d) throw new Error("Archive sans donnees.json : ce n'est pas une sauvegarde Logistique Fret.");
      brut = JSON.parse(_dec.decode(d.donnees));
      avecPhotos = true;
      const idx = f("photos/index.json");
      for (const m of idx ? JSON.parse(_dec.decode(idx.donnees)) : []) {
        const bin = f(`photos/${m.id}.jpg`);
        if (bin) photos.push({ meta: m, octets: bin.donnees });
      }
    } else brut = JSON.parse(_dec.decode(octets));
  } catch (e) {
    throw e instanceof SyntaxError ? new Error("Fichier illisible : ce n'est pas une sauvegarde Logistique Fret.") : e;
  }
  const donnees = brut && brut.etat ? brut.etat : brut; // anciens exports : l'état brut, sans enveloppe
  if (!donnees || !Array.isArray(donnees.camions)) throw new Error("Fichier invalide : choisissez une sauvegarde Logistique Fret.");
  const r = migrer(donnees);
  return { etat: r.etat, depuis: r.depuis, tropRecent: !!r.tropRecent, photos, avecPhotos };
}

/** Remplace toutes les photos par celles de la sauvegarde (miniatures recréées). Renvoie le nombre restauré. */
async function photosRestaurer(photos) {
  await photosVider();
  let n = 0;
  for (const { meta, octets } of photos) {
    const blob = new Blob([octets], { type: "image/jpeg" });
    let mini; try { mini = await fabriquerMini(blob); } catch { continue; }
    await photoEnregistrer({ ...meta, blob, mini, taille: blob.size });
    n++;
  }
  return n;
}

/* ---------- CSV (Excel français) ---------- */
function csvValeur(v) {
  if (v == null) return '""';
  if (typeof v === "number") v = Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100).replace(".", ",");
  return `"${String(v).replace(/"/g, '""')}"`;
}
function lignesVersCSV(lignes) {
  if (!lignes.length) return "";
  const cols = Object.keys(lignes[0]);
  return "\ufeff" + [cols.map(csvValeur).join(";"), ...lignes.map((l) => cols.map((c) => csvValeur(l[c])).join(";"))].join("\r\n");
}

/** Toutes les tables en lignes prêtes pour un tableur. */
function tablesCSV() {
  const oui = (b) => (b ? "oui" : "non");
  return {
    commandes: S.commandes.map((c) => {
      const m = margeCommande(c);
      return { reference: c.ref, statut: libStatutCmd(c.statut), client: nomClient(c.clientId), marchandise: c.marchandise, ville_chargement: c.origine, pays_chargement: c.paysOrigine, ville_livraison: c.destination, pays_livraison: c.paysDest,
        date_chargement: c.dateChargement, date_livraison: c.dateLivraison, poids_kg: c.poids, palettes: c.palettes, cmr: c.cmr, ref_client: c.refClient, prix: c.prix, devise: c.devise,
        prix_mad: m.prix, cout_mad: m.cout, marge_mad: m.marge, marge_pct: m.taux, chauffeur: nomChauffeur(c.chauffeurId), camion: nomCamion(c.camionId), facture: parId(S.factures, c.factureId)?.numero || "" };
    }),
    clients: S.clients.map((c) => ({ nom: c.nom, ice: c.ice, contact: c.contact, telephone: c.tel, email: c.email, ville: c.ville, pays: c.pays, delai_paiement_jours: c.delai, adresse: c.adresse })),
    factures: S.factures.map((f) => { const t = totauxFacture(f); return { numero: f.numero, client: nomClient(f.clientId), date: f.date, echeance: f.echeance, devise: f.devise, total_ht: t.ht, tva_pct: f.tva, tva: t.tva, total_ttc: t.ttc, statut: etatFacture(f).code === "payee" ? "payée" : etatFacture(f).code === "retard" ? "en retard" : "à encaisser", date_paiement: f.datePaiement, mode_paiement: f.mode }; }),
    camions: S.camions.map((c) => ({ immatriculation: c.immat, marque: c.marque, km: c.km, km_derniere_vidange: c.kmVidange, intervalle_vidange: c.intervalleVidange, km_derniers_pneus: c.kmPneus, duree_vie_pneus: c.intervallePneus, ...Object.fromEntries(DOCS_CAMION.map(([k, l]) => [l.toLowerCase().replace(/ /g, "_"), c[k]])), conso_moyenne_l_100: consoMoyenne(c.id) || "", cout_entretien_mad: coutEntretien(c.id) })),
    chauffeurs: S.chauffeurs.map((c) => ({ nom: c.nom, telephone: c.tel, camion: nomCamion(c.camionId), en_conge: oui(c.conge), ...Object.fromEntries(DOCS_CHAUFFEUR.map(([k, l]) => [l.toLowerCase().replace(/ /g, "_"), c[k]])) })),
    gasoil: S.pleins.map((p) => ({ date: p.date, camion: nomCamion(p.camionId), km: p.km, litres: p.litres, prix_litre: p.prix, montant_mad: p.litres * p.prix, plein_complet: oui(p.plein), station: p.station })),
    entretien: S.interventions.map((i) => ({ date: i.date, camion: nomCamion(i.camionId), intervention: libIntervention(i.type), km: i.km, cout_mad: i.cout, garage: i.garage, notes: i.notes })),
    trajets: S.trajets.map((t) => ({ date: t.date, depart: t.depart, arrivee: t.arrivee, km: t.distance, client: t.client, chauffeur: nomChauffeur(t.chauffeurId), camion: nomCamion(t.camionId), litres: t.calcul.litres, cout_gasoil_mad: t.calcul.coutGasoil, peage_mad: t.peage, cout_total_mad: t.calcul.coutTotal, duree_h: t.calcul.dureeTotale, statut: t.statut })),
    douane: S.dossiers.map((d) => { const it = CHECKLISTS_DOUANE[d.type] || []; return { reference: d.ref, operation: d.type, client: d.client, marchandise: d.marchandise, code_sh: d.codeSH, bureau: d.bureau, echeance: d.echeance, statut: d.statut, documents_faits: it.filter((_, i) => d.coches?.[i]).length, documents_total: it.length }; }),
  };
}

/** Un ZIP contenant un CSV par table non vide. */
function csvZipConstruire() {
  const fichiers = Object.entries(tablesCSV()).filter(([, l]) => l.length).map(([nom, l]) => ({ nom: `${nom}.csv`, donnees: _enc.encode(lignesVersCSV(l)) }));
  return fichiers.length ? { octets: zipCreer(fichiers), nom: `logistique-fret-csv-${dateISO(Date.now())}.zip`, type: "application/zip", nbTables: fichiers.length } : null;
}

/* ---------- verrou du mode chauffeur (code PIN + code de secours) ---------- */
const octetsVersHex = (o) => [...o].map((b) => b.toString(16).padStart(2, "0")).join("");
const selAleatoire = () => octetsVersHex(crypto.getRandomValues(new Uint8Array(12)));

/** Empreinte salée (PBKDF2-SHA256, 100 000 itérations) : le code n'est jamais stocké en clair. */
async function empreinteSecret(secret, sel) {
  const base = await crypto.subtle.importKey("raw", _enc.encode(secret), "PBKDF2", false, ["deriveBits"]);
  return octetsVersHex(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: _enc.encode(sel), iterations: 100000, hash: "SHA-256" }, base, 256)));
}
/** Code de secours lisible, sans caractères ambigus (0/O, 1/I) : XXXX-XXXX. */
function codeSecours() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const c = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => alphabet[b % alphabet.length]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}
const normaliserCode = (s) => String(s || "").trim().toUpperCase().replace(/[\s-]/g, "");

/** Crée le verrou. Sans PIN, seul le code de secours existe (inutile). Renvoie { verrou, secours } : le code de secours en clair n'est montré qu'une fois. */
async function verrouCreer(pin) {
  const sel = selAleatoire(), secours = codeSecours();
  return { verrou: { sel, hashPin: pin ? await empreinteSecret(normaliserCode(pin), sel) : null, hashSecours: await empreinteSecret(normaliserCode(secours), sel) }, secours };
}
async function verrouVerifier(verrou, saisie) {
  const s = normaliserCode(saisie);
  if (!s || !verrou) return false;
  const h = await empreinteSecret(s, verrou.sel);
  return h === verrou.hashPin || h === verrou.hashSecours;
}
