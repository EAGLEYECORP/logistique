"use strict";
/* ============================================================
   Noyau métier : état, calculs, alertes (sans dépendance à l'interface).
   Testé par tests/noyau.test.js
   ============================================================ */

const STORAGE_KEY = "logistique-v1";

const PARAMS_DEFAUT = {
  prixGasoil: 11.0,        // MAD / litre — à mettre à jour
  consoDefaut: 33,         // L / 100 km pour un poids lourd
  vitesseMoyenne: 70,      // km/h
  intervalleVidange: 40000,
  intervallePneus: 100000,
  alerteKm: 2000,          // prévenir X km avant l'échéance
  alerteJours: 30,         // prévenir X jours avant une expiration
  reposMinHeures: 11,      // repos journalier minimum
  amplitudeMaxHeures: 13,  // durée max d'un service avant repos obligatoire
  conduiteMaxJour: 9,      // heures de conduite par jour
  conduiteAvantPause: 4.5, // heures avant une pause
  dureePause: 0.75,        // heures (45 min)
  seuilConso: 15,          // % au-dessus de la moyenne = anomalie
  peagesEu: { DE: 0.35, AT: 0.48 }, // €/km par pays (poids lourds) — France, Espagne, Italie… à renseigner d'après les grilles officielles
  tauxEUR: 10.8,           // MAD pour 1 EUR — à mettre à jour
  tvaDefaut: 14,           // % — à vérifier avec votre comptable (export, transport international…)
  delaiPaiement: 30,       // jours, si le client n'en a pas
  rappelSauvegarde: 7,     // jours sans sauvegarde avant rappel
};

/** Version du schéma des données. 1 = flotte · 2 = + clients, commandes, factures · 3 = + assistant de démarrage, rappels, photos · 4 = + voyages, autorisations bilatérales, séjours Schengen · 5 = + traces GPS et zones · 6 = + gares de péage et relevés Jawaz. */
const VERSION_SCHEMA = 6;
const COLLECTIONS = ["camions", "pleins", "interventions", "chauffeurs", "trajets", "dossiers", "codes", "clients", "commandes", "factures", "voyages", "autorisations", "traces"];

// Documents suivis avec date d'expiration (transport national et international).
const DOCS_CAMION = [
  ["assurance", "Assurance"],
  ["visite", "Visite technique"],
  ["carteVerte", "Carte verte"],
  ["tachygraphe", "Tachygraphe"],
  ["autorisation", "Autorisation internationale"],
];
const DOCS_CHAUFFEUR = [
  ["permis", "Permis"],
  ["visiteMedicale", "Visite médicale"],
  ["passeport", "Passeport"],
  ["visa", "Visa Schengen"],
  ["carteConducteur", "Carte conducteur"],
];

const STATUTS_CMD = [
  ["devis", "Devis"],
  ["confirme", "Confirmée"],
  ["charge", "Chargée"],
  ["transit", "En transit"],
  ["douane", "En douane"],
  ["livre", "Livrée"],
];
const PAYS = ["Maroc", "Espagne", "France", "Portugal", "Italie", "Belgique", "Pays-Bas", "Allemagne", "Royaume-Uni", "Suisse", "Mauritanie", "Sénégal", "Autre"];

function etatVide() {
  return {
    camions: [], pleins: [], interventions: [], chauffeurs: [], trajets: [], dossiers: [], codes: [],
    clients: [], commandes: [], factures: [], voyages: [], autorisations: [], traces: [], zones: [], gares: [], releves: [],
    params: { ...PARAMS_DEFAUT }, meta: { version: VERSION_SCHEMA }, entreprise: {},
  };
}

function normaliser(e) {
  const base = etatVide();
  return { ...base, ...e, params: { ...PARAMS_DEFAUT, ...(e?.params || {}) }, meta: { ...(e?.meta || {}) }, entreprise: { ...(e?.entreprise || {}) } };
}

const contientDonnees = (e) => COLLECTIONS.some((k) => (e?.[k] || []).length > 0);

/**
 * Met à niveau des données d'une version antérieure (ou d'un export). Pure : ne touche pas à S.
 * Renvoie { etat, depuis, migre, tropRecent }. Des données plus récentes que cette application ne sont jamais « rétrogradées ».
 */
function migrer(brut) {
  const base = brut && typeof brut === "object" && !Array.isArray(brut) ? brut : {};
  const e = normaliser(base);
  const depuis = Number(base.meta?.version) || 1;
  if (depuis > VERSION_SCHEMA) return { etat: e, depuis, migre: false, tropRecent: true };
  if (depuis < 2) {
    for (const k of COLLECTIONS) {
      e[k] = (Array.isArray(e[k]) ? e[k] : []).filter((x) => x && typeof x === "object");
      e[k].forEach((x) => { if (!x.id) x.id = uid(); });
    }
    e.commandes.forEach((c) => { c.jalons ||= []; });
    e.factures.forEach((f) => { f.lignes ||= []; });
  }
  if (depuis < 3) {
    if (contientDonnees(e)) e.meta.onboarde = true; // un utilisateur existant ne revoit pas l'assistant de démarrage
    e.meta.notif ||= { actif: false, cats: {} };
  }
  if (depuis < 4) { e.voyages = Array.isArray(e.voyages) ? e.voyages : []; e.autorisations = Array.isArray(e.autorisations) ? e.autorisations : []; e.chauffeurs.forEach((c) => { c.sejours ||= []; }); }
  if (depuis < 5) { e.traces = Array.isArray(e.traces) ? e.traces : []; e.zones = Array.isArray(e.zones) ? e.zones : []; }
  if (depuis < 6) { e.gares = Array.isArray(e.gares) ? e.gares : []; e.releves = Array.isArray(e.releves) ? e.releves : []; }
  e.meta.version = VERSION_SCHEMA;
  return { etat: e, depuis, migre: depuis < VERSION_SCHEMA };
}

