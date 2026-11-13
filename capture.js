"use strict";
/* ============================================================
   Capture automatique des dépenses — logique pure, testée :
   · relevé de carte carburant (CSV) : chaque ligne rattachée au voyage du camion à cette date, sinon mise en attente ;
   · dépenses calculées : per diem du chauffeur, énergie du groupe froid, péage mesuré par GPS ;
   · amendes rattachées au voyage en cours à leur date ;
   · rappels : frais du transitaire aux étapes de douane, facture de la traversée après l'embarquement.
   Dépend de noyau.js, gps.js (lecture CSV), pilotage.js (dates du voyage).
   ============================================================ */

const CARBURANT_COLONNES = {
  temps: ["date et heure", "date/heure", "datetime", "date transaction", "transaction date", "date de transaction", "date", "datum"],
  montant: ["montant ttc", "total ttc", "montant brut", "gross amount", "bruttobetrag", "montant", "amount", "betrag", "total", "prix total"],
  devise: ["devise", "currency", "waehrung", "wahrung", "monnaie"],
  litres: ["litres", "quantite", "quantity", "menge", "volume", "qte", "liter"],
  plaque: ["plaque", "immatriculation", "immat", "vehicule", "vehicle", "kennzeichen", "licence plate", "license plate"],
  carte: ["numero de carte", "n° carte", "no carte", "carte", "card number", "card no", "card", "kartennummer", "karte", "pan"],
  pays: ["pays", "country", "land"],
  station: ["station", "lieu", "site", "location", "tankstelle", "ville", "city"],
  produit: ["produit", "product", "produkt", "article", "carburant", "fuel type"],
  ref: ["numero de transaction", "n° transaction", "transaction", "reference", "ticket", "receipt", "beleg", "numero"],
};
const immatNorm = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const arrondi2 = (n) => Math.round(n * 100) / 100;
/** Date et heure, ou date seule (AAAA-MM-JJ, JJ/MM/AAAA, JJ.MM.AAAA) : secondes depuis 1970, NaN si illisible. */
function tempsSouple(v, offH = 0) {
  const t = gpsTemps(v, offH); if (Number.isFinite(t)) return t;
  const s = String(v ?? "").trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000;
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) / 1000 : NaN;
}

/** Lit un relevé de carte carburant (DKV, UTA, Eurowag, AS24, carte marocaine… : colonnes reconnues par leur nom). */
function carteCarburantParse(texte, { offH = 0, colonnes = null } = {}) {
  const lignes = gpsLignesCSV(texte);
  if (lignes.length < 2) return { ok: false, lignes: [], entetes: lignes[0] || [], colonnes: null, rejetes: 0, erreur: "Fichier vide ou sans ligne de données." };
  const entetes = lignes[0], h = entetes.map(gpsNorm), pris = new Set();
  const trouver = (cands) => { for (const c of cands) { const i = h.findIndex((x, k) => !pris.has(k) && x === gpsNorm(c)); if (i >= 0) return i; } for (const c of cands) { if (c.length < 4) continue; const i = h.findIndex((x, k) => !pris.has(k) && x.includes(gpsNorm(c))); if (i >= 0) return i; } return -1; };
  const col = colonnes || Object.fromEntries(Object.entries(CARBURANT_COLONNES).map(([k, v]) => { const i = trouver(v); if (i >= 0) pris.add(i); return [k, i]; }));
  if (col.temps < 0 || col.montant < 0) return { ok: false, lignes: [], entetes, colonnes: col, rejetes: 0, erreur: "Colonnes introuvables (date et montant)." };
  const lire = (l, k) => (col[k] >= 0 && l[col[k]] != null ? String(l[col[k]]).trim() : "");
  const res = []; let rejetes = 0;
  for (const l of lignes.slice(1)) {
    const t = tempsSouple(l[col.temps], offH), montant = gpsNombre(l[col.montant]);
    if (!Number.isFinite(t) || !Number.isFinite(montant) || montant <= 0) { rejetes++; continue; }
    const litres = gpsNombre(lire(l, "litres")), date = gpsIso(t).slice(0, 10), plaque = lire(l, "plaque"), carte = lire(l, "carte"), ref = lire(l, "ref");
    res.push({ t, date, montant: arrondi2(montant), devise: (lire(l, "devise") || "EUR").toUpperCase().slice(0, 3), litres: Number.isFinite(litres) ? litres : 0, plaque, carte, pays: lire(l, "pays").toUpperCase().slice(0, 2), station: lire(l, "station"), produit: lire(l, "produit"), ref,
      cle: `carb:${date}|${immatNorm(plaque) || immatNorm(carte)}|${arrondi2(montant)}|${ref}` });
  }
  return { ok: res.length > 0, lignes: res, entetes, colonnes: col, rejetes, erreur: res.length ? "" : "Aucune ligne exploitable (date ou montant illisible)." };
}

