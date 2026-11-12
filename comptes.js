"use strict";
/* ============================================================
   Comptes et droits d'accès — logique pure, partagée par l'application ET le relais (même fichier, mêmes règles).
   En mode multi-utilisateur, le relais applique ces règles à CHAQUE appel : ce n'est plus un tri de l'affichage.
   · rôles : chef d'entreprise, exploitant, répartiteur (sans prix ni marges), commercial, comptable, chauffeur, transitaire ;
   · par collection : lecture (tout, les siens, rien), prix et marges visibles ou non, écriture (tout, certains champs, rien), suppression ;
   · une écriture ne peut jamais effacer ce que l'auteur n'a pas le droit de voir (prix, coûts) ni toucher un champ interdit.
   ============================================================ */

/** Collections stockées par le relais. « reglages » : enregistrements uniques params, entreprise, notifsEtat. */
const COLLECTIONS_SERVEUR = ["camions", "pleins", "interventions", "chauffeurs", "trajets", "dossiers", "codes", "clients", "commandes", "factures", "voyages", "autorisations", "traces",
  "zones", "gares", "releves", "chargesGenerales", "echeances", "depensesAttente", "attentesPort", "routageJalons", "notificationsApp", "reglages"];
const REGLAGES_IDS = ["params", "entreprise", "notifsEtat"];

const ROLES_COMPTES = [
  ["chef_entreprise", "Chef d'entreprise", "Tout voir et tout régler, comptes, journal"],
  ["exploitant", "Exploitant", "Toute l'exploitation, prix et marges compris"],
  ["dispatcher", "Répartiteur", "Exploitation sans prix ni marges"],
  ["commercial", "Commercial", "Clients, commandes, factures ; voyages en lecture"],
  ["comptable", "Comptable", "Factures, échéances, charges, dépenses des voyages"],
  ["chauffeur", "Chauffeur", "Ses voyages : étapes, preuve de livraison, listes de contrôle"],
  ["transitaire", "Transitaire", "Les dossiers de douane et voyages qui lui sont confiés, en lecture"],
];
/** Profil d'affichage (profils.js) correspondant à chaque rôle. */
const PROFIL_DU_ROLE = { chef_entreprise: "direction", exploitant: "exploitant", dispatcher: "exploitation", commercial: "commercial", comptable: "comptabilite", chauffeur: "chauffeur", transitaire: "transitaire" };

/** Champs financiers retirés pour un rôle qui ne voit pas les prix et les marges. */
const CHAMPS_FINANCIERS = {
  voyages: ["prix", "lignesCout", "marge", "carburantMad", "fraisRouteMad", "douaneMad", "autresMad", "peagesMad", "peagesReelMad", "peagesEur", "peagesEurReel", "peagesEurPays", "peagesFr", "factureId"],
  commandes: ["prix", "ferry", "fraisChauffeur", "autres", "factureId"],
  camions: ["fixeMensuel", "coutsFixes", "amortissement", "froid"],
  chauffeurs: ["perDiemJournalier", "perDiemDevise"],
  clients: ["delai", "encours"],
};
const CHAMPS_TRAVERSEE_FINANCIERS = ["fret", "baf", "ets", "lss", "fueleu", "chauffeur", "frigo"];
const REGLAGES_FINANCIERS = { params: ["fraisGenerauxMois", "fraisTransitaire", "reposHebdoEur", "peagesEu"], entreprise: ["tresorerie"] };

