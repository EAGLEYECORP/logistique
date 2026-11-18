"use strict";
/* ============================================================
   Envoi des factures et relances (interface) :
   · « Envoyer » sur chaque facture : e-mail au client avec la facture, la preuve de livraison et les photos (CMR signé, livraison) ;
     par le relais (SMTP), sinon par le partage du téléphone (Gmail, WhatsApp… avec les fichiers), sinon e-mail + PDF à joindre ;
   · proposé dès qu'une facture est créée ; date d'envoi et prochaines relances sur la ligne de la facture ;
   · relances programmées dans le plan des notifications (fil de l'équipe ; e-mail au client si activé, envoyé par le relais) ;
   · Réglages : jours des relances, envoi automatique au client.
   Logique pure dans relances.js ; pièces jointes acceptées par le relais : serveur/courriel.js.
   ============================================================ */

const htmlPieceJointe = (titre, corps) => htmlImpression(titre, corps).replace(/<div class="barre-impression">[\s\S]*?<\/div>/, "").replace(/<script>[\s\S]*?<\/script>/, "");
const blobEnBase64 = (blob) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => ko(r.error); r.readAsDataURL(blob); });
const tailleLisible = (o) => (o > 1048576 ? `${fmt(o / 1048576, 1)} Mo` : `${fmt(Math.max(1, o / 1024), 0)} Ko`);
/** Pièces d'une facture : [{ id, nom, type, blob, taille, libelle }] — facture, preuves de livraison, photos (6 au plus). */
/** Logo de l'entreprise en JPEG pour le PDF : { octets, largeurPx, hauteurPx } ou null (image PNG convertie sur fond blanc). */
async function logoPourPdf() {
  const url = typeof logoSur === "function" ? logoSur(S.entreprise) : ""; return url ? imageJpegPourPdf(url) : null;
}
/** Une image (adresse ou data:) en JPEG sur fond blanc pour le PDF : { octets, largeurPx, hauteurPx } ou null. */
async function imageJpegPourPdf(url, max = 400) {
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const b = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.9)); return b ? { octets: new Uint8Array(await b.arrayBuffer()), largeurPx: c.width, hauteurPx: c.height } : null;
  } catch { return null; }
}
/** Preuve de livraison en PDF (Blob), avec le logo et la signature du destinataire. */
async function blobPreuvePdf(v) {
  const octets = pdfPreuve(v, { logo: await logoPourPdf(), signature: v.pod?.signature ? await imageJpegPourPdf(v.pod.signature, 600) : null });
  return octets ? new Blob([octets], { type: "application/pdf" }) : null;
}
/** Facture en PDF (Blob). */
async function blobFacturePdf(f) { return new Blob([pdfFacture(f, { logo: await logoPourPdf() })], { type: "application/pdf" }); }
async function telechargerFacturePdf(f) { const b = await blobFacturePdf(f); telecharger(`${f.numero}.pdf`, new Uint8Array(await b.arrayBuffer()), "application/pdf"); }
async function piecesFacture(f) {
  const r = [], pdf = await blobFacturePdf(f);
  r.push({ id: "facture", nom: `${f.numero}.pdf`, type: "application/pdf", blob: pdf, taille: pdf.size, libelle: `Facture ${f.numero} (PDF)` });
  if (pertesPdf(texteFacturePdf(f)).length) { const fac = new Blob([htmlPieceJointe(f.numero, corpsFacture(f))], { type: "text/html" }); r.push({ id: "facture-html", nom: `${f.numero}.html`, type: "text/html", blob: fac, taille: fac.size, libelle: `Facture ${f.numero} (page web : écritures non latines du client ou des lignes)` }); }
  for (const v of voyagesFacture(f)) {
    if (!v.pod) continue;
    const pdf = await blobPreuvePdf(v);
    if (pdf) r.push({ id: `pod:${v.id}`, nom: `Preuve de livraison ${v.ref}.pdf`, type: "application/pdf", blob: pdf, taille: pdf.size, libelle: `Preuve de livraison ${v.ref} (PDF${v.pod.signature ? ", signée" : ""}${v.pod.reserves ? ", avec réserves" : ""})` });
    if ((!pdf || pertesPdf(textePreuvePdf(v)).length) && typeof corpsPreuve === "function") { const b = new Blob([htmlPieceJointe(`Preuve de livraison ${v.ref}`, corpsPreuve(v))], { type: "text/html" }); r.push({ id: `pod-html:${v.id}`, nom: `Preuve de livraison ${v.ref}.html`, type: "text/html", blob: b, taille: b.size, libelle: `Preuve de livraison ${v.ref} (page web : écritures non latines)` }); }
  }
  let photos = [];
  for (const cible of ciblesPhotosFacture(f)) { try { photos.push(...(await photosDe(cible)).map((p) => ({ ...p, cible }))); } catch { /* photos indisponibles */ } }
  photos = photos.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6);
  photos.forEach((p, i) => r.push({ id: `photo:${p.id}`, nom: `${p.cible.startsWith("voyage") ? "Voyage" : "Commande"} photo ${i + 1}.jpg`, type: "image/jpeg", blob: p.blob, taille: p.blob.size, libelle: `Photo ${i + 1} — ${p.nom || "CMR / livraison"} (${dateFr(String(p.date).slice(0, 10))})` }));
  return r;
}
async function envoyerFacture(f) {
  const cl = parId(S.clients, f.clientId) || {}, t = texteEnvoiFacture(f), pieces = await piecesFacture(f), caps = typeof canauxRelais === "function" ? await canauxRelais() : [];
  const parRelais = caps.includes("email"), partage = !!navigator.canShare && navigator.canShare({ files: [new File(["x"], "x.txt", { type: "text/plain" })] });
  const r = await modale({ titre: `Envoyer ${f.numero} — ${nomClient(f.clientId)}`, valider: parRelais ? "Envoyer l'e-mail" : partage ? "Partager (e-mail, WhatsApp…)" : "Préparer l'e-mail", corps: `
    <div class="form-grid"><label class="f full">À<input type="email" name="a" value="${esc(cl.email || "")}" ${parRelais ? "required" : ""} placeholder="adresse du client"></label>
      <label class="f full">Objet<input name="sujet" value="${esc(t.sujet)}"></label></div>
    <label class="f full" style="margin-top:8px">Message<textarea name="texte" rows="8">${esc(t.texte)}</textarea></label>
    <div class="section-title">Pièces jointes</div>
    <div class="pieces-liste">${pieces.map((p) => `<label class="check"><input type="checkbox" name="p__${esc(p.id)}" checked><span>${esc(p.libelle)} <span class="sub">${esc(p.nom)} · ${tailleLisible(p.taille)}</span></span></label>`).join("")}</div>
    ${pieces.length === 1 ? `<p class="hint">Aucune photo ni preuve de livraison sur les voyages de cette facture : prenez le CMR signé en photo sur le voyage (bouton Photos) pour le joindre.</p>` : ""}
    <p class="hint">${parRelais ? "Envoyé par le relais, depuis l'adresse de l'entreprise." : partage ? "Le partage du téléphone s'ouvre avec les fichiers : choisissez Gmail, Outlook ou WhatsApp." : "Sans relais e-mail : le message s'ouvre dans votre messagerie et la facture s'ouvre en PDF, à joindre."} La facture est jointe en page web, lisible et imprimable dans tout navigateur.</p>` });
  if (!r) return;
  const choisies = pieces.filter((p) => r[`p__${p.id}`]);
  try {
    if (parRelais) {
      const b64 = await Promise.all(choisies.map(async (p) => ({ nom: p.nom, type: p.type, base64: await blobEnBase64(p.blob) })));
      await partageAppel("POST", "/api/notifications/document", { a: String(r.a || "").trim(), sujet: r.sujet, texte: r.texte, pieces: b64 });
      f.envoi = { date: new Date().toISOString(), a: String(r.a).trim(), pieces: choisies.length, via: "relais" };
    } else if (partage) {
      const files = choisies.map((p) => new File([p.blob], p.nom, { type: p.type }));
      await navigator.share({ title: r.sujet, text: r.texte, files });
      f.envoi = { date: new Date().toISOString(), a: String(r.a || "").trim(), pieces: choisies.length, via: "partage" };
    } else {
      location.href = `mailto:${encodeURIComponent(String(r.a || ""))}?subject=${encodeURIComponent(r.sujet)}&body=${encodeURIComponent(r.texte)}`; imprimerFacture(f);
      f.envoi = { date: new Date().toISOString(), a: String(r.a || "").trim(), pieces: 0, via: "messagerie" };
    }
  } catch (e) { if (e?.name === "AbortError") return; return toast(`Envoi impossible : ${e.message}`, "danger"); }
  sauver(); toast(`${f.numero} envoyée${f.envoi.via === "relais" ? ` à ${f.envoi.a} (${f.envoi.pieces} pièce${f.envoi.pieces > 1 ? "s" : ""} jointe${f.envoi.pieces > 1 ? "s" : ""})` : ""}`); rafraichir();
}
function infoEnvoiFacture(f) {
  const r = prochainesRelances(f), env = f.envoi ? `envoyée le ${dateFr(f.envoi.date.slice(0, 10))}` : f.statut !== "payee" ? "pas encore envoyée" : "";
  const rel = f.statut === "payee" ? "" : f.sansRelance || parId(S.clients, f.clientId)?.sansRelance ? "relances suspendues" : r.length ? `relance ${r[0].j < 0 ? "J" + r[0].j : "J+" + r[0].j} le ${dateFr(r[0].date)}${S.params.relancesAuto ? " (e-mail)" : ""}` : "";
  return env || rel ? `<span class="sub">${[env, rel].filter(Boolean).map(esc).join(" · ")}</span>` : "";
}
function actionsEnvoiFacture(f) {
  const pdf = btn("facture-pdf", "PDF", { id: f.id, icone: "download", cls: "btn ghost sm", titre: "Télécharger la facture en PDF" });
  if (f.statut === "payee") return pdf;
  return `${pdf}${btn("envoyer-facture", f.envoi ? "Renvoyer" : "Envoyer", { id: f.id, icone: "upload", cls: `btn ${f.envoi ? "ghost " : ""}sm` })}${btn("relances-facture", f.sansRelance ? "Reprendre les relances" : "Suspendre les relances", { id: f.id, cls: "btn ghost sm" })}`;
}

