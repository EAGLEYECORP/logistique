"use strict";
/* ============================================================
   Transport international (phase 0) : voyages, traversée du détroit,
   autorisations bilatérales, Schengen, péages Autoroutes du Maroc.
   Chargé après commercial.js (réutilise l'interface de app.js).
   ============================================================ */

const optsAutorisations = () => [["", "— Aucune —"], ...S.autorisations.map((a) => [a.id, `${a.type === "MA" ? "MA" : "E"} · ${a.numero || "sans n°"}${a.fin ? " · jusqu'au " + dateFr(a.fin) : ""}`])];
const libLigne = (k) => LIGNES_TRAVERSEE[k]?.lib || "—";
const nomJalon = (k) => JALONS_VOYAGE.find(([c]) => c === k)?.[1] || k;
const classeTexte = (c) => ({ 1: "classe 1", 2: "classe 2", 3: "classe 3" }[c] || "classe 3 (par défaut)");
const niveauCtl = { danger: "danger", warn: "warn" };
let voyagesOuverts = new Set();
let ongletCheck = {};

/* ---------- Traversées : le passage Tanger Med ⇄ Algeciras est dans chaque voyage ---------- */
const traversee = (v, sens) => (v.traversees || []).find((t) => t.sens === sens);
function nouvelleTraversee(sens, ligne) {
  return { sens, ligne, armateur: "", date: "", heure: "", ml: 16.5, fret: "", baf: "", ets: "", lss: "", fueleu: "", chauffeur: "", frigo: "", ref: "", statut: "a_reserver", ...LIGNES_TRAVERSEE[ligne].defauts };
}
const STATUTS_TRAV = [["a_reserver", "À réserver"], ["reservee", "Réservée"], ["effectuee", "Effectuée"]];
const champsTraversee = (t) => [
  { name: "ligne", label: "Ligne", type: "select", options: Object.entries(LIGNES_TRAVERSEE).map(([k, l]) => [k, l.lib]), value: t.ligne },
  { name: "armateur", label: "Armateur", value: t.armateur, placeholder: "DFDS, Baleària, FRS, Armas, GNV…" },
  { name: "date", label: "Date de traversée", type: "date", value: t.date },
  { name: "heure", label: "Heure de départ", type: "time", value: t.heure },
  { name: "ml", label: "Mètres linéaires réservés", type: "number", min: 0, value: t.ml },
  { name: "ref", label: "N° de réservation", value: t.ref },
  { name: "statut", label: "Statut", type: "select", options: STATUTS_TRAV, value: t.statut, full: true },
  { name: "fret", label: "Fret de base (€)", type: "number", min: 0, value: t.fret },
  { name: "baf", label: "BAF carburant (€/ml)", type: "number", min: 0, value: t.baf },
  { name: "ets", label: "ETS (€/ml)", type: "number", min: 0, value: t.ets },
  { name: "lss", label: "Soufre LSS (€/ml)", type: "number", min: 0, value: t.lss },
  { name: "fueleu", label: "FuelEU (€/ml)", type: "number", min: 0, value: t.fueleu },
  { name: "chauffeur", label: "Passage chauffeur (€)", type: "number", min: 0, value: t.chauffeur },
  { name: "frigo", label: "Prise frigorifique (€)", type: "number", min: 0, value: t.frigo },
  { name: "appliquer", label: "Remplir avec les tarifs habituels de la ligne choisie (écrase les montants ci-dessus)", type: "checkbox", full: true },
];
function lireTraversee(v, t) {
  const o = { sens: t.sens, ligne: v.ligne, armateur: v.armateur, date: v.date, heure: v.heure, ml: num(v.ml), ref: v.ref, statut: v.statut };
  const defs = v.appliquer ? LIGNES_TRAVERSEE[v.ligne].defauts : {};
  for (const k of ["fret", "baf", "ets", "lss", "fueleu", "chauffeur", "frigo"]) o[k] = k in defs ? defs[k] : v[k] === "" ? "" : num(v[k]);
  return o;
}
function blocTraversee(voy, sens) {
  const t = traversee(voy, sens);
  const titre = sens === "aller" ? "Aller" : "Retour";
  if (!t) return `<div class="trav vide"><div><strong>${titre}</strong><span class="sub">Non renseignée</span></div>${btn("trav", "Ajouter", { id: `${voy.id}|${sens}`, cls: "btn ghost sm", icone: "plus" })}</div>`;
  const cout = coutTraversee(t);
  const L = LIGNES_TRAVERSEE[t.ligne];
  const niv = t.statut === "effectuee" ? "ok" : t.statut === "reservee" ? "neutral" : "warn";
  const detroit = traverseeDetroit(t);
  return `<div class="trav ${detroit ? "detroit" : ""}">
    <div>
      <strong>${titre} · ${esc(L?.lib || "")}</strong> ${badge(STATUTS_TRAV.find(([k]) => k === t.statut)?.[1] || "", niv)}
      <span class="sub">${[t.armateur, t.date && dateFr(t.date) + (t.heure ? " " + t.heure : ""), t.ml && fmt(t.ml, 1) + " ml", t.ref && "réf. " + t.ref, L?.duree].filter(Boolean).map(esc).join(" · ")}</span>
      ${t.statut === "a_reserver" && detroit ? `<span class="sub">Présentation au port environ 3 h avant le départ.</span>` : ""}
    </div>
    <div class="r"><strong class="num">${cout ? fmt(cout, 2) + " €" : "—"}</strong><span class="sub">${cout ? `≈ ${fmt(cout * S.params.tauxEUR)} MAD` : "devis à saisir"}</span>
      ${btn("trav", "Modifier", { id: `${voy.id}|${sens}`, cls: "btn ghost sm", icone: "edit" })}</div>
  </div>`;
}

