"use strict";
/* ============================================================
   Boîte des demandes (interface) : page Commandes → Demandes.
   · les e-mails relevés par le relais (lecture seule de la boîte de l'entreprise, toutes les 5 minutes) arrivent ici,
     avec les messages partagés depuis WhatsApp (Android) et ceux collés sur cette page ;
   · chaque message est déjà lu : trajet, date, palettes, température, prix, client reconnu, doublon possible, ce qui manque ;
   · un geste : « Créer la commande », « Chiffrer et répondre » (commande à chiffrer puis devis), « Ignorer » ;
   · pièces jointes (relais 2.3) : lues, rangées sur la commande, documents reconnus cochés (pieces_demande_ui.js) ;
   · Réglages → Général → Boîte des demandes : état de la relève, lignes à ajouter au relais, partage depuis WhatsApp.
   Logique pure dans boite.js ; relève par le relais dans serveur/imap.js.
   ============================================================ */

let filtreDemandes = "a_trier";
let etatBoiteRelais = null; // dernier état renvoyé par le relais : { active, adresse, dossier, derniere, erreur, nombre }
let derniereMajDemandes = 0;
const relaisBoite = () => (typeof partageRelais === "function" ? partageRelais() : null);
const depuisQuand = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `le ${dateFr(new Date(t).toISOString().slice(0, 10))}`; };
const quandDemande = (iso) => { const d = new Date(iso); if (!Number.isFinite(d.getTime())) return ""; return jourDe(iso) === today() ? `aujourd'hui ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : d.toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };

/** Récupère les messages relevés par le relais depuis la dernière fois. Renvoie les demandes ajoutées (ou null sans relais). */
async function majDemandes({ silencieux = true } = {}) {
  if (!relaisBoite()) return null;
  derniereMajDemandes = Date.now();
  let r; try { r = await partageAppel("GET", `/api/demandes?depuis=${num(S.params.boiteDepuis, 0)}`); } catch (e) { if (!silencieux) toast(e.message, "danger"); return null; }
  etatBoiteRelais = r.boite || null;
  const recues = Array.isArray(r.demandes) ? r.demandes : [], n = ajouterDemandes(recues, "email");
  if (recues.length) { S.params.boiteDepuis = Math.max(num(S.params.boiteDepuis, 0), ...recues.map((d) => num(d.recu))); sauver(); }
  if (n.length && typeof rangerDemandesAuto === "function") await rangerDemandesAuto(); // e-mails d'un client qui citent sa commande : pièces rangées seules
  const utiles = n.filter((d) => !d.masse && d.statut === "a_trier").length;
  if (utiles) toast(`${utiles} nouvelle${utiles > 1 ? "s" : ""} demande${utiles > 1 ? "s" : ""} dans la boîte`, "ok");
  if ((n.length || ongletActif === "demandes") && ["demandes", "tableau", "parametres"].includes(ongletActif) && !document.querySelector("dialog[open]")) rafraichir();
  return n;
}
async function releverBoiteMaintenant() {
  if (!relaisBoite()) return toast("Branchez d'abord le relais (Réglages → Général → Relais).", "warn");
  try { const r = await partageAppel("POST", "/api/demandes/relever"); etatBoiteRelais = r.boite || etatBoiteRelais; }
  catch (e) { toast(e.message, "danger"); await majDemandes(); return; }
  const n = await majDemandes({ silencieux: false });
  if (n && !n.length) toast("Boîte relevée : aucun nouveau message.");
}
/** Au démarrage (appelé par boot.js) : message partagé vers l'application, puis relève régulière tant que l'application est ouverte. */
function boiteDemarrer() {
  const q = new URLSearchParams(location.search);
  if (q.has("partage")) {
    const d = demandeDepuisPartage({ titre: q.get("titre") || "", texte: q.get("texte") || "", lien: q.get("lien") || "" }), n = d ? ajouterDemandes([d], "whatsapp") : [];
    history.replaceState(null, "", location.pathname + "#demandes"); filtreDemandes = "a_trier";
    if (n.length) sauver();
    afficher("demandes"); toast(n.length ? "Message reçu dans la boîte des demandes" : d ? "Ce message est déjà dans la boîte" : "Rien à lire dans ce partage", n.length ? "ok" : "warn");
  }
  if (!relaisBoite()) return;
  setTimeout(() => majDemandes(), 2500);
  setInterval(() => { if (document.visibilityState === "visible") majDemandes(); }, 5 * 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - derniereMajDemandes > 2 * 60000) majDemandes(); });
}

/* ---------- page ---------- */
function ligneEtatBoite() {
  const e = etatBoiteRelais;
  if (!relaisBoite()) return `<p class="dem-etat">${ic("mail")}<span>Pour recevoir ici les e-mails de la boîte de l'entreprise, branchez le relais puis la boîte (Réglages → Général → Boîte des demandes). En attendant : « Coller un message », ou partagez un message vers l'application depuis votre téléphone Android.</span></p>`;
  if (!e) return `<p class="dem-etat">${ic("clock")}<span>Relais branché : état de la boîte e-mail en cours de lecture…</span></p>`;
  if (!e.active) return `<p class="dem-etat warn">${ic("alert")}<span>Le relais ne relève pas encore de boîte e-mail : ajoutez les lignes IMAP_… à sa configuration (Réglages → Général → Boîte des demandes).</span></p>`;
  if (e.erreur) return `<p class="dem-etat danger">${ic("alert")}<span><strong>Relève impossible</strong> (${esc(depuisQuand(e.derniere))}) : ${esc(e.erreur)}</span></p>`;
  return `<p class="dem-etat ok">${ic("check")}<span>Boîte ${esc(e.adresse)} relevée ${e.derniere ? esc(depuisQuand(e.derniere)) : "bientôt"} par le relais, en lecture seule : rien n'est marqué lu ni déplacé dans votre messagerie.</span></p>`;
}
function carteDemande(d) {
  const r = lectureDemande(d), resume = resumeDemande(r), suite = suiteDemande(r), traitee = d.statut !== "a_trier";
  const nom = d.de?.nom || d.de?.email || (d.source === "whatsapp" ? "Message partagé" : "Expéditeur inconnu"), c = d.commandeId ? parId(S.commandes, d.commandeId) : null;
  const puces = [
    r.champs.clientId ? badge(nomClient(r.champs.clientId), "ok") : r.client.email || r.client.tel ? badge("Nouveau client", "neutral") : "",
    r.doublon ? badge(`Ressemble à ${r.doublon.ref}`, "warn") : "",
    r.demandePrix ? badge("Demande un prix", "neutral") : "",
    !traitee && r.manquants.length ? `<span class="sub dem-manque">À compléter : ${esc(r.manquants.join(", "))}</span>` : "",
  ].filter(Boolean).join("");
  const extrait = String(d.texte || "").replace(/\s+/g, " ").trim(), court = extrait.length > 200 ? extrait.slice(0, 200).replace(/\s\S*$/, "") + "…" : extrait;
  const tel = r.client.tel && typeof telInternational === "function" ? telInternational(r.client.tel) : "";
  const repondre = d.de?.email ? `<a class="btn ghost sm" href="mailto:${esc(d.de.email)}?subject=${encodeURIComponent(/^re\s*:/i.test(d.sujet || "") ? d.sujet : `Re: ${d.sujet || "votre demande"}`)}">${ic("mail")}Répondre</a>` : tel ? `<a class="btn ghost sm" href="https://wa.me/${tel}" target="_blank" rel="noopener">WhatsApp</a>` : "";
  const boutons = traitee
    ? `${c ? btn("dem-voir", `Voir ${esc(c.ref)}`, { id: d.id, icone: "box", cls: "btn ghost sm" }) : ""}${btn("dem-retrier", "Remettre à trier", { id: d.id, cls: "btn ghost sm" })}`
    : `${suite === "chiffrer" ? btn("dem-chiffrer", "Chiffrer et répondre", { id: d.id, icone: "receipt", cls: "btn sm" }) + btn("dem-commande", "Créer la commande", { id: d.id, icone: "plus", cls: "btn ghost sm" }) : btn("dem-commande", "Créer la commande", { id: d.id, icone: "plus", cls: "btn sm" })}${repondre}${btn("dem-ignorer", "Ignorer", { id: d.id, cls: "btn ghost sm" })}`;
  return `<article class="card demande ${d.statut}${d.masse ? " masse" : ""}" data-demande="${esc(d.id)}">
    <div class="dem-tete"><span class="dem-source" title="${esc(SOURCES_DEMANDE[d.source] || d.source)}">${ic(d.source === "whatsapp" ? "phone" : d.source === "collee" ? "file" : "mail")}</span>
      <div class="dem-qui"><strong>${esc(nom)}</strong><span class="sub">${[d.de?.nom && d.de?.email ? d.de.email : "", quandDemande(d.date)].filter(Boolean).map(esc).join(" · ")}</span></div>
      ${traitee ? badge(libDe(STATUTS_DEMANDE, d.statut), d.statut === "ignoree" ? "neutral" : "ok") : ""}</div>
    ${d.sujet ? `<div class="dem-sujet">${esc(d.sujet)}</div>` : ""}
    <div class="dem-lu ${resume ? "" : "vide"}">${ic("route")}<span>${resume ? esc(resume) : "Aucun trajet reconnu dans ce message"}</span></div>
    ${puces ? `<div class="dem-puces">${puces}</div>` : ""}
    ${extrait ? `<details class="dem-texte"><summary>${esc(court)}</summary><div class="dem-complet">${esc(d.texte)}</div></details>` : ""}
    ${d.pieces?.length ? (typeof blocPiecesDemande === "function" ? blocPiecesDemande(d) : `<p class="sub dem-pieces">${ic("file")}${d.pieces.map((p) => esc(p.nom)).join(" · ")} <span>(pièces jointes restées dans la messagerie)</span></p>`) : ""}
    <div class="row">${boutons}</div></article>`;
}
const FILTRES_DEMANDES = [["a_trier", "À trier"], ["traitees", "Traitées"], ["ignoree", "Ignorées"], ["masse", "Autres"], ["tout", "Tout"]];
function demandesDuFiltre(f) {
  const l = S.demandes || [];
  if (f === "a_trier") return l.filter((d) => d.statut === "a_trier" && !d.masse);
  if (f === "traitees") return l.filter((d) => ["commande", "devis", "rangee"].includes(d.statut));
  if (f === "ignoree") return l.filter((d) => d.statut === "ignoree");
  if (f === "masse") return l.filter((d) => d.masse && d.statut === "a_trier");
  return l;
}
VUES.demandes = {
  titre: "Demandes",
  sous: "E-mails et messages WhatsApp à transformer en commandes",
  actions: () => `${relaisBoite() ? btn("relever", "Relever la boîte", { icone: "mail", cls: "btn ghost" }) : ""}${btn("coller-boite", "Coller un message", { icone: "file", cls: "btn ghost" })}`,
  rendu() {
    let liste = demandesDuFiltre(filtreDemandes);
    if (filtreDemandes === "a_trier") { const p = new Map(liste.map((d) => [d.id, pertinenceDemande(d)])); liste = [...liste].sort((a, b) => (p.get(b.id) >= 3) - (p.get(a.id) >= 3) || String(b.date).localeCompare(String(a.date))); }
    const filtres = `<div class="segmented">${FILTRES_DEMANDES.map(([k, l]) => { const n = demandesDuFiltre(k).length; return `<button type="button" data-act="dem-filtre" data-id="${k}" aria-selected="${k === filtreDemandes}">${l}${n && k !== "tout" ? `<span>${n}</span>` : ""}</button>`; }).join("")}</div>`;
    const videTexte = { a_trier: ["Aucune demande à trier", "Les e-mails de la boîte de l'entreprise et les messages partagés depuis WhatsApp arrivent ici, déjà lus : trajet, date, palettes, température, prix et client."], traitees: ["Aucune demande traitée", "Les demandes devenues commandes ou devis se retrouvent ici."], ignoree: ["Aucune demande ignorée", ""], masse: ["Rien d'autre", "Lettres d'information et listes de diffusion, mises à part."], tout: ["Boîte vide", ""] }[filtreDemandes];
    return `${ligneEtatBoite()}${filtres}${liste.length ? liste.slice(0, 120).map(carteDemande).join("") : `<div class="card">${vide("mail", videTexte[0], videTexte[1], filtreDemandes === "a_trier" ? btn("coller-boite", "Coller un message", { icone: "file" }) : "")}</div>`}
      ${liste.length > 120 ? `<p class="hint">${liste.length - 120} demande(s) plus ancienne(s) non affichée(s).</p>` : ""}`;
  },
  async agir(act, id) {
    if (act === "dem-filtre") { filtreDemandes = id; return rafraichir(); }
    if (act === "relever") return releverBoiteMaintenant();
    if (act === "coller-boite") {
      const f = await modale({ titre: "Coller un message dans la boîte", valider: "Ajouter à la boîte", corps: `<label class="f full">Message reçu (e-mail, WhatsApp, SMS), en-tête compris si possible<textarea name="message" rows="10" required></textarea></label><p class="hint">Lu sur cet appareil : rien n'est envoyé.</p>` });
      const t = String(f?.message || "").trim(); if (!t) return;
      const de = t.match(/^(?:de|from)\s*:\s*(.+)$/im)?.[1] || "", email = (de.match(/[^\s<>,;"]+@[^\s<>,;"]+/) || [""])[0].toLowerCase();
      const corps = t.replace(/^(?:(?:de|from|à|a|to|objet|subject|date|envoyé|sent|cc)\s*:.*(?:\r?\n|$))+/i, "").trim() || t; // l'en-tête collé devient l'expéditeur et le sujet
      const n = ajouterDemandes([{ de: { nom: de.replace(/<[^>]*>/, "").replace(/"/g, "").trim(), email }, sujet: t.match(/^(?:objet|subject)\s*:\s*(.+)$/im)?.[1] || "", texte: corps }], "collee");
      filtreDemandes = "a_trier"; sauver(); toast(n.length ? "Message ajouté à la boîte" : "Ce message est déjà dans la boîte", n.length ? "ok" : "warn"); return rafraichir();
    }
    const d = (S.demandes || []).find((x) => x.id === id); if (!d) return;
    if (act === "dem-commande" || act === "dem-chiffrer") {
      const c = await commandeDepuisMessage(texteDemande(d), { aujourdhui: jourDe(d.date) || today(), recuLe: jourDe(d.date) || today() }); if (!c) return;
      classerDemande(d, c.statut === "devis" ? "devis" : "commande", { commandeId: c.id }); sauver();
      if (typeof rangerPiecesDemande === "function" && piecesARanger(d).length) { const r = await rangerPiecesDemande(d, c); if (r.ranges.length) toast(bilanRangement(c, r), "ok"); if (r.erreurs.length) toast(r.erreurs[0], "warn"); }
      rafraichir();
      if (act === "dem-chiffrer" && c.statut === "devis" && typeof chiffrerCommande === "function") await chiffrerCommande(c);
      return;
    }
    if (act === "dem-ignorer") { classerDemande(d, "ignoree"); sauver(); toast("Demande ignorée"); return rafraichir(); }
    if (act === "dem-retrier") { classerDemande(d, "a_trier"); sauver(); toast("Demande remise à trier"); return rafraichir(); }
    if (act === "dem-voir") { const c = parId(S.commandes, d.commandeId); if (!c) return toast("Cette commande n'existe plus.", "warn"); if (typeof filtreCmd !== "undefined") filtreCmd = c.statut === "devis" ? "chiffrer" : "actives"; return afficher("commandes"); }
  },
};

COMPTES_ONGLETS.demandes = () => demandesATrier().length;

/* ---------- réglages ---------- */
enregistrerCarteReglages({
  onglet: "general", ordre: 12,
  rendu: () => `<div class="card" id="carte-boite"><div class="card-head"><h2>Boîte des demandes</h2>${etatBoiteRelais?.active ? badge(etatBoiteRelais.erreur ? "Erreur de relève" : "Relevée", etatBoiteRelais.erreur ? "danger" : "ok") : badge(relaisBoite() ? "Boîte non configurée" : "Relais non branché", "neutral")}</div>
    ${ligneEtatBoite()}
    <p style="margin:0 0 8px">Le relais relit la boîte e-mail de l'entreprise toutes les 5 minutes, <strong>en lecture seule</strong>, et l'application montre chaque message déjà lu. Lignes à ajouter à la configuration du relais (<code>relais.env</code>), puis redémarrer le relais :</p>
    <pre class="bloc-code">IMAP_HOTE=imap.gmail.com
IMAP_UTILISATEUR=contact@votre-domaine.ma
IMAP_MOT_DE_PASSE=mot-de-passe-d-application
# IMAP_DOSSIER=INBOX   IMAP_INTERVALLE_MIN=5</pre>
    <p class="hint">Gmail : <code>imap.gmail.com</code>, IMAP activé et un mot de passe d'application (validation en deux étapes requise). Boîte chez l'hébergeur du site : l'adresse IMAP est dans son espace client (par exemple <code>ssl0.ovh.net</code> chez OVH, <code>imap.hostinger.com</code> chez Hostinger, <code>imap.zoho.eu</code> chez Zoho) — à vérifier chez le vôtre. Microsoft (Outlook, Microsoft 365) exige de plus en plus une connexion moderne que le relais ne fait pas : transférez alors les demandes vers une autre boîte. Le mot de passe reste sur le relais, jamais dans l'application.</p>
    <p class="hint"><strong>Depuis WhatsApp (Android)</strong> : une fois l'application installée sur l'écran d'accueil, elle apparaît dans le menu « Partager » ; si WhatsApp propose « Partager » pour le message, choisissez Logistique Fret. Sinon, ou sur iPhone (le partage vers une application web n'y existe pas) : copiez le message, puis Commandes → Demandes → « Coller un message ».</p>
    ${relaisBoite() ? `<div class="row" style="justify-content:flex-end;margin-top:8px">${btn("relever-boite", "Relever maintenant", { icone: "mail", cls: "btn ghost" })}</div>` : ""}</div>`,
  async agir(act) { if (act !== "relever-boite") return false; await releverBoiteMaintenant(); rafraichir(); return true; },
  apres() { if (relaisBoite() && !etatBoiteRelais && Date.now() - derniereMajDemandes > 30000) majDemandes(); },
});
