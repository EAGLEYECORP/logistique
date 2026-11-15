"use strict";
/* ============================================================
   Un seul dossier par voyage (interface) :
   · Commandes : « Planifier » crée le voyage pré-rempli ; « En retour » charge la commande au retour d'un voyage ; une commande liée suit son voyage ;
   · fiche du voyage : bloc « Chargement de retour » (commande, client, prix, CMR, état, facture), nouvelle commande de retour pré-remplie,
     liaison d'une commande existante, facture du retour à son propre client ;
   · à chaque enregistrement, les commandes suivent les étapes et l'équipe de leur voyage.
   Logique pure dans aller_retour.js.
   ============================================================ */

/* ---------- les commandes suivent leur voyage à chaque enregistrement ---------- */
if (typeof sauver === "function") { const avantAllerRetour = sauver; sauver = function () { try { synchroToutesCommandes(); } catch (e) { console.warn("Commandes des voyages :", e); } return avantAllerRetour.apply(this, arguments); }; }

/* ---------- commande → voyage ---------- */
async function planifierCommande(c) {
  if (voyageDeCommande(c)) return toast("Cette commande a déjà son voyage.", "warn");
  const base = voyageDepuisCommande(c);
  const f = await formulaire(`Planifier ${c.ref} — ${nomClient(c.clientId)}`, champsVoyage(base), { valider: "Créer le voyage", aide: "Client, villes, dates, prix, équipe et CMR sont repris de la commande. Les traversées aller et retour sont créées : complétez-les ensuite. La commande suivra les étapes du voyage." });
  if (!f) return;
  const n = { id: uid(), ...base, ...lireVoyage(f), commandeId: c.id, ...(base.cmr ? { cmr: base.cmr } : {}), ...(base.refClient ? { refClient: base.refClient } : {}), jalons: [], coches: {}, traversees: [nouvelleTraversee("aller", "tmed-alg"), nouvelleTraversee("retour", "alg-tmed")] };
  S.voyages.unshift(n); synchroCommandesVoyage(n); sauver(); toast(`Voyage ${n.ref} créé pour ${c.ref}`);
  const k = conflitsAffectation(n); if (k.length) toast(k[0].texte, "warn");
  ouvrirVoyage(n.id);
}
/** Voyages qui peuvent prendre une commande en retour : prévus ou en cours, sans retour ; ceux qui livrent près du chargement d'abord. */
function voyagesPourRetour(c) {
  const proche = (a, b) => !!a && !!b && (a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase()));
  return S.voyages.filter((v) => ["prevu", "en_cours"].includes(v.statut) && !v.commandeRetourId && v.commandeId !== c.id)
    .map((v) => ({ v, score: (proche(v.destination, c.origine) ? 0 : 1) * 1000 + Math.abs(joursEntre((v.livraisonPrevue || v.dateDepart || today()).slice(0, 10), c.dateChargement || today())) }))
    .sort((a, b) => a.score - b.score).map((x) => x.v);
}
async function commandeEnRetour(c) {
  const l = voyagesPourRetour(c);
  if (!l.length) return toast("Aucun voyage prévu ou en cours sans retour : créez d'abord le voyage aller.", "warn");
  const f = await formulaire(`Charger ${c.ref} au retour`, [{ name: "voyageId", label: "Voyage", type: "select", full: true, value: l[0].id,
    options: l.map((v) => [v.id, `${v.ref} · ${v.origine} → ${v.destination}${v.livraisonPrevue ? " · livre le " + dateFr(v.livraisonPrevue.slice(0, 10)) : ""}${v.chauffeurId ? " · " + nomChauffeur(v.chauffeurId) : ""}`]) }],
    { valider: "Charger au retour", aide: `${esc(c.origine)} → ${esc(c.destination)}, chargement le ${dateFr(c.dateChargement)}. Les voyages qui livrent près de ${esc(c.origine)} sont proposés en premier.` });
  if (!f) return;
  const v = parId(S.voyages, f.voyageId);
  try { lierRetour(v, c); } catch (e) { return toast(e.message, "danger"); }
  sauver(); toast(`${c.ref} chargée au retour de ${v.ref}`); rafraichir();
}
if (VUES.commandes) {
  const agirCommandesAvantAR = VUES.commandes.agir;
  VUES.commandes.agir = async function (act, id, b) {
    const c = parId(S.commandes, id);
    if (act === "planifier" && c) return planifierCommande(c);
    if (act === "en-retour" && c) return commandeEnRetour(c);
    if (act === "ouvrir-voyage" && c) { const l = voyageDeCommande(c); return l ? ouvrirVoyage(l.v.id) : undefined; }
    return agirCommandesAvantAR.call(this, act, id, b);
  };
}

