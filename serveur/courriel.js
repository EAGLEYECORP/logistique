"use strict";
/* ============================================================
   Envoi d'e-mails par SMTP, sans dépendance (modules net et tls de Node).
   Sécurité : « tls » (port 465), « starttls » (port 587) ou « aucune » (serveur local, essais).
   Message en texte et en HTML (multipart/alternative, UTF-8, base64). Aucun en-tête n'accepte de retour à la ligne.
   Fournisseurs gratuits possibles : la boîte de l'entreprise, ou Gmail avec un mot de passe d'application (environ 500 messages par jour).
   ============================================================ */
const net = require("net");
const tls = require("tls");
const crypto = require("crypto");
const os = require("os");

const ADRESSE = /^[^\s@<>,;"\r\n]+@[^\s@<>,;"\r\n]+\.[A-Za-z]{2,}$/;
const adresseValide = (a) => typeof a === "string" && ADRESSE.test(a.trim());
/** Mot d'en-tête encodé (RFC 2047) si le texte n'est pas en ASCII simple. */
const motEntete = (s) => { const t = String(s ?? "").replace(/[\r\n]+/g, " ").slice(0, 300); return /^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${Buffer.from(t, "utf8").toString("base64")}?=`; };
const base64Lignes = (s) => Buffer.from(String(s), "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
const echapper = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const enHtml = (texte) => `<!doctype html><html><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1d1d1f">${echapper(texte).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>")}</body></html>`;

/** Message complet prêt à envoyer (en-têtes + corps). */
function composer({ de, a, sujet, texte, html = null, date = new Date() }) {
  const destinataires = (Array.isArray(a) ? a : [a]).map((x) => String(x).trim());
  if (!adresseValide(de) || !destinataires.length || !destinataires.every(adresseValide)) throw new Error("Adresse e-mail invalide.");
  const frontiere = `=_lf_${crypto.randomBytes(12).toString("hex")}`, id = `<${crypto.randomBytes(12).toString("hex")}@${de.split("@")[1]}>`;
  return [
    `From: ${de}`, `To: ${destinataires.join(", ")}`, `Subject: ${motEntete(sujet)}`, `Date: ${date.toUTCString().replace("GMT", "+0000")}`, `Message-ID: ${id}`, "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${frontiere}"`, "", `--${frontiere}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lignes(texte),
    `--${frontiere}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lignes(html || enHtml(texte)), `--${frontiere}--`, "",
  ].join("\r\n");
}

/**
 * Envoie un e-mail. cfg : { hote, port, securite: "tls" | "starttls" | "aucune", utilisateur, motDePasse, de, rejeterNonAutorise = true }.
 * msg : { a (adresse ou liste), sujet, texte, html? }. Renvoie { ok: true, reponse } ou lève une erreur lisible.
 */
function envoyerCourriel(cfg, msg, { delai = 20000 } = {}) {
  const port = Number(cfg.port) || (cfg.securite === "tls" ? 465 : 587), securite = cfg.securite || (port === 465 ? "tls" : "starttls");
  const donnees = composer({ de: cfg.de, a: msg.a, sujet: msg.sujet, texte: msg.texte, html: msg.html });
  const destinataires = (Array.isArray(msg.a) ? msg.a : [msg.a]).map((x) => String(x).trim());
  return new Promise((ok, ko) => {
    let socket, tampon = "", attente = null, fini = false;
    const terminer = (err, val) => { if (fini) return; fini = true; clearTimeout(minuteur); try { socket?.end(); } catch { /* fermé */ } err ? ko(err) : ok(val); };
    const minuteur = setTimeout(() => terminer(new Error("Serveur SMTP : délai dépassé.")), delai);
    const brancher = (s) => { socket = s; s.setEncoding("utf8"); s.on("data", lire); s.on("error", (e) => terminer(new Error(`Serveur SMTP : ${e.message}`))); s.on("close", () => terminer(new Error("Serveur SMTP : connexion fermée."))); };
    // une réponse = une ou plusieurs lignes « 250-… » terminées par « 250 … »
    function lire(morceau) {
      tampon += morceau; let i;
      while ((i = tampon.indexOf("\r\n")) >= 0 || (i = tampon.indexOf("\n")) >= 0) {
        const ligne = tampon.slice(0, i); tampon = tampon.slice(i + (tampon[i] === "\r" ? 2 : 1));
        (lire.lignes ||= []).push(ligne);
        if (/^\d{3} /.test(ligne) || /^\d{3}$/.test(ligne)) { const r = { code: Number(ligne.slice(0, 3)), texte: lire.lignes.join("\n") }; lire.lignes = []; const a = attente; attente = null; a?.(r); }
      }
    }
    const reponse = () => new Promise((r) => { attente = r; });
    const commande = async (texte, attendus, masque = null) => { socket.write(texte + "\r\n"); const r = await reponse(); if (!attendus.includes(r.code)) throw new Error(`Serveur SMTP : ${masque || texte.split(" ")[0]} refusé (${r.texte.slice(0, 200)})`); return r; };
    const dialogue = async () => {
      let r = await reponse(); if (r.code !== 220) throw new Error(`Serveur SMTP : accueil inattendu (${r.texte.slice(0, 120)})`);
      const nom = os.hostname().replace(/[^A-Za-z0-9.-]/g, "") || "relais";
      r = await commande(`EHLO ${nom}`, [250]);
      if (securite === "starttls") {
        if (!/STARTTLS/i.test(r.texte)) throw new Error("Serveur SMTP : STARTTLS non proposé.");
        await commande("STARTTLS", [220]);
        const brut = socket; brut.removeAllListeners("data"); brut.removeAllListeners("close"); brut.removeAllListeners("error");
        await new Promise((fin, err) => { const t = tls.connect({ socket: brut, servername: cfg.hote, rejectUnauthorized: cfg.rejeterNonAutorise !== false }, fin); t.once("error", err); brancher(t); });
        await commande(`EHLO ${nom}`, [250]);
      }
      if (cfg.utilisateur) {
        await commande("AUTH LOGIN", [334]);
        await commande(Buffer.from(cfg.utilisateur).toString("base64"), [334], "identifiant");
        await commande(Buffer.from(cfg.motDePasse || "").toString("base64"), [235], "mot de passe");
      }
      await commande(`MAIL FROM:<${cfg.de}>`, [250]);
      for (const a of destinataires) await commande(`RCPT TO:<${a}>`, [250, 251]);
      await commande("DATA", [354]);
      socket.write(donnees.replace(/\r\n\./g, "\r\n..") + "\r\n.\r\n"); // une ligne commençant par un point est doublée
      r = await reponse(); if (r.code !== 250) throw new Error(`Serveur SMTP : message refusé (${r.texte.slice(0, 200)})`);
      socket.write("QUIT\r\n");
      await Promise.race([reponse(), new Promise((fin) => setTimeout(fin, 2000))]); // au revoir du serveur (facultatif : le message est déjà accepté)
      return { ok: true, reponse: r.texte.slice(0, 200) };
    };
    try {
      if (securite === "tls") brancher(tls.connect({ host: cfg.hote, port, servername: cfg.hote, rejectUnauthorized: cfg.rejeterNonAutorise !== false }));
      else brancher(net.connect({ host: cfg.hote, port }));
    } catch (e) { return terminer(new Error(`Serveur SMTP : ${e.message}`)); }
    dialogue().then((v) => terminer(null, v), (e) => terminer(e));
  });
}

module.exports = { envoyerCourriel, composer, adresseValide, motEntete };