/* ---------- branchements ---------- */
if (VUES.factures) {
  surAction("factures", "*", async function (act, id, b) {
    const f = parId(S.factures, id);
    if (act === "envoyer-facture" && f) return envoyerFacture(f);
    if (act === "relances-facture" && f) { f.sansRelance = !f.sansRelance; sauver(); toast(f.sansRelance ? `${f.numero} : relances suspendues` : `${f.numero} : relances reprises`); return rafraichir(); }
    return PASSER;
  });
}
// Une facture vient d'être créée (voyage, commande, retour, attente) : proposer de l'envoyer tout de suite.
for (const [page, actes] of [["voyages", ["facturer-voyage", "retour-facturer", "attente-facturer"]], ["commandes", ["facturer", "attente-facturer"]]]) {
  autourAction(page, actes, async (suite) => {
    const avant = S.factures.length, r = await suite();
    if (S.factures.length > avant) { const f = S.factures[S.factures.length - 1]; if (await confirmer(`Envoyer ${f.numero} maintenant ?`, "La facture part avec le CMR signé et la preuve de livraison : le client n'a rien à réclamer, le paiement ne glisse pas.", "Envoyer")) await envoyerFacture(f); }
    return r;
  }, { ordre: 50, nom: "envoi de la facture créée" });
}
// Relances dans le plan des notifications (fil de l'équipe ; e-mails au client exécutés par le relais, application fermée).
if (typeof planNotifications === "function") { const planAvantRelances = planNotifications; planNotifications = function (o = {}) { return [...planAvantRelances(o), ...planRelances(o)].sort((a, b) => a.quand - b.quand); }; }

