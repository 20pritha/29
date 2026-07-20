/**
 * @file SQLite-backed user store using Node's built-in `node:sqlite` — no
 * external service, no native dependency, no API key. One file on disk that
 * survives restarts and redeploys (mount it on a persistent volume in prod).
 *
 * Accounts are stored one row per user; the flexible `stats` blob is kept as
 * JSON so the game's stat shape can evolve without schema migrations.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_FILE = process.env.USERS_DB || path.join(__dirname, 'users.db');
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    name_lower TEXT NOT NULL UNIQUE,
    pass_hash  TEXT,
    stats      TEXT NOT NULL
  );
`);

// Full game records: seed + action log make any match exactly replayable, and
// `version` records which rule set produced it.
db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id         TEXT PRIMARY KEY,
    version    INTEGER NOT NULL,
    seed       INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    winner     INTEGER,
    players    TEXT NOT NULL,
    log        TEXT NOT NULL
  );
`);

const insertGameStmt = db.prepare(`
  INSERT OR REPLACE INTO games (id, version, seed, created_at, winner, players, log)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

/**
 * Persist a completed match for replay/analysis.
 * @param {{id:string,version:number,seed:number,createdAt:number,winner:number|null,players:any[],log:any[]}} g
 */
function saveGame(g) {
  insertGameStmt.run(g.id, g.version, g.seed, g.createdAt, g.winner,
    JSON.stringify(g.players), JSON.stringify(g.log));
}

/** Load a stored match (log parsed) for replay. @param {string} id */
function getGame(id) {
  const r = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  if (!r) return null;
  return { ...r, players: JSON.parse(r.players), log: JSON.parse(r.log) };
}

/** @returns {number} stored match count. */
function gameCount() { return db.prepare('SELECT COUNT(*) AS c FROM games').get().c; }

const upsertStmt = db.prepare(`
  INSERT INTO users (id, name, name_lower, pass_hash, stats)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, name_lower = excluded.name_lower,
    pass_hash = excluded.pass_hash, stats = excluded.stats
`);

/**
 * Insert or update one account.
 * @param {{id:string,name:string,passHash:string|null,stats:object}} u
 */
function upsertUser(u) {
  upsertStmt.run(u.id, u.name, u.name.toLowerCase(), u.passHash ?? null, JSON.stringify(u.stats));
}

/**
 * Load every account into the in-memory maps the server uses.
 * @returns {{ users: Record<string,object>, nameIndex: Record<string,string> }}
 */
function loadAllUsers() {
  const rows = db.prepare('SELECT id, name, pass_hash, stats FROM users').all();
  const users = {}, nameIndex = {};
  for (const r of rows) {
    users[r.id] = { id: r.id, name: r.name, passHash: r.pass_hash, stats: JSON.parse(r.stats) };
    nameIndex[r.name.toLowerCase()] = r.id;
  }
  return { users, nameIndex };
}

/** @returns {number} number of stored accounts. */
function count() { return db.prepare('SELECT COUNT(*) AS c FROM users').get().c; }

module.exports = { db, upsertUser, loadAllUsers, count, saveGame, getGame, gameCount, DB_FILE };
