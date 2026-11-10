# Audit — Le voyage d'un transporteur marocain vers l'Europe, et retour

**Date** : 10 novembre 2026 · **Périmètre** : transport routier international de marchandises (camion + semi-remorque, régime TIR) entre le Maroc et l'Europe, par le détroit (Tanger Med ⇄ Algeciras) · **Documents liés** : [02 — Cahier des charges de l'application de suivi](02-cahier-des-charges-application-suivi.md) · [03 — Annexes](03-annexes.md)

---

## 0. Comment lire ce document

| Pastille | Sens |
|---|---|
| ✅ | **Sourcé** : confirmé par au moins une source citée (liens en section 9). |
| 🔶 | **À vérifier** : connaissance générale du secteur, ou source partielle ou commerciale. À confirmer auprès de l'administration, d'un transitaire ou de l'AMTRI avant toute décision. |
| ❓ | **Non confirmé** : recherché sans succès. Ne pas s'y fier. |

**Limites de la recherche** (à lire) :

- **Mise à jour du 10 novembre 2026** : l'accès internet complet a permis de **télécharger directement** la grille tarifaire officielle d'ADM (584 sections), les pages ADM sur les classes de véhicules et sur Jawaz Pro, le texte du décret marocain sur les poids et dimensions, la page Mappy sur ses API et les tarifs publiés des armateurs GNV et DFDS : ces points sont désormais ✅ **officiels** (date de relevé 10/11/2026). Certains sites (CapMad, Médias24) bloquent les robots : leurs informations restent issues de résumés de recherche.
- Les **tarifs de péage doivent être revérifiés avant chaque usage commercial** : la grille ADM ne porte pas de date d'effet visible et a changé entre 2024 et 2026.
- Aucun texte de loi n'a été consulté en version intégrale. Ce document **n'est ni un avis juridique, ni un avis douanier, ni un avis fiscal**.
- Beaucoup de faits évoluent vite (quotas, visas, péages européens 2026, EES). La date de chaque source compte : voir section 9.

---

## 1. Résumé exécutif

**Le voyage en une phrase.** Commande → conformité (autorisation bilatérale, visa du chauffeur, carnet TIR) → chargement scellé → autoroutes ADM → Tanger Med (douane H24, zone TIR) → ferry (~1 h 30) → Algeciras (police Schengen/EES, douane, contrôle sanitaire) → route d'Europe (temps de conduite, péages par pays, interdictions) → livraison et douane de destination → recherche d'un fret retour (ou retour à vide) → import au Maroc → clôture (carnet TIR, CMR, coûts).

### Les 13 constats qui comptent

1. **Le goulot n'est pas le camion : ce sont les droits d'accès.** Chaque pays se négocie par **autorisations bilatérales** (Espagne : « au voyage » valable 3 mois, ou « à temps » annuelle ; autorisations « E » de transit), en **quotas régulièrement épuisés**, **non transférables** ✅. Un transporteur sans autorisation a des camions immobiles. L'application doit gérer le stock d'autorisations comme un actif.
2. **Le second goulot est humain : le visa Schengen du chauffeur.** La presse marocaine rapporte une réduction d'environ 50 % des visas français aux chauffeurs depuis septembre 2025 ; le consul de France conteste ces chiffres et avance **≈ 70 % d'octroi** pour les routiers ✅ ; le dossier restait « bloqué » en mai 2026 ✅. Sans chauffeur visé, pas de voyage.
3. **L'EES (système d'entrée/sortie) enregistre chaque passage et fait respecter strictement la règle 90 jours sur 180** ✅. Il faut un **décompte des jours Schengen par chauffeur**.
4. **Le retour est le levier n°1 de rentabilité.** Les opérateurs marocains reviennent souvent à vide, faute de clients dans le pays de livraison ✅ (ratio cité dans la presse : 700 camions partis pour 500 revenus chargés, contexte non précisé 🔶).
5. **Péages Maroc (grille officielle ADM, 584 sections, 3 classes).** Un ensemble articulé relève de la **classe 3** (plus de 2 essieux et hauteur > 1,30 m) ; un porteur à **2 essieux est en classe 2** ✅. Exemples en classe 3 : **Casablanca → Tanger Med = 253 MAD** (43 + 28 + 182), **Agadir → Tanger Med = 601 MAD** (11 + 337 + 43 + 28 + 182) ✅. La grille a été **révisée entre 2024 et 2026** (41 → 43 et 179 → 182 sur deux sections) ✅ : les tarifs doivent être **versionnés par date**.
6. **Péages Europe.** Postes variables majeurs, très différents d'un pays à l'autre ; Allemagne ≈ 0,35 €/km pour un 40 t Euro VI (dont ≈ 0,16 €/km de CO₂), Autriche ≈ 0,48 €/km, Suisse ≈ 0,74–0,95 €/km, Pays-Bas : taxe au kilomètre en 2026 🔶 (sources commerciales).
7. **Temps de conduite et repos** : règles européennes strictes, repos hebdomadaire **hors cabine** ✅ ; amendes de 1 000 à 3 000 € couramment, jusqu'à ≈ 7 300 € cité en Suède ✅.
8. **Dépendance au port d'Algeciras** : en janvier 2026, une tempête a bloqué ≈ 2 800 camions et l'accès a été limité aux poids lourds **avec réservation confirmée** ✅. Un point de contrôle unique fruits et légumes existe à Algeciras depuis octobre 2024 ✅.
9. **Mappy** : son API (4 briques : cartes, itinéraire multimodal, suggestion, géocodage) propose un mode **poids lourds** dont **les prix et les temps sont adaptés mais pas les restrictions de circulation** (hauteur, poids, interdictions) ✅, et met en avant le **coût complet carburant + péages** ✅. Données hébergées en Europe, société française : **couverture Espagne/Maroc et détail des péages non précisés** ❓. Mappy convient donc pour **estimer coût et temps**, **pas pour garantir qu'un itinéraire est légal pour votre gabarit**. La vérité terrain, ce sont **vos balises GPS**.
10. **Angle mort remorque** : le GPS est sur le tracteur. Dès qu'une remorque est laissée, échangée ou embarquée sans tracteur, le suivi s'arrête 🔶.
11. **Données personnelles** : la CNDP exige la **déclaration** de la géolocalisation des véhicules de salariés et l'**information** des intéressés (délibération 17-2014) ✅ ; le RGPD s'applique en Europe 🔶.
12. **Alternative maritime longue.** Les lignes **Sète ⇄ Tanger Med** (GNV) évitent l'Espagne, la France et les péages européens : pour un ensemble de 16,5 m, **≈ 3 640 € de fret et surcharges** à l'aller (+ 150 € de passage chauffeur), tarif valable depuis le 08/10/2026 ✅. Le détroit (DFDS) est à la **remorque non accompagnée** et au **mètre linéaire**, sur devis ✅. Ces options contournent en partie les **permis** et les **visas** 🔶.
13. **Vérité d'un voyage = une chaîne d'événements** (positions, jalons, documents, coûts). Une application qui ne relie pas **commande ↔ voyage ↔ étapes ↔ documents ↔ coûts ↔ positions** restera un tableau de bord de plus.

### Cinq décisions à prendre avant de construire

| # | Décision | Pourquoi c'est structurant |
|---|---|---|
| 1 | **Quel fournisseur GPS, quel accès aux données (API, export) ?** | Détermine si l'on intègre ou si l'on rebâtit. Voir cahier des charges §5. |
| 2 | **Accepter un serveur ?** | Le suivi temps réel est incompatible avec « 100 % hors ligne, sans serveur ». Hybride recommandé. |
| 3 | **Quels pays et ports ?** | Règles, péages, documents et autorisations varient par pays. |
| 4 | **Balises GPS sur les remorques ?** | Sinon le suivi s'arrête aux relais et remorques non accompagnées. |
| 5 | **Qui fait la douane : en interne ou transitaire ?** | Détermine quelles étapes l'application doit piloter ou seulement suivre. |

---

## 2. Contexte et contraintes structurelles

### 2.1 Accès au marché : les autorisations bilatérales

