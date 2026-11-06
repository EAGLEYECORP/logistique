"use strict";
/* ============================================================
   Photos jointes : galerie, visionneuse plein écran, pastilles de comptage.
   Les images sont compressées (1600 px, JPEG) et stockées dans IndexedDB (voir stockage.js) : elles fonctionnent hors ligne.
   Chaque photo est rattachée à une « cible » : "commande:ID", "plein:ID", "camion:ID", "intervention:ID", "chauffeur:ID", "dossier:ID".
   ============================================================ */

/** Bouton d'accès aux photos d'une cible. texte=true → bouton avec libellé (sinon icône seule). */
function boutonPhotos(cible, titre, { texte = false } = {}) {
  const attrs = `data-photos="${esc(cible)}" data-titre="${esc(titre)}"`;
  return texte
    ? `<button type="button" class="btn ghost sm" ${attrs}>${ic("camera")}Photos<span class="pbadge" data-pbadge="${esc(cible)}"></span></button>`
    : `<button type="button" class="icon-btn" ${attrs} title="Photos" aria-label="${esc(titre)}">${ic("camera")}<span class="pbadge" data-pbadge="${esc(cible)}"></span></button>`;
}

/** Remplit les pastilles (nombre de photos) de la page affichée, en un seul passage dans IndexedDB. */
async function hydraterPhotos() {
  const pastilles = document.querySelectorAll("[data-pbadge]");
  if (!pastilles.length) return;
  if (!idbDisponible()) { document.querySelectorAll("[data-photos]").forEach((b) => { b.hidden = true; }); return; }
  try {
    const comptes = await photosComptes();
    pastilles.forEach((el) => {
      const n = comptes[el.dataset.pbadge] || 0;
      el.textContent = n || "";
      el.parentElement.classList.toggle("a-photos", n > 0);
    });
  } catch { /* sans gravité : pas de pastilles */ }
}

/** Ajoute des fichiers image à une cible. Renvoie le nombre de photos enregistrées (les erreurs sont signalées une fois). */
async function photosAjouterFichiers(fichiers, cible) {
  let n = 0, erreur = "";
  for (const f of fichiers) {
    try { await photoAjouter(f, cible); n++; } catch (e) { erreur = e.message; }
  }
  if (erreur) toast(erreur, "danger");
  return n;
}

const supprimerPhotosDe = photosSupprimerDe; // alias lisible dans les vues

/* ---------- galerie ---------- */
async function ouvrirPhotos(cible, titre) {
  if (!idbDisponible()) return toast("Les photos ne sont pas disponibles sur ce navigateur.", "warn");
  let urls = [];
  const nettoyer = () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; };

  const corps = `<div id="galerie" class="galerie"></div>
    <div class="row" style="margin-top:14px">
      <label class="btn">${ic("camera")}Prendre une photo<input type="file" accept="image/*" capture="environment" hidden data-ph-input></label>
      <label class="btn ghost">${ic("upload")}Choisir des images<input type="file" accept="image/*" multiple hidden data-ph-input></label>
    </div>
    <p class="hint">Les photos sont compressées et gardées sur cet appareil, y compris hors ligne. Elles sont incluses dans l'export ZIP.</p>`;
  const fin = modale({ titre, corps, valider: "Fermer", annuler: "" });
  const d = $("#modale");

  const rendre = async (message = "") => {
    nettoyer();
    const liste = await photosDe(cible).catch(() => []);
    const zone = $("#galerie");
    if (!zone) return;
    urls = liste.map((p) => URL.createObjectURL(p.mini || p.blob));
    zone.innerHTML = message ? `<p class="hint">${esc(message)}</p>` : liste.length
      ? liste.map((p, i) => `<button type="button" class="vignette" data-ph="${i}" aria-label="Photo du ${esc(dateHeureFr(p.date))}"><img src="${urls[i]}" alt="" loading="lazy"></button>`).join("")
      : vide("camera", "Aucune photo", "Prenez une photo ou choisissez des images : CMR, preuve de livraison, ticket, dommage…");
    zone.dataset.n = liste.length;
    zone._liste = liste;
  };

  d.onchange = async (e) => {
    if (!e.target.matches("[data-ph-input]")) return;
    const fichiers = [...e.target.files];
    e.target.value = "";
    if (!fichiers.length) return;
    await rendre(`Enregistrement de ${fichiers.length} photo${fichiers.length > 1 ? "s" : ""}…`);
    const n = await photosAjouterFichiers(fichiers, cible);
    await rendre();
    if (n) toast(`${n} photo${n > 1 ? "s" : ""} ajoutée${n > 1 ? "s" : ""}`);
  };
  const surClic = async (e) => {
    const v = e.target.closest("[data-ph]");
    if (!v || !d.open) return;
    await ouvrirVisionneuse($("#galerie")._liste, +v.dataset.ph, titre, () => rendre());
  };
  d.addEventListener("click", surClic);
  await rendre();
  await fin;
  d.removeEventListener("click", surClic);
  d.onchange = null;
  nettoyer();
  hydraterPhotos();
}

