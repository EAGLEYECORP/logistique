"use strict";
/* ============================================================
   Conformité et communication (phases 5 à 8) — logique pure, testée :
   liens WhatsApp / SMS, analyse des activités du tachygraphe, chaîne du froid, balise du téléphone.
   ============================================================ */

/* ---------- WhatsApp et SMS (liens prêts à l'emploi : rien n'est envoyé sans geste de l'utilisateur) ---------- */
/** Numéro au format international sans « + » (wa.me). Les numéros marocains « 06… / 07… » deviennent « 212… ». */
function telInternational(tel, indicatifDefaut = "212") {
  let n = String(tel || "").replace(/[^\d+]/g, "");
  if (!n) return "";
  if (n.startsWith("+")) n = n.slice(1);
  else if (n.startsWith("00")) n = n.slice(2);
  else if (n.startsWith("0")) n = indicatifDefaut + n.slice(1);
  else if (n.length <= 9) n = indicatifDefaut + n;
  return /^\d{8,15}$/.test(n) ? n : "";
}
const lienWhatsApp = (tel, texte) => { const n = telInternational(tel); return n ? `https://wa.me/${n}?text=${encodeURIComponent(texte)}` : ""; };
const lienSMS = (tel, texte) => { const n = telInternational(tel); return n ? `sms:+${n}?&body=${encodeURIComponent(texte)}` : ""; };

/* ---------- tachygraphe : activités du conducteur → dépassements (règlement CE 561/2006, version simplifiée) ---------- */
const ACTIVITES = { conduite: "Conduite", travail: "Autre travail", disponibilite: "Disponibilité", repos: "Repos" };
/** Reconnaît un libellé d'activité d'export (français, anglais, codes C/W/A/R, picto…). */
function tachyActivite(v) {
  const s = gpsNorm(v);
  const code = { c: "conduite", d: "conduite", w: "travail", t: "travail", a: "disponibilite", r: "repos", b: "repos" }[s]; // codes à une lettre : correspondance exacte
  if (code) return code;
  if (/^(drive|driving|conduite|conduire|volant)/.test(s)) return "conduite";
  if (/^(avail|disponib|attente|pause equipage)/.test(s)) return "disponibilite";
  if (/^(work|travail|autre travail|other work)/.test(s)) return "travail";
  if (/^(rest|break|repos|pause|coupure)/.test(s)) return "repos";
  return null;
}
const TACHY_COLONNES = {
  conducteur: ["conducteur", "chauffeur", "driver", "nom", "carte"],
  debut: ["debut", "début", "start", "from", "de", "heure debut", "date debut", "begin"],
  fin: ["fin", "end", "to", "jusqu", "heure fin", "date fin"],
  activite: ["activite", "activité", "activity", "type", "etat", "état", "mode"],
  duree: ["duree", "durée", "duration"],
};
function tachyDetecterColonnes(entetes) {
  const h = entetes.map(gpsNorm);
  const trouver = (cands) => { for (const c of cands) { const i = h.indexOf(gpsNorm(c)); if (i >= 0) return i; } for (const c of cands) { if (c.length < 4) continue; const i = h.findIndex((x) => x.includes(gpsNorm(c))); if (i >= 0) return i; } return -1; };
  return { conducteur: trouver(TACHY_COLONNES.conducteur), debut: trouver(TACHY_COLONNES.debut), fin: trouver(TACHY_COLONNES.fin), activite: trouver(TACHY_COLONNES.activite), duree: trouver(TACHY_COLONNES.duree) };
}
/** Lit un export d'activités CSV : [{ debut, fin, type, conducteur }]. fin peut être déduite de la durée (minutes ou hh:mm) ou de l'activité suivante. */
function tachyParseCSV(texte, { offH = 0, colonnes = null } = {}) {
  const lignes = gpsLignesCSV(texte);
  if (lignes.length < 2) return { ok: false, activites: [], entetes: lignes[0] || [], colonnes: null, rejetes: 0, erreur: "Fichier vide ou sans ligne de données." };
  const entetes = lignes[0], col = colonnes || tachyDetecterColonnes(entetes);
  if (col.debut < 0 || col.activite < 0 || (col.fin < 0 && col.duree < 0)) return { ok: false, activites: [], entetes, colonnes: col, rejetes: 0, erreur: "Colonnes introuvables (début, activité, fin ou durée)." };
  const brut = []; let rejetes = 0;
  for (const l of lignes.slice(1)) {
    const debut = gpsTemps(l[col.debut], offH), type = tachyActivite(l[col.activite]);
    let fin = col.fin >= 0 ? gpsTemps(l[col.fin], offH) : NaN;
    if (!Number.isFinite(fin) && col.duree >= 0) { const d = String(l[col.duree]).trim(), m = d.match(/^(\d+):(\d{2})/); const mn = m ? +m[1] * 60 + +m[2] : gpsNombre(d); if (Number.isFinite(mn)) fin = debut + mn * 60; }
    if (!Number.isFinite(debut) || !type) { rejetes++; continue; }
    brut.push({ debut, fin, type, conducteur: col.conducteur >= 0 ? l[col.conducteur] : "" });
  }
  brut.sort((a, b) => a.debut - b.debut);
  const activites = [];
  brut.forEach((a, i) => { const fin = Number.isFinite(a.fin) ? a.fin : brut[i + 1]?.debut; if (Number.isFinite(fin) && fin > a.debut) activites.push({ ...a, fin }); else rejetes++; });
  return { ok: activites.length > 0, activites, entetes, colonnes: col, rejetes, erreur: activites.length ? "" : "Aucune activité exploitable." };
}

