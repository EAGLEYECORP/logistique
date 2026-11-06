"use strict";
/* ============================================================
   Assistant de démarrage (première ouverture) + bandeau d'installation.
   Étapes : bienvenue → entreprise → mentions légales → réglages de calcul → données de départ.
   Rien n'est obligatoire : tout se complète plus tard dans Réglages.
   ============================================================ */

const ETAPES_ASSISTANT = ["bienvenue", "entreprise", "legal", "calculs", "donnees"];
let assistantEtat = null;

function demarrerAssistant() {
  const E = S.entreprise || {}, P = S.params;
  assistantEtat = {
    etape: 0, existant: contientDonnees(S), choix: "zero", fichier: null, protegerDonnees: true, rappels: false,
    ent: { nom: E.nom || "", ville: E.ville || "", tel: E.tel || "", email: E.email || "", ice: E.ice || "", rc: E.rc || "", if: E.if || "", patente: E.patente || "", cnss: E.cnss || "", banque: E.banque || "", rib: E.rib || "", adresse: E.adresse || "" },
    par: { prixGasoil: P.prixGasoil, tauxEUR: P.tauxEUR, tvaDefaut: P.tvaDefaut, delaiPaiement: P.delaiPaiement },
  };
  const d = $("#assistant");
  d.oncancel = (e) => e.preventDefault(); // Échap ne ferme pas l'assistant : on le quitte avec « Passer »
  rendreAssistant();
  if (!d.open) d.showModal();
}

function lireChampsAssistant() {
  const d = $("#assistant"), a = assistantEtat;
  d.querySelectorAll("[data-ent]").forEach((el) => { a.ent[el.dataset.ent] = el.value.trim(); });
  d.querySelectorAll("[data-par]").forEach((el) => { a.par[el.dataset.par] = num(el.value, a.par[el.dataset.par]); });
  d.querySelectorAll("[name=choix]").forEach((el) => { if (el.checked) a.choix = el.value; });
  const f = d.querySelector("[data-fichier]"); if (f?.files?.[0]) a.fichier = f.files[0];
  const p = d.querySelector("[data-proteger]"); if (p) a.protegerDonnees = p.checked;
  const r = d.querySelector("[data-rappels]"); if (r) a.rappels = r.checked;
}

