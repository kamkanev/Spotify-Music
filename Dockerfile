FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node app.js ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node views ./views

USER node
EXPOSE 5050
CMD ["node", "app.js"]
