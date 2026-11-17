"use strict";
/* ============================================================
   Attente aux quais (interface) :
   · mode chauffeur : « Arrivé au quai » (chargement, puis livraison), temps sur place affiché ; l'étape « Chargée » ou « Livrée » ferme le quai ;
   · fiche du voyage et page Commandes : temps à chaque quai, au-delà de la franchise, montant, correction au bureau, « Facturer l'attente » ;
   · page Factures : l'attente des 30 derniers jours (facturable, facturée, sans tarif).
   Logique pure dans quais.js.
   ============================================================ */

const quaiCourant = (c) => (c.statut === "confirme" && !c.quais?.chargement?.depart ? "chargement" : ["charge", "transit", "douane"].includes(c.statut) && !c.quais?.livraison?.depart ? "livraison" : "");
const hmQuai = (iso) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/* ---------- mode chauffeur ---------- */
function blocQuaiChauffeur(c) {
  const q = quaiCourant(c); if (!q) return "";
  const a = attenteQuai(c, q), lib = q === "chargement" ? "chargement" : "livraison";
  if (!a) return `<div class="chf-quai">${(typeof glissiere === "function" ? glissiere("chf-quai", q === "chargement" ? "Glisser : arrivé au quai de chargement" : "Glisser : arrivé chez le destinataire", { id: `${c.id}|${q}`, ton: "discret" }) : btn("chf-quai", q === "chargement" ? "Arrivé au quai de chargement" : "Arrivé chez le destinataire", { id: `${c.id}|${q}`, icone: "pin", cls: "btn lg ghost" }))}<span class="sub">Notez votre arrivée : l'attente au-delà de ${dureeQuai(conditionsAttente(c).franchiseH * 60)} est facturée au client.</span></div>`;
  return `<div class="chf-quai sur-place ${a.auDelaMin ? "au-dela" : ""}">${ic("clock")}<span><strong>Au quai de ${lib} depuis ${hmQuai(a.arrivee)} · ${dureeQuai(a.minutes)}</strong><span class="sub">${a.auDelaMin ? `${dureeQuai(a.auDelaMin)} au-delà de la franchise` : `franchise ${dureeQuai(a.franchiseMin)}`} · « ${q === "chargement" ? "Chargée" : "Livrée"} » arrête le compteur</span></span></div>`;
}
if (typeof carteMission === "function") {
  const carteMissionAvantQuais = carteMission;
  carteMission = function (c, ch, principale) { const h = carteMissionAvantQuais(c, ch, principale); return principale ? h.replace('<div class="chf-actions">', `${blocQuaiChauffeur(c)}<div class="chf-actions">`) : h; };
}
surAction("chauffeur", ["chf-quai"], async (act, id) => { const [cid, q] = String(id).split("|"), c = parId(S.commandes, cid); if (!c) return; arriveeQuai(c, q); sauver(); toast(`Arrivée notée à ${hmQuai(c.quais[q].arrivee)}`); return rafraichir(); });
autourAction("chauffeur", ["chf-etape"], async (suite, act, id) => { const r = await suite(); const c = parId(S.commandes, id); if (c && typeof jalonDepuisCommande === "function" && jalonDepuisCommande(c)) sauver(); return r; }, { ordre: 60, nom: "voyage suivi des étapes du chauffeur" });

