# Construire depuis la racine du dépôt :  docker build -f serveur/Dockerfile -t relais .
FROM node:20-alpine
WORKDIR /app
COPY data.js noyau.js adm.js gps.js ./
COPY serveur/relais.js serveur/moteur.js serveur/page-client.js serveur/simulateur.js ./serveur/
ENV DONNEES=/donnees PORT=8787
VOLUME /donnees
EXPOSE 8787
USER node
CMD ["node", "serveur/relais.js"]