function resumeDonnees(e) {
  const n = (k) => (e?.[k] || []).length;
  return { camions: n("camions"), chauffeurs: n("chauffeurs"), clients: n("clients"), commandes: n("commandes"), factures: n("factures"), voyages: n("voyages"), autorisations: n("autorisations"), traces: n("traces"), trajets: n("trajets"), pleins: n("pleins"), dossiers: n("dossiers") };
}
function libResume(r) {
  const noms = { camions: "camion", chauffeurs: "chauffeur", clients: "client", commandes: "commande", factures: "facture", voyages: "voyage", autorisations: "autorisation", traces: "trace GPS", trajets: "trajet", pleins: "plein", dossiers: "dossier" };
  const l = Object.entries(r).filter(([, v]) => v).map(([k, v]) => `${v} ${noms[k]}${v > 1 ? "s" : ""}`);
  return l.length ? l.join(" · ") : "aucune donnée";
}

let S = etatVide();

/* ---------- utilitaires ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, d = 0) => { const n = parseFloat(String(v ?? "").replace(",", ".").replace(/\s/g, "")); return Number.isFinite(n) ? n : d; };
const fmt = (n, dec = 0) => Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const mad = (n) => fmt(n, 2) + " MAD";
const dateISO = (d) => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const today = () => dateISO(Date.now());
const sansAccent = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const joursAvant = (dateStr) => dateStr ? Math.round((new Date(dateStr + "T00:00:00") - new Date(today() + "T00:00:00")) / 86400000) : null;
const dateFr = (d) => d ? new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString("fr-FR") : "—";
const dateHeureFr = (d) => d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";
const parId = (liste, id) => liste.find((x) => x.id === id);
const nomCamion = (id) => parId(S.camions, id)?.immat || "—";
const nomChauffeur = (id) => parId(S.chauffeurs, id)?.nom || "—";

/* ---------- carburant ---------- */
// Consommation L/100 km par plein, méthode « plein à plein » (les pleins partiels s'additionnent).
function consommations(camionId) {
  const pleins = S.pleins.filter((p) => p.camionId === camionId).sort((a, b) => a.km - b.km);
  const res = {};
  let dernier = null;
  let litres = 0;
  for (const p of pleins) {
    if (!dernier) { if (p.plein) dernier = p; continue; }
    litres += p.litres;
    if (p.plein) {
      if (p.km > dernier.km) res[p.id] = (litres / (p.km - dernier.km)) * 100;
      dernier = p;
      litres = 0;
    }
  }
  return res;
}

function consoMoyenne(camionId) {
  const v = Object.values(consommations(camionId));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function consoFlotte() {
  const v = S.camions.map((c) => consoMoyenne(c.id)).filter(Boolean);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/* ---------- camions ---------- */
function etatCamion(c) {
  const P = S.params;
  const out = [];
  const echeanceKm = (type, depuis, intervalle, libDepasse) => {
    const reste = depuis + intervalle - c.km;
    out.push({
      type, reste, pct: Math.min(100, Math.max(0, ((c.km - depuis) / intervalle) * 100)),
      niveau: reste <= 0 ? "danger" : reste <= P.alerteKm ? "warn" : "ok",
      texte: reste < 0 ? `${libDepasse} de ${fmt(-reste)} km` : reste === 0 ? "à faire maintenant" : `dans ${fmt(reste)} km`,
    });
  };
  echeanceKm("Vidange", c.kmVidange, c.intervalleVidange, "dépassée");
  echeanceKm("Pneus", c.kmPneus, c.intervallePneus, "usure dépassée");
  for (const [cle, lib] of DOCS_CAMION) {
    const j = joursAvant(c[cle]);
    if (j === null) continue;
    out.push({ type: lib, niveau: j < 0 ? "danger" : j <= P.alerteJours ? "warn" : "ok", texte: j < 0 ? `expirée depuis ${-j} j` : `expire dans ${j} j` });
  }
  return out;
}

function niveauGlobal(etats) {
  return etats.some((e) => e.niveau === "danger") ? "danger" : etats.some((e) => e.niveau === "warn") ? "warn" : "ok";
}

function coutEntretien(camionId, depuis = "") {
  return S.interventions.filter((i) => (!camionId || i.camionId === camionId) && (i.date || "") >= depuis).reduce((s, i) => s + num(i.cout), 0);
}

/* ---------- chauffeurs ---------- */
function etatChauffeur(ch, maintenant = Date.now()) {
  const P = S.params;
  if (ch.conge) return { dispo: false, niveau: "warn", code: "conge", texte: "En congé" };
  const jPermis = joursAvant(ch.permis);
  if (jPermis !== null && jPermis < 0) return { dispo: false, niveau: "danger", code: "permis", texte: "Permis expiré" };
  if (ch.reposJusqua && new Date(ch.reposJusqua).getTime() > maintenant) {
    return { dispo: false, niveau: "warn", code: "repos", texte: `En repos jusqu'à ${dateHeureFr(ch.reposJusqua)}` };
  }
  if (ch.debutService) {
    const h = (maintenant - new Date(ch.debutService).getTime()) / 3600000;
    if (h >= P.amplitudeMaxHeures) return { dispo: false, niveau: "danger", code: "depasse", texte: `En service depuis ${fmt(h, 1)} h — repos obligatoire` };
    return { dispo: true, niveau: "ok", code: "service", reste: P.amplitudeMaxHeures - h, texte: `En service depuis ${fmt(h, 1)} h · reste ${fmt(P.amplitudeMaxHeures - h, 1)} h` };
  }
  return { dispo: true, niveau: "ok", code: "libre", texte: "Disponible" };
}

/* ---------- itinéraires ---------- */
function calculTrajet({ distance, peage = 0, conso, prix }) {
  const P = S.params;
  const litres = (distance * conso) / 100;
  const coutGasoil = litres * prix;
  const heuresConduite = distance / P.vitesseMoyenne;
  const jours = Math.max(1, Math.ceil(heuresConduite / P.conduiteMaxJour - 1e-9));
  let pauses = 0;
  let reste = heuresConduite;
  for (let j = 0; j < jours; j++) {
    const hj = Math.min(reste, P.conduiteMaxJour);
    pauses += Math.max(0, Math.ceil(hj / P.conduiteAvantPause - 1e-9) - 1);
    reste -= hj;
  }
  const reposNuit = jours - 1;
  const dureeTotale = heuresConduite + pauses * P.dureePause + reposNuit * P.reposMinHeures;
  return { litres, coutGasoil, coutTotal: coutGasoil + peage, coutKm: distance ? (coutGasoil + peage) / distance : 0, heuresConduite, pauses, reposNuit, jours, dureeTotale };
}

/* ---------- dépenses ---------- */
function depensesHebdo(nb = 8) {
  const lundi = new Date(today() + "T00:00:00");
  lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7));
  const semaines = [];
  for (let i = nb - 1; i >= 0; i--) {
    const d = new Date(lundi); d.setDate(d.getDate() - i * 7);
    const f = new Date(d); f.setDate(f.getDate() + 7);
    semaines.push({ debut: dateISO(d), fin: dateISO(f), gasoil: 0, entretien: 0 });
  }
  for (const s of semaines) {
    s.gasoil = S.pleins.filter((p) => p.date >= s.debut && p.date < s.fin).reduce((t, p) => t + p.litres * p.prix, 0);
    s.entretien = S.interventions.filter((i) => i.date >= s.debut && i.date < s.fin).reduce((t, i) => t + num(i.cout), 0);
  }
  return semaines;
}

