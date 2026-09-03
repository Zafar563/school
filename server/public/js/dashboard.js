// Maktab Qo'ng'irog'i — Boshqaruv paneli skripti (Multi-tenant)

const DAY_NAMES = {
  1: 'Dushanba',
  2: 'Seshanba',
  3: 'Chorshanba',
  4: 'Payshanba',
  5: 'Juma',
  6: 'Shanba'
};

const DAY_KEYS = [1, 2, 3, 4, 5, 6];

let currentDay = 1;
let scheduleData = null;
let currentRole = 'user';
let currentUserId = null;
let currentSchoolName = 'Maktab';
let currentUserApiKey = '';

const isAdmin = () => currentRole === 'admin';

// ============================================================
// THEME (Tungi / Kunduzgi rejim)
// ============================================================
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeIconSun = document.getElementById('themeIconSun');
const themeIconMoon = document.getElementById('themeIconMoon');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  if (theme === 'dark') {
    if (themeIconSun) themeIconSun.style.display = 'block';
    if (themeIconMoon) themeIconMoon.style.display = 'none';
  } else {
    if (themeIconSun) themeIconSun.style.display = 'none';
    if (themeIconMoon) themeIconMoon.style.display = 'block';
  }
}

const initialTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
applyTheme(initialTheme);

if (themeToggleBtn) {
  themeToggleBtn.onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  };
}

// ============================================================
// BRANDING
// ============================================================
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

// ============================================================
// ROLE & MULTI-TENANT VISIBILITY
// ============================================================
function applyRoleVisibility(role) {
  const admin = role === 'admin';
  document.body.classList.remove('is-admin', 'is-user');
  document.body.classList.add(admin ? 'is-admin' : 'is-user');

  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = admin ? '' : 'none';
  });

  const roleLabel = document.getElementById('userRoleLabel');
  if (roleLabel) {
    roleLabel.textContent = admin ? '👑 Administrator' : '👤 Foydalanuvchi';
    roleLabel.style.color = admin ? 'var(--primary)' : 'var(--success)';
  }

  if (!admin) {
    const activeTab = document.querySelector('.sidebar nav a.active');
    if (activeTab && activeTab.classList.contains('admin-only')) {
      const scheduleTab = document.querySelector('.sidebar nav a[data-tab="schedule"]');
      if (scheduleTab) scheduleTab.click();
    }
  }
}

// ============================================================
// AUTH & INITIALIZATION
// ============================================================
fetch('/api/me').then(r => r.json()).then(async d => {
  if (!d.loggedIn) { window.location.href = '/login.html'; return; }
  currentUserId = d.userId;
  document.getElementById('userLabel').textContent = d.username;
  currentRole = d.role || 'user';
  currentUserApiKey = d.apiKey || '';
  if (d.schoolName) {
    currentSchoolName = d.schoolName;
    document.getElementById('sidebarSchoolName').textContent = currentSchoolName;
  }
  applyRoleVisibility(currentRole);
  if (isAdmin()) {
    await loadSchoolDropdowns();
  }
  startDevicePolling();
  loadSchedule();
  loadMuteState();
});

document.getElementById('logoutBtn').onclick = () => {
  fetch('/api/logout', { method: 'POST' }).then(() => window.location.href = '/login.html');
};

// ============================================================
// TABS NAVIGATION
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
      device: 'Qurilmalar va aloqa',
      account: 'Hisobim',
      users: 'Foydalanuvchilar',
      log: 'Amallar tarixi'
    };
    document.getElementById('pageTitle').textContent = titleMap[tab] || '';
    if (tab === 'schedule') {
      if (isAdmin()) loadSchoolDropdowns();
      loadSchedule();
    }
    if (tab === 'holidays') {
      if (isAdmin()) loadSchoolDropdowns();
      loadHolidays();
    }
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
// ADMIN SCHOOL DROPDOWNS (MULTI-TENANT)
// ============================================================
let allUsersList = [];

