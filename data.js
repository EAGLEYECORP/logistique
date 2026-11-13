// Données de référence (statiques). À vérifier/compléter auprès de l'ADII :
// https://www.douane.gov.ma — les taux et codes à 10 chiffres changent avec la loi de finances.

// Chapitres du Système Harmonisé (SH) — les 2 premiers chiffres de tout code tarifaire.
const CHAPITRES_SH = [
  ["01", "Animaux vivants"],
  ["02", "Viandes et abats comestibles"],
  ["03", "Poissons, crustacés, mollusques"],
  ["04", "Lait, produits laitiers, œufs, miel"],
  ["05", "Autres produits d'origine animale"],
  ["06", "Plantes vivantes, fleurs coupées"],
  ["07", "Légumes, racines et tubercules"],
  ["08", "Fruits comestibles, agrumes, fruits à coque"],
  ["09", "Café, thé, maté, épices"],
  ["10", "Céréales"],
  ["11", "Produits de la minoterie, malt, amidons"],
  ["12", "Graines et fruits oléagineux, plantes industrielles"],
  ["13", "Gommes, résines, extraits végétaux"],
  ["14", "Matières à tresser, autres produits végétaux"],
  ["15", "Graisses et huiles animales ou végétales"],
  ["16", "Préparations de viandes, poissons"],
  ["17", "Sucres et sucreries"],
  ["18", "Cacao et ses préparations"],
  ["19", "Préparations à base de céréales, pâtisseries"],
  ["20", "Préparations de légumes, fruits"],
  ["21", "Préparations alimentaires diverses"],
  ["22", "Boissons, liquides alcooliques, vinaigres"],
  ["23", "Résidus des industries alimentaires, aliments pour animaux"],
  ["24", "Tabacs"],
  ["25", "Sel, soufre, terres et pierres, plâtres, ciments"],
  ["26", "Minerais, scories et cendres"],
  ["27", "Combustibles minéraux, huiles minérales"],
  ["28", "Produits chimiques inorganiques"],
  ["29", "Produits chimiques organiques"],
  ["30", "Produits pharmaceutiques"],
  ["31", "Engrais"],
  ["32", "Extraits tannants, peintures, vernis, encres"],
  ["33", "Huiles essentielles, parfumerie, cosmétiques"],
  ["34", "Savons, produits d'entretien, cires"],
  ["35", "Matières albuminoïdes, colles, enzymes"],
  ["36", "Poudres et explosifs, allumettes"],
  ["37", "Produits photographiques"],
  ["38", "Produits divers des industries chimiques"],
  ["39", "Matières plastiques et ouvrages"],
  ["40", "Caoutchouc et ouvrages (dont pneumatiques)"],
  ["41", "Peaux et cuirs"],
  ["42", "Ouvrages en cuir, maroquinerie, articles de voyage"],
  ["43", "Pelleteries et fourrures"],
  ["44", "Bois, charbon de bois, ouvrages en bois"],
  ["45", "Liège"],
  ["46", "Ouvrages de sparterie et vannerie"],
  ["47", "Pâtes de bois"],
  ["48", "Papiers et cartons"],
  ["49", "Produits de l'édition, imprimés"],
  ["50", "Soie"],
  ["51", "Laine, poils fins ou grossiers"],
  ["52", "Coton"],
  ["53", "Autres fibres textiles végétales"],
  ["54", "Filaments synthétiques ou artificiels"],
  ["55", "Fibres synthétiques ou artificielles discontinues"],
  ["56", "Ouates, feutres, ficelles, cordages"],
  ["57", "Tapis et revêtements de sol textiles"],
  ["58", "Tissus spéciaux, dentelles, broderies"],
  ["59", "Tissus imprégnés, enduits, techniques"],
  ["60", "Étoffes de bonneterie"],
  ["61", "Vêtements en bonneterie"],
  ["62", "Vêtements autres qu'en bonneterie"],
  ["63", "Autres articles textiles confectionnés, friperie"],
  ["64", "Chaussures"],
  ["65", "Coiffures"],
  ["66", "Parapluies, cannes, fouets"],
  ["67", "Plumes, fleurs artificielles, ouvrages en cheveux"],
  ["68", "Ouvrages en pierres, plâtre, ciment, amiante"],
  ["69", "Produits céramiques"],
  ["70", "Verre et ouvrages en verre"],
  ["71", "Perles, pierres et métaux précieux, bijouterie"],
  ["72", "Fonte, fer et acier"],
  ["73", "Ouvrages en fonte, fer ou acier"],
  ["74", "Cuivre et ouvrages en cuivre"],
  ["75", "Nickel et ouvrages en nickel"],
  ["76", "Aluminium et ouvrages en aluminium"],
  ["77", "(Réservé)"],
  ["78", "Plomb et ouvrages en plomb"],
  ["79", "Zinc et ouvrages en zinc"],
  ["80", "Étain et ouvrages en étain"],
  ["81", "Autres métaux communs, cermets"],
  ["82", "Outils, coutellerie en métaux communs"],
  ["83", "Ouvrages divers en métaux communs"],
  ["84", "Machines, appareils mécaniques, réacteurs, chaudières"],
  ["85", "Machines et appareils électriques, électroniques"],
  ["86", "Véhicules et matériel ferroviaires"],
  ["87", "Voitures automobiles, tracteurs, camions, pièces"],
  ["88", "Navigation aérienne ou spatiale"],
  ["89", "Navigation maritime ou fluviale"],
  ["90", "Instruments d'optique, de mesure, médico-chirurgicaux"],
  ["91", "Horlogerie"],
  ["92", "Instruments de musique"],
  ["93", "Armes et munitions"],
  ["94", "Meubles, literie, luminaires, constructions préfabriquées"],
  ["95", "Jouets, jeux, articles de sport"],
  ["96", "Ouvrages divers (brosses, stylos, briquets...)"],
  ["97", "Objets d'art, de collection ou d'antiquité"],
];

