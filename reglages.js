"use strict";
/* ============================================================
   Réglages — page à onglets : Général · Données · Rappels · Appareil.
   Les modules (rappels, mode chauffeur, assistant de démarrage) y ajoutent leurs cartes
   avec enregistrerCarteReglages({ onglet, ordre, rendu, apres, agir, soumettre }).
   ============================================================ */

const CARTES_REGLAGES = [];
const enregistrerCarteReglages = (c) => CARTES_REGLAGES.push({ ordre: 50, ...c });
const ONGLETS_REGLAGES = [["general", "Général"], ["donnees", "Données"], ["rappels", "Rappels"], ["appareil", "Appareil"]];
let ongletReglages = "general";

let invitationInstall = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); invitationInstall = e; if (typeof proposerInstallation === "function") proposerInstallation(); });

const cartesDe = (onglet) => CARTES_REGLAGES.filter((c) => c.onglet === onglet).sort((a, b) => a.ordre - b.ordre);
const tailleOctets = (n) => n >= 1048576 ? `${fmt(n / 1048576, 1)} Mo` : `${fmt(n / 1024)} Ko`;

/* ---------- Général : calculs, entreprise, assistant IA ---------- */
function carteCalculs() {
  const P = S.params;
  const n = (name, label) => ({ name, label, type: "number", value: P[name] });
  return `<div class="card">
    <div class="card-head"><h2>Calculs</h2></div>
    <form id="f-params">
      <div class="section-title" style="margin-top:0">Coûts</div>
      ${champs([n("prixGasoil", "Prix du gasoil (MAD/L)"), n("consoDefaut", "Consommation par défaut (L/100 km)"), n("vitesseMoyenne", "Vitesse moyenne (km/h)"), n("seuilConso", "Alerte conso au-dessus de la moyenne (%)")])}
      <div class="section-title">Facturation</div>
      ${champs([n("tauxEUR", "Taux de change (MAD pour 1 €)"), n("tvaDefaut", "TVA par défaut (%)"), n("delaiPaiement", "Délai de paiement par défaut (jours)")])}
      <div class="section-title">Entretien et papiers</div>
      ${champs([n("intervalleVidange", "Intervalle vidange par défaut (km)"), n("intervallePneus", "Durée de vie pneus par défaut (km)"), n("alerteKm", "Prévenir avant l'échéance (km)"), n("alerteJours", "Prévenir avant une expiration (jours)")])}
      <div class="section-title">Temps de conduite et repos</div>
      ${champs([n("amplitudeMaxHeures", "Service maximum (h)"), n("reposMinHeures", "Repos minimum (h)"), n("conduiteMaxJour", "Conduite max par jour (h)"), n("conduiteAvantPause", "Conduite avant pause (h)"), n("dureePause", "Durée de la pause (h)")])}
      <div class="section-title">Données</div>
      ${champs([n("rappelSauvegarde", "Rappel de sauvegarde au bout de (jours)")])}
      <p class="hint">Valeurs indicatives : adaptez-les à la réglementation applicable à vos trajets (nationaux ou internationaux).</p>
      <div class="row" style="justify-content:flex-end;margin-top:12px">${btn("defaut", "Valeurs par défaut", { cls: "btn ghost" })}<button class="btn">Enregistrer</button></div>
    </form>
  </div>`;
}