/* ---------- alertes ---------- */
/** Catégories de rappels : clé, libellé, détail. « autre » n'est jamais notifiée. */
const CATS_NOTIF = [
  ["docs", "Papiers et entretien", "Assurance, visite technique, permis, visa, vidange, pneus…"],
  ["repos", "Repos des chauffeurs", "Service bientôt trop long ou repos obligatoire"],
  ["factures", "Factures en retard", "Échéances dépassées"],
  ["commandes", "Commandes et douane", "Chargements sans équipe, livraisons à facturer, dossiers"],
  ["sauvegarde", "Rappel de sauvegarde", "Quand la dernière sauvegarde date de plus d'une semaine"],
];

function alertes() {
  const P = S.params;
  const liste = [];
  const ajouter = (niveau, onglet, texte, cat = "autre", cle = "") => liste.push({ niveau, onglet, texte, cat, cle });

  for (const c of S.camions) {
    for (const e of etatCamion(c)) if (e.niveau !== "ok") ajouter(e.niveau, "camions", `${c.immat} — ${e.type} ${e.texte}`, "docs", `docs:cam:${c.id}:${e.type}`);
    const moy = consoMoyenne(c.id);
    const conso = consommations(c.id);
    const dernier = S.pleins.filter((p) => p.camionId === c.id && conso[p.id]).sort((a, b) => b.km - a.km)[0];
    if (moy && dernier && conso[dernier.id] > moy * (1 + P.seuilConso / 100)) {
      ajouter("warn", "carburant", `${c.immat} — dernière conso ${fmt(conso[dernier.id], 1)} L/100 (moyenne ${fmt(moy, 1)}) : vérifier fuite, pneus, conduite ou vol de gasoil`, "autre", `conso:${c.id}`);
    }
  }
  for (const ch of S.chauffeurs) {
    const e = etatChauffeur(ch);
    if (e.niveau === "danger") ajouter("danger", "chauffeurs", `${ch.nom} — ${e.texte}`, e.code === "depasse" ? "repos" : "docs", e.code === "depasse" ? `repos:${ch.id}` : `docs:ch:${ch.id}:permis`);
    if (e.code === "service" && e.reste <= 1) ajouter("warn", "chauffeurs", `${ch.nom} — repos obligatoire dans ${fmt(Math.max(0, e.reste) * 60)} min`, "repos", `repos:${ch.id}`);
    for (const [cle, lib] of DOCS_CHAUFFEUR) {
      const j = joursAvant(ch[cle]);
      if (j === null || j > P.alerteJours || (cle === "permis" && j < 0)) continue; // permis expiré : déjà signalé par l'état
      ajouter(j < 0 ? "danger" : "warn", "chauffeurs", `${ch.nom} — ${lib} : ${j < 0 ? `échéance dépassée de ${-j} j` : `échéance dans ${j} j`}`, "docs", `docs:ch:${ch.id}:${cle}`);
    }
  }
  const responsables = {};
  for (const ch of S.chauffeurs) if (ch.camionId) (responsables[ch.camionId] ||= []).push(ch.nom);
  for (const [cid, noms] of Object.entries(responsables)) if (noms.length > 1) ajouter("warn", "chauffeurs", `${nomCamion(cid)} a plusieurs responsables : ${noms.join(", ")}`, "autre", `resp:${cid}`);
  for (const t of S.trajets) {
    if (t.statut === "planifie" && t.date && joursAvant(t.date) < 0) ajouter("warn", "itineraires", `Trajet ${t.depart} → ${t.arrivee} prévu le ${dateFr(t.date)} pas encore démarré`, "commandes", `traj:${t.id}`);
  }
  for (const d of S.dossiers) {
    if (d.statut === "clos") continue;
    const items = CHECKLISTS_DOUANE[d.type] || [];
    const faits = items.filter((_, i) => d.coches?.[i]).length;
    const jd = joursAvant(d.echeance);
    if (jd !== null && jd <= 3 && faits < items.length) ajouter(jd < 0 ? "danger" : "warn", "douane", `Dossier ${d.ref} — échéance ${jd < 0 ? "dépassée" : jd === 0 ? "aujourd'hui" : `dans ${jd} j`} (${faits}/${items.length} documents)`, "commandes", `dossier:${d.id}`);
  }
  for (const f of S.factures) {
    const e = etatFacture(f);
    if (e.code === "retard") ajouter("danger", "factures", `Facture ${f.numero} (${nomClient(f.clientId)}) — ${e.texte}, ${fmtDevise(totauxFacture(f).ttc, f.devise)}`, "factures", `fac:${f.id}`);
  }
  for (const c of S.commandes) {
    if (c.statut === "livre" && !c.factureId) ajouter("warn", "commandes", `Commande ${c.ref} livrée — à facturer`, "commandes", `cmd:${c.id}:facturer`);
    const jc = joursAvant(c.dateChargement);
    if (["devis", "confirme"].includes(c.statut) && jc !== null && jc <= 1 && (!c.chauffeurId || !c.camionId)) {
      ajouter(jc < 0 ? "danger" : "warn", "commandes", `Commande ${c.ref} — chargement ${jc < 0 ? "en retard" : jc === 0 ? "aujourd'hui" : "demain"}, chauffeur ou camion non affecté`, "commandes", `cmd:${c.id}:equipe`);
    }
  }
  for (const a of S.autorisations || []) {
    const lib = `Autorisation ${a.type === "MA" ? "« MA »" : "« E »"} ${a.numero || ""}`.trim();
    const jf = joursAvant(a.fin);
    if (jf !== null && jf <= P.alerteJours && !a.cloturee) ajouter(jf < 0 ? "danger" : "warn", "international", `${lib} — ${jf < 0 ? `expirée depuis ${-jf} j` : `expire dans ${jf} j`}`, "docs", `aut:${a.id}:fin`);
    const ju = a.dateUtilisation ? -joursAvant(a.dateUtilisation) : null;
    if (ju !== null && ju >= 7 && !a.compteRendu) ajouter(ju >= 15 ? "danger" : "warn", "international", `${lib} — compte-rendu de voyage non remis (${ju} j après le voyage)`, "docs", `aut:${a.id}:cr`);
  }
  for (const ch of S.chauffeurs) {
    if (!(ch.sejours || []).length) continue;
    const e = schengenEtat(ch.sejours);
    if (e.depasse) ajouter("danger", "international", `${ch.nom} — ${e.utilise} jours Schengen sur 180 (limite 90 dépassée)`, "docs", `schengen:${ch.id}`);
    else if (e.dedans && e.restant <= 10) ajouter(e.restant <= 3 ? "danger" : "warn", "international", `${ch.nom} — ${e.restant} jour(s) Schengen restant(s) : prévoir la sortie`, "docs", `schengen:${ch.id}`);
  }
  for (const ch of S.chauffeurs) {
    const recentes = (ch.tachy?.infractions || []).filter((i) => i.date && joursAvant(i.date) >= -14);
    if (recentes.length) ajouter(recentes.some((i) => i.gravite === "grave") ? "danger" : "warn", "chauffeurs", `${ch.nom} — ${recentes.length} dépassement(s) des temps de conduite et de repos ces 14 derniers jours (tachygraphe)`, "repos", `tachy:${ch.id}`);
  }
  for (const v of S.voyages || []) {
    if (!["prevu", "en_cours"].includes(v.statut)) continue;
    const jd = joursAvant(v.dateDepart);
    if (v.statut === "prevu" && jd !== null && jd <= 7) for (const c of controlesVoyage(v)) if (c.niveau === "danger" || jd <= 2) ajouter(c.niveau, "voyages", `Voyage ${v.ref} — ${c.texte}`, "commandes", `voy:${v.id}:${c.texte.slice(0, 40)}`);
    if (v.statut === "en_cours" && v.dateRetourPrevue && joursAvant(v.dateRetourPrevue) < 0) ajouter("warn", "voyages", `Voyage ${v.ref} — retour prévu le ${dateFr(v.dateRetourPrevue)}, pas encore terminé`, "commandes", `voy:${v.id}:retard`);
  }
  const js = S.meta.derniereSauvegarde ? -joursAvant(S.meta.derniereSauvegarde.slice(0, 10)) : Infinity;
  if (contientDonnees(S) && js > P.rappelSauvegarde) ajouter("warn", "parametres", S.meta.derniereSauvegarde ? `Dernière sauvegarde il y a ${js} jours — exportez vos données` : "Aucune sauvegarde de vos données — exportez-les", "sauvegarde", "sauvegarde");

  const ordre = { danger: 0, warn: 1 };
  return liste.sort((a, b) => ordre[a.niveau] - ordre[b.niveau]);
}

