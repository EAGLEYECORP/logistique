"use strict";
/* ============================================================
   Synchronisation entre appareils (bureau, téléphones des chauffeurs…) par le relais.
   · Les données sont chiffrées sur l'appareil (AES-256-GCM, mot de passe de synchronisation) : le serveur ne garde qu'un bloc illisible.
   · Fusion à trois voies par enregistrement : rien ne se perd en silence (voir conformite.js, fusionnerEtat).
   · Photos : un fichier chiffré par photo, envoyé ou reçu par lots ; une photo supprimée sur un appareil l'est sur les autres.
   · La configuration propre à l'appareil (jetons, PIN, mode chauffeur, profil) n'est pas synchronisée.
   ============================================================ */

const CLE_SYNC = "logistique-synchro", CLE_SYNC_ETAT = "logistique-synchro-etat";
const synchroCfg = () => { try { return { url: "", jeton: "", mdp: "", appareil: "", auto: false, photos: true, ...JSON.parse(localStorage.getItem(CLE_SYNC) || "{}") }; } catch { return { url: "", jeton: "", mdp: "", appareil: "", auto: false, photos: true }; } };
const synchroSauverCfg = (c) => { try { localStorage.setItem(CLE_SYNC, JSON.stringify(c)); } catch { /* ignoré */ } };
const synchroEtat = () => { try { return { version: 0, t: 0, bilan: "", erreur: "", ...JSON.parse(localStorage.getItem(CLE_SYNC_ETAT) || "{}") }; } catch { return { version: 0, t: 0, bilan: "", erreur: "" }; } };
const synchroSauverEtat = (e) => { try { localStorage.setItem(CLE_SYNC_ETAT, JSON.stringify(e)); } catch { /* ignoré */ } };
const syncBaseLire = () => idbTx("etat", "readonly", (st) => idbDemande(st.get("sync-base"))).catch(() => null);
const syncBaseEcrire = (texte) => idbTx("etat", "readwrite", (st) => idbDemande(texte === null ? st.delete("sync-base") : st.put(texte, "sync-base"))).catch(() => {});
const synchroActive = () => { const c = synchroCfg(); return !!(baseUrl(c.url) && c.jeton && c.mdp); };

const versBase64 = (o) => { let s = ""; for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000)); return btoa(s); };
const depuisBase64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
async function syncAppel(methode, chemin, corps) {
  const c = synchroCfg();
  let r;
  try { r = await fetch(baseUrl(c.url) + chemin, { method: methode, headers: { Authorization: `Bearer ${c.jeton}`, "Content-Type": "application/json" }, body: corps ? JSON.stringify(corps) : undefined }); }
  catch { throw new Error("Serveur injoignable (adresse, réseau ou HTTPS)."); }
  if (r.status === 401) throw new Error("Jeton refusé par le serveur.");
  const json = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 409) throw new Error(json.erreur || `Réponse ${r.status} du serveur.`);
  return { code: r.status, ...json };
}
const syncChiffrerEtat = async (etat) => versBase64(await chiffrer(new TextEncoder().encode(JSON.stringify(etat)), synchroCfg().mdp));
async function syncDechiffrerEtat(blob) {
  try { return JSON.parse(new TextDecoder().decode(await dechiffrer(depuisBase64(blob), synchroCfg().mdp))); }
  catch { throw new Error("Le mot de passe de synchronisation ne correspond pas à celui des autres appareils."); }
}
const syncEtatLocal = () => JSON.parse(JSON.stringify(S));

async function syncPousser(etat, baseVersion) {
  const r = await syncAppel("PUT", "/api/sync", { base: baseVersion, blob: await syncChiffrerEtat(etat), appareil: synchroCfg().appareil || navigator.platform || "appareil" });
  return r;
}
async function syncAppliquer(etat) {
  if (typeof snapshotEcrire === "function") { try { await snapshotEcrire(S, "manuel"); } catch { /* copie de sécurité facultative */ } }
  syncEnCours.applique = true;
  S = migrer(etat).etat; sauver(); syncEnCours.applique = false;
  if (typeof rafraichir === "function" && !$("#modale")?.open) rafraichir();
}
const syncEnCours = { actif: false, applique: false, minuteur: null };

