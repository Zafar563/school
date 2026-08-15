// Bu skript foydalanuvchi hisobini yaratadi — Admin (to'liq vakolat) yoki
// Direktor (soddalashtirilgan panel, faqat jadval+hisobi).
// Ishlatish: node create-admin.js <username> <parol> [rol]
//   rol — "admin" (standart, agar yozilmasa) yoki "direktor"
// Masalan:
//   node create-admin.js direktor.aliyev "KuchliParol123!" admin
//   node create-admin.js hisobchi.karimova "YanaKuchliParol1!" direktor

const bcrypt = require('bcryptjs');
const { createUser } = require('./db');

const username = process.argv[2];
const password = process.argv[3];
const role = (process.argv[4] || 'admin').toLowerCase();

if (!username || !password) {
  console.log('Foydalanish: node create-admin.js <foydalanuvchi_nomi> <parol> [admin|direktor]');
  process.exit(1);
}

if (password.length < 8) {
  console.log('Xato: parol kamida 8 belgidan iborat bo\'lishi kerak.');
  process.exit(1);
}

if (role !== 'admin' && role !== 'direktor') {
  console.log('Xato: rol faqat "admin" yoki "direktor" bo\'lishi mumkin.');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);

try {
  createUser(username, hash, role);
  console.log(`✅ Hisob yaratildi: ${username} (rol: ${role})`);
  console.log('Endi shu login/parol bilan /login sahifasidan kirishingiz mumkin.');
} catch (e) {
  if (e.message === 'UNIQUE') {
    console.log('Xato: bu foydalanuvchi nomi allaqachon mavjud. Parolni o\'zgartirish uchun change-password.js dan foydalaning.');
  } else {
    console.error(e);
  }
}
