// Twenty-Nine online server: accounts + rooms + real-time play.
// - Auth: register/login with bcrypt (async), users persisted to users.json,
//   tokens in memory. Auth attempts are rate-limited per connection.
// - Rooms: in-memory, 4 seats (humans or bots), server-authoritative game.
// - Engine: a fresh instance of the *existing* browser engine per room, loaded via
//   vm from ../cards.js + ../game.js + ../ai.js (those files are never modified).
// - HTTP static serving explicitly blocks the server directory so password
//   hashes (users.json) can never be downloaded.
// No external services, no API keys.
//
// @typedef {{ userId?: string, name: string, bot?: boolean, ws?: object|null,
//             disconnected?: boolean }} Seat
// @typedef {{ code: string, hostSeat: number, seats: (Seat|null)[], engine: object|null,
//             started: boolean, rated?: boolean, timers: object }} Room
// @typedef {{ seat: number, name: string|null, bot: boolean, rating: number|null,
//             connected: boolean, team: number }} SeatInfo

const http = require('http');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { WebSocketServer } = require('ws');
const store = require('./db'); // SQLite-backed user store

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 8030;
const USERS_FILE = path.join(__dirname, 'users.json');

// Pacing (ms). Overridable via env so tests can run fast.
const BOT_MS = +process.env.BOT_MS || 900;
const RESOLVE_MS = +process.env.RESOLVE_MS || 1300;
const NEXT_MS = +process.env.NEXT_MS || 4500;
// How long an in-progress room survives with zero connected humans before it is
// torn down (players get this long to reconnect). Prevents abandoned games from
// running bots forever.
const ABANDON_MS = +process.env.ABANDON_MS || 120000;
// Session token lifetime.
const TOKEN_TTL_MS = +process.env.TOKEN_TTL_MS || 30 * 24 * 3600 * 1000;

// ---------- engine loader (per-room isolated instance) ----------
const ENGINE_SRC = ['cards.js', 'game.js', 'ai.js']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
  .join('\n');

function makeEngine() {
  const sandbox = { Math, JSON, console };
  vm.createContext(sandbox);
  vm.runInContext(ENGINE_SRC + '\nthis.__e = { G: Game, AI: AI };', sandbox);
  return sandbox.__e; // { G, AI }
}

// ---------- user store ----------
let users = {};        // userId -> { id, name, passHash }
let nameIndex = {};    // lowercased name -> userId
function defaultStats() {
  return {
    rating: 0, games: 0, wins: 0, losses: 0, // rating = trophies, everyone starts at Bronze 0
    xp: 0, coins: 0, gems: 0, streak: 0, bestStreak: 0, lastDaily: 0,
    highestBid: 0, matches: [], friends: [], // matches/friends are capped lists
  };
}
function leaderboard() {
  return Object.values(users)
    .filter((u) => !u.guest) // ranked board: real accounts only
    .sort((a, b) => b.stats.rating - a.stats.rating)
    .slice(0, 10)
    .map((u, i) => ({ rank: i + 1, name: u.name, rating: u.stats.rating }));
}
/**
 * A user's friends with live presence.
 * @param {string} userId @returns {{name:string, online:boolean, trophies:number}[]}
 */
function friendList(userId) {
  const u = users[userId];
  if (!u) return [];
  const onlineNames = new Set(onlinePlayers());
  return (u.stats.friends || []).map((name) => {
    const fid = nameIndex[name.toLowerCase()];
    return {
      name,
      online: onlineNames.has(name),
      trophies: fid && users[fid] ? users[fid].stats.rating : 0,
    };
  });
}

function onlinePlayers() {
  const names = [];
  for (const ws of wss.clients) if (ws.userId && users[ws.userId]) names.push(users[ws.userId].name);
  return [...new Set(names)].slice(0, 12);
}
// One-time import: if the DB is empty but a legacy users.json exists, migrate it.
function migrateFromJson() {
  if (store.count() > 0) return;
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const legacy = data.users || {};
    let n = 0;
    for (const id in legacy) {
      if (legacy[id].guest) continue;
      legacy[id].stats = Object.assign(defaultStats(), legacy[id].stats || {});
      store.upsertUser(legacy[id]);
      n++;
    }
    if (n) console.log('migrated ' + n + ' account(s) from users.json → SQLite');
  } catch (e) { /* no legacy file: nothing to migrate */ }
}