/** Camion d'une ligne de relevé : par l'immatriculation, sinon par le numéro de carte carburant du camion (les relevés masquent souvent le début du numéro). */
function camionDeLigne(l) {
  const chiffres = (x) => String(x ?? "").replace(/\D/g, ""), p = immatNorm(l.plaque), k = chiffres(l.carte);
  const parCarte = (x) => { const c = chiffres(x.carteCarburant); return !!c && !!k && (c === k || (Math.min(c.length, k.length) >= 4 && (c.endsWith(k) || k.endsWith(c)))); };
  return (p && S.camions.find((c) => immatNorm(c.immat) === p)) || S.camions.find(parCarte) || null;
}
/**
 * Voyage (hors annulé) d'un camion ou d'un chauffeur à une date : celle-ci tombe entre le départ et le retour.
 * `avant` : jours de tolérance avant le départ (un plein fait la veille du départ est pour ce voyage). Si plusieurs voyages conviennent : celui dont la date est dans la fenêtre stricte, puis le plus récent.
 */
function voyageALaDate({ camionId, chauffeurId }, date, { avant = 0 } = {}) {
  const d = String(date).slice(0, 10);
  const c = S.voyages.filter((v) => v.statut !== "annule" && v.dateDepart && ((camionId && v.camionId === camionId) || (chauffeurId && v.chauffeurId === chauffeurId)))
    .map((v) => ({ v, strict: d >= v.dateDepart && d <= finVoyage(v), large: d >= dateISO(Date.parse(v.dateDepart + "T00:00:00Z") - avant * 86400000) && d <= finVoyage(v) }))
    .filter((x) => x.large).sort((a, b) => Number(b.strict) - Number(a.strict) || b.v.dateDepart.localeCompare(a.v.dateDepart));
  return c[0]?.v || null;
}
const cleConnue = (cle) => !!cle && (S.voyages.some((v) => (v.lignesCout || []).some((l) => l.cle === cle)) || (S.depensesAttente || []).some((a) => a.cle === cle));
const libCarburant = (l) => [l.produit, l.litres ? `${fmt(l.litres, 0)} L` : "", l.station, l.pays].filter(Boolean).join(" · ");

/**
 * Rattache les lignes d'un relevé de carte carburant : au voyage du camion à cette date, sinon en attente (S.depensesAttente) avec la raison.
 * Une ligne déjà importée (même date, véhicule, montant, référence) est ignorée. Renvoie { rattachees, attente, doublons, voyages (ids touchés) }.
 */
