# 07 — Déploiement conforme au RGPD et à la loi 09-08

Guide pratique pour héberger le relais et utiliser l'application sans exposer les données des chauffeurs et des clients, avec un bureau au Maroc et un en Allemagne.

> ⚠️ Ce document décrit des **mesures techniques** et rappelle les textes applicables. Ce n'est pas un avis juridique : faites valider la base légale, la notice et les clauses de transfert par un juriste ou votre délégué à la protection des données avant la mise en service.

## 1. Quelles données, où

| Donnée | Personnelle ? | Où elle vit | Durée par défaut |
|---|---|---|---|
| Positions GPS des camions | Oui : elles localisent le chauffeur | Relais (`positions-*.jsonl`), appareils | 30 jours sur le relais (`RETENTION_JOURS`) |
| Voyages, dépenses, factures, clients | Oui (noms, téléphones, e-mails) | Appareils ; relais **chiffré par l'application** (synchronisation) | Tant que l'entreprise en a besoin |
| Photos (CMR, reçus, livraison) | Souvent | Appareils ; relais chiffré par l'application | 18 mois conseillés (`PURGE_PHOTOS_MOIS=18`) |
| Fichiers de carte conducteur (.ddd) | Oui | Appareils seulement | 12 mois au moins pour le tachygraphe (règlement (UE) 165/2014) — 🔶 à confirmer |
| Alertes | Oui (plaque, retard) | Relais (`alertes.jsonl`) | 7 jours |
| Notifications programmées | Oui (texte, destinataire) | Relais (`scheduler.json`) | 30 jours après l'envoi |
| Journal d'accès | Adresse IP tronquée | Relais (`acces-*.jsonl`) | 30 jours |
| Lien de suivi client | Position arrondie (≈ 10 km) | Relais (`partages.json`) | 14 jours, révocable |

**Ce que le relais ne voit jamais en clair** : la synchronisation et les photos sont chiffrées par l'application avec votre mot de passe (AES-256-GCM) ; le relais ne stocke qu'un bloc illisible.

## 2. Trois couches de chiffrement

