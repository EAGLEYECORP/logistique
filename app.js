"use strict";
/* ============================================================
   Interface — Logistique Fret
   Dépend de data.js (référentiels) et noyau.js (état + calculs).
   ============================================================ */

/* ---------- persistance ---------- */
function charger() {
  try {
    const brut = localStorage.getItem(STORAGE_KEY);
    return brut ? normaliser(JSON.parse(brut)) : etatVide();
  } catch {
    return etatVide();
  }
}
function sauver() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); }
  catch { toast("Enregistrement impossible : exportez vos données (Réglages).", "danger"); }
}
S = charger();

/* ---------- icônes (SVG en ligne, hors ligne) ---------- */
const P_ = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3.5V16h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H17a3.5 3.5 0 0 0 0-7H7a3.5 3.5 0 0 1 0-7h8.5"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  alert: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z"/>',
  gauge: '<path d="M12 14 16 9M3.5 18a9 9 0 1 1 17 0"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8zM5 2l.6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6z"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
};
const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${P_[n] || ""}</svg>`;

/* ---------- composants ---------- */
const badge = (txt, niveau = "neutral") => `<span class="badge ${niveau}">${esc(txt)}</span>`;
const btn = (act, label, { id = "", icone = "", cls = "", titre = "" } = {}) =>
  `<button type="button" class="${cls || "btn"}" data-act="${act}" ${id ? `data-id="${esc(id)}"` : ""} ${titre ? `title="${esc(titre)}" aria-label="${esc(titre)}"` : ""}>${icone ? ic(icone) : ""}${label}</button>`;
const iconBtn = (act, icone, titre, id, danger) => btn(act, "", { id, icone, titre, cls: "icon-btn" + (danger ? " danger" : "") });

function champ(f) {
  const v = f.value ?? "";
  const req = f.required ? "required" : "";
  const cls = f.full ? "f full" : "f";
  if (f.type === "select") {
    const opts = f.options.map(([val, lib, dis]) => `<option value="${esc(val)}" ${String(val) === String(v) ? "selected" : ""} ${dis ? "disabled" : ""}>${esc(lib)}</option>`).join("");
    return `<label class="${cls}">${esc(f.label)}<select name="${f.name}" ${req}>${opts}</select></label>`;
  }
  if (f.type === "checkbox") return `<label class="check ${f.full ? "full" : ""}"><input type="checkbox" name="${f.name}" ${v ? "checked" : ""}><span>${esc(f.label)}</span></label>`;
  if (f.type === "textarea") return `<label class="${cls}">${esc(f.label)}<textarea name="${f.name}" rows="3">${esc(v)}</textarea></label>`;
  const extra = f.type === "number" ? `step="${f.step || "any"}" inputmode="decimal" ${f.min !== undefined ? `min="${f.min}"` : ""}` : "";
  return `<label class="${cls}">${esc(f.label)}<input type="${f.type || "text"}" name="${f.name}" value="${esc(v)}" ${extra} ${req} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ""} ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ""}></label>`;
}
const champs = (liste) => `<div class="form-grid">${liste.map(champ).join("")}</div>`;

function lireForm(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    o[el.name] = el.type === "checkbox" ? el.checked : el.value.trim();
  }
  return o;
}

function vide(icone, titre, texte, bouton = "") {
  return `<div class="empty"><div class="ico">${ic(icone)}</div><h3>${esc(titre)}</h3><p>${esc(texte)}</p>${bouton}</div>`;
}

function toast(msg, niveau = "ok") {
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `${ic(niveau === "ok" ? "check" : "alert")}<span>${esc(msg)}</span>`;
  const zone = $("#toasts");
  zone.append(t);
  while (zone.children.length > 3) zone.firstElementChild.remove();
  setTimeout(() => t.remove(), 2800);
}

/** Fenêtre modale. Renvoie les valeurs du formulaire, ou null si annulée. */
function modale({ titre, corps, valider = "Enregistrer", danger = false, annuler = "Annuler" }) {
  const d = $("#modale");
  d.innerHTML = `<form method="dialog" class="modal">
    <header><h2>${esc(titre)}</h2><button value="annuler" class="icon-btn" aria-label="Fermer" formnovalidate>${ic("x")}</button></header>
    <div class="modal-body">${corps}</div>
    <footer>${annuler ? `<button value="annuler" class="btn ghost" formnovalidate>${esc(annuler)}</button>` : ""}<button value="ok" class="btn ${danger ? "danger" : ""}">${esc(valider)}</button></footer>
  </form>`;
  d.returnValue = "";
  return new Promise((res) => {
    const f = d.querySelector("form");
    d.onclose = () => res(d.returnValue === "ok" ? lireForm(f) : null);
    d.onclick = (e) => { if (e.target === d) d.close(); };
    d.showModal();
    f.querySelector(".modal-body input:not([type=checkbox]), .modal-body select")?.focus();
  });
}
const confirmer = (titre, texte, valider = "Supprimer") =>
  modale({ titre, corps: `<p style="margin:0">${esc(texte)}</p>`, valider, danger: true }).then((r) => r !== null);
const formulaire = (titre, liste, opts = {}) => modale({ titre, corps: champs(liste) + (opts.aide ? `<p class="hint">${opts.aide}</p>` : ""), ...opts });

const $ = (sel) => document.querySelector(sel);

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
const exporterCSV = (nom, lignes) => { if (!lignes.length) return toast("Rien à exporter.", "warn"); telecharger(`${nom}-${today()}.csv`, versCSV(lignes), "text/csv;charset=utf-8"); };

const optsCamions = (vide = "— Aucun —") => [["", vide], ...S.camions.map((c) => [c.id, `${c.immat}${c.marque ? " · " + c.marque : ""}`])];

/* ============================================================
   Vues
   ============================================================ */
const VUES = {};
let ongletActif = "tableau";
const ONGLETS = [
  ["tableau", "Accueil", "home"],
  ["camions", "Camions", "truck"],
  ["carburant", "Gasoil", "fuel"],
  ["chauffeurs", "Chauffeurs", "users"],
  ["itineraires", "Trajets", "route"],
  ["douane", "Douane", "file"],
  ["nomenclature", "Codes SH", "search"],
  ["parametres", "Réglages", "settings"],
];

function afficher(onglet = ongletActif, { garderScroll = false } = {}) {
  if (onglet !== ongletActif) garderScroll = false;
  ongletActif = onglet;
  const v = VUES[onglet];
  const y = window.scrollY;
  const nbUrgent = alertes().filter((a) => a.niveau === "danger").length;
  const nav = ONGLETS.map(([id, lib, icone]) =>
    `<button class="nav-item ${id === onglet ? "active" : ""}" data-tab="${id}" ${id === onglet ? 'aria-current="page"' : ""}>${ic(icone)}<span>${lib}</span>${id === "tableau" && nbUrgent ? `<span class="count">${nbUrgent}</span>` : ""}</button>`).join("");
  $("#nav").innerHTML = nav;
  $("#bottombar").innerHTML = nav;
  $("#titre").textContent = v.titre;
  $("#soustitre").textContent = typeof v.sous === "function" ? v.sous() : v.sous;
  $("#actions").innerHTML = v.actions?.() || "";
  $("#app").innerHTML = v.rendu();
  document.title = `${v.titre} · Logistique Fret`;
  etiqueterTableaux();
  v.apres?.();
  window.scrollTo(0, garderScroll ? y : 0);
}
// Sur mobile, chaque ligne de tableau devient une carte : on recopie l'en-tête de colonne dans chaque cellule.
function etiqueterTableaux() {
  document.querySelectorAll("#app table").forEach((t) => {
    const ths = [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    if (!ths.length) return;
    t.classList.add("cards");
    t.querySelectorAll("tbody tr").forEach((tr) => [...tr.children].forEach((td, i) => { td.dataset.label = ths[i] || ""; }));
  });
}
const rafraichir = () => afficher(ongletActif, { garderScroll: true });

/* ---------- Accueil ---------- */
VUES.tableau = {
  titre: "Tableau de bord",
  sous: () => new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase()),
  actions: () => S.camions.length ? btn("aller", "Planifier un trajet", { id: "itineraires", icone: "route" }) : "",
  rendu() {
    if (!S.camions.length && !S.chauffeurs.length) {
      return `<div class="card">${vide("truck", "Bienvenue dans Logistique Fret", "Trois étapes pour démarrer. Vos données restent sur cet appareil.")}
        <div class="steps">
          <div class="step"><b>1</b><div><strong>Ajoutez vos camions</strong></div><div class="sub">Kilométrage, vidange, pneus, assurance</div></div>
          <div class="step"><b>2</b><div><strong>Ajoutez vos chauffeurs</strong></div><div class="sub">Permis, visite médicale, camion attribué</div></div>
          <div class="step"><b>3</b><div><strong>Saisissez pleins et trajets</strong></div><div class="sub">Les alertes et les coûts se calculent seuls</div></div>
        </div>
        <div class="row" style="justify-content:center">${btn("aller", "Ajouter un camion", { id: "camions", icone: "plus" })}${btn("demo", "Voir avec des données d'exemple", { cls: "btn ghost" })}</div></div>`;
    }
    const il30 = dateISO(Date.now() - 30 * 86400000);
    const gasoil30 = S.pleins.filter((p) => p.date >= il30).reduce((s, p) => s + p.litres * p.prix, 0);
    const entretien30 = coutEntretien(null, il30);
    const aEntretenir = S.camions.filter((c) => niveauGlobal(etatCamion(c)) !== "ok").length;
    const etats = S.chauffeurs.map((c) => etatChauffeur(c));
    const dispo = etats.filter((e) => e.dispo).length;
    const enRepos = etats.filter((e) => e.code === "repos").length;
    const actifs = S.trajets.filter((t) => t.statut === "encours").length;
    const planifies = S.trajets.filter((t) => t.statut === "planifie").length;
    const ouverts = S.dossiers.filter((d) => d.statut !== "clos");
    const incomplets = ouverts.filter((d) => (CHECKLISTS_DOUANE[d.type] || []).some((_, i) => !d.coches?.[i])).length;
    const cf = consoFlotte();
    const al = alertes();
    const kpi = (icone, l, v, s = "", sNiv = "") => `<div class="kpi"><div class="l">${ic(icone)}${l}</div><div class="v">${v}</div><div class="s ${sNiv}">${s}</div></div>`;
    return `
      <div class="kpis">
        ${kpi("truck", "Flotte", S.camions.length, aEntretenir ? `${aEntretenir} à entretenir` : "Tout est à jour", aEntretenir ? "warn" : "")}
        ${kpi("users", "Chauffeurs disponibles", `${dispo}<small>/${S.chauffeurs.length}</small>`, enRepos ? `${enRepos} en repos` : "")}
        ${kpi("route", "Trajets en cours", actifs, `${planifies} planifié${planifies > 1 ? "s" : ""}`)}
        ${kpi("fuel", "Dépenses 30 jours", `${fmt(gasoil30 + entretien30)}<small> MAD</small>`, `Gasoil ${fmt(gasoil30)} · entretien ${fmt(entretien30)}`)}
        ${kpi("gauge", "Coût gasoil / km", cf ? `${fmt((cf * S.params.prixGasoil) / 100, 2)}<small> MAD</small>` : "—", cf ? `Conso flotte ${fmt(cf, 1)} L/100` : "Saisissez 2 pleins complets")}
        ${kpi("file", "Dossiers douane", ouverts.length, incomplets ? `${incomplets} incomplet${incomplets > 1 ? "s" : ""}` : "", incomplets ? "warn" : "")}
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-head"><h2>À traiter${al.length ? ` · ${al.length}` : ""}</h2></div>
          ${al.length ? `<ul class="alerts">${al.map((a) => `<li><span class="ico ${a.niveau}">${ic(a.niveau === "danger" ? "alert" : "flag")}</span>
            <div class="t">${esc(a.texte)}</div>${btn("aller", "Voir", { id: a.onglet, cls: "btn ghost sm" })}</li>`).join("")}</ul>`
            : vide("check", "Rien à signaler", "Entretiens, papiers et repos sont à jour.")}
        </div>
        <div class="card">
          <div class="card-head"><h2>Dépenses par semaine</h2><div class="legend"><span style="--c:var(--chart-1)">Gasoil</span><span style="--c:var(--chart-2)">Entretien</span></div></div>
          ${graphiqueDepenses()}
        </div>
      </div>`;
  },
  agir(act) {
    if (act === "demo") { S = donneesDemo(); sauver(); toast("Données d'exemple chargées"); afficher("tableau"); }
  },
};

function graphiqueDepenses() {
  const sem = depensesHebdo(8);
  const max = Math.max(1, ...sem.map((s) => s.gasoil + s.entretien));
  const pas = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / pas) * pas;
  const W = 520, H = 220, g = 48, b = 26, t = 8;
  const h = H - b - t, bw = (W - g) / sem.length;
  const y = (v) => t + h - (v / top) * h;
  const kfmt = (v) => v >= 1000 ? fmt(v / 1000, v % 1000 ? 1 : 0) + " k" : fmt(v);
  let svg = "";
  for (let i = 0; i <= 4; i++) {
    const v = (top / 4) * i;
    svg += `<line class="grid" x1="${g}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${g - 8}" y="${y(v) + 4}" text-anchor="end">${kfmt(v)}</text>`;
  }
  sem.forEach((s, i) => {
    const x = g + i * bw + bw * 0.2, w = bw * 0.6;
    const hg = (s.gasoil / top) * h, he = (s.entretien / top) * h;
    const lbl = `Semaine du ${dateFr(s.debut)} : gasoil ${mad(s.gasoil)}, entretien ${mad(s.entretien)}`;
    svg += `<g><title>${esc(lbl)}</title>
      ${hg ? `<rect x="${x}" y="${t + h - hg}" width="${w}" height="${hg}" rx="3" fill="var(--chart-1)"/>` : ""}
      ${he ? `<rect x="${x}" y="${t + h - hg - he - (hg ? 2 : 0)}" width="${w}" height="${he}" rx="3" fill="var(--chart-2)"/>` : ""}
      <rect x="${g + i * bw}" y="${t}" width="${bw}" height="${h}" fill="transparent"/>
      <text class="axis" x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${s.debut.slice(8, 10)}/${s.debut.slice(5, 7)}</text></g>`;
  });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Dépenses de gasoil et d'entretien sur 8 semaines">${svg}</svg></div>`;
}

