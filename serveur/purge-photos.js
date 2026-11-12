"use strict";
/* ============================================================
   Purge des photos anciennes du relais (conservation limitée, RGPD).
   Deux temps : une photo plus vieille que N mois est d'abord MARQUÉE ; elle n'est supprimée qu'après le délai de grâce (30 jours par défaut),
   si elle n'a pas été renvoyée entre-temps. Chaque marque et chaque suppression est écrite dans donnees/purge.log.
   Une photo supprimée laisse une trace : les appareils synchronisés suppriment aussi leur copie.
   Automatique dans le relais avec PURGE_PHOTOS_MOIS=18 (une fois par jour), ou à la main, relais ARRÊTÉ :
     node serveur/purge-photos.js --mois 18 [--grace 30] [--simulation] [--donnees chemin]
   ============================================================ */
const fs = require("fs");
const path = require("path");

const MOIS_MS = 30.4375 * 86400000;
/**
 * Décide, pour chaque photo, ce qui arrive : [{ id, action: "marquer" | "supprimer" | "demarquer", ageJours }].
 * photos : Map ou entrées [id, { t (secondes), taille, supprime?, aPurger? (ms) }].
 */
function planPurge(photos, maintenant = Date.now(), { mois = 18, graceJours = 30 } = {}) {
  const r = [], limite = maintenant - mois * MOIS_MS;
  for (const [id, p] of photos instanceof Map ? photos.entries() : photos) {
    if (p.supprime) continue;
    const ageJours = Math.floor((maintenant - p.t * 1000) / 86400000);
    if (p.t * 1000 >= limite) { if (p.aPurger) r.push({ id, action: "demarquer", ageJours }); continue; }
    if (!p.aPurger) r.push({ id, action: "marquer", ageJours });
    else if (maintenant - p.aPurger >= graceJours * 86400000) r.push({ id, action: "supprimer", ageJours });
  }
  return r;
}
/** Applique un plan sur la table des photos (en place) ; supprimerFichier(id) efface le contenu. Renvoie le bilan et les lignes du journal. */
function appliquerPurge(photos, plan, supprimerFichier, maintenant = Date.now()) {
  const bilan = { marquees: 0, supprimees: 0, demarquees: 0 }, journal = [];
  for (const { id, action, ageJours } of plan) {
    const p = photos.get(id); if (!p) continue;
    if (action === "marquer") { p.aPurger = maintenant; bilan.marquees++; }
    else if (action === "demarquer") { delete p.aPurger; bilan.demarquees++; }
    else { try { supprimerFichier(id); } catch { /* déjà absent */ } photos.set(id, { t: Math.floor(maintenant / 1000), taille: 0, supprime: true }); bilan.supprimees++; }
    journal.push({ t: maintenant, id, action, ageJours });
  }
  return { bilan, journal };
}

module.exports = { planPurge, appliquerPurge };

if (require.main === module) {
  const { chargerCoffre } = require("./coffre.js");
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
  const simulation = process.argv.includes("--simulation"), mois = Number(arg("mois", process.env.PURGE_PHOTOS_MOIS || 18)), graceJours = Number(arg("grace", 30));
  const dossier = path.resolve(arg("donnees", process.env.DONNEES || path.join(__dirname, "donnees")));
  if (!(mois >= 1) || !(graceJours >= 0)) { console.error("--mois (1 ou plus) et --grace (jours) attendus."); process.exit(1); }
  const { coffre } = chargerCoffre(dossier, process.env), fichier = path.join(dossier, "photos.json");
  let photos; try { photos = new Map(JSON.parse(coffre.lireTexte(fichier))); } catch (e) { console.error(`Aucune photo lisible dans ${dossier} (${e.message}).`); process.exit(1); }
  const plan = planPurge(photos, Date.now(), { mois, graceJours });
  if (simulation) { for (const x of plan) console.log(`${x.action.padEnd(10)} ${x.id} (${x.ageJours} jours)`); console.log(`Simulation : ${plan.length} action(s), rien n'est modifié.`); process.exit(0); }
  const { bilan, journal } = appliquerPurge(photos, plan, (id) => fs.unlinkSync(path.join(dossier, "photos", `${id}.bin`)));
  coffre.ecrire(fichier, JSON.stringify([...photos.entries()]));
  for (const l of journal) fs.appendFileSync(path.join(dossier, "purge.log"), coffre.ligne(JSON.stringify(l)) + "\n", { mode: 0o600 });
  console.log(`Photos de plus de ${mois} mois : ${bilan.marquees} marquée(s) (supprimées dans ${graceJours} jours), ${bilan.supprimees} supprimée(s), ${bilan.demarquees} gardée(s) (renvoyées entre-temps).`);
}
