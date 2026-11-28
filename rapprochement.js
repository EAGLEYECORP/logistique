"use strict";
/* ============================================================
   Rapprochement bancaire — logique pure, testée.
   Le relevé du compte (CSV, Excel .xlsx, ou le « .xls » en tableau HTML de certaines banques) est lu ici :
   · la ligne d'en-tête est cherchée sous les lignes d'information du compte ; colonnes reconnues par leur nom (date d'opération,
     libellé, débit, crédit, montant signé ou avec un sens, solde) ; nombres « 12 500,00 », « 12.500,00 », « 1,250.00 » ;
     dates jj/mm/aaaa, aaaa-mm-jj, jj/mm/aa, ou numéro de jour Excel ;
   · chaque crédit est rapproché des factures à encaisser :
       sûr      — numéro de facture dans le libellé et montant exact (une ou plusieurs factures), ou client reconnu dans le libellé
                  et une seule facture (ou un seul groupe de factures, jusqu'à 4) de ce montant ;
       probable — numéro cité mais montant un peu plus bas (frais bancaires ?) ou différent, une seule facture de ce montant
                  sans client reconnu, facture en euros payée en dirhams ;
       plusieurs — plusieurs factures possibles : à choisir ;
       aucune   — crédit sans facture (acompte, autre recette) ;
   · rien n'est marqué payé sans validation ; une ligne déjà rapprochée (relevé réimporté) est reconnue et écartée.
   Interface : rapprochement_ui.js. Dépend de noyau.js (S, totauxFacture, num, dateISO).
   ============================================================ */

const normBanque = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/n°/g, " no ").replace(/[^a-z0-9]+/g, " ").trim();

