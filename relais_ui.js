"use strict";
/* ============================================================
   Réglages → Général → Relais : brancher l'application sur le relais, vérifier ce qui marche, préparer une installation.
   · adresse et jeton de lecture, « Enregistrer et tester » : joignable en https, jeton accepté, e-mail (factures, relances),
     notifications, prix du jour ;
   · « Préparer l'installation » : jetons et clé tirés au hasard sur cet appareil, fichier de configuration et commandes (Linux, Windows, Docker) ;
   · guide complet : docs/12-heberger-le-relais.md.
   ============================================================ */

const GUIDE_RELAIS = "https://github.com/EAGLEYECORP/logistique/blob/ccr-9838cb49-guapr6/docs/12-heberger-le-relais.md";
let etatRelais = null; // dernier test : { t, lignes: [{ ok, texte }] }
const jetonHasard = (n = 24) => { const b = crypto.getRandomValues(new Uint8Array(n)); return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };

/** Vérifie le relais : [{ ok, texte }]. */
async function testerRelais(base, jeton) {
  const l = [], ok = (b, t) => l.push({ ok: b, texte: t });
  if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(base)) ok(false, "L'adresse doit commencer par https:// (l'application est en https : le navigateur refuse un relais en http).");
  let sante = null; try { const r = await fetch(`${base}/sante`, { cache: "no-store" }); sante = r.ok ? await r.json() : null; } catch { /* injoignable */ }
  if (!sante) { ok(false, `Relais injoignable à ${base} : machine éteinte, adresse ou https à revoir.`); return l; }
  ok(true, `Relais joignable (version ${sante.version}).`);
  let e = null; try { const r = await fetch(`${base}/api/etat`, { headers: jeton ? { Authorization: `Bearer ${jeton}` } : {}, cache: "no-store", credentials: "same-origin" }); if (r.status === 401) { ok(false, "Jeton de lecture refusé : recopiez-le depuis la configuration du relais."); return l; } e = await r.json(); } catch { ok(false, "Le relais répond mais l'état n'est pas lisible."); return l; }
  ok(true, "Jeton accepté.");
  const can = e.notifications || [];
  ok(can.includes("email"), can.includes("email") ? "E-mail prêt : factures avec pièces jointes et relances automatiques." : "E-mail non configuré : ajoutez les lignes SMTP_… à la configuration du relais (guide, étape 7).");
  ok(can.some((c) => ["ntfy", "equipe", "whatsapp"].includes(c)) || can.includes("email"), `Notifications programmées : ${can.length ? can.join(", ") : "aucun canal"}${e.planifies !== undefined ? ` · ${e.planifies} message(s) en attente` : ""}.`);
  const bo = e.boite; ok(!!bo?.active && !bo.erreur, !bo?.active ? "Boîte des demandes non configurée : ajoutez les lignes IMAP_… pour recevoir ici les demandes envoyées par e-mail (Réglages → Général → Boîte des demandes)." : bo.erreur ? `Boîte des demandes : ${bo.erreur}` : `Boîte des demandes relevée (${bo.adresse}), en lecture seule.`);
  const iti = e.itineraire; ok(!!iti?.actif, iti?.actif ? `Itinéraire poids lourd : ${iti.source === "prive" ? "serveur openrouteservice du relais" : "service public openrouteservice (conditions à vérifier)"}, ${iti.calculsDuJour} calcul(s) aujourd'hui.` : "Itinéraire poids lourd non configuré : kilomètres estimés (Réglages → Général → Itinéraire poids lourd).");
  const maj = S.params.prixGasoilJour?.maj; ok(!!maj && Date.now() - maj < 2 * 86400000, maj ? `Prix du jour reçus le ${dateHeureFr(new Date(maj).toISOString())}.` : "Prix du jour pas encore reçus (taux Bank Al-Maghrib, gazole officiel) : ils arrivent à l'actualisation.");
  return l;
}
function carteRelais() {
  const multi = typeof multiActif === "function" && multiActif(), c = directCfg(), branche = c.mode === "relais" && c.url;
  const lignes = etatRelais ? `<ul class="relais-etat">${etatRelais.lignes.map((x) => `<li class="${x.ok ? "ok" : "ko"}">${ic(x.ok ? "check" : "alert")}<span>${esc(x.texte)}</span></li>`).join("")}</ul><p class="sub" style="margin:0">Testé le ${dateHeureFr(new Date(etatRelais.t).toISOString())}</p>` : "";
  return `<div class="card" id="carte-relais"><div class="card-head"><h2>Relais</h2>${multi ? badge("application servie par le relais", "ok") : branche ? badge("branché", "ok") : badge("non branché", "warn")}</div>
    <p style="margin-top:0">Le relais est le petit serveur gratuit qui envoie les factures par e-mail, programme les relances et les notifications, reçoit les balises GPS, sert le lien de suivi des clients et les prix du jour.</p>
    ${multi ? `<p class="hint">Mode multi-utilisateur : l'application est servie par le relais, rien à régler ici.</p>${btn("relais-tester", "Tester le relais", { icone: "check", cls: "btn ghost" })}` : `<form id="f-relais"><div class="form-grid">
      <label class="f">Adresse du relais<input name="url" type="url" placeholder="https://atlas-fret.duckdns.org" value="${esc(branche ? c.url : "")}"></label>
      <label class="f">Jeton de lecture<input name="jeton" type="password" autocomplete="off" value="${esc(branche ? c.jeton || "" : "")}"></label></div>
      <div class="row" style="justify-content:flex-end;margin-top:8px">${branche ? btn("relais-tester", "Tester", { cls: "btn ghost" }) : ""}<button class="btn">Enregistrer et tester</button></div></form>`}
    ${lignes}
    <div class="row" style="margin-top:10px">${btn("relais-preparer", "Préparer l'installation", { icone: "settings", cls: "btn ghost sm" })}<a class="btn ghost sm" href="${GUIDE_RELAIS}" target="_blank" rel="noopener">${ic("file")}Guide d'hébergement gratuit</a></div></div>`;
}
async function lancerTestRelais() {
  const multi = typeof multiActif === "function" && multiActif(), c = directCfg();
  const base = multi ? location.origin : baseUrl(c.url); if (!base) return toast("Saisissez l'adresse du relais.", "warn");
  toast("Test du relais…", "ok"); etatRelais = { t: Date.now(), lignes: await testerRelais(base, multi ? "" : c.jeton) };
  if (typeof capacitesRelais !== "undefined") capacitesRelais = { t: 0, canaux: [] }; // les canaux seront relus
  rafraichir();
}
async function preparerInstallation() {
  const je = jetonHasard(), jl = jetonHasard(), cle = jetonHasard(32);
  const env = `PORT=8787\nJETON_ECRITURE=${je}\nJETON_LECTURE=${jl}\nCHIFFRER_DONNEES=true\nCLE_DONNEES=${cle}\n# MULTI_UTILISATEUR=true\n# URL_PUBLIQUE=https://votre-nom.duckdns.org\n# SMTP_HOTE=smtp.gmail.com\n# SMTP_PORT=465\n# SMTP_SECURITE=tls\n# SMTP_UTILISATEUR=compta@votre-entreprise.ma\n# SMTP_MOT_DE_PASSE=mot-de-passe-d-application\n# SMTP_DE=compta@votre-entreprise.ma\n# IMAP_HOTE=imap.gmail.com\n# IMAP_UTILISATEUR=contact@votre-entreprise.ma\n# IMAP_MOT_DE_PASSE=mot-de-passe-d-application`;
  const linux = "git clone https://github.com/EAGLEYECORP/logistique.git && cd logistique\nsudo DOMAINE=votre-nom.duckdns.org bash serveur/installer.sh";
  await modale({ titre: "Préparer l'installation du relais", valider: "Fermer", annuler: "", corps: `
    <p style="margin-top:0">À faire sur la machine qui restera allumée (PC ou mini-PC du bureau). Le guide détaille chaque étape et les options sans IP publique.</p>
    <div class="section-title">Linux (Ubuntu, Debian, Raspberry Pi OS) : une commande</div>
    <textarea id="relais-linux" rows="2" readonly>${esc(linux)}</textarea>${btn("relais-copier", "Copier", { id: "relais-linux", cls: "btn ghost sm" })}
    <p class="hint">Le script tire lui-même les jetons et affiche le jeton de lecture à la fin.</p>
    <div class="section-title">Windows ou Docker : fichier relais.env</div>
    <textarea id="relais-env" rows="9" readonly>${esc(env)}</textarea>${btn("relais-copier", "Copier", { id: "relais-env", cls: "btn ghost sm" })}
    <p class="hint">Jetons et clé tirés au hasard sur cet appareil, jamais envoyés. Gardez ce fichier secret ; la clé CLE_DONNEES est indispensable pour relire les données chiffrées. Le jeton de lecture à saisir ici : <code>${esc(jl)}</code>.</p>` });
}
enregistrerCarteReglages({
  onglet: "general", ordre: 5, rendu: carteRelais,
  async agir(act) {
    if (act === "relais-tester") { await lancerTestRelais(); return true; }
    if (act === "relais-preparer") { await preparerInstallation(); return true; }
    return false;
  },
  soumettre(fid, v) {
    if (fid !== "f-relais") return false;
    const url = baseUrl(v.url); if (!url) { toast("Saisissez l'adresse du relais.", "warn"); return true; }
    directSauverCfg({ ...directCfg(), mode: "relais", url, jeton: String(v.jeton || "").trim() }); lancerTestRelais(); return true;
  },
});
// boutons « Copier » dans la fenêtre de préparation (les clics d'une fenêtre ne passent pas par le gestionnaire des pages)
document.addEventListener("click", async (e) => {
  const b = e.target.closest?.('dialog [data-act="relais-copier"]'); if (!b) return;
  const t = document.getElementById(b.dataset.id); if (!t) return;
  try { await navigator.clipboard.writeText(t.value); toast("Copié"); } catch { t.select(); toast("Sélectionné : copiez-le", "warn"); }
});