/* ---------- Voyages ---------- */
const champsVoyage = (v = {}) => [
  { name: "ref", label: "Référence", required: true, value: v.ref ?? `V-${new Date().getFullYear()}-${String(S.voyages.length + 1).padStart(4, "0")}` },
  { name: "statut", label: "Statut", type: "select", options: STATUTS_VOYAGE, value: v.statut || "prevu" },
  { name: "clientId", label: "Client", type: "select", options: optsClients("— Aucun —"), value: v.clientId },
  { name: "commandeId", label: "Commande liée (comptée une seule fois dans la rentabilité)", type: "select", options: [["", "— Aucune —"], ...S.commandes.map((c) => [c.id, `${c.ref} · ${nomClient(c.clientId)}`])], value: v.commandeId },
  { name: "marchandise", label: "Marchandise", value: v.marchandise },
  { name: "origine", label: "Départ (ville)", value: v.origine, required: true, placeholder: "Agadir" },
  { name: "destination", label: "Destination (ville)", value: v.destination, required: true, placeholder: "Perpignan" },
  { name: "dateDepart", label: "Départ prévu", type: "date", value: v.dateDepart || today(), required: true },
  { name: "dateRetourPrevue", label: "Retour au dépôt prévu", type: "date", value: v.dateRetourPrevue, required: true },
  { name: "livraisonPrevue", label: "Livraison promise au client (date et heure)", type: "datetime-local", value: v.livraisonPrevue ? dateISO(v.livraisonPrevue) + "T" + new Date(v.livraisonPrevue).toTimeString().slice(0, 5) : "" },
  { name: "destLat", label: "Destination : latitude (vide = ville reconnue)", type: "number", step: "any", value: v.destLat },
  { name: "destLon", label: "Destination : longitude", type: "number", step: "any", value: v.destLon },
  { name: "chauffeurId", label: "Chauffeur", type: "select", options: [["", "— À affecter —"], ...S.chauffeurs.map((h) => [h.id, h.nom])], value: v.chauffeurId },
  { name: "camionId", label: "Camion", type: "select", options: optsCamions("— À affecter —"), value: v.camionId },
  { name: "remorque", label: "Remorque", value: v.remorque },
  { name: "autorisationId", label: "Autorisation bilatérale utilisée", type: "select", options: optsAutorisations(), value: v.autorisationId },
  { name: "ptacT", label: "PTAC prévu (tonnes)", type: "number", min: 0, value: v.ptacT },
  { name: "transportCombine", label: "Transport combiné (conteneur 40 pieds : 44 t)", type: "checkbox", value: v.transportCombine },
  { name: "prix", label: "Prix de vente", type: "number", min: 0, value: v.prix },
  { name: "devise", label: "Devise", type: "select", options: optsDevise, value: v.devise || "EUR" },
  { name: "peageTrajet", label: "Péage Maroc : trajet type (grille ADM)", type: "select", options: [["", "— Saisie manuelle ci-dessous —"], ...ADM_TRAJETS.map((t) => [t.id, t.lib])], value: v.peageTrajet },
  { name: "peageAR", label: "Compter aussi le péage au retour", type: "checkbox", value: v.peageAR },
  { name: "peagesMad", label: "Péages Maroc, saisie manuelle (MAD)", type: "number", min: 0, value: v.peagesMad },
  { name: "peageFr1", label: "Péage France (VINCI, tarif officiel) : liaison 1", type: "select", options: [["", "— Aucune —"], ...FR_LIAISONS.map((l) => [l[1], `${l[1]} (${l[0]})`])], value: v.peageFr1 },
  { name: "peageFr2", label: "Péage France : liaison 2", type: "select", options: [["", "— Aucune —"], ...FR_LIAISONS.map((l) => [l[1], `${l[1]} (${l[0]})`])], value: v.peageFr2 },
  { name: "peageFr3", label: "Péage France : liaison 3", type: "select", options: [["", "— Aucune —"], ...FR_LIAISONS.map((l) => [l[1], `${l[1]} (${l[0]})`])], value: v.peageFr3 },
  { name: "peageFrAR", label: "Compter aussi le péage France au retour", type: "checkbox", value: v.peageFrAR },
  { name: "kmPays", label: "Km par pays pour estimer les péages d'Europe (ex. ES 950, FR 880)", value: v.kmPays, full: true, placeholder: "ES 950, FR 880" },
  { name: "peagesEur", label: "Péages Europe, saisie manuelle (€)", type: "number", min: 0, value: v.peagesEur },
  { name: "tempMin", label: "Chaîne du froid : consigne minimale (°C)", type: "number", step: "any", value: v.tempMin },
  { name: "tempMax", label: "Chaîne du froid : consigne maximale (°C)", type: "number", step: "any", value: v.tempMax },
  { name: "carburantMad", label: "Carburant (MAD)", type: "number", min: 0, value: v.carburantMad },
  { name: "fraisRouteMad", label: "Per diem, hôtel, parkings (MAD)", type: "number", min: 0, value: v.fraisRouteMad },
  { name: "douaneMad", label: "Frais de douane / transit (MAD)", type: "number", min: 0, value: v.douaneMad },
  { name: "autresMad", label: "Autres frais (MAD)", type: "number", min: 0, value: v.autresMad },
  { name: "kmAller", label: "Km aller (chargé)", type: "number", min: 0, value: v.kmAller },
  { name: "kmRetourCharge", label: "Km retour chargé", type: "number", min: 0, value: v.kmRetourCharge },
  { name: "kmRetourVide", label: "Km retour à vide", type: "number", min: 0, value: v.kmRetourVide },
  { name: "notes", label: "Notes", type: "textarea", full: true, value: v.notes },
];
const lireVoyage = (f) => ({
  ref: f.ref, statut: f.statut, clientId: f.clientId, commandeId: f.commandeId, marchandise: f.marchandise, origine: f.origine, destination: f.destination, dateDepart: f.dateDepart, dateRetourPrevue: f.dateRetourPrevue,
  chauffeurId: f.chauffeurId, camionId: f.camionId, remorque: f.remorque, autorisationId: f.autorisationId, ptacT: num(f.ptacT), transportCombine: !!f.transportCombine,
  livraisonPrevue: f.livraisonPrevue ? new Date(f.livraisonPrevue).toISOString() : "", destLat: f.destLat === "" ? undefined : num(f.destLat), destLon: f.destLon === "" ? undefined : num(f.destLon),
  prix: num(f.prix), devise: f.devise, peageTrajet: f.peageTrajet, peageAR: !!f.peageAR, peagesMad: num(f.peagesMad), peagesEur: num(f.peagesEur), kmPays: f.kmPays, peageFr1: f.peageFr1, peageFr2: f.peageFr2, peageFr3: f.peageFr3, peageFrAR: !!f.peageFrAR, tempMin: f.tempMin === "" ? undefined : num(f.tempMin), tempMax: f.tempMax === "" ? undefined : num(f.tempMax), carburantMad: num(f.carburantMad),
  fraisRouteMad: num(f.fraisRouteMad), douaneMad: num(f.douaneMad), autresMad: num(f.autresMad), kmAller: num(f.kmAller), kmRetourCharge: num(f.kmRetourCharge), kmRetourVide: num(f.kmRetourVide), notes: f.notes,
});
/** Coordonnées de la destination et de l'origine : saisies, sinon ville reconnue. */
const destinationDe = (v) => (Number.isFinite(v.destLat) && Number.isFinite(v.destLon) ? [v.destLat, v.destLon] : villeConnue(v.destination));
const origineDe = (v) => villeConnue(v.origine);
const niveauStatutVoyage = { prevu: "neutral", en_cours: "warn", termine: "ok", annule: "neutral" };