/** « 12 500,00 », « 12.500,00 », « 1,250.00 », « -1 234,56 », « (45,00) », « 300,00 CR » → nombre (NaN si illisible). */
function nombreBancaire(v) {
  if (typeof v === "number") return v;
  let s = String(v ?? "").replace(/[\s  ']/g, "").replace(/(mad|dhs|dh|eur|€|\$)/gi, "");
  if (!s) return NaN;
  let signe = 1;
  if (/^\(.*\)$/.test(s)) { signe = -1; s = s.slice(1, -1); }
  if (/(db|d|-)$/i.test(s) && !/^-/.test(s)) { signe = -1; s = s.replace(/(db|d|-)$/i, ""); } else s = s.replace(/(cr|c)$/i, "");
  if (s.startsWith("-")) { signe *= -1; s = s.slice(1); } else if (s.startsWith("+")) s = s.slice(1);
  const v1 = s.lastIndexOf(","), p1 = s.lastIndexOf(".");
  if (v1 >= 0 && p1 >= 0) s = v1 > p1 ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (v1 >= 0) s = /,\d{3}$/.test(s) && (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return signe * Number(s);
}
const MOIS_BANQUE = { janv: 1, jan: 1, fev: 2, feb: 2, mars: 3, mar: 3, avr: 4, apr: 4, mai: 5, may: 5, juin: 6, jun: 6, juil: 7, jul: 7, aout: 8, aug: 8, sept: 9, sep: 9, oct: 10, nov: 11, dec: 12 };
/** Date d'une ligne de relevé → « AAAA-MM-JJ » ("" si illisible). Les numéros de jour Excel (45000…) sont acceptés. */
function dateBancaire(v) {
  const s = String(v ?? "").trim(), d2 = (n) => String(n).padStart(2, "0");
  const ok = (a, m, j) => { const d = new Date(Date.UTC(a, m - 1, j)); return a >= 2000 && a <= 2100 && d.getUTCMonth() === m - 1 && d.getUTCDate() === j ? `${a}-${d2(m)}-${d2(j)}` : ""; };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return ok(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})\b/); if (m) return ok(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = normBanque(s).match(/^(\d{1,2}) ([a-z]{3,5})[a-z]* (\d{4})$/); if (m && MOIS_BANQUE[m[2]]) return ok(+m[3], MOIS_BANQUE[m[2]], +m[1]);
  if (/^\d{5}(\.\d+)?$/.test(s) && +s > 36000 && +s < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000).toISOString().slice(0, 10);
  return "";
}

/* ---------- lecture des fichiers ---------- */
/** CSV (séparateur ; tabulation ou virgule, choisi sur l'ensemble des premières lignes, guillemets compris) → lignes de cellules. */
function rangeesCSV(texte) {
  const t = String(texte ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const decouper = (l, sep) => { const r = []; let cur = "", q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === sep) { r.push(cur.trim()); cur = ""; } else cur += c; } r.push(cur.trim()); return r; };
  const lignes = t.split("\n").filter((l) => l.trim()), echantillon = lignes.slice(0, 40);
  const score = (sep) => { const n = echantillon.map((l) => decouper(l, sep).length).sort((a, b) => a - b); return n[Math.floor(n.length * 0.75)] || 0; };
  const sep = [";", "\t", ","].sort((a, b) => score(b) - score(a))[0];
  return lignes.map((l) => decouper(l, sep));
}
const XML_ENTITES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const texteXml = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_ENTITES[e] ?? m));
/** Feuille Excel (xl/worksheets/sheetN.xml et xl/sharedStrings.xml d'un .xlsx) → lignes de cellules (texte ; nombres tels quels). */
function rangeesXlsx(feuille, chaines = "") {
  const partagees = [...String(chaines).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => texteXml(t[1])).join(""));
  const colonne = (ref) => { let n = 0; for (const c of String(ref).replace(/\d+/g, "").toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };
  const r = [];
  for (const m of String(feuille).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const ligne = [];
    for (const c of m[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], corps = c[2] || "", ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1], type = (attrs.match(/\bt="(\w+)"/) || [])[1] || "n";
      const v = (corps.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      const val = type === "s" ? partagees[Number(v)] ?? "" : type === "inlineStr" ? texteXml((corps.match(/<is>([\s\S]*?)<\/is>/) || [])[1]) : texteXml(v ?? "");
      const i = ref ? colonne(ref) : ligne.length; while (ligne.length < i) ligne.push(""); ligne[i] = String(val).trim();
    }
    if (ligne.some((x) => x !== "")) r.push(ligne);
  }
  return r;
}
/** Tableau HTML (le « .xls » de certaines banques est une page web) → lignes de cellules. */
function rangeesHtml(html) {
  return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => texteXml(c[1].replace(/<br\s*\/?>/gi, " ")).replace(/\s+/g, " ").trim())).filter((l) => l.some(Boolean));
}

