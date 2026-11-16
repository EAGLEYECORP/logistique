# Héberger le relais gratuitement

L'application fonctionne seule sur chaque appareil. Le **relais** est le petit serveur qui ajoute ce qu'un appareil ne peut pas faire seul :

| Avec le relais | Sans |
|---|---|
| Positions des balises GPS, carte en direct, arrivée estimée | saisie à la main |
| Lien de suivi pour vos clients | — |
| Factures envoyées par e-mail avec CMR et preuve de livraison, relances automatiques | partage du téléphone, relances à faire soi-même |
| Notifications aux étapes, même application fermée | seulement quand l'application est ouverte |
| Taux EUR → MAD de Bank Al-Maghrib et gazole officiel du jour | valeurs saisies |
| Plusieurs utilisateurs, accès par service, synchronisation | un appareil à la fois |

Il faut : **une machine allumée en permanence**, **Node.js 18 ou plus** (gratuit) et une **adresse en https**. L'application est servie en https (GitHub Pages) : un navigateur refuse qu'elle parle à un relais en simple http.

## Choisir

| | Coût | Quand | Limites |
|---|---|---|---|
| **A. PC ou mini-PC au bureau + votre box** (recommandé) | 0 MAD | la box a une **adresse IP publique** et vous pouvez ouvrir des ports | la machine reste allumée ; électricité d'un mini-PC : quelques watts |
| **B. Même PC + un nom de domaine + Cloudflare Tunnel** | ≈ 100 à 150 MAD par an (le domaine) | box 4G, pas d'IP publique, ou pas d'accès à la box | dépend de Cloudflare (offre gratuite) |
| **C. Machine virtuelle gratuite Oracle Cloud** | 0 MAD | pas de machine au bureau | carte bancaire demandée à l'inscription ; l'allocation gratuite aurait été réduite en août 2026 et les machines inactives peuvent être reprises : **vérifiez la page officielle** avant |

**Déconseillé** : l'offre gratuite de Tailscale (réservée à un usage non commercial) ; les hébergeurs gratuits qui mettent le serveur en veille ou n'ont pas de disque permanent (le relais perdrait ses données) ; les tunnels « rapides » dont l'adresse change à chaque redémarrage (les liens envoyés aux clients cesseraient de marcher).

**Votre box a-t-elle une IP publique ?** Comparez l'adresse « WAN » affichée dans l'interface de la box avec celle donnée par un site comme « quelle est mon adresse IP ». Identiques : oui (option A). Différentes, ou commençant par 100.64 à 100.127 : non (option B). Les box fibre et ADSL en ont souvent une ; les box 4G rarement.

## A. PC ou mini-PC au bureau (Linux) — pas à pas