function loadUsers() {
  migrateFromJson();
  const loaded = store.loadAllUsers();
  users = loaded.users;
  nameIndex = loaded.nameIndex;
  // backfill any missing fields on older accounts
  for (const id in users) users[id].stats = Object.assign(defaultStats(), users[id].stats || {});
}

/** Persist a single account (guests are ephemeral and never written). */
function persistUser(id) {
  const u = users[id];
  if (u && !u.guest) store.upsertUser(u);
}
loadUsers();

const tokens = new Map(); // token -> { userId, exp }

function issueToken(userId) {
  const tok = crypto.randomBytes(24).toString('hex');
  tokens.set(tok, { userId, exp: Date.now() + TOKEN_TTL_MS });
  return tok;
}
/** Resolve a token to a userId, honouring expiry. @returns {string|null} */
function userIdForToken(tok) {
  const rec = tokens.get(tok);
  if (!rec) return null;
  if (rec.exp <= Date.now()) { tokens.delete(tok); return null; }
  return rec.userId;
}
/** Drop every token belonging to a user (used when a guest is reaped). */
function purgeTokensFor(userId) {
  for (const [tok, rec] of tokens) if (rec.userId === userId) tokens.delete(tok);
}
// Periodic sweep so expired tokens don't accumulate.
setInterval(() => {
  const now = Date.now();
  for (const [tok, rec] of tokens) if (rec.exp <= now) tokens.delete(tok);
}, 3600 * 1000).unref?.();