/* ---------- Données : sauvegarde ---------- */
function carteSauvegarde() {
  const ds = S.meta.derniereSauvegarde;
  const o = S.meta.exportOptions || { photos: true, chiffre: false };
  const j = ds ? -joursAvant(ds.slice(0, 10)) : null;
  return `<div class="card">
    <div class="card-head"><h2>Sauvegarde</h2>${ds ? badge(j === 0 ? "Aujourd'hui" : `Il y a ${j} j`, j > S.params.rappelSauvegarde ? "warn" : "ok") : badge("Jamais sauvegardé", "warn")}</div>
    <p class="hint" style="margin-top:0">Vos données restent sur cet appareil. Exportez-les chaque semaine : le fichier se range dans votre messagerie ou votre cloud, et sert à les transférer sur un autre appareil.</p>
    <div class="row" style="margin-top:12px">
      ${btn("export-maintenant", "Exporter maintenant", { icone: "download" })}
      ${btn("export-options", "Options…", { cls: "btn ghost" })}
      <label class="btn ghost">${ic("upload")}Importer<input type="file" id="import" accept=".json,.zip,.lfs,application/json,application/zip,application/octet-stream" hidden></label>
    </div>
    <p class="hint">Format actuel : <strong>${o.photos ? "ZIP complet (données + photos)" : "JSON (données seules, sans photos)"}</strong>${o.chiffre ? " · chiffré par mot de passe" : ""}.</p>
    <div class="section-title">Excel</div>
    <div class="row">${btn("export-csv", "Exporter tout en CSV (ZIP)", { icone: "download", cls: "btn ghost" })}</div>
    <p class="hint">Un fichier CSV par table (commandes, clients, factures, camions, gasoil…), lisible directement dans Excel.</p>
  </div>`;
}

function carteCopiesAuto() {
  return `<div class="card">
    <div class="card-head"><h2>Copies automatiques de l'appareil</h2></div>
    <p class="hint" style="margin-top:0">Une copie de vos données est conservée chaque jour (7 jours) dans l'appareil, ainsi qu'avant chaque import. Elle protège d'une erreur de manipulation, mais pas de la perte de l'appareil : exportez aussi vos données.</p>
    <div id="liste-copies"><p class="hint">Chargement…</p></div>
  </div>`;
}
async function remplirCopies() {
  const zone = $("#liste-copies");
  if (!zone) return;
  if (!idbDisponible()) { zone.innerHTML = `<p class="hint">Indisponible sur ce navigateur (IndexedDB).</p>`; return; }
  try {
    const l = await snapshotsLister();
    if (!$("#liste-copies")) return;
    zone.innerHTML = l.length ? `<div class="table-wrap"><table><thead><tr><th>Copie</th><th>Contenu</th><th></th></tr></thead><tbody>${l.map((x) => `<tr>
      <td><strong>${x.type === "auto" ? "Début de journée" : "Avant import"}</strong><span class="sub">${esc(dateHeureFr(x.ecrit))}</span></td>
      <td>${esc(libResume(x.resume))}</td><td><div class="actions">${btn("copie-restaurer", "Restaurer", { id: x.cle, cls: "btn ghost sm" })}</div></td></tr>`).join("")}</tbody></table></div>`
      : `<p class="hint">Aucune copie pour l'instant : la première sera créée à votre prochaine modification.</p>`;
    etiqueterTableaux();
  } catch { zone.innerHTML = `<p class="hint">Copies illisibles sur cet appareil.</p>`; }
}

function carteStockage() {
  return `<div class="card">
    <div class="card-head"><h2>Stockage</h2></div>
    <div id="info-stockage"><p class="hint">Chargement…</p></div>
  </div>`;
}
async function remplirStockage() {
  const zone = $("#info-stockage");
  if (!zone) return;
  const donnees = new Blob([JSON.stringify(S)]).size;
  let photos = { n: 0, taille: 0 };
  if (idbDisponible()) { try { const l = await photosToutes(); photos = { n: l.length, taille: l.reduce((s, p) => s + (p.taille || 0), 0) }; } catch { /* ignoré */ } }
  const [est, persistant] = await Promise.all([stockageEstimation(), stockagePersistant()]);
  if (!$("#info-stockage")) return;
  const ligne = (l, v) => `<tr><td>${l}</td><td class="r num">${v}</td></tr>`;
  $("#info-stockage").innerHTML = `<table><tbody>
    ${ligne("Données (stockage rapide, limite ≈ 5 Mo)", `${tailleOctets(donnees)} · ${fmt(donnees / 5242880 * 100)} %`)}
    ${ligne("Photos", `${photos.n} · ${tailleOctets(photos.taille)}`)}
    ${est ? ligne("Espace utilisé / disponible", `${tailleOctets(est.usage)} / ${tailleOctets(est.quota)}`) : ""}
    ${ligne("Protection contre l'effacement", persistant ? badge("Activée", "ok") : badge("Non activée", "warn"))}
  </tbody></table>
  ${persistant ? "" : `<p class="hint">Sans cette protection, le navigateur peut effacer les données de l'application quand l'appareil manque d'espace. ${btn("persister", "Activer la protection", { cls: "btn ghost sm" })}</p>`}`;
}

