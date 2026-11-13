"use strict";
/* ============================================================
   Commercial : clients, commandes de transport, facturation.
   Chargé après app.js (utilise ses composants d'interface).
   ============================================================ */

const optsClients = (vide = "— Aucun —") => [["", vide], ...[...S.clients].sort((a, b) => a.nom.localeCompare(b.nom)).map((c) => [c.id, c.nom])];
const optsPays = PAYS.map((p) => [p, p]);
const optsDevise = [["MAD", "MAD"], ["EUR", "EUR (€)"]];
const niveauStatut = { devis: "neutral", confirme: "neutral", charge: "warn", transit: "warn", douane: "warn", livre: "ok" };
const suivant = (s) => STATUTS_CMD[STATUTS_CMD.findIndex(([k]) => k === s) + 1]?.[0];
const lieu = (ville, pays) => `${ville || "?"}${pays && pays !== "Maroc" ? ` (${pays})` : ""}`;

/* ---------- Commandes ---------- */
let filtreCmd = "actives";

const champsCommande = (c = {}) => [
  { name: "clientId", label: "Client", type: "select", options: optsClients("— Choisir —"), value: c.clientId, required: true },
  { name: "marchandise", label: "Marchandise", value: c.marchandise, placeholder: "Agrumes, textile, pièces auto…" },
  { name: "origine", label: "Ville de chargement", value: c.origine, required: true, placeholder: "Agadir" },
  { name: "paysOrigine", label: "Pays de chargement", type: "select", options: optsPays, value: c.paysOrigine || "Maroc" },
  { name: "destination", label: "Ville de livraison", value: c.destination, required: true, placeholder: "Perpignan" },
  { name: "paysDest", label: "Pays de livraison", type: "select", options: optsPays, value: c.paysDest || "France" },
  { name: "dateChargement", label: "Date de chargement", type: "date", value: c.dateChargement || today(), required: true },
  { name: "dateLivraison", label: "Livraison prévue", type: "date", value: c.dateLivraison },
  { name: "poids", label: "Poids (kg)", type: "number", value: c.poids, min: 0 },
  { name: "palettes", label: "Palettes", type: "number", value: c.palettes, min: 0, step: 1 },
  { name: "prix", label: "Prix de vente", type: "number", value: c.prix, min: 0, required: true },
  { name: "devise", label: "Devise", type: "select", options: optsDevise, value: c.devise || "EUR" },
  { name: "chauffeurId", label: "Chauffeur", type: "select", options: [["", "— À affecter —"], ...S.chauffeurs.map((h) => [h.id, h.nom])], value: c.chauffeurId },
  { name: "camionId", label: "Camion", type: "select", options: optsCamions("— À affecter —"), value: c.camionId },
  { name: "cmr", label: "N° CMR", value: c.cmr },
  { name: "refClient", label: "Référence client", value: c.refClient },
  { name: "ferry", label: "Ferry / traversée (MAD)", type: "number", value: c.ferry, min: 0 },
  { name: "fraisChauffeur", label: "Frais de route chauffeur (MAD)", type: "number", value: c.fraisChauffeur, min: 0 },
  { name: "autres", label: "Autres frais (MAD)", type: "number", value: c.autres, min: 0 },
  { name: "notes", label: "Notes", type: "textarea", full: true, value: c.notes },
];
const lireCommande = (v) => ({
  clientId: v.clientId, marchandise: v.marchandise, origine: v.origine, paysOrigine: v.paysOrigine, destination: v.destination, paysDest: v.paysDest,
  dateChargement: v.dateChargement, dateLivraison: v.dateLivraison, poids: num(v.poids), palettes: num(v.palettes), prix: num(v.prix), devise: v.devise,
  chauffeurId: v.chauffeurId, camionId: v.camionId, cmr: v.cmr, refClient: v.refClient, ferry: num(v.ferry), fraisChauffeur: num(v.fraisChauffeur), autres: num(v.autres), notes: v.notes,
});