function rattacherCarburant(lignes) {
  const bilan = { rattachees: 0, attente: 0, doublons: 0, voyages: [] };
  for (const l of lignes) {
    if (cleConnue(l.cle)) { bilan.doublons++; continue; }
    const cam = camionDeLigne(l), v = cam && voyageALaDate({ camionId: cam.id }, l.date, { avant: 1 });
    const raison = !["MAD", "EUR"].includes(l.devise) ? `devise ${l.devise} : à convertir` : !cam ? "camion inconnu" : !v ? "aucun voyage à cette date" : "";
    if (!raison) {
      ajouterLigneCout(v, { type: "carburant", montant: l.montant, devise: l.devise, source: "fuel_card_csv", date: l.date, ref: l.ref, libelle: libCarburant(l), cle: l.cle, camionId: cam.id, litres: l.litres || undefined, pays: l.pays || undefined });
      bilan.rattachees++; if (!bilan.voyages.includes(v.id)) bilan.voyages.push(v.id);
    } else {
      (S.depensesAttente ||= []).push({ id: uid(), type: "carburant", montant: l.montant, devise: l.devise, source: "fuel_card_csv", date: l.date, ref: l.ref, libelle: libCarburant(l), cle: l.cle, litres: l.litres || undefined, pays: l.pays || undefined, camionId: cam?.id || "", vehicule: l.plaque || l.carte || "", raison });
      bilan.attente++;
    }
  }
  return bilan;
}
/** Affecte une dépense en attente à un voyage (montant et devise modifiables : conversion d'une autre devise). Renvoie la ligne créée. */
function affecterAttente(id, voyageId, { montant, devise } = {}) {
  const a = (S.depensesAttente || []).find((x) => x.id === id), v = parId(S.voyages, voyageId);
  if (!a || !v) return null;
  const l = ajouterLigneCout(v, { ...a, id: undefined, montant: montant ?? a.montant, devise: devise || a.devise, camionId: a.camionId || undefined });
  S.depensesAttente = S.depensesAttente.filter((x) => x.id !== id);
  return l;
}
/** Réessaie de rattacher les dépenses en attente (après la création d'un voyage ou l'ajout d'un camion). Renvoie les voyages touchés. */
function retenterAttente() {
  const touches = [];
  for (const a of [...(S.depensesAttente || [])]) {
    if (!["MAD", "EUR"].includes(a.devise)) continue;
    const cam = a.camionId ? parId(S.camions, a.camionId) : camionDeLigne({ plaque: a.vehicule, carte: a.vehicule });
    const v = a.type === "amendes" ? voyageALaDate({ camionId: cam?.id, chauffeurId: a.chauffeurId }, a.date) : cam && voyageALaDate({ camionId: cam.id }, a.date, { avant: 1 });
    if (v && affecterAttente(a.id, v.id) && !touches.includes(v.id)) touches.push(v.id);
  }
  return touches;
}

/** Enregistre une amende : sur le voyage en cours du chauffeur (ou du camion) à cette date, sinon en attente. Renvoie { voyage, ligne } ou { attente }. */
function enregistrerAmende({ chauffeurId = "", camionId = "", date, montant, devise = "EUR", ref = "", motif = "" }) {
  if (!(num(montant) > 0) || !date) throw new Error("Montant et date de l'amende obligatoires");
  const v = voyageALaDate({ chauffeurId, camionId }, date);
  const d = { type: "amendes", montant: num(montant), devise, source: "saisie", date: String(date).slice(0, 10), ref, libelle: motif };
  if (v) return { voyage: v, ligne: ajouterLigneCout(v, { ...d, chauffeurId: chauffeurId || undefined, camionId: camionId || undefined }) };
  const a = { id: uid(), ...d, chauffeurId, camionId, vehicule: "", raison: "aucun voyage à cette date" }; (S.depensesAttente ||= []).push(a);
  return { attente: a };
}

