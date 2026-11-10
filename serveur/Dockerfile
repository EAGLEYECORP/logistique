FROM node:20-alpine
WORKDIR /app
COPY relais.js simulateur.js ./
ENV DONNEES=/donnees PORT=8787
VOLUME /donnees
EXPOSE 8787
USER node
CMD ["node", "relais.js"]