const H = 3600;
/**
 * Analyse d'une suite d'activités [{ debut, fin, type }] : conduite par journée de travail et par semaine, pauses, repos.
 * Règles appliquées : 4 h 30 de conduite sans pause de 45 min (ou 15 + 30) · 9 h par jour (10 h deux fois par semaine) · 56 h par semaine · 90 h sur deux semaines ·
 * repos journalier de 11 h (9 h trois fois entre deux repos hebdomadaires) · repos hebdomadaire de 45 h (24 h réduit).
 * Ce n'est pas un contrôle officiel : seul le tachygraphe et l'autorité font foi.
 */
function tachyAnalyser(activites) {
  const A = [...activites].sort((a, b) => a.debut - b.debut), inf = [];
  const jour = (t) => gpsIso(t).slice(0, 10), duree = (a) => a.fin - a.debut;
  const ajouter = (type, gravite, t, texte) => inf.push({ type, gravite, date: jour(t), t, texte });

  // 1) conduite continue : somme de conduite depuis la dernière pause valide
  let serie = 0, pauseCourte = 0, serieDebut = null;
  for (const a of A) {
    if (a.type === "conduite") {
      if (serie === 0) serieDebut = a.debut;
      serie += duree(a);
      if (serie > 4.5 * H + 60) { ajouter("conduite_continue", serie > 5 * H ? "grave" : "mineur", serieDebut, `Conduite continue de ${(serie / H).toFixed(1).replace(".", ",")} h sans pause de 45 min`); serie = 0; pauseCourte = 0; }
    } else if (a.type === "repos") {
      const d = duree(a);
      if (d >= 45 * H / 60) { serie = 0; pauseCourte = 0; }
      else if (d >= 15 * 60) { if (pauseCourte === 0) pauseCourte = d; else if (pauseCourte >= 15 * 60 && d >= 30 * 60) { serie = 0; pauseCourte = 0; } else pauseCourte = d; }
    }
  }

  // 2) journées de travail : séparées par un repos de 9 h au moins
  const journees = []; let cur = null, dernierFin = null;
  for (const a of A) {
    const repos = a.type === "repos" ? duree(a) : 0;
    if (a.type === "repos" && repos >= 9 * H) { if (cur) { cur.reposApres = repos; cur.fin = dernierFin; journees.push(cur); cur = null; } dernierFin = a.fin; continue; }
    if (a.type !== "repos" && !cur) cur = { debut: a.debut, conduite: 0, reposApres: 0 };
    if (cur && a.type === "conduite") cur.conduite += duree(a);
    dernierFin = a.fin;
  }
  if (cur) { cur.fin = dernierFin; journees.push(cur); }
  const semaine = (t) => { const d = new Date(t * 1000), j = (d.getUTCDay() + 6) % 7; return jour(t - j * 86400); }; // lundi de la semaine
  const par10h = {};
  for (const j of journees) {
    const h = j.conduite / H, sem = semaine(j.debut);
    if (h > 10 * H / H + 1 / 60) ajouter("conduite_jour", "grave", j.debut, `Conduite journalière de ${h.toFixed(1).replace(".", ",")} h (maximum 10 h)`);
    else if (h > 9 + 1 / 60) { par10h[sem] = (par10h[sem] || 0) + 1; if (par10h[sem] > 2) ajouter("conduite_jour", "mineur", j.debut, `Plus de 2 journées à 10 h dans la semaine du ${dateFr(sem)} (${h.toFixed(1).replace(".", ",")} h)`); }
  }
  // repos journalier : entre deux journées, 11 h (9 h réduit, 3 fois au plus entre deux repos hebdomadaires de 24 h+)
  let reduits = 0;
  journees.forEach((j, i) => {
    const suivante = journees[i + 1]; if (!suivante) return;
    const repos = suivante.debut - j.fin;
    if (repos >= 24 * H) { reduits = 0; return; }
    if (repos < 11 * H) { reduits++; if (reduits > 3) ajouter("repos_journalier", "mineur", j.fin, `Repos journalier réduit pour la 4ᵉ fois sans repos hebdomadaire (${(repos / H).toFixed(1).replace(".", ",")} h)`); }
  });
  // 3) semaines
  const sem = {};
  for (const a of A) if (a.type === "conduite") { const k = semaine(a.debut); sem[k] = (sem[k] || 0) + duree(a) / H; }
  const semaines = Object.entries(sem).sort().map(([debut, h]) => ({ debut, conduiteH: h }));
  semaines.forEach((s, i) => {
    if (s.conduiteH > 56) ajouter("conduite_semaine", "grave", Date.parse(s.debut) / 1000, `Conduite hebdomadaire de ${s.conduiteH.toFixed(1).replace(".", ",")} h (maximum 56 h) — semaine du ${dateFr(s.debut)}`);
    const p = semaines[i + 1]; if (p && joursEntre(s.debut, p.debut) === 7 && s.conduiteH + p.conduiteH > 90) ajouter("conduite_2semaines", "grave", Date.parse(p.debut) / 1000, `${(s.conduiteH + p.conduiteH).toFixed(1).replace(".", ",")} h de conduite sur deux semaines (maximum 90 h)`);
  });
  // repos hebdomadaire : au moins un repos de 24 h par semaine civile couverte par les données (hors première et dernière semaine incomplètes)
  const repos24 = A.filter((a) => a.type === "repos" && duree(a) >= 24 * H);
  const lundis = [...new Set(A.map((a) => semaine(a.debut)))].sort();
  lundis.slice(1, -1).forEach((l) => { const fin = Date.parse(l) / 1000 + 7 * 86400; if (!repos24.some((r) => r.fin >= Date.parse(l) / 1000 && r.debut < fin)) ajouter("repos_hebdo", "grave", Date.parse(l) / 1000, `Aucun repos hebdomadaire de 24 h la semaine du ${dateFr(l)}`); });
  inf.sort((a, b) => a.t - b.t);
  const total = A.filter((a) => a.type === "conduite").reduce((s, a) => s + duree(a), 0) / H;
  return { conduiteTotalH: total, journees: journees.map((j) => ({ ...j, conduiteH: j.conduite / H })), semaines, infractions: inf.map(({ type, gravite, date, texte }) => ({ type, gravite, date, texte })), debut: A[0]?.debut ?? null, fin: A.length ? A[A.length - 1].fin : null };
}