- Le Maroc accède aux marchés européens par **accords bilatéraux** pays par pays ; le système multilatéral CEMT (43 pays dont l'UE) est **inaccessible** aux transporteurs marocains faute de contingent ✅.
- **Espagne** : accord bilatéral de 2012 ✅ ; contingent fixé par une commission mixte ; deux types d'autorisations — **« au voyage »** (un aller-retour, validité ≤ 3 mois) et **« à temps »** (nombre défini d'aller-retours sur un an) ✅ ; les autorisations **« E »** servent au **transit** par l'Espagne vers les autres pays européens et sont les plus sollicitées ✅.
- Le côté marocain **épuise régulièrement son contingent** ; l'Espagne en consomme peu ✅. En 2017, le Maroc a obtenu 8 500 autorisations supplémentaires ✅.
- **France** : quota bilatéral relevé par commission mixte ✅. **Portugal** : quota augmenté en janvier 2025 ✅. **Pays-Bas** : à l'expiration du contingent, les transporteurs marocains ne pouvaient plus desservir le marché ✅ (article ancien).
- **Calendrier et émission** : deux contingents sont **échangés chaque novembre** pour l'année suivante — les autorisations **« E »** (délivrées par l'Espagne) et **« MA »** (délivrées par le Maroc) ✅ ; la surconsommation des « E » fait que le stock s'épuise **de plus en plus tôt dans l'année** ✅ ; le ministère a commandé une étude sur un **modèle de fixation du contingent** ✅ ; un ordre de grandeur ancien de **70 000 autorisations de chaque côté** ❓ est à vérifier.
- **Compte-rendu de voyage** : l'accord bilatéral soumet tout transport international au **régime de l'autorisation préalable accompagnée d'un compte-rendu de voyage** ✅ (texte non consulté en entier) : l'application doit produire et archiver ce compte-rendu par voyage.
- Une autorisation est **nominative** (utilisable par le transporteur au nom duquel elle est établie) et **non transférable** ✅.
- Côté marocain, un cahier des charges de 2021 cite l'**autorisation « F »** de l'année pour le transport international de marchandises parmi les pièces d'un dossier visa ✅ (liste ancienne 🔶).
- **Ce que le transporteur ne peut pas faire** : les autorisations bilatérales couvrent des trajets **Maroc ⇄ pays** (et transit). Le **cabotage** (chargement et livraison dans un même pays étranger) et le **cross-trade** (pays tiers → pays tiers) relèvent du règlement (CE) 1072/2009, conçu pour les transporteurs de l'UE : pour un transporteur marocain ils sont, en principe, **non ouverts** 🔶 (non confirmé par les sources trouvées ; à vérifier avec un transitaire ou le ministère).