function rendreAssistant() {
  const d = $("#assistant"), a = assistantEtat, e = ETAPES_ASSISTANT[a.etape];
  const dernier = a.etape === ETAPES_ASSISTANT.length - 1;
  const champ = (cle, label, { type = "text", ph = "", full = false } = {}) => `<label class="f ${full ? "full" : ""}">${esc(label)}<input type="${type}" data-ent="${cle}" value="${esc(a.ent[cle])}" placeholder="${esc(ph)}" enterkeyhint="next" autocomplete="off"></label>`;
  const nombre = (cle, label) => `<label class="f">${esc(label)}<input type="number" step="any" inputmode="decimal" data-par="${cle}" value="${esc(a.par[cle])}"></label>`;
  const choix = (v, titre, texte, icone) => `<label class="choix"><input type="radio" name="choix" value="${v}" ${a.choix === v ? "checked" : ""}><span class="ci">${ic(icone)}</span><span><strong>${titre}</strong><span class="sub">${texte}</span></span></label>`;
  const corps = {
    bienvenue: `<div class="as-hero"><img src="icon.svg" width="84" height="84" alt=""><h1>Bienvenue</h1><p>Commandes, flotte, chauffeurs, douane et facturation pour le transport routier. Deux minutes pour démarrer.</p></div>
      <ul class="as-points"><li>${ic("shield")}<span><strong>Vos données restent chez vous</strong><span class="sub">Enregistrées sur cet appareil, sans compte ni serveur.</span></span></li>
        <li>${ic("route")}<span><strong>Fonctionne sans réseau</strong><span class="sub">Sur la route, au port, en zone blanche.</span></span></li>
        <li>${ic("download")}<span><strong>Gratuit et exportable</strong><span class="sub">Sauvegarde ZIP, export Excel, aucun verrouillage.</span></span></li></ul>`,
    entreprise: `<h2>Votre entreprise</h2><p class="hint">Ces informations apparaissent sur vos factures et ordres de transport.</p>
      <div class="form-grid">${champ("nom", "Raison sociale", { ph: "Transports Atlas SARL", full: true })}${champ("ville", "Ville")}${champ("tel", "Téléphone", { type: "tel" })}${champ("email", "E-mail", { type: "email" })}${champ("ice", "ICE")}</div>`,
    legal: `<h2>Mentions légales et banque</h2><p class="hint">Facultatif : vous pourrez compléter plus tard dans Réglages.</p>
      <div class="form-grid">${champ("rc", "RC")}${champ("if", "IF")}${champ("patente", "Patente")}${champ("cnss", "CNSS")}${champ("banque", "Banque")}${champ("rib", "RIB", { full: true })}${champ("adresse", "Adresse", { full: true })}</div>`,
    calculs: `<h2>Vos paramètres</h2><p class="hint">Valeurs de départ pour les calculs de coûts et de factures. Modifiables à tout moment.</p>
      <div class="form-grid">${nombre("prixGasoil", "Prix du gasoil (MAD/L)")}${nombre("tauxEUR", "Taux de change (MAD pour 1 €)")}${nombre("tvaDefaut", "TVA par défaut (%)")}${nombre("delaiPaiement", "Délai de paiement (jours)")}</div>
      <p class="hint">La TVA applicable au transport international dépend de votre situation : faites-la valider par votre comptable.</p>`,
    donnees: `<h2>${a.existant ? "Dernières options" : "Par où commencer ?"}</h2>
      ${a.existant ? "" : `<div class="choix-liste">${choix("zero", "Partir de zéro", "Ajoutez vos camions, chauffeurs et clients.", "plus")}${choix("demo", "Découvrir avec un exemple", "Données fictives pour essayer : effaçables d'un clic.", "sparkles")}${choix("restaurer", "Restaurer une sauvegarde", "Importer un fichier exporté depuis cette application.", "upload")}</div>
      <div id="as-fichier" ${a.choix === "restaurer" ? "" : "hidden"}><label class="f">Fichier de sauvegarde (.zip, .json, .lfs)<input type="file" data-fichier accept=".zip,.json,.lfs,application/zip,application/json,application/octet-stream"></label></div>`}
      <div class="liste-options" style="margin-top:12px">
        <label class="check"><input type="checkbox" data-proteger ${a.protegerDonnees ? "checked" : ""}><span><strong>Protéger mes données contre l'effacement</strong><span class="sub">Demande au navigateur de conserver les données de l'application.</span></span></label>
        ${typeof notifSupportee === "function" && notifSupportee() ? `<label class="check"><input type="checkbox" data-rappels ${a.rappels ? "checked" : ""}><span><strong>Activer les rappels</strong><span class="sub">Papiers qui expirent, repos des chauffeurs, factures en retard.</span></span></label>` : ""}
      </div>`,
  }[e];
  d.innerHTML = `<div class="assistant">
    <div class="as-corps">${corps}</div>
    <div class="as-pied"><div class="dots" aria-label="Étape ${a.etape + 1} sur ${ETAPES_ASSISTANT.length}">${ETAPES_ASSISTANT.map((_, i) => `<i class="${i === a.etape ? "on" : i < a.etape ? "fait" : ""}"></i>`).join("")}</div>
      <div class="row">${a.etape ? `<button type="button" class="btn ghost" data-as="prec">Retour</button>` : `<button type="button" class="btn ghost" data-as="passer">Passer</button>`}
        <button type="button" class="btn" data-as="${dernier ? "fin" : "suiv"}">${a.etape === 0 ? "Commencer" : dernier ? "Terminer" : "Continuer"}</button></div></div></div>`;
  d.onclick = surClicAssistant;
  d.onchange = (ev) => { if (ev.target.name === "choix") { lireChampsAssistant(); $("#as-fichier").hidden = assistantEtat.choix !== "restaurer"; } };
  if (!matchMedia("(pointer: coarse)").matches) d.querySelector("input:not([type=radio]):not([type=checkbox])")?.focus();
}

async function surClicAssistant(ev) {
  const act = ev.target.closest("[data-as]")?.dataset.as;
  if (!act) return;
  const d = $("#assistant"), a = assistantEtat;
  lireChampsAssistant();
  if (act === "suiv") { a.etape++; rendreAssistant(); d.querySelector(".as-corps").scrollTop = 0; }
  if (act === "prec") { a.etape--; rendreAssistant(); }
  if (act === "passer") { S.meta.onboarde = true; sauver(); d.close(); afficher(ongletActif); }
  if (act === "fin") await terminerAssistant();
}

