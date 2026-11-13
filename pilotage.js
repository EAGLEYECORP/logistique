"use strict";
/* ============================================================
   Pilotage — logique pure, testée :
   · rentabilité : coût complet au kilomètre par camion, par corridor et par client (charges fixes comprises) ;
   · prévisions : entretien, attente aux ports, Schengen, stock d'autorisations ;
   · dossier de voyage : conformité des papiers sur la durée du voyage.
   Dépend de noyau.js (état S, coutVoyage, margeCommande…).
   ============================================================ */

const JOURS_PAR_MOIS = 30.4375;
const nomVille = (s) => { const t = String(s || "").replace(/\(.*\)/, "").trim().toLowerCase(); return t ? t.replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase()) : "?"; };
const corridorDe = (o, d) => `${nomVille(o)} → ${nomVille(d)}`;

/** Fin réelle (étape « retour au dépôt ») ou prévue d'un voyage, en date ISO. */
function finVoyage(v) {
  const r = (v.jalons || []).find((j) => j.type === "retour");
  return r ? String(r.date).slice(0, 10) : v.dateRetourPrevue || v.dateDepart || "";
}
const joursVoyage = (v) => (v.dateDepart && finVoyage(v) ? Math.max(1, joursEntre(v.dateDepart, finVoyage(v)) + 1) : 1);
/** Carburant d'un voyage en MAD : le montant saisi, sinon les pleins du camion entre le départ et le retour (estimation). */
function carburantVoyage(v) {
  const lignes = (v.lignesCout || []).filter((l) => l.type === "carburant");
  if (lignes.length) return { mad: lignes.reduce((s, l) => s + ligneCoutMad(l), 0), estime: false };
  if (num(v.carburantMad) > 0) return { mad: num(v.carburantMad), estime: false };
  const fin = finVoyage(v);
  const mad = v.camionId && v.dateDepart ? S.pleins.filter((p) => p.camionId === v.camionId && p.date >= v.dateDepart && p.date <= fin).reduce((s, p) => s + num(p.litres) * num(p.prix), 0) : 0;
  if (mad > 0) return { mad, estime: true, source: "pleins" };
  const jour = typeof estimationCarburantJour === "function" ? estimationCarburantJour(v) : null; // prixjour.js : kilomètres × consommation × prix du jour
  return jour ? { mad: jour.mad, estime: true, source: "prix_jour", detail: jour.detail } : { mad: 0, estime: false };
}
/** Coût d'un voyage avec le carburant réel ou estimé d'après les pleins. */
function coutCompletVoyage(v) {
  const c = coutVoyage(v), carb = carburantVoyage(v);
  const total = c.total - c.parts.carburant + carb.mad;
  return { ...c, parts: { ...c.parts, carburant: carb.mad }, total, marge: c.prix - total, taux: c.prix ? ((c.prix - total) / c.prix) * 100 : 0, coutKm: c.km ? total / c.km : 0, carburantEstime: carb.estime, jours: joursVoyage(v) };
}

/**
 * Rentabilité sur une période [debut, fin] (dates ISO, bornes comprises ; vides = tout).
 * Activités : voyages (hors annulés) et commandes (hors devis, non liées à un voyage : une commande liée est déjà comptée par son voyage).
 * Coût complet = coûts des voyages et commandes + entretien de la période + charges fixes (par camion, et frais généraux répartis à parts égales).
 */