const COLLECTIONS_EXPLOITATION = ["camions", "pleins", "interventions", "chauffeurs", "trajets", "dossiers", "codes", "autorisations", "traces", "zones", "gares", "releves", "attentesPort", "voyages", "commandes", "notificationsApp"];
const droitDe = (l, f, e, s = false) => ({ lecture: l, finances: f, ecriture: e, suppression: s });
const DROIT_TOUT = droitDe("tout", true, true, true);
/** Droits d'un rôle sur chaque collection : { lecture: "tout" | "propre" | null, finances, ecriture: true | false | [champs], suppression }. */
function droitsRole(role) {
  const r = {};
  const pour = (cols, droit) => { for (const c of cols) r[c] = droit; };
  if (role === "chef_entreprise") pour(COLLECTIONS_SERVEUR, DROIT_TOUT);
  else if (role === "exploitant") {
    pour(COLLECTIONS_EXPLOITATION, DROIT_TOUT); pour(["clients", "factures", "echeances", "chargesGenerales"], droitDe("tout", true, false)); pour(["depensesAttente", "routageJalons"], droitDe("tout", true, true, true)); r.reglages = droitDe("tout", true, false);
  } else if (role === "dispatcher") {
    pour(COLLECTIONS_EXPLOITATION, droitDe("tout", false, true, true)); r.clients = droitDe("tout", false, false); r.routageJalons = droitDe("tout", false, false); r.reglages = droitDe("tout", false, false);
  } else if (role === "commercial") {
    pour(["clients", "commandes"], droitDe("tout", true, true, true)); r.factures = droitDe("tout", true, true); pour(["voyages", "camions", "chauffeurs", "dossiers"], droitDe("tout", false, false)); pour(["codes", "zones"], droitDe("tout", false, false)); r.reglages = droitDe("tout", false, false); r.notificationsApp = droitDe("tout", false, true);
  } else if (role === "comptable") {
    r.factures = droitDe("tout", true, true); pour(["echeances", "chargesGenerales", "depensesAttente"], droitDe("tout", true, true, true)); pour(["clients", "commandes", "pleins", "interventions", "chauffeurs", "trajets"], droitDe("tout", true, false));
    r.voyages = droitDe("tout", true, ["lignesCout", "marge", "factureId"]); r.camions = droitDe("tout", true, ["coutsFixes", "amortissement", "fixeMensuel", "froid"]); r.reglages = droitDe("tout", true, false); r.notificationsApp = droitDe("tout", false, true);
  } else if (role === "chauffeur") {
    r.voyages = droitDe("propre", false, ["jalons", "pod", "coches", "notifsJalons", "invitesIgnorees"]); r.chauffeurs = droitDe("propre", false, false); r.camions = droitDe("propre", false, false); r.zones = droitDe("tout", false, false);
  } else if (role === "transitaire") {
    r.dossiers = droitDe("propre", false, false); r.voyages = droitDe("propre", false, false); r.codes = droitDe("tout", false, false);
  }
  return r;
}
const droitsSur = (utilisateur, col) => (utilisateur && !utilisateur.cloture ? droitsRole(utilisateur.role)[col] || null : null);
/** Le rôle peut-il gérer les comptes et lire le journal ? */
const estChef = (u) => !!u && !u.cloture && u.role === "chef_entreprise";
/** Le rôle peut-il lire le suivi en direct (positions, liens client, notifications) ? */
const peutSuivre = (u) => !!u && !u.cloture && ["chef_entreprise", "exploitant", "dispatcher", "commercial"].includes(u.role);

/**
 * L'enregistrement appartient-il à l'utilisateur (lecture « propre ») ? ctx.camionsDuChauffeur : identifiants des camions de ses voyages.
 * Chauffeur : ses voyages (voyage.chauffeurId = compte.chauffeurId), sa fiche, les camions de ses voyages. Transitaire : dossiers et voyages qui lui sont confiés (transitaireId = id du compte).
 */
function estSien(col, rec, u, ctx = {}) {
  if (!rec || !u) return false;
  if (u.role === "chauffeur") {
    if (!u.chauffeurId) return false;
    if (col === "voyages") return rec.chauffeurId === u.chauffeurId;
    if (col === "chauffeurs") return rec.id === u.chauffeurId;
    if (col === "camions") return (ctx.camionsDuChauffeur || []).includes(rec.id);
  }
  if (u.role === "transitaire" && (col === "dossiers" || col === "voyages")) return rec.transitaireId === u.id;
  return false;
}
const peutVoir = (col, rec, u, ctx) => { const dr = droitsSur(u, col); return !!dr && (dr.lecture === "tout" || (dr.lecture === "propre" && estSien(col, rec, u, ctx))); };

/** Copie de l'enregistrement sans ce que le rôle ne doit pas voir (prix, coûts, marges). */
function filtrerEnregistrement(col, rec, u) {
  const dr = droitsSur(u, col); if (!dr) return null;
  if (dr.finances) return rec;
  const r = { ...rec };
  for (const k of CHAMPS_FINANCIERS[col] || []) delete r[k];
  if (col === "voyages" && Array.isArray(r.traversees)) r.traversees = r.traversees.map((t) => { const x = { ...t }; for (const k of CHAMPS_TRAVERSEE_FINANCIERS) delete x[k]; return x; });
  if (col === "reglages") for (const k of REGLAGES_FINANCIERS[rec.id] || []) delete r[k];
  return r;
}

