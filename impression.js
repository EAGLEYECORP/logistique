"use strict";
/* ============================================================
   Impression / PDF : factures, ordres de transport, dossiers de douane.
   Une fenêtre d'aperçu s'ouvre (A4, logo et mentions de l'entreprise) ; « Imprimer » permet aussi d'enregistrer en PDF.
   ============================================================ */

/** Le logo vient des données (peut venir d'une sauvegarde importée) : on n'accepte qu'une image data: PNG/JPEG. */
const logoSur = (E) => (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(E?.logo || "") ? E.logo : "");
const l = esc;
const ligneLibre = (n = 3) => Array.from({ length: n }, () => `<div class="ligne"></div>`).join("");

const CSS_IMPRESSION = `
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font: 13px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 28px; max-width: 820px; margin: auto; }
  .entete { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 14px; border-bottom: 2px solid #0f172a; margin-bottom: 16px; }
  .soc { display: flex; gap: 14px; align-items: center; }
  .logo { max-height: 58px; max-width: 130px; object-fit: contain; }
  .nom { font-size: 17px; font-weight: 700; letter-spacing: -.01em; }
  .adr { color: #475569; font-size: 12px; line-height: 1.5; }
  .titre-doc { text-align: right; }
  .titre-doc h1 { margin: 0 0 4px; font-size: 26px; letter-spacing: -.02em; }
  .titre-doc .m { color: #64748b; line-height: 1.6; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #64748b; margin: 16px 0 6px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; border-bottom: 1px solid #cbd5e1; padding: 8px 0; }
  td { padding: 10px 0; border-bottom: 1px solid #eef2f7; vertical-align: top; }
  .r { text-align: right; }
  .grille { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 28px; }
  .k { color: #64748b; font-size: 11px; } .v { font-weight: 600; }
  .cadre { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 16px; background: #f8fafc; }
  .tot { margin-left: auto; width: 300px; margin-top: 16px; }
  .tot div { display: flex; justify-content: space-between; padding: 5px 0; }
  .tot .g { font-size: 17px; font-weight: 700; border-top: 2px solid #0f172a; margin-top: 6px; padding-top: 10px; }
  .lettres { margin-top: 18px; padding: 10px 14px; border-left: 3px solid #0f172a; background: #f8fafc; font-style: italic; }
  .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 18px; }
  .signatures.deux { grid-template-columns: repeat(2, 1fr); }
  .sig { border: 1px solid #cbd5e1; border-radius: 8px; height: 100px; padding: 8px 10px; font-size: 11px; color: #64748b; }
  .ligne { border-bottom: 1px dotted #94a3b8; height: 26px; }
  table.compact td { padding: 5px 0; } table.compact th { padding: 6px 0; }
  .signatures.court .sig { height: 80px; }
  .coche { font-size: 15px; width: 26px; }
  .pied { margin-top: 16px; padding-top: 12px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 11px; line-height: 1.6; }
  .paye { color: #15803d; font-weight: 700; margin-top: 12px; }
  tr, .cadre, .sig, .lettres { break-inside: avoid; }
  .barre-impression { position: fixed; top: 12px; right: 12px; display: flex; gap: 8px; }
  .barre-impression button { font: inherit; padding: 8px 16px; border-radius: 999px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; }
  .barre-impression button.p { background: #0071e3; color: #fff; border-color: #0071e3; }
  @media print { body { padding: 0; } .barre-impression { display: none; } }
`;

