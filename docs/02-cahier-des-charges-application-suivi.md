# Cahier des charges — Application de suivi d'activité pour transporteur marocain (Maroc ⇄ Europe)

> Document de spécification fonctionnelle, version 1.0 (10/11/2026). Il s'appuie sur l'audit [`01-audit-voyage-maroc-europe.md`](01-audit-voyage-maroc-europe.md). Légende : ✅ confirmé · 🔶 à vérifier · ❓ inconnu. Les numéros de section de l'audit sont cités entre crochets, par exemple [audit §6.1].

---

## 1. Objet et principes

**But** : suivre de bout en bout l'activité d'une flotte de camions qui part du Maroc vers l'Europe et en revient, avec des **balises GPS déjà installées**, et répondre à quatre questions à tout instant :

1. **Où est chaque camion, et dans quelle étape du voyage ?**
2. **Est-il en règle** (chauffeur, véhicule, autorisation, douane, temps de conduite) **et que risque-t-il d'expirer ?**
3. **Combien ce voyage coûte-t-il et rapporte-t-il** (péages, traversée, gasoil, frais, retour à vide) ?
4. **Que doit faire le bureau aujourd'hui** (alertes classées par urgence) ?

**Principes directeurs**

| # | Principe | Raison |
|---|---|---|
| P1 | **Le Voyage est l'entité centrale** (aller + retour, plusieurs étapes), pas la commande ni le camion. | Un voyage Maroc–Europe dure des jours à des semaines, enchaîne plusieurs acteurs et peut revenir à vide [audit §3-4]. |
| P2 | **Les jalons se déduisent des positions GPS** (géorepérage des ports, douanes, frontières, clients) ; la saisie manuelle n'est qu'un repli. | Le chauffeur n'a pas à saisir ; la donnée est horodatée et incontestable. |
| P3 | **Fonctionner sans réseau** : mer, tunnels, zones blanches, roaming coupé. Aucune fausse alerte « camion perdu » pendant une traversée. | Le détroit ≈ 1 h 30 sans couverture fiable [audit §3 phase 4]. |
| P4 | **Tout est horodaté en UTC**, affiché à l'heure locale du lieu. | Maroc UTC+1 (UTC+0 pendant le ramadan) contre CET/CEST en Espagne et en France. |
| P5 | **Toute règle chiffrée est une donnée versionnée par date d'effet** (tarifs ADM, ferries, plafonds de poids, limites de conduite). | Les grilles changent (péage Kénitra Nord–Tanger Med 179 → 182 MAD entre 2024 et 2026) [audit §6.1]. |
| P6 | **Chaque chiffre affiché a une source et une confiance** (officiel, estimé, saisi). | Évite de présenter une estimation comme un fait. |
| P7 | **Données personnelles minimales** pour la géolocalisation des chauffeurs (déclaration CNDP, information des salariés). | Délibération CNDP 17-2014 ✅ [audit §5.3]. |
| P8 | **Français d'abord, arabe (RTL) ensuite, WhatsApp comme canal d'alerte.** | Usage réel des équipes et des chauffeurs. |

---

## 2. Acteurs et rôles

| Rôle | Besoins principaux | Accès |
|---|---|---|
| **Dirigeant** | Marge par voyage et par client, taux de retour à vide, conformité globale | Tout, tableaux de bord |
| **Exploitation / dispatch** | Planifier, affecter camion + chauffeur, suivre en direct, traiter les alertes | Voyages, carte, alertes |
| **Déclarant en douane / transitaire** | Dossiers, DUM, TIR, EUR.1, statut des contrôles | Documents et douane |
| **Comptabilité** | Frais, péages Jawaz Pro, traversées, facturation | Coûts, factures |
| **Atelier / parc** | Papiers du véhicule, entretien, tachygraphe | Camions |
| **Chauffeur** | Sa mission, ses documents, ses étapes, ses pleins, ses photos, l'itinéraire | Mode chauffeur (PIN) |
| **Client** *(lecture seule)* | Position approximative, ETA, preuve de livraison | Lien de suivi partagé |

---

## 3. Modèle de données

### 3.1 Entités

