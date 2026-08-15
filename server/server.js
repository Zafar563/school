require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const {
  findUserByUsername, createUser, updateUserPassword,
  getSetting, setSetting,
  getFullSchedule, setDaySchedule,
  addAuditLog, getAuditLog
} = require('./db');

// Server birinchi marta ishga tushganda standart adminni avtomatik yaratish
function ensureDefaultAdmin() {
  const defaultUser = 'maksim.gorkiy';
  const defaultPass = '1sonmaktab';
  if (!findUserByUsername(defaultUser)) {
    const hash = bcrypt.hashSync(defaultPass, 12);
    try {
      createUser(defaultUser, hash, 'admin');
      console.log(`✅ Standart admin avtomatik yaratildi: ${defaultUser}`);
    } catch (e) {
      // allqachon mavjud bo'lsa e'tibor berilmaydi
    }
  }
}
ensureDefaultAdmin();

const app = express();
app.set('trust proxy', 1); // Render/Railway kabi reverse-proxy ortida to'g'ri IP/HTTPS aniqlash uchun
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.use(express.json());

// Sessiya middleware'i BARCHA marshrutlardan oldin turishi shart — aks holda
// pastdagi /dashboard.html kabi req.session'ga tayanadigan route'lar hali
// sessiya biriktirilmagan holatda ishlab, foydalanuvchini har doim
// login sahifasiga qaytarib yuboradi (login qilingan bo'lsa ham).
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 12, // 12 soat
    secure: process.env.COOKIE_SECURE === 'true'
  }
}));

// dashboard.html himoyalangan bo'lishi kerak, shuning uchun uni statik papkadan
// emas, alohida (private) papkadan, login tekshiruvidan keyin beramiz.
app.get('/dashboard.html', (req, res) => {
  if (!req.session || !req.session.userId) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'private', 'dashboard.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------- LOGINGA TEGISHLI MIDDLEWARE ----------
function requireLogin(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Tizimga kirilmagan' });
}

// Faqat "admin" roli uchun (Direktor kira olmaydi) — qurilma texnik
// sozlamalari va amallar tarixi shu toifaga kiradi.
function requireAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.role === 'admin') return next();
  return res.status(403).json({ error: 'Bu bo\'lim uchun ruxsatingiz yo\'q' });
}

// Oddiy brute-force cheklovi (xotirada, sodda)
const loginAttempts = {};
function rateLimitLogin(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const rec = loginAttempts[ip] || { count: 0, first: now };
  if (now - rec.first > 15 * 60 * 1000) { rec.count = 0; rec.first = now; }
  if (rec.count >= 10) {
    return res.status(429).json({ error: 'Juda ko\'p urinish. 15 daqiqadan so\'ng qayta urinib ko\'ring.' });
  }
  rec.count++;
  loginAttempts[ip] = rec;
  next();
}

// ---------- AUTENTIFIKATSIYA YO'LLARI ----------
app.post('/api/login', rateLimitLogin, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Login va parol kiriting' });

  const user = findUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    addAuditLog(username, 'login_failed');
    return res.status(401).json({ error: 'Login yoki parol noto\'g\'ri' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role || 'admin';
  addAuditLog(username, 'login_success');
  res.json({ ok: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  const username = req.session.username;
  req.session.destroy(() => {
    addAuditLog(username, 'logout');
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({ loggedIn: true, username: req.session.username, role: req.session.role || 'admin' });
  }
  res.json({ loggedIn: false });
});

// Maktab nomi — login sahifasi ham ko'rsatishi kerak bo'lgani uchun
// autentifikatsiyasiz (ochiq) endpoint. Faqat nom qaytaradi, boshqa
// hech qanday maxfiy ma'lumot yo'q.
app.get('/api/branding', (req, res) => {
  res.json({ schoolName: getSetting('school_name') || 'Maktab' });
});

app.post('/api/admin/branding', requireAdmin, (req, res) => {
  const name = ((req.body && req.body.schoolName) || '').toString().trim();
  if (!name) return res.status(400).json({ error: 'Maktab nomini kiriting' });
  if (name.length > 60) return res.status(400).json({ error: 'Nom juda uzun (max 60 belgi)' });
  setSetting('school_name', name);
  addAuditLog(req.session.username, 'update_school_name', name);
  res.json({ ok: true, schoolName: name });
});

app.post('/api/change-password', requireLogin, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Yangi parol kamida 8 belgidan iborat bo\'lishi kerak' });
  }
  const user = findUserByUsername(req.session.username);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Joriy parol noto\'g\'ri' });
  }
  const hash = bcrypt.hashSync(newPassword, 12);
  updateUserPassword(user.id, hash);
  addAuditLog(user.username, 'password_changed');
  res.json({ ok: true });
});

