# Changelog

## 4.0.0 (en cours) — la vérité de l'argent

### D1 — Modèle de coût complet (schéma 7)
- **Lignes de coût par voyage** (20 types : carburant, péages, traversée, per diem, parking, douane, inspection sanitaire, amendes, dépannage…), chacune avec montant, devise, source (saisie, GPS, carte carburant, facture de l'armateur, calculé), date et référence. Une ligne réelle **remplace** l'estimation de son type : jamais de double compte. Les anciens champs restent lus tels quels.
- **Charges fixes détaillées par camion** (crédit, assurance, taxe à l'essieu, amortissement linéaire ou dégressif avec valeur restante) et bureau responsable.
- **Charges générales** avec clé de répartition (au kilomètre, au chiffre d'affaires, par camion, à parts égales) et **échéances** datées, ponctuelles ou récurrentes.
- Migration 6 → 7 sans perte ; 9 nouveaux tests.

### D2 — Marge du voyage en direct
- À côté du titre de chaque voyage : la **marge directe**, verte ou rouge, avec la courbe de son évolution à mesure que les dépenses arrivent.
- **Dépenses enregistrées** sur la fiche du voyage (ajout en quelques secondes, en MAD ou en EUR) ; la facture de traversée d'un sens ne remplace que l'estimation de ce sens.
- **Marge nette** : part des charges fixes du camion (au temps passé) et des charges générales (selon la clé de chaque charge, entre les voyages du mois), prix de revient par kilomètre chargé.
- Le dossier de voyage et l'export reprennent les nouveaux postes (froid, amendes, dépannage).

### D3 — Les dépenses entrent seules
- **Relevé de carte carburant (CSV)** : chaque plein est rattaché au voyage du camion à cette date (immatriculation ou numéro de carte, même masqué) ; le reste attend dans « Dépenses à rattacher » avec sa raison et se rattache seul dès que le voyage existe. Un relevé importé deux fois ne compte qu'une fois.
- **Per diem** du chauffeur (tarif par jour × jours du voyage) et **énergie du groupe froid** (part mensuelle du camion) comptés seuls, recalculés si les dates changent, figés une fois le voyage terminé.
- **Péage mesuré par GPS** : devient une dépense de source « GPS ».
- **Rappels au bon moment** : frais du transitaire dès l'étape de douane, facture de la traversée dès l'embarquement (montant et réservation proposés).
- **Amendes** : comptées dans le voyage que le chauffeur faisait à la date de l'infraction.
- Non fait : import des factures d'armateur en CSV (aucun format connu à ce jour — la facture se saisit en un geste depuis le rappel).

### D4 — Résultat de l'entreprise en direct (page « Direction »)
- Chiffre d'affaires, marge directe, charges de structure et marge nette de la période, **en MAD et en EUR**.
- **Tableau croisé** client × corridor × camion × chauffeur × mois, en un geste, avec accès au voyage.
- Tendance sur 12 mois ; « où part l'argent » par poste ; la part de charges qu'aucun voyage ne porte (camions à l'arrêt) est affichée, pas cachée.

### D5 — Trésorerie à 90 jours
- Solde jour par jour : factures à leur échéance (les retards sont signalés), échéances récurrentes développées, dépenses encore estimées et recette des voyages en cours.
- Zone rouge et date du passage sous zéro ; un jour touché sur la courbe montre ce qui tombe ce jour-là.

### D6 — Simulateur d'achat de camion
- Prix, financement (comptant, crédit avec tableau d'amortissement, leasing), répartition sur 1 à 3 corridors, taux de charge.
- Réponses : charge fixe ajoutée par mois, **taux de charge d'équilibre**, délai de retour, trésorerie cumulée sur 36 mois, tableau de sensibilité — à partir de la **marge au kilomètre réellement observée** sur vos corridors.

### D7 — Anomalies par camion
- Chaque camion est comparé à **sa propre référence** (90 jours, recalculée et mémorisée chaque semaine) sur quatre mesures : coût au kilomètre, consommation, temps à l'arrêt, kilomètres à vide.
- Alerte au-delà de 15 % d'écart sur 7 jours (seuil réglable), avec la **cause probable** : hausse brutale (fuite, vol, dépense exceptionnelle) ou progressive (usure, dérive), prix du gasoil, nouveau corridor, retours à vide.
- Visible dans les alertes, sur la page Direction et sur l'accueil du chef d'entreprise (profil Direction) : chiffre d'affaires, marges, charges du mois, trésorerie et point bas à 90 jours.

## 3.7.0 — La carte est là avant toute connexion GPS

- La page **Carte** (ex-« Suivi en direct ») s'affiche tout de suite, sans identifiants GPS : corridor Maroc → Espagne → France → Allemagne, zones (ports, frontière, dépôts), et **chaque camion à sa dernière position connue** d'après les traces importées. Un encadré dit ce qui manque (source, balise de chaque camion, première position) ; « Connecter mes balises » ouvre les réglages.
- Chaque camion de la flotte a sa fiche au clic même sans position ; sa balise se renseigne en un geste.
- « Carte » passe dans la barre du bas sur téléphone.
- Décisions pour la version 4 : `docs/11-decisions-v4.md`.

## 3.6.0 — Synchronisation des photos

- **Les photos se synchronisent** entre appareils par le relais (CMR, livraisons, dommages, tickets de gasoil, papiers) : une photo prise sur le téléphone du chauffeur arrive au bureau, et inversement. Chaque photo est **chiffrée sur l'appareil** (image, miniature, nom et rattachement) : le serveur ne garde que des fichiers illisibles.
- Envoi et réception **par lots de 20**, la suite au tour suivant sans bloquer l'application ; une photo supprimée sur un appareil l'est sur les autres ; option pour ne pas synchroniser les photos (données mobiles).
- **Sécurité** : un appareil vidé (données effacées, navigateur réinitialisé) n'efface plus rien sur le serveur — il récupère les données et les photos. Ce garde-fou couvre aussi la synchronisation des données livrée en 3.2.
- Relais 1.5 : stockage des photos (`/api/sync/photos`), 6 Mo par photo, quota réglable (`PHOTOS_MAX_MO`, 2 Go par défaut), trace des suppressions gardée 90 jours.
- 116 tests (105 application + 11 relais).

## 3.5.0 — Rentabilité, dossier de voyage, prévisions, profils par rôle

- **Rentabilité** (nouvelle page) : **coût complet au kilomètre** par camion (coûts des voyages, entretien, charges fixes du camion, frais généraux répartis), marge nette, part de kilomètres à vide, **prix de revient par kilomètre chargé** ; par corridor et par client en coûts directs ; évolution par mois ; export CSV. Carburant pris sur le voyage, sinon estimé d'après les pleins de la période. Une commande reliée à un voyage n'est comptée qu'une fois.
- **Retours à combler** : les voyages sans fret de retour, avec une annonce prête à envoyer par WhatsApp aux partenaires.
- **Dossier de voyage en un clic** : papiers valides sur toute la durée du voyage (ou expirant pendant), étapes avec leur origine (GPS, saisie, preuve de livraison), traversées, preuve de livraison signée, trace GPS, chaîne du froid, temps de conduite, listes de contrôle, photos. Impression / PDF, ou **archive ZIP** (dossier, données, photos en taille réelle, trace et températures en CSV). Coûts et marge inclus seulement sur demande.
- **À prévoir** (accueil) : entretien probable d'après les kilomètres par jour, date d'atteinte de la limite Schengen, autorisations insuffisantes pour les voyages prévus, temps habituel au port d'après vos propres traces.
- **Profil de l'appareil** : Direction, Exploitation (sans prix ni marges), Commercial, Comptabilité — chaque poste ne montre que ses pages, retour protégé par un code et un code de secours. C'est un tri de l'affichage, pas un contrôle d'accès.
- 113 tests (103 application + 10 relais).

## 3.4.0 — Carte de flotte interactive et fiche complète du camion, à coût zéro

- **Carte de la flotte** refaite avec **Leaflet** (open source, embarqué dans l'application : ni clé, ni compte, ni facturation) : zoom, déplacement, bouton « Tout voir », marqueurs colorés par état avec **flèche de cap**, trajet des 3 dernières heures, zones, couches à afficher ou masquer. Le cadrage choisi est conservé entre deux actualisations.
- **Camion cliquable** (sur la carte ou dans la liste) : **fiche complète** — alertes, position (coordonnées, vitesse, cap, zone, distance des 24 h, conduite sans pause et du jour), **voyage** (itinéraire, client, marchandise, livraison promise, heure d'arrivée estimée, traversées, dernières étapes, coût et marge), **chauffeur** (téléphone, appel / WhatsApp / SMS, service, permis, carte, passeport, visa, visite médicale, Schengen, tachygraphe), **camion** (kilométrage, essieux, vidange, pneus, papiers, consommation, entretien), **chaîne du froid**. Accès direct au voyage, au lien client, aux fiches. Sur téléphone, la fiche s'ouvre sous la carte.
- **Fond de carte gratuit** : OpenStreetMap par défaut ; les tuiles vues sont **gardées 7 jours sur l'appareil** (moins de requêtes, carte lisible hors ligne là où elle a déjà été consultée). Autre fournisseur possible par un simple modèle d'adresse. Sans fond de carte, camions, trajets et zones restent affichés.
- Guide « coût zéro » dans `serveur/README.md`.
- 108 tests (98 application + 10 relais).

## 3.3.0 — Outils de vérification et mise en service

- **Tester les canaux d'alerte** (Suivi en direct → Réglages de la source) : envoie un message d'essai sur chaque canal du relais (ntfy, Telegram, WhatsApp, webhook) et indique **lequel échoue et pourquoi**. Permet de valider un compte WhatsApp ou un bot Telegram en un clic.
- **Diagnostic des fichiers `.ddd`** (page Tachygraphe) : structure lue (fichiers présents, jours, plage de dates, changements d'activité), **sans nom ni numéro de carte**, à copier pour signaler un écart de lecture.
- **Checklist de mise en service** (`docs/04-mise-en-service.md`) : ce qui dépend de vous (relais, comptes, fichiers réels, déclarations) et comment chaque point se vérifie.
- 107 tests (97 application + 10 relais).

## 3.2.0 — Synchronisation entre appareils et péages de France officiels

- **Synchronisation entre appareils** (Réglages → Données) : bureau et téléphones des chauffeurs partagent les mêmes données par le relais. Données **chiffrées sur l'appareil** (AES-256-GCM, mot de passe de synchronisation) : le serveur ne garde qu'un bloc illisible. **Fusion à trois voies par enregistrement** : ce qui n'a changé que d'un côté est repris, si les deux côtés modifient le même enregistrement l'appareil qui synchronise l'emporte, une modification l'emporte toujours sur une suppression. Copie de sécurité avant chaque application de données reçues, synchronisation automatique (ouverture, toutes les 3 minutes, 15 s après une modification), reprise « le serveur gagne » / « cet appareil gagne ». Les photos ne sont pas synchronisées.
- **Péages de France** : les 30 principales liaisons du réseau **VINCI Autoroutes** avec leurs **tarifs officiels du 1er février 2026** (classe 3 = 2 essieux, classe 4 = 3 essieux et plus, déduite du camion), dont Montpellier – Perthus (62,50 € en classe 4) et Lyon – Perthus (157,80 €). Les autres réseaux (APRR, Sanef…) ne sont pas couverts. Pas de double compte avec l'estimation au kilomètre.
- Relais 1.3 : route de synchronisation (`/api/sync`, versions, refus 409 en cas de base périmée).
- 106 tests (96 application + 10 relais).

## 3.1.0 — Fichiers du tachygraphe, alertes automatiques, CMR, télépéage européen

- **Lecture des fichiers de carte conducteur (.ddd, .c1b)** : activités des 28 derniers jours et identité du conducteur lues directement (format TLV, tampon circulaire d'activité, changements d'activité sur 16 bits, selon le règlement (CE) 1360/2002, annexe 1B). Le conducteur est reconnu et le chauffeur correspondant présélectionné. Les signatures ne sont pas vérifiées ; seules les cartes conducteur sont lues (pas les fichiers de véhicule). Testé sur des fichiers construits d'après la spécification : essayez avec un vrai fichier et signalez tout écart.
- **Alertes automatiques par le relais** : le relais diffuse chaque alerte sur ses canaux (**ntfy, Telegram, WhatsApp Cloud API** — texte ou modèle approuvé —, **webhook**). Les secrets restent sur le serveur, jamais dans l'application. Pas de doublon pendant 6 h, 60 alertes par heure au plus.
- **Lettre de voiture CMR imprimable** : les 24 rubriques (français / anglais), préremplie depuis le voyage, conservée avec lui. Ce n'est pas une lettre de voiture électronique.
- **Relevés de télépéage européen** (DKV, UTA, Eurowag, Telepass…) : import CSV, montant des péages d'Europe du voyage calculé d'après les lignes réelles (en euros, entre le départ et le retour), par pays ; prioritaire sur l'estimation.
- 102 tests (93 application + 9 relais).

## 3.0.0 — Feuille de route terminée (phases 5 à 8)

- **Alertes sur le téléphone du bureau** (ntfy, gratuit) et **boutons WhatsApp / SMS** prêts à l'emploi vers le chauffeur concerné, sur chaque alerte du suivi en direct. Rien n'est envoyé sans geste de l'utilisateur côté WhatsApp / SMS ; l'envoi automatique par WhatsApp Business exige un compte et des frais, il n'est pas inclus.
- **Balise de secours dans le téléphone du chauffeur** (mode chauffeur) : position envoyée au relais toutes les 20 à 60 s, positions conservées hors réseau et renvoyées au retour du réseau, écran maintenu allumé.
- **Preuve de livraison** : signature du destinataire à l'écran, réserves, position et heure, imprimable ; marque le voyage « livré » (et le lien client). **Ce n'est pas un e-CMR** : la valeur juridique d'un CMR électronique au Maroc et en Espagne n'est pas confirmée.
- **Tachygraphe** : import des activités d'un conducteur (CSV : conduite, repos, travail, disponibilité), détection des dépassements (conduite continue, journée, semaine, deux semaines, repos journalier et hebdomadaire), alerte sur les 14 derniers jours. Les fichiers bruts `.ddd` ne sont pas lus.
- **Chaîne du froid** : température reçue des balises (relais, Traccar, CSV), consigne par voyage, alerte au-delà de 15 min hors plage, analyse des excursions et rapport dans la fiche voyage.
- **Péages d'Europe** : estimation par kilomètres par pays × tarif au km réglable ; seuls l'Allemagne et l'Autriche sont préremplis, les autres pays sont signalés tant que vous n'avez pas saisi le tarif de votre concessionnaire.
- 98 tests (90 application + 8 relais).

## 2.5.0 — Heure d'arrivée estimée et lien de suivi client (phase 4)

- **ETA** : heure d'arrivée estimée avec fourchette, calculée d'après la position, la vitesse récente du camion, la **traversée du détroit** (attente au port, mer, débarquement) et les **pauses et repos réglementaires** (45 min après 4 h 30, 11 h après 9 h de conduite, en tenant compte de la conduite déjà effectuée). Affichée dans le suivi en direct et dans la fiche voyage ; **alerte de retard probable** par rapport au créneau promis au client.
- Fiche voyage : créneau promis (date et heure), coordonnées de destination (reconnues automatiquement pour une quarantaine de grandes villes, sinon saisies).
- **Lien de suivi pour le client** (Voyages → « Partager le suivi ») : page publique en français, anglais, espagnol ou arabe, avec état, ETA, retard éventuel, position approximative (ou exacte, ou masquée), étapes et message. **Fonctionne application fermée** (le relais calcule lui-même, avec le même moteur que l'application). Le client ne voit ni chauffeur, ni plaque, ni balise. Partage par WhatsApp ou e-mail (message prêt, aucun envoi automatique), validité réglable, **révocation**, passage automatique à « Livré ».
- Relais 1.1 : liens (`/api/partages`), page client, moteur partagé avec l'application ; 89 tests (81 application + 8 relais).

## 2.4.0 — Suivi en direct (phase 3)

- **Page « Suivi en direct »** : carte de la flotte (fond OpenStreetMap facultatif, fond uni hors ligne), état de chaque camion (en route, à l'arrêt, arrêt prolongé, au port, en douane, au dépôt, **en traversée**, signal perdu), vitesse, âge de la dernière position, conduite sans pause de 45 min, alertes.
- **Le silence après un port est une traversée, jamais une alerte** : pas de couverture en mer, le signal revient à l'arrivée. Un silence ailleurs devient « signal perdu » au bout de 30 min.
- **Étapes du voyage automatiques** : un voyage « en cours » reçoit en direct l'entrée au port, l'embarquement et le débarquement du détroit (marqués « GPS »), et la traversée passe à « effectuée ».
- **Alertes** : signal perdu, arrêt de plus de 45 min hors zone connue, conduite continue (4 h 15 prévenir, 4 h 30 alerter, estimation GPS), excès de vitesse ; notification de l'appareil pour les alertes urgentes si les rappels sont activés.
- **Sources** : relais fourni (`serveur/relais.js`, sans dépendance : JSON, OsmAnd/Traccar Client, renvoi Traccar), API d'un **Traccar** existant, ou **démonstration** sans serveur. Jeton et adresse conservés sur l'appareil, jamais dans les sauvegardes.
- Fiche camion : identifiant de la balise (IMEI). 80 tests (75 application + 5 relais), documentation de déploiement dans `serveur/README.md`.

## 2.3.0 — Péages mesurés par GPS et rapprochement Jawaz Pro (phase 2)

- **Gares de péage localisées** : ADM ne publie pas leurs coordonnées. Trois façons de les renseigner, une seule fois : (1) **« Relever les gares » sur une trace** — l'application repère les ralentissements isolés en pleine conduite (typiques d'un péage), vous les affectez à une gare ADM sur une carte ; (2) **import OpenStreetMap** (GeoJSON exporté d'overpass-turbo, requête fournie, correspondances à valider) ; (3) saisie manuelle.
- **Péage mesuré** : chaque trace donne les passages devant les gares puis la somme des sections de la grille officielle, **selon la classe du camion**. Un clic l'applique au voyage (prioritaire sur le trajet type). Casablanca → Tanger Med reconstitué = 253 MAD, comme la grille.
- **Rapprochement avec le relevé Jawaz Pro** (CSV, colonnes reconnues ou désignées) : péages **conformes**, **écarts de montant**, **non facturés**, **facturés sans passage GPS** (Pass prêté, autre camion) avec les montants en jeu.
- Traces conservées plus finement (simplification à 30 m, passages devant les gares préservés) ; schéma de données **v6** (migration automatique) ; 70 tests.

## 2.2.0 — Traces GPS (phase 1)

- Nouvelle page **Traces GPS** : import de l'export de vos balises en **CSV ou GPX**, lu sur l'appareil. Colonnes reconnues automatiquement (français ou anglais, `;` ou `,`, virgule décimale, dates `JJ/MM/AAAA` ou ISO, date et heure séparées) ; sinon choix manuel des colonnes. Fuseau horaire du fichier au choix.
- **Analyse** : distance, durée, vitesse moyenne, **conduite estimée** et plus longue période sans pause de 45 min (estimation d'après la vitesse, pas le tachygraphe), arrêts de plus de 20 min, trous de signal, points aberrants écartés, **tracé dessiné hors ligne**.
- **Zones** (ports du Maroc et d'Europe, frontière, dépôts, clients) modifiables ; zones habituelles préchargées (coordonnées approximatives à ajuster).
- **Étapes détectées automatiquement** : entrée au port, **embarquement et débarquement de la traversée du détroit (aller et retour)**, livraison, retour au dépôt. Un clic les applique au voyage (marquées « GPS »), renseigne la date de la traversée et la distance GPS, et propose le séjour Schengen du chauffeur.
- Trace d'exemple intégrée pour essayer sans fichier ; schéma de données **v5** (migration automatique) ; 61 tests.

## 2.1.0 — Transport international Maroc ⇄ Europe (phase 0)

Issu de l'audit [`docs/`](docs/README.md).

### Voyages
- Nouvelle page **Voyages** : aller, retour, étapes horodatées (départ, douane BADR, port, embarquement, débarquement, livraison, chargement de retour, retour), coût complet, marge, coût au km.
- **La traversée Tanger Med ⇄ Algeciras est dans chaque voyage** (aller et retour créés automatiquement) : armateur, date, mètres linéaires, n° de réservation, statut, coût = fret + ml × (BAF + ETS + soufre + FuelEU) + passage chauffeur + frigorifique. Lignes Sète ⇄ Tanger Med préremplies (grille GNV).
- **Contrôles avant départ** : visa et passeport (6 mois) jusqu'au retour, permis, carte conducteur, papiers du camion, autorisation bilatérale, jours Schengen, PTAC contre le plafond (40 t, 44 t transport combiné, 36 t à 4 essieux), traversées non réservées. Alertes et rappels associés.
- **Retour à vide** : kilomètres, pourcentage et coût estimé.
- Listes de contrôle (avant départ, arrivée en Europe, retour), tableau indicatif des interdictions de circuler.

### Autorisations et Schengen
- Registre des autorisations « E » et « MA » (au voyage / à temps), alertes d'expiration et de **compte-rendu de voyage** non remis.
- **Compteur Schengen 90/180** par chauffeur (séjours, jours restants, dernière date autorisée).

### Péages Autoroutes du Maroc
- Grille officielle (584 sections, relevée le 10/11/2026), **classe déduite du camion** (essieux), trajets types vérifiés (Casablanca → Tanger Med 253 MAD en classe 3), calcul section par section, péage intégré à la fiche voyage.

### Autres
- **Interface en arabe (de droite à gauche)** : navigation, boutons et écrans de voyage ; reste en français. Réglages → Général → Langue.
- Schéma de données **v4** (migration automatique, sans perte) ; export CSV des voyages, autorisations et séjours Schengen.
- 10 nouveaux tests (**53** au total).

## 2.0.0 — Application hors ligne complète

### Sécurité des données
- **Schéma versionné (v3)** et migration automatique des anciennes données ; copie de sécurité conservée avant la mise à niveau ; données plus récentes jamais rétrogradées.
- **IndexedDB** : copie miroir de l'état, **instantané quotidien (7 jours)** et instantané avant chaque import ; **récupération automatique** si le navigateur efface ou corrompt les données.
- **Sauvegarde** : ZIP (données + photos), JSON, ou **chiffrée AES-256-GCM** par mot de passe ; import des anciens formats ; export **CSV/Excel** de toutes les tables.
- **Pastille « dernière sauvegarde »** toujours visible, rappel hebdomadaire, protection du stockage contre l'effacement, jauge d'espace.

### Rappels
- Notifications pour **papiers qui expirent, repos des chauffeurs, factures en retard, commandes à traiter, sauvegarde**, avec catégories au choix.
- Déduplication (urgent : chaque jour ; à surveiller : tous les 3 jours), un clic ouvre la bonne page.
- **Application fermée** : synchronisation périodique via le service worker (Android/Chrome, application installée).

### Photos
- Pièces jointes sur **commandes (CMR, livraison, dommages), pleins (ticket), camions, entretiens, chauffeurs, dossiers de douane**.
- Compression à la prise (1600 px, JPEG) : une photo de 15 Mo tient en ~300 Ko ; 100 % hors ligne ; galerie, visionneuse plein écran, export/restauration dans le ZIP.

### Mode chauffeur
- Interface à un écran verrouillée sur un chauffeur : service, mission et étape suivante en un geste, photos, itinéraire, plein de gasoil.
- PIN salé (PBKDF2) + code de secours, blocage temporaire après 5 échecs.

### Démarrage, mobile et PWA
- **Assistant de démarrage** (entreprise, mentions légales, paramètres, données de départ : zéro / exemple / restauration).
- Icônes PNG (standard, adaptative, Apple), manifeste enrichi (raccourcis), écran de démarrage, **indicateur hors ligne**, bandeau d'installation (Android et iOS), mise à jour proposée à l'utilisateur.
- Bouton « + » flottant, menu « Plus », claviers adaptés, pas de clavier surgissant à l'ouverture d'une fenêtre sur mobile.
- Thème clair / sombre / automatique, champs plus lisibles en sombre.

### Gestion
- **« À traiter »** classé par urgence avec actions directes ; recherche globale et touche N conservées.
- **Impression** : factures avec **montant en lettres**, logo, RIB et mentions ; **ordre de transport** (nouveau) ; dossier de douane en une page.
- Réglages en onglets (Général, Données, Rappels, Appareil).

### Technique
- Logique métier étendue dans `noyau.js` (migrations, rappels, étapes de commande, missions, montants en lettres) ; **43 tests** (ZIP validé par un outil standard, chiffrement, migrations…).
- Service worker : cache d'abord, version = commit, mise à jour contrôlée.
- Workflow GitHub Pages : tests puis publication.

### Corrigé
- Rechargement parasite à la toute première visite (nouveau service worker).
- Échap dans la recherche globale vidait le champ au lieu de fermer la fenêtre.

## 1.x
- Flotte, gasoil, chauffeurs, trajets, douane, codes SH, assistant IA, commandes, clients, factures.