// ---------- rooms ----------
const rooms = new Map(); // code -> room
function makeRoomCode() {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 4 }, () => alpha[Math.floor(Math.random() * alpha.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function newRoom(hostUserId, hostName) {
  const code = makeRoomCode();
  const room = {
    code,
    hostSeat: 0,
    seats: [null, null, null, null], // { userId, name, bot, ws }
    engine: null,
    started: false,
    timers: { bot: null, resolve: null, next: null },
  };
  room.seats[0] = { userId: hostUserId, name: hostName, bot: false, ws: null };
  rooms.set(code, room);
  return room;
}

function seatOfUser(room, userId) {
  return room.seats.findIndex((s) => s && !s.bot && s.userId === userId);
}
/** How many human seats currently have a live socket. */
function humansConnected(room) {
  return room.seats.filter((s) => s && !s.bot && s.ws && s.ws.readyState === 1).length;
}
/** Is this user seated in any room right now? */
function isSeatedAnywhere(userId) {
  for (const room of rooms.values()) if (seatOfUser(room, userId) >= 0) return true;
  return false;
}
function clearRoomTimers(room) {
  for (const k of ['bot', 'resolve', 'next']) {
    if (room.timers[k]) { clearTimeout(room.timers[k]); room.timers[k] = null; }
  }
}
/** Is any live socket authenticated as this user? */
function isConnected(userId) {
  for (const c of wss.clients) if (c.userId === userId && c.readyState === 1) return true;
  return false;
}
/** Delete an ephemeral guest account once it is gone for good. */
function reapGuest(userId) {
  const u = users[userId];
  if (u && u.guest && !isSeatedAnywhere(userId) && !isConnected(userId)) {
    purgeTokensFor(userId);
    delete users[userId];
  }
}
function destroyRoom(room) {
  clearRoomTimers(room);
  if (room.abandonTimer) { clearTimeout(room.abandonTimer); room.abandonTimer = null; }
  const occupants = room.seats.filter((s) => s && !s.bot && s.userId).map((s) => s.userId);
  room.engine = null;
  rooms.delete(room.code);
  occupants.forEach(reapGuest); // their seat is gone now
}
/** Everyone dropped: stop simulating and reap the room unless someone returns. */
function scheduleAbandonCleanup(room) {
  clearRoomTimers(room); // stop running bots for an empty room
  if (room.abandonTimer) return;
  room.abandonTimer = setTimeout(() => {
    room.abandonTimer = null;
    if (humansConnected(room) === 0) destroyRoom(room);
  }, ABANDON_MS);
  room.abandonTimer.unref?.();
}
function cancelAbandonCleanup(room) {
  if (room.abandonTimer) { clearTimeout(room.abandonTimer); room.abandonTimer = null; }
}
function firstEmptySeat(room) {
  return room.seats.findIndex((s) => s === null);
}
function seatsFilled(room) {
  return room.seats.every((s) => s !== null);
}

// ---------- per-player game view ----------
function viewFor(room, seat) {
  const G = room.engine.G;
  const seats = seatInfo(room);
  const v = {
    t: 'state',
    code: room.code,
    you: seat,
    hostSeat: room.hostSeat,
    started: room.started,
    seats,
    phase: G.phase,
    turn: G.turn,
    dealer: G.dealer,
    matchPoints: G.matchPoints,
    highBid: G.highBid,
    highBidder: G.highBidder,
    passed: G.passed,
    trumpRevealed: G.trumpRevealed,
    ledSuit: G.ledSuit,
    plays: G.plays,
    trickCount: G.trickCount,
    roundCardPoints: G.roundCardPoints,
    narration: G.narration,
    lastResult: G.lastResult || null,
    gameWinner: (G.gameWinner != null) ? G.gameWinner : null,
    hand: (G.players && G.players[seat]) ? G.players[seat].hand : [],
    // trump only visible to the bidder (their own choice) or once revealed
    trumpSuit: (G.trumpRevealed || seat === G.highBidder) ? G.trumpSuit : null,
  };
  // While a completed trick is resolving, nobody may act (turn still points at
  // the player who laid the 4th card). Don't advertise any moves.
  const resolving = !!G._pendingResolve;
  if (!resolving && G.phase === 'play' && G.turn === seat) {
    v.legal = G.legalCards(seat).map((c) => c.id);
    v.canReveal = G.canRevealTrump(seat);
    v.mustPlayTrump = G.mustPlayTrump;
  }
  if (!resolving && G.phase === 'bidding' && G.turn === seat) {
    v.canBid = true;
    v.minBid = Math.max(16, G.highBid + 1);
  }
  if (!resolving && G.phase === 'chooseTrump' && G.turn === seat) {
    v.trumpChoices = G.trumpChoices();
  }
  v.resolving = resolving;
  return v;
}

/**
 * Send a JSON object to a socket if it is open.
 * @param {import('ws')} ws @param {object} obj
 */
function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

/**
 * Public seat descriptors for lobby/state broadcasts (no hands, no sockets).
 * @param {Room} room @returns {SeatInfo[]}
 */
function seatInfo(room) {
  return room.seats.map((s, i) => ({
    seat: i,
    // Explicit emptiness: the client must not have to infer it from a null name
    // (every entry is an object, so a falsy check would call empty seats "filled").
    empty: !s,
    name: s ? s.name : null,
    bot: s ? !!s.bot : false,
    rating: (s && !s.bot) ? users[s.userId].stats.rating : null,
    connected: !!(s && !s.bot && s.ws && s.ws.readyState === 1),
    team: i % 2,
  }));
}

/**
 * Send a successful auth payload for a user.
 * @param {import('ws')} ws @param {string} id @param {string} token
 */
function sendAuthOk(ws, id, token) {
  const u = users[id];
  send(ws, { t: 'authOk', user: u.name, token, stats: u.stats, guest: !!u.guest });
}

/**
 * Per-connection auth rate limit: at most 20 auth attempts per rolling minute.
 * Blunts password brute-force and account-spam over a single socket. (Behind a
 * proxy, add IP-based limiting too — one client can open many sockets.)
 * @param {import('ws')} ws @returns {boolean} true if the attempt is allowed
 */
/**
 * Generic per-connection sliding-window rate limit.
 * @param {object} ws @param {string} key bucket name
 * @param {number} max allowed events per window @param {number} windowMs
 * @returns {boolean} true if allowed
 */
function rateLimit(ws, key, max, windowMs) {
  const now = Date.now();
  ws._rl = ws._rl || {};
  const arr = (ws._rl[key] || []).filter((t) => now - t < windowMs);
  ws._rl[key] = arr;
  if (arr.length >= max) return false;
  arr.push(now);
  return true;
}

/**
 * Make sure hostSeat points at a connected human. Without this, a host that
 * drops mid-game leaves the room permanently hostless — no rematch, no start.
 * @param {Room} room
 */
function reassignHost(room) {
  const cur = room.seats[room.hostSeat];
  if (cur && !cur.bot && cur.ws && cur.ws.readyState === 1) return; // still fine
  const next = room.seats.findIndex((s) => s && !s.bot && s.ws && s.ws.readyState === 1);
  if (next >= 0) room.hostSeat = next;
}

function authThrottle(ws) {
  const now = Date.now();
  ws._authHits = (ws._authHits || []).filter((t) => now - t < 60000);
  if (ws._authHits.length >= 20) return false;
  ws._authHits.push(now);
  return true;
}

function broadcastLobby(room) {
  const seats = seatInfo(room);
  const msg = {
    t: 'room', code: room.code, hostSeat: room.hostSeat, started: room.started, seats,
    public: !!room.public,
    filled: seats.filter((s) => !s.empty).length, // server is the source of truth
  };
  for (const s of room.seats) if (s && !s.bot) send(s.ws, msg);
}

function broadcastState(room) {
  for (let i = 0; i < 4; i++) {
    const s = room.seats[i];
    if (s && !s.bot && s.ws) send(s.ws, viewFor(room, i));
  }
}

// ---------- game driving ----------
function startGame(room) {
  if (room.started) return;
  if (!seatsFilled(room)) return;
  room.engine = makeEngine();
  room.started = true;
  room.rated = false;
  const G = room.engine.G;
  G.onChange(() => onEngineChange(room));
  G.newGame();
}

/**
 * Team-based Elo update at game end. Bots count as rating 1000; only human
 * seats are updated and persisted. Also awards XP/coins, updates streaks, and
 * records a match-history row. Sends each human their new stats.
 * @param {Room} room
 */
// Team-based Elo. Bots count as rating 1000. Only humans are updated/persisted.
function ratingOf(room, seat) {
  const s = room.seats[seat];
  if (!s || s.bot) return 1000;
  return users[s.userId].stats.rating;
}
function updateRatings(room) {
  const G = room.engine.G;
  const winner = G.gameWinner; // 0 or 1

  // Archive the whole match: seed + action log make it exactly replayable later
  // (bug reports, replays, future coach analysis).
  const gameId = crypto.randomUUID();
  try {
    store.saveGame({
      id: gameId, version: G.version, seed: G.seed, createdAt: Date.now(), winner,
      players: room.seats.map((s) => (s ? (s.bot ? { bot: true, name: s.name } : { userId: s.userId, name: s.name }) : null)),
      log: G.actionLog,
    });
  } catch (e) { console.error('saveGame', e.message); }
  // Trophies: every completed game awards them, so a player always moves
  // forward. Winning is worth much more than taking part.
  const TROPHY_WIN = 30, TROPHY_LOSS = 10;
  for (let i = 0; i < 4; i++) {
    const s = room.seats[i];
    if (!s || s.bot) continue;
    const t = i % 2;
    const score = (winner === t) ? 1 : 0;
    const st = users[s.userId].stats;
    const before = st.rating;
    st.rating += score ? TROPHY_WIN : TROPHY_LOSS;
    st.games += 1;
    if (score) { st.wins += 1; st.streak += 1; if (st.streak > st.bestStreak) st.bestStreak = st.streak; }
    else { st.losses += 1; st.streak = 0; }
    // progression: XP + coins, with a win bonus
    const xpGain = 40 + (score ? 80 : 0);
    const coinGain = 15 + (score ? 25 : 0);
    st.xp += xpGain; st.coins += coinGain;
    s._delta = st.rating - before;
    s._xpGain = xpGain; s._coinGain = coinGain;
    // match history row
    const pSeat = (i + 2) % 4;
    const partner = room.seats[pSeat] ? (room.seats[pSeat].bot ? 'Bot' : room.seats[pSeat].name) : '—';
    const bid = G.highBid || 0;
    if (bid > st.highestBid) st.highestBid = bid;
    st.matches.unshift({
      r: score ? 'W' : 'L', bid,
      made: G.lastResult ? !!G.lastResult.made : false,
      delta: s._delta, partner, at: Date.now(),
      gameId, seed: G.seed, version: G.version, // replayable reference
    });
    st.matches = st.matches.slice(0, 12);
    persistUser(s.userId);
  }
  for (let i = 0; i < 4; i++) {
    const s = room.seats[i];
    if (s && !s.bot && s.ws) {
      const st = users[s.userId].stats;
      send(s.ws, {
        t: 'stats', delta: s._delta || 0, xpGain: s._xpGain || 0, coinGain: s._coinGain || 0,
        stats: st,
      });
    }
  }
}

function onEngineChange(room) {
  const G = room.engine.G;
  broadcastState(room);
  // Don't burn timers simulating a game nobody is watching.
  if (humansConnected(room) === 0) { scheduleAbandonCleanup(room); return; }

  if (G._pendingResolve) {
    if (!room.timers.resolve) {
      room.timers.resolve = setTimeout(() => {
        room.timers.resolve = null;
        G.resolveTrick();
      }, RESOLVE_MS);
    }
    return;
  }
  if (G.phase === 'roundEnd') {
    if (!room.timers.next) {
      room.timers.next = setTimeout(() => {
        room.timers.next = null;
        if (G.phase === 'roundEnd') G.nextRound();
      }, NEXT_MS);
    }
    return;
  }
  if (G.phase === 'gameOver') {
    if (!room.rated) { room.rated = true; try { updateRatings(room); } catch (e) { console.error('rating', e); } }
    room.started = false;
    return;
  }

  const seat = G.turn;
  const standIn = room.seats[seat] && (room.seats[seat].bot || room.seats[seat].disconnected);
  if (['bidding', 'chooseTrump', 'play'].includes(G.phase) && standIn) {
    if (!room.timers.bot) {
      room.timers.bot = setTimeout(() => { room.timers.bot = null; botAct(room); }, BOT_MS);
    }
  }
}

function botAct(room) {
  if (!room.engine) return;
  const G = room.engine.G, AI = room.engine.AI;
  const seat = G.turn;
  const s = room.seats[seat];
  if (!s || (!s.bot && !s.disconnected)) return; // only bots / dropped players
  if (G._pendingResolve) return;
  if (G.phase === 'bidding') {
    const d = AI.bid(seat);
    if (d.action === 'bid') G.placeBid(seat, d.amount); else G.passBid(seat);
  } else if (G.phase === 'chooseTrump') {
    G.chooseTrump(AI.chooseTrump(seat));
  } else if (G.phase === 'play') {
    const m = AI.play(seat);
    if (m.reveal) G.revealTrump(seat);
    G.playCard(seat, m.cardId);
  }
}

function applyAction(room, seat, a) {
  if (!room.started || !room.engine) return;
  const G = room.engine.G;
  if (G._pendingResolve) return; // trick resolving; ignore stray actions
  switch (a.action) {
    case 'bid': G.placeBid(seat, a.amount | 0); break;
    case 'pass': G.passBid(seat); break;
    case 'trump': G.chooseTrump(a.suit); break;
    case 'reveal': G.revealTrump(seat); break;
    case 'play': G.playCard(seat, a.cardId); break;
  }
}

/**
 * Remove this socket from whatever room it is currently in. Called before
 * creating/joining another room so a user never holds two seats (which used to
 * keep the old room alive forever).
 */
function leaveCurrentRoom(ws) {
  if (!ws.room || !rooms.has(ws.room)) { ws.room = null; return; }
  handleDisconnect(ws);
  ws.room = null;
}

// If a human disconnects mid-game, hand their seat to a bot so play continues.
function handleDisconnect(ws) {
  const room = ws.room && rooms.get(ws.room);
  if (!room) return;
  const seat = seatOfUser(room, ws.userId);
  if (seat < 0) return;
  if (room.started) {
    // Keep the seat reserved; a stand-in bot plays until the human reconnects.
    room.seats[seat].ws = null;
    room.seats[seat].disconnected = true;
    if (humansConnected(room) === 0) {
      // Nobody left watching: stop simulating and reap the room after a grace period.
      scheduleAbandonCleanup(room);
    } else {
      reassignHost(room); // the host may have been the one who left
      broadcastState(room);
      onEngineChange(room); // nudge stand-in if it's their turn
    }
  } else {
    room.seats[seat] = null;
    if (seat === room.hostSeat) {
      const nextHuman = room.seats.findIndex((s) => s && !s.bot);
      if (nextHuman >= 0) room.hostSeat = nextHuman;
    }
    if (room.seats.every((s) => s === null)) rooms.delete(room.code);
    else broadcastLobby(room);
  }
}

// ---------- message handling ----------
function authUser(ws, userId) {
  const u = users[userId];
  ws.userId = userId;
  ws.name = u.name;
}

/**
 * Handle one inbound WebSocket message. Async because password hashing/compare
 * is awaited (never blocks the event loop). Unknown/oversized/invalid messages
 * are ignored.
 * @param {import('ws')} ws @param {string} raw @returns {Promise<void>}
 */
async function onMessage(ws, raw) {
  let m;
  try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || typeof m.t !== 'string') return;

  // ----- auth (rate-limited; bcrypt awaited so it never blocks the loop) -----
  if (m.t === 'register') {
    if (!authThrottle(ws)) return send(ws, { t: 'authErr', msg: 'Too many attempts, wait a minute' });
    const name = String(m.user || '').trim();
    const pass = String(m.pass || '');
    if (name.length < 2 || name.length > 20) return send(ws, { t: 'authErr', msg: 'Name 2-20 chars' });
    // reserved: guest accounts are auto-named Guest-XXXX; block impersonation
    if (/^guest-/i.test(name)) return send(ws, { t: 'authErr', msg: 'That name prefix is reserved' });
    if (pass.length < 4 || pass.length > 128) return send(ws, { t: 'authErr', msg: 'Password must be 4-128 chars' });
    if (nameIndex[name.toLowerCase()]) return send(ws, { t: 'authErr', msg: 'Name taken' });
    const passHash = await bcrypt.hash(pass, 10);
    if (nameIndex[name.toLowerCase()]) return send(ws, { t: 'authErr', msg: 'Name taken' }); // re-check after await
    const id = crypto.randomUUID();
    users[id] = { id, name, passHash, stats: defaultStats() };
    nameIndex[name.toLowerCase()] = id;
    persistUser(id);
    authUser(ws, id);
    return sendAuthOk(ws, id, issueToken(id));
  }
  if (m.t === 'login') {
    if (!authThrottle(ws)) return send(ws, { t: 'authErr', msg: 'Too many attempts, wait a minute' });
    const id = nameIndex[String(m.user || '').trim().toLowerCase()];
    const pass = String(m.pass || '').slice(0, 128);
    const ok = !!id && await bcrypt.compare(pass, users[id].passHash || '');
    if (!ok) return send(ws, { t: 'authErr', msg: 'Wrong name or password' }); // generic: no account enumeration
    authUser(ws, id);
    return sendAuthOk(ws, id, issueToken(id));
  }
  if (m.t === 'auth') { // token reconnect
    const id = userIdForToken(String(m.token || ''));
    if (!id || !users[id]) return send(ws, { t: 'authErr', msg: 'Session expired' });
    authUser(ws, id);
    return sendAuthOk(ws, id, m.token);
  }
  if (m.t === 'guest') { // ephemeral account, in-memory only (not saved to disk)
    if (!authThrottle(ws)) return send(ws, { t: 'authErr', msg: 'Too many attempts, wait a minute' });
    const id = crypto.randomUUID();
    users[id] = { id, name: 'Guest-' + id.slice(0, 4).toUpperCase(), passHash: null, stats: defaultStats(), guest: true };
    authUser(ws, id);
    return sendAuthOk(ws, id, issueToken(id));
  }

  if (!ws.userId || !users[ws.userId]) return send(ws, { t: 'error', msg: 'Not authenticated' });

  // ----- rooms -----
  // Real matchmaking: drop into any waiting public room, otherwise open one.
  // This is what makes "Play Online" different from "Play with Friends".
  if (m.t === 'quickMatch') {
    if (!rateLimit(ws, 'createRoom', 5, 60000)) return send(ws, { t: 'error', msg: 'Slow down' });
    for (const room of rooms.values()) {
      if (room.started || !room.public) continue;
      if (seatOfUser(room, ws.userId) >= 0) continue;
      const seat = firstEmptySeat(room);
      if (seat < 0) continue;
      leaveCurrentRoom(ws);
      room.seats[seat] = { userId: ws.userId, name: ws.name, bot: false, ws };
      ws.room = room.code;
      cancelAbandonCleanup(room);
      send(ws, { t: 'joined', code: room.code, seat, matched: true, public: true });
      broadcastLobby(room);
      return;
    }
    // nothing open — host a public room others can be matched into
    leaveCurrentRoom(ws);
    const room = newRoom(ws.userId, ws.name);
    room.public = true;
    room.seats[0].ws = ws;
    ws.room = room.code;
    send(ws, { t: 'joined', code: room.code, seat: 0, matched: true, public: true });
    return broadcastLobby(room);
  }

  if (m.t === 'createRoom') {
    if (!rateLimit(ws, 'createRoom', 5, 60000)) return send(ws, { t: 'error', msg: 'Slow down — too many rooms' });
    leaveCurrentRoom(ws); // never hold a seat in two rooms (leaks the old one)
    const room = newRoom(ws.userId, ws.name);
    room.seats[0].ws = ws;
    ws.room = room.code;
    send(ws, { t: 'joined', code: room.code, seat: 0 });
    return broadcastLobby(room);
  }
  if (m.t === 'joinRoom') {
    const code = String(m.code || '').toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) return send(ws, { t: 'error', msg: 'Invalid room code' });
    const room = rooms.get(code);
    if (!room) return send(ws, { t: 'error', msg: 'Room not found' });
    if (room.started) return send(ws, { t: 'error', msg: 'Game already started' });
    if (ws.room !== room.code) leaveCurrentRoom(ws); // drop the previous room first
    // already seated? reconnect
    let seat = seatOfUser(room, ws.userId);
    if (seat < 0) {
      seat = firstEmptySeat(room);
      if (seat < 0) return send(ws, { t: 'error', msg: 'Room full' });
      room.seats[seat] = { userId: ws.userId, name: ws.name, bot: false, ws };
    } else {
      room.seats[seat].ws = ws;
    }
    ws.room = room.code;
    send(ws, { t: 'joined', code: room.code, seat });
    return broadcastLobby(room);
  }

  if (m.t === 'home') {
    return send(ws, {
      t: 'home',
      stats: users[ws.userId].stats,
      leaderboard: leaderboard(),
      online: onlinePlayers(),
      friends: friendList(ws.userId),
    });
  }

  if (m.t === 'addFriend') {
    const st = users[ws.userId].stats;
    if (users[ws.userId].guest) return send(ws, { t: 'friends', friends: [], msg: 'Guests cannot add friends — create an account.' });
    const target = String(m.name || '').trim();
    const id = nameIndex[target.toLowerCase()];
    if (!id) return send(ws, { t: 'friends', friends: friendList(ws.userId), msg: 'No player called "' + target + '"' });
    if (id === ws.userId) return send(ws, { t: 'friends', friends: friendList(ws.userId), msg: "That's you!" });
    const name = users[id].name;
    if (st.friends.includes(name)) return send(ws, { t: 'friends', friends: friendList(ws.userId), msg: name + ' is already a friend' });
    st.friends.push(name);
    st.friends = st.friends.slice(0, 100);
    persistUser(ws.userId);
    return send(ws, { t: 'friends', friends: friendList(ws.userId), msg: 'Added ' + name });
  }

  if (m.t === 'removeFriend') {
    const st = users[ws.userId].stats;
    st.friends = (st.friends || []).filter((n) => n !== String(m.name || ''));
    persistUser(ws.userId);
    return send(ws, { t: 'friends', friends: friendList(ws.userId) });
  }

  if (m.t === 'claimDaily') {
    const st = users[ws.userId].stats;
    const now = Date.now();
    const DAY = 12 * 60 * 60 * 1000; // 12h cooldown
    if (now - (st.lastDaily || 0) >= DAY) {
      st.lastDaily = now; st.coins += 100; st.xp += 50;
      persistUser(ws.userId);
      return send(ws, { t: 'daily', granted: true, coins: 100, xp: 50, nextAt: st.lastDaily + DAY, stats: st });
    }
    return send(ws, { t: 'daily', granted: false, nextAt: st.lastDaily + DAY, stats: st });
  }

  if (m.t === 'rejoin') {
    const room = rooms.get(String(m.code || '').toUpperCase());
    if (!room) return send(ws, { t: 'noRoom' });
    const seat = seatOfUser(room, ws.userId);
    if (seat < 0) return send(ws, { t: 'noRoom' });
    room.seats[seat].ws = ws;
    room.seats[seat].disconnected = false;
    ws.room = room.code;
    cancelAbandonCleanup(room); // someone came back — keep the room alive
    send(ws, { t: 'joined', code: room.code, seat });
    if (room.started) { broadcastState(room); onEngineChange(room); } // resume play
    else broadcastLobby(room);
    return;
  }

  const room = ws.room && rooms.get(ws.room);
  if (!room) return;
  const mySeat = seatOfUser(room, ws.userId);

  if (m.t === 'chat') {
    if (!rateLimit(ws, 'chat', 10, 10000)) return; // anti-flood
    const text = String(m.text || '').slice(0, 200).trim();
    if (!text || mySeat < 0) return;
    const from = room.seats[mySeat].name;
    for (const s of room.seats) if (s && !s.bot && s.ws) send(s.ws, { t: 'chat', from, seat: mySeat, text });
    return;
  }
  if (m.t === 'rematch') {
    if (mySeat !== room.hostSeat || room.started) return;
    return startGame(room);
  }

  if (m.t === 'addBot') {
    if (mySeat !== room.hostSeat || room.started) return;
    const seat = Number.isInteger(m.seat) ? m.seat : firstEmptySeat(room);
    if (seat >= 0 && seat < 4 && room.seats[seat] === null) {
      room.seats[seat] = { bot: true, name: 'Bot ' + (seat + 1), ws: null };
      broadcastLobby(room);
    }
    return;
  }
  if (m.t === 'removeSeat') {
    if (mySeat !== room.hostSeat || room.started) return;
    const seat = m.seat;
    if (seat >= 0 && seat < 4 && seat !== room.hostSeat && room.seats[seat] && room.seats[seat].bot) {
      room.seats[seat] = null;
      broadcastLobby(room);
    }
    return;
  }
  if (m.t === 'fillBots') {
    if (mySeat !== room.hostSeat || room.started) return;
    for (let i = 0; i < 4; i++) if (room.seats[i] === null) room.seats[i] = { bot: true, name: 'Bot ' + (i + 1), ws: null };
    return broadcastLobby(room);
  }
  if (m.t === 'start') {
    if (mySeat !== room.hostSeat) return;
    if (!seatsFilled(room)) return send(ws, { t: 'error', msg: 'Fill all 4 seats first' });
    return startGame(room);
  }
  if (m.t === 'action') {
    if (mySeat < 0) return;
    return applyAction(room, mySeat, m);
  }
  if (m.t === 'leave') {
    handleDisconnect(ws);
    ws.room = null;
    return;
  }
}

