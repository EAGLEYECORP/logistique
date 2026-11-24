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

**Vérifier** : `npm test` (234 tests application, 40 relais, environ 20 s). Puis un passage réel dans Chromium avec Playwright (préinstallé ; servir l'application par `python3 -m http.server 8765`), **téléphone 390 px et bureau 1280 px**, zéro erreur de console, pas de défilement horizontal, une capture regardée. Les scripts d'essai vont dans le dossier temporaire de la session, pas dans le dépôt.

## 3. Revue : valeur réalisée et valeur non réalisée (revue du 23/11/2026, v5.19)

L'exploitant vit dans sa boîte e-mail et WhatsApp, l'itinéraire en Europe, le GPS, le téléphone avec le transitaire et le chauffeur, les prix et les marges, la facturation. Les écarts de la première revue sont tous traités (boîte des demandes, itinéraire poids lourd, coupure planifiée et alertes au chauffeur, meilleur créneau au port et bateau réservé, lien transitaire, lien de dépôt et relance J-2, quais par le GPS, facture et preuve en PDF, glisser pour confirmer, dictée, ticket photographié, résumé client). Ce qui reste se range en quatre familles :

- **A. Bâti, pas encore branché** (réglages de l'entreprise, aucun code) — le plus gros levier ; depuis la v5.20, l'écran **Mise en service** (Réglages → Général) en fait la liste, point par point ;
- **B. Se construit avec l'usage** (mesures et apprentissages qui s'accumulent) ;
- **C. À bâtir** (code, classé plus bas) ;
- **D. Hors de portée à zéro dollar ou sans interface publique**.

| Geste quotidien | Valeur réalisée aujourd'hui | Valeur non réalisée |
|---|---|---|
| **Relever les demandes** | Boîte des demandes relevée par le relais toutes les 5 min, demande lue (villes, dates, palettes, °C, prix), en commande ou en devis d'un geste ; partage depuis WhatsApp | A : `IMAP_…` sur le relais. **C : les pièces jointes** (bon de commande PDF, facture, colisage) restent dans la messagerie : ni lues, ni rangées sur la commande. D : pas d'API gratuite pour lire WhatsApp (le partage reste manuel) |
| **Chiffrer, répondre** | Prix conseillé, devis PDF, kilomètres poids lourd par pays, péages par pays, créneau au port dans le devis | A : **clé openrouteservice** sur le relais (`ITINERAIRE_CLE`, usage interne non commercial retenu) — sans elle, distances à vol d'oiseau × 1,25. Péages hors France : estimation au kilomètre jusqu'au relevé du télépéage |
| **Itinéraire en Europe** | Itinéraire `driving-hgv` (tronçons, détroit à part), liens Google Maps, interdictions de circuler, consigne de plein par pays | A : même clé. D : trafic en temps réel (pas d'API gratuite) |
| **Conduite, coupures** | Pause et fin de journée planifiées, aires poids lourds, message au chauffeur et alerte au bureau **par le relais jour et nuit**, compteurs jour/semaine, lecture des cartes `.ddd` | A : relais 2.1 ou plus ; sujet ntfy ou téléphone de chaque chauffeur ; balise rattachée à chaque camion. D : estimation GPS — le tachygraphe à distance demande un boîtier payant |
| **Port et bateau** | Attentes mesurées par port, jour et heure ; meilleur créneau ; heure limite d'entrée pour le bateau réservé, comparée à l'arrivée estimée ; référence de réservation au chauffeur | B : une dizaine de passages mesurés par port avant le conseil, plus pour une heure limite fine. D : horaires des armateurs saisis à la main (pas d'API publique). **C (petit) : heure du Maroc fixe à UTC+1** — décalage d'une heure pendant le ramadan |
| **Douane** | Étapes expliquées, documents, alertes, lien transitaire sans compte | Adoption : le transitaire doit utiliser son lien. D : BADR et PortNet sans interface publique |
| **Documents du client** | Liste par commande, lien de dépôt, relance J-2 par le relais sans redemander ce qui est arrivé | A : accord du client (fiche). La relance ne part que pour une liste tenue (un document coché, une demande ou un lien). **C : documents reçus par e-mail** non rangés seuls (lié aux pièces jointes) |
| **Suivi client** | Lien de suivi avec arrivée estimée, notifications aux étapes, résumé de la semaine (ponctualité, attentes, documents) | A : accord et « résumé de sa semaine » cochés par client ; heure promise saisie sur les voyages (sinon pas de ponctualité) |
| **Livraison, attente au quai** | Preuve signée en PDF (dictée des réserves), envoyée depuis le téléphone ; arrivée et départ aux quais par le GPS (relais) ; attente facturée | B : sites des clients appris au fil des livraisons. A : tarif d'attente par client. D : valeur juridique de l'e-CMR non confirmée au Maroc et en Espagne |
| **Facturer, encaisser** | Facture PDF, envoi par le relais avec preuve et photos, relances programmées, attente ajoutée seule | A : `SMTP_…` sur le relais. **C : encaissement à la main** — pas d'import du relevé bancaire pour lettrer les factures payées et tenir la trésorerie à jour |
| **Dépenses** | Relevé de carte carburant, Jawaz Pro, ticket photographié rangé seul, amendes, per diem et froid calculés | D : montant du ticket tapé (lecture automatique : service payant, ou l'assistant IA facultatif avec la clé de l'utilisateur) ; relevés importés en fichier (pas d'API) |
| **Pilotage** | Marge par voyage, client et corridor, direction, trésorerie, anomalies, prévisions | A : coûts fixes par camion, charges générales, taux — la marge ne vaut que ce qu'on y met |

### À bâtir, par ordre de valeur

1. ~~**Écran « Mise en service »**~~ — **livré en v5.20** : Réglages → Général, en tête (et un bandeau sur le tableau de bord tant que tout n'est pas prêt). Chaque point branché ou manquant, ce qu'il débloque, et le bouton qui ouvre la fiche à compléter (`mise_en_service.js`, `mise_en_service_ui.js`). La famille A est devenue une liste de choses à faire dans l'application.
2. **Pièces jointes des demandes** : le relais garde les pièces jointes (PDF, images) comme pour le lien de dépôt ; l'application les range sur la commande et coche le document reconnu par son nom (facture, colisage, phyto).
3. **Rapprochement bancaire** : import du relevé (CSV ou Excel de la banque), montants et références rapprochés des factures ouvertes, payées à la bonne date ; le reste à pointer.
4. **Heure du Maroc réelle** (`Africa/Casablanca`) pour les ports, les rappels et les heures limites, au lieu d'UTC+1 fixe.

### Vérifié

Le 23/11/2026 : 272 essais (232 application, 40 relais) ; les 18 essais de bout en bout récents (s51 à s68 : boîte des demandes, liens, itinéraire, coupures, créneau, registre, boutons de toutes les pages, PDF, quais, mode chauffeur, veille du relais, relances, résumé, dictée, tickets, bateau) ; clavier ; budget de rendu à 500 voyages (toutes les pages sous 0,55 s sur téléphone ralenti ×4) ; 108 captures de référence identiques. Les anciens essais (s1 à s50, écrits pour les versions 2 à 4) : 34 passent, 19 visent des écrans refaits depuis (navigation v5.0, fiche à onglets v5.1, glisser pour confirmer v5.10, demande de prix en devis v4.11) ou des fichiers d'entrée disparus ; leurs fonctions sont couvertes par les essais récents, les essais unitaires, ou vérifiées à part (facturer le retour, carte d'opérations). Sur téléphone, la dictée et le partage de la preuve : vérifiés par l'exploitant.

### Dette technique et risques à traiter

- **Enveloppes empilées** : remplacées en v5.7.0 par un registre de crochets (`app.js`) : `surAction(pages, actes, fn)` (la dernière inscrite d'abord ; `PASSER` laisse la main), `autourAction(pages, actes, fn, { ordre })` (verrou 20, annulation 10, suites d'une action 50-70), `blocPage(page, { position, ordre, rendu })`, `avantSauver(nom, fn, ordre)` / `apresSauver(nom, fn, ordre)` (`sauver({ local, sansNotif })`), `enregistrerBlocVoyage` pour la fiche. Il ne reste plus aucune enveloppe d'`agir` ni de `sauver`. Restent, volontairement, des transformations : `rendu` de Commandes (synthèse des devis), Réglages (profil) et Chauffeur (blocs insérés), `rendu` des notifications sur l'accueil, `afficher` (profils, historique), `carteMission` (plein, quais, coupures), `champsVoyage`, `blocRetour`, `chiffrerCommande`, `actions` de quelques pages.
- **Tout l'état dans localStorage** : réglé en v5.7.0 — stockage rapide tant que les données tiennent (≈ 4,5 millions de caractères), puis passage automatique dans la base de l'appareil (IndexedDB, magasin `etat`, clé `courant`) sans perte : la base est écrite d'abord, le drapeau `logistique-stockage = base` ensuite, le stockage rapide vidé en dernier ; instantanés quotidiens conservés.
- **Performance avec un gros historique** : réglée en v5.11.0 (calculs gardés le temps d'un affichage, voyages terminés par pages de 30) ; budget vérifié par un essai permanent.
- **Poids au démarrage** : mesuré en v5.12.0 — environ 1,4 Mo de code non minifié (≈ 520 Ko compressés) ; ouverture habituelle depuis la copie du téléphone ≈ 0,2 s (téléphone moyen), première visite en 4G lente ≈ 3,9 s. Le découpage par page rapporterait peu : presque chaque module nourrit les autres ou s'inscrit sur l'accueil et la fiche du voyage (analyse des dépendances faite). Fait : la carte (Leaflet) se charge à la demande ; le module IA n'est plus préchargé ; **mises à jour par empreintes** (`serveur/empreintes.js`, posé par `.github/workflows/pages.yml` et par le relais multi) : un fichier inchangé est repris de la copie hors ligne précédente, les autres sont revalidés (`cache: "no-cache"`) et vérifiés (SHA-256) avant d'être étiquetés `x-empreinte`. (L'ETag de GitHub Pages suit l'heure de publication : la revalidation ne sert qu'au sein d'une même publication, c'est-à-dire à la première visite ; d'une version à l'autre, ce sont les empreintes qui évitent les téléchargements.) Tout nouveau script de `index.html` doit entrer dans `FICHIERS` de `sw.js` (essai permanent).
- **Heure du Maroc** : UTC+1 fixe dans toute l'application (`prevision.js`, `dateHeureMaroc`, `creneaux.js` fuseau « maroc ») ; le Maroc passe à UTC+0 pendant le ramadan : décalage d'une heure ce mois-là (voir « À bâtir », 4).
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

### Phase C — le mode chauffeur (livrée en v5.10.0)
Gros boutons, **glisser pour confirmer** les étapes (pas de clic accidentel dans la poche), indicateur hors ligne permanent, vibration à l'enregistrement, consigne de plein et prochaine coupure en tête, arabe soigné.

### Phase D — contrôles visuels et performance (livrée en v5.11.0)
Captures de référence de chaque page (téléphone, bureau, clair, sombre) comparées à chaque livraison ; budget de rendu avec 500 voyages ; contraste et clavier.
- **Captures** : `node tests/captures.js --url <application servie>` — 27 pages × téléphone/bureau × clair/sombre, mode chauffeur compris ; données fixes (`tests/donnees-captures.js`), heure figée, aucun appel extérieur ; références dans `tests/captures/` (non versionné : propres à la machine) ; `--accepter` les remplace ; `--contre https://eagleyecorp.github.io/logistique/` compare à la version publiée sans rien garder. Les écarts (capture et pixels changés en rouge) vont dans `tests/captures/ecarts/`.
- **Rendu** : `avecMemo(fn)` / `memoCalcul(genre, clé, f)` (`noyau.js`) gardent un calcul le temps d'un affichage seulement (`afficher` l'enveloppe) : `coutVoyage`, `margeVoyage`, `voyagesDuMois`, l'index facture ↔ voyage. Hors affichage, rien n'est gardé (l'état peut changer). Essai permanent : 500 voyages, un calcul de coût par voyage et par affichage, mêmes résultats qu'à froid. Mesure sur navigateur (téléphone, processeur ×4) : toutes les pages sous 0,9 s.
- **Contraste** : jetons `--primary-plein`, `--ok-plein`, `--danger-plein` pour les fonds pleins sous du texte blanc ; `--primary`, `--ok`, `--danger`… pour les textes. Essai permanent : 4,5:1 au moins pour chaque texte et chaque pastille sur chaque fond, thèmes clair et sombre, et aucun texte blanc sur un jeton de texte.
- **Clavier** : tout élément `[data-act]` qui n'est pas un bouton devient atteignable (tabulation, Entrée/Espace) ; grille du planning à tabulation unique et flèches.

## 5. Finir l'application pour le quotidien — ordre conseillé

Chaque élément : logique pure testée, interface, passage réel sur téléphone, CHANGELOG, version, commit, publication vérifiée.

1. **Boîte des demandes** (livrée en v5.2.0 : `boite.js`, `boite_ui.js`, `serveur/imap.js`, `serveur/mime.js`) : le relais lit la boîte e-mail (IMAP sans dépendance, réglage `IMAP_*` comme `SMTP_*`), lit chaque message avec `lireDemande`, l'application les montre à trier (créer la commande, répondre par un devis, ignorer) ; plus le **partage depuis WhatsApp** vers l'application (manifeste `share_target`).
2. (livré en v5.3.0 : `liens.js`, `liens_ui.js`, `serveur/liens.js`, `serveur/page-lien.js`) **Lien de dépôt des documents** pour le client et **lien transitaire** pour les étapes de douane, servis par le relais, sans compte, expirables, comme le lien de suivi.
3. (livré en v5.4.0 : `itineraire.js`, `itineraire_ui.js`, `serveur/itineraire.js` ; service public d'openrouteservice à n'utiliser que si ses conditions le permettent, sinon serveur propre) **Itinéraire poids lourd** par le relais (openrouteservice ou équivalent gratuit, conditions vérifiées) : kilomètres et durée par pays réutilisés partout ; liens Mappy et Google Maps par tronçon.
4. (livré en v5.5.0 : `coupures.js`, `coupures_ui.js` ; envoyées par le relais seul, jour et nuit, depuis v5.14.0 : `serveur/veille.js`, `veille_relais.js`, `veille_relais_ui.js` — l'application confie la liste à surveiller (`PUT /api/veille`), le relais calcule avec `coupures.js` et `quais_gps.js` chargés par `serveur/moteur.js`, prévient le chauffeur, alerte le bureau si la pause est dépassée, relève les quais ; l'application reprend les passages et ne double pas les messages) **Coupure planifiée** et alertes au chauffeur : prochaine pause et parkings poids lourds possibles, compteurs jour, semaine, deux semaines.
5. (livré en v5.6.0 : `creneaux.js`, `creneaux_ui.js`) **Meilleur créneau au port** d'après l'historique des attentes, au planning et au devis.
6. **Refonte de la fiche du voyage** (phase B) — à mener en parallèle dès le début : c'est elle que l'exploitant ouvre cinquante fois par jour.
7. (livré en v5.7.0) **Registre de crochets** à la place des enveloppes, puis **état dans IndexedDB**.
8. (facture en PDF livrée en v5.8.0 : `pdf.js`, `facture_pdf.js` ; preuve de livraison en PDF livrée en v5.13.0 : `preuve_pdf.js` (page web jointe en plus seulement pour les écritures non latines) ; arrivée au quai par le GPS livrée en v5.9.0 : `quais_gps.js` ; mode chauffeur phase C livré en v5.10.0 : `chauffeur_ui.js`) **Facture en PDF**, arrivée au quai par géorepérage du client, mode chauffeur (phase C).

## 6. Texte à donner au nouveau modèle

> Tu reprends « Logistique Fret », application hors ligne d'un transporteur marocain Maroc ⇄ Europe, dépôt EAGLEYECORP/logistique, branche `ccr-9838cb49-guapr6`, publiée sur https://eagleyecorp.github.io/logistique/. Lis d'abord `docs/13-passation-fable.md` en entier, puis `README.md` et `CHANGELOG.md`. Respecte les règles de la section 1 (zéro dirham, hors ligne, sans compilation, aucune perte de données, français et arabe, tests). Commence par la **phase B, la fiche du voyage** : étudie sur Mobbin, Refero ou Pageflows comment les applications de fret et de livraison publiées présentent une fiche d'expédition (et demande-moi des captures si tu n'y as pas accès), propose-moi la direction en quelques lignes avec une maquette, puis construis-la sans casser une seule fonction. Ensuite, suis l'ordre de la section 5 pour que l'application me serve au quotidien : la boîte des demandes, les liens de dépôt pour les clients et le transitaire, l'itinéraire poids lourd, la coupure planifiée. Pour chaque livraison : tests verts, essai réel sur téléphone et bureau, CHANGELOG, commit en français, publication vérifiée, et un résumé simple de ce qui change pour moi.
