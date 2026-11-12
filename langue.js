"use strict";
/* ============================================================
   Langue de l'interface : français (par défaut) ou arabe (العربية, de droite à gauche).
   Traduction par dictionnaire des textes exacts de l'interface — couverture PARTIELLE :
   navigation, boutons, titres, écrans de voyage, de direction, d'opérations, de rentabilité et de notifications (testé : tests/noyau.test.js). Le reste reste en français.
   Choix propre à l'appareil (non inclus dans les sauvegardes).
   ============================================================ */
const AR = {
  // navigation
  "Accueil": "الرئيسية", "Exploitation": "الاستغلال", "Commandes": "الطلبيات", "Voyages": "الرحلات", "Traces GPS": "مسارات جي بي إس", "Importer une trace": "استيراد مسار", "Analyser et enregistrer": "تحليل وحفظ", "Zones (ports, frontières, dépôts, clients)": "المناطق (موانئ، حدود، مستودعات، زبناء)", "Traversées détectées": "العبورات المكتشفة", "Distance": "المسافة", "Durée": "المدة", "Vitesse moyenne": "السرعة المتوسطة", "Appliquer les étapes au voyage": "تطبيق المراحل على الرحلة", "Trajets": "المسارات", "Douane": "الجمارك",
  "Autorisations & visas": "التراخيص والتأشيرات", "Péages Maroc": "أداءات الطريق السيار", "Flotte": "الأسطول", "Camions": "الشاحنات", "Chauffeurs": "السائقون",
  "Gasoil": "الغازوال", "Gestion": "التدبير", "Clients": "الزبناء", "Factures": "الفواتير", "Outils": "الأدوات", "Codes SH": "رموز النظام المنسق", "Réglages": "الإعدادات",
  "Plus": "المزيد", "Rechercher": "بحث", "Données sur cet appareil": "البيانات محفوظة على هذا الجهاز",
  // actions
  "Enregistrer": "حفظ", "Annuler": "إلغاء", "Fermer": "إغلاق", "Modifier": "تعديل", "Supprimer": "حذف", "Ajouter": "إضافة", "Créer": "إنشاء", "Imprimer": "طباعة", "Photos": "الصور",
  "Vider": "إفراغ", "Retirer": "إزالة", "Terminer le voyage": "إنهاء الرحلة", "Nouveau voyage": "رحلة جديدة", "Nouvelle autorisation": "ترخيص جديد", "Nouvelle commande": "طلبية جديدة",
  "Nouveau client": "زبون جديد", "Ajouter un camion": "إضافة شاحنة", "Nouveau dossier": "ملف جديد", "Ajouter un séjour": "إضافة إقامة", "Marquer la sortie": "تسجيل الخروج",
  "Annuler la dernière étape": "إلغاء آخر مرحلة", "Mettre à jour": "تحديث", "Activer les rappels": "تفعيل التنبيهات", "Désactiver les rappels": "إيقاف التنبيهات",
  // voyages
  "Maroc ⇄ Europe : aller, traversée du détroit, retour, coût et marge": "المغرب ⇄ أوروبا: الذهاب، عبور المضيق، العودة، التكلفة والهامش",
  "Traversée du détroit (Tanger Med ⇄ Algeciras)": "عبور المضيق (طنجة المتوسط ⇄ الجزيرة الخضراء)", "Aller": "الذهاب", "Retour": "العودة",
  "Voyages en cours / prévus": "رحلات جارية / مبرمجة", "Traversées à réserver": "عبورات يجب حجزها", "Marge cumulée": "الهامش الإجمالي", "Retour à vide": "العودة فارغا",
  "Coût et marge": "التكلفة والهامش", "Péages Maroc": "أداءات الطريق السيار", "Péages Europe": "أداءات الطرق في أوروبا", "Traversées (aller + retour)": "العبورات (ذهاب + إياب)",
  "Carburant": "الوقود", "Per diem, hôtel": "تعويضات السفر والفندق", "Autres": "أخرى", "Coût total": "التكلفة الإجمالية", "Prix de vente": "سعر البيع", "Marge": "الهامش",
  "Étapes": "المراحل", "Listes de contrôle": "قوائم المراقبة", "Avant le départ": "قبل الانطلاق", "Arrivée en Europe": "الوصول إلى أوروبا", "Chargement et retour": "التحميل والعودة",
  "À régler avant le départ": "نقاط يجب تسويتها قبل الانطلاق", "Départ du dépôt": "الانطلاق من المستودع", "Douane export (BADR)": "جمارك التصدير (بدر)", "Entrée port Tanger Med": "دخول ميناء طنجة المتوسط",
  "Embarqué (aller)": "الصعود إلى الباخرة (ذهاب)", "Débarqué en Europe": "النزول في أوروبا", "Livré": "تم التسليم", "Chargement de retour": "تحميل العودة", "Embarqué (retour)": "الصعود إلى الباخرة (إياب)",
  "Débarqué à Tanger Med": "النزول بطنجة المتوسط", "Douane import": "جمارك الاستيراد", "Retour au dépôt": "العودة إلى المستودع",
  "Prévu": "مبرمج", "En cours": "جارٍ", "Terminé": "منتهٍ", "Annulé": "ملغى", "À réserver": "يجب حجزه", "Réservée": "محجوزة", "Effectuée": "منجزة", "Non renseignée": "غير مدخلة",
  "Interdictions de circuler des poids lourds (indicatif)": "منع سير الشاحنات الثقيلة (على سبيل الإرشاد)", "Pays": "البلد",
  // autorisations et Schengen
  "Autorisations bilatérales « E » / « MA » et compteur Schengen 90/180": "التراخيص الثنائية « E » / « MA » وعداد شنغن 90/180",
  "« E » disponibles": "« E » المتوفرة", "« MA » disponibles": "« MA » المتوفرة", "Comptes-rendus à remettre": "تقارير الرحلات الواجب تسليمها",
  "Autorisation": "الترخيص", "Validité": "الصلاحية", "Utilisation": "الاستعمال", "Compte-rendu": "تقرير الرحلة", "Disponible": "متوفر", "Remis": "مسلَّم", "À remettre": "يجب تسليمه",
  "Expirée": "منتهية الصلاحية", "Compteur Schengen (90 jours sur 180) par chauffeur": "عداد شنغن (90 يوما من 180) لكل سائق", "Limite dépassée": "تم تجاوز الحد",
  // péages
  "Grille officielle Autoroutes du Maroc, calcul par classe de véhicule": "التعريفة الرسمية للشركة الوطنية للطرق السيار بالمغرب حسب فئة العربة",
  "Trajets types": "مسارات نموذجية", "Ajouter une section": "إضافة مقطع", "Total, un sens": "المجموع، اتجاه واحد", "Classe": "الفئة",
  // accueil et général
  "À traiter": "للمعالجة", "Aujourd'hui": "اليوم", "Demain": "غدا", "En retard": "متأخر", "Général": "عام", "Données": "البيانات", "Rappels": "التنبيهات", "Appareil": "الجهاز",
  "Statut": "الحالة", "Client": "الزبون", "Chauffeur": "السائق", "Camion": "الشاحنة", "Référence": "المرجع", "Notes": "ملاحظات", "Numéro": "الرقم", "Marchandise": "البضاعة",
  "Départ prévu": "الانطلاق المبرمج", "Retour au dépôt prévu": "العودة المبرمجة إلى المستودع", "Date de traversée": "تاريخ العبور", "Armateur": "الناقل البحري",
  // pilotage (rentabilité, direction, trésorerie, simulateur), opérations, notifications, dépenses
  "Trésorerie à 90 jours": "الخزينة على مدى 90 يومًا", "Prochains mouvements": "الحركات القادمة", "Où se fait la marge": "من أين يأتي الهامش", "Où part l'argent": "أين تذهب الأموال", "Tendance sur 12 mois": "المنحى على مدى 12 شهرًا", "Résultat mensuel selon le taux de charge": "النتيجة الشهرية حسب نسبة الشحن", "Anomalies": "حالات شاذة", "L'entreprise ce mois-ci": "المقاولة هذا الشهر", "Direction": "الإدارة", "Résultat de la simulation": "نتيجة المحاكاة", "Résultat de l'entreprise en direct, trésorerie à 90 jours": "نتيجة المقاولة مباشرة، الخزينة على مدى 90 يومًا", "Solde aujourd'hui": "الرصيد اليوم", "Point le plus bas": "أدنى نقطة", "Dans 90 jours": "بعد 90 يومًا", "Chiffre d'affaires": "رقم المعاملات", "Marge directe": "الهامش المباشر", "Charges de structure": "التكاليف الهيكلية", "Marge nette": "الهامش الصافي", "Charge fixe ajoutée": "التكلفة الثابتة الإضافية", "Marge attendue": "الهامش المتوقع", "Résultat mensuel": "النتيجة الشهرية", "Trésorerie à 36 mois": "الخزينة بعد 36 شهرًا", "Charges du mois": "تكاليف الشهر", "Trésorerie": "الخزينة", "Point bas à 90 jours": "أدنى نقطة خلال 90 يومًا", "Ouvrir": "فتح", "Simuler un achat de camion": "محاكاة شراء شاحنة", "Tout voir": "عرض الكل", "Activités": "الأنشطة", "Scénario": "السيناريو", "Historique": "السجل", "Attentes aux ports": "الانتظار في الموانئ", "Conseils du moment": "نصائح اللحظة", "Opérations": "العمليات", "Chaque camion : où il est, ce qu'il fait, ce qui vient ensuite": "كل شاحنة: أين هي، ماذا تفعل، وما التالي", "Voyage": "الرحلة", "Planifier": "برمجة", "Carte": "الخريطة", "Sorti du port": "خرج من الميناء", "Destinataires": "المستلمون", "Qui est prévenu à chaque étape": "من يُخبَر في كل مرحلة", "Notifications": "الإشعارات", "Notifications par étape": "الإشعارات حسب المرحلة", "À envoyer vous-même": "للإرسال بأنفسكم", "Reporter d'une heure": "تأجيل ساعة", "Essai des canaux": "تجربة القنوات", "+1 h": "+1 س", "Tout marquer comme lu": "تعليم الكل كمقروء", "Essayer les canaux": "تجربة القنوات", "Message": "الرسالة", "Programmées": "المبرمجة", "Dernières": "الأخيرة", "Qui": "من", "Sujet ntfy (https://ntfy.sh/…)": "موضوع ntfy (https://ntfy.sh/…)", "E-mail": "البريد الإلكتروني", "WhatsApp": "واتساب", "Langue": "اللغة", "Étape": "المرحلة", "Auto": "تلقائي", "Charges fixes par camion": "التكاليف الثابتة لكل شاحنة", "Charges générales": "التكاليف العامة", "Échéances": "الآجال", "Par mois": "حسب الشهر", "Retours à combler": "رحلات عودة يجب ملؤها", "À prévoir": "ما يجب توقعه", "Rentabilité": "المردودية", "Coût complet au kilomètre : par camion, par corridor, par client": "التكلفة الكاملة للكيلومتر: حسب الشاحنة والممر والزبون", "Coût complet": "التكلفة الكاملة", "Coût complet au km": "التكلفة الكاملة للكيلومتر", "Détailler": "تفصيل", "Ajouter une charge": "إضافة تكلفة", "Ajouter une échéance": "إضافة أجل", "Exporter (CSV)": "تصدير (CSV)", "Copier l'annonce": "نسخ الإعلان", "Fret trouvé": "تم إيجاد الحمولة", "Voir": "عرض", "Km": "كلم", "Par km": "للكيلومتر", "Dépenses enregistrées": "المصاريف المسجلة", "Ajouter une dépense": "إضافة مصروف", "Dépenses à rattacher": "مصاريف يجب ربطها", "Rattacher": "ربط", "Saisir": "إدخال", "Plus tard": "لاحقًا", "Carte carburant": "بطاقة الوقود", "Enregistrer une amende": "تسجيل مخالفة", "Un passage au scanner est une attente exceptionnelle : il n'entre pas dans la médiane": "المرور عبر الماسح انتظار استثنائي: لا يدخل في الوسيط", "Importer le relevé CSV de votre carte carburant : chaque plein est rattaché au voyage du camion à cette date": "استيراد كشف CSV لبطاقة الوقود: تُربط كل تعبئة برحلة الشاحنة في ذلك التاريخ", "Ce mois": "هذا الشهر", "Mois dernier": "الشهر الماضي", "90 jours": "90 يومًا", "12 mois": "12 شهرًا", "Cette année": "هذه السنة", "Tout": "الكل", "30 jours": "30 يومًا", "Corridor": "الممر", "Mois": "الشهر", "Aucun voyage prévu": "لا رحلة مبرمجة", "Sans chauffeur": "بدون سائق", "Arrivée estimée": "الوصول المتوقع", "Notifier": "إخبار", "Passage au scanner": "المرور عبر الماسح", "Compter normalement": "احتسابه عاديًا", "Imposer (heures)": "فرض (بالساعات)", "Urgent": "عاجل", "À surveiller": "للمراقبة", "Appeler": "اتصال", "Ouvrir le voyage": "فتح الرحلة", "Proposer le retour": "اقتراح العودة", "Réserver": "حجز", "Ajouter la dépense": "إضافة المصروف", "Planifier un voyage": "برمجة رحلة", "Modifier les hypothèses": "تعديل الافتراضات", "Calculer": "حساب", "Envoyer": "إرسال", "Prochaine étape": "المرحلة التالية", "Rien à signaler": "لا شيء يُذكر", "Dépense ajoutée": "تمت إضافة المصروف", "Dépense supprimée": "تم حذف المصروف",
  "Mètres linéaires réservés": "الأمتار الطولية المحجوزة", "N° de réservation": "رقم الحجز", "Fret de base (€)": "الأجرة الأساسية (€)", "Passage chauffeur (€)": "تذكرة السائق (€)",
};
const LANGUES = [["fr", "Français"], ["ar", "العربية"]];
const langueActive = () => { try { return localStorage.getItem("logistique-langue") || "fr"; } catch { return "fr"; } };

