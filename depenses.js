"use strict";
/* ============================================================
   Capture automatique des dépenses (interface) : relevé de carte carburant, dépenses à rattacher,
   rappels de facture aux étapes, amendes, lignes calculées tenues à jour à chaque enregistrement.
   Logique pure dans capture.js.
   ============================================================ */

/* ---------- à chaque enregistrement : dépenses calculées et dépenses en attente ---------- */
let majDepensesEnCours = false;
function majDepenses() {
  if (majDepensesEnCours) return [];
  majDepensesEnCours = true;
  try { const touches = [...new Set([...retenterAttente(), ...majCoutsCalculesTous()])]; touches.forEach(recalculerMargeVoyage); return touches; } finally { majDepensesEnCours = false; }
}
if (typeof sauver === "function") { const sauverSansDepenses = sauver; sauver = function () { try { majDepenses(); } catch (e) { console.warn("Dépenses calculées :", e); } return sauverSansDepenses.apply(this, arguments); }; }

/* ---------- relevé de carte carburant ---------- */
function importerCarteCarburant() {
  const input = document.createElement("input"); input.type = "file"; input.accept = ".csv,.txt,text/csv,text/plain";
  input.onchange = async () => {
    const f = input.files?.[0]; if (!f) return;
    const lu = carteCarburantParse(await f.text());
    if (!lu.ok) return toast(lu.erreur || "Relevé illisible.", "danger");
    const b = rattacherCarburant(lu.lignes);
    b.voyages.forEach(recalculerMargeVoyage); sauver();
    toast(`${b.rattachees} plein(s) rattaché(s) à ${b.voyages.length} voyage(s)${b.attente ? ` · ${b.attente} à rattacher à la main` : ""}${b.doublons ? ` · ${b.doublons} déjà importé(s)` : ""}${lu.rejetes ? ` · ${lu.rejetes} ligne(s) illisible(s)` : ""}`, b.attente ? "warn" : "ok");
    rafraichir();
  };
  input.click();
}
const optsVoyages = (camionId) => [...S.voyages].filter((v) => v.statut !== "annule").sort((a, b) => Number(b.camionId === camionId) - Number(a.camionId === camionId) || (b.dateDepart || "").localeCompare(a.dateDepart || "")).slice(0, 60)
  .map((v) => [v.id, `${v.ref} · ${nomVille(v.origine)} → ${nomVille(v.destination)} · ${dateFr(v.dateDepart)}${v.camionId ? " · " + nomCamion(v.camionId) : ""}`]);

function blocAttente() {
  const l = S.depensesAttente || []; if (!l.length) return "";
  return `<div class="card fin" id="bloc-attente"><div class="card-head"><h2>Dépenses à rattacher</h2>${badge(String(l.length), "warn")}</div>
    ${l.map((a) => `<div class="trav"><div><strong>${esc(libTypeCout(a.type))} · ${fmt(a.montant, 2)} ${esc(a.devise)}</strong><span class="sub">${[dateFr(a.date), a.vehicule || (a.camionId && nomCamion(a.camionId)) || (a.chauffeurId && nomChauffeur(a.chauffeurId)), a.libelle, a.ref].filter(Boolean).map(esc).join(" · ")} — ${esc(a.raison || "")}</span></div>
      <div class="r">${btn("attente-affecter", "Rattacher", { id: a.id, cls: "btn sm" })}${iconBtn("attente-supprimer", "trash", "Écarter cette dépense", a.id, true)}</div></div>`).join("")}
    <p class="hint">Ces dépenses n'ont pas trouvé leur voyage. Elles se rattachent seules dès que le voyage ou le camion correspondant existe.</p></div>`;
}

