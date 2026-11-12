"use strict";
/* ============================================================
   Historique d'un voyage — logique pure, testée.
   Chaque changement d'étape, de statut ou de dépense est consigné dans voyage.auditLog : date, auteur (profil de l'appareil), action, avant, après.
   Le journal se construit par comparaison de l'état avant et après chaque enregistrement : aucun écran ne peut l'oublier.
   ============================================================ */

const AUDIT_MAX = 300;
const LIB_AUDIT = { creation: "Voyage créé", statut: "Statut", jalon: "Étape marquée", jalon_annule: "Étape annulée", cout_ajout: "Dépense ajoutée", cout_modif: "Dépense modifiée", cout_suppr: "Dépense supprimée", prix: "Prix de vente", dates: "Dates" };
/** Photographie d'un voyage : ce dont on suit les changements. */
function instantaneVoyage(v) {
  return { statut: v.statut || "", prix: `${num(v.prix)} ${v.devise || "MAD"}`, dates: `${v.dateDepart || "?"} → ${v.dateRetourPrevue || "?"}`, jalons: (v.jalons || []).map((j) => j.type),
    lignes: Object.fromEntries((v.lignesCout || []).map((l) => [l.id, { type: l.type, montant: num(l.montant), devise: l.devise, source: l.source, ref: l.ref || "" }])) };
}
const texteLigne = (l) => `${libTypeCout(l.type)} ${fmt(l.montant, l.devise === "EUR" ? 2 : 0)} ${l.devise}${l.ref ? ` (${l.ref})` : ""}`;
/** Différences entre deux photographies d'un même voyage : [{ action, detail, avant, apres }]. `avant` nul = création. */
function diffVoyage(avant, apres) {
  if (!avant) return [{ action: "creation", detail: "", avant: "", apres: apres.statut }];
  const r = [], lib = (k) => JALONS_VOYAGE.find((j) => j[0] === k)?.[1] || k, st = (k) => STATUTS_VOYAGE.find((s) => s[0] === k)?.[1] || k;
  if (avant.statut !== apres.statut) r.push({ action: "statut", detail: "", avant: st(avant.statut), apres: st(apres.statut) });
  if (avant.prix !== apres.prix) r.push({ action: "prix", detail: "", avant: avant.prix, apres: apres.prix });
  if (avant.dates !== apres.dates) r.push({ action: "dates", detail: "", avant: avant.dates, apres: apres.dates });
  for (const k of apres.jalons) if (!avant.jalons.includes(k)) r.push({ action: "jalon", detail: lib(k), avant: "", apres: lib(k) });
  for (const k of avant.jalons) if (!apres.jalons.includes(k)) r.push({ action: "jalon_annule", detail: lib(k), avant: lib(k), apres: "" });
  for (const [id, l] of Object.entries(apres.lignes)) {
    const a = avant.lignes[id];
    if (!a) r.push({ action: "cout_ajout", detail: `${texteLigne(l)} — ${libSourceCout(l.source).toLowerCase()}`, avant: "", apres: texteLigne(l) });
    else if (a.montant !== l.montant || a.devise !== l.devise || a.type !== l.type || a.ref !== l.ref) r.push({ action: "cout_modif", detail: libTypeCout(l.type), avant: texteLigne(a), apres: texteLigne(l) });
  }
  for (const [id, a] of Object.entries(avant.lignes)) if (!apres.lignes[id]) r.push({ action: "cout_suppr", detail: texteLigne(a), avant: texteLigne(a), apres: "" });
  return r;
}
/**
 * Compare chaque voyage à sa photographie précédente et complète son journal. `memoire` : Map id → photographie, mise à jour ici.
 * Un voyage absent de la mémoire et déjà doté d'un journal (rechargement de la page) n'est pas « créé » une deuxième fois. Renvoie le nombre d'entrées ajoutées.
 */
function journaliser(memoire, qui = "", maintenant = new Date().toISOString()) {
  let n = 0;
  for (const v of S.voyages) {
    const apres = instantaneVoyage(v), connu = memoire.has(v.id);
    const entrees = connu ? diffVoyage(memoire.get(v.id), apres) : (v.auditLog || []).length || (v.jalons || []).length || (v.lignesCout || []).length ? [] : diffVoyage(null, apres);
    if (entrees.length) { v.auditLog = [...(v.auditLog || []), ...entrees.map((e) => ({ date: maintenant, qui, ...e }))].slice(-AUDIT_MAX); n += entrees.length; }
    memoire.set(v.id, apres);
  }
  for (const id of [...memoire.keys()]) if (!S.voyages.some((v) => v.id === id)) memoire.delete(id);
  return n;
}