/* ---------- colonnes et lignes du relevé ---------- */
const COLONNES_BANQUE = {
  date: ["date operation", "date d operation", "date de l operation", "date opera", "date comptable", "date compta", "date", "fecha operacion", "fecha", "booking date", "transaction date", "jour"],
  valeur: ["date valeur", "date de valeur", "valeur", "fecha valor", "value date"],
  libelle: ["libelle", "libelle operation", "libelle de l operation", "designation", "description", "operation", "nature", "concepto", "detalle", "details", "narrative", "motif"],
  complement: ["libelle complementaire", "complement", "information complementaire", "reference", "ref", "referencia", "beneficiaire", "donneur d ordre", "tiers", "observations"],
  debit: ["debit", "debits", "montant debit", "debe", "cargo", "withdrawal", "sortie"],
  credit: ["credit", "credits", "montant credit", "haber", "abono", "deposit", "entree"],
  montant: ["montant", "importe", "amount", "somme", "mouvement"],
  sens: ["sens", "d c", "type", "debit credit"],
  solde: ["solde", "saldo", "balance", "solde comptable"],
};
/** Colonnes d'une ligne d'en-tête : { date, valeur, libelle, complements: [], debit, credit, montant, sens, solde } (-1 si absente). */
function colonnesReleve(entetes) {
  const h = entetes.map(normBanque), pris = new Set();
  const trouver = (cands, exact = true) => { for (const c of cands) { const i = h.findIndex((x, k) => !pris.has(k) && (exact ? x === c : x.startsWith(c) || (c.length > 4 && x.includes(c)))); if (i >= 0) { pris.add(i); return i; } } return -1; };
  const col = {};
  for (const k of ["valeur", "date", "debit", "credit", "solde", "libelle", "montant", "sens"]) col[k] = trouver(COLONNES_BANQUE[k]);
  for (const k of ["valeur", "date", "debit", "credit", "solde", "libelle", "montant", "sens"]) if (col[k] < 0) col[k] = trouver(COLONNES_BANQUE[k], false);
  col.complements = h.map((x, i) => (!pris.has(i) && COLONNES_BANQUE.complement.some((c) => x === c || x.startsWith(c)) ? i : -1)).filter((i) => i >= 0);
  if (col.date < 0 && col.valeur >= 0) { col.date = col.valeur; col.valeur = -1; }
  return col;
}
const empreinteBanque = (t) => { let h = 0x811c9dc5; for (const c of String(t)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
/**
 * Lignes de cellules d'un relevé → { ok, lignes: [{ id, date, valeur, libelle, montant, solde }], soldeFinal, entete, colonnes, rejetes, erreur }.
 * montant : positif pour un crédit (argent reçu), négatif pour un débit. id : empreinte stable (même relevé réimporté = mêmes id).
 */
function tableauReleve(rangees) {
  let iEntete = -1, col = null;
  for (let i = 0; i < Math.min(rangees.length, 40); i++) {
    const c = colonnesReleve(rangees[i]);
    if (c.date >= 0 && (c.credit >= 0 || c.montant >= 0) && (c.libelle >= 0 || c.complements.length)) { iEntete = i; col = c; break; }
  }
  if (iEntete < 0) return { ok: false, lignes: [], soldeFinal: null, entete: rangees.find((l) => l.length > 2) || [], colonnes: null, rejetes: 0, erreur: "En-tête du relevé introuvable : il faut au moins une colonne « Date », une colonne « Crédit » (ou « Montant ») et un « Libellé »." };
  const lignes = [], vus = new Map(); let rejetes = 0;
  for (const l of rangees.slice(iEntete + 1)) {
    const date = dateBancaire(l[col.date]); if (!date) continue; // sans date : solde initial, total, ligne d'information — pas une opération
    let montant = NaN;
    if (col.credit >= 0 || col.debit >= 0) {
      const cr = col.credit >= 0 ? nombreBancaire(l[col.credit]) : NaN, db = col.debit >= 0 ? nombreBancaire(l[col.debit]) : NaN;
      if (Number.isFinite(cr) && cr !== 0) montant = Math.abs(cr); else if (Number.isFinite(db) && db !== 0) montant = -Math.abs(db);
      else if (col.montant >= 0) montant = nombreBancaire(l[col.montant]);
    } else montant = nombreBancaire(l[col.montant]);
    if (Number.isFinite(montant) && col.sens >= 0 && col.credit < 0) { const s = normBanque(l[col.sens]); if (["d", "db", "dr"].includes(s) || /^(debit|debe|cargo)\b/.test(s)) montant = -Math.abs(montant); else if (["c", "cr"].includes(s) || /^(credit|haber|abono)\b/.test(s)) montant = Math.abs(montant); }
    if (!Number.isFinite(montant) || montant === 0) { rejetes++; continue; }
    const libelle = [col.libelle, ...col.complements].filter((i) => i >= 0 && l[i]).map((i) => l[i]).join(" · ").replace(/\s+/g, " ").trim().slice(0, 300);
    const solde = col.solde >= 0 ? nombreBancaire(l[col.solde]) : NaN, base = `${date}|${montant.toFixed(2)}|${normBanque(libelle)}`, n = (vus.get(base) || 0) + 1; vus.set(base, n);
    lignes.push({ id: empreinteBanque(`${base}|${n}`), date, valeur: col.valeur >= 0 ? dateBancaire(l[col.valeur]) : "", libelle, montant: Math.round(montant * 100) / 100, solde: Number.isFinite(solde) ? solde : null });
  }
  // solde final : celui de la ligne la plus récente (les relevés vont dans un sens ou dans l'autre)
  const avecSolde = lignes.filter((x) => x.solde !== null), croissant = lignes.length < 2 || lignes[0].date <= lignes[lignes.length - 1].date;
  const dernier = avecSolde.length ? (croissant ? avecSolde[avecSolde.length - 1] : avecSolde[0]) : null;
  return { ok: lignes.length > 0, lignes, soldeFinal: dernier ? { montant: dernier.solde, date: dernier.date } : null, entete: rangees[iEntete], colonnes: col, rejetes, erreur: lignes.length ? "" : "Aucune ligne lisible sous l'en-tête (date ou montant illisible)." };
}

/* ---------- rapprochement ---------- */
const MOTS_GENERIQUES_CLIENT = new Set("sarl sarlau sa sas sasu ste societe soc company co ltd llc gmbh sl slu srl spa bv nv group groupe grupo international intl transport transports transportes logistique logistics logistica trading import export exportation maroc morocco marocaine france espana espagne spain distribution services global industries the des les du de la le et and y del en".split(" "));
/** Le client nommé dans un libellé de virement (« VIR RECU DE SOUSS EXPORT SARL », éventuellement tronqué), ou null. */
function clientDuLibelle(libelle) {
  const mots = normBanque(libelle).split(" ").filter(Boolean); if (!mots.length) return null;
  const trouve = (tok) => mots.some((m) => m === tok || (m.length >= 4 && tok.startsWith(m) && m === mots[mots.length - 1]) || (tok.length >= 6 && m.startsWith(tok)));
  // le client retenu a tous ses mots distinctifs dans le libellé, et strictement plus de mots trouvés que tout autre client
  // (« VIR RECU SOUSS » avec « Souss Export » et « Souss Primeurs » : aucun des deux)
  const scores = (S.clients || []).map((c) => {
    const toks = normBanque(c.nom).split(" ").filter((t) => t.length >= 3), distinctifs = toks.filter((t) => !MOTS_GENERIQUES_CLIENT.has(t)), utiles = distinctifs.length ? distinctifs : toks.filter((t) => t.length >= 4);
    return { c, complet: utiles.length > 0 && utiles.every(trouve) && utiles.some((t) => t.length >= 4), trouves: toks.filter(trouve).length };
  }).filter((x) => x.trouves > 0).sort((a, b) => b.trouves - a.trouves);
  const premier = scores.find((x) => x.complet);
  return premier && scores.every((x) => x === premier || x.trouves < premier.trouves) ? premier.c : null;
}
/** La facture est-elle citée dans le libellé ? (« FAC-2026-0012 », « FAC 2026 12 », « FACT N° 12/2026 », « F2026-0012 ») */
function factureCitee(f, libelle) {
  const m = String(f.numero || "").match(/(\d{4})\D*(\d+)$/); if (!m) return false;
  const t = ` ${normBanque(libelle)} `, a = m[1], n = String(Number(m[2]));
  return new RegExp(`\\bf(?:a|ac|act|acture|ct)?\\s?(?:no\\s)?${a}\\s?0*${n}\\b`).test(t) || new RegExp(`\\bf(?:a|ac|act|acture|ct)?\\s?(?:no\\s)?0*${n}\\s${a}\\b`).test(t) || t.includes(` ${normBanque(f.numero)} `);
}
/** Mode de paiement d'après le libellé. */
const modeDuLibelle = (l) => { const t = normBanque(l); return /\b(chq|cheque|cheques|remise ch|rem ch)\b/.test(t) ? "cheque" : /\b(lcn|effet|effets|traite)\b/.test(t) ? "lcn" : /\b(especes|esp|versement esp)\b/.test(t) ? "especes" : "virement"; };
const arrondiBanque = (x) => Math.round(x * 100) / 100;

/**
 * Propose un rapprochement pour chaque crédit du relevé.
 * Renvoie { propositions: [{ ligne, statut: "sur"|"probable"|"plusieurs"|"aucune"|"deja", factureIds, choix: [[ids]], raison, ecart, mode }], debits, credits }.
 * devise : celle du compte (MAD ou EUR).
 */
function rapprocherReleve(lignes, { devise = "MAD" } = {}) {
  const deja = new Set((S.rapprochements || []).map((r) => r.ligneId)), taux = num(S.params?.tauxEUR, 10.8);
  const ouvertes = (S.factures || []).filter((f) => f.statut !== "payee");
  const montantCompte = (f) => { const t = arrondiBanque(totauxFacture(f).ttc); if ((f.devise || "MAD") === devise) return { m: t, change: false }; return { m: arrondiBanque(devise === "MAD" ? t * taux : t / taux), change: true }; };
  const egal = (a, b) => Math.abs(a - b) < 0.015;
  const frais = (attendu, recu) => { const e = arrondiBanque(attendu - recu); return e > 0 && e <= Math.max(attendu * 0.015, devise === "EUR" ? 35 : 350) ? e : 0; };
  const credits = lignes.filter((l) => l.montant > 0), propositions = [];
  for (const ligne of credits) {
    const base = { ligne, factureIds: [], choix: [], raison: "", ecart: 0, mode: modeDuLibelle(ligne.libelle) };
    if (deja.has(ligne.id)) { propositions.push({ ...base, statut: "deja", raison: "déjà rapprochée lors d'un import précédent" }); continue; }
    const possibles = ouvertes.filter((f) => !f.date || f.date <= dateISO(Date.parse(ligne.date) + 7 * 86400000)); // pas de paiement plus d'une semaine avant la facture
    const citees = possibles.filter((f) => factureCitee(f, ligne.libelle)), client = clientDuLibelle(ligne.libelle);
    const somme = (l) => arrondiBanque(l.reduce((s, f) => s + montantCompte(f).m, 0)), change = (l) => l.some((f) => montantCompte(f).change);
    let p = null;
    if (citees.length) {
      const total = somme(citees), e = frais(total, ligne.montant), ref = citees.map((f) => f.numero).join(", ");
      if (egal(total, ligne.montant) && !change(citees)) p = { statut: "sur", force: 0, factureIds: citees.map((f) => f.id), raison: `${ref} cité${citees.length > 1 ? "es" : "e"} dans le libellé, montant exact` };
      else if (change(citees) && Math.abs(total - ligne.montant) <= total * 0.04) p = { statut: "probable", force: 1, factureIds: citees.map((f) => f.id), raison: `${ref} cité, facture en ${devise === "MAD" ? "euros payée en dirhams" : "dirhams payée en euros"} : vérifier le change`, ecart: arrondiBanque(total - ligne.montant) };
      else if (e) p = { statut: "probable", force: 1, factureIds: citees.map((f) => f.id), raison: `${ref} cité, ${fmt(e, 2)} ${devise} de moins : frais bancaires ?`, ecart: e };
      else p = { statut: "probable", force: 5, factureIds: citees.map((f) => f.id), raison: `${ref} cité, mais montant différent (${fmt(total, 2)} attendu) : paiement partiel ?`, ecart: arrondiBanque(total - ligne.montant) };
    }
    if (!p && client) {
      const siennes = possibles.filter((f) => f.clientId === client.id && !montantCompte(f).change).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const exactes = siennes.filter((f) => egal(montantCompte(f).m, ligne.montant));
      if (exactes.length === 1) p = { statut: "sur", force: 2, factureIds: [exactes[0].id], raison: `${client.nom} dans le libellé, une seule facture de ce montant` };
      else if (exactes.length > 1) p = { statut: "plusieurs", force: 6, choix: exactes.map((f) => [f.id]), raison: `${client.nom} : ${exactes.length} factures de ce montant` };
      else {
        const groupes = [], l = siennes.slice(0, 12), n = l.length; // paiement groupé : 2 à 4 factures du client
        for (let masque = 1; masque < 1 << n && groupes.length < 6; masque++) { const g = l.filter((_, i) => masque & (1 << i)); if (g.length >= 2 && g.length <= 4 && egal(somme(g), ligne.montant)) groupes.push(g.map((f) => f.id)); }
        if (groupes.length === 1) p = { statut: "sur", force: 3, factureIds: groupes[0], raison: `${client.nom} dans le libellé, ${groupes[0].length} factures pour ce montant exact` };
        else if (groupes.length > 1) p = { statut: "plusieurs", force: 6, choix: groupes, raison: `${client.nom} : plusieurs groupes de factures font ce montant` };
        else {
          const proches = siennes.filter((f) => frais(montantCompte(f).m, ligne.montant));
          const changees = possibles.filter((f) => f.clientId === client.id && montantCompte(f).change && Math.abs(montantCompte(f).m - ligne.montant) <= montantCompte(f).m * 0.04);
          if (proches.length === 1) { const e = frais(montantCompte(proches[0]).m, ligne.montant); p = { statut: "probable", force: 4, factureIds: [proches[0].id], raison: `${client.nom}, ${fmt(e, 2)} ${devise} de moins que ${proches[0].numero} : frais bancaires ?`, ecart: e }; }
          else if (changees.length === 1) p = { statut: "probable", force: 4, factureIds: [changees[0].id], raison: `${client.nom}, ${changees[0].numero} en ${devise === "MAD" ? "euros payée en dirhams" : "dirhams payée en euros"} (≈ ${fmt(montantCompte(changees[0]).m, 2)} ${devise} au taux des réglages) : vérifier le change`, ecart: arrondiBanque(montantCompte(changees[0]).m - ligne.montant) };
        }
      }
    }
    if (!p) {
      const exactes = possibles.filter((f) => !montantCompte(f).change && egal(montantCompte(f).m, ligne.montant));
      if (exactes.length === 1) p = { statut: "probable", force: 5, factureIds: [exactes[0].id], raison: `seule facture de ce montant (${nomClient(exactes[0].clientId)}), client non reconnu dans le libellé` };
      else if (exactes.length > 1) p = { statut: "plusieurs", force: 7, choix: exactes.map((f) => [f.id]), raison: `${exactes.length} factures de ce montant` };
    }
    propositions.push({ ...base, statut: "aucune", raison: "aucune facture à encaisser ne correspond", ...(p || {}) });
  }
  // une facture ne sert qu'une fois : les preuves les plus fortes d'abord (numéro cité, puis client et montant exact, puis montant seul)
  const prises = new Set();
  for (const p of [...propositions].filter((x) => Number.isFinite(x.force)).sort((a, b) => a.force - b.force)) {
    if (p.factureIds.some((id) => prises.has(id))) Object.assign(p, { statut: "aucune", factureIds: [], raison: "la facture correspondante est déjà rapprochée d'une autre ligne" });
    else if (p.statut === "plusieurs") p.choix = p.choix.filter((g) => !g.some((id) => prises.has(id)));
    else p.factureIds.forEach((id) => prises.add(id));
  }
  return { propositions, debits: lignes.filter((l) => l.montant < 0).length, credits: credits.length };
}
/**
 * Marque payées les factures retenues : [{ ligne, factureIds, mode, ecart }]. Date de paiement = date de l'opération.
 * Chaque ligne rapprochée est retenue (S.rapprochements) pour ne pas être reproposée. Renvoie le nombre de factures marquées.
 */
function appliquerRapprochement(retenus, maintenant = Date.now()) {
  S.rapprochements ||= []; let n = 0;
  for (const r of retenus || []) {
    const fs = (r.factureIds || []).map((id) => parId(S.factures, id)).filter((f) => f && f.statut !== "payee"); if (!fs.length) continue;
    for (const f of fs) { Object.assign(f, { statut: "payee", datePaiement: r.ligne.date, mode: r.mode || "virement", paiement: { source: "releve", libelle: r.ligne.libelle.slice(0, 160), montant: r.ligne.montant, ...(fs.length > 1 ? { groupe: fs.length } : {}), ...(r.ecart ? { ecart: r.ecart } : {}) } }); n++; }
    S.rapprochements.push({ ligneId: r.ligne.id, date: r.ligne.date, montant: r.ligne.montant, libelle: r.ligne.libelle.slice(0, 160), factureIds: fs.map((f) => f.id), le: new Date(maintenant).toISOString() });
  }
  S.rapprochements = S.rapprochements.slice(-3000);
  return n;
}
