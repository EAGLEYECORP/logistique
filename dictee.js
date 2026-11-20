"use strict";
/* ============================================================
   Dictée — logique pure, testée. Le chauffeur dicte au lieu de taper (réserves à la livraison, notes) :
   · langue de reconnaissance d'après la langue de l'application (arabe du Maroc, français, espagnol, anglais) ;
   · ponctuation dite à voix haute : « virgule », « point », « à la ligne »… (« فاصلة », « نقطة », « سطر جديد » en arabe) ;
   · insertion à l'endroit du curseur, avec l'espace et la majuscule qu'il faut.
   La reconnaissance elle-même est celle du téléphone (Web Speech) : interface dans dictee_ui.js.
   ============================================================ */

const LANGUES_DICTEE = { fr: "fr-FR", ar: "ar-MA", es: "es-ES", en: "en-GB" };
/** Mots dits pour la ponctuation (les plus longs d'abord, pour « point d'interrogation » avant « point »).
    Troisième élément : ce qui, juste après, fait du mot un nom ordinaire (« point de livraison », « punto de entrega », « نقطة التسليم »). */
const COMMANDES_DICTEE = {
  fr: [["point d'interrogation", "?"], ["point d'exclamation", "!"], ["points de suspension", "…"], ["à la ligne", "\n"], ["nouvelle ligne", "\n"], ["deux points", ":"], ["point virgule", ";"], ["virgule", ","], ["point", ".", "\\s+(?:de|du|des|au|aux|à)(?=\\s|$)|\\s+d['’]"], ["tiret", "-"]],
  es: [["signo de interrogación", "?"], ["signo de exclamación", "!"], ["nueva línea", "\n"], ["punto y coma", ";"], ["dos puntos", ":"], ["coma", ","], ["punto", ".", "\\s+(?:de|del)(?=\\s|$)"], ["guion", "-"]],
  en: [["question mark", "?"], ["exclamation mark", "!"], ["new line", "\n"], ["full stop", "."], ["semicolon", ";"], ["colon", ":"], ["comma", ","], ["period", ".", "\\s+of(?=\\s|$)"], ["dash", "-"]],
  ar: [["علامة استفهام", "؟"], ["سطر جديد", "\n"], ["فاصلة", "،"], ["نقطة", ".", "\\s+ال"]],
};
const PONCTUATION_DICTEE = /^[.,;:!?…،؟\n-]/;
const echapperRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Remplace la ponctuation dite par les signes, et règle les espaces autour (pas d'espace avant un signe, une après). */
function appliquerCommandesDictee(texte, langue = "fr") {
  let t = ` ${String(texte || "").trim()} `;
  for (const [mot, signe, sauf] of COMMANDES_DICTEE[langue] || COMMANDES_DICTEE.fr) {
    const re = new RegExp(`(^|\\s)${echapperRegex(mot)}(?=\\s|$)${sauf ? `(?!${sauf})` : ""}`, langue === "ar" ? "g" : "giu");
    t = t.replace(re, (m, avant) => `${avant}\u0000${signe}\u0000`);
  }
  return t.replace(/\s*\u0000([^\u0000]*)\u0000\s*/g, (m, s) => (s === "\n" ? "\n" : s === "-" ? " - " : `${s} `)).replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/^[ \t]+|[ \t]+$/g, "");
}
/** Faut-il une majuscule ? (début du texte, ou après . ! ? … et un retour à la ligne) — sans objet en arabe. */
const finDePhrase = (avant) => !avant.trim() || /[.!?…]\s*$|\n\s*$/.test(avant);
/**
 * Insère ce qui a été dicté dans un champ à la place de la sélection [debut, fin] : { valeur, curseur }.
 * Espace avant si le texte précédent ne finit pas par une espace ou un retour ; majuscule en début de phrase (alphabet latin).
 */
function insererDictee(valeur, debut, fin, dicte, langue = "fr") {
  const v = String(valeur ?? ""), a = Math.max(0, Math.min(debut ?? v.length, v.length)), b = Math.max(a, Math.min(fin ?? a, v.length));
  let ajout = appliquerCommandesDictee(dicte, langue); if (!ajout) return { valeur: v, curseur: b };
  const avant = v.slice(0, a), apres = v.slice(b);
  if (langue !== "ar") { // majuscule en début de phrase, y compris à l'intérieur de ce qui vient d'être dicté
    const loc = LANGUES_DICTEE[langue] || "fr-FR";
    if (finDePhrase(avant)) ajout = ajout.charAt(0).toLocaleUpperCase(loc) + ajout.slice(1);
    ajout = ajout.replace(/([.!?…][ \t]+|\n)(\p{Ll})/gu, (m, s, c) => s + c.toLocaleUpperCase(loc));
  }
  const espaceAvant = avant && !/\s$/.test(avant) && !PONCTUATION_DICTEE.test(ajout) ? " " : "";
  const espaceApres = apres && !/^\s/.test(apres) && !/[\s\n]$/.test(ajout) && !PONCTUATION_DICTEE.test(apres) ? " " : "";
  const insere = `${espaceAvant}${ajout}${espaceApres}`;
  return { valeur: avant + insere + apres, curseur: a + insere.length - espaceApres.length };
}
