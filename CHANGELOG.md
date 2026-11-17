# Changelog

## 5.12.0 — Mises à jour légères pour les données mobiles ; hors ligne réparé sur le serveur multi-utilisateur

- **Une nouvelle version ne retélécharge plus toute l'application** : chaque publication pose l'empreinte de chaque fichier, et le téléphone garde de sa copie hors ligne tout ce qui n'a pas changé. Avant, chaque mise à jour rechargeait toute l'application (≈ 730 Ko compressés), même pour une correction d'une ligne ; maintenant seuls les fichiers modifiés partent, plus le service worker et ses trois fichiers de base toujours revérifiés — environ 40 Ko dans l'essai où un seul fichier changeait. La mise à jour vers cette version-ci recharge encore tout une dernière fois. Vérifié sur le site publié : copie hors ligne de 108 fichiers, tous reconnus par leur empreinte. Pour les chauffeurs en données mobiles, au Maroc comme en roaming en Europe, c'est autant de forfait gardé.
- **Première visite moitié moins lourde** : 0,8 Mo au lieu de 1,45 Mo. La copie hors ligne ne retélécharge plus ce que la page vient de recevoir (elle demande seulement au serveur si c'est inchangé), et le module de l'assistant IA (320 Ko, inutile sans internet de toute façon) n'est gardé qu'à sa première utilisation.
- **La carte en direct se charge à la demande** (bibliothèque Leaflet, 150 Ko) au lieu d'être chargée à chaque démarrage ; « Chargement de la carte… » s'affiche un instant à la première ouverture. Elle reste dans la copie hors ligne : la carte s'ouvre aussi sans réseau.
- **Réparé : le serveur multi-utilisateur (relais) bloquait le hors ligne.** Il ne servait pas les polices ni le module IA : l'installation hors ligne échouait sur ce serveur (pas d'application sans réseau), la police des titres ne s'affichait pas et l'assistant IA ne pouvait pas se charger. Tout est servi maintenant, avec la même mise à jour légère ; un fichier inchangé répond « inchangé » sans être renvoyé.
- Mesuré honnêtement : le **temps d'ouverture** ne change presque pas (première visite en 4G lente ≈ 3,9 s au lieu de 4,0 s ; ouverture habituelle depuis la copie du téléphone ≈ 0,2 s sur un téléphone moyen). Le code est trop lié pour être découpé page par page avec profit sans étape de construction ; le vrai coût était les données, et c'est lui qui baisse.

## 5.11.0 — Plus rapide avec beaucoup de voyages, plus lisible, tout au clavier

- **Les pages s'ouvrent 2 à 10 fois plus vite avec un gros historique.** Mesuré avec 500 voyages, 500 commandes et 380 factures, sur un téléphone moyen (processeur ralenti ×4) : tableau de bord 4,6 s → 0,8 s, Voyages 3,0 s → 0,3 s, Factures 1,5 s → 0,4 s, Planning 0,9 s → 0,2 s, Direction 0,85 s → 0,45 s ; enregistrer reste sous 0,1 s, ouvrir une fiche de voyage 0,02 s. Le coût et la marge de chaque voyage ne sont plus recalculés plusieurs fois pour un même affichage, et la facture de chaque voyage est retrouvée d'un coup au lieu d'être cherchée facture par facture. Les chiffres affichés sont exactement les mêmes.
- **Voyages terminés par pages de 30** : la liste montre les 30 plus récents et un bouton « Afficher les 30 suivants (n restants) » ; un voyage ouvert reste affiché.
- **Contraste renforcé, thèmes clair et sombre** : tous les textes, couleurs d'état (vert, orange, rouge, violet) et pastilles atteignent au moins 4,5:1 sur chacun de leurs fonds, le seuil de lisibilité recommandé (WCAG AA) — y compris en plein soleil sur un téléphone. Le bleu est un peu plus profond en clair ; en sombre, les boutons pleins prennent un bleu plus soutenu sous le texte blanc et le bleu des textes s'éclaircit ; le bouton « Supprimer », la glissière verte du chauffeur et les cases « en voyage » du planning aussi.
- **Tout se fait au clavier** : les cases du planning (chauffeurs, camions) et les lignes du tableau de Direction se prennent à la tabulation ; Entrée ou Espace les ouvre ; dans le planning, une seule case est dans l'ordre de tabulation (aujourd'hui) et les flèches passent d'un jour ou d'une ligne à l'autre (inversées en arabe). Contour de focus visible partout.
- Pour la suite (outil de développement, rien ne change à l'écran) : **captures de référence** de chaque page — téléphone et bureau, clair et sombre, mode chauffeur compris (108 images) — comparées à chaque livraison (`node tests/captures.js`, ou `--contre` l'adresse publiée pour comparer à la version précédente ; les pixels changés sont dessinés en rouge). Deux essais permanents de plus : le budget de rendu avec 500 voyages (un seul calcul de coût par voyage et par affichage, mêmes résultats, sous le budget) et le contraste des couleurs des deux thèmes.

## 5.10.0 — Mode chauffeur : glisser pour confirmer, la route en tête

- **Glisser pour confirmer** à la place des boutons pour les gestes qui comptent : l'étape de la mission (« Chargée », « Livrée »…), « Arrivé au quai » et la fin de service. Rien ne part par un appui accidentel dans la poche, et plus de question « Êtes-vous sûr ? » : le glissement est la confirmation (la livraison ouvre directement la preuve de livraison). À moitié glissé, rien ne se passe. En arabe, on glisse vers la gauche. Au clavier, Entrée confirme.
- **En tête de l'écran, « Ma route »** : la prochaine pause de 45 minutes et l'heure de fin de la conduite du jour (avec les aires poids lourds), et où faire le plein (Maroc plein complet, Espagne tant de litres, pas de plein en France) — au lieu d'être cachés plus bas dans la mission.
- **Bandeau permanent « En ligne » / « Hors ligne : tout est gardé sur le téléphone »** : le chauffeur sait que ce qu'il note n'est pas perdu sans réseau.
- **Une vibration** quand un geste est enregistré ; boutons plus grands ; flèche du trajet dans le bon sens en arabe.

## 5.9.0 — Arrivée et départ des quais notés par le GPS

- **L'attente aux quais se mesure seule** pour les camions suivis : quand le camion entre sur le site de chargement ou de livraison (300 m), l'arrivée est notée ; quand il le quitte (au-delà de 400 m, confirmé par deux positions), le départ aussi. L'attente au-delà de la franchise du client part sur la facture comme avant — sans que personne n'ait à y penser.
- **Le site s'apprend** : la première fois que l'arrivée est notée (par le chauffeur, « Arrivé au quai », ou au bureau) pendant que le camion est arrêté sur place, l'endroit est retenu pour ce client et cette ville ; les fois suivantes, tout est automatique. Plusieurs entrepôts d'un même client sont retenus séparément. La livraison utilise aussi les coordonnées précises de la destination du voyage quand elles sont saisies.
- **Jamais à la place d'une heure notée à la main** : le GPS ne pose que ce qui manque (par exemple le départ après une arrivée notée par le chauffeur). Les heures posées par le GPS portent « GPS » sur la fiche du voyage ; un message le dit (« départ au chargement (GPS) »).
- Vérifié tant que l'application est ouverte (au bureau par exemple) : contrôle toutes les 2 minutes.