/**
 * Un tour de synchronisation. options.mode : "auto" | "remplacer-local" (le serveur gagne) | "remplacer-serveur" (cet appareil gagne).
 * Renvoie un texte de bilan.
 */
async function synchroniser({ manuel = false, mode = "fusion" } = {}) {
  if (syncEnCours.actif || !synchroActive()) return "";
  if (!manuel && $("#modale")?.open) return ""; // on n'applique rien pendant une saisie
  syncEnCours.actif = true;
  const e = synchroEtat();
  try {
    for (let essai = 0; essai < 3; essai++) {
      const meta = await syncAppel("GET", "/api/sync?meta=1");
      const local = syncEtatLocal(), baseTexte = await syncBaseLire();
      let bilan;
      // Un appareil vidé (données effacées, navigateur réinitialisé) ne doit jamais effacer le serveur : il reprend les données du serveur.
      const vide = meta.version > 0 && !contientDonnees(local) && mode === "fusion";
      if (vide) { e.version = 0; await syncBaseEcrire(null); syncPhotosEtat({ connus: [] }); }
      if (mode === "remplacer-serveur" || meta.version === 0) {
        const r = await syncPousser(local, meta.version); if (r.code === 409) continue;
        e.version = r.version; await syncBaseEcrire(JSON.stringify(local)); bilan = meta.version === 0 ? "Données envoyées au serveur (première synchronisation)." : "Le serveur a été remplacé par les données de cet appareil.";
      } else if (meta.version === e.version && mode !== "remplacer-local") {
        if (baseTexte && syncStable(local) === syncStable(JSON.parse(baseTexte))) { bilan = "Déjà à jour."; }
        else { const r = await syncPousser(local, e.version); if (r.code === 409) continue; e.version = r.version; await syncBaseEcrire(JSON.stringify(local)); bilan = "Modifications envoyées."; }
      } else {
        const complet = await syncAppel("GET", "/api/sync"), remote = await syncDechiffrerEtat(complet.blob);
        let fusion;
        if (mode === "remplacer-local" || vide) fusion = { etat: remote, conflits: 0, recus: -1, envoyes: 0 };
        else {
          if (!e.version && contientDonnees(local) && manuel) {
            const c = await formulaire("Première synchronisation de cet appareil", [{ name: "choix", label: "Le serveur contient déjà des données", type: "select", options: [["fusion", "Fusionner avec les données de cet appareil"], ["serveur", "Remplacer les données de cet appareil par celles du serveur"]], value: "fusion" }], { valider: "Continuer", aide: "Une copie de sécurité de cet appareil est conservée avant tout changement (Réglages → Données → copies automatiques)." });
            if (!c) { syncEnCours.actif = false; return "Annulé."; }
            if (c.choix === "serveur") fusion = { etat: remote, conflits: 0, recus: -1, envoyes: 0 };
          }
          if (!fusion) fusion = fusionnerEtat(baseTexte ? JSON.parse(baseTexte) : null, local, remote);
        }
        await syncAppliquer(fusion.etat);
        const nouveau = syncEtatLocal();
        const r = await syncPousser(nouveau, complet.version); if (r.code === 409) continue;
        e.version = r.version; await syncBaseEcrire(JSON.stringify(nouveau));
        bilan = fusion.recus === -1 ? "Données du serveur appliquées." : `Fusion faite : ${fusion.recus} reçu(s), ${fusion.envoyes} envoyé(s), ${fusion.conflits} conflit(s) (cet appareil l'emporte).`;
      }
      e.t = Math.floor(Date.now() / 1000); e.bilan = bilan; e.erreur = ""; synchroSauverEtat(e);
      if (synchroCfg().photos !== false) { try { const ph = await synchroniserPhotos(); if (ph) { bilan += " " + ph; e.bilan = bilan; synchroSauverEtat(e); } } catch (err) { e.bilan = `${bilan} Photos : ${err.message}`; synchroSauverEtat(e); bilan = e.bilan; } }
      syncEnCours.actif = false; rafraichirCarteSynchro();
      return bilan;
    }
    throw new Error("Le serveur change trop vite : réessayez.");
  } catch (err) { e.erreur = err.message; synchroSauverEtat(e); syncEnCours.actif = false; rafraichirCarteSynchro(); if (manuel) toast(err.message, "danger"); return err.message; }
}
/* ---------- photos ---------- */
const CLE_SYNC_PHOTOS = "logistique-synchro-photos";
const syncPhotosLire = () => { try { return { connus: [], ...JSON.parse(localStorage.getItem(CLE_SYNC_PHOTOS) || "{}") }; } catch { return { connus: [] }; } };
const syncPhotosEtat = (x) => { try { localStorage.setItem(CLE_SYNC_PHOTOS, JSON.stringify(x)); } catch { /* ignoré */ } };
const photosCles = () => idbTx("photos", "readonly", (st) => idbDemande(st.getAllKeys()));
async function syncPhotoBrut(methode, id, corps) {
  const c = synchroCfg(); let r;
  try { r = await fetch(`${baseUrl(c.url)}/api/sync/photos/${encodeURIComponent(id)}`, { method: methode, headers: { Authorization: `Bearer ${c.jeton}`, "Content-Type": "application/octet-stream" }, body: corps }); }
  catch { throw new Error("serveur injoignable."); }
  if (r.status === 507) throw new Error("espace photos plein sur le serveur.");
  if (r.status === 413) throw new Error("photo trop volumineuse pour le serveur.");
  if (!r.ok && !(methode === "GET" && r.status === 404)) throw new Error(`réponse ${r.status} du serveur.`);
  return r;
}
/** Un lot de synchronisation des photos (au plus `lot` envois et `lot` réceptions) ; le reste suit au tour suivant. Renvoie un texte de bilan. */
async function synchroniserPhotos({ lot = 20 } = {}) {
  if (!idbDisponible() || !synchroActive()) return "";
  const manifeste = await syncAppel("GET", "/api/sync/photos"), mdp = synchroCfg().mdp;
  const vivants = manifeste.photos.filter((p) => !p.supprime).map((p) => p.id), tombes = manifeste.photos.filter((p) => p.supprime).map((p) => p.id);
  const locaux = await photosCles(); let connus = syncPhotosLire().connus;
  if (!locaux.length && connus.length) connus = []; // appareil vidé : on reprend les photos du serveur, on n'efface rien
  const plan = planPhotos(locaux, vivants, tombes, connus);
  const L = new Set(locaux), V = new Set(vivants); let envoyees = 0, recues = 0, erreur = "";
  for (const id of plan.supprimerLocal) { await photoSupprimer(id); L.delete(id); }
  for (const id of plan.supprimerServeur) { try { await syncPhotoBrut("DELETE", id); V.delete(id); } catch (e) { erreur = e.message; break; } }
  for (const id of plan.envoyer.slice(0, lot)) {
    if (erreur) break;
    try {
      const p = await photoLire(id); if (!p?.blob) { L.delete(id); continue; }
      const image = new Uint8Array(await p.blob.arrayBuffer()), mini = p.mini ? new Uint8Array(await p.mini.arrayBuffer()) : new Uint8Array(0);
      const paquet = photoEmballer({ id: p.id, cible: p.cible, nom: p.nom, date: p.date, w: p.w, h: p.h, taille: p.taille, type: p.blob.type || "image/jpeg" }, image, mini);
      await syncPhotoBrut("PUT", id, await chiffrer(paquet, mdp)); V.add(id); envoyees++;
    } catch (e) { erreur = e.message; }
  }
  for (const id of plan.recevoir.slice(0, lot)) {
    if (erreur) break;
    try {
      const r = await syncPhotoBrut("GET", id); if (r.status === 404) continue;
      const { meta, image, mini } = photoDeballer(await dechiffrer(new Uint8Array(await r.arrayBuffer()), mdp));
      await photoEnregistrer({ id: meta.id, cible: meta.cible, nom: meta.nom, date: meta.date, w: meta.w, h: meta.h, taille: meta.taille, blob: new Blob([image], { type: meta.type || "image/jpeg" }), mini: mini.length ? new Blob([mini], { type: "image/jpeg" }) : null });
      L.add(id); recues++;
    } catch (e) { erreur = /Mot de passe/.test(e.message) ? "mot de passe de synchronisation différent." : e.message; }
  }
  syncPhotosEtat({ connus: [...L].filter((id) => V.has(id)), t: Math.floor(Date.now() / 1000) });
  const reste = Math.max(0, plan.envoyer.length - envoyees) + Math.max(0, plan.recevoir.length - recues);
  if (recues || plan.supprimerLocal.length) { if (typeof hydraterPhotos === "function") hydraterPhotos(); }
  if (reste && !erreur) setTimeout(() => synchroniser(), 3000); // la suite au tour suivant, sans bloquer l'application
  if (erreur) throw new Error(`${envoyees} envoyée(s), ${recues} reçue(s), puis ${erreur}`);
  const supp = plan.supprimerLocal.length + plan.supprimerServeur.length;
  return envoyees || recues || supp || reste ? `Photos : ${envoyees} envoyée(s), ${recues} reçue(s)${supp ? `, ${supp} supprimée(s)` : ""}${reste ? `, ${reste} en attente` : ""}.` : "";
}

