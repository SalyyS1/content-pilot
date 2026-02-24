/**
 * ReupVideo Dashboard — Frontend JS (Upgraded)
 */

const API_BASE = '';

// === State ===
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth() + 1;
let refreshTimer = null;

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  loadAll();
  refreshTimer = setInterval(loadAll, 15000); // Refresh every 15s

  document.getElementById('cal-prev').addEventListener('click', () => { calMonth--; if (calMonth < 1) { calMonth = 12; calYear--; } loadCalendar(); });
  document.getElementById('cal-next').addEventListener('click', () => { calMonth++; if (calMonth > 12) { calMonth = 1; calYear++; } loadCalendar(); });
});

function startClock() {
  const el = document.getElementById('clock');
  const tick = () => { el.textContent = new Date().toLocaleTimeString(); };
  tick();
  setInterval(tick, 1000);
}

async function loadAll() {
  await Promise.all([
    loadAnalytics(),
    loadHealth(),
    loadCalendar(),
    loadUploads(),
    loadQueue(),
    loadLogs(),
  ]);
}

// === Analytics Overview ===
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
      grid.innerHTML = '<p class="muted">No accounts yet</p>';
      return;
    }

    grid.innerHTML = accounts.map(a => {
      const score = a.health_score || 50;
      const level = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
      const phase = a.phase || 'unknown';
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
            <span>${phase} · ${a.days_active || 0}d</span>
            <span>${a.today_uploads || 0} today</span>
          </div>
        </div>
      `;
    }).join('');
  } catch {
    document.getElementById('health-grid').innerHTML = '<p class="muted">Failed to load health data</p>';
  }
}

// === Calendar Heatmap ===
async function loadCalendar() {
  try {
    const data = await api(`/api/calendar?year=${calYear}&month=${calMonth}`);
    const grid = document.getElementById('calendar-grid');
    const monthLabel = document.getElementById('cal-month');

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    monthLabel.textContent = `${monthNames[calMonth - 1]} ${calYear}`;

    // Build calendar
    const daysInMonth = new Date(calYear, calMonth, 0).getDate();
    const firstDay = new Date(calYear, calMonth - 1, 1).getDay(); // 0=Sun

    // Create lookup map
    const uploadMap = {};
    if (data) {
      for (const d of data) {
        const day = parseInt(d.date.split('-')[2]);
        uploadMap[day] = d.count;
      }
    }

    let html = '';
    // Weekday headers
    for (const d of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) {
      html += `<div class="cal-day" style="font-weight:600;background:none">${d}</div>`;
    }
    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      html += '<div class="cal-day" style="background:none"></div>';
    }
    // Days
    for (let d = 1; d <= daysInMonth; d++) {
      const count = uploadMap[d] || 0;
      const level = count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 9 ? 3 : 4;
      html += `<div class="cal-day level-${level}" data-count="${count}" title="${d}: ${count} uploads">${d}</div>`;
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
      tbody.innerHTML = '<tr><td colspan="5" class="muted">No uploads yet</td></tr>';
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
    document.getElementById('uploads-body').innerHTML = '<tr><td colspan="5" class="muted">Failed to load</td></tr>';
  }
}

// === Queue ===
async function loadQueue() {
  try {
    const queue = await api('/api/queue');
    const container = document.getElementById('queue-list');

    if (!queue || queue.length === 0) {
      container.innerHTML = '<p class="muted">No jobs in queue</p>';
      return;
    }

    container.innerHTML = queue.map(j => `
      <div class="queue-item">
        <span>#${j.id} · ${esc(j.type)}</span>
        <span class="status-badge ${j.status}">${j.status}</span>
      </div>
    `).join('');
  } catch {
    document.getElementById('queue-list').innerHTML = '<p class="muted">Failed to load queue</p>';
  }
}

// === Live Logs ===
async function loadLogs() {
  try {
    const logs = await api('/api/logs?last=50');
    const container = document.getElementById('log-container');
    const wasScrolled = container.scrollTop + container.clientHeight >= container.scrollHeight - 20;

    if (!logs || logs.length === 0) {
      container.innerHTML = '<div class="log-line debug">No logs yet...</div>';
      return;
    }

    container.innerHTML = logs.map(l => {
      const level = (l.level || 'info').toLowerCase();
      const msg = typeof l === 'string' ? l : (l.message || l.msg || JSON.stringify(l));
      return `<div class="log-line ${level}">${esc(msg)}</div>`;
    }).join('');

    if (wasScrolled) container.scrollTop = container.scrollHeight;
  } catch {}
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
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