/* ---------- fiche du voyage : chargement de retour ---------- */
function blocRetour(v) {
  if (v.statut === "annule") return "";
  const r = commandeRetour(v);
  if (r) {
    const fac = factureDeCommande(r), e = fac && etatFacture(fac), cv = coutVoyage(v);
    return `<div class="section-title">Chargement de retour</div><div class="trav retour-charge"><div><strong>${esc(r.ref)} · ${esc(nomClient(r.clientId))}</strong>
      <span class="sub">${esc(lieu(r.origine, r.paysOrigine))} → ${esc(lieu(r.destination, r.paysDest))}${r.marchandise ? " · " + esc(r.marchandise) : ""} · chargement le ${dateFr(r.dateChargement)}${r.cmr ? " · CMR " + esc(r.cmr) : ""}</span>
      <span class="sub fin">${fmtDevise(r.prix, r.devise)}${r.devise === "EUR" ? ` (${fmt(cv.prixRetour)} MAD)` : ""} · ${badge(libStatutCmd(r.statut), niveauStatut?.[r.statut] || "neutral")}${fac ? ` · facture ${esc(fac.numero)} ${badge(e.code === "payee" ? "Payée" : e.code === "retard" ? "En retard" : "À encaisser", e.niveau)}` : r.statut === "livre" ? ` · ${badge("à facturer", "warn")}` : ""}</span></div>
      <div class="r">${r.statut === "livre" && !fac ? btn("retour-facturer", "Facturer le retour", { id: v.id, icone: "receipt", cls: "btn sm" }) : ""}${btn("retour-modifier", "Modifier", { id: v.id, cls: "btn ghost sm" })}${btn("retour-retirer", "Retirer", { id: v.id, cls: "btn ghost sm", titre: "Retirer cette commande du voyage (elle redevient une commande libre)" })}</div></div>`;
  }
  const s = typeof seuilRetour === "function" ? seuilRetour(v) : null;
  return `<div class="section-title">Chargement de retour</div><div class="trav vide"><div><strong>Pas encore de retour chargé</strong><span class="sub">${s ? (s.dejaCouvert ? "L'aller couvre déjà le coût complet de l'aller-retour." : `Prix plancher du retour : ${fmt(s.seuilEur, 0)} € (${fmt(s.seuilMad)} MAD) — en dessous, l'aller-retour perd de l'argent.`) : `Chargement à prévoir à ${esc(v.destination || "destination")} ; il aura son client, son prix, son CMR et sa facture.`}</span></div>
    <div class="r">${btn("retour-nouveau", "Nouvelle commande de retour", { id: v.id, icone: "plus", cls: "btn sm" })}${S.commandes.some((c) => !voyageDeCommande(c) && c.statut !== "livre") ? btn("retour-lier", "Commande existante", { id: v.id, cls: "btn ghost sm" }) : ""}</div></div>`;
}
if (typeof blocFacturation === "function") {
  const blocFacturationAvantAR = blocFacturation;
  blocFacturation = function (v) { return `${blocRetour(v)}${blocFacturationAvantAR(v).replace('<div class="section-title fin">Facturation</div>', v.commandeRetourId ? '<div class="section-title fin">Facturation de l\'aller</div>' : '<div class="section-title fin">Facturation</div>')}`; };
}
const agirVoyagesAvantAR = VUES.voyages.agir;
VUES.voyages.agir = async function (act, id, b) {
  if (!String(act).startsWith("retour-")) return agirVoyagesAvantAR.call(this, act, id, b);
  const v = parId(S.voyages, id); if (!v) return;
  voyagesOuverts.add(v.id);
  if (act === "retour-nouveau") {
    const base = commandeRetourDepuisVoyage(v);
    const f = await formulaire(`Retour de ${v.ref} — nouvelle commande`, champsCommande(base), { valider: "Créer et charger au retour", aide: `Chargement à ${esc(base.origine)}, livraison à ${esc(base.destination)} ; chauffeur et camion du voyage. Cette commande aura sa propre facture, à son client.` });
    if (!f) return;
    const n = { id: uid(), ref: prochainNumero("CMD", S.commandes, "ref"), statut: "confirme", jalons: [{ statut: "confirme", date: new Date().toISOString() }], ...lireCommande(f) };
    S.commandes.push(n);
    try { lierRetour(v, n); } catch (e) { return toast(e.message, "danger"); }
    sauver(); toast(`Commande ${n.ref} créée et chargée au retour`); return rafraichir();
  }
  if (act === "retour-lier") {
    const libres = S.commandes.filter((c) => !voyageDeCommande(c) && c.statut !== "livre" && c.id !== v.commandeId);
    const f = await formulaire(`Retour de ${v.ref} — commande existante`, [{ name: "commandeId", label: "Commande", type: "select", full: true, value: libres[0]?.id,
      options: libres.map((c) => [c.id, `${c.ref} · ${nomClient(c.clientId)} · ${c.origine} → ${c.destination} · ${dateFr(c.dateChargement)} · ${fmtDevise(c.prix, c.devise)}`]) }], { valider: "Charger au retour" });
    if (!f) return;
    try { lierRetour(v, parId(S.commandes, f.commandeId)); } catch (e) { return toast(e.message, "danger"); }
    sauver(); toast("Commande chargée au retour"); return rafraichir();
  }
  const r = commandeRetour(v); if (!r) return;
  if (act === "retour-modifier") { const f = await formulaire(`Modifier ${r.ref}`, champsCommande(r)); if (!f) return; Object.assign(r, lireCommande(f)); sauver(); toast("Commande de retour mise à jour"); return rafraichir(); }
  if (act === "retour-retirer") { if (!(await confirmer(`Retirer ${r.ref} du voyage ${v.ref} ?`, "La commande est conservée et redevient libre ; sa recette ne compte plus dans ce voyage.", "Retirer"))) return; delierRetour(v); sauver(); toast("Retour retiré du voyage"); return rafraichir(); }
  if (act === "retour-facturer") { const f = factureDeCommande(r); if (f) return toast(`Déjà facturée : ${f.numero}.`, "warn"); facturerCommandes([r]); }
};
