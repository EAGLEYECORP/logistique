"use strict";
/* ============================================================
   Rentabilité : coût complet au kilomètre par camion, par corridor et par client ; retours à combler.
   Logique pure dans pilotage.js.
   ============================================================ */

let cockpitPeriode = 90;
const PERIODES = [[30, "30 jours"], [90, "90 jours"], [365, "12 mois"], [0, "Tout"]];
const bornesPeriode = () => (cockpitPeriode ? { debut: dateISO(Date.now() - cockpitPeriode * 86400000), fin: today() } : {});
const madK = (n) => `${fmt(n)} MAD`;
const couleurMarge = (m) => (m < 0 ? "neg" : "");

function tableauRentabilite(titre, lignes, premiere, { fixes = false } = {}) {
  const utiles = lignes.filter((x) => x.nb || x.entretien || (fixes && x.fixes));
  if (!utiles.length) return "";
  return `<div class="section-title">${titre}</div><div class="card"><div class="table-wrap"><table>
    <thead><tr><th>${premiere}</th><th class="r">Activités</th><th class="r">Km</th><th class="r">Chiffre d'affaires</th><th class="r">${fixes ? "Coût complet" : "Coûts directs"}</th><th class="r">Marge</th><th class="r">Par km</th></tr></thead><tbody>
    ${utiles.map((x) => `<tr><td><strong>${esc(x.nom)}</strong>${fixes && x.fixeRenseigne === false ? `<span class="sub">charges fixes non renseignées</span>` : ""}</td>
      <td class="r num">${x.nb}</td><td class="r num">${fmt(x.km)}${x.kmVide ? `<span class="sub">${fmt(x.pctVide, 0)} % à vide</span>` : ""}</td>
      <td class="r num">${madK(x.ca)}</td>
      <td class="r num">${madK(fixes ? x.cout : x.variable)}${fixes ? `<span class="sub">directs ${fmt(x.variable)} · entretien ${fmt(x.entretien)} · fixes ${fmt(x.fixes)}</span>` : ""}</td>
      <td class="r num ${couleurMarge(fixes ? x.marge : x.ca - x.variable)}"><strong>${madK(fixes ? x.marge : x.ca - x.variable)}</strong><span class="sub">${x.ca ? fmt(((fixes ? x.marge : x.ca - x.variable) / x.ca) * 100, 1) + " %" : "—"}</span></td>
      <td class="r num">${x.km ? `${fmt((fixes ? x.cout : x.variable) / x.km, 2)} MAD<span class="sub">recette ${fmt(x.ca / x.km, 2)}</span>` : "—"}</td></tr>`).join("")}
    </tbody></table></div></div>`;
}
/** Voyages dont le retour n'est pas chargé : à proposer aux partenaires. */
function retoursACombler() {
  return S.voyages.filter((v) => ["prevu", "en_cours"].includes(v.statut) && !(num(v.kmRetourCharge) > 0) && !v.retourTrouve).sort((a, b) => (a.dateRetourPrevue || "").localeCompare(b.dateRetourPrevue || ""));
}
function texteRetour(v) {
  const cam = parId(S.camions, v.camionId), dispo = v.livraisonPrevue ? dateFr(String(v.livraisonPrevue).slice(0, 10)) : dateFr(v.dateRetourPrevue);
  return `Camion disponible au départ de ${nomVille(v.destination)} vers le Maroc (${nomVille(v.origine)}) à partir du ${dispo}.${Number.isFinite(v.tempMin) ? " Semi-remorque frigorifique." : ""}${cam?.essieux >= 5 ? " Ensemble articulé, 33 palettes." : ""} Contact : ${S.entreprise?.nom || ""}${S.entreprise?.tel ? " — " + S.entreprise.tel : ""}`;
}