/* ---------- Camions ---------- */
const TYPES_INTERVENTION = [["vidange", "Vidange"], ["pneus", "Pneus"], ["freins", "Freins"], ["reparation", "Réparation"], ["visite", "Visite technique"], ["autre", "Autre"]];
const libIntervention = (t) => (TYPES_INTERVENTION.find(([k]) => k === t) || [, t])[1];

const champsCamion = (c = {}) => [
  { name: "immat", label: "Immatriculation", value: c.immat, required: true, placeholder: "12345-A-6" },
  { name: "marque", label: "Marque / modèle", value: c.marque, placeholder: "Volvo FH" },
  { name: "km", label: "Kilométrage actuel", type: "number", value: c.km, required: true, min: 0 },
  { name: "kmVidange", label: "Km à la dernière vidange", type: "number", value: c.kmVidange, min: 0 },
  { name: "intervalleVidange", label: "Intervalle vidange (km)", type: "number", value: c.intervalleVidange ?? S.params.intervalleVidange },
  { name: "kmPneus", label: "Km au dernier changement de pneus", type: "number", value: c.kmPneus, min: 0 },
  { name: "intervallePneus", label: "Durée de vie des pneus (km)", type: "number", value: c.intervallePneus ?? S.params.intervallePneus },
  { name: "assurance", label: "Fin d'assurance", type: "date", value: c.assurance },
  { name: "visite", label: "Prochaine visite technique", type: "date", value: c.visite },
];
function lireCamion(v) {
  return {
    immat: v.immat.toUpperCase(), marque: v.marque, km: num(v.km),
    kmVidange: num(v.kmVidange, num(v.km)), intervalleVidange: num(v.intervalleVidange, S.params.intervalleVidange),
    kmPneus: num(v.kmPneus, num(v.km)), intervallePneus: num(v.intervallePneus, S.params.intervallePneus),
    assurance: v.assurance, visite: v.visite,
  };
}

