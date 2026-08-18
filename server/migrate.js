require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/school_bell',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function runMigrations() {
  console.log('🔄 PostgreSQL migratsiyalari tekshirilmoqda...');
  const client = await pool.connect();
  try {
    // Migratsiyalar tarixini saqlovchi jadval
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations_meta (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('ℹ️ Migrations papkasi topilmadi.');
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const { rows: executedRows } = await client.query('SELECT name FROM migrations_meta');
    const executedSet = new Set(executedRows.map(r => r.name));

    for (const file of files) {
      if (executedSet.has(file)) continue;

      console.log(`⏳ Migratsiya bajarilmoqda: ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO migrations_meta (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`✅ Muvaffaqiyatli bajarildi: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Migratsiyada xatolik (${file}):`, err.message);
        throw err;
      }
    }
    console.log('✅ Barcha PostgreSQL migratsiyalari tayyor.');
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { runMigrations, pool };
