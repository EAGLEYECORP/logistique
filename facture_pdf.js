"use strict";
/* ============================================================
   Facture en PDF — logique pure, testée (pdf.js) : le vrai fichier PDF, pour l'e-mail, le téléchargement et l'archive.
   Même contenu que la facture imprimée (impression.js) : entreprise et logo, numéro, date, échéance, client et ses identifiants,
   lignes, totaux HT / TVA / TTC, somme en lettres, « Payée le », mentions, règlement (RIB) et identifiants légaux en pied de page.
   Dépend de noyau.js (totauxFacture, montantEnLettres, fmtDevise, dateFr) et pdf.js.
   ============================================================ */

const BLEU_PDF = "#0f3d7a", GRIS_PDF = "#5c5c61", TRAIT_PDF = "#d2d2d7";
/** Tout le texte d'une facture (pour savoir si des caractères ne passent pas dans le PDF). */
function texteFacturePdf(f) {
  const c = parId(S.clients, f.clientId) || {}, E = S.entreprise || {};
  return [E.nom, E.adresse, E.ville, E.mentionsFacture, E.banque, c.nom, c.adresse, c.ville, c.pays, c.ice, ...(f.lignes || []).map((x) => x.designation)].filter(Boolean).join("\n");
}
/**
 * Fichier PDF de la facture → Uint8Array. logo : { octets (JPEG), largeurPx, hauteurPx } facultatif.
 */
