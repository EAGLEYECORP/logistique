"use strict";
/* ============================================================
   Démarrage : chargement des données (avec récupération), migration, indicateurs
   (sauvegarde, hors ligne), thème, mise à jour de l'application, installation.
   Chargé en dernier : toutes les vues sont enregistrées à ce moment-là.
   ============================================================ */

/* ---------- chargement + récupération ---------- */
/** Lit les données. Migre si besoin (copie de sécurité d'abord) ; si elles sont absentes ou corrompues, propose le miroir interne. */
async function chargerEtat() {
  let brut = null;
  try { brut = localStorage.getItem(STORAGE_KEY); } catch { /* stockage bloqué */ }
  let corrompu = false;
  if (brut) {
    try {
      const r = migrer(JSON.parse(brut));
      if (r.migre) {
        if (idbDisponible()) await snapshotEcrire(JSON.parse(brut), "manuel").catch(() => {}); // copie avant mise à niveau
        demarrage.notes.push(`Données mises à niveau (v${r.depuis} → v${VERSION_SCHEMA}). Une copie d'avant la mise à niveau est conservée.`);
        demarrage.sauverApres = true;
      }
      if (r.tropRecent) demarrage.notes.push("Ces données viennent d'une version plus récente de l'application : mettez-la à jour pour éviter toute perte.");
      return r.etat;
    } catch {
      corrompu = true;
      try { localStorage.setItem(`${STORAGE_KEY}-corrompu`, brut); } catch { /* ignoré */ }
    }
  }
  if (idbDisponible()) {
    try {
      const m = await etatMiroirLire();
      if (m?.etat && contientDonnees(m.etat)) {
        const ok = await modale({
          titre: corrompu ? "Données endommagées" : "Données retrouvées", valider: "Restaurer", annuler: "Repartir de zéro",
          corps: `<p style="margin:0 0 10px">${corrompu ? "Les données de cet appareil sont illisibles." : "Les données de cet appareil ont disparu (effacement du navigateur ?)."} Une copie interne a été retrouvée :</p>
            <p style="margin:0 0 10px"><strong>${esc(libResume(resumeDonnees(m.etat)))}</strong><br><span class="hint">enregistrée le ${esc(dateHeureFr(m.ecrit))}</span></p>
            <p class="hint" style="margin:0">Si vous choisissez de repartir de zéro, cette copie reste restaurable depuis Réglages → Données.</p>` });
        if (ok) { demarrage.notes.push("Données restaurées depuis la copie interne."); demarrage.sauverApres = true; return migrer(m.etat).etat; }
        await snapshotEcrire(m.etat, "manuel").catch(() => {});
      }
    } catch { /* miroir illisible */ }
  }
  return etatVide();
}
const demarrage = { notes: [], sauverApres: false };

/* ---------- thème ---------- */
function appliquerTheme(choix) {
  try { localStorage.setItem("logistique-theme", choix); } catch { /* ignoré */ }
  const r = document.documentElement;
  if (choix === "clair") r.dataset.theme = "light"; else if (choix === "sombre") r.dataset.theme = "dark"; else delete r.dataset.theme;
  majCouleurBarre();
}
/** Colore la barre d'état du navigateur comme le fond de l'application (clair ou sombre). */
function majCouleurBarre() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.removeAttribute("media"); if (bg) m.content = bg; });
}
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", majCouleurBarre);

/* ---------- indicateurs : sauvegarde, connexion ---------- */
function majIndicateurs() {
  const chip = $("#indic-sauvegarde");
  const chauffeur = typeof modeChauffeurActif === "function" && modeChauffeurActif();
  if (chip) {
    if (!contientDonnees(S) || chauffeur) chip.hidden = true;
    else {
      const ds = S.meta.derniereSauvegarde;
      const j = ds ? -joursAvant(ds.slice(0, 10)) : null;
      const seuil = S.params.rappelSauvegarde;
      const niveau = j === null || j > 2 * seuil ? "danger" : j > seuil ? "warn" : "ok";
      chip.hidden = false;
      chip.className = `chip ${niveau}`;
      chip.innerHTML = `${ic("shield")}<span>${j === null ? "Jamais sauvegardé" : j === 0 ? "Sauvegardé aujourd'hui" : `Sauvegardé il y a ${j} j`}</span>`;
      chip.title = "Cliquer pour exporter maintenant";
    }
  }
  // pastille sur l'icône de l'application installée : nombre d'urgences
  try { const n = alertes().filter((a) => a.niveau === "danger").length; if (n) navigator.setAppBadge?.(n); else navigator.clearAppBadge?.(); } catch { /* non pris en charge */ }
}
function majConnexion() {
  const b = $("#hors-ligne");
  if (b) b.hidden = navigator.onLine;
  document.body.classList.toggle("hors-ligne", !navigator.onLine);
}
window.addEventListener("offline", majConnexion);
window.addEventListener("online", () => { majConnexion(); toast("Connexion rétablie"); });
document.addEventListener("click", (e) => { if (e.target.closest("#indic-sauvegarde")) exporterMaintenant(); });

/* ---------- mise à jour de l'application ---------- */
function proposerMiseAJour(worker) {
  if ($("#maj")) return;
  const b = document.createElement("div");
  b.id = "maj"; b.className = "maj";
  b.innerHTML = `<span>Une nouvelle version est disponible.</span><button class="btn sm" type="button">Mettre à jour</button><button class="icon-btn" type="button" aria-label="Plus tard">${ic("x")}</button>`;
  b.querySelector(".btn").onclick = () => { b.querySelector(".btn").textContent = "Mise à jour…"; worker.postMessage({ type: "SKIP_WAITING" }); };
  b.querySelector(".icon-btn").onclick = () => b.remove();
  document.body.append(b);
}
function enregistrerServiceWorker() {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
  navigator.serviceWorker.register("sw.js").then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) proposerMiseAJour(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) proposerMiseAJour(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 3600000); // cherche une nouvelle version chaque heure
  }).catch(() => {});
  // On ne recharge que pour une MISE À JOUR (un service worker contrôlait déjà la page) : pas à la toute première visite.
  const avaitUnControleur = !!navigator.serviceWorker.controller;
  let recharge = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (avaitUnControleur && !recharge) { recharge = true; location.reload(); } });
}

/* ---------- démarrage ---------- */
/** Les modules optionnels (rappels, mode chauffeur…) s'y accrochent. */
function demarrageModules() {
  if (typeof notifDemarrer === "function") notifDemarrer();
  if (typeof demarrageInstallation === "function") demarrageInstallation();
}

function retirerSplash() {
  const s = $("#splash");
  if (!s) return;
  s.classList.add("fin");
  setTimeout(() => s.remove(), 400);
}

async function demarrer() {
  try { appliquerTheme(localStorage.getItem("logistique-theme") || "auto"); } catch { /* ignoré */ }
  S = await chargerEtat();
  if (demarrage.sauverApres) sauver();
  if (typeof chauffeurAppliquerMode === "function") chauffeurAppliquerMode();
  majConnexion();
  enregistrerServiceWorker();
  const h = location.hash.slice(1);
  afficher(VUES[h] ? h : "tableau");
  retirerSplash();
  demarrage.notes.forEach((n) => toast(n, "ok"));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") miroirVider(); });
  window.addEventListener("pagehide", miroirVider);
  if (!S.meta.onboarde && !contientDonnees(S) && typeof demarrerAssistant === "function") demarrerAssistant();
  demarrageModules();
}

document.addEventListener("DOMContentLoaded", demarrer);
