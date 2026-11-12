"use strict";
/* ============================================================
   Traces GPS (phase 1) : import CSV / GPX, analyse, zones, jalons automatiques.
   Chargé après voyages.js. Logique pure dans gps.js.
   ============================================================ */

const zonesActives = () => (S.zones.length ? S.zones : ZONES_DEFAUT);
const zonesModifiables = () => { if (!S.zones.length) S.zones = ZONES_DEFAUT.map((z) => ({ ...z })); return S.zones; };
const hFr = (t) => dateHeureFr(gpsIso(t));
const dureeTxt = (h) => (h >= 1 ? `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, "0")}` : `${Math.round(h * 60)} min`);
const FUSEAUX = [["0", "UTC (heure universelle)"], ["1", "UTC+1 (Maroc, Europe centrale hiver)"], ["2", "UTC+2 (Europe centrale été)"], ["-1", "UTC−1"]];
let gpsEnCours = null; // { nom, format, brut, texte, offH, resultat }
let tracesOuvertes = new Set();
let gpsMessage = "";

function preparerImport(texte, nom, offH, colonnes) {
  const lu = gpsLire(texte, nom, { offH, colonnes });
  gpsEnCours = { nom, texte, offH, lu };
  return lu;
}
async function choisirColonnes(lu) {
  const opts = [["-1", "— Aucune —"], ...lu.entetes.map((h, i) => [String(i), h || `Colonne ${i + 1}`])];
  const devine = lu.colonnes || {};
  const f = await formulaire("Quelles colonnes contiennent la position ?", [
    { name: "temps", label: "Date et heure", type: "select", options: opts, value: String(devine.temps ?? -1) },
    { name: "date", label: "Date (si elle est dans une colonne à part)", type: "select", options: opts, value: String(devine.date ?? -1) },
    { name: "lat", label: "Latitude", type: "select", options: opts, value: String(devine.lat ?? -1) },
    { name: "lon", label: "Longitude", type: "select", options: opts, value: String(devine.lon ?? -1) },
    { name: "vitesse", label: "Vitesse (facultatif)", type: "select", options: opts, value: String(devine.vitesse ?? -1) },
  ], { valider: "Utiliser ces colonnes", aide: "Nous n'avons pas reconnu les colonnes de ce fichier. Indiquez-les une fois ; elles seront reprises pour ce fichier." });
  return f ? { temps: +f.temps, date: +f.date, lat: +f.lat, lon: +f.lon, vitesse: +f.vitesse } : null;
}

function enregistrerTrace(voyageId) {
  const lu = gpsEnCours.lu;
  const { points, ecartes } = gpsNettoyer(lu.points);
  const an = gpsAnalyser(points, zonesActives());
  const v = voyageId && parId(S.voyages, voyageId);
  const t = {
    id: uid(), nom: gpsEnCours.nom.replace(/\.[^.]+$/, ""), voyageId: voyageId || "", camionId: v?.camionId || "", source: lu.format, importe: new Date().toISOString(), ecartes, rejetes: lu.rejetes || 0,
    nbPoints: an.nbPoints, debut: an.debut, fin: an.fin, km: Math.round(an.km * 10) / 10, dureeH: an.dureeH, vitMoyKmh: an.vitMoyKmh, conduiteH: an.conduiteH, conduiteMaxSansPauseH: an.conduiteMaxSansPauseH,
    arrets: an.arrets.slice(0, 40), trous: an.trous.slice(0, 40), visites: an.visites, traversees: an.traversees, jalons: an.jalons, pts: gpsSimplifier(points), temps: gpsTemperatures(points), ralentis: gpsRalentissements(points).slice(0, 80),
  };
  S.traces.unshift(t); tracesOuvertes.add(t.id); sauver();
  return t;
}

