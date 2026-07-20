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

- Users + Elo persist in `server/users.json`. Tokens are in memory (restart = re-login).
- Passwords are bcrypt-hashed. This is a hobby server: run it behind a tunnel's HTTPS, don't expose port 8030 raw to the internet.
- Pacing is tunable: `BOT_MS`, `RESOLVE_MS`, `NEXT_MS` (ms) env vars.
- If a player drops, a stand-in bot plays their seat until they reconnect (same account + room code).