/* ---------- rappels de facture sur la fiche du voyage ---------- */
function blocInvites(v) {
  const i = invitesCout(v); if (!i.length) return "";
  return `<ul class="ctl invites">${i.map((x) => `<li class="warn">${ic("receipt")}<span>${esc(x.texte)} à saisir ${btn("invite-saisir", "Saisir", { id: `${v.id}|${x.cle}`, cls: "btn sm" })}${btn("invite-ignorer", "Plus tard", { id: `${v.id}|${x.cle}`, cls: "btn ghost sm" })}</span></li>`).join("")}</ul>`;
}
async function saisirInvite(v, cle) {
  const x = invitesCout(v).find((i) => i.cle === cle); if (!x) return;
  const f = await formulaire(`${x.texte} — ${v.ref}`, [
    { name: "montant", label: `Montant (${x.devise})`, type: "number", min: 0, value: x.defaut, required: true },
    { name: "devise", label: "Devise", type: "select", options: [["MAD", "MAD"], ["EUR", "EUR"]], value: x.devise },
    { name: "ref", label: "Référence (facture, réservation)", value: x.ref || "", full: true },
    ...(x.type === "douane_frais" ? [{ name: "forfait", label: "Proposer ce montant pour les prochains voyages (forfait du transitaire)", type: "checkbox", value: !!S.params.fraisTransitaire, full: true }] : []),
  ], { valider: "Enregistrer", aide: x.type === "traversee" ? "Le montant de la facture remplace l'estimation de cette traversée." : "" });
  if (!f) return;
  try { ajouterLigneCout(v, { type: x.type, montant: f.montant, devise: f.devise, source: x.source, ref: f.ref, sens: x.sens, cle: x.type === "douane_frais" ? x.cle : undefined, libelle: x.texte }); } catch (e) { return toast(e.message, "danger"); }
  if (x.type === "douane_frais") { if (f.forfait && f.devise === "MAD") S.params.fraisTransitaire = num(f.montant); else if (!f.forfait) delete S.params.fraisTransitaire; }
  voyagesOuverts.add(v.id); recalculerMargeVoyage(v.id); sauver(); toast("Dépense enregistrée"); rafraichir();
}

/* ---------- page Voyages : bouton d'import, dépenses en attente, actions ---------- */
const actionsVoyagesAvantDepenses = VUES.voyages.actions, renduVoyagesAvantDepenses = VUES.voyages.rendu, agirVoyagesAvantDepenses = VUES.voyages.agir;
VUES.voyages.actions = function () { return `${btn("carte-carburant", "Carte carburant", { icone: "upload", cls: "btn ghost fin", titre: "Importer le relevé CSV de votre carte carburant : chaque plein est rattaché au voyage du camion à cette date" })}${actionsVoyagesAvantDepenses.call(this)}`; };
VUES.voyages.rendu = function () { return blocAttente() + renduVoyagesAvantDepenses.call(this); };
VUES.voyages.agir = async function (act, id, btnEl) {
  if (act === "carte-carburant") return importerCarteCarburant();
  if (act === "attente-affecter") {
    const a = (S.depensesAttente || []).find((x) => x.id === id); if (!a) return;
    const opts = optsVoyages(a.camionId); if (!opts.length) return toast("Créez d'abord le voyage correspondant.", "warn");
    const f = await formulaire("Rattacher la dépense", [
      { name: "voyageId", label: "Voyage", type: "select", options: opts, value: opts[0][0], full: true },
      { name: "montant", label: "Montant", type: "number", min: 0, value: a.montant, required: true },
      { name: "devise", label: "Devise", type: "select", options: [["MAD", "MAD"], ["EUR", "EUR"]], value: ["MAD", "EUR"].includes(a.devise) ? a.devise : "EUR" },
    ], { valider: "Rattacher", aide: ["MAD", "EUR"].includes(a.devise) ? "" : `Montant d'origine : ${fmt(a.montant, 2)} ${esc(a.devise)}. Saisissez sa contre-valeur en euros ou en dirhams.` });
    if (!f) return;
    try { affecterAttente(a.id, f.voyageId, { montant: num(f.montant), devise: f.devise }); } catch (e) { return toast(e.message, "danger"); }
    recalculerMargeVoyage(f.voyageId); sauver(); toast("Dépense rattachée"); rafraichir(); return;
  }
  if (act === "attente-supprimer") {
    if (!(await confirmer("Écarter cette dépense ?", "Elle ne sera comptée dans aucun voyage."))) return;
    S.depensesAttente = (S.depensesAttente || []).filter((x) => x.id !== id); sauver(); rafraichir(); return;
  }
  if (act === "invite-saisir" || act === "invite-ignorer") {
    const [vid, cle] = String(id).split("|"), v = parId(S.voyages, vid); if (!v) return;
    if (act === "invite-saisir") return saisirInvite(v, cle);
    (v.invitesIgnorees ||= []).push(cle); voyagesOuverts.add(v.id); sauver(); rafraichir(); return;
  }
  const avant = act === "jalon" ? (parId(S.voyages, String(id).split("|")[0])?.jalons || []).length : 0;
  const r = await agirVoyagesAvantDepenses.call(this, act, id, btnEl);
  if (act === "jalon") { // l'étape qui vient d'être marquée appelle peut-être une dépense : on la demande tout de suite
    const v = parId(S.voyages, String(id).split("|")[0]), der = v && (v.jalons || []).length > avant ? v.jalons[v.jalons.length - 1].type : "";
    if (der && invitesCout(v).some((i) => i.cle === `jalon:${der}`)) await saisirInvite(v, `jalon:${der}`);
  }
  return r;
};

