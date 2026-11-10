"use strict";
/* ============================================================
   Tachygraphe : analyse des activités exportées (CSV) d'un conducteur.
   Les fichiers bruts du tachygraphe (.ddd) ne sont pas lus : exportez les activités en CSV depuis votre logiciel de
   téléchargement. L'analyse applique les règles du règlement CE 561/2006 (version simplifiée) et ne remplace pas un contrôle officiel.
   ============================================================ */

let tachyEnCours = null; // { chauffeurId, nom, texte, offH, lu }
let tachyMessage = "";
let tachyDiagnostic = "";

async function choisirColonnesTachy(lu) {
  const opts = [["-1", "— Aucune —"], ...lu.entetes.map((h, i) => [String(i), h || `Colonne ${i + 1}`])], d = lu.colonnes || {};
  const f = await formulaire("Quelles colonnes contient votre export ?", [
    { name: "debut", label: "Début de l'activité (date et heure)", type: "select", options: opts, value: String(d.debut ?? -1) },
    { name: "fin", label: "Fin de l'activité (ou laisser vide et choisir la durée)", type: "select", options: opts, value: String(d.fin ?? -1) },
    { name: "duree", label: "Durée (minutes ou hh:mm)", type: "select", options: opts, value: String(d.duree ?? -1) },
    { name: "activite", label: "Activité (conduite, repos, travail, disponibilité)", type: "select", options: opts, value: String(d.activite ?? -1) },
    { name: "conducteur", label: "Conducteur (facultatif)", type: "select", options: opts, value: String(d.conducteur ?? -1) },
  ], { valider: "Utiliser ces colonnes", aide: "Colonnes non reconnues : indiquez-les une fois." });
  return f ? Object.fromEntries(Object.entries(f).map(([k, v]) => [k, +v])) : null;
}
const hFrT = (t) => new Date(t * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

VUES.tachy = {
  titre: "Tachygraphe",
  sous: "Temps de conduite et de repos : dépassements détectés dans vos exports",
  actions: () => "",
  rendu() {
    const e = tachyEnCours, lu = e?.lu;
    const apercu = lu?.ok ? tachyAnalyser(lu.activites) : null;
    return `<div class="card">
      <div class="card-head"><h2>Importer les activités d'un conducteur</h2></div>
      <div class="form-grid">
        <label class="f">Conducteur<select id="tachy-chauffeur">${S.chauffeurs.map((c) => `<option value="${c.id}" ${e?.chauffeurId === c.id ? "selected" : ""}>${esc(c.nom)}</option>`).join("")}</select></label>
        <label class="f">Fuseau horaire des heures<select id="tachy-fuseau">${FUSEAUX.map(([k, l]) => `<option value="${k}" ${String(e?.offH ?? 0) === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="f full">Carte conducteur (.ddd, .c1b) ou export d'activités (CSV)<input type="file" id="tachy-fichier" accept=".ddd,.c1b,.tgd,.esm,.bin,.csv,.txt,text/csv,text/plain"></label>
      </div>
      ${!S.chauffeurs.length ? `<p class="hint">Ajoutez d'abord des chauffeurs (page Chauffeurs).</p>` : ""}
      ${tachyMessage ? `<p class="hint" style="color:var(--danger)">${esc(tachyMessage)}</p>` : ""}
      ${tachyDiagnostic ? `<details><summary style="cursor:pointer;color:var(--muted)">Détails de la lecture du fichier (sans données personnelles)</summary><pre style="white-space:pre-wrap;font-size:.8rem;user-select:all">${esc(tachyDiagnostic)}</pre><p class="hint">Si ce fichier est mal lu, copiez ce texte dans votre message : il ne contient ni nom ni numéro de carte.</p></details>` : ""}
      ${apercu ? `<div class="trav"><div><strong>${esc(e.nom)}</strong><span class="sub">${lu.activites.length} activité(s) · ${hFrT(apercu.debut)} → ${hFrT(apercu.fin)} · ${fmt(apercu.conduiteTotalH, 1)} h de conduite · ${apercu.infractions.length} dépassement(s)${lu.rejetes ? ` · ${lu.rejetes} ligne(s) ignorée(s)` : ""}</span></div><div class="r">${btn("tachy-enregistrer", "Analyser et enregistrer", { icone: "check", cls: "btn" })}</div></div>` : ""}
      <p class="hint"><strong>Fichier de carte conducteur (.ddd / .c1b)</strong> : lu directement (activités des 28 derniers jours, identité du conducteur) ; les signatures ne sont pas vérifiées et seuls les fichiers de <strong>carte conducteur</strong> sont lus (pas les fichiers de véhicule). <strong>Export CSV</strong> — colonnes attendues : <strong>début</strong>, <strong>fin</strong> (ou <strong>durée</strong>) et <strong>activité</strong> (conduite, repos, travail, disponibilité ; ou C, R, W, A). Le fichier est lu sur cet appareil, rien n'est envoyé.</p>
    </div>
    ${S.chauffeurs.filter((c) => c.tachy).map((c) => { const t = c.tachy; return `<div class="card">
      <div class="card-head"><h2>${esc(c.nom)}</h2>${t.infractions.length ? badge(`${t.infractions.length} dépassement(s)`, t.infractions.some((i) => i.gravite === "grave") ? "danger" : "warn") : badge("Aucun dépassement", "ok")}</div>
      <p class="hint" style="margin-top:0">${hFrT(t.debut)} → ${hFrT(t.fin)} · ${fmt(t.conduiteTotalH, 1)} h de conduite · importé le ${dateFr(t.importe.slice(0, 10))}</p>
      ${t.infractions.length ? `<ul class="ctl">${t.infractions.slice(0, 40).map((i) => `<li class="${i.gravite === "grave" ? "danger" : "warn"}">${ic(i.gravite === "grave" ? "alert" : "clock")}<span>${dateFr(i.date)} — ${esc(i.texte)}</span></li>`).join("")}</ul>` : ""}
      ${t.semaines.length ? `<div class="table-wrap"><table class="plain"><tbody>${t.semaines.map((s) => `<tr><td>Semaine du ${dateFr(s.debut)}</td><td class="r num">${fmt(s.conduiteH, 1)} h</td><td class="r">${s.conduiteH > 56 ? badge("> 56 h", "danger") : badge("conforme", "ok")}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <div class="row">${btn("tachy-suppr", "Supprimer l'analyse", { id: c.id, cls: "btn text-danger sm" })}</div></div>`; }).join("")}
    <p class="hint">Règles appliquées : 4 h 30 de conduite sans pause de 45 min (ou 15 + 30 min), 9 h par jour (10 h deux fois par semaine), 56 h par semaine, 90 h sur deux semaines, repos journalier de 11 h (9 h trois fois), repos hebdomadaire. Simplifications : journées séparées par un repos de 9 h, semaines civiles. <strong>Seuls le tachygraphe et l'autorité de contrôle font foi.</strong></p>`;
  },
  async agir(act, id) {
    if (act === "tachy-enregistrer" && tachyEnCours?.lu?.ok) {
      const ch = parId(S.chauffeurs, tachyEnCours.chauffeurId), a = tachyAnalyser(tachyEnCours.lu.activites);
      if (!ch) return;
      ch.tachy = { importe: new Date().toISOString(), debut: a.debut, fin: a.fin, conduiteTotalH: a.conduiteTotalH, infractions: a.infractions.slice(-200), semaines: a.semaines };
      tachyEnCours = null; tachyMessage = ""; sauver(); toast(`Analyse enregistrée pour ${ch.nom} : ${a.infractions.length} dépassement(s)`); rafraichir();
    }
    if (act === "tachy-suppr" && (await confirmer("Supprimer l'analyse ?", "Les alertes associées disparaîtront."))) { delete parId(S.chauffeurs, id).tachy; sauver(); rafraichir(); }
  },
};
document.addEventListener("change", async (e) => {
  if (ongletActif !== "tachy") return;
  if (e.target.id === "tachy-chauffeur" && tachyEnCours) { tachyEnCours.chauffeurId = e.target.value; return; }
  if (e.target.id === "tachy-fuseau" && tachyEnCours?.binaire) return; // les fichiers .ddd sont en UTC
  if (e.target.id === "tachy-fuseau" && tachyEnCours) { const off = Number(e.target.value); tachyEnCours = { ...tachyEnCours, offH: off, lu: tachyParseCSV(tachyEnCours.texte, { offH: off, colonnes: tachyEnCours.colonnes }) }; return rafraichir(); }
  if (e.target.id === "tachy-fichier" && e.target.files?.[0]) {
    const f = e.target.files[0], chauffeurId = $("#tachy-chauffeur")?.value, off = Number($("#tachy-fuseau")?.value || 0);
    tachyMessage = "";
    if (f.size > 20 * 1024 * 1024) { tachyMessage = "Fichier trop volumineux (20 Mo maximum)."; return rafraichir(); }
    if (/\.(ddd|c1b|tgd|esm|bin)$/i.test(f.name)) {
      const octets = new Uint8Array(await f.arrayBuffer()), lu = tachyParseDDD(octets);
      tachyDiagnostic = tachyDiagnosticDDD(octets);
      if (!lu.ok) { tachyMessage = lu.erreur; tachyEnCours = null; return rafraichir(); }
      const nomF = lu.conducteur ? sansAccent(lu.conducteur.nom) : "", cible = nomF && S.chauffeurs.find((c) => sansAccent(c.nom).includes(nomF)) || parId(S.chauffeurs, chauffeurId);
      tachyEnCours = { chauffeurId: cible?.id || chauffeurId, nom: lu.conducteur ? `${f.name} — ${lu.conducteur.prenoms} ${lu.conducteur.nom}` : f.name, texte: "", offH: 0, lu, colonnes: null, binaire: true };
      if (lu.conducteur && !cible) toast(`Conducteur du fichier : ${lu.conducteur.prenoms} ${lu.conducteur.nom} — choisissez le chauffeur correspondant.`, "warn");
      return rafraichir();
    }
    const texte = await f.text();
    let lu = tachyParseCSV(texte, { offH: off }), colonnes = lu.colonnes;
    if (!lu.ok && lu.entetes?.length > 1) { const col = await choisirColonnesTachy(lu); if (col) { colonnes = col; lu = tachyParseCSV(texte, { offH: off, colonnes: col }); } }
    if (!lu.ok) { tachyMessage = lu.erreur || "Fichier illisible."; tachyEnCours = null; } else tachyEnCours = { chauffeurId, nom: f.name, texte, offH: off, lu, colonnes };
    rafraichir();
  }
});

/* ---------- Réglages : tarifs des péages d'Europe (€/km par pays) ---------- */
enregistrerCarteReglages({
  onglet: "general", ordre: 12,
  rendu() {
    const t = S.params.peagesEu || {}, texte = Object.entries(t).map(([p, v]) => `${p} ${v}`).join(", ");
    return `<div class="card"><div class="card-head"><h2>Péages d'Europe (€ par km, poids lourds)</h2></div>
      <form id="f-peages-eu"><label class="f full">Tarif moyen par pays<input name="tarifs" value="${esc(texte)}" placeholder="DE 0.35, AT 0.48, FR 0.30, ES 0.17, IT 0.20" autocomplete="off"></label>
      <p class="hint">Sert à estimer les péages d'un voyage à partir des kilomètres par pays (fiche voyage). <strong>Seules l'Allemagne (≈ 0,35 €/km) et l'Autriche (≈ 0,48 €/km) sont préremplies</strong> : pour la France, l'Espagne, l'Italie, la Suisse et les autres, saisissez la valeur de <strong>votre</strong> concessionnaire ou de votre calculateur poids lourds (classe 4 en France ; les grilles changent chaque année). Un pays sans tarif n'est pas compté, et la fiche voyage vous le signale.</p>
      <div class="row" style="justify-content:flex-end"><button class="btn">Enregistrer</button></div></form></div>`;
  },
  soumettre(fid, v) {
    if (fid !== "f-peages-eu") return false;
    const o = lireKmPays(v.tarifs); S.params.peagesEu = Object.fromEntries(Object.entries(o).filter(([, x]) => x > 0 && x < 5));
    sauver(); toast("Tarifs enregistrés"); rafraichir(); return true;
  },
});
