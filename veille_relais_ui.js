"use strict";
/* ============================================================
   Veille par le relais (interface et envoi) — voir veille_relais.js et serveur/veille.js.
   · la liste à surveiller part au relais après chaque enregistrement (regroupé), au démarrage et toutes les 15 minutes ;
   · les passages aux quais vus par le relais sont repris au démarrage puis toutes les 5 minutes ;
   · tant que le relais prévient un chauffeur, l'application ne lui envoie plus elle-même le même message (coupures_ui.js).
   Sans relais, ou avec un relais qui ne connaît pas la veille, rien ne change : l'application surveille tant qu'elle est ouverte.
   ============================================================ */

const veilleRelais = { couverts: new Set(), t: 0, empreinte: "", indisponible: 0, voyages: 0, quais: 0 };
/** Le relais prévient-il lui-même le chauffeur de ce voyage ? (liste acceptée il y a moins de 40 minutes) */
const veilleCouvre = (voyageId) => Date.now() - veilleRelais.t < 40 * 60000 && veilleRelais.couverts.has(voyageId);
/** Le relais surveille-t-il en ce moment ? (pour les textes des réglages) */
const veilleActive = () => Date.now() - veilleRelais.t < 40 * 60000;

async function envoyerVeille({ forcer = false } = {}) {
  if (typeof partageRelais !== "function" || !partageRelais()) return null;
  if (veilleRelais.indisponible && Date.now() - veilleRelais.indisponible < 6 * 3600000) return null; // relais d'une version plus ancienne : réessayé dans 6 h
  const corps = listeVeille(await canauxRelais()), empreinte = JSON.stringify(corps);
  if (!forcer && empreinte === veilleRelais.empreinte && Date.now() - veilleRelais.t < 15 * 60000) return null;
  try {
    const r = await partageAppel("PUT", "/api/veille", corps), refuses = new Set((r.refus || []).filter((x) => /^chauffeur/.test(x.raison)).map((x) => x.id));
    Object.assign(veilleRelais, { empreinte, t: Date.now(), indisponible: 0, voyages: r.voyages || 0, quais: r.quais || 0, couverts: new Set(corps.voyages.filter((v) => v.coupures?.canal && !refuses.has(v.id)).map((v) => v.id)) });
    return r;
  } catch (e) {
    if (/Introuvable|404/.test(e.message)) veilleRelais.indisponible = Date.now();
    veilleRelais.couverts = new Set(); return null;
  }
}
async function reprendreQuaisRelais() {
  if (typeof partageRelais !== "function" || !partageRelais() || veilleRelais.indisponible) return;
  let lu; try { lu = await partageAppel("GET", "/api/veille"); } catch { return; }
  const messages = appliquerQuaisRelais(lu); if (!messages.length) return;
  sauver(); for (const m of messages) { toast(m, "ok"); if (typeof ajouterFil === "function") ajouterFil(m); }
  if (["voyages", "commandes"].includes(ongletActif) && !document.querySelector("dialog[open]")) rafraichir();
}
let minuteurVeille = null;
apresSauver("veille du relais", () => { clearTimeout(minuteurVeille); minuteurVeille = setTimeout(() => { envoyerVeille().catch(() => {}); }, 5000); }, 45);
/** Au démarrage (boot.js). */
function veilleDemarrer() {
  setTimeout(async () => { await envoyerVeille({ forcer: true }).catch(() => {}); await reprendreQuaisRelais().catch(() => {}); }, 7000);
  setInterval(() => { envoyerVeille().catch(() => {}); reprendreQuaisRelais().catch(() => {}); }, 5 * 60000);
}
