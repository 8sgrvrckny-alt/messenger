const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { db } = require('./db');

// Секретный ключ для токенов
const SECRET = process.env.JWT_SECRET || 'super-secret-key-123';

// Твой ключ от SMS.ru (вшит прямо в код)
const SMS_API_ID = "7EE737F2-2B95-849C-35C9-1D309104C9F3";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- СТАРЫЕ МАРШРУТЫ ---
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'нужны логин и пароль' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const info = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);
    const user = { id: info.lastInsertRowid, username };
    res.json({ token: jwt.sign(user, SECRET), user });
  } catch {
    res.status(400).json({ error: 'логин занят' });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !(await bcrypt.compare(password, u.password))) {
    return res.status(401).json({ error: 'неверный логин или пароль' });
  }
  const user = { id: u.id, username: u.username };
  res.json({ token: jwt.sign(user, SECRET), user });
});

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: 'unauthorized' }); }
}

app.get('/users', auth, (req, res) => {
  const users = db.prepare('SELECT id, username, online FROM users WHERE id != ?').all(req.user.id);
  res.json(users);
});

// --- НОВЫЕ МАРШРУТЫ ДЛЯ СМС ---
app.post('/send-code', async (req, res) => {
  let { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Введи номер' });
  
  phone = phone.replace(/\D/g, ''); 
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  
  db.prepare('INSERT OR REPLACE INTO codes (phone, code) VALUES (?, ?)').run(phone, code);

  try {
    const smsRes = await fetch(`https://sms.ru/sms/send?api_id=${SMS_API_ID}&to=${phone}&msg=Ваш код: ${code}&json=1`);
    const smsData = await smsRes.json();
    
    if (smsData.status === 'OK') {
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: 'Ошибка SMS: ' + (smsData.status_text || 'Неизвестно') });
    }
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера при отправке' });
  }
});

app.post('/verify-code', async (req, res) => {
  let { phone, code, password } = req.body;
  phone = phone.replace(/\D/g, '');

  const saved = db.prepare('SELECT code FROM codes WHERE phone = ?').get(phone);
  
  if (!saved || saved.code !== code) {
    return res.status(400).json({ error: 'Неверный код' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const info = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(phone, hash);
    const user = { id: info.lastInsertRowid, username: phone };
    db.prepare('DELETE FROM codes WHERE phone = ?').run(phone);
    res.json({ token: jwt.sign(user, SECRET), user });
  } catch {
    res.status(400).json({ error: 'Этот номер уже зарегистрирован' });
  }
});

// --- WEBSOCKETS (ЧАТЫ) ---
io.use((socket, next) => {
  try { socket.user = jwt.verify(socket.handshake.auth.token, SECRET); next(); }
  catch { next(new Error('unauthorized')); }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  socket.join(`user:${userId}`);
  db.prepare('UPDATE users SET online = 1 WHERE id = ?').run(userId);
  io.emit('presence', { userId, online: true });

  socket.on('message:send', ({ to, text }, cb) => {
    if (!to || !text?.trim()) return cb?.({ error: 'пусто' });
    const info = db.prepare('INSERT INTO messages (from_id, to_id, text) VALUES (?, ?, ?)').run(userId, to, text.trim());
    const msg = { id: info.lastInsertRowid, from: userId, to, text: text.trim(), created_at: Date.now() };
    io.to(`user:${to}`).emit('message:new', msg);
    socket.emit('message:new', msg);
    cb?.({ ok: true });
  });

  socket.on('messages:history', ({ with: otherId }, cb) => {
    const rows = db.prepare(`SELECT id, from_id AS "from", to_id AS "to", text, created_at
      FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
      ORDER BY created_at ASC LIMIT 200`).all(userId, otherId, otherId, userId);
    cb?.(rows);
  });

  socket.on('disconnect', () => {
    db.prepare('UPDATE users SET online = 0 WHERE id = ?').run(userId);
    io.emit('presence', { userId, online: false });
  });
});

server.listen(process.env.PORT || 3001, () => console.log('server started'));
