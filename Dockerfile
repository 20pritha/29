# Twenty-Nine — single container that serves the web client AND the WebSocket
# game server. Works on Render / Railway / Fly.io / any VPS.
#
# Node 22+ is REQUIRED: the user store uses the built-in `node:sqlite` module.
FROM node:22-alpine

WORKDIR /app

# install server deps first so this layer caches
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# app source (client files live at the repo root, server/ holds the backend)
COPY . .

# Hosts inject PORT; the server falls back to 8030 locally.
ENV PORT=8030
# Account database location. If a persistent disk is mounted at /data it is kept
# across deploys; if no disk is attached the app still starts (the directory is
# created in the container) but accounts reset on redeploy.
ENV USERS_DB=/data/users.db
RUN mkdir -p /data
EXPOSE 8030

CMD ["node", "server/server.js"]
