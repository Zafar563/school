// Kun nomlari (Dushanba=1 ... Shanba=6, Yakshanba=0 ko'rsatilmaydi)
const DAY_NAMES = { 1:'Dushanba', 2:'Seshanba', 3:'Chorshanba', 4:'Payshanba', 5:'Juma', 6:'Shanba' };
const DAY_KEYS = [1, 2, 3, 4, 5, 6];

let currentDay = (new Date().getDay() === 0) ? 1 : new Date().getDay();
let scheduleData = null;
let currentRole = 'admin';
const isAdmin = () => currentRole === 'admin';

// ============================================================
// THEME (TUNGI / KUNDUZGI REJIM)
// ============================================================
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeIconSun = document.getElementById('themeIconSun');
const themeIconMoon = document.getElementById('themeIconMoon');

function updateDashboardThemeIcons(theme) {
  if (theme === 'dark') {
    if (themeIconSun) themeIconSun.style.display = 'block';
    if (themeIconMoon) themeIconMoon.style.display = 'none';
  } else {
    if (themeIconSun) themeIconSun.style.display = 'none';
    if (themeIconMoon) themeIconMoon.style.display = 'block';
  }
}

updateDashboardThemeIcons(document.documentElement.getAttribute('data-theme') || 'light');

if (themeToggleBtn) {
  themeToggleBtn.onclick = () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateDashboardThemeIcons(next);
  };
}

// ============================================================
// BRANDING (maktab nomi)
// ============================================================
let currentSchoolName = 'Maktab';

function loadBranding() {
  fetch('/api/branding').then(r => r.json()).then(d => {
    currentSchoolName = d.schoolName || 'Maktab';
    document.getElementById('sidebarSchoolName').textContent = currentSchoolName;
    document.title = 'Boshqaruv paneli — ' + currentSchoolName;
    const input = document.getElementById('schoolNameInput');
    if (input) input.value = currentSchoolName;
  }).catch(() => {});
}
loadBranding();

const saveSchoolNameBtn = document.getElementById('saveSchoolNameBtn');
if (saveSchoolNameBtn) {
  saveSchoolNameBtn.onclick = () => {
    const name = (document.getElementById('schoolNameInput') || {}).value.trim();
    if (!name) { toast('Maktab nomini kiriting', 'error'); return; }
    fetch('/api/admin/branding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolName: name })
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) { toast(d.error || 'Xatolik', 'error'); return; }
      currentSchoolName = d.schoolName;
      document.getElementById('sidebarSchoolName').textContent = currentSchoolName;
      document.title = 'Boshqaruv paneli — ' + currentSchoolName;
      toast('Maktab nomi saqlandi ✓');
    }).catch(() => toast('Server bilan bog\'lanishda xato', 'error'));
  };
}

let currentUserApiKey = '';

// ============================================================
// AUTH
// ============================================================
fetch('/api/me').then(r => r.json()).then(d => {
  if (!d.loggedIn) { window.location.href = '/login.html'; return; }
  document.getElementById('userLabel').textContent = d.username;
  currentRole = d.role || 'user';
  currentUserApiKey = d.apiKey || '';
  document.getElementById('userRoleLabel').textContent = isAdmin() ? 'Administrator' : 'Foydalanuvchi';
  if (!isAdmin()) {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
  } else {
    document.querySelectorAll('.user-only').forEach(el => el.style.display = 'none');
  }
  startDevicePolling();
  loadSchedule();
  loadMuteState();
});

document.getElementById('logoutBtn').onclick = () => {
  fetch('/api/logout', { method: 'POST' }).then(() => window.location.href = '/login.html');
};

// ============================================================
// TABS
// ============================================================
document.querySelectorAll('.sidebar nav a').forEach(a => {
  a.addEventListener('click', () => {
    document.querySelectorAll('.sidebar nav a').forEach(x => x.classList.remove('active'));
    a.classList.add('active');
    const tab = a.dataset.tab;
    ['schedule', 'holidays', 'device', 'account', 'users', 'log'].forEach(t => {
      const el = document.getElementById('tab-' + t);
      if (el) el.style.display = (t === tab) ? '' : 'none';
    });
    const titleMap = {
      schedule: 'Qo\'ng\'iroq jadvali',
      holidays: 'Bayramlar va ta\'tillar',
      device: 'Qurilma sozlamalari',
      account: 'Hisobim',
      users: 'Foydalanuvchilar',
      log: 'Amallar tarixi'
    };
    document.getElementById('pageTitle').textContent = titleMap[tab] || '';
    if (tab === 'holidays') loadHolidays();
    if (tab === 'device') loadDevice();
    if (tab === 'account') loadTelegramConfig();
    if (tab === 'users') loadUsers();
    if (tab === 'log') loadLog();
  });
});