VUES.camions = {
  titre: "Camions",
  sous: "Entretien, kilométrage et papiers de la flotte",
  actions: () => btn("ajouter", "Ajouter un camion", { icone: "plus" }),
  rendu() {
    if (!S.camions.length) return `<div class="card">${vide("truck", "Aucun camion", "Ajoutez votre premier camion pour suivre vidanges, pneus et papiers.", btn("ajouter", "Ajouter un camion", { icone: "plus" }))}</div>`;
    const responsables = (id) => S.chauffeurs.filter((ch) => ch.camionId === id).map((ch) => ch.nom).join(", ");
    const lignes = [...S.camions].sort((a, b) => ({ danger: 0, warn: 1, ok: 2 }[niveauGlobal(etatCamion(a))] - { danger: 0, warn: 1, ok: 2 }[niveauGlobal(etatCamion(b))]));
    const hist = [...S.interventions].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 30);
    return `
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Camion</th><th class="r">Kilométrage</th><th>Usure</th><th>Papiers</th><th class="r">Conso</th><th class="r">Entretien</th><th></th></tr></thead>
        <tbody>${lignes.map((c) => {
          const etats = etatCamion(c);
          const moy = consoMoyenne(c.id);
          const resp = responsables(c.id);
          return `<tr>
            <td><strong>${esc(c.immat)}</strong><span class="sub">${esc(c.marque || "")}${resp ? ` · ${esc(resp)}` : ""}</span></td>
            <td class="r num">${fmt(c.km)} km</td>
            <td><div class="gauges">${etats.filter((e) => e.pct !== undefined).map((e) =>
              `<div class="gauge ${e.niveau}"><span class="lbl">${e.type}</span><span class="bar"><i style="width:${e.pct}%"></i></span><span class="txt">${esc(e.texte)}</span></div>`).join("")}</div></td>
            <td><div class="chips" style="margin:0">${etats.filter((e) => e.pct === undefined).map((e) => `<span title="${esc(e.texte)}">${badge(e.type, e.niveau)}</span>`).join("") || '<span class="sub">Non renseigné</span>'}</div></td>
            <td class="r num">${moy ? fmt(moy, 1) + " L/100" : "—"}</td>
            <td class="r num">${fmt(coutEntretien(c.id))} MAD</td>
            <td><div class="actions">
              ${btn("entretien", "Entretien", { id: c.id, icone: "wrench", cls: "btn ghost sm" })}
              ${btn("km", "Km", { id: c.id, cls: "btn ghost sm", titre: "Mettre à jour le kilométrage" })}
              ${iconBtn("modifier", "edit", "Modifier", c.id)}${iconBtn("suppr", "trash", "Supprimer", c.id, true)}
            </div></td></tr>`;
        }).join("")}</tbody></table></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Historique d'entretien</h2>${hist.length ? btn("csv", "Exporter", { icone: "download", cls: "btn ghost sm" }) : ""}</div>
      ${hist.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Camion</th><th>Intervention</th><th class="r">Km</th><th>Garage / notes</th><th class="r">Coût</th><th></th></tr></thead><tbody>
        ${hist.map((i) => `<tr><td>${dateFr(i.date)}</td><td>${esc(nomCamion(i.camionId))}</td><td>${badge(libIntervention(i.type))}</td><td class="r num">${fmt(i.km)}</td>
          <td>${esc(i.garage)}${i.notes ? `<span class="sub">${esc(i.notes)}</span>` : ""}</td><td class="r num">${mad(i.cout)}</td>
          <td><div class="actions">${iconBtn("suppr-int", "trash", "Supprimer", i.id, true)}</div></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="hint" style="margin:0">Cliquez sur « Entretien » sur un camion pour enregistrer une vidange, un changement de pneus ou une réparation, avec son coût.</p>`}
    </div>`;
  },
  async agir(act, id) {
    const c = parId(S.camions, id);
    if (act === "ajouter") {
      const v = await formulaire("Nouveau camion", champsCamion(), { valider: "Ajouter", aide: "Laissez vides les km de vidange/pneus si vous ne les connaissez pas : le kilométrage actuel sera utilisé." });
      if (!v) return;
      S.camions.push({ id: uid(), ...lireCamion(v) }); sauver(); toast(`Camion ${v.immat.toUpperCase()} ajouté`); rafraichir();
    }
    if (act === "modifier") {
      const v = await formulaire(`Modifier ${c.immat}`, champsCamion(c));
      if (!v) return;
      Object.assign(c, lireCamion(v)); sauver(); toast("Modifications enregistrées"); rafraichir();
    }
    if (act === "km") {
      const v = await formulaire(`Kilométrage de ${c.immat}`, [{ name: "km", label: "Kilométrage au compteur", type: "number", value: c.km, required: true, full: true }], { valider: "Mettre à jour" });
      if (!v) return;
      const k = num(v.km, c.km);
      if (k < c.km && !(await confirmer("Kilométrage inférieur", `Le nouveau kilométrage (${fmt(k)}) est inférieur à l'ancien (${fmt(c.km)}). Continuer ?`, "Continuer"))) return;
      c.km = k; sauver(); toast("Kilométrage mis à jour"); rafraichir();
    }
    if (act === "entretien") {
      const v = await formulaire(`Entretien — ${c.immat}`, [
        { name: "type", label: "Intervention", type: "select", options: TYPES_INTERVENTION },
        { name: "date", label: "Date", type: "date", value: today(), required: true },
        { name: "km", label: "Kilométrage", type: "number", value: c.km, required: true },
        { name: "cout", label: "Coût (MAD)", type: "number", value: "", min: 0 },
        { name: "garage", label: "Garage / prestataire" },
        { name: "visite", label: "Prochaine visite technique (si visite)", type: "date" },
        { name: "notes", label: "Notes", type: "textarea", full: true },
      ], { aide: "Une vidange ou un changement de pneus remet le compteur d'usure à zéro à ce kilométrage." });
      if (!v) return;
      const km = num(v.km, c.km);
      S.interventions.push({ id: uid(), camionId: c.id, type: v.type, date: v.date, km, cout: num(v.cout), garage: v.garage, notes: v.notes });
      if (v.type === "vidange") c.kmVidange = km;
      if (v.type === "pneus") c.kmPneus = km;
      if (v.type === "visite" && v.visite) c.visite = v.visite;
      if (km > c.km) c.km = km;
      sauver(); toast(`${libIntervention(v.type)} enregistrée`); rafraichir();
    }
    if (act === "suppr") {
      if (!(await confirmer(`Supprimer ${c.immat} ?`, "Son historique de gasoil et d'entretien sera aussi supprimé. Cette action est définitive."))) return;
      S.camions = S.camions.filter((x) => x.id !== id);
      S.pleins = S.pleins.filter((p) => p.camionId !== id);
      S.interventions = S.interventions.filter((p) => p.camionId !== id);
      S.chauffeurs.forEach((ch) => { if (ch.camionId === id) ch.camionId = ""; });
      sauver(); toast("Camion supprimé"); rafraichir();
    }
    if (act === "suppr-int") {
      if (!(await confirmer("Supprimer cette intervention ?", "Elle sera retirée de l'historique et des coûts."))) return;
      S.interventions = S.interventions.filter((x) => x.id !== id); sauver(); rafraichir();
    }
    if (act === "csv") exporterCSV("entretien", S.interventions.map((i) => ({ date: i.date, camion: nomCamion(i.camionId), intervention: libIntervention(i.type), km: i.km, cout: i.cout, garage: i.garage, notes: i.notes })));
  },
};

