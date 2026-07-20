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

module.exports = { db, upsertUser, loadAllUsers, count, DB_FILE };