- **Alternative** : la presse marocaine présente le **maritime** (lignes directes vers l'Europe, remorques non accompagnées) comme alternative à la saturation des autorisations espagnoles ✅ — voir §6.5.

> **Conséquence pour l'application** : registre des autorisations (pays, type, numéro, validité, voyages restants, voyage consommé), alerte avant épuisement et avant expiration, et refus de planifier un voyage sans autorisation affectée.

### 2.2 Visas Schengen des chauffeurs : la crise 2025–2026

- Pas de catégorie « chauffeur routier » au consulat de France : ces demandes relèvent de visas professionnels de circulation ✅. Le consulat travaille avec des « tiers de confiance » dont l'**AMTRI** ✅.
- La presse rapporte une **baisse d'environ 50 % des visas** français aux Marocains depuis septembre 2025, touchant des centaines d'entreprises de transport ✅. Les professionnels avancent des taux d'octroi très bas (2–3 %), **que le consulat réfute** ✅ : **chiffres contestés, ne pas les citer comme faits**.
- Motifs de refus cités par le consulat : irrégularités formelles, par exemple affiliation **CNSS** non mise au nom de la nouvelle entreprise d'un chauffeur récemment recruté ✅.
- Proposition marocaine : **visa professionnel** plus souple, inspiré de l'expérience croate ; en mai 2026 le dossier restait **bloqué dans l'attente d'une décision européenne** ✅. Le ministre marocain des Transports a mené une réunion en visioconférence avec le commissaire européen : des solutions à court, moyen et long terme ont été proposées, en attente d'une modification de la réglementation sur les **visas électroniques** ✅.
- Selon l'AMTRI, les visas accordés aux routiers sont surtout des **visas touristiques de 90 jours au plus, non consécutifs** ✅ ; l'**EES** aggrave les difficultés et les transporteurs ont préparé une **grève nationale** en avril 2026 ✅ ; **l'Espagne apparaît plus ouverte** (pénurie de chauffeurs, recrutement de Marocains) ✅. **Aucune décision officielle postérieure à mai 2026 n'a été trouvée** ❓.
- Pièces d'un dossier (liste de 2021, à revérifier) : permis national, permis international en cours de validité, carte de conducteur professionnel et attestation de formation continue, autorisation « F » de l'année ✅ 🔶.

> **Conséquence** : un dossier chauffeur doit contenir passeport, visa (type, dates, nombre d'entrées), CNSS, permis, carte professionnelle, formation continue, **avec alertes d'expiration** et un **compteur Schengen** (voir §2.3). Planifier un voyage sans chauffeur éligible doit être impossible.

### 2.3 Système d'entrée/sortie (EES) et règle 90/180

- L'EES enregistre visage et empreintes à la **première** entrée et remplace le tampon ; le refus de collecte entraîne le refus d'entrée ✅. Mise en service progressive à partir du **12 octobre 2025** ✅ ; d'autres sources parlent d'une application complète en **avril 2026** : **dates variables selon les sources** 🔶.
- Il s'applique aux ressortissants de pays tiers, **y compris les chauffeurs professionnels** ; la règle des **90 jours sur 180** les concerne aussi ✅. Les transporteurs sont invités à prévoir des **temps de passage supplémentaires** ✅.
- **ETIAS** (exemptions de visa) est un dispositif distinct, non attendu avant fin 2026 ✅ ; il ne concerne pas les Marocains soumis au visa 🔶.
- Un chauffeur visé qui enchaîne les voyages peut **dépasser 90 jours sur 180 sans s'en apercevoir** : sanction de l'EES, refus d'entrée, interdiction de séjour 🔶.

> **Conséquence** : calcul automatique « jours consommés / jours restants sur la fenêtre glissante de 180 jours » par chauffeur, prévision pour le voyage planifié, et blocage de l'affectation si le voyage ferait dépasser 90 jours.

### 2.4 Déséquilibre aller/retour

- Les opérateurs marocains rentrent **à vide** quand ils ne trouvent pas de client dans le pays de livraison : activité « peu rentable » ✅. L'aller est tiré par l'**agrumiculture et le maraîchage** vers l'Espagne et la France ✅ (saison forte d'octobre à mai 🔶).
- La réglementation européenne contraignante rend les transporteurs marocains **moins compétitifs** que leurs homologues, selon l'AMTRI ✅.
- Leviers de fret retour : bourses de fret européennes, donneurs d'ordre marocains qui importent (pièces automobiles, machines, intrants), groupage, partenariats avec des transporteurs européens 🔶. Une plateforme marocaine, **CloudFret**, vise l'optimisation du remplissage ✅.

### 2.5 Le détroit : Tanger Med ⇄ Algeciras

- **Douane H24 à Tanger Med depuis le 15 avril 2024** : dédouanement 7j/7, à toute heure ✅. La **zone d'accès TIR** peut traiter **≈ 140 camions TIR par heure** ✅.
- Traversée **Tanger Med → Algeciras : moins de 1 h 30**, ≈ **40 traversées par jour** ✅ ; **Tanger Ville : ≈ 2 h 30** (source ancienne 🔶).
- **Janvier 2026** : intempéries, ≈ **2 800 camions bloqués** à Algeciras, accès limité aux camions avec **réservation confirmée** ✅.
- **Contrôles sanitaires en Espagne** : projet pilote à Algeciras depuis le **1ᵉʳ octobre 2024**, **un seul point de contrôle** fruits et légumes ✅ ; le port traite ≈ 60 % des légumes importés de pays tiers par l'Espagne ✅ ; plus de 130 000 certificats d'importation fruits et légumes sur un an et des inspections en hausse de 7,5 % ✅.
- **Prix de la traversée camion** : ❓ non trouvé (les comparateurs affichent passagers et voitures).
- **Compagnies et lignes** : plusieurs armateurs desservent Algeciras ⇄ Tanger Med ✅ ; d'autres lignes (Sète, Barcelone, Marseille…) existent 🔶 mais n'ont pas pu être confirmées : à demander à l'armateur ou au transitaire.

---

## 3. Le voyage aller, étape par étape

Chaque phase suit la même grille : **Quoi** · **Documents** · **Acteurs** · **Durée typique** · **Coûts** · **Risques** · **Données à capturer** · **Alertes utiles**.

### Phase 0 — Préparation (J-14 → J-1)

| | |
|---|---|
| **Quoi** | Confirmer la commande ; choisir pays et itinéraire ; vérifier la conformité (autorisation, chauffeur, véhicule, remorque) ; réserver traversée ; retirer le carnet TIR ; préparer les documents d'exportation ; établir le budget du voyage. |
| **Conformité à vérifier** | **Autorisation** bilatérale pour le(s) pays (type, validité, reste disponible) ✅ · **chauffeur** : passeport, visa et dates, **jours Schengen restants**, permis, carte professionnelle, formation continue, CNSS ✅ · **véhicule** : assurance internationale (carte verte) 🔶, visite technique, **tachygraphe** (type et conformité) ✅, **classe Euro** (péages et zones à faibles émissions) 🔶, poids et dimensions · **remorque** : plaque TIR et agrément pour le régime TIR 🔶, sellette, scellements, frigorifique (ATP 🔶) si besoin. |
| **Réservations** | Traversée (le port peut exiger une réservation confirmée pour les poids lourds ✅). Armateurs : le détroit se réserve **au mètre linéaire**, remorque non accompagnée chez DFDS, **heure limite de présentation : 3 h avant le départ** ✅ ; Sète–Tanger Med : voir §6.5. |
| **Compte-rendu de voyage** | À remettre avec l'autorisation bilatérale utilisée (Espagne) ✅ : prévoir de le pré-remplir (dates, route, véhicule, chauffeur, marchandise). |
| **Carnet TIR** | Document distinct des autorisations bilatérales ✅. **Émetteur marocain** : les sources divergent — l'**ADII** serait l'association garante ✅ (phrase tronquée) ; un guide indique l'**AFMTV**, affiliée à l'IRU 🔶 : ❓ **à trancher** auprès de l'ADII ou de l'IRU. Le carnet ne doit pas servir au transport entre États membres de l'UE ✅. |
| **Documents d'exportation** | Facture commerciale, liste de colisage, **DUM** d'exportation (BADR), certificat d'origine ou **EUR.1** selon l'accord, certificats sanitaires/phytosanitaires selon le produit (ONSSA 🔶), contrôle à l'exportation selon la filière (EACCE 🔶). |
| **Coûts à budgéter** | Gasoil, autoroutes Maroc, traversée, péages Europe, hébergement du repos hebdomadaire, indemnités chauffeur, frais de douane et transitaire, parkings sécurisés, assurances, frais de visa. Détail : §6. |
| **Acteurs** | Dispatcher, chauffeur, transitaire, client/expéditeur, assureur, armateur. |
| **Risques** | Autorisation épuisée ; chauffeur sans visa ou en dépassement 90/180 ; carnet TIR non retiré ; mauvaise classe de véhicule ; documents incomplets. |
| **Données à capturer** | Voyage, camion, remorque, chauffeur(s), autorisation affectée, n° carnet TIR, réservation (armateur, date, créneau), budget par poste, documents requis et reçus. |
| **Alertes** | Autorisation < N voyages ou < N jours ; visa/passeport/carte/permis < 30 j ; jours Schengen insuffisants ; carnet TIR non lié au voyage à J-2 ; documents manquants à J-1. |

### Phase 1 — Chargement au Maroc

| | |
|---|---|
| **Quoi** | Arrivée chez l'expéditeur ; contrôle du véhicule (propreté, frigorifique, température) ; chargement ; **pesée** ; **scellement** ; émission du CMR ; contrôles qualité à l'export. |
| **Documents** | **CMR** (lettre de voiture internationale), facture, colisage, bon de pesée, relevé de température, numéros de scellés, photos du chargement. |
| **Durée** | Quelques heures ; attente chez l'expéditeur fréquente 🔶. |
| **Coûts** | Temps d'attente (facturable selon contrat 🔶), manutention. |
| **Risques** | **Surcharge** (poids et essieux, différents du Maroc à l'Europe — §5.4) ; chargement mal arrimé ; écarts de quantité ; température hors plage ; **intrusion de clandestins avant ou après chargement** 🔶 ; scellé non conforme. |
| **Données** | Heure d'arrivée/de départ, poids total, poids par essieu, n° scellés, photos (chargement, scellé fermé, CMR signé), températures initiales, réserves au CMR. |
| **Alertes** | Attente > seuil ; poids > limite du pays le plus contraignant du trajet ; température hors plage ; photo du scellé manquante au départ. |

### Phase 2 — Route au Maroc et autoroutes

| | |
|---|---|
| **Quoi** | Trajet jusqu'à Tanger Med par les autoroutes ADM (A1 Agadir–Tanger via Casablanca–Rabat–Kénitra, etc.). |
| **Règles** | Poids lourds limités à **80 km/h** (pour les 40 t, contesté par la profession) ✅. Poids et essieux régis par le décret 2-10-421 (loi 52-05) ✅ ; plafonds exacts non confirmés ❓ (voir §5.4). |
| **Péages** | Voir §6.1 : grille par section, **classe 3 pour les poids lourds** ✅, **Jawaz** (tag télépéage ; ADM annonce ≈ 80 % d'usage chez les camions en août 2025 ✅). |
| **Durée** | Agadir → Tanger Med : une journée complète de conduite (conduite + pauses) 🔶. |
| **Risques** | Contrôles de poids ; retards (accident, travaux) ; tag Jawaz utilisé sur un autre véhicule = fraude ✅ ; passage en voie non adaptée. |
| **Données** | Positions GPS, passages aux gares de péage, vitesse, arrêts, carburant, kilométrage. |
| **Alertes** | Vitesse > 80 km/h ; arrêt prolongé hors zone prévue ; écart d'itinéraire ; ETA au port incompatible avec le créneau de traversée. |

### Phase 3 — Port de Tanger Med : douane export, TIR, embarquement

| | |
|---|---|
| **Quoi** | Arrivée au port ; **zone d'accès TIR** ; déclaration d'exportation **BADR** et **PortNet** (guichet unique national) ✅ ; scanner/inspection éventuelle ; **vérification du carnet TIR et des scellés** ; enregistrement chez l'armateur ; embarquement. |
| **Documents** | Carnet TIR, CMR, facture, colisage, DUM, EUR.1, certificats ; passeport et visa du chauffeur ; documents du véhicule. |
| **Durée** | Quelques heures à plus d'une journée selon affluence 🔶 (❓ aucun délai officiel trouvé). |
| **Coûts** | Frais portuaires, parking, transitaire, redevances 🔶. |
| **Risques** | Inspection prolongée ; erreur de déclaration ; scellé rompu ; clandestins découverts ; retard d'embarquement (créneau perdu → nouvelle réservation) ; saturation saisonnière. |
| **Données** | Heure d'entrée au port, heure de fin de douane, n° de déclaration, résultat (voie verte/inspection), n° de scellés vérifiés, créneau de traversée, heure d'embarquement. |
| **Alertes** | Temps au port > seuil ; créneau perdu ; déclaration non validée à H-2 ; incident de scellé. |

### Phase 4 — Traversée

| | |
|---|---|
| **Quoi** | Traversée (**≈ 1 h 30**, ≈ 40 traversées par jour tous armateurs ✅ ; DFDS : départs d'Algeciras vers 02 h, 08 h, 15 h, 22 h, **présentation 3 h avant**, **remorques non accompagnées**, terminal d'Algeciras ouvert 24 h/24 ✅) ; **tracteur accompagné** (chauffeur à bord) ou **remorque non accompagnée** 🔶 (le chauffeur ne traverse pas, un autre tracteur la prend en charge en Europe). |
| **Spécificité GPS** | **Perte de couverture réseau en mer** : ne pas déclencher d'alerte « balise hors ligne » dans la zone du détroit ; mémoriser localement et envoyer au retour du réseau 🔶. |
| **Données** | Heure d'embarquement/débarquement, navire, durée de traversée. |
| **Risques** | Mauvaise mer (annulations, retards) ; avaries ; vol dans les parkings du navire 🔶. |

### Phase 5 — Entrée dans l'UE à Algeciras

| | |
|---|---|
| **Quoi** | **Contrôle aux frontières Schengen** (passeport, visa, EES) ; **douane** (présentation du carnet TIR ou de la déclaration de transit) ; **contrôle sanitaire/phytosanitaire** si fruits, légumes, produits animaux (point de contrôle unique fruits et légumes depuis octobre 2024 ✅) ; sortie du port. |
| **Documents** | Passeport, visa, EES (biométrie), carnet TIR, CMR, **certificats sanitaires** ; document d'entrée sanitaire commun (**CHED** via **TRACES** 🔶). |
| **Durée** | Variable ; l'EES ajoute du temps de passage ✅ ; un contrôle sanitaire peut immobiliser le camion 🔶. |
| **Risques** | Refus d'entrée (visa, jours Schengen) ; **inspection sanitaire défavorable (refoulement, destruction)** ; carnet TIR contesté ; saturation du port. |
| **Données** | Heure d'arrivée, passage frontière, résultat des contrôles, numéros de lot, décision sanitaire, photos. |
| **Alertes** | Attente > seuil ; refus ; retard de livraison prévisible ; **température hors plage durant l'attente**. |

### Phase 6 — Route en Europe

| | |
|---|---|
| **Quoi** | Traversée d'Espagne, France, Benelux, Allemagne, Italie… ; **navigation par Mappy** par le chauffeur ; respect des temps de conduite et de repos ; péages ; interdictions de circulation. |
| **Règles clés** | Temps de conduite et repos (§5.1) ; **repos hebdomadaire régulier hors cabine** ✅ ; tachygraphe (§5.2) ; interdictions de circulation des poids lourds le week-end et jours fériés (France, Espagne, Italie, Allemagne… 🔶 — §5.5) ; zones à faibles émissions (§5.5) ; vitesses par pays (§5.6). |
| **Péages** | §6.2 : péages autoroutiers (Espagne, France, Italie, Portugal), **LKW-Maut** (Allemagne), GO-Maut (Autriche), LSVA (Suisse), taxe kilométrique (Pays-Bas dès 2026), Eurovignette, **EETS**. |
| **Durée** | Madrid → Paris ≈ 1 200–1 400 km : 2 à 3 jours en conduite réglementaire 🔶 (un seul conducteur : 9 h/jour max). |
| **Coûts** | Péages, carburant, hébergement (repos hebdomadaire), parkings sécurisés, amendes éventuelles. |
| **Risques** | **Dépassement des temps de conduite** (amende, immobilisation) ; **repos hebdomadaire en cabine** (amendes 1 000–3 000 €, ≈ 7 300 € en Suède ✅) ; **vol de marchandise** sur parkings non sécurisés 🔶 ; interdiction week-end mal anticipée (immobilisation) ; zone à faibles émissions refusée à un véhicule ancien ; panne ; météo (Alpes, Pyrénées) ; contrôle routier (documents, tachygraphe) ; **clandestins**. |
| **Données** | Positions, vitesse, arrêts, activités du chauffeur (conduite, pause, repos), péages payés, carburant acheté, parkings utilisés, incidents. |
| **Alertes** | Temps de conduite restant < seuil ; repos hebdomadaire à planifier (lieu, hôtel) ; arrêt hors parking sécurisé de nuit ; interdiction de circulation à venir ; zone à faibles émissions sur l'itinéraire ; excès de vitesse par pays ; déviation d'itinéraire ; panne ; batterie de la balise faible. |

### Phase 7 — Livraison et douane de destination

| | |
|---|---|
| **Quoi** | Rendez-vous de livraison (créneau) ; **déchargement** ; signature du **CMR** ; **apurement du transit TIR** au bureau de destination ; mise à la consommation par le destinataire ou son transitaire. |
| **Documents** | CMR signé (exemplaires), preuve de livraison, relevé de température, échange de palettes, **déchargement du carnet TIR** (certificat d'apurement). |
| **Coûts** | **Attente** (temps libre contractuel), palettes non rendues, pénalités de retard. |
| **Risques** | Retard de livraison ; refus de livraison (qualité, température) ; **réserves au CMR** ; carnet TIR non apuré dans les délais (réclamation à la garantie) 🔶 ; litiges palettes. |
| **Données** | Heure d'arrivée au site, début/fin de déchargement, réserves, photos (CMR signé, marchandise, dommages), n° d'apurement TIR. |
| **Alertes** | ETA > créneau ; attente > temps libre (déclencher la facturation) ; réserve au CMR ; carnet TIR non apuré à J+N. |

---

## 4. Le retour, étape par étape

### Phase 8 — Trouver un fret retour

| | |
|---|---|
| **Pourquoi** | Un retour chargé change la marge du voyage. |
| **Sources de fret** | Donneurs d'ordre habituels (import au Maroc), transitaires, **bourses de fret** européennes (Timocom, Trans.eu, Teleroute… 🔶) et marocaines (CloudFret ✅ 🔶), groupage, partenaires. |
| **Contraintes** | **Même autorisation** utilisée à l'aller (aller-retour pour « au voyage ») ✅ ; **pas de cabotage ni de cross-trade** 🔶 : un fret doit être **Europe → Maroc** ; compatibilité du véhicule (frigo, bâche, citerne) ; respect des temps de conduite avant le retour ; délai de rapatriement. |
| **Marchandises types de retour** | Pièces automobiles, machines, intrants agricoles, produits manufacturés, biens de consommation, palettes vides 🔶. |
| **Données** | Annonces de fret ciblées (origine, destination, poids, date, tarif), offres envoyées, accord, estimation du coût d'approche à vide, **gain du fret retour vs retour à vide**. |
| **Alertes** | Camion libre à destination sans fret retour à J+1 ; opportunité de fret compatible dans un rayon de X km. |

### Phase 9 — Chargement en Europe et export de l'UE

| | |
|---|---|
| **Quoi** | Chargement ; scellement ; CMR retour ; **déclaration d'exportation de l'UE** (système d'exportation) ; documents d'origine (EUR.1 côté exportateur européen 🔶) ; certificats selon la marchandise. |
| **Risques** | Poids (limites européennes vs marocaines) ; document manquant ; marchandise réglementée (contrôle à l'import au Maroc) ; vol ; **clandestins**. |
| **Données** | Idem phase 1 (poids, scellés, photos, température, CMR). |

### Phase 10 — Sortie de l'UE, traversée, import au Maroc

| | |
|---|---|
| **Quoi** | Sortie de l'espace Schengen (**EES : enregistrement de sortie** ✅) ; contrôle douanier de sortie ; traversée Algeciras → Tanger Med ; **dédouanement à l'import** au Maroc (**DUM import via BADR**, droits et TVA à l'importation, contrôles de conformité selon le produit : ONSSA, MCINET, ANRT… 🔶). |
| **Documents** | Facture d'achat, colisage, CMR, EUR.1 (pour l'avantage tarifaire), certificats de conformité, carnet TIR (ou déclaration de transit), DUM import. |
| **Risques** | Marchandise bloquée à l'import (non-conformité, valeur contestée) ; paiement de droits et TVA ; stationnement prolongé au port ; scellé rompu ; **exemplaire papier du CMR perdu**. |
| **Données** | Heure de passage de la frontière UE, de la traversée, du dédouanement ; montants de droits et taxes ; n° de déclaration ; mainlevée. |

### Phase 11 — Livraison au Maroc

Même logique que la phase 7 : créneau, déchargement, CMR signé, réserves, photos, apurement du TIR, facturation du client marocain (en MAD ou en devise).

### Phase 12 — Après-voyage : clôture et conformité

| Étape | Détail |
|---|---|
| **Clôture financière** | Rapprocher **estimé vs réel** : gasoil, péages ADM et européens (relevés Jawaz Pro et fournisseurs EETS), traversée, hébergement, indemnités. Calculer **marge réelle du voyage**. |
| **Documents** | Restituer et archiver : CMR (exemplaires), carnet TIR (**retour à l'association émettrice**, apuré), preuves de livraison, relevés de température, photos. |
| **Réclamations** | Convention CMR : réserves à la livraison ; pour les dommages non apparents, notification écrite dans **7 jours** (hors dimanches) ; prescription **1 an** (3 ans en cas de faute lourde) 🔶 ; limite de responsabilité **8,33 DTS par kg** de poids brut manquant 🔶 → assurance CMR. |
| **Chauffeur** | Mettre à jour les **jours Schengen** consommés ; contrôler les temps de conduite ; **télécharger la carte conducteur** (au plus tous les **28 jours** 🔶) et le **tachygraphe** du véhicule (au plus tous les **90 jours** 🔶), conserver 12 mois 🔶. |
| **Amendes (PV)** | Enregistrer, rattacher au voyage et au chauffeur, suivre le paiement. |
| **Maintenance** | Mettre à jour kilométrage, vidange, pneus (voir l'application actuelle). |
| **Facturation** | Facturer le client (voir l'application actuelle) ; TVA : le **transport international** relève d'un régime particulier (exonération avec droit à déduction possible) 🔶 — **à faire valider par le comptable** (la valeur de 14 % par défaut de l'application est un point de départ, pas un conseil). |

---

## 5. Règles de conduite, de circulation et de véhicule

### 5.1 Temps de conduite et de repos (règlement (CE) 561/2006 / AETR)

| Règle | Valeur | Statut |
|---|---|---|
| Conduite continue maximale | **4 h 30**, puis pause **45 min** (ou 15 + 30) | 🔶 |
| Conduite journalière | **9 h** (10 h au plus **2 fois** par semaine) | 🔶 |
| Conduite hebdomadaire | **56 h** ; **90 h** sur deux semaines consécutives | 🔶 |
| Repos journalier | **11 h** (réduit à 9 h au plus 3 fois entre deux repos hebdomadaires) | 🔶 |
| Repos hebdomadaire | **45 h** (réduit à 24 h avec compensation) ; **le repos régulier ne peut pas se prendre en cabine** | ✅ (cabine) |
| **Quelle règle s'applique à un camion marocain ?** | Le règlement 561/2006 ou l'**AETR**, selon le statut du pays d'immatriculation. **Le statut AETR du Maroc n'a pas pu être confirmé** ❓ : une évaluation UE de 2021 mentionne un accompagnement vers l'AETR et le tachygraphe numérique ✅, et le Maroc figure parmi les pays autorisés à adhérer ✅. | ❓ |
| Application aux transporteurs hors UE | Les règles du paquet mobilité (repos hebdomadaire hors cabine) s'appliquent à **toutes les entreprises** qui opèrent dans l'UE, y compris hors UE ✅. | ✅ |

> **Choix de conception recommandé** : appliquer **les limites européennes les plus strictes** à tous les voyages vers l'UE, sans dépendre de la conclusion juridique sur l'AETR.

### 5.2 Tachygraphe

- Le tachygraphe **numérique** est obligatoire pour le transport international dans les pays tiers signataires de l'AETR depuis 2010 ✅. Un texte CEE-ONU prévoit l'équipement numérique conforme de **tous** les véhicules du transport international à partir du **1ᵉʳ janvier 2028** ✅ (application au Maroc non vérifiée ❓).
- Dans l'UE, les véhicules en transport international doivent se conformer à la génération de tachygraphe intelligent en vigueur (échéances 2023–2026) 🔶 : **vérifier la génération et la date de mise en conformité** du parc.
- **Intérêt pour l'application** : la **téléchargement à distance** des données du tachygraphe (si le boîtier GPS le permet) donne les **temps de conduite réels** ; sinon, saisie manuelle ou import de fichiers `.ddd`.

### 5.3 Droit marocain applicable au voyage

| Sujet | Ce qui est connu |
|---|---|
| Code de la route | Loi 52-05 ; décret 2-10-421 pour poids et dimensions ✅. |
| Vitesse | Poids lourds **80 km/h** ✅ (limite contestée par la profession pour les 40 t). |
| Géolocalisation des salariés | Délibération CNDP 17-2014 : **déclaration**, **information** des salariés et de leurs représentants ; interconnexion de fichiers : autorisation distincte ✅. |
| Temps de conduite au Maroc | ❓ non trouvé. |

### 5.4 Poids et dimensions : le texte marocain (décret 2-10-421, relevé le 10/11/2026) ✅

**Poids total autorisé en charge / poids total roulant autorisé**

| Configuration | Limite marocaine |
|---|---|
| Véhicule articulé **5 ou 6 essieux** (tracteur 2 essieux + semi 3 ; tracteur 3 essieux + semi 2 ou 3) | **40 t** |
| Idem, **transport combiné** avec un conteneur de 40 pieds | **44 t** |
| Train routier 5 ou 6 essieux | **40 t** |
| Véhicule articulé ou train routier **4 essieux** | **36 t** |
| Remorque 2 essieux (hors semi) / 3 essieux (hors semi) | 18 t / 24 t |
| Porteur 2 essieux / 3 essieux / 3 essieux (conditions de pneus et suspension) / 4 essieux dont 2 directeurs | 18 t / 25 t / 26 t / 32 t |

**Poids par essieu** : essieu simple non moteur **10 t** ; **tandem de remorque ou semi-remorque** : 11 t (écartement < 1 m), 16 t (1 à < 1,3 m), 18 t (1,3 à < 1,8 m), **20 t (≥ 1,8 m)** ; les valeurs du **tridem** et de l'**essieu moteur** n'ont pas été extraites : ❓ à lire dans le décret.

**Dimensions maximales** : ensemble articulé **16,50 m** ; train routier **18,75 m** ; porteur 12,00 m ; remorque 12,00 m ; largeur **2,55 m** (2,60 m pour les superstructures conditionnées, donc frigorifiques) ; hauteur **4,00 m**.

> Les **dimensions marocaines sont identiques aux dimensions européennes** (directive 96/53/CE 🔶) et le **40 t** est la limite commune, avec **44 t en transport combiné** dans les deux cas. Le « 44 t sur certains essieux » d'un blog ne s'applique donc pas au cas général. **Règle d'application** : l'application compare charge, essieux et gabarit **au plus petit plafond** parmi le Maroc et les pays traversés, et avertit avant le départ (surcharge = amende dans l'UE et immobilisation).

### 5.5 Restrictions de circulation en Europe 🔶

- **Week-ends et jours fériés** : interdiction aux poids lourds de plus de 7,5 t dans plusieurs pays (France : du samedi 22 h au dimanche 22 h environ ; Italie, Espagne, Allemagne : dimanches et jours fériés, avec variations régionales et estivales). Le calendrier **doit être intégré à la planification**.
- **Zones à faibles émissions** (ZFE en France, ZBE en Espagne, *Umweltzonen* en Allemagne, restrictions en Italie) : exigent une **classe Euro** minimale ; vignettes ou équivalences possibles (par exemple Crit'Air en France). **Stocker la classe Euro** de chaque camion.
- **Tunnels et cols** (Mont-Blanc, Fréjus, Gothard…) : restrictions de poids, d'hauteur, de matières dangereuses, créneaux.
- **Hiver** : équipements obligatoires en montagne (chaînes, pneus hiver), variables selon pays et période.

### 5.6 Vitesses maximales des poids lourds (indicatif 🔶)

Autoroute : France 90 km/h, Espagne 90 km/h, Italie 80 km/h, Allemagne 80 km/h, Portugal 90 km/h, Belgique 90 km/h, Pays-Bas 80 km/h. **À vérifier** pays par pays avant de coder des alertes de survitesse.

---

## 6. Péages et frais de route

### 6.1 Autoroutes du Maroc (ADM) — grille officielle

**Source** : grille tarifaire publiée sur le site d'ADM, **téléchargée le 10/11/2026** : **584 sections** (couples de gares d'entrée et de sortie), **92 gares/échangeurs**, **3 classes**. Fichier de travail : [`data/adm-grille-2026-11.csv`](data/adm-grille-2026-11.csv). La page ne publie **aucune date d'effet** ❓ : la grille doit être **horodatée à l'import**.

**Classes officielles** (hauteur hors tout au droit de l'essieu avant, nombre d'essieux du véhicule ou de l'ensemble, longueur) ✅ :

| Classe | Critère officiel | Exemple |
|---|---|---|
| **1** | 2 essieux et hauteur ≤ 1,30 m | voiture |
| **2** | 2 essieux et hauteur > 1,30 m **ou** plus de 2 essieux et hauteur ≤ 1,30 m | camionnette, **porteur 2 essieux** |
| **3** | **plus de 2 essieux et hauteur > 1,30 m** (véhicule ou ensemble) | **tracteur + semi-remorque**, porteur 3 essieux, camion + remorque |

Les tarifs des classes 2 et 3 sont **ceux de la classe 1 multipliés par des coefficients** ✅. **Attention** : un porteur à 2 essieux paie la **classe 2**, pas la classe 3 ; l'application doit donc **déduire la classe de la carte grise du camion** (essieux, hauteur), pas la saisir à la main.

**La grille est un réseau de segments, pas un barème point à point.** Il n'existe **pas** de ligne « Casablanca – Tanger Med » : on **additionne** les sections successives. Trois **trajets de référence** (classe 3), calculés sur la grille :

| Trajet | Sections (classe 3) | Total |
|---|---|---|
| **Casablanca → Tanger Med** | Casablanca–Rabat **43** + Rabat–Kénitra **28** + Kénitra Nord–Port Tanger Med **182** | **253 MAD** |
| **Casablanca → Agadir** | Nouaceur–Amskroud **337** + Échangeur Amskroud–Agadir **11** | **348 MAD** |
| **Agadir → Tanger Med** | 11 + 337 + 43 + 28 + 182 | **601 MAD** |
| *Même trajet Casablanca → Tanger Med, classe 2 (porteur 2 essieux)* | 36 + 23 + 151 | *210 MAD* |

> **Deux hypothèses à confirmer** ❓ : (1) **Kénitra ↔ Kénitra Nord** et (2) **Casablanca ↔ Nouaceur** n'ont **aucune ligne** dans la grille : nous les avons comptés **sans péage**. Si un péage y existe, le total augmente. La topologie (quelles gares se raccordent) **n'est pas dans la grille** : elle se déduit de la carte du réseau ou, mieux, des **passages réels détectés par le GPS** aux gares.

**Sections utiles (classe 3)** — extraits de la grille ✅ :

| Section | Cl. 1 | Cl. 2 | **Cl. 3** | Note |
|---|---|---|---|---|
| Casablanca – Rabat | 25 | 36 | **43** | était 23 / 34 / **41** dans le PDF ADM de janvier 2024 |
| Rabat – Kénitra | 14 | 23 | **28** | |
| Kénitra Nord – Port Tanger Med | 89 | 151 | **182** | était **179** en 2024 |
| Tanger Est – Port Tanger Med | 13 | 29 | **36** | |
| Nouaceur – Marrakech Palmeraie | 83 | 124 | **150** | |
| Nouaceur – Marrakech Targa | 89 | 133 | **161** | |
| Nouaceur – Amskroud | 167 | 281 | **337** | |
| Échangeur Amskroud – Agadir | 5 | 9 | **11** | |
| Oujda – Fès | 106 | 180 | **216** | |
| Oujda – Sidi Allal El Bahraoui | 156 | 256 | **308** | |
| Fès – Sidi Allal El Bahraoui | 52 | 79 | **95** | |
| Casablanca – El Jadida Est | 31 | 48 | **59** | |

> Les **comparateurs en ligne sont à écarter** : l'un affichait **337 MAD** pour Casablanca–Tanger Med, soit **33 % de plus** que la somme officielle (253 MAD).

**Moyens de paiement sur les voies** ✅ : Pass **Jawaz**, cartes bancaires, **carte réseau**, espèces.

**Jawaz Pro** (offre entreprises, page officielle ADM) ✅ :

- Cible : entreprises et administrations avec un parc de **véhicules légers ou poids lourds**.
- Fonctionnement : le client **achète une recharge centrale**, alimentée par ADM sur la plateforme web, et la **répartit librement sur ses Pass** (recharge à distance, **sous-comptes**, **blocage/déblocage** d'un Pass).
- **Suivi des passages et des recharges en temps réel (≤ 10 minutes de décalage)**, **historique consultable**, **factures éditées automatiquement**, paiement par virement ou chèque.
- **Solde valable 5 ans**, report à N+1 ; **tarif préférentiel** d'achat des Pass et **remise** sur l'achat ✅. Contact : `jawaz.entreprise@adm.co.ma`.
- ❓ **Aucune API ni export documentés** : à demander à ADM (indispensable pour rapprocher les passages avec les voyages).
- Le Pass est **lié à un véhicule** ; l'utiliser sur un autre véhicule entre l'entrée et la sortie est **traité comme une fraude** ✅.
- ADM annonce ≈ **60 % d'adoption** globale et jusqu'à **80 % chez les poids lourds** (août 2025) ✅. Les conditions générales indiquent que les voies « j » sont réservées aux véhicules légers de classe 1 ✅ ; le fonctionnement exact pour les poids lourds (voies utilisables, rabais) ❓ est **à clarifier avec ADM**.

**Fonctions utiles à l'application** : coût autoroute par voyage, **déduction automatique de la classe**, **rapprochement** des passages Jawaz Pro avec les **passages GPS** aux gares (passage non facturé, tag sur le mauvais camion), versionnement des grilles par date.

### 6.2 Péages en Europe

| Pays / système | Ce que l'on sait | Statut |
|---|---|---|
| **Allemagne** (LKW-Maut) | Camions > 3,5 t ; **surtaxe CO₂ depuis décembre 2023** ; ≈ 0,35 €/km pour un 40 t Euro VI en 2026 (≈ 0,16 €/km de CO₂) | 🔶 source commerciale |
| **Autriche** (GO-Maut) | ≈ 0,48 €/km HT ; réforme 2026 | 🔶 |
| **Suisse** (LSVA / RPLP) | ≈ 0,74–0,95 €/km ; LSVA III depuis janvier 2026 | 🔶 |
| **Pays-Bas** | Taxe **au kilomètre** pour poids lourds à partir de **juillet 2026** (certaines sources disent janvier), boîtier embarqué ; remplace l'Eurovignette | 🔶 sources divergentes |
| **Roumanie / Pologne** | TollRo (km) à partir de juillet 2026 ; e-TOLL en hausse d'environ 40 % en février 2026 | 🔶 |
| **Espagne, France, Italie, Portugal** | Péages autoroutiers **par section**, tarifs par classe de véhicule ; télépéage (Via-T, Télépéage poids lourds, Telepass, Via Verde) | ❓ tarifs non trouvés |
| **Eurovignette** (Belgique, Danemark, Luxembourg, Suède) | Directive révisée : tarification liée aux émissions à partir de juillet 2026 | 🔶 |
| **Fournisseurs EETS** (un seul contrat, un seul boîtier, plusieurs pays) | DKV, Eurowag, AS24, Telepass Europe, Toll4Europe (cités) ; UTA ❓ | 🔶 |

> **Conséquence** : coût de péage = **estimation** (avant voyage) puis **réel** (relevés mensuels des fournisseurs EETS ou cartes carburant/péage). L'application doit accepter l'**import d'un relevé** (CSV) et le **rapprocher** du voyage, du camion et de la date.

### 6.3 Autres frais d'un voyage

| Poste | Notes |
|---|---|
| **Carburant** | Consommation à partir du CAN/capteur de carburant de la balise si disponible, sinon plein à plein (voir l'application actuelle). Prix différents par pays. **Carburant en réservoir d'origine** généralement toléré sans droits à l'entrée de l'UE 🔶. |
| **Traversée** | Au **mètre linéaire** ou à l'unité selon l'armateur ; voir §6.5 pour des **tarifs publiés** (GNV Sète–Tanger Med) et la structure du détroit (DFDS, sur devis). |
| **Hébergement** | **Repos hebdomadaire hors cabine** : hôtel ou hébergement adéquat **à la charge de l'employeur** (paquet mobilité) 🔶 ; prévoir un budget par nuit. |
| **Indemnités chauffeur** | Per diem selon contrat ; frais de route. |
| **Parkings sécurisés** | Réduisent le risque de vol ; frais par nuit. |
| **Vignettes et zones** | Crit'Air, vignettes, redevances de zone 🔶. |
| **Frais de douane / transitaire** | Par déclaration, par dossier. |
| **Assurances** | CMR, marchandises, carte verte, assistance rapatriement. |
| **Amendes** | Temps de conduite, repos en cabine, poids, vitesse : provisionner en pourcentage. |
| **Visa** | Frais de dossier par chauffeur et par demande. |
| **Attente** | Immobilisation facturable au client si la clause existe 🔶. |

### 6.4 Modèle de coût d'un voyage (recommandé)

```
Coût voyage = Gasoil (aller + retour)
            + Péages Maroc (ADM) aller + retour
            + Péages Europe (aller + retour)
            + Traversée (aller + retour)
            + Hébergement des repos hebdomadaires
            + Indemnités et frais chauffeur
            + Frais douane / transitaire / port (export + import)
            + Parkings sécurisés + vignettes
            + Assurances (quote-part)
            + Provision amendes / aléas
            + Amortissement + entretien au km
            + Coût du temps d'immobilisation (attentes)

Marge voyage = (Fret aller + Fret retour) − Coût voyage
Marge si retour à vide = Fret aller − Coût voyage          (c'est ce que le suivi doit rendre visible)
```

### 6.5 Traversées maritimes : tarifs publiés et structure

**GNV — Sète ⇄ Tanger Med** (grille publiée, **valable depuis le 08/10/2026**, base FAS Sète / FIOS Tanger Med, nette hors frais et formalités) ✅ :

| Poste | Sète → Tanger Med | Tanger Med → Sète |
|---|---|---|
| **Ensemble articulé 16,50 ml (≤ 40 t) chargé** — fret | **2 031 €** | **1 851 €** |
| Ensemble articulé 16,50 ml **à vide** — fret | 1 556 € | 1 441 € |
| Semi-remorque seule (non accompagnée) chargée — fret | 1 689 € | 1 509 € |
| Surcharge carburant **BAF** | 53 € / ml | 53 € / ml |
| **ETS** (système européen d'échange de quotas) | 30,50 € / ml | 30,50 € / ml |
| Surcharge soufre **LSS** | 11 € / ml | 11 € / ml |
| **FuelEU** | 3 € / ml | 3 € / ml |
| **Passage chauffeur** (cabine, pension complète) | 150 € | 150 € |
| Prise électrique pour frigorifique | 150 € / unité | 150 € / unité |

**Exemple chiffré — ensemble de 16,5 ml chargé, Sète → Tanger Med** : 2 031 + 16,5 × (53 + 30,50 + 11 + 3) = 2 031 + 1 608,75 = **3 639,75 €**, plus **150 €** pour le chauffeur (**≈ 3 790 €**), plus **150 €** si frigorifique. **Retour à vide** Tanger Med → Sète : 1 441 + 1 608,75 = **3 049,75 €** (+ 150 €). *Recalculer avec la grille en vigueur : tout est exprimé par mètre linéaire.*

**DFDS — Algeciras ⇄ Tanger Med (Ro-Ro)** ✅ : unités **non accompagnées**, **au moins deux départs** par jour et par sens, traversée **1 h 30**, **heure limite de présentation 3 h avant** le départ ; **BAF 4,36 € par mètre linéaire** (juin 2026) ; **taxes portuaires espagnoles incluses** ; **ETS non inclus** ; gabarit du matériel : 12 m, 2,7 m de large, 3,9 m de haut, 16 t par essieu (autres pages divergent : **à confirmer** auprès de DFDS) ; **fret de base sur devis** ❓. Autres armateurs du détroit (Baleària, FRS Iberia, Naviera Armas, Africa Morocco Link) ✅ 🔶 : **tarifs camion à demander**.

> **Pour l'application** : modéliser la traversée par **mètres linéaires × tarif + BAF + ETS + autres surcharges + passage chauffeur + frigorifique**, avec **historique de tarifs par armateur et par date**. Et comparer systématiquement **route Espagne–France (péages, carburant, temps de conduite, hébergement, visa, autorisation)** à **traversée longue (Sète)**.

---

## 7. Matrice des risques

| Domaine | Risque | Probabilité / impact 🔶 | Mitigation (dans l'application ou le process) |
|---|---|---|---|
| Accès | Autorisation épuisée ou expirée | Élevée / bloquant | Registre des autorisations, alertes, affectation obligatoire |
| Humain | Chauffeur sans visa / hors 90-180 | Élevée / bloquant | Dossier chauffeur + compteur Schengen + blocage d'affectation |
| Conformité | Dépassement temps de conduite / repos en cabine | Moyenne / fort (amendes, immobilisation) | Suivi des activités, alertes, planification de nuit/hébergement |
| Douane | Carnet TIR non apuré, document manquant | Moyenne / fort | Check-lists par phase, suivi du carnet, alertes J+N |
| Sanitaire | Refoulement à l'entrée (fruits et légumes) | Moyenne / fort | Documents sanitaires, températures, historique des contrôles |
| Sûreté | Vol de marchandise ; clandestins | Moyenne / fort | Parkings sécurisés, scellés + photos, capteur de porte, inspection avant départ |
| Opérationnel | Port saturé, tempête, créneau perdu | Moyenne / moyen | Réservations, marges de planification, alertes météo/port |
| Technique | Balise hors ligne, couverture en mer | Élevée / moyen | Mémorisation locale, règles anti-fausses alertes, contrôle de santé des balises |
| Financier | Marge érodée (retour à vide, péages) | Élevée / fort | Marge par voyage, fret retour, rapprochement des coûts réels |
| Réglementaire | Évolution visas, EES, péages | Élevée / moyen | Référentiels **versionnés** et modifiables sans code |
| Données | Non-conformité CNDP / RGPD | Moyenne / fort | Déclaration CNDP, information des chauffeurs, droits d'accès, durée de conservation |
| Climat | Hiver Alpes/Pyrénées, canicule (frigo) | Moyenne / moyen | Alertes météo, équipements, températures |

---

## 8. Ce qui n'a pas pu être vérifié, et questions au transporteur

### 8.1 Statut des points ouverts

**Résolus le 10/11/2026 (✅ officiel)** : grille tarifaire ADM complète et **sections manquantes** (Rabat–Kénitra : 28 MAD en classe 3) ; **définition officielle des classes** ; **plafonds de poids et dimensions marocains** (décret 2-10-421) ; **offre Jawaz Pro** ; **mode poids lourds de l'API Mappy et ses limites** ; **tarifs maritimes publiés** (GNV Sète–Tanger Med ; structure DFDS).

**Toujours non confirmés (à vérifier avant de coder ou d'afficher en dur)** :

1. **Association garante TIR au Maroc** : ADII (une source) ou **AFMTV**, affiliée à l'IRU (un guide) ; le système **SafeTIR** de l'IRU permet aux douanes de vérifier un carnet en temps réel ✅ ; plafond de garantie marocain ❓ (plafonds usuels cités par l'ONU : 50 000 USD, 200 000 USD pour alcool et tabac, 2003).
2. **Statut AETR du Maroc** (la page des dépositaires de l'ONU n'a pas fourni la liste des parties).
3. **Quotas 2026** des autorisations bilatérales et **résultat de l'échange de novembre 2026**.
4. **Péages Espagne, France, Italie, Portugal** (tarifs par classe).
5. **Topologie du réseau ADM** (raccords Kénitra/Kénitra Nord, Casablanca/Nouaceur) et **coordonnées des gares de péage** (non publiées sur la page ADM).
6. **Jawaz Pro pour poids lourds** : voies utilisables, remises, **API ou export** des passages.
7. **Poids de l'essieu moteur et du tridem** marocains (texte du décret, extraction incomplète).
8. **Temps de conduite au Maroc** (textes marocains).
9. **Pièces actuelles du dossier visa** et décision postérieure à mai 2026 sur un visa professionnel.
10. **Couverture et péages de l'API Mappy** hors France (Espagne, Maroc), et **restrictions de circulation poids lourds** (non prises en compte) : à valider avec Mappy.
11. **Tarif camion de la traversée du détroit** (devis DFDS, Baleària, FRS, Armas).

### 8.2 Questions à poser au transporteur (pour calibrer le cahier des charges)

**Flotte et équipement**
1. Combien de tracteurs, de remorques ? Âge et **classe Euro** ? Frigorifiques ?
2. Quel **fournisseur GPS**, quels modèles de balises, quelle fréquence d'envoi, quels capteurs (carburant, température, porte, CAN, tachygraphe) ?
3. Le fournisseur propose-t-il une **API** ou des **exports** ? Quelle durée de conservation ?
4. Quelle **carte SIM** (roaming Maroc/Europe) ? Y a-t-il des **balises sur les remorques** ?
5. Quel **tachygraphe** (génération) ? Téléchargement à distance ?

**Activité**
6. Pays et ports principaux ? **Tracteur accompagné ou remorque non accompagnée** ?
7. Types de marchandises (fruits et légumes, frigorifique, sec, dangereuses) ?
8. Combien de voyages par mois et par camion ? Part de **retour à vide** ?
9. Comment trouve-t-on le **fret retour** (clients, bourses, transitaires) ?

**Conformité**
10. Quelles **autorisations** (pays, type, quantité) ? Qui les gère ? Combien sont épuisées chaque année ?
11. **Carnet TIR** : auprès de quelle association ? Qui l'apure ?
12. Combien de chauffeurs **avec visa** ? Types, durées, nombre d'entrées ? Comment suit-on les **90/180 jours** ?
13. **Déclaration CNDP** de la géolocalisation déjà faite ?

**Organisation**
14. Qui dédouane : **en interne ou transitaire** ? Quel logiciel ?
15. Qui est en **permanence au bureau** (dispatch) ? Quels horaires ?
16. Comment communiquez-vous avec les chauffeurs (**WhatsApp**, téléphone) ? Langue (**arabe, français, espagnol**) ?
17. Quelle facturation (devises, délais, TVA appliquée) ?

**Finance**
18. Comment suivez-vous aujourd'hui les péages (Jawaz Pro, EETS) et les frais de route ?
19. Quels sont vos **trois plus gros postes de perte** aujourd'hui ?

---

## 9. Sources

**Sources officielles et primaires relevées le 10/11/2026**
- [ADM — grille tarifaire sur le réseau](https://www.adm.co.ma/fr/grille-tarifaire-sur-le-reseau) (584 sections) · [ADM — votre classe de véhicule](https://www.adm.co.ma/fr/votre-classe-de-vehicule) · [ADM — Jawaz Pro](https://www.adm.co.ma/fr/jawaz-pro) · [ADM — régler votre passage](https://www.adm.co.ma/fr/regler-votre-passage)
- [Décret n° 2-10-421 (véhicules : poids et dimensions)](https://maroctl.com/routier/code-de-la-route/decret-n-2-10-421-les-vehicules/)
- [Mappy — les API entreprises](https://blog.mappy.com/entreprise/nos-offres-commerciales/les-apis-mappy/)
- [GNV — tarifs Sète ⇄ Tanger Med](https://www.gnv.it/en/cargo/listini/listino-sete-tanger-med) · [DFDS — Algeciras ⇄ Tanger Med Ro-Ro](https://www.dfds.com/en/freight-ferries-and-logistics/routes-and-schedules/algeciras-tanger-ro-ro-route)
- [Accord de transport routier (site de la Douane marocaine)](https://www.douane.gov.ma/accords/printAccord.jsf?accordId=18) (cité par la recherche ; page non consultable depuis la session)

**Compléments de la mise à jour (presse)**
- [Visas des transporteurs : désamorçage imminent ? (LesEco)](https://leseco.ma/business/visa-transporteurs-desamorcage-imminent.html) · [Visas des chauffeurs : réunion avec l'UE (TelQuel, mai 2026)](https://telquel.ma/instant-t/2026/05/13/transport-international-la-question-des-visas-des-chauffeurs-professionnels-marocains-au-centre-dune-reunion-avec-lue_1989268) · [Rabat négocie avec Bruxelles (Hespress)](https://fr.hespress.com/473361-crise-des-visas-des-routiers-marocains-rabat-negocie-avec-bruxelles-pour-debloquer-la-situation.html)
- [EES : les transporteurs préparent une grève nationale (Médias24, avril 2026)](https://medias24.com/2026/04/22/sous-pression-du-systeme-dentree-et-de-sortie-en-europe-les-transporteurs-routiers-internationaux-preparent-une-greve-nationale-1664363/) · [Europe : les nouveaux contrôles piègent les chauffeurs marocains (Bladi)](https://www.bladi.net/europe-nouveaux-controles-piegent-chauffeurs-marocains,121273.html) · [Trente mille chauffeurs manquants en Espagne (Bladi)](https://www.bladi.net/trente-mille-chauffeurs-manquants-espagne-ouvre-grand-porte-marocains,121482.html)
- [Le maritime s'impose comme alternative (Aujourd'hui le Maroc)](https://aujourdhui.ma/economie/le-maritime-simpose-comme-alternative) · [Surconsommation des autorisations espagnoles (Le360)](https://fr.le360.ma/economie/transport-routier-quelle-alternative-a-la-surconsommation-des-autorisations-espagnoles-227150/) · [Révision de l'accord bilatéral (Challenges)](https://archive.challenge.ma/maroc-espagne-les-transporteurs-marocains-reclament-la-revision-de-laccord-bilateral-en-matiere-de-tir-236401/)

**Péages et autoroutes (Maroc)**
- [Grille tarifaire ADM sur le réseau](https://www.adm.co.ma/fr/grille-tarifaire-sur-le-reseau) · [PDF ADM janvier 2024](https://www.adm.co.ma/sites/default/files/2024-01/grille-tarifaire-sur-le-reseau-autoroutier.pdf)
- [Péage Jawaz : adoption, prix (Hespress, août 2025)](https://fr.hespress.com/437278-la-societe-nationale-des-autoroutes-du-maroc-offre-promotionnelle-estivale-et-mode-vigilance-totale-renforcee-pour-garantir-des-deplacements-securises-et-confortables-aux-mdm.html) · [Réajustement du prix du Pass Jawaz (Hespress)](https://fr.hespress.com/436767-apres-5-ans-de-democratisation-adm-a-reajuste-le-prix-du-pass-jawaz.html) · [Conditions générales d'abonnement Jawaz (ADM)](https://adm.fornetmaroc.com/sites/default/files/2024-04/conditions-generales-dabonnement-jawaz-1.pdf)

**Autorisations bilatérales, TIR**
- [Exportations vers l'Espagne et autorisations (TelQuel, 2017)](https://telquel.ma/2017/10/03/maroc-espagne-les-exportations-marocaines-toujours-otage-autorisations_1563188) · [8 500 autorisations supplémentaires (TelQuel, 2017)](https://telquel.ma/2017/10/04/transport-routier-le-maroc-obtient-8500-autorisations-pour-acceder-au-marche-europeen_1563446)
- [Quota portugais augmenté (Médias24, janvier 2025)](https://medias24.com/2025/01/29/augmentation-du-quota-des-autorisations-portugaises-allouees-aux-transporteurs-marocains-de-marchandises/) · [Marché néerlandais fermé (Bladi)](https://www.bladi.net/marche-neerlandais-interdit-routiers-marocains,88137.html) · [Guerre commerciale Maroc-Espagne et TIR (Le360)](https://fr.le360.ma/economie/ca-tir-dans-la-guerre-commerciale-entre-le-maroc-et-lespagne-226284/)
- [La douane veut réglementer le transport (Aujourd'hui le Maroc)](https://aujourdhui.ma/economie/la-douane-veut-reglementer-le-transport-83355) · [Convention TIR (MarocTL)](https://maroctl.com/routier/transport-de-marchandises/lois-et-reglements-transport-de-marchandises/convention-douaniere-relative-au-transport-international-de-marchandises-sous-le-couvert-de-carnets-tir/)

**Visas, EES**
- [Visas : le consul de France dément un blocage massif (Médias24, février 2026)](https://medias24.com/2026/02/20/visas-pour-les-transporteurs-marocains-le-consul-de-france-dement-un-blocage-massif-1631507/) · [EES, visas Schengen, coûts : le TIR à l'agonie (Médias24, mai 2026)](https://medias24.com/2026/05/19/regime-dentree-sortie-de-lue-visas-schengen-couts-le-transport-routier-international-a-lagonie-1681707/)
- [Durcissement des visas (Le360)](https://fr.le360.ma/politique/visas-schengen-le-durcissement-de-leur-octroi-penalise-les-camionneurs-et-les-relations-commerciales_DOSSRS5NVBDILDMTONX6DMP6BM/) · [La France durcit les visas (Bladi)](https://www.bladi.net/france-durcit-visas-entreprises-marocaines-asphyxiees,118782.html) · [Cahier des charges visa TIR 2021 (Médias24)](https://medias24.com/2021/12/14/visa-schengen-le-cahier-des-charges-dedie-aux-professionnels-du-tir-bientot-finalise/)
- [EES et transport routier (GetTransport)](https://blog.gettransport.com/fr/trends-in-logistic/eu-entry-exit-system-trucking-2026/) · [EES à partir du 12 octobre 2025 (KPMG)](https://kpmg.com/av/fr/avocats/eclairages/2025/09/mise-en-oeuvre-de-l-entry-exit-system-a-partir-du-12-octobre-2025.html) · [Règlement (UE) 2017/2226](https://eur-lex.europa.eu/eli/reg/2017/2226/oj/fra)

**Port, détroit, contrôles**
- [Douane H24 à Tanger Med (TelQuel, avril 2024)](https://telquel.ma/instant-t/2024/04/09/douane-au-port-de-tanger-med-nouvelle-organisation-a-partir-du-15-avril-pour-fonctionner-en-h24_1865742/) · [Camions bloqués à Algeciras (Hespress)](https://fr.hespress.com/459994-intemperies-les-camions-marocains-bloques-au-port-dalgeciras.html) · [Camions bloqués à Algeciras (Bladi)](https://en.bladi.net/moroccan-trucks-blocked-algeciras,119204.html)
- [Tanger – Algeciras, la traversée (Bladi)](https://www.bladi.net/tanger-algesiras-traversee.html) · [Ferries Tanger Med – Algeciras (Ferryhopper)](https://www.ferryhopper.com/fr/ferry-routes/direct/ferry-tanger-algeciras) · [Guide TIR Maroc-Europe (CapMad / Transmartic)](https://www.capmad.com/article/transit-tir-maroceurope-transmartic-detaille-les-procedures-de-dedouanement-pour-les-pme)
- [Pilote de contrôle agricole à Algeciras (HortiDaily)](https://www.hortidaily.com/article/9688810/spain-launches-pilot-project-to-enhance-agricultural-import-controls-starting-with-morocco) · [Espagne renforce les contrôles (Morocco World News)](https://www.moroccoworldnews.com/2024/12/167223/spain-tightens-controls-on-agricultural-imports-from-morocco/)

**Règles de conduite, AETR, paquet mobilité**
- [Droit au repos des chauffeurs (ETF)](https://www.etf-europe.org/news/road-transport-drivers-right-decent-rest-still-widely-ignored-across-europe) · [Amendes paquet mobilité (Trans.info)](https://trans.info/en/mobility-package-fines-318678)
- [AETR (Office fédéral suisse des routes)](https://www.astra.admin.ch/astra/fr/home/services/vehicules/tachygraphe-numerique/bases-legales/aetr.html) · [Évaluation Maroc-UE, AETR (SEAE)](https://www.eeas.europa.eu/node/91422_ar) · [Proposition de la Commission 2026 sur l'AETR (EUR-Lex)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A52026PC0015)

**Péages en Europe**
- [Péages poids lourds en Europe (Impargo)](https://impargo.de/en/blog/truck-toll-europe) · [Péages aux Pays-Bas 2026 (Eurowag)](https://www.eurowag.com/blog/truck-tolls-in-the-netherlands-a-practical-guide-for-transport-companies-preparing-for-2026) · [Coût de 500 km de péages en 2026 (TransConnect)](https://transconnect.com/en/blog/174-in-germany-286-in-austria-what-500-kilometres-of-tolls-really-cost-in-2026) · [Évolutions des péages 2026 (GetCoC)](https://www.getcoc.eu/en/blog/post/changes-to-tolls-in-europe-in-2026)

**Mappy, cartographie poids lourds**
- [Les API Mappy](https://blog.mappy.com/entreprise/nos-offres-commerciales/les-apis-mappy/) · [GPS poids lourd Mappy Maxi X685](https://www.officeeasy.fr/mappy-maxi-x685.html) · [PTV Map&Guide](https://www.appvizer.fr/transport/itineraire/ptv-mapguide) · [Planificateur poids lourds (Geotab)](https://www.geotab.com/fr/blog/planificateur-itineraire-poids-lourds/)

**Droit marocain et données**
- [Décret 2-10-421 (véhicules)](https://maroctl.com/routier/code-de-la-route/decret-n-2-10-421-les-vehicules/) · [Poids lourds limités à 80 km/h (Bladi)](https://www.bladi.net/limites-km-poids-lourds-marocains-reclament-droit-accelerer,123486.html) · [Délibération CNDP 17-2014 sur la géolocalisation](https://www.cndp.ma/wp-content/uploads/2023/01/deliberation-n-17-2014-10-01-2014.pdf)

**Retour à vide, fret**
- [Le transport routier international au Maroc va mal (Le360)](https://fr.le360.ma/economie/le-transport-routier-international-au-maroc-va-mal-35791/) · [CloudFret (Daba Finance)](https://dabafinance.com/en/news/CloudFret-closes-funding-round-to-expand-outside-Morocco-french-11-13) · [Retour du véhicule, étude Commission européenne (FNTR)](https://www.fntr.fr/sites/default/files/2021-02/CP%20Retour%20du%20v%C3%A9hicule_1.pdf)