function carteZoneSensible() {
  return `<div class="card">
    <div class="card-head"><h2>Zone sensible</h2></div>
    <div class="row">${btn("demo", "Charger l'exemple", { cls: "btn ghost" })}${btn("reset", "Tout effacer", { cls: "btn text-danger" })}</div>
    <p class="hint">Avant tout remplacement, une copie automatique de vos données est conservée (voir ci-dessus).</p>
  </div>`;
}

/* ---------- Appareil : apparence, installation ---------- */
function carteApparence() {
  const t = (() => { try { return localStorage.getItem("logistique-theme") || "auto"; } catch { return "auto"; } })();
  return `<div class="card">
    <div class="card-head"><h2>Apparence</h2></div>
    <div class="segmented" role="tablist">${[["auto", "Automatique"], ["clair", "Clair"], ["sombre", "Sombre"]].map(([k, l]) => `<button role="tab" data-act="theme" data-id="${k}" aria-selected="${k === t}">${l}</button>`).join("")}</div>
    <p class="hint" style="margin-top:0">« Automatique » suit le réglage de votre téléphone ou ordinateur.</p>
  </div>`;
}
function carteInstallation() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const installee = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  return `<div class="card">
    <div class="card-head"><h2>Application mobile</h2>${installee ? badge("Installée", "ok") : ""}</div>
    <p class="hint" style="margin-top:0">Installée sur l'écran d'accueil, l'application s'ouvre comme une application native et fonctionne sans réseau.</p>
    ${invitationInstall ? btn("installer", "Installer sur cet appareil", { icone: "phone" })
      : installee ? "" : `<p class="hint">${ios ? "Sur iPhone (Safari) : Partager → « Sur l'écran d'accueil »." : "Sur Android (Chrome) : menu ⋮ → « Installer l'application »."}${location.protocol === "file:" ? " L'installation nécessite que l'application soit servie par un petit serveur (voir le README : Termux, GitHub Pages…)." : ""}</p>`}
  </div>`;
}

