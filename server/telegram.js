// Zero-dependency Telegram Bot moduli (Node.js native fetch orqali - Multi-tenant)
const {
  getSetting, setSetting,
  getFullSchedule, addAuditLog,
  setPendingCommand, getAllUsers,
  setUserMuteState
} = require('./db');

let botToken = process.env.TELEGRAM_BOT_TOKEN || '';
let adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
let isPolling = false;
let lastUpdateId = 0;
let deviceStatusMap = {}; // { [userId]: 'online' | 'offline' }

async function initTelegramBot() {
  try {
    botToken = (await getSetting('telegram_bot_token')) || process.env.TELEGRAM_BOT_TOKEN || '';
    adminChatId = (await getSetting('telegram_admin_chat_id')) || process.env.TELEGRAM_ADMIN_CHAT_ID || '';
  } catch (e) {
    return;
  }

  if (!botToken) {
    console.log('ℹ️ Telegram Bot Token sozlanmagan (ixtiyoriy).');
    return;
  }

  if (isPolling) return;
  isPolling = true;
  console.log('🤖 Telegram Bot xizmati ishga tushdi.');
  pollTelegramUpdates();
  startDeviceWatcher();
}

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  if (!botToken || !chatId) return;
  try {
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('Telegram xabar yuborishda xatolik:', err.message);
  }
}

async function notifyAdmin(text) {
  const targetChatId = (await getSetting('telegram_admin_chat_id')) || adminChatId;
  if (targetChatId) {
    await sendTelegramMessage(targetChatId, text);
  }
}

