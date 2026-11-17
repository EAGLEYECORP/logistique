"use strict";
/* Pages publiques des liens sans compte : dépôt des documents par le client, étapes de douane par le transitaire.
   Autonomes, sans dépendance externe, en français, anglais, espagnol et arabe. Les photos sont réduites sur le téléphone avant l'envoi. */
const T = {
  fr: { depot: "Envoyer vos documents", transit: "Étapes de douane", pour: "Pour", de: "Demandé par", expire: "Ce lien a expiré : demandez-en un nouveau.", introuvable: "Lien introuvable ou révoqué.",
    photo: "Prendre en photo", fichier: "Choisir un fichier", envoi: "Envoi…", recu: "Reçu", envoye: "envoyé(s)", erreur: "Envoi impossible, réessayez.", taille: "Fichier trop lourd (12 Mo au plus).", type: "Format non accepté : photo ou PDF.", plein: "Limite atteinte : contactez-nous.",
    autre: "Autre document", aide: "Photo nette, à plat, document entier. Les fichiers sont transmis à votre transporteur uniquement.", valable: "Lien valable jusqu'au", fait: "Fait", annuler: "Annuler", ref: "Référence", note: "Note (facultatif)", noteph: "inspection, remarque…",
    aide2: "Marquez chaque étape dès qu'elle est passée : le transporteur et le chauffeur sont prévenus.", a_faire: "À faire", fait_le: "Fait le", docs: "À présenter" },
  en: { depot: "Send your documents", transit: "Customs steps", pour: "For", de: "Requested by", expire: "This link has expired: please ask for a new one.", introuvable: "Link not found or revoked.",
    photo: "Take a photo", fichier: "Choose a file", envoi: "Sending…", recu: "Received", envoye: "sent", erreur: "Upload failed, please retry.", taille: "File too large (12 MB max).", type: "Format not accepted: photo or PDF.", plein: "Limit reached: please contact us.",
    autre: "Other document", aide: "Sharp, flat photo of the whole document. Files go to your carrier only.", valable: "Link valid until", fait: "Done", annuler: "Undo", ref: "Reference", note: "Note (optional)", noteph: "inspection, remark…",
    aide2: "Mark each step as soon as it is cleared: the carrier and the driver are notified.", a_faire: "To do", fait_le: "Done on", docs: "To present" },
  es: { depot: "Envíe sus documentos", transit: "Etapas de aduana", pour: "Para", de: "Solicitado por", expire: "Este enlace ha caducado: pida uno nuevo.", introuvable: "Enlace no encontrado o revocado.",
    photo: "Hacer una foto", fichier: "Elegir un archivo", envoi: "Enviando…", recu: "Recibido", envoye: "enviado(s)", erreur: "Error de envío, inténtelo de nuevo.", taille: "Archivo demasiado grande (12 MB máx.).", type: "Formato no aceptado: foto o PDF.", plein: "Límite alcanzado: contáctenos.",
    autre: "Otro documento", aide: "Foto nítida, plana, documento completo. Los archivos solo llegan a su transportista.", valable: "Enlace válido hasta", fait: "Hecho", annuler: "Deshacer", ref: "Referencia", note: "Nota (opcional)", noteph: "inspección, observación…",
    aide2: "Marque cada etapa en cuanto se supere: el transportista y el conductor reciben el aviso.", a_faire: "Pendiente", fait_le: "Hecho el", docs: "A presentar" },
  ar: { depot: "أرسلوا وثائقكم", transit: "مراحل الجمارك", pour: "لـ", de: "مطلوب من طرف", expire: "انتهت صلاحية هذا الرابط: اطلبوا رابطًا جديدًا.", introuvable: "الرابط غير موجود أو أُلغي.",
    photo: "التقاط صورة", fichier: "اختيار ملف", envoi: "جارٍ الإرسال…", recu: "تم الاستلام", envoye: "مُرسل", erreur: "تعذر الإرسال، أعيدوا المحاولة.", taille: "الملف كبير جدًا (12 ميغابايت كحد أقصى).", type: "صيغة غير مقبولة: صورة أو PDF.", plein: "تم بلوغ الحد: اتصلوا بنا.",
    autre: "وثيقة أخرى", aide: "صورة واضحة ومسطحة للوثيقة كاملة. تُرسل الملفات إلى ناقلكم فقط.", valable: "الرابط صالح حتى", fait: "تم", annuler: "تراجع", ref: "المرجع", note: "ملاحظة (اختياري)", noteph: "تفتيش، ملاحظة…",
    aide2: "أشّروا على كل مرحلة فور اجتيازها: يتم إشعار الناقل والسائق.", a_faire: "للقيام به", fait_le: "تم في", docs: "للتقديم" },
};
const echapper = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function page(type, langue = "fr", erreur = "") {
  const l = T[langue] ? langue : "fr", t = T[l];
  const css = `:root{--bg:#f5f5f7;--card:#fff;--tx:#1d1d1f;--mu:#6e6e73;--pr:#0071e3;--ok:#1d8a3a;--da:#d70015;--bd:#e5e5ea;--s2:#f2f2f5}
@media(prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--tx:#f5f5f7;--mu:#98989d;--bd:#38383a;--s2:#2c2c2e;--pr:#0a84ff;--ok:#30d158}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans Arabic",sans-serif}
main{max-width:620px;margin:0 auto;padding:22px 16px 48px}h1{font-size:1.45rem;margin:4px 0 2px;letter-spacing:-.01em}.mu{color:var(--mu);font-size:.9rem}
.card{background:var(--card);border:1px solid var(--bd);border-radius:18px;padding:16px;margin:12px 0}.ligne{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.ligne b{font-size:1.02rem}.ok{color:var(--ok);font-weight:600}.da{color:var(--da)}.boutons{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
label.btn,button.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 16px;border-radius:999px;border:1px solid var(--bd);background:var(--card);color:var(--tx);font:inherit;font-weight:600;cursor:pointer;flex:1 1 auto}
label.btn.pr,button.btn.pr{background:var(--pr);border-color:var(--pr);color:#fff}input[type=file]{display:none}input[type=text]{width:100%;min-height:42px;border:1px solid var(--bd);border-radius:12px;padding:0 12px;font:inherit;background:var(--s2);color:var(--tx)}
.port{font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mu);margin:22px 0 4px}.etat{font-size:.85rem;margin-top:6px}.champs{display:grid;gap:8px;margin-top:10px}
.lang{display:flex;gap:10px;justify-content:center;margin-top:20px}.lang a{color:var(--mu);text-decoration:none;font-size:.9rem;padding:4px 8px;border-radius:8px}.lang a.on{background:var(--bd);color:var(--tx)}`;
  const langues = `<div class="lang">${["fr", "en", "es", "ar"].map((k) => `<a href="?lang=${k}" class="${k === l ? "on" : ""}">${{ fr: "Français", en: "English", es: "Español", ar: "العربية" }[k]}</a>`).join("")}</div>`;
  const tete = `<!doctype html><html lang="${l}" dir="${l === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${echapper(type === "depot" ? t.depot : t.transit)}</title><style>${css}</style></head><body><main>`;
  if (erreur) return `${tete}<h1>${echapper(type === "depot" ? t.depot : t.transit)}</h1><div class="card">${echapper(erreur === "expire" ? t.expire : t.introuvable)}</div>${langues}</main></body></html>`;
  const script = type === "depot" ? `
function reduire(f){return new Promise(function(ok){if(!/^image\\/(jpeg|png|webp)$/.test(f.type)||f.size<1200000||!window.createImageBitmap)return ok(f);createImageBitmap(f).then(function(b){var m=2000,r=Math.min(1,m/Math.max(b.width,b.height)),c=document.createElement("canvas");c.width=Math.round(b.width*r);c.height=Math.round(b.height*r);c.getContext("2d").drawImage(b,0,0,c.width,c.height);c.toBlob(function(x){ok(x&&x.size<f.size?new File([x],f.name.replace(/\\.\\w+$/,"")+".jpg",{type:"image/jpeg"}):f)},"image/jpeg",.85)}).catch(function(){ok(f)})})}
function envoyer(doc,fichiers,zone){var l=[].slice.call(fichiers);if(!l.length)return;zone.textContent=T.envoi;zone.className="etat mu";
 (function suivant(){var f=l.shift();if(!f){charger();return}reduire(f).then(function(x){var type=x.type||(/\\.pdf$/i.test(x.name)?"application/pdf":"");return fetch(location.pathname+"/fichier?doc="+encodeURIComponent(doc)+"&nom="+encodeURIComponent(x.name||"document"),{method:"POST",headers:{"Content-Type":type},body:x})}).then(function(r){if(r.ok)return suivant();zone.className="etat da";zone.textContent=r.status===413?T.taille:r.status===415?T.type:r.status===429||r.status===507?T.plein:T.erreur}).catch(function(){zone.className="etat da";zone.textContent=T.erreur})})()}
function rendre(d){document.getElementById("titre").textContent=d.titre||"";document.getElementById("de").textContent=d.entreprise?T.de+" "+d.entreprise:"";document.getElementById("msg").textContent=d.message||"";
 document.getElementById("exp").textContent=T.valable+" "+new Date(d.expire*1000).toLocaleDateString(L);
 var z=document.getElementById("liste");z.innerHTML="";d.docs.concat([{id:"autre",lib:T.autre,envoyes:d.autres||0}]).forEach(function(x){var c=document.createElement("div");c.className="card";
  c.innerHTML='<div class="ligne"><b></b><span class="etat"></span></div><div class="boutons"><label class="btn pr">📷 '+T.photo+'<input type="file" accept="image/*" capture="environment"></label><label class="btn">📎 '+T.fichier+'<input type="file" accept="image/*,application/pdf" multiple></label></div><div class="etat mu"></div>';
  c.querySelector("b").textContent=x.lib;var e=c.querySelector(".ligne .etat");if(x.recu){e.className="etat ok";e.textContent="✓ "+T.recu}else if(x.envoyes){e.className="etat ok";e.textContent="✓ "+x.envoyes+" "+T.envoye}
  var zone=c.querySelectorAll(".etat")[1];c.querySelectorAll("input").forEach(function(i){i.addEventListener("change",function(){envoyer(x.id,i.files,zone);i.value=""})});z.appendChild(c)})}
function charger(){fetch(location.pathname+"/donnees").then(function(r){return r.ok?r.json():Promise.reject(r.status)}).then(rendre).catch(function(s){document.getElementById("liste").innerHTML='<div class="card">'+(s===410?T.expire:T.introuvable)+"</div>"})}
charger();` : `
function poster(id,corps,zone){zone.textContent="…";fetch(location.pathname+"/etape",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.assign({etape:id},corps))}).then(function(r){if(!r.ok)throw 0;charger()}).catch(function(){zone.className="etat da";zone.textContent=T.erreur})}
function rendre(d){document.getElementById("titre").textContent=d.titre||"";document.getElementById("de").textContent=d.entreprise?T.de+" "+d.entreprise:"";document.getElementById("msg").textContent=d.message||"";
 document.getElementById("exp").textContent=T.valable+" "+new Date(d.expire*1000).toLocaleDateString(L);
 var z=document.getElementById("liste");z.innerHTML="";var port="";d.etapes.forEach(function(x){if(x.port!==port){port=x.port;var h=document.createElement("div");h.className="port";h.textContent=port;z.appendChild(h)}
  var c=document.createElement("div");c.className="card";c.innerHTML='<div class="ligne"><b></b><span class="etat"></span></div><div class="mu det"></div><div class="mu docs"></div><div class="champs"></div><div class="boutons"></div><div class="etat mu err"></div>';
  c.querySelector("b").textContent=x.lib;c.querySelector(".det").textContent=x.fait?"":x.detail||"";c.querySelector(".docs").textContent=!x.fait&&x.docs&&x.docs.length?T.docs+" : "+x.docs.join(" · "):"";
  var e=c.querySelector(".ligne .etat"),b=c.querySelector(".boutons"),ch=c.querySelector(".champs"),err=c.querySelector(".err");
  if(x.fait){e.className="etat ok";e.textContent="✓ "+T.fait_le+" "+new Date(x.date).toLocaleString(L,{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})+(x.ref?" · "+x.ref:"");
   var a=document.createElement("button");a.className="btn";a.textContent=T.annuler;a.onclick=function(){poster(x.id,{annuler:true},err)};b.appendChild(a)}
  else{e.className="etat mu";e.textContent=T.a_faire;
   if(x.refLib){var i=document.createElement("input");i.type="text";i.placeholder=x.refLib;i.setAttribute("aria-label",x.refLib);ch.appendChild(i)}
   var n=document.createElement("input");n.type="text";n.placeholder=T.note+" — "+T.noteph;n.setAttribute("aria-label",T.note);ch.appendChild(n);
   var f=document.createElement("button");f.className="btn pr";f.textContent="✓ "+T.fait;f.onclick=function(){poster(x.id,{ref:i?i.value:"",note:n.value},err)};b.appendChild(f)}
  z.appendChild(c)})}
function charger(){fetch(location.pathname+"/donnees").then(function(r){return r.ok?r.json():Promise.reject(r.status)}).then(rendre).catch(function(s){document.getElementById("liste").innerHTML='<div class="card">'+(s===410?T.expire:T.introuvable)+"</div>"})}
charger();setInterval(function(){if(!document.activeElement||document.activeElement.tagName!=="INPUT")charger()},60000);`;
  return `${tete}<div class="mu" id="de"></div><h1>${echapper(type === "depot" ? t.depot : t.transit)}</h1><div class="mu">${echapper(t.pour)} <b id="titre"></b></div>
<p id="msg"></p><p class="mu">${echapper(type === "depot" ? t.aide : t.aide2)}</p><div id="liste"></div><p class="mu" id="exp"></p>${langues}</main>
<script>var T=${JSON.stringify(t)},L=${JSON.stringify(l === "ar" ? "ar-MA" : l)};${script}</script></body></html>`;
}
module.exports = { page, TEXTES_LIENS: T };
