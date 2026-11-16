"use strict";
/* ============================================================
   Lecture d'une demande de transport collée (e-mail, WhatsApp, SMS) — logique pure, testée, sans réseau ni coût.
   Français, anglais, espagnol (et noms de villes en arabe) : villes de chargement et de livraison, dates (« jeudi », « demain »,
   « 20/11 », « 20 novembre », « Nov 20 »), palettes, poids, température, prix et devise, référence du client, marchandise,
   client reconnu par son e-mail, son numéro ou son nom ; demande de prix détectée ; doublon possible signalé.
   Chaque champ lu garde l'extrait du message d'où il vient, pour vérifier d'un coup d'œil.
   Dépend de noyau.js (état S, dates).
   ============================================================ */

const normLecture = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** [nom affiché, pays, alias normalisés…] — villes courantes du corridor Maroc ⇄ Europe. */
const VILLES_LECTURE = [
  ["Agadir", "Maroc", "agadir", "اكادير", "أكادير"], ["Aït Melloul", "Maroc", "ait melloul"], ["Biougra", "Maroc", "biougra"], ["Chtouka", "Maroc", "chtouka"], ["Taroudant", "Maroc", "taroudant"],
  ["Casablanca", "Maroc", "casablanca", "casa", "الدار البيضاء"], ["Mohammedia", "Maroc", "mohammedia"], ["Rabat", "Maroc", "rabat", "الرباط"], ["Kénitra", "Maroc", "kenitra"], ["Larache", "Maroc", "larache"],
  ["Tanger Med", "Maroc", "tanger med", "tangermed", "طنجة المتوسط"], ["Tanger", "Maroc", "tanger", "tangier", "tanger ville", "طنجة"], ["Tétouan", "Maroc", "tetouan"], ["Marrakech", "Maroc", "marrakech", "marrakesh", "مراكش"],
  ["Fès", "Maroc", "fes", "fez", "فاس"], ["Meknès", "Maroc", "meknes", "مكناس"], ["Oujda", "Maroc", "oujda"], ["Nador", "Maroc", "nador"], ["Berkane", "Maroc", "berkane"], ["El Jadida", "Maroc", "el jadida"], ["Safi", "Maroc", "safi"],
  ["Laâyoune", "Maroc", "laayoune"], ["Dakhla", "Maroc", "dakhla"],
  ["Algeciras", "Espagne", "algeciras", "algesiras", "الجزيرة الخضراء"], ["Madrid", "Espagne", "madrid", "mercamadrid", "مدريد"], ["Barcelone", "Espagne", "barcelone", "barcelona", "mercabarna", "برشلونة"], ["Valence", "Espagne", "valencia"], ["Murcie", "Espagne", "murcie", "murcia"],
  ["Almería", "Espagne", "almeria"], ["Séville", "Espagne", "seville", "sevilla"], ["Malaga", "Espagne", "malaga"], ["Saragosse", "Espagne", "saragosse", "zaragoza"], ["Bilbao", "Espagne", "bilbao"], ["Alicante", "Espagne", "alicante"],
  ["Tarragone", "Espagne", "tarragone", "tarragona"], ["Irun", "Espagne", "irun"], ["La Jonquera", "Espagne", "la jonquera", "jonquera"], ["Huelva", "Espagne", "huelva"], ["Grenade", "Espagne", "grenade", "granada"],
  ["Perpignan", "France", "perpignan", "saint charles", "st charles", "بربينيان"], ["Rungis", "France", "rungis"], ["Paris", "France", "paris", "باريس"], ["Lyon", "France", "lyon"], ["Marseille", "France", "marseille"], ["Toulouse", "France", "toulouse"],
  ["Bordeaux", "France", "bordeaux"], ["Lille", "France", "lille"], ["Nantes", "France", "nantes"], ["Montpellier", "France", "montpellier"], ["Avignon", "France", "avignon"], ["Cavaillon", "France", "cavaillon"],
  ["Châteaurenard", "France", "chateaurenard"], ["Strasbourg", "France", "strasbourg"], ["Le Boulou", "France", "le boulou", "boulou"], ["Sète", "France", "sete"],
  ["Francfort", "Allemagne", "francfort", "frankfurt"], ["Hambourg", "Allemagne", "hambourg", "hamburg"], ["Munich", "Allemagne", "munich", "munchen"], ["Cologne", "Allemagne", "cologne", "koln"], ["Düsseldorf", "Allemagne", "dusseldorf"],
  ["Berlin", "Allemagne", "berlin"], ["Stuttgart", "Allemagne", "stuttgart"], ["Rotterdam", "Pays-Bas", "rotterdam"], ["Amsterdam", "Pays-Bas", "amsterdam"], ["Anvers", "Belgique", "anvers", "antwerpen", "antwerp"],
  ["Bruxelles", "Belgique", "bruxelles", "brussels"], ["Milan", "Italie", "milan", "milano"], ["Turin", "Italie", "turin", "torino"], ["Vérone", "Italie", "verone", "verona"], ["Rome", "Italie", "rome", "roma"],
  ["Lisbonne", "Portugal", "lisbonne", "lisboa", "lisbon"], ["Porto", "Portugal", "porto"], ["Londres", "Royaume-Uni", "londres", "london"],
];
const MOIS_LECTURE = { janvier: 1, janv: 1, january: 1, jan: 1, enero: 1, fevrier: 2, fevr: 2, february: 2, feb: 2, febrero: 2, mars: 3, march: 3, mar: 3, marzo: 3, avril: 4, april: 4, apr: 4, avr: 4, abril: 4, mai: 5, may: 5, mayo: 5,
  juin: 6, june: 6, jun: 6, junio: 6, juillet: 7, juil: 7, july: 7, jul: 7, julio: 7, aout: 8, august: 8, aug: 8, agosto: 8, septembre: 9, sept: 9, september: 9, sep: 9, septiembre: 9, octobre: 10, oct: 10, october: 10, octubre: 10,
  novembre: 11, nov: 11, november: 11, noviembre: 11, decembre: 12, dec: 12, december: 12, diciembre: 12 };
