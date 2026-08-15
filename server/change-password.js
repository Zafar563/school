// Ishlatish: node change-password.js <username> <yangi_parol>
const bcrypt = require('bcryptjs');
const { findUserByUsername, updateUserPassword } = require('./db');

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.log('Foydalanish: node change-password.js <foydalanuvchi_nomi> <yangi_parol>');
  process.exit(1);
}
if (password.length < 8) {
  console.log('Xato: parol kamida 8 belgidan iborat bo\'lishi kerak.');
  process.exit(1);
}

const user = findUserByUsername(username);
if (!user) {
  console.log('Xato: bunday foydalanuvchi topilmadi.');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
updateUserPassword(user.id, hash);
console.log(`✅ ${username} uchun parol yangilandi.`);
