"use strict";
/* ============================================================
   Direction : compte de résultat en direct, tableau croisé, tendance sur 12 mois, trésorerie à 90 jours.
   Logique pure dans tresorerie.js (et investissement.js, anomalies.js).
   ============================================================ */

let dirPeriode = "mois", dirDims = ["client"], dirDetail = "", dirJour = "";
const PERIODES_DIR = [["mois", "Ce mois"], ["mois-1", "Mois dernier"], ["90", "90 jours"], ["365", "12 mois"], ["annee", "Cette année"]];
function bornesDirection() {
  const t = today(), m0 = t.slice(0, 7) + "-01";
  if (dirPeriode === "mois") return [m0, ajouterJours(ajouterMois(m0, 1), -1)];
  if (dirPeriode === "mois-1") return [ajouterMois(m0, -1), ajouterJours(m0, -1)];
  if (dirPeriode === "annee") return [t.slice(0, 4) + "-01-01", t];
  return [ajouterJours(t, -Number(dirPeriode)), t];
}
const deuxDevises = (mad, cls = "") => `<div class="v ${cls}">${fmt(mad)} <small>MAD</small></div><div class="s">${fmt(enEUR(mad))} €</div>`;
const moisCourt = (m) => new Date(m + "-15").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });

/** Tendance sur 12 mois : barres de chiffre d'affaires, courbe de marge nette. */
function graphTendance(t) {
  const W = 720, H = 180, g = 28, b = 22, max = Math.max(1, ...t.map((x) => x.revenue), ...t.map((x) => x.marge_nette)), min = Math.min(0, ...t.map((x) => x.marge_nette));
  const y = (v) => 8 + (H - b - 8) * (1 - (v - min) / (max - min || 1)), pas = (W - g) / t.length, x = (i) => g + i * pas + pas / 2;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Chiffre d'affaires et marge nette sur 12 mois">
    <line x1="${g}" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="axe"/>
    ${t.map((m, i) => `<g><title>${moisCourt(m.mois)} — chiffre d'affaires ${fmt(m.revenue)} MAD · marge nette ${fmt(m.marge_nette)} MAD</title><rect x="${x(i) - pas * 0.3}" y="${y(m.revenue)}" width="${pas * 0.6}" height="${Math.max(0, y(0) - y(m.revenue))}" rx="3" class="barre"/><text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="lib">${moisCourt(m.mois).split(" ")[0]}</text></g>`).join("")}
    <polyline points="${t.map((m, i) => `${x(i)},${y(m.marge_nette)}`).join(" ")}" class="courbe"/>
    ${t.map((m, i) => `<circle cx="${x(i)}" cy="${y(m.marge_nette)}" r="3" class="pt ${m.marge_nette < 0 ? "neg" : ""}"/>`).join("")}
  </svg><div class="legende"><span><i class="l-barre"></i>Chiffre d'affaires</span><span><i class="l-courbe"></i>Marge nette (toutes charges)</span></div></div>`;
}
/** Trésorerie à 90 jours : courbe du solde, zone rouge sous zéro, un jour = une zone cliquable. */
function graphTresorerie(p) {
  const W = 720, H = 190, b = 22, j = p.jours, max = Math.max(1, ...j.map((x) => x.solde), p.solde_initial), min = Math.min(0, ...j.map((x) => x.solde));
  const y = (v) => 8 + (H - b - 8) * (1 - (v - min) / (max - min || 1)), pas = W / j.length, x = (i) => i * pas + pas / 2, y0 = y(0);
  const pts = j.map((d, i) => `${x(i).toFixed(1)},${y(d.solde).toFixed(1)}`).join(" ");
  return `<div class="chart treso"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Solde de trésorerie prévu sur ${j.length} jours">
    ${min < 0 ? `<rect x="0" y="${y0}" width="${W}" height="${H - b - y0}" class="zone-neg"/>` : ""}
    <line x1="0" x2="${W}" y1="${y0}" y2="${y0}" class="axe"/>
    <polyline points="${pts}" class="courbe ${p.negatif ? "neg" : ""}"/>
    ${j.map((d, i) => (d.items.length ? `<circle cx="${x(i).toFixed(1)}" cy="${y(d.solde).toFixed(1)}" r="${d.date === dirJour ? 5 : 2.6}" class="pt ${d.solde < 0 ? "neg" : ""}"/>` : "")).join("")}
    ${j.map((d, i) => (i % 15 === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="${i ? "middle" : "start"}" class="lib">${dateFr(d.date).slice(0, 5)}</text>` : "")).join("")}
    ${j.map((d, i) => `<rect x="${(i * pas).toFixed(1)}" y="0" width="${pas.toFixed(1)}" height="${H - b}" class="jour" data-act="jour" data-id="${d.date}"><title>${dateFr(d.date)} — solde ${fmt(d.solde)} MAD${d.items.length ? ` · ${d.items.length} mouvement(s)` : ""}</title></rect>`).join("")}
  </svg></div>`;
}
const ligneMouvement = (i) => `<div class="trav"><div><strong>${esc(i.libelle)}</strong><span class="sub">${esc({ facture: "Facture à encaisser", recette_prevue: "Recette prévue", depense_prevue: "Dépense attendue" }[i.type] || libDe(TYPES_ECHEANCE, i.type))}</span></div><div class="r"><strong class="num ${i.montant < 0 ? "neg" : "pos"}">${i.montant > 0 ? "+" : ""}${fmt(i.montant)} MAD</strong></div></div>`;

function blocTresorerie() {
  const p = previsionsTresorerie(90), jour = p.jours.find((d) => d.date === dirJour), prochains = p.jours.filter((d) => d.items.length).slice(0, 6);
  return `<div class="section-title">Trésorerie à 90 jours</div>
  <div class="card" id="bloc-treso">
    <div class="kpis compact">
      <div class="kpi"><div class="l">Solde aujourd'hui</div>${deuxDevises(p.solde_initial)}<div class="s">${btn("solde", p.solde_renseigne ? "Mettre à jour" : "Saisir le solde en banque", { cls: "btn ghost sm" })}</div></div>
      <div class="kpi"><div class="l">Point le plus bas</div>${deuxDevises(p.min.solde, p.min.solde < 0 ? "neg" : "")}<div class="s">le ${dateFr(p.min.date)}</div></div>
      <div class="kpi"><div class="l">Dans 90 jours</div>${deuxDevises(p.solde_final, p.solde_final < 0 ? "neg" : "")}<div class="s">+${fmt(p.total_entrees)} · −${fmt(p.total_sorties)}</div></div>
    </div>
    ${p.negatif ? `<p class="alerte-treso">${ic("alert")} La trésorerie passe sous zéro le <strong>${dateFr(p.negatif)}</strong> : relancez les factures en retard ou décalez une échéance avant cette date.</p>` : ""}
    ${graphTresorerie(p)}
    <div id="treso-jour">${jour ? `<div class="section-title">${dateFr(jour.date)} · solde ${fmt(jour.solde)} MAD</div>${jour.items.map(ligneMouvement).join("") || `<p class="hint">Aucun mouvement ce jour-là.</p>`}` : `<div class="section-title">Prochains mouvements</div>${prochains.map((d) => d.items.map((i) => ligneMouvement({ ...i, libelle: `${dateFr(d.date).slice(0, 5)} · ${i.libelle}` })).join("")).join("") || `<p class="hint">Aucun mouvement prévu : émettez vos factures et renseignez vos échéances (page Rentabilité).</p>`}`}</div>
    <p class="hint">Touchez un jour de la courbe pour voir ce qui tombe ce jour-là. Comptés : factures non payées à leur échéance, échéances (salaires, crédit, TVA…), dépenses encore estimées et recette des voyages en cours. ${p.solde_renseigne ? "" : "Sans solde de départ, la courbe part de zéro."}</p>
  </div>`;
}

function blocCube(p) {
  const lignes = pivotPnl(p.lignes, dirDims), detail = lignes.find((x) => x.cle === dirDetail);
  const chips = `<div class="segmented multi" role="group" aria-label="Regrouper par">${DIMENSIONS_PNL.map(([k, l]) => `<button type="button" data-act="dim" data-id="${k}" aria-pressed="${dirDims.includes(k)}" aria-selected="${dirDims.includes(k)}">${l}</button>`).join("")}</div>`;
  return `<div class="section-title">Où se fait la marge</div>
  <div class="card" id="bloc-cube">${chips}
    ${lignes.length ? `<div class="table-wrap"><table><thead><tr><th>${dirDims.map((d) => libDe(DIMENSIONS_PNL, d)).join(" × ")}</th><th class="r">Activités</th><th class="r">Chiffre d'affaires</th><th class="r">Marge directe</th><th class="r">Marge nette</th></tr></thead><tbody>
      ${lignes.map((x) => `<tr class="cliquable ${x.cle === dirDetail ? "actif" : ""}" data-act="detail" data-id="${esc(x.cle)}"><td><strong>${esc(dirDims.length === 1 && dirDims[0] === "mois" ? moisCourt(x.cle) : x.nom)}</strong></td><td class="r num">${x.nb}</td><td class="r num">${fmt(x.revenue)}<span class="sub">${fmt(enEUR(x.revenue))} €</span></td>
        <td class="r num ${x.marge_directe < 0 ? "neg" : ""}">${fmt(x.marge_directe)}</td><td class="r num ${x.marge_nette < 0 ? "neg" : ""}"><strong>${fmt(x.marge_nette)}</strong><span class="sub">${x.revenue ? fmt(x.pct_marge, 1) + " %" : "—"}</span></td></tr>
        ${x.cle === dirDetail ? `<tr class="detail"><td colspan="5">${detail.ids.map((id) => { const l = p.lignes.find((a) => a.id === id), mn = l.revenue - l.direct - l.structure; return `<div class="trav"><div><strong>${esc(l.ref || (l.genre === "voyage" ? "Voyage" : "Commande"))} · ${esc(l.corridor)}</strong><span class="sub">${dateFr(l.date)} · ${esc(l.clientNom)} · ${esc(l.camionNom)}${l.genre === "commande" ? " · commande" : ""}</span></div><div class="r"><span class="num ${mn < 0 ? "neg" : ""}">${fmt(l.revenue)} → <strong>${fmt(mn)} MAD</strong></span>${btn("ouvrir", "Ouvrir", { id: `${l.genre}|${l.id}`, cls: "btn ghost sm" })}</div></div>`; }).join("")}</td></tr>` : ""}`).join("")}
    </tbody></table></div><p class="hint">Montants en MAD. Marge nette = marge directe moins la part de charges fixes et générales portée par chaque voyage. Touchez une ligne pour voir ses voyages ; combinez plusieurs regroupements pour croiser.</p>` : `<p class="hint">Aucune activité sur cette période.</p>`}
  </div>`;
}
function blocCouts(p) {
  const directs = Object.entries(p.couts_directs_par_type).map(([k, m]) => [k === "commandes" ? "Commandes (trajet, ferry, frais)" : libTypeCout(k), m]);
  const fixes = Object.entries({ leasing: "Crédit, leasing", assurance: "Assurance", taxe: "Taxe à l'essieu", amortissement: "Amortissement", global: "Charges fixes (montant global)", entretien: "Entretien réel" }).map(([k, l]) => [l, p.couts_fixes_alloues_par_categorie[k]]);
  const gen = Object.entries(p.charges_generales_allouees_par_categorie).map(([k, m]) => [libDe(CATEGORIES_CHARGE, k), m]);
  const tous = [...directs.map((x) => [...x, "direct"]), ...fixes.map((x) => [...x, "fixe"]), ...gen.map((x) => [...x, "general"])].filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]), max = Math.max(1, ...tous.map((x) => x[1]));
  if (!tous.length) return "";
  return `<div class="section-title">Où part l'argent · ${fmt(p.couts_directs + p.structure)} MAD</div>
  <div class="card" id="bloc-couts">${tous.map(([l, m, t]) => `<div class="poste"><span>${esc(l)}</span><div class="jauge"><i class="${t}" style="width:${(m / max) * 100}%"></i></div><strong class="num">${fmt(m)}</strong></div>`).join("")}
    <div class="legende"><span><i class="l-direct"></i>Coûts directs des voyages</span><span><i class="l-fixe"></i>Charges fixes des camions</span><span><i class="l-general"></i>Charges générales</span></div>
    ${p.non_alloue > 1 ? `<p class="hint">${fmt(p.non_alloue)} MAD de charges de structure ne sont portés par aucun voyage sur la période (camions à l'arrêt, jours sans voyage).</p>` : ""}</div>`;
}

VUES.direction = {
  titre: "Direction",
  sous: "Résultat de l'entreprise en direct, trésorerie à 90 jours",
  actions: () => btn("simuler", "Simuler un achat de camion", { icone: "truck", cls: "btn ghost" }),
  rendu() {
    const [d0, d1] = bornesDirection(), p = pnlPeriode(d0, d1);
    const segments = `<div class="segmented" role="tablist">${PERIODES_DIR.map(([k, l]) => `<button role="tab" data-act="periode" data-id="${k}" aria-selected="${k === dirPeriode}">${l}</button>`).join("")}</div>`;
    return `${segments}
    <div class="kpis" id="dir-kpis">
      <div class="kpi"><div class="l">${ic("receipt")} Chiffre d'affaires</div>${deuxDevises(p.revenue)}<div class="s">${p.nb} voyage(s) et commande(s) · du ${dateFr(p.debut).slice(0, 5)} au ${dateFr(p.fin).slice(0, 5)}</div></div>
      <div class="kpi"><div class="l">Marge directe</div>${deuxDevises(p.marge_brute, p.marge_brute < 0 ? "neg" : "")}<div class="s">${p.revenue ? fmt((p.marge_brute / p.revenue) * 100, 1) + " % du chiffre d'affaires" : "—"}</div></div>
      <div class="kpi"><div class="l">Charges de structure</div>${deuxDevises(p.structure)}<div class="s">${fmt(p.structure / p.mois)} MAD par mois, voyages ou non</div></div>
      <div class="kpi"><div class="l">Marge nette</div>${deuxDevises(p.marge_nette, p.marge_nette < 0 ? "neg" : "pos")}<div class="s ${p.marge_nette < 0 ? "danger" : ""}">${p.revenue ? fmt(p.pct_marge, 1) + " %" : "aucune recette sur la période"}${d1 > today() ? " · charges du mois entier déjà comptées" : ""}</div></div>
    </div>
    ${typeof blocAnomalies === "function" ? blocAnomalies() : ""}
    ${blocTresorerie()}
    <div class="section-title">Tendance sur 12 mois</div><div class="card">${graphTendance(tendancePnl(12))}</div>
    ${blocCube(p)}${blocCouts(p)}`;
  },
  async agir(act, id) {
    if (act === "periode") { dirPeriode = id; dirDetail = ""; return rafraichir(); }
    if (act === "dim") { dirDims = dirDims.includes(id) ? dirDims.filter((d) => d !== id) : [...dirDims, id]; if (!dirDims.length) dirDims = [id]; dirDims = DIMENSIONS_PNL.map(([k]) => k).filter((k) => dirDims.includes(k)); dirDetail = ""; return rafraichir(); }
    if (act === "detail") { dirDetail = dirDetail === id ? "" : id; return rafraichir(); }
    if (act === "jour") { dirJour = dirJour === id ? "" : id; return rafraichir(); }
    if (act === "ouvrir") { const [genre, oid] = id.split("|"); if (genre === "voyage") { voyagesOuverts.add(oid); afficher("voyages"); setTimeout(() => document.querySelector(`[data-voyage="${oid}"]`)?.scrollIntoView({ block: "start" }), 60); } else afficher("commandes"); return; }
    if (act === "solde") {
      const f = await formulaire("Solde en banque aujourd'hui", [{ name: "solde", label: "Solde (MAD) — tous comptes confondus", type: "number", value: S.entreprise?.tresorerie?.solde ?? "", required: true, full: true }], { valider: "Enregistrer", aide: "La prévision part de ce solde. Mettez-le à jour quand vous consultez votre banque." });
      if (!f) return;
      (S.entreprise ||= {}).tresorerie = { solde: num(f.solde), date: today() }; sauver(); toast("Solde enregistré"); return rafraichir();
    }
    if (act === "simuler" && typeof ouvrirSimulateur === "function") return ouvrirSimulateur();
  },
};