VUES.commandes = {
  titre: "Commandes",
  sous: "Ordres de transport, du devis à la livraison",
  actions: () => S.clients.length ? btn("ajouter", "Nouvelle commande", { icone: "plus" }) : btn("aller", "Ajouter un client", { id: "clients", icone: "plus" }),
  rendu() {
    if (!S.commandes.length) {
      return `<div class="card">${vide("box", "Aucune commande", S.clients.length ? "Créez votre premier ordre de transport : suivi des étapes, marge et facturation en un clic." : "Ajoutez d'abord un client, puis créez ses commandes.",
        S.clients.length ? btn("ajouter", "Nouvelle commande", { icone: "plus" }) : btn("aller", "Ajouter un client", { id: "clients", icone: "plus" }))}</div>`;
    }
    const filtres = {
      actives: ["En cours", (c) => c.statut !== "livre"],
      facturer: ["À facturer", (c) => c.statut === "livre" && !c.factureId],
      toutes: ["Toutes", () => true],
    };
    const liste = S.commandes.filter(filtres[filtreCmd][1]).sort((a, b) => (a.dateChargement || "").localeCompare(b.dateChargement || ""));
    const compte = (k) => S.commandes.filter(filtres[k][1]).length;
    return `
    <div class="segmented" role="tablist">${Object.entries(filtres).map(([k, [lib]]) =>
      `<button role="tab" data-act="filtre" data-id="${k}" aria-selected="${k === filtreCmd}">${lib}<span>${compte(k)}</span></button>`).join("")}</div>
    <div class="card">
      ${liste.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Commande</th><th>Trajet</th><th>Dates</th><th>Équipe</th><th class="r fin">Prix · marge</th><th>Étape</th><th></th></tr></thead><tbody>
        ${liste.map((c) => {
          const m = margeCommande(c);
          const nx = suivant(c.statut);
          const jc = joursAvant(c.dateChargement);
          const facture = c.factureId && parId(S.factures, c.factureId);
          return `<tr>
            <td><strong>${esc(c.ref)}</strong><span class="sub">${esc(nomClient(c.clientId))}${c.marchandise ? " · " + esc(c.marchandise) : ""}</span></td>
            <td>${esc(lieu(c.origine, c.paysOrigine))} → ${esc(lieu(c.destination, c.paysDest))}<span class="sub">${[c.poids && fmt(c.poids) + " kg", c.palettes && fmt(c.palettes) + " pal.", c.cmr && "CMR " + c.cmr].filter(Boolean).map(esc).join(" · ")}</span></td>
            <td>${dateFr(c.dateChargement)}${c.statut === "devis" || c.statut === "confirme" ? (jc === 0 ? " " + badge("Aujourd'hui", "warn") : jc < 0 ? " " + badge("En retard", "danger") : "") : ""}<span class="sub">→ ${dateFr(c.dateLivraison)}</span></td>
            <td>${c.chauffeurId ? esc(nomChauffeur(c.chauffeurId)) : badge("À affecter", "warn")}<span class="sub">${c.camionId ? esc(nomCamion(c.camionId)) : ""}</span></td>
            <td class="r num fin">${fmtDevise(c.prix, c.devise)}<span class="sub ${m.marge < 0 ? "neg" : ""}">${c.trajetId || coutCommande(c) ? `marge ${fmt(m.marge)} MAD · ${fmt(m.taux)} %${c.trajetId ? "" : " · hors gasoil"}` : "coûts non saisis"}</span></td>
            <td>${badge(libStatutCmd(c.statut), niveauStatut[c.statut])}${facture ? `<span class="sub">${esc(facture.numero)}</span>` : ""}</td>
            <td><div class="actions">
              ${nx ? btn("avancer", libStatutCmd(nx), { id: c.id, icone: "arrow", cls: "btn ghost sm", titre: `Passer à l'étape « ${libStatutCmd(nx)} »` }) : ""}
              ${c.statut === "livre" && !c.factureId ? btn("facturer", "Facturer", { id: c.id, icone: "receipt", cls: "btn sm" }) : ""}
              ${!c.trajetId ? iconBtn("trajet", "route", "Créer le trajet (coût gasoil et péages)", c.id) : ""}
              ${iconBtn("imprimer-ordre", "print", "Imprimer l'ordre de transport", c.id)}${boutonPhotos("commande:" + c.id, `Photos — ${c.ref} (CMR, livraison, dommages)`)}${iconBtn("suivi", "clock", "Suivi des étapes", c.id)}${iconBtn("modifier", "edit", "Modifier", c.id)}${iconBtn("suppr", "trash", "Supprimer", c.id, true)}
            </div></td></tr>`;
        }).join("")}</tbody></table></div>` : vide("check", filtreCmd === "facturer" ? "Tout est facturé" : "Rien ici", filtreCmd === "facturer" ? "Aucune commande livrée en attente de facture." : "Aucune commande dans cette vue.")}
    </div>
    <p class="hint">La marge = prix de vente (converti à ${fmt(S.params.tauxEUR, 2)} MAD/€) − gasoil et péages du trajet lié − ferry − frais de route − autres frais.</p>`;
  },
  async agir(act, id) {
    const c = parId(S.commandes, id);
    if (act === "filtre") { filtreCmd = id; return rafraichir(); }
    if (act === "ajouter") {
      const v = await formulaire("Nouvelle commande", champsCommande(), { valider: "Créer" });
      if (!v) return;
      const n = { id: uid(), ref: prochainNumero("CMD", S.commandes, "ref"), statut: "confirme", jalons: [{ statut: "confirme", date: new Date().toISOString() }], ...lireCommande(v) };
      S.commandes.push(n); sauver(); toast(`Commande ${n.ref} créée`); rafraichir();
    }
    if (act === "modifier") {
      const v = await formulaire(`Modifier ${c.ref}`, champsCommande(c));
      if (!v) return;
      Object.assign(c, lireCommande(v)); sauver(); toast("Commande mise à jour"); rafraichir();
    }
    if (act === "avancer") {
      const nx = suivant(c.statut);
      if (!nx) return;
      if (nx === "charge" && (!c.chauffeurId || !c.camionId)) {
        const v = await formulaire(`Chargement — ${c.ref}`, [
          { name: "chauffeurId", label: "Chauffeur", type: "select", required: true, options: [["", "— Choisir —"], ...S.chauffeurs.map((h) => { const e = etatChauffeur(h); return [h.id, e.dispo ? h.nom : `${h.nom} — ${e.texte}`, !e.dispo]; })], value: c.chauffeurId },
          { name: "camionId", label: "Camion", type: "select", required: true, options: optsCamions("— Choisir —"), value: c.camionId },
        ], { valider: "Confirmer le chargement", aide: "Affectez l'équipe avant de marquer la marchandise comme chargée." });
        if (!v) return;
        Object.assign(c, v);
      }
      appliquerEtape(c, nx);
      sauver(); toast(`${c.ref} : ${libStatutCmd(nx)}`); rafraichir();
    }
    if (act === "trajet") {
      const v = await formulaire(`Trajet de ${c.ref}`, [
        { name: "distance", label: "Distance totale (km)", type: "number", required: true, min: 1 },
        { name: "peage", label: "Péages (MAD)", type: "number", value: 0, min: 0 },
      ], { valider: "Créer le trajet", aide: `${esc(lieu(c.origine, c.paysOrigine))} → ${esc(lieu(c.destination, c.paysDest))}. Le coût du gasoil est calculé avec la consommation réelle du camion, et le trajet apparaît dans l'onglet Trajets.` });
      if (!v) return;
      const t = { id: uid(), depart: c.origine, arrivee: c.destination, date: c.dateChargement, chauffeurId: c.chauffeurId, camionId: c.camionId, client: `${nomClient(c.clientId)} · ${c.ref}`,
        statut: ["charge", "transit", "douane"].includes(c.statut) ? "encours" : "planifie", ...lireTrajet({ ...v, camionId: c.camionId }) };
      S.trajets.push(t); c.trajetId = t.id; sauver();
      toast(`Trajet créé · coût ${fmt(t.calcul.coutTotal)} MAD`); rafraichir();
    }
    if (act === "suivi") {
      const etapes = STATUTS_CMD.map(([k, lib]) => {
        const j = (c.jalons || []).find((x) => x.statut === k);
        return `<li class="${j ? "fait" : ""}"><span class="pt"></span><div><strong>${lib}</strong><span class="sub">${j ? dateHeureFr(j.date) : "—"}</span></div></li>`;
      }).join("");
      await modale({ titre: `Suivi — ${c.ref}`, valider: "Fermer", annuler: "", corps: `<p class="hint" style="margin:0 0 12px">${esc(nomClient(c.clientId))} · ${esc(lieu(c.origine, c.paysOrigine))} → ${esc(lieu(c.destination, c.paysDest))}</p><ol class="timeline">${etapes}</ol>` });
    }
    if (act === "facturer") facturerCommandes([c]);
    if (act === "imprimer-ordre") imprimerOrdre(c);
    if (act === "suppr" && (await confirmer(`Supprimer ${c.ref} ?`, c.factureId ? "La facture associée est conservée." : "Cette action est définitive."))) {
      supprimerPhotosDe(`commande:${id}`);
      S.commandes = S.commandes.filter((x) => x.id !== id); sauver(); rafraichir();
    }
  },
};