/* ---------- bureau : correction, facturation ---------- */
async function corrigerQuais(c) {
  const v = (q, k) => (c.quais?.[q]?.[k] ? isoLocal(c.quais[q][k]) : "");
  const f = await formulaire(`Attente aux quais — ${c.ref}`, [
    { name: "ca", label: `Arrivée au chargement${c.origine ? " — " + c.origine : ""}`, type: "datetime-local", value: v("chargement", "arrivee") },
    { name: "cd", label: "Départ du chargement", type: "datetime-local", value: v("chargement", "depart") },
    { name: "la", label: `Arrivée à la livraison${c.destination ? " — " + c.destination : ""}`, type: "datetime-local", value: v("livraison", "arrivee") },
    { name: "ld", label: "Départ de la livraison", type: "datetime-local", value: v("livraison", "depart") },
  ], { valider: "Enregistrer", aide: `Franchise de ${esc(nomClient(c.clientId))} : ${dureeQuai(conditionsAttente(c).franchiseH * 60)} par quai ; tarif : ${conditionsAttente(c).tarif ? `${conditionsAttente(c).tarif} ${conditionsAttente(c).devise === "EUR" ? "€" : "MAD"}/h` : "à fixer sur la fiche du client"}.` });
  if (!f) return;
  try {
    for (const [q, a, d] of [["chargement", f.ca, f.cd], ["livraison", f.la, f.ld]]) {
      if (c.quais?.[q]?.facture) continue; // déjà facturé : on ne touche plus
      if (!a) { if (c.quais) delete c.quais[q]; continue; }
      arriveeQuai(c, q, new Date(a).toISOString(), { forcer: true });
      if (d) departQuai(c, q, new Date(d).toISOString()); else delete c.quais[q].depart;
    }
  } catch (e) { return toast(e.message, "danger"); }
  sauver(); toast("Attente aux quais enregistrée"); rafraichir();
}
/** Facture séparée de l'attente, pour une commande déjà facturée. */
function facturerAttente(c) {
  const lignes = lignesAttente(c); if (!lignes.length) return toast("Rien à facturer.", "warn");
  const cl = parId(S.clients, c.clientId), date = today(), devise = lignes[0].devise;
  const f = { id: uid(), numero: prochainNumero("FAC", S.factures, "numero"), clientId: c.clientId, commandeIds: [], date, echeance: dateISO(Date.parse(date + "T00:00:00Z") + (cl?.delai ?? S.params.delaiPaiement) * 86400000), devise, tva: S.params.tvaDefaut, statut: "emise", lignes: [] };
  const n = ajouterAttentesFacture(f, [c]); S.factures.push(f); sauver();
  toast(`Facture ${f.numero} : ${n} ligne(s) d'attente · ${fmtDevise(totauxFacture(f).ttc, f.devise)}`); rafraichir();
}
function resumeAttenteCommande(c) {
  const l = QUAIS.map(([q, lib]) => ({ q, lib, a: attenteQuai(c, q) })).filter((x) => x.a);
  if (!l.length) return null;
  const montant = l.reduce((s, x) => s + (x.a.facture ? 0 : x.a.montant), 0), auDela = l.reduce((s, x) => s + x.a.auDelaMin, 0), k = conditionsAttente(c);
  return { l, montant, auDela, k, facturable: montant > 0, dejaFacturee: !!(typeof factureDeCommande === "function" ? factureDeCommande(c) : c.factureId) };
}
function puceAttente(c) {
  const r = resumeAttenteCommande(c); if (!r || !r.auDela) return "";
  return `<button type="button" class="puce-docs ${r.facturable ? "warn" : r.k.tarif ? "ok" : "neutre"}" data-act="attente" data-id="${c.id}" title="Attente aux quais au-delà de la franchise">${ic("clock")}${dureeQuai(r.auDela)} d'attente${r.facturable ? ` · ${fmtDevise(r.montant, r.k.devise)}` : r.k.tarif ? " · facturée" : " · tarif à fixer"}</button>`;
}
function blocAttentesVoyage(v) {
  if (v.statut === "annule") return "";
  const cmds = [["Aller", commandeAller(v)], ["Retour", commandeRetour(v)]].filter(([, c]) => c);
  if (!cmds.length) return "";
  const lignes = cmds.map(([sens, c]) => {
    const r = resumeAttenteCommande(c);
    const detail = r ? r.l.map((x) => `${x.lib} : ${x.a.enCours ? `sur place depuis ${hmQuai(x.a.arrivee)}` : dureeQuai(x.a.minutes)}${x.a.auDelaMin ? ` (${dureeQuai(x.a.auDelaMin)} au-delà)` : ""}${x.a.facture ? " · facturé" : ""}${c.quais?.[x.q]?.sourceArrivee === "gps" || c.quais?.[x.q]?.sourceDepart === "gps" ? " · GPS" : ""}`).join(" · ") : "Arrivée et départ des quais non notés (le chauffeur les note, ou corrigez ici).";
    const action = r?.facturable ? (r.dejaFacturee ? btn("attente-facturer", `Facturer ${fmtDevise(r.montant, r.k.devise)}`, { id: c.id, icone: "receipt", cls: "btn sm" }) : `<span class="sub">${fmtDevise(r.montant, r.k.devise)} : ajouté à la facture du ${c.id === v.commandeId ? "voyage" : "retour"}</span>`) : r?.auDela && !r.k.tarif ? `<span class="sub">tarif à fixer</span>` : "";
    return `<div class="trav"><div><strong>${sens} · ${esc(c.ref)} · ${esc(nomClient(c.clientId))}</strong><span class="sub">${detail}</span></div><div class="r">${action}${btn("attente", "Noter", { id: c.id, cls: "btn ghost sm", icone: "clock" })}</div></div>`;
  });
  const sansSite = cmds.some(([, c]) => QUAIS.some(([q]) => !quaiDe(c, q)?.depart && typeof siteQuai === "function" && !siteQuai(c, q, v)));
  return `<div class="section-title">Attente aux quais</div>${lignes.join("")}${sansSite ? `<p class="hint">Le GPS note seul l'arrivée et le départ d'un quai dont il connaît l'endroit : il le retient la première fois que l'arrivée est notée (par le chauffeur ou ici) pendant que le camion est sur place, pour ce client et cette ville.</p>` : ""}`;
}
if (typeof enregistrerBlocVoyage === "function") enregistrerBlocVoyage({ onglet: ongletArgentOuSuivi, ordre: 45, rendu: blocAttentesVoyage });
surAction(["commandes", "voyages"], ["attente", "attente-facturer"], async (act, id) => { const c = parId(S.commandes, id); if (!c) return; const l = typeof voyageDeCommande === "function" && voyageDeCommande(c); if (l) voyagesOuverts.add(l.v.id); return act === "attente" ? corrigerQuais(c) : facturerAttente(c); });

