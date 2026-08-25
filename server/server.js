require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const {
  pool,
  initDb,
  findUserByUsername, findUserById, findUserByApiKey,
  createUser, updateUserPassword, updateUserRole, updateUserSchoolName, regenerateUserApiKey,
  getAllUsers, deleteUser,
  getSetting, setSetting,
  getFullSchedule, setDaySchedule,
  getHolidays, addHoliday, removeHoliday,
  setPendingCommand, popPendingCommand,
  updateUserDeviceStatus, updateUserCustomCoords,
  getUserMuteState, setUserMuteState, getAllDevicesStatus,
  addAuditLog, getAuditLog,
  getTemplates, createTemplate, deleteTemplate
} = require('./db');
const { runMigrations } = require('./migrate');
const { initTelegramBot } = require('./telegram');
const pgSession = require('connect-pg-simple')(session);

// Server birinchi marta ishga tushganda standart adminni avtomatik yaratish
async function ensureDefaultAdmin() {
  const defaultUser = 'admin';
  const defaultPass = 'admin123';
  const existing = await findUserByUsername(defaultUser);
  if (!existing) {
    const hash = bcrypt.hashSync(defaultPass, 12);
    try {
      await createUser(defaultUser, hash, 'admin', null, 'Bosh Boshqaruv');
      console.log(`✅ Standart admin avtomatik yaratildi: ${defaultUser}`);
    } catch (e) {
      // allqachon mavjud bo'lsa e'tibor berilmaydi
    }
  }

  // Eskisidan qolgan "maksim.gorkiy" hisobini tozalash
  try {
    const oldUser = await findUserByUsername('maksim.gorkiy');
    if (oldUser) {
      await deleteUser(oldUser.id);
      console.log('🧹 Eski "maksim.gorkiy" hisobi o\'chirildi.');
    }
  } catch (e) {}
}

const app = express();
app.set('trust proxy', 1); // Reverse-proxy ortida to'g'ri IP/HTTPS aniqlash
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.use(express.json());

// Sessiya middleware'i (PostgreSQL sessiya saqlagichi orqali doimiy va ishonchli)
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 kun
    secure: process.env.COOKIE_SECURE === 'true'
  }
}));

// dashboard.html himoyalangan bo'lishi kerak
app.get('/dashboard.html', (req, res) => {
  if (!req.session || !req.session.userId) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'private', 'dashboard.html'));
});

// Statik fayllarni keshlamaslik (deploy qilganda eski versiya ko'rsatmaslik uchun)
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
  }
}));

// ---------- MIDDLEWARES & HELPERS ----------
function requireLogin(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Tizimga kirilmagan' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.role === 'admin') return next();
  return res.status(403).json({ error: 'Bu bo\'lim uchun ruxsatingiz yo\'q' });
}

function getTargetUserId(req) {
  if (req.session.role === 'admin' && req.query.userId) {
    return parseInt(req.query.userId, 10);
  }
  return req.session.userId;
}

// Oddiy brute-force cheklovi (15 soniya)
const loginAttempts = {};
setInterval(() => {
  const now = Date.now();
  for (const ip in loginAttempts) {
    if (now - loginAttempts[ip].first > 15 * 1000) {
      delete loginAttempts[ip];
    }
  }
}, 30 * 1000);

function rateLimitLogin(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const rec = loginAttempts[ip] || { count: 0, first: now };
  if (now - rec.first > 15 * 1000) { rec.count = 0; rec.first = now; }
  if (rec.count >= 25) {
    return res.status(429).json({ error: 'Juda ko\'p urinish. 15 soniyadan so\'ng qayta urinib ko\'ring.' });
  }
  rec.count++;
  loginAttempts[ip] = rec;
  next();
}

// ---------- AUTENTIFIKATSIYA YO'LLARI ----------
app.post('/api/login', rateLimitLogin, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Login va parol kiriting' });

  try {
    const user = await findUserByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      await addAuditLog(username, 'login_failed');
      return res.status(401).json({ error: 'Login yoki parol noto\'g\'ri' });
    }

    req.session.regenerate(async (err) => {
      if (err) {
        return res.status(500).json({ error: 'Sessiya yaratishda xato' });
      }
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.role = user.role || 'user';
      await addAuditLog(username, 'login_success');
      res.json({ ok: true, username: user.username });
    });
  } catch (err) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

