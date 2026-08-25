require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const { runMigrations } = require('./migrate');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/school_bell',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

let isInitialized = false;

async function initDb() {
  if (isInitialized) return;
  await runMigrations();

  // Standart device_api_key bo'lmasa yaratib qo'yish
  const existingKey = await getSetting('device_api_key');
  if (!existingKey) {
    const randomKey = crypto.randomBytes(24).toString('hex');
    await setSetting('device_api_key', randomKey);
  }
  isInitialized = true;
}

// ---------------- USERS ----------------
async function findUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1 LIMIT 1', [username]);
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [parseInt(id, 10)]);
  return rows[0] || null;
}

async function findUserByApiKey(apiKey) {
  if (!apiKey) return null;
  const { rows } = await pool.query('SELECT * FROM users WHERE api_key = $1 LIMIT 1', [apiKey]);
  return rows[0] || null;
}

async function createUser(username, passwordHash, role = 'admin', apiKey = null) {
  const key = apiKey || crypto.randomBytes(24).toString('hex');
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, role, api_key)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [username, passwordHash, role, key]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') { // Postgres unique_violation
      throw new Error('UNIQUE');
    }
    throw err;
  }
}

async function updateUserPassword(userId, passwordHash) {
  const res = await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, parseInt(userId, 10)]);
  return res.rowCount > 0;
}

async function updateUserRole(userId, role) {
  const res = await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, parseInt(userId, 10)]);
  return res.rowCount > 0;
}

async function regenerateUserApiKey(userId) {
  const newKey = crypto.randomBytes(24).toString('hex');
  const res = await pool.query('UPDATE users SET api_key = $1 WHERE id = $2 RETURNING api_key', [newKey, parseInt(userId, 10)]);
  return res.rows[0] ? res.rows[0].api_key : null;
}

async function getAllUsers() {
  const { rows } = await pool.query('SELECT id, username, role, api_key, created_at FROM users ORDER BY id ASC');
  return rows;
}

async function deleteUser(userId) {
  const res = await pool.query('DELETE FROM users WHERE id = $1', [parseInt(userId, 10)]);
  return res.rowCount > 0;
}

// ---------------- SETTINGS ----------------
async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1 LIMIT 1', [key]);
  if (!rows[0]) return null;
  return rows[0].value;
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
}

// ---------------- SCHEDULE ----------------
async function getFullSchedule() {
  const days = { 1: { items: [] }, 2: { items: [] }, 3: { items: [] }, 4: { items: [] }, 5: { items: [] }, 6: { items: [] } };
  const { rows: items } = await pool.query(
    'SELECT * FROM schedule_items ORDER BY day_of_week ASC, hour ASC, minute ASC'
  );

  for (const it of items) {
    const d = it.day_of_week;
    if (days[d]) {
      days[d].items.push({
        id: it.id,
        hour: it.hour,
        minute: it.minute,
        duration_sec: it.duration_sec,
        label: it.label || '',
        ring_pattern: it.ring_pattern || 'continuous',
        pulse_count: it.pulse_count || 3,
        pulse_gap_sec: it.pulse_gap_sec || 1
      });
    }
  }

  const { rows: holidays } = await pool.query(
    "SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date FROM holidays ORDER BY date ASC"
  );

  return {
    days,
    holidays: holidays.map(h => h.date)
  };
}

async function setDaySchedule(day, items) {
  const dayNum = parseInt(day, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM schedule_items WHERE day_of_week = $1', [dayNum]);

    for (const it of items) {
      const pattern = it.ring_pattern === 'pulsed' ? 'pulsed' : 'continuous';
      const hour = Math.min(23, Math.max(0, parseInt(it.hour) || 0));
      const minute = Math.min(59, Math.max(0, parseInt(it.minute) || 0));
      const duration = Math.min(60, Math.max(1, parseInt(it.duration_sec) || 5));
      const label = (it.label || '').trim();
      const pulseCount = Math.min(10, Math.max(2, parseInt(it.pulse_count) || 3));
      const pulseGap = Math.min(10, Math.max(1, parseInt(it.pulse_gap_sec) || 1));

      await client.query(
        `INSERT INTO schedule_items (day_of_week, hour, minute, duration_sec, label, ring_pattern, pulse_count, pulse_gap_sec)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [dayNum, hour, minute, duration, label, pattern, pulseCount, pulseGap]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ---------------- HOLIDAYS ----------------
async function getHolidays() {
  const { rows } = await pool.query(
    "SELECT id, TO_CHAR(date, 'YYYY-MM-DD') AS date, name, created_at FROM holidays ORDER BY date ASC"
  );
  return rows;
}

async function addHoliday(date, name) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('INVALID_DATE');
  const cleanName = (name || '').trim();
  const { rows } = await pool.query(
    `INSERT INTO holidays (date, name)
     VALUES ($1::date, $2)
     ON CONFLICT (date) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, TO_CHAR(date, 'YYYY-MM-DD') AS date, name, created_at`,
    [date, cleanName]
  );
  return rows[0];
}

async function removeHoliday(id) {
  const res = await pool.query('DELETE FROM holidays WHERE id = $1', [parseInt(id, 10)]);
  return res.rowCount > 0;
}

// ---------------- AUDIT LOG ----------------
async function addAuditLog(username, action, detail = '') {
  await pool.query(
    'INSERT INTO audit_logs (username, action, detail) VALUES ($1, $2, $3)',
    [username || null, action, detail]
  );
}

async function getAuditLog(limit = 100) {
  const { rows } = await pool.query(
    'SELECT id, username, action, detail, created_at FROM audit_logs ORDER BY id DESC LIMIT $1',
    [parseInt(limit, 10) || 100]
  );
  return rows;
}

// ---------------- PENDING COMMANDS ----------------
async function setPendingCommand(cmd) {
  await pool.query('INSERT INTO pending_commands (command) VALUES ($1::jsonb)', [JSON.stringify(cmd)]);
}

async function popPendingCommand() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id, command, created_at FROM pending_commands ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED'
    );
    if (!rows[0]) {
      await client.query('COMMIT');
      return null;
    }
    const item = rows[0];
    await client.query('DELETE FROM pending_commands WHERE id = $1', [item.id]);
    await client.query('COMMIT');
    const cmdData = typeof item.command === 'object' && item.command !== null ? item.command : {};
    return { ...cmdData, created_at: item.created_at };
  } catch (e) {
    await client.query('ROLLBACK');
    return null;
  } finally {
    client.release();
  }
}

module.exports = {
  pool, initDb,
  findUserByUsername, findUserById, findUserByApiKey,
  createUser, updateUserPassword, updateUserRole, regenerateUserApiKey,
  getAllUsers, deleteUser,
  getSetting, setSetting,
  getFullSchedule, setDaySchedule,
  getHolidays, addHoliday, removeHoliday,
  setPendingCommand, popPendingCommand,
  addAuditLog, getAuditLog
};