async function loadSchoolDropdowns() {
  if (!isAdmin()) return;
  try {
    const res = await fetch('/api/admin/users');
    const users = await res.json();
    allUsersList = Array.isArray(users) ? users : [];
    const options = allUsersList.map(u => `<option value="${u.id}">🏫 ${u.school_name || u.username} (@${u.username})</option>`).join('');

    const sSelect = document.getElementById('adminScheduleUserSelect');
    if (sSelect) {
      const prev = sSelect.value;
      sSelect.innerHTML = options;
      if (prev && allUsersList.some(u => String(u.id) === String(prev))) {
        sSelect.value = prev;
      } else if (allUsersList[0]) {
        sSelect.value = allUsersList[0].id;
      }
    }

    const hSelect = document.getElementById('adminHolidayUserSelect');
    if (hSelect) {
      const prev = hSelect.value;
      hSelect.innerHTML = options;
      if (prev && allUsersList.some(u => String(u.id) === String(prev))) {
        hSelect.value = prev;
      } else if (allUsersList[0]) {
        hSelect.value = allUsersList[0].id;
      }
    }

    const dSelect = document.getElementById('adminDeviceUserSelect');
    if (dSelect) {
      const prev = dSelect.value;
      dSelect.innerHTML = options;
      if (prev && allUsersList.some(u => String(u.id) === String(prev))) {
        dSelect.value = prev;
      } else if (allUsersList[0]) {
        dSelect.value = allUsersList[0].id;
      }
    }
  } catch (e) {}
}

const adminScheduleSelect = document.getElementById('adminScheduleUserSelect');
if (adminScheduleSelect) {
  adminScheduleSelect.onchange = () => {
    const val = adminScheduleSelect.value;
    const hSelect = document.getElementById('adminHolidayUserSelect');
    const dSelect = document.getElementById('adminDeviceUserSelect');
    if (hSelect) hSelect.value = val;
    if (dSelect) dSelect.value = val;
    loadSchedule();
    loadMuteState();
    loadCustomTemplates();
    pollDeviceStatus();
  };
}

const adminHolidaySelect = document.getElementById('adminHolidayUserSelect');
if (adminHolidaySelect) {
  adminHolidaySelect.onchange = () => {
    const val = adminHolidaySelect.value;
    const sSelect = document.getElementById('adminScheduleUserSelect');
    const dSelect = document.getElementById('adminDeviceUserSelect');
    if (sSelect) sSelect.value = val;
    if (dSelect) dSelect.value = val;
    loadHolidays();
  };
}

const adminDeviceSelect = document.getElementById('adminDeviceUserSelect');
if (adminDeviceSelect) {
  adminDeviceSelect.onchange = () => {
    const val = adminDeviceSelect.value;
    const sSelect = document.getElementById('adminScheduleUserSelect');
    const hSelect = document.getElementById('adminHolidayUserSelect');
    if (sSelect) sSelect.value = val;
    if (hSelect) hSelect.value = val;
    pollDeviceStatus();
  };
}

function getActiveScheduleUserId() {
  if (isAdmin()) {
    const s = document.getElementById('adminScheduleUserSelect');
    if (s && s.value) return s.value;
    const d = document.getElementById('adminDeviceUserSelect');
    if (d && d.value) return d.value;
    const h = document.getElementById('adminHolidayUserSelect');
    if (h && h.value) return h.value;
  }
  return null;
}

function getActiveHolidayUserId() {
  if (isAdmin()) {
    const h = document.getElementById('adminHolidayUserSelect');
    if (h && h.value) return h.value;
    const s = document.getElementById('adminScheduleUserSelect');
    if (s && s.value) return s.value;
    const d = document.getElementById('adminDeviceUserSelect');
    if (d && d.value) return d.value;
  }
  return null;
}

// ============================================================
// SCHEDULE — ROW BUILD
// ============================================================
function timeStr(h, m) {
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function rowHtml(prefix, idx, it) {
  const t = timeStr(it.hour, it.minute);
  const pattern = it.ring_pattern === 'pulsed' ? 'pulsed' : 'continuous';
  const pc = it.pulse_count || 3;
  const pg = it.pulse_gap_sec || 1;
  const dur = it.duration_sec || 5;
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
// DAY TABS & SCHEDULE LOGIC
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
  const targetId = getActiveScheduleUserId();
  const url = targetId ? `/api/admin/schedule?userId=${targetId}` : '/api/admin/schedule';
  fetch(url).then(r => r.json()).then(data => {
    scheduleData = data;
    refreshDayView();
  }).catch(() => toast('Jadvalni yuklashda xato', 'error'));
  loadCustomTemplates();
}

function saveDay() {
  const items = collectRows('day');
  const targetId = getActiveScheduleUserId();
  fetch('/api/admin/schedule/day', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: currentDay, items, userId: targetId })
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      toast(DAY_NAMES[currentDay] + ' jadvali saqlandi ✓');
      loadSchedule();
    } else {
      toast(d.error || 'Xatolik yuz berdi', 'error');
    }
  }).catch(() => toast('Server bilan bog\'lanishda xato', 'error'));
}