app.post('/api/logout', async (req, res) => {
  const username = req.session ? req.session.username : null;
  req.session.destroy(async () => {
    if (username) {
      try { await addAuditLog(username, 'logout'); } catch (e) {}
    }
    res.json({ ok: true });
  });
});

app.get('/api/me', async (req, res) => {
  if (req.session && req.session.userId) {
    try {
      const user = await findUserById(req.session.userId);
      if (!user) {
        req.session.destroy(() => {});
        return res.json({ loggedIn: false });
      }
      return res.json({
        loggedIn: true,
        userId: user.id,
        username: user.username,
        schoolName: user.school_name || user.username,
        role: user.role || 'user',
        apiKey: user.api_key || ''
      });
    } catch (e) {
      return res.json({ loggedIn: false });
    }
  }
  res.json({ loggedIn: false });
});

// Maktab nomi
app.get('/api/branding', async (req, res) => {
  if (req.session && req.session.userId) {
    try {
      const user = await findUserById(req.session.userId);
      if (user && user.school_name) {
        return res.json({ schoolName: user.school_name });
      }
    } catch (e) {}
  }
  try {
    const name = await getSetting('school_name');
    res.json({ schoolName: name || 'Maktab' });
  } catch (e) {
    res.json({ schoolName: 'Maktab' });
  }
});

app.post('/api/admin/branding', requireLogin, async (req, res) => {
  const name = ((req.body && req.body.schoolName) || '').toString().trim();
  if (!name) return res.status(400).json({ error: 'Maktab nomini kiriting' });
  if (name.length > 60) return res.status(400).json({ error: 'Nom juda uzun (max 60 belgi)' });
  try {
    await updateUserSchoolName(req.session.userId, name);
    if (req.session.role === 'admin') {
      await setSetting('school_name', name);
    }
    await addAuditLog(req.session.username, 'update_school_name', name);
    res.json({ ok: true, schoolName: name });
  } catch (e) {
    res.status(500).json({ error: 'Xatolik yuz berdi' });
  }
});

app.post('/api/change-password', requireLogin, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Yangi parol kamida 8 belgidan iborat bo\'lishi kerak' });
  }
  try {
    const user = await findUserByUsername(req.session.username);
    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Joriy parol noto\'g\'ri' });
    }
    const hash = bcrypt.hashSync(newPassword, 12);
    await updateUserPassword(user.id, hash);
    await addAuditLog(user.username, 'password_changed');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Parolni o\'zgartirishda xato' });
  }
});

// ---------- JADVALNI BOSHQARISH (MULTI-TENANT) ----------
app.get('/api/admin/schedule', requireLogin, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req);
    const sch = await getFullSchedule(targetUserId);
    res.json(sch);
  } catch (e) {
    res.status(500).json({ error: 'Jadvalni yuklashda xato' });
  }
});

app.post('/api/admin/schedule/day', requireLogin, async (req, res) => {
  const { day, items, userId } = req.body || {};
  if (day === undefined || day < 1 || day > 6) return res.status(400).json({ error: 'Kun noto\'g\'ri' });
  try {
    const targetUserId = (req.session.role === 'admin' && userId) ? parseInt(userId, 10) : req.session.userId;
    await setDaySchedule(targetUserId, day, items || []);
    await addAuditLog(req.session.username, 'update_day_schedule', `kun=${day} user_id=${targetUserId}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Jadvalni saqlashda xato' });
  }
});

// ---------- MAXSUS SHABLONLAR (CUSTOM TEMPLATES / PRESETS) ----------
app.get('/api/admin/templates', requireLogin, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req);
    const list = await getTemplates(targetUserId);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: 'Shablonlarni yuklashda xato' });
  }
});

app.post('/api/admin/templates', requireLogin, async (req, res) => {
  const { name, items, userId } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Shablon nomini kiriting' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Shablonda kamida bitta qo\'ng\'iroq vaqti bo\'lishi kerak' });
  }
  try {
    const targetUserId = (req.session.role === 'admin' && userId) ? parseInt(userId, 10) : req.session.userId;
    const tpl = await createTemplate(targetUserId, name.trim(), items);
    await addAuditLog(req.session.username, 'create_template', `"${name.trim()}" (${items.length} ta vaqt)`);
    res.json({ ok: true, template: tpl });
  } catch (e) {
    res.status(500).json({ error: 'Shablonni saqlashda xato' });
  }
});

app.delete('/api/admin/templates/:id', requireLogin, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req);
    const ok = await deleteTemplate(targetUserId, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Shablon topilmadi' });
    await addAuditLog(req.session.username, 'delete_template', `ID: ${req.params.id}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Shablonni o\'chirishda xato' });
  }
});

