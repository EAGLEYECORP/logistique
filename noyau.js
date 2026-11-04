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
};

function etatVide() {
  return {
    camions: [], pleins: [], interventions: [], chauffeurs: [], trajets: [], dossiers: [], codes: [],
    params: { ...PARAMS_DEFAUT }, meta: {},
  };
}

function normaliser(e) {
  const base = etatVide();
  return { ...base, ...e, params: { ...PARAMS_DEFAUT, ...(e?.params || {}) }, meta: { ...(e?.meta || {}) } };
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
  for (const [cle, lib] of [["assurance", "Assurance"], ["visite", "Visite technique"]]) {
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
    return { dispo: true, niveau: "ok", code: "service", texte: `En service depuis ${fmt(h, 1)} h · reste ${fmt(P.amplitudeMaxHeures - h, 1)} h` };
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
function alertes() {
  const P = S.params;
  const liste = [];
  const ajouter = (niveau, onglet, texte) => liste.push({ niveau, onglet, texte });

  for (const c of S.camions) {
    for (const e of etatCamion(c)) if (e.niveau !== "ok") ajouter(e.niveau, "camions", `${c.immat} — ${e.type} ${e.texte}`);
    const moy = consoMoyenne(c.id);
    const conso = consommations(c.id);
    const dernier = S.pleins.filter((p) => p.camionId === c.id && conso[p.id]).sort((a, b) => b.km - a.km)[0];
    if (moy && dernier && conso[dernier.id] > moy * (1 + P.seuilConso / 100)) {
      ajouter("warn", "carburant", `${c.immat} — dernière conso ${fmt(conso[dernier.id], 1)} L/100 (moyenne ${fmt(moy, 1)}) : vérifier fuite, pneus, conduite ou vol de gasoil`);
    }
  }
  for (const ch of S.chauffeurs) {
    const e = etatChauffeur(ch);
    if (e.niveau === "danger") ajouter("danger", "chauffeurs", `${ch.nom} — ${e.texte}`);
    const j = joursAvant(ch.permis);
    if (j !== null && j >= 0 && j <= P.alerteJours) ajouter("warn", "chauffeurs", `${ch.nom} — permis expire dans ${j} j`);
    const jv = joursAvant(ch.visiteMedicale);
    if (jv !== null && jv <= P.alerteJours) ajouter(jv < 0 ? "danger" : "warn", "chauffeurs", `${ch.nom} — visite médicale ${jv < 0 ? `expirée depuis ${-jv} j` : `dans ${jv} j`}`);
  }
  const responsables = {};
  for (const ch of S.chauffeurs) if (ch.camionId) (responsables[ch.camionId] ||= []).push(ch.nom);
  for (const [cid, noms] of Object.entries(responsables)) if (noms.length > 1) ajouter("warn", "chauffeurs", `${nomCamion(cid)} a plusieurs responsables : ${noms.join(", ")}`);
  for (const t of S.trajets) {
    if (t.statut === "planifie" && t.date && joursAvant(t.date) < 0) ajouter("warn", "itineraires", `Trajet ${t.depart} → ${t.arrivee} prévu le ${dateFr(t.date)} pas encore démarré`);
  }
  for (const d of S.dossiers) {
    if (d.statut === "clos") continue;
    const items = CHECKLISTS_DOUANE[d.type] || [];
    const faits = items.filter((_, i) => d.coches?.[i]).length;
    const jd = joursAvant(d.echeance);
    if (jd !== null && jd <= 3 && faits < items.length) ajouter(jd < 0 ? "danger" : "warn", "douane", `Dossier ${d.ref} — échéance ${jd < 0 ? "dépassée" : jd === 0 ? "aujourd'hui" : `dans ${jd} j`} (${faits}/${items.length} documents)`);
  }
  const aDesDonnees = S.camions.length || S.chauffeurs.length || S.dossiers.length;
  const js = S.meta.derniereSauvegarde ? -joursAvant(S.meta.derniereSauvegarde.slice(0, 10)) : Infinity;
  if (aDesDonnees && js > 7) ajouter("warn", "parametres", S.meta.derniereSauvegarde ? `Dernière sauvegarde il y a ${js} jours — exportez vos données` : "Aucune sauvegarde de vos données — exportez-les");

  const ordre = { danger: 0, warn: 1 };
  return liste.sort((a, b) => ordre[a.niveau] - ordre[b.niveau]);
}