/* ---------- visionneuse plein écran ---------- */
async function ouvrirVisionneuse(liste, index, titre, apresChangement) {
  const dlg = $("#visionneuse");
  let url = "";
  let i = index;
  const afficherPhoto = () => {
    if (url) URL.revokeObjectURL(url);
    const p = liste[i];
    url = URL.createObjectURL(p.blob);
    dlg.innerHTML = `<div class="vision">
      <header><span>${esc(titre)} · ${i + 1} / ${liste.length}</span><div class="row">
        <button type="button" class="icon-btn" data-v="tel" aria-label="Télécharger">${ic("download")}</button>
        <button type="button" class="icon-btn" data-v="suppr" aria-label="Supprimer">${ic("trash")}</button>
        <button type="button" class="icon-btn" data-v="fermer" aria-label="Fermer">${ic("x")}</button></div></header>
      <div class="vision-img"><img src="${url}" alt="${esc(titre)}">
        ${liste.length > 1 ? `<button type="button" class="nav prec" data-v="prec" aria-label="Précédente">‹</button><button type="button" class="nav suiv" data-v="suiv" aria-label="Suivante">›</button>` : ""}</div>
      <footer>${esc(dateHeureFr(p.date))} · ${p.w}×${p.h} · ${tailleOctets(p.taille || 0)}</footer></div>`;
  };
  afficherPhoto();
  dlg.onclick = async (e) => {
    const a = e.target.closest("[data-v]")?.dataset.v;
    if (!a) { if (e.target === dlg) dlg.close(); return; }
    if (a === "fermer") dlg.close();
    if (a === "prec") { i = (i - 1 + liste.length) % liste.length; afficherPhoto(); }
    if (a === "suiv") { i = (i + 1) % liste.length; afficherPhoto(); }
    if (a === "tel") {
      const p = liste[i];
      const lien = document.createElement("a");
      lien.href = url; lien.download = `${titre.replace(/[^\w\-]+/g, "_")}-${dateISO(p.date)}-${i + 1}.jpg`;
      lien.click();
    }
    if (a === "suppr") {
      if (!(await confirmerDansVisionneuse())) return;
      await photoSupprimer(liste[i].id);
      liste.splice(i, 1);
      if (!liste.length) { dlg.close(); return; }
      i = Math.min(i, liste.length - 1); afficherPhoto();
    }
  };
  dlg.onkeydown = (e) => {
    if (e.key === "ArrowLeft") dlg.querySelector('[data-v="prec"]')?.click();
    if (e.key === "ArrowRight") dlg.querySelector('[data-v="suiv"]')?.click();
  };
  dlg.showModal();
  await new Promise((ok) => dlg.addEventListener("close", ok, { once: true }));
  if (url) URL.revokeObjectURL(url);
  dlg.innerHTML = "";
  apresChangement?.();
}
/** Confirmation simple, intégrée à la visionneuse (la fenêtre de confirmation générale serait cachée derrière). */
function confirmerDansVisionneuse() {
  return new Promise((ok) => {
    const bandeau = document.createElement("div");
    bandeau.className = "vision-confirm";
    bandeau.innerHTML = `<span>Supprimer cette photo ?</span><button type="button" class="btn sm danger">Supprimer</button><button type="button" class="btn sm ghost">Annuler</button>`;
    const fin = (r) => { bandeau.remove(); ok(r); };
    bandeau.querySelector(".danger").onclick = () => fin(true);
    bandeau.querySelector(".ghost").onclick = () => fin(false);
    $("#visionneuse").append(bandeau);
  });
}

/* ---------- accès depuis toutes les vues ---------- */
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-photos]");
  if (b) ouvrirPhotos(b.dataset.photos, b.dataset.titre);
});