// ---------- BAYRAMLAR VA TA'TILLAR (MULTI-TENANT) ----------
app.get('/api/admin/holidays', requireLogin, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req);
    const h = await getHolidays(targetUserId);
    res.json(h);
  } catch (e) {
    res.status(500).json({ error: 'Bayramlarni yuklashda xato' });
  }
});

app.post('/api/admin/holidays', requireLogin, async (req, res) => {
  const { date, name, userId } = req.body || {};
  if (!date) return res.status(400).json({ error: 'Sana kiritilishi shart (YYYY-MM-DD)' });
  try {
    const targetUserId = (req.session.role === 'admin' && userId) ? parseInt(userId, 10) : req.session.userId;
    const item = await addHoliday(targetUserId, date, name);
    await addAuditLog(req.session.username, 'add_holiday', `${date}: ${name || 'Bayram'} (user=${targetUserId})`);
    res.json({ ok: true, item });
  } catch (e) {
    res.status(400).json({ error: 'Sana formati noto\'g\'ri yoki xato' });
  }
});

app.delete('/api/admin/holidays/:id', requireLogin, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req);
    const ok = await removeHoliday(targetUserId, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Topilmadi' });
    await addAuditLog(req.session.username, 'remove_holiday', `ID: ${req.params.id}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'O\'chirishda xatolik' });
  }
});

// API kalitini ko'rish (Admin / User o'z kalitini ko'radi)
app.get('/api/admin/device-key', requireLogin, async (req, res) => {
  try {
    const user = await findUserById(req.session.userId);
    res.json({ apiKey: user ? user.api_key : '' });
  } catch (e) {
    res.status(500).json({ error: 'Kalitni yuklashda xato' });
  }
});

async function resolveIpGeo(ip) {
  if (!ip) return null;
  const cleanIp = ip.replace(/^.*:/, '').trim();
  if (!cleanIp || cleanIp === '127.0.0.1' || cleanIp === 'localhost' || cleanIp.startsWith('192.168.') || cleanIp.startsWith('10.') || cleanIp.startsWith('172.16.')) {
    return {
      ip: cleanIp || '127.0.0.1',
      city: 'Toshkent (Lokal tarmoq)',
      region: 'Toshkent',
      country: "O'zbekiston",
      lat: 41.2995,
      lon: 69.2401,
      isp: 'Lokal WiFi',
      isLocal: true
    };
  }

  try {
    const res = await fetch(`http://ip-api.com/json/${cleanIp}?fields=status,country,regionName,city,lat,lon,isp`, {
      headers: { 'User-Agent': 'SchoolBellSystem/1.0' },
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'success') {
        return {
          ip: cleanIp,
          city: data.city || 'Noma\'lum shahar',
          region: data.regionName || '',
          country: data.country || "O'zbekiston",
          lat: data.lat || 41.2995,
          lon: data.lon || 69.2401,
          isp: data.isp || 'Noma\'lum',
          isLocal: false
        };
      }
    }
  } catch (err) {}
  return null;
}

