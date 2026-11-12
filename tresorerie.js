"use strict";
/* ============================================================
   Compte de résultat de l'entreprise et prévision de trésorerie — logique pure, testée.
   · pnlPeriode : chiffre d'affaires, coûts directs par type, charges de structure réelles de la période, marge nette ;
     une ligne par activité (voyage ou commande), regroupable par client, corridor, camion, chauffeur, mois — seuls ou croisés.
   · previsionsTresorerie : solde jour par jour (factures à encaisser, échéances, dépenses attendues des voyages en cours).
   Dépend de noyau.js, pilotage.js, couts.js, rentabilite.js.
   ============================================================ */

const DIMENSIONS_PNL = [["client", "Client"], ["corridor", "Corridor"], ["camion", "Camion"], ["chauffeur", "Chauffeur"], ["mois", "Mois"]];
const enEUR = (mad) => (S.params.tauxEUR > 0 ? mad / S.params.tauxEUR : 0);
const ajouterJours = (iso, n) => dateISO(Date.parse(iso.slice(0, 10) + "T00:00:00Z") + n * 86400000);

/** Regroupe des lignes d'activité selon une ou plusieurs dimensions. Renvoie [{ cle, nom, noms[], nb, revenue, direct, structure, marge_directe, marge_nette, pct_marge, km, ids[] }] trié par chiffre d'affaires. */
function pivotPnl(lignes, dims) {
  const m = new Map();
  for (const l of lignes) {
    const cles = dims.map((d) => l[d] || ""), cle = cles.join("|");
    if (!m.has(cle)) m.set(cle, { cle, noms: dims.map((d) => l[d + "Nom"] || l[d] || "—"), nb: 0, revenue: 0, direct: 0, structure: 0, km: 0, ids: [] });
    const x = m.get(cle); x.nb++; x.revenue += l.revenue; x.direct += l.direct; x.structure += l.structure; x.km += l.km; x.ids.push(l.id);
  }
  return [...m.values()].map((x) => { const md = x.revenue - x.direct, mn = md - x.structure; return { ...x, nom: x.noms.join(" · "), marge_directe: md, marge_nette: mn, pct_marge: x.revenue ? (mn / x.revenue) * 100 : 0 }; })
    .sort((a, b) => (dims.length === 1 && dims[0] === "mois" ? a.cle.localeCompare(b.cle) : b.revenue - a.revenue));
}

/**
 * Compte de résultat entre deux dates (bornes comprises, vides = tout). Montants en MAD ; `eur` donne les totaux en euros.
 * Activités : voyages hors annulés (date de départ) et commandes hors devis non reliées à un voyage (date de chargement).
 * Les charges de structure de l'entreprise sont celles de la période entière (camions à l'arrêt compris) : `non_alloue` est la part qu'aucun voyage ne porte.
 */
