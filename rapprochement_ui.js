"use strict";
/* ============================================================
   Rapprochement bancaire (interface) — logique dans rapprochement.js.
   · Factures → « Relevé bancaire » : le fichier exporté depuis la banque en ligne (CSV, Excel .xlsx, ou le « .xls » en page web
     de certaines banques), et la devise du compte ;
   · proposition ligne par ligne : rapprochés (cochés), à vérifier (non cochés, avec la raison : frais bancaires, change,
     paiement partiel), plusieurs factures possibles (à choisir), crédits sans facture (pour information) ;
   · « Marquer payées » : factures payées à la date de l'opération, mode d'après le libellé (virement, chèque, LCN) ;
     solde du relevé repris dans la trésorerie si on le coche (compte en dirhams).
   Rien ne quitte l'appareil.
   ============================================================ */

/** Lit le fichier du relevé → lignes de cellules. */
async function lireReleveFichier(fichier) {
  const o = new Uint8Array(await fichier.arrayBuffer());
  if (o[0] === 0x50 && o[1] === 0x4b) { // .xlsx (archive ZIP)
    const fs = await zipLire(o), texte = (nom) => { const f = fs.find((x) => x.nom === nom); return f ? new TextDecoder("utf-8").decode(f.donnees) : ""; };
    const cible = (texte("xl/_rels/workbook.xml.rels").match(new RegExp(`Id="${(texte("xl/workbook.xml").match(/<sheet\b[^>]*\br:id="([^"]+)"/) || [])[1] || "rId1"}"[^>]*Target="([^"]+)"`)) || [])[1];
    const feuille = cible ? `xl/${cible.replace(/^\/?xl\//, "").replace(/^\//, "")}` : fs.map((x) => x.nom).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
    if (!feuille || !texte(feuille)) throw new Error("Classeur Excel sans feuille lisible.");
    return rangeesXlsx(texte(feuille), texte("xl/sharedStrings.xml"));
  }
  if (o[0] === 0xd0 && o[1] === 0xcf) throw new Error("Ancien format Excel (.xls) : ouvrez le fichier dans Excel ou LibreOffice, enregistrez-le en .xlsx ou en CSV, puis importez ce fichier.");
  if (o[0] === 0x25 && o[1] === 0x50 && o[2] === 0x44 && o[3] === 0x46) throw new Error("Relevé en PDF : il ne se lit pas de façon fiable. Dans la banque en ligne, exportez les opérations en CSV ou en Excel.");
  let t = new TextDecoder("utf-8").decode(o); if (t.includes("�")) t = new TextDecoder("windows-1252").decode(o);
  return /<table[\s>]/i.test(t.slice(0, 50000)) ? rangeesHtml(t) : rangeesCSV(t);
}

