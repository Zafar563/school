// Mavjud hisobni "admin" (to'liq vakolat) roliga o'tkazadi.
// Ishlatish: node set-admin.js <username>
// Masalan:   node set-admin.js maksim.gorkiy

const { findUserByUsername, updateUserRole } = require('./db');

const username = process.argv[2];

if (!username) {
  console.log('Foydalanish: node set-admin.js <foydalanuvchi_nomi>');
  process.exit(1);
}

const user = findUserByUsername(username);
if (!user) {
  console.log('Xato: bunday foydalanuvchi topilmadi.');
  process.exit(1);
}

if (user.role === 'admin') {
  console.log(`ℹ️  ${username} allaqachon admin.`);
  process.exit(0);
}

updateUserRole(user.id, 'admin');
console.log(`✅ ${username} endi admin. Saytdan chiqib, qaytadan kirsin (yoki sahifani yangilasin) — shunda "Qurilma" va "Log" bo'limlari ko'rinadi.`);