/* ---------- vue ---------- */
VUES.parametres = {
  titre: "Réglages",
  sous: "Calculs, données, rappels et appareil",
  rendu() {
    const generales = [carteCalculs(), carteEntreprise(), carteReglagesIA(), ...cartesDe("general").map((c) => c.rendu())];
    const donnees = [carteSauvegarde(), carteCopiesAuto(), carteStockage(), ...cartesDe("donnees").map((c) => c.rendu()), carteZoneSensible()];
    const parOnglet = { general: generales, donnees, rappels: cartesDe("rappels").map((c) => c.rendu()), appareil: [carteApparence(), ...cartesDe("appareil").map((c) => c.rendu()), carteInstallation()] };
    return `<div class="segmented" role="tablist">${ONGLETS_REGLAGES.map(([k, l]) => `<button role="tab" data-act="onglet-reglages" data-id="${k}" aria-selected="${k === ongletReglages}">${l}</button>`).join("")}</div>
      ${parOnglet[ongletReglages].join("")}`;
  },
  apres() {
    $("#import")?.addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importerFichier(f); });
    if (ongletReglages === "donnees") { remplirCopies(); remplirStockage(); }
    CARTES_REGLAGES.forEach((c) => c.apres?.());
  },
  soumettre(fid, v) {
    if (fid === "f-entreprise") {
      const { logoFichier, ...infos } = v;
      S.entreprise = { ...S.entreprise, ...infos };
      (async () => {
        if (logoFichier?.length) { try { S.entreprise.logo = await logoDepuisFichier(logoFichier[0]); } catch (e) { toast(e.message, "warn"); } }
        sauver(); toast("Informations de l'entreprise enregistrées"); rafraichir();
      })();
      return;
    }
    if (fid === "f-ia") {
      const actuelle = iaConfig();
      iaSauverConfig({ cle: v.cle || actuelle.cle, modele: v.modele });
      toast(v.cle || actuelle.cle ? "Assistant IA configuré" : "Modèle enregistré"); return rafraichir();
    }
    if (CARTES_REGLAGES.some((c) => c.soumettre?.(fid, v))) return;
    for (const k of Object.keys(PARAMS_DEFAUT)) S.params[k] = num(v[k], PARAMS_DEFAUT[k]);
    sauver(); toast("Réglages enregistrés"); rafraichir();
  },
  async agir(act, id) {
    if (act === "onglet-reglages") { ongletReglages = id; return rafraichir(); }
    if (act === "logo-retirer") { delete S.entreprise.logo; sauver(); toast("Logo retiré"); return rafraichir(); }
    for (const c of CARTES_REGLAGES) if (c.agir && (await c.agir(act, id))) return;
    if (act === "defaut") { S.params = { ...PARAMS_DEFAUT }; sauver(); toast("Valeurs par défaut rétablies"); rafraichir(); }
    if (act === "export-maintenant") exporterMaintenant();
    if (act === "export-options") { if (await choisirOptionsExport()) rafraichir(); }
    if (act === "export-csv") {
      const z = csvZipConstruire();
      if (!z) return toast("Rien à exporter pour l'instant.", "warn");
      telecharger(z.nom, z.octets, z.type); toast(`${z.nbTables} fichiers CSV téléchargés`);
    }
    if (act === "copie-restaurer") restaurerCopie(id);
    if (act === "persister") { toast((await stockageDemanderPersistance()) ? "Protection activée" : "Le navigateur n'a pas accordé la protection (installez l'application pour l'obtenir).", (await stockagePersistant()) ? "ok" : "warn"); remplirStockage(); }
    if (act === "theme") { appliquerTheme(id); rafraichir(); }
    if (act === "reset" && (await confirmer("Tout effacer ?", "Camions, chauffeurs, commandes, factures, photos… tout sera supprimé de cet appareil. Une copie automatique reste restaurable depuis l'onglet Données.", "Tout effacer"))) {
      await copieAvantRemplacement();
      S = etatVide(); sauver(); await photosVider().catch(() => {}); toast("Données effacées");
      ongletReglages = "general";
      if (typeof demarrerAssistant === "function") demarrerAssistant(); else afficher("tableau");
    }
    if (act === "demo" && (!contientDonnees(S) || (await confirmer("Charger l'exemple ?", "Les données actuelles seront remplacées (une copie automatique est conservée).", "Remplacer")))) {
      await copieAvantRemplacement();
      const ent = S.entreprise; const prix = S.params;
      S = donneesDemo(); if (ent?.nom) S.entreprise = ent; S.params = { ...S.params, ...prix };
      S.meta.onboarde = true; sauver(); toast("Données d'exemple chargées"); afficher("tableau");
    }
    if (act === "ia-verifier") {
      const b = $("#app [data-act=ia-verifier]");
      b.disabled = true; b.innerHTML = '<span class="spinner"></span>Vérification…';
      try { toast(`Clé valide · ${await iaVerifierCle()} disponible`); }
      catch (e) { toast(e.message, "danger"); }
      finally { rafraichir(); }
    }
    if (act === "ia-oublier" && (await confirmer("Retirer la clé API ?", "L'assistant IA sera désactivé sur cet appareil.", "Retirer"))) {
      iaSauverConfig({ ...iaConfig(), cle: "" }); toast("Clé retirée"); rafraichir();
    }
    if (act === "installer" && invitationInstall) { invitationInstall.prompt(); invitationInstall = null; rafraichir(); }
  },
};

/* ---------- export / import ---------- */
async function copieAvantRemplacement() {
  if (idbDisponible() && contientDonnees(S)) await snapshotEcrire(S, "manuel").catch(() => {});
}

