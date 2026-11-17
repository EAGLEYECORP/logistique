# Passation — revue de valeur, design haut de gamme, finir l'application

Document de passation pour le modèle qui reprend le projet (Claude Fable 5.2). Il dit **ce qui existe**, **ce qui manque à un exploitant marocain qui fait Maroc ⇄ Europe au quotidien**, **comment travailler dans ce code** et **quoi construire ensuite**, design compris. État au 16/11/2026, version 5.0.0.

---

## 1. Règles non négociables

- **Zéro dirham** : aucune API ou service payant obligatoire. Une option payante peut être proposée, jamais imposée, et toujours signalée.
- **Hors ligne d'abord, sans compilation** : JavaScript « vanilla », scripts classiques qui partagent la portée globale, pas de framework, pas de bundler. Le relais (`serveur/`) est en Node sans aucune dépendance.
- **Aucune perte de données** : toute évolution du format garde les données existantes (migrations dans `noyau.js`, `VERSION_SCHEMA`).
- **Français** dans l'interface et les messages de commit ; chaque libellé fixe a sa traduction arabe dans `langue.js` (un test l'exige).
- **Vie privée** : jamais l'e-mail, le nom ou les données de l'utilisateur dans des requêtes vers des services tiers.
- **Branche** `ccr-9838cb49-guapr6` : on y commit et on y pousse (`git push -u origin ccr-9838cb49-guapr6`, nouvel essai en cas d'erreur réseau). Pas de pull request sans demande. GitHub Pages publie chaque push (`.github/workflows/pages.yml`) : vérifier en ligne que `sw.js` porte le nouveau commit.
- **Messages de commit** en français, terminés par les lignes d'attribution demandées dans la session.
- **Ne jamais présenter une estimation comme une vérité** : chaque chiffre estimé dit d'où il vient et ce qui lui manque (voir `devis.js`, `plein.js`).

## 2. Carte du code

| Couche | Fichiers | Rôle |
|---|---|---|
| Cœur, état, migrations | `noyau.js`, `data.js` | état `S` (localStorage), paramètres `PARAMS_DEFAUT`, coûts du voyage, alertes |
| Logique pure, testée | `aller_retour.js`, `lecture_commande.js`, `documents_commande.js`, `quais.js`, `fret_retour.js`, `devis.js`, `plein.js`, `relances.js`, `passages.js`, `ports_gps.js`, `portuaire.js`, `planning.js`, `prixjour.js`, `prevision.js`, `gps.js`, `conformite.js`, `pilotage.js`, `rentabilite.js`, `tresorerie.js`, `couts.js`, `comptes.js`… | règles métier sans DOM, chargées par `tests/noyau.test.js` dans une machine virtuelle Node |
| Interface | `app.js` (navigation en six `SECTIONS`, helpers `btn`, `modale`, `formulaire`, `toast`, `vide`…), `*_ui.js`, `voyages.js`, `commercial.js`, `chauffeur.js`… | chaque page = `VUES.<id> = { titre, sous, actions(), rendu(), apres(), agir(act, id), soumettre(fid, v) }` |
| Relais | `serveur/relais.js`, `multi.js`, `auth.js`, `courriel.js`, `marches.js`, `coffre.js` | positions GPS, lien client, notifications programmées, e-mail avec pièces jointes, prix du jour, multi-utilisateur, chiffrement au repos |
| Hébergement | `serveur/installer.sh`, `demarrer-windows.cmd`, `Dockerfile`, `docs/12-heberger-le-relais.md` | installation gratuite du relais |

**Ajouter une fonction** : logique pure dans un nouveau fichier `x.js` (testée), interface dans `x_ui.js` qui **enveloppe** l'existant (`const avant = VUES.voyages.agir; VUES.voyages.agir = async function (act, id, b) { … return avant.call(this, act, id, b); }`). Ajouter chaque fichier : à `index.html` (ordre : les purs après `noyau.js`, les interfaces après ce qu'elles enveloppent), à la liste de précache de `sw.js`, à la liste de chargement de `tests/noyau.test.js` (purs) et à la liste du test « arabe » (interfaces). Les clics dans une fenêtre (`dialog`) ne passent pas par le gestionnaire des pages : écouter `document` pour ces boutons (voir `fret_retour_ui.js`).