/* ============================================================
   Transport international Maroc ⇄ Europe (phase 0)
   Schengen, autorisations bilatérales, traversée du détroit, coût et contrôles d'un voyage.
   ============================================================ */

/* ---------- Schengen : 90 jours sur toute période glissante de 180 jours ---------- */
const jourNum = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };
const numJour = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
/** Séjours : [{entree, sortie}] ; sortie vide = encore dans l'espace Schengen. Les jours d'entrée et de sortie comptent. */
function schengenUtilise(sejours, ref = today()) {
  const r = jourNum(ref), debut = r - 179, jours = new Set();
  for (const s of sejours || []) {
    if (!s.entree) continue;
    const a = jourNum(s.entree), b = s.sortie ? jourNum(s.sortie) : r;
    for (let d = Math.max(a, debut); d <= Math.min(b, r); d++) jours.add(d);
  }
  return jours.size;
}
function schengenEtat(sejours, ref = today()) {
  const utilise = schengenUtilise(sejours, ref);
  const dedans = (sejours || []).some((s) => s.entree && !s.sortie && jourNum(s.entree) <= jourNum(ref));
  return { utilise, restant: Math.max(0, 90 - utilise), depasse: utilise > 90, dedans };
}
/** Un séjour prévu entre deux dates reste-t-il dans la limite ? Renvoie le pic d'utilisation et la dernière date autorisée. */
function schengenPrevu(sejours, entree, sortie) {
  const e = jourNum(entree), x = jourNum(sortie);
  const avec = [...(sejours || []).filter((s) => s.entree), { entree, sortie }];
  let pic = 0;
  for (let d = e; d <= x; d++) pic = Math.max(pic, schengenUtilise(avec, numJour(d)));
  let limite = null;
  for (let d = e; d < e + 200; d++) if (schengenUtilise([...(sejours || []).filter((s) => s.entree), { entree, sortie: numJour(d) }], numJour(d)) > 90) { limite = numJour(d - 1); break; }
  return { pic, ok: pic <= 90, limite };
}

