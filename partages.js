"use strict";
/* ============================================================
   Lien de suivi pour le client (phase 4). Le lien est servi par le relais (serveur/relais.js) : il fonctionne
   même application fermée. Le client voit l'état, l'heure d'arrivée estimée, une position arrondie et les étapes —
   jamais le chauffeur, la plaque ni l'identifiant de la balise.
   ============================================================ */

const ETAPES_CLIENT = { depart: "Parti", port_tmed: "Arrivé au port de Tanger Med", embarque_aller: "Embarqué pour la traversée", debarque_alg: "Arrivé en Europe", livre: "Livré" };
const PRECISIONS = [["approx", "Approximative (≈ 10 km) — recommandé"], ["masquee", "Masquée (état et heure d'arrivée seulement)"], ["exacte", "Exacte"]];
const LANGUES_CLIENT = [["fr", "Français"], ["en", "English"], ["es", "Español"], ["ar", "العربية"]];

const partageRelais = () => { const c = directCfg(); return c.mode === "relais" && baseUrl(c.url) && c.jeton ? { base: baseUrl(c.url), jeton: c.jeton } : null; };
async function partageAppel(methode, chemin, corps) {
  const r = partageRelais(); if (!r) throw new Error("Le lien client demande le relais : réglez la source « Relais » dans Suivi en direct.");
  let rep;
  try { rep = await fetch(r.base + chemin, { method: methode, headers: { Authorization: `Bearer ${r.jeton}`, "Content-Type": "application/json" }, body: corps ? JSON.stringify(corps) : undefined }); }
  catch { throw new Error("Serveur injoignable (adresse, réseau ou HTTPS)."); }
  if (rep.status === 401) throw new Error("Jeton refusé par le serveur.");
  const json = await rep.json().catch(() => ({}));
  if (!rep.ok) throw new Error(json.erreur || `Réponse ${rep.status} du serveur.`);
  return json;
}
/** Ce qu'on envoie au relais pour un voyage. */
function corpsPartage(v, options = {}) {
  const cam = parId(S.camions, v.camionId), dest = destinationDe(v), orig = origineDe(v);
  const etapes = (v.jalons || []).filter((j) => ETAPES_CLIENT[j.type]).map((j) => ({ libelle: ETAPES_CLIENT[j.type], date: j.date }));
  const livre = (v.jalons || []).some((j) => j.type === "livre");
  return { ...options, balise: cam?.balise?.trim() || "", origine: v.origine, destination: v.destination, destLat: dest?.[0] ?? null, destLon: dest?.[1] ?? null, origLat: orig?.[0] ?? null, origLon: orig?.[1] ?? null,
    livraisonPrevue: v.livraisonPrevue || "", etapes, attentes: (({ portH, auPortH, debarqH, fourchetteMin, source }) => ({ portH, auPortH, debarqH, fourchetteMin, source }))(attentesPourEta(v)), statut: livre ? "livre" : "actif", zones: zonesActives().filter((z) => ["port_maroc", "port_europe", "frontiere", "douane"].includes(z.type)).map(({ id, nom, type, lat, lon, rayon }) => ({ id, nom, type, lat, lon, rayon })) };
}
const lienClient = (v) => { const r = partageRelais(); return r && v.partage ? `${r.base}${v.partage.chemin}${v.partage.langue && v.partage.langue !== "fr" ? `?lang=${v.partage.langue}` : ""}` : ""; };
let partageDerniereSync = 0;
/** Met à jour les liens actifs (étapes, livré, créneau). Appelée à chaque actualisation du suivi, au plus toutes les 2 minutes. */
async function partagesSynchroniser(force = false) {
  if (!partageRelais() || (!force && Date.now() - partageDerniereSync < 120000)) return;
  partageDerniereSync = Date.now();
  for (const v of S.voyages) if (v.partage?.id && v.statut !== "annule") { try { await partageAppel("PUT", `/api/partages/${v.partage.id}`, corpsPartage(v)); } catch (e) { if (/introuvable/i.test(e.message)) { delete v.partage; sauver(); } } }
}

