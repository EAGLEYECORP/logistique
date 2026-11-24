"use strict";
/* ============================================================
   Relève d'une boîte e-mail par IMAP, sans dépendance (modules net et tls de Node).
   · lecture seule : le dossier est ouvert par EXAMINE et les messages lus par BODY.PEEK — rien n'est marqué « lu », rien n'est déplacé ;
   · première relève : les messages des derniers jours ; ensuite seulement les nouveaux (numéro UID au-delà du dernier vu) ;
   · chaque message est lu jusqu'à 300 Ko ; au-delà (pièces jointes), il est relu en entier, un à la fois, jusqu'à maxComplet
     octets par message et maxCompletTotal par relève — sinon il reste coupé et seuls les noms des pièces jointes restent lisibles.
   Fournisseurs : la boîte de l'entreprise chez l'hébergeur (OVH, Hostinger, Zoho…), ou Gmail avec IMAP activé et un mot de passe d'application.
   ============================================================ */
const net = require("net");
const tls = require("tls");

const MOIS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateImap = (d) => `${d.getUTCDate()}-${MOIS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
/** Chaîne IMAP entre guillemets ; refuse ce que le protocole ne permet pas sans « littéral ». */
function quoter(s) {
  const t = String(s ?? "");
  if (/[\r\n\0]/.test(t) || /[^\x20-\x7e]/.test(t)) throw new Error("Identifiant ou mot de passe avec des caractères non pris en charge (accents, retours à la ligne) : utilisez un mot de passe d'application.");
  return `"${t.replace(/[\\"]/g, "\\$&")}"`;
}

/** Session sur une connexion ouverte : accueil(), commande(texte) → { statut, texte, reponses: [{ texte, litteraux: [Buffer] }] }. */
function creerSession(socket, delaiMs) {
  let tampon = Buffer.alloc(0), courant = { texte: "", litteraux: [] }, besoin = -1, reponses = [], attente = { tag: "*" }, n = 0, erreur = null;
  const pret = new Promise((ok, ko) => Object.assign(attente, { ok, ko }));
  const finir = (e) => { if (!erreur) erreur = e; if (attente?.ko) { const a = attente; attente = null; a.ko(erreur); } };
  socket.on("data", (d) => { tampon = Buffer.concat([tampon, d]); try { pomper(); } catch (e) { finir(e); socket.destroy(); } });
  socket.on("error", (e) => finir(new Error(`Boîte e-mail injoignable : ${e.code || e.message}`)));
  socket.on("close", () => finir(new Error("Connexion fermée par le serveur de la boîte.")));
  socket.setTimeout(delaiMs, () => { finir(new Error("La boîte e-mail ne répond pas (délai dépassé).")); socket.destroy(); });
  function pomper() {
    for (;;) {
      if (besoin >= 0) { if (tampon.length < besoin) return; courant.litteraux.push(Buffer.from(tampon.subarray(0, besoin))); tampon = tampon.subarray(besoin); besoin = -1; continue; }
      const i = tampon.indexOf("\r\n");
      if (i < 0) { if (tampon.length > 1e6) throw new Error("Réponse illisible du serveur de la boîte."); return; }
      const l = tampon.subarray(0, i).toString("latin1"); tampon = tampon.subarray(i + 2); courant.texte += l;
      const m = l.match(/\{(\d+)\}$/);
      if (m) { besoin = Number(m[1]); if (besoin > 40e6) throw new Error("Message trop volumineux."); continue; }
      const ligne = courant; courant = { texte: "", litteraux: [] };
      const fin = attente && (attente.tag === "*" ? ligne.texte.startsWith("* ") : ligne.texte.startsWith(attente.tag + " "));
      if (!fin) { reponses.push(ligne); continue; }
      const a = attente; attente = null;
      const statut = ((a.tag === "*" ? ligne.texte.slice(2) : ligne.texte.slice(a.tag.length + 1)).match(/^(OK|NO|BAD|PREAUTH|BYE)\b/i)?.[1] || "BAD").toUpperCase();
      a.ok({ statut, texte: ligne.texte, reponses }); reponses = [];
    }
  }
  return {
    accueil: () => pret,
    commande(cmd) {
      if (erreur) return Promise.reject(erreur);
      const tag = `L${++n}`;
      return new Promise((ok, ko) => { attente = { tag, ok, ko }; socket.write(`${tag} ${cmd}\r\n`); });
    },
  };
}

/**
 * Relève les messages nouveaux d'un dossier.
 * → { uidValidite, dernierUid, messages: [{ uid, brut (Buffer), taille, tronque }], laisses (trop anciens au-delà de max) }.
 * depuisUid / uidValidite : ce qui a été vu à la relève précédente (UIDVALIDITY changé ⇒ on repart des derniers jours).
 */