/* ---------- Autoroutes du Maroc : classe du véhicule ---------- */
/** Classe 1 : 2 essieux, ≤ 1,30 m · 2 : 2 essieux > 1,30 m, ou plus de 2 essieux ≤ 1,30 m · 3 : plus de 2 essieux et > 1,30 m. */
function classeADM(camion) {
  const essieux = num(camion?.essieux, 0);
  if (!essieux) return null;
  const haut = camion.hauteurBasse ? false : true; // hauteur de l'essieu avant > 1,30 m par défaut (poids lourd)
  if (essieux <= 2) return haut ? 2 : 1;
  return haut ? 3 : 2;
}

/* ---------- Plafonds de poids (décret 2-10-421, identique à la limite européenne) ---------- */
function plafondPoidsT(essieux, combine) {
  const e = num(essieux, 0);
  if (e >= 5) return combine ? 44 : 40;
  if (e === 4) return 36;
  return null; // configuration non couverte : à vérifier
}

/* ---------- Traversées (Tanger Med ⇄ Algeciras est le passage obligé de chaque voyage) ---------- */
const LIGNES_TRAVERSEE = {
  "tmed-alg": { lib: "Tanger Med → Algeciras", duree: "≈ 1 h 30", defauts: { baf: 4.36, ets: 0, lss: 0, fueleu: 0, chauffeur: 0 }, note: "Détroit : fret sur devis (DFDS, Baleària, FRS, Armas…). BAF DFDS 4,36 €/ml (juin 2026) ; ETS non inclus." },
  "alg-tmed": { lib: "Algeciras → Tanger Med", duree: "≈ 1 h 30", defauts: { baf: 4.36, ets: 0, lss: 0, fueleu: 0, chauffeur: 0 }, note: "Détroit : fret sur devis. Présentation 3 h avant le départ (DFDS)." },
  "tmed-sete": { lib: "Tanger Med → Sète", duree: "≈ 38 h", defauts: { fret: 1851, baf: 53, ets: 30.5, lss: 11, fueleu: 3, chauffeur: 150 }, note: "GNV, ensemble 16,5 ml chargé, grille valable depuis le 08/10/2026 (à revérifier)." },
  "sete-tmed": { lib: "Sète → Tanger Med", duree: "≈ 38 h", defauts: { fret: 2031, baf: 53, ets: 30.5, lss: 11, fueleu: 3, chauffeur: 150 }, note: "GNV, ensemble 16,5 ml chargé, grille valable depuis le 08/10/2026 (à revérifier)." },
  autre: { lib: "Autre ligne", duree: "", defauts: {}, note: "" },
};
/** Coût en € : fret de base + mètres linéaires × (BAF + ETS + soufre + FuelEU) + passage chauffeur + frigorifique. */
function coutTraversee(t) {
  const ml = num(t?.ml), surch = num(t?.baf) + num(t?.ets) + num(t?.lss) + num(t?.fueleu);
  return Math.round((num(t?.fret) + ml * surch + num(t?.chauffeur) + num(t?.frigo)) * 100) / 100;
}
const traverseeDetroit = (t) => t?.ligne === "tmed-alg" || t?.ligne === "alg-tmed";

/* ---------- Voyage : jalons, coûts, retour à vide ---------- */
const JALONS_VOYAGE = [
  ["depart", "Départ du dépôt"], ["douane_export", "Douane export (BADR)"], ["port_tmed", "Entrée port Tanger Med"], ["embarque_aller", "Embarqué (aller)"],
  ["debarque_alg", "Débarqué en Europe"], ["livre", "Livré"], ["charge_retour", "Chargement de retour"], ["embarque_retour", "Embarqué (retour)"],
  ["debarque_tmed", "Débarqué à Tanger Med"], ["douane_import", "Douane import"], ["retour", "Retour au dépôt"],
];
const STATUTS_VOYAGE = [["prevu", "Prévu"], ["en_cours", "En cours"], ["termine", "Terminé"], ["annule", "Annulé"]];