document.getElementById('addRowBtn').onclick = () => addRow('day');
document.getElementById('saveDayBtn').onclick = saveDay;

// ============================================================
// PRESET & CUSTOM TEMPLATES
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

let userCustomTemplates = [];

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

// MAXSUS FOYDALANUVCHI SHABLONLARI
function loadCustomTemplates() {
  const targetId = getActiveScheduleUserId();
  const url = targetId ? `/api/admin/templates?userId=${targetId}` : '/api/admin/templates';
  fetch(url).then(r => r.json()).then(list => {
    userCustomTemplates = Array.isArray(list) ? list : [];
    renderCustomTemplatesUI();
  }).catch(() => {});
}

function renderCustomTemplatesUI() {
  const box = document.getElementById('customTemplatesContainer');
  if (!box) return;
  if (!userCustomTemplates.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = userCustomTemplates.map(t => `
    <div style="display:inline-flex; align-items:center; background:var(--bg-card, #fff); border:1px solid var(--border, #e4e4e7); border-radius:6px; overflow:hidden;">
      <button class="btn btn-ghost btn-sm" onclick="applyCustomTemplate(${t.id})" style="border:none; padding:4px 8px; font-size:12px; font-weight:500;">
        📁 ${t.name} <span style="font-size:10px; color:var(--text-muted); opacity:0.8;">(${t.items.length})</span>
      </button>
      <button class="btn btn-ghost btn-sm" onclick="deleteCustomTemplate(${t.id}, '${(t.name || '').replace(/'/g, "\\'")}')" style="border:none; border-left:1px solid var(--border); padding:4px 6px; color:var(--danger, #DC2626); font-size:11px;" title="Shablonni o'chirish">
        ✕
      </button>
    </div>
  `).join('');
}

window.applyCustomTemplate = function(templateId) {
  const t = userCustomTemplates.find(x => x.id === templateId);
  if (!t) return;
  if (!confirm(`Hozirgi ${DAY_NAMES[currentDay]} jadvaliga "${t.name}" shablonini yuklamoqchimisiz?`)) return;
  renderList('day', JSON.parse(JSON.stringify(t.items)));
  toast(`"${t.name}" shabloni yuklandi. "Saqlash" tugmasini bosing ✓`);
};

window.deleteCustomTemplate = function(templateId, name) {
  if (!confirm(`"${name}" maxsus shablonini o'chirishni tasdiqlaysizmi?`)) return;
  const targetId = getActiveScheduleUserId();
  const url = `/api/admin/templates/${templateId}` + (targetId ? '?userId=' + targetId : '');
  fetch(url, { method: 'DELETE' })
    .then(r => r.json())
    .then(d => {
      if (d.ok) {
        toast('Shablon o\'chirildi ✓');
        loadCustomTemplates();
      } else {
        toast(d.error || 'Xato', 'error');
      }
    }).catch(() => toast('Server bilan aloqada xato', 'error'));
};

const saveAsTemplateBtn = document.getElementById('saveAsTemplateBtn');
if (saveAsTemplateBtn) {
  saveAsTemplateBtn.onclick = () => {
    const items = collectRows('day');
    if (!items || items.length === 0) {
      toast('Shablon yaratish uchun kamida bitta qo\'ng\'iroq vaqti qo\'shilgan bo\'lishi kerak', 'error');
      return;
    }
    const name = prompt('Ushbu kun jadvali uchun yangi shablon nomini kiriting (masalan: "Juma qisqa darslar" yoki "Imtihon rejimi"):');
    if (!name || !name.trim()) return;

    const targetId = getActiveScheduleUserId();
    fetch('/api/admin/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), items, userId: targetId })
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) { toast(d.error || 'Xatolik', 'error'); return; }
      toast(`"${name.trim()}" shabloni muvaffaqiyatli saqlandi ✓`);
      loadCustomTemplates();
    }).catch(() => toast('Server bilan aloqada xato', 'error'));
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
  const targetId = getActiveScheduleUserId();
  const url = (isAdmin() && targetId) ? `/api/admin/mute?userId=${targetId}` : '/api/admin/mute';
  fetch(url).then(r => r.json()).then(d => {
    isMuted = d.muted;
    applyMuteVisual();
  });
}