function pnlPeriode(debut = "", fin = "") {
  const dans = (d) => !!d && (!debut || d >= debut) && (!fin || d <= fin);
  const voyages = S.voyages.filter((v) => v.statut !== "annule" && dans(v.dateDepart));
  const liees = new Set(S.voyages.map((v) => v.commandeId).filter(Boolean));
  const commandes = S.commandes.filter((c) => c.statut !== "devis" && !liees.has(c.id) && dans(c.dateChargement));
  const lignes = [], couts_directs_par_type = {};
  const type = (t, m) => { if (m) couts_directs_par_type[t] = (couts_directs_par_type[t] || 0) + m; };
  const dims = (o) => ({ client: o.clientId || "", clientNom: o.clientId ? nomClient(o.clientId) : "Sans client", corridor: corridorDe(o.origine, o.destination), camion: o.camionId || "", camionNom: o.camionId ? nomCamion(o.camionId) : "Sans camion", chauffeur: o.chauffeurId || "", chauffeurNom: o.chauffeurId ? nomChauffeur(o.chauffeurId) : "Sans chauffeur" });
  for (const v of voyages) {
    const m = margeVoyage(v);
    for (const l of m.couts_directs) type(l.type, l.montant);
    lignes.push({ id: v.id, genre: "voyage", ref: v.ref || "", date: v.dateDepart, mois: v.dateDepart.slice(0, 7), ...dims(v), revenue: m.revenu, direct: m.total_direct, structure: m.total_structure, km: m.km });
  }
  for (const c of commandes) {
    const m = margeCommande(c), t = c.trajetId && parId(S.trajets, c.trajetId);
    type("commandes", m.cout);
    lignes.push({ id: c.id, genre: "commande", ref: c.ref || "", date: c.dateChargement, mois: c.dateChargement.slice(0, 7), ...dims(c), revenue: m.prix, direct: m.cout, structure: 0, km: t ? num(t.distance) : 0 });
  }
  const dates = [...lignes.map((l) => l.date), ...S.interventions.map((i) => i.date).filter(dans)].sort();
  const d0 = debut || dates[0] || today(), d1 = fin || today(), mois = Math.max(1, joursEntre(d0, d1) + 1) / JOURS_PAR_MOIS;
  const couts_fixes_alloues_par_categorie = { leasing: 0, assurance: 0, taxe: 0, amortissement: 0, global: 0, entretien: 0 };
  for (const c of S.camions) { const f = fixesMensuelsCamion(c, d1); if (f.detail) for (const k of ["leasing", "assurance", "taxe", "amortissement"]) couts_fixes_alloues_par_categorie[k] += f[k] * mois; else couts_fixes_alloues_par_categorie.global += f.total * mois; }
  for (const i of S.interventions) if (dans(i.date)) couts_fixes_alloues_par_categorie.entretien += num(i.cout);
  const charges_generales_allouees_par_categorie = {};
  for (const g of chargesGeneralesMois()) charges_generales_allouees_par_categorie[g.categorie] = (charges_generales_allouees_par_categorie[g.categorie] || 0) + g.montant * mois;
  const somme = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const revenue = lignes.reduce((s, l) => s + l.revenue, 0), direct = lignes.reduce((s, l) => s + l.direct, 0);
  const fixes = somme(couts_fixes_alloues_par_categorie), generales = somme(charges_generales_allouees_par_categorie), structure = fixes + generales;
  const marge_brute = revenue - direct, marge_nette = marge_brute - structure;
  return {
    debut: d0, fin: d1, mois, nb: lignes.length, revenue, couts_directs: direct, couts_directs_par_type, marge_brute, couts_fixes_alloues_par_categorie, charges_generales_allouees_par_categorie, couts_fixes: fixes, charges_generales: generales, structure,
    marge_nette, pct_marge: revenue ? (marge_nette / revenue) * 100 : 0, non_alloue: structure - lignes.reduce((s, l) => s + l.structure, 0), km: lignes.reduce((s, l) => s + l.km, 0),
    eur: { revenue: enEUR(revenue), marge_brute: enEUR(marge_brute), marge_nette: enEUR(marge_nette), structure: enEUR(structure) },
    lignes, par_client: pivotPnl(lignes, ["client"]), par_corridor: pivotPnl(lignes, ["corridor"]), par_camion: pivotPnl(lignes, ["camion"]), par_chauffeur: pivotPnl(lignes, ["chauffeur"]), par_mois: pivotPnl(lignes, ["mois"]),
  };
}
/** Tendance sur n mois glissants (mois en cours compris) : [{ mois, revenue, marge_brute, marge_nette }] — charges de structure du mois entier. */
function tendancePnl(n = 12, jusqua = today()) {
  const r = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = ajouterMois(jusqua.slice(0, 7) + "-01", -i), finMois = ajouterJours(ajouterMois(d, 1), -1), p = pnlPeriode(d, finMois);
    r.push({ mois: d.slice(0, 7), nb: p.nb, revenue: p.revenue, marge_brute: p.marge_brute, marge_nette: p.marge_nette, structure: p.structure });
  }
  return r;
}

