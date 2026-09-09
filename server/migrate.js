require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/school_bell',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function ensureMetaTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations_meta (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

// Migratsiya juftliklarini (.up.sql va .down.sql) olish
function getMigrationPairs() {
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) return [];

  const files = fs.readdirSync(migrationsDir);
  const upFiles = files.filter(f => f.endsWith('.up.sql')).sort();

  return upFiles.map(upFile => {
    const baseName = upFile.replace(/\.up\.sql$/, '');
    const downFile = baseName + '.down.sql';
    const hasDown = files.includes(downFile);

    return {
      baseName,
      upFile,
      downFile: hasDown ? downFile : null
    };
  });
}

// Baza tarixida migratsiya nomi har xil formatda bo'lishini tekshirish
function isMigrationExecuted(executedSet, baseName, upFile) {
  return (
    executedSet.has(baseName) ||
    executedSet.has(upFile) ||
    executedSet.has(baseName + '.sql')
  );
}

// ---------------- MIGRATE UP ----------------
async function migrateUp(limit = null) {
  console.log('🔄 PostgreSQL migratsiyalari (UP) tekshirilmoqda...');
  const client = await pool.connect();
  try {
    await ensureMetaTable(client);

    const pairs = getMigrationPairs();
    const { rows: executedRows } = await client.query('SELECT name FROM migrations_meta ORDER BY id ASC');
    const executedSet = new Set(executedRows.map(r => r.name));

    let executedCount = 0;

    for (const item of pairs) {
      if (isMigrationExecuted(executedSet, item.baseName, item.upFile)) {
        continue;
      }
      if (limit !== null && executedCount >= limit) break;

      console.log('⏳ Migratsiya bajarilmoqda [UP]: ' + item.upFile + '...');
      const fullPath = path.join(__dirname, 'migrations', item.upFile);
      const sql = fs.readFileSync(fullPath, 'utf8').trim();

      if (!sql) {
        console.warn('⚠️ [' + item.upFile + '] fayli bo\'sh.');
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO migrations_meta (name) VALUES ($1)', [item.upFile]);
        await client.query('COMMIT');
        console.log('✅ [UP] Muvaffaqiyatli bajarildi: ' + item.upFile);
        executedCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migratsiyada xatolik (UP -> ' + item.upFile + '):', err.message);
        throw err;
      }
    }

    if (executedCount === 0) {
      console.log("✨ Barcha migratsiyalar allaqachon bajarilgan (kutilayotgan yangi migratsiya yo'q).");
    } else {
      console.log('🎉 Jami ' + executedCount + " ta migratsiya (UP) muvaffaqiyatli qo'llanildi.");
    }
  } finally {
    client.release();
  }
}

// ---------------- MIGRATE DOWN (ATKAT / ROLLBACK) ----------------
async function migrateDown(steps = 1) {
  const count = Math.max(1, parseInt(steps, 10) || 1);
  console.log('⏪ Migratsiyani orqaga qaytarish (DOWN / ATKAT) boshlanmoqda (Qadamlar soni: ' + count + ')...');
  const client = await pool.connect();
  try {
    await ensureMetaTable(client);

    const { rows: executed } = await client.query(
      'SELECT id, name FROM migrations_meta ORDER BY id DESC LIMIT $1',
      [count]
    );

    if (executed.length === 0) {
      console.log('ℹ️ Orqaga qaytarish (atkat) uchun bajarilgan migratsiyalar topilmadi.');
      return;
    }

    for (const row of executed) {
      const recordedName = row.name;
      const baseName = recordedName.replace(/\.up\.sql$/, '').replace(/\.sql$/, '');
      const downFile = baseName + '.down.sql';
      const fullPath = path.join(__dirname, 'migrations', downFile);

      if (!fs.existsSync(fullPath)) {
        console.error('❌ Bekor qilish (DOWN) fayli topilmadi: ' + downFile);
        continue;
      }

      console.log('⏳ Migratsiya bekor qilinmoqda (DOWN): ' + downFile + '...');
      const downSql = fs.readFileSync(fullPath, 'utf8').trim();

      if (!downSql) {
        console.warn('⚠️ [' + downFile + '] fayli bo\'sh.');
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(downSql);
        await client.query('DELETE FROM migrations_meta WHERE id = $1', [row.id]);
        await client.query('COMMIT');
        console.log('⏪ [DOWN / ATKAT] Muvaffaqiyatli bekor qilindi: ' + downFile);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migratsiyani bekor qilishda xato (DOWN -> ' + downFile + '):', err.message);
        throw err;
      }
    }

    console.log('✅ Jami ' + executed.length + ' ta migratsiya muvaffaqiyatli orqaga qaytarildi (atkat qilindi).');
  } finally {
    client.release();
  }
}

