const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { db } = require('./db');

const SECRET = process.env.JWT_SECRET || 'fallback-secret-key-12345';
const app = express();
app.use(cors({ origin: '*', maxHttpBufferSize: 1e7 }));
app.use(express.json({ limit: '15mb' })); 

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e7 });

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Введи логин и пароль' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const info = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);
    const user = { id: info.lastInsertRowid, username, avatar: null, frame: 'none', coins: 1000, inventory: '', equipped: 'none' };
    res.json({ token: jwt.sign(user, SECRET), user });
  } catch { res.status(400).json({ error: 'Этот логин уже занят' }); }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !(await bcrypt.compare(password, u.password))) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const user = { id: u.id, username: u.username, avatar: u.avatar, frame: u.frame, coins: u.coins, inventory: u.inventory, equipped: u.equipped };
  res.json({ token: jwt.sign(user, SECRET), user });
});

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: 'unauthorized' }); }
}

app.get('/users', auth, (req, res) => {
  const users = db.prepare('SELECT id, username, online, avatar, frame, equipped FROM users WHERE id != ?').all(req.user.id);
  res.json(users);
});

app.post('/user/avatar', auth, (req, res) => {
  const { avatar } = req.body;
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, req.user.id);
  io.emit('avatar:updated', { userId: req.user.id, avatar });
  res.json({ ok: true });
});

app.post('/buy-nft', auth, (req, res) => {
  const { itemId, price } = req.body;
  const user = db.prepare('SELECT coins, inventory FROM users WHERE id = ?').get(req.user.id);
  if (user.coins < price) return res.status(400).json({ error: 'Недостаточно монет!' });
  if (user.inventory.includes(itemId)) return res.status(400).json({ error: 'Уже куплено!' });
  const newCoins = user.coins - price;
  const newInv = user.inventory ? `${user.inventory},${itemId}` : itemId;
  db.prepare('UPDATE users SET coins = ?, inventory = ? WHERE id = ?').run(newCoins, newInv, req.user.id);
  res.json({ coins: newCoins, inventory: newInv });
});

app.post('/equip-nft', auth, (req, res) => {
  const { itemId } = req.body;
  db.prepare('UPDATE users SET equipped = ? WHERE id = ?').run(itemId, req.user.id);
  io.emit('equipped:updated', { userId: req.user.id, equipped: itemId });
  res.json({ ok: true });
});

io.use((socket, next) => {
  try { socket.user = jwt.verify(socket.handshake.auth.token, SECRET); next(); }
  catch { next(new Error('unauthorized')); }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  socket.join(`user:${userId}`);
  db.prepare('UPDATE users SET online = 1 WHERE id = ?').run(userId);
  io.emit('presence', { userId, online: true });

  socket.on('typing', ({ to, isTyping }) => {
    io.to(`user:${to}`).emit('typing', { from: userId, isTyping });
  });

  socket.on('message:send', ({ to, text, image, replyTo, expiresIn }, cb) => {
    if (!to || (!text?.trim() && !image)) return cb?.({ error: 'пусто' });
    try {
      const expiresAt = expiresIn ? Date.now() + (expiresIn * 1000) : null;
      const info = db.prepare('INSERT INTO messages (from_id, to_id, text, image, reply_to, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(userId, to, text ? text.trim() : null, image || null, replyTo || null, expiresAt);
      
      const msg = { id: info.lastInsertRowid, from: userId, to, text: text ? text.trim() : null, image: image || null, is_read: 0, reply_to: replyTo || null, reactions: '{}', expires_at: expiresAt, created_at: Date.now() };
      
      io.to(`user:${to}`).emit('message:new', msg);
      socket.emit('message:new', msg);
      cb?.({ ok: true });
    } catch (err) { cb?.({ error: 'Ошибка базы' }); }
  });

  socket.on('message:react', ({ msgId, emoji, to }) => {
    try {
      const msg = db.prepare('SELECT reactions FROM messages WHERE id = ?').get(msgId);
      if (!msg) return;
      let reactions = JSON.parse(msg.reactions || '{}');
      const userKey = userId.toString();
      if (reactions[userKey] === emoji) delete reactions[userKey];
      else reactions[userKey] = emoji;
      
      const newReactionsStr = JSON.stringify(reactions);
      db.prepare('UPDATE messages SET reactions = ? WHERE id = ?').run(newReactionsStr, msgId);
      io.to(`user:${to}`).emit('message:reacted', { msgId, reactions: newReactionsStr });
      socket.emit('message:reacted', { msgId, reactions: newReactionsStr });
    } catch(e) { console.log(e); }
  });

  socket.on('messages:history', ({ with: otherId }, cb) => {
    try {
      const now = Date.now();
      db.prepare('DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < ?').run(now);
      const rows = db.prepare(`SELECT id, from_id AS "from", to_id AS "to", text, image, is_read, reply_to, reactions, expires_at, created_at FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY created_at ASC LIMIT 200`).all(userId, otherId, otherId, userId);
      db.prepare(`UPDATE messages SET is_read = 1 WHERE from_id = ? AND to_id = ? AND is_read = 0`).run(otherId, userId);
      io.to(`user:${otherId}`).emit('messages:read', { by: userId });
      cb?.(rows);
    } catch (err) { cb?.([]); }
  });

  socket.on('disconnect', () => {
    db.prepare('UPDATE users SET online = 0 WHERE id = ?').run(userId);
    io.emit('presence', { userId, online: false });
  });
});

server.listen(process.env.PORT || 3001, () => console.log('server started'));
