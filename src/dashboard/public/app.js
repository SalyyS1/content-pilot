/**
 * ReupVideo Dashboard v3 — Premium Frontend
 */

const API_BASE = '';
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth() + 1;
let refreshTimer = null;
let lastUpdateTime = Date.now();

// =============================================
//  INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  loadAll();
  refreshTimer = setInterval(loadAll, 5000);

  document.getElementById('cal-prev')?.addEventListener('click', () => {
    calMonth--; if (calMonth < 1) { calMonth = 12; calYear--; }
    loadCalendar();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    calMonth++; if (calMonth > 12) { calMonth = 1; calYear++; }
    loadCalendar();
  });

  // Upload page filters
  document.getElementById('upload-filter-platform')?.addEventListener('change', loadFullUploads);
  document.getElementById('upload-filter-status')?.addEventListener('change', loadFullUploads);

  loadConfig();
  loadAccounts();
  checkAIStatus();

  // Close modal on overlay click
  document.getElementById('add-account-modal')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) hideAddAccountModal();
  });

  // Escape key closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideAddAccountModal();
  });
});


// =============================================
//  TOAST NOTIFICATION SYSTEM
// =============================================
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ'}</span>
    <span>${esc(message)}</span>
  `;

  toast.addEventListener('click', () => dismissToast(toast));
  container.appendChild(toast);

  setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(toast) {
  if (!toast || toast.classList.contains('toast-out')) return;
  toast.classList.add('toast-out');
  setTimeout(() => toast.remove(), 300);
}


// =============================================
//  PAGE NAVIGATION
// =============================================
function switchPage(pageName) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = document.getElementById(`page-${pageName}`);
  const nav = document.querySelector(`.nav-item[data-page="${pageName}"]`);

  if (page) page.classList.add('active');
  if (nav) nav.classList.add('active');

  // Load page-specific data
  if (pageName === 'accounts') loadAccounts();
  if (pageName === 'logs') loadLogs();
  if (pageName === 'uploads') loadFullUploads();
}


// =============================================
//  CLOCK
// =============================================
function startClock() {
  const el = document.getElementById('clock');
  if (!el) return;
  const tick = () => {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  tick();
  setInterval(tick, 1000);
}


// =============================================
//  ANIMATED COUNTER
// =============================================
function animateValue(el, newVal) {
  if (!el) return;
  const current = parseInt(el.getAttribute('data-count') || '0') || 0;
  const target = parseInt(newVal) || 0;

  if (current === target) {
    el.textContent = target;
    return;
  }

  el.setAttribute('data-count', target);
  const duration = 600;
  const startTime = performance.now();

  function step(timestamp) {
    const progress = Math.min((timestamp - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const val = Math.round(current + (target - current) * eased);
    el.textContent = val;
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}


// =============================================
//  LOAD ALL DASHBOARD DATA
// =============================================
async function loadAll() {
  await Promise.all([
    loadAnalytics(),
    loadHealth(),
    loadCalendar(),
    loadUploads(),
    loadQueue(),
  ]);

  lastUpdateTime = Date.now();
  const el = document.getElementById('last-updated-time');
  if (el) el.textContent = 'Updated just now';

  // Only load logs if logs page active
  const logsPage = document.getElementById('page-logs');
  if (logsPage?.classList.contains('active')) loadLogs();

  // Load full uploads if on uploads page
  const uploadsPage = document.getElementById('page-uploads');
  if (uploadsPage?.classList.contains('active')) loadFullUploads();
}


// =============================================
//  ANALYTICS
// =============================================
async function loadAnalytics() {
  try {
    const data = await api('/api/analytics');
    animateValue(document.getElementById('today-uploads'), data.today_uploads || 0);
    animateValue(document.getElementById('week-uploads'), data.week_uploads || 0);
    animateValue(document.getElementById('active-accounts'), data.active_accounts || 0);

    const revEl = document.getElementById('revenue-est');
    if (revEl) revEl.textContent = data.revenue ? `$${data.revenue.total}` : '$0';

    const badge = document.getElementById('status-badge');
    if (badge) {
      badge.textContent = 'RUNNING';
      badge.className = 'badge running';
    }
  } catch {
    const badge = document.getElementById('status-badge');
    if (badge) {
      badge.textContent = 'OFFLINE';
      badge.className = 'badge stopped';
    }
  }
}


// =============================================
//  ACCOUNT HEALTH
// =============================================
async function loadHealth() {
  try {
    const accounts = await api('/api/health');
    const grid = document.getElementById('health-grid');
    if (!grid) return;

    if (!accounts || accounts.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;padding:30px">
          <div class="empty-state-icon">📊</div>
          <div class="empty-state-desc">Thêm account để xem health</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = accounts.map(a => {
      const score = a.health_score || 50;
      const level = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
      const shadowBan = a.shadow_ban_suspected ? ' <span style="color:var(--red)">⚠</span>' : '';

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
    const grid = document.getElementById('health-grid');
    if (grid) grid.innerHTML = '<p class="muted">Không tải được health data</p>';
  }
}


// =============================================
//  CALENDAR
// =============================================
async function loadCalendar() {
  try {
    const data = await api(`/api/calendar?year=${calYear}&month=${calMonth}`);
    const grid = document.getElementById('calendar-grid');
    const monthLabel = document.getElementById('cal-month');

    const monthNames = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'];
    if (monthLabel) monthLabel.textContent = `${monthNames[calMonth - 1]} ${calYear}`;

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
      html += `<div class="cal-day" style="font-weight:600;background:none;color:var(--text-muted);font-size:10px">${d}</div>`;
    }
    for (let i = 0; i < firstDay; i++) {
      html += '<div class="cal-day" style="background:none"></div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const count = uploadMap[d] || 0;
      const level = count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 9 ? 3 : 4;
      html += `<div class="cal-day level-${level}" title="${count} uploads">${d}</div>`;
    }

    if (grid) grid.innerHTML = html;
  } catch {
    const grid = document.getElementById('calendar-grid');
    if (grid) grid.innerHTML = '';
  }
}


// =============================================
//  RECENT UPLOADS (Dashboard summary)
// =============================================
async function loadUploads() {
  try {
    const uploads = await api('/api/uploads?limit=10');
    const tbody = document.getElementById('uploads-body');
    if (!tbody) return;

    if (!uploads || uploads.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:30px">Chưa có upload nào</td></tr>';
      return;
    }

    tbody.innerHTML = uploads.map(u => {
      const platformIcon = { youtube: '📺', facebook: '📘', tiktok: '🎵' };
      return `
      <tr>
        <td>
          <div class="video-title">
            <div class="video-thumb">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </div>
            <span class="video-name" title="${esc(u.title || '')}">${esc((u.title || 'Untitled').slice(0, 40))}</span>
          </div>
        </td>
        <td>${platformIcon[u.platform] || '🌐'} ${esc(u.platform || '?')}</td>
        <td>${esc(u.account_name || `#${u.account_id}`)}</td>
        <td><span class="status-badge ${u.status || 'pending'}">${u.status || 'pending'}</span></td>
        <td style="color:var(--text-muted);font-size:12px">${timeAgo(u.created_at)}</td>
      </tr>
      `;
    }).join('');
  } catch {
    const tbody = document.getElementById('uploads-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="muted">Lỗi</td></tr>';
  }
}


// =============================================
//  FULL UPLOADS PAGE
// =============================================
async function loadFullUploads() {
  try {
    const platform = document.getElementById('upload-filter-platform')?.value || 'all';
    const status = document.getElementById('upload-filter-status')?.value || 'all';
    let url = '/api/uploads?limit=50';
    if (platform !== 'all') url += `&platform=${platform}`;
    if (status !== 'all') url += `&status=${status}`;

    const uploads = await api(url);
    const tbody = document.getElementById('full-uploads-body');
    if (!tbody) return;

    // Update stats
    if (uploads) {
      const success = uploads.filter(u => u.status === 'uploaded').length;
      const pending = uploads.filter(u => ['pending', 'processing', 'downloaded'].includes(u.status)).length;
      const failed = uploads.filter(u => u.status === 'failed').length;
      animateValue(document.getElementById('upload-total-success'), success);
      animateValue(document.getElementById('upload-total-pending'), pending);
      animateValue(document.getElementById('upload-total-failed'), failed);
    }

    if (!uploads || uploads.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px">
        <div class="empty-state">
          <div class="empty-state-icon">📹</div>
          <div class="empty-state-title">Chưa có video nào</div>
          <div class="empty-state-desc">Video sẽ xuất hiện khi Autopilot bắt đầu hoạt động</div>
        </div>
      </td></tr>`;
      return;
    }

    const platformIcon = { youtube: '📺', facebook: '📘', tiktok: '🎵' };
    tbody.innerHTML = uploads.map(u => `
      <tr>
        <td>
          <div class="video-title">
            <div class="video-thumb">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </div>
            <span class="video-name" title="${esc(u.title || '')}">${esc((u.title || 'Untitled').slice(0, 50))}</span>
          </div>
        </td>
        <td>${platformIcon[u.platform] || '🌐'} ${esc(u.platform || '?')}</td>
        <td>${esc(u.account_name || `#${u.account_id}`)}</td>
        <td><span class="status-badge ${u.status || 'pending'}">${u.status || 'pending'}</span></td>
        <td style="color:var(--text-muted);font-size:12px">${timeAgo(u.created_at)}</td>
        <td>
          ${u.url ? `<a href="${esc(u.url)}" target="_blank" class="btn-secondary btn-sm btn-icon-only" title="Xem video">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          </a>` : '-'}
        </td>
      </tr>
    `).join('');
  } catch {
    const tbody = document.getElementById('full-uploads-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="muted">Lỗi tải uploads</td></tr>';
  }
}


// =============================================
//  QUEUE
// =============================================
async function loadQueue() {
  try {
    const queue = await api('/api/queue');
    const container = document.getElementById('queue-list');
    if (!container) return;

    if (!queue || queue.length === 0) {
      container.innerHTML = '<p class="muted" style="text-align:center;padding:20px">Không có job nào trong queue</p>';
      return;
    }

    container.innerHTML = queue.map(j => `
      <div class="queue-item">
        <span style="color:var(--text-secondary)">#${j.id} · ${esc(j.type)}</span>
        <span class="status-badge ${j.status}">${j.status}</span>
      </div>
    `).join('');
  } catch {
    const container = document.getElementById('queue-list');
    if (container) container.innerHTML = '<p class="muted">Lỗi</p>';
  }
}


// =============================================
//  LOGS
// =============================================
async function loadLogs() {
  try {
    const filter = document.getElementById('log-filter')?.value || 'all';
    const logs = await api('/api/logs?last=100');
    const container = document.getElementById('log-container');
    if (!container) return;

    const wasScrolled = container.scrollTop + container.clientHeight >= container.scrollHeight - 30;

    if (!logs || logs.length === 0) {
      container.innerHTML = '<div class="log-line debug">$ waiting for logs...</div>';
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
      const time = l.timestamp ? `<span style="color:var(--text-dim)">${new Date(l.timestamp).toLocaleTimeString('vi-VN')}</span> ` : '';
      return `<div class="log-line ${level}">${time}${esc(msg)}</div>`;
    }).join('');

    if (wasScrolled) container.scrollTop = container.scrollHeight;
  } catch {}
}

function clearLogs() {
  const container = document.getElementById('log-container');
  if (container) container.innerHTML = '<div class="log-line debug">$ logs cleared</div>';
  showToast('Logs cleared', 'info');
}


// =============================================
//  ACCOUNTS
// =============================================
async function loadAccounts() {
  try {
    const accounts = await api('/api/accounts');
    const grid = document.getElementById('accounts-grid');
    if (!grid) return;

    if (!accounts || accounts.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-state-icon">👥</div>
          <div class="empty-state-title">Chưa có account nào</div>
          <div class="empty-state-desc">Click "Thêm Account" để bắt đầu thêm tài khoản Facebook, YouTube hoặc TikTok</div>
        </div>
      `;
      return;
    }

    const platformIcons = { youtube: '📺', facebook: '📘', tiktok: '🎵' };
    grid.innerHTML = accounts.map(a => {
      const icon = platformIcons[a.platform] || '🌐';
      const statusClass = a.status === 'active' ? 'active' :
                          a.status === 'banned' ? 'banned' :
                          a.status === 'error' ? 'error' : 'unknown';

      return `
        <div class="account-card" data-platform="${a.platform || ''}" data-id="${a.id}">
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
            <button class="btn-success btn-sm" onclick="testAccount(${a.id}, this)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
              Test
            </button>
            <button class="btn-danger btn-sm" onclick="deleteAccount(${a.id}, this)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              Xóa
            </button>
          </div>
          <div id="test-result-${a.id}"></div>
        </div>
      `;
    }).join('');
  } catch {
    const grid = document.getElementById('accounts-grid');
    if (grid) grid.innerHTML = '<p class="muted">Lỗi tải accounts</p>';
  }
}