// ---------- HTTP + WS ----------
const app = express();
// SECURITY: never expose the server directory. It contains the source and
// users.json (bcrypt password hashes). Block it (and dotfiles) before static.
app.use((req, res, next) => {
  if (req.path.startsWith('/server') || req.path.includes('/.')) return res.status(403).end();
  next();
});
app.use(express.static(ROOT, { dotfiles: 'deny' }));
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size, users: Object.keys(users).length }));

const server = http.createServer(app);
// Cap inbound frame size — our messages are tiny; this blocks memory-abuse frames.
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    // onMessage is async; catch both sync throws and async rejections.
    Promise.resolve()
      .then(() => onMessage(ws, data.toString()))
      .catch((e) => { console.error('onMessage', e); send(ws, { t: 'error', msg: 'Server error' }); });
  });
  ws.on('close', () => {
    handleDisconnect(ws);
    // Guests are ephemeral: reap once they're gone and hold no seat (a seated
    // guest is reaped later, when their room is destroyed).
    if (ws.userId) reapGuest(ws.userId);
  });
  ws.on('error', () => {});
});

if (require.main === module) {
  server.listen(PORT, () => console.log('Twenty-Nine server on http://localhost:' + PORT));
}

module.exports = { app, server, makeEngine, rooms, users };