/* ---------- Clients ---------- */
const champsClient = (c = {}) => [
  { name: "nom", label: "Raison sociale", value: c.nom, required: true },
  { name: "ice", label: "ICE / n° TVA", value: c.ice },
  { name: "contact", label: "Contact", value: c.contact },
  { name: "tel", label: "Téléphone", type: "tel", value: c.tel },
  { name: "email", label: "E-mail", type: "email", value: c.email },
  { name: "ville", label: "Ville", value: c.ville },
  { name: "pays", label: "Pays", type: "select", options: optsPays, value: c.pays || "Maroc" },
  { name: "delai", label: "Délai de paiement (jours)", type: "number", value: c.delai ?? S.params.delaiPaiement, min: 0, step: 1 },
  { name: "adresse", label: "Adresse", type: "textarea", full: true, value: c.adresse },
  { name: "notificationsClientAutorisees", label: "Le client accepte d'être prévenu aux étapes de ses voyages (WhatsApp ou e-mail)", type: "checkbox", full: true, value: c.notificationsClientAutorisees },
  { name: "canalNotifPrefere", label: "Canal préféré du client", type: "select", options: [["whatsapp", "WhatsApp"], ["email", "E-mail"], ["sms", "SMS"]], value: c.canalNotifPrefere || "whatsapp" },
  { name: "langueNotif", label: "Langue des messages", type: "select", options: [["fr", "Français"], ["en", "English"], ["es", "Español"], ["ar", "العربية"]], value: c.langueNotif || "fr" },
];