/* ---------- Gasoil ---------- */
VUES.carburant = {
  titre: "Gasoil",
  sous: "Pleins, consommation et détection des anomalies",
  actions: () => S.camions.length ? btn("ajouter", "Saisir un plein", { icone: "plus" }) : "",
  rendu() {
    if (!S.camions.length) return `<div class="card">${vide("fuel", "Ajoutez d'abord un camion", "Les pleins sont rattachés à un camion.", btn("aller", "Aller aux camions", { id: "camions" }))}</div>`;
    const consos = {};
    for (const c of S.camions) Object.assign(consos, consommations(c.id));
    const pleins = [...S.pleins].sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.km - a.km);
    const seuil = 1 + S.params.seuilConso / 100;
    return `
    <div class="card">
      <div class="card-head"><h2>Par camion</h2></div>
      <div class="table-wrap"><table><thead><tr><th>Camion</th><th class="r">Pleins</th><th class="r">Litres</th><th class="r">Coût total</th><th class="r">Conso moyenne</th><th class="r">Coût / km</th></tr></thead><tbody>
      ${S.camions.map((c) => {
        const ps = S.pleins.filter((p) => p.camionId === c.id);
        const moy = consoMoyenne(c.id);
        return `<tr><td><strong>${esc(c.immat)}</strong><span class="sub">${esc(c.marque || "")}</span></td><td class="r num">${ps.length}</td>
          <td class="r num">${fmt(ps.reduce((s, p) => s + p.litres, 0))} L</td><td class="r num">${mad(ps.reduce((s, p) => s + p.litres * p.prix, 0))}</td>
          <td class="r num">${moy ? fmt(moy, 1) + " L/100" : "—"}</td><td class="r num">${moy ? fmt((moy * S.params.prixGasoil) / 100, 2) + " MAD" : "—"}</td></tr>`;
      }).join("")}</tbody></table></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Historique des pleins</h2>${pleins.length ? btn("csv", "Exporter", { icone: "download", cls: "btn ghost sm" }) : ""}</div>
      ${pleins.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Camion</th><th class="r">Compteur</th><th class="r">Litres</th><th class="r">Montant</th><th class="r">L/100</th><th>Station</th><th></th></tr></thead><tbody>
        ${pleins.map((p) => {
          const moy = consoMoyenne(p.camionId);
          const cv = consos[p.id];
          const anormal = cv && moy && cv > moy * seuil;
          return `<tr><td>${dateFr(p.date)}</td><td>${esc(nomCamion(p.camionId))}</td><td class="r num">${fmt(p.km)}</td>
            <td class="r num">${fmt(p.litres, 1)}${p.plein ? "" : '<span class="sub">partiel</span>'}</td><td class="r num">${mad(p.litres * p.prix)}</td>
            <td class="r num">${cv ? (anormal ? badge(fmt(cv, 1) + " ⚠", "warn") : fmt(cv, 1)) : "—"}</td><td>${esc(p.station)}</td>
            <td><div class="actions">${iconBtn("suppr", "trash", "Supprimer", p.id, true)}</div></td></tr>`;
        }).join("")}</tbody></table></div>` : vide("fuel", "Aucun plein", "Saisissez vos pleins pour suivre la consommation et repérer les anomalies.", btn("ajouter", "Saisir un plein", { icone: "plus" }))}
    </div>`;
  },
  async agir(act, id) {
    if (act === "ajouter") {
      const v = await formulaire("Saisir un plein", [
        { name: "camionId", label: "Camion", type: "select", options: optsCamions("— Choisir —").slice(1), required: true },
        { name: "date", label: "Date", type: "date", value: today(), required: true },
        { name: "km", label: "Kilométrage au compteur", type: "number", required: true, min: 0 },
        { name: "litres", label: "Litres", type: "number", required: true, min: 0 },
        { name: "prix", label: "Prix au litre (MAD)", type: "number", value: S.params.prixGasoil, required: true, min: 0 },
        { name: "station", label: "Station / lieu" },
        { name: "plein", label: "Plein complet (réservoir rempli)", type: "checkbox", value: true, full: true },
      ], { valider: "Ajouter", aide: "La consommation se calcule entre deux pleins complets. Le kilométrage du camion est mis à jour automatiquement." });
      if (!v) return;
      const p = { id: uid(), camionId: v.camionId, date: v.date, km: num(v.km), litres: num(v.litres), prix: num(v.prix), station: v.station, plein: v.plein };
      S.pleins.push(p);
      const c = parId(S.camions, p.camionId);
      if (c && p.km > c.km) c.km = p.km;
      S.params.prixGasoil = p.prix;
      sauver();
      const cv = consommations(p.camionId)[p.id];
      toast(cv ? `Plein enregistré · ${fmt(cv, 1)} L/100 km` : "Plein enregistré");
      rafraichir();
    }
    if (act === "suppr" && (await confirmer("Supprimer ce plein ?", "La consommation sera recalculée."))) { S.pleins = S.pleins.filter((p) => p.id !== id); sauver(); rafraichir(); }
    if (act === "csv") exporterCSV("gasoil", S.pleins.map((p) => ({ date: p.date, camion: nomCamion(p.camionId), km: p.km, litres: p.litres, prix_litre: p.prix, montant: (p.litres * p.prix).toFixed(2), plein_complet: p.plein ? "oui" : "non", station: p.station })));
  },
};

/* ---------- Chauffeurs ---------- */
const champsChauffeur = (ch = {}) => [
  { name: "nom", label: "Nom complet", value: ch.nom, required: true, autocomplete: "off" },
  { name: "tel", label: "Téléphone", type: "tel", value: ch.tel },
  { name: "permis", label: "Expiration du permis", type: "date", value: ch.permis },
  { name: "visiteMedicale", label: "Prochaine visite médicale", type: "date", value: ch.visiteMedicale },
  { name: "camionId", label: "Camion sous sa responsabilité", type: "select", options: optsCamions(), value: ch.camionId, full: true },
  { name: "conge", label: "En congé", type: "checkbox", value: ch.conge, full: true },
];

VUES.chauffeurs = {
  titre: "Chauffeurs",
  sous: () => `Affectation, temps de service et repos (${S.params.amplitudeMaxHeures} h de service max, ${S.params.reposMinHeures} h de repos)`,
  actions: () => btn("ajouter", "Ajouter un chauffeur", { icone: "plus" }),
  rendu() {
    if (!S.chauffeurs.length) return `<div class="card">${vide("users", "Aucun chauffeur", "Ajoutez vos chauffeurs et attribuez-leur un camion.", btn("ajouter", "Ajouter un chauffeur", { icone: "plus" }))}</div>`;
    return `<div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Chauffeur</th><th>Camion</th><th>État</th><th>Papiers</th><th class="r">Trajets</th><th></th></tr></thead><tbody>
      ${S.chauffeurs.map((c) => {
        const e = etatChauffeur(c);
        const termines = S.trajets.filter((t) => t.chauffeurId === c.id && t.statut === "termine");
        const pap = [["Permis", c.permis], ["Visite méd.", c.visiteMedicale]].filter(([, d]) => d).map(([l, d]) => {
          const j = joursAvant(d);
          return `<span title="${dateFr(d)}">${badge(l, j < 0 ? "danger" : j <= S.params.alerteJours ? "warn" : "ok")}</span>`;
        }).join("");
        return `<tr>
          <td><strong>${esc(c.nom)}</strong>${c.tel ? `<span class="sub"><a href="tel:${esc(c.tel.replace(/\s/g, ""))}">${esc(c.tel)}</a></span>` : ""}</td>
          <td>${c.camionId ? esc(nomCamion(c.camionId)) : '<span class="sub">—</span>'}</td>
          <td>${badge(e.dispo ? (e.code === "service" ? "En service" : "Disponible") : e.code === "repos" ? "En repos" : e.code === "conge" ? "Congé" : "Indisponible", e.niveau)}<span class="sub">${esc(e.texte)}</span></td>
          <td><div class="chips" style="margin:0">${pap || '<span class="sub">—</span>'}</div></td>
          <td class="r num">${termines.length}<span class="sub">${fmt(termines.reduce((s, t) => s + t.distance, 0))} km</span></td>
          <td><div class="actions">
            ${c.conge ? "" : c.debutService ? btn("repos", "Fin de service", { id: c.id, cls: "btn sm" }) : btn("service", "Prise de service", { id: c.id, icone: "play", cls: "btn ghost sm" })}
            ${iconBtn("modifier", "edit", "Modifier", c.id)}${iconBtn("suppr", "trash", "Supprimer", c.id, true)}
          </div></td></tr>`;
      }).join("")}</tbody></table></div></div>`;
  },
  async agir(act, id) {
    const c = parId(S.chauffeurs, id);
    const enregistrer = async (v, existant) => {
      if (v.camionId) {
        const autre = S.chauffeurs.find((x) => x.camionId === v.camionId && x !== existant);
        if (autre) {
          if (!(await confirmer("Camion déjà attribué", `${nomCamion(v.camionId)} est sous la responsabilité de ${autre.nom}. Le réattribuer à ${v.nom} ?`, "Réattribuer"))) return false;
          autre.camionId = "";
        }
      }
      const data = { nom: v.nom, tel: v.tel, permis: v.permis, visiteMedicale: v.visiteMedicale, camionId: v.camionId, conge: v.conge };
      if (existant) Object.assign(existant, data); else S.chauffeurs.push({ id: uid(), ...data });
      return true;
    };
    if (act === "ajouter") {
      const v = await formulaire("Nouveau chauffeur", champsChauffeur(), { valider: "Ajouter" });
      if (v && (await enregistrer(v))) { sauver(); toast(`${v.nom} ajouté`); rafraichir(); }
    }
    if (act === "modifier") {
      const v = await formulaire(`Modifier ${c.nom}`, champsChauffeur(c));
      if (v && (await enregistrer(v, c))) { sauver(); toast("Modifications enregistrées"); rafraichir(); }
    }
    if (act === "service") {
      if (c.reposJusqua && new Date(c.reposJusqua) > new Date() &&
        !(await confirmer("Repos non terminé", `${c.nom} est en repos jusqu'à ${dateHeureFr(c.reposJusqua)}. Forcer la prise de service ?`, "Forcer"))) return;
      c.debutService = new Date().toISOString(); c.reposJusqua = null;
      sauver(); toast(`Prise de service de ${c.nom}`); rafraichir();
    }
    if (act === "repos") {
      c.debutService = null;
      c.reposJusqua = new Date(Date.now() + S.params.reposMinHeures * 3600000).toISOString();
      sauver(); toast(`${c.nom} en repos jusqu'à ${dateHeureFr(c.reposJusqua)}`); rafraichir();
    }
    if (act === "suppr" && (await confirmer(`Supprimer ${c.nom} ?`, "Ses trajets resteront dans l'historique."))) {
      S.chauffeurs = S.chauffeurs.filter((x) => x.id !== id); sauver(); toast("Chauffeur supprimé"); rafraichir();
    }
  },
};

/* ---------- Trajets ---------- */
const STATUTS = { planifie: ["Planifié", "neutral"], encours: ["En cours", "warn"], termine: ["Terminé", "ok"] };

function lireTrajet(v) {
  const camion = parId(S.camions, v.camionId);
  const conso = (camion && consoMoyenne(camion.id)) || S.params.consoDefaut;
  const distance = num(v.distance), peage = num(v.peage);
  return { distance, peage, conso, calcul: calculTrajet({ distance, peage, conso, prix: S.params.prixGasoil }) };
}

function blocResultat(r) {
  const k = r.calcul;
  const h = (x) => `${Math.floor(x)} h ${String(Math.round((x % 1) * 60)).padStart(2, "0")}`;
  return `<div class="result">
    <div class="hl"><div class="l">Coût estimé</div><div class="v">${mad(k.coutTotal)}</div><div class="s">${fmt(k.coutKm, 2)} MAD / km</div></div>
    <div><div class="l">Gasoil</div><div class="v">${fmt(k.litres)} L</div><div class="s">${mad(k.coutGasoil)} · ${fmt(r.conso, 1)} L/100</div></div>
    <div><div class="l">Péage</div><div class="v">${mad(r.peage)}</div></div>
    <div><div class="l">Conduite</div><div class="v">${h(k.heuresConduite)}</div><div class="s">${k.pauses} pause${k.pauses > 1 ? "s" : ""} · ${k.reposNuit} repos de nuit</div></div>
    <div><div class="l">Durée totale</div><div class="v">${h(k.dureeTotale)}</div><div class="s">sur ${k.jours} jour${k.jours > 1 ? "s" : ""}</div></div>
  </div>`;
}