/* ---------- charges fixes par camion, charges générales, échéances (schéma 7) ---------- */
const optsListe = (l) => l.map(([k, lib]) => [k, lib]);
function blocStructure() {
  const generales = chargesGeneralesMois(), totalG = generales.reduce((s, g) => s + g.montant, 0);
  const a90 = echeancier(today(), dateISO(Date.now() + 90 * 86400000));
  const ligneCamion = (c) => { const f = fixesMensuelsCamion(c), am = amortissementCamion(c);
    const detail = f.detail ? [f.leasing ? `crédit ${fmt(f.leasing)}` : "", f.assurance ? `assurance ${fmt(f.assurance)}` : "", f.taxe ? `taxe ${fmt(f.taxe)}` : "", am.renseigne ? (am.termine ? "amorti" : `amortissement ${fmt(f.amortissement)} (reste ${fmt(am.vnc)})`) : ""].filter(Boolean).join(" · ") : f.total ? "montant global" : "à renseigner";
    return `<div class="trav"><div><strong>${esc(c.immat)}</strong><span class="sub">${esc(detail)}${c.officeResponsable ? " · bureau " + esc(libDe(BUREAUX, c.officeResponsable)) : ""}</span></div><div class="r"><strong class="num">${fmt(f.total)} MAD / mois</strong>${btn("fixes-camion", "Détailler", { id: c.id, cls: "btn ghost sm" })}</div></div>`; };
  return `<div class="section-title">Charges fixes par camion</div>
    <div class="card" id="bloc-fixes">${S.camions.length ? S.camions.map(ligneCamion).join("") : `<p class="hint" style="margin:0">Ajoutez vos camions pour renseigner leurs charges fixes.</p>`}
      <p class="hint">Crédit ou leasing, assurance, taxe à l'essieu, amortissement. L'entretien réel (interventions) est compté à part. Sans détail, l'ancien montant global est utilisé.</p></div>
    <div class="section-title">Charges générales · ${fmt(totalG)} MAD / mois</div>
    <div class="card" id="bloc-generales">${generales.map((g) => `<div class="trav"><div><strong>${esc(g.libelle)}</strong><span class="sub">${g.projete ? "ancienne saisie globale — ajoutez une charge détaillée pour la remplacer" : `${esc(libDe(CATEGORIES_CHARGE, g.categorie))} · répartie ${esc(libDe(CLES_ALLOCATION, g.cle).toLowerCase())}`}</span></div><div class="r"><strong class="num">${fmt(g.montant)} MAD</strong>${g.projete ? "" : iconBtn("charge-modifier", "edit", "Modifier", g.id) + iconBtn("charge-supprimer", "trash", "Supprimer", g.id, true)}</div></div>`).join("") || `<p class="hint" style="margin:0">Loyer, salaires du bureau, comptable, téléphone… Chaque charge est répartie sur les camions et les voyages selon la clé choisie.</p>`}
      <div class="row" style="margin-top:8px">${btn("charge-ajouter", "Ajouter une charge", { icone: "plus", cls: "btn sm" })}</div></div>
    <div class="section-title">Échéances · ${a90.length} dans les 90 jours${a90.length ? ` · ${fmt(a90.reduce((s, e) => s + e.mad, 0))} MAD` : ""}</div>
    <div class="card" id="bloc-echeances">${(S.echeances || []).map((e) => { const proch = occurrencesEcheance(e, today(), dateISO(Date.now() + 400 * 86400000))[0];
      return `<div class="trav"><div><strong>${esc(e.libelle || libDe(TYPES_ECHEANCE, e.type))}</strong><span class="sub">${esc(libDe(TYPES_ECHEANCE, e.type))} · ${esc(libDe(FREQUENCES, e.recurs?.frequence || "").toLowerCase())}${proch ? ` · prochaine le ${dateFr(proch)}` : " · passée"}</span></div><div class="r"><strong class="num">${fmt(e.montant)} ${esc(e.devise || "MAD")}</strong>${iconBtn("echeance-modifier", "edit", "Modifier", e.id)}${iconBtn("echeance-supprimer", "trash", "Supprimer", e.id, true)}</div></div>`; }).join("") || `<p class="hint" style="margin:0">TVA, impôt, assurance, mensualités de crédit, salaires : chaque échéance datée alimente la prévision de trésorerie.</p>`}
      <div class="row" style="margin-top:8px">${btn("echeance-ajouter", "Ajouter une échéance", { icone: "plus", cls: "btn sm" })}</div></div>`;
}
const champsFixesCamion = (c) => { const f = c.coutsFixes || {}, a = c.amortissement || {}; return [
  { name: "leasing_mensuel", label: "Crédit ou leasing par mois (MAD)", type: "number", min: 0, value: f.leasing_mensuel },
  { name: "assurance_mensuel", label: "Assurance par mois (MAD)", type: "number", min: 0, value: f.assurance_mensuel },
  { name: "taxe_routiere_annuelle", label: "Taxe à l'essieu par an (MAD)", type: "number", min: 0, value: f.taxe_routiere_annuelle },
  { name: "entretien_mensuel_budget", label: "Budget d'entretien par mois (MAD)", type: "number", min: 0, value: f.entretien_mensuel_budget },
  { name: "prix_acquisition", label: "Prix d'achat (MAD)", type: "number", min: 0, value: a.prix_acquisition },
  { name: "date_acquisition", label: "Date d'achat", type: "date", value: a.date_acquisition },
  { name: "duree_ans", label: "Durée d'amortissement (années)", type: "number", min: 0, value: a.duree_ans, placeholder: "5" },
  { name: "valeur_residuelle", label: "Valeur de revente prévue (MAD)", type: "number", min: 0, value: a.valeur_residuelle },
  { name: "methode", label: "Méthode d'amortissement", type: "select", options: [["lineaire", "Linéaire"], ["degressif", "Dégressif"]], value: a.methode || "lineaire" },
  { name: "officeResponsable", label: "Bureau responsable", type: "select", options: [["", "—"], ...BUREAUX], value: c.officeResponsable || "" },
  { name: "fixeMensuel", label: "Montant global par mois (MAD), utilisé seulement si rien n'est détaillé ci-dessus", type: "number", min: 0, value: c.fixeMensuel, full: true },
]; };
const champsCharge = (g = {}) => [
  { name: "libelle", label: "Libellé", value: g.libelle, required: true, placeholder: "Loyer du bureau de Tanger", full: true },
  { name: "montant_mensuel", label: "Montant par mois (MAD)", type: "number", min: 0, value: g.montant_mensuel, required: true },
  { name: "categorie", label: "Catégorie", type: "select", options: CATEGORIES_CHARGE, value: g.categorie || "loyer" },
  { name: "cle_allocation", label: "Répartition", type: "select", options: CLES_ALLOCATION, value: g.cle_allocation || "km", full: true },
];
const champsEcheance = (e = {}) => [
  { name: "libelle", label: "Libellé", value: e.libelle, required: true, placeholder: "TVA du 4e trimestre", full: true },
  { name: "type", label: "Type", type: "select", options: TYPES_ECHEANCE, value: e.type || "autre" },
  { name: "montant", label: "Montant", type: "number", min: 0, value: e.montant, required: true },
  { name: "devise", label: "Devise", type: "select", options: [["MAD", "MAD"], ["EUR", "EUR"]], value: e.devise || "MAD" },
  { name: "date", label: "Date (première échéance)", type: "date", value: e.date, required: true },
  { name: "frequence", label: "Répétition", type: "select", options: FREQUENCES, value: e.recurs?.frequence || "" },
  { name: "jusqu_a", label: "Jusqu'au (facultatif)", type: "date", value: e.recurs?.jusqu_a },
];
const nombres = (v, cles) => { const o = {}; for (const k of cles) if (v[k] !== "" && v[k] !== undefined) o[k] = num(v[k]); return o; };
async function agirStructure(act, id) {
  if (act === "fixes-camion") {
    const c = parId(S.camions, id); if (!c) return true;
    const v = await formulaire(`Charges fixes de ${c.immat}`, champsFixesCamion(c), { aide: "Camion en crédit ou leasing : renseignez la mensualité. Camion acheté comptant : renseignez l'amortissement. Évitez de compter les deux pour le même camion." });
    if (!v) return true;
    const f = nombres(v, ["leasing_mensuel", "assurance_mensuel", "taxe_routiere_annuelle", "entretien_mensuel_budget"]), a = nombres(v, ["prix_acquisition", "duree_ans", "valeur_residuelle"]);
    if (v.date_acquisition) a.date_acquisition = v.date_acquisition; if (Object.keys(a).length) a.methode = v.methode;
    if (Object.keys(f).length) c.coutsFixes = f; else delete c.coutsFixes;
    if (Object.keys(a).length) c.amortissement = a; else delete c.amortissement;
    if (v.officeResponsable) c.officeResponsable = v.officeResponsable; else delete c.officeResponsable;
    if (v.fixeMensuel === "") delete c.fixeMensuel; else c.fixeMensuel = num(v.fixeMensuel);
    sauver(); toast("Charges fixes enregistrées"); rafraichir(); return true;
  }
  if (act === "charge-ajouter" || act === "charge-modifier") {
    const g = act === "charge-modifier" ? parId(S.chargesGenerales, id) : null;
    const v = await formulaire(g ? "Modifier la charge" : "Nouvelle charge générale", champsCharge(g || {}), { valider: g ? "Enregistrer" : "Ajouter", aide: "Au kilomètre : chaque voyage porte sa part selon sa distance. Au chiffre d'affaires : selon son prix. Par camion : même part pour chaque camion." });
    if (!v) return true;
    const d = { libelle: v.libelle, montant_mensuel: num(v.montant_mensuel), categorie: v.categorie, cle_allocation: v.cle_allocation };
    if (g) Object.assign(g, d); else (S.chargesGenerales ||= []).push({ id: uid(), ...d });
    sauver(); toast(g ? "Charge modifiée" : "Charge ajoutée"); rafraichir(); return true;
  }
  if (act === "charge-supprimer") {
    const g = parId(S.chargesGenerales, id); if (!g || !(await confirmer("Supprimer cette charge ?", g.libelle || ""))) return true;
    S.chargesGenerales = S.chargesGenerales.filter((x) => x.id !== id); sauver(); toast("Charge supprimée"); rafraichir(); return true;
  }
  if (act === "echeance-ajouter" || act === "echeance-modifier") {
    const e = act === "echeance-modifier" ? parId(S.echeances, id) : null;
    const v = await formulaire(e ? "Modifier l'échéance" : "Nouvelle échéance", champsEcheance(e || {}), { valider: e ? "Enregistrer" : "Ajouter" });
    if (!v) return true;
    const d = { libelle: v.libelle, type: v.type, montant: num(v.montant), devise: v.devise, date: v.date, recurs: v.frequence ? { frequence: v.frequence, ...(v.jusqu_a ? { jusqu_a: v.jusqu_a } : {}) } : undefined };
    if (e) { Object.assign(e, d); if (!d.recurs) delete e.recurs; } else (S.echeances ||= []).push({ id: uid(), ...d });
    sauver(); toast(e ? "Échéance modifiée" : "Échéance ajoutée"); rafraichir(); return true;
  }
  if (act === "echeance-supprimer") {
    const e = parId(S.echeances, id); if (!e || !(await confirmer("Supprimer cette échéance ?", e.libelle || ""))) return true;
    S.echeances = S.echeances.filter((x) => x.id !== id); sauver(); toast("Échéance supprimée"); rafraichir(); return true;
  }
  return false;
}