async function terminerAssistant() {
  const d = $("#assistant"), a = assistantEtat;
  if (a.choix === "restaurer" && !a.fichier && !a.existant) return toast("Choisissez le fichier de sauvegarde à restaurer.", "warn");
  // Les autorisations du navigateur exigent un geste de l'utilisateur : on les demande en premier, avant tout await long.
  const demandes = [];
  if (a.protegerDonnees) demandes.push(stockageDemanderPersistance());
  S.entreprise = { ...S.entreprise, ...a.ent };
  Object.assign(S.params, a.par);
  S.meta.onboarde = true;
  const { ent, par } = { ent: S.entreprise, par: { ...S.params } };
  if (!a.existant && a.choix === "demo") { S = donneesDemo(); S.entreprise = ent.nom ? ent : S.entreprise; S.params = { ...S.params, ...par }; S.meta.onboarde = true; }
  sauver();
  d.close();
  if (a.rappels && typeof notifActiver === "function") await notifActiver();
  await Promise.allSettled(demandes);
  afficher("tableau");
  if (!a.existant && a.choix === "restaurer" && a.fichier) importerFichier(a.fichier);
  else toast(a.existant ? "Réglages enregistrés" : a.choix === "demo" ? "Exemple chargé : explorez l'application" : "C'est prêt : ajoutez votre premier camion", "ok");
}

enregistrerCarteReglages({
  onglet: "appareil", ordre: 30,
  rendu: () => `<div class="card"><div class="card-head"><h2>Assistant de démarrage</h2></div>
    <p class="hint" style="margin-top:0">Reprenez les informations de votre entreprise et vos paramètres pas à pas.</p>
    <div class="row">${btn("assistant-relancer", "Relancer l'assistant", { cls: "btn ghost" })}</div></div>`,
  agir: (act) => { if (act === "assistant-relancer") { demarrerAssistant(); return true; } return false; },
});

/* ---------- bandeau d'installation ---------- */
const INSTALL_REFUS = "logistique-install-refus";
function installationProposable() {
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) return false;
  if (typeof modeChauffeurActif === "function" && modeChauffeurActif()) return false;
  if (!S.meta.onboarde || !contientDonnees(S)) return false;
  try { if (Date.now() - Number(localStorage.getItem(INSTALL_REFUS) || 0) < 14 * 86400000) return false; } catch { /* ignoré */ }
  return location.protocol.startsWith("http");
}
function proposerInstallation() {
  if ($("#bandeau-install") || !installationProposable()) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!invitationInstall && !ios) return;
  const b = document.createElement("div");
  b.id = "bandeau-install"; b.className = "bandeau-install";
  b.innerHTML = `<img src="icon.svg" width="44" height="44" alt=""><div class="t"><strong>Installer Logistique Fret</strong><span class="sub">${invitationInstall ? "Accès direct depuis l'écran d'accueil, même sans réseau." : "Touchez Partager puis « Sur l'écran d'accueil »."}</span></div>
    ${invitationInstall ? `<button type="button" class="btn sm" data-i="oui">Installer</button>` : ""}<button type="button" class="icon-btn" data-i="non" aria-label="Plus tard">${ic("x")}</button>`;
  b.onclick = async (e) => {
    const a = e.target.closest("[data-i]")?.dataset.i;
    if (a === "oui" && invitationInstall) { invitationInstall.prompt(); await invitationInstall.userChoice.catch(() => {}); invitationInstall = null; }
    if (a) { try { localStorage.setItem(INSTALL_REFUS, String(Date.now())); } catch { /* ignoré */ } b.remove(); }
  };
  document.body.append(b);
}
/** Au démarrage : après la 2e visite, on propose l'installation (iOS : explications). */
function demarrageInstallation() {
  let n = 0;
  try { n = Number(localStorage.getItem("logistique-visites") || 0) + 1; localStorage.setItem("logistique-visites", String(n)); } catch { /* ignoré */ }
  if (n >= 2) setTimeout(proposerInstallation, 4000);
}