// Listes de documents par type d'opération. Modèle de départ : adaptez à votre activité.
const CHECKLISTS_DOUANE = {
  import: [
    "Facture commerciale (originale, avec valeur et Incoterm)",
    "Liste de colisage (packing list)",
    "Titre de transport : CMR (route), connaissement / B/L (mer) ou LTA (air)",
    "Certificat d'origine (EUR.1 / EUR-MED pour l'UE, ou formulaire de l'accord applicable)",
    "Engagement d'importation / domiciliation bancaire (si requis)",
    "Code SH à 10 chiffres vérifié",
    "Autorisations / certificats spécifiques (ONSSA, MCINET, ANRT, etc.) selon le produit",
    "Assurance transport",
    "Déclaration DUM déposée sur BADR",
    "Paiement des droits et taxes (DI, TVA, TPI...)",
    "Bon à enlever (BAE) obtenu",
  ],
  export: [
    "Facture commerciale",
    "Liste de colisage",
    "Titre de transport : CMR, connaissement ou LTA",
    "Certificat d'origine (EUR.1 / EUR-MED si destination UE)",
    "Code SH à 10 chiffres vérifié",
    "Certificats phytosanitaires / sanitaires (si produits agricoles ou alimentaires)",
    "Déclaration DUM export déposée sur BADR",
    "Visa / mainlevée douane",
    "Rapatriement des devises (domiciliation) suivi",
  ],
  transit: [
    "Titre de transport (CMR / connaissement)",
    "Carnet TIR ou déclaration de transit",
    "Facture et liste de colisage",
    "Garantie / caution douanière",
    "Scellés douaniers vérifiés",
    "Itinéraire et délai de transit respectés",
    "Apurement du transit au bureau de destination",
  ],
};