/* ---------- amende (page Tachygraphe) ---------- */
async function saisirAmende() {
  if (!S.chauffeurs.length) return toast("Ajoutez d'abord vos chauffeurs.", "warn");
  const f = await formulaire("Enregistrer une amende", [
    { name: "chauffeurId", label: "Chauffeur", type: "select", options: S.chauffeurs.map((c) => [c.id, c.nom]), value: S.chauffeurs[0].id, full: true },
    { name: "date", label: "Date de l'infraction", type: "date", value: today(), required: true },
    { name: "montant", label: "Montant", type: "number", min: 0, required: true },
    { name: "devise", label: "Devise", type: "select", options: [["EUR", "EUR"], ["MAD", "MAD"]], value: "EUR" },
    { name: "motif", label: "Motif", placeholder: "Repos journalier insuffisant, surcharge…", full: true },
    { name: "ref", label: "Numéro du procès-verbal", full: true },
  ], { valider: "Enregistrer", aide: "L'amende est comptée dans le voyage que ce chauffeur faisait à cette date." });
  if (!f) return;
  let r; try { r = enregistrerAmende({ ...f, camionId: parId(S.chauffeurs, f.chauffeurId)?.camionId || "" }); } catch (e) { return toast(e.message, "danger"); }
  if (r.voyage) recalculerMargeVoyage(r.voyage.id);
  sauver(); toast(r.voyage ? `Amende comptée dans le voyage ${r.voyage.ref}` : "Aucun voyage à cette date : amende mise en attente (page Voyages)", r.voyage ? "ok" : "warn"); rafraichir();
}
if (VUES.tachy) {
  const actionsTachyAvant = VUES.tachy.actions, agirTachyAvant = VUES.tachy.agir;
  VUES.tachy.actions = function () { return `${actionsTachyAvant ? actionsTachyAvant.call(this) : ""}${btn("amende", "Enregistrer une amende", { icone: "alert", cls: "btn ghost fin" })}`; };
  VUES.tachy.agir = function (act, id, b) { if (act === "amende") return saisirAmende(); return agirTachyAvant?.call(this, act, id, b); };
}

/* ---------- à chaque changement de page : les dépenses calculées sont à jour avant l'affichage ---------- */
if (typeof afficher === "function") { const afficherSansDepenses = afficher; afficher = function () { try { majDepenses(); if (typeof majReferences === "function" && S.camions.length && majReferences()) setTimeout(sauver, 0); } catch (e) { console.warn("Dépenses calculées :", e); } return afficherSansDepenses.apply(this, arguments); }; }