/* ---------- chaîne du froid ---------- */
/**
 * Excursions hors plage de consigne. points : [[t, temp], …] ; min / max en °C ; tolérance en minutes (dégivrage, ouverture de porte).
 * Renvoie { min, max, moyenne, conforme, excursions: [{ debut, fin, dureeMin, extreme, sens }] } (seules les excursions plus longues que la tolérance comptent).
 */
function froidAnalyser(points, min, max, { toleranceMin = 15 } = {}) {
  const P = points.filter((p) => Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  if (!P.length) return null;
  const hors = (x) => (x < min ? "bas" : x > max ? "haut" : null);
  const exc = []; let cur = null;
  for (let i = 0; i < P.length; i++) {
    const [t, x] = P[i], sens = hors(x);
    if (sens) { if (cur && cur.sens === sens) { cur.fin = t; cur.extreme = sens === "haut" ? Math.max(cur.extreme, x) : Math.min(cur.extreme, x); } else { if (cur) exc.push(cur); cur = { debut: t, fin: t, sens, extreme: x }; } }
    else if (cur) { cur.fin = t; exc.push(cur); cur = null; } // retour en plage : l'excursion court jusqu'à ce point
  }
  if (cur) exc.push(cur);
  const retenues = exc.map((e) => ({ ...e, dureeMin: Math.round((e.fin - e.debut) / 60) })).filter((e) => e.dureeMin >= toleranceMin);
  const temps = P.map((p) => p[1]);
  return { min: Math.min(...temps), max: Math.max(...temps), moyenne: temps.reduce((s, x) => s + x, 0) / temps.length, conforme: retenues.length === 0, excursions: retenues, nb: P.length };
}
/** Excursion en cours (dernière mesure hors plage depuis au moins `toleranceMin`) : { sens, depuisMin, temp } ou null. */
function froidEnCours(points, min, max, maintenant, { toleranceMin = 15 } = {}) {
  const P = points.filter((p) => Number.isFinite(p[1])); if (!P.length) return null;
  const dernier = P[P.length - 1], hors = (x) => (x < min ? "bas" : x > max ? "haut" : null), sens = hors(dernier[1]);
  if (!sens || maintenant - dernier[0] > 3600) return null;
  let debut = dernier[0];
  for (let i = P.length - 2; i >= 0 && hors(P[i][1]) === sens; i--) debut = P[i][0];
  const depuisMin = Math.round((maintenant - debut) / 60);
  return depuisMin >= toleranceMin ? { sens, depuisMin, temp: dernier[1] } : null;
}

/* ---------- balise du téléphone du chauffeur ---------- */
/** Faut-il envoyer cette position ? Au plus toutes les 20 s, ou dès 50 m de déplacement ; précision > 200 m ignorée. */
function baliseTelRetenir(precedente, p) {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || (p.precision != null && p.precision > 200)) return false;
  if (!precedente) return true;
  const dt = p.t - precedente.t;
  return dt >= 20 && (dt >= 60 || gpsDistance([0, precedente.lat, precedente.lon], [0, p.lat, p.lon]) >= 50);
}