/** Péage mesuré : passages devant les gares localisées, puis sections de la grille ADM selon la classe du camion. */
function peagesDeTrace(t) {
  const v = t.voyageId && parId(S.voyages, t.voyageId);
  const classe = classeADM(parId(S.camions, v?.camionId || t.camionId)) || 3;
  const passages = gpsPassagesGares(t.pts, S.gares);
  const trajets = gpsTrajetsPeage(passages, classe);
  return { classe, passages, trajets, total: trajets.reduce((s, x) => s + x.mad, 0) };
}
const NIV_RAPPROCHE = { ok: ["Conforme", "ok"], ecart: ["Écart de montant", "warn"], non_facture: ["Non facturé", "danger"], sans_passage: ["Facturé sans passage GPS", "warn"], liaison: ["Liaison (aucun tarif)", "neutral"] };
function sectionPeagesTrace(t, v) {
  const p = peagesDeTrace(t);
  const lie = S.gares.length >= 2;
  const rel = parId(S.releves, t.releveId);
  const rap = rel && lie ? gpsRapprocher(p.trajets, rel.lignes, { debut: t.debut, fin: t.fin }) : null;
  const rs = rap && gpsResumeRapprochement(rap);
  return `<div class="section-title">Péages mesurés par GPS</div>
    ${!lie ? `<p class="hint" style="margin-top:0">Aucune gare de péage n'est encore localisée (${S.gares.length}/92). ADM ne publie pas leurs coordonnées : relevez-les une fois sur cette trace, elles serviront pour tous vos voyages.</p>`
      : p.trajets.length ? `<div class="table-wrap"><table class="plain"><tbody>${p.trajets.map((x) => `<tr><td>${esc(x.de)} → ${esc(x.vers)}</td><td>${hFr(x.tVers)}</td><td class="r num">${x.type === "section" ? x.mad + " MAD" : x.type === "liaison" ? badge("liaison", "neutral") : badge("section absente de la grille", "danger")}</td></tr>`).join("")}
        <tr><td colspan="2"><strong>Total mesuré · classe ${p.classe}</strong></td><td class="r num"><strong>${p.total} MAD</strong></td></tr></tbody></table></div>`
      : `<p class="hint" style="margin-top:0">Aucun passage devant une gare localisée sur cette trace (${S.gares.length} gare(s) connue(s)).</p>`}
    <div class="row">
      ${t.ralentis?.length ? btn("releve-gares", `Relever les gares (${t.ralentis.length} candidats)`, { id: t.id, icone: "pin", cls: "btn ghost sm" }) : ""}
      ${v && lie && p.total ? btn("peage-voyage", v.peagesReelMad ? "Mettre à jour le péage du voyage" : "Utiliser ce péage dans le voyage", { id: t.id, icone: "check", cls: "btn sm" }) : ""}
      ${v?.peagesReelMad ? btn("peage-type", "Revenir au trajet type", { id: t.id, cls: "btn ghost sm" }) : ""}
    </div>
    ${lie && S.releves.length ? `<div class="form-grid" style="margin-top:10px"><label class="f">Comparer au relevé de péage (Jawaz Pro)<select data-trace-releve="${t.id}"><option value="">— Aucun —</option>${S.releves.map((r) => `<option value="${r.id}" ${r.id === t.releveId ? "selected" : ""}>${esc(r.nom)}</option>`).join("")}</select></label></div>` : ""}
    ${rap ? `<div class="kpis" style="margin-top:10px">
        <div class="kpi"><div class="l">Conformes</div><div class="v">${rs.ok}</div></div>
        <div class="kpi"><div class="l">Écarts de montant</div><div class="v">${rs.ecart}</div></div>
        <div class="kpi"><div class="l">Non facturés</div><div class="v">${rs.nonFacture}</div><div class="s ${rs.manque ? "danger" : ""}">${rs.manque} MAD</div></div>
        <div class="kpi"><div class="l">Sans passage GPS</div><div class="v">${rs.sansPassage}</div><div class="s ${rs.surplus ? "warn" : ""}">${rs.surplus} MAD</div></div></div>
      ${rap.filter((x) => x.statut !== "liaison").map((x) => { const tr = x.trajet, l = x.ligne; const [lib, niv] = NIV_RAPPROCHE[x.statut];
        return `<div class="trav"><div>${tr ? `<strong>${esc(tr.de)} → ${esc(tr.vers)}</strong><span class="sub">GPS ${hFr(tr.tVers)} · ${tr.mad} MAD</span>` : `<strong>${esc(l.gareB)}</strong><span class="sub">Facturé ${hFr(l.t)}${l.ref ? " · " + esc(l.ref) : ""}</span>`}</div>
          <div class="r">${badge(lib, niv)}<span class="num">${l ? l.mad + " MAD" : "—"}${x.statut === "ecart" ? ` (${x.difference > 0 ? "+" : ""}${x.difference})` : ""}</span></div></div>`; }).join("")}
      <p class="hint">« Non facturé » : le camion est passé mais aucune ligne ne correspond (Pass non débité, gare mal localisée ?). « Facturé sans passage GPS » : une ligne du relevé n'a pas de passage correspondant pendant cette trace (Pass utilisé sur un autre véhicule, trou de signal ?). À vérifier avant toute réclamation.</p>` : ""}`;
}

/** Applique les jalons et les dates de traversée de la trace au voyage (sans écraser ce qui est déjà saisi). */
function appliquerTraceAuVoyage(t, v) {
  let n = 0;
  v.jalons ||= [];
  for (const j of t.jalons) if (!v.jalons.some((x) => x.type === j.type)) { v.jalons.push({ type: j.type, date: j.date, source: "gps" }); n++; }
  const sorties = sortiesPortDepuisVisites(t.visites, t.fin || 0);
  if (sorties.alg_entry && !v.sortiesPort?.alg_entry) { (v.sortiesPort ||= {}).alg_entry = sorties.alg_entry; n++; }
  for (const tr of t.traversees) {
    const x = (v.traversees || []).find((z) => z.sens === tr.sens);
    if (x) { const iso = gpsIso(tr.embarque); x.date = x.date || iso.slice(0, 10); x.heure = x.heure || iso.slice(11, 16); x.statut = "effectuee"; }
  }
  v.kmGps = (v.kmGps || 0) + t.km;
  if (v.jalons.some((j) => j.type === "retour")) v.statut = "termine"; else if (v.jalons.length && v.statut === "prevu") v.statut = "en_cours";
  return n;
}

/** Trace fictive (CSV français) : Agadir → Casablanca → Tanger Med → traversée → Algeciras → frontière, pour essayer sans fichier. */
function traceExemple() {
  const dep = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - 3, 4, 0) / 1000;
  const lignes = ["Horodatage;Latitude;Longitude;Vitesse (km/h);Contact"];
  let t = dep;
  const pt = (la, lo, v) => lignes.push(`${new Date(t * 1000).toISOString().slice(0, 19).replace("T", " ")};${la.toFixed(5).replace(".", ",")};${lo.toFixed(5).replace(".", ",")};${v};${v ? "ON" : "OFF"}`);
  const aller = (a, b, v, pas = 300) => { const d = gpsDistance([0, ...a], [0, ...b]) / 1000, n = Math.max(1, Math.round((d / v) * 3600 / pas)); for (let i = 1; i <= n; i++) { t += pas; pt(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, v); } };
  const attendre = (a, min) => { for (let i = 0; i < min; i += 10) { t += 600; pt(a[0], a[1], 0); } };
  const A = [30.42, -9.6], C = [33.59, -7.62], T = [35.889, -5.5], G = [36.13, -5.44], F = [42.42, 2.87];
  pt(A[0], A[1], 0); aller(A, C, 78); attendre(C, 50); aller(C, T, 80); attendre(T, 120); t += 2 * 3600; pt(G[0], G[1], 0); attendre(G, 30); aller(G, F, 85);
  return lignes.join("\n");
}
const champsZone = (z = {}) => [
  { name: "nom", label: "Nom", value: z.nom, required: true },
  { name: "type", label: "Type", type: "select", options: TYPES_ZONE, value: z.type || "autre" },
  { name: "lat", label: "Latitude", type: "number", step: "any", value: z.lat, required: true, placeholder: "35.889" },
  { name: "lon", label: "Longitude", type: "number", step: "any", value: z.lon, required: true, placeholder: "-5.500" },
  { name: "rayon", label: "Rayon (mètres)", type: "number", min: 50, value: z.rayon ?? 1000, required: true },
];
const lireZone = (f) => ({ nom: f.nom, type: f.type, lat: num(f.lat), lon: num(f.lon), rayon: Math.max(50, num(f.rayon, 1000)) });

function carteTrace(t) {
  const v = t.voyageId && parId(S.voyages, t.voyageId);
  const sj = gpsSejourSchengen(t);
  const ch = v && parId(S.chauffeurs, v.chauffeurId);
  const nomJ = (k) => JALONS_VOYAGE.find(([c]) => c === k)?.[1] || k;
  return `<details class="card dossier" data-trace="${t.id}" ${tracesOuvertes.has(t.id) ? "open" : ""}>
    <summary><div><strong>${esc(t.nom)}</strong> · ${fmt(t.km, 0)} km
      <div class="meta">${[hFr(t.debut) + " → " + hFr(t.fin), fmt(t.nbPoints) + " points", v && "voyage " + v.ref].filter(Boolean).map(esc).join(" · ")}</div></div>
      <div class="row">${t.traversees.length ? badge(`${t.traversees.length} traversée(s)`, "ok") : ""}${t.trous.length ? badge(`${t.trous.length} trou(s)`, "neutral") : ""}</div></summary>
    <div class="body">
      <div class="kpis">
        <div class="kpi"><div class="l">Distance</div><div class="v">${fmt(t.km, 0)} <small>km</small></div></div>
        <div class="kpi"><div class="l">Durée</div><div class="v">${dureeTxt(t.dureeH)}</div></div>
        <div class="kpi"><div class="l">Conduite estimée</div><div class="v">${dureeTxt(t.conduiteH)}</div><div class="s ${t.conduiteMaxSansPauseH > 4.5 ? "danger" : ""}">${dureeTxt(t.conduiteMaxSansPauseH)} max sans pause de 45 min</div></div>
        <div class="kpi"><div class="l">Vitesse moyenne</div><div class="v">${fmt(t.vitMoyKmh, 0)} <small>km/h</small></div></div>
      </div>
      <p class="hint" style="margin-top:0">La conduite est <strong>estimée d'après la vitesse</strong> (≥ 5 km/h) : ce n'est pas le relevé du tachygraphe.${t.ecartes ? ` ${t.ecartes} point(s) aberrant(s) écarté(s).` : ""}</p>
      ${gpsSVG(t.pts, zonesActives(), t.visites)}
      ${t.traversees.length ? `<div class="section-title">Traversées détectées</div>${t.traversees.map((x) => `<div class="trav detroit"><div><strong>${x.sens === "aller" ? "Aller" : "Retour"} · ${esc(x.de)} → ${esc(x.vers)}</strong><span class="sub">Embarquement ${hFr(x.embarque)} · débarquement ${hFr(x.debarque)}</span></div><div class="r"><strong>${dureeTxt(x.dureeH)}</strong><span class="sub">porte à porte</span></div></div>`).join("")}` : ""}
      <div class="section-title">Étapes proposées par le GPS</div>
      ${t.jalons.length ? `<ol class="timeline">${t.jalons.map((j) => `<li class="fait"><span class="pt"></span><div><strong>${esc(nomJ(j.type))}</strong><span class="sub">${hFr(Date.parse(j.date) / 1000)}${j.detail ? " · " + esc(j.detail) : ""}</span></div></li>`).join("")}</ol>` : `<p class="hint">Aucune étape reconnue : vérifiez que la trace passe par des zones (section « Zones » plus bas).</p>`}
      ${t.visites.length ? `<div class="section-title">Passages dans les zones</div><div class="table-wrap"><table class="plain"><tbody>${t.visites.map((x) => `<tr><td>${esc(x.zone)}</td><td>${hFr(x.entree)}</td><td class="r">${x.sortie > x.entree ? dureeTxt((x.sortie - x.entree) / 3600) : "—"}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${t.arrets.length ? `<div class="section-title">Arrêts de plus de 20 min</div><div class="table-wrap"><table class="plain"><tbody>${t.arrets.map((x) => `<tr><td>${hFr(x.debut)}</td><td>${x.zone ? esc(x.zone) : `<span class="sub">${x.lat.toFixed(3)}, ${x.lon.toFixed(3)}</span>`}</td><td class="r">${dureeTxt(x.dureeMin / 60)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${t.trous.length ? `<div class="section-title">Trous de signal (plus de 30 min)</div><div class="table-wrap"><table class="plain"><tbody>${t.trous.map((x) => `<tr><td>${hFr(x.debut)}</td><td>${x.de || x.vers ? `${esc(x.de || "?")} → ${esc(x.vers || "?")}` : ""}</td><td class="r">${dureeTxt(x.dureeMin / 60)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${sectionPeagesTrace(t, v)}
      <div class="section-title">Voyage</div>
      <div class="form-grid"><label class="f">Rattacher à un voyage<select data-trace-voyage="${t.id}"><option value="">— Aucun —</option>${S.voyages.map((x) => `<option value="${x.id}" ${x.id === t.voyageId ? "selected" : ""}>${esc(x.ref)} · ${esc(x.origine)} ⇄ ${esc(x.destination)}</option>`).join("")}</select></label></div>
      <div class="row">
        ${v ? btn("appliquer", "Appliquer les étapes au voyage", { id: t.id, icone: "check", cls: "btn sm" }) : ""}
        ${v && ch && sj ? btn("schengen", "Ajouter le séjour Schengen", { id: t.id, icone: "shield", cls: "btn ghost sm", titre: `${ch.nom} : ${dateFr(sj.entree)} → ${sj.sortie ? dateFr(sj.sortie) : "en cours"}` }) : ""}
        ${btn("suppr-trace", "Supprimer la trace", { id: t.id, cls: "btn text-danger sm" })}
      </div>
    </div></details>`;
}

VUES.gps = {
  titre: "Traces GPS",
  sous: "Importez l'export de vos balises : traversées, étapes et conduite détectées automatiquement",
  actions: () => "",
  rendu() {
    const e = gpsEnCours, lu = e?.lu;
    const apercu = lu?.ok ? (() => { const { points } = gpsNettoyer(lu.points); const a = gpsAnalyser(points, zonesActives()); return { a, n: points.length }; })() : null;
    return `<div class="card">
      <div class="card-head"><h2>Importer une trace</h2>${badge(`${S.traces.length} enregistrée(s)`, "neutral")}</div>
      <div class="form-grid">
        <label class="f full">Fichier d'export de la plateforme (CSV ou GPX)<input type="file" id="gps-fichier" accept=".csv,.txt,.gpx,text/csv,text/plain,application/gpx+xml"></label>
        <label class="f">Fuseau horaire des heures du fichier<select id="gps-fuseau">${FUSEAUX.map(([k, l]) => `<option value="${k}" ${String(e?.offH ?? 0) === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="f">Voyage concerné<select id="gps-voyage"><option value="">— Aucun (à rattacher plus tard) —</option>${S.voyages.map((v) => `<option value="${v.id}">${esc(v.ref)} · ${esc(v.origine)} ⇄ ${esc(v.destination)}</option>`).join("")}</select></label>
      </div>
      <div class="row" style="margin-bottom:6px">${btn("exemple", "Essayer avec une trace d'exemple", { icone: "play", cls: "btn ghost sm" })}</div>
      ${gpsMessage ? `<p class="hint" style="color:var(--danger)">${esc(gpsMessage)}</p>` : ""}
      ${apercu ? `<div class="trav"><div><strong>${esc(e.nom)}</strong><span class="sub">${fmt(apercu.n)} points · ${hFr(apercu.a.debut)} → ${hFr(apercu.a.fin)} · ${fmt(apercu.a.km, 0)} km${lu.rejetes ? ` · ${lu.rejetes} ligne(s) ignorée(s)` : ""}</span>
        <span class="sub">${apercu.a.traversees.length ? `${apercu.a.traversees.length} traversée(s) et ${apercu.a.jalons.length} étape(s) reconnue(s)` : "Aucune traversée détectée"}</span></div>
        <div class="r">${btn("enregistrer", "Analyser et enregistrer", { icone: "check", cls: "btn" })}</div></div>` : ""}
      <p class="hint">Demandez à votre fournisseur de balises l'<strong>export de trajets</strong> (CSV ou GPX) avec au minimum : <strong>date et heure, latitude, longitude</strong> (la vitesse est un plus). Les colonnes sont reconnues automatiquement, en français ou en anglais ; sinon vous les désignez une fois. Aucune donnée n'est envoyée : le fichier est lu sur cet appareil.</p>
    </div>
    ${S.traces.map(carteTrace).join("")}
    <div class="section-title">Zones (ports, frontières, dépôts, clients)</div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Zone</th><th>Type</th><th>Position</th><th class="r">Rayon</th><th></th></tr></thead><tbody>
        ${zonesActives().map((z) => `<tr><td><strong>${esc(z.nom)}</strong></td><td>${esc(TYPES_ZONE.find(([k]) => k === z.type)?.[1] || z.type)}</td><td class="num">${z.lat.toFixed(4)}, ${z.lon.toFixed(4)}</td><td class="r num">${fmt(z.rayon)} m</td>
          <td><div class="actions">${btn("zone-modifier", "Modifier", { id: z.id, icone: "edit", cls: "btn ghost sm" })}${iconBtn("zone-suppr", "trash", "Supprimer", z.id, true)}</div></td></tr>`).join("")}
        </tbody></table></div>
      <div class="row" style="margin-top:12px">${btn("zone-ajouter", "Ajouter une zone", { icone: "plus", cls: "btn ghost sm" })}${S.zones.length ? btn("zone-defaut", "Restaurer les zones habituelles", { cls: "btn ghost sm" }) : ""}</div>
      <p class="hint">Quand un camion entre dans une zone, une étape du voyage peut être déduite : entrée au port, embarquement, débarquement, retour au dépôt… Les coordonnées des zones habituelles sont <strong>approximatives</strong> : ajustez-les avec les positions réelles de vos balises (sur la trace d'un voyage passé, notez la latitude et la longitude à l'entrée du port). Ajoutez votre <strong>dépôt</strong> (type « Dépôt ») et vos clients réguliers.</p>
    </div>`;
  },
  apres() {
    document.querySelectorAll("details[data-trace]").forEach((el) => el.addEventListener("toggle", () => { el.open ? tracesOuvertes.add(el.dataset.trace) : tracesOuvertes.delete(el.dataset.trace); }));
  },
  async agir(act, id) {
    if (act === "enregistrer" && gpsEnCours?.lu?.ok) {
      const t = enregistrerTrace($("#gps-voyage")?.value);
      gpsEnCours = null; gpsMessage = "";
      toast(`Trace « ${t.nom} » enregistrée : ${t.traversees.length} traversée(s), ${t.jalons.length} étape(s)`); return rafraichir();
    }
    if (act === "exemple") { gpsMessage = ""; preparerImport(traceExemple(), "exemple-agadir-algeciras.csv", 0); return rafraichir(); }
    const t = parId(S.traces, id);
    if (act === "appliquer" && t) {
      const v = parId(S.voyages, t.voyageId);
      if (!v) return toast("Rattachez d'abord la trace à un voyage.", "warn");
      const n = appliquerTraceAuVoyage(t, v); sauver(); toast(n ? `${n} étape(s) ajoutée(s) au voyage ${v.ref}` : "Le voyage avait déjà toutes ces étapes"); rafraichir();
    }
    if (act === "schengen" && t) {
      const v = parId(S.voyages, t.voyageId), ch = v && parId(S.chauffeurs, v.chauffeurId), sj = gpsSejourSchengen(t);
      if (!ch || !sj) return;
      const ch_ = (ch.sejours ||= []);
      if (ch_.some((s) => s.entree === sj.entree)) return toast("Ce séjour est déjà enregistré.", "warn");
      ch_.push(sj); sauver(); toast(`Séjour ajouté pour ${ch.nom}`); rafraichir();
    }
    if (act === "releve-gares" && t) return ouvrirReleveGares(id);
    if (act === "peage-voyage" && t) {
      const v = parId(S.voyages, t.voyageId); if (!v) return;
      v.peagesReelMad = peagesDeTrace(t).total; sauver(); toast(`Péage du voyage ${v.ref} : ${v.peagesReelMad} MAD (mesuré)`); rafraichir();
    }
    if (act === "peage-type" && t) { const v = parId(S.voyages, t.voyageId); if (v) { delete v.peagesReelMad; sauver(); toast("Retour au trajet type"); rafraichir(); } }
    if (act === "suppr-trace" && t && (await confirmer(`Supprimer la trace « ${t.nom} » ?`, "Les étapes déjà appliquées au voyage sont conservées."))) { S.traces = S.traces.filter((x) => x.id !== id); sauver(); rafraichir(); }
    if (act === "zone-ajouter") {
      const f = await formulaire("Nouvelle zone", champsZone(), { valider: "Ajouter" });
      if (f) { zonesModifiables().push({ id: uid(), ...lireZone(f) }); sauver(); rafraichir(); }
    }
    if (act === "zone-modifier") {
      const z = zonesModifiables().find((x) => x.id === id);
      const f = z && (await formulaire(`Modifier ${z.nom}`, champsZone(z)));
      if (f) { Object.assign(z, lireZone(f)); sauver(); rafraichir(); }
    }
    if (act === "zone-suppr" && (await confirmer("Supprimer cette zone ?", "Les traces déjà analysées ne changent pas."))) { S.zones = zonesModifiables().filter((x) => x.id !== id); sauver(); rafraichir(); }
    if (act === "zone-defaut" && (await confirmer("Restaurer les zones habituelles ?", "Vos zones personnalisées seront remplacées.", "Restaurer"))) { S.zones = []; sauver(); rafraichir(); }
  },
};

document.addEventListener("change", async (e) => {
  if (ongletActif !== "gps") return;
  if (e.target.id === "gps-fuseau" && gpsEnCours) {
    const off = Number(e.target.value); preparerImport(gpsEnCours.texte, gpsEnCours.nom, off); return rafraichir();
  }
  if (e.target.dataset?.traceReleve !== undefined) { const t = parId(S.traces, e.target.dataset.traceReleve); if (t) { t.releveId = e.target.value; sauver(); rafraichir(); } return; }
  if (e.target.dataset?.traceVoyage !== undefined) {
    const t = parId(S.traces, e.target.dataset.traceVoyage); if (!t) return;
    t.voyageId = e.target.value; t.camionId = parId(S.voyages, t.voyageId)?.camionId || ""; sauver(); return rafraichir();
  }
  if (e.target.id === "gps-fichier" && e.target.files?.[0]) {
    const fichier = e.target.files[0], off = Number($("#gps-fuseau")?.value || 0), voyage = $("#gps-voyage")?.value;
    gpsMessage = "";
    if (fichier.size > 40 * 1024 * 1024) { gpsMessage = "Fichier trop volumineux (40 Mo maximum) : exportez un seul voyage à la fois."; return rafraichir(); }
    const texte = await fichier.text();
    let lu = preparerImport(texte, fichier.name, off);
    if (!lu.ok && lu.format === "csv" && lu.entetes?.length > 1) {
      const col = await choisirColonnes(lu);
      if (col) lu = preparerImport(texte, fichier.name, off, col);
    }
    if (!lu.ok) { gpsMessage = lu.erreur || "Fichier illisible."; gpsEnCours = null; }
    rafraichir();
    if (voyage && $("#gps-voyage")) $("#gps-voyage").value = voyage;
  }
});