function appliquerLangue(l = langueActive()) {
  document.documentElement.lang = l;
  document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
  if (l === "ar") traduire(document.body);
}
const traduireTexte = (t) => {
  const m = t.match(/^(\s*)([\s\S]*?)(\s*)$/); let a = AR[m[2]];
  if (!a && m[2].includes(" · ")) { const p = m[2].split(" · "); if (AR[p[0]]) a = [AR[p[0]], ...p.slice(1).map((x) => AR[x] || x)].join(" · "); } // « Anomalies · 3 », « Programmées · 24 h · 2 »
  return a ? m[1] + a + m[3] : t;
};
function traduire(racine) {
  if (langueActive() !== "ar") return;
  const w = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.parentElement && /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentElement.tagName)) continue;
    const t = n.nodeValue; if (!t.trim()) continue;
    const r = traduireTexte(t); if (r !== t) n.nodeValue = r;
  }
  racine.querySelectorAll?.("[placeholder],[title],[aria-label]").forEach((e) => ["placeholder", "title", "aria-label"].forEach((a) => { const v = e.getAttribute(a); if (v && AR[v]) e.setAttribute(a, AR[v]); }));
}
let _minuterieLangue = 0;
new MutationObserver(() => { if (langueActive() !== "ar") return; clearTimeout(_minuterieLangue); _minuterieLangue = setTimeout(() => traduire(document.body), 30); }).observe(document.body, { childList: true, subtree: true });
appliquerLangue();

enregistrerCarteReglages({
  onglet: "general", ordre: 5,
  rendu() {
    const l = langueActive();
    return `<div class="card"><div class="card-head"><h2>Langue · اللغة</h2></div>
      <div class="segmented" role="tablist">${LANGUES.map(([k, lib]) => `<button role="tab" data-act="langue" data-id="${k}" aria-selected="${k === l}">${lib}</button>`).join("")}</div>
      <p class="hint">L'arabe (de droite à gauche) couvre la navigation, les boutons, les écrans de voyage, de direction, d'opérations, de rentabilité et de notifications ; les phrases calculées (alertes, conseils) restent en français. · العربية تغطي القوائم والأزرار وشاشات الرحلات، ويبقى باقي التطبيق بالفرنسية حاليا.</p></div>`;
  },
  agir(act, id) {
    if (act !== "langue") return false;
    try { localStorage.setItem("logistique-langue", id); } catch { /* ignoré */ }
    location.reload();
    return true;
  },
});