VUES.clients = {
  titre: "Clients",
  sous: "Chargeurs, conditions de paiement et encours",
  actions: () => btn("ajouter", "Ajouter un client", { icone: "plus" }),
  rendu() {
    if (!S.clients.length) return `<div class="card">${vide("building", "Aucun client", "Ajoutez vos chargeurs pour créer des commandes et des factures.", btn("ajouter", "Ajouter un client", { icone: "plus" }))}</div>`;
    const il90 = dateISO(Date.now() - 90 * 86400000);
    return `<div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Client</th><th>Contact</th><th class="r">Commandes</th><th class="r">CA 90 jours</th><th class="r">Encours</th><th></th></tr></thead><tbody>
      ${[...S.clients].sort((a, b) => a.nom.localeCompare(b.nom)).map((c) => {
        const cmds = S.commandes.filter((x) => x.clientId === c.id);
        const ca = cmds.filter((x) => x.statut === "livre" && (x.dateLivraison || "") >= il90).reduce((s, x) => s + versMAD(x.prix, x.devise), 0);
        const enc = encoursClients(c.id);
        return `<tr>
          <td><strong>${esc(c.nom)}</strong><span class="sub">${[c.ville, c.pays, c.ice && "ICE " + c.ice].filter(Boolean).map(esc).join(" · ")}</span></td>
          <td>${esc(c.contact || "—")}<span class="sub">${c.tel ? `<a href="tel:${esc(c.tel.replace(/\s/g, ""))}">${esc(c.tel)}</a>` : ""}${c.email ? ` · <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ""}</span></td>
          <td class="r num">${cmds.length}</td>
          <td class="r num">${fmt(ca)} MAD</td>
          <td class="r num">${enc.total ? `${fmt(enc.total)} MAD${enc.retard ? `<span class="sub neg">dont ${fmt(enc.retard)} en retard</span>` : ""}` : "—"}<span class="sub">${c.delai ?? S.params.delaiPaiement} j</span></td>
          <td><div class="actions">${btn("commande", "Commande", { id: c.id, icone: "plus", cls: "btn ghost sm" })}${iconBtn("modifier", "edit", "Modifier", c.id)}${iconBtn("suppr", "trash", "Supprimer", c.id, true)}</div></td></tr>`;
      }).join("")}</tbody></table></div></div>`;
  },
  async agir(act, id) {
    const c = parId(S.clients, id);
    const lire = (v) => ({ ...v, delai: num(v.delai, S.params.delaiPaiement) });
    if (act === "ajouter") {
      const v = await formulaire("Nouveau client", champsClient(), { valider: "Ajouter" });
      if (!v) return;
      S.clients.push({ id: uid(), ...lire(v) }); sauver(); toast(`${v.nom} ajouté`); rafraichir();
    }
    if (act === "modifier") {
      const v = await formulaire(`Modifier ${c.nom}`, champsClient(c));
      if (!v) return;
      Object.assign(c, lire(v)); sauver(); toast("Client mis à jour"); rafraichir();
    }
    if (act === "commande") {
      const v = await formulaire(`Nouvelle commande — ${c.nom}`, champsCommande({ clientId: c.id }), { valider: "Créer" });
      if (!v) return;
      const n = { id: uid(), ref: prochainNumero("CMD", S.commandes, "ref"), statut: "confirme", jalons: [{ statut: "confirme", date: new Date().toISOString() }], ...lireCommande(v) };
      S.commandes.push(n); sauver(); toast(`Commande ${n.ref} créée`); afficher("commandes");
    }
    if (act === "suppr") {
      if (S.commandes.some((x) => x.clientId === id) || S.factures.some((x) => x.clientId === id)) return toast("Ce client a des commandes ou des factures : il ne peut pas être supprimé.", "warn");
      if (await confirmer(`Supprimer ${c.nom} ?`, "Cette action est définitive.")) { S.clients = S.clients.filter((x) => x.id !== id); sauver(); rafraichir(); }
    }
  },
};

/* ---------- Factures ---------- */
function facturerCommandes(cmds) {
  const c0 = cmds[0];
  const client = parId(S.clients, c0.clientId);
  const date = today();
  const f = {
    id: uid(), numero: prochainNumero("FAC", S.factures, "numero"), clientId: c0.clientId, commandeIds: cmds.map((c) => c.id),
    date, echeance: dateISO(new Date(date + "T00:00:00").getTime() + (client?.delai ?? S.params.delaiPaiement) * 86400000),
    devise: c0.devise || "MAD", tva: S.params.tvaDefaut, statut: "emise",
    lignes: cmds.map((c) => ({ designation: `Transport ${lieu(c.origine, c.paysOrigine)} → ${lieu(c.destination, c.paysDest)}${c.marchandise ? " — " + c.marchandise : ""} · ${c.ref}${c.cmr ? " · CMR " + c.cmr : ""}${c.refClient ? " · réf. " + c.refClient : ""}`, montant: num(c.prix) })),
  };
  S.factures.push(f);
  cmds.forEach((c) => { c.factureId = f.id; });
  sauver(); toast(`Facture ${f.numero} créée · ${fmtDevise(totauxFacture(f).ttc, f.devise)}`);
  rafraichir();
  return f;
}

let filtreFac = "attente";
VUES.factures = {
  titre: "Factures",
  sous: "Facturation, échéances et encaissements",
  actions: () => S.clients.length ? btn("ajouter", "Facture libre", { icone: "plus", cls: "btn ghost" }) : "",
  rendu() {
    const enc = encoursClients();
    const il30 = dateISO(Date.now() - 30 * 86400000);
    const encaisse30 = S.factures.filter((f) => f.statut === "payee" && (f.datePaiement || "") >= il30).reduce((s, f) => s + versMAD(totauxFacture(f).ttc, f.devise), 0);
    const aFacturer = S.commandes.filter((c) => c.statut === "livre" && !c.factureId);
    const filtres = { attente: ["À encaisser", (f) => f.statut !== "payee"], retard: ["En retard", (f) => etatFacture(f).code === "retard"], payees: ["Payées", (f) => f.statut === "payee"], toutes: ["Toutes", () => true] };
    const liste = S.factures.filter(filtres[filtreFac][1]).sort((a, b) => (b.numero || "").localeCompare(a.numero || ""));
    return `
    <div class="kpis">
      <div class="kpi"><div class="l">${ic("receipt")}Encours clients</div><div class="v">${fmt(enc.total)}<small> MAD</small></div><div class="s">${S.factures.filter((f) => f.statut !== "payee").length} facture(s) à encaisser</div></div>
      <div class="kpi"><div class="l">${ic("alert")}En retard</div><div class="v">${fmt(enc.retard)}<small> MAD</small></div><div class="s ${enc.retard ? "danger" : ""}">${enc.retard ? "À relancer" : "Aucun retard"}</div></div>
      <div class="kpi"><div class="l">${ic("check")}Encaissé 30 jours</div><div class="v">${fmt(encaisse30)}<small> MAD</small></div><div class="s">TTC, converti en MAD</div></div>
      <div class="kpi"><div class="l">${ic("box")}Livré non facturé</div><div class="v">${aFacturer.length}</div><div class="s ${aFacturer.length ? "warn" : ""}">${aFacturer.length ? fmt(aFacturer.reduce((s, c) => s + versMAD(c.prix, c.devise), 0)) + " MAD HT" : "Tout est facturé"}</div></div>
    </div>
    ${aFacturer.length ? `<div class="card callout"><div class="row" style="justify-content:space-between"><div><strong>${aFacturer.length} commande${aFacturer.length > 1 ? "s" : ""} livrée${aFacturer.length > 1 ? "s" : ""} à facturer</strong><span class="sub">${aFacturer.map((c) => esc(c.ref)).join(", ")}</span></div>${btn("tout-facturer", "Tout facturer", { icone: "receipt" })}</div></div>` : ""}
    ${S.factures.length ? `<div class="segmented" role="tablist">${Object.entries(filtres).map(([k, [lib]]) => `<button role="tab" data-act="filtre" data-id="${k}" aria-selected="${k === filtreFac}">${lib}<span>${S.factures.filter(filtres[k][1]).length}</span></button>`).join("")}</div>
    <div class="card">${liste.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Facture</th><th>Client</th><th>Date</th><th class="r">Montant TTC</th><th>Statut</th><th></th></tr></thead><tbody>
      ${liste.map((f) => {
        const t = totauxFacture(f); const e = etatFacture(f);
        return `<tr><td><strong>${esc(f.numero)}</strong><span class="sub">${(f.lignes || []).length} ligne(s)${S.voyages.filter((v) => factureDuVoyage(v) === f).map((v) => " · voyage " + esc(v.ref || "")).join("")}</span></td>
          <td>${esc(nomClient(f.clientId))}</td>
          <td>${dateFr(f.date)}<span class="sub">échéance ${dateFr(f.echeance)}</span></td>
          <td class="r num">${fmtDevise(t.ttc, f.devise)}<span class="sub">HT ${fmt(t.ht, 2)} · TVA ${fmt(f.tva)} %</span></td>
          <td>${badge(e.code === "payee" ? "Payée" : e.code === "retard" ? "En retard" : "À encaisser", e.niveau)}<span class="sub">${esc(e.texte)}</span></td>
          <td><div class="actions">${f.statut !== "payee" ? btn("payer", "Encaisser", { id: f.id, icone: "check", cls: "btn ghost sm" }) : ""}${f.statut !== "payee" && e.code === "retard" ? btn("relance", "Relance", { id: f.id, icone: "mail", cls: "btn ghost sm" }) : ""}
            ${iconBtn("imprimer", "print", "Imprimer / PDF", f.id)}${iconBtn("suppr", "trash", "Supprimer", f.id, true)}</div></td></tr>`;
      }).join("")}</tbody></table></div>` : vide("check", "Rien ici", "Aucune facture dans cette vue.")}</div>`
      : `<div class="card">${vide("receipt", "Aucune facture", "Les commandes livrées se facturent en un clic depuis l'onglet Commandes.")}</div>`}
    ${!S.entreprise.nom ? `<p class="hint">Renseignez votre raison sociale, ICE et RIB dans Réglages → Entreprise : ils apparaissent sur les factures imprimées.</p>` : ""}`;
  },
  async agir(act, id) {
    const f = parId(S.factures, id);
    if (act === "filtre") { filtreFac = id; return rafraichir(); }
    if (act === "tout-facturer") {
      const groupes = {};
      S.commandes.filter((c) => c.statut === "livre" && !c.factureId).forEach((c) => (groupes[`${c.clientId}|${c.devise}`] ||= []).push(c));
      Object.values(groupes).forEach(facturerCommandes);
    }
    if (act === "ajouter") {
      const v = await formulaire("Facture libre", [
        { name: "clientId", label: "Client", type: "select", options: optsClients("— Choisir —"), required: true },
        { name: "devise", label: "Devise", type: "select", options: optsDevise, value: "MAD" },
        { name: "designation", label: "Désignation", required: true, full: true, placeholder: "Frais d'immobilisation, magasinage…" },
        { name: "montant", label: "Montant HT", type: "number", required: true, min: 0 },
        { name: "tva", label: "TVA (%)", type: "number", value: S.params.tvaDefaut, min: 0 },
      ], { valider: "Créer la facture" });
      if (!v) return;
      const client = parId(S.clients, v.clientId);
      S.factures.push({ id: uid(), numero: prochainNumero("FAC", S.factures, "numero"), clientId: v.clientId, commandeIds: [], date: today(),
        echeance: dateISO(Date.now() + (client?.delai ?? S.params.delaiPaiement) * 86400000), devise: v.devise, tva: num(v.tva), statut: "emise", lignes: [{ designation: v.designation, montant: num(v.montant) }] });
      sauver(); toast("Facture créée"); rafraichir();
    }
    if (act === "payer") {
      const v = await formulaire(`Encaisser ${f.numero}`, [
        { name: "datePaiement", label: "Date du paiement", type: "date", value: today(), required: true },
        { name: "mode", label: "Mode", type: "select", options: [["virement", "Virement"], ["cheque", "Chèque"], ["lcn", "LCN / effet"], ["especes", "Espèces"]] },
      ], { valider: "Marquer payée", aide: `${fmtDevise(totauxFacture(f).ttc, f.devise)} TTC · ${esc(nomClient(f.clientId))}` });
      if (!v) return;
      Object.assign(f, v, { statut: "payee" }); sauver(); toast(`${f.numero} encaissée`); rafraichir();
    }
    if (act === "relance") {
      const c = parId(S.clients, f.clientId);
      const t = totauxFacture(f);
      const sujet = `Relance — facture ${f.numero}`;
      const corps = `Bonjour${c?.contact ? " " + c.contact : ""},\n\nSauf erreur de notre part, la facture ${f.numero} du ${dateFr(f.date)}, d'un montant de ${fmtDevise(t.ttc, f.devise)} TTC, arrivée à échéance le ${dateFr(f.echeance)}, reste impayée.\n\nMerci de bien vouloir procéder à son règlement${S.entreprise.rib ? ` sur le compte ${S.entreprise.rib}` : ""}.\n\nCordialement,\n${S.entreprise.nom || ""}`;
      location.href = `mailto:${encodeURIComponent(c?.email || "")}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
    }
    if (act === "imprimer") imprimerFacture(f);
    if (act === "suppr" && (await confirmer(`Supprimer ${f.numero} ?`, "Les commandes et voyages liés redeviennent « à facturer ». Pour une facture déjà envoyée, préférez un avoir."))) {
      S.commandes.forEach((c) => { if (c.factureId === id) c.factureId = null; });
      S.voyages.forEach((v) => { if (v.factureId === id) delete v.factureId; });
      S.factures = S.factures.filter((x) => x.id !== id); sauver(); rafraichir();
    }
  },
};

/* ---------- Réglages : entreprise ---------- */
function carteEntreprise() {
  const E = S.entreprise;
  return `<div class="card">
    <div class="card-head"><h2>Entreprise</h2>${E.nom ? badge("Renseignée", "ok") : badge("À compléter", "warn")}</div>
    <form id="f-entreprise">
      ${champs([
        { name: "nom", label: "Raison sociale", value: E.nom },
        { name: "tel", label: "Téléphone", value: E.tel },
        { name: "email", label: "E-mail", type: "email", value: E.email },
        { name: "ville", label: "Ville", value: E.ville },
        { name: "ice", label: "ICE", value: E.ice },
        { name: "rc", label: "RC", value: E.rc },
        { name: "if", label: "IF", value: E.if },
        { name: "patente", label: "Patente", value: E.patente },
        { name: "cnss", label: "CNSS", value: E.cnss },
        { name: "banque", label: "Banque", value: E.banque },
        { name: "rib", label: "RIB", value: E.rib, full: true },
        { name: "adresse", label: "Adresse", type: "textarea", value: E.adresse, full: true },
        { name: "mentionsFacture", label: "Mentions de bas de facture (conditions de paiement, pénalités de retard…)", type: "textarea", value: E.mentionsFacture, full: true },
      ])}
      <div class="logo-champ">
        ${logoSur(E) ? `<img src="${logoSur(E)}" alt="Logo actuel">` : ""}
        <label class="f">Logo (PNG ou JPEG, affiché sur les documents imprimés)<input type="file" name="logoFichier" accept="image/png,image/jpeg"></label>
        ${logoSur(E) ? btn("logo-retirer", "Retirer le logo", { cls: "btn text-danger sm" }) : ""}
      </div>
      <p class="hint">Ces informations apparaissent sur les factures imprimées et les relances.</p>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn">Enregistrer</button></div>
    </form>
  </div>`;
}