/** Fenêtre d'options d'export. Valide le mot de passe dans la fenêtre (elle se rouvre avec le message d'erreur). */
async function choisirOptionsExport(erreur = "", init = S.meta.exportOptions || { photos: true, chiffre: false }) {
  const v = await formulaire("Options d'export", [
    { name: "format", label: "Contenu", type: "select", value: init.photos ? "zip" : "json", full: true, options: [["zip", "ZIP complet — données + photos (recommandé)"], ["json", "JSON — données seules, sans photos"]] },
    { name: "chiffre", label: "Chiffrer avec un mot de passe", type: "checkbox", value: init.chiffre, full: true },
    { name: "mdp", label: "Mot de passe (8 caractères minimum)", type: "password", autocomplete: "new-password" },
    { name: "mdp2", label: "Confirmer le mot de passe", type: "password", autocomplete: "new-password" },
  ], { valider: "Enregistrer", aide: `${erreur ? `<strong style="color:var(--danger)">${esc(erreur)}</strong><br>` : ""}Le mot de passe n'est pas conservé : <strong>sans lui, le fichier est irrécupérable</strong>. Il sera demandé à chaque export chiffré.` });
  if (!v) return false;
  if (v.chiffre && (v.mdp.length < 8 || v.mdp !== v.mdp2)) return choisirOptionsExport(v.mdp.length < 8 ? "Mot de passe trop court (8 caractères minimum)." : "Les deux mots de passe ne correspondent pas.", { photos: v.format === "zip", chiffre: true });
  S.meta.exportOptions = { photos: v.format === "zip", chiffre: v.chiffre };
  sauver(); toast("Options enregistrées");
  return true;
}

async function exporterMaintenant() {
  const o = S.meta.exportOptions || { photos: true, chiffre: false };
  let mdp = "";
  if (o.chiffre) {
    const v = await formulaire("Mot de passe de la sauvegarde", [{ name: "mdp", label: "Mot de passe", type: "password", required: true, full: true, autocomplete: "off" }], { valider: "Exporter" });
    if (!v) return;
    mdp = v.mdp;
  }
  try {
    const r = await sauvegardeConstruire({ photos: o.photos, mdp });
    S.meta.derniereSauvegarde = new Date().toISOString(); sauver();
    telecharger(r.nom, r.octets, r.type);
    toast(`Sauvegarde téléchargée · ${tailleOctets(r.octets.length)}${r.nbPhotos ? ` · ${r.nbPhotos} photo${r.nbPhotos > 1 ? "s" : ""}` : ""}${r.chiffre ? " · chiffrée" : ""}`);
    if (typeof majIndicateurs === "function") majIndicateurs();
    if (ongletActif === "parametres" || ongletActif === "tableau") rafraichir();
  } catch (e) { toast(`Export impossible : ${e.message}`, "danger"); }
}

