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
    reply_to INTEGER,
    reactions TEXT DEFAULT '{}',
    expires_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s','now')*1000)
  );
`);

// Безопасное добавление колонок для старых баз
try { db.exec("ALTER TABLE messages ADD COLUMN reply_to INTEGER;"); } catch(e) {}
try { db.exec("ALTER TABLE messages ADD COLUMN reactions TEXT DEFAULT '{}';"); } catch(e) {}
try { db.exec("ALTER TABLE messages ADD COLUMN expires_at INTEGER;"); } catch(e) {}
// Удаляем старые NFT-колонки, если они были (чтобы не мешали)
// (Мы оставим их, вдруг захочешь вернуть, но в коде пока не используем)

module.exports = { db };