async function releverBoite({ hote, port, securite = "tls", utilisateur, motDePasse, dossier = "INBOX", depuisUid = 0, uidValidite = 0, joursInitiaux = 3, max = 25, maxOctets = 300000, maxComplet = 0, maxCompletTotal = 60e6, delaiMs = 30000, maintenant = Date.now(), connecter = null }) {
  if (!hote || !utilisateur) throw new Error("Boîte e-mail non configurée (IMAP_HOTE, IMAP_UTILISATEUR, IMAP_MOT_DE_PASSE).");
  const socket = connecter ? connecter() : securite === "aucune" ? net.connect({ host: hote, port: port || 143 }) : tls.connect({ host: hote, port: port || 993, servername: hote });
  const s = creerSession(socket, delaiMs);
  try {
    const acc = await s.accueil();
    if (!["OK", "PREAUTH"].includes(acc.statut)) throw new Error(`Le serveur de la boîte refuse la connexion : ${acc.texte.slice(0, 120)}`);
    if (acc.statut !== "PREAUTH") {
      const r = await s.commande(`LOGIN ${quoter(utilisateur)} ${quoter(motDePasse)}`);
      if (r.statut !== "OK") throw new Error(`Connexion refusée par la boîte (${r.texte.replace(/^\S+\s+(NO|BAD)\s*/i, "").slice(0, 160) || r.statut}). Vérifiez l'adresse, le mot de passe d'application et qu'IMAP est activé.`);
    }
    const sel = await s.commande(`EXAMINE ${quoter(dossier)}`);
    if (sel.statut !== "OK") throw new Error(`Dossier « ${dossier} » introuvable dans la boîte.`);
    const uv = Number((sel.reponses.map((x) => x.texte).join("\n").match(/UIDVALIDITY (\d+)/i) || [])[1] || 0);
    const repartir = !depuisUid || uv !== Number(uidValidite);
    const rs = await s.commande(`UID SEARCH ${repartir ? `SINCE ${dateImap(new Date(maintenant - joursInitiaux * 86400000))}` : `UID ${depuisUid + 1}:*`}`);
    if (rs.statut !== "OK") throw new Error("Recherche refusée par la boîte.");
    const uids = [...new Set(rs.reponses.filter((x) => /^\* SEARCH\b/i.test(x.texte)).flatMap((x) => x.texte.replace(/^\* SEARCH/i, "").trim().split(/\s+/)).map(Number))]
      .filter((u) => Number.isInteger(u) && u > 0 && (repartir || u > depuisUid)).sort((a, b) => a - b);
    const choisis = uids.slice(-max), messages = [];
    if (choisis.length) {
      const rf = await s.commande(`UID FETCH ${choisis.join(",")} (UID RFC822.SIZE BODY.PEEK[]<0.${maxOctets}>)`);
      if (rf.statut !== "OK") throw new Error("Lecture des messages refusée par la boîte.");
      for (const x of rf.reponses) {
        const u = x.texte.match(/^\* \d+ FETCH\b.*?\bUID (\d+)/i); if (!u || !x.litteraux.length) continue;
        const taille = Number(x.texte.match(/RFC822\.SIZE (\d+)/i)?.[1] || 0);
        messages.push({ uid: Number(u[1]), brut: x.litteraux[x.litteraux.length - 1], taille, tronque: taille > maxOctets });
      }
      // messages coupés (pièces jointes) : relus en entier, un à la fois, dans la limite fixée
      let budget = maxCompletTotal;
      for (const m of messages) {
        if (!m.tronque || !maxComplet || m.taille > maxComplet || m.taille > budget) continue;
        const rc = await s.commande(`UID FETCH ${m.uid} (UID RFC822.SIZE BODY.PEEK[])`);
        const x = rc.statut === "OK" ? rc.reponses.find((y) => new RegExp(`^\\* \\d+ FETCH\\b.*?\\bUID ${m.uid}\\b`, "i").test(y.texte) && y.litteraux.length) : null;
        if (x) { m.brut = x.litteraux[x.litteraux.length - 1]; m.tronque = false; budget -= m.taille; }
      }
    }
    s.commande("LOGOUT").catch(() => { /* fermeture */ });
    return { uidValidite: uv, dernierUid: Math.max(repartir ? 0 : depuisUid, ...uids, 0), messages: messages.sort((a, b) => a.uid - b.uid), laisses: uids.length - choisis.length };
  } finally { setTimeout(() => socket.destroy(), 300).unref?.(); }
}

module.exports = { releverBoite, creerSession, dateImap, quoter };