VUES.itineraires = {
  titre: "Trajets",
  sous: "Coût, durée et affectation de chaque trajet",
  rendu() {
    const P = S.params;
    const chauffeurs = S.chauffeurs.map((c) => ({ c, e: etatChauffeur(c) })).sort((a, b) => b.e.dispo - a.e.dispo);
    const nbDispo = chauffeurs.filter((x) => x.e.dispo).length;
    const trajets = [...S.trajets].sort((a, b) => ({ encours: 0, planifie: 1, termine: 2 }[a.statut] - { encours: 0, planifie: 1, termine: 2 }[b.statut]) || (b.date || "").localeCompare(a.date || ""));
    return `
    <div class="card">
      <div class="card-head"><h2>Planifier un trajet</h2></div>
      <form id="f-trajet">
        ${champs([
          { name: "depart", label: "Départ", required: true, placeholder: "Casablanca" },
          { name: "arrivee", label: "Arrivée", required: true, placeholder: "Tanger Med" },
          { name: "distance", label: "Distance (km)", type: "number", required: true, min: 1 },
          { name: "peage", label: "Péage (MAD)", type: "number", value: 0, min: 0 },
          { name: "date", label: "Date de départ", type: "date", value: today() },
          { name: "chauffeurId", label: `Chauffeur · ${nbDispo} disponible${nbDispo > 1 ? "s" : ""}`, type: "select",
            options: [["", "— Aucun —"], ...chauffeurs.map(({ c, e }) => [c.id, e.dispo ? c.nom : `${c.nom} — ${e.texte}`, !e.dispo])] },
          { name: "camionId", label: "Camion", type: "select", options: optsCamions() },
          { name: "client", label: "Client / marchandise" },
        ])}
        <div id="resultat"></div>
        <div class="row" style="justify-content:space-between;margin-top:16px">
          <p class="hint" style="margin:0">Hypothèses : ${P.vitesseMoyenne} km/h · pause ${fmt(P.dureePause * 60)} min toutes les ${fmt(P.conduiteAvantPause, 1)} h · ${P.conduiteMaxJour} h de conduite/jour · gasoil ${fmt(P.prixGasoil, 2)} MAD/L</p>
          <button class="btn">${ic("check")}Enregistrer le trajet</button>
        </div>
      </form>
    </div>
    <div class="card">
      <div class="card-head"><h2>Trajets</h2>${trajets.length ? btn("csv", "Exporter", { icone: "download", cls: "btn ghost sm" }) : ""}</div>
      ${trajets.length ? `<div class="table-wrap"><table><thead><tr><th>Trajet</th><th>Date</th><th>Équipe</th><th class="r">Coût estimé</th><th class="r">Durée</th><th>Statut</th><th></th></tr></thead><tbody>
        ${trajets.map((t) => {
          const [lib, niv] = STATUTS[t.statut] || STATUTS.planifie;
          return `<tr><td><strong>${esc(t.depart)} → ${esc(t.arrivee)}</strong><span class="sub">${fmt(t.distance)} km${t.client ? " · " + esc(t.client) : ""}</span></td>
            <td>${dateFr(t.date)}</td>
            <td>${esc(nomChauffeur(t.chauffeurId))}<span class="sub">${esc(nomCamion(t.camionId))}</span></td>
            <td class="r num">${mad(t.calcul.coutTotal)}<span class="sub">${fmt(t.calcul.litres)} L + ${fmt(t.peage)} péage</span></td>
            <td class="r num">${fmt(t.calcul.dureeTotale, 1)} h<span class="sub">${t.calcul.jours} j</span></td>
            <td>${badge(lib, niv)}</td>
            <td><div class="actions">
              ${t.statut === "planifie" ? btn("demarrer", "Démarrer", { id: t.id, icone: "play", cls: "btn ghost sm" }) : ""}
              ${t.statut === "encours" ? btn("terminer", "Terminer", { id: t.id, icone: "flag", cls: "btn sm" }) : ""}
              ${iconBtn("suppr", "trash", "Supprimer", t.id, true)}</div></td></tr>`;
        }).join("")}</tbody></table></div>` : vide("route", "Aucun trajet", "Remplissez le formulaire ci-dessus : le coût et la durée s'affichent pendant la saisie.")}
    </div>`;
  },
  saisie(e) {
    const f = e.target.form;
    if (!f || f.id !== "f-trajet") return;
    if (e.target.name === "chauffeurId") {
      const ch = parId(S.chauffeurs, f.chauffeurId.value);
      if (ch?.camionId) f.camionId.value = ch.camionId;
    }
    const v = lireForm(f);
    $("#resultat").innerHTML = num(v.distance) > 0 ? blocResultat(lireTrajet(v)) : "";
  },
  soumettre(fid, v) {
    if (fid !== "f-trajet") return;
    S.trajets.push({ id: uid(), depart: v.depart, arrivee: v.arrivee, date: v.date, chauffeurId: v.chauffeurId, camionId: v.camionId, client: v.client, statut: "planifie", ...lireTrajet(v) });
    sauver(); toast(`Trajet ${v.depart} → ${v.arrivee} planifié`); afficher();
  },
  async agir(act, id) {
    const t = parId(S.trajets, id);
    if (act === "demarrer") {
      t.statut = "encours";
      const ch = parId(S.chauffeurs, t.chauffeurId);
      if (ch && !ch.debutService) { ch.debutService = new Date().toISOString(); ch.reposJusqua = null; }
      sauver(); toast("Trajet démarré"); rafraichir();
    }
    if (act === "terminer") {
      t.statut = "termine";
      const c = parId(S.camions, t.camionId);
      if (c) c.km += t.distance;
      sauver(); toast(c ? `Trajet terminé · ${c.immat} passe à ${fmt(c.km)} km` : "Trajet terminé"); rafraichir();
    }
    if (act === "suppr" && (await confirmer("Supprimer ce trajet ?", `${t.depart} → ${t.arrivee}`))) { S.trajets = S.trajets.filter((x) => x.id !== id); sauver(); rafraichir(); }
    if (act === "csv") exporterCSV("trajets", S.trajets.map((t) => ({
      date: t.date, depart: t.depart, arrivee: t.arrivee, km: t.distance, client: t.client, chauffeur: nomChauffeur(t.chauffeurId), camion: nomCamion(t.camionId),
      litres: t.calcul.litres.toFixed(0), cout_gasoil: t.calcul.coutGasoil.toFixed(2), peage: t.peage, cout_total: t.calcul.coutTotal.toFixed(2), statut: STATUTS[t.statut][0],
    })));
  },
};

/* ---------- Douane ---------- */
const TYPES_DOSSIER = { import: "Import", export: "Export", transit: "Transit" };
const dossiersOuverts = new Set();

VUES.douane = {
  titre: "Douane",
  sous: "Dossiers import, export et transit — documents à réunir",
  actions: () => btn("ajouter", "Nouveau dossier", { icone: "plus" }),
  rendu() {
    const carte = (d) => {
      const items = CHECKLISTS_DOUANE[d.type] || [];
      const faits = items.filter((_, i) => d.coches?.[i]).length;
      const pct = items.length ? Math.round((faits / items.length) * 100) : 0;
      const jd = joursAvant(d.echeance);
      const ech = d.echeance ? badge(jd < 0 ? `Échéance dépassée` : jd === 0 ? "Aujourd'hui" : `J-${jd}`, faits === items.length ? "ok" : jd <= 3 ? (jd < 0 ? "danger" : "warn") : "neutral") : "";
      return `<details class="card dossier" data-dossier="${d.id}" ${dossiersOuverts.has(d.id) ? "open" : ""}>
        <summary>
          <div><strong>${esc(d.ref)}</strong> · ${TYPES_DOSSIER[d.type]} · ${esc(d.client)}
            <div class="meta">${[d.marchandise, d.codeSH && "SH " + d.codeSH, d.bureau, d.echeance && "échéance " + dateFr(d.echeance)].filter(Boolean).map(esc).join(" · ")}</div></div>
          <div class="row">${d.statut === "clos" ? badge("Clos", "neutral") : ech}${badge(`${faits}/${items.length}`, faits === items.length ? "ok" : "neutral")}</div>
        </summary>
        <div class="body">
          <div class="progress"><i style="width:${pct}%"></i></div>
          <div class="checklist">${items.map((it, i) => `<label class="check"><input type="checkbox" data-coche="${d.id}" data-i="${i}" ${d.coches?.[i] ? "checked" : ""}><span>${esc(it)}</span></label>`).join("")}</div>
          ${d.notes ? `<p class="hint">${esc(d.notes)}</p>` : ""}
          <div class="row">
            ${btn(d.statut === "clos" ? "rouvrir" : "clore", d.statut === "clos" ? "Rouvrir" : "Clore le dossier", { id: d.id, icone: d.statut === "clos" ? "" : "check", cls: "btn ghost sm" })}
            ${btn("ia-sh", "Code SH avec l'IA", { id: d.id, icone: "sparkles", cls: "btn ghost sm" })}
            ${btn("imprimer", "Imprimer", { id: d.id, icone: "print", cls: "btn ghost sm" })}
            ${btn("modifier", "Modifier", { id: d.id, icone: "edit", cls: "btn ghost sm" })}
            ${btn("suppr", "Supprimer", { id: d.id, cls: "btn text-danger sm" })}
          </div>
        </div></details>`;
    };
    const ouverts = S.dossiers.filter((d) => d.statut !== "clos");
    const clos = S.dossiers.filter((d) => d.statut === "clos");
    if (!S.dossiers.length) return `<div class="card">${vide("file", "Aucun dossier", "Créez un dossier : la liste des documents à réunir est générée selon l'opération.", btn("ajouter", "Nouveau dossier", { icone: "plus" }))}</div>${aideDouane()}`;
    return `${ouverts.map(carte).join("") || `<div class="card">${vide("check", "Aucun dossier ouvert", "Tous vos dossiers sont clos.")}</div>`}
      ${clos.length ? `<div class="section-title">Clos · ${clos.length}</div>${clos.map(carte).join("")}` : ""}${aideDouane()}`;
  },
  apres() {
    document.querySelectorAll("details.dossier").forEach((el) => el.addEventListener("toggle", () => {
      el.open ? dossiersOuverts.add(el.dataset.dossier) : dossiersOuverts.delete(el.dataset.dossier);
    }));
  },
  saisie(e) {
    const cb = e.target.closest("[data-coche]");
    if (!cb) return;
    const d = parId(S.dossiers, cb.dataset.coche);
    (d.coches ||= [])[+cb.dataset.i] = cb.checked;
    sauver();
    const items = CHECKLISTS_DOUANE[d.type];
    if (items.every((_, i) => d.coches[i])) toast(`Dossier ${d.ref} complet`);
    rafraichir();
  },
  async agir(act, id) {
    const d = parId(S.dossiers, id);
    const champsDossier = (x = {}) => [
      { name: "ref", label: "Référence", required: true, value: x.ref ?? `D-${today().replace(/-/g, "")}-${S.dossiers.length + 1}` },
      { name: "type", label: "Opération", type: "select", options: Object.entries(TYPES_DOSSIER), value: x.type },
      { name: "client", label: "Client", required: true, value: x.client },
      { name: "marchandise", label: "Marchandise", value: x.marchandise },
      { name: "codeSH", label: "Code SH", placeholder: "8708.29…", value: x.codeSH },
      { name: "bureau", label: "Bureau de douane", placeholder: "Tanger Med, Casa Port…", value: x.bureau },
      { name: "echeance", label: "Échéance", type: "date", value: x.echeance },
      { name: "notes", label: "Notes", type: "textarea", full: true, value: x.notes },
    ];
    if (act === "ajouter") {
      const v = await formulaire("Nouveau dossier douane", champsDossier(), { valider: "Créer", aide: "La liste des documents est générée selon l'opération choisie." });
      if (!v) return;
      const n = { id: uid(), ...v, statut: "ouvert", coches: [], cree: today() };
      S.dossiers.unshift(n); dossiersOuverts.add(n.id); sauver(); toast(`Dossier ${n.ref} créé`); rafraichir();
    }
    if (act === "modifier") {
      const v = await formulaire(`Modifier ${d.ref}`, champsDossier(d));
      if (!v) return;
      if (v.type !== d.type) d.coches = [];
      Object.assign(d, v); sauver(); toast("Dossier mis à jour"); rafraichir();
    }
    if (act === "clore") { d.statut = "clos"; dossiersOuverts.delete(id); sauver(); toast(`Dossier ${d.ref} clos`); rafraichir(); }
    if (act === "rouvrir") { d.statut = "ouvert"; sauver(); rafraichir(); }
    if (act === "imprimer") imprimerDossier(d);
    if (act === "ia-sh") {
      Object.assign(iaEtat, { dossierId: d.id, description: d.marchandise || "", details: "", resultat: null, erreur: "" });
      afficher("nomenclature");
      $("#f-ia-sh [name=description]")?.focus();
    }
    if (act === "suppr" && (await confirmer(`Supprimer le dossier ${d.ref} ?`, "Cette action est définitive."))) { S.dossiers = S.dossiers.filter((x) => x.id !== id); sauver(); rafraichir(); }
  },
};
const aideDouane = () => `<p class="hint">Déclarations sur <strong>BADR</strong> (ADII). Les documents exigés varient selon le produit et l'accord commercial : vérifiez sur <a href="https://www.douane.gov.ma" target="_blank" rel="noopener">douane.gov.ma</a>. Les listes sont modifiables dans <code>data.js</code>.</p>`;

