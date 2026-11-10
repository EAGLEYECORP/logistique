# Mise en service : ce qui dépend de vous, et comment le vérifier

Tout ce qui pouvait être construit et testé sans compte externe est livré (voir [`CHANGELOG.md`](../CHANGELOG.md)). Les points ci-dessous demandent **un compte, un fichier réel ou une information qu'il n'était pas possible d'obtenir ici** : chacun a un test en un clic ou une vérification précise. Cochez-les dans l'ordre.

## 1. Hébergement du relais (suivi en direct, lien client, alertes, synchronisation)
- [ ] Démarrer le relais en https ([`serveur/README.md`](../serveur/README.md) : proxy Caddy, tunnel, conteneur ou Termux).
- [ ] Application → Suivi en direct → Réglages de la source → **Tester la connexion** (« Relais joignable »).
- [ ] Brancher les balises (directement, ou par Traccar) et vérifier qu'un camion apparaît sur la carte.

## 2. Alertes automatiques (Telegram, WhatsApp, ntfy, webhook)
- [ ] Renseigner les variables d'environnement du canal choisi (tableau dans `serveur/README.md`).
- [ ] Application → Suivi en direct → Réglages de la source → **Tester les canaux d'alerte** : le message d'essai arrive sur chaque canal, ou le résultat indique **lequel échoue et pourquoi** (jeton refusé, modèle non approuvé, numéro non autorisé…).
- [ ] WhatsApp : compte Meta Business, numéro, jeton ; hors fenêtre de 24 h, un modèle de message approuvé (`WHATSAPP_MODELE`). Commencez par un seul destinataire. *L'intégration suit la documentation de l'API mais n'a pas pu être essayée avec un compte réel.*

## 3. Fichier de carte conducteur (.ddd)
- [ ] Page Tachygraphe → choisir le fichier `.ddd` de **carte conducteur** (pas un fichier de véhicule). Ouvrir « Détails de la lecture du fichier » : nombre de jours, plage de dates, nombre de changements d'activité. Vérifier avec le logiciel de votre fournisseur que les jours et les temps de conduite correspondent.
- [ ] Si la lecture échoue ou diffère, copiez le **diagnostic** (il ne contient ni nom ni numéro de carte) dans votre message : le format sera corrigé. *Le lecteur suit la spécification européenne mais n'a pas pu être essayé sur un fichier réel.*

## 4. Péages
- [ ] **Autoroutes du Maroc** : comparer un trajet connu avec votre relevé Jawaz Pro (importer le CSV : page Traces GPS, section Péages). Si les colonnes ne sont pas reconnues, désignez-les une fois.
- [ ] **Gares** : relever les gares sur une trace réelle (Péages Maroc → Gares) ou importer le fichier OpenStreetMap.
- [ ] **France** : choisir la liaison VINCI dans la fiche voyage (tarifs officiels du 1er février 2026). Pour APRR, Sanef et les autres réseaux : relevé de télépéage.
- [ ] **Espagne, Italie et autres pays** : importer le relevé de télépéage de votre fournisseur (fiche voyage → « Relevé péages Europe »), ou saisir le tarif moyen de votre concessionnaire (Réglages → Péages d'Europe). Aucun tarif officiel au kilomètre n'a été trouvé ; la plupart des autoroutes espagnoles du trajet usuel sont gratuites.

## 5. Points juridiques et réglementaires à confirmer
- [ ] **CNDP** : déclaration du traitement de géolocalisation, information des salariés (délibération 17-2014).
- [ ] **e-CMR** : demander au ministère marocain des Transports ou consulter le [dépositaire ONU](https://treaties.un.org) si le Maroc est partie au protocole additionnel. En attendant, conserver le CMR papier signé ; l'application imprime un CMR préparé et une preuve de livraison, qui ne sont pas des e-CMR.
- [ ] **Interdictions de circuler** et **quotas d'autorisations** : vérifier chaque année auprès des autorités (valeurs de départ).

## 6. Éléments qui n'existent pas publiquement
- API **Jawaz Pro** et **EETS** : à demander à ADM et à votre fournisseur de télépéage ; les relevés CSV les remplacent d'ici là.
- **Téléchargement à distance du tachygraphe** : à demander à votre fournisseur de balises ou de tachygraphe ; l'application lit les fichiers qu'il fournit.