/* ---------- Voyages internationaux : listes de contrôle (valeurs de départ, modifiables) ---------- */
const CHECKLISTS_VOYAGE = {
  depart: ["Passeport valable 6 mois après le retour", "Visa valable pour l'aller et le retour", "Jours Schengen restants suffisants", "Permis, carte conducteur, aptitude médicale",
    "Carte grise, assurance internationale / carte verte, visite technique", "Tachygraphe étalonné (disque ou carte, papier)", "Autorisation bilatérale + compte-rendu de voyage vierge",
    "Carnet TIR (volets), sceaux notés", "Pass Jawaz lié au camion, solde suffisant", "Poids, essieux et gabarit vérifiés (40 t, 16,50 m, 2,55 m, 4,00 m)",
    "CMR (4 exemplaires), facture, liste de colisage", "DUM export déposée et validée (BADR)", "EUR.1 ou certificat d'origine", "Certificats sanitaires / ATP / ADR si concerné",
    "Température de consigne réglée (frigorifique)", "Traversée du détroit réservée (mètres linéaires, heure limite)", "Balise GPS en marche, SIM active", "Photos du chargement et des scellés"],
  arrivee: ["Contrôle d'entrée (passeport, visa, EES) fait", "Scellés contrôlés et photographiés au débarquement", "Contrôle douanier / sanitaire passé (Algeciras pour les produits frais)",
    "Décharge TIR ou ouverture du transit", "Compteur Schengen et tachygraphe à jour", "Parking sécurisé réservé pour le repos hebdomadaire (hors cabine)", "Livraison : CMR signé, photo de preuve"],
  retour: ["Fret de retour confirmé (ou retour à vide décidé)", "Documents de la marchandise de retour (CMR, facture, certificats)", "Déclaration d'import préparée côté Maroc",
    "Traversée de retour réservée", "Compte-rendu de voyage rempli et remis", "Carnet TIR clôturé, sceaux comptabilisés", "Sortie de Schengen avant la date limite",
    "Fiche de frais avec justificatifs (péages, traversée, carburant, hôtel, amendes)", "État du camion contrôlé, incidents signalés"],
};
const LIB_CHECKLISTS_VOYAGE = { depart: "Avant le départ", arrivee: "Arrivée en Europe", retour: "Chargement et retour" };

/** Interdictions de circuler des poids lourds (> 7,5 t) — INDICATIVES, à vérifier chaque année auprès des autorités de chaque pays. jours : 0 = dimanche, 6 = samedi. */
const INTERDICTIONS = [
  { pays: "France", jours: [6, 0], texte: "Du samedi 22 h au dimanche 22 h, et veilles / jours fériés" },
  { pays: "Espagne", jours: [0], texte: "Dimanches et jours fériés sur de nombreux axes (varie selon les régions)" },
  { pays: "Italie", jours: [0], texte: "Dimanches et jours fériés, environ 9 h – 22 h" },
  { pays: "Allemagne", jours: [0], texte: "Dimanches et jours fériés, 0 h – 22 h" },
  { pays: "Autriche", jours: [6, 0], texte: "Du samedi 15 h au dimanche 22 h" },
  { pays: "Suisse", jours: [0], texte: "Dimanche, et nuit de 22 h à 5 h" },
];

/** Villes courantes (coordonnées approximatives du centre) : le voyage reconnaît sa destination sans saisie de coordonnées. */
const VILLES = {
  "agadir": [30.4278, -9.5981], "casablanca": [33.5731, -7.5898], "rabat": [34.0209, -6.8416], "marrakech": [31.6295, -7.9811], "fes": [34.0331, -5.0003], "tanger": [35.7595, -5.834],
  "tanger med": [35.889, -5.5], "kenitra": [34.261, -6.5802], "oujda": [34.6867, -1.9114], "laayoune": [27.1253, -13.1625], "dakhla": [23.6848, -15.958], "nador": [35.1681, -2.9335],
  "algeciras": [36.1408, -5.4562], "madrid": [40.4168, -3.7038], "barcelone": [41.3851, 2.1734], "valence": [39.4699, -0.3763], "seville": [37.3891, -5.9845], "malaga": [36.7213, -4.4214], "almeria": [36.8381, -2.4597],
  "murcie": [37.9922, -1.1307], "saragosse": [41.6488, -0.8891], "bilbao": [43.263, -2.935], "perpignan": [42.6887, 2.8948], "montpellier": [43.6108, 3.8767], "sete": [43.4075, 3.6967], "marseille": [43.2965, 5.3698],
  "lyon": [45.764, 4.8357], "paris": [48.8566, 2.3522], "rungis": [48.7462, 2.3526], "bordeaux": [44.8378, -0.5792], "toulouse": [43.6047, 1.4442], "nantes": [47.2184, -1.5536], "lille": [50.6292, 3.0573],
  "milan": [45.4642, 9.19], "turin": [45.0703, 7.6869], "rome": [41.9028, 12.4964], "bruxelles": [50.8503, 4.3517], "anvers": [51.2194, 4.4025], "rotterdam": [51.9244, 4.4777], "amsterdam": [52.3676, 4.9041],
  "francfort": [50.1109, 8.6821], "munich": [48.1351, 11.582], "hambourg": [53.5511, 9.9937], "lisbonne": [38.7223, -9.1393],
};