function showAddAccountModal() {
  document.getElementById('add-account-modal').style.display = 'flex';
  // Auto focus name field
  setTimeout(() => document.getElementById('acc-name')?.focus(), 100);
}

function hideAddAccountModal() {
  document.getElementById('add-account-modal').style.display = 'none';
}

async function addAccount() {
  const nameEl = document.getElementById('acc-name');
  const cookieEl = document.getElementById('acc-cookie');
  const platformEl = document.getElementById('acc-platform');

  const data = {
    platform: platformEl.value,
    name: nameEl.value,
    email: document.getElementById('acc-email').value,
    cookie: cookieEl.value,
    pages: document.getElementById('acc-pages').value,
  };

  // Validate
  if (!data.name.trim()) {
    showToast('Vui lòng nhập tên hiển thị', 'warning');
    nameEl.focus();
    return;
  }

  const btn = document.getElementById('btn-add-account');
  const origHTML = btn.innerHTML;
  btn.classList.add('btn-loading');
  btn.innerHTML = 'Đang thêm...';

  try {
    const res = await fetch(API_BASE + '/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await res.json();

    if (res.ok) {
      showToast(`Account "${data.name}" đã được thêm thành công!${result.c_user ? ` (c_user: ${result.c_user})` : ''}`, 'success');
      hideAddAccountModal();

      // Clear form
      nameEl.value = '';
      cookieEl.value = '';
      document.getElementById('acc-email').value = '';
      document.getElementById('acc-pages').value = '';

      loadAccounts();
    } else {
      showToast(result.error || 'Lỗi thêm account', 'error');
    }
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  } finally {
    btn.classList.remove('btn-loading');
    btn.innerHTML = origHTML;
  }
}

async function testAccount(id, btn) {
  const resultEl = document.getElementById(`test-result-${id}`);
  const origHTML = btn.innerHTML;
  btn.classList.add('btn-loading');
  btn.innerHTML = 'Testing...';

  try {
    const res = await fetch(API_BASE + `/api/accounts/${id}/test`, { method: 'POST' });
    const data = await res.json();

    // Show inline result
    if (resultEl) {
      const isSuccess = data.valid || data.status === 'success';
      resultEl.innerHTML = `<div class="account-test-result ${isSuccess ? 'success' : 'error'}">${esc(data.message || 'Test complete')}</div>`;

      // Auto-hide after 8s
      setTimeout(() => { if (resultEl) resultEl.innerHTML = ''; }, 8000);
    }

    showToast(data.message || 'Test xong!', data.valid ? 'success' : 'warning');
  } catch (err) {
    showToast('Test failed: ' + err.message, 'error');
    if (resultEl) resultEl.innerHTML = `<div class="account-test-result error">❌ Connection error</div>`;
  } finally {
    btn.classList.remove('btn-loading');
    btn.innerHTML = origHTML;
  }
}

async function deleteAccount(id, btn) {
  if (!confirm('Bạn chắc muốn xóa account này?')) return;

  const card = btn.closest('.account-card');
  if (card) {
    card.style.transition = 'all 0.3s ease';
    card.style.opacity = '0.5';
    card.style.transform = 'scale(0.95)';
  }

  try {
    await fetch(API_BASE + `/api/accounts/${id}`, { method: 'DELETE' });
    showToast('Account đã được xóa', 'success');

    // Animate out
    if (card) {
      card.style.opacity = '0';
      card.style.transform = 'scale(0.9) translateY(10px)';
      setTimeout(() => loadAccounts(), 300);
    } else {
      loadAccounts();
    }
  } catch {
    showToast('Xóa thất bại', 'error');
    if (card) {
      card.style.opacity = '1';
      card.style.transform = 'scale(1)';
    }
  }
}


// =============================================
//  SETTINGS
// =============================================
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
    showToast('Settings đã được lưu!', 'success');
  } catch {
    showToast('Lỗi lưu settings', 'error');
  }
}


// =============================================
//  AI STATUS
// =============================================
async function checkAIStatus() {
  try {
    const chatgpt = document.querySelector('#ai-chatgpt .dot');
    const gemini = document.querySelector('#ai-gemini .dot');

    await api('/api/stats').catch(() => null);

    if (chatgpt) chatgpt.className = 'dot green';
    if (gemini) gemini.className = 'dot green';
  } catch {}
}


// =============================================
//  HELPERS
// =============================================
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
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