/** Dépenses calculées attendues sur un voyage : per diem (tarif journalier du chauffeur × jours), énergie du froid (part mensuelle du camion × jours), péage mesuré par GPS. */
function coutsCalculesAttendus(v) {
  const r = [], jours = joursVoyage(v), ch = parId(S.chauffeurs, v.chauffeurId), cam = parId(S.camions, v.camionId);
  if (ch && num(ch.perDiemJournalier) > 0) r.push({ cle: "auto:perdiem", type: "per_diem_chauffeur", montant: arrondi2(num(ch.perDiemJournalier) * jours), devise: ch.perDiemDevise === "EUR" ? "EUR" : "MAD", source: "calcule", libelle: `${jours} jour(s) × ${fmt(ch.perDiemJournalier, 2)}`, fige: true });
  if (cam && num(cam.froid?.consomMensuelle) > 0) r.push({ cle: "auto:froid", type: "froid_energie", montant: arrondi2((num(cam.froid.consomMensuelle) * jours) / JOURS_PAR_MOIS), devise: "MAD", source: "calcule", libelle: `${jours} jour(s) sur ${fmt(cam.froid.consomMensuelle)} MAD par mois`, fige: true });
  if (num(v.peagesReelMad) > 0) r.push({ cle: "auto:peage-gps", type: "peage_ma", montant: num(v.peagesReelMad), devise: "MAD", source: "gps", libelle: "Gares franchies, mesurées par GPS" });
  return r;
}
/**
 * Met les lignes calculées d'un voyage à jour (création, changement de dates, de chauffeur ou de tarif). Renvoie vrai si quelque chose a changé.
 * Un voyage terminé ou annulé est figé : son per diem et son énergie ne bougent plus si un tarif change ensuite ; le péage mesuré suit toujours la mesure.
 */
function majCoutsCalcules(v) {
  const fige = ["termine", "annule"].includes(v.statut), attendus = coutsCalculesAttendus(v);
  let change = false; v.lignesCout ||= [];
  for (const a of attendus) {
    const l = v.lignesCout.find((x) => x.cle === a.cle);
    if (l) { if (fige && a.fige) continue; if (l.montant !== a.montant || l.devise !== a.devise || l.libelle !== a.libelle) { l.montant = a.montant; l.devise = a.devise; l.libelle = a.libelle; change = true; } }
    else if (!(fige && a.fige)) { ajouterLigneCout(v, { ...a, date: v.dateDepart || today() }); change = true; }
  }
  const garder = (l) => !String(l.cle || "").startsWith("auto:") || attendus.some((a) => a.cle === l.cle) || (fige && l.cle !== "auto:peage-gps");
  if (v.lignesCout.some((l) => !garder(l))) { v.lignesCout = v.lignesCout.filter(garder); change = true; }
  return change;
}
/** Met à jour les lignes calculées de tous les voyages ; renvoie les ids des voyages modifiés. */
function majCoutsCalculesTous() { return S.voyages.filter((v) => majCoutsCalcules(v)).map((v) => v.id); }

/**
 * Rappels de dépense à saisir sur un voyage : frais du transitaire une fois la douane passée (export, import), facture de la traversée une fois embarqué.
 * [{ cle, type, texte, devise, defaut, sens?, source }] — sans les rappels écartés (v.invitesIgnorees) ni ceux déjà satisfaits.
 */
function invitesCout(v) {
  if (v.statut === "annule") return [];
  const fait = (k) => (v.jalons || []).some((j) => j.type === k), lignes = v.lignesCout || [], ignore = v.invitesIgnorees || [], r = [];
  for (const [jalon, texte] of [["douane_export", "Frais du transitaire à l'export"], ["douane_import", "Frais du transitaire à l'import"]])
    if (fait(jalon) && !(num(v.douaneMad) > 0) && !lignes.some((l) => l.cle === `jalon:${jalon}`)) r.push({ cle: `jalon:${jalon}`, type: "douane_frais", texte, devise: "MAD", defaut: num(S.params.fraisTransitaire) || "", source: "saisie" });
  for (const [jalon, sens] of [["embarque_aller", "aller"], ["embarque_retour", "retour"]]) {
    const t = (v.traversees || []).find((x) => x.sens === sens);
    if (fait(jalon) && !lignes.some((l) => l.type === "traversee" && (!l.sens || l.sens === sens))) r.push({ cle: `jalon:${jalon}`, type: "traversee", sens, texte: `Facture de la traversée ${sens}`, devise: "EUR", defaut: t && coutTraversee(t) > 0 ? coutTraversee(t) : "", ref: t?.ref || "", source: "facture_armateur" });
  }
  return r.filter((x) => !ignore.includes(x.cle));
}
