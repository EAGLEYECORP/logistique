"use strict";
/* ============================================================
   Mode multi-utilisateur (interface) — actif quand l'application est servie par un relais MULTI_UTILISATEUR=true.
   · premier démarrage (compte du chef, import des données de cet appareil ou d'une sauvegarde, clé de récupération) ;
   · connexion (double authentification, mot de passe oublié, clé de récupération) ;
   · données lues et écrites sur le serveur, enregistrement par enregistrement, avec version :
     si quelqu'un a modifié entre-temps, on propose de fusionner, de garder sa version ou de prendre la sienne ;
   · mises à jour en direct (SSE, reconnexion 1 s → 30 s), verrous de 30 s sur les opérations sensibles ;
   · pages Utilisateurs et Journal (chef d'entreprise), carte « Mon compte ».
   Les droits sont appliqués par le serveur (comptes.js) ; l'interface ne fait que masquer ce qui serait refusé.
   ============================================================ */

const multi = { actif: false, verifie: false, utilisateur: null, droits: {}, utilisateurs: [], seq: 0, cliche: {}, verrous: new Map(), source: null, attente: 1000, envoi: null, enAttente: false, horsLigne: false };
const multiActif = () => multi.actif && !!multi.utilisateur;
const roleMulti = () => (multiActif() ? multi.utilisateur.role : null);
const bureauUtilisateur = () => (multiActif() ? multi.utilisateur.office || "" : "");
const ONGLETS_CHEF = ["utilisateurs", "acces", "journal"];
/** Page → groupe de droits (comptes.js) : une page dont le service n'a aucun droit disparaît du menu ; un accès accordé par le chef la fait apparaître. */
const PAGE_GROUPE = { passages: "voyages", voyages: "voyages", planning: "voyages", direct: "voyages", operations: "voyages", gps: "voyages", itineraires: "voyages", international: "voyages", commandes: "commandes", factures: "factures", clients: "clients", camions: "flotte", chauffeurs: "flotte", carburant: "flotte", tachy: "flotte", douane: "douane", nomenclature: "douane" };
/** Pages permises selon le compte (undefined = laisser profils.js décider). */
function comptesOngletPermis(id) {
  if (!multiActif()) return ONGLETS_CHEF.includes(id) ? false : undefined;
  if (ONGLETS_CHEF.includes(id)) return multi.utilisateur.role === "chef_entreprise";
  const g = PAGE_GROUPE[id];
  if (g && multi.droits) {
    const cols = GROUPES_DROITS.find((x) => x[0] === g)[2], voit = cols.some((c) => multi.droits[c]);
    if (!voit) return false; // aucun droit : la page n'a rien à montrer
    const n = multi.droitsService?.[g]; if (n && n !== "aucun") return true; // accès accordé par le chef d'entreprise
  }
  return undefined;
}

/* ---------- appels au serveur ---------- */
async function api(methode, chemin, corps, entetes = {}, essai = 0) {
  let r;
  try { r = await fetch(chemin, { method: methode, credentials: "same-origin", headers: { "Content-Type": "application/json", "X-LF": "1", ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps), cache: "no-store" }); }
  catch { const e = new Error("Serveur injoignable."); e.horsLigne = true; throw e; }
  if (r.status === 401 && essai === 0 && !chemin.startsWith("/api/auth/")) { // accès expiré : renouvellement (cookie), puis on réessaie une fois
    const ok = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-LF": "1" }, body: "{}" }).then((x) => x.ok).catch(() => false);
    if (ok) return api(methode, chemin, corps, entetes, 1);
    multiDeconnecte(); const e = new Error("Session expirée : reconnectez-vous."); e.code = 401; throw e;
  }
  const json = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(json.erreur || `Réponse ${r.status} du serveur.`); e.code = r.status; e.corps = json; throw e; }
  return json;
}