// ---------- ADMIN: JADVALNI BOSHQARISH (login talab qilinadi) ----------

app.get('/api/admin/schedule', requireLogin, (req, res) => {
  res.json(getFullSchedule());
});

app.post('/api/admin/schedule/day', requireLogin, (req, res) => {
  const { day, items } = req.body || {};
  if (day === undefined || day < 1 || day > 6) return res.status(400).json({ error: 'Kun noto\'g\'ri' });
  setDaySchedule(day, items || []);
  addAuditLog(req.session.username, 'update_day_schedule', `kun=${day}`);
  res.json({ ok: true });
});

// API kalitini ko'rish / qayta generatsiya qilish (ESP32 shu kalit bilan kiradi)
app.get('/api/admin/device-key', requireAdmin, (req, res) => {
  res.json({ apiKey: getSetting('device_api_key') });
});

app.post('/api/admin/device-key/regenerate', requireAdmin, (req, res) => {
  const newKey = crypto.randomBytes(24).toString('hex');
  setSetting('device_api_key', newKey);
  addAuditLog(req.session.username, 'regenerate_device_key');
  res.json({ apiKey: newKey });
});

app.get('/api/admin/device-status', requireAdmin, (req, res) => {
  const lastSeen = getSetting('device_last_seen');
  const online = !!lastSeen && (Date.now() - new Date(lastSeen).getTime()) < 3 * 60 * 1000;
  res.json({
    lastSeen,
    lastIp: getSetting('device_last_ip'),
    online,
    checkIntervalSec: 120
  });
});

// Butun tizimni vaqtincha o'chirib qo'yish (favqulodda "jim" rejimi)
app.get('/api/admin/mute', requireLogin, (req, res) => {
  res.json({ muted: getSetting('bell_muted') === true });
});

app.post('/api/admin/mute', requireLogin, (req, res) => {
  const muted = !!(req.body && req.body.muted);
  setSetting('bell_muted', muted);
  addAuditLog(req.session.username, muted ? 'bell_muted' : 'bell_unmuted');
  res.json({ ok: true, muted });
});

app.get('/api/admin/audit-log', requireAdmin, (req, res) => {
  res.json(getAuditLog(100));
});

// ---------- ESP32 QURILMA UCHUN API (login emas, API-KEY bilan) ----------

function requireDeviceKey(req, res, next) {
  const key = req.header('X-API-KEY');
  const validKey = getSetting('device_api_key');
  if (!key || key !== validKey) {
    return res.status(401).json({ error: 'API kalit noto\'g\'ri' });
  }
  next();
}

app.get('/api/device/schedule', requireDeviceKey, (req, res) => {
  const prevSeen = getSetting('device_last_seen');
  const wasOffline = !prevSeen || (Date.now() - new Date(prevSeen).getTime()) > 3 * 60 * 1000;
  setSetting('device_last_seen', new Date().toISOString());
  setSetting('device_last_ip', req.ip);
  if (wasOffline) {
    addAuditLog(null, 'device_connected', `IP: ${req.ip}`);
  }
  // Diqqat: har bir qo'ng'iroq vaqti endi o'z ichida ring_pattern/pulse_count/
  // pulse_gap_sec maydonlariga ega (getFullSchedule orqali keladi), shuning
  // uchun bu yerda alohida umumiy "ringStyle" yuborilmaydi.
  const payload = getFullSchedule();
  payload.muted = getSetting('bell_muted') === true;
  res.json(payload);
});

// ---------- SAHIFALAR ----------
app.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard.html');
  }
  res.redirect('/login.html');
});

app.listen(PORT, () => {
  console.log(`Server ishga tushdi: http://localhost:${PORT}`);
  console.log('Agar admin hisob hali yaratilmagan bo\'lsa: node create-admin.js <login> <parol>');
});