// ============================================================
// TOAST
// ============================================================
function toast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = type === 'error' ? '#DC2626' : '#18181B';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ============================================================
// CLOCK
// ============================================================
function tickClock() {
  const now = new Date();
  document.getElementById('clockTime').textContent = now.toLocaleTimeString('uz-UZ', { hour12: false });
  const d = now.getDay();
  document.getElementById('clockDay').textContent = DAY_NAMES[d] || 'Yakshanba';
}
setInterval(tickClock, 1000);
tickClock();

// ============================================================
// SCHEDULE — ROW BUILD
// ============================================================
function timeStr(h, m) {
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// type: 'in' = Kirish (continuous), 'out' = Chiqish (pulsed), 'custom' = Qo'lda
function rowHtml(prefix, idx, it) {
  const t = timeStr(it.hour, it.minute);
  const pattern = it.ring_pattern === 'pulsed' ? 'pulsed' : 'continuous';
  const pc = it.pulse_count || 3;
  const pg = it.pulse_gap_sec || 1;
  const dur = it.duration_sec || 5;

  // Determine current type from pattern
  // We don't store 'type' — infer from pattern for display
  const showPulse = pattern === 'pulsed';

  return `<div class="time-row" id="${prefix}row${idx}">
    <input type="time" value="${t}" id="${prefix}t${idx}">
    <input type="text" placeholder="Nomi (masalan: 1-dars boshi)" value="${it.label || ''}" id="${prefix}l${idx}">
    <select id="${prefix}p${idx}" onchange="onPatternChange('${prefix}',${idx})">
      <option value="continuous" ${pattern === 'continuous' ? 'selected' : ''}>Uzluksiz</option>
      <option value="pulsed" ${pattern === 'pulsed' ? 'selected' : ''}>Uzib-uzib</option>
    </select>
    <span class="row-lbl">sek:</span>
    <input type="number" min="1" max="60" value="${dur}" id="${prefix}d${idx}">
    <span class="pulse-fields" id="${prefix}pf${idx}" style="${showPulse ? '' : 'display:none'}">
      <span class="row-lbl">marta:</span>
      <input type="number" min="2" max="10" value="${pc}" id="${prefix}pc${idx}">
      <span class="row-lbl">tin:</span>
      <input type="number" min="1" max="10" value="${pg}" id="${prefix}pg${idx}">
    </span>
    <button class="del-btn" onclick="delRow('${prefix}',${idx})" title="O'chirish">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>`;
}

function onPatternChange(prefix, idx) {
  const pattern = document.getElementById(`${prefix}p${idx}`).value;
  const pf = document.getElementById(`${prefix}pf${idx}`);
  if (pf) pf.style.display = pattern === 'pulsed' ? '' : 'none';
}

function renderList(prefix, items) {
  items.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  const el = document.getElementById(prefix + 'List');
  const emptyEl = document.getElementById(prefix + 'Empty');
  if (!el) return;
  el.innerHTML = items.map((it, i) => rowHtml(prefix, i, it)).join('');
  if (emptyEl) emptyEl.style.display = items.length ? 'none' : 'flex';
  window[prefix + 'Items'] = items;
}

function addRow(prefix) {
  const items = window[prefix + 'Items'] || [];
  items.push({ hour: 8, minute: 0, duration_sec: 5, label: '', ring_pattern: 'continuous', pulse_count: 3, pulse_gap_sec: 1 });
  renderList(prefix, items);
}

function delRow(prefix, idx) {
  const items = window[prefix + 'Items'];
  if (!items) return;
  items.splice(idx, 1);
  renderList(prefix, items);
}

function collectRows(prefix) {
  const items = window[prefix + 'Items'] || [];
  return items.map((_, i) => {
    const tVal = (document.getElementById(`${prefix}t${i}`) || {}).value || '08:00';
    const parts = tVal.split(':');
    const pattern = (document.getElementById(`${prefix}p${i}`) || {}).value || 'continuous';
    return {
      hour: parseInt(parts[0]) || 8,
      minute: parseInt(parts[1]) || 0,
      duration_sec: parseInt((document.getElementById(`${prefix}d${i}`) || {}).value) || 5,
      label: ((document.getElementById(`${prefix}l${i}`) || {}).value || '').trim(),
      ring_pattern: pattern,
      pulse_count: parseInt((document.getElementById(`${prefix}pc${i}`) || {}).value) || 3,
      pulse_gap_sec: parseInt((document.getElementById(`${prefix}pg${i}`) || {}).value) || 1
    };
  });
}

// ============================================================
// DAY TABS
// ============================================================
function renderDayTabs() {
  const el = document.getElementById('dayTabs');
  if (!el) return;
  el.innerHTML = '';
  DAY_KEYS.forEach(d => {
    const btn = document.createElement('div');
    btn.className = 'tab' + (d === currentDay ? ' active' : '');
    btn.textContent = DAY_NAMES[d];
    btn.onclick = () => { currentDay = d; refreshDayView(); };
    el.appendChild(btn);
  });
}

function refreshDayView() {
  renderDayTabs();
  if (!scheduleData) return;
  const dayInfo = scheduleData.days[currentDay] || { items: [] };
  renderList('day', JSON.parse(JSON.stringify(dayInfo.items)));
}

function loadSchedule() {
  fetch('/api/admin/schedule').then(r => r.json()).then(data => {
    scheduleData = data;
    refreshDayView();
  });
}

function saveDay() {
  const items = collectRows('day');
  fetch('/api/admin/schedule/day', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: currentDay, items })
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      toast(DAY_NAMES[currentDay] + ' jadvali saqlandi ✓');
      loadSchedule();
    } else {
      toast(d.error || 'Xatolik yuz berdi', 'error');
    }
  }).catch(() => toast('Server bilan bog\'lanishda xato', 'error'));
}