/** Péages de France : principales liaisons du réseau VINCI Autoroutes (ASF, Cofiroute, Escota…), tarifs officiels applicables au 1er février 2026,
    publiés par VINCI Autoroutes (« Tarifs des principales liaisons »). [autoroutes, liaison, classe 1, 2, 3, 4, 5] en euros TTC.
    Classe 3 = poids lourds à 2 essieux ; classe 4 = poids lourds à 3 essieux et plus (ensemble articulé). Les autres réseaux (APRR, Sanef, Atlandes…) ne sont PAS couverts. */
const FR_LIAISONS_DATE = "2026-02-01";
const FR_LIAISONS = [["A7/A8","Lyon / Marseille - Aix",28.1,45.7,60.3,81.7,17.0],["A7/A9","Lyon / Montpellier",32.8,51.3,70.7,92.6,19.2],["A7/A9","Lyon / Espagne (Perthus)",55.5,86.4,123.0,157.8,32.8],["A54/A7/A8","Arles / Marseille - Aix",5.2,7.7,11.5,14.7,3.0],["A9","Montpellier / Espagne (Perthus)",23.1,35.3,50.9,62.5,13.0],["A9/A61","Montpellier / Toulouse sud-ouest",27.6,41.9,61.9,75.6,15.7],["A9","Montpellier / Narbonne-est",9.7,14.7,21.5,27.5,5.6],["A8","Aix / Nice",21.2,31.5,45.0,62.6,13.0],["A51","Aix / Gap (La Saulce)",14.9,20.6,28.9,42.0,8.7],["A89","Bordeaux / Clermont-Ferrand",42.7,64.3,90.8,129.3,26.0],["A89","Bordeaux / Lyon (La Tour de Salvagny)",59.0,89.4,127.5,178.9,35.6],["A62/A61/A9/A54/A7","Bordeaux / Marseille",63.5,97.7,142.4,179.5,38.1],["A10","Paris (La Folie-Bessin) / Orléans-nord",12.0,17.1,28.2,37.6,6.8],["A10","Paris (La Folie-Bessin) / Tours-centre",26.0,40.1,66.8,82.6,16.2],["A10","Paris (La Folie-Bessin) / Poitiers-sud",40.9,62.1,102.1,129.9,25.3],["A10","Paris (La Folie-Bessin) / Bordeaux (Virsac)",60.9,93.6,146.1,187.6,37.7],["A10","Tours Centre (Sorigny) / Bordeaux (Virsac)",34.9,53.5,79.3,105.0,21.5],["A28","Tours (Saint-Christophe) / Alençon-sud",14.4,21.9,35.4,41.5,9.1],["A10/A71","Paris (La Folie-Bessin) / Bourges",24.6,39.6,64.4,82.5,15.7],["A11","Paris (La Folie-Bessin) / Le Mans-nord",21.6,33.2,52.0,71.5,13.6],["A11/A81","Paris (La Folie-Bessin) / La Gravelle (Vitré)",32.3,50.6,75.3,108.6,21.6],["A11","Paris (La Folie-Bessin) / Angers (Corzé)",32.9,50.8,78.9,100.1,20.2],["A11","Paris (La Folie-Bessin) / Nantes",43.3,67.0,103.4,133.1,26.4],["A83/A10","Nantes / Bordeaux",33.2,50.2,69.9,90.7,19.9],["A11","Nantes / Angers",10.4,16.2,24.5,33.0,6.2],["A11/A85","Nantes / Vierzon-nord",36.5,56.4,85.0,111.9,22.1],["A62","Toulouse nord-est / Bordeaux",22.9,36.0,52.5,67.0,14.1],["A62/A61/A9","Bordeaux / Toulouse / Montpellier",51.1,78.8,115.8,144.4,30.2],["A61/A9","Toulouse sud-est / Espagne (Perthus)",27.9,42.6,57.2,75.7,16.7],["A85","Angers / Tours",12.7,18.5,26.9,36.3,7.5]];

