const Database = require('better-sqlite3');
const db = new Database('messenger.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT,
    online INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now')*1000)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER NOT NULL,
    to_id INTEGER NOT NULL,
    text TEXT,
    image TEXT,
    is_read INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now')*1000)
  );
  CREATE TABLE IF NOT EXISTS codes (
    phone TEXT PRIMARY KEY,
    code TEXT NOT NULL
  );
`);

try { db.exec("ALTER TABLE users ADD COLUMN avatar TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE messages ADD COLUMN is_read INTEGER DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE messages ADD COLUMN image TEXT;"); } catch(e) {}

module.exports = { db };