const JOURS_LECTURE = { dimanche: 0, sunday: 0, domingo: 0, lundi: 1, monday: 1, lunes: 1, mardi: 2, tuesday: 2, martes: 2, mercredi: 3, wednesday: 3, miercoles: 3, jeudi: 4, thursday: 4, jueves: 4, vendredi: 5, friday: 5, viernes: 5, samedi: 6, saturday: 6, sabado: 6 };
const MOTS_CHARGEMENT = /(chargement|charger|charge le|enlevement|enlever|ramasse|depart|pick ?up|loading|load|collect|carga|cargar|recogida|recoger|salida|origine|origin|origen|desde|from|من|شحن)\s*\W{0,3}[^.\n]{0,25}$/;
const MOTS_LIVRAISON = /(livraison|livrer|livre le|dechargement|decharger|arrivee|destination|delivery|deliver|unloading|unload|entrega|entregar|descarga|destino|hasta|hacia|to|vers|pour|\u0627\u0655?\u0644\u0649|\u0627\u0644\u0649|تسليم)\s*\W{0,3}[^.\n]{0,25}$/;
const MARCHANDISES_LECTURE = [["clementine", "Clémentines"], ["mandarin", "Mandarines"], ["orange", "Oranges"], ["agrume", "Agrumes"], ["citrus", "Agrumes"], ["citrico", "Agrumes"], ["tomate", "Tomates"], ["tomato", "Tomates"],
  ["poivron", "Poivrons"], ["pimiento", "Poivrons"], ["pepper", "Poivrons"], ["courgette", "Courgettes"], ["calabacin", "Courgettes"], ["concombre", "Concombres"], ["pepino", "Concombres"], ["haricot", "Haricots verts"], ["judia", "Haricots verts"],
  ["fraise", "Fraises"], ["strawberr", "Fraises"], ["fresa", "Fraises"], ["framboise", "Framboises"], ["raspberr", "Framboises"], ["myrtille", "Myrtilles"], ["blueberr", "Myrtilles"], ["arandano", "Myrtilles"], ["avocat", "Avocats"], ["avocado", "Avocats"], ["aguacate", "Avocats"],
  ["pasteque", "Pastèques"], ["watermelon", "Pastèques"], ["sandia", "Pastèques"], ["melon", "Melons"], ["pomme de terre", "Pommes de terre"], ["potato", "Pommes de terre"], ["patata", "Pommes de terre"], ["oignon", "Oignons"], ["onion", "Oignons"], ["cebolla", "Oignons"],
  ["poisson", "Poisson"], ["sardine", "Sardines"], ["fish", "Poisson"], ["pescado", "Poisson"], ["textile", "Textile"], ["confection", "Confection textile"], ["vetement", "Vêtements"], ["garment", "Vêtements"], ["ropa", "Vêtements"],
  ["cablage", "Câblage automobile"], ["piece auto", "Pièces automobiles"], ["pieces auto", "Pièces automobiles"], ["auto parts", "Pièces automobiles"], ["emballage", "Emballages"], ["packaging", "Emballages"], ["envase", "Emballages"], ["carton", "Cartons"],
  ["electromenager", "Électroménager"], ["meuble", "Meubles"], ["furniture", "Meubles"], ["ceramique", "Céramique"], ["conserve", "Conserves"], ["huile d'olive", "Huile d'olive"], ["olive oil", "Huile d'olive"], ["legume", "Légumes"], ["vegetable", "Légumes"], ["verdura", "Légumes"],
  ["fruit", "Fruits"], ["fruta", "Fruits"]];