// Button event listeners
document.getElementById('addRowBtn').onclick = () => addRow('day');
document.getElementById('saveDayBtn').onclick = saveDay;

// ============================================================
// PRESET TEMPLATES
// ============================================================
const PRESET_TEMPLATES = {
  shift1: [
    { hour: 8, minute: 0, duration_sec: 5, label: '1-dars kirish', ring_pattern: 'continuous' },
    { hour: 8, minute: 45, duration_sec: 5, label: '1-dars chiqish', ring_pattern: 'continuous' },
    { hour: 8, minute: 50, duration_sec: 5, label: '2-dars kirish', ring_pattern: 'continuous' },
    { hour: 9, minute: 35, duration_sec: 5, label: '2-dars chiqish', ring_pattern: 'continuous' },
    { hour: 9, minute: 45, duration_sec: 5, label: '3-dars kirish (Katta tanaffus)', ring_pattern: 'continuous' },
    { hour: 10, minute: 30, duration_sec: 5, label: '3-dars chiqish', ring_pattern: 'continuous' },
    { hour: 10, minute: 35, duration_sec: 5, label: '4-dars kirish', ring_pattern: 'continuous' },
    { hour: 11, minute: 20, duration_sec: 5, label: '4-dars chiqish', ring_pattern: 'continuous' },
    { hour: 11, minute: 25, duration_sec: 5, label: '5-dars kirish', ring_pattern: 'continuous' },
    { hour: 12, minute: 10, duration_sec: 5, label: '5-dars chiqish', ring_pattern: 'continuous' },
    { hour: 12, minute: 15, duration_sec: 5, label: '6-dars kirish', ring_pattern: 'continuous' },
    { hour: 13, minute: 0, duration_sec: 5, label: '6-dars chiqish (1-smena tugashi)', ring_pattern: 'continuous' }
  ],
  shift2: [
    { hour: 13, minute: 30, duration_sec: 5, label: '1-dars kirish', ring_pattern: 'continuous' },
    { hour: 14, minute: 15, duration_sec: 5, label: '1-dars chiqish', ring_pattern: 'continuous' },
    { hour: 14, minute: 20, duration_sec: 5, label: '2-dars kirish', ring_pattern: 'continuous' },
    { hour: 15, minute: 5, duration_sec: 5, label: '2-dars chiqish', ring_pattern: 'continuous' },
    { hour: 15, minute: 15, duration_sec: 5, label: '3-dars kirish', ring_pattern: 'continuous' },
    { hour: 16, minute: 0, duration_sec: 5, label: '3-dars chiqish', ring_pattern: 'continuous' },
    { hour: 16, minute: 5, duration_sec: 5, label: '4-dars kirish', ring_pattern: 'continuous' },
    { hour: 16, minute: 50, duration_sec: 5, label: '4-dars chiqish', ring_pattern: 'continuous' },
    { hour: 16, minute: 55, duration_sec: 5, label: '5-dars kirish', ring_pattern: 'continuous' },
    { hour: 17, minute: 40, duration_sec: 5, label: '5-dars chiqish', ring_pattern: 'continuous' },
    { hour: 17, minute: 45, duration_sec: 5, label: '6-dars kirish', ring_pattern: 'continuous' },
    { hour: 18, minute: 30, duration_sec: 5, label: '6-dars chiqish (2-smena tugashi)', ring_pattern: 'continuous' }
  ],
  shortDay: [
    { hour: 8, minute: 0, duration_sec: 5, label: '1-dars kirish (35 min)', ring_pattern: 'continuous' },
    { hour: 8, minute: 35, duration_sec: 5, label: '1-dars chiqish', ring_pattern: 'continuous' },
    { hour: 8, minute: 40, duration_sec: 5, label: '2-dars kirish', ring_pattern: 'continuous' },
    { hour: 9, minute: 15, duration_sec: 5, label: '2-dars chiqish', ring_pattern: 'continuous' },
    { hour: 9, minute: 20, duration_sec: 5, label: '3-dars kirish', ring_pattern: 'continuous' },
    { hour: 9, minute: 55, duration_sec: 5, label: '3-dars chiqish', ring_pattern: 'continuous' },
    { hour: 10, minute: 0, duration_sec: 5, label: '4-dars kirish', ring_pattern: 'continuous' },
    { hour: 10, minute: 35, duration_sec: 5, label: '4-dars chiqish', ring_pattern: 'continuous' },
    { hour: 10, minute: 40, duration_sec: 5, label: '5-dars kirish', ring_pattern: 'continuous' },
    { hour: 11, minute: 15, duration_sec: 5, label: '5-dars chiqish', ring_pattern: 'continuous' },
    { hour: 11, minute: 20, duration_sec: 5, label: '6-dars kirish', ring_pattern: 'continuous' },
    { hour: 11, minute: 55, duration_sec: 5, label: '6-dars chiqish', ring_pattern: 'continuous' }
  ]
};