/* ---------- état local ↔ serveur ---------- */
const propre = (r) => Object.fromEntries(Object.entries(r || {}).filter(([k]) => !k.startsWith("_")));
/** Ce que ce rôle peut réellement changer d'un enregistrement (le reste, calculé sur l'appareil ou invisible, est ignoré par le serveur). */
function projection(col, r) {
  if (!r || !multiActif()) return propre(r);
  const f = propre(filtrerEnregistrement(col, r, multi.utilisateur) || {}), dr = multi.droits[col];
  return Array.isArray(dr?.ecriture) ? Object.fromEntries(Object.entries(f).filter(([k]) => k === "id" || dr.ecriture.includes(k))) : f;
}
let colCourante = "";
const egalRec = (a, b, col = colCourante) => JSON.stringify(projection(col, a)) === JSON.stringify(projection(col, b));
/** Enregistrements de l'état local, par collection du serveur. */
function enregistrementsLocaux() {
  const r = {};
  for (const col of COLLECTIONS_SERVEUR) {
    if (!multi.droits[col]) continue;
    if (col === "reglages") r.reglages = REGLAGES_IDS.filter((k) => S[k] && typeof S[k] === "object").map((k) => ({ ...S[k], id: k }));
    else r[col] = (S[col] || []).filter((x) => x && x.id).map((x) => ({ ...x, id: String(x.id) }));
  }
  return r;
}
function appliquerDonnees(d) {
  multi.cliche = {}; const e = etatVide();
  for (const [col, liste] of Object.entries(d.collections || {})) {
    multi.cliche[col] = {};
    for (const r of liste) { multi.cliche[col][r.id] = { v: r._v, rec: propre(r) }; if (col === "reglages") e[r.id] = { ...(e[r.id] || {}), ...propre(r) }; else (e[col] ||= []).push(propre(r)); }
  }
  e.params = { ...PARAMS_DEFAUT, ...(e.params || {}) }; delete e.params.id; delete e.entreprise.id; if (e.notifsEtat) delete e.notifsEtat.id;
  e.meta = { ...(S?.meta || {}), version: VERSION_SCHEMA, onboarde: true };
  S = migrer(e).etat; multi.seq = d.seq || 0;
}
/** Envoie au serveur ce qui a changé localement (après chaque enregistrement), un enregistrement à la fois. */
async function pousser() {
  if (!multiActif() || multi.envoi) { multi.enAttente = true; return; }
  multi.envoi = (async () => {
    const locaux = enregistrementsLocaux();
    for (const [col, liste] of Object.entries(locaux)) {
      if (!multi.droits[col]?.ecriture) continue;
      const cliche = (multi.cliche[col] ||= {}), vus = new Set();
      for (const rec of liste) {
        vus.add(rec.id); const avant = cliche[rec.id];
        if (avant && egalRec(avant.rec, rec, col)) continue;
        if (!avant && Array.isArray(multi.droits[col].ecriture)) continue; // ce rôle ne crée pas d'enregistrement ici
        await ecrireServeur(col, rec, avant);
      }
      if (multi.droits[col]?.suppression) for (const id of Object.keys(cliche)) if (!vus.has(id)) await supprimerServeur(col, id, cliche[id]);
    }
  })();
  try { await multi.envoi; multi.horsLigne = false; } catch (e) { if (e.horsLigne) { multi.horsLigne = true; setTimeout(pousser, 30000); } else console.warn("Envoi :", e); }
  finally { multi.envoi = null; indicateurMulti(); if (multi.enAttente) { multi.enAttente = false; pousser(); } }
}
async function ecrireServeur(col, rec, avant, { forcer = false } = {}) {
  try {
    const r = await api("PUT", `/api/records/${col}/${encodeURIComponent(rec.id)}`, rec, { "If-Match": avant ? String(avant.v) : "0", ...(forcer ? { "X-Forcer": "1" } : {}) });
    multi.cliche[col][rec.id] = { v: r.enregistrement?._v ?? (avant?.v || 0) + 1, rec: propre(r.enregistrement || rec) };
    if (r.enregistrement && !egalRec(r.enregistrement, rec, col)) remplacerLocal(col, propre(r.enregistrement)); // le serveur a gardé ce que ce rôle ne peut pas changer
  } catch (e) {
    if (e.horsLigne) throw e;
    if (e.code === 409) return conflit(col, rec, avant, e.corps);
    if (e.code === 423) { toast(e.message, "warn"); return remplacerLocal(col, avant?.rec || null, rec.id); }
    toast(`${libCollection(col)} : ${e.message}`, "danger"); remplacerLocal(col, avant?.rec || null, rec.id); // refusé : on revient à la version du serveur
  }
}
async function supprimerServeur(col, id, avant) {
  try { await api("DELETE", `/api/records/${col}/${encodeURIComponent(id)}`, undefined, { "If-Match": String(avant.v) }); delete multi.cliche[col][id]; }
  catch (e) { if (e.horsLigne) throw e; if (e.code === 404) { delete multi.cliche[col][id]; return; } toast(`${libCollection(col)} : ${e.message}`, "danger"); remplacerLocal(col, avant.rec, id); }
}
function remplacerLocal(col, rec, id = rec?.id) {
  if (col === "reglages") { if (rec) S[id] = id === "params" ? { ...PARAMS_DEFAUT, ...propre(rec) } : propre(rec); if (S[id]) delete S[id].id; }
  else { const l = S[col] ||= [], i = l.findIndex((x) => String(x.id) === String(id)); if (rec) { if (i >= 0) l[i] = propre(rec); else l.push(propre(rec)); } else if (i >= 0) l.splice(i, 1); }
  sauverLocal(); if (!$("#modale")?.open) rafraichir();
}
const LIB_COLLECTIONS = { voyages: "Voyage", commandes: "Commande", factures: "Facture", clients: "Client", camions: "Camion", chauffeurs: "Chauffeur", reglages: "Réglages" };
const libCollection = (c) => LIB_COLLECTIONS[c] || c;
/** Fusion champ par champ : ce que j'ai changé + ce que l'autre a changé ; si nous avons changé le même champ, ma version. */
function fusionner(base, mien, sien) {
  const r = {};
  for (const k of new Set([...Object.keys(base || {}), ...Object.keys(mien || {}), ...Object.keys(sien || {})])) {
    if (k.startsWith("_")) continue;
    const b = JSON.stringify(base?.[k]), m = JSON.stringify(mien?.[k]), s = JSON.stringify(sien?.[k]);
    const v = m !== b ? mien?.[k] : s !== b ? sien?.[k] : mien?.[k]; if (v !== undefined) r[k] = v;
  }
  return r;
}
async function conflit(col, rec, avant, corps) {
  const actuel = corps?.actuel;
  if (!actuel) { toast("Modifié par quelqu'un d'autre : rechargement.", "warn"); return chargerDonnees(); }
  const lesDeux = Object.keys(C_diff(avant?.rec, rec)).filter((k) => JSON.stringify(actuel[k]) !== JSON.stringify(avant?.rec?.[k]) && JSON.stringify(rec[k]) !== JSON.stringify(actuel[k])), champs = lesDeux; // modifiés par moi ET par l'autre
  const choix = await new Promise((ok) => {
    modale({ titre: `${libCollection(col)} modifié entre-temps`, valider: "Fusionner (recommandé)", annuler: "Choisir autrement", corps: `<p style="margin-top:0"><strong>${esc(corps.par || "Un autre utilisateur")}</strong> a modifié ${esc((rec.ref || rec.nom || rec.immat || rec.numero || rec.id))} pendant que vous le modifiiez.</p>
      ${champs.length ? `<p class="hint">Champs modifiés des deux côtés : ${champs.map(esc).join(", ")}. La fusion garde vos changements et ajoute les siens ; pour un même champ, la vôtre l'emporte.</p>` : `<p class="hint">Vous n'avez pas touché les mêmes champs : la fusion garde les deux.</p>`}` }).then(async (f) => {
      if (f) return ok("fusionner");
      const g = await modale({ titre: "Que faire ?", valider: "Garder ma version", annuler: "Prendre la sienne", corps: `<p style="margin:0">« Garder ma version » remplace ses changements par les vôtres. « Prendre la sienne » abandonne les vôtres.</p>` });
      ok(g ? "garder" : "prendre");
    });
  });
  const base = { v: actuel._v, rec: propre(actuel) };
  if (choix === "prendre") { multi.cliche[col][rec.id] = base; remplacerLocal(col, propre(actuel)); return; }
  const final = choix === "garder" ? rec : { ...fusionner(avant?.rec, rec, propre(actuel)), id: rec.id };
  multi.cliche[col][rec.id] = base; remplacerLocal(col, final);
  await ecrireServeur(col, final, base);
}
const C_diff = (a, b) => { const r = {}; for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) if (!k.startsWith("_") && JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) r[k] = 1; return r; };

