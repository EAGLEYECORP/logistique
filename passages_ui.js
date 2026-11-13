"use strict";
/* ============================================================
   Page « Passages douane » : centre de notifications de chaque étape du passage des ports.
   · au port maintenant : où en est chaque camion, depuis combien de temps, ce qui doit se passer ensuite ;
   · fil : chaque étape faite (ce qu'elle veut dire, ce qui suit, qui agit, documents), alertes, choses à préparer ;
   · envoi automatique selon le routage (fil de l'application, exploitation, transitaire, chauffeur) ; « Notifier » à la main.
   Logique pure dans passages.js ; étapes dans data.js ; saisie d'une étape : ports_ui.js.
   ============================================================ */

let filtrePassages = "", voyagePassages = "", lieuPassages = "";
const ICONE_PASSAGE = { fait: "check", inspection: "search", reference: "file", retard: "clock", preparer: "flag" };
const passagesLus = () => S.notifsEtat?.passagesLus || "";
const nonLusPassages = () => { const lu = passagesLus(); return centrePassages().filter((e) => e.date > lu && e.type !== "fait").length; };

function blocSuite(s, { court = false } = {}) {
  if (!s) return "";
  if (s.fait) return `<span class="sub passage-suivie">${ic("check")}Suivie de : ${esc(s.lib)} · ${dateHeureFr(s.date)}</span>`;
  if (court) return `<span class="sub passage-suivie">Ensuite : ${esc(s.lib)}</span>`;
  return `<div class="passage-suite"><span class="sub">Ensuite${s.acteur ? ` · ${esc(s.acteur)}` : ""}${s.seuil ? ` · habituellement moins de ${esc(dureePassage(s.seuil))}` : ""}</span><strong>${esc(s.lib)}</strong>${s.detail ? `<span class="sub">${esc(s.detail)}</span>` : ""}${s.docs?.length ? `<span class="sub">À présenter : ${s.docs.map(esc).join(" · ")}</span>` : ""}</div>`;
}
function carteEnPassage(x) {
  const v = x.v, pct = Math.round((x.faites / x.total) * 100);
  return `<div class="passage-port ${x.retard ? "retard" : ""}"><div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap"><div><strong>${esc(v.ref)}</strong> <span class="sub">${esc(nomCamion(v.camionId) || "")}${v.chauffeurId ? " · " + esc(nomChauffeur(v.chauffeurId)) : ""} · ${x.sens === "aller" ? "aller" : "retour"}</span></div>
      ${badge(x.retard ? `en attente ${dureePassage(x.depuisMin)}` : `depuis ${dureePassage(x.depuisMin)}`, x.retard ? (x.depuisMin > 2 * x.seuil ? "danger" : "warn") : "neutral")}</div>
    <div class="passage-barre" title="${x.faites}/${x.total} étapes"><i style="width:${pct}%"></i></div>
    <span class="sub">${x.enMer ? `${ic("ship")}En traversée · ` : ""}Fait : ${esc(etapePortLib(x.derniere))}</span>
    ${x.sautees.length ? `<span class="passage-conseil">${ic("alert")}Non notée(s) : ${x.sautees.map((e) => esc(e.lib)).join(" · ")} — à vérifier avec le transitaire.</span>` : ""}
    ${blocSuite(x.suite)}
    <div class="row" style="margin-top:6px">${x.prochaine ? btn("passage-fait", "Étape suivante faite", { id: `${v.id}|${x.prochaine.e.id}`, cls: "btn sm", icone: "check" }) : ""}${btn("passage-voyage", "Voyage", { id: v.id, cls: "btn ghost sm" })}${btn("passage-filtrer", "Son fil", { id: v.id, cls: "btn ghost sm" })}</div></div>`;
}
/** Un port : chaque étape, aller et retour, avec les camions qui l'attendent, votre temps habituel et le repère d'alerte. */
function blocLieu(p) {
  if (!p) return "";
  const hm = (m) => (m === null ? "—" : dureePassage(m));
  return `<div class="card passage-lieu"><div class="card-head"><h2>${esc(p.lib)} : ce qui se passe</h2>${p.alertes.length ? badge(`${p.alertes.length} alerte(s) · 30 j`, "warn") : badge("aucune alerte", "ok")}</div>
    <div class="passage-sens">${p.sens.map((s) => `<div><div class="groupe">${esc(s.lib)} · ${s.n ? `temps habituel au port ${esc(hm(s.mediane))} (${s.n} passage(s))` : "pas encore d'historique"}</div>
      <ol class="passage-pipeline">${s.etapes.map((x) => `<li class="${x.attente.length ? "occupe" : ""} ${x.attente.some((a) => a.retard) ? "retard" : ""}">
        <div class="pp-tete"><strong>${esc(x.e.lib)}</strong>${x.e.frais ? ` <span class="sub">(frais)</span>` : ""}${x.e.facultatif ? ` <span class="sub">(si nécessaire)</span>` : ""}
          <span class="pp-n">${x.attente.length ? badge(`${x.attente.length} camion(s)`, x.attente.some((a) => a.retard) ? "warn" : "neutral") : ""}</span></div>
        <span class="sub">${esc(ACTEURS_PASSAGE[SUITES_PASSAGE[x.e.id]?.acteur] || "")}${x.n ? ` · habituel chez vous : ${esc(hm(x.mediane))}` : ""}${x.repere ? ` · alerte après ${esc(hm(x.repere))}` : ""}</span>
        ${x.attente.length ? `<div class="pp-camions">${x.attente.map((a) => `<button type="button" class="chip ${a.retard ? "retard" : ""}" data-act="passage-filtrer" data-id="${a.v.id}" title="Voir son fil">${a.enMer ? ic("ship") : ""}${esc(a.v.ref)} · ${esc(dureePassage(a.depuisMin))}</button>`).join("")}</div>` : ""}</li>`).join("")}</ol></div>`).join("")}</div>
    ${p.termines.length ? `<div class="groupe">Passages terminés · 7 jours</div>${p.termines.map((t) => `<div class="trav"><div><strong>${esc(t.v.ref)} · ${esc(PORTS_PASSAGE[t.port].lib)}</strong><span class="sub">${esc(dureePassage(t.r.dureeMs / 60000))} au port · sorti le ${dateHeureFr(new Date(t.r.fin).toISOString())}</span></div></div>`).join("")}` : ""}
    <p class="hint">${p.lieu === "alg" ? "PCF d'Algeciras ouvert lun.–ven. 7 h 30–22 h, sam., dim. et fêtes 9 h 30–22 h. " : "Passage portuaire dématérialisé : le camion est appelé quand son dossier PortNet est complet ; le résultat du scanner part directement dans BADR. "}Temps habituels calculés sur vos passages des 90 derniers jours, inspections physiques écartées.</p></div>`;
}
function ligneEvenement(e, lu, detaillee = true) {
  const neuf = e.date > lu && e.type !== "fait";
  return `<div class="passage-ev niveau-${e.niveau} ${neuf ? "nouveau" : ""}"><span class="passage-ic">${ic(ICONE_PASSAGE[e.type] || "bell")}</span><div class="passage-corps">
    <div class="row" style="justify-content:space-between;gap:6px;flex-wrap:wrap"><strong>${esc(e.titre)}</strong><span class="sub">${dateHeureFr(e.date)}${e.source === "gps" ? " · GPS" : ""}</span></div>
    <span class="passage-texte">${esc(e.texte)}</span>${e.conseil ? `<span class="passage-conseil">${ic("alert")}${esc(e.conseil)}</span>` : ""}
    ${blocSuite(e.suite, { court: !detaillee })}
    <div class="row" style="margin-top:6px">${e.suite?.id && !e.suite.fait ? btn("passage-fait", "Étape suivante faite", { id: `${e.voyageId}|${e.suite.id}`, cls: "btn ghost sm", icone: "check" }) : ""}${btn("passage-notifier", "Notifier", { id: e.id, cls: "btn ghost sm", icone: "bell" })}${btn("passage-voyage", "Voyage", { id: e.voyageId, cls: "btn ghost sm" })}</div></div></div>`;
}
VUES.passages = {
  titre: "Passages douane",
  sous: "Chaque étape à Tanger Med et Algeciras : ce qui vient de se passer, ce qui suit, qui doit agir",
  actions: () => btn("passages-lu", "Tout marquer comme lu", { cls: "btn ghost", icone: "check" }),
  rendu() {
    const maintenant = Date.now(), L = lieuPassages && LIEUX_PASSAGE[lieuPassages], au = voyagesEnPassage(maintenant).filter((x) => !L || L.ports.includes(x.port)), tous = centrePassages({ maintenant }).filter((e) => !L || L.ports.includes(e.port)), lu = passagesLus();
    const ev = tous.filter((e) => (!voyagePassages || e.voyageId === voyagePassages) && (!filtrePassages || (filtrePassages === "alertes" ? e.categorie === "alerte" : filtrePassages === "preparer" ? e.type === "preparer" : e.type === "fait")));
    const n = (f) => tous.filter(f).length, v = voyagePassages && parId(S.voyages, voyagePassages);
    const jours = []; for (const e of ev.slice(0, 200)) { const j = e.date.slice(0, 10); if (jours[jours.length - 1]?.j !== j) jours.push({ j, l: [] }); jours[jours.length - 1].l.push(e); }
    const choixLieu = `<div class="row passage-filtres"><div class="segmented" role="tablist">${[["", "Tous les ports"], ["tmed", "Tanger Med"], ["alg", "Algeciras"]].map(([k, l]) => `<button role="tab" data-act="passage-lieu" data-id="${k}" aria-selected="${k === lieuPassages}">${l}</button>`).join("")}</div></div>`;
    return `${choixLieu}${L ? blocLieu(vuePort(lieuPassages, { maintenant })) : ""}<div class="kpis compact">
        <div class="kpi"><div class="l">Au port maintenant</div><div class="v">${au.length}</div><div class="s">${au.filter((x) => x.retard).length} en attente anormale</div></div>
        <div class="kpi"><div class="l">Alertes · 30 jours</div><div class="v">${n((e) => e.categorie === "alerte")}</div><div class="s">${nonLusPassages()} non lue(s) · ${n((e) => e.type === "inspection")} inspection(s) · ${n((e) => e.type === "reference")} référence(s) à noter</div></div>
        <div class="kpi"><div class="l">À préparer</div><div class="v">${n((e) => e.type === "preparer")}</div><div class="s">CHED, ENS, export, DUM import</div></div>
        <div class="kpi"><div class="l">Étapes faites · 30 jours</div><div class="v">${n((e) => e.type === "fait")}</div><div class="s">à Tanger Med et Algeciras</div></div></div>
      <div class="section-title">${L ? `Dans le port de ${esc(L.lib)}` : "Au port maintenant"} · ${au.length}</div>
      <div class="card">${au.length ? `<div class="passage-ports">${au.map(carteEnPassage).join("")}</div>` : `<p class="hint" style="margin:0">Aucun camion en cours de passage. Dès qu'une étape est faite (sur la fiche du voyage, par le GPS ou par le chauffeur), il apparaît ici avec ce qui doit se passer ensuite.</p>`}</div>
      <div class="section-title">Fil des passages</div>
      <div class="row passage-filtres"><div class="segmented" role="tablist">${[["", "Tout"], ["alertes", "Alertes"], ["preparer", "À préparer"], ["fait", "Étapes faites"]].map(([k, l]) => `<button role="tab" data-act="passage-filtre" data-id="${k}" aria-selected="${k === filtrePassages}">${l}</button>`).join("")}</div>
        ${v ? `<span class="chip">${esc(v.ref)} ${btn("passage-filtrer", "×", { id: "", cls: "btn ghost sm", titre: "Tous les voyages" })}</span>` : ""}</div>
      <div class="card">${jours.length ? (() => { const vus = new Set(); return jours.map((g) => `<div class="groupe">${esc(dateFr(g.j))}</div>${g.l.map((e) => { const k = `${e.voyageId}:${e.suite?.id}`, premier = !vus.has(k); vus.add(k); return ligneEvenement(e, lu, premier); }).join("")}`).join(""); })() : `<p class="hint" style="margin:0">Rien pour l'instant. Chaque étape du passage des ports (fiche du voyage → Passage des ports) apparaîtra ici avec sa signification et la suite.</p>`}</div>
      <p class="hint">Les délais « habituels » sont des repères réglables (Réglages → Rappels → Notifications des passages). Les étapes et documents sont à confirmer avec votre transitaire ; sources : Tanger Med, ministère espagnol de l'Agriculture (PCF d'Algeciras), règlements EES et ICS2.</p>`;
  },
  async agir(act, id) {
    if (act === "passage-filtre") { filtrePassages = id; return rafraichir(); }
    if (act === "passage-lieu") { lieuPassages = id; return rafraichir(); }
    if (act === "passage-filtrer") { voyagePassages = id; return rafraichir(); }
    if (act === "passage-voyage") return typeof ouvrirVoyage === "function" ? ouvrirVoyage(id) : afficher("voyages");
    if (act === "passages-lu") { (S.notifsEtat ||= { annulees: {}, reports: {} }).passagesLus = new Date().toISOString(); sauver(); return rafraichir(); }
    if (act === "passage-fait") { const [vid, eid] = String(id).split("|"), v = parId(S.voyages, vid); if (v) await saisirEtapePort(v, eid); return; }
    if (act === "passage-notifier") return notifierPassageManuel(id);
  },
};

/* ---------- envoi ---------- */
async function notifierPassageManuel(evId) {
  const ev = centrePassages().find((e) => e.id === evId); if (!ev) return;
  const tous = Object.fromEntries(CATEGORIES_PASSAGE.map(([k]) => [k, AUDIENCES_PASSAGE.map(([a]) => a)]));
  const { messages, manques } = messagesEvenement(ev, { routage: { ...tous, chauffeur: ["chauffeur"] } });
  if (!messages.length) return toast(manques[0] || "Aucun destinataire : renseignez les contacts (Réglages → Rappels).", "warn");
  const corps = `${messages.map((m, i) => `<div class="notif-ligne"><label class="check"><input type="checkbox" name="ok_${i}" ${m.audience === "in_app" || routagePassages()[ev.categorie]?.includes(m.audience) ? "checked" : ""}><span><strong>${esc(m.nom || m.audience)}</strong> <span class="sub">${esc({ in_app: "dans l'application", ntfy: "ntfy", email: "e-mail", whatsapp: "WhatsApp", sms: "SMS" }[m.canal] || m.canal)}${m.destination ? " · " + esc(m.destination) : ""}</span></span></label>
    <textarea name="texte_${i}" rows="4">${esc(m.texte)}</textarea></div>`).join("")}${manques.length ? `<p class="hint">Non joignables : ${manques.map(esc).join(" · ")}.</p>` : ""}`;
  const f = await modale({ titre: `Notifier — ${ev.titre}`, corps, valider: "Envoyer" }); if (!f) return;
  const choisis = messages.map((m, i) => (f[`ok_${i}`] ? { ...m, texte: String(f[`texte_${i}`] || m.texte).slice(0, 2000), cle: `${m.cle}:manuel:${Date.now()}` } : null)).filter(Boolean);
  if (!choisis.length) return;
  const r = await envoyerNotifications(choisis, { forcer: true }); sauver();
  if (r.liens.length) await modale({ titre: "À envoyer vous-même", valider: "Fermer", annuler: "", corps: `<div class="liens-envoi">${r.liens.map((l) => `<a class="btn" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.lib)}</a>`).join("")}</div>${r.erreurs.length ? `<p class="hint">${r.erreurs.map(esc).join(" · ")}</p>` : ""}` });
  else toast(r.erreurs.length ? `${r.envoyes} envoyé(s) · ${r.erreurs[0]}` : `${r.envoyes} notification(s) envoyée(s)`, r.erreurs.length ? "warn" : "ok");
}
let passagesAutoEnCours = false;
/** Envoie les événements récents pas encore notifiés (étape faite, alerte, à préparer) selon le routage. */
async function notifierPassagesAuto() {
  if (passagesAutoEnCours) return; passagesAutoEnCours = true;
  try {
    const a = passagesANotifier(); if (!a.length) return;
    for (const { v, ev } of a) {
      (v.notifsPassage ||= []).push(ev.id); v.notifsPassage = v.notifsPassage.slice(-300); // noté avant l'envoi : jamais deux fois depuis cet appareil
      const { messages } = messagesEvenement(ev), r = await envoyerNotifications(messages);
      if (r.liens.length) ajouterFil(`${ev.titre} : ${r.liens.length} message(s) à envoyer vous-même`, { id: `liens:${ev.id}`, voyageId: v.id, liens: r.liens });
    }
    sauverSansNotif(); if (ongletActif === "passages" || ongletActif === "tableau") rafraichir();
  } catch (e) { console.warn("Notifications des passages :", e); } finally { passagesAutoEnCours = false; }
}
if (typeof sauver === "function") { const avantPassages = sauver; sauver = function () { const r = avantPassages.apply(this, arguments); try { if (passagesANotifier().length) setTimeout(notifierPassagesAuto, 0); } catch (e) { console.warn(e); } return r; }; }
setInterval(() => { try { if (passagesANotifier().length) notifierPassagesAuto(); } catch { /* ignoré */ } }, 60000); // les attentes trop longues apparaissent avec le temps

/* ---------- réglages : qui est prévenu, repères de délai ---------- */
enregistrerCarteReglages({
  onglet: "rappels", ordre: 21,
  rendu() {
    const r = routagePassages(), etapes = Object.entries(PORTS_PASSAGE).flatMap(([port, p]) => p.etapes.filter((e) => SUITES_PASSAGE[e.id]?.seuil).map((e) => ({ e, port: p.lib.split(" — ")[0] })));
    return `<div class="card" id="carte-passages"><div class="card-head"><h2>Notifications des passages</h2></div>
      <p class="hint" style="margin-top:0">Chaque étape du passage des ports (Tanger Med, Algeciras) peut prévenir automatiquement. Les contacts (sujet ntfy, e-mail, WhatsApp) se renseignent dans « Notifications par étape » ci-dessus.</p>
      <form id="f-passages"><div class="table-wrap"><table class="compact sans-cartes acces"><thead><tr><th>Catégorie</th>${AUDIENCES_PASSAGE.map(([, l]) => `<th>${esc(l)}</th>`).join("")}</tr></thead><tbody>
        ${CATEGORIES_PASSAGE.map(([k, l]) => `<tr><th scope="row">${esc(l)}</th>${AUDIENCES_PASSAGE.map(([a]) => (k === "chauffeur") === (a === "chauffeur") ? `<td><input type="checkbox" name="r__${k}__${a}" ${(r[k] || []).includes(a) ? "checked" : ""} aria-label="${esc(l)} : ${esc(a)}"></td>` : "<td></td>").join("")}</tr>`).join("")}
      </tbody></table></div>
      <details style="margin-top:10px"><summary><strong>Repères de délai</strong> <span class="sub">au-delà, une alerte « en attente » part (le double : alerte urgente)</span></summary>
        <div class="form-grid" style="margin-top:8px">${etapes.map(({ e, port }) => `<label class="f">${esc(port)} — ${esc(e.lib)} (min)<input type="number" min="0" step="5" name="s__${e.id}" value="${seuilPassage(e.id)}"></label>`).join("")}</div></details>
      <div class="row" style="justify-content:flex-end;margin-top:10px">${btn("passages-defaut", "Par défaut", { cls: "btn ghost" })}<button class="btn">Enregistrer</button></div></form></div>`;
  },
  agir(act) { if (act !== "passages-defaut") return false; delete S.params.routagePassages; delete S.params.seuilsPassage; sauver(); toast("Notifications des passages remises par défaut"); rafraichir(); return true; },
  soumettre(fid, v) {
    if (fid !== "f-passages") return false;
    const routage = Object.fromEntries(CATEGORIES_PASSAGE.map(([k]) => [k, AUDIENCES_PASSAGE.map(([a]) => a).filter((a) => v[`r__${k}__${a}`])]));
    const seuils = {}; for (const [k, x] of Object.entries(v)) if (k.startsWith("s__") && x !== "" && Number(x) !== SUITES_PASSAGE[k.slice(3)]?.seuil) seuils[k.slice(3)] = Math.max(0, Number(x));
    S.params.routagePassages = routage; if (Object.keys(seuils).length) S.params.seuilsPassage = seuils; else delete S.params.seuilsPassage;
    sauver(); toast("Notifications des passages enregistrées"); rafraichir(); return true;
  },
});

/* ---------- accueil : alertes de passage en tête ---------- */
if (VUES.tableau) {
  const renduTableauAvantPassages = VUES.tableau.rendu;
  VUES.tableau.rendu = function () {
    const html = renduTableauAvantPassages.call(this), au = voyagesEnPassage(), alertes = au.filter((x) => x.retard);
    if (!au.length) return html;
    const bloc = `<div class="card" id="bloc-passages"><div class="card-head"><h2>Passages douane</h2>${alertes.length ? badge(`${alertes.length} en attente anormale`, "warn") : badge(`${au.length} au port`, "ok")}</div>
      ${au.slice(0, 4).map((x) => `<div class="trav"><div><strong>${esc(x.v.ref)} · ${esc(x.prochaine ? etapePortLib(x.prochaine) : etapePortLib(x.derniere))}</strong><span class="sub">${x.retard ? "en attente" : "dernière étape"} depuis ${esc(dureePassage(x.depuisMin))} · ${esc(x.derniere.e.lib)}</span></div></div>`).join("")}
      <div class="row">${btn("aller", "Ouvrir les passages", { id: "passages", cls: "btn ghost sm", icone: "flag" })}</div></div>`;
    return bloc + html;
  };
}