1. **La machine** : un vieux PC, un mini-PC ou un Raspberry Pi 4/5, avec Ubuntu Server, Debian ou Raspberry Pi OS. Donnez-lui une adresse fixe sur le réseau du bureau (dans la box : « bail DHCP statique » ou « réservation »).
2. **Un nom gratuit** : créez un sous-domaine sur [DuckDNS](https://www.duckdns.org) (par exemple `atlas-fret.duckdns.org`) et installez sa mise à jour automatique (DuckDNS donne la commande, une ligne dans `crontab`). Vérifiez ses conditions d'utilisation. Autre possibilité sans compte : `196-200-10-20.sslip.io` (votre IP publique avec des tirets), qui ne suit pas un changement d'IP.
3. **La box** : redirigez les ports **80 et 443** (TCP) vers l'adresse fixe de la machine.
4. **Le relais**, en une commande :
   ```bash
   git clone https://github.com/EAGLEYECORP/logistique.git && cd logistique
   sudo DOMAINE=atlas-fret.duckdns.org bash serveur/installer.sh
   ```
   Le script installe Node.js si besoin, copie le code dans `/opt/logistique-fret`, écrit la configuration `/etc/logistique-fret.env` (jetons et clé de chiffrement tirés au hasard, fichier lisible par root seulement), crée le service qui démarre avec la machine, et met **Caddy** devant pour le https (certificat Let's Encrypt gratuit, renouvelé seul). Il affiche à la fin l'adresse et les jetons. Ajoutez `MULTI=oui` pour plusieurs utilisateurs.
5. **Vérifier** : `https://atlas-fret.duckdns.org/sante` répond `{"ok":true,…}`.
6. **Brancher l'application** : Réglages → Général → **Relais** : adresse et jeton de lecture, puis « Tester ». En mode multi-utilisateur, ouvrez simplement l'adresse du relais : l'application s'y affiche et demande de créer le premier compte.
7. **E-mail** (factures, relances) : dans `/etc/logistique-fret.env`, retirez le `#` des lignes `SMTP_…` et remplissez-les, puis `sudo systemctl restart logistique-fret`. Avec Gmail : activez la validation en deux étapes du compte, créez un **mot de passe d'application** et mettez-le dans `SMTP_MOT_DE_PASSE` (environ 500 messages par jour). La boîte de l'entreprise (hébergeur du domaine) convient aussi : demandez-lui l'adresse SMTP et le port.

## A bis. PC Windows au bureau

1. Installez **Node.js LTS** depuis nodejs.org.
2. Copiez le dossier de l'application (ou `git clone`) dans `C:\logistique`.
3. Copiez `serveur\relais.env.exemple` en `serveur\relais.env` et remplissez-le (Réglages → Relais dans l'application peut tirer les jetons pour vous).
4. Double-cliquez `serveur\demarrer-windows.cmd` : le relais démarre et redémarre seul s'il s'arrête.
5. Au démarrage du PC : Planificateur de tâches → Créer une tâche → Déclencheur « Au démarrage » → Action : `C:\logistique\serveur\demarrer-windows.cmd` → « Exécuter même si l'utilisateur n'est pas connecté ».
6. https : installez [Caddy pour Windows](https://caddyserver.com/download) avec un fichier `Caddyfile` contenant `atlas-fret.duckdns.org { reverse_proxy 127.0.0.1:8787 }`, et redirigez les ports 80 et 443 de la box vers ce PC ; ou passez par l'option B.
7. Empêchez la mise en veille du PC (Paramètres → Alimentation).

## B. Sans IP publique : Cloudflare Tunnel

1. Achetez un nom de domaine (≈ 100 à 150 MAD par an chez un registraire) et confiez sa gestion à Cloudflare (offre gratuite).
2. Cloudflare → Zero Trust → Réseaux → **Tunnels** → Créer un tunnel ; installez `cloudflared` sur le PC avec la commande affichée.
3. Ajoutez un nom public, par exemple `fret.mon-entreprise.ma`, vers `http://localhost:8787`.
4. Installez le relais sans Caddy : `sudo bash serveur/installer.sh` (Linux) ou `demarrer-windows.cmd` (Windows). Aucun port à ouvrir sur la box.

## C. Machine virtuelle (Oracle Cloud ou autre) avec Docker

```bash
git clone https://github.com/EAGLEYECORP/logistique.git && cd logistique
docker build -f serveur/Dockerfile -t logistique-relais .
cp serveur/relais.env.exemple relais.env   # puis remplissez-le
docker run -d --name relais --restart unless-stopped -p 127.0.0.1:8787:8787 -v relais-donnees:/donnees --env-file relais.env logistique-relais
```
Puis Caddy devant (même Caddyfile qu'en A) et les ports 80/443 ouverts dans le pare-feu de la machine **et** dans les règles réseau du fournisseur. Ou, plus simple : `sudo DOMAINE=… bash serveur/installer.sh` sur la machine, sans Docker.

## Sauvegarder

Copiez chaque semaine, hors de la machine : le dossier des données (`/var/lib/logistique-fret`, ou le volume `relais-donnees`) **et** le fichier de configuration (`/etc/logistique-fret.env` ou `relais.env`). Sans la clé `CLE_DONNEES`, des données chiffrées ne se relisent pas. Les données de l'application restent aussi sur chaque appareil (Réglages → Données → Sauvegarde).

## Mettre à jour

```bash
cd logistique && git pull && sudo bash serveur/installer.sh
```
La configuration et les données sont conservées.

## Sécurité

- Gardez les jetons secrets ; en cas de fuite, changez-les dans le fichier de configuration et redémarrez, puis saisissez le nouveau jeton dans l'application.
- Le chiffrement des données au repos est activé par le script (`CHIFFRER_DONNEES=true`).
- N'ouvrez que les ports 80 et 443 ; tenez le système à jour (Ubuntu : `sudo apt install unattended-upgrades`).
- La géolocalisation des chauffeurs est une donnée personnelle : déclaration à la CNDP et information des salariés (voir `docs/07-rgpd-deploiement.md`).

## Dépannage

| Symptôme | Cause probable |
|---|---|
| « Serveur injoignable » dans l'application | adresse en http au lieu de https, ou relais arrêté (`systemctl status logistique-fret`) |
| Caddy n'obtient pas de certificat | ports 80/443 non redirigés, port 80 bloqué par le fournisseur d'accès, ou nom DuckDNS pas à jour |
| Ça marche au bureau, pas depuis un téléphone en 4G | pas d'IP publique : option B |
| « Jeton refusé » | jeton de lecture mal recopié (Réglages → Relais → Tester) |

Sources : [Oracle — ressources Always Free](https://docs.oracle.com/iaas/Content/FreeTier/resourceref.htm), [limites annoncées en 2026 (InfoQ)](https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/), [Tailscale — offres](https://tailscale.com/pricing), [Caddy](https://caddyserver.com), [DuckDNS](https://www.duckdns.org). Conditions des offres gratuites relevées le 16/11/2026 : vérifiez-les avant de vous engager.
