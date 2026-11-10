"use strict";
/* Page publique de suivi pour le client final : autonome, sans dépendance externe, rafraîchie toutes les 30 s. */
const TEXTES = {
  fr: { titre: "Suivi de votre livraison", ref: "Référence", statut: "Statut", arrivee: "Arrivée estimée", entre: "entre", et: "et", maj: "Mise à jour", il_y_a: "il y a", min: "min", h: "h", j: "j", s: "s",
    dans_temps: "Dans les temps", retard: "Retard probable de", avance: "En avance", livre: "Livré", livre_le: "Livré le", attente: "En attente de la première position", etapes: "Étapes", position: "Position approximative",
    indicatif: "Heure d'arrivée indicative, calculée d'après la position du camion, la traversée du détroit et les pauses réglementaires du chauffeur. Elle peut évoluer.", expire: "Ce lien de suivi a expiré.", introuvable: "Lien de suivi introuvable.",
    etats: { en_route: "En route", arret: "À l'arrêt (pause du chauffeur)", arret_long: "À l'arrêt (pause du chauffeur)", au_port: "Au port, formalités en cours", en_douane: "En formalités douanières", depot: "Au départ", client: "Chez le destinataire", traversee: "Traversée du détroit en cours", hors_ligne: "Position en cours de mise à jour", inconnu: "En attente de la première position", en_attente: "En attente de la première position" } },
  en: { titre: "Track your delivery", ref: "Reference", statut: "Status", arrivee: "Estimated arrival", entre: "between", et: "and", maj: "Updated", il_y_a: "", min: "min ago", h: "h ago", j: "d ago", s: "s ago",
    dans_temps: "On time", retard: "Likely delay of", avance: "Ahead of schedule", livre: "Delivered", livre_le: "Delivered on", attente: "Waiting for the first position", etapes: "Milestones", position: "Approximate position",
    indicatif: "Indicative arrival time, based on the truck's position, the strait crossing and the driver's mandatory rest. It may change.", expire: "This tracking link has expired.", introuvable: "Tracking link not found.",
    etats: { en_route: "On the road", arret: "Stopped (driver break)", arret_long: "Stopped (driver break)", au_port: "At the port, formalities in progress", en_douane: "Customs formalities", depot: "At origin", client: "At the consignee", traversee: "Crossing the strait", hors_ligne: "Position being updated", inconnu: "Waiting for the first position", en_attente: "Waiting for the first position" } },
  es: { titre: "Seguimiento de su entrega", ref: "Referencia", statut: "Estado", arrivee: "Llegada estimada", entre: "entre", et: "y", maj: "Actualizado", il_y_a: "hace", min: "min", h: "h", j: "d", s: "s",
    dans_temps: "En plazo", retard: "Retraso probable de", avance: "Adelantado", livre: "Entregado", livre_le: "Entregado el", attente: "Esperando la primera posición", etapes: "Etapas", position: "Posición aproximada",
    indicatif: "Hora de llegada indicativa, calculada según la posición del camión, el cruce del estrecho y los descansos obligatorios del conductor. Puede cambiar.", expire: "Este enlace de seguimiento ha caducado.", introuvable: "Enlace de seguimiento no encontrado.",
    etats: { en_route: "En ruta", arret: "Parado (descanso del conductor)", arret_long: "Parado (descanso del conductor)", au_port: "En el puerto, trámites en curso", en_douane: "Trámites aduaneros", depot: "En origen", client: "En destino", traversee: "Cruzando el estrecho", hors_ligne: "Posición en actualización", inconnu: "Esperando la primera posición", en_attente: "Esperando la primera posición" } },
  ar: { titre: "تتبع شحنتكم", ref: "المرجع", statut: "الحالة", arrivee: "الوصول المتوقع", entre: "بين", et: "و", maj: "آخر تحديث", il_y_a: "منذ", min: "د", h: "س", j: "ي", s: "ث",
    dans_temps: "في الموعد", retard: "تأخر محتمل قدره", avance: "قبل الموعد", livre: "تم التسليم", livre_le: "تم التسليم في", attente: "في انتظار أول موقع", etapes: "المراحل", position: "الموقع التقريبي",
    indicatif: "وقت وصول تقريبي محسوب حسب موقع الشاحنة وعبور المضيق وفترات الراحة القانونية للسائق، وقد يتغير.", expire: "انتهت صلاحية رابط التتبع.", introuvable: "رابط التتبع غير موجود.",
    etats: { en_route: "في الطريق", arret: "متوقفة (راحة السائق)", arret_long: "متوقفة (راحة السائق)", au_port: "في الميناء، الإجراءات جارية", en_douane: "إجراءات جمركية", depot: "في نقطة الانطلاق", client: "عند المستلم", traversee: "عبور المضيق جارٍ", hors_ligne: "تحديث الموقع جارٍ", inconnu: "في انتظار أول موقع", en_attente: "في انتظار أول موقع" } },
};
const echapper = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function page(langue = "fr") {
  const l = TEXTES[langue] ? langue : "fr";
  return `<!doctype html><html lang="${l}" dir="${l === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>${echapper(TEXTES[l].titre)}</title><style>
:root{--bg:#f5f6f8;--card:#fff;--tx:#111827;--mu:#6b7280;--pr:#2563eb;--ok:#16a34a;--wa:#d97706;--da:#dc2626;--bd:#e5e7eb}
@media(prefers-color-scheme:dark){:root{--bg:#0b0f14;--card:#151b23;--tx:#f3f4f6;--mu:#9ca3af;--bd:#263040}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:20px 16px 40px}h1{font-size:1.35rem;margin:6px 0 2px}.mu{color:var(--mu);font-size:.9rem}
.card{background:var(--card);border:1px solid var(--bd);border-radius:18px;padding:18px;margin:14px 0}.pill{display:inline-block;padding:6px 14px;border-radius:99px;font-weight:600;background:color-mix(in srgb,var(--pr) 14%,transparent);color:var(--pr)}
.pill.ok{background:color-mix(in srgb,var(--ok) 15%,transparent);color:var(--ok)}.pill.wa{background:color-mix(in srgb,var(--wa) 16%,transparent);color:var(--wa)}
.eta{font-size:1.6rem;font-weight:700;letter-spacing:-.02em;margin:6px 0 2px}.bar{height:10px;background:var(--bd);border-radius:99px;overflow:hidden;margin:14px 0 6px}.bar i{display:block;height:100%;background:var(--pr);border-radius:inherit;transition:width .6s}
ol{list-style:none;margin:0;padding:0}li{display:flex;gap:12px;padding:0 0 14px;position:relative}li:before{content:"";position:absolute;inset-inline-start:6px;top:16px;bottom:0;width:2px;background:var(--bd)}li:last-child:before{display:none}li b{display:block;font-weight:600}
li i{flex:none;width:14px;height:14px;border-radius:50%;background:var(--pr);margin-top:3px}svg{width:100%;height:auto;display:block;border-radius:12px;background:color-mix(in srgb,var(--pr) 6%,transparent)}
.lang{display:flex;gap:10px;justify-content:center;margin-top:18px}.lang a{color:var(--mu);text-decoration:none;font-size:.9rem;padding:4px 8px;border-radius:8px}.lang a.on{background:var(--bd);color:var(--tx)}
</style></head><body><main><div class="mu" id="ref"></div><h1 id="route">&nbsp;</h1><div id="contenu"></div>
<p class="mu" id="note"></p><div class="lang">${["fr", "en", "es", "ar"].map((k) => `<a href="?lang=${k}" class="${k === l ? "on" : ""}">${{ fr: "Français", en: "English", es: "Español", ar: "العربية" }[k]}</a>`).join("")}</div></main>
<script>
var T=${JSON.stringify(TEXTES[l])},L=${JSON.stringify(l)};
function ago(s){s=Math.max(0,s);var v=s<90?[Math.round(s),T.s]:s<5400?[Math.round(s/60),T.min]:s<172800?[Math.round(s/3600),T.h]:[Math.round(s/86400),T.j];return (T.il_y_a?T.il_y_a+" ":"")+v[0]+" "+v[1]}
function hm(t){return new Date(t*1000).toLocaleTimeString(L,{hour:"2-digit",minute:"2-digit"})}
function jour(t){return new Date(t*1000).toDateString()}function bord(t,ref){return jour(t)==jour(ref)?hm(t):dt(t)}
function dt(t){return new Date(t*1000).toLocaleString(L,{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function carte(d){var p=[[d.orig,"o"],[d.dest,"d"],[d.position,"t"]].filter(function(x){return x[0]});if(p.length<2)return"";
 var la=p.map(function(x){return x[0][0]}),lo=p.map(function(x){return x[0][1]}),k=Math.cos((Math.min.apply(0,la)+Math.max.apply(0,la))/2*Math.PI/180);
 var w=Math.max((Math.max.apply(0,lo)-Math.min.apply(0,lo))*k,.01),h=Math.max(Math.max.apply(0,la)-Math.min.apply(0,la),.01),e=Math.min(520/w,200/h),W=600,H=240;
 function X(x){return 40+(x-Math.min.apply(0,lo))*k*e+(520-w*e)/2}function Y(y){return H-20-(y-Math.min.apply(0,la))*e-(200-h*e)/2}
 var pts=[d.orig,d.position,d.dest].filter(Boolean).map(function(q){return X(q[1]).toFixed(1)+","+Y(q[0]).toFixed(1)}).join(" ");
 var s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(T.position)+'"><polyline points="'+pts+'" fill="none" stroke="#2563eb" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round"/>';
 p.forEach(function(x){var c=x[1]=="t"?"#d97706":x[1]=="d"?"#16a34a":"#6b7280",r=x[1]=="t"?9:6;s+='<circle cx="'+X(x[0][1]).toFixed(1)+'" cy="'+Y(x[0][0]).toFixed(1)+'" r="'+r+'" fill="'+c+'" stroke="#fff" stroke-width="2"/>'});return s+"</svg>"}
function rendre(d){
 document.getElementById("ref").textContent=T.ref+" "+d.reference;document.getElementById("route").textContent=d.origine+" → "+d.destination;
 var h="",liv=d.statut=="livre",et=T.etats[d.etat]||T.etats.inconnu;
 h+='<div class="card"><span class="pill'+(liv?" ok":"")+'">'+esc(liv?T.livre:et)+"</span>";
 if(!liv&&d.eta){h+='<div class="eta">'+esc(dt(d.eta.arrivee))+'</div><div class="mu">'+T.entre+" "+esc(bord(d.eta.min,d.eta.arrivee))+" "+T.et+" "+esc(bord(d.eta.max,d.eta.arrivee))+"</div>";
  if(d.retardMin!==null){var r=d.retardMin;h+='<p><span class="pill '+(r>30?"wa":"ok")+'">'+(r>30?T.retard+" "+(r>=90?Math.round(r/60)+" "+T.h.split(" ")[0]:r+" "+T.min.split(" ")[0]):r<-30?T.avance:T.dans_temps)+"</span></p>"}}
 if(liv&&d.livreLe)h+='<div class="eta">'+esc(T.livre_le+" "+dt(d.livreLe))+"</div>";
 if(!liv&&d.progression!==null)h+='<div class="bar"><i style="width:'+d.progression+'%"></i></div>';
 if(!d.position&&!d.eta&&!liv)h+='<p class="mu">'+esc(T.attente)+"</p>";
 if(d.maj)h+='<div class="mu">'+T.maj+" "+esc(ago(Math.floor(Date.now()/1000)-d.maj))+"</div>";h+="</div>";
 if(!liv&&d.position)h+='<div class="card">'+carte(d)+"</div>";
 if(d.etapes&&d.etapes.length){h+='<div class="card"><b>'+T.etapes+"</b><ol style='margin-top:12px'>"+d.etapes.map(function(e){return"<li><i></i><div><b>"+esc(e.libelle)+'</b><span class="mu">'+(e.date?esc(dt(Date.parse(e.date)/1000)):"")+"</span></div></li>"}).join("")+"</ol></div>"}
 if(d.message)h+='<div class="card">'+esc(d.message)+"</div>";
 document.getElementById("contenu").innerHTML=h;document.getElementById("note").textContent=T.indicatif}
function charger(){fetch(location.pathname.replace(/[/]$/,"")+"/donnees",{cache:"no-store"}).then(function(r){if(r.status==410)throw T.expire;if(!r.ok)throw T.introuvable;return r.json()}).then(rendre).catch(function(m){document.getElementById("contenu").innerHTML='<div class="card">'+esc(typeof m=="string"?m:T.introuvable)+"</div>"})}
charger();setInterval(charger,30000);
</script></body></html>`;
}
module.exports = { page, TEXTES };
