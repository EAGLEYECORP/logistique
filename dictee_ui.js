"use strict";
/* ============================================================
   Dictée (interface) — logique dans dictee.js.
   · un bouton micro dans chaque zone de texte (réserves de la preuve de livraison, notes…), seulement si le téléphone
     sait reconnaître la voix (Web Speech : Chrome sur Android, Safari sur iPhone) ; sinon rien ne s'affiche ;
   · langue de l'application (arabe du Maroc ou français) ; ce qui est entendu s'affiche en direct sous la zone, le texte
     reconnu s'insère au curseur ; un appui de plus, la fermeture de la fenêtre ou le silence arrêtent ;
   · la voix passe par le service vocal du téléphone (Google ou Apple), comme le micro du clavier.
   Une zone peut refuser la dictée avec data-dictee="non".
   ============================================================ */

const ReconnaissanceVocale = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition || null : null;
const MESSAGES_DICTEE = {
  "not-allowed": "Micro refusé : autorisez le micro pour l'application (réglages du navigateur ou du téléphone).",
  "service-not-allowed": "La dictée est désactivée sur ce téléphone : utilisez le micro du clavier.",
  network: "La dictée a besoin du réseau sur ce téléphone : utilisez le micro du clavier, ou tapez.",
  "no-speech": "Rien entendu : réessayez en parlant près du téléphone.",
  "audio-capture": "Aucun micro disponible sur cet appareil.",
  "language-not-supported": "Cette langue n'est pas prise en charge par la dictée du téléphone.",
};
let dicteeEnCours = null; // { reco, zone, bouton, direct, debut, fin, langue }
const langueDictee = () => { const l = typeof langueActive === "function" ? langueActive() : "fr"; return LANGUES_DICTEE[l] ? l : "fr"; };

function arreterDictee() { try { dicteeEnCours?.reco.stop(); } catch { /* déjà arrêtée */ } }
function demarrerDictee(zone, bouton) {
  if (dicteeEnCours) { const meme = dicteeEnCours.zone === zone; arreterDictee(); if (meme) return; }
  const langue = langueDictee(), reco = new ReconnaissanceVocale();
  reco.lang = LANGUES_DICTEE[langue]; reco.interimResults = true; reco.continuous = true; reco.maxAlternatives = 1;
  const direct = document.createElement("span"); direct.className = "dictee-direct"; direct.setAttribute("aria-live", "polite"); direct.textContent = langue === "ar" ? "أتكلم…" : "Parlez…";
  zone.closest(".zone-dictee")?.after(direct);
  const etat = { reco, zone, bouton, direct, langue, debut: zone.selectionStart ?? zone.value.length, fin: zone.selectionEnd ?? zone.value.length };
  reco.onresult = (e) => {
    let provisoire = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i], texte = r[0]?.transcript || "";
      if (!r.isFinal) { provisoire += texte; continue; }
      const [a, b] = document.activeElement === zone ? [zone.selectionStart, zone.selectionEnd] : [Math.min(etat.debut, zone.value.length), Math.min(etat.fin, zone.value.length)];
      const x = insererDictee(zone.value, a, b, texte, langue);
      zone.value = x.valeur; etat.debut = etat.fin = x.curseur;
      try { zone.setSelectionRange(x.curseur, x.curseur); } catch { /* zone cachée */ }
      zone.dispatchEvent(new Event("input", { bubbles: true }));
    }
    direct.textContent = provisoire;
  };
  reco.onerror = (e) => { if (e.error !== "aborted" && MESSAGES_DICTEE[e.error]) toast(MESSAGES_DICTEE[e.error], e.error === "no-speech" ? "" : "warn"); };
  reco.onend = () => {
    bouton.classList.remove("en-cours"); bouton.setAttribute("aria-pressed", "false"); bouton.setAttribute("aria-label", "Dicter");
    direct.remove(); if (dicteeEnCours === etat) dicteeEnCours = null;
  };
  try { reco.start(); } catch (e) { direct.remove(); toast(MESSAGES_DICTEE["service-not-allowed"], "warn"); return; }
  bouton.classList.add("en-cours"); bouton.setAttribute("aria-pressed", "true"); bouton.setAttribute("aria-label", "Arrêter la dictée");
  dicteeEnCours = etat;
}
/** Ajoute le bouton micro aux zones de texte apparues (pages et fenêtres). */
function equiperDictee(racine = document) {
  if (!ReconnaissanceVocale) return;
  for (const t of racine.querySelectorAll("textarea:not([data-dictee-pret])")) {
    t.dataset.dicteePret = "1"; if (!t.hasAttribute("dir")) t.setAttribute("dir", "auto");
    if (t.dataset.dictee === "non" || t.readOnly || t.disabled) continue;
    const enveloppe = document.createElement("span"); enveloppe.className = "zone-dictee";
    t.replaceWith(enveloppe); enveloppe.append(t);
    enveloppe.insertAdjacentHTML("beforeend", `<button type="button" class="bouton-dictee" data-dicter aria-pressed="false" aria-label="Dicter" title="Dicter — la voix passe par le service vocal du téléphone">${ic("mic")}</button>`);
  }
}
if (ReconnaissanceVocale) {
  new MutationObserver(() => equiperDictee()).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-dicter]"); if (!b) return;
    e.preventDefault(); const zone = b.closest(".zone-dictee")?.querySelector("textarea"); if (zone) demarrerDictee(zone, b);
  });
  document.getElementById("modale")?.addEventListener("close", arreterDictee);
  document.addEventListener("visibilitychange", () => { if (document.hidden) arreterDictee(); });
  equiperDictee();
}