| Entité | Champs clés |
|---|---|
| **Voyage** | id, client(s), camion, remorque, chauffeur(s), type (export/import/transit/triangulaire), origine, destination, `sens_retour_prevu` (charge de retour oui/non), statut, dates prévues/réelles, itinéraire retenu (route Espagne–France ou maritime longue Sète), budget, coûts réels |
| **Tronçon (leg)** | voyage, ordre, mode (route / mer), de → à, distance, durée prévue, péages prévus |
| **Étape / jalon** | voyage, type, lieu, heure prévue, heure réelle, source (GPS auto / manuel / import), preuve (photo, document) |
| **Document** | type (CMR, DUM, TIR, EUR.1, facture, packing list, certificat sanitaire, ATP…), numéro, dates, pièces jointes, statut (à fournir / reçu / validé / expiré), voyage ou dossier lié |
| **Autorisation bilatérale** | type (« E » Espagne, « MA » Maroc, au voyage ≤ 3 mois ou à temps annuelle), numéro, **transporteur titulaire**, validité, voyages utilisés, **compte-rendu de voyage** à remettre [audit §2.1] |
| **Carnet TIR** | numéro, titulaire, validité, nombre de volets, **sceau** (numéro, apposé/rompu), garant (🔶 ADII ou AFMTV) |
| **Chauffeur** | permis, FIMO/FCO 🔶, carte conducteur, passeport, **visa** (type, dates, entrées), **compteur Schengen 90/180**, aptitude médicale, historique de voyages |
| **Camion / remorque** | immatriculation, **essieux, hauteur, PTAC → classe ADM déduite**, assurance, visite technique, carte verte, tachygraphe (étalonnage), **Pass Jawaz lié**, balise GPS (IMEI, SIM), frigorifique (groupe, capteurs) |
| **Position GPS** | appareil, horodatage UTC, lat/lon, vitesse, cap, précision, contact, kilométrage, **capteurs** (carburant, température, porte, CAN), source |
| **Événement** | type (entrée/sortie zone, arrêt prolongé, excès de vitesse, ouverture porte, rupture de sceau, panne, accident), position, heure, gravité |
| **Temps de conduite** | chauffeur, période, conduite continue, journalière, hebdomadaire, repos pris, source (tachygraphe distant, GPS déduit, manuel) |
| **Péage** | pays, section ou portique, classe, montant, devise, heure, source (grille ADM, Jawaz Pro, EETS, ticket) |
| **Frais** | catégorie (carburant, traversée, péage, hébergement, per diem, amende, réparation, douane, parking), montant, devise, taux de change, preuve (photo) |
| **Traversée** | armateur, ligne, date, **mètres linéaires**, tarif de base, BAF, ETS, autres surcharges, passage chauffeur, frigorifique, référence de réservation [audit §6.5] |
| **Incident / réclamation** | type (retard, avarie, vol, contrôle, amende), voyage, description, photos, montant, assurance, statut |
| **Amende** | pays, motif, montant, paiement sur place ou différé, chauffeur, voyage |
| **Alerte** | règle, gravité, cible, première détection, dernier envoi, accusé de réception, résolution |

### 3.2 Exemple de voyage (JSON)

```json
{
  "id": "V-2026-0412",
  "camion": "A-12345-B",
  "remorque": "R-6789",
  "chauffeur": "C-017",
  "client": "CL-088",
  "type": "export",
  "itineraire": "route-espagne-france",
  "retour": { "charge_prevue": false, "origine_retour": "Valence" },
  "troncons": [
    { "ordre": 1, "mode": "route", "de": "Agadir", "a": "Tanger Med", "peages_prevus_mad": 601, "classe_adm": 3 },
    { "ordre": 2, "mode": "mer", "de": "Tanger Med", "a": "Algeciras", "metres_lineaires": 16.5 },
    { "ordre": 3, "mode": "route", "de": "Algeciras", "a": "Perpignan" }
  ],
  "jalons": [
    { "type": "depart_depot", "heure_utc": "2026-11-12T05:10:00Z", "source": "gps" },
    { "type": "entree_port_tanger_med", "heure_utc": null, "source": null }
  ],
  "documents": [
    { "type": "CMR", "statut": "recu" },
    { "type": "DUM_export", "statut": "a_fournir" },
    { "type": "autorisation_E", "numero": "E-…", "statut": "validee" }
  ]
}
```

---

## 4. Modules fonctionnels

