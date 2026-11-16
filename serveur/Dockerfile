# Relais Logistique Fret — construire depuis la racine du dépôt :
#   docker build -f serveur/Dockerfile -t logistique-relais .
#   docker run -d --name relais --restart unless-stopped -p 8787:8787 -v relais-donnees:/donnees --env-file relais.env logistique-relais
# L'image contient l'application entière : le relais la sert en mode multi-utilisateur, et charge noyau.js, prevision.js, comptes.js… pour calculer comme elle.
FROM node:20-alpine
WORKDIR /app
COPY . .
ENV DONNEES=/donnees PORT=8787 HOTE=0.0.0.0
RUN mkdir -p /donnees && chown node:node /donnees
VOLUME /donnees
EXPOSE 8787
USER node
HEALTHCHECK --interval=60s --timeout=5s --retries=3 CMD wget -q -O- http://127.0.0.1:8787/sante >/dev/null 2>&1 || exit 1
CMD ["node", "serveur/relais.js"]
