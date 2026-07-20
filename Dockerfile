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
# Keep the account database on a mounted volume so redeploys don't wipe users.
ENV USERS_DB=/data/users.db
EXPOSE 8030

CMD ["node", "server/server.js"]