function enteteDoc(titreDoc, meta) {
  const E = S.entreprise || {};
  const adr = [E.adresse && l(E.adresse).replace(/\n/g, "<br>"), E.ville && l(E.ville), E.tel && `Tél. ${l(E.tel)}`, E.email && l(E.email)].filter(Boolean).join("<br>");
  const logo = logoSur(E);
  return `<div class="entete"><div class="soc">${logo ? `<img class="logo" src="${logo}" alt="">` : ""}<div><div class="nom">${l(E.nom) || "Votre entreprise"}</div><div class="adr">${adr}</div></div></div>
    <div class="titre-doc"><h1>${l(titreDoc)}</h1><div class="m">${meta.join("<br>")}</div></div></div>`;
}
function piedDoc({ banque = false, mentions = false } = {}) {
  const E = S.entreprise || {};
  const ids = [E.ice && `ICE ${E.ice}`, E.rc && `RC ${E.rc}`, E.if && `IF ${E.if}`, E.patente && `Patente ${E.patente}`, E.cnss && `CNSS ${E.cnss}`].filter(Boolean).map(l).join(" · ");
  const bq = banque && E.rib ? `Règlement par virement : ${l(E.banque)} — RIB ${l(E.rib)}<br>` : "";
  const mt = mentions && E.mentionsFacture ? `${l(E.mentionsFacture).replace(/\n/g, "<br>")}<br>` : "";
  return bq || mt || ids ? `<div class="pied">${mt}${bq}${ids}</div>` : "";
}
const champDoc = (k, v) => `<div><div class="k">${l(k)}</div><div class="v">${v ? l(v) : "—"}</div></div>`;

