"use strict";

/* ============================================================
   Stockage local (aucun serveur, aucun abonnement)
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
};

function etatVide() {
  return { camions: [], pleins: [], chauffeurs: [], trajets: [], dossiers: [], codes: [], params: { ...PARAMS_DEFAUT } };
}

function charger() {
  try {
    const brut = localStorage.getItem(STORAGE_KEY);
    if (!brut) return etatVide();
    const e = JSON.parse(brut);
    const base = etatVide();
    return { ...base, ...e, params: { ...PARAMS_DEFAUT, ...(e.params || {}) } };
  } catch {
    return etatVide();
  }
}

let S = charger();

function sauver() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); }
  catch { alert("Impossible d'enregistrer (stockage du navigateur indisponible). Exportez vos données."); }
}

/* ============================================================
   Utilitaires
   ============================================================ */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, d = 0) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : d; };
const fmt = (n, dec = 0) => Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const mad = (n) => fmt(n, 2) + " MAD";
const today = () => new Date().toISOString().slice(0, 10);
const sansAccent = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const joursAvant = (dateStr) => dateStr ? Math.ceil((new Date(dateStr) - new Date(today())) / 86400000) : null;
const dateFr = (d) => d ? new Date(d).toLocaleDateString("fr-FR") : "—";
const dateHeureFr = (d) => d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";
const badge = (txt, niveau) => `<span class="badge ${niveau}">${esc(txt)}</span>`;
const parId = (liste, id) => liste.find((x) => x.id === id);
const nomCamion = (id) => parId(S.camions, id)?.immat || "—";
const nomChauffeur = (id) => parId(S.chauffeurs, id)?.nom || "—";

function champ(f) {
  const v = f.value ?? "";
  const req = f.required ? "required" : "";
  if (f.type === "select") {
    const opts = f.options.map(([val, lib]) => `<option value="${esc(val)}" ${String(val) === String(v) ? "selected" : ""}>${esc(lib)}</option>`).join("");
    return `<label>${esc(f.label)}<select name="${f.name}" ${req}>${opts}</select></label>`;
  }
  if (f.type === "checkbox") {
    return `<label class="checklist"><span class="row"><input type="checkbox" name="${f.name}" ${v ? "checked" : ""}> ${esc(f.label)}</span></label>`;
  }
  const step = f.step ? `step="${f.step}"` : f.type === "number" ? 'step="any"' : "";
  return `<label>${esc(f.label)}<input type="${f.type || "text"}" name="${f.name}" value="${esc(v)}" ${step} ${req} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ""}></label>`;
}

function lireForm(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    o[el.name] = el.type === "checkbox" ? el.checked : el.value.trim();
  }
  return o;
}

const optsCamions = (vide = "— Aucun —") => [["", vide], ...S.camions.map((c) => [c.id, `${c.immat} ${c.marque ? "(" + c.marque + ")" : ""}`])];
const optsChauffeurs = (liste = S.chauffeurs) => [["", "— Aucun —"], ...liste.map((c) => [c.id, c.nom])];