## 5.8.0 — La facture en vrai PDF

- **Bouton « PDF »** sur chaque facture (page Factures et fiche du voyage → Argent) : un vrai fichier PDF, prêt à archiver ou à transmettre, sans passer par l'impression du navigateur.
- **L'e-mail de la facture joint le PDF** (au lieu d'une page web), avec la preuve de livraison et les photos du CMR comme avant.
- Contenu identique à la facture imprimée : logo et coordonnées de l'entreprise, numéro, date, échéance, client et son ICE, lignes (les longues désignations passent à la ligne), totaux HT / TVA / TTC, somme en lettres, « Payée le », et en pied de **chaque page** les mentions, le RIB et les identifiants légaux ; une facture de nombreuses lignes continue sur les pages suivantes (« suite », 1/3, 2/3…).
- Fabriqué sur l'appareil, sans service extérieur ni bibliothèque : polices standard des lecteurs PDF (accents, €, « » compris ; « → » écrit « – »). Les écritures non latines (un nom de client en arabe) n'existent pas dans ces polices : dans ce cas, la page web de la facture est jointe en plus, pour que rien ne soit perdu.

## 5.7.0 — Plus de limite de 5 Mo pour les données ; fondations remises d'aplomb

- **Les données n'ont plus de plafond** : tant qu'elles tiennent dans le stockage rapide du navigateur (≈ 5 Mo), rien ne change ; au-delà, elles passent **automatiquement** dans la base de l'appareil (IndexedDB) au lieu d'afficher « stockage plein ». Sans perte : la base est écrite d'abord, le stockage rapide n'est vidé qu'ensuite ; les instantanés quotidiens continuent ; la protection contre l'effacement est demandée. Réglages → Données dit où elles sont enregistrées. Une flotte qui accumule deux ans de voyages, de traces et de dépenses ne bute plus sur la limite.
- **Fondations** (rien ne change à l'écran, tout reste où il était) : les 33 couches qui s'empilaient sur les actions des pages et les 8 sur l'enregistrement sont remplacées par un **registre** où chaque partie de l'application s'inscrit, avec un **ordre explicite** là où il compte (verrou à plusieurs, « Annuler », suites d'une étape ; avant l'enregistrement : taux figés, commandes des voyages, historique, dépenses ; après : synchronisation, notifications, envoi au serveur). Les blocs ajoutés aux pages (accueil, factures, voyages, planning, gasoil, chauffeurs) s'inscrivent aussi, dans le même ordre qu'avant. Ajouter une fonction ne dépend plus de l'ordre de chargement des fichiers.
- Vérifié : tous les essais réels de la session repassés (fiche du voyage, boîte des demandes, liens, itinéraire, coupures, créneau au port), et les gestes des pages Commandes, Factures, Chauffeurs, Camions, Tachygraphe et Voyages un par un.

## 5.6.0 — Meilleur créneau au port, d'après vos propres passages

- **Fiche du voyage → Suivi → Créneau au port** : pour le prochain port du voyage (Tanger Med à l'export, Algeciras, Tanger Med à l'import), l'heure d'arrivée conseillée ce jour-là et celle à éviter, avec l'attente habituelle de chacune et le nombre de passages ; pour un voyage prévu, l'**arrivée estimée** au port (départ du dépôt à 6 h, 70 km/h, pauses et repos de nuit) et ce qu'elle coûte en attente par rapport au meilleur créneau. Petit graphique des tranches de 3 heures, l'arrivée estimée soulignée.
- **Page Planning → Attentes aux ports par jour et heure** : une grille jour × tranche de 3 heures pour chaque port (Algeciras : marchandises fraîches à part), du vert (rapide) au rouge (lent), avec le nombre de passages ; le détail au survol.
- **Devis** : le créneau conseillé à Tanger Med le jour du chargement.
- Tout vient de **vos attentes mesurées** (entrée au port → embarquement ou sortie, heure du Maroc ; passages au scanner écartés) ; sans assez de passages, rien n'est conseillé et c'est dit (3 passages par tranche au moins, sinon toute la semaine).
- Pour les développeurs : un test vérifie qu'aucun nom global n'est déclaré deux fois dans les scripts de la page (la page s'arrêtait au second fichier).

## 5.5.0 — Coupures planifiées : la prochaine pause, les compteurs du chauffeur, les aires poids lourds

- **Fiche du voyage → Suivi → Conduite et coupures** (voyage en cours dont la balise est suivie) : **prochaine pause de 45 min** (« dans 0 h 40, vers 17:19, ≈ 53 km »), **fin de la conduite du jour** (9 h, ou 10 h quand c'est encore permis cette semaine), arrêt en cours (« encore 15 min pour valoir une pause »), dépassements en rouge.
- **Compteurs** du chauffeur : depuis la dernière pause (4 h 30), aujourd'hui (9 h / 10 h), **cette semaine (56 h)**, **deux semaines (90 h)**. L'application tient un journal de conduite par chauffeur avec le GPS qu'elle voit ; les jours sans données (repos, ou application fermée) sont signalés : le compteur peut alors être sous-estimé.
- **Aires poids lourds** vers le lieu estimé de la pause : lien de carte, ou liste OpenStreetMap (places poids lourds, gratuit ou payant, gardé, toilettes, douches) avec « Y aller ».
- **Alerte au chauffeur** 30 minutes avant la pause et avant la fin de sa journée (réglable), sur son canal habituel (ntfy ou WhatsApp par le relais), avec le lien des aires ; une seule fois par pause ; tant que l'application est ouverte (au bureau). « Prévenir le chauffeur » l'envoie tout de suite. Réglages → Général → Coupures et alertes au chauffeur.
- **Mode chauffeur** : la prochaine pause et la fin de journée sur la mission.
- Correction : une balise à l'arrêt qui n'envoie sa position que toutes les 20 minutes ne faisait jamais « pause » (les trous entre deux positions ne s'additionnaient pas) ; l'alerte « 4 h 30 sans pause » pouvait se déclencher à tort.
- Estimation d'après le GPS et le règlement CE 561/2006 simplifié : le tachygraphe fait foi.

## 5.4.0 — Itinéraire poids lourd : kilomètres réels par pays, liens Google Maps

- **Fiche du voyage → Suivi → Itinéraire poids lourd** : le trajet découpé en tronçons routiers (Agadir → Tanger Med, Algeciras → Perpignan ; la traversée du détroit à part), chacun avec son **lien Google Maps** pour le chauffeur ou le bureau.
- **« Calculer l'itinéraire réel »** quand le relais a un service d'itinéraire : kilomètres et heures de conduite d'un camion (gabarit, tonnage), **kilomètres par pays** et **à péage**. Ils remplissent les kilomètres du voyage et les « km par pays » : **péages d'Europe recalculés**, **consigne de plein** sur les vrais kilomètres d'Espagne et de France, coût au km. **Une valeur saisie à la main n'est jamais écrasée.**
- **Devis** : l'itinéraire réel est calculé avant le prix conseillé quand le service est branché ; le détail dit si la distance est calculée ou estimée (à vol d'oiseau × 1,25).
- **Relais** : `ITINERAIRE_URL` (votre propre serveur openrouteservice, logiciel libre) ou `ITINERAIRE_CLE` (service public d'openrouteservice) ; profil camion, ferries évités, résultats gardés 60 jours, quota quotidien. **Conditions à vérifier** : la formule gratuite du service public semble réservée à un usage non commercial ; Réglages → Général → Itinéraire poids lourd l'explique. Sans service, l'estimation reste, signalée comme telle.
- Google Maps n'a pas de mode poids lourd (hauteurs, tonnages, interdictions à vérifier) ; Mappy n'est pas relié : son format d'adresse n'a pas pu être vérifié.

## 5.3.0 — Liens sans compte : le client dépose ses documents, le transitaire marque les étapes de douane

- **Lien de dépôt pour le client** (fiche du voyage → Documents, pour l'aller et pour le retour) : le client ouvre le lien sur son téléphone, voit la liste des documents attendus **dans sa langue** (français, anglais, espagnol ; arabe au choix sur la page) et les envoie **en photo ou en PDF**, sans compte. Les photos sont réduites sur son téléphone avant l'envoi.
  - Les fichiers arrivent tout seuls dans les **photos du voyage** (relève toutes les 5 minutes, ou « Vérifier ») et **marquent les documents reçus** ; message « Primeurs du Souss a envoyé 2 documents (CMD-…) : Facture commerciale ». Ils sont ensuite effacés du relais.
  - **« Demander les documents »** met désormais le lien dans le message envoyé au client (WhatsApp ou e-mail), dans sa langue.
  - Les PDF sont gardés comme les photos (galerie, export, synchronisation) ; une image que le navigateur ne sait pas afficher (HEIC) est gardée telle quelle, jamais perdue.
- **Lien transitaire** (fiche du voyage → Suivi) : le transitaire voit les étapes de Tanger Med et d'Algeciras, aller et retour, avec les documents à présenter, et appuie sur « Fait » à chaque étape, avec la référence (DUM, MRN, CHED…) et une note ; « Annuler » s'il s'est trompé. L'étape est **appliquée au voyage** avec ses effets (étape du voyage, sortie du port, traversée, séjour Schengen), le chauffeur et l'équipe sont prévenus comme d'habitude ; une étape notée à la main ou par le GPS n'est jamais écrasée. La page du transitaire suit ce que l'application sait (étapes posées par le GPS). Les noms des étapes restent en français ; l'interface de la page existe en français, espagnol, anglais et arabe.
- Liens servis par votre relais : **identifiant secret** dans l'adresse, **expiration** (3 semaines pour le dépôt, durée du voyage pour le transitaire), **révocation** en un geste, page invisible des moteurs de recherche, 40 fichiers de 12 Mo au plus par lien ; fichiers et liens chiffrés au repos si le chiffrement est activé, effacés 7 jours après l'expiration.

## 5.2.0 — Boîte des demandes : les demandes reçues par e-mail et WhatsApp, déjà lues

- **Nouvelle page Commandes → Demandes.** Les e-mails de la boîte de l'entreprise y arrivent seuls : le relais relit la boîte **toutes les 5 minutes, en lecture seule** (rien n'est marqué lu ni déplacé dans votre messagerie), sans service payant ni bibliothèque ajoutée.
- **Chaque message est déjà lu** : trajet, date de chargement (« jeudi », « demain » lus à la date du message), palettes, poids, température, prix ; client reconnu à son adresse, ou « Nouveau client » ; « Ressemble à CMD-… » si la demande est peut-être déjà enregistrée ; ce qui manque ; noms des pièces jointes (elles restent dans la messagerie). L'historique cité d'une réponse est retiré pour ne pas relire un ancien prix ou une ancienne ville.
- **Un geste par message** : « Créer la commande » (client inconnu créé au passage), **« Chiffrer et répondre »** quand le client demande un prix (commande à chiffrer, prix conseillé, devis envoyé par WhatsApp ou e-mail), « Répondre », « Ignorer » (avec « Annuler »). Les demandes traitées gardent le lien vers leur commande ; « Remettre à trier » si besoin.
- **Les vraies demandes d'abord** : les messages qui ressemblent à une demande de transport passent devant ; lettres d'information et listes de diffusion rangées dans « Autres » ; nos propres messages et les réponses automatiques écartés par le relais.
- **Depuis WhatsApp (Android)** : l'application installée apparaît dans le menu « Partager » ; un message partagé arrive dans la boîte et la page s'ouvre. Sur iPhone (pas de partage vers une application web) ou si WhatsApp ne propose pas « Partager » pour ce message : copier, puis « Coller un message » sur la page Demandes — le message rejoint la même boîte.
- Le nombre de demandes à trier s'affiche sur l'onglet Demandes et dans « À traiter » de l'accueil (urgent au-delà de 24 h sans réponse). Raccourci « Demandes à trier » sur l'icône de l'application.
- **Réglages → Général → Boîte des demandes** : état de la relève (dernière relève, erreur expliquée, par exemple mot de passe refusé), lignes à ajouter au relais, « Relever maintenant ». Le test du relais dit aussi si la boîte est relevée. Les droits suivent ceux de la page Commandes.
- **Relais** : variables `IMAP_HOTE`, `IMAP_UTILISATEUR`, `IMAP_MOT_DE_PASSE` (et `IMAP_PORT`, `IMAP_SECURITE`, `IMAP_DOSSIER`, `IMAP_INTERVALLE_MIN`) ; routes `GET /api/demandes` et `POST /api/demandes/relever` ; messages gardés chiffrés au repos si le chiffrement est activé. Guide d'hébergement, installateur et modèles de configuration mis à jour.
- Correction : l'application installée sur GitHub Pages ne pouvait pas appeler un relais placé à une autre adresse pour le lien de suivi des clients (en-tête `X-LF` refusé par le navigateur) ; le relais l'autorise maintenant.

## 5.1.0 — Fiche du voyage : où en est le camion, et la seule chose à faire maintenant

- **La fiche du voyage est refaite.** Fermée, elle montre la référence, le client, le trajet en grand, la marge et le statut, une **frise réduite** et la ligne **« À faire »** : on sait quoi faire sur chaque voyage sans l'ouvrir.
- **Ouverte**, elle commence par :
  - la **frise** Départ → Tanger Med → Algeciras → Livraison → Retour → Dépôt, avec l'étape en cours (« Algeciras · depuis 1 h 20 », « en mer ») et le temps passé dans chaque port ; « Retour : à trouver » en orange tant qu'il n'y a ni chargement ni décision de rentrer à vide ;
  - l'**arrivée estimée** quand la balise du camion est suivie ;
  - **« À faire maintenant »** : une seule action, calculée d'après l'état du voyage, avec son bouton — affecter l'équipe, réserver la traversée, demander les documents au client, marquer le départ, l'étape de port suivante (avec les documents à présenter et qui doit agir), la livraison, charger ou trouver le retour, le retour au dépôt, puis facturer, envoyer la facture, facturer le retour, relancer, encaisser ; « Appeler » le chauffeur pendant le voyage ;
  - les **points d'attention** qui ne sont pas l'action du moment (documents qui manquent encore, traversée retour à réserver, retour à trouver, preuve à faire signer, aller livré à facturer, attente trop longue au port), chacun avec son bouton.
- **Quatre onglets** au lieu d'une longue page : **Suivi** (passage des ports, attentes, traversées, retour, arrivée estimée, chaîne du froid, étapes), **Documents** (documents du client, CMR, preuve de livraison, photos, dossier complet, références de douane), **Argent** (la marge nette en grand avec la part des coûts, le tableau des coûts, les dépenses, les factures de l'aller et du retour avec Envoyer et Encaisser, l'attente aux quais, la consigne de plein), **Équipe** (chauffeur et camion avec leurs papiers — touchez la pastille pour le détail —, jours Schengen, Appeler et WhatsApp, points à régler avant le départ, listes de contrôle, notes). Un voyage terminé s'ouvre sur l'onglet Argent. Les onglets Documents et Équipe portent le nombre de choses à régler.
- **Plus rapide** : le contenu d'une fiche n'est calculé qu'à son ouverture ; changer d'onglet ne recharge pas la page.
- **Chaque étape se marque directement** dans la liste des étapes (plus seulement « l'étape suivante ») ; le bouton principal va à l'étape qui suit la dernière faite, celles d'avant que le GPS a sautées ne bloquent plus. « Annuler » reste proposé dans le message.
- **Sur ordinateur**, la fiche ouverte se lit sur deux colonnes : où en est le voyage et quoi faire à gauche, les onglets à droite. Sur téléphone, une colonne ; les actions moins courantes (Dupliquer, Terminer, Supprimer) sont rangées sous « ⋯ ».
- **Profil sans accès aux prix** : pas d'onglet Argent ni d'action d'argent ; l'attente aux quais et la consigne de plein passent dans Suivi ; le coût des traversées est masqué.
- Corrections :
  - un port était compté « en cours » tant qu'une étape intermédiaire n'était pas notée, même après l'embarquement : il est maintenant terminé dès sa dernière étape faite ;
  - les papiers du chauffeur et du camion d'un voyage en route sont vérifiés à la date du jour (plus à la date de départ) ;
  - les documents du client qui bloquent en douane restent signalés après le chargement, jusqu'à la livraison ;
  - un test du planning dépendait de la date du jour.
- Pour les développeurs : les blocs de la fiche s'inscrivent dans un registre (`enregistrerBlocVoyage({ onglet, ordre, rendu })`, `voyages.js`) ; les quatre enveloppes de `blocFacturation` (retour, documents, quais, plein) sont remplacées par des inscriptions. Logique pure et testée dans `fiche.js` (frise, prochaine action, points d'attention, étape posée), écran dans `fiche_ui.js`.

## 5.0.0 — Nouvelle navigation : six sections

- **Six sections au lieu de 26 pages** dans le menu : **Aujourd'hui** (accueil, opérations), **Commandes** (commandes, clients), **Voyages** (voyages, planning, passages douane, carte, traces GPS, trajets, douane, autorisations, péages), **Flotte** (camions, chauffeurs, gasoil, tachygraphe), **Argent** (factures, rentabilité, direction), **Réglages** (réglages, utilisateurs, accès, journal, codes SH).
  - Les pages d'une section s'affichent en **onglets** en haut de la page ; toucher une section rouvre la **dernière page** ouverte dedans.
  - Chaque page garde son adresse (`#planning`, `#factures`…) et ses droits : une section n'affiche que les pages permises par le profil ou les accès par service, et disparaît s'il n'en reste aucune.
  - Sur téléphone : Aujourd'hui, Commandes, Voyages, Flotte et « Plus » (toutes les sections et leurs pages).
- **« Annuler » dans le message de confirmation** pendant 6 secondes, plutôt qu'une question avant d'agir : étape d'un voyage ou d'un port, commande avancée, devis accepté, facture encaissée, étapes du chauffeur et arrivée au quai.
- **Polices embarquées**, qui marchent hors ligne : General Sans pour les titres (Fontshare, licence ITF gratuite pour usage commercial), Noto Sans Arabic pour l'arabe (licence OFL, téléchargée seulement quand un texte arabe s'affiche) ; le texte courant garde la police du système. Jetons de typographie et d'espacement.
- **Écrans vides** : un bouton pour la suite là où il manquait (aucune facture, aucune activité, aucun chauffeur, pages multi-utilisateur sans relais).
- Correction : sur téléphone, les cartes de l'accueil pouvaient déborder de l'écran à cause d'un texte long (colonnes de grille bornées).

## 4.15.0 — Étapes de port posées par le GPS

- **Sans rien apprendre**, en plus de l'entrée au port, de l'embarquement, du débarquement et de la sortie d'Algeciras déjà reconnus : **arrivée au port d'Algeciras au retour** (entrée dans le port avant l'embarquement) et **mainlevée / sortie de Tanger Med au retour** (sortie du port après le débarquement, qui pose aussi l'étape du voyage).
- **Les contrôles à l'intérieur du port s'apprennent de vos propres camions** : quand une étape (douane, scanner, police, contrôle sanitaire…) est notée pendant que le camion est arrêté au port, la position de cet arrêt est retenue pour cette étape. **À partir de 2 passages**, un arrêt au même endroit pose l'étape seul, au départ de l'arrêt, dans l'ordre du passage. Aucune coordonnée inventée : seulement vos relevés, partagés entre appareils en mode multi-utilisateur.
- **Arrêts courts** (5 minutes et plus dans un rayon de 60 m) repérés dans les ports — carte en direct et traces importées — là où l'analyse générale ne retient que les arrêts de 20 minutes.
- Les étapes posées ainsi portent « GPS » et le détail (« arrêt de 14 min à l'emplacement appris ») ; **annulée à la main, une étape n'est plus reposée** par le GPS. Elles alimentent le centre des passages, les temps habituels et les notifications comme les autres.
- Page **Passages douane**, vue de chaque port : « Reconnaissance par le GPS » — étapes déjà reconnues, en cours d'apprentissage (1/2), à relever ; « Oublier » un emplacement appris par erreur.

## 4.14.0 — Héberger le relais gratuitement

- **Guide pas à pas** (`docs/12-heberger-le-relais.md`) : pourquoi un relais, choisir entre le PC du bureau avec la box (0 MAD, recommandé), un nom de domaine + Cloudflare Tunnel quand la box n'a pas d'IP publique (≈ 100 à 150 MAD par an), ou une machine virtuelle gratuite (conditions à vérifier) ; https gratuit (Caddy, Let's Encrypt), e-mail (boîte de l'entreprise ou Gmail avec mot de passe d'application), sauvegarde, mise à jour, sécurité, dépannage. Déconseillé, avec la raison : l'offre gratuite de Tailscale (non commerciale), les hébergeurs qui mettent en veille, les tunnels dont l'adresse change.
- **Linux en une commande** : `sudo DOMAINE=… bash serveur/installer.sh` installe Node.js si besoin, le code, une configuration secrète (jetons et clé de chiffrement tirés au hasard), un service qui démarre avec la machine et redémarre seul, et Caddy pour le https. Relancé, il met à jour sans toucher à la configuration ni aux données.
- **Windows** : `serveur/demarrer-windows.cmd` (redémarrage automatique) et `serveur/relais.env.exemple`.
- **Image Docker corrigée** : elle ne contenait que quatre fichiers et ne démarrait plus depuis l'ajout de l'e-mail, du chiffrement, des comptes et des prix du jour ; elle contient maintenant l'application entière, avec un contrôle de santé.
- **Réglages → Général → Relais** : adresse et jeton, « Enregistrer et tester » (joignable en https, jeton accepté, e-mail prêt pour les factures et relances, canaux de notification, prix du jour), « Préparer l'installation » (configuration et commandes, jetons tirés sur l'appareil).

## 4.13.0 — Factures envoyées avec leurs justificatifs, relances programmées

- **« Envoyer »** sur chaque facture (et proposé dès qu'une facture est créée) : e-mail au client, dans sa langue, avec **la facture, la preuve de livraison (signature, réserves) et les photos du voyage** (CMR signé, livraison), le RIB dans le message. Trois chemins, sans coût :
  - par le **relais** (serveur d'e-mail de l'entreprise) : envoyé depuis l'adresse de l'entreprise, pièces jointes comprises ;
  - sinon par le **partage du téléphone** : Gmail, Outlook ou WhatsApp s'ouvrent avec les fichiers ;
  - sinon la messagerie s'ouvre et la facture s'ouvre en PDF, à joindre.
- **Relances programmées** : rappel 3 jours avant l'échéance, puis J+7, J+15, J+30 (réglables), de plus en plus fermes, en français, anglais ou espagnol. L'équipe est prévenue dans le fil à chaque date ; avec « envoi automatique » (Réglages → Rappels), le relais envoie aussi l'e-mail au client, application fermée. Une facture payée sort des relances ; « Suspendre les relances » sur une facture, « Pas de relance » sur un client.
- Sur la ligne de chaque facture : date d'envoi et prochaine relance.
- Relais : route `POST /api/notifications/document` (e-mail avec pièces jointes, PDF, HTML, JPEG, PNG, 8 Mo au plus).

## 4.12.0 — Consigne de plein par pays

- **Sur chaque voyage vers l'Espagne ou la France** : où faire le plein et combien, d'après les prix du jour (Maroc : vos pleins ; Espagne et France : prix officiels, Algeciras et Pyrénées-Orientales en priorité). Par exemple Agadir → Lyon : plein complet au Maroc avant Tanger Med, 132 L en Espagne avant La Jonquera, 426 L en Espagne au retour — rien en France ; Agadir → Madrid : tout l'aller-retour sur le gasoil marocain.
- **Règle** : à chaque arrêt, on ne prend que de quoi atteindre un pays moins cher à portée (le Maroc au retour compris), ou le prochain arrêt au même prix ; sinon le plein. Réserve de 10 %. Réservoir par camion (fiche du camion, 700 L par défaut), consommation réelle du camion.
- **Économie estimée** par rapport à des pleins pris au fil de la route (≈ 370 à 500 € par aller-retour vers la France aux prix du 16/11/2026).
- **« Envoyer au chauffeur »** par WhatsApp, et la consigne sur la mission en **mode chauffeur**.
- **Après coup** : litres achetés par pays d'après la carte carburant ; litres pris en France hors consigne et surcoût.
- Rappel affiché : le gasoil des réservoirs d'origine entre dans l'Union en franchise ; pas de jerricans.

## 4.11.0 — Prix conseillé et devis

- **« Chiffrer »** sur chaque demande (filtre « Devis » de la page Commandes) :
  - **coût complet de l'aller-retour** : médiane de vos voyages sur le même trajet (12 derniers mois) ; sans historique, estimation (kilomètres par Tanger Med ⇄ Algeciras, gasoil, traversées, per diem, charges fixes) qui **dit ce qui lui manque** (fret du détroit, péages…) ;
  - **chance de charger un retour** près de la livraison et prix moyen de ces retours, d'après votre historique (50 % par défaut sous 3 voyages) ;
  - **prix conseillé** = coût ÷ (1 − marge visée) − retour attendu, avec les variantes à 10 % et 20 %, **prix plancher** (en dessous, vous perdez de l'argent) ;
  - **prix passés** du client sur ce trajet (gagnés, perdus) et médiane tous clients.
- **Devis imprimable** (PDF) : client, transport, prix « traversée et péages inclus », paiement, conditions d'attente aux quais (franchise et tarif du client), validité, bon pour accord. **Envoi par WhatsApp ou e-mail** dans la langue du client (français, anglais, espagnol).
- **« Accepté »** confirme la commande (prête à planifier) ; **« Perdu »** garde le motif (trop cher, délai, pas de camion) et le prix du concurrent. **Taux de devis gagnés** sur 90 jours, motifs de perte, prix moyen gagné et perdu.
- Réglages : marge nette visée (15 % par défaut), fret du détroit par traversée quand vos traversées passées ne le donnent pas.

## 4.10.0 — Trouver le fret de retour avant de rentrer à vide

- **Alerte dès J-3 de la livraison** quand un camion parti vers l'Europe n'a pas de retour (urgente la veille et après livraison), avec le **prix plancher** du retour : en dessous, l'aller-retour perd de l'argent.
- **Bloc « Retours à trouver »** sur l'accueil : camions concernés, jours avant livraison, prix plancher, chargeurs à proximité.
- **« Trouver un retour »** sur la fiche du voyage :
  - vos **chargeurs de retour** à moins de 300 km de la livraison (fiche du client : « Chargeur de fret de retour » et ses villes de chargement), classés par zone puis par fidélité : retours déjà faits, dernier prix payé, dernier contact ;
  - un message de disponibilité prêt (« camion frigorifique disponible à Perpignan le 18/11, retour vers le Maroc… »), **dans la langue de chacun** (français, espagnol, anglais), par WhatsApp ou e-mail ; chaque contact est noté sur la fiche du client ;
  - un **message à coller dans vos groupes WhatsApp**, « Copier le message » ;
  - « Nouvelle commande de retour » quand un chargeur dit oui ; « Rentrer à vide » éteint les alertes de ce voyage.
- Les clients déjà chargés au retour (commandes Europe → Maroc) apparaissent même sans être marqués.

## 4.9.0 — Attente aux quais mesurée et facturée

- **Mode chauffeur** : « Arrivé au quai de chargement », puis « Arrivé chez le destinataire » ; le temps sur place s'affiche, orange au-delà de la franchise ; l'étape « Chargée » ou « Livrée » arrête le compteur.
- **Franchise et tarif par client** (fiche du client : 2 h gratuites par quai par défaut, tarif par heure en € ou MAD) ; au-delà, l'attente se facture **par demi-heure entamée**.
- **Lignes ajoutées seules à la facture** — celle du voyage pour l'aller, celle de la commande pour le retour — avec le détail (« Attente au chargement — Agadir, 16/11 : 3 h 45 sur place, franchise 2 h → 2 h × 35 € »), converties dans la devise de la facture, jamais deux fois. Commande déjà facturée : « Facturer l'attente » crée une facture d'attente à part.
- **Fiche du voyage** : bloc « Attente aux quais » (aller et retour), correction des heures au bureau ; **page Commandes** : pastille « 1 h 45 d'attente · 70 € » ; **page Factures** : l'attente des 30 derniers jours, facturable, facturée, et les heures sans tarif à aller chercher au contrat.
- Correction : quand le chauffeur marque « Livrée » (aller) ou « Chargée » (retour) sur une commande liée, le voyage reçoit l'étape correspondante.

## 4.8.0 — Documents attendus du client

- **Pastille « Docs 4/7 »** sur chaque commande (verte : tout est là ; orange : il en manque ; rouge : un document bloquant manque à 3 jours du chargement). Elle ouvre la liste.
- **La liste dépend du sens et de la marchandise** : facture commerciale et liste de colisage pour tout transport international ; EUR.1 (n'empêche pas le départ) ; à l'export du Maroc d'une marchandise fraîche : certificat EACCE, certificat phytosanitaire, CHED partie I dans TRACES (par l'importateur) ; au retour depuis l'Union : déclaration d'export (MRN) ; adresse et créneau de livraison. Chaque document : reçu (avec sa référence), ou « non requis » pour cette commande. Liste de départ à confirmer avec votre transitaire.
- **Demander les manquants** en un geste : message prêt, dans la langue du client (français, anglais, espagnol), à envoyer par WhatsApp ou e-mail ; la demande est notée sur la commande.
- **Alerte** dès J-3 du chargement s'il manque un document bloquant (urgente la veille) ; **point « à régler »** sur le voyage tant que la commande n'est pas chargée ; ligne « Documents du client » (aller et retour) sur la fiche du voyage.
- Sur téléphone, la case de référence n'apparaît qu'une fois le document reçu : la liste tient sur un écran.

## 4.7.0 — Coller un message : la demande du client devient une commande

- **« Coller un message »** sur la page Commandes : collez l'e-mail, le WhatsApp ou le SMS du client tel quel. L'application lit, sur l'appareil, sans réseau ni coût :
  - villes de chargement et de livraison (corridor Maroc ⇄ Europe, noms français, espagnols, anglais et arabes ; villes de vos commandes passées) ;
  - dates : « jeudi », « demain », « 20/11 », « 20 novembre », « Nov 20 », « el 19/11 », « le 21 » — rangées en chargement ou livraison selon les mots autour ;
  - palettes, poids (kg ou tonnes, « 18.500 kg »), température (« 2 à 6 °C », « -1/+2 ºC », « +4°C »), prix et devise (€, EUR, MAD, dh), référence du client (PO, réf., order no), marchandise ;
  - le client, par son e-mail, son domaine (pas les messageries publiques), son numéro ou son nom ; client inconnu : création proposée avec ses coordonnées.
- Chaque champ lu est montré **avec l'extrait du message** d'où il vient, en tête du formulaire ; ce qui manque est listé ; **doublon possible** signalé ; plusieurs montants : à choisir.
- **Demande de prix** (« votre meilleur prix ? », « quote », « ¿precio? ») : la commande est créée **« à chiffrer »** ; nouveau filtre « À chiffrer » sur la page Commandes. Le message d'origine est gardé dans les notes.
- La commande a maintenant sa **consigne de température**, reprise par « Planifier » dans le voyage.

## 4.6.0 — Un seul dossier par voyage, avec un aller et un retour

- **« Planifier » sur une commande** crée son voyage pré-rempli : client, villes, dates, prix, équipe, CMR, référence client, frais de route ; retour au dépôt estimé (livraison + 4 jours) ; traversées créées. Fini la double saisie.
- **Le retour chargé est une seconde commande sur le même voyage** : son client, son prix, son CMR, sa facture. Sur la fiche du voyage, bloc « Chargement de retour » : nouvelle commande de retour pré-remplie (chargement à la destination de l'aller, livraison au départ, même équipe), ou commande existante ; prix plancher affiché tant qu'il n'y a pas de retour. Sur la page Commandes : « En retour » charge une commande au retour d'un voyage (ceux qui livrent près du chargement d'abord).
- **Un seul suivi** : les étapes du voyage font avancer ses deux commandes (chargée, en transit, en douane, livrée), datées comme le voyage, et l'équipe suit ; une commande liée renvoie à son voyage.
- **La recette du voyage = aller + retour** ; rentabilité et compte de résultat répartis chez chaque client (coûts au kilomètre chargé, sinon au prix), corridor du retour à part, un seul voyage compté par camion ; prévision de trésorerie avec la facture de chaque client.
- **Pas de double facture** : une commande facturée par son voyage (ou l'inverse) ne peut plus l'être deux fois ; la facture de l'aller ne facture pas le retour ; « Facturer le retour » à son propre client.
- Sans perte de données : les voyages et commandes existants gardent leurs liens ; aucun changement de format.

## 4.5.1 — Passages douane port par port

- **Vue Tanger Med et vue Algeciras** sur la page Passages douane : pour chaque port, toutes les étapes (sortie et entrée), le nombre de camions qui attendent chacune (touchez un camion pour son fil), **votre temps habituel** par étape et au port (médiane de vos passages des 90 derniers jours, inspections physiques écartées), le repère d'alerte, les passages terminés des 7 derniers jours, les alertes du port.
- Un camion qui a embarqué apparaît « en traversée » côté Algeciras (ou Tanger Med au retour) ; les rappels « à préparer » se rangent dans le port concerné (CHED et ENS : Algeciras ; DUM import : Tanger Med).

## 4.5.0 — Centre des passages en douane

- **Page « Passages douane »** : un centre de notifications pour chaque étape du passage à Tanger Med et Algeciras, aller et retour.
  - **Au port maintenant** : chaque camion en cours de passage, depuis combien de temps, la dernière étape faite, les étapes non notées, et **ce qui doit se passer ensuite** (étape, qui agit, documents à présenter, délai habituel) ; « Étape suivante faite » en un geste.
  - **Fil** : chaque étape faite avec **ce qu'elle veut dire** (ex. DUM déposée : la marchandise est sous contrôle douanier ; PCF : partie II du CHED, le dédouanement peut se terminer ; EES : chaque jour Schengen est compté) et la suite réelle ; filtres Alertes, À préparer, Étapes faites ; par voyage.
  - **Alertes** : attente anormale avant l'étape suivante (repères réglables, puis alerte urgente au double) avec un conseil par étape ; inspection physique au scanner ; référence non notée (DUM, TIR/T1, MRN, CHED).
  - **À préparer avant d'arriver** : CHED dans TRACES au moins un jour ouvrable avant Algeciras (frais), déclaration d'entrée ENS (ICS2), déclaration d'export UE au retour, DUM import pour Tanger Med.
- **Notifications automatiques** selon un routage réglable (Réglages → Rappels → Notifications des passages) : fil de l'application, exploitation, direction, transitaire ; au chauffeur, la prochaine étape et ses documents. « Notifier » à la main sur chaque événement. Bloc « Passages douane » sur l'accueil.
- Étapes précisées d'après les sources officielles : passage portuaire dématérialisé et résultat du scanner transmis à BADR (Tanger Med), CHED et horaires du PCF d'Algeciras (ministère espagnol de l'Agriculture), EES en service complet depuis le 10/04/2026, ENS avant l'arrivée.

## 4.4.1 — Papiers cliquables et disponibilités sur la page Chauffeurs

- **Papiers cliquables** sur les pages Chauffeurs et Camions : toucher les pastilles ouvre le détail — pourquoi rouge (expiré, obligatoire pour rouler ou non), orange (expire bientôt) ou vert, papiers sans date — et « Mettre à jour les dates » ouvre la fiche.
- **Disponibilités des 14 prochains jours** en tête de la page Chauffeurs (7 sur téléphone) : en voyage, absent, papiers expirés, libre ; nombre de libres par jour ; toucher une case ouvre le voyage, l'absence, le détail des papiers ou planifie ; « Déclarer une absence » et « Planning complet ».

## 4.4.0 — Accès limités par service

- **Accès par service** (mode multi-utilisateur, page réservée au chef d'entreprise) : pour chaque rôle — exploitant, répartiteur, commercial, comptable, chauffeur, transitaire — et chaque groupe de données (voyages, commandes, factures, clients, flotte, charges, douane, réglages), choisir *défaut*, *aucun accès*, *lecture sans prix*, *lecture*, *modification sans prix*, *modification*, *tout sans prix* ou *tout*. **Appliqué par le serveur** : sans prix, les prix, coûts et marges ne sont pas envoyés ; sans accès, les données ne quittent pas le serveur et la page disparaît du menu ; un accès accordé fait apparaître la page.
- Effet **immédiat** sur les appareils connectés (mise à jour en direct, sans reconnexion), changement inscrit au **Journal**, « Tout remettre par défaut ». Le chef d'entreprise garde toujours tous les droits ; un chauffeur ou un transitaire ne voit toujours que *ses* voyages et dossiers ; les réglages restent lisibles par tous (l'application en a besoin).
- **Appareil seul** (sans relais) : Réglages → Appareil → « Pages de chaque service » — cocher les pages et l'affichage des prix de chaque profil (exploitation, commercial, comptabilité), toujours protégé par le code du poste.
- Relais : route `GET/PUT /api/droits` (chef), réglage conservé dans `comptes.json` (chiffré au repos si activé).

## 4.3.0 — Prix du jour (taux EUR → MAD, gazole) et papiers expliqués

- **Taux EUR → MAD du jour** : cours de référence de **Bank Al-Maghrib**, récupéré par le relais (repli : open.er-api.com, indiqué « indicatif »). Appliqué seul toutes les 6 heures ; un voyage **terminé ou facturé garde le taux de son jour** (ses marges ne bougent plus) ; les voyages en cours suivent le taux du jour.
- **Gazole aux prix réels du jour** : Maroc = médiane de ce que vous avez payé (pleins et cartes carburant des 14 derniers jours, utilisée pour les calculs de trajets) ; Espagne = prix officiels du ministère (médiane nationale, Cadix, Algeciras) ; France = prix officiels prix-carburants (stations avec piste poids lourds, Pyrénées-Orientales). Carte « Prix du jour » sur la page Gasoil et dans les Réglages, avec ce que vous avez payé à côté.
- **Carburant d'un voyage prévu estimé au prix du jour** (kilomètres × consommation du camion × prix Maroc et Europe) tant qu'aucune dépense réelle n'est arrivée ; la carte carburant garde désormais les litres et le pays de chaque plein.
- **Papiers expliqués** : sur le planning, une case rouge « papiers » montre chaque document (expiré depuis quand, bientôt, manquant, valable ; bloquant ou non) et ouvre la fiche pour saisir la nouvelle date.
- Relais : route `GET /api/marches` (cache de 6 h ; une source en panne n'efface pas les autres).

## 4.2.0 — Passage des ports étape par étape, chaque voyage relié à sa facture

- **Passage des ports** sur chaque voyage — aller : Tanger Med (parc de régulation, PortNet et DUM, douane, contrôle sanitaire export pour le frais, scanner, police, droits de port, embarquement) puis Algeciras (débarquement, police des frontières et EES, douane espagnole, poste de contrôle sanitaire pour le frais, sortie du port) ; retour : Algeciras (douane de sortie, police, embarquement) puis Tanger Med (débarquement, police, scanner, DUM import, contrôles, mainlevée). Pour chaque étape : ce qui s'y passe, les documents à présenter, la référence à noter (DUM, TIR/T1, MRN, CHED…), l'heure, le temps passé au port.
- « Fait » sur une étape pose aussi l'étape du voyage (attentes mesurées, arrivée estimée, notifications), la traversée effectuée, le passage au scanner (hors médiane), la sortie d'Algeciras et le **séjour Schengen** du chauffeur (ouvert à la police d'Algeciras, fermé au retour). Les étapes posées par le GPS comptent comme faites. Références reprises dans le dossier du voyage. Étapes de départ à confirmer avec votre transitaire (`data.js`, `PORTS_PASSAGE`).
- **Chaque voyage fait est relié à une facture** : état sur la fiche (facture, montant, payée / à encaisser / en retard), « Facturer ce voyage » en un geste (numéro, échéance du client, désignation détaillée avec CMR), « Ajouter à une facture » existante du même client, voyages à facturer en tête de la page Factures, **alerte** dès le lendemain (urgente après 7 jours). Une facture supprimée remet ses voyages « à facturer » ; la trésorerie ne compte plus deux fois un voyage facturé.

## 4.1.0 — Planning des chauffeurs et des camions

- **Page Planning** : disponibilités jour par jour (14 jours, 7 sur téléphone) — en voyage, congé, maladie, formation, repos, entretien, panne, visite technique, papiers expirés (permis, carte conducteur, visite médicale ; assurance et visite technique du camion), libre. Nombre de libres par jour, jours Schengen restants de chaque chauffeur, semaine suivante ou précédente, impression.
- **Une case libre** crée un voyage qui part ce jour (chauffeur et son camion préremplis) ou déclare une absence ; une case occupée ouvre le voyage ou l'absence.
- **Qui est libre du … au …** : les libres d'abord (les plus de jours Schengen en tête), et pourquoi les autres ne le sont pas.
- **Conflits signalés** dans les contrôles et les alertes : chauffeur ou camion sur deux voyages en même temps, voyage pendant une absence ou une immobilisation.
- **Formulaire de voyage** : chaque chauffeur et chaque camion affiche sa disponibilité pour les dates du voyage, les libres en premier.
- **Dupliquer un voyage** : même trajet, client, prix et équipe, même durée, à une nouvelle date ; étapes, dépenses et réservations remises à zéro.
- **Programme du chauffeur** sur WhatsApp en un geste (voyages, traversée et réservation, absences des 7 prochains jours).
- 6 nouveaux tests (171 application, 27 relais).

## 4.0.0 — 12/11/2026 — la vérité de l'argent, la direction, les deux bureaux

Treize livrables, dans l'ordre de la valeur (décisions : `docs/11-decisions-v4.md`). **192 tests** (165 application, 27 relais ; 116 au départ), moins de 20 s. Documentation : `docs/05` à `docs/10`.

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

### D8 — Conseils d'exploitation
- **Prix plancher du fret de retour** d'un voyage livré sans retour : « en dessous de X €, cet aller-retour perd de l'argent ».
- **Camion à l'arrêt** depuis plus de 24 h : ses corridors les plus rentables sont proposés.
- **Traversée à réserver**, **chauffeur qui ne peut pas légalement faire le voyage** (heures de conduite, carte conducteur, Schengen), **repos hebdomadaire hors cabine** à prévoir avec son coût.

### D10 — Deux accueils, actions directes, historique
- Page **Opérations** : une carte par camion (état, voyage, prochaine étape, arrivée estimée, alertes, marge en direct, bureau responsable).
- **Accueil de l'exploitant** (profil Exploitation) : conseils et flotte d'abord ; **accueil du chef d'entreprise** (profil Direction) : résultat, trésorerie, anomalies.
- Chaque alerte est **à un geste de l'action** : appeler ou écrire au chauffeur sur WhatsApp, écrire au client, ouvrir le voyage.
- Chaque dépense se modifie, porte la photo de son reçu, et tout changement d'un voyage (étape, statut, prix, dates, dépense) est consigné dans son **historique** avec l'auteur, l'avant et l'après.
- La recherche (⌘K) trouve aussi les voyages, les dépenses et les échéances. Non fait : recherche dans le texte des photos (elle exigerait un service payant).

### D12 — Arrivée estimée calée sur vos attentes réelles aux ports
- Chaque passage à **Tanger Med (export)**, **Algeciras (entrée)** et **Tanger Med (import)** est mesuré de l'entrée à la sortie, d'après les étapes posées par le GPS (ou saisies). Les mesures sont partagées entre les bureaux par la synchronisation.
- **Attente attendue** par port, heure, jour et saison : médiane, P75, P90, avec repli progressif tant que les mesures manquent, puis estimation générique. Passages au scanner hors médiane ; à Algeciras, marchandises fraîches et autres jamais mélangées ; une valeur imposée passe avant tout.
- L'**arrivée estimée** utilise ces attentes, prend l'attente réelle dès qu'un port est franchi, et affiche sa **fourchette**, qui se resserre à chaque port. La carte du camion dit « au port depuis…, sortie attendue vers… ».
- Un décalage de plus de 30 minutes (réglable) est signalé ; un créneau promis qui ne sera plus tenu l'est en urgence.
- **Lien client** : même moteur côté relais, fourchette et mention « calée sur les attentes mesurées » ou « estimation », en quatre langues.
- Non fait : arrivée estimée d'un voyage seulement prévu (sans position GPS) ; message « retard probable » envoyé automatiquement au client (il viendra avec les notifications par étape).

### D11 — Notifications par étape
- **Routage par étape** (11 étapes) : qui est prévenu (exploitation Maroc et Allemagne, direction, commercial, comptabilité, transitaire, client, chauffeur), par quel canal (fil de l'application, ntfy, e-mail, WhatsApp, canaux du relais), automatiquement ou par le bouton **« Notifier »** de chaque étape, avec le texte modifiable avant l'envoi.
- **Messages en français, anglais, espagnol et arabe**, choisis selon la langue de chaque destinataire ; éditeur avec aperçu en direct.
- **Rappels programmés** : veille du départ à 18 h, présentation au port, embarquement, livraison (chauffeur), facture à émettre 24 h après la livraison. Ils suivent le voyage (un départ décalé décale ses rappels) et partent du relais à l'heure, **même application fermée** ; panneau « Notifications » pour les annuler ou les reporter.
- **Client** : prévenu seulement s'il l'a accepté (fiche client : accord, canal préféré, langue). WhatsApp avec repli sur l'e-mail.
- **Relais 1.6.0** : plan exécuté chaque minute et conservé après redémarrage, envoi d'e-mails par SMTP sans dépendance, serveurs ntfy autorisés, doublons entre bureaux écartés. Sans relais : ntfy part de l'application, WhatsApp, e-mail et SMS s'ouvrent prêts à envoyer.
- Schéma 8 (migration sans perte). Non fait : pièces jointes PDF (le message contient le lien de suivi) ; réglage SMTP depuis l'application (le relais ne lit pas les données synchronisées : il se règle par ses variables).

### D9 — Deux bureaux, relais durci, RGPD
- **Relais 1.7.0 — chiffrement au repos** (`CHIFFRER_DONNEES=true`) : positions, partages, alertes, notifications, journal d'accès et photos chiffrés sur le disque (AES-256-GCM, clé tirée d'une phrase secrète par scrypt), écritures atomiques, passage au chiffrement sans perte, démarrage sans plantage avec une mauvaise clé.
- **Historique des alertes** (7 jours) : un appareil qui revient en ligne affiche les alertes manquées.
- **Journal d'accès** (option) et **purge des photos** après 18 mois avec délai de grâce de 30 jours et journal ; script `serveur/purge-photos.js`.
- **Arabe** étendu aux écrans de direction, d'opérations, de rentabilité, de dépenses et de notifications (testé : chaque libellé fixe a sa traduction) ; un libellé suivi d'un compte se traduit aussi.
- `docs/07-rgpd-deploiement.md` : durées de conservation, trois couches de chiffrement, LUKS, textes applicables (RGPD, BetrVG, loi 09-08, clauses contractuelles types), notice chauffeur en français, arabe et allemand.
- Correction : sans dates précisées, la liste des notifications programmées du relais était vide.

### D13 — Multi-utilisateur : un navigateur suffit, des droits réels
- **Relais 2.0.0** (`MULTI_UTILISATEUR=true`) : l'application est servie par le relais ; chacun se connecte avec son compte, sans installation ni mot de passe de synchronisation. Premier démarrage protégé par le jeton du relais, import des données de l'appareil ou d'une sauvegarde, clé de récupération.
- **Sept rôles** (chef d'entreprise, exploitant, répartiteur sans prix ni marges, commercial, comptable, chauffeur, transitaire) ; **droits appliqués par le serveur à chaque appel** (`comptes.js`, même fichier pour l'application et le relais) : un rôle ne reçoit jamais ce qu'il ne doit pas voir et ne peut ni modifier ni effacer les prix qu'il ne voit pas.
- **Connexion** : mots de passe scrypt, sessions opaques 12 h renouvelées 30 jours avec rotation et détection de vol, cookies HttpOnly/SameSite, **double authentification TOTP** (obligatoire pour le chef), blocage après 5 échecs, alerte sur réseau inhabituel, mot de passe oublié par e-mail.
- **Modifications concurrentes** : versions et 409 avec l'état actuel ; fusionner, garder sa version ou prendre la sienne. Verrous de 30 s sur la livraison, l'encaissement, la suppression (« X modifie »). Suppression douce.
- **Temps réel** (SSE, moins d'une seconde) et rattrapage après une coupure ; tableau des opérations avec les camions de son bureau mis en avant.
- **Journal** de chaque écriture (avant/après), des connexions, refus et conflits, 24 mois, page de consultation et export CSV ; page **Utilisateurs** (création, rôle, bureau, clôture, réouverture, réinitialisation).
- Corrections trouvées en route : l'assistant de démarrage ne s'ouvre plus par-dessus l'écran de connexion ; les journaux chiffrés ligne à ligne restaient lisibles après un redémarrage mais pas deux (corrigé, testé).
- Écarts assumés : pas de SQLite ni d'Argon2id (zéro dépendance) ; jetons opaques au lieu de JWT ; réseau inhabituel au lieu du pays ; clé de récupération dédiée au lieu du mot de passe de synchronisation (voir docs/10).

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