document.getElementById('muteSwitch').onclick = () => {
  const targetId = getActiveScheduleUserId();
  fetch('/api/admin/mute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ muted: !isMuted, userId: targetId })
  }).then(r => r.json()).then(d => {
    isMuted = d.muted;
    applyMuteVisual();
    toast(isMuted ? "Qo'ng'iroq o'chirildi" : "Qo'ng'iroq yoqildi");
  });
};

// ============================================================
// DEVICE TAB & STATUS
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
  const targetId = getActiveScheduleUserId();
  const url = (isAdmin() && targetId) ? `/api/admin/device-status?userId=${targetId}` : '/api/admin/device-status';

  fetch(url).then(r => r.json()).then(d => {
    const scene = document.getElementById('connScene');
    const badgeDot = document.getElementById('connBadgeDot');
    const sideDot = document.getElementById('deviceDot');
    const badge = document.getElementById('deviceStatusText');
    const detail = document.getElementById('deviceStatusDetail');
    const linkLabel = document.getElementById('connLinkLabel');
    const serverSub = document.getElementById('connServerSub');

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

    const schoolLabel = d.schoolName || d.username || 'Tanlangan maktab';
    if (badge) {
      if (d.online === true) {
        badge.innerHTML = `<b>${schoolLabel}</b>: <span style="color:var(--success)">🟢 ESP32 onlayn va ulangan</span>`;
      } else if (!d.lastSeen) {
        badge.innerHTML = `<b>${schoolLabel}</b>: <span style="color:var(--text-muted)">⚪ Hali ulanmagan</span>`;
      } else {
        badge.innerHTML = `<b>${schoolLabel}</b>: <span style="color:var(--danger)">🔴 ESP32 oflayn</span>`;
      }
    }

    if (linkLabel) {
      if (d.online === true) {
        linkLabel.textContent = 'Real-time WebSocket & jadval faol';
      } else if (d.lastSeen) {
        linkLabel.textContent = 'aloqa uzilgan';
      } else {
        linkLabel.textContent = 'so\'rov yo\'q';
      }
    }

    if (serverSub) {
      serverSub.textContent = d.online ? 'Faol' : 'Kutmoqda';
    }

    if (detail) {
      if (!d.lastSeen) {
        detail.textContent = `${schoolLabel} qurilmasi serverga hali bir marta ham bog'lanmagan.`;
      } else {
        const rel = relativeTime(d.lastSeen);
        detail.textContent = `Oxirgi aloqa: ${rel}  ·  IP: ${d.lastIp || '—'}`;
      }
    }

    // Real-time Header & Sidebar status badges for every user
    const headerDot = document.getElementById('headerDeviceDot');
    const headerText = document.getElementById('headerDeviceText');
    if (headerDot) {
      headerDot.classList.remove('online', 'offline');
      if (d.online === true) headerDot.classList.add('online');
      else if (d.online === false) headerDot.classList.add('offline');
    }
    if (headerText) {
      if (d.online === true) headerText.textContent = 'ESP32: Onlayn';
      else if (!d.lastSeen) headerText.textContent = 'ESP32: Ulanmagan';
      else headerText.textContent = 'ESP32: Oflayn';
    }

    if (deviceWasOnline !== null && deviceWasOnline !== d.online) {
      toast(d.online ? `📶 ${schoolLabel} qurilmasi ulandi` : `⚠️ ${schoolLabel} qurilmasi aloqasi uzildi`);
    }
    deviceWasOnline = d.online;
  }).catch(() => {});

  // Agar admin bo'lsa, barcha maktablar monitoring jadvalini yuklash
  if (isAdmin()) {
    fetch('/api/admin/device-status?all=true').then(r => r.json()).then(res => {
      const tbody = document.getElementById('allDevicesList');
      if (!tbody || !res || !Array.isArray(res.devices)) return;
      tbody.innerHTML = res.devices.map(u => {
        const isOnline = !!u.last_seen && (Date.now() - new Date(u.last_seen).getTime()) < 3 * 60 * 1000;
        const rel = u.last_seen ? relativeTime(u.last_seen) : 'ulanmagan';
        return `<tr>
          <td><b>${u.school_name || u.username}</b></td>
          <td><span class="mono">@${u.username}</span></td>
          <td>
            <span class="conn-badge" style="padding:3px 8px; font-size:11px; background:${isOnline ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'}; color:${isOnline ? '#059669' : '#DC2626'}; border:1px solid ${isOnline ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}">
              ${isOnline ? '🟢 Onlayn' : '🔴 Oflayn'}
            </span>
          </td>
          <td class="mono" style="font-size:12px;">${rel}</td>
          <td><code class="mono" style="font-size:11px;">${u.last_ip || '—'}</code></td>
          <td>
            <span style="font-size:12px; font-weight:600; color:${u.bell_muted ? 'var(--danger)' : 'var(--success)'}">
              ${u.bell_muted ? '🔕 O\'chirilgan' : '🔔 Faol'}
            </span>
          </td>
          <td style="text-align:right;">
            <button class="btn btn-ghost btn-sm" onclick="selectSchoolForAdmin(${u.id})" style="padding:3px 8px; font-size:11px; color:var(--primary); font-weight:600;">
              Tanlash ➜
            </button>
          </td>
        </tr>`;
      }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">Maktablar topilmadi</td></tr>';
    }).catch(() => {});
  }
}

