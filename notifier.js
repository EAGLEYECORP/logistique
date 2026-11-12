"use strict";
/* ============================================================
   Notifications par étape (interface) : « Notifier » sur chaque étape, envois automatiques, rappels programmés,
   fil de l'application, réglages (destinataires, routage, messages en quatre langues, essai).
   Logique pure dans jalons_notifications.js ; envoi programmé par le relais (serveur/relais.js), application fermée.
   Sans relais : ntfy part directement de l'application, WhatsApp, e-mail et SMS s'ouvrent prêts à envoyer.
   ============================================================ */

/* ---------- envoi ---------- */
let capacitesRelais = { t: 0, canaux: [] };
async function canauxRelais() {
  if (typeof partageRelais !== "function" || !partageRelais()) return [];
  if (Date.now() - capacitesRelais.t < 10 * 60000) return capacitesRelais.canaux;
  try { const e = await partageAppel("GET", "/api/etat"); capacitesRelais = { t: Date.now(), canaux: e.notifications || [] }; } catch { capacitesRelais = { t: Date.now() - 9 * 60000, canaux: [] }; }
  return capacitesRelais.canaux;
}
/** Lien pour envoyer soi-même un message (WhatsApp, e-mail, SMS) quand le relais ne peut pas l'envoyer. */
function lienEnvoi(m) {
  if (m.canal === "whatsapp") return { lib: `WhatsApp — ${m.nom || m.destination}`, href: `https://wa.me/${m.destination}?text=${encodeURIComponent(m.texte)}` };
  if (m.canal === "sms") return { lib: `SMS — ${m.nom || m.destination}`, href: `sms:+${m.destination}?&body=${encodeURIComponent(m.texte)}` };
  if (m.canal === "email") return { lib: `E-mail — ${m.nom || m.destination}`, href: `mailto:${m.destination}?subject=${encodeURIComponent(m.sujet || "")}&body=${encodeURIComponent(m.texte)}` };
  return null;
}
function ajouterFil(texte, { id = uid(), voyageId = "", liens = [] } = {}) {
  S.notificationsApp ||= [];
  if (S.notificationsApp.some((x) => x.id === id || (x.texte === texte && Date.now() - Date.parse(x.date) < 10 * 60000))) return false; // même message pour plusieurs destinataires de l'application : une seule ligne
  S.notificationsApp.unshift({ id, date: new Date().toISOString(), texte, voyageId, liens, lu: false });
  S.notificationsApp = S.notificationsApp.slice(0, 200);
  return true;
}
/**
 * Envoie des messages : fil de l'application, relais (ntfy, e-mail, WhatsApp, canaux de l'équipe), sinon ntfy direct et liens à ouvrir.
 * Renvoie { envoyes, liens: [{ lib, href }], erreurs }.
 */
async function envoyerNotifications(messages, { forcer = false } = {}) {
  const res = { envoyes: 0, liens: [], erreurs: [] }, caps = await canauxRelais(), viaRelais = [];
  for (const m of messages) {
    if (m.canal === "in_app") { if (ajouterFil(m.texte, { id: m.id + ":" + Math.round((m.quand || Date.now()) / 60000), voyageId: m.voyageId })) res.envoyes++; continue; }
    if (caps.includes(m.canal) && !(m.canal === "whatsapp" && !caps.includes("whatsapp"))) { viaRelais.push(m); continue; }
    if (m.canal === "ntfy") { try { const r = await fetch(m.destination, { method: "POST", body: m.texte, headers: { Title: "Logistique Fret" } }); if (r.ok) res.envoyes++; else res.erreurs.push(`ntfy : réponse ${r.status}`); } catch { res.erreurs.push("ntfy : injoignable"); } continue; }
    if (m.canal === "equipe") { res.erreurs.push("Canaux de l'équipe : relais nécessaire"); continue; }
    const l = lienEnvoi(m); if (l) res.liens.push(l);
  }
  if (viaRelais.length) {
    try {
      const r = await partageAppel("POST", "/api/notifications/manuelle", { forcer, messages: viaRelais.map(({ id, canal, destination, repli, sujet, texte, cle, voyageId }) => ({ id, canal, destination, repli, sujet, texte, cle, voyageId })) });
      for (const [i, j] of (r.journal || []).entries()) {
        if (j.statut === "envoye" || j.statut === "deja_envoye") res.envoyes++;
        else { res.erreurs.push(`${viaRelais[i]?.nom || j.id} : ${j.raison || (j.erreurs || []).join(", ") || j.statut}`); const l = lienEnvoi(viaRelais[i]); if (l) res.liens.push(l); }
      }
    } catch (e) { res.erreurs.push(e.message); for (const m of viaRelais) { const l = lienEnvoi(m); if (l) res.liens.push(l); } }
  }
  return res;
}