VUES.rentabilite = {
  titre: "Rentabilité",
  sous: "Coût complet au kilomètre : par camion, par corridor, par client",
  actions: () => btn("export-rentabilite", "Exporter (CSV)", { icone: "download", cls: "btn ghost" }),
  rendu() {
    const r = rentabilite(bornesPeriode()), t = r.totaux, a = r.avertissements;
    const segments = `<div class="segmented" role="tablist">${PERIODES.map(([k, l]) => `<button role="tab" data-act="periode" data-id="${k}" aria-selected="${k === cockpitPeriode}">${l}</button>`).join("")}</div>`;
    const maxMois = Math.max(1, ...r.mois.map((m) => Math.max(m.ca, m.variable)));
    const avert = [a.camionsSansFixe ? `${a.camionsSansFixe} camion(s) sans charges fixes : le coût complet est sous-estimé` : "", a.sansFraisGeneraux ? "frais généraux non renseignés" : "", a.carburantEstime ? `${a.carburantEstime} voyage(s) dont le carburant est estimé d'après les pleins` : "", a.sansKm ? `${a.sansKm} voyage(s) sans kilomètres` : "", a.sansPrix ? `${a.sansPrix} voyage(s) sans prix de vente` : ""].filter(Boolean);
    const retours = retoursACombler();
    return `${segments}
    ${!t.nb ? `<div class="card">${vide("gauge", "Aucune activité sur cette période", "Enregistrez vos voyages (avec leurs kilomètres, leur prix et leurs coûts) pour voir ici le coût complet au kilomètre et la marge réelle.")}</div>` : `
    <div class="kpis">
      <div class="kpi"><div class="l">${ic("receipt")} Chiffre d'affaires</div><div class="v">${fmt(t.ca)} <small>MAD</small></div><div class="s">${t.nb} voyage(s) et commande(s)</div></div>
      <div class="kpi"><div class="l">Coût complet</div><div class="v">${fmt(t.cout)} <small>MAD</small></div><div class="s">directs ${fmt(t.variable)} · entretien ${fmt(t.entretien)} · fixes ${fmt(t.fixes)}</div></div>
      <div class="kpi"><div class="l">Marge nette</div><div class="v ${couleurMarge(t.marge)}">${fmt(t.marge)} <small>MAD</small></div><div class="s ${t.marge < 0 ? "danger" : ""}">${fmt(t.taux, 1)} % du chiffre d'affaires</div></div>
      <div class="kpi"><div class="l">${ic("truck")} Coût complet au km</div><div class="v">${t.km ? fmt(t.coutKm, 2) : "—"} <small>MAD</small></div><div class="s ${t.pctVide > 30 ? "warn" : ""}">${fmt(t.km)} km · ${fmt(t.pctVide, 0)} % à vide</div></div>
    </div>
    ${t.km ? `<div class="card"><p style="margin:0"><strong>Prix de revient : ${fmt(t.coutKmCharge, 2)} MAD par kilomètre chargé</strong> (${fmt(t.coutKmCharge / S.params.tauxEUR, 2)} €). En dessous de ce prix, un voyage perd de l'argent une fois les retours à vide et les charges fixes comptés. Charges fixes et entretien : ${fmt(t.fixesJour)} MAD par jour, que les camions roulent ou non.</p>
      ${avert.length ? `<p class="hint" style="margin-bottom:0">À compléter pour un calcul juste : ${avert.map(esc).join(" · ")}.</p>` : ""}</div>` : ""}
    ${tableauRentabilite("Par camion (coût complet)", r.camions, "Camion", { fixes: true })}
    ${tableauRentabilite("Par corridor (coûts directs)", r.corridors, "Corridor")}
    ${tableauRentabilite("Par client (coûts directs)", r.clients, "Client")}
    ${r.mois.length > 1 ? `<div class="section-title">Par mois</div><div class="card">${r.mois.map((m) => `<div class="mois"><span>${new Date(m.nom + "-15").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })}</span><div class="barres"><i style="width:${(m.ca / maxMois) * 100}%" title="Chiffre d'affaires"></i><i class="c" style="width:${(m.variable / maxMois) * 100}%" title="Coûts directs"></i></div><b class="num ${couleurMarge(m.ca - m.variable)}">${fmt(m.ca - m.variable)}</b></div>`).join("")}<p class="hint">Bleu : chiffre d'affaires · gris : coûts directs · à droite : marge directe (MAD).</p></div>` : ""}`}
    <div class="section-title">Retours à combler · ${retours.length}</div>
    <div class="card">${retours.length ? retours.map((v) => `<div class="trav"><div><strong>${esc(v.ref)} · ${esc(nomVille(v.destination))} → ${esc(nomVille(v.origine))}</strong><span class="sub">retour prévu le ${dateFr(v.dateRetourPrevue)}${v.camionId ? " · " + esc(nomCamion(v.camionId)) : ""} · aucun fret de retour enregistré</span></div>
      <div class="r"><a class="btn sm" href="https://wa.me/?text=${encodeURIComponent(texteRetour(v))}" target="_blank" rel="noopener">Proposer par WhatsApp</a>${btn("copier-retour", "Copier l'annonce", { id: v.id, cls: "btn ghost sm" })}${btn("retour-trouve", "Fret trouvé", { id: v.id, cls: "btn ghost sm" })}</div></div>`).join("") : `<p class="hint" style="margin:0">Tous les voyages prévus ou en cours ont un retour chargé (ou marqué « fret trouvé »).</p>`}
      <p class="hint">L'annonce s'ouvre dans WhatsApp, prête à envoyer à vos partenaires ou à un groupe : vous choisissez les destinataires. Une fois le fret trouvé, saisissez les kilomètres de retour chargé dans le voyage.</p></div>
    ${blocStructure()}`;
  },
  async agir(act, id) {
    if (await agirStructure(act, id)) return;
    if (act === "periode") { cockpitPeriode = Number(id); return rafraichir(); }
    if (act === "retour-trouve") { const v = parId(S.voyages, id); if (v) { v.retourTrouve = true; sauver(); toast("Retour marqué comme trouvé"); rafraichir(); } return; }
    if (act === "copier-retour") { const v = parId(S.voyages, id); if (!v) return; try { await navigator.clipboard.writeText(texteRetour(v)); toast("Annonce copiée"); } catch { toast(texteRetour(v), "warn"); } return; }
    if (act === "export-rentabilite") {
      const r = rentabilite(bornesPeriode()), ligne = (type) => (x) => ({ type, nom: x.nom, activites: x.nb, km: x.km, km_a_vide: x.kmVide, chiffre_affaires_mad: x.ca, couts_directs_mad: x.variable, entretien_mad: x.entretien, charges_fixes_mad: x.fixes, cout_complet_mad: x.cout, marge_mad: x.marge, cout_par_km_mad: x.coutKm });
      exporterCSV("rentabilite", [...r.camions.map(ligne("camion")), ...r.corridors.map(ligne("corridor")), ...r.clients.map(ligne("client")), ...r.mois.map(ligne("mois"))]);
    }
  },
};

/* ---------- accueil : ce qui se prépare (prévisions) ---------- */
const rendreAccueilBase = VUES.tableau.rendu;
VUES.tableau.rendu = function () {
  const html = rendreAccueilBase.call(this), p = S.camions.length || S.chauffeurs.length ? previsions() : [];
  if (!p.length) return html;
  return `<div class="card"><div class="card-head"><h2>À prévoir</h2>${badge(String(p.length), p.some((x) => x.niveau === "warn") ? "warn" : "neutral")}</div>
    <ul class="ctl">${p.map((x) => `<li class="${x.niveau === "warn" ? "warn" : ""}">${ic(x.niveau === "warn" ? "clock" : "calendar")}<span>${esc(x.texte)} ${btn("aller", "Voir", { id: x.onglet, cls: "btn ghost sm" })}</span></li>`).join("")}</ul></div>` + html;
};
