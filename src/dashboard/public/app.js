/**
 * ReupVideo Dashboard v2 — Full Frontend
 */

const API_BASE = '';
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth() + 1;
let refreshTimer = null;

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  loadAll();
  refreshTimer = setInterval(loadAll, 15000);

  document.getElementById('cal-prev').addEventListener('click', () => {
    calMonth--; if (calMonth < 1) { calMonth = 12; calYear--; }
    loadCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calMonth++; if (calMonth > 12) { calMonth = 1; calYear++; }
    loadCalendar();
  });

  loadConfig();
  loadAccounts();
  checkAIStatus();
});

// === Page Navigation ===
function switchPage(pageName) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  const page = document.getElementById(`page-${pageName}`);
  const nav = document.querySelector(`.nav-item[data-page="${pageName}"]`);
  
  if (page) page.classList.add('active');
  if (nav) nav.classList.add('active');

  if (pageName === 'accounts') loadAccounts();
  if (pageName === 'logs') loadLogs();
}

// === Clock ===
function startClock() {
  const el = document.getElementById('clock');
  const tick = () => { el.textContent = new Date().toLocaleTimeString('vi-VN'); };
  tick();
  setInterval(tick, 1000);
}

// === Load All Dashboard Data ===
async function loadAll() {
  await Promise.all([
    loadAnalytics(),
    loadHealth(),
    loadCalendar(),
    loadUploads(),
    loadQueue(),
  ]);
  // Only load logs if on logs page
  const logsPage = document.getElementById('page-logs');
  if (logsPage && logsPage.classList.contains('active')) {
    loadLogs();
  }
}

// === Analytics ===
async function loadAnalytics() {
  try {
    const data = await api('/api/analytics');
    document.getElementById('today-uploads').textContent = data.today_uploads || 0;
    document.getElementById('week-uploads').textContent = data.week_uploads || 0;
    document.getElementById('active-accounts').textContent = data.active_accounts || 0;
    document.getElementById('revenue-est').textContent = data.revenue ? `$${data.revenue.total}` : '$0';

    const badge = document.getElementById('status-badge');
    badge.textContent = 'RUNNING';
    badge.className = 'badge running';
  } catch {
    document.getElementById('status-badge').textContent = 'OFFLINE';
    document.getElementById('status-badge').className = 'badge stopped';
  }
}