function telecharger(nom, contenu, type) {
  const blob = new Blob([contenu], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function versCSV(lignes) {
  if (!lignes.length) return "";
  const cols = Object.keys(lignes[0]);
  const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "﻿" + [cols.map(cel).join(";"), ...lignes.map((l) => cols.map((c) => cel(l[c])).join(";"))].join("\n");
}

/* ============================================================
   Calculs métier
   ============================================================ */

// Consommation L/100 km par plein, méthode « plein à plein ».
function consommations(camionId) {
  const pleins = S.pleins.filter((p) => p.camionId === camionId).sort((a, b) => a.km - b.km);
  const res = {};
  let dernierPlein = null;
  let litresDepuis = 0;
  for (const p of pleins) {
    litresDepuis += p.litres;
    if (p.plein) {
      if (dernierPlein && p.km > dernierPlein.km) {
        res[p.id] = (litresDepuis / (p.km - dernierPlein.km)) * 100;
      }
      dernierPlein = p;
      litresDepuis = 0;
    }
  }
  return res;
}

function consoMoyenne(camionId) {
  const v = Object.values(consommations(camionId));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function etatCamion(c) {
  const P = S.params;
  const out = [];
  const resteVid = c.kmVidange + c.intervalleVidange - c.km;
  const restePneus = c.kmPneus + c.intervallePneus - c.km;
  out.push({ type: "Vidange", reste: resteVid, niveau: resteVid <= 0 ? "danger" : resteVid <= P.alerteKm ? "warn" : "ok", texte: resteVid <= 0 ? `dépassée de ${fmt(-resteVid)} km` : `dans ${fmt(resteVid)} km` });
  out.push({ type: "Pneus", reste: restePneus, niveau: restePneus <= 0 ? "danger" : restePneus <= P.alerteKm ? "warn" : "ok", texte: restePneus <= 0 ? `usure dépassée de ${fmt(-restePneus)} km` : `dans ${fmt(restePneus)} km` });
  for (const [cle, lib] of [["assurance", "Assurance"], ["visite", "Visite technique"]]) {
    const j = joursAvant(c[cle]);
    if (j === null) continue;
    out.push({ type: lib, niveau: j < 0 ? "danger" : j <= P.alerteJours ? "warn" : "ok", texte: j < 0 ? `expirée depuis ${-j} j` : `expire dans ${j} j` });
  }
  return out;
}

function etatChauffeur(ch) {
  const P = S.params;
  const maintenant = Date.now();
  if (ch.conge) return { dispo: false, niveau: "warn", texte: "En congé" };
  const jPermis = joursAvant(ch.permis);
  if (jPermis !== null && jPermis < 0) return { dispo: false, niveau: "danger", texte: "Permis expiré" };
  if (ch.reposJusqua && new Date(ch.reposJusqua).getTime() > maintenant) {
    return { dispo: false, niveau: "warn", texte: `En repos jusqu'à ${dateHeureFr(ch.reposJusqua)}` };
  }
  if (ch.debutService) {
    const h = (maintenant - new Date(ch.debutService).getTime()) / 3600000;
    if (h >= P.amplitudeMaxHeures) return { dispo: false, niveau: "danger", texte: `En service depuis ${fmt(h, 1)} h — repos obligatoire` };
    return { dispo: true, niveau: "ok", texte: `En service depuis ${fmt(h, 1)} h (reste ${fmt(P.amplitudeMaxHeures - h, 1)} h)` };
  }
  return { dispo: true, niveau: "ok", texte: "Disponible" };
}

function calculTrajet({ distance, peage, conso, prix }) {
  const P = S.params;
  const litres = (distance * conso) / 100;
  const coutGasoil = litres * prix;
  const heuresConduite = distance / P.vitesseMoyenne;
  const jours = Math.max(1, Math.ceil(heuresConduite / P.conduiteMaxJour));
  // pauses dans chaque journée de conduite
  let pauses = 0;
  let reste = heuresConduite;
  for (let j = 0; j < jours; j++) {
    const hj = Math.min(reste, P.conduiteMaxJour);
    pauses += Math.max(0, Math.ceil(hj / P.conduiteAvantPause) - 1);
    reste -= hj;
  }
  const reposNuit = jours - 1;
  const dureeTotale = heuresConduite + pauses * P.dureePause + reposNuit * P.reposMinHeures;
  return { litres, coutGasoil, coutTotal: coutGasoil + peage, heuresConduite, pauses, reposNuit, jours, dureeTotale };
}

function alertes() {
  const P = S.params;
  const liste = [];
  for (const c of S.camions) {
    for (const e of etatCamion(c)) if (e.niveau !== "ok") liste.push({ niveau: e.niveau, texte: `🚚 ${c.immat} — ${e.type} ${e.texte}` });
    const moy = consoMoyenne(c.id);
    const conso = consommations(c.id);
    const derniers = S.pleins.filter((p) => p.camionId === c.id && conso[p.id]).sort((a, b) => b.km - a.km);
    if (moy && derniers[0] && conso[derniers[0].id] > moy * 1.15) {
      liste.push({ niveau: "warn", texte: `⛽ ${c.immat} — dernière conso ${fmt(conso[derniers[0].id], 1)} L/100 (moyenne ${fmt(moy, 1)}) : vérifier fuite, pneus, conduite ou vol de gasoil` });
    }
  }
  for (const ch of S.chauffeurs) {
    const e = etatChauffeur(ch);
    if (e.niveau === "danger") liste.push({ niveau: "danger", texte: `👤 ${ch.nom} — ${e.texte}` });
    const j = joursAvant(ch.permis);
    if (j !== null && j >= 0 && j <= P.alerteJours) liste.push({ niveau: "warn", texte: `👤 ${ch.nom} — permis expire dans ${j} j` });
    const jv = joursAvant(ch.visiteMedicale);
    if (jv !== null && jv <= P.alerteJours) liste.push({ niveau: jv < 0 ? "danger" : "warn", texte: `👤 ${ch.nom} — visite médicale ${jv < 0 ? "expirée" : `dans ${jv} j`}` });
  }
  const responsables = {};
  for (const ch of S.chauffeurs) if (ch.camionId) (responsables[ch.camionId] ||= []).push(ch.nom);
  for (const [cid, noms] of Object.entries(responsables)) if (noms.length > 1) liste.push({ niveau: "warn", texte: `🚚 ${nomCamion(cid)} a plusieurs responsables : ${noms.join(", ")}` });
  for (const d of S.dossiers) {
    if (d.statut === "clos") continue;
    const items = CHECKLISTS_DOUANE[d.type] || [];
    const faits = items.filter((_, i) => d.coches?.[i]).length;
    const jd = joursAvant(d.echeance);
    if (jd !== null && jd <= 3) liste.push({ niveau: jd < 0 ? "danger" : "warn", texte: `📄 Dossier ${d.ref} — échéance ${jd < 0 ? "dépassée" : `dans ${jd} j`} (${faits}/${items.length} documents)` });
  }
  return liste.sort((a, b) => (a.niveau === "danger" ? -1 : 1) - (b.niveau === "danger" ? -1 : 1));
}

/* ============================================================
   Vues
   ============================================================ */
const VUES = {};
let ongletActif = "tableau";

function afficher(onglet = ongletActif) {
  ongletActif = onglet;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === onglet));
  document.getElementById("app").innerHTML = VUES[onglet]();
  BRANCHEMENTS[onglet]?.();
}

const BRANCHEMENTS = {};
const $ = (sel) => document.querySelector(sel);
function surSoumission(sel, fn) {
  const f = $(sel);
  if (f) f.addEventListener("submit", (e) => { e.preventDefault(); fn(lireForm(f), f); });
}
function surActions(fn) {
  document.getElementById("app").querySelectorAll("[data-act]").forEach((b) =>
    b.addEventListener("click", () => fn(b.dataset.act, b.dataset.id, b)));
}

/* ---------- Tableau de bord ---------- */
VUES.tableau = () => {
  const il30j = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const coutMois = S.pleins.filter((p) => p.date >= il30j).reduce((s, p) => s + p.litres * p.prix, 0);
  const dispo = S.chauffeurs.filter((c) => etatChauffeur(c).dispo).length;
  const enCours = S.trajets.filter((t) => t.statut !== "termine").length;
  const dossiers = S.dossiers.filter((d) => d.statut !== "clos").length;
  const al = alertes();
  const vide = !S.camions.length && !S.chauffeurs.length;
  return `
    <div class="kpis">
      <div class="kpi"><div class="v">${S.camions.length}</div><div class="l">Camions</div></div>
      <div class="kpi"><div class="v">${dispo}/${S.chauffeurs.length}</div><div class="l">Chauffeurs disponibles</div></div>
      <div class="kpi"><div class="v">${enCours}</div><div class="l">Trajets planifiés / en cours</div></div>
      <div class="kpi"><div class="v">${dossiers}</div><div class="l">Dossiers douane ouverts</div></div>
      <div class="kpi"><div class="v">${fmt(coutMois)}</div><div class="l">Gasoil sur 30 jours (MAD)</div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>À faire aujourd'hui (${al.length})</h2>
      ${al.length ? `<ul class="alerts">${al.map((a) => `<li>${badge(a.niveau === "danger" ? "Urgent" : "Bientôt", a.niveau)} ${esc(a.texte)}</li>`).join("")}</ul>`
        : `<p class="muted">Rien à signaler. ${vide ? "Commencez par ajouter vos camions et chauffeurs, ou chargez les données d'exemple dans Paramètres." : ""}</p>`}
    </div>`;
};

/* ---------- Camions ---------- */
let camionEdite = null;
VUES.camions = () => {
  const P = S.params;
  const c = camionEdite ? parId(S.camions, camionEdite) : null;
  const responsables = (id) => S.chauffeurs.filter((ch) => ch.camionId === id).map((ch) => ch.nom).join(", ") || "—";
  return `
  <div class="card">
    <h2>${c ? "Modifier " + esc(c.immat) : "Ajouter un camion"}</h2>
    <form id="f-camion" class="grid">
      ${champ({ name: "immat", label: "Immatriculation", value: c?.immat, required: true, placeholder: "12345-A-6" })}
      ${champ({ name: "marque", label: "Marque / modèle", value: c?.marque })}
      ${champ({ name: "km", label: "Kilométrage actuel", type: "number", value: c?.km, required: true })}
      ${champ({ name: "kmVidange", label: "Km dernière vidange", type: "number", value: c?.kmVidange })}
      ${champ({ name: "intervalleVidange", label: "Intervalle vidange (km)", type: "number", value: c?.intervalleVidange ?? P.intervalleVidange })}
      ${champ({ name: "kmPneus", label: "Km dernier changement pneus", type: "number", value: c?.kmPneus })}
      ${champ({ name: "intervallePneus", label: "Durée de vie pneus (km)", type: "number", value: c?.intervallePneus ?? P.intervallePneus })}
      ${champ({ name: "assurance", label: "Fin d'assurance", type: "date", value: c?.assurance })}
      ${champ({ name: "visite", label: "Prochaine visite technique", type: "date", value: c?.visite })}
      <div class="row"><button class="btn">${c ? "Enregistrer" : "Ajouter"}</button>${c ? '<button type="button" class="btn ghost" data-act="annuler">Annuler</button>' : ""}</div>
    </form>
  </div>
  <div class="card">
    <h2>Flotte (${S.camions.length})</h2>
    ${S.camions.length ? `<div class="table-wrap"><table>
      <tr><th>Camion</th><th>Km</th><th>Responsable</th><th>Conso moy.</th><th>Entretien</th><th></th></tr>
      ${S.camions.map((c) => {
        const moy = consoMoyenne(c.id);
        return `<tr>
          <td><strong>${esc(c.immat)}</strong><br><span class="muted">${esc(c.marque)}</span></td>
          <td>${fmt(c.km)}</td>
          <td>${esc(responsables(c.id))}</td>
          <td>${moy ? fmt(moy, 1) + " L/100" : "—"}</td>
          <td>${etatCamion(c).map((e) => `${badge(e.type, e.niveau)} <span class="muted">${esc(e.texte)}</span>`).join("<br>")}</td>
          <td class="row">
            <button class="btn small ghost" data-act="vidange" data-id="${c.id}">Vidange faite</button>
            <button class="btn small ghost" data-act="pneus" data-id="${c.id}">Pneus changés</button>
            <button class="btn small ghost" data-act="km" data-id="${c.id}">Saisir km</button>
            <button class="btn small ghost" data-act="modifier" data-id="${c.id}">Modifier</button>
            <button class="btn small danger" data-act="suppr" data-id="${c.id}">Supprimer</button>
          </td></tr>`;
      }).join("")}</table></div>` : '<p class="muted">Aucun camion.</p>'}
  </div>`;
};
BRANCHEMENTS.camions = () => {
  surSoumission("#f-camion", (v) => {
    const data = {
      immat: v.immat.toUpperCase(), marque: v.marque,
      km: num(v.km), kmVidange: num(v.kmVidange, num(v.km)), intervalleVidange: num(v.intervalleVidange, S.params.intervalleVidange),
      kmPneus: num(v.kmPneus, num(v.km)), intervallePneus: num(v.intervallePneus, S.params.intervallePneus),
      assurance: v.assurance, visite: v.visite,
    };
    if (camionEdite) Object.assign(parId(S.camions, camionEdite), data);
    else S.camions.push({ id: uid(), ...data });
    camionEdite = null; sauver(); afficher();
  });
  surActions((act, id) => {
    const c = parId(S.camions, id);
    if (act === "annuler") camionEdite = null;
    if (act === "modifier") camionEdite = id;
    if (act === "vidange") { c.kmVidange = c.km; }
    if (act === "pneus") { c.kmPneus = c.km; }
    if (act === "km") {
      const k = prompt(`Kilométrage actuel de ${c.immat} :`, c.km);
      if (k === null) return;
      if (num(k) < c.km && !confirm("Ce kilométrage est inférieur à l'ancien. Continuer ?")) return;
      c.km = num(k, c.km);
    }
    if (act === "suppr") {
      if (!confirm(`Supprimer ${c.immat} ? Son historique de gasoil sera aussi supprimé.`)) return;
      S.camions = S.camions.filter((x) => x.id !== id);
      S.pleins = S.pleins.filter((p) => p.camionId !== id);
      S.chauffeurs.forEach((ch) => { if (ch.camionId === id) ch.camionId = ""; });
    }
    sauver(); afficher();
  });
};

/* ---------- Gasoil ---------- */
VUES.carburant = () => {
  const P = S.params;
  const pleins = [...S.pleins].sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.km - a.km);
  const consos = {};
  for (const c of S.camions) Object.assign(consos, consommations(c.id));
  const resume = S.camions.map((c) => {
    const ps = S.pleins.filter((p) => p.camionId === c.id);
    return { c, litres: ps.reduce((s, p) => s + p.litres, 0), cout: ps.reduce((s, p) => s + p.litres * p.prix, 0), moy: consoMoyenne(c.id) };
  });
  return `
  <div class="card">
    <h2>Saisir un plein</h2>
    ${S.camions.length ? `<form id="f-plein" class="grid">
      ${champ({ name: "camionId", label: "Camion", type: "select", options: optsCamions("— Choisir —").slice(1), required: true })}
      ${champ({ name: "date", label: "Date", type: "date", value: today(), required: true })}
      ${champ({ name: "km", label: "Kilométrage compteur", type: "number", required: true })}
      ${champ({ name: "litres", label: "Litres", type: "number", required: true })}
      ${champ({ name: "prix", label: "Prix / litre (MAD)", type: "number", value: P.prixGasoil, required: true })}
      ${champ({ name: "station", label: "Station / lieu" })}
      ${champ({ name: "plein", label: "Plein complet", type: "checkbox", value: true })}
      <div><button class="btn">Ajouter</button></div>
    </form>
    <p class="muted">Cochez « plein complet » quand le réservoir est rempli : la consommation est calculée entre deux pleins complets. Le kilométrage du camion est mis à jour automatiquement.</p>`
    : '<p class="muted">Ajoutez d\'abord un camion.</p>'}
  </div>
  <div class="card">
    <h2>Bilan par camion</h2>
    ${resume.length ? `<div class="table-wrap"><table><tr><th>Camion</th><th>Litres</th><th>Coût total</th><th>Conso moyenne</th></tr>
      ${resume.map((r) => `<tr><td>${esc(r.c.immat)}</td><td>${fmt(r.litres)}</td><td>${mad(r.cout)}</td><td>${r.moy ? fmt(r.moy, 1) + " L/100 km" : "—"}</td></tr>`).join("")}
    </table></div>` : '<p class="muted">—</p>'}
  </div>
  <div class="card">
    <div class="row" style="justify-content:space-between"><h2>Historique (${pleins.length})</h2>
      ${pleins.length ? '<button class="btn small ghost" data-act="csv">Exporter CSV</button>' : ""}</div>
    ${pleins.length ? `<div class="table-wrap"><table><tr><th>Date</th><th>Camion</th><th>Km</th><th>Litres</th><th>Coût</th><th>L/100</th><th>Station</th><th></th></tr>
      ${pleins.map((p) => {
        const moy = consoMoyenne(p.camionId);
        const cv = consos[p.id];
        const anormal = cv && moy && cv > moy * 1.15;
        return `<tr><td>${dateFr(p.date)}</td><td>${esc(nomCamion(p.camionId))}</td><td>${fmt(p.km)}</td><td>${fmt(p.litres, 1)}${p.plein ? "" : ' <span class="muted">(partiel)</span>'}</td>
        <td>${mad(p.litres * p.prix)}</td><td>${cv ? (anormal ? badge(fmt(cv, 1), "warn") : fmt(cv, 1)) : "—"}</td><td>${esc(p.station)}</td>
        <td><button class="btn small danger" data-act="suppr" data-id="${p.id}">×</button></td></tr>`;
      }).join("")}</table></div>` : '<p class="muted">Aucun plein enregistré.</p>'}
  </div>`;
};
BRANCHEMENTS.carburant = () => {
  surSoumission("#f-plein", (v) => {
    const p = { id: uid(), camionId: v.camionId, date: v.date, km: num(v.km), litres: num(v.litres), prix: num(v.prix), station: v.station, plein: v.plein };
    S.pleins.push(p);
    const c = parId(S.camions, p.camionId);
    if (c && p.km > c.km) c.km = p.km;
    S.params.prixGasoil = p.prix;
    sauver(); afficher();
  });
  surActions((act, id) => {
    if (act === "suppr" && confirm("Supprimer ce plein ?")) { S.pleins = S.pleins.filter((p) => p.id !== id); sauver(); afficher(); }
    if (act === "csv") telecharger(`gasoil-${today()}.csv`, versCSV(S.pleins.map((p) => ({
      date: p.date, camion: nomCamion(p.camionId), km: p.km, litres: p.litres, prix_litre: p.prix, cout: (p.litres * p.prix).toFixed(2), plein_complet: p.plein ? "oui" : "non", station: p.station,
    }))), "text/csv;charset=utf-8");
  });
};

