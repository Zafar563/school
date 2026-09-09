// Multi-tenant Telegram Bot moduli (Har bir maktab uchun alohida bot boshqaruvi)
const {
  getSetting, setSetting,
  getFullSchedule, addAuditLog,
  setPendingCommand, getAllUsers,
  setUserMuteState, findUserById,
  updateUserTelegram, getUserTelegram,
  getUsersWithTelegram
} = require('./db');

let deviceSocketDispatcher = null;
const activeBots = new Map(); // userId -> { token, chatId, userId, lastUpdateId, isRunning }
const deviceStatusMap = {};   // userId -> 'online' | 'offline'
let watcherInterval = null;

function setDeviceSocketDispatcher(fn) {
  deviceSocketDispatcher = fn;
}

// Telegram Bot API orqali xabar yuborish
async function sendTelegramMessage(token, chatId, text, replyMarkup = null) {
  if (!token || !chatId) return { ok: false, error: 'Token yoki Chat ID yetarli emas' };
  try {
    const payload = {
      chat_id: String(chatId),
      text: text,
      parse_mode: 'HTML'
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`Telegram xabar yuborishda xatolik (chatId: ${chatId}):`, err.message);
    return { ok: false, error: err.message };
  }
}

// Bot ma'lumotlarini tekshirish (getMe)
async function getBotInfo(token) {
  if (!token) return { ok: false, error: 'Token kiritilmagan' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    if (data.ok && data.result) {
      return {
        ok: true,
        id: data.result.id,
        username: data.result.username,
        first_name: data.result.first_name
      };
    }
    return { ok: false, error: data.description || 'Token yaroqsiz' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Foydalanuvchi maktabi uchun sinov xabari yuborish
async function sendTestNotification(userId) {
  const user = await findUserById(userId);
  if (!user || !user.telegram_bot_token) {
    return { ok: false, error: 'Ushbu maktab uchun Telegram Bot Token sozlanmagan' };
  }
  if (!user.telegram_chat_id) {
    return { ok: false, error: 'Admin Chat ID topilmadi. Avval botingizga /start buyrug\'ini yuboring' };
  }
  const schoolName = user.school_name || user.username;
  const res = await sendTelegramMessage(
    user.telegram_bot_token,
    user.telegram_chat_id,
    `📨 <b>Sinov xabari</b>\n\n🏫 <b>${schoolName}</b> qo'ng'iroq tizimi Telegram boti muvaffaqiyatli ulandi va faol ishlamoqda!`
  );
  return res;
}

// ---------------- TELEGRAM BUYRUQLARINI QAYTA ISHLASH (MAKTAB BO'YICHA ISOLYATSIYA) ----------------
async function handleSchoolMessage(botConfig, msg) {
  const chatId = String(msg.chat.id);
  const text = (msg.text || '').trim();
  const userId = botConfig.userId;

  // Agar DB dagi chat_id bo'sh bo'lsa yoki o'zgargan bo'lsa, avtomatik yangilash
  if (botConfig.chatId !== chatId) {
    try {
      await updateUserTelegram(userId, botConfig.token, chatId);
      botConfig.chatId = chatId;
    } catch (e) {}
  }

  const user = await findUserById(userId);
  const schoolName = user ? (user.school_name || user.username) : 'Maktab';

  const mainMenu = {
    keyboard: [
      [{ text: '📊 Holat' }, { text: '🔔 Sinov (5s)' }],
      [{ text: '🚨 Favqulodda (30s)' }, { text: '🔕 Qo\'ng\'iroqni to\'xtatish' }],
      [{ text: '🔔 Qo\'ng\'iroqni yoqish' }]
    ],
    resize_keyboard: true
  };

  if (text === '/start' || text === 'start') {
    const welcome = `🔔 <b>${schoolName} Qo'ng'irog'i Botiga xush kelibsiz!</b>\n\n` +
      `Ushbu bot orqali faqat <b>${schoolName}</b> qo'ng'iroq tizimi va ESP32 apparatini boshqarishingiz mumkin.\n\n` +
      `Quyidagi tugmalar orqali boshqaring:`;
    return sendTelegramMessage(botConfig.token, chatId, welcome, mainMenu);
  }

  if (text === '📊 Holat' || text === '/status') {
    if (!user) {
      return sendTelegramMessage(botConfig.token, chatId, 'ℹ️ Maktab ma\'lumotlari topilmadi.', mainMenu);
    }

    const isOnline = !!user.last_seen && (Date.now() - new Date(user.last_seen).getTime()) < 3 * 60 * 1000;
    const rel = user.last_seen ? new Date(user.last_seen).toLocaleTimeString('uz-UZ') : 'bog\'lanmagan';
    
    const res = `<b>📊 ${schoolName} Holati:</b>\n\n` +
      `• <b>ESP32 Aloqasi:</b> ${isOnline ? '🟢 Onlayn' : '🔴 Oflayn'} (${rel})\n` +
      `• <b>IP Manzil:</b> <code>${user.last_ip || '—'}</code>\n` +
      `• <b>Qo'ng'iroq rejimi:</b> ${user.bell_muted ? '🔕 O\'chirilgan (Mute)' : '🔔 Faol'}\n` +
      `• <b>Tizim vaqti:</b> <code>${new Date().toLocaleTimeString('uz-UZ')}</code>`;

    return sendTelegramMessage(botConfig.token, chatId, res, mainMenu);
  }

  if (text === '🔔 Sinov (5s)' || text === '/test') {
    const cmd = {
      type: 'command',
      action: 'ring',
      duration_sec: 5,
      ring_pattern: 'continuous',
      created_at: Date.now()
    };
    if (deviceSocketDispatcher) deviceSocketDispatcher(userId, cmd);
    await setPendingCommand(userId, cmd);
    await addAuditLog(`Telegram:${chatId}`, 'manual_ring', `Telegram orqali 5s sinov qo'ng'irog'i (${schoolName})`);
    return sendTelegramMessage(
      botConfig.token,
      chatId,
      `🔔 <b>${schoolName}:</b> 5 soniyalik sinov qo'ng'irog'i yuborildi!\nESP32 qurilmasi darhol chaladi.`,
      mainMenu
    );
  }

  if (text === '🚨 Favqulodda (30s)' || text === '/alarm') {
    const cmd = {
      type: 'command',
      action: 'ring',
      duration_sec: 30,
      ring_pattern: 'continuous',
      created_at: Date.now()
    };
    if (deviceSocketDispatcher) deviceSocketDispatcher(userId, cmd);
    await setPendingCommand(userId, cmd);
    await addAuditLog(`Telegram:${chatId}`, 'manual_ring', `🚨 Telegram orqali 30s FAVQULODDA TREVOGA (${schoolName})`);
    return sendTelegramMessage(
      botConfig.token,
      chatId,
      `🚨 <b>DIQQAT:</b> <b>${schoolName}</b> da 30 soniyalik FAVQULODDA signal chalindi!`,
      mainMenu
    );
  }

  if (text === '🔕 Qo\'ng\'iroqni to\'xtatish' || text === '🔕 To\'xtatish' || text === '/mute') {
    await setUserMuteState(userId, true);
    const cmd = { type: 'command', action: 'stop', created_at: Date.now() };
    if (deviceSocketDispatcher) deviceSocketDispatcher(userId, cmd);
    await setPendingCommand(userId, cmd);
    await addAuditLog(`Telegram:${chatId}`, 'bell_muted', `Telegram orqali qo'ng'iroq to'xtatildi (${schoolName})`);
    return sendTelegramMessage(
      botConfig.token,
      chatId,
      `🔕 <b>${schoolName}:</b> Qo'ng'iroq tizimi to'xtatildi (Mute qilindi).\nQayta yoqilmaguncha jiringlamaydi.`,
      mainMenu
    );
  }

  if (text === '🔔 Qo\'ng\'iroqni yoqish' || text === '🔔 Yoqish' || text === '/unmute') {
    await setUserMuteState(userId, false);
    await addAuditLog(`Telegram:${chatId}`, 'bell_unmuted', `Telegram orqali qo'ng'iroq yoqildi (${schoolName})`);
    return sendTelegramMessage(
      botConfig.token,
      chatId,
      `🔔 <b>${schoolName}:</b> Qo'ng'iroq tizimi qayta yoqildi (Faol holatda).`,
      mainMenu
    );
  }
}

// ---------------- LONG POLLING (HAR BIR MAKTAB BOTI UCHUN) ----------------
async function pollBotUpdates(botConfig) {
  while (botConfig.isRunning) {
    try {
      const url = `https://api.telegram.org/bot${botConfig.token}/getUpdates?offset=${botConfig.lastUpdateId + 1}&timeout=30`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const upd of data.result) {
            botConfig.lastUpdateId = upd.update_id;
            if (upd.message && upd.message.text) {
              await handleSchoolMessage(botConfig, upd.message);
            }
          }
        }
      } else if (res.status === 401 || res.status === 404) {
        console.error(`❌ Telegram Bot Token yaroqsiz (User ID: ${botConfig.userId})`);
        botConfig.isRunning = false;
        break;
      }
    } catch (e) {
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ---------------- MULTI-BOT INITIALIZATION & HOT RELOAD ----------------
async function initTelegramBot() {
  try {
    const usersWithTg = await getUsersWithTelegram();
    const currentTargetMap = new Map();

    if (Array.isArray(usersWithTg)) {
      for (const u of usersWithTg) {
        if (u.telegram_bot_token && u.telegram_bot_token.trim()) {
          currentTargetMap.set(u.id, {
            userId: u.id,
            token: u.telegram_bot_token.trim(),
            chatId: u.telegram_chat_id ? String(u.telegram_chat_id).trim() : '',
            schoolName: u.school_name || u.username
          });
        }
      }
    }

    // Eski/o'chirilgan yoki tokeni o'zgargan botlarni to'xtatish
    for (const [userId, active] of activeBots.entries()) {
      const target = currentTargetMap.get(userId);
      if (!target || target.token !== active.token) {
        console.log(`🛑 Bot to'xtatildi (User ID: ${userId})`);
        active.isRunning = false;
        activeBots.delete(userId);
      }
    }

    // Yangi botlarni ishga tushirish
    for (const [userId, target] of currentTargetMap.entries()) {
      if (!activeBots.has(userId)) {
        const botConfig = {
          userId: target.userId,
          token: target.token,
          chatId: target.chatId,
          lastUpdateId: 0,
          isRunning: true
        };
        activeBots.set(userId, botConfig);
        console.log(`🤖 [Telegram] Maktab boti ishga tushdi: "${target.schoolName}" (User ID: ${userId})`);
        pollBotUpdates(botConfig);
      } else {
        // Chat ID yangilangan bo'lsa sinxronlash
        activeBots.get(userId).chatId = target.chatId;
      }
    }

    if (!watcherInterval) {
      startDeviceWatcher();
    }
  } catch (err) {
    console.error('Telegram botlarni yuklashda xato:', err.message);
  }
}

// ---------------- QURILMA MONITORINGI VA TELEGRAM OGOHLANTIRISHLAR ----------------
function startDeviceWatcher() {
  if (watcherInterval) clearInterval(watcherInterval);
  watcherInterval = setInterval(async () => {
    try {
      const users = await getAllUsers();
      if (!users) return;

      for (const u of users) {
        const isOnline = !!u.last_seen && (Date.now() - new Date(u.last_seen).getTime()) < 3 * 60 * 1000;
        const prevStatus = deviceStatusMap[u.id];

        if (prevStatus === undefined) {
          deviceStatusMap[u.id] = isOnline ? 'online' : 'offline';
          continue;
        }

        const schoolName = u.school_name || u.username;
        const botToken = u.telegram_bot_token;
        const chatId = u.telegram_chat_id;

        if (isOnline && prevStatus === 'offline') {
          deviceStatusMap[u.id] = 'online';
          if (botToken && chatId) {
            await sendTelegramMessage(
              botToken,
              chatId,
              `🟢 <b>Xushxabar:</b> <b>${schoolName}</b> ESP32 qo'ng'iroq qurilmasi qayta <b>ONLAYN</b> bo'ldi!`
            );
          }
        } else if (!isOnline && prevStatus === 'online') {
          deviceStatusMap[u.id] = 'offline';
          if (botToken && chatId) {
            await sendTelegramMessage(
              botToken,
              chatId,
              `⚠️ <b>OGOHLANTIRISH:</b> <b>${schoolName}</b> ESP32 qo'ng'iroq qurilmasi 3 daqiqadan beri <b>OFLAYN</b>!\n<i>(Elektr toki o'chgan yoki WiFi uzilgan bo'lishi mumkin).</i>`
            );
          }
        }
      }
    } catch (e) {}
  }, 60 * 1000);
}

module.exports = {
  initTelegramBot,
  setDeviceSocketDispatcher,
  getBotInfo,
  sendTestNotification,
  sendTelegramMessage
};