/* ---------- envois automatiques à chaque étape ---------- */
let autoEnCours = false;
async function notifierEtapesAuto() {
  if (autoEnCours) return; autoEnCours = true;
  try {
    for (const { voyage: v, jalon } of jalonsANotifier()) {
      (v.notifsJalons ||= []).push(jalon); // marqué avant l'envoi : jamais deux fois depuis cet appareil
      const { messages } = notificationsJalon(v, jalon), r = await envoyerNotifications(messages);
      if (r.liens.length) ajouterFil(`${v.ref} — ${LIB_JALONS_LANGUES[jalon]?.fr || jalon} : ${r.liens.length} message(s) à envoyer vous-même`, { id: `liens:${v.id}:${jalon}`, voyageId: v.id, liens: r.liens });
    }
    sauverSansNotif();
  } catch (e) { console.warn("Notifications automatiques :", e); } finally { autoEnCours = false; }
}
/* ---------- plan envoyé au relais (il l'exécute même application fermée) ---------- */
let planMinuteur = null, planDernier = "";
function planifierEnvoiPlan() { clearTimeout(planMinuteur); planMinuteur = setTimeout(envoyerPlan, 4000); }
async function envoyerPlan() {
  const caps = await canauxRelais(); if (!caps.length) return;
  const p = planNotifications({ jusqua: Date.now() + 8 * 86400000 }).filter((m) => caps.includes(m.canal));
  const corps = { messages: p.map(({ id, quand, canal, destination, repli, sujet, texte, cle, voyageId }) => ({ id, quand, canal, destination, repli, sujet, texte, cle, voyageId })) }, empreinte = JSON.stringify(corps);
  if (empreinte === planDernier) return;
  try { await partageAppel("PUT", "/api/notifications/plan", corps); planDernier = empreinte; } catch (e) { console.warn("Plan de notifications :", e.message); }
}
/** Rappels destinés au fil de l'application (et à ntfy quand il n'y a pas de relais) : remis par l'application ouverte. */
async function remettreRappelsLocaux() {
  const caps = await canauxRelais(), maintenant = Date.now(), dus = planNotifications({ depuis: maintenant - 6 * 3600000, jusqua: maintenant, maintenant: maintenant - 6 * 3600000 }).filter((m) => m.canal === "in_app" || (!caps.includes(m.canal) && m.canal === "ntfy"));
  S.notifsEtat ||= { annulees: {}, reports: {} }; S.notifsEtat.remis ||= {};
  const nouveaux = dus.filter((m) => !S.notifsEtat.remis[m.cle]); if (!nouveaux.length) return;
  for (const m of nouveaux) S.notifsEtat.remis[m.cle] = new Date().toISOString();
  await envoyerNotifications(nouveaux); sauverSansNotif();
}
let sauverSansNotif = typeof sauver === "function" ? sauver : () => {};
if (typeof sauver === "function") { const avant = sauver; sauverSansNotif = avant; sauver = function () { const r = avant.apply(this, arguments); try { if (jalonsANotifier().length) setTimeout(notifierEtapesAuto, 0); planifierEnvoiPlan(); } catch (e) { console.warn("Notifications :", e); } return r; }; }
setInterval(() => { remettreRappelsLocaux().catch(() => {}); }, 60000);
setTimeout(() => { remettreRappelsLocaux().catch(() => {}); planifierEnvoiPlan(); }, 3000);

