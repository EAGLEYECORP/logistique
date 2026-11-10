"use strict";
/* ============================================================
   Synchronisation entre appareils (bureau, téléphones des chauffeurs…) par le relais.
   · Les données sont chiffrées sur l'appareil (AES-256-GCM, mot de passe de synchronisation) : le serveur ne garde qu'un bloc illisible.
   · Fusion à trois voies par enregistrement : rien ne se perd en silence (voir conformite.js, fusionnerEtat).
   · Photos et configuration propre à l'appareil (jetons, PIN, mode chauffeur) ne sont pas synchronisées.
   ============================================================ */

const CLE_SYNC = "logistique-synchro", CLE_SYNC_ETAT = "logistique-synchro-etat";
const synchroCfg = () => { try { return { url: "", jeton: "", mdp: "", appareil: "", auto: false, ...JSON.parse(localStorage.getItem(CLE_SYNC) || "{}") }; } catch { return { url: "", jeton: "", mdp: "", appareil: "", auto: false }; } };
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
      if (mode === "remplacer-serveur" || meta.version === 0) {
        const r = await syncPousser(local, meta.version); if (r.code === 409) continue;
        e.version = r.version; await syncBaseEcrire(JSON.stringify(local)); bilan = meta.version === 0 ? "Données envoyées au serveur (première synchronisation)." : "Le serveur a été remplacé par les données de cet appareil.";
      } else if (meta.version === e.version && mode !== "remplacer-local") {
        if (baseTexte && syncStable(local) === syncStable(JSON.parse(baseTexte))) { bilan = "Déjà à jour."; }
        else { const r = await syncPousser(local, e.version); if (r.code === 409) continue; e.version = r.version; await syncBaseEcrire(JSON.stringify(local)); bilan = "Modifications envoyées."; }
      } else {
        const complet = await syncAppel("GET", "/api/sync"), remote = await syncDechiffrerEtat(complet.blob);
        let fusion;
        if (mode === "remplacer-local") fusion = { etat: remote, conflits: 0, recus: -1, envoyes: 0 };
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
      e.t = Math.floor(Date.now() / 1000); e.bilan = bilan; e.erreur = ""; synchroSauverEtat(e); syncEnCours.actif = false; rafraichirCarteSynchro();
      return bilan;
    }
    throw new Error("Le serveur change trop vite : réessayez.");
  } catch (err) { e.erreur = err.message; synchroSauverEtat(e); syncEnCours.actif = false; rafraichirCarteSynchro(); if (manuel) toast(err.message, "danger"); return err.message; }
}
function synchroPlanifier() { // envoi différé 15 s après une modification
  if (syncEnCours.applique || !synchroCfg().auto || !synchroActive()) return;
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
    <p class="hint" style="margin-top:0">Retrouvez les mêmes données sur le bureau et sur les téléphones des chauffeurs, par votre relais. Les données sont <strong>chiffrées sur l'appareil</strong> avec le mot de passe ci-dessous : le serveur ne voit qu'un bloc illisible. <strong>Les photos ne sont pas synchronisées.</strong></p>
    ${e.erreur ? `<p class="hint" style="color:var(--danger)">${esc(e.erreur)}</p>` : e.t ? `<p class="hint">Dernière synchronisation : ${dateHeureFr(new Date(e.t * 1000).toISOString())} — ${esc(e.bilan)}</p>` : ""}
    <form id="f-synchro"><div class="form-grid">
      <label class="f full">Adresse du relais<input name="url" value="${esc(c.url || d.url || "")}" placeholder="https://suivi.mon-entreprise.ma" inputmode="url" autocomplete="off"></label>
      <label class="f full">Jeton de lecture<input name="jeton" type="password" value="${esc(c.jeton || d.jeton || "")}" autocomplete="off"></label>
      <label class="f full">Mot de passe de synchronisation (le même sur tous les appareils — <strong>perdu, il est irrécupérable</strong>)<input name="mdp" type="password" value="${esc(c.mdp)}" autocomplete="off"></label>
      <label class="f full">Nom de cet appareil<input name="appareil" value="${esc(c.appareil)}" placeholder="Bureau, Téléphone de Karim…"></label>
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
    synchroSauverCfg({ url: baseUrl(v.url), jeton: v.jeton, mdp: v.mdp, appareil: v.appareil.trim(), auto: !!v.auto });
    toast("Réglages de synchronisation enregistrés"); rafraichir(); if (synchroActive() && v.auto) synchroniser({ manuel: true }); return true;
  },
  async agir(act) {
    if (act === "synchro-maintenant") { const b = await synchroniser({ manuel: true }); if (b) toast(b); return true; }
    if (act === "synchro-serveur") { if (await confirmer("Le serveur gagne ?", "Les données de cet appareil seront remplacées par celles du serveur (une copie de sécurité est conservée).", "Remplacer")) { const b = await synchroniser({ manuel: true, mode: "remplacer-local" }); if (b) toast(b); } return true; }
    if (act === "synchro-local") { if (await confirmer("Cet appareil gagne ?", "Les données du serveur seront remplacées par celles de cet appareil. Les autres appareils recevront ces données à leur prochaine synchronisation.", "Remplacer le serveur")) { const b = await synchroniser({ manuel: true, mode: "remplacer-serveur" }); if (b) toast(b); } return true; }
    if (act === "synchro-oublier") { synchroSauverCfg({ url: "", jeton: "", mdp: "", appareil: "", auto: false }); synchroSauverEtat({}); await syncBaseEcrire(null); toast("Synchronisation désactivée sur cet appareil"); rafraichir(); return true; }
    return false;
  },
});