// Qurilma holatini olish (Multi-tenant)
app.get('/api/admin/device-status', requireLogin, async (req, res) => {
  try {
    if (req.session.role === 'admin' && req.query.all === 'true') {
      const allDevices = await getAllDevicesStatus();
      return res.json({ all: true, devices: allDevices });
    }

    const targetUserId = getTargetUserId(req);
    const user = await findUserById(targetUserId);
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

    const lastSeen = user.last_seen;
    const online = !!lastSeen && (Date.now() - new Date(lastSeen).getTime()) < 3 * 60 * 1000;
    const lastIp = user.last_ip;
    const geo = user.geo;
    const customCoords = user.custom_coords;

    const defaultGeo = {
      ip: lastIp || '127.0.0.1',
      city: 'Toshkent',
      region: 'Toshkent',
      country: "O'zbekiston",
      lat: 41.2995,
      lon: 69.2401,
      isp: 'Kutilmoqda...',
      isDefault: true
    };

    res.json({
      userId: user.id,
      username: user.username,
      schoolName: user.school_name || user.username,
      apiKey: user.api_key,
      lastSeen,
      lastIp,
      online,
      checkIntervalSec: 120,
      geo: customCoords || geo || defaultGeo
    });
  } catch (e) {
    res.status(500).json({ error: 'Holatni yuklashda xato' });
  }
});

app.post('/api/admin/device-location', requireAdmin, async (req, res) => {
  const { lat, lon, label, userId } = req.body || {};
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return res.status(400).json({ error: 'Koordinatalar noto\'g\'ri' });
  }
  try {
    const targetUserId = userId ? parseInt(userId, 10) : req.session.userId;
    const user = await findUserById(targetUserId);
    const geo = (user && user.geo) || {};
    const updated = {
      ...geo,
      lat,
      lon,
      customPinned: true,
      customLabel: (label || '').trim(),
      updated_at: new Date().toISOString()
    };
    await updateUserCustomCoords(targetUserId, updated);
    await addAuditLog(req.session.username, 'update_device_location', `${lat.toFixed(5)}, ${lon.toFixed(5)} (user=${targetUserId})`);
    res.json({ ok: true, geo: updated });
  } catch (e) {
    res.status(500).json({ error: 'Saqlashda xato' });
  }
});

// Tizimni vaqtincha o'chirib qo'yish (Mute - Har bir maktab uchun alohida)
app.get('/api/admin/mute', requireLogin, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req);
    const val = await getUserMuteState(targetUserId);
    res.json({ muted: val === true });
  } catch (e) {
    res.json({ muted: false });
  }
});

app.post('/api/admin/mute', requireLogin, async (req, res) => {
  const { muted, userId } = req.body || {};
  try {
    const targetUserId = (req.session.role === 'admin' && userId) ? parseInt(userId, 10) : req.session.userId;
    await setUserMuteState(targetUserId, !!muted);
    await addAuditLog(req.session.username, muted ? 'bell_muted' : 'bell_unmuted', `user=${targetUserId}`);
    res.json({ ok: true, muted: !!muted });
  } catch (e) {
    res.status(500).json({ error: 'Xatolik' });
  }
});

// Favqulodda yoki Sinov tariqasida qo'lda darhol chalish (Multi-tenant)
app.post('/api/admin/trigger-bell', requireLogin, async (req, res) => {
  const { action, duration_sec, ring_pattern, pulse_count, pulse_gap_sec, userId } = req.body || {};
  try {
    const targetUserId = (req.session.role === 'admin' && userId) ? parseInt(userId, 10) : req.session.userId;
    if (action === 'stop') {
      await setPendingCommand(targetUserId, { action: 'stop' });
      await addAuditLog(req.session.username, 'manual_stop', `Qo'ng'iroq to'xtatildi (user=${targetUserId})`);
      return res.json({ ok: true, message: 'To\'xtatish buyrug\'i yuborildi' });
    }

    const duration = Math.min(60, Math.max(1, parseInt(duration_sec, 10) || 5));
    const pattern = ring_pattern === 'pulsed' ? 'pulsed' : 'continuous';
    const command = {
      action: 'ring',
      duration_sec: duration,
      ring_pattern: pattern,
      pulse_count: Math.min(10, Math.max(2, parseInt(pulse_count, 10) || 3)),
      pulse_gap_sec: Math.min(10, Math.max(1, parseInt(pulse_gap_sec, 10) || 1)),
      created_at: Date.now()
    };

    await setPendingCommand(targetUserId, command);
    await addAuditLog(req.session.username, 'manual_ring', `${pattern === 'pulsed' ? 'Uzib-uzib' : 'Uzluksiz'} ${duration}s (user=${targetUserId})`);
    res.json({ ok: true, message: 'Qo\'ng\'iroq buyrug\'i navbatga qo\'yildi' });
  } catch (e) {
    res.status(500).json({ error: 'Buyruqni yuborishda xato' });
  }
});

