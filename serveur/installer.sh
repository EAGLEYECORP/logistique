#!/usr/bin/env bash
# ============================================================
# Installation du relais Logistique Fret sur Linux (Ubuntu, Debian, Raspberry Pi OS) — gratuit, sans dépendance.
#   sudo bash serveur/installer.sh                       # relais seul, port 8787
#   sudo DOMAINE=fret.duckdns.org bash serveur/installer.sh   # + https automatique (Caddy, certificat Let's Encrypt gratuit)
#   sudo MULTI=oui DOMAINE=… bash serveur/installer.sh    # + plusieurs utilisateurs (l'application servie par le relais)
# Relancer le script met à jour le code sans toucher à la configuration ni aux données.
# Essai sans rien installer : ESSAI=/tmp/essai bash serveur/installer.sh   (écrit les fichiers sous ce dossier, n'appelle ni apt ni systemctl)
# ============================================================
set -euo pipefail

RACINE="${ESSAI:-}"                       # préfixe des fichiers écrits (vide = système)
DEST="$RACINE/opt/logistique-fret"         # code
DONNEES="$RACINE/var/lib/logistique-fret"  # données du relais (positions, comptes, notifications…)
ENVF="$RACINE/etc/logistique-fret.env"     # configuration (jetons, e-mail…) : n'est jamais écrasée
UNITE="$RACINE/etc/systemd/system/logistique-fret.service"
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8787}"
dire() { printf '\n\033[1m%s\033[0m\n' "$*"; }
essai() { [ -n "$RACINE" ]; }

if ! essai && [ "$(id -u)" -ne 0 ]; then echo "Lancez ce script avec sudo." >&2; exit 1; fi

dire "1. Node.js (18 ou plus)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  if essai; then echo "(essai) apt-get install -y nodejs"; else apt-get update -y && apt-get install -y nodejs; fi
fi
command -v node >/dev/null 2>&1 && echo "Node $(node -v)"

dire "2. Code dans $DEST"
mkdir -p "$DEST" "$DONNEES" "$(dirname "$ENVF")" "$(dirname "$UNITE")"
( cd "$SOURCE" && tar --exclude=./.git --exclude=./node_modules --exclude=./tests --exclude=./serveur/donnees -cf - . ) | tar -xf - -C "$DEST"
echo "Copié depuis $SOURCE"

dire "3. Configuration $ENVF"
if [ -f "$ENVF" ]; then
  echo "Déjà présente : conservée (vos jetons et réglages ne changent pas)."
else
  jeton() { node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))'; }
  {
    echo "# Relais Logistique Fret — gardez ce fichier secret (chmod 600)."
    echo "PORT=$PORT"
    echo "HOTE=127.0.0.1"
    echo "DONNEES=/var/lib/logistique-fret"
    echo "JETON_ECRITURE=$(jeton)"
    echo "JETON_LECTURE=$(jeton)"
    echo "CHIFFRER_DONNEES=true"
    echo "CLE_DONNEES=$(jeton)$(jeton)"
    if [ -n "${DOMAINE:-}" ]; then echo "URL_PUBLIQUE=https://$DOMAINE"; fi
    if [ "${MULTI:-}" = "oui" ]; then echo "MULTI_UTILISATEUR=true"; fi
    echo "# E-mail (factures, relances, notifications) — boîte de l'entreprise, ou Gmail avec un mot de passe d'application :"
    echo "# SMTP_HOTE=smtp.gmail.com"
    echo "# SMTP_PORT=465"
    echo "# SMTP_SECURITE=tls"
    echo "# SMTP_UTILISATEUR=compta@votre-entreprise.ma"
    echo "# SMTP_MOT_DE_PASSE=mot-de-passe-d-application"
    echo "# SMTP_DE=compta@votre-entreprise.ma"
    echo "# Boîte des demandes (lecture seule, toutes les 5 minutes) : la boîte qui reçoit les demandes des clients :"
    echo "# IMAP_HOTE=imap.gmail.com"
    echo "# IMAP_UTILISATEUR=contact@votre-entreprise.ma"
    echo "# IMAP_MOT_DE_PASSE=mot-de-passe-d-application"
    echo "# Itinéraire poids lourd (km réels par pays, péages) : clé gratuite openrouteservice (compte sur openrouteservice.org, usage interne) :"
    echo "# ITINERAIRE_CLE=votre-cle-openrouteservice"
    echo "# Alertes de l'équipe sur téléphone (gratuit) : NTFY_URL=https://ntfy.sh/un-sujet-difficile-a-deviner"
  } > "$ENVF"
  chmod 600 "$ENVF"
  [ -z "${DOMAINE:-}" ] && sed -i 's/^HOTE=127.0.0.1/HOTE=0.0.0.0/' "$ENVF"   # sans https devant, le relais écoute sur le réseau
  echo "Créée, avec des jetons et une clé de chiffrement tirés au hasard."
fi

dire "4. Service (démarre avec la machine, redémarre en cas d'arrêt)"
cat > "$UNITE" <<UNIT
[Unit]
Description=Relais Logistique Fret
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=/etc/logistique-fret.env
WorkingDirectory=/opt/logistique-fret
ExecStart=$(command -v node || echo /usr/bin/node) serveur/relais.js
Restart=always
RestartSec=5
DynamicUser=yes
StateDirectory=logistique-fret
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT
if essai; then echo "(essai) systemctl enable --now logistique-fret"; else systemctl daemon-reload && systemctl enable --now logistique-fret && systemctl restart logistique-fret; fi

if [ -n "${DOMAINE:-}" ]; then
  dire "5. https pour $DOMAINE (Caddy, certificat gratuit)"
  CADDYF="$RACINE/etc/caddy/Caddyfile"; mkdir -p "$(dirname "$CADDYF")"
  if essai; then echo "(essai) apt-get install -y caddy"; else command -v caddy >/dev/null 2>&1 || apt-get install -y caddy; fi
  printf '%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$DOMAINE" "$PORT" > "$CADDYF"
  if essai; then echo "(essai) systemctl reload caddy"; else systemctl enable --now caddy && systemctl reload caddy; fi
  echo "Ouvrez les ports 80 et 443 de votre box vers cette machine (redirection de ports), si ce n'est pas déjà fait."
fi

dire "Terminé"
ADRESSE="${DOMAINE:+https://$DOMAINE}"; ADRESSE="${ADRESSE:-http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT}"
echo "Adresse du relais : $ADRESSE"
echo "Jeton de lecture (à saisir dans l'application, page Carte → Relais) : $(grep '^JETON_LECTURE=' "$ENVF" | cut -d= -f2)"
echo "Jeton d'écriture (balises GPS, Traccar) : $(grep '^JETON_ECRITURE=' "$ENVF" | cut -d= -f2)"
essai || echo "Vérifier : curl -s http://127.0.0.1:$PORT/sante   ·   Journal : journalctl -u logistique-fret -f"
echo "Sauvegarde : copiez $DONNEES et $ENVF (la clé CLE_DONNEES est indispensable pour relire des données chiffrées)."