const isoJour = (d) => d.toISOString().slice(0, 10);
const plusJours = (iso, n) => isoJour(new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000));
const nombreLu = (s) => { const t = String(s).replace(/\s/g, ""); if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, "")); return Number(t.replace(",", ".")); };
/** Contexte de chargement ou de livraison d'après les mots qui précèdent la position i. */
function contexteLecture(n, i) { const avant = n.slice(Math.max(0, i - 45), i); const c = MOTS_CHARGEMENT.exec(avant), l = MOTS_LIVRAISON.exec(avant); if (c && l) return c.index > l.index ? "chargement" : "livraison"; return c ? "chargement" : l ? "livraison" : ""; }
/** Extrait autour d'une position, coupé aux espaces (jamais au milieu d'un mot). */
const extrait = (texte, i, long) => { let d = Math.max(0, i - 14), f = Math.min(texte.length, i + long + 14); while (d > 0 && d > i - 30 && !/\s/.test(texte[d - 1])) d--; while (f < texte.length && f < i + long + 30 && !/\s/.test(texte[f])) f++; return texte.slice(d, f).replace(/\s+/g, " ").replace(/[,;:]$/, "").trim(); };

/** Villes citées, dans l'ordre du texte : [{ nom, pays, i, l, ctx }]. Villes de l'historique des commandes en plus. */
function villesDuTexte(texte) {
  const n = normLecture(texte), connues = [...VILLES_LECTURE];
  for (const c of S.commandes || []) for (const [v, p] of [[c.origine, c.paysOrigine], [c.destination, c.paysDest]]) if (v && !connues.some((x) => x.slice(2).includes(normLecture(v)))) connues.push([v, p || "Autre", normLecture(v)]);
  const alias = connues.flatMap(([nom, pays, ...a]) => a.map((x) => ({ nom, pays, a: normLecture(x) }))).sort((x, y) => y.a.length - x.a.length), pris = [], r = [];
  for (const { nom, pays, a } of alias) {
    const re = new RegExp(`(^|[^a-z\\u0621-\\u064a])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z\\u0621-\\u064a])`, "g"); let m;
    while ((m = re.exec(n))) { const i = m.index + m[1].length, l = a.length; if (pris.some(([d, f]) => i < f && i + l > d)) continue; pris.push([i, i + l]); r.push({ nom, pays, i, l, ctx: contexteLecture(n, i) }); }
  }
  return r.sort((a, b) => a.i - b.i).filter((x, k, l) => l.findIndex((y) => y.nom === x.nom) === k);
}
/** Dates citées : [{ iso, i, l, ctx }]. aujourdhui : date ISO du jour du message. */
function datesDuTexte(texte, aujourdhui = today()) {
  const n = normLecture(texte), r = [], an = Number(aujourdhui.slice(0, 4)), moisAuj = Number(aujourdhui.slice(5, 7));
  const ajout = (j, mo, a, i, l) => { if (!(j >= 1 && j <= 31 && mo >= 1 && mo <= 12)) return; let y = a ? (a < 100 ? 2000 + a : a) : an; let iso = `${y}-${String(mo).padStart(2, "0")}-${String(j).padStart(2, "0")}`; if (!a && iso < plusJours(aujourdhui, -30)) iso = `${y + 1}${iso.slice(4)}`; r.push({ iso, i, l, ctx: contexteLecture(n, i) }); };
  let m;
  const reNum = /(^|[^\d])(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?(?![\d/.]*\s*(?:kg|t\b|€|eur|mad|dh|°))/g; while ((m = reNum.exec(n))) ajout(+m[2], +m[3], m[4] ? +m[4] : 0, m.index + m[1].length, m[0].length - m[1].length);
  const reTiret = /(^|[^\d])(\d{1,2})-(\d{1,2})-(\d{4})/g; while ((m = reTiret.exec(n))) ajout(+m[2], +m[3], +m[4], m.index + m[1].length, m[0].length - m[1].length);
  const noms = Object.keys(MOIS_LECTURE).sort((a, b) => b.length - a.length).join("|");
  const reJM = new RegExp(`(^|[^\\d])(\\d{1,2})(?:er|st|nd|rd|th)?\\s+(?:de\\s+)?(${noms})\\.?(?:\\s+(?:de\\s+)?(\\d{4}))?(?![a-z])`, "g"); while ((m = reJM.exec(n))) ajout(+m[2], MOIS_LECTURE[m[3]], m[4] ? +m[4] : 0, m.index + m[1].length, m[0].length - m[1].length);
  const reMJ = new RegExp(`(^|[^a-z])(${noms})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?![\\d])`, "g"); while ((m = reMJ.exec(n))) if (!r.some((x) => Math.abs(x.i - m.index) < 6)) ajout(+m[3], MOIS_LECTURE[m[2]], m[4] ? +m[4] : 0, m.index + m[1].length, m[0].length - m[1].length);
  const relatifs = [[/(^|[^a-z])(apres[- ]demain|day after tomorrow|pasado manana)(?![a-z])/g, 2], [/(^|[^a-z])(aujourd'?hui|today|hoy)(?![a-z])/g, 0], [/(^|[^a-z])(demain|tomorrow|manana)(?![a-z])/g, 1]];
  for (const [re, d] of relatifs) while ((m = re.exec(n))) { const i = m.index + m[1].length; if (!r.some((x) => i >= x.i && i < x.i + x.l)) r.push({ iso: plusJours(aujourdhui, d), i, l: m[2].length, ctx: contexteLecture(n, i) }); }
  const reJour = new RegExp(`(^|[^a-z])(${Object.keys(JOURS_LECTURE).join("|")})(?:\\s+prochain|\\s+next|\\s+que viene)?(?![a-z])`, "g");
  while ((m = reJour.exec(n))) { const i = m.index + m[1].length; if (r.some((x) => Math.abs(x.i - i) < 14)) continue; const auj = new Date(aujourdhui + "T00:00:00Z").getUTCDay(); let d = (JOURS_LECTURE[m[2]] - auj + 7) % 7; if (d === 0) d = 7; r.push({ iso: plusJours(aujourdhui, d), i, l: m[0].length - m[1].length, ctx: contexteLecture(n, i) }); }
  const reLe = /(^|[^a-z])(?:le|el|the)\s+(\d{1,2})(?:er|th)?(?![\d/.:hk])(?!\s*(?:palette|pal|kg|t\b|tonne|€|eur|mad|dh|°|h\b))/g;
  while ((m = reLe.exec(n))) { const i = m.index + m[1].length; if (r.some((x) => Math.abs(x.i - i) < 8)) continue; const j = +m[2]; let mo = moisAuj, y = an; if (`${y}-${String(mo).padStart(2, "0")}-${String(j).padStart(2, "0")}` < aujourdhui) { mo++; if (mo > 12) { mo = 1; y++; } } ajout(j, mo, y, i, m[0].length - m[1].length); }
  return r.sort((a, b) => a.i - b.i);
}

/**
 * Lit une demande collée. Renvoie { champs, sources, manquants, demandePrix, doublon, client: { id, email, tel, nom }, alertes }.
 * champs : clientId, marchandise, origine, paysOrigine, destination, paysDest, dateChargement, dateLivraison, poids, palettes, prix, devise, refClient, tempMin, tempMax.
 */
function lireDemande(texte, { aujourdhui = today() } = {}) {
  const t = String(texte || "").slice(0, 20000), n = normLecture(t), champs = {}, sources = {}, alertes = [];
  const noter = (k, v, i, l) => { champs[k] = v; if (i !== undefined) sources[k] = extrait(t, i, l || 0); };
  // villes
  const villes = villesDuTexte(t), sansPort = villes.filter((v) => v.nom !== "Tanger Med" && v.nom !== "Algeciras"), liste = sansPort.length >= 2 ? sansPort : villes;
  let o = liste.find((v) => v.ctx === "chargement"), d = liste.find((v) => v.ctx === "livraison" && v !== o);
  if (!o && !d && liste.length >= 2) { o = liste[0]; d = liste[1]; }
  else if (o && !d) d = liste.find((v) => v !== o); else if (d && !o) o = liste.find((v) => v !== d);
  if (o) { noter("origine", o.nom, o.i, o.l); champs.paysOrigine = o.pays; }
  if (d) { noter("destination", d.nom, d.i, d.l); champs.paysDest = d.pays; }
  // dates
  const dates = datesDuTexte(t, aujourdhui);
  let dc = dates.find((x) => x.ctx === "chargement"), dl = dates.find((x) => x.ctx === "livraison" && x !== dc);
  if (!dc && dates.length) dc = dates.find((x) => x !== dl) || null;
  if (!dl && dates.length > 1) dl = dates.find((x) => x !== dc && (!dc || x.iso >= dc.iso)) || null;
  if (dc) noter("dateChargement", dc.iso, dc.i, dc.l);
  if (dl) noter("dateLivraison", dl.iso, dl.i, dl.l);
  if (dc && dl && dl.iso < dc.iso) alertes.push("La livraison lue tombe avant le chargement : vérifiez les dates.");
  // palettes, poids, température
  let m = /(\d{1,3})\s*(?:x\s*)?(?:euro[- ]?)?(palettes?|pal\b|pals\b|pallets?|palets?|pales?|plts?|باليط|بالية)/.exec(n); if (m) noter("palettes", Number(m[1]), m.index, m[0].length);
  m = /(\d{1,3}(?:[ .,]\d{3})+|\d+(?:[.,]\d+)?)\s*(kgs?|kilos?|tonnes?|tons?|tn|t)(?![a-z])/.exec(n);
  if (m) { const v = nombreLu(m[1]), kg = /^(t|tn|tonnes?|tons?)$/.test(m[2]) ? v * 1000 : v; if (kg > 0 && kg <= 45000) noter("poids", Math.round(kg), m.index, m[0].length); }
  m = /([+-]?\d{1,2})\s*(?:°\s*c?|º\s*c?)?\s*(?:a|à|to|-|\/|et|y|and)\s*([+-]?\d{1,2})\s*(?:°|º)\s*c?/.exec(n);
  if (m) { const a = Number(m[1]), b = Number(m[2]); noter("tempMin", Math.min(a, b), m.index, m[0].length); champs.tempMax = Math.max(a, b); }
  else if ((m = /([+-]\s?\d{1,2}|\d{1,2})\s*(?:°|º)\s*c?(?![a-z])/.exec(n))) { const v = Number(m[1].replace(/\s/g, "")); if (v >= -30 && v <= 25) { noter("tempMin", v, m.index, m[0].length); champs.tempMax = v; } }
  if (champs.tempMin === undefined && /(frigo|reefer|frigorifique|refrigere|refrigerado|frais|fresh|congele|frozen|congelado)/.test(n)) alertes.push("Transport sous température mentionné : consigne de température à préciser.");
  // prix
  const prix = []; const rePrix = /(?:(€|eur|euros?|mad|dh|dhs|dirhams?)\s*(\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,](\d{1,2}))?)|(?:(\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(€|eur\b|euros?\b|mad\b|dh\b|dhs\b|dirhams?\b))/g;
  while ((m = rePrix.exec(n))) { const valeur = nombreLu(m[2] || m[4]) + (m[3] || m[5] ? Number(`0.${m[3] || m[5]}`) : 0), cur = m[1] || m[6], dev = /mad|dh|dirham/.test(cur) ? "MAD" : "EUR"; if (valeur >= 50) prix.push({ valeur, devise: dev, i: m.index, l: m[0].length, pres: /(prix|price|precio|tarif|budget|offre|offer|rate|propos)/.test(n.slice(Math.max(0, m.index - 30), m.index)) }); }
  const p = prix.find((x) => x.pres) || (prix.length === 1 ? prix[0] : null);
  if (p) { noter("prix", Math.round(p.valeur * 100) / 100, p.i, p.l); champs.devise = p.devise; } else if (prix.length > 1) alertes.push(`${prix.length} montants dans le message : choisissez le bon prix.`);
  const demandePrix = !p && /(prix\s*\?|quel (est votre |serait )?(le )?prix|votre (meilleur )?(prix|tarif|offre)|combien|cotation|devis|quote|quotation|best rate|your rate|precio\s*\?|cotizacion|presupuesto|cuanto)/.test(n);
  // référence du client
  m = /(?:r[eé]f(?:[eé]rence)?\.?|\bpo\b|bon de commande|order(?: no\.?| number| n°)?|pedido|n°\s*commande)\s*(?:n°|no\.?|nr\.?|#|:)?\s*([a-z0-9][a-z0-9\-/]{2,24})/i.exec(t);
  if (m && /\d/.test(m[1])) noter("refClient", m[1].toUpperCase(), m.index, m[0].length);
  // marchandise
  m = /\d+\s*(?:palettes?|pallets?|palets?|pales?)\s+(?:de|of|con)\s+([a-zà-ÿ' ]{3,40}?)(?=[,.;\n]|\s+(?:a|à|de|from|desde|pour|le|el|the|chargement|livraison|\d))/i.exec(t);
  const mot = MARCHANDISES_LECTURE.find(([k]) => n.includes(k));
  if (m) noter("marchandise", m[1].trim().replace(/^./, (c) => c.toUpperCase()) + (champs.palettes ? `, ${champs.palettes} palettes` : ""), m.index, m[0].length);
  else if (mot) noter("marchandise", mot[1] + (champs.palettes ? `, ${champs.palettes} palettes` : ""), n.indexOf(mot[0]), mot[0].length);
  // client : e-mail, téléphone, nom
  const emails = [...t.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)].map((x) => x[0].toLowerCase()), tels = [...t.matchAll(/(?:\+|00)?\d[\d .-]{8,16}\d/g)].map((x) => x[0].replace(/\D/g, "")).filter((x) => x.length >= 9);
  const propres = new Set((S.entreprise?.email ? [S.entreprise.email.toLowerCase()] : []));
  const emailClient = emails.find((e) => !propres.has(e)) || "", domaine = emailClient.split("@")[1] || "", publics = /^(gmail|hotmail|outlook|yahoo|live|icloud|aol|menara|gmx)\./;
  let client = (S.clients || []).find((c) => c.email && emails.includes(c.email.toLowerCase()))
    || (domaine && !publics.test(domaine) && (S.clients || []).find((c) => c.email && c.email.toLowerCase().endsWith("@" + domaine)))
    || (S.clients || []).find((c) => c.tel && tels.some((x) => x.slice(-9) === String(c.tel).replace(/\D/g, "").slice(-9)))
    || (S.clients || []).filter((c) => c.nom && normLecture(c.nom).length >= 4 && n.includes(normLecture(c.nom))).sort((a, b) => b.nom.length - a.nom.length)[0] || null;
  if (client) champs.clientId = client.id;
  const nomExp = (/^(?:de|from|von|de :|from:)\s*:?\s*"?([^<"\n]{3,60}?)"?\s*<[^>]+>/im.exec(t) || [])[1] || "";
  // doublon
  const doublon = champs.origine && champs.destination ? (S.commandes || []).find((c) => c.statut !== "livre" && (!champs.clientId || c.clientId === champs.clientId) && normLecture(c.origine) === normLecture(champs.origine) && normLecture(c.destination) === normLecture(champs.destination) && (!champs.dateChargement || !c.dateChargement || Math.abs(joursEntre(c.dateChargement, champs.dateChargement)) <= 2)) || null : null;
  const manquants = [["clientId", "client"], ["origine", "ville de chargement"], ["destination", "ville de livraison"], ["dateChargement", "date de chargement"], ["prix", "prix"]].filter(([k]) => champs[k] === undefined).map(([, l]) => l);
  return { champs, sources, manquants, demandePrix, doublon, client: { id: client?.id || "", email: emailClient, tel: tels[0] || "", nom: nomExp.trim() }, alertes };
}
