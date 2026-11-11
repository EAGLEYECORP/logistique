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
    <div class="section-title">Charges fixes</div>
    <div class="card"><form id="f-fixes"><div class="form-grid">
      ${S.camions.map((c) => `<label class="f">${esc(c.immat)} — charges fixes par mois (MAD)<input type="number" min="0" step="any" inputmode="decimal" name="fixe_${c.id}" value="${esc(c.fixeMensuel ?? "")}" placeholder="crédit ou amortissement, assurance, taxes, salaire"></label>`).join("")}
      <label class="f">Frais généraux par mois (MAD)<input type="number" min="0" step="any" inputmode="decimal" name="generaux" value="${esc(S.params.fraisGenerauxMois ?? "")}" placeholder="bureau, administration, comptable"></label></div>
      <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn">Enregistrer</button></div></form>
      <p class="hint">Par camion : mensualité de crédit ou amortissement, assurance, taxes, salaire fixe du chauffeur. Les frais généraux sont répartis à parts égales entre les camions. Une commande reliée à un voyage (champ « Commande liée » du voyage) n'est comptée qu'une fois. Corridors et clients sont présentés en coûts directs : les charges fixes sont portées par les camions.</p></div>`;
  },
  soumettre(fid, v) {
    if (fid !== "f-fixes") return false;
    for (const c of S.camions) { const x = v[`fixe_${c.id}`]; if (x === "") delete c.fixeMensuel; else c.fixeMensuel = num(x); }
    if (v.generaux === "") delete S.params.fraisGenerauxMois; else S.params.fraisGenerauxMois = num(v.generaux);
    sauver(); toast("Charges fixes enregistrées"); rafraichir(); return true;
  },
  async agir(act, id) {
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