function applyPreset(tplKey) {
  if (!PRESET_TEMPLATES[tplKey]) return;
  if (!confirm(`Hozirgi ${DAY_NAMES[currentDay]} jadvaliga ushbu shablonni yuklamoqchimisiz?`)) return;
  const items = JSON.parse(JSON.stringify(PRESET_TEMPLATES[tplKey]));
  renderList('day', items);
  toast('Shablon yuklandi. "Saqlash" tugmasini bosing ✓');
}

const tpl1Btn = document.getElementById('tpl1SmenaBtn');
if (tpl1Btn) tpl1Btn.onclick = () => applyPreset('shift1');

const tpl2Btn = document.getElementById('tpl2SmenaBtn');
if (tpl2Btn) tpl2Btn.onclick = () => applyPreset('shift2');

const tplShortBtn = document.getElementById('tplShortDayBtn');
if (tplShortBtn) tplShortBtn.onclick = () => applyPreset('shortDay');

const tplClearBtn = document.getElementById('tplClearDayBtn');
if (tplClearBtn) {
  tplClearBtn.onclick = () => {
    if (!confirm(`${DAY_NAMES[currentDay]} jadvalidagi barcha vaqtlarni tozalashni tasdiqlaysizmi?`)) return;
    renderList('day', []);
    toast('Jadval tozalandi. "Saqlash" tugmasini bosing ✓');
  };
}

// ============================================================
// MUTE
// ============================================================
let isMuted = false;

function applyMuteVisual() {
  const sw = document.getElementById('muteSwitch');
  const label = document.getElementById('muteLabel');
  const banner = document.getElementById('muteBanner');
  if (sw) sw.classList.toggle('is-muted', isMuted);
  if (label) label.textContent = isMuted ? "O'chirilgan" : "Yoqilgan";
  if (banner) banner.classList.toggle('show', isMuted);
}

function loadMuteState() {
  fetch('/api/admin/mute').then(r => r.json()).then(d => {
    isMuted = d.muted;
    applyMuteVisual();
  });
}

document.getElementById('muteSwitch').onclick = () => {
  fetch('/api/admin/mute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ muted: !isMuted })
  }).then(r => r.json()).then(d => {
    isMuted = d.muted;
    applyMuteVisual();
    toast(isMuted ? "Qo'ng'iroq o'chirildi" : "Qo'ng'iroq yoqildi");
  });
};

// ============================================================
// DEVICE TAB
// ============================================================
let deviceWasOnline = null;

