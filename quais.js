"use strict";
/* ============================================================
   Attente aux quais (chargement, livraison) et sa facturation — logique pure, testée.
   · chaque commande a deux quais : chargement et livraison ; arrivée et départ notés par le chauffeur (« Arrivé au quai », puis l'étape
     « Chargée » ou « Livrée » ferme le quai) ou corrigés au bureau ;
   · au-delà de la franchise du client (2 h par défaut), l'attente se facture par demi-heure entamée, au tarif du client ;
   · une ligne de facture par quai, ajoutée seule à la facture de la commande (ou du voyage), jamais deux fois ;
   · sans tarif fixé, les heures au-delà de la franchise sont quand même comptées : c'est l'argent à aller chercher au contrat.
   Dépend de noyau.js (état S, num, dates).
   ============================================================ */

const QUAIS = [["chargement", "chargement"], ["livraison", "livraison"]];
const AU_QUAI = { chargement: "au chargement", livraison: "à la livraison" };
const quaiDe = (c, q) => c?.quais?.[q] || null;
/** Note l'arrivée au quai (maintenant par défaut). Ne remplace pas une arrivée déjà notée sauf si forcer. */
function arriveeQuai(c, q, date = new Date().toISOString(), { forcer = false } = {}) {
  c.quais ||= {}; const x = (c.quais[q] ||= {});
  if (x.arrivee && !forcer) return x;
  x.arrivee = date; if (x.depart && x.depart < date) delete x.depart;
  return x;
}
/** Note le départ du quai ; sans arrivée notée, rien n'est mesuré. */
function departQuai(c, q, date = new Date().toISOString()) {
  const x = quaiDe(c, q); if (!x?.arrivee) return null;
  if (date < x.arrivee) throw new Error("Le départ du quai est avant l'arrivée.");
  x.depart = date; return x;
}
/** Conditions d'attente du client : { franchiseH, tarif, devise, fixe }. */
function conditionsAttente(c) {
  const cl = parId(S.clients, c?.clientId) || {};
  const franchiseH = num(cl.franchiseAttenteH, NaN), tarif = num(cl.tarifAttente, NaN);
  return { franchiseH: Number.isFinite(franchiseH) && franchiseH >= 0 ? franchiseH : num(S.params?.franchiseAttenteH, 2), tarif: Number.isFinite(tarif) && tarif > 0 ? tarif : num(S.params?.tarifAttente, 0), devise: cl.deviseAttente || S.params?.deviseAttente || "EUR", fixe: Number.isFinite(tarif) && tarif > 0 };
}
/**
 * Attente à un quai : { arrivee, depart, enCours, minutes, franchiseMin, auDelaMin, heuresFacturees, montant, devise, tarif, facture }.
 * Quai en cours : minutes jusqu'à maintenant, rien de facturable. Heures facturées : par demi-heure entamée au-delà de la franchise.
 */
function attenteQuai(c, q, maintenant = Date.now()) {
  const x = quaiDe(c, q); if (!x?.arrivee) return null;
  const a = Date.parse(x.arrivee), d = x.depart ? Date.parse(x.depart) : maintenant, minutes = Math.max(0, Math.round((d - a) / 60000));
  const k = conditionsAttente(c), franchiseMin = Math.round(k.franchiseH * 60), auDelaMin = Math.max(0, minutes - franchiseMin);
  const heuresFacturees = x.depart ? Math.ceil(auDelaMin / 30) / 2 : 0;
  return { arrivee: x.arrivee, depart: x.depart || "", enCours: !x.depart, minutes, franchiseMin, auDelaMin, heuresFacturees, montant: Math.round(heuresFacturees * k.tarif * 100) / 100, devise: k.devise, tarif: k.tarif, facture: x.facture || "" };
}
const dureeQuai = (min) => { const m = Math.round(min); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""}`; };
const lieuQuai = (c, q) => (q === "chargement" ? c.origine : c.destination) || "";
/** Lignes de facture d'attente d'une commande, pas encore facturées : [{ quai, designation, montant, devise }]. */
function lignesAttente(c, maintenant = Date.now()) {
  const r = [];
  for (const [q, lib] of QUAIS) {
    const a = attenteQuai(c, q, maintenant); if (!a || a.enCours || a.facture || !(a.montant > 0)) continue;
    const jour = a.arrivee.slice(0, 10).split("-").reverse().join("/");
    r.push({ quai: q, devise: a.devise, montant: a.montant, designation: `Attente ${AU_QUAI[q] || "au " + lib}${lieuQuai(c, q) ? " — " + lieuQuai(c, q) : ""}, ${jour} : ${dureeQuai(a.minutes)} sur place, franchise ${dureeQuai(a.franchiseMin)} → ${String(a.heuresFacturees).replace(".", ",")} h × ${String(a.tarif).replace(".", ",")} ${a.devise === "EUR" ? "€" : "MAD"} · ${c.ref || ""}` });
  }
  return r;
}
/** Ajoute à une facture les lignes d'attente des commandes (converties dans la devise de la facture) et les marque facturées. Renvoie le nombre de lignes. */
function ajouterAttentesFacture(f, commandes) {
  let n = 0;
  for (const c of commandes) for (const l of lignesAttente(c)) {
    const montant = l.devise === (f.devise || "MAD") ? l.montant : f.devise === "EUR" ? l.montant / num(S.params.tauxEUR, 10.9) : versMAD(l.montant, l.devise);
    (f.lignes ||= []).push({ designation: l.designation, montant: Math.round(montant * 100) / 100, attente: { commandeId: c.id, quai: l.quai } });
    c.quais[l.quai].facture = f.id; n++;
  }
  return n;
}
/** Synthèse depuis une date : { quais, minutes, auDelaMin, facturableMad, factureMad, sansTarifMin }. */
function syntheseAttentes(depuis = "", maintenant = Date.now()) {
  const r = { quais: 0, minutes: 0, auDelaMin: 0, facturableMad: 0, factureMad: 0, sansTarifMin: 0 };
  for (const c of S.commandes || []) for (const [q] of QUAIS) {
    const a = attenteQuai(c, q, maintenant); if (!a || a.enCours || (depuis && a.arrivee.slice(0, 10) < depuis)) continue;
    r.quais++; r.minutes += a.minutes; r.auDelaMin += a.auDelaMin;
    if (!a.tarif) r.sansTarifMin += a.auDelaMin; else if (a.facture) r.factureMad += versMAD(a.montant, a.devise); else r.facturableMad += versMAD(a.montant, a.devise);
  }
  return r;
}