/**
 * Écriture demandée par un utilisateur : { ok, enregistrement, raison }.
 * Champs autorisés seulement (rôles à écriture partielle) ; les champs financiers que l'auteur ne voit pas sont repris de l'existant ;
 * un enregistrement « propre » doit le rester (un chauffeur ne peut pas s'attribuer le voyage d'un autre). Les champs techniques (_v, _seq…) sont ignorés.
 */
function appliquerEcriture(col, avant, propose, u, ctx = {}) {
  const dr = droitsSur(u, col);
  if (!dr || !dr.ecriture) return { ok: false, raison: "Écriture non autorisée pour votre rôle." };
  if (!propose || typeof propose !== "object" || Array.isArray(propose)) return { ok: false, raison: "Enregistrement illisible." };
  if (avant && !peutVoir(col, avant, u, ctx)) return { ok: false, raison: "Enregistrement hors de votre périmètre." };
  const propre = Object.fromEntries(Object.entries(propose).filter(([k]) => !k.startsWith("_")));
  let r;
  if (Array.isArray(dr.ecriture)) {
    if (!avant) return { ok: false, raison: "Création non autorisée pour votre rôle." };
    r = { ...avant }; for (const k of dr.ecriture) { if (k in propre) r[k] = propre[k]; else if (k in r && !(k in propre)) delete r[k]; }
  } else {
    r = { ...propre };
    if (!dr.finances && avant) {
      for (const k of CHAMPS_FINANCIERS[col] || []) { if (k in avant) r[k] = avant[k]; else delete r[k]; }
      if (col === "reglages") for (const k of REGLAGES_FINANCIERS[avant.id] || []) { if (k in avant) r[k] = avant[k]; else delete r[k]; }
      if (col === "voyages" && Array.isArray(r.traversees)) r.traversees = r.traversees.map((t) => { const a = (avant.traversees || []).find((x) => x.sens === t.sens) || {}; const x = { ...t }; for (const k of CHAMPS_TRAVERSEE_FINANCIERS) { if (k in a) x[k] = a[k]; else delete x[k]; } return x; });
    } else if (!dr.finances) { for (const k of CHAMPS_FINANCIERS[col] || []) delete r[k]; }
  }
  for (const k of Object.keys(avant || {})) if (k.startsWith("_")) delete r[k];
  if (dr.lecture === "propre" && !estSien(col, r, u, ctx)) return { ok: false, raison: "Enregistrement hors de votre périmètre." };
  if (col === "reglages" && !REGLAGES_IDS.includes(String(r.id))) return { ok: false, raison: "Réglage inconnu." };
  return { ok: true, enregistrement: r };
}
const peutSupprimer = (col, rec, u, ctx) => { const dr = droitsSur(u, col); return !!dr && dr.suppression && peutVoir(col, rec, u, ctx); };

/** Différences entre deux versions d'un enregistrement (pour le journal) : { champ: [avant, après] }, valeurs longues abrégées. */
function diffEnregistrement(avant, apres) {
  const r = {}, court = (v) => { const s = JSON.stringify(v); return s === undefined ? null : s.length > 300 ? s.slice(0, 297) + "…" : v; };
  for (const k of new Set([...Object.keys(avant || {}), ...Object.keys(apres || {})])) {
    if (k.startsWith("_")) continue;
    if (JSON.stringify(avant?.[k]) !== JSON.stringify(apres?.[k])) r[k] = [court(avant?.[k]), court(apres?.[k])];
  }
  return r;
}
/** Mot de passe acceptable : 12 caractères au moins (recommandations NIST : pas de règle de composition, pas de rotation imposée). */
const motDePasseValide = (m) => typeof m === "string" && m.length >= 12 && m.length <= 200;
const emailCompteValide = (e) => typeof e === "string" && /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i.test(e.trim()) && e.length <= 200;

if (typeof module !== "undefined") module.exports = { COLLECTIONS_SERVEUR, REGLAGES_IDS, ROLES_COMPTES, PROFIL_DU_ROLE, CHAMPS_FINANCIERS, droitsRole, droitsSur, estChef, peutSuivre, estSien, peutVoir, filtrerEnregistrement, appliquerEcriture, peutSupprimer, diffEnregistrement, motDePasseValide, emailCompteValide };