**Vérifier** : `npm test` (206 tests application, 31 relais, environ 15 s). Puis un passage réel dans Chromium avec Playwright (préinstallé ; servir l'application par `python3 -m http.server 8765`), **téléphone 390 px et bureau 1280 px**, zéro erreur de console, pas de défilement horizontal, une capture regardée. Les scripts d'essai vont dans le dossier temporaire de la session, pas dans le dépôt.

## 3. Revue : la valeur aujourd'hui et ce qui manque, geste par geste

L'exploitant vit dans : sa boîte e-mail et WhatsApp (commandes, documents), **Mappy** une fois en Europe (itinéraire, durée, péages), la plateforme GPS (où est le camion, depuis combien de temps il roule, quand faire la coupure), le téléphone avec le transitaire et le chauffeur (où en est la douane, combien d'attente au port), Excel (prix, marges) et la facturation.

| Geste quotidien | Ce que l'application fait déjà | Ce qui manque (valeur non réalisée) |
|---|---|---|
| **Relever les e-mails, trouver les nouvelles commandes** | « Coller un message » : lecture sur l'appareil (villes, dates, palettes, °C, prix, client), demande de prix → devis ; pastille documents | **La boîte n'est pas lue toute seule.** Le relais pourrait lire la boîte de l'entreprise (IMAP, mot de passe d'application, sans dépendance) toutes les 5 minutes et remplir une **« Boîte des demandes »** déjà lues, à transformer en commande d'un geste. **WhatsApp** : pas d'API gratuite pour lire, mais le **partage vers l'application** (« share target » du manifeste) permettrait d'envoyer un message WhatsApp dans l'app depuis le menu Partager d'Android. |
| **Chiffrer, répondre vite** | Prix conseillé (historique ou estimation), devis PDF, taux de devis gagnés | Distances **à vol d'oiseau × 1,25** : pas de vrai itinéraire poids lourd, donc péages Europe et durée approximatifs. |
| **Itinéraire en Europe (Mappy)** | Grille ADM au Maroc, liaisons VINCI en France, interdictions de circuler par pays, lien Google Maps (voiture) en mode chauffeur | **Pas d'itinéraire poids lourd.** Mappy n'a pas d'API ouverte. Un itinéraire HGV gratuit existe (openrouteservice, profil `driving-hgv`, clé gratuite avec quotas : conditions à vérifier), appelé par le relais (clé côté serveur) : vrais kilomètres et durée par pays, à réutiliser dans le devis, la consigne de plein, l'arrivée estimée et le planning. Liens « Ouvrir dans Mappy / Google Maps » par tronçon. |
| **Temps de conduite, coupure** | Alerte en direct à 4 h 15 et 4 h 30 de conduite continue (estimation GPS), conduite du jour, analyse des fichiers du tachygraphe (.ddd) et infractions, faisabilité légale au planning, repos hebdomadaire | **La coupure n'est pas planifiée à l'avance** : « pause à prévoir vers 14 h 20, 30 km avant Valence, parkings poids lourds possibles : … » (parkings : données OpenStreetMap `hgv=yes` via Overpass, gratuites, usage raisonnable). **L'alerte ne part pas au chauffeur** (seulement la carte du bureau) : ntfy ou WhatsApp au chauffeur. Compteurs 9 h/10 h du jour, 56 h de la semaine et 90 h sur deux semaines, en combinant GPS et tachygraphe. |
| **Attente au port** | Attentes mesurées (médiane, P75, P90) par port, heure, jour et saison ; centre des passages, camions au port maintenant, attentes anormales ; étapes apprises par le GPS | **Le meilleur créneau n'est pas proposé** : d'après l'historique, quelle heure d'arrivée à Tanger Med donne la plus courte attente, à afficher au planning et au devis. Horaires des traversées et référence de réservation non reliés. |
| **Étapes de douane** | Chaque étape expliquée, ce qui suit, documents, alertes, CHED/ENS à préparer, rôle transitaire | **Le transitaire ne saisit pas lui-même** dans la pratique : un lien simple (sans compte) pour qu'il marque « DUM déposée », « bon à embarquer » et joigne la DUM, comme le lien de suivi client. |
| **Documents du client** | Liste par commande selon le sens et la marchandise, demande des manquants dans la langue du client | **Le client ne peut pas déposer ses documents** : un **lien de dépôt** par commande (relais, sans compte) où il envoie facture, colisage, phyto ; la pastille passe au vert seule. **Relance automatique** des documents manquants à J-2. |
| **Suivi client** | Lien de suivi, notifications aux étapes, arrivée estimée calée sur vos attentes réelles | Rien de majeur ; un résumé hebdomadaire par client (ponctualité, attentes, documents en retard) servirait la relation commerciale. |
| **Livraison, attente au quai** | Preuve de livraison signée, attente au quai mesurée et facturée | Détection automatique de l'arrivée au quai par le GPS (géorepérage du client) au lieu du bouton. |
| **Facturer, encaisser** | Facture en un geste, envoyée avec CMR et preuve, relances programmées | Facture en **vrai PDF** (aujourd'hui une page web jointe). |
| **Saisie au fil de l'eau** | Carte carburant (CSV), Jawaz, photos, mode chauffeur | Le chauffeur doit taper peu : **glisser pour confirmer** une étape, saisie vocale des réserves, photo du ticket rattachée seule. |

### Dette technique et risques à traiter

- **Enveloppes empilées** : remplacées en v5.7.0 par un registre de crochets (`app.js`) : `surAction(pages, actes, fn)` (la dernière inscrite d'abord ; `PASSER` laisse la main), `autourAction(pages, actes, fn, { ordre })` (verrou 20, annulation 10, suites d'une action 50-70), `blocPage(page, { position, ordre, rendu })`, `avantSauver(nom, fn, ordre)` / `apresSauver(nom, fn, ordre)` (`sauver({ local, sansNotif })`), `enregistrerBlocVoyage` pour la fiche. Il ne reste plus aucune enveloppe d'`agir` ni de `sauver`. Restent, volontairement, des transformations : `rendu` de Commandes (synthèse des devis), Réglages (profil) et Chauffeur (blocs insérés), `rendu` des notifications sur l'accueil, `afficher` (profils, historique), `carteMission` (plein, quais, coupures), `champsVoyage`, `blocRetour`, `chiffrerCommande`, `actions` de quelques pages.
- **Tout l'état dans localStorage** : réglé en v5.7.0 — stockage rapide tant que les données tiennent (≈ 4,5 millions de caractères), puis passage automatique dans la base de l'appareil (IndexedDB, magasin `etat`, clé `courant`) sans perte : la base est écrite d'abord, le drapeau `logistique-stockage = base` ensuite, le stockage rapide vidé en dernier ; instantanés quotidiens conservés.
- **Poids au démarrage** : environ 1,4 Mo de JavaScript, CSS et HTML non minifiés, chargés d'un coup. Charger à la demande les pages rarement ouvertes.
- **Fiche du voyage** : refaite en v5.1.0 (frise, prochaine action, quatre onglets, contenu calculé à l'ouverture). Un nouveau bloc s'inscrit avec `enregistrerBlocVoyage({ onglet, ordre, rendu })` au lieu d'envelopper une fonction.

## 4. Design haut de gamme : direction et méthode

**Ce qui est fait (phase A, v5.0.0)** : six sections et onglets de section, polices embarquées (General Sans pour les titres, Noto Sans Arabic, texte en police système), jetons de couleur (clair et sombre) et d'espacement, « Annuler » dans les messages, écrans vides avec action, cartes qui ne débordent plus.

**Méthode** : avant chaque écran, étudier comment des applications **réellement publiées** résolvent le même problème — Mobbin (mobbin.com), Refero (refero.design), Pageflows (pageflows.com) pour les parcours complets, Spotted in Prod (spottedinprod.com) pour les interactions iOS. Reprendre des **principes**, jamais l'apparence d'une application précise. Si ces sites demandent un compte ou sont bloqués par le réseau de la session, demander à l'utilisateur d'envoyer 5 à 10 captures.

Parcours à étudier, dans cet ordre :
1. **Fiche d'expédition** (applications de fret, de livraison, de suivi de colis) : en-tête avec la frise d'étapes, « prochaine action », onglets.
2. **Application chauffeur / livreur** : une main, gros boutons, glisser pour confirmer, état hors ligne.
3. **Boîte de réception et tri** (messagerie, support client) : pour la « Boîte des demandes ».
4. **Tableau de bord d'opérations** (gestion de flotte) : densité, états lisibles d'un coup d'œil.
5. **Liste de factures et relances** (outils de facturation).

**Principes à tenir** : une action principale par écran ; l'état se lit par la forme (pastille, frise, couleur sémantique), pas seulement par le texte ; 70 % de texte gris en moins (explications derrière un « ? ») ; formulaires courts avec « Plus de détails » ; sur téléphone, feuilles qui montent du bas ; chiffres alignés (`tabular-nums`) ; contraste suffisant dans les deux thèmes ; arabe de droite à gauche vérifié à chaque écran.

### Phase B — la fiche du voyage (livrée en v5.1.0)
- **En-tête fixe** : référence, client, chauffeur, camion, et la **frise** aller → Tanger Med → Algeciras → livraison → retour → dépôt, l'étape en cours mise en avant.
- **Carte « prochaine action »** : une seule chose à faire maintenant, un seul bouton (marquer l'étape suivante, réserver la traversée, demander les documents, facturer…), calculée d'après l'état du voyage.
- **Quatre onglets** : **Suivi** (frise, ports, attentes, carte), **Documents** (client, CMR, preuve, photos, dossier), **Argent** (prix aller + retour, coûts, marge, facture, attente au quai, plein), **Équipe** (chauffeur, camion, papiers, Schengen, contrôles avant départ). Chaque onglet n'est dessiné qu'à l'ouverture.
- Critères : la fiche ouverte tient sur un écran de téléphone sans défiler jusqu'à la prochaine action ; toutes les fonctions actuelles restent accessibles ; aucun test ne casse.

### Phase C — le mode chauffeur
Gros boutons, **glisser pour confirmer** les étapes (pas de clic accidentel dans la poche), indicateur hors ligne permanent, vibration à l'enregistrement, consigne de plein et prochaine coupure en tête, arabe soigné.

### Phase D — contrôles visuels et performance
Captures de référence de chaque page (téléphone, bureau, clair, sombre) comparées à chaque livraison ; budget de rendu avec 500 voyages ; contraste et clavier.

## 5. Finir l'application pour le quotidien — ordre conseillé

Chaque élément : logique pure testée, interface, passage réel sur téléphone, CHANGELOG, version, commit, publication vérifiée.

1. **Boîte des demandes** (livrée en v5.2.0 : `boite.js`, `boite_ui.js`, `serveur/imap.js`, `serveur/mime.js`) : le relais lit la boîte e-mail (IMAP sans dépendance, réglage `IMAP_*` comme `SMTP_*`), lit chaque message avec `lireDemande`, l'application les montre à trier (créer la commande, répondre par un devis, ignorer) ; plus le **partage depuis WhatsApp** vers l'application (manifeste `share_target`).
2. (livré en v5.3.0 : `liens.js`, `liens_ui.js`, `serveur/liens.js`, `serveur/page-lien.js`) **Lien de dépôt des documents** pour le client et **lien transitaire** pour les étapes de douane, servis par le relais, sans compte, expirables, comme le lien de suivi.
3. (livré en v5.4.0 : `itineraire.js`, `itineraire_ui.js`, `serveur/itineraire.js` ; service public d'openrouteservice à n'utiliser que si ses conditions le permettent, sinon serveur propre) **Itinéraire poids lourd** par le relais (openrouteservice ou équivalent gratuit, conditions vérifiées) : kilomètres et durée par pays réutilisés partout ; liens Mappy et Google Maps par tronçon.
4. (livré en v5.5.0 : `coupures.js`, `coupures_ui.js` ; alertes envoyées tant que l'application est ouverte — les faire envoyer par le relais seul reste à faire) **Coupure planifiée** et alertes au chauffeur : prochaine pause et parkings poids lourds possibles, compteurs jour, semaine, deux semaines.
5. (livré en v5.6.0 : `creneaux.js`, `creneaux_ui.js`) **Meilleur créneau au port** d'après l'historique des attentes, au planning et au devis.
6. **Refonte de la fiche du voyage** (phase B) — à mener en parallèle dès le début : c'est elle que l'exploitant ouvre cinquante fois par jour.
7. (livré en v5.7.0) **Registre de crochets** à la place des enveloppes, puis **état dans IndexedDB**.
8. (facture en PDF livrée en v5.8.0 : `pdf.js`, `facture_pdf.js` ; la preuve de livraison est encore jointe en page web ; arrivée au quai par le GPS livrée en v5.9.0 : `quais_gps.js` ; mode chauffeur phase C livré en v5.10.0 : `chauffeur_ui.js`) **Facture en PDF**, arrivée au quai par géorepérage du client, mode chauffeur (phase C).

## 6. Texte à donner au nouveau modèle

> Tu reprends « Logistique Fret », application hors ligne d'un transporteur marocain Maroc ⇄ Europe, dépôt EAGLEYECORP/logistique, branche `ccr-9838cb49-guapr6`, publiée sur https://eagleyecorp.github.io/logistique/. Lis d'abord `docs/13-passation-fable.md` en entier, puis `README.md` et `CHANGELOG.md`. Respecte les règles de la section 1 (zéro dirham, hors ligne, sans compilation, aucune perte de données, français et arabe, tests). Commence par la **phase B, la fiche du voyage** : étudie sur Mobbin, Refero ou Pageflows comment les applications de fret et de livraison publiées présentent une fiche d'expédition (et demande-moi des captures si tu n'y as pas accès), propose-moi la direction en quelques lignes avec une maquette, puis construis-la sans casser une seule fonction. Ensuite, suis l'ordre de la section 5 pour que l'application me serve au quotidien : la boîte des demandes, les liens de dépôt pour les clients et le transitaire, l'itinéraire poids lourd, la coupure planifiée. Pour chaque livraison : tests verts, essai réel sur téléphone et bureau, CHANGELOG, commit en français, publication vérifiée, et un résumé simple de ce qui change pour moi.
