"use strict";
/* ============================================================
   « Coller un message » sur la page Commandes : la demande reçue par e-mail ou WhatsApp devient une commande pré-remplie.
   Lecture sur l'appareil (lecture_commande.js), sans réseau ni coût ; chaque champ lu est montré avec l'extrait d'où il vient ;
   client inconnu : création proposée d'après l'e-mail ou le numéro ; doublon possible signalé ; demande de prix → commande « à chiffrer ».
   ============================================================ */

const LIB_CHAMPS_LUS = { clientId: "Client", origine: "Chargement", destination: "Livraison", dateChargement: "Date de chargement", dateLivraison: "Date de livraison", palettes: "Palettes", poids: "Poids", tempMin: "Température", prix: "Prix", refClient: "Référence client", marchandise: "Marchandise" };
function valeurLue(k, c) {
  if (k === "clientId") return nomClient(c.clientId);
  if (k === "dateChargement" || k === "dateLivraison") return dateFr(c[k]);
  if (k === "poids") return `${fmt(c.poids)} kg`;
  if (k === "tempMin") return c.tempMin === c.tempMax ? `${c.tempMin} °C` : `${c.tempMin} à ${c.tempMax} °C`;
  if (k === "prix") return fmtDevise(c.prix, c.devise);
  if (k === "origine") return `${c.origine} (${c.paysOrigine})`; if (k === "destination") return `${c.destination} (${c.paysDest})`;
  return String(c[k]);
}
function resumeLecture(r) {
  const lus = Object.keys(LIB_CHAMPS_LUS).filter((k) => r.champs[k] !== undefined);
  return `<div class="lecture-resume"><strong>Lu dans le message (${lus.length} champ${lus.length > 1 ? "s" : ""}) — vérifiez avant de créer :</strong>
    <ul>${lus.map((k) => `<li>${ic("check")}<span><b>${esc(LIB_CHAMPS_LUS[k])}</b> : ${esc(valeurLue(k, r.champs))}${r.sources[k] ? ` <span class="sub">« ${esc(r.sources[k])} »</span>` : ""}</span></li>`).join("")}</ul>
    ${r.manquants.length ? `<p class="lecture-manque">${ic("alert")}À compléter : ${r.manquants.map(esc).join(", ")}.</p>` : ""}
    ${r.demandePrix ? `<p class="lecture-info">${ic("receipt")}Le client demande un prix : la commande est créée « à chiffrer » (devis).</p>` : ""}
    ${r.doublon ? `<p class="lecture-manque">${ic("alert")}Ressemble à ${esc(r.doublon.ref)} (${esc(nomClient(r.doublon.clientId))}, ${esc(r.doublon.origine)} → ${esc(r.doublon.destination)}, ${dateFr(r.doublon.dateChargement)}) : vérifiez que ce n'est pas la même demande.</p>` : ""}
    ${r.alertes.map((a) => `<p class="lecture-manque">${ic("alert")}${esc(a)}</p>`).join("")}</div>`;
}
const nomDepuisEmail = (e) => { const d = (e.split("@")[1] || "").split(".")[0]; return d ? d.replace(/[-_]/g, " ").replace(/\b\w/g, (x) => x.toUpperCase()) : ""; };
async function collerMessage() {
  const f = await modale({ titre: "Coller une demande de transport", valider: "Lire le message", corps: `<label class="f full">Message reçu (e-mail, WhatsApp, SMS) — collez-le tel quel, en-tête compris<textarea name="message" id="message-colle" rows="11" required placeholder="De : Karim &lt;achats@client.ma&gt;&#10;Bonjour, 26 palettes de clémentines, chargement jeudi à Agadir, livraison lundi à Perpignan, 2 à 6 °C, 22 t. Votre meilleur prix ?"></textarea></label>
    <p class="hint">Lu sur cet appareil : rien n'est envoyé. Villes, dates (« jeudi », « 20/11 », « Nov 20 »), palettes, poids, température, prix, référence et client sont reconnus en français, anglais et espagnol.</p>` });
  if (!f || !String(f.message || "").trim()) return;
  const message = String(f.message).trim(), r = lireDemande(message);
  if (!r.champs.clientId && (r.client.email || r.client.tel || r.client.nom)) {
    const c = await formulaire("Client inconnu : le créer ?", champsClient({ nom: r.client.nom && !/@/.test(r.client.nom) ? r.client.nom : nomDepuisEmail(r.client.email), email: r.client.email, tel: r.client.tel ? (r.client.tel.startsWith("212") ? "+" + r.client.tel : r.client.tel) : "" }),
      { valider: "Créer le client", annuler: "Plus tard", aide: "Ces coordonnées viennent du message. Corrigez le nom (raison sociale) si besoin." });
    if (c) { const n = { id: uid(), ...c, delai: num(c.delai, S.params.delaiPaiement) }; S.clients.push(n); r.champs.clientId = n.id; r.manquants = r.manquants.filter((m) => m !== "client"); }
  }
  const prefill = { ...r.champs, devise: r.champs.devise || "EUR", notes: `Demande reçue le ${dateFr(today())} :\n${message.slice(0, 1500)}` };
  const liste = champsCommande(prefill).map((x) => (x.name === "prix" ? { ...x, required: false, label: "Prix de vente (vide = à chiffrer)" } : x));
  const v = await modale({ titre: "Nouvelle commande d'après le message", corps: resumeLecture(r) + champs(liste), valider: r.demandePrix || !r.champs.prix ? "Créer (à chiffrer)" : "Créer la commande" }); // ce qui a été lu, en tête : visible sans défiler
  if (!v) return;
  const devis = r.demandePrix || !num(v.prix), statut = devis ? "devis" : "confirme";
  const n = { id: uid(), ref: prochainNumero("CMD", S.commandes, "ref"), statut, source: "message", jalons: [{ statut, date: new Date().toISOString() }], ...lireCommande(v) };
  S.commandes.push(n); filtreCmd = devis ? "chiffrer" : "actives"; sauver();
  toast(devis ? `Commande ${n.ref} créée, à chiffrer` : `Commande ${n.ref} créée`); rafraichir();
}
if (VUES.commandes) {
  const actionsCommandesAvantLecture = VUES.commandes.actions, agirCommandesAvantLecture = VUES.commandes.agir;
  VUES.commandes.actions = () => btn("coller", "Coller un message", { icone: "file", cls: "btn ghost" }) + actionsCommandesAvantLecture();
  VUES.commandes.agir = async function (act, id, b) { if (act === "coller") return collerMessage(); return agirCommandesAvantLecture.call(this, act, id, b); };
}