/* ============================================================
   Passage des ports, étape par étape (aller : Tanger Med → Algeciras ; retour : Algeciras → Tanger Med).
   Valeurs de départ à confirmer avec votre transitaire et vos chauffeurs : l'ordre et les intitulés varient selon l'armateur,
   la marchandise (frais / sec), le régime (TIR, T1, export définitif) et l'affluence.
   jalon : étape du voyage posée en même temps (heure d'arrivée, attentes mesurées, notifications) ;
   ref : référence à noter ; frais : seulement pour les marchandises fraîches ou sous température dirigée ;
   scanner : on peut noter un passage en inspection (couloir rouge) ; schengen : entrée ou sortie de l'espace Schengen du chauffeur.
   ============================================================ */
const PORTS_PASSAGE = {
  tmed_export: { lib: "Tanger Med — sortie du Maroc", sens: "aller", portAttente: "tmed_export", etapes: [
    { id: "tme_parc", lib: "Arrivée au parc de régulation export", detail: "Plateforme d'accès export (zone d'attente des camions). Passage portuaire entièrement dématérialisé : le camion est appelé quand son dossier PortNet est complet. Se présenter au moins 3 h avant le départ du navire (selon l'armateur).", docs: ["Réservation de l'armateur"], ref: "N° de réservation", jalon: "port_tmed" },
    { id: "tme_portnet", lib: "Pré-enregistrement PortNet", detail: "Le transitaire saisit le camion, le chauffeur et la marchandise dans le guichet unique PortNet ; la DUM export est déposée dans BADR.", docs: ["DUM export (BADR)", "Facture commerciale", "Liste de colisage"], ref: "N° DUM" },
    { id: "tme_douane", lib: "Douane : contrôle des documents", detail: "Bureau de douane : vérification de la DUM, du titre de transit et des documents d'origine ; validation (« bon à embarquer » douanier).", docs: ["DUM", "CMR", "Carnet TIR ou T1", "Certificat d'origine EUR.1 / EUR-MED", "Facture"], ref: "N° carnet TIR / T1" },
    { id: "tme_sanitaire", lib: "Contrôle sanitaire export (ONSSA / EACCE)", detail: "Fruits, légumes, produits animaux : certificat phytosanitaire ou sanitaire, contrôle de conformité à l'export.", docs: ["Certificat phytosanitaire", "Certificat EACCE"], ref: "N° de certificat", frais: true },
    { id: "tme_scanner", lib: "Scanner", detail: "Passage au scanner ; le résultat est transmis automatiquement à la douane (BADR). En « couloir rouge » : inspection physique, attente plus longue (notez-le : cette attente ne fausse pas vos médianes).", docs: [], scanner: true },
    { id: "tme_police", lib: "Police : sortie du territoire", detail: "Contrôle du passeport et du visa du chauffeur, du véhicule et de l'autorisation de transport.", docs: ["Passeport + visa Schengen", "Carte grise", "Autorisation de transport international (« E »)", "Carte verte"] },
    { id: "tme_tmpa", lib: "Droits de port et accès au quai", detail: "Facturation des droits de port, autorisation de mouvement portuaire, file de pré-embarquement.", docs: ["Billet / réservation"] },
    { id: "tme_embarquement", lib: "Embarquement", detail: "Le camion monte à bord. La traversée dure environ 1 h 30.", docs: [], ref: "Navire", jalon: "embarque_aller" },
  ] },
  alg_entree: { lib: "Algeciras — entrée dans l'Union européenne", sens: "aller", portAttente: "alg_entry", etapes: [
    { id: "alg_debarquement", lib: "Débarquement", detail: "Le camion descend du navire et rejoint la zone de contrôle.", docs: [], jalon: "debarque_alg" },
    { id: "alg_police", lib: "Police des frontières : entrée Schengen", detail: "Contrôle du passeport et du visa ; enregistrement biométrique dans le système européen d'entrée et de sortie (EES, en service complet depuis le 10/04/2026 : chaque jour est compté automatiquement). Le compteur Schengen du chauffeur démarre.", docs: ["Passeport + visa Schengen"], schengen: "entree" },
    { id: "alg_douane", lib: "Douane espagnole", detail: "Déclaration sommaire d'entrée (ENS, ICS2) déposée avant l'arrivée du navire ; présentation du titre de transit (TIR ou T1) ou de la déclaration d'importation ; contrôle, mainlevée.", docs: ["Carnet TIR ou T1", "CMR", "Facture", "Certificat d'origine EUR.1"], ref: "N° MRN" },
    { id: "alg_pcf", lib: "Contrôle sanitaire (poste de contrôle frontalier)", detail: "Fruits, légumes, produits animaux : document sanitaire commun d'entrée (DSCE / CHED) (partie I) déposé dans TRACES par l'importateur ou son agent au moins un jour ouvrable avant l'arrivée ; contrôle documentaire, d'identité et parfois physique (prélèvement possible), puis partie II et dédouanement — souvent l'attente la plus longue. PCF ouvert lun.–ven. 7 h 30–22 h, sam., dim. et fêtes 9 h 30–22 h.", docs: ["DSCE / CHED (TRACES)", "Certificat phytosanitaire"], ref: "N° CHED", frais: true },
    { id: "alg_sortie", lib: "Sortie du port", detail: "Le camion quitte la zone portuaire vers sa destination.", docs: [], sortiePort: "alg_entry" },
  ] },
  alg_sortie: { lib: "Algeciras — sortie de l'Union européenne", sens: "retour", etapes: [
    { id: "ras_arrivee", lib: "Arrivée au port d'Algeciras", detail: "Zone d'attente des camions ; se présenter à l'heure demandée par l'armateur.", docs: ["Réservation de l'armateur"], ref: "N° de réservation" },
    { id: "ras_douane", lib: "Douane : sortie de l'Union", detail: "Validation de la sortie de la déclaration d'export (MRN, système ECS) ou apurement du transit.", docs: ["Déclaration d'export (DAE / MRN)", "CMR", "Facture"], ref: "MRN export" },
    { id: "ras_police", lib: "Police : sortie Schengen", detail: "Contrôle du passeport ; sortie enregistrée dans l'EES. Le séjour Schengen du chauffeur se ferme.", docs: ["Passeport"], schengen: "sortie" },
    { id: "ras_embarquement", lib: "Embarquement", detail: "Le camion monte à bord vers Tanger Med.", docs: [], ref: "Navire", jalon: "embarque_retour" },
  ] },
  tmed_import: { lib: "Tanger Med — entrée au Maroc", sens: "retour", portAttente: "tmed_import", etapes: [
    { id: "tmi_debarquement", lib: "Débarquement", detail: "Le camion descend du navire et rejoint la zone de contrôle import.", docs: [], jalon: "debarque_tmed" },
    { id: "tmi_police", lib: "Police : entrée au Maroc", detail: "Contrôle du passeport du chauffeur et des documents du véhicule.", docs: ["Passeport", "Carte grise"] },
    { id: "tmi_scanner", lib: "Scanner", detail: "Passage au scanner ; inspection physique possible (couloir rouge).", docs: [], scanner: true },
    { id: "tmi_douane", lib: "Douane : DUM import", detail: "Le transitaire dépose la DUM import dans BADR ; liquidation et paiement des droits et de la TVA à l'import.", docs: ["DUM import", "Facture", "CMR", "Certificat d'origine EUR.1 (préférence UE-Maroc)"], ref: "N° DUM import" },
    { id: "tmi_controles", lib: "Contrôles selon la marchandise (ONSSA, normes…)", detail: "Seulement si la marchandise l'exige : contrôle sanitaire, technique ou de conformité.", docs: ["Certificats demandés"], ref: "N° de certificat", facultatif: true },
    { id: "tmi_mainlevee", lib: "Mainlevée et sortie du port", detail: "Bon à enlever : le camion quitte le port.", docs: [], jalon: "douane_import" },
  ] },
};