/** Arrivée estimée (si le suivi en direct est actif pour ce camion). */
function blocEta(v) {
  if (!["prevu", "en_cours"].includes(v.statut) || typeof etaDuVoyage !== "function") return "";
  const e = etaDuVoyage(v);
  if (!e) return destinationDe(v) ? "" : `<p class="hint">Pour estimer l'heure d'arrivée, précisez la destination (ville connue, ou latitude et longitude).</p>`;
  const hm = (t) => new Date(t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const d = (t) => new Date(t * 1000).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `<div class="section-title">Arrivée estimée</div><div class="trav"><div><strong>${d(e.arrivee)}</strong><span class="sub">${e.fourchetteMin ? `± ${e.fourchetteMin >= 90 ? fmt(e.fourchetteMin / 60, 1) + " h" : e.fourchetteMin + " min"} · ` : ""}entre ${hm(e.min)} et ${hm(e.max)} · ${fmt(e.kmRestants)} km restants · ${e.pauses} pause(s) et ${e.reposJournaliers} repos de 11 h${e.traversee ? " · traversée du détroit comprise" : ""}</span></div>
    <div class="r">${e.retardMin !== null ? badge(e.retardMin > 30 ? `Retard probable ${Math.round(e.retardMin / 6) / 10} h` : e.retardMin < -30 ? "En avance" : "Dans les temps", e.retardMin > 60 ? "danger" : e.retardMin > 30 ? "warn" : "ok") : ""}</div></div>
    <p class="hint" style="margin-top:6px">${e.source === "operateur_calibre" ? "Calée sur vos attentes mesurées aux ports." : e.source === "mesure" ? "Ports franchis : attentes réelles prises en compte." : "Attentes aux ports : estimation générique tant que vos mesures sont trop peu nombreuses."} Distance à vol d'oiseau avec détour, vitesse récente, repos réglementaires.</p>`;
}
/** Chaîne du froid : analyse des températures des traces rattachées au voyage. */
function blocFroid(v) {
  const traces = S.traces.filter((t) => t.voyageId === v.id && t.temps?.length);
  if (!traces.length) return "";
  const pts = traces.flatMap((t) => t.temps).sort((a, b) => a[0] - b[0]);
  const consigne = Number.isFinite(v.tempMin) && Number.isFinite(v.tempMax);
  const r = consigne ? froidAnalyser(pts, v.tempMin, v.tempMax) : null, brut = froidAnalyser(pts, -100, 100);
  const hm = (t) => new Date(t * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `<div class="section-title">Chaîne du froid</div><div class="trav"><div><strong>${String(brut.min.toFixed(1)).replace(".", ",")} à ${String(brut.max.toFixed(1)).replace(".", ",")} °C</strong><span class="sub">moyenne ${String(brut.moyenne.toFixed(1)).replace(".", ",")} °C · ${brut.nb} mesure(s)${consigne ? ` · consigne ${v.tempMin} à ${v.tempMax} °C` : ""}</span></div><div class="r">${r ? badge(r.conforme ? "Conforme" : `${r.excursions.length} excursion(s)`, r.conforme ? "ok" : "danger") : badge("Consigne non renseignée", "neutral")}</div></div>
    ${r && r.excursions.length ? `<ul class="ctl">${r.excursions.map((e) => `<li class="danger">${ic("alert")}<span>${hm(e.debut)} : ${e.sens === "haut" ? "au-dessus" : "en dessous"} de la consigne pendant ${e.dureeMin} min (extrême ${String(e.extreme).replace(".", ",")} °C)</span></li>`).join("")}</ul>` : ""}`;
}
/** Preuve de livraison (signature, réserves, position). */
function blocPreuve(v) {
  if (!v.pod) return "";
  return `<div class="section-title">Preuve de livraison</div><div class="trav"><div><strong>Livré${v.pod.signataire ? ` à ${esc(v.pod.signataire)}` : ""}</strong><span class="sub">${dateHeureFr(v.pod.date)}${v.pod.lat ? ` · position ${v.pod.lat.toFixed(4)}, ${v.pod.lon.toFixed(4)}` : ""}${v.pod.reserves ? ` · réserves : ${esc(v.pod.reserves)}` : " · sans réserve"}</span></div><div class="r">${btn("preuve-imprimer", "Imprimer", { id: v.id, icone: "print", cls: "btn ghost sm" })}</div></div>`;
}
function carteVoyage(v) {
  const c = coutVoyage(v);
  const ctl = ["prevu", "en_cours"].includes(v.statut) ? controlesVoyage(v) : [];
  const jalons = v.jalons || [];
  const prochain = JALONS_VOYAGE.find(([k]) => !jalons.some((j) => j.type === k));
  const cam = parId(S.camions, v.camionId);
  const cls = classeADM(cam);
  const ck = ongletCheck[v.id] || "depart";
  const items = CHECKLISTS_VOYAGE[ck];
  const faits = items.filter((_, i) => v.coches?.[ck]?.[i]).length;
  const dateD = v.dateDepart;
  const interd = dateD ? interdictionsLe(dateD, INTERDICTIONS) : [];
  const parts = [["Péages Maroc", c.parts.peagesMaroc], ["Péages France (VINCI)", c.parts.peagesFrance], ["Péages Europe", c.parts.peagesEurope], ["Traversées (aller + retour)", c.parts.traversees], ["Carburant", c.parts.carburant], ["Per diem, hôtel", c.parts.fraisRoute], ["Douane", c.parts.douane], ["Énergie du groupe froid", c.parts.froid], ["Amendes", c.parts.amendes], ["Dépannage, pneus en route", c.parts.maintien], ["Autres", c.parts.autres]];
  return `<details class="card dossier" data-voyage="${v.id}" ${voyagesOuverts.has(v.id) ? "open" : ""}>
    <summary>
      <div><strong>${esc(v.ref)}</strong> · ${esc(v.origine)} ⇄ ${esc(v.destination)}${v.clientId ? " · " + esc(nomClient(v.clientId)) : ""}
        <div class="meta">${[dateFr(v.dateDepart) + " → " + dateFr(v.dateRetourPrevue), v.chauffeurId && nomChauffeur(v.chauffeurId), v.camionId && nomCamion(v.camionId), v.marchandise].filter(Boolean).map(esc).join(" · ")}</div></div>
      <div class="row">${pastilleMarge(v)}${ctl.filter((x) => x.niveau === "danger").length ? badge(`${ctl.filter((x) => x.niveau === "danger").length} blocage(s)`, "danger") : ctl.length ? badge(`${ctl.length} point(s)`, "warn") : ""}${badge(STATUTS_VOYAGE.find(([k]) => k === v.statut)?.[1], niveauStatutVoyage[v.statut])}</div>
    </summary>
    <div class="body">
      <div class="section-title" style="margin-top:4px">Traversée du détroit (Tanger Med ⇄ Algeciras)</div>
      ${blocTraversee(v, "aller")}${blocTraversee(v, "retour")}
      ${ctl.length ? `<div class="section-title">À régler avant le départ</div><ul class="ctl">${ctl.map((x) => `<li class="${niveauCtl[x.niveau]}">${ic(x.niveau === "danger" ? "alert" : "clock")}<span>${esc(x.texte)}</span></li>`).join("")}</ul>` : v.statut === "prevu" ? `<p class="hint" style="color:var(--ok)">${ic("check")} Aucun point bloquant détecté.</p>` : ""}
      ${interd.length ? `<p class="hint">Départ un ${new Date(dateD + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long" })} : interdictions de circuler possibles (${interd.map((i) => i.pays).join(", ")}) — voir le tableau en bas de page.</p>` : ""}
      ${blocEta(v)}${typeof blocAttentesPort === "function" ? blocAttentesPort(v) : ""}${blocFroid(v)}${blocPreuve(v)}
      <div class="fin"><div class="section-title">Coût et marge</div>
      <div class="table-wrap"><table class="plain"><tbody>
        ${v.kmPays && peagesEuropeVoyage(v).manquants.length ? `<tr><td colspan="2" class="sub">Péages d'Europe : tarif au km non renseigné pour ${peagesEuropeVoyage(v).manquants.join(", ")} (Réglages → calculs) — ces pays ne sont pas comptés.</td></tr>` : ""}
        ${parts.filter(([, m]) => m).map(([l, m]) => `<tr><td>${l}${l === "Péages France (VINCI)" ? `<span class="sub">${peagesFranceVoyage(v).detail.map((d) => `${esc(d.liaison)} ${fmt(d.eur, 2)} €`).join(" · ")}${v.peageFrAR ? " ×2" : ""} · classe ${peagesFranceVoyage(v).classe} · tarif officiel du ${dateFr(FR_LIAISONS_DATE)}</span>` : ""}${l === "Péages Europe" && v.peagesEurReel ? `<span class="sub">relevé de télépéage : ${Object.entries(v.peagesEurPays || {}).map(([p, m]) => `${p} ${fmt(m, 2)} €`).join(", ") || "total du relevé"}</span>` : ""}${l === "Péages Maroc" && v.peageTrajet ? `<span class="sub">${esc(ADM_TRAJETS.find((t) => t.id === v.peageTrajet)?.lib || "")}${v.peageAR ? " ×2" : ""} · ${classeTexte(cls)}</span>` : ""}</td><td class="r num">${fmt(m)} MAD</td></tr>`).join("") || `<tr><td colspan="2" class="sub">Aucun coût saisi</td></tr>`}
        <tr><td><strong>Coût total</strong></td><td class="r num"><strong>${fmt(c.total)} MAD</strong></td></tr>
        <tr><td>Prix de vente</td><td class="r num">${c.prix ? fmt(c.prix) + " MAD" : "—"}</td></tr>
        <tr><td><strong>Marge directe</strong></td><td class="r num ${c.marge < 0 ? "neg" : ""}"><strong>${c.prix ? `${fmt(c.marge)} MAD · ${fmt(c.taux, 1)} %` : "—"}</strong></td></tr>
        ${lignesMargeNette(v)}
        ${num(v.kmGps) ? `<tr><td>Distance mesurée par le GPS</td><td class="r num">${fmt(v.kmGps)} km</td></tr>` : ""}
        ${c.km ? `<tr><td>Coût au km (${fmt(c.km)} km)</td><td class="r num">${fmt(c.coutKm, 2)} MAD/km</td></tr>` : ""}
        ${num(v.kmRetourVide) ? `<tr><td>Retour à vide</td><td class="r num">${fmt(v.kmRetourVide)} km · ≈ ${fmt(c.coutKm * num(v.kmRetourVide))} MAD</td></tr>` : ""}
      </tbody></table></div>${blocLignesCout(v)}</div>
      <div class="section-title">Étapes</div>
      <ol class="timeline">${JALONS_VOYAGE.map(([k, l]) => { const j = jalons.find((x) => x.type === k); return `<li class="${j ? "fait" : ""}"><span class="pt"></span><div><strong>${esc(l)}</strong>${j ? `<span class="sub">${dateHeureFr(j.date)}${j.source === "gps" ? " · " + badge("GPS", "ok") : ""}${(v.notifsJalons || []).includes(k) ? " · notifié" : ""}</span>` : ""}</div>${j && v.statut !== "annule" ? iconBtn("notifier-jalon", "mail", "Notifier", `${v.id}|${k}`) : ""}</li>`; }).join("")}</ol>
      <div class="row">${prochain && v.statut !== "annule" ? btn("jalon", `Marquer : ${prochain[1]}`, { id: v.id, icone: "flag", cls: "btn sm" }) : ""}${jalons.length ? btn("annuler-jalon", "Annuler la dernière étape", { id: v.id, cls: "btn ghost sm" }) : ""}</div>
      <div class="section-title">Listes de contrôle</div>
      <div class="segmented">${Object.entries(LIB_CHECKLISTS_VOYAGE).map(([k, l]) => `<button type="button" data-act="onglet-check" data-id="${v.id}|${k}" aria-selected="${k === ck}">${l}</button>`).join("")}</div>
      <div class="progress"><i style="width:${Math.round((faits / items.length) * 100)}%"></i></div>
      <div class="checklist">${items.map((it, i) => `<label class="check"><input type="checkbox" data-coche="${v.id}" data-ck="${ck}" data-i="${i}" ${v.coches?.[ck]?.[i] ? "checked" : ""}><span>${esc(it)}</span></label>`).join("")}</div>
      ${v.notes ? `<p class="hint">${esc(v.notes)}</p>` : ""}
      <div class="row">
        ${v.statut === "termine" ? "" : btn("terminer", "Terminer le voyage", { id: v.id, icone: "check", cls: "btn ghost sm" })}
        ${v.statut === "annule" ? "" : btn("preuve", v.pod ? "Refaire la preuve de livraison" : "Preuve de livraison", { id: v.id, icone: "check", cls: "btn ghost sm" })}
        ${v.statut === "annule" ? "" : btn("cmr", "CMR (impression)", { id: v.id, icone: "print", cls: "btn ghost sm" })}
        ${btn("releve-eu", "Relevé péages Europe", { id: v.id, icone: "upload", cls: "btn ghost sm", titre: "Importer le relevé CSV de votre fournisseur de télépéage (DKV, UTA, Eurowag, Telepass…)" })}
        ${btn("dossier", "Dossier complet", { id: v.id, icone: "file", cls: "btn ghost sm", titre: "Tout le voyage en un document : papiers, étapes, traversées, preuve de livraison, trace, photos" })}
        ${btn("partager", v.partage ? "Lien client" : "Partager le suivi", { id: v.id, icone: "mail", cls: "btn ghost sm" })}
        ${boutonPhotos("voyage:" + v.id, `Documents — ${v.ref}`, { texte: true })}
        ${btn("modifier", "Modifier", { id: v.id, icone: "edit", cls: "btn ghost sm" })}
        ${btn("suppr", "Supprimer", { id: v.id, cls: "btn text-danger sm" })}
      </div>
    </div></details>`;
}

VUES.voyages = {
  titre: "Voyages",
  sous: "Maroc ⇄ Europe : aller, traversée du détroit, retour, coût et marge",
  actions: () => btn("ajouter", "Nouveau voyage", { icone: "plus" }),
  rendu() {
    if (!S.voyages.length) return `<div class="card">${vide("ship", "Aucun voyage", "Un voyage regroupe l'aller, la traversée Tanger Med ⇄ Algeciras, le retour, les papiers, les coûts et la marge.", btn("ajouter", "Nouveau voyage", { icone: "plus" }))}</div>${aideInterdictions()}`;
    const rv = retourVide(S.voyages);
    const actifs = S.voyages.filter((v) => ["prevu", "en_cours"].includes(v.statut));
    const finis = S.voyages.filter((v) => v.statut === "termine");
    const avecPrix = S.voyages.filter((v) => v.statut !== "annule" && num(v.prix));
    const marge = avecPrix.reduce((s, v) => s + coutVoyage(v).marge, 0);
    const aReserver = S.voyages.filter((v) => ["prevu", "en_cours"].includes(v.statut)).reduce((n, v) => n + (v.traversees || []).filter((t) => t.statut === "a_reserver").length, 0);
    const tri = (a, b) => (a.dateDepart || "").localeCompare(b.dateDepart || "");
    return `<div class="kpis">
      <div class="kpi"><div class="l">${ic("ship")} Voyages en cours / prévus</div><div class="v">${actifs.length}</div><div class="s">${finis.length} terminé(s)</div></div>
      <div class="kpi"><div class="l">${ic("ship")} Traversées à réserver</div><div class="v">${aReserver}</div><div class="s ${aReserver ? "warn" : ""}">${aReserver ? "à confirmer auprès des armateurs" : "tout est réservé"}</div></div>
      <div class="kpi fin"><div class="l">${ic("receipt")} Marge cumulée</div><div class="v">${fmt(marge)} <small>MAD</small></div><div class="s ${marge < 0 ? "danger" : ""}">${avecPrix.length} voyage(s) avec prix</div></div>
      <div class="kpi"><div class="l">${ic("truck")} Retour à vide</div><div class="v">${fmt(rv.pct, 0)} <small>%</small></div><div class="s ${rv.pct > 30 ? "warn" : ""}">${fmt(rv.kmVide)} km · ≈ ${fmt(rv.coutVide)} MAD</div></div>
    </div>
    ${actifs.sort(tri).map(carteVoyage).join("")}
    ${finis.length ? `<div class="section-title">Terminés · ${finis.length}</div>${finis.sort((a, b) => tri(b, a)).map(carteVoyage).join("")}` : ""}
    ${S.voyages.filter((v) => v.statut === "annule").map(carteVoyage).join("")}
    ${aideInterdictions()}`;
  },
  apres() {
    document.querySelectorAll("details[data-voyage]").forEach((el) => el.addEventListener("toggle", () => { el.open ? voyagesOuverts.add(el.dataset.voyage) : voyagesOuverts.delete(el.dataset.voyage); }));
  },
  saisie(e) {
    const cb = e.target.closest("[data-coche]");
    if (!cb) return;
    const v = parId(S.voyages, cb.dataset.coche);
    ((v.coches ||= {})[cb.dataset.ck] ||= [])[+cb.dataset.i] = cb.checked;
    sauver(); rafraichir();
  },
  async agir(act, id) {
    const [vid, extra] = String(id).split("|");
    const v = parId(S.voyages, vid);
    if (act === "ajouter") {
      const f = await formulaire("Nouveau voyage", champsVoyage(), { valider: "Créer", aide: "Les deux traversées Tanger Med ⇄ Algeciras (aller et retour) sont créées automatiquement : complétez-les ensuite." });
      if (!f) return;
      const n = { id: uid(), ...lireVoyage(f), jalons: [], coches: {}, traversees: [nouvelleTraversee("aller", "tmed-alg"), nouvelleTraversee("retour", "alg-tmed")] };
      S.voyages.unshift(n); voyagesOuverts.add(n.id); sauver(); toast(`Voyage ${n.ref} créé`); rafraichir();
    }
    if (!v) return;
    if (act === "modifier") {
      const f = await formulaire(`Modifier ${v.ref}`, champsVoyage(v));
      if (f) { Object.assign(v, lireVoyage(f)); sauver(); toast("Voyage mis à jour"); rafraichir(); }
    }
    if (act === "trav") {
      const sens = extra;
      const t = traversee(v, sens) || nouvelleTraversee(sens, sens === "aller" ? "tmed-alg" : "alg-tmed");
      const f = await formulaire(`Traversée ${sens} — ${v.ref}`, champsTraversee(t), { aide: `Détroit : ${LIGNES_TRAVERSEE["tmed-alg"].note} Coût = fret + mètres linéaires × (BAF + ETS + soufre + FuelEU) + passage chauffeur + frigorifique.` });
      if (!f) return;
      const n = lireTraversee(f, t);
      v.traversees = [...(v.traversees || []).filter((x) => x.sens !== sens), n].sort((a, b) => (a.sens === "aller" ? -1 : 1));
      sauver(); toast(`Traversée ${sens} enregistrée`); rafraichir();
    }
    if (act === "onglet-check") { ongletCheck[vid] = extra; rafraichir(); }
    if (act === "jalon") {
      const prochain = JALONS_VOYAGE.find(([k]) => !(v.jalons || []).some((j) => j.type === k));
      if (!prochain) return;
      (v.jalons ||= []).push({ type: prochain[0], date: new Date().toISOString() });
      if (prochain[0] === "depart" && v.statut === "prevu") v.statut = "en_cours";
      const sens = prochain[0] === "embarque_aller" ? "aller" : prochain[0] === "embarque_retour" ? "retour" : null;
      const t = sens && traversee(v, sens); if (t) t.statut = "effectuee";
      if (prochain[0] === "retour") v.statut = "termine";
      sauver(); toast(prochain[1]); rafraichir();
    }
    if (act === "annuler-jalon") { const j = (v.jalons || []).pop(); if (j && v.statut === "termine" && j.type === "retour") v.statut = "en_cours"; sauver(); rafraichir(); }
    if (act === "terminer") { v.statut = "termine"; sauver(); toast(`Voyage ${v.ref} terminé`); rafraichir(); }
    if (act === "suppr" && (await confirmer(`Supprimer ${v.ref} ?`, "Cette action est définitive."))) {
      supprimerPhotosDe(`voyage:${vid}`); S.voyages = S.voyages.filter((x) => x.id !== vid); sauver(); rafraichir();
    }
  },
};
const aideInterdictions = () => `<div class="section-title">Interdictions de circuler des poids lourds (indicatif)</div>
  <div class="card"><div class="table-wrap"><table class="plain"><thead><tr><th>Pays</th><th>Règle générale (> 7,5 t)</th></tr></thead><tbody>${INTERDICTIONS.map((i) => `<tr><td><strong>${esc(i.pays)}</strong></td><td>${esc(i.texte)}</td></tr>`).join("")}</tbody></table></div>
  <p class="hint">Valeurs de départ <strong>à vérifier chaque année</strong> auprès des autorités de chaque pays : jours fériés, exceptions pour denrées périssables et variations régionales ne sont pas détaillés. Modifiable dans <code>data.js</code>.</p></div>`;

/* ---------- Autorisations bilatérales et Schengen ---------- */
const champsAutorisation = (a = {}) => [
  { name: "type", label: "Autorisation", type: "select", options: [["E", "« E » (délivrée par l'Espagne)"], ["MA", "« MA » (délivrée par le Maroc)"]], value: a.type || "E" },
  { name: "mode", label: "Validité", type: "select", options: [["voyage", "Au voyage (≤ 3 mois)"], ["temps", "À temps (annuelle)"]], value: a.mode || "voyage" },
  { name: "numero", label: "Numéro", value: a.numero },
  { name: "titulaire", label: "Transporteur titulaire (nominative, non transférable)", value: a.titulaire ?? S.entreprise?.nom ?? "" },
  { name: "debut", label: "Début de validité", type: "date", value: a.debut },
  { name: "fin", label: "Fin de validité", type: "date", value: a.fin },
  { name: "dateUtilisation", label: "Date d'utilisation (au voyage)", type: "date", value: a.dateUtilisation },
  { name: "compteRendu", label: "Compte-rendu de voyage remis", type: "checkbox", value: a.compteRendu },
  { name: "cloturee", label: "Clôturée (ne plus alerter)", type: "checkbox", value: a.cloturee },
  { name: "notes", label: "Notes", type: "textarea", full: true, value: a.notes },
];
const lireAutorisation = (f) => ({ type: f.type, mode: f.mode, numero: f.numero, titulaire: f.titulaire, debut: f.debut, fin: f.fin, dateUtilisation: f.dateUtilisation, compteRendu: !!f.compteRendu, cloturee: !!f.cloturee, notes: f.notes });
const champsSejour = (s = {}) => [
  { name: "entree", label: "Date d'entrée en Schengen", type: "date", value: s.entree || today(), required: true },
  { name: "sortie", label: "Date de sortie (vide = encore en Europe)", type: "date", value: s.sortie },
];
const autorisationActive = (a) => !a.cloturee && !(a.fin && joursAvant(a.fin) < 0) && !(a.mode === "voyage" && (a.dateUtilisation || a.voyageId));

VUES.international = {
  titre: "Autorisations & visas",
  sous: "Autorisations bilatérales « E » / « MA » et compteur Schengen 90/180",
  actions: () => btn("ajouter", "Nouvelle autorisation", { icone: "plus" }),
  rendu() {
    const dispo = (t) => S.autorisations.filter((a) => a.type === t && autorisationActive(a)).length;
    const crManquants = S.autorisations.filter((a) => a.dateUtilisation && !a.compteRendu).length;
    const lignes = [...S.autorisations].sort((a, b) => (a.fin || "9").localeCompare(b.fin || "9"));
    const sch = S.chauffeurs.map((c) => ({ c, e: schengenEtat(c.sejours) }));
    return `<div class="kpis">
      <div class="kpi"><div class="l">${ic("shield")} « E » disponibles</div><div class="v">${dispo("E")}</div><div class="s">valides, non utilisées</div></div>
      <div class="kpi"><div class="l">${ic("shield")} « MA » disponibles</div><div class="v">${dispo("MA")}</div><div class="s">valides, non utilisées</div></div>
      <div class="kpi"><div class="l">${ic("file")} Comptes-rendus à remettre</div><div class="v">${crManquants}</div><div class="s ${crManquants ? "warn" : ""}">${crManquants ? "après chaque voyage" : "à jour"}</div></div>
    </div>
    <div class="card">
      ${lignes.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Autorisation</th><th>Validité</th><th>Utilisation</th><th>Compte-rendu</th><th></th></tr></thead><tbody>
        ${lignes.map((a) => { const j = joursAvant(a.fin); return `<tr>
          <td><strong>${a.type === "MA" ? "« MA »" : "« E »"} ${esc(a.numero || "")}</strong><span class="sub">${a.mode === "temps" ? "À temps" : "Au voyage"}${a.titulaire ? " · " + esc(a.titulaire) : ""}</span></td>
          <td>${a.fin ? `${dateFr(a.debut)} → ${dateFr(a.fin)}` : "—"} ${a.cloturee ? badge("Clôturée") : j !== null && j < 0 ? badge("Expirée", "danger") : j !== null && j <= S.params.alerteJours ? badge(`J-${j}`, "warn") : ""}</td>
          <td>${a.dateUtilisation ? dateFr(a.dateUtilisation) : a.mode === "temps" ? "—" : badge("Disponible", "ok")}</td>
          <td>${a.dateUtilisation ? (a.compteRendu ? badge("Remis", "ok") : badge("À remettre", -joursAvant(a.dateUtilisation) >= 15 ? "danger" : "warn")) : "—"}</td>
          <td><div class="actions">${btn("modifier", "Modifier", { id: a.id, icone: "edit", cls: "btn ghost sm" })}${iconBtn("suppr", "trash", "Supprimer", a.id, true)}</div></td></tr>`; }).join("")}
        </tbody></table></div>` : vide("shield", "Aucune autorisation", "Enregistrez vos autorisations « E » (Espagne) et « MA » (Maroc) pour suivre validité, utilisation et comptes-rendus de voyage.", btn("ajouter", "Nouvelle autorisation", { icone: "plus" }))}
    </div>
    <p class="hint">Les contingents « E » et « MA » sont échangés chaque novembre pour l'année suivante, et les « E » s'épuisent de plus en plus tôt. Chaque autorisation est nominative et non transférable ; le compte-rendu de voyage est à remettre après chaque voyage.</p>
    <div class="section-title">Compteur Schengen (90 jours sur 180) par chauffeur</div>
    ${sch.length ? sch.map(({ c, e }) => `<div class="card">
      <div class="card-head"><h2>${esc(c.nom)}</h2>${e.depasse ? badge("Limite dépassée", "danger") : badge(`${e.restant} j restants`, e.restant <= 10 ? "warn" : "ok")}</div>
      <div class="progress"><i style="width:${Math.min(100, (e.utilise / 90) * 100)}%;${e.depasse ? "background:var(--danger)" : e.restant <= 10 ? "background:var(--warn)" : ""}"></i></div>
      <p class="hint" style="margin:0 0 8px">${e.utilise} jour(s) utilisé(s) sur les 180 derniers jours${e.dedans ? " · actuellement en Europe" : ""}${c.visa ? ` · visa jusqu'au ${dateFr(c.visa)}` : ""}</p>
      ${(c.sejours || []).length ? `<div class="table-wrap"><table class="plain"><tbody>${[...c.sejours].sort((a, b) => b.entree.localeCompare(a.entree)).map((s, i) => `<tr><td>${dateFr(s.entree)} → ${s.sortie ? dateFr(s.sortie) : "<strong>en cours</strong>"}</td><td class="r"><div class="actions">${s.sortie ? "" : btn("sortie-sejour", "Marquer la sortie", { id: `${c.id}|${s.entree}`, cls: "btn ghost sm" })}${iconBtn("suppr-sejour", "trash", "Supprimer ce séjour", `${c.id}|${s.entree}`, true)}</div></td></tr>`).join("")}</tbody></table></div>` : ""}
      <div class="row">${btn("ajout-sejour", "Ajouter un séjour", { id: c.id, icone: "plus", cls: "btn ghost sm" })}</div></div>`).join("")
      : `<div class="card">${vide("users", "Aucun chauffeur", "Ajoutez des chauffeurs pour suivre leurs jours Schengen.")}</div>`}
    <p class="hint">Les jours d'entrée et de sortie comptent. Ce compteur est une aide : le décompte officiel est celui des contrôles aux frontières (système EES).</p>`;
  },
  async agir(act, id) {
    const [x, d] = String(id).split("|");
    if (act === "ajouter") {
      const f = await formulaire("Nouvelle autorisation", champsAutorisation(), { valider: "Ajouter" });
      if (f) { S.autorisations.push({ id: uid(), ...lireAutorisation(f) }); sauver(); toast("Autorisation ajoutée"); rafraichir(); }
    }
    const a = parId(S.autorisations, x);
    if (act === "modifier" && a) { const f = await formulaire(`Modifier ${a.numero || a.type}`, champsAutorisation(a)); if (f) { Object.assign(a, lireAutorisation(f)); sauver(); toast("Autorisation mise à jour"); rafraichir(); } }
    if (act === "suppr" && a && (await confirmer("Supprimer cette autorisation ?", "Cette action est définitive."))) { S.autorisations = S.autorisations.filter((z) => z.id !== x); sauver(); rafraichir(); }
    const c = parId(S.chauffeurs, x);
    if (act === "ajout-sejour" && c) {
      const f = await formulaire(`Séjour Schengen — ${c.nom}`, champsSejour());
      if (f) { (c.sejours ||= []).push({ entree: f.entree, sortie: f.sortie }); sauver(); rafraichir(); }
    }
    if (act === "sortie-sejour" && c) {
      const s = c.sejours.find((z) => z.entree === d);
      const f = await formulaire(`Sortie de ${c.nom}`, [{ name: "sortie", label: "Date de sortie", type: "date", value: today(), required: true }]);
      if (f && s) { s.sortie = f.sortie; sauver(); rafraichir(); }
    }
    if (act === "suppr-sejour" && c && (await confirmer("Supprimer ce séjour ?", "Le compteur sera recalculé."))) { c.sejours = c.sejours.filter((z) => z.entree !== d); sauver(); rafraichir(); }
  },
};

/* ---------- Péages Autoroutes du Maroc ---------- */
let peageSel = [];          // sections choisies : [[gareA, gareB], …]
let peageClasse = "auto";
const classePeage = () => peageClasse === "auto" ? (classeADM(S.camions.find((c) => c.id === peageCamion)) || 3) : Number(peageClasse);
let peageCamion = "";
function rendreResultatsPeage(q) {
  const t = sansAccent(q).trim();
  if (t.length < 2) return `<p class="hint">Tapez au moins 2 lettres d'une gare (Casablanca, Rabat, Tanger, Agadir, Marrakech, Fès, Oujda…).</p>`;
  const cl = classePeage();
  const l = ADM_GRILLE.filter((r) => sansAccent(r[0] + " " + r[1]).includes(t)).slice(0, 30);
  return l.length ? l.map((r) => `<button type="button" class="sheet-item" style="flex-direction:row;justify-content:space-between;width:100%;margin-bottom:6px" data-act="ajout-section" data-id="${ADM_GRILLE.indexOf(r)}"><span>${esc(r[0])} → ${esc(r[1])}</span><strong>${r[1 + cl]} MAD</strong></button>`).join("") : `<p class="hint">Aucune section ne correspond.</p>`;
}
VUES.peages = {
  titre: "Péages Maroc",
  sous: "Grille officielle Autoroutes du Maroc, calcul par classe de véhicule",
  rendu() {
    const cl = classePeage();
    const t = admTotal(peageSel, cl);
    return `<div class="card">
      <div class="form-grid">
        <label class="f">Camion (la classe est déduite des essieux)<select id="peage-camion">${optsCamions("— Aucun : choisir la classe —").map(([v, l]) => `<option value="${esc(v)}" ${v === peageCamion ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
        <label class="f">Classe<select id="peage-classe">${[["auto", `Automatique (${classeTexte(classeADM(S.camions.find((c) => c.id === peageCamion)))})`], ["1", "Classe 1 — voiture"], ["2", "Classe 2 — porteur 2 essieux"], ["3", "Classe 3 — ensemble articulé"]].map(([v, l]) => `<option value="${v}" ${v === peageClasse ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      </div>
      <div class="section-title">Trajets types</div>
      <div class="chips">${ADM_TRAJETS.map((x) => btn("trajet-type", esc(x.lib) + ` · ${admTotal(x.sections, cl).total} MAD`, { id: x.id, cls: "btn ghost sm" })).join("")}</div>
      <div class="section-title">Votre trajet · classe ${cl}</div>
      ${peageSel.length ? `<div class="table-wrap"><table class="plain"><tbody>${t.detail.map((d, i) => `<tr><td>${esc(d.a)} → ${esc(d.b)}</td><td class="r num">${d.mad === null ? badge("absente", "danger") : d.mad + " MAD"}</td><td class="r">${iconBtn("retirer-section", "x", "Retirer", i)}</td></tr>`).join("")}
        <tr><td><strong>Total, un sens</strong></td><td class="r num"><strong>${t.total} MAD</strong></td><td></td></tr></tbody></table></div>
        <div class="row">${btn("vider-peage", "Vider", { cls: "btn ghost sm" })}</div>` : `<p class="hint">Choisissez un trajet type ci-dessus, ou ajoutez les sections une à une (la grille est un réseau de segments : un trajet est la somme des sections successives).</p>`}
      <div class="section-title">Ajouter une section</div>
      <div class="search">${ic("search")}<input id="peage-q" type="search" placeholder="Gare : Rabat, Tanger Med, Agadir…" autocomplete="off"></div>
      <div id="peage-res" style="margin-top:10px">${rendreResultatsPeage("")}</div>
    </div>
    <p class="hint">Source : grille officielle d'Autoroutes du Maroc relevée le ${dateFr(ADM_RELEVE)} (${ADM_GRILLE.length} sections), sans date d'effet publiée : <strong>recontrôlez sur adm.co.ma</strong>. Casablanca ↔ Nouaceur et Kénitra ↔ Kénitra Nord n'ont aucune ligne dans la grille et sont comptés sans péage. Classes : ensemble articulé = classe 3 ; porteur à 2 essieux = classe 2. Pour un voyage, choisissez le trajet type dans la fiche voyage : le péage suit automatiquement la classe du camion.</p>`;
  },
  saisie(e) {
    if (e.target.id === "peage-q") $("#peage-res").innerHTML = rendreResultatsPeage(e.target.value);
  },
  agir(act, id) {
    if (act === "trajet-type") peageSel = ADM_TRAJETS.find((x) => x.id === id).sections.map((s) => [...s]);
    if (act === "ajout-section") { const r = ADM_GRILLE[+id]; peageSel.push([r[0], r[1]]); }
    if (act === "retirer-section") peageSel.splice(+id, 1);
    if (act === "vider-peage") peageSel = [];
    rafraichir();
  },
};
document.addEventListener("change", (e) => {
  if (ongletActif !== "peages") return;
  if (e.target.id === "peage-camion") { peageCamion = e.target.value; rafraichir(); }
  if (e.target.id === "peage-classe") { peageClasse = e.target.value; rafraichir(); }
});