### M1 — Planification du voyage

- Création d'un voyage avec **assistant** : client, marchandise (code SH, poids, volume, température), origine, destination, date de chargement.
- **Choix d'itinéraire comparé** : route Espagne–France (péages, carburant, temps de conduite, hébergement, autorisation, visa) **contre** traversée longue Sète ⇄ Tanger Med (≈ 3 790 € ensemble de 16,5 m chargé + chauffeur) [audit §6.5], avec **coût total et délai** pour chaque option.
- **Contrôle d'éligibilité avant départ** (bloquant ou avertissement) : autorisation disponible (type, quota, validité), visa et compteur Schengen suffisants pour la durée prévue, papiers du camion valides **jusqu'à la date de retour**, tachygraphe étalonné, charge et essieux **au plus petit plafond** des pays traversés [audit §5.4], gabarit, ADR/ATP si concerné.
- **Besoin de retour** : si aucune charge de retour n'est trouvée, calculer le **coût du retour à vide** et proposer des solutions (bourse de fret, partenaire européen, maritime).
- **Génération du dossier** : ordre de transport, check-list de documents par tronçon [annexe B], compte-rendu de voyage pré-rempli.

### M2 — Suivi en direct

- **Carte de la flotte** : tous les camions, couleur par statut (en route, à l'arrêt, au port, en douane, en traversée, à l'arrêt non planifié, hors ligne).
- **Fiche camion** : voyage, chauffeur, vitesse, dernier contact, étape actuelle, **ETA**, temps de conduite restant, alertes ouvertes.
- **Historique de trace** par voyage (rejeu), distance, temps d'arrêt par lieu, vitesse moyenne.
- **ETA** : durée restante basée sur la vitesse moyenne des camions poids lourds sur le tronçon + repos obligatoires restants (et non sur les temps voiture).
- **États dérivés** : *en traversée* quand le camion est dans la zone du port puis qu'il disparaît entre les deux rives ; il **n'est pas « perdu »**.
- **Hors ligne** : les balises stockent et retransmettent (store-and-forward) ; l'écran affiche « dernière position connue il y a X », jamais une alerte tant que la zone ou l'heure explique l'absence.

### M3 — Jalons automatiques par géorepérage

Zones à définir (rayon ou polygone) pour chaque lieu clé ; **le franchissement produit un jalon horodaté sans saisie** :

| Zone | Jalon produit | Utilité |
|---|---|---|
| Dépôt, entrepôt client, quai | départ / arrivée / début-fin de chargement | Durée de chargement, détention (surestaries) |
| Autoroutes du Maroc : gares de péage | passage, rapprochement avec Jawaz Pro | Contrôle des péages [audit §6.1] |
| **Port de Tanger Med** : entrée, zone TIR, zone de contrôle, embarquement | files d'attente, durée douane, embarquement | Mesurer l'attente (zone TIR ≈ 140 camions/h) [audit §3 phases 3-4] |
| Port d'Algeciras / Tarifa / Sète / Barcelone… | débarquement, sortie | Fin de traversée, point de contrôle Algeciras |
| Frontières (Espagne–France, Schengen) | passage | Compteur Schengen, restrictions nationales |
| Aires de repos, parkings sécurisés | stationnement long | Preuve de repos hebdomadaire hors cabine [audit §5.1] |
| Centres de contrôle sanitaire (SIVEP, PIF) | présentation, libération | Produits frais |
| Zones à risque (vol, migrants) | entrée, arrêt | Alerte sécurité |

**Données de zones** : les coordonnées des gares ADM ne sont pas publiées par ADM ❓ ; on les construit depuis **OpenStreetMap** puis on les valide avec les traces GPS réelles.

### M4 — Conformité chauffeur

