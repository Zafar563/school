// Zero-dependency Telegram Bot moduli (Node.js native fetch orqali)
const {
  getSetting, setSetting,
  getFullSchedule, addAuditLog,
  setPendingCommand
} = require('./db');

let botToken = process.env.TELEGRAM_BOT_TOKEN || '';
let adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
let isPolling = false;
let lastUpdateId = 0;
let lastDeviceStatus = null; // 'online' | 'offline'

function initTelegramBot() {
  // DB dan yoki .env dan tokenlarni olamiz
  botToken = getSetting('telegram_bot_token') || process.env.TELEGRAM_BOT_TOKEN || '';
  adminChatId = getSetting('telegram_admin_chat_id') || process.env.TELEGRAM_ADMIN_CHAT_ID || '';

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
  const targetChatId = getSetting('telegram_admin_chat_id') || adminChatId;
  if (targetChatId) {
    await sendTelegramMessage(targetChatId, text);
  }
}

// ---------------- TELEGRAM BUYRUQLARINI QAYTA ISHLASH ----------------
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  // Agar admin chat ID hali DB da saqlanmagan bo'lsa va /start bosilsa, adminga bog'lash
  if (!getSetting('telegram_admin_chat_id')) {
    setSetting('telegram_admin_chat_id', String(chatId));
  }

  const mainMenu = {
    keyboard: [
      [{ text: '📊 Holat' }, { text: '📅 Bugungi jadval' }],
      [{ text: '🔔 Sinov (5s)' }, { text: '🚨 Favqulodda (30s)' }],
      [{ text: '🔕 Qo\'ng\'iroqni to\'xtatish' }, { text: '🔔 Yoqish' }]
    ],
    resize_keyboard: true
  };

  if (text === '/start' || text === 'start') {
    const schoolName = getSetting('school_name') || 'Maktab';
    const welcome = `🔔 <b>${schoolName} Qo'ng'irog'i Botiga xush kelibsiz!</b>\n\nQuyidagi tugmalar orqali tizimni boshqarishingiz mumkin:`;
    return sendTelegramMessage(chatId, welcome, mainMenu);
  }

  if (text === '📊 Holat' || text === '/status') {
    const lastSeen = getSetting('device_last_seen');
    const online = !!lastSeen && (Date.now() - new Date(lastSeen).getTime()) < 3 * 60 * 1000;
    const isMuted = getSetting('bell_muted') === true;

    let res = `<b>📊 Tizim Holati:</b>\n\n`;
    res += `• <b>ESP32 Qurilma:</b> ${online ? '🟢 Onlayn' : '🔴 Oflayn'}\n`;
    res += `• <b>Oxirgi aloqa:</b> ${lastSeen ? new Date(lastSeen).toLocaleString('uz-UZ') : 'Hech qachon'}\n`;
    res += `• <b>Qo'ng'iroq rejimi:</b> ${isMuted ? '🔕 O\'chirilgan (Muted)' : '🔔 Faol (Ishlayapti)'}\n`;

    return sendTelegramMessage(chatId, res, mainMenu);
  }

  if (text === '📅 Bugungi jadval' || text === '/schedule') {
    const d = new Date().getDay(); // 0-Yakshanba
    const dayNames = { 1:'Dushanba', 2:'Seshanba', 3:'Chorshanba', 4:'Payshanba', 5:'Juma', 6:'Shanba', 0:'Yakshanba' };
    const full = getFullSchedule();
    const items = (full.days && full.days[d] && full.days[d].items) || [];

    let res = `<b>📅 ${dayNames[d]} kungi jadval:</b>\n\n`;
    if (items.length === 0) {
      res += `<i>Bugun uchun qo'ng'iroq vaqtlari belgilanmagan.</i>`;
    } else {
      items.forEach((it, idx) => {
        const time = `${String(it.hour).padStart(2,'0')}:${String(it.minute).padStart(2,'0')}`;
        res += `${idx + 1}. <b>${time}</b> — ${it.label || 'Qo\'ng\'iroq'} (${it.duration_sec}s)\n`;
      });
    }

    return sendTelegramMessage(chatId, res, mainMenu);
  }

  if (text === '🔔 Sinov (5s)' || text === '/test') {
    setPendingCommand({
      action: 'ring',
      duration_sec: 5,
      ring_pattern: 'continuous',
      created_at: Date.now()
    });
    addAuditLog(`Telegram:${chatId}`, 'manual_ring', 'Telegram orqali 5s sinov qo\'ng\'irog\'i');
    return sendTelegramMessage(chatId, '🔔 <b>Sinov qo\'ng\'irog\'i yuborildi (5 soniya).</b>\nESP32 keyingi so\'rovida darhol chaladi.', mainMenu);
  }

  if (text === '🚨 Favqulodda (30s)' || text === '/alarm') {
    setPendingCommand({
      action: 'ring',
      duration_sec: 30,
      ring_pattern: 'continuous',
      created_at: Date.now()
    });
    addAuditLog(`Telegram:${chatId}`, 'manual_ring', '🚨 Telegram orqali 30s FAVQULODDA TREVOGA');
    return sendTelegramMessage(chatId, '🚨 <b>DIQQAT: Favqulodda signal yuborildi (30 soniya uzluksiz)!</b>', mainMenu);
  }

  if (text === '🔕 Qo\'ng\'iroqni to\'xtatish' || text === '/mute') {
    setSetting('bell_muted', true);
    setPendingCommand({ action: 'stop' });
    addAuditLog(`Telegram:${chatId}`, 'bell_muted', 'Telegram orqali to\'xtatildi');
    return sendTelegramMessage(chatId, '🔕 <b>Qo\'ng\'iroq tizimi o\'chirildi (Mute).</b>\nQayta yoqilmaguncha jiringlamaydi.', mainMenu);
  }

  if (text === '🔔 Yoqish' || text === '/unmute') {
    setSetting('bell_muted', false);
    addAuditLog(`Telegram:${chatId}`, 'bell_unmuted', 'Telegram orqali yoqildi');
    return sendTelegramMessage(chatId, '🔔 <b>Qo\'ng\'iroq tizimi qayta yoqildi (Faol).</b>', mainMenu);
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
      // Aloqa uzilsa biroz kutib qayta urinadi
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ---------------- QURILMA MONITORINGI (OFFLINE / ONLINE XABARLARI) ----------------
function startDeviceWatcher() {
  setInterval(async () => {
    const lastSeen = getSetting('device_last_seen');
    const isOnline = !!lastSeen && (Date.now() - new Date(lastSeen).getTime()) < 3 * 60 * 1000;

    if (lastDeviceStatus === null) {
      lastDeviceStatus = isOnline ? 'online' : 'offline';
      return;
    }

    if (isOnline && lastDeviceStatus === 'offline') {
      lastDeviceStatus = 'online';
      await notifyAdmin('🟢 <b>Xushxabar:</b> ESP32 maktab qo\'ng\'iroq qurilmasi qayta <b>ONLAYN</b> bo\'ldi!');
    } else if (!isOnline && lastDeviceStatus === 'online') {
      lastDeviceStatus = 'offline';
      await notifyAdmin('⚠️ <b>OGOHLANTIRISH:</b> ESP32 qo\'ng\'iroq qurilmasi 3 daqiqadan beri <b>OFLAYN</b>!\n<i>(Ehtimol maktabda elektr toki o\'chgan yoki WiFi uzilgan).</i>');
    }
  }, 60 * 1000); // Har daqiqada tekshiradi
}

module.exports = {
  initTelegramBot,
  notifyAdmin
};
