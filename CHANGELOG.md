# Changelog

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
