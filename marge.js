"use strict";
/* ============================================================
   Marge du voyage en direct (interface) : pastille et courbe à côté du titre, lignes de coût, marge nette.
   Logique pure dans rentabilite.js et noyau.js.
   ============================================================ */

/** Pastille de marge à côté du titre du voyage : verte si positive, rouge sinon, avec la courbe d'évolution. */
function pastilleMarge(v) {
  const m = margeVoyage(v); if (!m || !m.revenu) return "";
  const h = historiqueMarge(v).map((p) => p.marge), c = courbeMini(h, 56, 18), neg = m.marge_directe < 0;
  return `<span class="marge-pastille fin ${neg ? "neg" : "pos"}" data-marge="${v.id}" title="Marge directe : prix de vente moins les coûts enregistrés ou estimés">
    <svg viewBox="0 0 56 18" width="56" height="18" aria-hidden="true"><line x1="0" x2="56" y1="${c.zero}" y2="${c.zero}" class="zero"/><polyline points="${c.points}"/></svg>
    <strong>${m.marge_directe > 0 ? "+" : ""}${fmt(m.marge_directe)} MAD</strong></span>`;
}
/** Lignes du tableau « Coût et marge » : charges de structure et marge nette. */
function lignesMargeNette(v) {
  const m = margeVoyage(v); if (!m || !m.revenu || !(m.total_structure > 0)) return "";
  const fixes = m.couts_fixes_alloues.reduce((s, x) => s + x.montant, 0), gen = m.charges_generales_allouees.reduce((s, x) => s + x.montant, 0);
  return `${fixes ? `<tr><td>Charges fixes du camion<span class="sub">${m.jours} jour(s) × ${fmt(m.couts_fixes_alloues[0].mensuel)} MAD par mois</span></td><td class="r num">${fmt(fixes)} MAD</td></tr>` : ""}
    ${gen ? `<tr><td>Charges générales<span class="sub">${m.charges_generales_allouees.map((g) => `${esc(g.libelle)} ${fmt(g.montant)} (${esc(libDe(CLES_ALLOCATION, g.cle).toLowerCase())})`).join(" · ")}</span></td><td class="r num">${fmt(gen)} MAD</td></tr>` : ""}
    <tr><td><strong>Marge nette</strong><span class="sub">toutes charges comprises${m.km_charge > 0 ? ` · prix de revient ${fmt(m.cout_par_km_charge, 2)} MAD par km chargé` : ""}</span></td><td class="r num ${m.marge_nette < 0 ? "neg" : ""}"><strong>${fmt(m.marge_nette)} MAD · ${fmt(m.taux, 1)} %</strong></td></tr>`;
}
/** Lignes de coût enregistrées sur le voyage, avec leur source, et le bouton d'ajout. */
function blocLignesCout(v) {
  const l = [...(v.lignesCout || [])].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return `<div class="section-title">Dépenses enregistrées · ${l.length}</div>
    ${blocInvites(v)}<div class="lignes-cout" data-lignes="${v.id}">${l.map((x) => `<div class="trav"><div><strong>${esc(libTypeCout(x.type))}${x.sens ? ` (${esc(x.sens)})` : ""}</strong><span class="sub">${[x.date && dateFr(x.date), libSourceCout(x.source), x.ref, x.libelle].filter(Boolean).map(esc).join(" · ")}</span></div>
      <div class="r"><strong class="num">${fmt(x.montant, x.devise === "EUR" ? 2 : 0)} ${esc(x.devise)}</strong>${iconBtn("ligne-supprimer", "trash", "Supprimer cette dépense", `${v.id}|${x.id}`, true)}</div></div>`).join("")}
      <div class="row">${btn("ligne-ajouter", "Ajouter une dépense", { id: v.id, icone: "plus", cls: "btn sm" })}</div>
      <p class="hint">Une dépense enregistrée remplace l'estimation du même type (carburant, péages, traversée…) : la marge suit ce qui est réellement payé.</p></div>`;
}
const TYPES_SAISIE = TYPES_COUT.filter((t) => t[2]).map(([k, l]) => [k, l]);
const champsLigneCout = (v) => [
  { name: "type", label: "Type de dépense", type: "select", options: TYPES_SAISIE, value: "carburant", full: true },
  { name: "montant", label: "Montant", type: "number", min: 0, required: true },
  { name: "devise", label: "Devise", type: "select", options: [["MAD", "MAD"], ["EUR", "EUR"]], value: "MAD" },
  { name: "date", label: "Date", type: "date", value: today() >= (v.dateDepart || "") && today() <= (finVoyage(v) || "9999") ? today() : v.dateDepart || today() },
  { name: "sens", label: "Traversée concernée", type: "select", options: [["", "—"], ["aller", "Aller"], ["retour", "Retour"]], value: "" },
  { name: "ref", label: "Référence (facture, reçu)", full: true },
];

const agirVoyagesAvantMarge = VUES.voyages.agir;
VUES.voyages.agir = async function (act, id, btnEl) {
  if (act === "ligne-ajouter") {
    const v = parId(S.voyages, id); if (!v) return;
    const f = await formulaire(`Dépense — ${v.ref}`, champsLigneCout(v), { valider: "Ajouter", aide: "La traversée concernée ne sert que pour une facture de traversée : elle remplace alors l'estimation de ce sens." });
    if (!f) return;
    try { ajouterLigneCout(v, { type: f.type, montant: f.montant, devise: f.devise, date: f.date, ref: f.ref, sens: f.type === "traversee" ? f.sens : "", source: f.type === "traversee" ? "facture_armateur" : "saisie" }); } catch (e) { return toast(e.message, "danger"); }
    voyagesOuverts.add(v.id); recalculerMargeVoyage(v.id); sauver(); toast("Dépense ajoutée"); rafraichir(); return;
  }
  if (act === "ligne-supprimer") {
    const [vid, lid] = id.split("|"), v = parId(S.voyages, vid); if (!v) return;
    if (!(await confirmer("Supprimer cette dépense ?", "L'estimation du même type, s'il y en a une, sera de nouveau utilisée."))) return;
    retirerLigneCout(v, lid); recalculerMargeVoyage(v.id); sauver(); toast("Dépense supprimée"); rafraichir(); return;
  }
  return agirVoyagesAvantMarge.call(this, act, id, btnEl);
};
// Toute entrée de coût venue d'ailleurs (import, GPS, calcul) met à jour la pastille sans recharger la page.
surMargeVoyage(({ voyageId }) => { const v = parId(S.voyages, voyageId); for (const el of document.querySelectorAll(`[data-marge="${voyageId}"]`)) if (v) el.outerHTML = pastilleMarge(v); });