/**
 * Prévision de trésorerie jour par jour sur `jours` jours à partir de `depart`. Montants en MAD.
 * Solde de départ : S.entreprise.tresorerie.solde (saisi par l'utilisateur), sinon 0.
 * Entrées : factures non payées à leur échéance (en retard : comptées au jour de départ, signalées) ; prix des voyages prévus ou en cours non facturés, au retour + délai de paiement du client.
 * Sorties : échéances (récurrentes développées) ; dépenses encore estimées des voyages prévus ou en cours — carburant à la fin du voyage + délai de la carte, traversée à sa date de facturation, sinon 30 jours après la traversée, le reste à la fin du voyage.
 * Les dépenses déjà enregistrées sont considérées comme payées (elles sont dans le solde de départ).
 */
function previsionsTresorerie(jours = 90, { depart = today(), solde } = {}) {
  const fin = ajouterJours(depart, jours - 1), mouvements = [];
  const mv = (date, montant, type, libelle, ref = "", plus = {}) => { if (!montant) return; const d = date && date > depart ? date.slice(0, 10) : depart; if (d <= fin) mouvements.push({ date: d, montant, type, libelle, ref, ...plus }); };
  for (const f of S.factures) if (f.statut !== "payee") { const ttc = versMAD(totauxFacture(f).ttc, f.devise), retard = !!f.echeance && f.echeance < depart; mv(f.echeance || depart, ttc, "facture", `Facture ${f.numero || ""}${f.clientId ? " — " + nomClient(f.clientId) : ""}${retard ? " (en retard)" : ""}`, f.id, retard ? { retard: true } : {}); }
  for (const e of echeancier(depart, fin)) mv(e.date, -e.mad, e.type, e.libelle, e.id);
  const delaiCarte = num(S.params.delaiCarteCarburant, 15);
  for (const v of S.voyages) {
    if (!["prevu", "en_cours"].includes(v.statut)) continue;
    const finV = finVoyage(v) || depart, m = margeVoyage(v), cmd = v.commandeId && parId(S.commandes, v.commandeId);
    if (m.revenu > 0 && !cmd?.factureId) { const cl = parId(S.clients, v.clientId); mv(ajouterJours(finV, num(cl?.delai, S.params.delaiPaiement)), m.revenu, "recette_prevue", `Voyage ${v.ref || ""} à facturer${cl ? " — " + cl.nom : ""}`, v.id); }
    for (const l of m.couts_directs) {
      if (!l.projete) continue;
      const t = l.type === "traversee" ? (v.traversees || []).find((x) => x.sens === l.sens) : null;
      const date = l.type === "carburant" ? ajouterJours(finV, delaiCarte) : t ? t.dateFacturation || (t.date ? ajouterJours(t.date, 30) : ajouterJours(finV, 30)) : finV;
      mv(date, -l.montant, "depense_prevue", `${libTypeCout(l.type)}${l.sens ? " " + l.sens : ""} — voyage ${v.ref || ""} (estimation)`, v.id);
    }
  }
  const solde_initial = num(solde ?? S.entreprise?.tresorerie?.solde), parJour = new Map();
  for (const m of mouvements) { if (!parJour.has(m.date)) parJour.set(m.date, []); parJour.get(m.date).push(m); }
  const res = []; let s = solde_initial, min = { date: depart, solde: Infinity }, negatif = null, total_entrees = 0, total_sorties = 0;
  for (let i = 0; i < jours; i++) {
    const date = ajouterJours(depart, i), items = (parJour.get(date) || []).sort((a, b) => b.montant - a.montant);
    const entrees = items.filter((x) => x.montant > 0).reduce((a, x) => a + x.montant, 0), sorties = -items.filter((x) => x.montant < 0).reduce((a, x) => a + x.montant, 0);
    s += entrees - sorties; total_entrees += entrees; total_sorties += sorties;
    if (s < min.solde) min = { date, solde: s }; if (s < 0 && !negatif) negatif = date;
    res.push({ date, entrees, sorties, solde: s, items });
  }
  return { depart, fin, solde_initial, solde_final: s, jours: res, min, negatif, total_entrees, total_sorties, eur: { solde_initial: enEUR(solde_initial), solde_final: enEUR(s), min: enEUR(min.solde) }, solde_renseigne: S.entreprise?.tresorerie?.solde !== undefined && S.entreprise?.tresorerie?.solde !== "" };
}
