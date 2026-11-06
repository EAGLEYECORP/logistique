"use strict";
/* ============================================================
   Rappels (notifications locales)
   Aucun serveur : l'application calcule elle-même ce qui est urgent (voir alertes() et notificationsAEnvoyer()
   dans noyau.js) et l'affiche via le service worker.
   - application ouverte : vérification au démarrage, chaque minute et au retour sur l'onglet ;
   - application fermée : « periodicsync » (Chrome/Android, application installée) via sw.js — selon le navigateur.
   Chaque alerte n'est rappelée qu'une fois par jour (urgent) ou tous les 3 jours (à surveiller).
   ============================================================ */

const notifSupportee = () => "Notification" in window && "serviceWorker" in navigator;
const notifPermission = () => ("Notification" in window ? Notification.permission : "indisponible");
const notifConfig = () => (S.meta.notif ||= { actif: false, cats: {} });

async function notifAfficher(item) {
  const options = { body: item.corps, tag: item.tag, icon: "icon-192.png", badge: "icon-192.png", data: { onglet: item.onglet }, lang: "fr" };
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) return await reg.showNotification(item.titre, options);
  } catch { /* repli ci-dessous */ }
  try { const n = new Notification(item.titre, options); n.onclick = () => { window.focus(); afficher(VUES[item.onglet] ? item.onglet : "tableau"); n.close(); }; } catch { /* non supporté */ }
}

let _notifEnCours = false;
/** Envoie les rappels dus. Renvoie le nombre de notifications affichées. */
async function notifVerifier() {
  const cfg = S.meta.notif;
  if (_notifEnCours || !cfg?.actif || notifPermission() !== "granted") return 0;
  if (typeof modeChauffeurActif === "function" && modeChauffeurActif()) return 0;
  _notifEnCours = true;
  try {
    const notifies = idbDisponible() ? await notifiesLire().catch(() => ({})) : {};
    const jour = today();
    const { items, cles } = notificationsAEnvoyer(alertes(), cfg, notifies, jour);
    for (const it of items) await notifAfficher(it);
    if (cles.length && idbDisponible()) {
      cles.forEach((k) => { notifies[k] = jour; });
      for (const k of Object.keys(notifies)) if (joursEntre(notifies[k], jour) > 30) delete notifies[k];
      await notifiesEcrire(notifies).catch(() => {});
    }
    return items.length;
  } finally { _notifEnCours = false; }
}

async function notifRegistrePeriodique(activer = true) {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.periodicSync) return false;
    if (!activer) { await reg.periodicSync.unregister("verifier-alertes"); return false; }
    const st = await navigator.permissions?.query({ name: "periodic-background-sync" }).catch(() => null);
    if (st && st.state !== "granted") return false;
    await reg.periodicSync.register("verifier-alertes", { minInterval: 12 * 3600 * 1000 });
    return true;
  } catch { return false; }
}
async function notifPeriodiqueActif() {
  try { const reg = await navigator.serviceWorker.ready; return reg.periodicSync ? (await reg.periodicSync.getTags()).includes("verifier-alertes") : false; } catch { return false; }
}

/** À appeler depuis un geste de l'utilisateur (clic) : demande l'autorisation puis active les rappels. */
async function notifActiver() {
  if (!notifSupportee()) { toast("Ce navigateur ne gère pas les notifications.", "warn"); return false; }
  if (Notification.permission === "denied") { toast("Notifications bloquées : autorisez-les dans les réglages du site (cadenas de la barre d'adresse).", "warn"); return false; }
  const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (p !== "granted") { toast("Autorisation refusée : les rappels restent désactivés.", "warn"); return false; }
  notifConfig().actif = true; sauver();
  const enFond = await notifRegistrePeriodique(true);
  toast(enFond ? "Rappels activés, même application fermée" : "Rappels activés");
  notifVerifier();
  return true;
}

