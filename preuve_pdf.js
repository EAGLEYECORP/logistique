"use strict";
/* ============================================================
   Preuve de livraison en PDF — logique pure, testée (pdf.js) : le vrai fichier, pour l'e-mail de la facture,
   le partage (WhatsApp, e-mail) et l'archive. Même contenu que la preuve imprimée (terrain.js, corpsPreuve) :
   livré le / à qui / où (position relevée), réserves, signature du destinataire, et le rappel que ce document
   ne remplace pas le CMR papier. Dépend de noyau.js (dateFr, dateHeureFr, parId) et pdf.js ; couleurs de facture_pdf.js.
   ============================================================ */

/** Tout le texte d'une preuve (pour savoir si des caractères ne passent pas dans le PDF, un nom en arabe par exemple). */
function textePreuvePdf(v) {
  const p = v?.pod || {}, c = parId(S.clients, v?.clientId) || {}, E = S.entreprise || {};
  return [E.nom, E.adresse, E.ville, c.nom, v?.origine, v?.destination, v?.marchandise, p.signataire, p.reserves, p.par].filter(Boolean).join("\n");
}
/** Les lignes « libellé : valeur » de la preuve (communes au PDF et aux essais). */
function champsPreuve(v) {
  const p = v.pod || {}, c = parId(S.clients, v.clientId) || {}, cam = parId(S.camions, v.camionId) || {}, ch = parId(S.chauffeurs, v.chauffeurId) || {};
  const cmd = v.commandeId && parId(S.commandes, v.commandeId);
  return [
    ["Itinéraire", [v.origine, v.destination].filter(Boolean).join(" → ")],
    ["Client", c.nom],
    ["Marchandise", v.marchandise || cmd?.marchandise],
    ["Commande", cmd?.ref],
    ["CMR n°", v.cmr?.numero || v.cmrNumero],
    ["Livré le", dateHeureFr(p.date)],
    ["Reçu par", p.signataire],
    ["Position relevée", Number.isFinite(p.lat) ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}${p.precision ? ` (± ${p.precision} m)` : ""}` : "non disponible"],
    ["Chauffeur", p.par || ch.nom],
    ["Camion", cam.immat],
  ].filter(([, val]) => val);
}
/**
 * Fichier PDF de la preuve de livraison → Uint8Array (null sans preuve).
 * logo et signature : { octets (JPEG), largeurPx, hauteurPx } facultatifs.
 */
function pdfPreuve(v, { logo = null, signature = null } = {}) {
  const p = v?.pod; if (!p) return null;
  const E = S.entreprise || {}, d = creerPdf({ titre: `Preuve de livraison ${v.ref}`, auteur: E.nom || "" });
  const M = 50, D = d.largeur - M, BAS = d.hauteur - 70; let y = M;
  const place = (h) => { if (y + h > BAS) { d.nouvellePage(); y = M; d.texte(M, y + 10, `Preuve de livraison ${v.ref || ""} (suite)`, { taille: 10, gras: true }); y += 34; } };
  // en-tête : entreprise (et logo) à gauche, titre à droite
  let xNom = M; if (logo) { d.image(M, y - 6, 64, 48, logo); xNom = M + 74; }
  d.texte(xNom, y + 10, E.nom || "Votre entreprise", { taille: 15, gras: true, couleur: "#1d1d1f" });
  let ya = y + 26; for (const l of [...couperTexte(E.adresse || "", 220, 8.5), E.ville, E.tel && `Tél. ${E.tel}`, E.email].filter(Boolean)) { d.texte(xNom, ya, l, { taille: 8.5, couleur: GRIS_PDF }); ya += 11; }
  d.texte(D, y + 12, "PREUVE DE LIVRAISON", { taille: 17, gras: true, couleur: BLEU_PDF, align: "droite" });
  d.texte(D, y + 30, `Voyage ${v.ref || ""}`, { taille: 10.5, gras: true, align: "droite" });
  d.texte(D, y + 44, `Édité le ${dateFr(today())}`, { taille: 9, couleur: GRIS_PDF, align: "droite" });
  y = Math.max(ya, y + 58) + 16;
  // bandeau : livré, avec ou sans réserve
  const reserves = String(p.reserves || "").trim(), vert = "#1d7a35", orange = "#9a5000";
  d.rect(M, y, D - M, 30, { remplir: reserves ? "#fff4e5" : "#e9f6ec", rayon: 6 });
  d.texte(M + 12, y + 19, `LIVRÉ LE ${dateHeureFr(p.date)}${p.signataire ? ` À ${String(p.signataire).toUpperCase()}` : ""}`, { taille: 10.5, gras: true, couleur: reserves ? orange : vert });
  d.texte(D - 12, y + 19, reserves ? "AVEC RÉSERVES" : "SANS RÉSERVE", { taille: 9.5, gras: true, couleur: reserves ? orange : vert, align: "droite" });
  y += 48;
  // détails de la livraison, sur deux colonnes
  const titre = (t) => { d.texte(M, y, t.toUpperCase(), { taille: 8, gras: true, couleur: GRIS_PDF }); y += 8; d.ligne(M, y, D, y, { couleur: TRAIT_PDF }); y += 16; };
  titre("Livraison");
  const champs = champsPreuve(v), lc = (D - M - 20) / 2;
  for (let i = 0; i < champs.length; i += 2) {
    let h = 0;
    for (const [k, [lib, val]] of [champs[i], champs[i + 1]].filter(Boolean).entries()) {
      const x = M + k * (lc + 20), lignes = couperTexte(String(val), lc, 10);
      d.texte(x, y, lib, { taille: 8, couleur: GRIS_PDF });
      lignes.forEach((l, j) => d.texte(x, y + 13 + j * 12.5, l, { taille: 10 }));
      h = Math.max(h, 13 + lignes.length * 12.5);
    }
    y += h + 10;
  }
  y += 6;
  // réserves
  const lr = reserves ? couperTexte(reserves, D - M - 24, 10) : ["Aucune réserve formulée à la livraison."];
  place(40 + Math.min(lr.length, 20) * 13); titre("Réserves");
  for (let i = 0; i < lr.length;) { // une longue réserve continue sur la page suivante
    const n = Math.max(1, Math.min(lr.length - i, Math.floor((BAS - y - 16) / 13))), hr = 16 + n * 13;
    d.rect(M, y - 4, D - M, hr, { contour: TRAIT_PDF, rayon: 6 });
    lr.slice(i, i + n).forEach((l, j) => d.texte(M + 12, y + 12 + j * 13, l, { taille: 10, couleur: reserves ? "#1d1d1f" : GRIS_PDF }));
    y += hr + 20; i += n; if (i < lr.length) place(BAS);
  }
  // signature du destinataire
  const hs = 110; place(hs + 70); titre("Signature du destinataire");
 d.rect(M, y - 4, 260, hs, { contour: TRAIT_PDF, rayon: 6 });
  if (signature) d.image(M + 10, y + 4, 240, hs - 18, signature);
  else d.texte(M + 130, y + hs / 2, "Non signée", { taille: 10, couleur: GRIS_PDF, align: "centre" });
  const xs = M + 280; let ys = y + 10;
  for (const l of [p.signataire && `Reçu par ${p.signataire}`, `Le ${dateHeureFr(p.date)}`, Number.isFinite(p.lat) && "Position relevée par le téléphone au moment de la signature"].filter(Boolean)) {
    for (const t of couperTexte(l, D - xs, 9)) { d.texte(xs, ys, t, { taille: 9, couleur: GRIS_PDF }); ys += 12; }
  }
  y += hs + 22;
  // rappel juridique
  place(40);
  for (const l of couperTexte("Document de preuve établi par l'application. Il ne remplace pas le CMR : la valeur juridique d'un CMR électronique n'est pas confirmée au Maroc ni en Espagne. Conservez le CMR papier signé.", D - M, 8)) { d.texte(M, y, l, { taille: 8, couleur: GRIS_PDF }); y += 10.5; }
  // pied : identifiants de l'entreprise
  const ids = [E.nom, E.ice && `ICE ${E.ice}`, E.rc && `RC ${E.rc}`, E.if && `IF ${E.if}`, E.patente && `Patente ${E.patente}`].filter(Boolean).join(" · ");
  const n = d.nbPages;
  for (let k = 1; k <= n; k++) {
    d.allerPage(k); const yp = d.hauteur - 40;
    if (ids) { d.ligne(M, yp - 10, D, yp - 10, { couleur: TRAIT_PDF }); d.texte(d.largeur / 2, yp, couperTexte(ids, D - M, 7.5)[0], { taille: 7.5, couleur: GRIS_PDF, align: "centre" }); }
    if (n > 1) d.texte(D, d.hauteur - 20, `${k}/${n}`, { taille: 7.5, couleur: GRIS_PDF, align: "droite" });
  }
  return d.octets();
}