/* ---------- Chauffeurs ---------- */
let chauffeurEdite = null;
VUES.chauffeurs = () => {
  const ch = chauffeurEdite ? parId(S.chauffeurs, chauffeurEdite) : null;
  const P = S.params;
  return `
  <div class="card">
    <h2>${ch ? "Modifier " + esc(ch.nom) : "Ajouter un chauffeur"}</h2>
    <form id="f-chauffeur" class="grid">
      ${champ({ name: "nom", label: "Nom complet", value: ch?.nom, required: true })}
      ${champ({ name: "tel", label: "Téléphone", type: "tel", value: ch?.tel })}
      ${champ({ name: "permis", label: "Expiration du permis", type: "date", value: ch?.permis })}
      ${champ({ name: "visiteMedicale", label: "Prochaine visite médicale", type: "date", value: ch?.visiteMedicale })}
      ${champ({ name: "camionId", label: "Camion sous sa responsabilité", type: "select", options: optsCamions(), value: ch?.camionId })}
      ${champ({ name: "conge", label: "En congé", type: "checkbox", value: ch?.conge })}
      <div class="row"><button class="btn">${ch ? "Enregistrer" : "Ajouter"}</button>${ch ? '<button type="button" class="btn ghost" data-act="annuler">Annuler</button>' : ""}</div>
    </form>
    <p class="muted">Règles appliquées : service de ${P.amplitudeMaxHeures} h max, puis repos de ${P.reposMinHeures} h minimum (modifiable dans Paramètres — vérifiez la réglementation en vigueur).</p>
  </div>
  <div class="card">
    <h2>Équipe (${S.chauffeurs.length})</h2>
    ${S.chauffeurs.length ? `<div class="table-wrap"><table><tr><th>Chauffeur</th><th>Camion</th><th>État</th><th>Trajets</th><th></th></tr>
      ${S.chauffeurs.map((c) => {
        const e = etatChauffeur(c);
        const nbTrajets = S.trajets.filter((t) => t.chauffeurId === c.id).length;
        const km = S.trajets.filter((t) => t.chauffeurId === c.id && t.statut === "termine").reduce((s, t) => s + t.distance, 0);
        return `<tr>
          <td><strong>${esc(c.nom)}</strong><br><span class="muted">${esc(c.tel)}${c.permis ? " · permis " + dateFr(c.permis) : ""}</span></td>
          <td>${esc(nomCamion(c.camionId))}</td>
          <td>${badge(e.dispo ? "Disponible" : "Indisponible", e.niveau)}<br><span class="muted">${esc(e.texte)}</span></td>
          <td>${nbTrajets} <span class="muted">(${fmt(km)} km faits)</span></td>
          <td class="row">
            ${c.debutService ? `<button class="btn small" data-act="repos" data-id="${c.id}">Mettre en repos</button>`
              : `<button class="btn small ghost" data-act="service" data-id="${c.id}">Prise de service</button>`}
            <button class="btn small ghost" data-act="modifier" data-id="${c.id}">Modifier</button>
            <button class="btn small danger" data-act="suppr" data-id="${c.id}">Supprimer</button>
          </td></tr>`;
      }).join("")}</table></div>` : '<p class="muted">Aucun chauffeur.</p>'}
  </div>`;
};
BRANCHEMENTS.chauffeurs = () => {
  surSoumission("#f-chauffeur", (v) => {
    if (v.camionId) {
      const autre = S.chauffeurs.find((c) => c.camionId === v.camionId && c.id !== chauffeurEdite);
      if (autre && !confirm(`${nomCamion(v.camionId)} est déjà sous la responsabilité de ${autre.nom}. Le réaffecter ?`)) return;
      if (autre) autre.camionId = "";
    }
    const data = { nom: v.nom, tel: v.tel, permis: v.permis, visiteMedicale: v.visiteMedicale, camionId: v.camionId, conge: v.conge };
    if (chauffeurEdite) Object.assign(parId(S.chauffeurs, chauffeurEdite), data);
    else S.chauffeurs.push({ id: uid(), ...data });
    chauffeurEdite = null; sauver(); afficher();
  });
  surActions((act, id) => {
    const c = parId(S.chauffeurs, id);
    if (act === "annuler") chauffeurEdite = null;
    if (act === "modifier") chauffeurEdite = id;
    if (act === "service") {
      if (c.reposJusqua && new Date(c.reposJusqua) > new Date() && !confirm(`${c.nom} n'a pas fini son repos (jusqu'à ${dateHeureFr(c.reposJusqua)}). Forcer la prise de service ?`)) return;
      c.debutService = new Date().toISOString(); c.reposJusqua = null;
    }
    if (act === "repos") {
      c.debutService = null;
      c.reposJusqua = new Date(Date.now() + S.params.reposMinHeures * 3600000).toISOString();
    }
    if (act === "suppr") {
      if (!confirm(`Supprimer ${c.nom} ?`)) return;
      S.chauffeurs = S.chauffeurs.filter((x) => x.id !== id);
    }
    sauver(); afficher();
  });
};