async function importerFichier(fichier) {
  const octets = new Uint8Array(await fichier.arrayBuffer());
  let lu, mdp = "", message = "";
  for (;;) {
    try { lu = await sauvegardeLire(octets, mdp); break; }
    catch (e) {
      if (!e.chiffre && !/Mot de passe/.test(e.message)) return toast(e.message, "danger");
      const v = await formulaire("Fichier chiffré", [{ name: "mdp", label: "Mot de passe", type: "password", required: true, full: true, autocomplete: "off" }], { valider: "Déchiffrer", aide: message });
      if (!v) return;
      mdp = v.mdp; message = `<strong style="color:var(--danger)">Mot de passe incorrect.</strong>`;
    }
  }
  const nbPh = lu.photos.length;
  const corps = `<p style="margin:0 0 10px">Le fichier contient <strong>${esc(libResume(resumeDonnees(lu.etat)))}</strong>${nbPh ? ` et <strong>${nbPh} photo${nbPh > 1 ? "s" : ""}</strong>` : ""}.</p>
    <p style="margin:0 0 10px">Vos données actuelles (<strong>${esc(libResume(resumeDonnees(S)))}</strong>) seront remplacées. Une copie automatique reste restaurable.</p>
    ${lu.depuis < VERSION_SCHEMA ? `<p class="hint">Sauvegarde d'une version plus ancienne (v${lu.depuis}) : elle sera mise à niveau automatiquement.</p>` : ""}
    ${lu.tropRecent ? `<p class="hint" style="color:var(--danger)">Ce fichier vient d'une version plus récente de l'application : certaines informations pourraient être ignorées.</p>` : ""}
    ${lu.avecPhotos ? "" : `<p class="hint">Ce fichier ne contient pas de photos : vos photos actuelles sont conservées.</p>`}`;
  if (!(await modale({ titre: "Importer la sauvegarde ?", corps, valider: "Remplacer mes données", danger: true }))) return;
  await copieAvantRemplacement();
  S = lu.etat; sauver();
  let nPh = 0;
  if (lu.avecPhotos) { try { nPh = await photosRestaurer(lu.photos); } catch (e) { toast(`Photos non restaurées : ${e.message}`, "warn"); } }
  toast(`Sauvegarde importée${nPh ? ` · ${nPh} photo${nPh > 1 ? "s" : ""}` : ""}`);
  afficher("tableau");
}

async function restaurerCopie(cle) {
  const snap = await snapshotLire(cle).catch(() => null);
  if (!snap) return toast("Copie introuvable.", "danger");
  const r = resumeDonnees(snap.etat);
  if (!(await modale({ titre: "Restaurer cette copie ?", valider: "Restaurer", danger: true,
    corps: `<p style="margin:0 0 10px">Copie du <strong>${esc(dateHeureFr(snap.ecrit))}</strong> : ${esc(libResume(r))}.</p><p style="margin:0">Vos données actuelles (${esc(libResume(resumeDonnees(S)))}) seront remplacées. Une copie de l'état actuel est conservée avant.</p>` }))) return;
  await copieAvantRemplacement();
  S = migrer(snap.etat).etat; sauver(); toast("Copie restaurée"); afficher("tableau");
}

/* ---------- Entreprise et assistant IA (cartes existantes) ---------- */
function carteReglagesIA() {
  const c = iaConfig();
  const masque = c.cle ? `${c.cle.slice(0, 10)}…${c.cle.slice(-4)}` : "";
  return `<div class="card">
    <div class="card-head"><h2 class="row" style="gap:10px"><span class="ia-ico sm">${ic("sparkles")}</span>Assistant IA</h2>${c.cle ? badge("Activé", "ok") : badge("Non configuré", "neutral")}</div>
    <form id="f-ia">
      ${champs([
        { name: "cle", label: c.cle ? `Clé API Anthropic (actuelle : ${masque})` : "Clé API Anthropic", type: "password", placeholder: c.cle ? "Laisser vide pour garder la clé actuelle" : "sk-ant-…", autocomplete: "off" },
        { name: "modele", label: "Modèle", type: "select", value: c.modele, options: IA_MODELES.map((m) => [m.id, m.nom]) },
      ])}
      <p class="hint">Créez une clé sur <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> (paiement à l'usage).
        Tarifs par million de jetons : ${IA_MODELES.map((m) => `${m.nom.split(" — ")[0].replace("Claude ", "")} ${fmt(m.entree, 2)} $ / ${fmt(m.sortie, 2)} $`).join(" · ")} (entrée / sortie).
        La clé reste sur cet appareil et n'est <strong>jamais</strong> incluse dans les sauvegardes exportées. Conseil : utilisez une clé dédiée avec une limite de dépense mensuelle.</p>
      <div class="row" style="justify-content:flex-end;margin-top:12px">
        ${c.cle ? btn("ia-oublier", "Retirer la clé", { cls: "btn text-danger" }) + btn("ia-verifier", "Vérifier la clé", { cls: "btn ghost" }) : ""}
        <button class="btn">Enregistrer</button>
      </div>
    </form>
  </div>`;
}

/** Réduit un logo à 400×160 px maximum (transparence conservée) : une centaine de Ko au plus, stocké dans les données. */
async function logoDepuisFichier(fichier) {
  const bmp = await decoderImage(fichier);
  try {
    const k = Math.min(1, 400 / bmp.width, 160 / bmp.height);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } finally { bmp.close?.(); }
}