function pdfFacture(f, { logo = null } = {}) {
  const E = S.entreprise || {}, c = parId(S.clients, f.clientId) || {}, t = totauxFacture(f), d = creerPdf({ titre: `Facture ${f.numero}`, auteur: E.nom || "" });
  const M = 50, D = d.largeur - M, BAS = d.hauteur - 110; let y = M;
  // en-tête : entreprise (et logo) à gauche, « Facture » à droite
  let xNom = M; if (logo) { d.image(M, y - 6, 64, 48, logo); xNom = M + 74; }
  d.texte(xNom, y + 10, E.nom || "Votre entreprise", { taille: 15, gras: true, couleur: "#1d1d1f" });
  let ya = y + 26; for (const l of [...couperTexte(E.adresse || "", 220, 8.5), E.ville, E.tel && `Tél. ${E.tel}`, E.email].filter(Boolean)) { d.texte(xNom, ya, l, { taille: 8.5, couleur: GRIS_PDF }); ya += 11; }
  d.texte(D, y + 12, "FACTURE", { taille: 22, gras: true, couleur: BLEU_PDF, align: "droite" });
  d.texte(D, y + 30, `N° ${f.numero}`, { taille: 10.5, gras: true, align: "droite" });
  d.texte(D, y + 44, `Date : ${dateFr(f.date)}`, { taille: 9, couleur: GRIS_PDF, align: "droite" });
  d.texte(D, y + 56, `Échéance : ${dateFr(f.echeance)}`, { taille: 9, couleur: GRIS_PDF, align: "droite" });
  y = Math.max(ya, y + 70) + 14;
  // client
  const lc = [...(c.nom ? couperTexte(c.nom, 196, 9.5, true).map((t2) => ({ t: t2, g: true })) : []), ...couperTexte(c.adresse || "", 196, 9).filter(Boolean).map((t2) => ({ t: t2 })), [c.ville, c.pays].filter(Boolean).join(", ") && { t: [c.ville, c.pays].filter(Boolean).join(", ") }, c.ice && { t: `ICE / TVA : ${c.ice}` }].filter(Boolean);
  const hc = 24 + lc.length * 12; d.rect(D - 220, y, 220, hc, { remplir: "#f5f5f7", rayon: 6 });
  d.texte(D - 208, y + 14, "FACTURÉ À", { taille: 7.5, gras: true, couleur: GRIS_PDF });
  lc.forEach((x, i) => d.texte(D - 208, y + 28 + i * 12, x.t, { taille: 9.5, gras: !!x.g }));
  y += hc + 26;
  // lignes
  const entete = () => { d.rect(M, y, D - M, 20, { remplir: "#eef2f8" }); d.texte(M + 8, y + 13.5, "Désignation", { taille: 9, gras: true, couleur: BLEU_PDF }); d.texte(D - 8, y + 13.5, `Montant HT (${f.devise === "EUR" ? "€" : "MAD"})`, { taille: 9, gras: true, couleur: BLEU_PDF, align: "droite" }); y += 20; };
  entete();
  for (const x of f.lignes || []) {
    const lignes = couperTexte(x.designation || "", D - M - 130, 9.5), h = 10 + lignes.length * 12.5;
    if (y + h > BAS) { d.nouvellePage(); y = M; d.texte(M, y + 10, `Facture ${f.numero} (suite)`, { taille: 10, gras: true }); y += 24; entete(); }
    lignes.forEach((l, i) => d.texte(M + 8, y + 15 + i * 12.5, l, { taille: 9.5 }));
    d.texte(D - 8, y + 15, fmt(x.montant, 2), { taille: 9.5, align: "droite" });
    y += h; d.ligne(M, y, D, y, { couleur: TRAIT_PDF });
  }
  // totaux
  if (y + 120 > BAS) { d.nouvellePage(); y = M; }
  y += 14; const xt = D - 220;
  const totaux = [["Total HT", fmtDevise(t.ht, f.devise)], [`TVA ${fmt(f.tva)} %`, fmtDevise(t.tva, f.devise)]];
  totaux.forEach(([k, v], i) => { d.texte(xt + 10, y + 12 + i * 16, k, { taille: 9.5, couleur: GRIS_PDF }); d.texte(D - 10, y + 12 + i * 16, v, { taille: 9.5, align: "droite" }); });
  y += totaux.length * 16 + 6; d.rect(xt, y, 220, 26, { remplir: BLEU_PDF, rayon: 5 });
  d.texte(xt + 10, y + 17, "Total TTC", { taille: 11, gras: true, couleur: "#ffffff" }); d.texte(D - 10, y + 17, fmtDevise(t.ttc, f.devise), { taille: 11, gras: true, couleur: "#ffffff", align: "droite" });
  y += 44;
  for (const l of couperTexte(`Arrêtée la présente facture à la somme de : ${montantEnLettres(t.ttc, f.devise)} toutes taxes comprises.`, D - M, 9.5)) { d.texte(M, y, l, { taille: 9.5 }); y += 13; }
  if (f.statut === "payee") { y += 10; d.rect(M, y, 170, 28, { contour: "#1d8a3a", epaisseur: 1.5, rayon: 5 }); d.texte(M + 85, y + 18, `PAYÉE LE ${dateFr(f.datePaiement || today())}`, { taille: 11, gras: true, couleur: "#1d8a3a", align: "centre" }); }
  // pied de page de chaque page : mentions, règlement, identifiants légaux, numéro de page
  const pied = [...couperTexte(E.mentionsFacture || "", D - M, 7.5).filter(Boolean), E.rib && `Règlement par virement : ${E.banque || ""} — RIB ${E.rib}`, [E.ice && `ICE ${E.ice}`, E.rc && `RC ${E.rc}`, E.if && `IF ${E.if}`, E.patente && `Patente ${E.patente}`, E.cnss && `CNSS ${E.cnss}`].filter(Boolean).join(" · ")].filter(Boolean);
  const n = d.nbPages;
  for (let p = 1; p <= n; p++) {
    d.allerPage(p); let yp = d.hauteur - 34 - pied.length * 10;
    d.ligne(M, yp - 8, D, yp - 8, { couleur: TRAIT_PDF });
    for (const l of pied) { d.texte(d.largeur / 2, yp, l, { taille: 7.5, couleur: GRIS_PDF, align: "centre" }); yp += 10; }
    if (n > 1) d.texte(D, d.hauteur - 20, `${p}/${n}`, { taille: 7.5, couleur: GRIS_PDF, align: "droite" });
  }
  return d.octets();
}