/* ---------- page Factures : l'argent de l'attente ---------- */
if (VUES.factures) {
    blocPage("factures", { position: "avant", ordre: 10, rendu() {
    const html = "", s = syntheseAttentes(dateISO(Date.now() - 30 * 86400000));
    if (!s.auDelaMin) return html;
    return `<div class="card attente-synthese"><div class="card-head"><h2>Attente aux quais · 30 jours</h2>${s.facturableMad ? badge(`${fmt(s.facturableMad)} MAD à facturer`, "warn") : ""}</div>
      <p style="margin:0">${dureeQuai(s.auDelaMin)} au-delà des franchises sur ${s.quais} quai(s)${s.factureMad ? ` · ${fmt(s.factureMad)} MAD déjà facturés` : ""}${s.sansTarifMin ? ` · <strong>${dureeQuai(s.sansTarifMin)} sans tarif</strong> : fixez un tarif d'attente sur la fiche des clients concernés` : ""}.</p></div>` + html;
  } });
}

/* ---------- arrivée et départ des quais par le GPS (quais_gps.js) ---------- */
/** Position GPS du camion à un instant (à 10 minutes près) s'il était arrêté : [lat, lon] ou null. */
function positionAuMoment(points, t) {
  const proches = (points || []).filter((p) => Math.abs(p[0] - t) <= 600); if (!proches.length) return null;
  const p = proches.sort((a, b) => Math.abs(a[0] - t) - Math.abs(b[0] - t))[0];
  return proches.every((x) => distQuaiM([x[1], x[2]], [p[1], p[2]]) <= 200) ? [p[1], p[2]] : null;
}
/** Toutes les 2 minutes : sites appris (arrivée notée à la main pendant un arrêt) puis arrivées et départs posés par le GPS. */
function surveillerQuais() {
  if (typeof histDuVoyage !== "function") return;
  let change = false; const messages = [];
  for (const v of S.voyages.filter((x) => x.statut === "en_cours")) {
    const h = histDuVoyage(v); if (!h || h.length < 2) continue;
    for (const c of [commandeAller(v), commandeRetour(v)].filter(Boolean)) for (const [q] of QUAIS) {
      const x = quaiDe(c, q);
      if (x?.arrivee && x.sourceArrivee !== "gps" && !siteQuai(c, q, v)) { const pos = positionAuMoment(h, Date.parse(x.arrivee) / 1000); if (pos && apprendreSiteQuai(c, q, pos)) { change = true; messages.push(`${nomClient(c.clientId)} : emplacement du quai de ${q} retenu`); } }
      const debut = Date.parse(`${q === "chargement" ? c.dateChargement || v.dateDepart : v.dateDepart}T00:00:00Z`) / 1000 - 86400;
      const effets = appliquerQuaiGps(c, q, h, { v, depuis: Number.isFinite(debut) ? debut : 0 });
      if (effets.length) { change = true; messages.push(`${v.ref} · ${c.ref} : ${effets.join(", ")} (GPS)`); }
    }
  }
  if (!change) return;
  sauver(); for (const m of messages) { toast(m, "ok"); if (typeof ajouterFil === "function") ajouterFil(m); }
  if (["voyages", "commandes"].includes(ongletActif) && !document.querySelector("dialog[open]")) rafraichir();
}
function quaisDemarrer() { setInterval(() => { try { surveillerQuais(); } catch (e) { console.warn("Quais (GPS) :", e); } }, 2 * 60000); setTimeout(() => { try { surveillerQuais(); } catch { /* réessayé */ } }, 9000); }