window.selectSchoolForAdmin = function(userId) {
  const sSelect = document.getElementById('adminScheduleUserSelect');
  const hSelect = document.getElementById('adminHolidayUserSelect');
  const dSelect = document.getElementById('adminDeviceUserSelect');
  if (sSelect) sSelect.value = userId;
  if (hSelect) hSelect.value = userId;
  if (dSelect) dSelect.value = userId;
  loadSchedule();
  loadMuteState();
  loadCustomTemplates();
  pollDeviceStatus();
  toast('Maktab tanlandi ✓');
};

function loadDevice() {
  const keyInput = document.getElementById('deviceApiKeyVal');
  if (keyInput) keyInput.value = currentUserApiKey || 'Kalit topilmadi';
  pollDeviceStatus();
}

const copyApiKeyBtn = document.getElementById('copyApiKeyBtn');
if (copyApiKeyBtn) {
  copyApiKeyBtn.onclick = () => {
    const key = (document.getElementById('deviceApiKeyVal') || {}).value || currentUserApiKey;
    if (!key) return;
    navigator.clipboard.writeText(key).then(() => {
      toast('API Kalit nusxalandi ✓');
    }).catch(() => {
      toast('Nusxalash imkoni bo\'lmadi', 'error');
    });
  };
}

const headerBadgeEl = document.getElementById('headerDeviceBadge');
if (headerBadgeEl) {
  headerBadgeEl.onclick = () => {
    const devTab = document.querySelector('.sidebar nav a[data-tab="device"]');
    if (devTab) devTab.click();
  };
}

