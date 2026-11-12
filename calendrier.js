"use strict";
/* ============================================================
   Page Planning : disponibilités des chauffeurs et des camions jour par jour.
   Une case libre → nouveau voyage ou absence ; une case occupée → le voyage ou l'absence.
   Qui est libre sur une période, programme du chauffeur par WhatsApp, impression de la semaine.
   Logique pure dans planning.js.
   ============================================================ */

let planGenre = "chauffeur", planDebut = "", planLibres = { debut: "", fin: "" };
const lundiDe = (iso) => { const d = new Date(iso + "T00:00:00Z"); return dateISO(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000); };
const nbJoursPlanning = () => (typeof innerWidth === "number" && innerWidth < 700 ? 7 : 14);
const JOURS_COURTS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const ressourcePlanning = (genre, id) => parId(genre === "chauffeur" ? S.chauffeurs : S.camions, id);

function grilleHtml(g) {
  const auj = today();
  const entete = g.jours.map((j) => { const d = new Date(j + "T00:00:00Z"), we = [0, 6].includes(d.getUTCDay()); return `<th class="jour-col ${j === auj ? "auj" : ""} ${we ? "we" : ""}"><span>${JOURS_COURTS[d.getUTCDay()]}</span><strong>${d.getUTCDate()}</strong></th>`; }).join("");
  const ligne = (l) => {
    const r = ressourcePlanning(planGenre, l.id), tel = planGenre === "chauffeur" && r?.tel;
    const cellules = l.cellules.map((c, i) => {
      const debutSerie = i === 0 || l.cellules[i - 1].libelle !== c.libelle || l.cellules[i - 1].voyageId !== c.voyageId;
      const titre = c.statut === "voyage" ? `${c.libelle} → ${c.destination}` : c.statut === "libre" ? "Libre : toucher pour planifier" : `${c.libelle}${c.note ? " — " + c.note : ""}`;
      return `<td class="cel cel-${c.niveau} ${g.jours[i] === today() ? "auj" : ""}" data-act="cellule" data-id="${planGenre}|${l.id}|${g.jours[i]}" title="${esc(titre)}">${debutSerie && c.statut !== "libre" ? `<span>${esc(c.libelle)}</span>` : ""}</td>`;
    }).join("");
    return `<tr><th class="res-col"><strong>${esc(l.nom)}</strong><span class="sub">${planGenre === "chauffeur" ? `Schengen : ${l.schengen} j restants` : r?.marque ? esc(r.marque) : ""} · ${l.libres} j libres</span>
      ${tel ? `<a class="btn ghost sm no-print" href="${esc(lienWhatsApp(r.tel, programmeChauffeur(r)))}" target="_blank" rel="noopener" title="Envoyer son programme des 7 prochains jours">Programme</a>` : ""}</th>${cellules}</tr>`;
  };
  return `<div class="table-wrap planning-wrap"><table class="planning sans-cartes"><thead><tr><th class="res-col">${planGenre === "chauffeur" ? "Chauffeur" : "Camion"}</th>${entete}</tr></thead>
    <tbody>${g.lignes.map(ligne).join("")}</tbody>
    <tfoot><tr><th class="res-col">Libres</th>${g.libresParJour.map((n) => `<td class="libres-jour ${n ? "" : "zero"}">${n}</td>`).join("")}</tr></tfoot></table></div>
    <div class="legende planning-legende"><span><i class="cel-occupe"></i>En voyage</span><span><i class="cel-fait"></i>Voyage terminé</span><span><i class="cel-absent"></i>${planGenre === "chauffeur" ? "Absent" : "Immobilisé"}</span><span><i class="cel-bloque"></i>Papiers expirés</span><span><i class="cel-libre"></i>Libre</span></div>`;
}
function blocLibres() {
  const d = planLibres.debut || today(), f = planLibres.fin || d, l = ressourcesLibres(planGenre, d, f), libres = l.filter((x) => x.libre), pris = l.filter((x) => !x.libre);
  return `<div class="section-title">${planGenre === "chauffeur" ? "Trouver un chauffeur libre" : "Trouver un camion libre"}</div>
    <div class="card" id="bloc-libres"><form id="f-libres"><div class="form-grid"><label class="f">Du<input type="date" name="debut" value="${esc(d)}" required></label><label class="f">Au<input type="date" name="fin" value="${esc(f)}" required></label></div>
      <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn">Chercher</button></div></form>
      <p style="margin:10px 0 4px"><strong>${libres.length ? `${libres.length} libre(s) du ${dateFr(d)} au ${dateFr(f)} : ${libres.map((x) => esc(x.nom) + (x.schengen !== undefined ? ` (Schengen ${x.schengen} j)` : "")).join(", ")}` : `Personne n'est libre du ${dateFr(d)} au ${dateFr(f)}.`}</strong></p>
      ${pris.length ? `<details><summary class="hint">Pourquoi les autres ne le sont pas (${pris.length})</summary><ul class="ctl">${pris.map((x) => `<li class="warn">${ic("clock")}<span>${x.raisons.map(esc).join(" · ")}</span></li>`).join("")}</ul></details>` : ""}</div>`;
}
function blocAbsences() {
  const auj = today(), liste = (planGenre === "chauffeur" ? S.chauffeurs : S.camions).flatMap((r) => ((planGenre === "chauffeur" ? r.absences : r.immobilisations) || []).filter((a) => (a.fin || a.debut) >= auj).map((a) => ({ r, a }))).sort((x, y) => x.a.debut.localeCompare(y.a.debut));
  const types = planGenre === "chauffeur" ? TYPES_ABSENCE : TYPES_IMMOBILISATION;
  return `<div class="section-title">${planGenre === "chauffeur" ? "Absences à venir" : "Immobilisations à venir"} · ${liste.length}</div>
    <div class="card">${liste.map(({ r, a }) => `<div class="trav"><div><strong>${esc(planGenre === "chauffeur" ? r.nom : r.immat)} · ${esc(libDe(types, a.type))}</strong><span class="sub">du ${dateFr(a.debut)} au ${dateFr(a.fin || a.debut)}${a.note ? " · " + esc(a.note) : ""}</span></div>
      <div class="r">${iconBtn("absence-modifier", "edit", "Modifier", `${planGenre}|${r.id}|${a.id}`)}${iconBtn("absence-supprimer", "trash", "Supprimer", `${planGenre}|${r.id}|${a.id}`, true)}</div></div>`).join("") || `<p class="hint" style="margin:0">Rien de prévu. Touchez une case libre du planning pour déclarer ${planGenre === "chauffeur" ? "un congé, une maladie, une formation" : "un entretien, une panne, une visite technique"}.</p>`}</div>`;
}

async function saisirAbsence(genre, resId, absence = null, jour = today()) {
  const types = genre === "chauffeur" ? TYPES_ABSENCE : TYPES_IMMOBILISATION, ressources = genre === "chauffeur" ? S.chauffeurs : S.camions;
  if (!ressources.length) return toast(genre === "chauffeur" ? "Ajoutez d'abord vos chauffeurs." : "Ajoutez d'abord vos camions.", "warn");
  const f = await formulaire(absence ? "Modifier" : genre === "chauffeur" ? "Absence d'un chauffeur" : "Immobilisation d'un camion", [
    { name: "resId", label: genre === "chauffeur" ? "Chauffeur" : "Camion", type: "select", options: ressources.map((r) => [r.id, genre === "chauffeur" ? r.nom : r.immat]), value: resId || ressources[0].id, full: true },
    { name: "type", label: "Motif", type: "select", options: types, value: absence?.type || types[0][0] },
    { name: "debut", label: "Du", type: "date", value: absence?.debut || jour, required: true },
    { name: "fin", label: "Au (inclus)", type: "date", value: absence?.fin || absence?.debut || jour, required: true },
    { name: "note", label: "Note", value: absence?.note || "", full: true },
  ], { valider: absence ? "Enregistrer" : "Ajouter" });
  if (!f) return;
  if (f.fin < f.debut) return toast("La fin est avant le début.", "danger");
  const r = ressourcePlanning(genre, f.resId), cle = genre === "chauffeur" ? "absences" : "immobilisations";
  const conflits = indisponibilites(genre, r, f.debut, f.fin).filter((c) => c.type === "voyage");
  if (conflits.length && !(await confirmer("Un voyage est prévu sur cette période", conflits.map((c) => c.texte).join(" · ") + ". Enregistrer quand même ? Le voyage sera signalé comme bloqué jusqu'à ce que vous changiez de chauffeur ou de camion.", "Enregistrer"))) return;
  if (absence) { const ancien = ressourcePlanning(genre, resId); ancien[cle] = (ancien[cle] || []).filter((a) => a.id !== absence.id); }
  (r[cle] ||= []).push({ id: absence?.id || uid(), type: f.type, debut: f.debut, fin: f.fin, ...(f.note ? { note: f.note.trim() } : {}) });
  r[cle].sort((a, b) => a.debut.localeCompare(b.debut));
  sauver(); toast("Enregistré"); rafraichir();
}
async function nouveauVoyageDepuisPlanning(genre, resId, jour) {
  const r = ressourcePlanning(genre, resId), base = { dateDepart: jour, ...(genre === "chauffeur" ? { chauffeurId: resId, camionId: r?.camionId || "" } : { camionId: resId, chauffeurId: S.chauffeurs.find((c) => c.camionId === resId)?.id || "" }) };
  const f = await formulaire("Nouveau voyage", champsVoyage(base), { valider: "Créer" });
  if (!f) return;
  const n = { id: uid(), ...lireVoyage(f), jalons: [], coches: {}, traversees: [nouvelleTraversee("aller", "tmed-alg"), nouvelleTraversee("retour", "alg-tmed")] };
  S.voyages.unshift(n); sauver(); toast(`Voyage ${n.ref} créé`);
  const c = conflitsAffectation(n); if (c.length) toast(c[0].texte, "warn");
  rafraichir();
}

VUES.planning = {
  titre: "Planning",
  sous: "Disponibilités des chauffeurs et des camions, jour par jour",
  actions: () => `${btn("absence-ajouter", planGenre === "chauffeur" ? "Absence" : "Immobilisation", { icone: "plus", cls: "btn ghost" })}${btn("imprimer-planning", "Imprimer", { icone: "print", cls: "btn ghost" })}`,
  rendu() {
    if (!planDebut) planDebut = lundiDe(today());
    const n = nbJoursPlanning(), g = grillePlanning(planGenre, planDebut, n), fin = g.jours[g.jours.length - 1];
    const vide_ = planGenre === "chauffeur" ? !S.chauffeurs.length : !S.camions.length;
    return `<div class="row planning-barre"><div class="segmented" role="tablist">${[["chauffeur", "Chauffeurs"], ["camion", "Camions"]].map(([k, l]) => `<button role="tab" data-act="plan-genre" data-id="${k}" aria-selected="${k === planGenre}">${l}</button>`).join("")}</div>
      <div class="row">${btn("plan-nav", "‹", { id: "-1", cls: "btn ghost sm", titre: "Période précédente" })}${btn("plan-nav", "Aujourd'hui", { id: "0", cls: "btn ghost sm" })}${btn("plan-nav", "›", { id: "1", cls: "btn ghost sm", titre: "Période suivante" })}<span class="sub">${dateFr(planDebut)} → ${dateFr(fin)}</span></div></div>
      <div class="card" id="carte-planning">${vide_ ? vide("calendar", planGenre === "chauffeur" ? "Aucun chauffeur" : "Aucun camion", "Ajoutez-les pour voir leurs disponibilités.") : grilleHtml(g)}
        <p class="hint no-print">Touchez une case libre pour créer un voyage ou déclarer ${planGenre === "chauffeur" ? "une absence" : "une immobilisation"} ; une case colorée ouvre le voyage ou l'absence. Les voyages qui se chevauchent, ou qui tombent pendant une absence, sont signalés dans les alertes.</p></div>
      ${vide_ ? "" : blocLibres() + blocAbsences()}`;
  },
  soumettre(fid, v) { if (fid !== "f-libres") return false; planLibres = { debut: v.debut, fin: v.fin < v.debut ? v.debut : v.fin }; rafraichir(); return true; },
  async agir(act, id) {
    if (act === "plan-genre") { planGenre = id; return rafraichir(); }
    if (act === "plan-nav") { const n = nbJoursPlanning(); planDebut = id === "0" ? lundiDe(today()) : dateISO(Date.parse(planDebut + "T00:00:00Z") + Number(id) * n * 86400000); return rafraichir(); }
    if (act === "imprimer-planning") return window.print();
    if (act === "absence-ajouter") return saisirAbsence(planGenre, "");
    if (act === "absence-modifier" || act === "absence-supprimer") {
      const [genre, resId, aid] = id.split("|"), r = ressourcePlanning(genre, resId), cle = genre === "chauffeur" ? "absences" : "immobilisations", a = (r?.[cle] || []).find((x) => x.id === aid); if (!a) return;
      if (act === "absence-modifier") return saisirAbsence(genre, resId, a);
      if (!(await confirmer("Supprimer ?", `${libDe(genre === "chauffeur" ? TYPES_ABSENCE : TYPES_IMMOBILISATION, a.type)} du ${dateFr(a.debut)} au ${dateFr(a.fin || a.debut)}`))) return;
      r[cle] = r[cle].filter((x) => x.id !== aid); sauver(); toast("Supprimé"); return rafraichir();
    }
    if (act === "cellule") {
      const [genre, resId, jour] = id.split("|"), r = ressourcePlanning(genre, resId), c = occupation(genre, r, jour);
      if (c.statut === "voyage") return typeof ouvrirVoyage === "function" ? ouvrirVoyage(c.voyageId) : afficher("voyages");
      if (c.statut === "absent" && c.absenceId) return saisirAbsence(genre, resId, (r[genre === "chauffeur" ? "absences" : "immobilisations"] || []).find((a) => a.id === c.absenceId));
      const f = await formulaire(`${genre === "chauffeur" ? r.nom : r.immat} · ${dateFr(jour)}`, [{ name: "quoi", label: c.statut === "papiers" ? `${c.libelle} : à régler avant tout voyage` : "Que voulez-vous faire ?", type: "select", options: [["voyage", "Créer un voyage qui part ce jour"], ["absence", genre === "chauffeur" ? "Déclarer une absence" : "Déclarer une immobilisation"]], value: "voyage", full: true }], { valider: "Continuer" });
      if (!f) return;
      return f.quoi === "voyage" ? nouveauVoyageDepuisPlanning(genre, resId, jour) : saisirAbsence(genre, resId, null, jour);
    }
  },
};

/* ---------- formulaire de voyage : disponibilité affichée à côté de chaque chauffeur et camion ---------- */
if (typeof champsVoyage === "function") {
  const champsVoyageAvantPlanning = champsVoyage;
  champsVoyage = function (v = {}) {
    const champs = champsVoyageAvantPlanning(v), d = v.dateDepart || today(), f = v.dateRetourPrevue || d;
    for (const [nom, genre] of [["chauffeurId", "chauffeur"], ["camionId", "camion"]]) {
      const c = champs.find((x) => x.name === nom); if (!c) continue;
      const etat = new Map(ressourcesLibres(genre, d, f, { sauf: v.id || "" }).map((x) => [x.id, x]));
      const [premiere, ...reste] = c.options;
      c.options = [premiere, ...reste.sort((a, b) => Number(!!etat.get(b[0])?.libre) - Number(!!etat.get(a[0])?.libre)).map(([id, lib]) => { const e = etat.get(id); return [id, e ? `${lib} — ${e.libre ? "libre" : e.raisons[0].replace(/^[^:]*?(est |: )/, "")}` : lib]; })];
      c.label = `${c.label} (disponibilité du ${dateFr(d)}${f !== d ? " au " + dateFr(f) : ""})`;
    }
    return champs;
  };
}

/* ---------- dupliquer un voyage ---------- */
const agirVoyagesAvantPlanning = VUES.voyages.agir;
VUES.voyages.agir = async function (act, id, b) {
  if (act === "dupliquer") {
    const v = parId(S.voyages, String(id).split("|")[0]); if (!v) return;
    const proposee = dateISO(Date.parse((finVoyage(v) || today()) + "T00:00:00Z") + 86400000);
    const f = await formulaire(`Dupliquer ${v.ref}`, [{ name: "dateDepart", label: "Nouveau départ", type: "date", value: proposee < today() ? today() : proposee, required: true }, { name: "ref", label: "Référence", value: prochainNumero("V", S.voyages, "ref"), required: true }], { valider: "Dupliquer", aide: "Même trajet, client, prix, chauffeur et camion ; même durée. Étapes, dépenses et réservations de traversée sont remises à zéro." });
    if (!f) return;
    const n = dupliquerVoyage(v, f.dateDepart, f.ref.trim());
    S.voyages.unshift(n); voyagesOuverts.add(n.id); sauver(); toast(`Voyage ${n.ref} créé`);
    const c = conflitsAffectation(n); if (c.length) toast(c[0].texte, "warn");
    return rafraichir();
  }
  return agirVoyagesAvantPlanning.call(this, act, id, b);
};