function relativeTime(iso) {
  if (!iso) return null;
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 10) return 'hozirgina';
  if (sec < 60) return `${sec} soniya oldin`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} daqiqa oldin`;
  const hr = Math.floor(min / 60);
  return hr < 24 ? `${hr} soat oldin` : new Date(iso).toLocaleString('uz-UZ');
}

function pollDeviceStatus() {
  fetch('/api/admin/device-status').then(r => r.json()).then(d => {
    const scene = document.getElementById('connScene');
    const badgeDot = document.getElementById('connBadgeDot');
    const sideDot = document.getElementById('deviceDot');
    const badge = document.getElementById('deviceStatusText');
    const detail = document.getElementById('deviceStatusDetail');
    const linkLabel = document.getElementById('connLinkLabel');
    const serverSub = document.getElementById('connServerSub');

    // Apply scene state
    if (scene) {
      scene.classList.remove('online', 'offline');
      if (d.online === true) scene.classList.add('online');
      else if (d.online === false) scene.classList.add('offline');
    }
    if (badgeDot) {
      badgeDot.classList.toggle('online', d.online === true);
      badgeDot.classList.toggle('offline', d.online === false);
    }
    if (sideDot) {
      sideDot.classList.toggle('online', d.online === true);
      sideDot.classList.toggle('offline', d.online === false);
    }

    if (badge) {
      if (d.online === true) {
        badge.textContent = 'ESP32 ulangan va ishlayapti';
        badge.style.color = 'var(--success)';
      } else if (!d.lastSeen) {
        badge.textContent = 'Hali ulanmagan';
        badge.style.color = 'var(--text-muted)';
      } else {
        badge.textContent = 'ESP32 oflayn';
        badge.style.color = 'var(--danger)';
      }
    }

    if (linkLabel) {
      if (d.online === true) {
        linkLabel.textContent = 'jadval so\'rovi → har 2 daqiqada';
      } else if (d.lastSeen) {
        linkLabel.textContent = 'aloqa yo\'q';
      } else {
        linkLabel.textContent = 'so\'rov yo\'q';
      }
    }

    if (serverSub) {
      serverSub.textContent = d.online ? 'Faol' : (d.lastSeen ? 'Kutmoqda' : 'Kutmoqda');
    }

    if (detail) {
      if (!d.lastSeen) {
        detail.textContent = 'Qurilma serverga hali bir marta ham bog\'lanmagan.';
      } else {
        const rel = relativeTime(d.lastSeen);
        detail.textContent = `Oxirgi aloqa: ${rel}  ·  IP: ${d.lastIp || '—'}`;
      }
    }

    if (deviceWasOnline !== null && deviceWasOnline !== d.online) {
      toast(d.online ? '📶 Qurilma ulandi' : '⚠️ Qurilma aloqasi uzildi');
    }
    deviceWasOnline = d.online;

    if (d.geo) {
      updateDeviceMap(d.geo, d.online);
    }
  }).catch(() => {});
}

// ============================================================
// DEVICE MAP (LEAFLET + OPENSTREETMAP)
// ============================================================
let deviceMap = null;
let deviceMarker = null;
let customPinnedCoords = null;
let pendingGeoData = null;
let pendingOnlineState = null;

function initDeviceMap() {
  const mapEl = document.getElementById('deviceMap');
  if (!mapEl || typeof L === 'undefined' || deviceMap) return false;

  // Leaflet xaritani faqat tab ko'rinayotganda yaratish mumkin
  const tabEl = document.getElementById('tab-device');
  if (tabEl && tabEl.style.display === 'none') return false;

  try {
    deviceMap = L.map('deviceMap').setView([41.2995, 69.2401], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(deviceMap);

    const schoolIcon = L.divIcon({
      className: 'school-map-pin',
      html: '<div style="background:#4F46E5; color:white; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 0 12px rgba(79,70,229,0.5); font-size:16px; border:2px solid white;">🔔</div>',
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    deviceMarker = L.marker([41.2995, 69.2401], {
      icon: schoolIcon,
      draggable: isAdmin()
    }).addTo(deviceMap);

    deviceMarker.bindPopup('<b>ESP32 Maktab Qo\'ng\'irog\'i</b><br>Joylashuvi aniqlanmoqda...');

    if (isAdmin()) {
      deviceMarker.on('dragend', function (e) {
        const pos = e.target.getLatLng();
        customPinnedCoords = { lat: pos.lat, lon: pos.lng };
        const saveBtn = document.getElementById('saveLocationBtn');
        if (saveBtn) {
          saveBtn.style.display = 'inline-flex';
          saveBtn.textContent = `💾 Saqlash (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})`;
        }
        toast('Yangi nuqta tanlandi. Saqlash uchun tugmani bosing.');
      });
    }

    // Agar oldindan yig'ilgan geo ma'lumotlar bo'lsa, hozir ko'rsatish
    if (pendingGeoData) {
      updateDeviceMap(pendingGeoData, pendingOnlineState);
    }
    return true;
  } catch (e) {}
  return false;
}

const saveLocationBtn = document.getElementById('saveLocationBtn');
if (saveLocationBtn) {
  saveLocationBtn.onclick = () => {
    if (!customPinnedCoords) return;
    fetch('/api/admin/device-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customPinnedCoords)
    }).then(r => r.json()).then(d => {
      if (d.ok) {
        toast('Joylashuv muvaffaqiyatli saqlandi ✓');
        saveLocationBtn.style.display = 'none';
        pollDeviceStatus();
      } else {
        toast(d.error || 'Xatolik', 'error');
      }
    }).catch(() => toast('Server bilan aloqada xato', 'error'));
  };
}

function updateDeviceMap(geo, isOnline) {
  if (!geo) return;

  // Geo ma'lumotlarini doimo saqlash (xarita hali yaratilmagan bo'lsa)
  pendingGeoData = geo;
  pendingOnlineState = isOnline;

  const lat = geo.lat || 41.2995;
  const lon = geo.lon || 69.2401;

  const city = geo.city || 'Toshkent';
  const region = geo.region ? ` (${geo.region})` : '';
  const isp = geo.isp || '—';
  const ip = geo.ip || '—';

  const cityEl = document.getElementById('geoCityVal');
  const ispEl = document.getElementById('geoIspVal');
  const coordsEl = document.getElementById('geoCoordsVal');
  const ipEl = document.getElementById('geoIpVal');
  const mapCityText = document.getElementById('mapCityText');

  if (cityEl) cityEl.textContent = `${city}${region}`;
  if (ispEl) ispEl.textContent = isp;
  if (coordsEl) coordsEl.textContent = `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
  if (ipEl) ipEl.textContent = ip;
  if (mapCityText) mapCityText.textContent = `${city}`;

  // Xarita hali tayyor emas bo'lsa, yaratishga urinish
  if (!deviceMap) {
    initDeviceMap();
  }

  if (deviceMap && deviceMarker) {
    deviceMarker.setLatLng([lat, lon]);
    deviceMarker.getPopup().setContent(`<b>🔔 ${currentSchoolName || 'Maktab'}</b><br>Holati: ${isOnline ? '<span style="color:#059669;font-weight:600">🟢 Onlayn</span>' : '<span style="color:#DC2626;font-weight:600">🔴 Oflayn</span>'}<br>Shahar: ${city}<br>Provayder: ${isp}<br>IP: ${ip}`);
    
    setTimeout(() => {
      if (deviceMap) {
        deviceMap.invalidateSize();
        deviceMap.panTo([lat, lon]);
      }
    }, 200);
  }
}