/* ---------- mises à jour en direct ---------- */
let toastMaj = null;
async function recupererChangements(par = "") {
  const r = await api("GET", `/api/changes?since=${multi.seq}`); let n = 0;
  for (const c of r.changements) {
    const cliche = (multi.cliche[c.col] ||= {}), avant = cliche[c.id], local = c.col === "reglages" ? (S[c.id] ? { ...S[c.id], id: c.id } : null) : (S[c.col] || []).find((x) => String(x.id) === c.id);
    const sansModifLocale = !local || !avant || egalRec(avant.rec, local, c.col);
    if (c.supprime) { delete cliche[c.id]; if (local) { remplacerLocalSilencieux(c.col, null, c.id); n++; } continue; }
    if (sansModifLocale) { const deja = local && JSON.stringify(projection(c.col, local)) === JSON.stringify(projection(c.col, c.enregistrement)); cliche[c.id] = { v: c.enregistrement._v, rec: propre(c.enregistrement) }; if (!deja) { remplacerLocalSilencieux(c.col, propre(c.enregistrement), c.id); n++; } } // écho de ma propre écriture : rien à faire
    // modification locale en cours : on garde le cliché ancien, l'envoi produira un conflit et proposera la fusion
  }
  multi.seq = Math.max(multi.seq, r.seq);
  if (n) { sauverLocal(); if (!$("#modale")?.open) rafraichir({ garderScroll: true }); clearTimeout(toastMaj); toastMaj = setTimeout(() => toast(par ? `Mis à jour par ${par}` : "Données mises à jour"), 300); }
}
function remplacerLocalSilencieux(col, rec, id) {
  if (col === "reglages") { if (rec) { S[id] = id === "params" ? { ...PARAMS_DEFAUT, ...rec } : { ...rec }; delete S[id].id; } return; }
  const l = S[col] ||= [], i = l.findIndex((x) => String(x.id) === String(id)); if (rec) { if (i >= 0) l[i] = rec; else l.push(rec); } else if (i >= 0) l.splice(i, 1);
}
function ouvrirFlux() {
  if (!multiActif() || typeof EventSource === "undefined") return;
  try { multi.source?.close(); } catch { /* ignoré */ }
  const es = new EventSource("/api/sse", { withCredentials: true }); multi.source = es;
  es.addEventListener("bonjour", (e) => { multi.attente = 1000; const d = JSON.parse(e.data); majVerrous(d.verrous || []); if (d.seq > multi.seq) recupererChangements().catch(() => {}); indicateurMulti(); });
  es.addEventListener("change", (e) => { const d = JSON.parse(e.data); if (d.seq > multi.seq) recupererChangements(d.par === multi.utilisateur.nom ? "" : d.par).catch(() => {}); });
  es.addEventListener("verrou", (e) => { const d = JSON.parse(e.data); if (d.libere) multi.verrous.delete(d.cle); else multi.verrous.set(d.cle, d); decorerVerrous(); });
  es.addEventListener("droits", async () => { // le chef a changé les accès par service : on recharge ce que ce rôle peut voir
    try { await chargerDonnees(); if (typeof roleAppliquer === "function") roleAppliquer(); afficher(ongletActif); if (multi.utilisateur.role !== "chef_entreprise") toast("Vos accès ont été modifiés par le chef d'entreprise.", "warn"); } catch (e) { console.warn(e); }
  });
  es.addEventListener("securite", (e) => toast(JSON.parse(e.data).texte, "warn"));
  es.addEventListener("deconnexion", () => { toast("Votre compte a été modifié : reconnectez-vous.", "warn"); multiDeconnecte(); });
  es.onerror = () => { es.close(); multi.source = null; indicateurMulti(); const a = multi.attente; multi.attente = Math.min(30000, a * 2); setTimeout(ouvrirFlux, a); };
}
const majVerrous = (l) => { multi.verrous = new Map(l.map((v) => [v.cle, v])); decorerVerrous(); };
/** « X est en train de modifier » sur les fiches verrouillées par quelqu'un d'autre. */
function decorerVerrous() {
  document.querySelectorAll(".badge-verrou").forEach((b) => b.remove());
  for (const [cle, v] of multi.verrous) {
    if (v.u === multi.utilisateur?.id || v.exp < Date.now()) continue;
    const [col, id] = cle.split("/"), el = col === "voyages" ? document.querySelector(`[data-voyage="${CSS.escape(id)}"] summary .row`) : null;
    if (el) el.insertAdjacentHTML("afterbegin", `<span class="badge warn badge-verrou">${esc(v.nom)} modifie${v.raison ? " (" + esc(v.raison) + ")" : ""}</span>`);
  }
}
async function verrouiller(col, id, raison) {
  if (!multiActif()) return true;
  try { await api("POST", "/api/verrous", { col, id, raison }); return true; } catch (e) { toast(e.message, "warn"); return false; }
}
const liberer = (col, id) => { if (multiActif()) api("DELETE", `/api/verrous/${col}/${encodeURIComponent(id)}`).catch(() => {}); };

/* ---------- enregistrement : local, puis serveur ---------- */
let sauverLocal = () => {};
if (typeof sauver === "function") { const avant = sauver; sauverLocal = () => avant(); sauver = function () { const r = avant.apply(this, arguments); if (multiActif()) { clearTimeout(multi.minuteur); multi.minuteur = setTimeout(pousser, 300); } return r; }; }
// opérations sensibles : verrou de 30 s (livraison, encaissement, suppression d'un voyage)
const agirVoyagesAvantMulti = VUES.voyages.agir;
VUES.voyages.agir = async function (act, id, b) {
  const vid = String(id || "").split("|")[0], v = parId(S.voyages, vid);
  const prochain = v && JALONS_VOYAGE.find(([k]) => !(v.jalons || []).some((j) => j.type === k));
  const sensible = (act === "jalon" && prochain?.[0] === "livre") || act === "preuve" || act === "supprimer";
  if (sensible && !(await verrouiller("voyages", vid, act === "supprimer" ? "suppression" : "livraison"))) return;
  try { return await agirVoyagesAvantMulti.call(this, act, id, b); } finally { if (sensible) setTimeout(() => liberer("voyages", vid), 1500); }
};
if (VUES.factures) { const agirFacturesAvantMulti = VUES.factures.agir; VUES.factures.agir = async function (act, id, b) { const sensible = act === "payer"; if (sensible && !(await verrouiller("factures", id, "encaissement"))) return; try { return await agirFacturesAvantMulti.call(this, act, id, b); } finally { if (sensible) setTimeout(() => liberer("factures", id), 1500); } }; }
const apresVoyagesAvantMulti = VUES.voyages.apres;
VUES.voyages.apres = function () { const r = apresVoyagesAvantMulti?.call(this); if (multiActif()) decorerVerrous(); return r; };