- **Temps de conduite et de repos** (règlement CE 561/2006, AETR hors UE 🔶) : conduite continue 4 h 30, conduite journalière 9 h (10 h deux fois par semaine), hebdomadaire 56 h, bi-hebdomadaire 90 h, repos journalier 11 h (réduit 9 h), repos hebdomadaire 45 h (réduit 24 h) à compenser, **repos hebdomadaire normal interdit en cabine** (amendes de 1 000 à 3 000 € selon les pays) ✅ [audit §5.1-5.2].
- **Source** : décodage à distance de la carte conducteur et du tachygraphe (téléchargement à distance tous les 28 jours pour le véhicule et 90 jours pour la carte 🔶), à défaut estimation par GPS (contact, vitesse), à défaut saisie.
- **Compteur Schengen 90/180** par chauffeur : jours consommés, jours restants, date de sortie recommandée, **EES** (enregistrement biométrique à l'entrée et à la sortie) ✅ [audit §2.2].
- **Visa** : type, dates, nombre d'entrées, alerte à J-45, J-15 ; dossier consulaire en préparation (pièces à réunir).
- **Autres documents** : permis, carte conducteur, FIMO/FCO 🔶, aptitude médicale, passeport (validité > 6 mois au retour).

### M5 — Conformité véhicule et autorisations

- Alertes d'expiration : assurance, **carte verte**, visite technique, étalonnage du tachygraphe, certificat ATP (frigorifique), ADR, **autorisation bilatérale** [audit §3 phase 0].
- **Registre des autorisations « E » et « MA »** : stock, consommation par voyage, validité (au voyage ≤ 3 mois / à temps), **comptes-rendus de voyage manquants**, projection d'épuisement selon le rythme, **suivi de l'échange annuel de novembre** [audit §2.1].
- **Carnet TIR** : volets utilisés, sceau, **clôture au retour** (décharge), litiges.
- **Poids et gabarit** : fiche technique du camion, plafonds Maroc / UE (40 t, 44 t transport combiné, 16,50 m, 2,55 m, 4,00 m) ✅ [audit §5.4].

### M6 — Douane et documents

- **Dossier par voyage et par frontière** : DUM (BADR), PortNet, EUR.1 / certificat d'origine, TIR, T1 🔶, CMR, facture, liste de colisage, certificats (ATP, phytosanitaire, sanitaire, TRACES/CHED 🔶 pour les produits frais) [audit §3 phases 1-2, 5].
- **Statuts** : à fournir → reçu → déposé → validé / rejeté / contrôlé ; photos des pièces ; **mémoire des rejets** (motif).
- **Délais** : alerte si dépôt non fait à J-1, si dédouanement dépasse un seuil, si le camion attend plus de X heures au port.
- **Assistant IA codes SH** (déjà dans l'application actuelle) pour préparer la classification.

### M7 — Coûts, péages et marges

**Coût du voyage** = péages Maroc + péages Europe + traversée + carburant + hébergement + per diem + frais de douane + amendes + autres, comparé au prix de vente.

- **Moteur de péages ADM (Maroc)** [audit §6.1] : charge la grille officielle (584 sections, 3 classes, [`data/adm-grille-2026-11.csv`](data/adm-grille-2026-11.csv)) ; la **classe est déduite** du camion (essieux, hauteur) ; le trajet est une **somme de sections** le long du réseau, donc il faut un **graphe** (gares et jonctions). Cas de test de référence en classe 3 : **Casablanca → Tanger Med = 253 MAD**, **Casablanca → Agadir = 348**, **Agadir → Tanger Med = 601**.
- **Rapprochement Jawaz Pro** : importer ou saisir les passages facturés, les comparer aux passages GPS aux gares → **passage manquant, tag sur un autre véhicule (fraude), double facturation**. L'existence d'une API ou d'un export reste à obtenir auprès d'ADM ❓.
- **Péages Europe** : Espagne, France, Italie, Allemagne (≈ 0,35 €/km hors CO₂ inclus 🔶), Autriche, Suisse, Pays-Bas (taxe kilométrique 2026) 🔶 ; **EETS** (télépéage européen) comme source de passages réels.
- **Traversées** : modèle mètres linéaires × tarif + BAF + ETS + surcharges + passage chauffeur + frigorifique, avec **historique de tarifs par armateur** [audit §6.5].
- **Carburant** : consommation plein à plein (déjà présente), **comparaison avec les capteurs CAN/jauge** ; prix du gasoil par pays ; alerte vol/fuite.
- **Frais de route** : per diem, hébergement, parking, réparations, amendes ; saisie par le chauffeur avec photo.
- **Marge** par voyage, par client, par ligne, par camion, par chauffeur ; **comparatif prévu / réel**.
- **Multidevise** : MAD / EUR, taux de change du jour de la dépense.

### M8 — Retour à vide et charges de retour

- KPI central : **% de kilomètres à vide**, coût du retour à vide, jours d'attente de fret.
- Fiche « disponibilité retour » : lieu, date, gabarit, température, restrictions.
- Rapprochement avec les fournisseurs de fret de retour (bourses, partenaires) — saisie ou import ; pas d'intégration supposée.
- Simulation « accepter un fret moins cher plutôt que rentrer à vide ».

### M9 — Incidents, sécurité, litiges

- **Bouton d'alerte chauffeur**, procédure en cas de panne, accident, vol, intrusion de migrants (contrôle de remorque, photos, rapport), contrôle routier, amende.
- **Alertes automatiques** : arrêt prolongé hors zone prévue, déviation d'itinéraire, ouverture de porte hors zone, rupture de sceau, immobilisation en zone à risque.
- **Dossier d'incident** : photos géolocalisées, horodatage, déclaration d'assurance, réclamation CMR (réserves, délais).
- **Registre des amendes** par chauffeur et par pays.

### M10 — Partage client, preuve de livraison

- **Lien de suivi** (lecture seule, limité dans le temps) : étape, position approximative, ETA, sans coordonnées précises au-delà d'un seuil.
- **Preuve de livraison** : photo, signature, géolocalisation, CMR signé ; **e-CMR** 🔶 comme cible (statut au Maroc et en Espagne à vérifier).
- **Notifications client** : départ, passage de frontière, retard probable, livraison.

### M11 — Chaîne du froid (si frigorifique)

- Température par capteur (consigne, alarme hors plage), historique pour la preuve, alertes porte ouverte / groupe arrêté, **carburant du groupe**, export du relevé pour le client.
- Les produits frais sont sensibles aux files d'attente du port et aux contrôles sanitaires d'Algeciras [audit §3 phase 5].

### M12 — Alertes et notifications

- **Catalogue de règles** [annexe D] : document qui expire, repos manquant, temps de conduite, retard, attente anormale, coût hors budget, passage Jawaz non facturé, etc.
- **Canaux** : notification de l'application, **WhatsApp** et SMS (indispensables pour les chauffeurs), e-mail ; **accusé de réception** et escalade si non traité.
- **Dédoublonnage** (urgent chaque jour, à surveiller tous les 3 jours) comme dans l'application actuelle.

### M13 — Rapports et indicateurs

Tableaux de bord : voyages en cours, ponctualité, durée moyenne par phase (douane, attente, traversée), **marge par voyage / client / ligne**, **taux de retour à vide**, coût au kilomètre, consommation, infractions de conduite, délais de remboursement des frais, taux de saturation des autorisations. Export CSV/Excel et PDF.

---

## 5. Exigences GPS et télématique

| Sujet | Exigence |
|---|---|
| **Fréquence d'envoi** | 30 s en mouvement, 5 min à l'arrêt, immédiat sur événement (ouverture de porte, SOS). |
| **Protocoles** | Accepter les protocoles courants (**Teltonika, Queclink, Concox/GT06, Ruptela…**) 🔶 ; interface HTTP/MQTT ou plateforme de télématique. |
| **Capteurs** | Contact, vitesse, odomètre CAN, niveau de carburant, température (frigo), porte, **identification du chauffeur** (iButton / RFID), tachygraphe (téléchargement à distance), sceau électronique si disponible. |
| **Connectivité** | Carte SIM **multi-opérateurs ou eSIM** avec itinérance Maroc ↔ UE (tarifs, politique de « fair use », coupure d'itinérance) ; **arrêt des réseaux 2G/3G** à anticiper (matériel 4G/LTE-M). |
| **Hors couverture** | Mémoire tampon (≥ 72 h), envoi différé, horodatage de la position, **pas d'alerte hors ligne en mer ou zone blanche connue**. |
| **Remorque** | Si la remorque change (semi-remorque non accompagnée, traversée sans tracteur), **appairer tracteur ↔ remorque** par événement ; **balise propre à la remorque** conseillée pour la remorque non accompagnée (le tracteur reste au Maroc). |
| **Horodatage** | Tout en UTC ; affichage en heure locale du lieu ; gérer le **ramadan (Maroc UTC+0)** et le **changement d'heure européen**. |
| **Qualité** | Filtrage des positions aberrantes (sauts, précision > 100 m), lissage de la trace, correction par réseau routier (map-matching). |
| **Sécurité** | Chiffrement en transit, authentification des balises, **journal d'accès**, conservation limitée. |

---

## 6. Navigation et Mappy

**Constat** [audit §1.9] : Mappy est utilisé par les chauffeurs en Europe. Son API propose un **mode poids lourds qui adapte prix et temps** et affiche le **coût carburant + péages** ✅, **mais ne gère pas les restrictions de circulation** (hauteur, poids, interdictions) ✅ ; **la couverture hors France n'est pas précisée** ❓.

| Usage | Recommandation |
|---|---|
| **Navigation du chauffeur** | Garder Mappy si l'équipe le connaît ; **ajouter un bouton « Ouvrir dans Mappy »** depuis chaque étape (lien profond avec adresse ou coordonnées) 🔶 : vérifier les paramètres exacts du lien. |
| **Estimation des coûts et durées** | L'API Mappy (mode poids lourds) peut servir de **première estimation**, jamais de preuve ; comparer avec un second moteur. |
| **Itinéraires conformes au gabarit** | Utiliser un moteur **camion avec restrictions** : PTV, HERE, TollGuru 🔶 (payants) ou **OpenRouteService / Valhalla** (libres, profil camion) 🔶. |
| **Avertissements pour le chauffeur** | Afficher avant le départ les **restrictions connues** : interdictions de circuler le week-end et les jours fériés (calendrier par pays) 🔶, zones à faibles émissions, tunnels (ADR), hauteur, poids. |
| **Vérité terrain** | Les **balises GPS** donnent l'itinéraire réellement suivi, les temps d'arrêt et les passages. |

---

## 7. Architecture proposée

Le **suivi en temps réel exige un serveur** : une application hors ligne sans serveur ne peut pas recevoir les positions des camions. Trois options :

| Option | Description | + | − |
|---|---|---|---|
| **A. Plateforme de télématique du marché** (API) | Brancher l'API du fournisseur actuel des balises ; l'application garde la gestion (voyages, coûts, documents) | Rapide, peu de maintenance | Dépendance, coût, API à vérifier ❓ |
| **B. Auto-hébergé : Traccar + passerelle d'ingestion** | Traccar (libre) reçoit les balises ; une passerelle pousse les événements vers l'application | Maîtrise totale, pas de licence | Hébergement, supervision, sauvegardes à assurer |
| **C. Développement sur mesure** | Serveur propre (base de données géographique, file de messages) | Parfaitement adapté | Coût et délais élevés |

**Recommandation** : **hybride**. Conserver l'application **hors ligne en premier** pour les chauffeurs et le bureau (voyages, documents, coûts, photos), et ajouter une **couche serveur minimale** (option A ou B) qui ne fait que : recevoir les positions, calculer jalons et alertes, et **synchroniser** avec l'application. Si le serveur tombe, l'application continue de fonctionner.

**Synchronisation** : modèle « événements » horodatés, résolution des conflits par dernière modification et journal d'audit ; identités et droits par rôle.

---

## 8. Moteur de péages ADM — spécification détaillée

1. **Données** : charger `adm-grille-2026-11.csv` (colonnes `gare_a, gare_b, classe1_mad, classe2_mad, classe3_mad`) dans une table **versionnée par date d'effet** (la date d'effet n'est pas publiée par ADM ❓ : enregistrer la **date de relevé**).
2. **Classe du véhicule** : déduite des caractéristiques du camion (essieux, hauteur de l'essieu avant) : porteur 2 essieux → classe 2, ensemble articulé ou 3 essieux et plus avec hauteur > 1,30 m → classe 3 ✅.
3. **Topologie** : la grille ne dit pas comment les sections s'enchaînent. Construire un **graphe** (gares ↔ jonctions) à partir de la carte du réseau et des **traces GPS réelles** ; deux liaisons restent à confirmer : **Kénitra ↔ Kénitra Nord** et **Casablanca ↔ Nouaceur** (aucune ligne de tarif) ❓.
4. **Calcul** : somme des sections entre la gare d'entrée et celle de sortie ; afficher **le détail par section** pour contrôle.
5. **Tests de non-régression** (classe 3) : Casablanca → Tanger Med **253** ; Casablanca → Agadir **348** ; Agadir → Tanger Med **601** ; classe 2 Casablanca → Tanger Med **210** [audit §6.1].
6. **Rapprochement** avec Jawaz Pro et GPS : montant attendu vs montant facturé ; écart > 0 → alerte.
7. **Mise à jour** : bouton « importer une nouvelle grille », comparaison automatique avec l'ancienne (liste des sections changées) ; journal.
8. **Comparateurs en ligne** : ne pas les utiliser comme référence (l'un affichait 337 MAD contre 253 MAD officiels).

---

## 9. Vie privée et conformité

- **CNDP (Maroc)** : déclarer le traitement de géolocalisation, informer les chauffeurs et leurs représentants, limiter l'usage à la gestion de la flotte (délibération 17-2014) ✅ ; durée de conservation à fixer.
- **RGPD (UE)** : les chauffeurs sont suivis pendant qu'ils circulent dans l'UE ; prévoir information, base légale, droits d'accès 🔶 à valider avec un juriste.
- **Principe** : pas de suivi hors temps de service quand le camion est à usage privé ; **désactivation** possible pendant le repos personnel du chauffeur si la loi l'exige.
- **Sécurité** : chiffrement, mots de passe, droits par rôle, journal d'accès, sauvegardes, **PIN** en mode chauffeur (déjà présent).

---

## 10. Exigences non fonctionnelles

| Domaine | Exigence |
|---|---|
| **Langues** | Français, **arabe (RTL)**, anglais ensuite ; nombres et monnaie localisés (MAD, €). |
| **Hors ligne** | Toutes les fonctions du chauffeur et du bureau sauf la carte en direct fonctionnent sans réseau. |
| **Performance** | Carte fluide jusqu'à 200 camions ; mise à jour de position < 10 s en ligne. |
| **Disponibilité** | Serveur de suivi : 99,5 %, copie de secours des positions ; défaut = l'application locale continue. |
| **Sauvegarde** | Export chiffré complet (existant) + sauvegarde serveur quotidienne. |
| **Accessibilité** | Contrastes, gros boutons pour le chauffeur, utilisation avec gants. |
| **Intégrations** | WhatsApp Business / SMS, export comptable (CSV), calendrier. |

---

## 11. Écart avec l'application actuelle et feuille de route

**Déjà dans l'application (v2.0.0)** : commandes, clients, factures, camions (papiers, entretien), gasoil, chauffeurs (permis, visa, passeport), trajets, douane (documents, scans), codes SH + IA, mode chauffeur (PIN), notifications locales, photos, sauvegarde chiffrée, impression (facture, ordre de transport, dossier de douane), hors ligne complet.

**Manque pour le cahier des charges** : entité **Voyage** multi-tronçons, **autorisations bilatérales**, **compteur Schengen**, **TIR et sceaux**, **péages**, **traversées au mètre linéaire**, **retour à vide**, **GPS/carte/jalons automatiques**, **temps de conduite réel**, **WhatsApp**, **arabe**, **serveur de suivi**.

| Phase | Contenu | Pré-requis | Effort indicatif |
|---|---|---|---|
| **0 — Gains rapides (dans l'application hors ligne)** | Registre des autorisations « E/MA » avec compte-rendu ; **compteur Schengen 90/180** ; entité **Voyage** avec jalons saisis ; **grille ADM + estimateur de péage** (sans graphe : choix manuel des sections) ; **modèle de coût par voyage** (traversée au ml, per diem, hébergement) ; champs de **retour** et **KPI de retour à vide** ; **check-lists de documents** par tronçon ; **calendrier d'interdictions** de circuler ; interface en arabe | Aucun serveur | 2–4 semaines |
| **1 — Données GPS** *(import CSV/GPX, zones, jalons et traversées détectés : fait en v2.2.0 ; péages mesurés, gares relevées sur trace ou importées d'OpenStreetMap et rapprochement avec le relevé Jawaz Pro : faits en v2.3.0)* | Import de traces (CSV/GPX) depuis la plateforme actuelle ; zones et jalons ; rapprochement péages/passages ; carte hors ligne des voyages terminés | Export des balises | 3–5 semaines |
| **2 — Suivi en direct** *(fait en v2.4.0 : relais, Traccar, carte, états dont traversée, alertes, étapes automatiques ; ETA et lien client faits en v2.5.0 ; restent alertes WhatsApp/SMS, e-CMR)* | Passerelle (Traccar ou API du fournisseur) ; carte en direct ; états dérivés (traversée) ; alertes ; ETA | Serveur | 4–8 semaines |
| **3 — Conformité avancée** | Tachygraphe à distance ; télépéage (EETS) ; Jawaz Pro (API/export) ; e-CMR ; lien client | Accords partenaires | continu |

---

### État d'avancement (v3.0.0)

| Phase | Contenu | État |
|---|---|---|
| 0 | Voyages, traversée du détroit, autorisations, Schengen, péages ADM, arabe | ✅ v2.1 |
| 1 | Import GPS CSV/GPX, zones, étapes automatiques | ✅ v2.2 |
| 2 | Gares de péage, péage mesuré, rapprochement Jawaz Pro | ✅ v2.3 |
| 3 | Suivi en direct (relais, Traccar, démonstration) | ✅ v2.4 |
| 4 | ETA et lien client | ✅ v2.5 |
| 5 à 8 | Alertes ntfy / WhatsApp / SMS, balise du téléphone, preuve de livraison, tachygraphe (CSV), chaîne du froid, péages d'Europe | ✅ v3.0 |

| 9 | Fichiers `.ddd` de carte conducteur, alertes automatiques (Telegram, WhatsApp Cloud API, webhook), CMR imprimable, relevés de télépéage européen | ✅ v3.1 |

**Reste hors de portée d'une application autonome** (dépend d'un tiers ou d'une information non confirmée) :

- **Téléchargement à distance du tachygraphe** : il se fait par le matériel du véhicule ou le service de votre fournisseur ; l'application lit les fichiers que vous en obtenez (`.ddd` carte conducteur, CSV). Les fichiers de **véhicule (VU)** ne sont pas lus.
- **API Jawaz Pro et EETS** : aucune API documentée publiquement ; on passe par les relevés CSV (Jawaz Pro : rapprochement avec les passages GPS ; télépéage européen : montant réel du voyage).
- **e-CMR** : le protocole additionnel à la convention CMR est en vigueur depuis 2011 et l'Espagne y a adhéré, mais **aucune adhésion du Maroc n'a pu être confirmée** (à vérifier auprès du [dépositaire ONU](https://treaties.un.org) ou du ministère marocain des Transports ; voir aussi [le texte de la convention](https://maroctl.com/routier/transport-de-marchandises/lois-et-reglements-transport-de-marchandises/convention-cmr-transport-international-de-marchandises/)). Un vrai e-CMR passe par une plateforme agréée : l'application fournit un CMR papier préparé et une preuve de livraison signée, qui n'en sont pas.
- **Tarifs de péage de France, d'Espagne et d'Italie** : les péages se facturent par section, il n'existe pas de tarif au kilomètre officiel ; les sources trouvées se contredisent. Utilisez le relevé de télépéage (montant réel) ou saisissez le tarif moyen de votre concessionnaire.
- **Envoi WhatsApp** : l'intégration est faite, mais elle exige un compte Meta Business, un jeton et, hors fenêtre de 24 h, un modèle approuvé : à créer par vous.
- **Synchronisation entre appareils** : hors du périmètre hors ligne (les alertes et le lien client passent par le relais).

## 12. Critères d'acceptation (extraits)

1. Le calcul de péage Casablanca → Tanger Med en classe 3 donne **253 MAD** avec le détail 43 + 28 + 182.
2. Un voyage dont le visa du chauffeur expire avant la date de retour prévue **est signalé avant le départ**.
3. Une autorisation « E » utilisée **sans compte-rendu** après 15 jours déclenche une alerte.
4. Un camion qui passe 90 minutes sans position **dans la zone du détroit** n'est pas déclaré « perdu » ; hors zone, l'alerte apparaît après le seuil paramétré.
5. Le chauffeur peut, **sans réseau**, voir sa mission, photographier un CMR et enregistrer un plein ; l'envoi se fait au retour du réseau.
6. Le tableau de bord affiche le **taux de retour à vide** du mois et le **coût de chaque kilomètre à vide**.
7. Tous les tarifs affichés indiquent **leur source et leur date**.