function rentabilite({ debut = "", fin = "" } = {}) {
  const dans = (d) => !!d && (!debut || d >= debut) && (!fin || d <= fin);
  const voyages = S.voyages.filter((v) => v.statut !== "annule" && dans(v.dateDepart));
  const liees = new Set(S.voyages.map((v) => v.commandeId).filter(Boolean));
  const commandes = S.commandes.filter((c) => c.statut !== "devis" && !liees.has(c.id) && dans(c.dateChargement));
  const dates = [...voyages.map((v) => v.dateDepart), ...commandes.map((c) => c.dateChargement), ...S.interventions.map((i) => i.date).filter(dans)].filter(Boolean).sort();
  const d0 = debut || dates[0] || today(), d1 = fin || today();
  const jours = Math.max(1, joursEntre(d0, d1) + 1), mois = jours / JOURS_PAR_MOIS;

  const vide = () => ({ nb: 0, km: 0, kmVide: 0, jours: 0, ca: 0, variable: 0, entretien: 0, fixes: 0 });
  const finir = (x) => { const cout = x.variable + x.entretien + x.fixes, marge = x.ca - cout; return { ...x, cout, marge, taux: x.ca ? (marge / x.ca) * 100 : 0, coutKm: x.km ? cout / x.km : 0, margeKm: x.km ? marge / x.km : 0, pctVide: x.km ? (x.kmVide / x.km) * 100 : 0 }; };
  const parCamion = new Map(), parClient = new Map(), parCorridor = new Map(), parMois = new Map();
  const de = (map, cle, init) => { if (!map.has(cle)) map.set(cle, { ...vide(), ...init }); return map.get(cle); };
  for (const c of S.camions) de(parCamion, c.id, { id: c.id, nom: c.immat, fixeRenseigne: fixesMensuelsCamion(c, d1).total > 0 });
  const avert = { carburantEstime: 0, sansKm: 0, sansPrix: 0, sansCamion: 0 };

  const ajouter = ({ camionId, clientId, corridor, date, km, kmVide, jours: j, ca, variable }) => {
    const cibles = [de(parCamion, camionId || "", { id: camionId || "", nom: camionId ? nomCamion(camionId) : "Sans camion" }), de(parClient, clientId || "", { id: clientId || "", nom: clientId ? nomClient(clientId) : "Sans client" }), de(parCorridor, corridor, { nom: corridor }), de(parMois, date.slice(0, 7), { nom: date.slice(0, 7) })];
    for (const x of cibles) { x.nb++; x.km += km; x.kmVide += kmVide; x.jours += j; x.ca += ca; x.variable += variable; }
    if (!camionId) avert.sansCamion++;
  };
  for (const v of voyages) {
    const c = coutCompletVoyage(v);
    if (c.carburantEstime) avert.carburantEstime++; if (!c.km) avert.sansKm++; if (!c.prix) avert.sansPrix++;
    ajouter({ camionId: v.camionId, clientId: v.clientId, corridor: corridorDe(v.origine, v.destination), date: v.dateDepart, km: c.km, kmVide: num(v.kmRetourVide), jours: c.jours, ca: c.prix, variable: c.total });
  }
  for (const c of commandes) {
    const m = margeCommande(c), t = c.trajetId && parId(S.trajets, c.trajetId);
    ajouter({ camionId: c.camionId, clientId: c.clientId, corridor: corridorDe(c.origine, c.destination), date: c.dateChargement, km: t ? num(t.distance) : 0, kmVide: 0, jours: c.dateLivraison ? Math.max(1, joursEntre(c.dateChargement, c.dateLivraison) + 1) : 1, ca: m.prix, variable: m.cout });
  }
  for (const i of S.interventions) if (dans(i.date) && parCamion.has(i.camionId)) parCamion.get(i.camionId).entretien += num(i.cout);
  for (const c of S.camions) parCamion.get(c.id).fixes = fixesMensuelsCamion(c, d1).total * mois;
  const unites = S.camions.map((c) => ({ id: c.id, camionId: c.id, km: parCamion.get(c.id).km, ca: parCamion.get(c.id).ca }));
  for (const g of chargesGeneralesMois()) for (const [id, m] of repartir(g.montant * mois, g.cle, unites)) parCamion.get(id).fixes += m; // charges générales : selon la clé de chaque charge

  const camions = [...parCamion.values()].map(finir).sort((a, b) => b.ca - a.ca);
  const totaux = finir(camions.reduce((s, x) => { for (const k of ["nb", "km", "kmVide", "jours", "ca", "variable", "entretien", "fixes"]) s[k] += x[k]; return s; }, vide()));
  const kmCharge = totaux.km - totaux.kmVide;
  return {
    periode: { debut: d0, fin: d1, jours, mois }, totaux: { ...totaux, coutKmCharge: kmCharge > 0 ? totaux.cout / kmCharge : 0, variableKm: totaux.km ? totaux.variable / totaux.km : 0, fixesJour: (totaux.fixes + totaux.entretien) / jours },
    camions, clients: [...parClient.values()].map(finir).sort((a, b) => b.ca - a.ca), corridors: [...parCorridor.values()].map(finir).sort((a, b) => b.ca - a.ca),
    mois: [...parMois.values()].map(finir).sort((a, b) => a.nom.localeCompare(b.nom)),
    avertissements: { ...avert, camionsSansFixe: S.camions.filter((c) => !(fixesMensuelsCamion(c, d1).total > 0)).length, sansFraisGeneraux: !chargesGeneralesMois().length },
  };
}

