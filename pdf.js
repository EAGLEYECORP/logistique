"use strict";
/* ============================================================
   PDF sans dépendance — logique pure, testée.
   Texte en Helvetica et Helvetica gras (polices standard de tout lecteur PDF, rien à embarquer), alphabet latin avec accents,
   €, « », ° (codage WinAnsi) ; traits, rectangles, image JPEG (logo) ; plusieurs pages A4 ; coupure des lignes trop longues.
   Coordonnées en points depuis le HAUT de la page (1 mm ≈ 2,83 points). Les caractères hors alphabet latin (arabe…) deviennent « ? » :
   pertesPdf(texte) les signale pour joindre aussi la version HTML.
   ============================================================ */

const A4 = { l: 595.28, h: 841.89 };
// largeurs (millièmes de la taille) des caractères 32 à 126 — Helvetica et Helvetica-Bold (fichiers AFM d'Adobe)
const LARG_HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const LARG_HELV_GRAS = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const WINANSI = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‰": 0x89, "‹": 0x8b, "Œ": 0x8c, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99, "›": 0x9b, "œ": 0x9c, "Ÿ": 0x9f };
const LARG_SPECIALES = { "€": 556, "…": 1000, "–": 556, "—": 1000, "•": 350, "‘": 222, "’": 222, "“": 333, "”": 333, "«": 556, "»": 556, "°": 400, "×": 584, "Œ": 1000, "œ": 944, " ": 278 };

/** Signes courants absents des polices standard, écrits avec leur plus proche équivalent. */
const EQUIVALENTS_PDF = { "→": "–", "←": "–", "⇄": "–", "↔": "–", "≈": "~", "≤": "<=", "≥": ">=", "✓": "v", "\u2011": "-", "\u2212": "-" };
const versPdf = (t) => [...String(t ?? "")].map((c) => EQUIVALENTS_PDF[c] ?? c).join("");
/** Code WinAnsi d'un caractère (espaces insécables du format français ramenées à des espaces), ou null s'il n'existe pas. */
function codeWinAnsi(c) {
  if (c === " " || c === " ") return 0x20;
  const n = c.codePointAt(0);
  if (n >= 0x20 && n < 0x7f) return n;
  if (WINANSI[c] !== undefined) return WINANSI[c];
  if (n >= 0xa0 && n <= 0xff) return n;
  return null;
}
/** Caractères qui ne peuvent pas s'écrire dans le PDF (ils y deviendraient « ? »). */
const pertesPdf = (t) => [...new Set([...versPdf(t)].filter((c) => !/[\n\r\t]/.test(c) && codeWinAnsi(c) === null))];
function largeurCaractere(c, gras) {
  const n = codeWinAnsi(c); if (n === null) return 556;
  if (n >= 0x20 && n < 0x7f) return (gras ? LARG_HELV_GRAS : LARG_HELV)[n - 32];
  if (LARG_SPECIALES[c]) return LARG_SPECIALES[c];
  const base = c.normalize("NFD")[0]; return base !== c && base.charCodeAt(0) < 0x7f && base.charCodeAt(0) >= 0x20 ? (gras ? LARG_HELV_GRAS : LARG_HELV)[base.charCodeAt(0) - 32] : 556;
}
/** Largeur d'un texte en points. */
const largeurTexte = (t, taille = 10, gras = false) => ([...versPdf(t)].reduce((s, c) => s + largeurCaractere(c, gras), 0) * taille) / 1000;
/** Texte coupé en lignes de largeur maximale (sur les espaces ; un mot trop long est coupé). */
function couperTexte(t, largeurMax, taille = 10, gras = false) {
  const lignes = [];
  for (const para of String(t ?? "").split(/\r?\n/)) {
    let ligne = "";
    for (const mot of para.split(/\s+/).filter(Boolean)) {
      const essai = ligne ? `${ligne} ${mot}` : mot;
      if (largeurTexte(essai, taille, gras) <= largeurMax) { ligne = essai; continue; }
      if (ligne) lignes.push(ligne);
      let m = mot; while (largeurTexte(m, taille, gras) > largeurMax) { let k = m.length; while (k > 1 && largeurTexte(m.slice(0, k), taille, gras) > largeurMax) k--; lignes.push(m.slice(0, k)); m = m.slice(k); }
      ligne = m;
    }
    lignes.push(ligne);
  }
  return lignes;
}
const echapperPdf = (t) => [...versPdf(t)].map((c) => { const n = codeWinAnsi(c) ?? 0x3f; const ch = String.fromCharCode(n); return ch === "\\" || ch === "(" || ch === ")" ? "\\" + ch : n < 0x20 || n > 0x7e ? "\\" + n.toString(8).padStart(3, "0") : ch; }).join("");
const nombrePdf = (x) => (Math.round(x * 100) / 100).toString();
const couleurPdf = (hex = "#000000") => { const h = String(hex).replace("#", ""), v = (i) => nombrePdf(parseInt(h.slice(i, i + 2), 16) / 255); return `${v(0)} ${v(2)} ${v(4)}`; };

/**
 * Document PDF : const d = creerPdf({ titre }); d.texte(x, y, "…", { taille, gras, couleur, align }); d.ligne(…); d.rect(…); d.image(…); d.nouvellePage(); d.octets() → Uint8Array.
 */