function peagesMarocVoyage(v) {
  if (num(v.peagesReelMad)) return num(v.peagesReelMad); // péage mesuré par GPS : prioritaire
  const cam = parId(S.camions, v.camionId);
  const classe = classeADM(cam) || 3;
  if (v.peageTrajet && typeof admTrajet === "function") {
    const t = admTrajet(v.peageTrajet, classe);
    if (t) return Math.round(t.total * (v.peageAR ? 2 : 1));
  }
  return num(v.peagesMad);
}
/** « ES 950, FR 880 » → { ES: 950, FR: 880 } (codes pays sur 2 lettres, kilomètres). */
function lireKmPays(texte) {
  const o = {};
  for (const m of String(texte || "").toUpperCase().matchAll(/\b([A-Z]{2})\b\s*[:=]?\s*(\d+(?:[.,]\d+)?)/g)) o[m[1]] = (o[m[1]] || 0) + num(m[2]);
  return o;
}
/** Péages d'Europe estimés : kilomètres par pays × tarif €/km du pays. Pays sans tarif renseigné : listés, jamais devinés. */
function peagesEuropeVoyage(v) {
  const km = typeof v.kmPays === "string" ? lireKmPays(v.kmPays) : v.kmPays || {}, tarifs = S.params.peagesEu || {};
  const manquants = [], detail = [];
  let eur = 0;
  const kmSansFr = (v.peageFr1 || v.peageFr2 || v.peageFr3) ? Object.fromEntries(Object.entries(km).filter(([p]) => p !== "FR")) : km; // la France est comptée par liaisons officielles
  for (const [pays, k] of Object.entries(kmSansFr)) { const t = num(tarifs[pays]); if (t > 0) { detail.push({ pays, km: k, tarif: t, eur: k * t }); eur += k * t; } else manquants.push(pays); }
  return { eur: Math.round(eur * 100) / 100, detail, manquants };
}
/** Péages de France sur les liaisons VINCI Autoroutes choisies (classe 3 si le camion a 2 essieux, sinon classe 4). */
function peagesFranceVoyage(v) {
  const noms = [v.peageFr1, v.peageFr2, v.peageFr3].filter(Boolean);
  if (!noms.length || typeof FR_LIAISONS === "undefined") return { eur: 0, classe: null, detail: [] };
  const cam = parId(S.camions, v.camionId), classe = cam && num(cam.essieux) && num(cam.essieux) <= 2 ? 3 : 4, col = 1 + classe;
  const detail = noms.map((n) => { const l = FR_LIAISONS.find((x) => x[1] === n); return { liaison: n, eur: l ? l[1 + classe] : 0 }; });
  const total = detail.reduce((s, d) => s + d.eur, 0) * (v.peageFrAR ? 2 : 1);
  return { eur: Math.round(total * 100) / 100, classe, detail, col };
}
/** Coût complet d'un voyage, en MAD. */
function coutVoyage(v) {
  const taux = S.params.tauxEUR;
  const trav = (v.traversees || []).reduce((s, t) => s + coutTraversee(t), 0) * taux;
  const parts = {
    peagesMaroc: peagesMarocVoyage(v), peagesFrance: peagesFranceVoyage(v).eur * taux, peagesEurope: (num(v.peagesEurReel) > 0 ? num(v.peagesEurReel) : v.kmPays && peagesEuropeVoyage(v).eur > 0 ? peagesEuropeVoyage(v).eur : num(v.peagesEur)) * taux, traversees: trav, carburant: num(v.carburantMad),
    fraisRoute: num(v.fraisRouteMad), douane: num(v.douaneMad), autres: num(v.autresMad),
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  const prix = v.devise === "EUR" ? num(v.prix) * taux : num(v.prix);
  const km = num(v.kmAller) + num(v.kmRetourCharge) + num(v.kmRetourVide);
  return { parts, total, prix, marge: prix - total, taux: prix ? ((prix - total) / prix) * 100 : 0, km, coutKm: km ? total / km : 0 };
}
/** Part des kilomètres roulés à vide et coût estimé (au coût moyen du kilomètre). */
function retourVide(voyages) {
  const l = voyages.filter((v) => v.statut !== "annule");
  const vide = l.reduce((s, v) => s + num(v.kmRetourVide), 0);
  const km = l.reduce((s, v) => s + num(v.kmAller) + num(v.kmRetourCharge) + num(v.kmRetourVide), 0);
  const cout = l.reduce((s, v) => s + coutVoyage(v).total, 0);
  return { kmVide: vide, km, pct: km ? (vide / km) * 100 : 0, coutVide: km ? (cout / km) * vide : 0, nb: l.length };
}

/** Contrôles avant départ et pendant le voyage (visa, passeport, papiers, autorisation, Schengen, charge, traversée). */
function controlesVoyage(v) {
  const r = [];
  const ch = parId(S.chauffeurs, v.chauffeurId), cam = parId(S.camions, v.camionId);
  const retour = v.dateRetourPrevue || v.dateDepart;
  const apresRetour = (iso) => iso && retour && joursEntre(retour, iso) < 0;
  const ajouter = (niveau, texte) => r.push({ niveau, texte });
  if (!ch) ajouter("warn", "Aucun chauffeur affecté"); if (!cam) ajouter("warn", "Aucun camion affecté");
  if (ch) {
    if (!ch.visa) ajouter("warn", `${ch.nom} : visa non renseigné`);
    else if (apresRetour(ch.visa)) ajouter("danger", `${ch.nom} : le visa expire le ${dateFr(ch.visa)}, avant la fin du voyage (${dateFr(retour)})`);
    if (ch.passeport && retour && joursEntre(retour, ch.passeport) < 183) ajouter(joursEntre(retour, ch.passeport) < 0 ? "danger" : "warn", `${ch.nom} : passeport valable moins de 6 mois après le retour (${dateFr(ch.passeport)})`);
    for (const [k, l] of [["permis", "permis"], ["carteConducteur", "carte conducteur"]]) if (apresRetour(ch[k])) ajouter("danger", `${ch.nom} : ${l} expire le ${dateFr(ch[k])}, avant la fin du voyage`);
    if (v.dateDepart && retour) {
      const p = schengenPrevu(ch.sejours, v.dateDepart, retour);
      if (!p.ok) ajouter("danger", `${ch.nom} : ${p.pic} jours Schengen prévus sur 180 (limite 90) — dernier jour autorisé : ${p.limite ? dateFr(p.limite) : "?"}`);
      else if (p.pic > 80) ajouter("warn", `${ch.nom} : ${p.pic}/90 jours Schengen après ce voyage`);
    }
  }
  if (cam) {
    for (const [k, l] of DOCS_CAMION) if (k !== "autorisation" && apresRetour(cam[k])) ajouter("danger", `${cam.immat} : ${l.toLowerCase()} expire le ${dateFr(cam[k])}, avant la fin du voyage`);
    if (!num(cam.essieux)) ajouter("warn", `${cam.immat} : essieux non renseignés (classe de péage et poids autorisé inconnus)`);
    const pl = plafondPoidsT(cam.essieux, v.transportCombine);
    if (pl && num(v.ptacT) > pl) ajouter("danger", `PTAC prévu ${fmt(v.ptacT, 1)} t au-dessus de la limite de ${pl} t`);
  }
  const a = parId(S.autorisations, v.autorisationId);
  if (!a) ajouter("warn", "Aucune autorisation bilatérale (« E » ou « MA ») rattachée à ce voyage");
  else {
    if (a.fin && v.dateDepart && joursEntre(v.dateDepart, a.fin) < 0) ajouter("danger", `Autorisation ${a.numero || a.type} expirée au départ (${dateFr(a.fin)})`);
    else if (a.fin && retour && joursEntre(retour, a.fin) < 0) ajouter("warn", `Autorisation ${a.numero || a.type} valable jusqu'au ${dateFr(a.fin)}, avant le retour`);
  }
  const trav = v.traversees || [];
  for (const sens of ["aller", "retour"]) {
    const t = trav.find((x) => x.sens === sens);
    if (!t) ajouter("warn", `Traversée ${sens} non renseignée`);
    else if (t.statut === "a_reserver") ajouter("warn", `Traversée ${sens} (${LIGNES_TRAVERSEE[t.ligne]?.lib || "?"}) à réserver`);
  }
  return r;
}

/** Séjours à prévoir : interdictions de circuler le week-end (valeurs indicatives, à vérifier). */
function interdictionsLe(dateStr, liste) {
  const j = new Date(dateStr + "T00:00:00").getDay();
  return (liste || []).filter((i) => i.jours.includes(j));
}

const joursEntre = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);