function synchroPlanifier() { // envoi différé 15 s après une modification
  if (syncEnCours.applique || !synchroCfg().auto || !synchroActive() || (typeof multiActif === "function" && multiActif())) return;
  clearTimeout(syncEnCours.minuteur); syncEnCours.minuteur = setTimeout(() => synchroniser(), 15000);
}
if (typeof sauver === "function") { const sauverSansSynchro = sauver; sauver = function () { const r = sauverSansSynchro.apply(this, arguments); synchroPlanifier(); return r; }; }
setInterval(() => { if (document.visibilityState === "visible" && synchroCfg().auto) synchroniser(); }, 3 * 60 * 1000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && synchroCfg().auto) synchroniser(); });
setTimeout(() => { if (synchroCfg().auto) synchroniser(); }, 4000);

/* ---------- réglages ---------- */
const rafraichirCarteSynchro = () => { const z = document.querySelector("#carte-synchro"); if (z) z.outerHTML = carteSynchro(); };
function carteSynchro() {
  const c = synchroCfg(), e = synchroEtat(), d = typeof directCfg === "function" ? directCfg() : {};
  return `<div class="card" id="carte-synchro"><div class="card-head"><h2>Synchronisation entre appareils</h2>${synchroActive() ? (e.erreur ? badge("Erreur", "danger") : e.t ? badge(`v${e.version}`, "ok") : badge("Prête", "neutral")) : badge("Non configurée", "neutral")}</div>
    <p class="hint" style="margin-top:0">Retrouvez les mêmes données sur le bureau et sur les téléphones des chauffeurs, par votre relais. Les données sont <strong>chiffrées sur l'appareil</strong> avec le mot de passe ci-dessous : le serveur ne voit qu'un bloc illisible. Les <strong>photos</strong> suivent, chiffrées elles aussi, par lots de 20.</p>
    ${e.erreur ? `<p class="hint" style="color:var(--danger)">${esc(e.erreur)}</p>` : e.t ? `<p class="hint">Dernière synchronisation : ${dateHeureFr(new Date(e.t * 1000).toISOString())} — ${esc(e.bilan)}</p>` : ""}
    <form id="f-synchro"><div class="form-grid">
      <label class="f full">Adresse du relais<input name="url" value="${esc(c.url || d.url || "")}" placeholder="https://suivi.mon-entreprise.ma" inputmode="url" autocomplete="off"></label>
      <label class="f full">Jeton de lecture<input name="jeton" type="password" value="${esc(c.jeton || d.jeton || "")}" autocomplete="off"></label>
      <label class="f full">Mot de passe de synchronisation (le même sur tous les appareils — <strong>perdu, il est irrécupérable</strong>)<input name="mdp" type="password" value="${esc(c.mdp)}" autocomplete="off"></label>
      <label class="f full">Nom de cet appareil<input name="appareil" value="${esc(c.appareil)}" placeholder="Bureau, Téléphone de Karim…"></label>
      <label class="check full"><input type="checkbox" name="photos" ${c.photos !== false ? "checked" : ""}><span>Synchroniser aussi les photos (CMR, livraisons, tickets… — consomme des données mobiles)</span></label>
      <label class="check full"><input type="checkbox" name="auto" ${c.auto ? "checked" : ""}><span>Synchroniser automatiquement (à l'ouverture, toutes les 3 minutes, et 15 secondes après une modification)</span></label></div>
      <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn">Enregistrer</button></div></form>
    ${synchroActive() ? `<div class="row" style="margin-top:12px">${btn("synchro-maintenant", "Synchroniser maintenant", { icone: "clock" })}${btn("synchro-serveur", "Le serveur gagne", { cls: "btn ghost sm", titre: "Remplacer les données de cet appareil par celles du serveur" })}${btn("synchro-local", "Cet appareil gagne", { cls: "btn ghost sm", titre: "Remplacer les données du serveur par celles de cet appareil" })}${btn("synchro-oublier", "Oublier", { cls: "btn text-danger sm" })}</div>
    <p class="hint">Si deux appareils modifient le même enregistrement, la version de l'appareil qui synchronise l'emporte ; une modification l'emporte toujours sur une suppression. Une copie de sécurité est conservée avant chaque application de données reçues.</p>` : ""}</div>`;
}
enregistrerCarteReglages({
  onglet: "donnees", ordre: 15,
  rendu: carteSynchro,
  soumettre(fid, v) {
    if (fid !== "f-synchro") return false;
    synchroSauverCfg({ url: baseUrl(v.url), jeton: v.jeton, mdp: v.mdp, appareil: v.appareil.trim(), auto: !!v.auto, photos: !!v.photos });
    toast("Réglages de synchronisation enregistrés"); rafraichir(); if (synchroActive() && v.auto) synchroniser({ manuel: true }); return true;
  },
  async agir(act) {
    if (act === "synchro-maintenant") { const b = await synchroniser({ manuel: true }); if (b) toast(b); return true; }
    if (act === "synchro-serveur") { if (await confirmer("Le serveur gagne ?", "Les données de cet appareil seront remplacées par celles du serveur (une copie de sécurité est conservée).", "Remplacer")) { const b = await synchroniser({ manuel: true, mode: "remplacer-local" }); if (b) toast(b); } return true; }
    if (act === "synchro-local") { if (await confirmer("Cet appareil gagne ?", "Les données du serveur seront remplacées par celles de cet appareil. Les autres appareils recevront ces données à leur prochaine synchronisation.", "Remplacer le serveur")) { const b = await synchroniser({ manuel: true, mode: "remplacer-serveur" }); if (b) toast(b); } return true; }
    if (act === "synchro-oublier") { synchroSauverCfg({ url: "", jeton: "", mdp: "", appareil: "", auto: false, photos: true }); synchroSauverEtat({}); syncPhotosEtat({ connus: [] }); await syncBaseEcrire(null); toast("Synchronisation désactivée sur cet appareil"); rafraichir(); return true; }
    return false;
  },
});