/* ---------- prévisions ---------- */
/** Kilomètres par jour d'un camion d'après ses pleins des 120 derniers jours (au moins 2 relevés espacés de 7 jours). */
function kmParJour(camionId) {
  const depuis = dateISO(Date.now() - 120 * 86400000);
  const p = S.pleins.filter((x) => x.camionId === camionId && x.date >= depuis && num(x.km) > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (p.length < 2) return null;
  const j = joursEntre(p[0].date, p[p.length - 1].date), km = num(p[p.length - 1].km) - num(p[0].km);
  return j >= 7 && km > 0 ? km / j : null;
}
/** Dates probables des prochaines échéances d'entretien au kilométrage : [{ camion, type, resteKm, jours, date }]. */
function previsionsEntretien() {
  const res = [];
  for (const c of S.camions) {
    const r = kmParJour(c.id); if (!r) continue;
    for (const e of etatCamion(c).filter((x) => x.pct !== undefined && x.reste > 0)) { const j = Math.round(e.reste / r); res.push({ camionId: c.id, camion: c.immat, type: e.type, resteKm: e.reste, jours: j, date: dateISO(Date.now() + j * 86400000), kmJour: Math.round(r) }); }
  }
  return res.sort((a, b) => a.jours - b.jours);
}
const mediane = (l) => { if (!l.length) return null; const t = [...l].sort((a, b) => a - b), m = Math.floor(t.length / 2); return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2; };
/** Durées passées dans les ports d'après vos traces : [{ zone, n, medianeH, maxH }] (passages d'au moins 10 minutes). */
function statsPorts() {
  const par = new Map();
  for (const t of S.traces || []) for (const v of t.visites || []) {
    if (v.type !== "port_maroc" && v.type !== "port_europe") continue;
    const h = (v.sortie - v.entree) / 3600; if (h < 10 / 60) continue;
    (par.get(v.zone) || par.set(v.zone, []).get(v.zone)).push(h);
  }
  return [...par.entries()].map(([zone, l]) => ({ zone, n: l.length, medianeH: mediane(l), maxH: Math.max(...l) })).sort((a, b) => b.n - a.n);
}
/** Ce qui se prépare : entretien à moins de 30 jours, Schengen, autorisations, attente au port des prochains départs. [{ niveau, onglet, texte }] */
function previsions() {
  const res = [], P = S.params;
  for (const e of previsionsEntretien()) if (e.jours <= 30) res.push({ niveau: e.jours <= 7 ? "warn" : "info", onglet: "camions", texte: `${e.camion} — ${e.type.toLowerCase()} probable vers le ${dateFr(e.date)} (dans ${e.jours} j, ${fmt(e.resteKm)} km restants à ${fmt(e.kmJour)} km/jour)` });
  for (const ch of S.chauffeurs) {
    const enCours = (ch.sejours || []).find((s) => s.entree && !s.sortie); if (!enCours) continue;
    const p = schengenPrevu((ch.sejours || []).filter((s) => s !== enCours), enCours.entree, dateISO(Date.now() + 120 * 86400000));
    if (p.limite) { const j = joursAvant(p.limite); if (j !== null && j <= 30) res.push({ niveau: j <= 10 ? "warn" : "info", onglet: "international", texte: `${ch.nom} — s'il reste en Europe, la limite Schengen de 90 jours sera atteinte le ${dateFr(p.limite)} (dans ${Math.max(0, j)} j)` }); }
  }
  const prevus = S.voyages.filter((v) => v.statut === "prevu" && joursAvant(v.dateDepart) !== null && joursAvant(v.dateDepart) >= 0 && joursAvant(v.dateDepart) <= 30);
  const sansAut = prevus.filter((v) => !v.autorisationId).length;
  const dispo = (S.autorisations || []).filter((a) => !a.cloturee && !(a.fin && joursAvant(a.fin) < 0) && !(a.mode === "voyage" && (a.dateUtilisation || a.voyageId))).length;
  if (sansAut > dispo) res.push({ niveau: "warn", onglet: "international", texte: `${sansAut} voyage(s) prévu(s) sous 30 jours sans autorisation, pour ${dispo} autorisation(s) disponible(s) : demandez-en ${sansAut - dispo} de plus` });
  const ports = statsPorts(), tm = ports.find((x) => /tanger med/i.test(x.zone));
  const proches = prevus.filter((v) => joursAvant(v.dateDepart) <= 7);
  if (tm && tm.n >= 3 && proches.length) res.push({ niveau: "info", onglet: "voyages", texte: `${proches.length} départ(s) dans les 7 jours : vos camions passent habituellement ${fmt(tm.medianeH, 1)} h au port de Tanger Med (jusqu'à ${fmt(tm.maxH, 1)} h, sur ${tm.n} passages)` });
  const ordre = { warn: 0, info: 1 };
  return res.sort((a, b) => ordre[a.niveau] - ordre[b.niveau]);
}

/* ---------- dossier de voyage : conformité des papiers sur la durée du voyage ---------- */
/** Pour chaque papier du chauffeur et du camion : valide jusqu'au retour, expire pendant le voyage, déjà expiré au départ, ou non renseigné. */
function conformiteVoyage(v) {
  const res = [], debut = v.dateDepart, fin = finVoyage(v);
  const juger = (objet, piece, echeance) => {
    let statut = "non_renseigne";
    if (echeance) statut = debut && echeance < debut ? "expire_au_depart" : fin && echeance < fin ? "expire_pendant" : "valide";
    res.push({ objet, piece, echeance: echeance || "", statut });
  };
  const ch = parId(S.chauffeurs, v.chauffeurId), cam = parId(S.camions, v.camionId);
  if (ch) for (const [k, lib] of DOCS_CHAUFFEUR) juger(ch.nom, lib, ch[k]);
  if (cam) for (const [k, lib] of DOCS_CAMION) juger(cam.immat, lib, cam[k]);
  const a = parId(S.autorisations || [], v.autorisationId);
  juger("Voyage", "Autorisation bilatérale", a ? a.fin || "9999-12-31" : "");
  if (a && !a.fin) res[res.length - 1].echeance = "";
  return res;
}
