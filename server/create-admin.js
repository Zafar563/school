// Bu skript foydalanuvchi hisobini yaratadi — Admin yoki User
// Ishlatish: node create-admin.js <username> <parol> [admin|user]
const bcrypt = require('bcryptjs');
const { initDb, createUser, pool } = require('./db');

async function main() {
  const username = process.argv[2];
  const password = process.argv[3];
  const role = (process.argv[4] || 'admin').toLowerCase();

  if (!username || !password) {
    console.log('Foydalanish: node create-admin.js <foydalanuvchi_nomi> <parol> [admin|user]');
    process.exit(1);
  }

  if (password.length < 6) {
    console.log('Xato: parol kamida 6 belgidan iborat bo\'lishi kerak.');
    process.exit(1);
  }

  if (role !== 'admin' && role !== 'user') {
    console.log('Xato: rol faqat "admin" yoki "user" bo\'lishi mumkin.');
    process.exit(1);
  }

  try {
    await initDb();
    const hash = bcrypt.hashSync(password, 12);
    const user = await createUser(username, hash, role);
    console.log(`✅ Hisob yaratildi: ${username} (rol: ${role})`);
    console.log(`🔑 ESP32 API Kalit: ${user.api_key}`);
    console.log('Endi shu login/parol bilan /login sahifasidan kirishingiz mumkin.');
  } catch (e) {
    if (e.message === 'UNIQUE') {
      console.log('Xato: bu login allaqachon mavjud. Parolni o\'zgartirish uchun change-password.js dan foydalaning.');
    } else {
      console.error('Xatolik:', e.message);
    }
  } finally {
    await pool.end();
  }
}

main();
