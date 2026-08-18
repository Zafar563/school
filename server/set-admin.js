// Mavjud hisobni "admin" (to'liq vakolat) roliga o'tkazadi.
// Ishlatish: node set-admin.js <username>
const { initDb, findUserByUsername, updateUserRole, pool } = require('./db');

async function main() {
  const username = process.argv[2];

  if (!username) {
    console.log('Foydalanish: node set-admin.js <foydalanuvchi_nomi>');
    process.exit(1);
  }

  try {
    await initDb();
    const user = await findUserByUsername(username);
    if (!user) {
      console.log('Xato: bunday foydalanuvchi topilmadi.');
      process.exit(1);
    }

    if (user.role === 'admin') {
      console.log(`ℹ️  ${username} allaqachon admin.`);
      process.exit(0);
    }

    await updateUserRole(user.id, 'admin');
    console.log(`✅ ${username} endi admin.`);
  } catch (e) {
    console.error('Xatolik:', e.message);
  } finally {
    await pool.end();
  }
}

main();
