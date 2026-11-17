"use strict";
/* ============================================================
   Lecture d'un e-mail brut (RFC 5322 / MIME), sans dépendance : expéditeur, sujet, date, texte, noms des pièces jointes.
   · en-têtes repliés, mots encodés (=?utf-8?B?…?=, =?iso-8859-1?Q?…?=) ;
   · parties multiples (mixed, alternative, related), texte brut préféré, sinon HTML converti en texte ;
   · base64, quoted-printable, jeux de caractères utf-8, iso-8859-1, windows-1252… ;
   · l'historique cité d'une réponse (« Le … a écrit : », « De : … Envoyé : … », lignes « > ») est coupé :
     la lecture de la demande ne doit pas reprendre les villes ou les prix d'un ancien message.
   Les pièces jointes ne sont pas gardées : leur nom seulement.
   ============================================================ */

const enLatin1 = (b) => (Buffer.isBuffer(b) ? b.toString("latin1") : String(b));
const ALIAS = { "iso-8859-1": "latin1", "us-ascii": "utf-8", ascii: "utf-8", "iso8859-1": "latin1", latin1: "latin1", "x-unknown": "utf-8", unknown: "utf-8", "utf8": "utf-8" };
/** Octets (chaîne « latin1 » ou Buffer) → texte, selon le jeu de caractères annoncé. */
function decoderOctets(octets, charset = "utf-8") {
  const b = Buffer.isBuffer(octets) ? octets : Buffer.from(String(octets), "latin1");
  const cs = String(charset || "utf-8").toLowerCase().replace(/^"|"$/g, "").trim(), nom = ALIAS[cs] || cs;
  if (nom === "latin1") return b.toString("latin1");
  try { return new TextDecoder(nom, { fatal: false }).decode(b); } catch { /* jeu inconnu */ }
  try { return new TextDecoder("utf-8").decode(b); } catch { return b.toString("latin1"); }
}
/** Quoted-printable → octets (chaîne latin1). */
const decoderQP = (s, entete = false) => (entete ? s.replace(/_/g, " ") : s).replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
/** Mots encodés d'un en-tête (RFC 2047) ; deux mots encodés voisins se collent sans espace. */
function decoderEntete(v) {
  return String(v || "").replace(/(=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[BbQq]\?)/g, "$1")
    .replace(/=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g, (_, cs, enc, t) => decoderOctets(enc.toUpperCase() === "B" ? Buffer.from(t, "base64") : Buffer.from(decoderQP(t, true), "latin1"), cs.split("*")[0]))
    .replace(/\s+/g, " ").trim();
}
/** En-têtes et corps : { entetes: Map(nom minuscule → [valeurs]), corps (chaîne latin1) }. */
function separer(brut) {
  const s = enLatin1(brut), m = s.match(/\r?\n\r?\n/), i = m ? m.index : s.length;
  const tete = s.slice(0, i).replace(/\r?\n[ \t]+/g, " "), corps = m ? s.slice(i + m[0].length) : "";
  const entetes = new Map();
  for (const l of tete.split(/\r?\n/)) { const j = l.indexOf(":"); if (j <= 0) continue; const k = l.slice(0, j).trim().toLowerCase(); (entetes.get(k) || entetes.set(k, []).get(k)).push(l.slice(j + 1).trim()); }
  return { entetes, corps };
}
const entete = (e, k) => (e.get(k) || [])[0] || "";
/** « type/sous-type; a=b; c="d" » → { valeur, params } (paramètres RFC 2231 « nom*=utf-8''… » compris). */
function lireParametres(v) {
  const parts = String(v || "").match(/(?:[^;"]+|"(?:[^"\\]|\\.)*")+/g) || [""], params = {}, suites = {};
  for (const p of parts.slice(1)) {
    const j = p.indexOf("="); if (j < 0) continue;
    let k = p.slice(0, j).trim().toLowerCase(), val = p.slice(j + 1).trim().replace(/^"|"$/g, "").replace(/\\(.)/g, "$1");
    const m = k.match(/^([^*]+)\*(\d+)?(\*)?$/);
    if (m) { const enc = m[3] || (!m[2] && k.endsWith("*")); (suites[m[1]] ||= []).push({ n: Number(m[2] || 0), val, enc }); continue; }
    params[k] = val;
  }
  for (const [k, l] of Object.entries(suites)) {
    l.sort((a, b) => a.n - b.n); let cs = "utf-8";
    params[k] = l.map((x, i) => { let t = x.val; if (x.enc) { if (i === 0 && /^[^']*'[^']*'/.test(t)) { cs = t.split("'")[0] || "utf-8"; t = t.replace(/^[^']*'[^']*'/, ""); } return decoderOctets(Buffer.from(t.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1"), cs); } return t; }).join("");
  }
  return { valeur: parts[0].trim().toLowerCase(), params };
}
/** Corps d'une partie décodé en octets (latin1) selon Content-Transfer-Encoding. */
function decoderCorps(corps, cte) {
  const e = String(cte || "").toLowerCase().trim();
  if (e === "base64") return Buffer.from(corps.replace(/[^A-Za-z0-9+/=]/g, ""), "base64").toString("latin1");
  if (e === "quoted-printable") return decoderQP(corps);
  return corps;
}
const ENTITES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç", ocirc: "ô", ucirc: "û", ugrave: "ù", icirc: "î", iuml: "ï", euml: "ë", deg: "°", euro: "€", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", hellip: "…", ndash: "–", mdash: "—", Eacute: "É", Agrave: "À", Egrave: "È", Ccedil: "Ç", aacute: "á", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", ouml: "ö", auml: "ä", szlig: "ß", iexcl: "¡", iquest: "¿", ordm: "º", ordf: "ª", middot: "·", bull: "•", times: "×", copy: "©", reg: "®", atilde: "ã", otilde: "õ" };
/** HTML → texte lisible (paragraphes et lignes gardés, scripts et styles retirés). */
function htmlEnTexte(h) {
  return String(h).replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, "\n").replace(/<(td|th)[^>]*>/gi, " ").replace(/<li[^>]*>/gi, "• ").replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITES[e] ?? m))
    .replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
/** Parcourt les parties : { textes: [{ type, texte }], pieces: [{ nom, type, taille }] }. */
function parties(brut, profondeur = 0, acc = { textes: [], pieces: [] }) {
  const { entetes: e, corps } = separer(brut), ct = lireParametres(entete(e, "content-type") || "text/plain"), cd = lireParametres(entete(e, "content-disposition"));
  const nom = decoderEntete(cd.params.filename || ct.params.name || "");
  if (ct.valeur.startsWith("multipart/") && ct.params.boundary && profondeur < 8) {
    const f = "--" + ct.params.boundary, morceaux = corps.split(new RegExp(`\\r?\\n?${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?[ \\t]*\\r?\\n?`));
    for (const m of morceaux.slice(1)) if (m.trim()) parties(m, profondeur + 1, acc);
    return acc;
  }
  if (ct.valeur === "message/rfc822" && profondeur < 8) { acc.pieces.push({ nom: nom || "message joint.eml", type: ct.valeur, taille: corps.length }); return acc; }
  const octets = decoderCorps(corps, entete(e, "content-transfer-encoding"));
  if (cd.valeur === "attachment" || (nom && !ct.valeur.startsWith("text/"))) { acc.pieces.push({ nom: nom || "pièce jointe", type: ct.valeur, taille: octets.length }); return acc; }
  if (ct.valeur === "text/plain" || ct.valeur === "text/html") acc.textes.push({ type: ct.valeur, texte: decoderOctets(octets, ct.params.charset) });
  return acc;
}
/** Retire l'historique cité d'une réponse et la signature de transfert ; garde le début de l'échange. */
function couperHistorique(t) {
  const lignes = String(t).replace(/\r\n?/g, "\n").split("\n"), r = [];
  const marque = /^\s*(le .{4,120}a écrit\s*:|on .{4,120}wrote\s*:|el .{4,120}escribió\s*:|-{2,}\s*(message d'origine|original message|mensaje original)\s*-{2,}|_{8,}|(de|from|von)\s*:\s.+(envoyé|sent|enviado|gesendet)\s*:)/i;
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    if (marque.test(l) || (/^\s*(de|from)\s*:/i.test(l) && /^\s*(envoyé|sent|date|enviado)\s*:/i.test(lignes[i + 1] || "") && r.join("").trim())) break;
    if (/^\s*>/.test(l) && r.join("").trim()) continue; // ligne citée
    r.push(l);
  }
  return r.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
/** « Nom <a@b.c> » → { nom, email }. */
function lireAdresse(v) {
  const t = decoderEntete(v), m = t.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  if (m) return { nom: m[1].trim(), email: m[2].trim().toLowerCase() };
  const e = (t.match(/[^\s<>,;"]+@[^\s<>,;"]+/) || [""])[0].toLowerCase();
  return { nom: "", email: e };
}

/**
 * E-mail brut → { messageId, de: { nom, email }, a, sujet, date (ISO ou ""), texte, pieces: [{ nom, type, taille }], masse, auto }.
 * masse : lettre d'information ou liste de diffusion ; auto : réponse automatique (absence, accusé).
 */
function lireCourriel(brut, { maxTexte = 12000 } = {}) {
  const { entetes: e } = separer(brut), p = parties(brut);
  const brutTexte = p.textes.find((x) => x.type === "text/plain")?.texte || htmlEnTexte(p.textes.find((x) => x.type === "text/html")?.texte || "");
  const texte = couperHistorique(brutTexte).slice(0, maxTexte), d = Date.parse(entete(e, "date"));
  const auto = /^auto-(replied|generated)/i.test(entete(e, "auto-submitted")) || !!entete(e, "x-autoreply") || !!entete(e, "x-autorespond") || /^(réponse automatique|automatic reply|auto(matic)? ?reply|out of office|absence)/i.test(decoderEntete(entete(e, "subject")));
  return {
    messageId: entete(e, "message-id").replace(/[<>\s]/g, "").slice(0, 200),
    de: lireAdresse(entete(e, "reply-to") && /noreply|no-reply/i.test(entete(e, "from")) ? entete(e, "reply-to") : entete(e, "from")),
    a: lireAdresse(entete(e, "to")).email,
    sujet: decoderEntete(entete(e, "subject")).slice(0, 300),
    date: Number.isFinite(d) ? new Date(d).toISOString() : "",
    texte, pieces: p.pieces.slice(0, 20),
    masse: !!entete(e, "list-unsubscribe") || !!entete(e, "list-id") || /^(bulk|list|junk)$/i.test(entete(e, "precedence")),
    auto,
  };
}

module.exports = { lireCourriel, decoderEntete, decoderOctets, htmlEnTexte, couperHistorique, lireParametres, separer };