function imprimerDossier(d) {
  const items = CHECKLISTS_DOUANE[d.type] || [];
  const w = window.open("", "_blank");
  if (!w) return toast("Autorisez les fenêtres pop-up pour imprimer.", "warn");
  w.document.write(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>${esc(d.ref)}</title>
    <body style="font-family:system-ui,sans-serif;padding:32px;max-width:760px;margin:auto;color:#0f172a">
    <h1 style="margin:0 0 4px">Dossier ${esc(d.ref)}</h1><p style="color:#64748b;margin:0 0 24px">${TYPES_DOSSIER[d.type]} · imprimé le ${dateFr(today())}</p>
    <table style="border-collapse:collapse;margin-bottom:24px">${[["Client", d.client], ["Marchandise", d.marchandise], ["Code SH", d.codeSH], ["Bureau", d.bureau], ["Échéance", dateFr(d.echeance)]]
      .map(([k, v]) => `<tr><td style="padding:4px 24px 4px 0;color:#64748b">${k}</td><td style="padding:4px 0;font-weight:600">${esc(v || "—")}</td></tr>`).join("")}</table>
    <h2 style="font-size:1rem">Documents</h2>
    <ul style="list-style:none;padding:0">${items.map((it, i) => `<li style="padding:8px 0;border-bottom:1px solid #e2e8f0">${d.coches?.[i] ? "☑" : "☐"}&nbsp; ${esc(it)}</li>`).join("")}</ul>
    ${d.notes ? `<p><strong>Notes :</strong> ${esc(d.notes)}</p>` : ""}
    <script>onload=()=>print()<\/script></body></html>`);
  w.document.close();
}

/* ---------- Codes SH ---------- */
let recherche = "";
VUES.nomenclature = {
  titre: "Codes SH",
  sous: "Nomenclature du Système Harmonisé et vos codes habituels",
  actions: () => btn("ajouter", "Ajouter un code", { icone: "plus" }),
  rendu: () => `${blocIA()}
    <div class="card">
      <div class="search">${ic("search")}<input id="q" type="search" placeholder="Rechercher : pneumatiques, 87, huile, textile…" value="${esc(recherche)}" autocomplete="off"></div>
      <div id="res-nomenclature"></div>
      <p class="hint">Les 2 premiers chiffres du code donnent le chapitre. Le code marocain complet compte 10 chiffres : consultez le tarif officiel de l'ADII avant toute déclaration.</p>
    </div>`,
  apres() { rendreRecherche(); },
  saisie(e) {
    if (e.target.id === "q") { recherche = e.target.value; rendreRecherche(); }
    if (e.target.form?.id === "f-ia-sh") iaEtat[e.target.name] = e.target.value;
  },
  async soumettre(fid, v) {
    if (fid !== "f-ia-sh" || iaEtat.enCours) return;
    Object.assign(iaEtat, { description: v.description, details: v.details, enCours: true, erreur: "", resultat: null });
    rafraichir();
    try { iaEtat.resultat = await iaClasser(v); }
    catch (e) { iaEtat.erreur = e.message; }
    finally {
      iaEtat.enCours = false;
      if (ongletActif === "nomenclature") rafraichir();
      if (iaEtat.resultat) toast(`${iaEtat.resultat.suggestions.length} proposition${iaEtat.resultat.suggestions.length > 1 ? "s" : ""} de classement`);
    }
  },
  async agir(act, id) {
    const sug = iaEtat.resultat?.suggestions?.[+id];
    if (act === "ia-ajouter" && sug) {
      const code = sug.code_national || sug.code_sh6;
      if (S.codes.some((c) => c.code === code)) return toast(`Le code ${code} est déjà dans vos codes.`, "warn");
      S.codes.push({ id: uid(), code, designation: sug.designation, droit: "", notes: `Proposé par l'assistant IA (confiance ${LIB_CONFIANCE[sug.confiance][0].toLowerCase()}) — à vérifier sur le tarif ADII.${sug.points_a_verifier.length ? " À vérifier : " + sug.points_a_verifier.join(" ; ") : ""}` });
      sauver(); toast(`Code ${code} ajouté à vos codes`); rafraichir();
    }
    if (act === "ia-appliquer" && sug) {
      const d = parId(S.dossiers, iaEtat.dossierId);
      if (!d) return;
      d.codeSH = sug.code_national || sug.code_sh6;
      sauver(); toast(`Code ${d.codeSH} appliqué au dossier ${d.ref}`);
      iaEtat.dossierId = null; dossiersOuverts.add(d.id); afficher("douane");
    }
    if (act === "ia-effacer") { Object.assign(iaEtat, { description: "", details: "", resultat: null, erreur: "", dossierId: null }); rafraichir(); }
    if (act === "ajouter") {
      const v = await formulaire("Ajouter un code habituel", [
        { name: "code", label: "Code SH (10 chiffres)", required: true, placeholder: "4011.20.00.00" },
        { name: "droit", label: "Droit d'importation (%)", type: "number", min: 0 },
        { name: "designation", label: "Désignation", required: true, full: true },
        { name: "notes", label: "Notes (documents exigés, contrôles…)", type: "textarea", full: true },
      ], { valider: "Ajouter" });
      if (!v) return;
      S.codes.push({ id: uid(), ...v }); sauver(); toast(`Code ${v.code} ajouté`); rafraichir();
    }
    if (act === "suppr-code" && (await confirmer("Supprimer ce code ?", parId(S.codes, id)?.designation || ""))) { S.codes = S.codes.filter((c) => c.id !== id); sauver(); rendreRecherche(); }
  },
};
const iaEtat = { description: "", details: "", enCours: false, resultat: null, erreur: "", dossierId: null };
const LIB_CONFIANCE = { elevee: ["Confiance élevée", "ok"], moyenne: ["Confiance moyenne", "warn"], faible: ["Confiance faible", "danger"] };