/** Page complète d'un document (chaîne HTML). */
function htmlImpression(titre, corps) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${l(titre)}</title><style>${CSS_IMPRESSION}</style></head>
    <body><div class="barre-impression"><button class="p" onclick="print()">Imprimer / PDF</button><button onclick="close()">Fermer</button></div>${corps}
    <script>addEventListener("load", () => setTimeout(() => print(), 350))<\/script></body></html>`;
}
function ouvrirImpression(titre, corps) {
  const w = window.open("", "_blank");
  if (!w) return toast("Autorisez les fenêtres pop-up pour imprimer.", "warn");
  w.document.write(htmlImpression(titre, corps));
  w.document.close();
}

/* ---------- facture ---------- */
function imprimerFacture(f) {
  const c = parId(S.clients, f.clientId) || {};
  const t = totauxFacture(f);
  const client = [`<strong>${l(c.nom)}</strong>`, c.adresse && l(c.adresse).replace(/\n/g, "<br>"), [c.ville, c.pays].filter(Boolean).map(l).join(", "), c.ice && `ICE / TVA : ${l(c.ice)}`].filter(Boolean).join("<br>");
  ouvrirImpression(f.numero, `${enteteDoc("Facture", [`N° <strong style="color:#0f172a">${l(f.numero)}</strong>`, `Date : ${dateFr(f.date)}`, `Échéance : ${dateFr(f.echeance)}`])}
    <div class="cadre" style="max-width:340px;margin-left:auto"><div class="k">Facturé à</div>${client}</div>
    <table style="margin-top:24px"><thead><tr><th>Désignation</th><th class="r">Montant HT</th></tr></thead><tbody>
      ${(f.lignes || []).map((x) => `<tr><td>${l(x.designation)}</td><td class="r">${fmtDevise(x.montant, f.devise)}</td></tr>`).join("")}</tbody></table>
    <div class="tot"><div><span>Total HT</span><span>${fmtDevise(t.ht, f.devise)}</span></div><div><span>TVA ${fmt(f.tva)} %</span><span>${fmtDevise(t.tva, f.devise)}</span></div><div class="g"><span>Total TTC</span><span>${fmtDevise(t.ttc, f.devise)}</span></div></div>
    <div class="lettres">Arrêtée la présente facture à la somme de : <strong>${l(montantEnLettres(t.ttc, f.devise))}</strong> toutes taxes comprises.</div>
    ${f.statut === "payee" ? `<div class="paye">Payée le ${dateFr(f.datePaiement)}</div>` : ""}
    ${piedDoc({ banque: true, mentions: true })}`);
}

/* ---------- ordre de transport ---------- */
function imprimerOrdre(c) {
  const cl = parId(S.clients, c.clientId) || {};
  const ch = parId(S.chauffeurs, c.chauffeurId) || {};
  const cam = parId(S.camions, c.camionId) || {};
  ouvrirImpression(`Ordre ${c.ref}`, `${enteteDoc("Ordre de transport", [`N° <strong style="color:#0f172a">${l(c.ref)}</strong>`, `Édité le ${dateFr(dateISO(Date.now()))}`, c.cmr ? `CMR n° ${l(c.cmr)}` : ""].filter(Boolean))}
    <h2>Donneur d'ordre</h2>
    <div class="cadre"><div class="grille">${champDoc("Client", cl.nom)}${champDoc("Référence client", c.refClient)}${champDoc("Contact", [cl.contact, cl.tel].filter(Boolean).join(" · "))}${champDoc("ICE / TVA", cl.ice)}</div></div>
    <h2>Itinéraire</h2>
    <div class="grille">
      <div class="cadre"><div class="k">Chargement</div><div class="v" style="font-size:15px">${l(lieu(c.origine, c.paysOrigine))}</div><div>${dateFr(c.dateChargement)}</div></div>
      <div class="cadre"><div class="k">Livraison</div><div class="v" style="font-size:15px">${l(lieu(c.destination, c.paysDest))}</div><div>${c.dateLivraison ? dateFr(c.dateLivraison) : "—"}</div></div>
    </div>
    <h2>Marchandise</h2>
    <div class="grille">${champDoc("Désignation", c.marchandise)}${champDoc("Poids / palettes", [c.poids && `${fmt(c.poids)} kg`, c.palettes && `${fmt(c.palettes)} palettes`].filter(Boolean).join(" · "))}</div>
    <h2>Équipe et véhicule</h2>
    <div class="grille">${champDoc("Chauffeur", ch.nom)}${champDoc("Téléphone", ch.tel)}${champDoc("Camion", [cam.immat, cam.marque].filter(Boolean).join(" · "))}${champDoc("N° CMR", c.cmr)}</div>
    ${c.notes ? `<h2>Instructions</h2><div class="cadre">${l(c.notes).replace(/\n/g, "<br>")}</div>` : ""}
    <h2>Observations au chargement / à la livraison</h2>${ligneLibre(3)}
    <div class="signatures"><div class="sig">Expéditeur / chargeur<br>Nom, date, signature</div><div class="sig">Transporteur<br>Cachet, date, signature</div><div class="sig">Destinataire<br>Nom, date, signature</div></div>
    ${piedDoc()}`);
}

/* ---------- dossier de douane ---------- */
function imprimerDossier(d) {
  const items = CHECKLISTS_DOUANE[d.type] || [];
  const faits = items.filter((_, i) => d.coches?.[i]).length;
  ouvrirImpression(`Dossier ${d.ref}`, `${enteteDoc("Dossier de douane", [`Réf. <strong style="color:#0f172a">${l(d.ref)}</strong>`, `${l(TYPES_DOSSIER[d.type])} · ${faits}/${items.length} documents`, `Édité le ${dateFr(dateISO(Date.now()))}`])}
    <div class="cadre"><div class="grille">${champDoc("Client", d.client)}${champDoc("Opération", TYPES_DOSSIER[d.type])}${champDoc("Marchandise", d.marchandise)}${champDoc("Code SH", d.codeSH)}${champDoc("Bureau de douane", d.bureau)}${champDoc("Échéance", d.echeance ? dateFr(d.echeance) : "")}</div></div>
    <h2>Documents à réunir</h2>
    <table class="compact"><thead><tr><th style="width:30px"></th><th>Document</th></tr></thead><tbody>${items.map((it, i) => `<tr><td class="coche">${d.coches?.[i] ? "☑" : "☐"}</td><td>${l(it)}</td></tr>`).join("")}</tbody></table>
    ${d.notes ? `<h2>Notes</h2><div class="cadre">${l(d.notes).replace(/\n/g, "<br>")}</div>` : ""}
    <h2>Observations</h2>${ligneLibre(2)}
    <div class="signatures deux court"><div class="sig">Transitaire / déclarant<br>Date, signature</div><div class="sig">Responsable<br>Date, cachet, signature</div></div>
    ${piedDoc()}`);
}