/* ---------- « Notifier » sur une étape ---------- */
async function notifierJalonManuel(v, jalon) {
  const { messages, manques } = notificationsJalon(v, jalon);
  if (!messages.length) return toast(manques.length ? `Personne à prévenir : ${manques[0]}` : "Aucun destinataire pour cette étape (Réglages → Rappels).", "warn");
  const corps = `${messages.map((m, i) => `<div class="notif-ligne"><label class="check"><input type="checkbox" name="ok_${i}" checked><span><strong>${esc(m.nom || libDe(AUDIENCES_NOTIF, m.audience))}</strong> <span class="sub">${esc({ in_app: "dans l'application", ntfy: "ntfy", email: "e-mail", whatsapp: "WhatsApp", sms: "SMS", equipe: "canaux du relais" }[m.canal] || m.canal)}${m.destination ? " · " + esc(m.destination) : ""} · ${esc(m.langue)}</span></span></label>
      <textarea name="texte_${i}" rows="3" ${m.langue === "ar" ? 'dir="rtl"' : ""}>${esc(m.texte)}</textarea></div>`).join("")}
    ${manques.length ? `<p class="hint">Non prévenus : ${manques.map(esc).join(" · ")}.</p>` : ""}`;
  const f = await modale({ titre: `Notifier — ${LIB_JALONS_LANGUES[jalon]?.fr || jalon} (${v.ref})`, corps, valider: "Envoyer" });
  if (!f) return;
  const choisis = messages.map((m, i) => (f[`ok_${i}`] ? { ...m, texte: String(f[`texte_${i}`] || m.texte).slice(0, 2000), cle: `${m.cle}:manuel:${Date.now()}` } : null)).filter(Boolean);
  if (!choisis.length) return;
  const r = await envoyerNotifications(choisis, { forcer: true });
  if (!(v.notifsJalons || []).includes(jalon)) (v.notifsJalons ||= []).push(jalon);
  sauver();
  if (r.liens.length) await modale({ titre: "À envoyer vous-même", valider: "Fermer", annuler: "", corps: `<p class="hint" style="margin-top:0">Ces messages s'ouvrent prêts à envoyer (le relais ne peut pas les envoyer${r.erreurs.length ? " ou a échoué" : ""}).</p><div class="liens-envoi">${r.liens.map((l) => `<a class="btn" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.lib)}</a>`).join("")}</div>${r.erreurs.length ? `<p class="hint">${r.erreurs.map(esc).join(" · ")}</p>` : ""}` });
  else toast(r.erreurs.length ? `${r.envoyes} envoyé(s) · ${r.erreurs[0]}` : `${r.envoyes} notification(s) envoyée(s)`, r.erreurs.length ? "warn" : "ok");
  rafraichir();
}
const agirVoyagesAvantNotif = VUES.voyages.agir;
VUES.voyages.agir = async function (act, id, b) {
  if (act === "notifier-jalon") { const [vid, jalon] = String(id).split("|"), v = parId(S.voyages, vid); if (v) { voyagesOuverts.add(v.id); await notifierJalonManuel(v, jalon); } return; }
  return agirVoyagesAvantNotif.call(this, act, id, b);
};