function startDevicePolling() {
  pollDeviceStatus();
  setInterval(pollDeviceStatus, 8000);
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

const saveTgBtn = document.getElementById('saveTelegramBtn');
if (saveTgBtn) {
  saveTgBtn.onclick = () => {
    const token = (document.getElementById('tgTokenInput') || {}).value.trim();
    const adminChatId = (document.getElementById('tgChatIdInput') || {}).value.trim();
    fetch('/api/admin/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, adminChatId })
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) { toast(d.error || 'Xatolik', 'error'); return; }
      toast('Telegram bot saqlandi va faollashtirildi ✓');
    }).catch(() => toast('Server bilan bog\'lanishda xato', 'error'));
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
  if (!isAdmin()) return;
  fetch('/api/admin/audit-log').then(r => r.json()).then(rows => {
    const tbody = document.querySelector('#logTable tbody');
    if (!tbody) return;
    const actionLabel = {
      login_success: 'Kirdi', login_failed: 'Xato kirish', logout: 'Chiqdi',
      update_day_schedule: 'Jadval yangilandi', password_changed: 'Parol o\'zgartirildi',
      bell_muted: 'Qo\'ng\'iroq o\'chirildi', bell_unmuted: 'Qo\'ng\'iroq yoqildi',
      regenerate_device_key: 'Kalit yangilandi', device_connected: 'Qurilma ulandi',
      update_school_name: 'Maktab nomi o\'zgartirildi', create_user: 'Foydalanuvchi yaratildi'
    };
    tbody.innerHTML = rows.map(r => `<tr>
      <td class="mono">${new Date(r.created_at).toLocaleString('uz-UZ')}</td>
      <td><b>${r.username || '—'}</b></td>
      <td>${actionLabel[r.action] || r.action}</td>
      <td>${r.detail || ''}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px">Tarix bo\'sh</td></tr>';
  });
}

// ============================================================
// HOLIDAYS (MULTI-TENANT)
// ============================================================
function loadHolidays() {
  const targetId = getActiveHolidayUserId();
  const url = targetId ? `/api/admin/holidays?userId=${targetId}` : '/api/admin/holidays';
  fetch(url).then(r => r.json()).then(items => {
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
  const targetId = getActiveHolidayUserId();
  const url = '/api/admin/holidays/' + id + (targetId ? '?userId=' + targetId : '');
  fetch(url, { method: 'DELETE' })
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
    const targetId = getActiveHolidayUserId();
    if (!date) { toast('Sanani tanlang', 'error'); return; }
    fetch('/api/admin/holidays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, name, userId: targetId })
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

document.querySelectorAll('#quickHolidays button').forEach(btn => {
  btn.onclick = () => {
    const currentYear = new Date().getFullYear();
    const mmdd = btn.dataset.date;
    const name = btn.dataset.name;
    const fullDate = `${currentYear}-${mmdd}`;
    const targetId = getActiveHolidayUserId();
    fetch('/api/admin/holidays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, fullDate, name, userId: targetId })
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
  const targetId = getActiveScheduleUserId();
  const payload = { ...opts };
  if (targetId) payload.userId = targetId;
  fetch('/api/admin/trigger-bell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
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
// USERS MANAGEMENT (ADMIN)
// ============================================================
function loadUsers() {
  if (!isAdmin()) return;
  fetch('/api/admin/users').then(r => r.json()).then(rows => {
    const tbody = document.getElementById('usersList');
    if (!tbody) return;
    tbody.innerHTML = rows.map(u => `<tr>
      <td class="mono">${u.id}</td>
      <td><b>${u.school_name || u.username}</b></td>
      <td><span class="mono">@${u.username}</span></td>
      <td>
        <span class="conn-badge" style="padding:2px 8px; font-size:11px; background:${u.role === 'admin' ? 'rgba(59,130,246,0.15)' : 'rgba(107,114,128,0.15)'}; color:${u.role === 'admin' ? '#2563eb' : '#4b5563'}">
          ${u.role === 'admin' ? '👑 Admin' : '👤 User'}
        </span>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:6px;">
          <code class="mono" style="background:rgba(0,0,0,0.06); padding:3px 7px; border-radius:4px; font-size:11px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block;" title="${u.api_key || ''}">${u.api_key || '—'}</code>
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
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">Foydalanuvchilar yo\'q</td></tr>';
  }).catch(() => toast('Foydalanuvchilarni yuklashda xato', 'error'));
}

function copyToClipboard(text, successMsg = 'Nusxalandi ✓') {
  if (!text) { toast('Nusxalash uchun matn yo\'q', 'error'); return; }

  if (navigator.clipboard && (window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.clipboard.writeText(text).then(() => {
      toast(successMsg);
    }).catch(() => {
      fallbackCopyText(text, successMsg);
    });
  } else {
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
    textArea.setSelectionRange(0, 99999);
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
        loadSchoolDropdowns();
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
        loadSchoolDropdowns();
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
    const sInput = document.getElementById('newSchoolNameInput');
    const uInput = document.getElementById('newUsernameInput');
    const pInput = document.getElementById('newUserPasswordInput');
    const rInput = document.getElementById('newUserRoleSelect');

    const schoolName = (sInput || {}).value.trim();
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
      body: JSON.stringify({ username, password, role, schoolName })
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) { toast(d.error || 'Xatolik', 'error'); return; }
      toast(`Yangi maktab ("${schoolName || username}") yaratildi ✓`);
      if (sInput) sInput.value = '';
      uInput.value = '';
      pInput.value = '';
      loadUsers();
      loadSchoolDropdowns();
    }).catch(() => toast('Server bilan aloqada xato', 'error'));
  };
}