1. **Dans l'application** : synchronisation et photos chiffrées avant l'envoi (déjà en place).
2. **Sur le disque du relais** : `CHIFFRER_DONNEES=true` chiffre *tous* les fichiers du relais (positions, partages, alertes, notifications, journal d'accès, photos). La clé vient d'une phrase secrète :
   - `CLE_DONNEES=…` (variable d'environnement, 12 caractères au moins) — **recommandé** : la phrase ne reste pas à côté des données ;
   - sinon le fichier `donnees/cle.env` (mode 600), créé au premier démarrage. Déplacez-le avec `FICHIER_CLE=/autre/disque/cle.env`.
   - Notez la phrase dans un coffre-fort : **sans elle, les données du relais sont perdues**.
   - Un relais déjà en service peut passer au chiffrement à tout moment : les anciens fichiers restent lisibles et sont réécrits chiffrés au fil de l'eau.
3. **Disque entier (LUKS)** sur un serveur loué : protège aussi le système, les journaux et l'espace d'échange.

```bash
# Exemple sur un disque de données dédié (Debian/Ubuntu) — à adapter
sudo apt install cryptsetup
sudo cryptsetup luksFormat /dev/sdb          # demande une phrase secrète
sudo cryptsetup open /dev/sdb donnees
sudo mkfs.ext4 /dev/mapper/donnees && sudo mount /dev/mapper/donnees /srv/relais
DONNEES=/srv/relais CHIFFRER_DONNEES=true CLE_DONNEES='…' node serveur/relais.js
```

Le chiffrement du relais est une **défense en profondeur** : il ne remplace pas LUKS sur un serveur loué, et LUKS ne remplace pas le chiffrement du relais (sauvegardes, copies du dossier).

## 3. Réglages du relais à activer

```bash
CHIFFRER_DONNEES=true            # fichiers chiffrés au repos
CLE_DONNEES='phrase longue et secrète'
RETENTION_JOURS=30               # positions
PURGE_PHOTOS_MOIS=18             # photos : marquées à 18 mois, supprimées 30 jours plus tard (journal purge.log)
JOURNAL_ACCES=true               # qui a lu quoi (adresse tronquée, jamais le jeton), 30 jours
```

- **HTTPS obligatoire** dès que le relais est joignable depuis Internet (tunnel gratuit ou serveur loué : voir `serveur/README.md`).
- Jetons séparés : `JETON_ECRITURE` (balises) ne permet pas de lire ; `JETON_LECTURE` (application) ne permet pas d'écrire de positions. Changez-les si un téléphone est perdu.
- Purge manuelle possible, relais arrêté : `node serveur/purge-photos.js --mois 18 --simulation` puis sans `--simulation`.
- Une photo purgée laisse une trace : les appareils synchronisés suppriment aussi leur copie.

## 4. Textes applicables (🔶 à faire valider)

**Allemagne / Union européenne — RGPD**
- Base légale du suivi GPS des camions : exécution du contrat et obligations légales (temps de conduite, sûreté du fret), intérêt légitime pour la localisation en cours de mission (article 6, paragraphe 1, points b, c et f). Pas de suivi en dehors du service : le téléphone balise du chauffeur s'arrête en fin de voyage.
- Salariés en Allemagne : la base « emploi » du § 26 BDSG est fragilisée depuis l'arrêt de la CJUE du 30 mars 2023 (C-34/21) ; appuyez-vous sur l'article 6 du RGPD. S'il existe un comité d'entreprise (*Betriebsrat*), le suivi technique des salariés relève de sa codécision (§ 87, alinéa 1, n° 6 BetrVG) : accord d'entreprise à prévoir.
- Analyse d'impact (AIPD, article 35) : recommandée pour la géolocalisation des salariés.
- Registre des traitements (article 30) : y inscrire le suivi, la synchronisation, les notifications.

**Maroc — loi 09-08 et CNDP**
- Déclaration (ou demande d'autorisation) du traitement auprès de la CNDP avant la mise en service.
- Transfert de données vers l'étranger (relais en Europe, bureau en Allemagne) : soumis à l'autorisation de la CNDP lorsque le pays de destination n'est pas reconnu comme offrant une protection suffisante.

**Transfert Union européenne → Maroc**
- Le Maroc ne bénéficie pas d'une décision d'adéquation de la Commission européenne. Les données de salariés ou de clients européens consultées depuis le bureau marocain relèvent d'un transfert : **clauses contractuelles types** (décision d'exécution (UE) 2021/914) entre les deux entités, avec une évaluation des risques du transfert.
- Mesures qui réduisent ce risque et que l'application met déjà en œuvre : chiffrement de bout en bout de la synchronisation, données minimales sur le relais, lien client sans nom de chauffeur ni plaque.

## 5. Informer les chauffeurs

À remettre (et faire signer) à chaque chauffeur avant l'activation du suivi. Adaptez les crochets.

### Français
> **Information sur la géolocalisation des véhicules**
> [Entreprise], [adresse], responsable du traitement, localise les véhicules pendant les missions de transport pour : organiser les voyages, prévenir les clients de l'heure d'arrivée, respecter les temps de conduite et de repos, assurer la sécurité du chargement. Positions conservées 30 jours, photos de livraison 18 mois, données du tachygraphe selon la durée légale. Destinataires : l'exploitation (Maroc et Allemagne), la direction ; les clients ne voient qu'une position arrondie et l'heure d'arrivée, jamais votre nom. Aucun suivi en dehors du service. Vous pouvez accéder à vos données, les faire corriger ou effacer et vous opposer au traitement en écrivant à [contact]. Vous pouvez saisir la CNDP (Maroc) ou l'autorité de protection des données compétente (Allemagne).

### العربية
> **إشعار بخصوص تحديد الموقع الجغرافي للمركبات**
> تقوم [المقاولة]، [العنوان]، بصفتها المسؤولة عن المعالجة، بتحديد موقع المركبات أثناء مهام النقل من أجل: تنظيم الرحلات، وإخبار الزبناء بموعد الوصول، واحترام مدد السياقة والراحة، وضمان سلامة الحمولة. تُحفَظ المواقع 30 يومًا، وصور التسليم 18 شهرًا، وبيانات جهاز التاكوغراف حسب المدة القانونية. الجهات المطّلعة: مصلحة الاستغلال (المغرب وألمانيا) والإدارة؛ لا يرى الزبناء إلا موقعًا تقريبيًا وموعد الوصول، ولا يرون اسمك أبدًا. لا يتم أي تتبع خارج أوقات العمل. يمكنك الاطلاع على بياناتك وطلب تصحيحها أو حذفها والاعتراض على معالجتها بالكتابة إلى [جهة الاتصال]. ويمكنك اللجوء إلى اللجنة الوطنية لمراقبة حماية المعطيات ذات الطابع الشخصي (المغرب) أو إلى سلطة حماية البيانات المختصة (ألمانيا).

### Deutsch
> **Information zur Fahrzeugortung**
> [Unternehmen], [Anschrift], Verantwortlicher, ortet die Fahrzeuge während der Transportaufträge, um Fahrten zu planen, Kunden über die Ankunftszeit zu informieren, Lenk- und Ruhezeiten einzuhalten und die Ladung zu sichern. Speicherdauer: Positionen 30 Tage, Lieferfotos 18 Monate, Fahrtenschreiberdaten nach gesetzlicher Frist. Empfänger: Disposition (Marokko und Deutschland), Geschäftsleitung; Kunden sehen nur eine ungefähre Position und die Ankunftszeit, nie Ihren Namen. Keine Ortung außerhalb der Arbeitszeit. Sie haben das Recht auf Auskunft, Berichtigung, Löschung und Widerspruch: [Kontakt]. Sie können sich bei der zuständigen Datenschutzaufsichtsbehörde beschweren.

## 6. Répondre à une demande d'un chauffeur ou d'un client

| Demande | Comment |
|---|---|
| Accès | Réglages → Données → export (tableur) ; filtrer sur la personne. Positions : `GET /api/trace` du relais pour sa balise. |
| Rectification | Modifier la fiche (chauffeur, client) : la synchronisation propage la correction. |
| Effacement | Supprimer la fiche et ses photos dans l'application ; la suppression se propage aux autres appareils et au relais. Les positions disparaissent seules après `RETENTION_JOURS`. |
| Opposition au suivi | Retirer la balise du camion dans la fiche, arrêter le téléphone balise du chauffeur. |

## 7. Liste de contrôle avant la mise en service

- [ ] Relais en HTTPS, jetons changés, `CHIFFRER_DONNEES=true`, phrase secrète sauvegardée hors du serveur.
- [ ] Serveur loué : disque chiffré (LUKS), mises à jour automatiques, pare-feu (seul le port HTTPS ouvert).
- [ ] `RETENTION_JOURS`, `PURGE_PHOTOS_MOIS`, `JOURNAL_ACCES` réglés.
- [ ] Notice remise et signée par chaque chauffeur ; accord d'entreprise si un *Betriebsrat* existe.
- [ ] Déclaration CNDP faite ; clauses contractuelles types signées entre l'entité allemande et l'entité marocaine.
- [ ] Registre des traitements à jour ; analyse d'impact faite pour la géolocalisation.
- [ ] Clients : accord explicite avant toute notification (case « Le client accepte d'être prévenu » sur sa fiche).