function creerPdf({ titre = "", auteur = "" } = {}) {
  const pages = [[]], images = []; let ici = 0;
  const courante = () => pages[ici], Y = (y) => nombrePdf(A4.h - y);
  return {
    largeur: A4.l, hauteur: A4.h,
    get page() { return ici + 1; },
    get nbPages() { return pages.length; },
    nouvellePage() { pages.push([]); ici = pages.length - 1; },
    /** Revenir sur une page (1 = la première) pour y ajouter quelque chose (pied de page « 1/3 »). */
    allerPage(n) { ici = Math.max(0, Math.min(pages.length - 1, n - 1)); },
    texte(x, y, t, { taille = 10, gras = false, couleur = "#000000", align = "gauche" } = {}) {
      const l = largeurTexte(t, taille, gras), x0 = align === "droite" ? x - l : align === "centre" ? x - l / 2 : x;
      courante().push(`BT /${gras ? "F2" : "F1"} ${nombrePdf(taille)} Tf ${couleurPdf(couleur)} rg ${nombrePdf(x0)} ${Y(y)} Td (${echapperPdf(t)}) Tj ET`);
      return l;
    },
    ligne(x1, y1, x2, y2, { epaisseur = 0.5, couleur = "#000000" } = {}) { courante().push(`${nombrePdf(epaisseur)} w ${couleurPdf(couleur)} RG ${nombrePdf(x1)} ${Y(y1)} m ${nombrePdf(x2)} ${Y(y2)} l S`); },
    rect(x, y, l, h, { remplir = null, contour = null, epaisseur = 0.5, rayon = 0 } = {}) {
      const op = remplir && contour ? "B" : remplir ? "f" : "S", style = `${remplir ? couleurPdf(remplir) + " rg " : ""}${contour ? couleurPdf(contour) + " RG " : ""}${nombrePdf(epaisseur)} w `;
      if (!rayon) { courante().push(`${style}${nombrePdf(x)} ${Y(y + h)} ${nombrePdf(l)} ${nombrePdf(h)} re ${op}`); return; }
      const r = Math.min(rayon, l / 2, h / 2), k = r * 0.5523, x1 = x, x2 = x + l, y1 = A4.h - y, y2 = A4.h - y - h, n = nombrePdf;
      courante().push(`${style}${n(x1 + r)} ${n(y1)} m ${n(x2 - r)} ${n(y1)} l ${n(x2 - r + k)} ${n(y1)} ${n(x2)} ${n(y1 - r + k)} ${n(x2)} ${n(y1 - r)} c ${n(x2)} ${n(y2 + r)} l ${n(x2)} ${n(y2 + r - k)} ${n(x2 - r + k)} ${n(y2)} ${n(x2 - r)} ${n(y2)} c ${n(x1 + r)} ${n(y2)} l ${n(x1 + r - k)} ${n(y2)} ${n(x1)} ${n(y2 + r - k)} ${n(x1)} ${n(y2 + r)} c ${n(x1)} ${n(y1 - r)} l ${n(x1)} ${n(y1 - r + k)} ${n(x1 + r - k)} ${n(y1)} ${n(x1 + r)} ${n(y1)} c h ${op}`);
    },
    /** Image JPEG (octets, largeur et hauteur en pixels) dans un cadre l × h points, proportions gardées. */
    image(x, y, l, h, { octets, largeurPx, hauteurPx }) {
      if (!octets?.length || !largeurPx || !hauteurPx) return;
      const i = images.push({ octets, largeurPx, hauteurPx }), e = Math.min(l / largeurPx, h / hauteurPx), lw = largeurPx * e, hh = hauteurPx * e;
      courante().push(`q ${nombrePdf(lw)} 0 0 ${nombrePdf(hh)} ${nombrePdf(x)} ${Y(y + hh)} cm /Im${i} Do Q`);
    },
    octets() {
      const objets = []; // index = numéro - 1
      const ajouter = (contenu) => objets.push(contenu);
      ajouter("<< /Type /Catalog /Pages 2 0 R >>"); ajouter(null); // les pages sont écrites ensuite
      ajouter("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
      ajouter("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
      const noImages = images.map((im) => { const brut = Array.from(im.octets, (b) => String.fromCharCode(b)).join(""); ajouter(`<< /Type /XObject /Subtype /Image /Width ${im.largeurPx} /Height ${im.hauteurPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.octets.length} >>\nstream\n${brut}\nendstream`); return objets.length; });
      const xobj = noImages.length ? ` /XObject << ${noImages.map((n, i) => `/Im${i + 1} ${n} 0 R`).join(" ")} >>` : "";
      const kids = [];
      for (const p of pages) {
        const flux = p.join("\n"); ajouter(`<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`); const nc = objets.length;
        ajouter(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.l} ${A4.h}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobj} >> /Contents ${nc} 0 R >>`); kids.push(objets.length);
      }
      objets[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
      ajouter(`<< /Title (${echapperPdf(titre)}) /Author (${echapperPdf(auteur)}) /Producer (Logistique Fret) >>`); const info = objets.length;
      let sortie = "%PDF-1.4\n%âãÏÓ\n"; const decalages = [];
      objets.forEach((o, i) => { decalages.push(sortie.length); sortie += `${i + 1} 0 obj\n${o}\nendobj\n`; });
      const xref = sortie.length;
      sortie += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${decalages.map((d) => `${String(d).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objets.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      const o = new Uint8Array(sortie.length); for (let i = 0; i < sortie.length; i++) o[i] = sortie.charCodeAt(i) & 0xff;
      return o;
    },
  };
}
