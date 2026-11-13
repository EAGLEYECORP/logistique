"use strict";
/* ============================================================
   Prix du jour, de sources officielles et gratuites, sans dépendance :
   · taux de référence EUR → MAD de Bank Al-Maghrib (page publique des cours de référence) ; repli : open.er-api.com (gratuit, non officiel) ;
   · gazole en Espagne : ministère de la Transition écologique (prix de chaque station, mis à jour chaque jour) — médiane nationale, province de Cadix, Algeciras ;
   · gazole en France : données publiques prix-carburants (temps réel) — médiane nationale, stations avec piste poids lourds, Pyrénées-Orientales (Le Boulou).
   Le Maroc ne publie pas de prix des carburants en données ouvertes : l'application utilise vos propres pleins.
   ============================================================ */
const zlib = require("zlib");

const SOURCES = {
  bam: "https://www.bkam.ma/Marches/Principaux-indicateurs/Marche-des-changes/Cours-de-change/Cours-de-reference",
  erapi: "https://open.er-api.com/v6/latest/EUR",
  es: "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/",
  fr: "https://donnees.roulez-eco.fr/opendata/instantane",
};
const mediane = (l) => { const t = l.filter(Number.isFinite).sort((a, b) => a - b); if (!t.length) return null; const m = Math.floor(t.length / 2); return Math.round((t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2) * 1000) / 1000; };
const dateFrVersIso = (s) => { const m = String(s || "").match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };

/** Taux EUR → MAD sur la page des cours de référence de Bank Al-Maghrib : { taux, date } ou null. */
function lireTauxBam(html) {
  const m = String(html).match(/1\s*EURO\s*\(EUR\)[\s\S]{0,600}?(\d{1,2}[,.]\d{2,5})/i); if (!m) return null;
  const taux = Number(m[1].replace(",", ".")); if (!(taux > 5 && taux < 20)) return null;
  return { taux, date: dateFrVersIso((String(html).match(/\d{2}\/\d{2}\/\d{4}/) || [])[0]) };
}
/** Prix de chaque station en Espagne (JSON du ministère) : médianes du gazole A en €/L. */
function lireGazoleEspagne(json) {
  const l = json?.ListaEESSPrecio || [], prix = (e) => Number(String(e["Precio Gasoleo A"] || "").replace(",", "."));
  const ok = l.filter((e) => prix(e) > 0.5 && prix(e) < 5);
  const algeciras = ok.filter((e) => /^(algeciras|los barrios|san roque|la línea de la concepción|la linea de la concepcion)$/i.test(String(e.Municipio || "").trim()));
  return { prix: mediane(ok.map(prix)), n: ok.length, cadix: mediane(ok.filter((e) => e.IDProvincia === "11").map(prix)), algeciras: mediane(algeciras.map(prix)), nAlgeciras: algeciras.length, date: dateFrVersIso(json?.Fecha), unite: "EUR/L" };
}
/** Premier fichier d'une archive ZIP (méthode « stored » ou « deflate »), d'après le répertoire central. */
function premierFichierZip(buf) {
  const b = Buffer.from(buf); let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (b.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error("Archive ZIP illisible.");
  const cd = b.readUInt32LE(fin + 16); if (b.readUInt32LE(cd) !== 0x02014b50) throw new Error("Archive ZIP illisible.");
  const methode = b.readUInt16LE(cd + 10), taille = b.readUInt32LE(cd + 20), local = b.readUInt32LE(cd + 42);
  const debut = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28), donnees = b.subarray(debut, debut + taille);
  return methode === 0 ? donnees : methode === 8 ? zlib.inflateRawSync(donnees) : (() => { throw new Error("Compression ZIP non gérée."); })();
}
/** Prix des stations en France (XML prix-carburants) : médianes du gazole en €/L, prix de moins de 8 jours. */
function lireGazoleFrance(xml, maintenant = Date.now()) {
  const tous = [], pl = [], p66 = []; let dernier = "";
  for (const m of String(xml).matchAll(/<pdv\b([^>]*)>([\s\S]*?)<\/pdv>/g)) {
    const g = m[2].match(/<prix[^>]*nom="Gazole"[^>]*maj="([^"]+)"[^>]*valeur="([\d.]+)"/) || m[2].match(/<prix[^>]*nom="Gazole"[^>]*valeur="([\d.]+)"[^>]*maj="([^"]+)"/);
    if (!g) continue;
    const [maj, val] = /^\d{4}-/.test(g[1]) ? [g[1], g[2]] : [g[2], g[1]], prix = Number(val), t = Date.parse(maj.replace(" ", "T") + "Z");
    if (!(prix > 0.5 && prix < 5) || !(maintenant - t < 8 * 86400000)) continue;
    tous.push(prix); if (/Piste poids lourds/i.test(m[2])) pl.push(prix); if (/cp="66\d{3}"/.test(m[1])) p66.push(prix); if (maj > dernier) dernier = maj;
  }
  return { prix: mediane(tous), n: tous.length, poidsLourds: mediane(pl), nPoidsLourds: pl.length, pyreneesOrientales: mediane(p66), date: dernier.slice(0, 10), unite: "EUR/L" };
}

/** Récupère tout ; chaque source peut échouer seule (son erreur est rendue). */
async function recupererMarches(http_ = (...a) => fetch(...a), maintenant = Date.now()) {
  const r = { maj: maintenant, taux: null, carburant: {}, erreurs: [] };
  const lire = async (url, type = "text") => { const x = await http_(url, { headers: { "User-Agent": "logistique-fret-relais" } }); if (!x.ok) throw new Error(`réponse ${x.status}`); return type === "json" ? x.json() : type === "buffer" ? Buffer.from(await x.arrayBuffer()) : x.text(); };
  try { const t = lireTauxBam(await lire(SOURCES.bam)); if (!t) throw new Error("taux introuvable sur la page"); r.taux = { eurMad: t.taux, date: t.date, source: "Bank Al-Maghrib (cours de référence)", officiel: true }; }
  catch (e) { r.erreurs.push(`Bank Al-Maghrib : ${e.message}`); try { const j = await lire(SOURCES.erapi, "json"); if (j?.rates?.MAD) r.taux = { eurMad: Math.round(j.rates.MAD * 10000) / 10000, date: new Date((j.time_last_update_unix || maintenant / 1000) * 1000).toISOString().slice(0, 10), source: "open.er-api.com (indicatif)", officiel: false }; } catch (e2) { r.erreurs.push(`taux de repli : ${e2.message}`); } }
  try { r.carburant.ES = { ...lireGazoleEspagne(await lire(SOURCES.es, "json")), source: "Ministère espagnol (prix des stations)" }; } catch (e) { r.erreurs.push(`Espagne : ${e.message}`); }
  try { r.carburant.FR = { ...lireGazoleFrance(premierFichierZip(await lire(SOURCES.fr, "buffer")).toString("latin1"), maintenant), source: "prix-carburants.gouv.fr" }; } catch (e) { r.erreurs.push(`France : ${e.message}`); }
  return r;
}

module.exports = { lireTauxBam, lireGazoleEspagne, lireGazoleFrance, premierFichierZip, recupererMarches, mediane, SOURCES };