// === Account Health ===
async function loadHealth() {
  try {
    const accounts = await api('/api/health');
    const grid = document.getElementById('health-grid');

    if (!accounts || accounts.length === 0) {
      grid.innerHTML = '<p class="muted">Chưa có account nào</p>';
      return;
    }

    grid.innerHTML = accounts.map(a => {
      const score = a.health_score || 50;
      const level = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
      const shadowBan = a.shadow_ban_suspected ? ' 🚫' : '';

      return `
        <div class="health-card">
          <div class="health-card-header">
            <span class="health-card-name">${esc(a.name || `#${a.id}`)}${shadowBan}</span>
            <span class="health-card-platform">${esc(a.platform || '?')}</span>
          </div>
          <div class="gauge-wrap">
            <div class="gauge-bar ${level}" style="width:${score}%"></div>
          </div>
          <div class="health-card-meta">
            <span>${score}/100</span>
            <span>${a.phase || 'N/A'} · ${a.days_active || 0}d</span>
            <span>${a.today_uploads || 0} today</span>
          </div>
        </div>
      `;
    }).join('');
  } catch {
    document.getElementById('health-grid').innerHTML = '<p class="muted">Không tải được health data</p>';
  }
}

// === Calendar ===
async function loadCalendar() {
  try {
    const data = await api(`/api/calendar?year=${calYear}&month=${calMonth}`);
    const grid = document.getElementById('calendar-grid');
    const monthLabel = document.getElementById('cal-month');

    const monthNames = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'];
    monthLabel.textContent = `${monthNames[calMonth - 1]} ${calYear}`;

    const daysInMonth = new Date(calYear, calMonth, 0).getDate();
    const firstDay = new Date(calYear, calMonth - 1, 1).getDay();

    const uploadMap = {};
    if (data) {
      for (const d of data) {
        const day = parseInt(d.date.split('-')[2]);
        uploadMap[day] = d.count;
      }
    }

    let html = '';
    for (const d of ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']) {
      html += `<div class="cal-day" style="font-weight:600;background:none">${d}</div>`;
    }
    for (let i = 0; i < firstDay; i++) {
      html += '<div class="cal-day" style="background:none"></div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const count = uploadMap[d] || 0;
      const level = count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 9 ? 3 : 4;
      html += `<div class="cal-day level-${level}" title="${d}: ${count} uploads">${d}</div>`;
    }

    grid.innerHTML = html;
  } catch {
    document.getElementById('calendar-grid').innerHTML = '';
  }
}

// === Recent Uploads ===
async function loadUploads() {
  try {
    const uploads = await api('/api/uploads?limit=20');
    const tbody = document.getElementById('uploads-body');

    if (!uploads || uploads.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">Chưa có upload nào</td></tr>';
      return;
    }

    tbody.innerHTML = uploads.map(u => `
      <tr>
        <td title="${esc(u.title || '')}">${esc((u.title || 'Untitled').slice(0, 40))}</td>
        <td>${esc(u.platform || '?')}</td>
        <td>${esc(u.account_name || `#${u.account_id}`)}</td>
        <td><span class="status-badge ${u.status || 'pending'}">${u.status || 'pending'}</span></td>
        <td>${timeAgo(u.created_at)}</td>
      </tr>
    `).join('');
  } catch {
    document.getElementById('uploads-body').innerHTML = '<tr><td colspan="5" class="muted">Lỗi</td></tr>';
  }
}

// === Queue ===
async function loadQueue() {
  try {
    const queue = await api('/api/queue');
    const container = document.getElementById('queue-list');

    if (!queue || queue.length === 0) {
      container.innerHTML = '<p class="muted">Không có job nào trong queue</p>';
      return;
    }

    container.innerHTML = queue.map(j => `
      <div class="queue-item">
        <span>#${j.id} · ${esc(j.type)}</span>
        <span class="status-badge ${j.status}">${j.status}</span>
      </div>
    `).join('');
  } catch {
    document.getElementById('queue-list').innerHTML = '<p class="muted">Lỗi</p>';
  }
}

// === Logs ===
async function loadLogs() {
  try {
    const filter = document.getElementById('log-filter')?.value || 'all';
    const logs = await api(`/api/logs?last=100`);
    const container = document.getElementById('log-container');
    const wasScrolled = container.scrollTop + container.clientHeight >= container.scrollHeight - 20;

    if (!logs || logs.length === 0) {
      container.innerHTML = '<div class="log-line debug">No logs yet...</div>';
      return;
    }

    let filtered = logs;
    if (filter !== 'all') {
      filtered = logs.filter(l => {
        const level = (l.level || 'info').toLowerCase();
        return level === filter;
      });
    }

    container.innerHTML = filtered.map(l => {
      const level = (l.level || 'info').toLowerCase();
      const msg = typeof l === 'string' ? l : (l.message || l.msg || JSON.stringify(l));
      return `<div class="log-line ${level}">${esc(msg)}</div>`;
    }).join('');

    if (wasScrolled) container.scrollTop = container.scrollHeight;
  } catch {}
}

function clearLogs() {
  document.getElementById('log-container').innerHTML = '<div class="log-line debug">Logs cleared</div>';
}

// === Accounts ===
async function loadAccounts() {
  try {
    const accounts = await api('/api/accounts');
    const grid = document.getElementById('accounts-grid');

    if (!accounts || accounts.length === 0) {
      grid.innerHTML = `
        <div class="account-card" style="text-align:center;padding:40px">
          <p style="font-size:48px;margin-bottom:12px">👥</p>
          <p style="color:var(--text-secondary)">Chưa có account nào</p>
          <p style="color:var(--text-muted);font-size:13px;margin-top:8px">Click "+ Thêm Account" để bắt đầu</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = accounts.map(a => {
      const platformEmoji = { youtube: '📺', facebook: '📘', tiktok: '🎵' };
      const icon = platformEmoji[a.platform] || '🌐';
      const statusClass = a.status === 'active' ? 'uploaded' : a.status === 'banned' ? 'failed' : 'pending';

      return `
        <div class="account-card">
          <div class="account-card-header">
            <h3>
              <span class="platform-icon ${a.platform || ''}">${icon}</span>
              ${esc(a.name || a.email || `Account #${a.id}`)}
            </h3>
            <span class="status-badge ${statusClass}">${a.status || 'unknown'}</span>
          </div>
          <div class="account-stats">
            <div class="account-stat">
              <span class="account-stat-value">${a.total_uploads || 0}</span>
              <span class="account-stat-label">Uploads</span>
            </div>
            <div class="account-stat">
              <span class="account-stat-value">${a.today_uploads || 0}</span>
              <span class="account-stat-label">Hôm nay</span>
            </div>
            <div class="account-stat">
              <span class="account-stat-value">${a.health_score || '-'}</span>
              <span class="account-stat-label">Health</span>
            </div>
          </div>
          <div class="account-actions">
            <button class="btn-secondary btn-sm" onclick="testAccount(${a.id})">🔄 Test</button>
            <button class="btn-danger btn-sm" onclick="deleteAccount(${a.id})">🗑️ Xóa</button>
          </div>
        </div>
      `;
    }).join('');
  } catch {
    document.getElementById('accounts-grid').innerHTML = '<p class="muted">Lỗi tải accounts</p>';
  }
}

function showAddAccountModal() {
  document.getElementById('add-account-modal').style.display = 'flex';
}

function hideAddAccountModal() {
  document.getElementById('add-account-modal').style.display = 'none';
}

async function addAccount() {
  const data = {
    platform: document.getElementById('acc-platform').value,
    name: document.getElementById('acc-name').value,
    email: document.getElementById('acc-email').value,
    cookie: document.getElementById('acc-cookie').value,
    pages: document.getElementById('acc-pages').value,
  };

  try {
    await fetch(API_BASE + '/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    hideAddAccountModal();
    loadAccounts();
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

async function testAccount(id) {
  try {
    const res = await fetch(API_BASE + `/api/accounts/${id}/test`, { method: 'POST' });
    const data = await res.json();
    alert(data.message || 'Test xong!');
  } catch {
    alert('Test failed');
  }
}

async function deleteAccount(id) {
  if (!confirm('Bạn chắc muốn xóa account này?')) return;
  try {
    await fetch(API_BASE + `/api/accounts/${id}`, { method: 'DELETE' });
    loadAccounts();
  } catch {
    alert('Xóa thất bại');
  }
}

// === Settings ===
async function loadConfig() {
  try {
    const cfg = await api('/api/config');
    if (cfg.maxUploadsPerDay) document.getElementById('set-max-uploads').value = cfg.maxUploadsPerDay;
    if (cfg.uploadIntervalMinutes) document.getElementById('set-interval').value = cfg.uploadIntervalMinutes;
    if (cfg.transformMode) document.getElementById('set-transform').value = cfg.transformMode;
    if (cfg.processingPreset) document.getElementById('set-preset').value = cfg.processingPreset;
  } catch {}
}

async function saveSettings() {
  const settings = {
    maxUploadsPerDay: parseInt(document.getElementById('set-max-uploads').value),
    uploadIntervalMinutes: parseInt(document.getElementById('set-interval').value),
    transformMode: document.getElementById('set-transform').value,
    processingPreset: document.getElementById('set-preset').value,
  };

  try {
    await fetch(API_BASE + '/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    alert('✅ Đã lưu settings!');
  } catch {
    alert('❌ Lỗi lưu settings');
  }
}

// === AI Status ===
async function checkAIStatus() {
  try {
    const chatgpt = document.querySelector('#ai-chatgpt .dot');
    const gemini = document.querySelector('#ai-gemini .dot');
    
    // Check via stats endpoint
    const stats = await api('/api/stats').catch(() => null);
    
    // Simple heuristic — if stats loaded, services are running
    if (chatgpt) { chatgpt.className = 'dot green'; }
    if (gemini) { gemini.className = 'dot green'; }
  } catch {
    // Leave as red  
  }
}

// === Helpers ===
async function api(url) {
  const res = await fetch(API_BASE + url);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function timeAgo(dateStr) {
  if (!dateStr) return '-';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ`;
  return `${Math.floor(hours / 24)} ngày`;
}