function loadDevice() {
  pollDeviceStatus();
  // Tab ochilganda xarita yaratish yoki o'lchamini yangilash
  setTimeout(() => {
    if (!deviceMap) {
      initDeviceMap();
    }
    if (deviceMap) {
      deviceMap.invalidateSize();
      // Agar geo ma'lumot mavjud bo'lsa, xaritani yangilash
      if (pendingGeoData) {
        updateDeviceMap(pendingGeoData, pendingOnlineState);
      }
    }
  }, 300);
}

function startDevicePolling() {
  pollDeviceStatus();
  setInterval(pollDeviceStatus, 8000);
}

// ============================================================
// ACCOUNT & TELEGRAM
// ============================================================
function loadTelegramConfig() {
  if (!isAdmin()) return;
  fetch('/api/admin/telegram').then(r => r.json()).then(d => {
    const tInput = document.getElementById('tgTokenInput');
    const cInput = document.getElementById('tgChatIdInput');
    if (tInput) tInput.value = d.token || '';
    if (cInput) cInput.value = d.adminChatId || '';
  }).catch(() => {});
}

const saveTelegramBtn = document.getElementById('saveTelegramBtn');
if (saveTelegramBtn) {
  saveTelegramBtn.onclick = () => {
    const token = (document.getElementById('tgTokenInput') || {}).value.trim();
    const adminChatId = (document.getElementById('tgChatIdInput') || {}).value.trim();
    fetch('/api/admin/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, adminChatId })
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) { toast(d.error || 'Xato', 'error'); return; }
      toast('Telegram sozlamalari saqlandi va bot ishga tushdi ✓');
    }).catch(() => toast('Server bilan aloqada xato', 'error'));
  };
}

document.getElementById('changePassBtn').onclick = () => {
  const cur = (document.getElementById('curPass') || {}).value;
  const nw = (document.getElementById('newPass') || {}).value;
  if (!cur || !nw) { toast('Ikkala maydonni ham to\'ldiring', 'error'); return; }
  fetch('/api/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: cur, newPassword: nw })
  }).then(async r => {
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'Xato', 'error'); return; }
    toast('Parol yangilandi ✓');
    document.getElementById('curPass').value = '';
    document.getElementById('newPass').value = '';
  });
};

