"use strict";
/* ============================================================
   Tickets photographiés (interface) — logique dans capture.js (enregistrerTicket).
   · mode chauffeur : « Photo d'un ticket » ouvre l'appareil photo, puis une fenêtre courte (type en un geste, montant si lisible,
     devise proposée d'après l'avancement du voyage) ; le ticket se range seul sur le voyage en cours, photo jointe à la dépense ;
     sans montant ou sans voyage, il attend dans « Dépenses à rattacher » avec sa photo ;
   · fiche du voyage, onglet Argent : les pleins du voyage avec la photo de leur ticket.
   Les photos de tickets ne partent jamais avec les factures du client (cible « ligne: », comme les reçus).
   ============================================================ */

/** Appareil photo du téléphone (ou choix d'une image). */
const choisirPhotoTicket = () => new Promise((ok) => {
  const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" }); input.setAttribute("capture", "environment");
  input.onchange = () => ok(input.files?.length ? [...input.files] : null); input.click();
});
async function photographierTicket(fichiers = null) {
  const ch = typeof chauffeurCourant === "function" ? chauffeurCourant() : null; if (!ch) return;
  fichiers ||= await choisirPhotoTicket(); if (!fichiers?.length) return;
  const v = voyageALaDate({ chauffeurId: ch.id, camionId: ch.camionId }, today(), { avant: 1 }), p = proposeTicket(v), apercu = URL.createObjectURL(fichiers[0]);
  const f = await modale({ titre: "Ticket", valider: "Enregistrer le ticket", corps: `
    <img class="ticket-apercu" src="${apercu}" alt="Ticket photographié">
    <div class="choix-ticket" role="radiogroup" aria-label="Type de dépense">${TYPES_TICKET.map(([k, l], i) => `<label class="puce-choix"><input type="radio" name="type" value="${k}" ${i === 0 ? "checked" : ""}><span>${esc(l)}</span></label>`).join("")}</div>
    ${champs([{ name: "montant", label: "Montant (si lisible)", type: "number", min: 0 }, { name: "devise", label: "Devise", type: "select", options: [["EUR", "EUR €"], ["MAD", "MAD"]], value: p.devise }, { name: "note", label: "Note (facultatif)", full: true }])}
    <p class="hint">${v ? `Rangé sur le voyage ${esc(v.ref)}, avec la photo.` : "Aucun voyage en cours : le bureau le rangera."} Sans montant, le bureau le lira sur la photo.</p>` });
  URL.revokeObjectURL(apercu);
  if (!f) return;
  let r; try { r = enregistrerTicket({ chauffeurId: ch.id, camionId: ch.camionId, type: f.type || TYPES_TICKET[0][0], montant: f.montant, devise: f.devise, note: f.note }); } catch (e) { return toast(e.message, "danger"); }
  const n = await photosAjouterFichiers(fichiers, `ligne:${r.pieceId}`);
  if (r.voyage && typeof recalculerMargeVoyage === "function") recalculerMargeVoyage(r.voyage.id);
  sauver(); if (typeof vibrer === "function") vibrer(40);
  toast(r.voyage ? `Ticket rangé sur ${r.voyage.ref}${n ? ", photo jointe" : ""}` : r.attente.raison === "montant à lire sur le ticket" ? "Ticket gardé avec sa photo : le bureau lira le montant" : "Ticket gardé avec sa photo : le bureau le rangera", "ok");
  rafraichir();
}
surAction("chauffeur", ["chf-ticket"], () => photographierTicket());

/* ---------- fiche du voyage : les pleins du voyage et la photo de leur ticket ---------- */
function blocPleinsVoyage(v) {
  if (!v.camionId || !v.dateDepart) return "";
  const fin = finVoyage(v), pleins = S.pleins.filter((p) => p.camionId === v.camionId && p.date >= v.dateDepart && p.date <= fin).sort((a, b) => (a.date || "").localeCompare(b.date || "") || num(a.km) - num(b.km));
  if (!pleins.length) return "";
  return `<div class="section-title">Pleins du voyage · ${pleins.length}</div>${pleins.map((p) => `<div class="trav"><div><strong>${dateFr(p.date)} · ${fmt(p.litres)} L</strong><span class="sub">${[p.station, p.km && `${fmt(p.km)} km`, p.prix && `${fmt(p.prix, 2)} MAD/L`, p.plein ? "plein complet" : ""].filter(Boolean).map(esc).join(" · ")}</span></div>
    <div class="r"><strong class="num">${fmt(num(p.litres) * num(p.prix))} MAD</strong>${typeof boutonPhotos === "function" ? boutonPhotos(`plein:${p.id}`, `Ticket — plein du ${dateFr(p.date)}`) : ""}</div></div>`).join("")}`;
}
if (typeof enregistrerBlocVoyage === "function") enregistrerBlocVoyage({ onglet: "argent", ordre: 45, rendu: blocPleinsVoyage });
