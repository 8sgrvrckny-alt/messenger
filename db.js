const Database = require('better-sqlite3');
const db = new Database('messenger.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT,
    frame TEXT DEFAULT 'none',
    coins INTEGER DEFAULT 1000,
    inventory TEXT DEFAULT '',
    equipped TEXT DEFAULT 'none',
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
  CREATE TABLE IF NOT EXISTS contacts (
    user_id INTEGER,
    contact_id INTEGER,
    PRIMARY KEY (user_id, contact_id)
  );
`);

try { db.exec("ALTER TABLE users ADD COLUMN avatar TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN frame TEXT DEFAULT 'none';"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN coins INTEGER DEFAULT 1000;"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN inventory TEXT DEFAULT '';"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN equipped TEXT DEFAULT 'none';"); } catch(e) {}
try { db.exec("ALTER TABLE messages ADD COLUMN is_read INTEGER DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE messages ADD COLUMN image TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE messages ADD COLUMN reply_to INTEGER;"); } catch(e) {}
try { db.exec("ALTER TABLE messages ADD COLUMN reactions TEXT DEFAULT '{}';"); } catch(e) {}
try { db.exec("ALTER TABLE messages ADD COLUMN expires_at INTEGER;"); } catch(e) {}

module.exports = { db };
