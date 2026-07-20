# Twenty-Nine server

Local Node server for online play: accounts, rooms, ranked (Elo), chat. No cloud, no API keys. Serves the solo app too.

## Run

```bash
cd server
npm install      # first time
npm start        # → http://localhost:8030
```

Open in a browser:
- Online: http://localhost:8030/online.html
- Solo:   http://localhost:8030/index.html

## Play with people on the same wifi (LAN)

The server listens on all interfaces. Find your machine's LAN IP:

```bash
ipconfig getifaddr en0   # macOS wifi
```

Others on the same network open `http://<that-ip>:8030/online.html`, register, and join your room code.

## Deploying

**Vercel / Netlify / GitHub Pages will NOT work for online play.** They are static or
serverless hosts — they cannot keep a WebSocket connection open or hold room state in
memory. The page loads but every account action fails with "Not connected".
(`solo.html` still works on those hosts, since it needs no server at all.)

Deploy to a host that runs a persistent Node process:

**Render** — a blueprint is included:
1. Push the repo to GitHub.
2. Render → New → Blueprint → pick the repo (it reads `render.yaml`).
3. Deploy. One URL serves both the site and the WebSocket.

**Railway / Fly.io / any VPS** — use the included `Dockerfile`:
```bash
docker build -t twentynine .
docker run -p 8030:8030 -v twentynine-data:/data twentynine
```

Requirements:
- **Node 22.5+** (the user store uses the built-in `node:sqlite`). The Dockerfile pins this.
- Mount a volume and set `USERS_DB` to a path on it (e.g. `/data/users.db`), or accounts
  and ratings reset on every redeploy.
- The host provides `PORT`; the server reads it automatically.

### Keeping the front end on Vercel (optional)
If you want the site on Vercel and only the game server elsewhere, point the client at
the backend once:
```
https://your-site.vercel.app/?server=your-app.onrender.com
```
It is remembered in local storage. You can also set it permanently by editing
`window.TWENTYNINE_SERVER` in `config.js`. Simpler option: just use the backend URL for
everything — it already serves the whole site.

## Play with friends over the internet (tunnel)

No deploy needed — expose your local server with a tunnel:

```bash
# option A: ngrok (https://ngrok.com, free tier)
ngrok http 8030
# → gives a public https URL; share <url>/online.html

# option B: cloudflared (no signup)
cloudflared tunnel --url http://localhost:8030
```

The client uses `wss://` automatically when loaded over `https://`, so tunnels work as-is.

`server/tunnel.sh` runs ngrok for you if it's installed.

## Notes / limits (MVP)

- Accounts + Elo persist in a **SQLite** database at `server/users.db` (via Node's
  built-in `node:sqlite` — no external service, no native build). Survives restarts.
  On deploy, mount `users.db` on a persistent volume so redeploys don't wipe it.
  A legacy `server/users.json` is auto-imported once on first boot if present.
  Tokens are in memory (restart = re-login with password; the account persists).
- Passwords are bcrypt-hashed. This is a hobby server: run it behind a tunnel's HTTPS, don't expose port 8030 raw to the internet.
- Pacing is tunable: `BOT_MS`, `RESOLVE_MS`, `NEXT_MS` (ms) env vars.
- If a player drops, a stand-in bot plays their seat until they reconnect (same account + room code).
