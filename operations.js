"use strict";
/* ============================================================
   Opérations : une carte par camion (état, voyage, prochaine étape, arrivée, alertes, marge en direct), conseils du moment,
   accueil de l'exploitant, actions directes sur les alertes, historique des voyages.
   Logique pure dans optimisation.js et journal.js.
   ============================================================ */

const flotteEnDirect = () => { try { return typeof directFlotte === "function" ? directFlotte() : []; } catch { return []; } };
const positionsFlotte = () => flotteEnDirect().filter((f) => f.camion).map((f) => ({ camionId: f.camion.id, zone: f.etat?.zone?.nom || "", arretMin: f.etat?.arretMin || 0 }));
const heureFr = (ts) => new Date(ts * 1000).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" });

function carteOperation(c) {
  const eta = c.eta && (c.eta.arrivee || c.eta.t) ? heureFr(c.eta.arrivee || c.eta.t) : "", attente = typeof attenteEnCours === "function" && c.voyage ? attenteEnCours(parId(S.voyages, c.voyage.id)) : null;
  return `<article class="ops-carte ${c.bureau ? "bureau-" + c.bureau : ""} ${c.nbAlertes ? "alerte" : ""}" data-camion="${c.camionId}">
    <header><strong>${esc(c.immat)}</strong>${c.nbAlertes ? badge(`${c.nbAlertes} alerte(s)`, "danger") : ""}${badge(c.etat.libelle, c.etat.niveau)}</header>
    ${c.etat.zone ? `<div class="sub">${ic("pin")} ${esc(c.etat.zone)}</div>` : ""}
    ${c.voyage ? `<div class="ops-voyage"><strong>${esc(c.voyage.ref)}</strong> · ${esc(c.voyage.trajet)}</div>
      ${c.prochain ? `<div class="sub">${ic("flag")} Prochaine étape : ${esc(c.prochain)}</div>` : ""}
      ${attente ? `<div class="sub">${ic("clock")} ${esc(attente.texte)}</div>` : ""}
      ${eta ? `<div class="sub">${ic("clock")} Arrivée estimée ${esc(eta)}${c.eta.fourchetteMin ? ` ± ${c.eta.fourchetteMin >= 90 ? fmt(c.eta.fourchetteMin / 60, 1) + " h" : fmt(c.eta.fourchetteMin, 0) + " min"}` : ""}${c.eta.retardMin > 30 ? ` · ${badge("retard probable", "warn")}` : ""}</div>` : ""}` : `<div class="sub">Aucun voyage prévu</div>`}
    <footer>${c.chauffeur ? `<span class="sub">${ic("users")} ${esc(c.chauffeur.nom)}</span>` : `<span class="sub">Sans chauffeur</span>`}
      ${c.marge !== null ? `<span class="fin num ${c.marge < 0 ? "neg" : "pos"}">${c.marge > 0 ? "+" : ""}${fmt(c.marge)} MAD</span>` : ""}</footer>
    <div class="row">${c.voyage ? btn("voyage", "Voyage", { id: c.voyage.id, cls: "btn ghost sm" }) : btn("aller", "Planifier", { id: "voyages", cls: "btn ghost sm" })}${btn("carte", "Carte", { id: c.camionId, cls: "btn ghost sm" })}
      ${c.chauffeur?.tel ? `<a class="btn ghost sm" href="tel:+${telInternational(c.chauffeur.tel)}">Appeler</a><a class="btn ghost sm" href="${lienWhatsApp(c.chauffeur.tel, `Bonjour ${c.chauffeur.nom}, `)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}</div>
  </article>`;
}
function blocOperations(max = 0) {
  const c = cartesOperations({ flotte: flotteEnDirect() }), l = max ? c.slice(0, max) : c;
  if (!c.length) return "";
  const bureaux = [...new Set(c.map((x) => x.bureau).filter(Boolean))];
  return `<div class="ops-grille" id="ops-grille">${l.map(carteOperation).join("")}</div>
    ${bureaux.length ? `<div class="legende">${bureaux.map((b) => `<span><i class="l-bureau-${b}"></i>Bureau ${esc(libDe(BUREAUX, b))}</span>`).join("")}</div>` : ""}
    ${max && c.length > max ? `<div class="row" style="margin-top:8px">${btn("aller", `Voir les ${c.length} camions`, { id: "operations", cls: "btn ghost sm" })}</div>` : ""}`;
}
function blocConseils(max = 0) {
  const c = conseils({ positions: positionsFlotte() }), l = max ? c.slice(0, max) : c;
  if (!c.length) return "";
  return `<div class="card" id="bloc-conseils"><div class="card-head"><h2>Conseils du moment</h2>${badge(String(c.length), c.some((x) => x.niveau === "danger") ? "danger" : "warn")}</div>
    <ul class="ctl">${l.map((x) => `<li class="${x.niveau === "danger" ? "danger" : "warn"}">${ic({ retour: "route", arret: "truck", traversee: "ship", chauffeur: "users", repos: "clock" }[x.type] || "flag")}<span><strong>${esc(x.titre)}</strong><span class="sub">${esc(x.texte)}${x.finance ? ` <span class="fin">${esc(x.finance)}</span>` : ""}</span>
      ${x.action.act === "aller" ? btn("aller", x.action.lib, { id: x.action.id, cls: "btn ghost sm" }) : btn("voyage", x.action.lib, { id: x.action.id, cls: "btn ghost sm" })}</span></li>`).join("")}</ul>
    ${max && c.length > max ? `<div class="row">${btn("aller", `Voir les ${c.length} conseils`, { id: "operations", cls: "btn ghost sm" })}</div>` : ""}</div>`;
}
function ouvrirVoyage(id) { voyagesOuverts.add(id); afficher("voyages"); setTimeout(() => document.querySelector(`[data-voyage="${id}"]`)?.scrollIntoView({ block: "start" }), 60); }
function agirOperations(act, id) {
  if (act === "voyage") { ouvrirVoyage(id); return true; }
  if (act === "carte") { afficher("direct"); setTimeout(() => { const f = (typeof flotteAffichee === "function" ? flotteAffichee() : []).find((x) => x.camion?.id === id); if (f && typeof directSelectionner === "function") directSelectionner(f.id); }, 200); return true; }
  return false;
}

VUES.operations = {
  titre: "Opérations",
  sous: "Chaque camion : où il est, ce qu'il fait, ce qui vient ensuite",
  actions: () => btn("aller", "Carte", { id: "direct", icone: "radar", cls: "btn ghost" }),
  rendu() {
    if (!S.camions.length) return `<div class="card">${vide("truck", "Aucun camion", "Ajoutez vos camions et vos voyages : chaque camion aura ici sa carte.", btn("aller", "Ajouter un camion", { id: "camions", icone: "plus" }))}</div>`;
    return `${blocConseils()}<div class="section-title">Flotte · ${S.camions.length}</div>${blocOperations()}`;
  },
  agir(act, id) { agirOperations(act, id); },
};

/* ---------- accueil de l'exploitant (profil Exploitation) et conseils pour tous ---------- */
const renduAccueilAvantOperations = VUES.tableau.rendu, agirAccueilAvantOperations = VUES.tableau.agir;
VUES.tableau.rendu = function () {
  const html = renduAccueilAvantOperations.call(this);
  if (!S.camions.length) return html;
  const exploitant = typeof roleLire === "function" && roleLire().role === "exploitation";
  return exploitant ? `${blocConseils(5)}<div class="section-title">Flotte</div>${blocOperations(6)}${html}` : `${html}${blocConseils(3)}`;
};
VUES.tableau.agir = function (act, id, b) { if (agirOperations(act, id)) return; return agirAccueilAvantOperations?.call(this, act, id, b); };

/* ---------- alertes : à un geste de l'action ---------- */
function boutonsAlerte(a) {
  return actionsAlerte(a).map((x) => (x.genre === "voyage" ? btn("voyage", x.lib, { id: x.id, cls: "btn ghost sm" }) : `<a class="btn ghost sm" href="${esc(x.href)}" ${x.genre === "whatsapp" ? 'target="_blank" rel="noopener"' : ""}>${esc(x.lib)}</a>`)).join("");
}

/* ---------- historique : tenu à chaque enregistrement ---------- */
const memoireJournal = new Map(); let journalPret = false;
const auteurJournal = () => (typeof roleLire === "function" && typeof ROLES !== "undefined" ? ROLES[roleLire().role]?.lib || "" : "");
function journalInitialiser() { if (journalPret) return; journalPret = true; for (const v of S.voyages) memoireJournal.set(v.id, instantaneVoyage(v)); }
if (typeof sauver === "function") { const sauverSansJournal = sauver; sauver = function () { try { journalInitialiser(); if (typeof majDepenses === "function") majDepenses(); if (typeof majAttentesPort === "function") majAttentesPort(); journaliser(memoireJournal, auteurJournal()); } catch (e) { console.warn("Historique :", e); } return sauverSansJournal.apply(this, arguments); }; }
if (typeof afficher === "function") { const afficherSansJournal = afficher; afficher = function () { try { journalInitialiser(); } catch { /* ignoré */ } return afficherSansJournal.apply(this, arguments); }; }

function blocHistorique(v) {
  const l = [...(v.auditLog || [])].reverse(); if (!l.length) return "";
  return `<details class="historique"><summary class="section-title">Historique · ${l.length}</summary>
    <ul class="histo">${l.slice(0, 60).map((e) => `<li><span class="sub">${dateHeureFr(e.date)}${e.qui ? " · " + esc(e.qui) : ""}</span><strong>${esc(LIB_AUDIT[e.action] || e.action)}</strong> ${e.avant && e.apres ? `${esc(e.avant)} → ${esc(e.apres)}` : esc(e.apres || e.avant || e.detail || "")}</li>`).join("")}</ul></details>`;
}

/* ---------- attentes aux ports : fiche du voyage et réglages ---------- */
function blocAttentesPort(v) {
  if (v.statut === "annule") return "";
  const lignes = PORTS_ATTENTE.map(([portId, lib]) => { const p = passagePort(v, portId); return { portId, lib, ...p }; }).filter((p) => p.entree !== null);
  if (!lignes.length) return "";
  const enCours = attenteEnCours(v);
  return `<div class="section-title">Attentes aux ports</div>${lignes.map((p) => `<div class="trav"><div><strong>${esc(p.lib)}</strong><span class="sub">${p.sortie !== null ? `${dureeTexte(p.sortie - p.entree)} d'attente · entré le ${dateHeureFr(new Date(p.entree).toISOString())}${v.scanRouge?.[p.portId] ? " · passage au scanner (hors médiane)" : ""}` : enCours?.portId === p.portId ? esc(enCours.texte.replace(p.lib + " ", "")) : "sortie non enregistrée"}</span></div>
    <div class="r">${p.sortie === null && p.portId === "alg_entry" ? btn("sortie-alg", "Sorti du port", { id: v.id, cls: "btn sm" }) : ""}${p.sortie !== null ? btn("scan-rouge", v.scanRouge?.[p.portId] ? "Compter normalement" : "Passage au scanner", { id: `${v.id}|${p.portId}`, cls: "btn ghost sm", titre: "Un passage au scanner est une attente exceptionnelle : il n'entre pas dans la médiane" }) : ""}</div></div>`).join("")}`;
}
const agirVoyagesAvantAttentes = VUES.voyages.agir;
VUES.voyages.agir = async function (act, id, b) {
  if (act === "sortie-alg") { const v = parId(S.voyages, id); if (!v) return; (v.sortiesPort ||= {}).alg_entry = new Date().toISOString(); voyagesOuverts.add(v.id); sauver(); toast("Sortie du port d'Algeciras enregistrée"); return rafraichir(); }
  if (act === "scan-rouge") { const [vid, portId] = id.split("|"), v = parId(S.voyages, vid); if (!v) return; v.scanRouge ||= {}; if (v.scanRouge[portId]) delete v.scanRouge[portId]; else v.scanRouge[portId] = true; voyagesOuverts.add(v.id); sauver(); return rafraichir(); }
  return agirVoyagesAvantAttentes.call(this, act, id, b);
};
enregistrerCarteReglages({
  onglet: "general", ordre: 13,
  rendu() {
    const seuil = num(S.params.seuilCalibrationAttente, 10);
    return `<div class="card" id="carte-attentes"><div class="card-head"><h2>Attentes aux ports</h2>${badge(`${(S.attentesPort || []).length} mesure(s)`, "neutral")}</div>
      <form id="f-attentes">${PORTS_ATTENTE.map(([id, lib]) => { const a = attentePort(id), n = (S.attentesPort || []).filter((x) => x.portId === id && !x.scanRouge).length, f = S.params.attentesForcees?.[id];
        return `<div class="trav"><div><strong>${esc(lib)}</strong><span class="sub">${a.source === "operateur_calibre" ? `médiane mesurée ${dureeTexte(a.p50)} · 9 fois sur 10 moins de ${dureeTexte(a.p90)} · ${n} mesures` : a.source === "saisie_manuelle" ? `valeur saisie ${dureeTexte(a.p50)} · ${n} mesure(s) par ailleurs` : `estimation ${dureeTexte(a.p50)} · ${n} mesure(s) sur ${seuil} nécessaires`}</span></div>
          <div class="r"><label class="f" style="margin:0">Imposer (heures)<input type="number" min="0" step="any" inputmode="decimal" name="force_${id}" value="${f ? esc(String(Math.round((f.p50_ms / 3600000) * 100) / 100)) : ""}" placeholder="—" style="width:7em"></label></div></div>`; }).join("")}
        <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn">Enregistrer</button></div></form>
      <p class="hint">Chaque passage est mesuré de l'entrée à la sortie du port d'après les étapes du voyage (posées par le GPS). L'arrivée estimée utilise vos mesures dès qu'elles sont assez nombreuses ; une valeur imposée passe avant tout. À Algeciras, marchandises fraîches et autres sont mesurées séparément.</p></div>`;
  },
  soumettre(fid, v) {
    if (fid !== "f-attentes") return false;
    const f = {}; for (const [id] of PORTS_ATTENTE) if (v[`force_${id}`] !== "" && num(v[`force_${id}`]) > 0) f[id] = { p50_ms: num(v[`force_${id}`]) * 3600000, source: "saisie_manuelle" };
    if (Object.keys(f).length) S.params.attentesForcees = f; else delete S.params.attentesForcees;
    sauver(); toast("Attentes aux ports enregistrées"); rafraichir(); return true;
  },
});