function notifDemarrer() {
  navigator.serviceWorker?.addEventListener("message", (e) => { if (e.data?.type === "ouvrir") afficher(VUES[e.data.onglet] ? e.data.onglet : "tableau"); });
  setTimeout(notifVerifier, 2500);
  setInterval(notifVerifier, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") notifVerifier(); });
}

/* ---------- carte Réglages → Rappels ---------- */
enregistrerCarteReglages({
  onglet: "rappels", ordre: 10,
  rendu() {
    const cfg = notifConfig();
    const perm = notifPermission();
    const actif = cfg.actif && perm === "granted";
    const etat = !notifSupportee() ? badge("Non disponible", "neutral") : perm === "denied" ? badge("Bloqués par le navigateur", "danger") : actif ? badge("Activés", "ok") : badge("Désactivés", "neutral");
    const attente = alertes().filter((a) => a.cat !== "autre").length;
    return `<div class="card">
      <div class="card-head"><h2 class="row" style="gap:10px"><span class="ia-ico sm">${ic("bell")}</span>Rappels sur cet appareil</h2>${etat}</div>
      <p class="hint" style="margin-top:0">Soyez prévenu avant qu'un papier expire, qu'un chauffeur dépasse son temps de service, qu'une facture soit en retard ou qu'un chargement n'ait pas d'équipe. Tout est calculé sur l'appareil, sans serveur.</p>
      ${!notifSupportee() ? `<p class="hint">Ce navigateur ne gère pas les notifications. Sur iPhone, elles nécessitent iOS 16.4 ou plus et l'application installée sur l'écran d'accueil.</p>`
        : perm === "denied" ? `<p class="hint" style="color:var(--danger)">Les notifications sont bloquées. Autorisez-les dans les réglages du site (cadenas de la barre d'adresse), puis revenez ici.</p>` : ""}
      <div class="row" style="margin:12px 0">
        ${actif ? btn("notif-off", "Désactiver les rappels", { cls: "btn ghost" }) + btn("notif-test", "Envoyer un rappel test", { icone: "bell", cls: "btn ghost" }) + btn("notif-maintenant", `Vérifier maintenant (${attente})`, { cls: "btn ghost" })
          : btn("notif-on", "Activer les rappels", { icone: "bell" })}
      </div>
      ${actif ? `<form id="f-notif">
        <div class="section-title" style="margin-top:4px">Me prévenir pour</div>
        <div class="liste-options">${CATS_NOTIF.map(([k, lib, det]) => `<label class="check"><input type="checkbox" name="cat_${k}" ${cfg.cats[k] === false ? "" : "checked"}><span><strong>${esc(lib)}</strong><span class="sub">${esc(det)}</span></span></label>`).join("")}</div>
        <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn">Enregistrer</button></div>
      </form>
      <p class="hint" id="info-fond">Chargement…</p>` : ""}
      <p class="hint">Un rappel urgent est répété chaque jour, un point « à surveiller » tous les 3 jours. Appuyer sur une notification ouvre la page concernée.</p>
    </div>`;
  },
  async apres() {
    const z = $("#info-fond");
    if (!z) return;
    const fond = await notifPeriodiqueActif();
    if ($("#info-fond")) $("#info-fond").innerHTML = fond ? `${badge("Actif", "ok")} Rappels en arrière-plan : vous êtes prévenu même application fermée.`
      : `Rappels en arrière-plan indisponibles ici : les rappels s'affichent quand l'application est ouverte. Installez l'application sur Android (Chrome) pour être aussi prévenu application fermée.`;
  },
  soumettre(fid, v) {
    if (fid !== "f-notif") return false;
    const cfg = notifConfig();
    cfg.cats = Object.fromEntries(CATS_NOTIF.map(([k]) => [k, !!v[`cat_${k}`]]));
    sauver(); toast("Préférences de rappel enregistrées"); rafraichir();
    return true;
  },
  async agir(act) {
    if (act === "notif-on") { if (await notifActiver()) rafraichir(); return true; }
    if (act === "notif-off") { notifConfig().actif = false; sauver(); await notifRegistrePeriodique(false); toast("Rappels désactivés"); rafraichir(); return true; }
    if (act === "notif-test") {
      await notifAfficher({ titre: "Logistique Fret", corps: "Voici à quoi ressembleront vos rappels.", tag: "test", onglet: "tableau" });
      toast("Rappel test envoyé"); return true;
    }
    if (act === "notif-maintenant") {
      const n = await notifVerifier();
      toast(n ? `${n} rappel${n > 1 ? "s" : ""} envoyé${n > 1 ? "s" : ""}` : "Rien de nouveau à signaler (rappels déjà envoyés aujourd'hui)"); return true;
    }
    return false;
  },
});
