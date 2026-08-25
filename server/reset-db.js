require('dotenv').config();
const { pool, runMigrations } = require('./migrate');
const bcrypt = require('bcryptjs');

async function resetDatabase() {
  console.log('⚠️ Barcha PostgreSQL jadvallari va ma\'lumotlari tozalanmoqda (DROP SCHEMA CASCADE)...');
  const client = await pool.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE;');
    await client.query('CREATE SCHEMA public;');
    await client.query('GRANT ALL ON SCHEMA public TO postgres;');
    await client.query('GRANT ALL ON SCHEMA public TO public;');
    console.log('✅ Barcha eski jadvallar muvaffaqiyatli o\'chirildi (DROP qilindi).');

    // Yangi migratsiyalarni noldan ishga tushirish
    console.log('⏳ Yangi toza jadvallar yaratilmoqda...');
    await runMigrations();

    // Standart adminni qayta yaratish
    const hash = bcrypt.hashSync('admin123', 12);
    await client.query(
      `INSERT INTO users (username, password_hash, role, api_key, school_name)
       VALUES ($1, $2, $3, $4, $5)`,
      ['admin', hash, 'admin', 'admin_key_' + Math.random().toString(36).substring(2, 10), 'Bosh Boshqaruv']
    );
    console.log('✅ Standart admin yaratildi: login="admin", parol="admin123"');
    console.log('🎉 Baza to\'liq yangilandi va noldan sozlandi!');
  } catch (err) {
    console.error('❌ Bazani tozalashda xatolik:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

resetDatabase();