/* ---------- panneau : notifications programmées (24 h) et fil ---------- */
function blocNotifications() {
  const p = planNotifications({ jusqua: Date.now() + 24 * 3600000 }), fil = (S.notificationsApp || []).slice(0, 6), nonLus = (S.notificationsApp || []).filter((x) => !x.lu).length;
  if (!p.length && !fil.length) return "";
  const hm = (ms) => new Date(ms).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return `<div class="card" id="bloc-notifications"><div class="card-head"><h2>Notifications</h2>${nonLus ? badge(`${nonLus} nouvelle(s)`, "warn") : ""}</div>
    ${p.length ? `<div class="groupe">Programmées · 24 h · ${p.length}</div>${p.map((m) => `<div class="trav"><div><strong>${esc(hm(m.quand))} · ${esc(m.nom || libDe(AUDIENCES_NOTIF, m.audience))}${m.reporte ? " · reportée" : ""}</strong><span class="sub">${esc(m.texte)}</span></div>
      <div class="r">${btn("notif-reporter", "+1 h", { id: m.id, cls: "btn ghost sm", titre: "Reporter d'une heure" })}${btn("notif-annuler", "Annuler", { id: m.id, cls: "btn ghost sm" })}</div></div>`).join("")}` : ""}
    ${fil.length ? `<div class="groupe">Dernières</div>${fil.map((x) => `<div class="trav ${x.lu ? "" : "nouveau"}"><div><strong>${esc(x.texte)}</strong><span class="sub">${dateHeureFr(x.date)}</span>${(x.liens || []).length ? `<div class="liens-envoi">${x.liens.map((l) => `<a class="btn ghost sm" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.lib)}</a>`).join("")}</div>` : ""}</div>${x.voyageId ? `<div class="r">${btn("voyage", "Voyage", { id: x.voyageId, cls: "btn ghost sm" })}</div>` : ""}</div>`).join("")}
      ${nonLus ? `<div class="row">${btn("notif-lu", "Tout marquer comme lu", { cls: "btn ghost sm" })}</div>` : ""}` : ""}</div>`;
}
async function agirNotifications(act, id) {
  S.notifsEtat ||= { annulees: {}, reports: {} };
  if (act === "notif-annuler") {
    S.notifsEtat.annulees = { ...(S.notifsEtat.annulees || {}), [id]: new Date().toISOString() };
    try { if ((await canauxRelais()).length) await partageAppel("DELETE", `/api/notifications/scheduler/${encodeURIComponent(id)}`); } catch { /* le prochain plan ne le contiendra plus */ }
    sauver(); toast("Notification annulée"); rafraichir(); return true;
  }
  if (act === "notif-reporter") { S.notifsEtat.reports = { ...(S.notifsEtat.reports || {}), [id]: num(S.notifsEtat.reports?.[id]) + 3600000 }; sauver(); toast("Reportée d'une heure"); rafraichir(); return true; }
  if (act === "notif-lu") { (S.notificationsApp || []).forEach((x) => { x.lu = true; }); sauver(); rafraichir(); return true; }
  return false;
}
for (const vue of ["tableau", "direction", "operations"]) {
  const V = VUES[vue]; if (!V) continue;
  const rendu = V.rendu, agir = V.agir;
  V.rendu = function () {
    const html = rendu.call(this), b = S.voyages.length ? blocNotifications() : "", ancre = /(<div class="card"[^>]*>\s*<div class="card-head"><h2>À traiter)/;
    return vue === "tableau" && ancre.test(html) ? html.replace(ancre, `${b}$1`) : html + b;
  };
  V.agir = async function (act, id, el) {
    if (await agirNotifications(act, id)) return;
    if (act === "voyage" && vue === "direction" && typeof ouvrirVoyage === "function") return ouvrirVoyage(id);
    return agir?.call(this, act, id, el);
  };
}