/**
 * Quelles notifications envoyer maintenant ? Pure.
 *  - liste     : résultat de alertes()
 *  - cfg       : { actif, cats: { docs: false, … } } (une catégorie absente est activée)
 *  - notifies  : { clé: "AAAA-MM-JJ" } dernière notification par alerte
 * Urgent : rappelé chaque jour · à surveiller : tous les 3 jours. Au plus 3 notifications urgentes + 1 résumé.
 */
function notificationsAEnvoyer(liste, cfg, notifies = {}, jour = today()) {
  if (!cfg?.actif) return { items: [], cles: [] };
  const cats = cfg.cats || {};
  const nouvelles = liste.filter((a) => {
    if (!a.cle || a.cat === "autre" || cats[a.cat] === false) return false;
    const dernier = notifies[a.cle];
    return !dernier || joursEntre(dernier, jour) >= (a.niveau === "danger" ? 1 : 3);
  });
  const urgentes = nouvelles.filter((a) => a.niveau === "danger").slice(0, 3);
  const reste = nouvelles.filter((a) => !urgentes.includes(a));
  const items = urgentes.map((a) => ({ tag: a.cle, titre: "Urgent — Logistique Fret", corps: a.texte, onglet: a.onglet }));
  if (reste.length) {
    items.push({ tag: "resume", titre: urgentes.length ? `${reste.length} autre${reste.length > 1 ? "s points" : " point"} à traiter` : `${reste.length} point${reste.length > 1 ? "s" : ""} à surveiller`, corps: reste.slice(0, 3).map((a) => a.texte).join("\n") + (reste.length > 3 ? `\n+ ${reste.length - 3} autre${reste.length > 4 ? "s" : ""}` : ""), onglet: "tableau" });
  }
  return { items, cles: [...urgentes, ...reste].map((a) => a.cle) };
}

/* ---------- service du chauffeur, étapes de commande, missions ---------- */
function prendreService(ch, maintenant = Date.now()) {
  ch.debutService = new Date(maintenant).toISOString();
  ch.reposJusqua = null;
}
function finDeService(ch, maintenant = Date.now()) {
  ch.debutService = null;
  ch.reposJusqua = new Date(maintenant + S.params.reposMinHeures * 3600000).toISOString();
}

/** Fait avancer une commande à l'étape nx : jalon horodaté, trajet lié démarré/terminé, kilométrage du camion. */
function appliquerEtape(c, nx, maintenant = new Date()) {
  c.statut = nx;
  (c.jalons ||= []).push({ statut: nx, date: maintenant.toISOString() });
  const t = c.trajetId && parId(S.trajets, c.trajetId);
  if (nx === "charge" && t && t.statut === "planifie") t.statut = "encours";
  if (nx === "livre") {
    c.dateLivraison ||= dateISO(maintenant);
    if (t && t.statut !== "termine") {
      t.statut = "termine";
      const cam = parId(S.camions, t.camionId);
      if (cam) cam.km += t.distance;
    }
  }
}

/** Commandes non livrées d'un chauffeur, la plus avancée d'abord. */
function missionsChauffeur(id) {
  const ordre = { douane: 0, transit: 1, charge: 2, confirme: 3, devis: 4 };
  return S.commandes.filter((c) => c.chauffeurId === id && c.statut !== "livre")
    .sort((a, b) => (ordre[a.statut] - ordre[b.statut]) || (a.dateChargement || "").localeCompare(b.dateChargement || ""));
}
/** Trajets d'un chauffeur qui ne sont rattachés à aucune commande. */
function trajetsIsoles(id) {
  const lies = new Set(S.commandes.map((c) => c.trajetId).filter(Boolean));
  return S.trajets.filter((t) => t.chauffeurId === id && t.statut !== "termine" && !lies.has(t.id));
}

/* ---------- commercial : commandes, factures, marges ---------- */
const nomClient = (id) => parId(S.clients, id)?.nom || "—";
const libStatutCmd = (s) => (STATUTS_CMD.find(([k]) => k === s) || [, s])[1];
const fmtDevise = (n, devise = "MAD") => `${fmt(n, 2)} ${devise === "EUR" ? "€" : "MAD"}`;