// ============================================================
// LOG
// ============================================================
function loadLog() {
  fetch('/api/admin/audit-log').then(r => r.json()).then(rows => {
    const tbody = document.querySelector('#logTable tbody');
    if (!tbody) return;
    const actionLabel = {
      login_success: 'Kirdi', login_failed: 'Xato kirish', logout: 'Chiqdi',
      update_day_schedule: 'Jadval yangilandi', password_changed: 'Parol o\'zgartirildi',
      bell_muted: 'Qo\'ng\'iroq o\'chirildi', bell_unmuted: 'Qo\'ng\'iroq yoqildi',
      regenerate_device_key: 'Kalit yangilandi', device_connected: 'Qurilma ulandi',
      update_school_name: 'Maktab nomi o\'zgartirildi'
    };
    tbody.innerHTML = rows.map(r => `<tr>
      <td class="mono">${new Date(r.created_at).toLocaleString('uz-UZ')}</td>
      <td>${r.username || '—'}</td>
      <td>${actionLabel[r.action] || r.action}</td>
      <td>${r.detail || ''}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px">Tarix bo\'sh</td></tr>';
  });
}

// ============================================================
// HOLIDAYS
// ============================================================
function loadHolidays() {
  fetch('/api/admin/holidays').then(r => r.json()).then(items => {
    const tbody = document.getElementById('holidaysList');
    const empty = document.getElementById('holidaysEmpty');
    if (!tbody) return;
    if (!items || items.length === 0) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';
    tbody.innerHTML = items.map(h => `<tr>
      <td class="mono" style="font-weight:600;">${h.date}</td>
      <td>${h.name || '—'}</td>
      <td style="text-align:right;">
        <button class="btn btn-ghost btn-sm" onclick="deleteHoliday(${h.id})" style="color:var(--danger, #DC2626); padding:4px 8px;">
          O'chirish
        </button>
      </td>
    </tr>`).join('');
  }).catch(() => toast('Bayramlarni yuklashda xato', 'error'));
}

window.deleteHoliday = function(id) {
  if (!confirm('Ushbu bayram sanasini o\'chirmoqchimisiz?')) return;
  fetch('/api/admin/holidays/' + id, { method: 'DELETE' })
    .then(r => r.json())
    .then(d => {
      if (d.ok) {
        toast('O\'chirildi ✓');
        loadHolidays();
      } else {
        toast(d.error || 'Xato', 'error');
      }
    });
};

const addHolidayBtn = document.getElementById('addHolidayBtn');
if (addHolidayBtn) {
  addHolidayBtn.onclick = () => {
    const date = (document.getElementById('holidayDateInput') || {}).value;
    const name = (document.getElementById('holidayNameInput') || {}).value.trim();
    if (!date) { toast('Sanani tanlang', 'error'); return; }
    fetch('/api/admin/holidays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, name })
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) { toast(d.error || 'Xato', 'error'); return; }
      toast('Bayram sanasi saqlandi ✓');
      document.getElementById('holidayDateInput').value = '';
      document.getElementById('holidayNameInput').value = '';
      loadHolidays();
    });
  };
}

// O'zbekiston rasmiy bayramlarini tez qo'shish tugmalari
document.querySelectorAll('#quickHolidays button').forEach(btn => {
  btn.onclick = () => {
    const currentYear = new Date().getFullYear();
    const mmdd = btn.dataset.date;
    const name = btn.dataset.name;
    const fullDate = `${currentYear}-${mmdd}`;
    fetch('/api/admin/holidays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: fullDate, name })
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) { toast(d.error || 'Xato', 'error'); return; }
      toast(`${name} (${fullDate}) qo'shildi ✓`);
      loadHolidays();
    });
  };
});

// ============================================================
// MANUAL & EMERGENCY BELL TRIGGER
// ============================================================
function triggerManualBell(opts) {
  fetch('/api/admin/trigger-bell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts)
  }).then(async r => {
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'Xato', 'error'); return; }
    toast(d.message || 'Buyruq yuborildi ✓');
  }).catch(() => toast('Server bilan aloqada xato', 'error'));
}

document.querySelectorAll('.trigger-ring-5').forEach(btn => {
  btn.onclick = () => triggerManualBell({ action: 'ring', duration_sec: 5, ring_pattern: 'continuous' });
});

document.querySelectorAll('.trigger-ring-pulse').forEach(btn => {
  btn.onclick = () => triggerManualBell({ action: 'ring', duration_sec: 3, ring_pattern: 'pulsed', pulse_count: 3, pulse_gap_sec: 1 });
});

document.querySelectorAll('.trigger-ring-emergency').forEach(btn => {
  btn.onclick = () => {
    if (!confirm('🚨 DIQQAT: Favqulodda trevoga signali 30 soniya davomida uzluksiz chalinadi! Tasdiqlaysizmi?')) return;
    triggerManualBell({ action: 'ring', duration_sec: 30, ring_pattern: 'continuous' });
  };
});

document.querySelectorAll('.trigger-ring-stop').forEach(btn => {
  btn.onclick = () => triggerManualBell({ action: 'stop' });
});