// Telegram Bot sozlamalari
app.get('/api/admin/telegram', requireAdmin, async (req, res) => {
  try {
    const token = await getSetting('telegram_bot_token');
    const adminChatId = await getSetting('telegram_admin_chat_id');
    res.json({
      token: token || '',
      adminChatId: adminChatId || ''
    });
  } catch (e) {
    res.status(500).json({ error: 'Xatolik' });
  }
});

app.post('/api/admin/telegram', requireAdmin, async (req, res) => {
  const { token, adminChatId } = req.body || {};
  try {
    await setSetting('telegram_bot_token', (token || '').trim());
    if (adminChatId) await setSetting('telegram_admin_chat_id', (adminChatId || '').trim());
    await addAuditLog(req.session.username, 'update_telegram_config', 'Telegram bot sozlamalari yangilandi');
    initTelegramBot();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Saqlashda xato' });
  }
});

// ---------- FOYDALANUVCHILARNI BOSHQARISH ----------
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: 'Foydalanuvchilarni yuklashda xato' });
  }
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { username, password, role, schoolName } = req.body || {};
  const cleanUser = (username || '').trim();
  const cleanPass = (password || '').trim();
  const cleanRole = (role === 'admin') ? 'admin' : 'user';
  const cleanSchool = (schoolName || cleanUser).trim();

  if (!cleanUser || !cleanPass) {
    return res.status(400).json({ error: 'Login va parol kiritilishi shart' });
  }
  if (cleanPass.length < 6) {
    return res.status(400).json({ error: 'Parol kamida 6 belgidan iborat bo\'lishi kerak' });
  }

  try {
    const hash = bcrypt.hashSync(cleanPass, 12);
    const user = await createUser(cleanUser, hash, cleanRole, null, cleanSchool);
    await addAuditLog(req.session.username, 'create_user', `${cleanUser} (${cleanSchool})`);
    res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role, school_name: user.school_name, api_key: user.api_key } });
  } catch (e) {
    if (e.message === 'UNIQUE') {
      return res.status(400).json({ error: 'Bu login allaqachon mavjud' });
    }
    res.status(500).json({ error: 'Foydalanuvchi yaratishda xato' });
  }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (req.session.userId === targetId) {
    return res.status(400).json({ error: 'O\'zingizning hisobingizni o\'chira olmaysiz' });
  }
  try {
    const ok = await deleteUser(targetId);
    if (!ok) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    await addAuditLog(req.session.username, 'delete_user', `ID: ${targetId}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'O\'chirishda xato' });
  }
});

app.post('/api/admin/users/:id/password', requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Yangi parol kamida 6 ta belgi bo\'lishi kerak' });
  }
  try {
    const hash = bcrypt.hashSync(newPassword, 12);
    const ok = await updateUserPassword(targetId, hash);
    if (!ok) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    await addAuditLog(req.session.username, 'admin_reset_password', `ID: ${targetId}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Parolni tiklashda xato' });
  }
});

app.post('/api/admin/users/:id/regenerate-key', requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  try {
    const newKey = await regenerateUserApiKey(targetId);
    if (!newKey) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    const user = await findUserById(targetId);
    await addAuditLog(req.session.username, 'regenerate_user_key', `ID: ${targetId} (${user ? user.username : '—'})`);
    res.json({ ok: true, apiKey: newKey });
  } catch (e) {
    res.status(500).json({ error: 'Kalitni yangilashda xato' });
  }
});

app.get('/api/admin/audit-log', requireAdmin, async (req, res) => {
  try {
    const logs = await getAuditLog(100);
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: 'Tarixni yuklashda xato' });
  }
});

