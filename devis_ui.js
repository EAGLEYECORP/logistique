"use strict";
/* ============================================================
   Prix conseillé et devis (interface) :
   · « Chiffrer » sur une demande : coût de l'aller-retour, chance de retour, prix plancher, prix conseillé (et à 10 / 20 %),
     prix passés du client et du corridor ; prix et validité → devis imprimable, envoyé par WhatsApp ou e-mail dans la langue du client ;
   · « Accepté » (la commande est confirmée) ou « Perdu » (motif, prix du concurrent) ; taux de devis gagnés sur 90 jours ;
   · Réglages : marge visée, fret du détroit par défaut.
   Logique pure dans devis.js.
   ============================================================ */

const LIB_ETAT_DEVIS = { a_chiffrer: ["À chiffrer", "warn"], envoye: ["Devis envoyé", "neutral"], expire: ["Devis expiré", "danger"], gagne: ["Devis gagné", "ok"], perdu: ["Perdu", "danger"] };
const fmtPrix = (x, d) => `${fmt(x, 0)} ${d === "EUR" ? "€" : "MAD"}`;
function puceDevis(c) {
  const e = etatDevis(c); if (!e || e === "gagne") return "";
  const [lib, niv] = LIB_ETAT_DEVIS[e];
  return `<span class="sub">${badge(lib, niv)}${c.devis && e !== "perdu" ? ` ${fmtPrix(c.devis.prix, c.devis.devise)} · jusqu'au ${dateFr(c.devis.validite)}` : ""}${e === "perdu" ? ` ${esc(libDe(MOTIFS_PERTE, c.perdu.motif))}${c.perdu.prixConcurrent ? ` · concurrent ${fmtPrix(c.perdu.prixConcurrent, c.devise)}` : ""}` : ""}</span>`;
}
function actionsDevis(c) {
  const e = etatDevis(c); if (!e || e === "gagne") return "";
  if (e === "perdu") return btn("devis-rouvrir", "Rouvrir", { id: c.id, cls: "btn ghost sm" });
  return `${btn("devis-chiffrer", e === "a_chiffrer" ? "Chiffrer" : "Devis", { id: c.id, icone: "receipt", cls: `btn ${e === "a_chiffrer" ? "" : "ghost "}sm` })}${c.devis ? btn("devis-accepte", "Accepté", { id: c.id, icone: "check", cls: "btn sm" }) + btn("devis-perdu", "Perdu", { id: c.id, cls: "btn ghost sm" }) : ""}`;
}