/* ---------- réglages ---------- */
enregistrerCarteReglages({
  onglet: "rappels", ordre: 22,
  rendu: () => `<div class="card" id="carte-relances"><div class="card-head"><h2>Relances des factures</h2></div>
    <form id="f-relances"><div class="form-grid">
      <label class="f">Jours par rapport à l'échéance (négatif = avant)<input name="relancesJours" value="${esc(S.params.relancesJours ?? "-3,7,15,30")}" placeholder="-3,7,15,30"></label>
      <label class="check full"><input type="checkbox" name="relancesAuto" ${S.params.relancesAuto ? "checked" : ""}><span>Envoyer aussi les relances par e-mail au client (relais avec serveur d'e-mail), dans sa langue</span></label>
    </div><div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn">Enregistrer</button></div></form>
    <p class="hint">Sans envoi automatique, l'équipe est prévenue dans le fil de l'application à chaque date. Une facture payée sort des relances ; « Suspendre les relances » sur une facture, ou « Pas de relance » sur la fiche d'un client, les arrête.</p></div>`,
  soumettre(fid, v) { if (fid !== "f-relances") return false; S.params.relancesJours = String(v.relancesJours || "").trim() || "-3,7,15,30"; S.params.relancesAuto = !!v.relancesAuto; sauver(); toast("Relances enregistrées"); rafraichir(); return true; },
});

/* ---------- facture en PDF : téléchargement depuis la page Factures et la fiche du voyage ---------- */
surAction(["factures", "voyages"], ["facture-pdf"], async (act, id) => { const f = parId(S.factures, id); if (!f) return; try { await telechargerFacturePdf(f); toast(`${f.numero}.pdf téléchargée`); } catch (e) { toast(`PDF impossible : ${e.message}`, "danger"); } });