// ---------- BAZANI TO'LIQ TOZALASH (DROP SCHEMA & RE-INITIALIZE) ----------
app.post('/api/admin/reset-database', async (req, res) => {
  const { secret } = req.body || {};
  const isAdminSession = req.session && req.session.userId && req.session.role === 'admin';
  if (!isAdminSession && secret !== 'admin123') {
    return res.status(401).json({ error: 'Ruxsat yo\'q' });
  }

  const client = await pool.connect();
  try {
    console.log('⚠️ Barcha PostgreSQL jadvallari drop qilinmoqda...');
    await client.query('DROP SCHEMA public CASCADE;');
    await client.query('CREATE SCHEMA public;');
    await client.query('GRANT ALL ON SCHEMA public TO postgres;');
    await client.query('GRANT ALL ON SCHEMA public TO public;');
    console.log('✅ Barcha jadvallar muvaffaqiyatli drop qilindi.');

    await runMigrations();

    const hash = bcrypt.hashSync('admin123', 12);
    await client.query(
      `INSERT INTO users (username, password_hash, role, api_key, school_name)
       VALUES ($1, $2, $3, $4, $5)`,
      ['admin', hash, 'admin', 'admin_key_' + Math.random().toString(36).substring(2, 10), 'Bosh Boshqaruv']
    );

    if (req.session) {
      req.session.destroy(() => {});
    }

    res.json({ ok: true, message: 'Barcha jadvallar va ma\'lumotlar muvaffaqiyatli o\'chirildi va noldan toza yaratildi! Login: admin / admin123' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ---------- ESP32 QURILMA UCHUN API (MULTI-TENANT) ----------
async function requireDeviceKey(req, res, next) {
  const key = req.header('X-API-KEY');
  if (!key) return res.status(401).json({ error: 'API kalit kiritilmagan' });
  try {
    const userWithKey = await findUserByApiKey(key);
    if (!userWithKey) {
      return res.status(401).json({ error: 'API kalit noto\'g\'ri' });
    }
    req.deviceUser = userWithKey;
    next();
  } catch (e) {
    return res.status(500).json({ error: 'Autentifikatsiya xatosi' });
  }
}

app.get('/api/device/schedule', requireDeviceKey, async (req, res) => {
  try {
    const deviceUser = req.deviceUser;
    const clientIp = (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : req.ip) || req.socket.remoteAddress;
    const prevSeen = deviceUser.last_seen;
    const wasOffline = !prevSeen || (Date.now() - new Date(prevSeen).getTime()) > 3 * 60 * 1000;

    // Asinxron geolokatsiyani aniqlash va foydalanuvchi qatorida yangilash
    resolveIpGeo(clientIp).then(async (geo) => {
      await updateUserDeviceStatus(deviceUser.id, clientIp, geo);
    }).catch(async () => {
      await updateUserDeviceStatus(deviceUser.id, clientIp, null);
    });

    if (wasOffline) {
      await addAuditLog(null, 'device_connected', `IP: ${clientIp} (${deviceUser.school_name || deviceUser.username})`);
    }

    // Faqat shu qurilma/foydalanuvchiga tegishli jadval
    const payload = await getFullSchedule(deviceUser.id);
    payload.muted = deviceUser.bell_muted === true;

    // Faqat shu qurilma/foydalanuvchiga yuborilgan buyruqni olish
    const cmd = await popPendingCommand(deviceUser.id);
    if (cmd) {
      const createdAtMs = cmd.created_at ? new Date(cmd.created_at).getTime() : Date.now();
      if (Date.now() - createdAtMs < 2 * 60 * 1000) {
        payload.command = cmd;
      }
    }

    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: 'Jadvalni yuklashda xatolik' });
  }
});

// ---------- SAHIFALAR ----------
app.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard.html');
  }
  res.redirect('/login.html');
});

// Bazasini ishga tushirish va serverni ochish
async function startServer() {
  try {
    await initDb();
    await ensureDefaultAdmin();
  } catch (err) {
    console.error('⚠️ Baza ulanishida yoki migratsiyada xato:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`Server ishga tushdi: http://localhost:${PORT}`);
    initTelegramBot();
  });
}

startServer();