const montantReleve = (m, devise) => `${m > 0 ? "+" : ""}${fmt(m, 2)} ${devise === "EUR" ? "€" : "MAD"}`;
const descFactures = (ids) => ids.map((id) => parId(S.factures, id)).filter(Boolean).map((f) => `<span class="rb-f"><strong>${esc(f.numero)}</strong> · ${esc(nomClient(f.clientId))} · ${esc(fmtDevise(totauxFacture(f).ttc, f.devise))}</span>`).join("");
function ligneProposition(p, devise, { coche = false, choix = false } = {}) {
  const op = `<div class="rb-op"><strong class="num">${esc(montantReleve(p.ligne.montant, devise))}</strong><span class="sub">${esc(dateFr(p.ligne.date))} · ${esc(p.ligne.libelle || "—")}</span></div>`;
  if (choix) return `<li class="rb-ligne">${op}<div class="rb-fac"><label class="f">Facture<select name="c_${esc(p.ligne.id)}"><option value="">— Ne rien faire —</option>${p.choix.map((g, i) => `<option value="${i}">${esc(g.map((id) => { const f = parId(S.factures, id); return f ? `${f.numero} · ${nomClient(f.clientId)} · ${dateFr(f.date)}` : ""; }).join(" + "))}</option>`).join("")}</select></label><span class="sub">${esc(p.raison)}</span></div></li>`;
  if (!p.factureIds.length) return `<li class="rb-ligne">${op}<div class="rb-fac"><span class="sub">${esc(p.raison)}</span></div></li>`;
  return `<li class="rb-ligne"><label class="check rb-check"><input type="checkbox" name="l_${esc(p.ligne.id)}" ${coche ? "checked" : ""}><span>${op}<span class="rb-fac">${descFactures(p.factureIds)}<span class="sub">${esc(p.raison)}</span></span></span></label></li>`;
}
async function importerReleveBancaire() {
  const ouvertes = S.factures.filter((f) => f.statut !== "payee").length;
  const f = await modale({ titre: "Relevé bancaire", valider: "Lire le relevé", corps: `<p class="hint" style="margin-top:0">Exportez les opérations du compte depuis votre banque en ligne (CSV ou Excel), puis choisissez le fichier : chaque virement reçu est rapproché des ${ouvertes} facture${ouvertes > 1 ? "s" : ""} à encaisser. Rien n'est marqué payé avant votre validation, et le fichier reste sur cet appareil.</p>
    <div class="form-grid"><label class="f full">Fichier du relevé<input type="file" name="fichier" accept=".csv,.txt,.xlsx,.xls,.htm,.html,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" required></label>
    <label class="f">Devise du compte<select name="devise">${[["MAD", "Dirham (MAD)"], ["EUR", "Euro (€)"]].map(([k, l]) => `<option value="${k}" ${k === (S.params.releveDevise || "MAD") ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>` });
  if (!f?.fichier?.length) return;
  const devise = f.devise === "EUR" ? "EUR" : "MAD"; S.params.releveDevise = devise;
  let r; try { r = tableauReleve(await lireReleveFichier(f.fichier[0])); } catch (e) { return toast(e.message, "danger"); }
  if (!r.ok) return modale({ titre: "Relevé illisible", valider: "Fermer", annuler: "", corps: `<p style="margin-top:0">${esc(r.erreur)}</p>${r.entete?.length ? `<p class="hint">Colonnes vues dans le fichier : ${esc(r.entete.filter(Boolean).join(" · "))}</p>` : ""}<p class="hint">Astuce : exportez « les opérations » (pas le relevé PDF) au format CSV ou Excel.</p>` });
  const { propositions, debits, credits } = rapprocherReleve(r.lignes, { devise }), de = (st) => propositions.filter((p) => p.statut === st);
  const [surs, probables, plusieurs, aucunes, deja] = ["sur", "probable", "plusieurs", "aucune", "deja"].map(de), dates = r.lignes.map((l) => l.date).sort();
  const solde = r.soldeFinal && devise === "MAD" ? r.soldeFinal : null, aFaire = surs.length + probables.length + plusieurs.filter((p) => p.choix.length).length;
  const section = (titre, l, o) => (l.length ? `<div class="section-title">${titre} · ${l.length}</div><ul class="rb-liste">${l.map((p) => ligneProposition(p, devise, o)).join("")}</ul>` : "");
  const corps = `<p class="hint" style="margin-top:0">Du ${esc(dateFr(dates[0]))} au ${esc(dateFr(dates[dates.length - 1]))} · ${r.lignes.length} opérations (${credits} crédit${credits > 1 ? "s" : ""}, ${debits} débit${debits > 1 ? "s" : ""})${r.rejetes ? ` · ${r.rejetes} ligne(s) illisible(s) ignorée(s)` : ""}</p>
    ${section("Rapprochés", surs, { coche: true })}${section("À vérifier", probables, {})}${section("Plusieurs factures possibles", plusieurs.filter((p) => p.choix.length), { choix: true })}
    ${aucunes.length ? `<details class="rb-sans"><summary>Crédits sans facture · ${aucunes.length}</summary><ul class="rb-liste">${aucunes.map((p) => ligneProposition(p, devise)).join("")}</ul></details>` : ""}
    ${deja.length ? `<p class="hint">${deja.length} crédit(s) déjà rapproché(s) lors d'un import précédent.</p>` : ""}
    ${!aFaire && !solde ? `<p>Aucun crédit de ce relevé ne correspond à une facture à encaisser.</p>` : ""}
    ${solde ? `<label class="check" style="margin-top:10px"><input type="checkbox" name="solde"><span>Mettre le solde de trésorerie à <strong>${esc(fmt(solde.montant, 2))} MAD</strong> (solde du relevé au ${esc(dateFr(solde.date))}) — si c'est votre seul compte</span></label>` : ""}`;
  const v = await modale({ titre: `Relevé bancaire — ${f.fichier[0].name}`, valider: aFaire ? "Marquer payées" : solde ? "Enregistrer" : "Fermer", annuler: aFaire || solde ? "Annuler" : "", corps });
  if (!v) return;
  const retenus = [...surs, ...probables].filter((p) => v[`l_${p.ligne.id}`]).map((p) => ({ ligne: p.ligne, factureIds: p.factureIds, mode: p.mode, ecart: p.ecart }));
  for (const p of plusieurs) { const i = v[`c_${p.ligne.id}`]; if (i !== "" && i !== undefined && p.choix[Number(i)]) retenus.push({ ligne: p.ligne, factureIds: p.choix[Number(i)], mode: p.mode, ecart: 0 }); }
  const n = appliquerRapprochement(retenus);
  if (solde && v.solde) (S.entreprise ||= {}).tresorerie = { solde: solde.montant, date: solde.date };
  sauver();
  toast(n ? `${n} facture${n > 1 ? "s" : ""} marquée${n > 1 ? "s" : ""} payée${n > 1 ? "s" : ""} d'après le relevé${solde && v.solde ? " · solde de trésorerie mis à jour" : ""}` : solde && v.solde ? "Solde de trésorerie mis à jour" : "Aucune facture marquée payée", n || v.solde ? "ok" : "");
  rafraichir();
}

const actionsFacturesBase = VUES.factures.actions;
VUES.factures.actions = () => `${S.factures.some((f) => f.statut !== "payee") ? btn("releve-banque", "Relevé bancaire", { icone: "upload", cls: "btn ghost" }) : ""}${actionsFacturesBase ? actionsFacturesBase() : ""}`;
surAction("factures", ["releve-banque"], () => importerReleveBancaire());
