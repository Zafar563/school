// Yengil fayl-asosli ma'lumotlar bazasi. Native kompilyatsiya talab qilmaydi,
// shuning uchun har qanday hosting muhitida (Render, Railway, oddiy VPS,
// hatto eski shared-hosting) muammosiz ishlaydi.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_FILE = path.join(DATA_DIR, 'data.json');

function defaultData() {
  return {
    users: [],               // {id, username, password_hash, role, created_at}
    settings: {},             // {device_api_key: "...", device_last_seen: "...", device_last_ip: "..."}
    scheduleDay: { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] },
    holidays: [],            // [{id: 1, date: "2026-03-21", name: "Navro'z bayrami"}]
    auditLog: [],             // {username, action, detail, created_at}
    nextId: { user: 1, dayItem: 1, log: 1, holiday: 1 }
  };
}

let data;

function load() {
  if (!fs.existsSync(DB_FILE)) {
    data = defaultData();
    data.settings.device_api_key = crypto.randomBytes(24).toString('hex');
    persist();
  } else {
    data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.settings.device_api_key) {
      data.settings.device_api_key = crypto.randomBytes(24).toString('hex');
      persist();
    }
    if (!data.holidays) data.holidays = [];
    if (!data.nextId.holiday) data.nextId.holiday = 1;
  }
}

function persist() {
  // Atomik yozish: avval vaqtinchalik faylga yozamiz, keyin almashtiramiz —
  // shu tarzda server to'satdan o'chib qolsa ham fayl buzilmaydi.
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

load();

// ---------------- USERS ----------------
function findUserByUsername(username) {
  return data.users.find(u => u.username === username) || null;
}
function findUserById(id) {
  return data.users.find(u => u.id === id) || null;
}
function createUser(username, passwordHash, role = 'admin') {
  if (findUserByUsername(username)) throw new Error('UNIQUE');
  const user = { id: data.nextId.user++, username, password_hash: passwordHash, role, created_at: new Date().toISOString() };
  data.users.push(user);
  persist();
  return user;
}
function updateUserPassword(userId, passwordHash) {
  const user = findUserById(userId);
  if (!user) return false;
  user.password_hash = passwordHash;
  persist();
  return true;
}
function getAllUsers() {
  return data.users.map(u => ({
    id: u.id,
    username: u.username,
    role: u.role || 'user',
    created_at: u.created_at
  }));
}
function deleteUser(userId) {
  const numId = parseInt(userId, 10);
  const beforeLen = data.users.length;
  data.users = data.users.filter(u => u.id !== numId);
  if (data.users.length !== beforeLen) {
    persist();
    return true;
  }
  return false;
}

// ---------------- SETTINGS ----------------
function getSetting(key) {
  return Object.prototype.hasOwnProperty.call(data.settings, key) ? data.settings[key] : null;
}
function setSetting(key, value) {
  data.settings[key] = value;
  persist();
}

// ---------------- SCHEDULE ----------------
function getFullSchedule() {
  const days = {};
  for (let d = 1; d <= 6; d++) {
    days[d] = {
      items: data.scheduleDay[String(d)] || []
    };
  }
  return {
    days,
    holidays: (data.holidays || []).map(h => h.date) // ESP32 uchun faqat sanalar ro'yxati
  };
}

// ---------------- HOLIDAYS ----------------
function getHolidays() {
  return (data.holidays || []).sort((a, b) => a.date.localeCompare(b.date));
}

function addHoliday(date, name) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('INVALID_DATE');
  // Agar shu sanada allaqachon mavjud bo'lsa yangilaymiz
  const existing = (data.holidays || []).find(h => h.date === date);
  if (existing) {
    existing.name = (name || '').trim();
    persist();
    return existing;
  }
  const item = {
    id: data.nextId.holiday++,
    date,
    name: (name || '').trim(),
    created_at: new Date().toISOString()
  };
  if (!data.holidays) data.holidays = [];
  data.holidays.push(item);
  persist();
  return item;
}

function removeHoliday(id) {
  const numId = parseInt(id, 10);
  if (!data.holidays) return false;
  const beforeLen = data.holidays.length;
  data.holidays = data.holidays.filter(h => h.id !== numId);
  if (data.holidays.length !== beforeLen) {
    persist();
    return true;
  }
  return false;
}

// Har bir qo'ng'iroq vaqti endi o'zining chalish uslubiga ega bo'ladi
// (ring_pattern: 'continuous' | 'pulsed'), shunda masalan "dars boshlanishi"
// va "favqulodda signal" turlicha eshitiladi.
function normalizeItem(it, idGen) {
  const pattern = it.ring_pattern === 'pulsed' ? 'pulsed' : 'continuous';
  return {
    id: idGen(),
    hour: Math.min(23, Math.max(0, parseInt(it.hour) || 0)),
    minute: Math.min(59, Math.max(0, parseInt(it.minute) || 0)),
    duration_sec: Math.min(60, Math.max(1, parseInt(it.duration_sec) || 5)),
    label: (it.label || '').trim(),
    ring_pattern: pattern,
    pulse_count: Math.min(10, Math.max(2, parseInt(it.pulse_count) || 3)),
    pulse_gap_sec: Math.min(10, Math.max(1, parseInt(it.pulse_gap_sec) || 1))
  };
}

function setDaySchedule(day, items) {
  data.scheduleDay[String(day)] = items.map(it => normalizeItem(it, () => data.nextId.dayItem++));
  persist();
}

// ---------------- AUDIT LOG ----------------
function addAuditLog(username, action, detail) {
  data.auditLog.unshift({
    id: data.nextId.log++,
    username: username || null,
    action,
    detail: detail || '',
    created_at: new Date().toISOString()
  });
  if (data.auditLog.length > 500) data.auditLog.length = 500; // haddan tashqari o'smasin
  persist();
}
function getAuditLog(limit = 100) {
  return data.auditLog.slice(0, limit);
}

function setPendingCommand(cmd) {
  data.settings.pending_command = cmd;
  persist();
}

function popPendingCommand() {
  if (!data.settings.pending_command) return null;
  const cmd = data.settings.pending_command;
  delete data.settings.pending_command;
  persist();
  return cmd;
}

module.exports = {
  findUserByUsername, findUserById, createUser, updateUserPassword,
  getAllUsers, deleteUser,
  getSetting, setSetting,
  getFullSchedule, setDaySchedule,
  getHolidays, addHoliday, removeHoliday,
  setPendingCommand, popPendingCommand,
  addAuditLog, getAuditLog
};
