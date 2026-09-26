import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";

const DB_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DB_DIR, "kitty.db"));

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_token TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kitty_state (
    user_id INTEGER PRIMARY KEY,
    hunger REAL NOT NULL DEFAULT 60,
    fun REAL NOT NULL DEFAULT 60,
    social REAL NOT NULL DEFAULT 60,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    treats INTEGER NOT NULL DEFAULT 5,
    mood TEXT NOT NULL DEFAULT 'neutral',
    last_interaction INTEGER NOT NULL,
    last_decay INTEGER NOT NULL,
    cosmetics TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, id);

  CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    fact TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, fact),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    covers_up_to_message_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

/* migration: add cosmetics column if it doesn't exist (older DBs) */
const cols = db.prepare("PRAGMA table_info(kitty_state)").all();
if (!cols.some((c) => c.name === "cosmetics")) {
  db.exec(
    "ALTER TABLE kitty_state ADD COLUMN cosmetics TEXT NOT NULL DEFAULT '{}'"
  );
  console.log("🧵 Migrated: added cosmetics column");
}

const MAX_FACTS = 40;

export function getUserByToken(token) {
  let user = db.prepare("SELECT * FROM users WHERE device_token = ?").get(token);
  if (!user) {
    const now = Date.now();
    const info = db
      .prepare("INSERT INTO users (device_token, created_at) VALUES (?, ?)")
      .run(token, now);
    db.prepare(
      "INSERT INTO kitty_state (user_id, last_interaction, last_decay) VALUES (?, ?, ?)"
    ).run(info.lastInsertRowid, now, now);
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  }
  return user;
}

export function getState(userId) {
  return db.prepare("SELECT * FROM kitty_state WHERE user_id = ?").get(userId);
}

export function updateState(userId, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sets = keys.map(k => `${k} = ?`).join(", ");
  const values = keys.map(k => patch[k]);
  db.prepare(`UPDATE kitty_state SET ${sets} WHERE user_id = ?`).run(...values, userId);
}

export function addMessage(userId, role, content) {
  const info = db
    .prepare("INSERT INTO messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)")
    .run(userId, role, content, Date.now());
  return info.lastInsertRowid;
}

export function getRecentMessages(userId, limit = 12) {
  const rows = db
    .prepare("SELECT id, role, content FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, limit);
  return rows.reverse();
}

export function getMessagesBefore(userId, beforeId, limit = 30) {
  const rows = db
    .prepare(
      "SELECT id, role, content FROM messages WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT ?"
    )
    .all(userId, beforeId, limit);
  return rows.reverse();
}

export function getFacts(userId) {
  return db
    .prepare("SELECT fact FROM facts WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, MAX_FACTS)
    .map(r => r.fact);
}

export function addFact(userId, fact) {
  try {
    db.prepare(
      "INSERT OR IGNORE INTO facts (user_id, fact, created_at) VALUES (?, ?, ?)"
    ).run(userId, fact, Date.now());
  } catch {}
}

export function getLatestSummary(userId) {
  return db
    .prepare(
      "SELECT content, covers_up_to_message_id FROM summaries WHERE user_id = ? ORDER BY id DESC LIMIT 1"
    )
    .get(userId);
}

export function saveSummary(userId, content, coversUpToId) {
  db.prepare(
    "INSERT INTO summaries (user_id, content, covers_up_to_message_id, created_at) VALUES (?, ?, ?, ?)"
  ).run(userId, content, coversUpToId, Date.now());
  db.prepare(
    `DELETE FROM summaries WHERE user_id = ? AND id NOT IN (
       SELECT id FROM summaries WHERE user_id = ? ORDER BY id DESC LIMIT 3
     )`
  ).run(userId, userId);
}

export function countMessagesAfter(userId, afterId) {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM messages WHERE user_id = ? AND id > ?")
    .get(userId, afterId);
  return row.c;
}

export function resetUser(userId) {
  db.prepare("DELETE FROM messages WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM facts WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM summaries WHERE user_id = ?").run(userId);
  const now = Date.now();
  db.prepare(
    `UPDATE kitty_state SET
       hunger = 60, fun = 60, social = 60,
       xp = 0, level = 1, treats = 5, mood = 'neutral',
       last_interaction = ?, last_decay = ?
     WHERE user_id = ?`
  ).run(now, now, userId);
}

export function getCosmetics(userId) {
  const row = db
    .prepare("SELECT cosmetics FROM kitty_state WHERE user_id = ?")
    .get(userId);
  if (!row || !row.cosmetics) return { bow: "pink", outfit: "none", accessory: "none" };
  try {
    return JSON.parse(row.cosmetics);
  } catch {
    return { bow: "pink", outfit: "none", accessory: "none" };
  }
}

export function setCosmetics(userId, cosmetics) {
  db.prepare("UPDATE kitty_state SET cosmetics = ? WHERE user_id = ?").run(
    JSON.stringify(cosmetics),
    userId
  );
}

export default db;