async function chiffrerCommande(c) {
  const p = prixConseille(c), h = historiquePrix(c), d = p.devise;
  const histo = h.client.length ? `<ul class="devis-histo">${h.client.map((x) => `<li>${esc(x.ref)} · ${dateFr(x.date)} · <strong>${fmtPrix(x.prix, x.devise)}</strong> ${x.perdu ? badge("perdu", "danger") : x.gagne ? badge("gagné", "ok") : ""}</li>`).join("")}</ul>` : `<p class="sub" style="margin:0">Aucun prix passé pour ce client sur ce trajet.</p>`;
  const corps = `<div class="devis-grille">
      <div class="devis-case principal"><span class="sub">Prix conseillé (marge ${Math.round(p.marge * 100)} %)</span><strong>${p.conseille ? fmtPrix(p.conseille, d) : "—"}</strong><span class="sub">${p.variantes.map((x) => `à ${Math.round(x.marge * 100)} % : ${fmtPrix(x.prix, d)}`).join(" · ")}</span></div>
      <div class="devis-case"><span class="sub">Prix plancher</span><strong>${fmtPrix(p.plancher, d)}</strong><span class="sub">en dessous, vous perdez de l'argent</span></div>
      <div class="devis-case"><span class="sub">Coût de l'aller-retour</span><strong>${fmtPrix(p.cout.montant, d)}</strong><span class="sub">${esc(p.cout.detail || "")}</span></div>
      <div class="devis-case"><span class="sub">Retour chargé</span><strong>${Math.round(p.retour.proba * 100)} % de chances</strong><span class="sub">${p.retour.defaut ? "par défaut (moins de 3 voyages vers cette zone)" : `${p.retour.n} voyages vers cette zone`}${p.retour.prixRetourEur ? ` · retour moyen ${fmt(p.retour.prixRetourEur)} €` : " · aucun prix de retour connu : non déduit"}</span></div>
    </div>
    ${p.cout.manques.length ? `<p class="lecture-manque">${ic("alert")}<span>Estimation incomplète : ${p.cout.manques.map(esc).join(" ; ")}. Le prix conseillé est un plancher de réflexion, pas un tarif.</span></p>` : ""}
    <div class="section-title">Prix passés</div>${histo}${h.corridor.mediane ? `<p class="sub" style="margin:4px 0 0">Tous clients, ce trajet : médiane ${fmtPrix(h.corridor.mediane, h.corridor.devise)} (${h.corridor.n} commande${h.corridor.n > 1 ? "s" : ""}).</p>` : ""}
    <div class="form-grid" style="margin-top:12px">
      <label class="f">Prix du devis HT (${d === "EUR" ? "€" : "MAD"})<input type="number" name="prix" min="0" step="10" required value="${num(c.devis?.prix) || p.conseille || ""}"></label>
      <label class="f">Valable (jours)<input type="number" name="validite" min="1" step="1" value="7"></label></div>`;
  const f = await modale({ titre: `Chiffrer ${c.ref} — ${nomClient(c.clientId)}`, corps, valider: "Enregistrer le devis" });
  if (!f) return;
  noterDevis(c, { prix: f.prix, validiteJours: num(f.validite, 7) }); sauver(); rafraichir();
  await envoyerDevis(c);
}
async function envoyerDevis(c) {
  const t = texteDevis(c), cl = parId(S.clients, c.clientId) || {}, tel = typeof telInternational === "function" ? telInternational(cl.tel) : "";
  const liens = [btn("devis-imprimer", "Imprimer le devis (PDF)", { id: c.id, icone: "print", cls: "btn" })];
  if (tel) liens.push(`<a class="btn ghost" href="https://wa.me/${tel}?text=${encodeURIComponent(t.texte)}" target="_blank" rel="noopener">WhatsApp — ${esc(cl.tel)}</a>`);
  if (cl.email) liens.push(`<a class="btn ghost" href="mailto:${esc(cl.email)}?subject=${encodeURIComponent(t.sujet)}&body=${encodeURIComponent(t.texte)}">E-mail — ${esc(cl.email)}</a>`);
  await modale({ titre: `Envoyer le devis ${c.ref}`, valider: "Fermer", annuler: "", corps: `<div class="liens-envoi">${liens.join("")}</div><textarea rows="8" readonly style="width:100%;margin-top:10px">${esc(t.texte)}</textarea><p class="hint">Quand le client répond : « Accepté » confirme la commande ; « Perdu » garde le motif pour vos prochains prix.</p>` });
}
function imprimerDevis(c) {
  const cl = parId(S.clients, c.clientId) || {}, d = c.devis || { prix: c.prix, devise: c.devise, date: today(), validite: "" }, k = typeof conditionsAttente === "function" ? conditionsAttente(c) : null;
  ouvrirImpression(`Devis ${c.ref}`, `${enteteDoc("Devis", [`N° <strong style="color:#0f172a">${l(c.ref)}</strong>`, `Du ${dateFr(d.date)}`, d.validite ? `Valable jusqu'au ${dateFr(d.validite)}` : ""].filter(Boolean))}
    <h2>Client</h2><div class="cadre"><div class="grille">${champDoc("Client", cl.nom)}${champDoc("Contact", [cl.contact, cl.tel, cl.email].filter(Boolean).join(" · "))}${champDoc("ICE / TVA", cl.ice)}${champDoc("Votre référence", c.refClient)}</div></div>
    <h2>Transport</h2><div class="grille">
      <div class="cadre"><div class="k">Chargement</div><div class="v" style="font-size:15px">${l(lieu(c.origine, c.paysOrigine))}</div><div>${dateFr(c.dateChargement)}</div></div>
      <div class="cadre"><div class="k">Livraison</div><div class="v" style="font-size:15px">${l(lieu(c.destination, c.paysDest))}</div><div>${c.dateLivraison ? dateFr(c.dateLivraison) : "—"}</div></div></div>
    <div class="grille">${champDoc("Marchandise", c.marchandise)}${champDoc("Poids / palettes", [c.poids && `${fmt(c.poids)} kg`, c.palettes && `${fmt(c.palettes)} palettes`].filter(Boolean).join(" · "))}${champDoc("Température", Number.isFinite(c.tempMin) ? `${c.tempMin} à ${c.tempMax} °C` : "")}</div>
    <h2>Prix</h2><div class="cadre"><div class="grille">${champDoc("Transport, traversée et péages inclus", `${fmt(d.prix, 2)} ${d.devise === "EUR" ? "€" : "MAD"} HT`)}${champDoc("Paiement", `à ${cl.delai ?? S.params.delaiPaiement} jours`)}</div></div>
    <h2>Conditions</h2><div class="cadre">${k ? `Attente : ${l(String(k.franchiseH))} h gratuites par quai (chargement, livraison)${k.tarif ? `, puis ${l(String(k.tarif))} ${k.devise === "EUR" ? "€" : "MAD"} HT de l'heure, par demi-heure entamée` : ""}.<br>` : ""}Documents d'export, d'origine et sanitaires fournis par l'expéditeur avant le chargement. Transport soumis à la convention CMR.${d.validite ? `<br>Prix valable jusqu'au ${dateFr(d.validite)}, sous réserve de disponibilité d'un camion à la date demandée.` : ""}</div>
    <div class="signatures"><div class="sig">Bon pour accord — client<br>Nom, date, signature</div><div class="sig">Transporteur<br>Cachet, date, signature</div></div>
    ${piedDoc({ banque: true, mentions: true })}`);
}
async function devisMarquerPerdu(c) {
  const f = await formulaire(`Devis perdu — ${c.ref}`, [
    { name: "motif", label: "Pourquoi ?", type: "select", options: MOTIFS_PERTE, value: "prix" },
    { name: "prixConcurrent", label: `Prix du concurrent, si connu (${c.devise === "MAD" ? "MAD" : "€"})`, type: "number", min: 0, step: 10 },
    { name: "note", label: "Note", full: true },
  ], { valider: "Marquer perdu", aide: "Ces réponses affinent vos prochains prix sur ce trajet." });
  if (!f) return; devisPerdu(c, f); sauver(); toast(`${c.ref} : devis perdu`); rafraichir();
}
async function agirDevis(act, id) {
  const c = parId(S.commandes, id); if (!c) return false;
  if (act === "devis-chiffrer") { await chiffrerCommande(c); return true; }
  if (act === "devis-imprimer") { imprimerDevis(c); return true; }
  if (act === "devis-accepte") { devisAccepte(c); sauver(); toast(`${c.ref} acceptée : commande confirmée, à planifier`); filtreCmd = "actives"; rafraichir(); return true; }
  if (act === "devis-perdu") { await devisMarquerPerdu(c); return true; }
  if (act === "devis-rouvrir") { delete c.perdu; sauver(); toast(`${c.ref} rouverte`); rafraichir(); return true; }
  return false;
}
if (VUES.commandes) {
  const agirCommandesAvantDevis = VUES.commandes.agir, renduCommandesAvantDevis = VUES.commandes.rendu;
  VUES.commandes.agir = async function (act, id, b) { if (String(act).startsWith("devis-") && (await agirDevis(act, id))) return; return agirCommandesAvantDevis.call(this, act, id, b); };
  VUES.commandes.rendu = function () {
    const html = renduCommandesAvantDevis.call(this); if (filtreCmd !== "chiffrer") return html;
    const t = tauxDevis(dateISO(Date.now() - 90 * 86400000)); if (!t.envoyes) return html;
    const motifs = Object.entries(t.motifs).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${libDe(MOTIFS_PERTE, k).toLowerCase()}`).join(", ");
    return html.replace('<div class="card">', `<div class="card devis-synthese"><div class="card-head"><h2>Devis · 90 jours</h2>${t.taux !== null ? badge(`${t.taux} % gagnés`, t.taux >= 50 ? "ok" : "warn") : ""}</div><p style="margin:0">${t.envoyes} envoyé${t.envoyes > 1 ? "s" : ""} · ${t.gagnes} gagné${t.gagnes > 1 ? "s" : ""} · ${t.perdus} perdu${t.perdus > 1 ? "s" : ""}${motifs ? ` (${motifs})` : ""} · ${t.enAttente} en attente${t.prixMoyenGagne && t.prixMoyenPerdu ? ` · prix moyen gagné ${fmt(t.prixMoyenGagne)} MAD, perdu ${fmt(t.prixMoyenPerdu)} MAD` : ""}.</p></div><div class="card">`);
  };
}
// les boutons d'une fenêtre ne passent pas par le gestionnaire des pages
document.addEventListener("click", (e) => { const b = e.target.closest?.('dialog [data-act="devis-imprimer"]'); if (b) agirDevis("devis-imprimer", b.dataset.id); });

/* ---------- réglages ---------- */
enregistrerCarteReglages({
  onglet: "general", ordre: 40,
  rendu: () => `<div class="card" id="carte-devis"><div class="card-head"><h2>Devis et prix conseillé</h2></div>
    <form id="f-devis"><div class="form-grid">
      <label class="f">Marge nette visée (%)<input type="number" name="margeVisee" min="0" max="60" step="1" value="${num(S.params.margeVisee, 15)}"></label>
      <label class="f">Fret du détroit par traversée (€, si vos traversées ne le donnent pas)<input type="number" name="fretDetroitEur" min="0" step="10" value="${num(S.params.fretDetroitEur) || ""}"></label>
    </div><div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn">Enregistrer</button></div></form>
    <p class="hint">Le prix conseillé part de vos voyages passés sur le même trajet ; sans historique, d'une estimation (kilomètres, gasoil, traversées, per diem, charges fixes) qui liste ce qui lui manque.</p></div>`,
  soumettre(fid, v) { if (fid !== "f-devis") return false; S.params.margeVisee = num(v.margeVisee, 15); S.params.fretDetroitEur = num(v.fretDetroitEur, 0); sauver(); toast("Réglages des devis enregistrés"); rafraichir(); return true; },
});