/* ---------- écrans de connexion ---------- */
function ecranCompte(html) {
  let o = document.getElementById("ecran-compte");
  if (!o) { o = document.createElement("div"); o.id = "ecran-compte"; document.body.appendChild(o); }
  o.innerHTML = `<div class="compte-boite"><div class="compte-logo">${ic("truck")}<strong>Logistique Fret</strong></div>${html}</div>`;
  document.documentElement.classList.remove("verif-compte"); document.body.classList.add("ecran-compte-ouvert");
  if (typeof traduire === "function") traduire(o);
  return o;
}
const fermerEcranCompte = () => { document.getElementById("ecran-compte")?.remove(); document.body.classList.remove("ecran-compte-ouvert"); };
const champCompte = (name, label, type = "text", plus = "") => `<label class="f">${label}<input name="${name}" type="${type}" ${plus}></label>`;
function formCompte(o, soumettre) {
  const f = o.querySelector("form"), msg = o.querySelector(".compte-msg");
  f.onsubmit = async (e) => { e.preventDefault(); msg.textContent = ""; const b = f.querySelector("button[type=submit]"); b.disabled = true; try { await soumettre(Object.fromEntries(new FormData(f).entries()), msg); } catch (x) { msg.textContent = x.message; } finally { b.disabled = false; } };
  f.querySelector("input")?.focus();
}
function ecranConnexion(etat, { exige = false, email = "" } = {}) {
  const o = ecranCompte(`<h1>Connexion</h1><form>${champCompte("email", "Adresse e-mail", "email", `autocomplete="username" required value="${esc(email)}"`)}${champCompte("motDePasse", "Mot de passe", "password", 'autocomplete="current-password" required')}
    ${exige ? champCompte("code", "Code à 6 chiffres (application d'authentification)", "text", 'inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" required') : ""}
    <p class="compte-msg" role="alert"></p><button class="btn" type="submit">Se connecter</button></form>
    <div class="compte-liens">${etat.reinitialisationParEmail ? `<button type="button" class="lien" data-compte="oubli">Mot de passe oublié ?</button>` : `<span class="hint">Mot de passe oublié : demandez au chef d'entreprise.</span>`}<button type="button" class="lien" data-compte="recuperation">Clé de récupération (chef)</button></div>`);
  o.querySelector('[data-compte="oubli"]')?.addEventListener("click", () => ecranOubli(etat));
  o.querySelector('[data-compte="recuperation"]').addEventListener("click", () => ecranRecuperation(etat));
  formCompte(o, async (v, msg) => {
    let r;
    try { r = await api("POST", "/api/auth/login", { email: v.email, motDePasse: v.motDePasse, code: v.code }); }
    catch (e) { if (e.corps?.exige === "code" && !exige) return ecranConnexion(etat, { exige: true, email: v.email }); throw e; }
    multi.utilisateur = r.utilisateur; multi.droits = r.droits;
    if (r.exige2FA) return ecranActiver2FA(etat);
    await apresConnexion();
  });
}
function ecranOubli(etat) {
  const o = ecranCompte(`<h1>Mot de passe oublié</h1><form>${champCompte("email", "Adresse e-mail du compte", "email", "required")}<p class="compte-msg" role="alert"></p><button class="btn" type="submit">Recevoir un lien</button></form><div class="compte-liens"><button type="button" class="lien" data-compte="retour">Retour</button></div>`);
  o.querySelector('[data-compte="retour"]').onclick = () => ecranConnexion(etat);
  formCompte(o, async (v, msg) => { const r = await api("POST", "/api/auth/reinitialiser", { email: v.email }); msg.textContent = r.note; });
}
function ecranNouveauMotDePasse(etat, jeton) {
  const o = ecranCompte(`<h1>Nouveau mot de passe</h1><form>${champCompte("m1", "Nouveau mot de passe (12 caractères au moins)", "password", 'minlength="12" autocomplete="new-password" required')}${champCompte("m2", "Confirmer", "password", 'minlength="12" required')}<p class="compte-msg" role="alert"></p><button class="btn" type="submit">Enregistrer</button></form>`);
  formCompte(o, async (v) => { if (v.m1 !== v.m2) throw new Error("Les deux mots de passe diffèrent."); await api("POST", "/api/auth/reinitialiser/confirmer", { jeton, motDePasse: v.m1 }); history.replaceState(null, "", location.pathname); toast("Mot de passe enregistré : connectez-vous."); ecranConnexion(etat); });
}
function ecranRecuperation(etat) {
  const o = ecranCompte(`<h1>Clé de récupération</h1><p class="hint">Remise à la création du relais. Elle réinitialise le mot de passe du chef d'entreprise et sa double authentification.</p>
    <form>${champCompte("code", "Clé de récupération", "text", 'autocomplete="off" required placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"')}${champCompte("email", "Adresse du chef (facultatif)", "email")}${champCompte("m1", "Nouveau mot de passe (12 caractères au moins)", "password", 'minlength="12" required')}
    <p class="compte-msg" role="alert"></p><button class="btn" type="submit">Réinitialiser</button></form><div class="compte-liens"><button type="button" class="lien" data-compte="retour">Retour</button></div>`);
  o.querySelector('[data-compte="retour"]').onclick = () => ecranConnexion(etat);
  formCompte(o, async (v) => { const r = await api("POST", "/api/auth/recuperation", { code: v.code, email: v.email, motDePasse: v.m1 }); await afficherCleRecuperation(r.codeRecuperation, "Nouvelle clé de récupération : l'ancienne ne marche plus."); ecranConnexion(etat, { email: r.email }); });
}
function afficherCleRecuperation(code, titre = "Clé de récupération") {
  return new Promise((ok) => {
    const o = ecranCompte(`<h1>${esc(titre)}</h1><p>Notez cette clé et rangez-la en lieu sûr (coffre, gestionnaire de mots de passe). Elle seule permet de reprendre la main si le chef d'entreprise perd son mot de passe et son téléphone. <strong>Elle ne sera plus affichée.</strong></p>
      <p class="cle-recuperation">${esc(code)}</p><form><label class="check"><input type="checkbox" name="ok" required><span>J'ai noté la clé</span></label><p class="compte-msg"></p><button class="btn" type="submit">Continuer</button></form>`);
    formCompte(o, async () => ok());
  });
}
function ecranActiver2FA(etat) {
  const o = ecranCompte(`<h1>Double authentification</h1><p>Obligatoire pour le chef d'entreprise. Installez une application d'authentification (Google Authenticator, Microsoft Authenticator, Aegis…), ajoutez un compte avec la clé ci-dessous, puis saisissez le code affiché.</p><p class="cle-recuperation" id="secret-2fa">…</p><p class="hint" id="uri-2fa"></p>
    <form>${champCompte("code", "Code à 6 chiffres", "text", 'inputmode="numeric" pattern="\\d{6}" autocomplete="one-time-code" required')}<p class="compte-msg" role="alert"></p><button class="btn" type="submit">Activer</button></form>`);
  api("POST", "/api/auth/2fa/initier", {}).then((r) => { o.querySelector("#secret-2fa").textContent = r.secret.match(/.{1,4}/g).join(" "); o.querySelector("#uri-2fa").innerHTML = `Sur le téléphone : <a href="${esc(r.uri)}">ouvrir dans l'application</a>`; }).catch((e) => { o.querySelector(".compte-msg").textContent = e.message; });
  formCompte(o, async (v) => { await api("POST", "/api/auth/2fa/activer", { code: v.code }); toast("Double authentification activée"); const me = await api("GET", "/api/auth/me"); multi.utilisateur = me.utilisateur; await apresConnexion(); });
}
function ecranPremierDemarrage(etat) {
  const aDesDonnees = typeof contientDonnees === "function" && contientDonnees(S);
  const o = ecranCompte(`<h1>Premier démarrage</h1><p>Ce relais n'a encore aucun compte. Créez celui du chef d'entreprise ; vous créerez ensuite ceux de l'équipe.</p>
    <form>${champCompte("nom", "Votre nom", "text", "required")}${champCompte("email", "Adresse e-mail", "email", 'autocomplete="username" required')}${champCompte("m1", "Mot de passe (12 caractères au moins)", "password", 'minlength="12" autocomplete="new-password" required')}${champCompte("m2", "Confirmer", "password", 'minlength="12" required')}
      ${champCompte("jeton", "Jeton de lecture du relais (affiché à son démarrage)", "password", 'autocomplete="off" required')}
      <fieldset class="compte-import"><legend>Données de départ</legend>
        ${aDesDonnees ? `<label class="check"><input type="radio" name="source" value="appareil" checked><span>Les données de cet appareil (${esc(libResume(resumeDonnees(S)))})</span></label>` : ""}
        <label class="check"><input type="radio" name="source" value="fichier" ${aDesDonnees ? "" : "checked"}><span>Une sauvegarde (fichier .json exporté depuis l'application)</span></label><input type="file" name="fichier" accept=".json,application/json">
        <label class="check"><input type="radio" name="source" value="vide"><span>Commencer vide</span></label></fieldset>
      <p class="compte-msg" role="alert"></p><button class="btn" type="submit">Créer le compte</button></form>`);
  formCompte(o, async (v) => {
    if (v.m1 !== v.m2) throw new Error("Les deux mots de passe diffèrent.");
    let donnees = null;
    if (v.source === "appareil") donnees = S;
    if (v.source === "fichier") { const f = o.querySelector("input[name=fichier]").files[0]; if (!f) throw new Error("Choisissez le fichier de sauvegarde."); const j = JSON.parse(await f.text()); donnees = migrer(j.donnees || j.etat || j).etat; }
    const r = await fetch("/api/auth/initialiser", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${v.jeton}` }, body: JSON.stringify({ nom: v.nom, email: v.email, motDePasse: v.m1, donnees }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erreur || `Réponse ${r.status}`);
    await afficherCleRecuperation(j.codeRecuperation);
    toast(`${j.importes} enregistrement(s) importé(s). Connectez-vous.`); ecranConnexion({ ...etat, initialise: true }, { email: v.email });
  });
}

/* ---------- démarrage en mode multi-utilisateur ---------- */
async function chargerDonnees() {
  const d = await api("GET", "/api/donnees");
  multi.utilisateur = d.utilisateur; multi.droits = d.droits; multi.droitsService = d.droitsService || {}; multi.utilisateurs = d.utilisateurs || [];
  appliquerDonnees(d); majVerrous(d.verrous || []); sauverLocal();
}
async function apresConnexion() {
  await chargerDonnees();
  if (multi.utilisateur.role === "chauffeur" && multi.utilisateur.chauffeurId) { try { localStorage.setItem("logistique-mode", JSON.stringify({ chauffeurId: multi.utilisateur.chauffeurId, compte: true })); } catch { /* ignoré */ } }
  if (typeof directCfg === "function" && directCfg().mode === "off") directSauverCfg({ ...directCfg(), mode: "relais", url: location.origin, jeton: "" }); // suivi en direct par la session
  fermerEcranCompte(); if (typeof roleAppliquer === "function") roleAppliquer(); if (typeof chauffeurAppliquerMode === "function") chauffeurAppliquerMode();
  ouvrirFlux(); indicateurMulti(); afficher(multi.utilisateur.role === "chauffeur" ? "chauffeur" : "tableau");
  toast(`Bonjour ${multi.utilisateur.nom}`);
}
function multiDeconnecte() {
  try { multi.source?.close(); } catch { /* ignoré */ }
  multi.utilisateur = null; multi.source = null;
  try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem("logistique-mode"); } catch { /* ignoré */ }
  api("GET", "/api/auth/etat").then((e) => ecranConnexion(e)).catch(() => location.reload());
}
async function seDeconnecter() { await api("POST", "/api/auth/logout", {}).catch(() => {}); multiDeconnecte(); }
function indicateurMulti() {
  let el = document.getElementById("indic-multi");
  if (!multiActif()) { el?.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "indic-multi"; document.body.appendChild(el); }
  const enLigne = !!multi.source && !multi.horsLigne;
  el.className = enLigne ? "ok" : "warn"; el.textContent = `${multi.utilisateur.nom} · ${libDe(ROLES_COMPTES, multi.utilisateur.role)}${enLigne ? "" : " · hors ligne"}`;
  el.title = enLigne ? "Connecté au serveur : les modifications des autres arrivent en direct." : "Connexion perdue : vos modifications partiront au retour du réseau.";
}
const servieParRelaisMulti = () => /^https?:$/.test(location.protocol) && !!document.querySelector('meta[name="lf-multi"]');
async function demarrerMulti() {
  if (!servieParRelaisMulti()) { multi.verifie = true; document.documentElement.classList.remove("verif-compte"); return; }
  let etat = null;
  try { const r = await fetch("/api/auth/etat", { cache: "no-store", credentials: "same-origin" }); if (r.ok) etat = await r.json(); } catch { /* pas de relais */ }
  multi.verifie = true;
  if (!etat?.multi) { document.documentElement.classList.remove("verif-compte"); return; }
  multi.actif = true;
  const reinit = location.hash.match(/^#reinitialiser=([\w-]+)$/);
  if (reinit) return ecranNouveauMotDePasse(etat, reinit[1]);
  if (!etat.initialise) return ecranPremierDemarrage(etat);
  try { const me = await api("GET", "/api/auth/me"); multi.utilisateur = me.utilisateur; multi.droits = me.droits; if (me.exige2FA) return ecranActiver2FA(etat); await apresConnexion(); document.documentElement.classList.remove("verif-compte"); }
  catch (e) { if (e.horsLigne && contientDonnees(S)) { document.documentElement.classList.remove("verif-compte"); toast("Serveur injoignable : données de la dernière connexion.", "warn"); return; } ecranConnexion(etat); }
}
if (servieParRelaisMulti()) document.documentElement.classList.add("verif-compte");
setTimeout(() => { if (!multi.verifie) document.documentElement.classList.remove("verif-compte"); }, 3000);
window.addEventListener("online", () => { if (multiActif()) { pousser(); if (!multi.source) ouvrirFlux(); } });
setTimeout(demarrerMulti, 0);

/* ---------- pages du chef d'entreprise : utilisateurs et journal ---------- */
const optsRoles = () => ROLES_COMPTES.map(([k, l]) => [k, l]);
const optsBureaux = [["", "—"], ["maroc", "Maroc"], ["allemagne", "Allemagne"]];
const champsUtilisateur = (u = {}, nouveau = false) => [
  { name: "nom", label: "Nom", value: u.nom, required: true },
  { name: "email", label: "Adresse e-mail (identifiant)", type: "email", value: u.email, required: true },
  { name: "role", label: "Rôle", type: "select", options: optsRoles(), value: u.role || "dispatcher" },
  { name: "office", label: "Bureau", type: "select", options: optsBureaux, value: u.office || "" },
  { name: "chauffeurId", label: "Fiche chauffeur (rôle chauffeur)", type: "select", options: [["", "—"], ...S.chauffeurs.map((c) => [c.id, c.nom])], value: u.chauffeurId || "" },
  { name: "motDePasse", label: nouveau ? "Mot de passe provisoire (12 caractères au moins)" : "Nouveau mot de passe provisoire (laisser vide pour ne pas changer)", type: "text", value: nouveau ? motDePasseProvisoire() : "", required: nouveau, full: true },
  ...(nouveau ? [] : [{ name: "reinitialiser2FA", label: "Réinitialiser sa double authentification (téléphone perdu)", type: "checkbox", full: true }]),
];
const motDePasseProvisoire = () => { const m = "abcdefghjkmnpqrstuvwxyz23456789", b = crypto.getRandomValues(new Uint8Array(16)); return [...b].map((x) => m[x % m.length]).join("").match(/.{4}/g).join("-"); };
let listeComptes = null;
VUES.utilisateurs = {
  titre: "Utilisateurs", sous: "Comptes de l'équipe et rôles (droits appliqués par le serveur)",
  actions: () => btn("ajouter", "Nouveau compte", { icone: "plus" }),
  rendu() {
    if (!multiActif()) return `<div class="card">${vide("users", "Mode multi-utilisateur inactif", "Démarrez le relais avec MULTI_UTILISATEUR=true et ouvrez son adresse dans un navigateur (voir docs/10-multi-utilisateur.md).")}</div>`;
    if (!listeComptes) { api("GET", "/api/utilisateurs").then((r) => { listeComptes = r.utilisateurs; rafraichir(); }).catch((e) => toast(e.message, "danger")); return `<div class="card"><p class="hint">Chargement…</p></div>`; }
    return `<div class="card"><div class="table-wrap"><table><thead><tr><th>Nom</th><th>Rôle</th><th>Bureau</th><th>Double auth.</th><th>Dernier accès</th><th></th></tr></thead><tbody>
      ${listeComptes.map((u) => `<tr class="${u.cloture ? "inactif" : ""}"><td><strong>${esc(u.nom)}</strong><span class="sub">${esc(u.email)}${u.cloture ? " · clôturé" : ""}</span></td><td>${esc(libDe(ROLES_COMPTES, u.role))}${u.chauffeurId ? `<span class="sub">${esc(nomChauffeur(u.chauffeurId))}</span>` : ""}</td><td>${esc(libDe(optsBureaux, u.office || ""))}</td>
        <td>${u.deuxFA ? badge("active", "ok") : u.role === "chef_entreprise" ? badge("à activer", "warn") : badge("non", "neutral")}</td><td>${u.dernierAcces ? dateHeureFr(new Date(u.dernierAcces).toISOString()) : "—"}</td>
        <td><div class="actions">${btn("modifier", "Modifier", { id: u.id, cls: "btn ghost sm" })}${btn(u.cloture ? "rouvrir" : "clore", u.cloture ? "Rouvrir" : "Clôturer", { id: u.id, cls: "btn ghost sm" })}</div></td></tr>`).join("")}</tbody></table></div>
      <p class="hint">${ROLES_COMPTES.map(([, l, d]) => `<strong>${esc(l)}</strong> : ${esc(d)}`).join(" · ")}. Changer de rôle, clôturer ou changer le mot de passe déconnecte la personne sur tous ses appareils.</p></div>`;
  },
  async agir(act, id) {
    const u = listeComptes?.find((x) => x.id === id);
    const lire = (v) => ({ nom: v.nom, email: v.email, role: v.role, office: v.office || null, chauffeurId: v.chauffeurId || null, ...(v.motDePasse ? { motDePasse: v.motDePasse } : {}), ...(v.reinitialiser2FA ? { reinitialiser2FA: true } : {}) });
    try {
      if (act === "ajouter") { const v = await formulaire("Nouveau compte", champsUtilisateur({}, true), { valider: "Créer", aide: "Transmettez l'adresse et le mot de passe provisoire à la personne (de vive voix ou par message séparé) ; elle le changera dans Réglages → Mon compte." }); if (!v) return; await api("POST", "/api/utilisateurs", lire(v)); toast(`Compte de ${v.nom} créé`); }
      if (act === "modifier" && u) { const v = await formulaire(`Modifier ${u.nom}`, champsUtilisateur(u)); if (!v) return; await api("PUT", `/api/utilisateurs/${id}`, lire(v)); toast("Compte modifié"); }
      if ((act === "clore" || act === "rouvrir") && u) { if (act === "clore" && !(await confirmer(`Clôturer le compte de ${u.nom} ?`, "La personne est déconnectée partout et ne peut plus se connecter. Le compte peut être rouvert.", "Clôturer"))) return; await api("PUT", `/api/utilisateurs/${id}`, { cloture: act === "clore" }); toast(act === "clore" ? "Compte clôturé" : "Compte rouvert"); }
    } catch (e) { return toast(e.message, "danger"); }
    listeComptes = null; rafraichir();
  },
};
/* ---------- accès par service : le chef d'entreprise règle ce que chaque rôle voit et modifie ---------- */
let droitsCharges = null;
VUES.acces = {
  titre: "Accès par service", sous: "Ce que chaque service voit et modifie — appliqué par le serveur",
  actions: () => (multiActif() ? btn("acces-defaut", "Tout remettre par défaut", { cls: "btn ghost", icone: "x" }) : ""),
  rendu() {
    if (!multiActif()) return `<div class="card">${vide("shield", "Mode multi-utilisateur inactif", "Les accès par service sont appliqués par le relais en mode multi-utilisateur. Sur un appareil seul, réglez les pages de chaque profil dans Réglages → Appareil.")}</div>`;
    if (!droitsCharges) { api("GET", "/api/droits").then((r) => { droitsCharges = r; rafraichir(); }).catch((e) => toast(e.message, "danger")); return `<div class="card"><p class="hint">Chargement…</p></div>`; }
    const roles = droitsCharges.roles.filter(([k]) => k !== "chef_entreprise");
    const cellule = (role, g) => {
      const choisi = droitsCharges.droits[role]?.[g] || "defaut", effectif = droitsCharges.effectifs[role][g];
      const lib = (k) => libDe(droitsCharges.niveaux, k), parDefaut = choisi === "defaut" ? effectif : niveauDroit(role, g, {});
      return `<td><select name="${esc(role)}__${esc(g)}" data-niveau="${esc(choisi === "defaut" ? parDefaut : choisi)}" data-defaut="${esc(parDefaut)}" class="${choisi === "defaut" ? "" : "acces-change"}" aria-label="${esc(libDe(roles, role))} — ${esc(libDe(droitsCharges.groupes, g))}">
        ${droitsCharges.niveaux.filter(([k]) => !(g === "reglages" && k === "aucun")).map(([k]) => `<option value="${k}" ${k === choisi ? "selected" : ""}>${esc(k === "defaut" ? `Défaut : ${lib(parDefaut).toLowerCase()}` : lib(k))}</option>`).join("")}</select></td>`;
    };
    return `<div class="card"><form id="f-acces"><div class="table-wrap"><table class="acces sans-cartes"><thead><tr><th>Données</th>${roles.map(([, l]) => `<th>${esc(l)}</th>`).join("")}</tr></thead><tbody>
      ${droitsCharges.groupes.map(([g, l]) => `<tr><th scope="row">${esc(l)}</th>${roles.map(([k]) => cellule(k, g)).join("")}</tr>`).join("")}
      </tbody></table></div><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn">${ic("shield")}Enregistrer les accès</button></div></form>
      <p class="hint">Les cases encadrées s'écartent du défaut du rôle. <strong>Tout</strong> : lire, modifier et supprimer. <strong>Sans prix</strong> : les prix, coûts et marges ne sont pas envoyés à l'appareil. <strong>Aucun accès</strong> : les données ne quittent pas le serveur et la page disparaît du menu. Un chauffeur ou un transitaire ne voit toujours que <em>ses</em> voyages et dossiers. Le chef d'entreprise garde toujours tous les droits. Chaque changement est inscrit au Journal et s'applique aussitôt sur les appareils connectés.</p></div>`;
  },
  apres() { document.getElementById("f-acces")?.addEventListener("change", (e) => { const s = e.target; if (s.tagName !== "SELECT") return; s.classList.toggle("acces-change", s.value !== "defaut"); s.dataset.niveau = s.value === "defaut" ? s.dataset.defaut : s.value; }); },
  async agir(act) {
    if (act !== "acces-defaut") return;
    if (!(await confirmer("Remettre tous les accès par défaut ?", "Chaque service retrouve les droits prévus pour son rôle.", "Remettre"))) return;
    try { await api("PUT", "/api/droits", { droits: {} }); toast("Accès remis par défaut"); } catch (e) { return toast(e.message, "danger"); }
    droitsCharges = null; rafraichir();
  },
  async soumettre(fid, v) {
    if (fid !== "f-acces") return false;
    const droits = {};
    for (const [cle, niveau] of Object.entries(v)) { const [role, g] = cle.split("__"); if (niveau && niveau !== "defaut") (droits[role] ||= {})[g] = niveau; }
    try { await api("PUT", "/api/droits", { droits }); toast("Accès enregistrés : ils s'appliquent tout de suite"); } catch (e) { toast(e.message, "danger"); return true; }
    droitsCharges = null; rafraichir(); return true;
  },
};
let filtreJournal = { utilisateur: "", collection: "", action: "", debut: "", fin: "" }, journalCharge = null;
const LIB_ACTIONS = { creation: "Création", modification: "Modification", suppression: "Suppression", conflit: "Conflit", refus: "Refus", connexion: "Connexion", echec_connexion: "Échec de connexion", deconnexion: "Déconnexion", reseau_inhabituel: "Réseau inhabituel", compte_cree: "Compte créé", compte_modifie: "Compte modifié", droits_modifies: "Accès modifiés", mot_de_passe_change: "Mot de passe changé", mot_de_passe_reinitialise: "Mot de passe réinitialisé", reinitialisation_demandee: "Réinitialisation demandée", double_authentification_activee: "Double auth. activée", double_authentification_desactivee: "Double auth. désactivée", initialisation: "Initialisation", recuperation: "Récupération", echec_recuperation: "Échec de récupération", jeton_reutilise: "Jeton réutilisé" };
const requeteJournal = () => new URLSearchParams(Object.entries(filtreJournal).filter(([, v]) => v)).toString();
const resumeDiff = (a) => (a.diff ? Object.entries(a.diff).slice(0, 4).map(([k, [x, y]]) => `${k} : ${JSON.stringify(x) ?? "—"} → ${JSON.stringify(y) ?? "—"}`).join(" · ") + (Object.keys(a.diff).length > 4 ? ` · +${Object.keys(a.diff).length - 4}` : "") : a.details ? JSON.stringify(a.details) : "");
VUES.journal = {
  titre: "Journal", sous: "Qui a fait quoi : chaque écriture (avant / après), connexions, refus — 24 mois",
  actions: () => (multiActif() ? `<a class="btn ghost" href="/api/journal?${esc(requeteJournal())}&format=csv" download>${ic("download")}Exporter (CSV)</a>` : ""),
  rendu() {
    if (!multiActif()) return `<div class="card">${vide("file", "Mode multi-utilisateur inactif", "Le journal est tenu par le relais en mode multi-utilisateur.")}</div>`;
    if (!journalCharge) { api("GET", `/api/journal?${requeteJournal()}`).then((r) => { journalCharge = r.journal; rafraichir(); }).catch((e) => toast(e.message, "danger")); return `<div class="card"><p class="hint">Chargement…</p></div>`; }
    const sel = (name, opts) => `<label class="f">${{ utilisateur: "Utilisateur", collection: "Données", action: "Action" }[name]}<select name="${name}">${[["", "Tous"], ...opts].map(([k, l]) => `<option value="${esc(k)}" ${filtreJournal[name] === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
    return `<div class="card"><form id="f-journal"><div class="form-grid">${sel("utilisateur", multi.utilisateurs.map((u) => [u.id, u.nom]))}${sel("collection", COLLECTIONS_SERVEUR.map((c) => [c, c]))}${sel("action", Object.entries(LIB_ACTIONS))}
        <label class="f">Du<input type="date" name="debut" value="${esc(filtreJournal.debut)}"></label><label class="f">Au<input type="date" name="fin" value="${esc(filtreJournal.fin)}"></label></div>
        <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn">Filtrer</button></div></form></div>
      <div class="card"><div class="table-wrap"><table class="compact"><thead><tr><th>Date</th><th>Qui</th><th>Action</th><th>Données</th><th>Détails</th></tr></thead><tbody>
        ${journalCharge.slice(0, 500).map((a) => `<tr><td>${dateHeureFr(new Date(a.t).toISOString())}</td><td>${esc(a.nom || "—")}</td><td>${badge(LIB_ACTIONS[a.action] || a.action, ["refus", "echec_connexion", "conflit", "reseau_inhabituel", "jeton_reutilise", "echec_recuperation"].includes(a.action) ? "warn" : a.action === "suppression" ? "danger" : "neutral")}</td><td>${esc([a.col, a.id].filter(Boolean).join(" · "))}</td><td class="sub">${esc(resumeDiff(a))}</td></tr>`).join("") || `<tr><td colspan="5" class="hint">Aucune entrée.</td></tr>`}
      </tbody></table></div>${journalCharge.length > 500 ? `<p class="hint">500 premières lignes sur ${journalCharge.length} : précisez les filtres ou exportez.</p>` : ""}</div>`;
  },
  soumettre(fid, v) { if (fid !== "f-journal") return false; filtreJournal = { utilisateur: v.utilisateur, collection: v.collection, action: v.action, debut: v.debut, fin: v.fin }; journalCharge = null; rafraichir(); return true; },
};

/* ---------- carte « Mon compte » ---------- */
function carteCompte() {
  if (!multiActif()) return "";
  const u = multi.utilisateur;
  return `<div class="card" id="carte-compte"><div class="card-head"><h2>Mon compte</h2>${badge(libDe(ROLES_COMPTES, u.role), "ok")}</div>
    <p style="margin-top:0"><strong>${esc(u.nom)}</strong> · ${esc(u.email)}${u.office ? ` · bureau ${esc(libDe(optsBureaux, u.office))}` : ""}</p>
    <p class="hint">Vos droits sont appliqués par le serveur : ce que votre rôle ne permet pas n'est ni envoyé à cet appareil, ni accepté s'il est modifié. Double authentification : ${u.deuxFA ? "active" : "inactive"}.</p>
    <div class="row">${btn("compte-mdp", "Changer de mot de passe", { cls: "btn ghost" })}${u.deuxFA ? "" : btn("compte-2fa", "Activer la double authentification", { cls: "btn ghost" })}${btn("compte-sortir", "Se déconnecter", { icone: "x", cls: "btn" })}</div></div>`;
}
enregistrerCarteReglages({
  onglet: "appareil", ordre: 3, rendu: carteCompte,
  async agir(act) {
    if (act === "compte-sortir") { await seDeconnecter(); return true; }
    if (act === "compte-mdp") {
      const f = await formulaire("Changer de mot de passe", [{ name: "ancien", label: "Mot de passe actuel", type: "password", required: true, full: true }, { name: "nouveau", label: "Nouveau (12 caractères au moins)", type: "password", required: true, full: true }, { name: "nouveau2", label: "Confirmer", type: "password", required: true, full: true }], { aide: "Vos autres appareils seront déconnectés." });
      if (!f) return true; if (f.nouveau !== f.nouveau2) { toast("Les deux mots de passe diffèrent.", "danger"); return true; }
      try { await api("POST", "/api/auth/mot-de-passe", { ancien: f.ancien, nouveau: f.nouveau }); toast("Mot de passe changé"); } catch (e) { toast(e.message, "danger"); } return true;
    }
    if (act === "compte-2fa") { ecranActiver2FA(await api("GET", "/api/auth/etat")); return true; }
    return false;
  },
});

if (typeof roleAppliquer === "function") roleAppliquer(); // pages Utilisateurs et Journal : seulement en mode multi, pour le chef d'entreprise