/* ---------- réglages : destinataires, routage, messages, essai ---------- */
let reglageJalon = "livre";
function routageModifiable(jalon) { const r = JSON.parse(JSON.stringify(routageJalons().find((x) => x.jalon === jalon))); return r; }
function enregistrerRoutage(r) { S.routageJalons = [...(S.routageJalons || []).filter((x) => x.jalon !== r.jalon), { ...r, id: r.jalon }]; }
enregistrerCarteReglages({
  onglet: "rappels", ordre: 20,
  rendu() {
    const a = S.entreprise?.audiences || {}, internes = AUDIENCES_NOTIF.filter(([k]) => AUDIENCES_INTERNES.includes(k)), r = routageJalons();
    return `<div class="card" id="carte-notif-jalons"><div class="card-head"><h2>Notifications par étape</h2></div>
      <form id="f-notif-dest"><div class="section-title" style="margin-top:0">Destinataires</div>
        <div class="table-wrap"><table class="compact"><thead><tr><th>Qui</th><th>Sujet ntfy (https://ntfy.sh/…)</th><th>E-mail</th><th>WhatsApp</th><th>Langue</th></tr></thead><tbody>
        ${internes.map(([k, lib]) => `<tr><td><strong>${esc(lib)}</strong></td><td><input name="ntfy_${k}" value="${esc(a[k]?.ntfy || "")}" placeholder="https://ntfy.sh/sujet-secret" inputmode="url"></td><td><input name="email_${k}" type="email" value="${esc(a[k]?.email || "")}"></td><td><input name="wa_${k}" type="tel" value="${esc(a[k]?.whatsapp || "")}"></td>
          <td><select name="langue_${k}">${LANGUES_NOTIF.map((l) => `<option value="${l}" ${(a[k]?.langue || "fr") === l ? "selected" : ""}>${l}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>
        <div class="row" style="justify-content:flex-end;margin-top:8px">${btn("notif-essai", "Essayer les canaux", { cls: "btn ghost" })}<button class="btn">Enregistrer</button></div></form>
      <div class="section-title">Qui est prévenu à chaque étape</div>
      <div class="table-wrap"><table class="compact grille-notif"><thead><tr><th>Étape</th><th>Auto</th>${AUDIENCES_NOTIF.map(([k, lib]) => `<th title="${esc(lib)}">${esc(lib.split(" ")[0])}</th>`).join("")}<th></th></tr></thead><tbody>
        ${r.map((x) => `<tr><td>${esc(LIB_JALONS_LANGUES[x.jalon].fr)}</td><td><input type="checkbox" data-routage="${x.jalon}|auto" ${x.auto ? "checked" : ""} aria-label="Envoi automatique"></td>
          ${AUDIENCES_NOTIF.map(([k]) => `<td><input type="checkbox" data-routage="${x.jalon}|${k}" ${x.audiences[k] ? "checked" : ""} aria-label="${esc(libDe(AUDIENCES_NOTIF, k))}"></td>`).join("")}
          <td>${btn("notif-modele", "Message", { id: x.jalon, cls: "btn ghost sm" })}</td></tr>`).join("")}</tbody></table></div>
      <p class="hint">Auto : envoyé dès que l'étape est atteinte (GPS ou chauffeur). Sinon, bouton « Notifier » sur l'étape du voyage. Le client n'est prévenu que s'il l'a accepté (fiche client). Les rappels programmés (veille du départ, présentation au port, embarquement, livraison, facture à émettre) partent du relais à l'heure, même application fermée. ntfy est gratuit : installez l'application ntfy et abonnez-vous au sujet (gardez-le secret).</p></div>`;
  },
  async agir(act, id) {
    if (act === "notif-modele") {
      const r = routageModifiable(id), v = S.voyages.find((x) => x.statut === "en_cours") || S.voyages[0] || { id: "exemple", ref: "V-26-001", origine: "Agadir", destination: "Perpignan", statut: "prevu" };
      const apercu = (l, t) => remplirModele(t || MODELE_EQUIPE[l], variablesNotif(v, id, l, Date.now()));
      apercuNotif = { apercu };
      const f = await modale({ titre: `Message — ${LIB_JALONS_LANGUES[id].fr}`, valider: "Enregistrer", corps: `${LANGUES_NOTIF.map((l) => `<label class="f full">${{ fr: "Français", en: "English", es: "Español", ar: "العربية" }[l]}<textarea name="m_${l}" rows="2" ${l === "ar" ? 'dir="rtl"' : ""} placeholder="${esc(MODELE_EQUIPE[l])}" data-apercu="${l}">${esc(r.modeles?.[l] || "")}</textarea></label><p class="hint apercu" id="apercu-${l}" ${l === "ar" ? 'dir="rtl"' : ""}>${esc(apercu(l, r.modeles?.[l]))}</p>`).join("")}
        <p class="hint">Message envoyé à l'équipe pour cette étape. Vide = message par défaut. Variables : {ref} {client} {origine} {destination} {jalon} {heure} {camion} {chauffeur} {reservation} {eta} {lien}. Les messages du client, de la comptabilité et du transitaire ont leur propre modèle.</p>` });
      if (!f) return true;
      r.modeles = Object.fromEntries(LANGUES_NOTIF.filter((l) => String(f[`m_${l}`] || "").trim()).map((l) => [l, String(f[`m_${l}`]).trim().slice(0, 1000)]));
      enregistrerRoutage(r); sauver(); toast("Message enregistré"); rafraichir(); return true;
    }
    if (act === "notif-essai") {
      const a = S.entreprise?.audiences || {}, ntfy = Object.values(a).map((x) => x?.ntfy).find(sujetNtfyValide), email = Object.values(a).map((x) => x?.email).find(emailValide);
      if (!(await canauxRelais()).length) { if (!ntfy) return toast("Renseignez un sujet ntfy, ou réglez le relais (Carte → réglages).", "warn"); try { const r = await fetch(ntfy, { method: "POST", body: "Essai : les notifications de Logistique Fret arrivent bien ici.", headers: { Title: "Logistique Fret" } }); toast(r.ok ? "Essai envoyé sur ntfy" : `ntfy : réponse ${r.status}`, r.ok ? "ok" : "danger"); } catch { toast("ntfy injoignable", "danger"); } return true; }
      try { const r = await partageAppel("POST", "/api/notifications/test", { ntfy, email }); await modale({ titre: "Essai des canaux", valider: "Fermer", annuler: "", corps: `<ul class="ctl">${r.resultats.map((x) => `<li class="${x.envoyes.length ? "" : "warn"}">${ic(x.envoyes.length ? "check" : "alert")}<span><strong>${esc(x.canal)}</strong><span class="sub">${x.envoyes.length ? "reçu : " + x.envoyes.map(esc).join(", ") : x.erreurs.map(esc).join(" · ")}</span></span></li>`).join("")}</ul>` }); } catch (e) { toast(e.message, "danger"); }
      return true;
    }
    return false;
  },
  soumettre(fid, v) {
    if (fid !== "f-notif-dest") return false;
    const a = {};
    for (const [k] of AUDIENCES_NOTIF.filter(([k]) => AUDIENCES_INTERNES.includes(k))) {
      const x = { ntfy: (v[`ntfy_${k}`] || "").trim(), email: (v[`email_${k}`] || "").trim(), whatsapp: (v[`wa_${k}`] || "").trim(), langue: v[`langue_${k}`] || "fr" };
      if (x.ntfy && !sujetNtfyValide(x.ntfy)) { toast(`${libDe(AUDIENCES_NOTIF, k)} : sujet ntfy invalide (https://ntfy.sh/ suivi de 6 à 64 lettres, chiffres, - ou _)`, "danger"); return true; }
      if (x.email && !emailValide(x.email)) { toast(`${libDe(AUDIENCES_NOTIF, k)} : adresse e-mail invalide`, "danger"); return true; }
      if (x.ntfy || x.email || x.whatsapp || x.langue !== "fr") a[k] = x;
    }
    (S.entreprise ||= {}).audiences = a; sauver(); toast("Destinataires enregistrés"); rafraichir(); return true;
  },
});
// aperçu en direct dans l'éditeur de message
let apercuNotif = null;
document.addEventListener("input", (e) => { const t = e.target.closest?.("[data-apercu]"); if (!t || !apercuNotif) return; const p = document.getElementById(`apercu-${t.dataset.apercu}`); if (p) p.textContent = apercuNotif.apercu(t.dataset.apercu, t.value.trim()); });
// cases du routage : prises en compte au clic
document.addEventListener("change", (e) => {
  const c = e.target.closest?.("[data-routage]"); if (!c) return;
  const [jalon, cle] = c.dataset.routage.split("|"), r = routageModifiable(jalon);
  if (cle === "auto") r.auto = c.checked; else if (c.checked) r.audiences[cle] = [AUDIENCES_NOTIF.find((x) => x[0] === cle)[2]]; else delete r.audiences[cle];
  enregistrerRoutage(r); sauver(); toast(`${LIB_JALONS_LANGUES[jalon].fr} : routage enregistré`);
});

/* ---------- alertes manquées : un appareil revenu en ligne récupère l'historique du relais (7 jours) ---------- */
const CLE_ALERTES_VUES = "logistique-alertes-vues";
async function recupererAlertesManquees() {
  if (typeof partageRelais !== "function" || !partageRelais()) return 0;
  let depuis = 0; try { depuis = Number(localStorage.getItem(CLE_ALERTES_VUES)) || 0; } catch { /* ignoré */ }
  const debut = Math.max(depuis, Date.now() - 7 * 86400000);
  let r; try { r = await partageAppel("GET", `/api/alertes/historique?debut=${debut + 1}`); } catch { return 0; }
  let n = 0, dernier = depuis;
  for (const a of r.alertes || []) { if (ajouterFil(`${a.niveau === "danger" ? "Urgent · " : ""}${a.texte}`, { id: `alerte:${a.cle}:${a.t}` })) n++; dernier = Math.max(dernier, a.t); }
  try { localStorage.setItem(CLE_ALERTES_VUES, String(dernier || Date.now())); } catch { /* ignoré */ }
  if (n) { sauverSansNotif(); if (depuis) toast(`${n} alerte(s) reçue(s) pendant votre absence`, "warn"); if (typeof rafraichir === "function") rafraichir(); }
  return n;
}
setTimeout(() => { recupererAlertesManquees().catch(() => {}); }, 2500);
setInterval(() => { recupererAlertesManquees().catch(() => {}); }, 5 * 60000);
window.addEventListener?.("online", () => { recupererAlertesManquees().catch(() => {}); });