function blocIA() {
  const conf = iaConfig();
  if (!conf.cle) {
    return `<div class="card ia-card"><div class="ia-intro"><span class="ia-ico">${ic("sparkles")}</span>
      <div><h2>Assistant IA de classement</h2><p class="hint" style="margin:4px 0 0">Décrivez une marchandise : l'assistant propose le code SH, explique son raisonnement (RGI) et signale les contrôles probables. Il faut une clé API Anthropic (paiement à l'usage, quelques centimes par demande).</p></div></div>
      <div class="row" style="margin-top:14px">${btn("aller", "Configurer l'assistant", { id: "parametres", icone: "settings" })}</div></div>`;
  }
  const dossier = iaEtat.dossierId && parId(S.dossiers, iaEtat.dossierId);
  const r = iaEtat.resultat;
  const liste = (titre, items) => items?.length ? `<div class="section-title">${titre}</div><ul class="ia-list">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  return `<div class="card ia-card">
    <div class="card-head"><h2 class="row" style="gap:10px"><span class="ia-ico sm">${ic("sparkles")}</span>Assistant IA de classement</h2>${badge(iaModele(conf.modele).nom.split(" — ")[0], "neutral")}</div>
    ${dossier ? `<p class="hint" style="margin:0 0 12px">Pour le dossier <strong>${esc(dossier.ref)}</strong> · ${esc(dossier.client)}</p>` : ""}
    <form id="f-ia-sh">
      ${champs([
        { name: "description", label: "Marchandise", type: "textarea", full: true, required: true, value: iaEtat.description },
        { name: "details", label: "Précisions (matière, usage, présentation, état neuf ou usagé…)", full: true, value: iaEtat.details },
      ])}
      <div class="row" style="justify-content:space-between;margin-top:14px">
        <p class="hint" style="margin:0">Plus la description est précise, plus le classement est fiable. Le coût de chaque demande s'affiche avec la réponse.</p>
        <div class="row">${r || iaEtat.erreur ? btn("ia-effacer", "Effacer", { cls: "btn ghost" }) : ""}
          <button class="btn" ${iaEtat.enCours ? "disabled" : ""}>${iaEtat.enCours ? '<span class="spinner"></span>Analyse en cours…' : ic("sparkles") + "Proposer un classement"}</button></div>
      </div>
    </form>
    ${iaEtat.erreur ? `<div class="ia-erreur">${ic("alert")}<span>${esc(iaEtat.erreur)}</span></div>` : ""}
    ${r ? `<div class="ia-res">
      <p class="hint" style="margin:0 0 4px">Marchandise comprise : <strong>${esc(r.comprehension)}</strong></p>
      ${r.suggestions.map((s, i) => {
        const [lc, nc] = LIB_CONFIANCE[s.confiance] || LIB_CONFIANCE.faible;
        return `<div class="ia-sug">
          <div class="row" style="justify-content:space-between">
            <div class="row"><span class="code-pill lg">${esc(s.code_sh6)}</span>${s.code_national ? `<span class="sub">National proposé : <strong>${esc(s.code_national)}</strong> (à vérifier)</span>` : ""}</div>
            ${badge(lc, nc)}
          </div>
          <div class="ia-des">${esc(s.designation)}</div>
          <p class="ia-just">${esc(s.justification)}</p>
          ${s.points_a_verifier.length ? `<ul class="ia-list">${s.points_a_verifier.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
          <div class="row">${btn("ia-ajouter", "Ajouter à mes codes", { id: String(i), icone: "plus", cls: "btn ghost sm" })}
            ${dossier ? btn("ia-appliquer", `Appliquer au dossier ${dossier.ref}`, { id: String(i), icone: "check", cls: "btn sm" }) : ""}</div>
        </div>`;
      }).join("")}
      ${liste("Pour affiner le classement", r.questions)}
      ${liste("Contrôles et autorisations probables", r.controles)}
      <p class="hint">${esc(r.modele)}${r.secours ? " (modèle de secours)" : ""} · coût ≈ ${r.cout < 0.01 ? "< 0,01" : fmt(r.cout, 2)} $ · Proposition indicative : vérifiez toujours sur le tarif officiel de l'ADII avant de déclarer.</p>
    </div>` : ""}
  </div>`;
}

