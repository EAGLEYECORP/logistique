"use strict";
/* ============================================================
   Chaque voyage fait est relié à une facture : état de facturation sur la fiche du voyage,
   « Facturer ce voyage » (facture créée en un geste), « Ajouter à une facture » existante du même client,
   voyages à facturer en tête de la page Factures. Logique pure dans noyau.js.
   ============================================================ */

function blocFacturation(v) {
  if (v.statut === "annule") return "";
  const f = factureDuVoyage(v), fait = voyageFaitLe(v);
  if (f) { const e = etatFacture(f), t = totauxFacture(f); return `<div class="section-title fin">Facturation</div><div class="trav fin"><div><strong>Facture ${esc(f.numero)} · ${fmtDevise(t.ttc, f.devise)} TTC</strong><span class="sub">${esc(e.texte)}${v.commandeId && !v.factureId && !(f.voyageIds || []).includes(v.id) ? " · par la commande liée" : ""}</span></div><div class="r">${badge(e.code === "payee" ? "Payée" : e.code === "retard" ? "En retard" : "À encaisser", e.niveau)}${btn("voir-facture", "Voir", { id: f.id, cls: "btn ghost sm" })}</div></div>`; }
  if (!fait) return "";
  const autres = S.factures.filter((x) => x.statut !== "payee" && (!v.clientId || x.clientId === v.clientId));
  return `<div class="section-title fin">Facturation</div><div class="trav fin a-facturer"><div><strong>À facturer</strong><span class="sub">Voyage fait le ${dateFr(fait)}${v.prix ? ` · ${fmtDevise(num(v.prix), v.devise || "MAD")} HT` : " · prix non renseigné"}</span></div>
    <div class="r">${btn("facturer-voyage", "Facturer ce voyage", { id: v.id, icone: "receipt", cls: "btn sm" })}${autres.length ? btn("rattacher-facture", "Ajouter à une facture", { id: v.id, cls: "btn ghost sm" }) : ""}</div></div>`;
}
async function facturerVoyage(v) {
  if (!v.clientId) return toast("Choisissez d'abord le client du voyage (Modifier).", "warn");
  const f = await formulaire(`Facturer ${v.ref}`, [
    { name: "numero", label: "Numéro", value: prochainNumero("FAC", S.factures, "numero"), required: true },
    { name: "date", label: "Date", type: "date", value: today(), required: true },
    { name: "designation", label: "Désignation", value: designationVoyage(v), full: true, required: true },
    { name: "montant", label: `Montant HT (${v.devise || "MAD"})`, type: "number", min: 0, value: num(v.prix), required: true },
    { name: "tva", label: "TVA (%)", type: "number", min: 0, value: S.params.tvaDefaut },
  ], { valider: "Créer la facture", aide: "Transport international : le taux de TVA applicable (souvent exonéré) est à confirmer avec votre comptable." });
  if (!f) return;
  let fac; try { fac = creerFactureVoyages([v], { numero: f.numero.trim(), date: f.date, designation: f.designation.trim(), montant: num(f.montant), tva: num(f.tva) }); } catch (e) { return toast(e.message, "danger"); }
  sauver(); toast(`Facture ${fac.numero} créée · ${fmtDevise(totauxFacture(fac).ttc, fac.devise)} TTC`); rafraichir();
}
async function rattacherFacture(v) {
  const liste = S.factures.filter((x) => x.statut !== "payee" && (!v.clientId || x.clientId === v.clientId));
  if (!liste.length) return toast("Aucune facture ouverte pour ce client.", "warn");
  const f = await formulaire(`Ajouter ${v.ref} à une facture`, [
    { name: "factureId", label: "Facture", type: "select", options: liste.map((x) => [x.id, `${x.numero} · ${nomClient(x.clientId)} · ${fmtDevise(totauxFacture(x).ttc, x.devise)}`]), value: liste[0].id, full: true },
    { name: "ligne", label: "Ajouter la ligne du voyage à la facture", type: "checkbox", value: true, full: true },
  ], { valider: "Ajouter" });
  if (!f) return;
  try { rattacherVoyageFacture(v, parId(S.factures, f.factureId), { ajouterLigne: !!f.ligne }); } catch (e) { return toast(e.message, "danger"); }
  sauver(); toast("Voyage ajouté à la facture"); rafraichir();
}
const agirVoyagesAvantFacture = VUES.voyages.agir;
VUES.voyages.agir = async function (act, id, b) {
  const v = parId(S.voyages, String(id || "").split("|")[0]);
  if (act === "facturer-voyage" && v) return facturerVoyage(v);
  if (act === "rattacher-facture" && v) return rattacherFacture(v);
  if (act === "voir-facture") return afficher("factures");
  return agirVoyagesAvantFacture.call(this, act, id, b);
};
// page Factures : les voyages faits à facturer d'abord
if (VUES.factures) {
  const renduFacturesAvantVoyages = VUES.factures.rendu, agirFacturesAvantVoyages = VUES.factures.agir;
  VUES.factures.rendu = function () {
    const l = voyagesAFacturer(), html = renduFacturesAvantVoyages.call(this);
    if (!l.length) return html;
    return `<div class="card callout" id="voyages-a-facturer"><div class="card-head"><h2>Voyages faits à facturer · ${l.length}</h2></div>
      ${l.map(({ voyage: v, depuis }) => `<div class="trav"><div><strong>${esc(v.ref || "")} · ${esc(v.origine || "")} → ${esc(v.destination || "")}</strong><span class="sub">${v.clientId ? esc(nomClient(v.clientId)) : "client à choisir"} · fait il y a ${depuis} j${v.prix ? " · " + fmtDevise(num(v.prix), v.devise || "MAD") + " HT" : ""}</span></div><div class="r">${badge(depuis > 7 ? "En retard" : "À facturer", depuis > 7 ? "danger" : "warn")}${btn("facturer-voyage", "Facturer", { id: v.id, cls: "btn sm" })}</div></div>`).join("")}</div>` + html;
  };
  VUES.factures.agir = async function (act, id, b) { if (act === "facturer-voyage") { const v = parId(S.voyages, id); return v ? facturerVoyage(v) : undefined; } return agirFacturesAvantVoyages.call(this, act, id, b); };
}