// ============================================================
// USERS MANAGEMENT (ADMIN & USER)
// ============================================================
function loadUsers() {
  if (!isAdmin()) return;
  fetch('/api/admin/users').then(r => r.json()).then(rows => {
    const tbody = document.getElementById('usersList');
    if (!tbody) return;
    tbody.innerHTML = rows.map(u => `<tr>
      <td class="mono">${u.id}</td>
      <td><b>${u.username}</b></td>
      <td>
        <span class="conn-badge" style="padding:2px 8px; font-size:11px; background:${u.role === 'admin' ? 'rgba(59,130,246,0.15)' : 'rgba(107,114,128,0.15)'}; color:${u.role === 'admin' ? '#2563eb' : '#4b5563'}">
          ${u.role === 'admin' ? '👑 Admin' : '👤 User'}
        </span>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:6px;">
          <code class="mono" style="background:rgba(0,0,0,0.06); padding:3px 7px; border-radius:4px; font-size:11px; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block;" title="${u.api_key || ''}">${u.api_key || '—'}</code>
          <button class="btn btn-ghost btn-sm" onclick="copyUserApiKey('${u.api_key || ''}')" title="Kalitdan nusxa olish" style="padding:2px 6px; font-size:11px; line-height:1.2;">
            📋 Nusxa
          </button>
          <button class="btn btn-ghost btn-sm" onclick="regenerateUserKey(${u.id}, '${u.username}')" title="Yangi kalit yaratish" style="padding:2px 6px; font-size:11px; line-height:1.2;">
            🔄
          </button>
        </div>
      </td>
      <td class="mono">${new Date(u.created_at).toLocaleDateString('uz-UZ')}</td>
      <td style="text-align:right;">
        <button class="btn btn-ghost btn-sm" onclick="resetUserPassword(${u.id}, '${u.username}')" style="padding:4px 8px; margin-right:4px;">
          Parol
        </button>
        <button class="btn btn-ghost btn-sm" onclick="deleteUserAccount(${u.id}, '${u.username}')" style="color:var(--danger, #DC2626); padding:4px 8px;">
          O'chirish
        </button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px">Foydalanuvchilar yo\'q</td></tr>';
  }).catch(() => toast('Foydalanuvchilarni yuklashda xato', 'error'));
}

function copyToClipboard(text, successMsg = 'Nusxalandi ✓') {
  if (!text) { toast('Nusxalash uchun matn yo\'q', 'error'); return; }

  // 1. Agar navigator.clipboard mavjud va ruxsat berilgan bo'lsa
  if (navigator.clipboard && (window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.clipboard.writeText(text).then(() => {
      toast(successMsg);
    }).catch(() => {
      fallbackCopyText(text, successMsg);
    });
  } else {
    // 2. HTTP yoki qo'llab-quvvatlamaydigan brauzerlar uchun universal fallback
    fallbackCopyText(text, successMsg);
  }
}

function fallbackCopyText(text, successMsg) {
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    textArea.style.left = '-9999px';
    textArea.style.opacity = '0';
    textArea.setAttribute('readonly', '');
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, 99999); // Mobile uchun
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    if (successful) {
      toast(successMsg);
    } else {
      prompt('API kalitdan nusxa oling (Ctrl+C):', text);
    }
  } catch (err) {
    prompt('API kalitdan nusxa oling (Ctrl+C):', text);
  }
}

window.copyUserApiKey = function(key) {
  copyToClipboard(key, 'ESP32 API kalit nusxalandi ✓');
};

window.regenerateUserKey = function(id, username) {
  if (!confirm(`"${username}" uchun yangi ESP32 API kalit generatsiya qilinsinmi? (Eski kalit bekor qilinadi)`)) return;
  fetch(`/api/admin/users/${id}/regenerate-key`, { method: 'POST' })
    .then(r => r.json())
    .then(d => {
      if (d.ok) {
        toast(`"${username}" uchun yangi API kalit yaratildi ✓`);
        loadUsers();
      } else {
        toast(d.error || 'Xatolik', 'error');
      }
    }).catch(() => toast('Server xatosi', 'error'));
};

window.deleteUserAccount = function(id, username) {
  if (!confirm(`"${username}" hisobini o'chirishni tasdiqlaysizmi?`)) return;
  fetch('/api/admin/users/' + id, { method: 'DELETE' })
    .then(r => r.json())
    .then(d => {
      if (d.ok) {
        toast('Foydalanuvchi o\'chirildi ✓');
        loadUsers();
      } else {
        toast(d.error || 'Xatolik', 'error');
      }
    }).catch(() => toast('Server xatosi', 'error'));
};

window.resetUserPassword = function(id, username) {
  const newPass = prompt(`"${username}" uchun yangi parolni kiriting (kamida 6 ta belgi):`);
  if (!newPass) return;
  if (newPass.length < 6) {
    toast('Parol kamida 6 belgidan iborat bo\'lishi kerak', 'error');
    return;
  }
  fetch(`/api/admin/users/${id}/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPassword: newPass })
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      toast(`"${username}" paroli yangilandi ✓`);
    } else {
      toast(d.error || 'Xatolik', 'error');
    }
  }).catch(() => toast('Server xatosi', 'error'));
};

const createUserBtn = document.getElementById('createUserBtn');
if (createUserBtn) {
  createUserBtn.onclick = () => {
    const uInput = document.getElementById('newUsernameInput');
    const pInput = document.getElementById('newUserPasswordInput');
    const rInput = document.getElementById('newUserRoleSelect');

    const username = (uInput || {}).value.trim();
    const password = (pInput || {}).value.trim();
    const role = (rInput || {}).value;

    if (!username || !password) {
      toast('Login va parolni to\'ldiring', 'error');
      return;
    }
    if (password.length < 6) {
      toast('Parol kamida 6 belgidan iborat bo\'lishi kerak', 'error');
      return;
    }

    fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role })
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) { toast(d.error || 'Xatolik', 'error'); return; }
      toast(`Yangi ${role === 'admin' ? 'Admin' : 'Foydalanuvchi'} ("${username}") yaratildi ✓`);
      uInput.value = '';
      pInput.value = '';
      loadUsers();
    }).catch(() => toast('Server bilan aloqada xato', 'error'));
  };
}
