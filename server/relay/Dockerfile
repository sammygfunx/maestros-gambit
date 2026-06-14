FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY relay_server.js ./

ENV MG_RELAY_HOST=0.0.0.0
EXPOSE 8911

CMD ["node", "relay_server.js"]