// ---------------- MIGRATE STATUS ----------------
async function migrateStatus() {
  console.log('\n📋 Migratsiyalar holati (.up.sql & .down.sql):');
  console.log('================================================================================');
  const client = await pool.connect();
  try {
    await ensureMetaTable(client);

    const pairs = getMigrationPairs();
    const { rows: executedRows } = await client.query('SELECT name, executed_at FROM migrations_meta ORDER BY id ASC');
    const executedMap = new Map(executedRows.map(r => [r.name, r.executed_at]));
    const executedSet = new Set(executedRows.map(r => r.name));

    pairs.forEach((item, index) => {
      const isExecuted = isMigrationExecuted(executedSet, item.baseName, item.upFile);
      let executedDate = '—';
      for (const [name, time] of executedMap.entries()) {
        if (name === item.baseName || name === item.upFile || name === (item.baseName + '.sql')) {
          executedDate = new Date(time).toLocaleString('uz-UZ');
          break;
        }
      }

      const status = isExecuted ? '\x1b[32m[✓ BAJARILGAN]\x1b[0m' : '\x1b[33m[⏳ KUTILMOQDA]\x1b[0m';
      const downStatus = item.downFile ? ' (down mavjud)' : ' \x1b[31m(down yo\'q)\x1b[0m';
      console.log((index + 1) + '. ' + item.baseName.padEnd(30) + ' ' + status.padEnd(20) + ' ' + executedDate + downStatus);
    });
    console.log('================================================================================\n');
  } finally {
    client.release();
  }
}

// ---------------- MIGRATE RESET (ROLLBACK ALL) ----------------
async function migrateReset() {
  console.log('⚠️ BARCHA migratsiyalarni nolgacha orqaga qaytarish (RESET) boshlanmoqda...');
  const client = await pool.connect();
  try {
    await ensureMetaTable(client);
    const { rows } = await client.query('SELECT COUNT(*)::int as count FROM migrations_meta');
    const total = rows[0]?.count || 0;
    if (total === 0) {
      console.log("ℹ️ Baza allaqachon toza (bajarilgan migratsiyalar yo'q).");
      return;
    }
    await migrateDown(total);
  } finally {
    client.release();
  }
}

const runMigrations = migrateUp;

// CLI orqali to'g'ridan-to'g'ri chaqirilganda
if (require.main === module) {
  const command = (process.argv[2] || 'up').toLowerCase();
  const arg = process.argv[3];

  (async () => {
    try {
      if (command === 'up') {
        await migrateUp(arg ? parseInt(arg, 10) : null);
      } else if (command === 'down') {
        await migrateDown(arg ? parseInt(arg, 10) : 1);
      } else if (command === 'status') {
        await migrateStatus();
      } else if (command === 'reset') {
        await migrateReset();
      } else {
        console.log('Noma\'lum buyruq: "' + command + '". Ishlatish: node migrate.js [up|down|status|reset]');
      }
      process.exit(0);
    } catch (e) {
      process.exit(1);
    }
  })();
}

module.exports = {
  runMigrations,
  migrateUp,
  migrateDown,
  migrateStatus,
  migrateReset,
  pool
};