/* ---------- Itinéraires ---------- */
VUES.itineraires = () => {
  const P = S.params;
  const dispo = S.chauffeurs.filter((c) => etatChauffeur(c).dispo);
  const trajets = [...S.trajets].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const statutLib = { planifie: ["Planifié", "warn"], encours: ["En cours", "ok"], termine: ["Terminé", "ok"] };
  return `
  <div class="card">
    <h2>Planifier un trajet</h2>
    <form id="f-trajet" class="grid">
      ${champ({ name: "depart", label: "Départ", required: true, placeholder: "Casablanca" })}
      ${champ({ name: "arrivee", label: "Arrivée", required: true, placeholder: "Tanger Med" })}
      ${champ({ name: "distance", label: "Distance (km)", type: "number", required: true })}
      ${champ({ name: "peage", label: "Péage (MAD)", type: "number", value: 0 })}
      ${champ({ name: "date", label: "Date de départ", type: "date", value: today() })}
      ${champ({ name: "chauffeurId", label: `Chauffeur (${dispo.length} disponible${dispo.length > 1 ? "s" : ""})`, type: "select", options: optsChauffeurs(dispo) })}
      ${champ({ name: "camionId", label: "Camion", type: "select", options: optsCamions() })}
      ${champ({ name: "client", label: "Client / marchandise" })}
      <div class="row"><button type="button" class="btn ghost" data-act="calculer">Calculer</button><button class="btn">Enregistrer</button></div>
    </form>
    <div id="resultat"></div>
    <p class="muted">Le camion sous la responsabilité du chauffeur est choisi automatiquement. Hypothèses : ${P.vitesseMoyenne} km/h, pause de ${fmt(P.dureePause * 60)} min toutes les ${fmt(P.conduiteAvantPause, 1)} h, ${P.conduiteMaxJour} h de conduite/jour.</p>
  </div>
  <div class="card">
    <div class="row" style="justify-content:space-between"><h2>Trajets (${trajets.length})</h2>
      ${trajets.length ? '<button class="btn small ghost" data-act="csv">Exporter CSV</button>' : ""}</div>
    ${trajets.length ? `<div class="table-wrap"><table><tr><th>Date</th><th>Trajet</th><th>Chauffeur / camion</th><th>Coût estimé</th><th>Durée</th><th>Statut</th><th></th></tr>
      ${trajets.map((t) => {
        const [lib, niv] = statutLib[t.statut] || statutLib.planifie;
        return `<tr><td>${dateFr(t.date)}</td>
        <td><strong>${esc(t.depart)} → ${esc(t.arrivee)}</strong><br><span class="muted">${fmt(t.distance)} km ${t.client ? "· " + esc(t.client) : ""}</span></td>
        <td>${esc(nomChauffeur(t.chauffeurId))}<br><span class="muted">${esc(nomCamion(t.camionId))}</span></td>
        <td>${mad(t.calcul.coutTotal)}<br><span class="muted">${fmt(t.calcul.litres)} L + ${mad(t.peage)} péage</span></td>
        <td>${fmt(t.calcul.dureeTotale, 1)} h<br><span class="muted">${t.calcul.jours} jour(s)</span></td>
        <td>${badge(lib, niv)}</td>
        <td class="row">
          ${t.statut === "planifie" ? `<button class="btn small" data-act="demarrer" data-id="${t.id}">Démarrer</button>` : ""}
          ${t.statut === "encours" ? `<button class="btn small" data-act="terminer" data-id="${t.id}">Terminer</button>` : ""}
          <button class="btn small danger" data-act="suppr" data-id="${t.id}">×</button></td></tr>`;
      }).join("")}</table></div>` : '<p class="muted">Aucun trajet.</p>'}
  </div>`;
};
function lireTrajet(v) {
  const camion = parId(S.camions, v.camionId);
  const conso = (camion && consoMoyenne(camion.id)) || S.params.consoDefaut;
  const distance = num(v.distance), peage = num(v.peage);
  return { distance, peage, conso, calcul: calculTrajet({ distance, peage, conso, prix: S.params.prixGasoil }) };
}
function afficherCalcul(r) {
  const k = r.calcul;
  $("#resultat").innerHTML = `<div class="result"><dl>
    <dt>Gasoil</dt><dd>${fmt(k.litres)} L × ${fmt(S.params.prixGasoil, 2)} = ${mad(k.coutGasoil)} <span class="muted">(${fmt(r.conso, 1)} L/100)</span></dd>
    <dt>Péage</dt><dd>${mad(r.peage)}</dd>
    <dt>Coût total estimé</dt><dd>${mad(k.coutTotal)} · ${r.distance ? fmt(k.coutTotal / r.distance, 2) : 0} MAD/km</dd>
    <dt>Conduite</dt><dd>${fmt(k.heuresConduite, 1)} h, ${k.pauses} pause(s), ${k.reposNuit} repos de nuit</dd>
    <dt>Durée totale</dt><dd>${fmt(k.dureeTotale, 1)} h sur ${k.jours} jour(s)</dd>
  </dl></div>`;
}
BRANCHEMENTS.itineraires = () => {
  const f = $("#f-trajet");
  f.chauffeurId.addEventListener("change", () => {
    const ch = parId(S.chauffeurs, f.chauffeurId.value);
    if (ch?.camionId) f.camionId.value = ch.camionId;
  });
  surSoumission("#f-trajet", (v) => {
    const r = lireTrajet(v);
    S.trajets.push({ id: uid(), depart: v.depart, arrivee: v.arrivee, date: v.date, chauffeurId: v.chauffeurId, camionId: v.camionId, client: v.client, statut: "planifie", ...r });
    sauver(); afficher();
  });
  surActions((act, id) => {
    if (act === "calculer") {
      const v = lireForm(f);
      if (!num(v.distance)) return alert("Indiquez la distance.");
      return afficherCalcul(lireTrajet(v));
    }
    const t = parId(S.trajets, id);
    if (act === "demarrer") {
      t.statut = "encours";
      const ch = parId(S.chauffeurs, t.chauffeurId);
      if (ch && !ch.debutService) { ch.debutService = new Date().toISOString(); ch.reposJusqua = null; }
    }
    if (act === "terminer") {
      t.statut = "termine";
      const c = parId(S.camions, t.camionId);
      if (c) c.km += t.distance;
    }
    if (act === "suppr") { if (!confirm("Supprimer ce trajet ?")) return; S.trajets = S.trajets.filter((x) => x.id !== id); }
    if (act === "csv") return telecharger(`trajets-${today()}.csv`, versCSV(S.trajets.map((t) => ({
      date: t.date, depart: t.depart, arrivee: t.arrivee, km: t.distance, client: t.client, chauffeur: nomChauffeur(t.chauffeurId), camion: nomCamion(t.camionId),
      litres: t.calcul.litres.toFixed(0), cout_gasoil: t.calcul.coutGasoil.toFixed(2), peage: t.peage, cout_total: t.calcul.coutTotal.toFixed(2), statut: t.statut,
    }))), "text/csv;charset=utf-8");
    sauver(); afficher();
  });
};