// ---------------- TELEGRAM BUYRUQLARINI QAYTA ISHLASH ----------------
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  // Agar admin chat ID hali DB da saqlanmagan bo'lsa va /start bosilsa, adminga bog'lash
  const currentAdminChat = await getSetting('telegram_admin_chat_id');
  if (!currentAdminChat) {
    await setSetting('telegram_admin_chat_id', String(chatId));
  }

  const mainMenu = {
    keyboard: [
      [{ text: '📊 Holat' }, { text: '🏫 Maktablar ro\'yxati' }],
      [{ text: '🔔 Sinov (5s)' }, { text: '🚨 Favqulodda (30s)' }],
      [{ text: '🔕 Qo\'ng\'iroqni to\'xtatish' }, { text: '🔔 Yoqish' }]
    ],
    resize_keyboard: true
  };

  if (text === '/start' || text === 'start') {
    const defaultSchool = (await getSetting('school_name')) || 'Aqlli Maktab';
    const welcome = `🔔 <b>${defaultSchool} Qo'ng'irog'i Botiga xush kelibsiz!</b>\n\nQuyidagi tugmalar orqali barcha maktablar va qo'ng'iroq apparatlarini boshqarishingiz mumkin:`;
    return sendTelegramMessage(chatId, welcome, mainMenu);
  }

  if (text === '📊 Holat' || text === '/status' || text === '🏫 Maktablar ro\'yxati') {
    const users = await getAllUsers();
    if (!users || users.length === 0) {
      return sendTelegramMessage(chatId, 'ℹ️ Hozircha tizimda maktablar mavjud emas.', mainMenu);
    }

    let res = `<b>📊 Maktablar & ESP32 Qurilmalari Holati:</b>\n\n`;
    users.forEach((u, i) => {
      const isOnline = !!u.last_seen && (Date.now() - new Date(u.last_seen).getTime()) < 3 * 60 * 1000;
      const rel = u.last_seen ? new Date(u.last_seen).toLocaleTimeString('uz-UZ') : 'bog\'lanmagan';
      res += `${i + 1}. <b>${u.school_name || u.username}</b> (@${u.username})\n`;
      res += `   • Aloqa: ${isOnline ? '🟢 Onlayn' : '🔴 Oflayn'} (${rel})\n`;
      res += `   • IP: <code>${u.last_ip || '—'}</code>\n`;
      res += `   • Qo'ng'iroq: ${u.bell_muted ? '🔕 O\'chirilgan' : '🔔 Faol'}\n\n`;
    });

    return sendTelegramMessage(chatId, res, mainMenu);
  }

  if (text === '🔔 Sinov (5s)' || text === '/test') {
    const users = await getAllUsers();
    for (const u of users) {
      await setPendingCommand(u.id, {
        action: 'ring',
        duration_sec: 5,
        ring_pattern: 'continuous',
        created_at: Date.now()
      });
    }
    await addAuditLog(`Telegram:${chatId}`, 'manual_ring', 'Telegram orqali 5s sinov qo\'ng\'irog\'i (barcha maktablar)');
    return sendTelegramMessage(chatId, '🔔 <b>Sinov qo\'ng\'irog\'i yuborildi (5 soniya).</b>\nBarcha onlayn ESP32 qurilmalari keyingi so\'rovida darhol chaladi.', mainMenu);
  }

  if (text === '🚨 Favqulodda (30s)' || text === '/alarm') {
    const users = await getAllUsers();
    for (const u of users) {
      await setPendingCommand(u.id, {
        action: 'ring',
        duration_sec: 30,
        ring_pattern: 'continuous',
        created_at: Date.now()
      });
    }
    await addAuditLog(`Telegram:${chatId}`, 'manual_ring', '🚨 Telegram orqali 30s FAVQULODDA TREVOGA (barcha maktablar)');
    return sendTelegramMessage(chatId, '🚨 <b>DIQQAT: Favqulodda signal yuborildi (30 soniya uzluksiz)!</b>', mainMenu);
  }

  if (text === '🔕 Qo\'ng\'iroqni to\'xtatish' || text === '/mute') {
    const users = await getAllUsers();
    for (const u of users) {
      await setUserMuteState(u.id, true);
      await setPendingCommand(u.id, { action: 'stop' });
    }
    await addAuditLog(`Telegram:${chatId}`, 'bell_muted', 'Telegram orqali barcha qo\'ng\'iroqlar to\'xtatildi');
    return sendTelegramMessage(chatId, '🔕 <b>Barcha maktablarda qo\'ng\'iroq tizimi o\'chirildi (Mute).</b>\nQayta yoqilmaguncha jiringlamaydi.', mainMenu);
  }

  if (text === '🔔 Yoqish' || text === '/unmute') {
    const users = await getAllUsers();
    for (const u of users) {
      await setUserMuteState(u.id, false);
    }
    await addAuditLog(`Telegram:${chatId}`, 'bell_unmuted', 'Telegram orqali barcha qo\'ng\'iroqlar yoqildi');
    return sendTelegramMessage(chatId, '🔔 <b>Barcha maktablarda qo\'ng\'iroq tizimi qayta yoqildi (Faol).</b>', mainMenu);
  }
}

// ---------------- LONG POLLING ----------------
async function pollTelegramUpdates() {
  while (isPolling) {
    try {
      const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const upd of data.result) {
            lastUpdateId = upd.update_id;
            if (upd.message && upd.message.text) {
              await handleMessage(upd.message);
            }
          }
        }
      }
    } catch (e) {
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ---------------- QURILMA MONITORINGI (HAR BIR MAKTAB UCHUN) ----------------
function startDeviceWatcher() {
  setInterval(async () => {
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
        if (isOnline && prevStatus === 'offline') {
          deviceStatusMap[u.id] = 'online';
          await notifyAdmin(`🟢 <b>Xushxabar:</b> <b>${schoolName}</b> ESP32 qo'ng'iroq qurilmasi qayta <b>ONLAYN</b> bo'ldi!`);
        } else if (!isOnline && prevStatus === 'online') {
          deviceStatusMap[u.id] = 'offline';
          await notifyAdmin(`⚠️ <b>OGOHLANTIRISH:</b> <b>${schoolName}</b> ESP32 qo'ng'iroq qurilmasi 3 daqiqadan beri <b>OFLAYN</b>!\n<i>(Elektr toki o'chgan yoki WiFi uzilgan bo'lishi mumkin).</i>`);
        }
      }
    } catch (e) {}
  }, 60 * 1000);
}

module.exports = {
  initTelegramBot,
  notifyAdmin
};