function rendreRecherche() {
  const q = sansAccent(recherche).trim();
  const qCode = q.replace(/[\s.]/g, "");
  const match = (code, txt) => !q || (/^\d+$/.test(qCode) && code.replace(/\./g, "").startsWith(qCode)) || sansAccent(txt).includes(q);
  const perso = S.codes.filter((c) => match(c.code, `${c.designation} ${c.notes}`));
  const chap = CHAPITRES_SH.filter(([c, t]) => match(c, t));
  $("#res-nomenclature").innerHTML = `
    ${perso.length ? `<div class="section-title">Mes codes · ${perso.length}</div><div class="table-wrap"><table><tbody>
      ${perso.map((c) => `<tr><td style="width:150px"><span class="code-pill">${esc(c.code)}</span></td><td>${esc(c.designation)}${c.notes ? `<span class="sub">${esc(c.notes)}</span>` : ""}</td>
        <td class="r">${c.droit !== "" && c.droit !== undefined ? badge(`DI ${c.droit} %`) : ""}</td><td><div class="actions">${iconBtn("suppr-code", "trash", "Supprimer", c.id, true)}</div></td></tr>`).join("")}
    </tbody></table></div>` : ""}
    <div class="section-title">Chapitres · ${chap.length}</div>
    ${chap.length ? `<div class="table-wrap"><table><tbody>${chap.map(([c, t]) => `<tr><td style="width:70px"><span class="code-pill">${c}</span></td><td>${esc(t)}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="hint">Aucun chapitre ne correspond à « ${esc(recherche)} ».</p>`}`;
}

/* ---------- Réglages ---------- */
let invitationInstall = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); invitationInstall = e; });

VUES.parametres = {
  titre: "Réglages",
  sous: "Paramètres de calcul, sauvegarde et installation",
  rendu() {
    const P = S.params;
    const n = (name, label) => ({ name, label, type: "number", value: P[name] });
    const ds = S.meta.derniereSauvegarde;
    return `
    <div class="card">
      <div class="card-head"><h2>Calculs</h2></div>
      <form id="f-params">
        <div class="section-title" style="margin-top:0">Coûts</div>
        ${champs([n("prixGasoil", "Prix du gasoil (MAD/L)"), n("consoDefaut", "Consommation par défaut (L/100 km)"), n("vitesseMoyenne", "Vitesse moyenne (km/h)"), n("seuilConso", "Alerte conso au-dessus de la moyenne (%)")])}
        <div class="section-title">Entretien</div>
        ${champs([n("intervalleVidange", "Intervalle vidange par défaut (km)"), n("intervallePneus", "Durée de vie pneus par défaut (km)"), n("alerteKm", "Prévenir avant l'échéance (km)"), n("alerteJours", "Prévenir avant une expiration (jours)")])}
        <div class="section-title">Temps de conduite et repos</div>
        ${champs([n("amplitudeMaxHeures", "Service maximum (h)"), n("reposMinHeures", "Repos minimum (h)"), n("conduiteMaxJour", "Conduite max par jour (h)"), n("conduiteAvantPause", "Conduite avant pause (h)"), n("dureePause", "Durée de la pause (h)")])}
        <p class="hint">Valeurs indicatives : adaptez-les à la réglementation applicable à vos trajets (nationaux ou internationaux).</p>
        <div class="row" style="justify-content:flex-end;margin-top:12px">${btn("defaut", "Valeurs par défaut", { cls: "btn ghost" })}<button class="btn">Enregistrer</button></div>
      </form>
    </div>
    ${carteReglagesIA()}
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h2>Sauvegarde</h2>${ds ? badge(`Dernière : ${dateFr(ds.slice(0, 10))}`, -joursAvant(ds.slice(0, 10)) > 7 ? "warn" : "ok") : badge("Jamais", "warn")}</div>
        <p class="hint" style="margin-top:0">Vos données restent sur cet appareil. Exportez-les chaque semaine, et importez le fichier pour les transférer sur un autre appareil.</p>
        <div class="row" style="margin-top:12px">
          ${btn("exporter", "Exporter", { icone: "download" })}
          <label class="btn ghost">${ic("upload")}Importer<input type="file" id="import" accept=".json,application/json" hidden></label>
        </div>
        <div class="section-title">Zone sensible</div>
        <div class="row">${btn("demo", "Charger l'exemple", { cls: "btn ghost" })}${btn("reset", "Tout effacer", { cls: "btn text-danger" })}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Application mobile</h2></div>
        <p class="hint" style="margin-top:0">Installez Logistique Fret sur l'écran d'accueil : elle s'ouvre comme une application et fonctionne sans réseau.</p>
        ${invitationInstall ? btn("installer", "Installer sur cet appareil", { icone: "phone" })
          : `<p class="hint">Sur Android (Chrome) : menu ⋮ → « Installer l'application ». Sur iPhone (Safari) : Partager → « Sur l'écran d'accueil ».${location.protocol === "file:" ? " L'installation nécessite que l'application soit hébergée (ex. GitHub Pages)." : ""}</p>`}
      </div>
    </div>`;
  },
  apres() {
    $("#import").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      let d;
      try { d = JSON.parse(await f.text()); if (!Array.isArray(d.camions)) throw 0; }
      catch { return toast("Fichier invalide : choisissez une sauvegarde Logistique Fret (.json).", "danger"); }
      if (!(await confirmer("Importer la sauvegarde ?", `Toutes les données actuelles seront remplacées par celles du fichier (${d.camions.length} camions, ${(d.chauffeurs || []).length} chauffeurs).`, "Remplacer"))) return;
      S = normaliser(d); sauver(); toast("Sauvegarde importée"); afficher("tableau");
    });
  },
  soumettre(fid, v) {
    if (fid === "f-ia") {
      const actuelle = iaConfig();
      iaSauverConfig({ cle: v.cle || actuelle.cle, modele: v.modele });
      toast(v.cle || actuelle.cle ? "Assistant IA configuré" : "Modèle enregistré"); return rafraichir();
    }
    for (const k of Object.keys(PARAMS_DEFAUT)) S.params[k] = num(v[k], PARAMS_DEFAUT[k]);
    sauver(); toast("Réglages enregistrés"); rafraichir();
  },
  async agir(act) {
    if (act === "exporter") {
      S.meta.derniereSauvegarde = new Date().toISOString(); sauver();
      telecharger(`logistique-sauvegarde-${today()}.json`, JSON.stringify(S, null, 2), "application/json");
      toast("Sauvegarde téléchargée"); rafraichir();
    }
    if (act === "defaut") { S.params = { ...PARAMS_DEFAUT }; sauver(); toast("Valeurs par défaut rétablies"); rafraichir(); }
    if (act === "reset" && (await confirmer("Tout effacer ?", "Camions, chauffeurs, pleins, trajets et dossiers seront supprimés définitivement. Exportez d'abord une sauvegarde.", "Tout effacer"))) {
      S = etatVide(); sauver(); toast("Données effacées"); afficher("tableau");
    }
    if (act === "demo" && (!S.camions.length || (await confirmer("Charger l'exemple ?", "Les données actuelles seront remplacées.", "Remplacer")))) {
      S = donneesDemo(); sauver(); toast("Données d'exemple chargées"); afficher("tableau");
    }
    if (act === "ia-verifier") {
      const b = $("#app [data-act=ia-verifier]");
      b.disabled = true; b.innerHTML = '<span class="spinner"></span>Vérification…';
      try { toast(`Clé valide · ${await iaVerifierCle()} disponible`); }
      catch (e) { toast(e.message, "danger"); }
      finally { rafraichir(); }
    }
    if (act === "ia-oublier" && (await confirmer("Retirer la clé API ?", "L'assistant IA sera désactivé sur cet appareil.", "Retirer"))) {
      iaSauverConfig({ ...iaConfig(), cle: "" }); toast("Clé retirée"); rafraichir();
    }
    if (act === "installer" && invitationInstall) { invitationInstall.prompt(); invitationInstall = null; rafraichir(); }
  },
};

function carteReglagesIA() {
  const c = iaConfig();
  const masque = c.cle ? `${c.cle.slice(0, 10)}…${c.cle.slice(-4)}` : "";
  return `<div class="card">
    <div class="card-head"><h2 class="row" style="gap:10px"><span class="ia-ico sm">${ic("sparkles")}</span>Assistant IA</h2>${c.cle ? badge("Activé", "ok") : badge("Non configuré", "neutral")}</div>
    <form id="f-ia">
      ${champs([
        { name: "cle", label: c.cle ? `Clé API Anthropic (actuelle : ${masque})` : "Clé API Anthropic", type: "password", placeholder: c.cle ? "Laisser vide pour garder la clé actuelle" : "sk-ant-…", autocomplete: "off" },
        { name: "modele", label: "Modèle", type: "select", value: c.modele, options: IA_MODELES.map((m) => [m.id, m.nom]) },
      ])}
      <p class="hint">Créez une clé sur <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> (paiement à l'usage).
        Tarifs par million de jetons : ${IA_MODELES.map((m) => `${m.nom.split(" — ")[0].replace("Claude ", "")} ${fmt(m.entree, 2)} $ / ${fmt(m.sortie, 2)} $`).join(" · ")} (entrée / sortie).
        La clé reste sur cet appareil et n'est <strong>jamais</strong> incluse dans les sauvegardes exportées. Conseil : utilisez une clé dédiée avec une limite de dépense mensuelle.</p>
      <div class="row" style="justify-content:flex-end;margin-top:12px">
        ${c.cle ? btn("ia-oublier", "Retirer la clé", { cls: "btn text-danger" }) + btn("ia-verifier", "Vérifier la clé", { cls: "btn ghost" }) : ""}
        <button class="btn">Enregistrer</button>
      </div>
    </form>
  </div>`;
}

/* ---------- données d'exemple ---------- */
function donneesDemo() {
  const e = etatVide();
  const j = (n) => dateISO(Date.now() + n * 86400000);
  const h = (n) => new Date(Date.now() + n * 3600000).toISOString();
  e.camions = [
    { id: "c1", immat: "12345-A-6", marque: "Volvo FH", km: 412300, kmVidange: 374000, intervalleVidange: 40000, kmPneus: 330000, intervallePneus: 100000, assurance: j(20), visite: j(90) },
    { id: "c2", immat: "67890-B-1", marque: "Renault T", km: 218900, kmVidange: 205000, intervalleVidange: 40000, kmPneus: 150000, intervallePneus: 100000, assurance: j(200), visite: j(-3) },
    { id: "c3", immat: "24680-D-8", marque: "Mercedes Actros", km: 98000, kmVidange: 80000, intervalleVidange: 40000, kmPneus: 0, intervallePneus: 100000, assurance: j(150), visite: j(160) },
  ];
  e.chauffeurs = [
    { id: "h1", nom: "Youssef El Amrani", tel: "06 00 00 00 01", permis: j(400), visiteMedicale: j(15), camionId: "c1" },
    { id: "h2", nom: "Karim Benali", tel: "06 00 00 00 02", permis: j(25), visiteMedicale: j(300), camionId: "c2", debutService: h(-14) },
    { id: "h3", nom: "Said Ouchen", tel: "06 00 00 00 03", permis: j(700), visiteMedicale: j(200), camionId: "c3", reposJusqua: h(5) },
  ];
  const pl = (id, c, d, km, l, prix = 11) => ({ id, camionId: c, date: j(d), km, litres: l, prix, station: ["Afriquia", "Shell", "TotalEnergies"][km % 3], plein: true });
  e.pleins = [
    pl("p1", "c1", -48, 404000, 380), pl("p2", "c1", -40, 406200, 720), pl("p3", "c1", -27, 408400, 725), pl("p4", "c1", -14, 410400, 650), pl("p5", "c1", -4, 412300, 720),
    pl("p6", "c2", -45, 212000, 400), pl("p7", "c2", -30, 214300, 740), pl("p8", "c2", -12, 216600, 745), pl("p9", "c2", -3, 218900, 760),
    pl("p10", "c3", -35, 94000, 300), pl("p11", "c3", -10, 98000, 1240),
  ];
  e.interventions = [
    { id: "i1", camionId: "c2", type: "vidange", date: j(-38), km: 205000, cout: 2400, garage: "Garage Atlas Poids Lourds", notes: "Huile + filtres" },
    { id: "i2", camionId: "c1", type: "freins", date: j(-20), km: 409000, cout: 3800, garage: "Garage Atlas Poids Lourds", notes: "Plaquettes essieu avant" },
    { id: "i3", camionId: "c3", type: "reparation", date: j(-6), km: 97500, cout: 1500, garage: "Électricité Auto Casa", notes: "Alternateur" },
  ];
  e.trajets = [
    { id: "t1", depart: "Casablanca", arrivee: "Agadir", distance: 460, peage: 0, conso: 32, date: j(1), chauffeurId: "h1", camionId: "c1", client: "Agrumes — Souss Export", statut: "planifie" },
  ].map((t) => ({ ...t, calcul: calculTrajet({ distance: t.distance, peage: t.peage, conso: t.conso, prix: 11 }) }));
  e.dossiers = [
    { id: "d1", ref: "D-EXEMPLE-1", type: "import", client: "Société Atlas SARL", marchandise: "Pièces détachées auto", codeSH: "8708", bureau: "Tanger Med", echeance: j(2), statut: "ouvert", coches: [true, true, true, false, false, true] },
    { id: "d2", ref: "D-EXEMPLE-2", type: "export", client: "Souss Export", marchandise: "Agrumes", codeSH: "0805", bureau: "Agadir", echeance: j(10), statut: "ouvert", coches: [true, true] },
  ];
  e.codes = [{ id: "k1", code: "4011.20", designation: "Pneumatiques neufs pour autobus ou camions (à compléter à 10 chiffres)", droit: "", notes: "Vérifier le taux sur le portail ADII" }];
  e.meta.derniereSauvegarde = new Date().toISOString();
  return e;
}

/* ============================================================
   Événements (délégation) et démarrage
   ============================================================ */
document.addEventListener("click", (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) return afficher(tab.dataset.tab);
  const b = e.target.closest("[data-act]");
  if (!b || !b.closest("#app, #actions")) return;
  if (b.dataset.act === "aller") return afficher(b.dataset.id);
  VUES[ongletActif].agir?.(b.dataset.act, b.dataset.id, b);
});
const app = $("#app");
app.addEventListener("input", (e) => VUES[ongletActif].saisie?.(e));
app.addEventListener("submit", (e) => {
  e.preventDefault();
  VUES[ongletActif].soumettre?.(e.target.id, lireForm(e.target), e.target);
});
// Raccourcis clavier : « n » = nouvel élément sur la page courante.
document.addEventListener("keydown", (e) => {
  if (e.key === "n" && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$("#modale").open) {
    const b = $("#actions [data-act=ajouter]");
    if (b) { e.preventDefault(); b.click(); }
  }
});
// Rafraîchit les états (repos, service) chaque minute.
setInterval(() => { if (["tableau", "chauffeurs"].includes(ongletActif) && !$("#modale").open) rafraichir(); }, 60000);

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});

afficher("tableau");