async function ouvrirPartage(voyageId) {
  const v = parId(S.voyages, voyageId); if (!v) return;
  if (!partageRelais()) return toast("Le lien client demande le relais : réglez la source « Relais » (Suivi en direct).", "warn");
  const cam = parId(S.camions, v.camionId);
  if (!cam?.balise) return toast("Renseignez l'identifiant de la balise sur la fiche du camion de ce voyage.", "warn");
  if (v.partage) return gererPartage(v);
  const f = await formulaire(`Partager le suivi — ${v.ref}`, [
    { name: "reference", label: "Référence affichée au client", value: v.refClient || v.ref, required: true },
    { name: "precision", label: "Position visible par le client", type: "select", options: PRECISIONS, value: "approx" },
    { name: "jours", label: "Validité du lien (jours)", type: "number", min: 1, max: 120, value: 14 },
    { name: "langue", label: "Langue de la page", type: "select", options: LANGUES_CLIENT, value: "fr" },
    { name: "message", label: "Message pour le client (facultatif)", type: "textarea", full: true },
  ], { valider: "Créer le lien", aide: "Le client ne voit ni le chauffeur, ni la plaque, ni l'identifiant de la balise. Toute personne qui possède le lien voit le suivi : ne le diffusez qu'aux destinataires concernés. Vous pouvez le révoquer à tout moment." });
  if (!f) return;
  try {
    const r = await partageAppel("POST", "/api/partages", corpsPartage(v, { reference: f.reference, precision: f.precision, jours: Number(f.jours) || 14, langue: f.langue, message: f.message }));
    v.partage = { id: r.id, chemin: r.chemin, langue: f.langue, expire: r.expire, cree: new Date().toISOString() }; sauver(); rafraichir(); gererPartage(v);
  } catch (e) { toast(e.message, "danger"); }
}
async function gererPartage(v) {
  const lien = lienClient(v), msg = `Suivez votre livraison ${v.origine} → ${v.destination} en direct : ${lien}`;
  const corps = `<p class="hint" style="margin-top:0">Lien actif jusqu'au <strong>${dateFr(new Date(v.partage.expire * 1000).toISOString().slice(0, 10))}</strong>.</p>
    <label class="f full">Lien à transmettre au client<input id="lien-client" value="${esc(lien)}" readonly onclick="this.select()"></label>
    <div class="row" style="margin:12px 0">
      <a class="btn" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a>
      <a class="btn ghost" href="mailto:?subject=${encodeURIComponent("Suivi de votre livraison")}&body=${encodeURIComponent(msg)}">E-mail</a>
      <button type="button" class="btn ghost" data-copier="${esc(lien)}">Copier le lien</button></div>
    <p class="hint">WhatsApp et l'e-mail s'ouvrent avec le message prêt : vous choisissez le destinataire, rien n'est envoyé automatiquement.</p>
    <label class="check"><input type="checkbox" name="revoquer"><span>Révoquer ce lien (le client ne verra plus rien)</span></label>`;
  const r = await modale({ titre: `Lien client — ${v.ref}`, corps, valider: "Terminer", annuler: "" });
  if (r?.revoquer) { try { await partageAppel("DELETE", `/api/partages/${v.partage.id}`); } catch (e) { if (!/introuvable/i.test(e.message)) return toast(e.message, "danger"); } delete v.partage; sauver(); toast("Lien révoqué"); rafraichir(); }
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copier]"); if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copier); toast("Lien copié"); } catch { document.querySelector("#lien-client")?.select(); toast("Sélectionné : copiez avec Ctrl+C.", "warn"); }
});

const agirVoyagesBase = VUES.voyages.agir;
VUES.voyages.agir = async function (act, id, bouton) {
  if (act === "partager") return ouvrirPartage(String(id).split("|")[0]);
  const r = await agirVoyagesBase.call(this, act, id, bouton);
  if (["jalon", "annuler-jalon", "terminer", "modifier"].includes(act)) partagesSynchroniser(true);
  return r;
};