/* ---------- Douane ---------- */
VUES.douane = () => {
  const typeLib = { import: "Import", export: "Export", transit: "Transit" };
  const ouverts = S.dossiers.filter((d) => d.statut !== "clos");
  const clos = S.dossiers.filter((d) => d.statut === "clos");
  const carte = (d) => {
    const items = CHECKLISTS_DOUANE[d.type] || [];
    const faits = items.filter((_, i) => d.coches?.[i]).length;
    const niv = faits === items.length ? "ok" : faits === 0 ? "danger" : "warn";
    return `<details class="card" ${d.id === dossierOuvert ? "open" : ""} data-dossier="${d.id}">
      <summary><strong>${esc(d.ref)}</strong> · ${typeLib[d.type]} · ${esc(d.client)} ${d.codeSH ? "· SH " + esc(d.codeSH) : ""}
        ${badge(`${faits}/${items.length} documents`, niv)} ${d.echeance ? `<span class="muted">échéance ${dateFr(d.echeance)}</span>` : ""}</summary>
      ${d.marchandise ? `<p>${esc(d.marchandise)} ${d.bureau ? `— bureau : ${esc(d.bureau)}` : ""}</p>` : ""}
      <div class="checklist">${items.map((it, i) => `<label><input type="checkbox" data-coche="${d.id}" data-i="${i}" ${d.coches?.[i] ? "checked" : ""}> ${esc(it)}</label>`).join("")}</div>
      <div class="row" style="margin-top:10px">
        <button class="btn small ghost" data-act="${d.statut === "clos" ? "rouvrir" : "clore"}" data-id="${d.id}">${d.statut === "clos" ? "Rouvrir" : "Clore le dossier"}</button>
        <button class="btn small ghost" data-act="imprimer" data-id="${d.id}">Imprimer la liste</button>
        <button class="btn small danger" data-act="suppr" data-id="${d.id}">Supprimer</button>
      </div></details>`;
  };
  return `
  <div class="card">
    <h2>Nouveau dossier douane</h2>
    <form id="f-dossier" class="grid">
      ${champ({ name: "ref", label: "Référence dossier", required: true, value: "D-" + today().replace(/-/g, "") + "-" + (S.dossiers.length + 1) })}
      ${champ({ name: "type", label: "Opération", type: "select", options: [["import", "Import"], ["export", "Export"], ["transit", "Transit"]] })}
      ${champ({ name: "client", label: "Client", required: true })}
      ${champ({ name: "marchandise", label: "Marchandise" })}
      ${champ({ name: "codeSH", label: "Code SH", placeholder: "8708.29..." })}
      ${champ({ name: "bureau", label: "Bureau de douane", placeholder: "Tanger Med, Casa Port..." })}
      ${champ({ name: "echeance", label: "Échéance", type: "date" })}
      <div><button class="btn">Créer</button></div>
    </form>
    <p class="muted">Chaque dossier reçoit la liste des documents à réunir selon l'opération. Les déclarations se font sur <strong>BADR</strong> (ADII). Les exigences varient selon le produit et l'accord commercial : vérifiez sur <a href="https://www.douane.gov.ma" target="_blank" rel="noopener">douane.gov.ma</a>.</p>
  </div>
  <h2>Dossiers ouverts (${ouverts.length})</h2>
  ${ouverts.map(carte).join("") || '<p class="muted">Aucun dossier ouvert.</p>'}
  ${clos.length ? `<h2>Dossiers clos (${clos.length})</h2>${clos.map(carte).join("")}` : ""}`;
};
let dossierOuvert = null;
BRANCHEMENTS.douane = () => {
  surSoumission("#f-dossier", (v) => {
    const d = { id: uid(), ...v, statut: "ouvert", coches: [], cree: today() };
    S.dossiers.unshift(d); dossierOuvert = d.id; sauver(); afficher();
  });
  document.querySelectorAll("[data-coche]").forEach((cb) => cb.addEventListener("change", () => {
    const d = parId(S.dossiers, cb.dataset.coche);
    d.coches ||= [];
    d.coches[+cb.dataset.i] = cb.checked;
    dossierOuvert = d.id; sauver(); afficher();
  }));
  surActions((act, id) => {
    const d = parId(S.dossiers, id);
    if (act === "clore") d.statut = "clos";
    if (act === "rouvrir") d.statut = "ouvert";
    if (act === "suppr") { if (!confirm(`Supprimer le dossier ${d.ref} ?`)) return; S.dossiers = S.dossiers.filter((x) => x.id !== id); }
    if (act === "imprimer") return imprimerDossier(d);
    sauver(); afficher();
  });
};
function imprimerDossier(d) {
  const items = CHECKLISTS_DOUANE[d.type] || [];
  const w = window.open("", "_blank");
  if (!w) return alert("Autorisez les fenêtres pop-up pour imprimer.");
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(d.ref)}</title>
    <body style="font-family:sans-serif;padding:24px">
    <h1>Dossier ${esc(d.ref)} — ${esc(d.type)}</h1>
    <p>Client : ${esc(d.client)}<br>Marchandise : ${esc(d.marchandise)}<br>Code SH : ${esc(d.codeSH)}<br>Bureau : ${esc(d.bureau)}<br>Échéance : ${dateFr(d.echeance)}</p>
    <ul style="list-style:none;padding:0">${items.map((it, i) => `<li style="padding:6px 0">${d.coches?.[i] ? "☑" : "☐"} ${esc(it)}</li>`).join("")}</ul>
    <script>print()<\/script></body>`);
  w.document.close();
}

/* ---------- Nomenclature ---------- */
let recherche = "";
VUES.nomenclature = () => `
  <div class="card">
    <h2>Rechercher un code</h2>
    <input id="q" placeholder="Ex. : pneumatiques, 87, huile, textile..." value="${esc(recherche)}" autofocus>
    <div id="res-nomenclature"></div>
    <p class="muted">Les 2 premiers chiffres du code SH donnent le chapitre. Le code complet marocain compte 10 chiffres : consultez le tarif officiel sur le portail de l'ADII avant toute déclaration.</p>
  </div>
  <div class="card">
    <h2>Mes codes habituels</h2>
    <form id="f-code" class="grid">
      ${champ({ name: "code", label: "Code SH (10 chiffres)", required: true })}
      ${champ({ name: "designation", label: "Désignation", required: true })}
      ${champ({ name: "droit", label: "Droit d'importation (%)", type: "number" })}
      ${champ({ name: "notes", label: "Notes (documents exigés, contrôles...)" })}
      <div><button class="btn">Ajouter</button></div>
    </form>
  </div>`;
function rendreRecherche() {
  const q = sansAccent(recherche).trim();
  const qCode = q.replace(/[\s.]/g, "");
  const match = (code, txt) => !q || (qCode && code.replace(/\./g, "").startsWith(qCode)) || sansAccent(txt).includes(q);
  const perso = S.codes.filter((c) => match(c.code, c.designation + " " + c.notes));
  const chap = CHAPITRES_SH.filter(([c, t]) => match(c, t));
  $("#res-nomenclature").innerHTML = `
    ${perso.length ? `<h3>Mes codes (${perso.length})</h3><div class="table-wrap"><table><tr><th>Code</th><th>Désignation</th><th>DI</th><th>Notes</th><th></th></tr>
      ${perso.map((c) => `<tr><td><strong>${esc(c.code)}</strong></td><td>${esc(c.designation)}</td><td>${c.droit !== "" ? esc(c.droit) + " %" : "—"}</td><td>${esc(c.notes)}</td>
      <td><button class="btn small danger" data-act="suppr-code" data-id="${c.id}">×</button></td></tr>`).join("")}</table></div>` : ""}
    <h3>Chapitres du Système Harmonisé (${chap.length})</h3>
    <div class="table-wrap"><table>${chap.map(([c, t]) => `<tr><td style="width:60px"><strong>${c}</strong></td><td>${esc(t)}</td></tr>`).join("") || '<tr><td class="muted">Aucun résultat.</td></tr>'}</table></div>`;
  $("#res-nomenclature").querySelectorAll("[data-act=suppr-code]").forEach((b) => b.addEventListener("click", () => {
    S.codes = S.codes.filter((c) => c.id !== b.dataset.id); sauver(); rendreRecherche();
  }));
}
BRANCHEMENTS.nomenclature = () => {
  rendreRecherche();
  $("#q").addEventListener("input", (e) => { recherche = e.target.value; rendreRecherche(); });
  surSoumission("#f-code", (v) => { S.codes.push({ id: uid(), ...v }); sauver(); afficher(); });
};

/* ---------- Paramètres ---------- */
VUES.parametres = () => {
  const P = S.params;
  const n = (name, label) => champ({ name, label, type: "number", value: P[name] });
  return `
  <div class="card">
    <h2>Paramètres</h2>
    <form id="f-params" class="grid">
      ${n("prixGasoil", "Prix du gasoil (MAD/L)")}
      ${n("consoDefaut", "Consommation par défaut (L/100 km)")}
      ${n("vitesseMoyenne", "Vitesse moyenne (km/h)")}
      ${n("intervalleVidange", "Intervalle vidange par défaut (km)")}
      ${n("intervallePneus", "Durée de vie pneus par défaut (km)")}
      ${n("alerteKm", "Alerte entretien avant (km)")}
      ${n("alerteJours", "Alerte expiration avant (jours)")}
      ${n("amplitudeMaxHeures", "Service max avant repos (h)")}
      ${n("reposMinHeures", "Repos minimum (h)")}
      ${n("conduiteMaxJour", "Conduite max par jour (h)")}
      ${n("conduiteAvantPause", "Conduite avant pause (h)")}
      ${n("dureePause", "Durée de la pause (h)")}
      <div><button class="btn">Enregistrer</button></div>
    </form>
    <p class="muted">Les règles de temps de conduite par défaut sont indicatives : adaptez-les à la réglementation applicable à vos trajets (national ou international).</p>
  </div>
  <div class="card">
    <h2>Sauvegarde</h2>
    <p class="muted">Les données restent dans ce navigateur. Exportez-les régulièrement, ou pour les transférer sur un autre appareil.</p>
    <div class="row">
      <button class="btn" data-act="exporter">Exporter (fichier JSON)</button>
      <label class="btn ghost" style="flex-direction:row;color:var(--primary)">Importer<input type="file" id="import" accept=".json" hidden></label>
      <button class="btn ghost" data-act="demo">Charger des données d'exemple</button>
      <button class="btn danger" data-act="reset">Tout effacer</button>
    </div>
  </div>`;
};
BRANCHEMENTS.parametres = () => {
  surSoumission("#f-params", (v) => {
    for (const k of Object.keys(PARAMS_DEFAUT)) S.params[k] = num(v[k], PARAMS_DEFAUT[k]);
    sauver(); alert("Paramètres enregistrés."); afficher();
  });
  $("#import").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.camions)) throw new Error();
      if (!confirm("Remplacer toutes les données actuelles par ce fichier ?")) return;
      S = { ...etatVide(), ...d, params: { ...PARAMS_DEFAUT, ...(d.params || {}) } };
      sauver(); afficher("tableau");
    } catch { alert("Fichier invalide."); }
  });
  surActions((act) => {
    if (act === "exporter") telecharger(`logistique-sauvegarde-${today()}.json`, JSON.stringify(S, null, 2), "application/json");
    if (act === "reset" && confirm("Effacer toutes les données ? Cette action est définitive.")) { S = etatVide(); sauver(); afficher("tableau"); }
    if (act === "demo" && (S.camions.length === 0 || confirm("Remplacer les données actuelles par l'exemple ?"))) { S = donneesDemo(); sauver(); afficher("tableau"); }
  });
};

function donneesDemo() {
  const e = etatVide();
  const j = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  e.camions = [
    { id: "c1", immat: "12345-A-6", marque: "Volvo FH", km: 412300, kmVidange: 374000, intervalleVidange: 40000, kmPneus: 330000, intervallePneus: 100000, assurance: j(20), visite: j(90) },
    { id: "c2", immat: "67890-B-1", marque: "Renault T", km: 218900, kmVidange: 205000, intervalleVidange: 40000, kmPneus: 150000, intervallePneus: 100000, assurance: j(200), visite: j(-3) },
    { id: "c3", immat: "24680-D-8", marque: "Mercedes Actros", km: 98000, kmVidange: 80000, intervalleVidange: 40000, kmPneus: 0, intervallePneus: 100000, assurance: j(150), visite: j(160) },
  ];
  e.chauffeurs = [
    { id: "h1", nom: "Youssef El Amrani", tel: "06 00 00 00 01", permis: j(400), visiteMedicale: j(15), camionId: "c1" },
    { id: "h2", nom: "Karim Benali", tel: "06 00 00 00 02", permis: j(25), visiteMedicale: j(300), camionId: "c2", debutService: new Date(Date.now() - 14 * 3600000).toISOString() },
    { id: "h3", nom: "Said Ouchen", tel: "06 00 00 00 03", permis: j(700), visiteMedicale: j(200), camionId: "c3", reposJusqua: new Date(Date.now() + 5 * 3600000).toISOString() },
  ];
  const pl = (id, c, d, km, l, plein = true) => ({ id, camionId: c, date: j(d), km, litres: l, prix: 11, station: "", plein });
  e.pleins = [
    pl("p1", "c1", -20, 410000, 400), pl("p2", "c1", -14, 411000, 330), pl("p3", "c1", -5, 412300, 520),
    pl("p4", "c2", -12, 217500, 380), pl("p5", "c2", -3, 218900, 460),
  ];
  e.trajets = [];
  e.dossiers = [
    { id: "d1", ref: "D-EXEMPLE-1", type: "import", client: "Société Atlas SARL", marchandise: "Pièces détachées auto", codeSH: "8708", bureau: "Tanger Med", echeance: j(2), statut: "ouvert", coches: [true, true, true, false, false, true] },
  ];
  e.codes = [{ id: "k1", code: "4011.20", designation: "Pneumatiques neufs pour autobus ou camions (à compléter à 10 chiffres)", droit: "", notes: "Vérifier le taux sur le portail ADII" }];
  return e;
}

/* ============================================================
   Démarrage
   ============================================================ */
document.getElementById("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) { camionEdite = chauffeurEdite = null; afficher(b.dataset.tab); }
});
afficher("tableau");