function versMAD(montant, devise) {
  return devise === "EUR" ? num(montant) * S.params.tauxEUR : num(montant);
}

/** Coût d'une commande en MAD : trajet lié (gasoil + péages) + ferry + frais chauffeur + autres. */
function coutCommande(c) {
  const t = c.trajetId && parId(S.trajets, c.trajetId);
  return (t ? t.calcul.coutTotal : 0) + num(c.ferry) + num(c.fraisChauffeur) + num(c.autres);
}

function margeCommande(c) {
  const prix = versMAD(c.prix, c.devise);
  const marge = prix - coutCommande(c);
  return { prix, cout: prix - marge, marge, taux: prix ? (marge / prix) * 100 : 0 };
}

function totauxFacture(f) {
  const ht = (f.lignes || []).reduce((s, l) => s + num(l.montant), 0);
  const tva = (ht * num(f.tva)) / 100;
  return { ht, tva, ttc: ht + tva };
}

/** Prochain numéro de pièce : PREFIXE-AAAA-0001, séquentiel par année. */
function prochainNumero(prefixe, liste, champ, annee = today().slice(0, 4)) {
  const re = new RegExp(`^${prefixe}-${annee}-(\\d+)$`);
  const max = liste.reduce((m, x) => { const r = re.exec(x[champ] || ""); return r ? Math.max(m, +r[1]) : m; }, 0);
  return `${prefixe}-${annee}-${String(max + 1).padStart(4, "0")}`;
}

function etatFacture(f) {
  if (f.statut === "payee") return { code: "payee", niveau: "ok", texte: `Payée le ${dateFr(f.datePaiement)}` };
  const j = joursAvant(f.echeance);
  if (j !== null && j < 0) return { code: "retard", niveau: "danger", texte: `en retard de ${-j} j` };
  return { code: "attente", niveau: "warn", texte: j === null ? "En attente" : j === 0 ? "Échéance aujourd'hui" : `Échéance dans ${j} j` };
}

/** Encours clients en MAD (factures non payées) et part en retard. */
function encoursClients(clientId = null) {
  let total = 0, retard = 0;
  for (const f of S.factures) {
    if (f.statut === "payee" || (clientId && f.clientId !== clientId)) continue;
    const m = versMAD(totauxFacture(f).ttc, f.devise);
    total += m;
    if (etatFacture(f).code === "retard") retard += m;
  }
  return { total, retard };
}

/** Chiffre d'affaires et marge des commandes livrées depuis une date (MAD). */
function activiteDepuis(depuis) {
  const cmds = S.commandes.filter((c) => c.statut === "livre" && (c.dateLivraison || "") >= depuis);
  const r = cmds.reduce((a, c) => { const m = margeCommande(c); a.ca += m.prix; a.marge += m.marge; return a; }, { ca: 0, marge: 0 });
  return { ...r, nb: cmds.length, taux: r.ca ? (r.marge / r.ca) * 100 : 0 };
}

/* ---------- montants en lettres (français) ---------- */
const UNITES_FR = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const DIZAINES_FR = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];

/** 0-99. « quatre-vingts » prend son s seulement s'il termine le groupe (pluriel). */
function moinsDeCentFr(n, pluriel) {
  if (n < 20) return UNITES_FR[n];
  const d = Math.floor(n / 10), u = n % 10;
  if (d === 7) return u === 1 ? "soixante et onze" : `soixante-${UNITES_FR[10 + u]}`;
  if (d === 9) return `quatre-vingt-${UNITES_FR[10 + u]}`;
  if (d === 8) return u === 0 ? (pluriel ? "quatre-vingts" : "quatre-vingt") : `quatre-vingt-${UNITES_FR[u]}`;
  if (u === 0) return DIZAINES_FR[d];
  return u === 1 ? `${DIZAINES_FR[d]} et un` : `${DIZAINES_FR[d]}-${UNITES_FR[u]}`;
}
/** 1-999. pluriel=false devant « mille » (invariable : « deux cent mille », « quatre-vingt mille »). */
function moinsDeMilleFr(n, pluriel) {
  const c = Math.floor(n / 100), r = n % 100;
  let s = c ? (c === 1 ? "cent" : `${UNITES_FR[c]} cent`) + (r === 0 && c > 1 && pluriel ? "s" : "") : "";
  if (r) s += (s ? " " : "") + moinsDeCentFr(r, pluriel);
  return s;
}
function nombreEnLettres(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "zéro";
  const [mds, mil, k, u] = [Math.floor(n / 1e9) % 1000, Math.floor(n / 1e6) % 1000, Math.floor(n / 1e3) % 1000, n % 1000];
  const p = [];
  if (mds) p.push(`${moinsDeMilleFr(mds, true)} milliard${mds > 1 ? "s" : ""}`);
  if (mil) p.push(`${moinsDeMilleFr(mil, true)} million${mil > 1 ? "s" : ""}`);
  if (k) p.push(k === 1 ? "mille" : `${moinsDeMilleFr(k, false)} mille`);
  if (u) p.push(moinsDeMilleFr(u, true));
  return p.join(" ");
}
/** « trois mille six cent quarante-huit dirhams et cinquante centimes » */
function montantEnLettres(montant, devise = "MAD") {
  const total = Math.round(Math.abs(montant) * 100);
  const ent = Math.floor(total / 100), cts = total % 100;
  const [un, plur] = devise === "EUR" ? ["euro", "euros"] : ["dirham", "dirhams"];
  return `${nombreEnLettres(ent)} ${ent > 1 ? plur : un}${cts ? ` et ${nombreEnLettres(cts)} centime${cts > 1 ? "s" : ""}` : ""}`;
}
