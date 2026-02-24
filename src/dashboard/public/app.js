/* ================================================
   Dashboard JavaScript v2.0
   Premium UX with Analytics, Toasts, Activity Feed
   ================================================ */

// ================================================
// Toast Notification System
// ================================================

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ================================================
// Navigation
// ================================================

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const page = item.dataset.page;
    switchPage(page);
  });
});

function switchPage(pageName) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-page="${pageName}"]`)?.classList.add('active');

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${pageName}`)?.classList.add('active');

  const titles = {
    dashboard: 'Dashboard',
    autopilot: 'Auto-Pilot',
    uploads: 'Upload History',
    reup: 'Manual Reup',
    analytics: 'Analytics',
    accounts: 'Accounts',
    logs: 'Logs',
    settings: 'Settings',
  };
  document.getElementById('pageTitle').textContent = titles[pageName] || pageName;

  if (pageName === 'uploads') loadUploads();
  if (pageName === 'accounts') loadAccountOverview();
  if (pageName === 'logs') loadLogs();
  if (pageName === 'settings') loadSettings();
  if (pageName === 'analytics') loadAnalytics();
}

// ================================================
// API Calls
// ================================================

async function api(path, options = {}) {
  try {
    const response = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return await response.json();
  } catch (error) {
    console.error(`API error: ${path}`, error);
    return null;
  }
}

// ================================================
// Dashboard Stats
// ================================================

let previousStats = {};

async function loadStats() {
  const stats = await api('/stats');
  if (!stats) return;

  // Animate stat values
  animateValue(document.getElementById('stat-videos'), stats.totalVideos || 0);
  animateValue(document.getElementById('stat-published'), stats.publishedUploads || 0);
  animateValue(document.getElementById('stat-pending'), stats.pendingUploads || 0);
  animateValue(document.getElementById('stat-failed'), stats.failedUploads || 0);
  animateValue(document.getElementById('stat-today'), stats.todayUploads || 0);
  animateValue(document.getElementById('stat-accounts'), stats.accounts || 0);

  // Pending badge in nav
  const pendingBadge = document.getElementById('navPendingBadge');
  if (stats.pendingUploads > 0) {
    pendingBadge.textContent = stats.pendingUploads;
    pendingBadge.style.display = 'inline';
  } else {
    pendingBadge.style.display = 'none';
  }

  // Update auto-pilot badge & controls
  updateApBadge(stats.autopilot);
  updateApControls(stats.autopilot);
  updateHealthPanel(stats);

  // Detect new uploads via toast
  if (previousStats.publishedUploads !== undefined &&
      stats.publishedUploads > previousStats.publishedUploads) {
    const diff = stats.publishedUploads - previousStats.publishedUploads;
    showToast(`${diff} new upload${diff > 1 ? 's' : ''} published! 🎉`, 'success');
  }

  if (previousStats.failedUploads !== undefined &&
      stats.failedUploads > previousStats.failedUploads) {
    showToast('Upload failed! Check logs for details.', 'error');
  }

  previousStats = { ...stats };
}

function animateValue(el, target) {
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;

  const duration = 600;
  const start = performance.now();

  function step(timestamp) {
    const progress = Math.min((timestamp - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(current + (target - current) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

// ================================================
// System Health Panel
// ================================================

function updateHealthPanel(stats) {
  // Auto-pilot health
  const apDot = document.getElementById('healthApDot');
  const apVal = document.getElementById('healthAp');
  if (stats.autopilot?.isRunning && !stats.autopilot?.isPaused) {
    apDot.className = 'health-dot healthy';
    apVal.textContent = 'Running';
  } else if (stats.autopilot?.isPaused) {
    apDot.className = 'health-dot warning';
    apVal.textContent = 'Paused';
  } else {
    apDot.className = 'health-dot';
    apVal.textContent = 'Stopped';
  }

  // YouTube / Facebook auth: check if any accounts exist
  const ytDot = document.getElementById('healthYtDot');
  const ytVal = document.getElementById('healthYt');
  const fbDot = document.getElementById('healthFbDot');
  const fbVal = document.getElementById('healthFb');

  if (stats.accounts > 0) {
    ytDot.className = 'health-dot healthy';
    ytVal.textContent = 'Connected';
    fbDot.className = 'health-dot healthy';
    fbVal.textContent = 'Connected';
  } else {
    ytDot.className = 'health-dot warning';
    ytVal.textContent = 'Not connected';
    fbDot.className = 'health-dot warning';
    fbVal.textContent = 'Not connected';
  }
}

// ================================================
// Activity Feed
// ================================================

async function loadActivityFeed() {
  const uploads = await api('/uploads?limit=10');
  const container = document.getElementById('activityFeed');
  if (!uploads || uploads.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-text">No activity yet</div>
        <div class="empty-state-sub">Start reup to see activity here</div>
      </div>
    `;
    return;
  }

  container.innerHTML = uploads.map(u => {
    const isSuccess = u.status === 'published';
    const isFail = u.status === 'failed';
    const icons = { published: '✅', pending: '⏳', uploading: '📤', failed: '❌' };
    const iconClass = isSuccess ? 'ai-success' : isFail ? 'ai-fail' : 'ai-info';

    return `
      <div class="activity-item">
        <div class="activity-icon ${iconClass}">${icons[u.status] || '📌'}</div>
        <div class="activity-content">
          <div class="activity-text">${escapeHtml(truncate(u.title || 'Untitled', 50))}</div>
          <div class="activity-meta">${u.platform === 'youtube' ? '▶️ YT' : '📘 FB'} • ${u.status} • ${formatDate(u.uploaded_at || u.created_at)}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ================================================
// Recent Uploads
// ================================================

async function loadRecentUploads() {
  const uploads = await api('/uploads?limit=10');
  if (!uploads) return;
  renderUploads(uploads, 'recentUploads');
  loadActivityFeed();
}

async function loadUploads() {
  const status = document.getElementById('filterStatus')?.value || '';
  const platform = document.getElementById('filterPlatform')?.value || '';
  const uploads = await api(`/uploads?status=${status}&platform=${platform}&limit=50`);
  if (!uploads) return;
  renderUploads(uploads, 'uploadsList');
}

function renderUploads(uploads, targetId) {
  const tbody = document.getElementById(targetId);
  if (!tbody) return;

  if (uploads.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">No uploads found</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = uploads.map(u => `
    <tr>
      <td>#${u.id}</td>
      <td><span class="badge badge-${u.platform}">${u.platform === 'youtube' ? '▶️ YT' : '📘 FB'}</span></td>
      <td title="${escapeHtml(u.title || '')}">${truncate(u.title || '-', 40)}</td>
      <td><span class="badge badge-${u.status}">${u.status}</span></td>
      <td>${u.account_name || '-'}</td>
      <td>${u.retry_count || 0}</td>
      <td>${u.target_url ? `<a href="${u.target_url}" target="_blank" style="color: var(--accent-sky)">🔗 Link</a>` : '-'}</td>
      <td>${formatDate(u.uploaded_at || u.created_at)}</td>
    </tr>
  `).join('');
}

// ================================================
// Analytics
// ================================================

async function loadAnalytics() {
  const stats = await api('/stats');
  const uploads = await api('/uploads?limit=500');

  if (!stats) return;

  // Success rate ring
  const total = (stats.publishedUploads || 0) + (stats.failedUploads || 0) + (stats.pendingUploads || 0);
  const rate = total > 0 ? Math.round((stats.publishedUploads / total) * 100) : 0;

  document.getElementById('rateValue').textContent = rate + '%';
  document.getElementById('ratePublished').textContent = stats.publishedUploads || 0;
  document.getElementById('rateFailed').textContent = stats.failedUploads || 0;
  document.getElementById('ratePending').textContent = stats.pendingUploads || 0;

  // Animate ring
  const ring = document.getElementById('rateRingFill');
  const circumference = 326.73;
  const offset = circumference - (circumference * rate / 100);
  ring.style.strokeDashoffset = offset;

  // Platform breakdown
  if (uploads && uploads.length > 0) {
    const ytCount = uploads.filter(u => u.platform === 'youtube').length;
    const fbCount = uploads.filter(u => u.platform === 'facebook').length;
    const maxCount = Math.max(ytCount, fbCount, 1);

    document.getElementById('barYoutube').style.width = `${(ytCount / maxCount) * 100}%`;
    document.getElementById('barFacebook').style.width = `${(fbCount / maxCount) * 100}%`;
    document.getElementById('countYoutube').textContent = ytCount;
    document.getElementById('countFacebook').textContent = fbCount;

    // 7-day chart
    renderWeeklyChart(uploads);
  }
}

function renderWeeklyChart(uploads) {
  const container = document.getElementById('chartContainer');
  const days = [];
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    const name = d.toLocaleDateString('vi-VN', { weekday: 'short' });
    days.push({ key, name, success: 0, fail: 0, pending: 0 });
  }

  for (const u of uploads) {
    const date = (u.uploaded_at || u.created_at || '').split('T')[0].split(' ')[0];
    const day = days.find(d => d.key === date);
    if (day) {
      if (u.status === 'published') day.success++;
      else if (u.status === 'failed') day.fail++;
      else day.pending++;
    }
  }

  const maxVal = Math.max(...days.map(d => d.success + d.fail + d.pending), 1);

  container.innerHTML = days.map(d => {
    const sH = Math.max((d.success / maxVal) * 150, d.success > 0 ? 8 : 0);
    const fH = Math.max((d.fail / maxVal) * 150, d.fail > 0 ? 8 : 0);
    const pH = Math.max((d.pending / maxVal) * 150, d.pending > 0 ? 8 : 0);

    return `
      <div class="chart-bar-group">
        <div style="display: flex; flex-direction: column; gap: 2px; align-items: center; height: 160px; justify-content: flex-end;">
          ${pH > 0 ? `<div class="chart-bar bar-pending" style="height: ${pH}px" title="Pending: ${d.pending}"></div>` : ''}
          ${fH > 0 ? `<div class="chart-bar bar-fail" style="height: ${fH}px" title="Failed: ${d.fail}"></div>` : ''}
          <div class="chart-bar bar-success" style="height: ${Math.max(sH, 4)}px" title="Success: ${d.success}"></div>
        </div>
        <span class="chart-label">${d.name}</span>
      </div>
    `;
  }).join('');
}

// ================================================
// CSV Export
// ================================================

async function exportData() {
  const uploads = await api('/uploads?limit=10000');
  if (!uploads || uploads.length === 0) {
    showToast('No data to export', 'warning');
    return;
  }

  const headers = ['ID','Platform','Title','Status','Account','Retries','URL','Date'];
  const rows = uploads.map(u => [
    u.id,
    u.platform,
    `"${(u.title || '').replace(/"/g, '""')}"`,
    u.status,
    u.account_name || '',
    u.retry_count || 0,
    u.target_url || '',
    u.uploaded_at || u.created_at || '',
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `reup-export-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();

  showToast(`Exported ${uploads.length} records`, 'success');
}

// ================================================
// Auto-Pilot Controls
// ================================================

function updateApBadge(apStatus) {
  const badge = document.getElementById('autoPilotBadge');
  const dot = badge.querySelector('.status-dot');

  if (apStatus?.isRunning && !apStatus?.isPaused) {
    dot.className = 'status-dot online';
    badge.querySelector('span:last-child').textContent = 'Auto-Pilot Active';
    badge.className = 'status-badge active';
  } else if (apStatus?.isPaused) {
    dot.className = 'status-dot paused';
    badge.querySelector('span:last-child').textContent = 'Auto-Pilot Paused';
    badge.className = 'status-badge';
  } else {
    dot.className = 'status-dot offline';
    badge.querySelector('span:last-child').textContent = 'Auto-Pilot Off';
    badge.className = 'status-badge';
  }
}

function updateApControls(apStatus) {
  const apDot = document.querySelector('.ap-dot');
  const apText = document.getElementById('apStatusText');
  const btnStart = document.getElementById('btnApStart');
  const btnPause = document.getElementById('btnApPause');
  const btnStop = document.getElementById('btnApStop');

  if (!apStatus || !apStatus.isRunning) {
    apDot.className = 'ap-dot';
    apText.textContent = 'Stopped';
    btnStart.disabled = false;
    btnPause.disabled = true;
    btnStop.disabled = true;
  } else if (apStatus.isPaused) {
    apDot.className = 'ap-dot paused';
    apText.textContent = 'Paused';
    btnStart.disabled = true;
    btnPause.textContent = '▶️ Resume';
    btnPause.disabled = false;
    btnStop.disabled = false;
  } else {
    apDot.className = 'ap-dot running';
    apText.textContent = 'Running';
    btnStart.disabled = true;
    btnPause.textContent = '⏸️ Pause';
    btnPause.disabled = false;
    btnStop.disabled = false;
  }

  if (apStatus) {
    document.getElementById('apSessions').textContent = apStatus.sessionsRun || 0;
    document.getElementById('apDownloaded').textContent = apStatus.totalDownloaded || 0;
    document.getElementById('apUploaded').textContent = apStatus.totalUploaded || 0;
    document.getElementById('apLastRun').textContent = apStatus.lastRunAt ? formatDate(apStatus.lastRunAt) : '-';
  }
}

async function apControl(action) {
  if (action === 'start') {
    const interval = parseInt(document.getElementById('apInterval').value) || 10;
    const categories = document.getElementById('apCategories').value.split(',').map(c => c.trim());
    const targets = [];
    if (document.getElementById('apYoutube').checked) targets.push('youtube');
    if (document.getElementById('apFacebook').checked) targets.push('facebook');

    await api('/autopilot/start', {
      method: 'POST',
      body: { intervalMinutes: interval, categories, targets },
    });
    showToast('Auto-Pilot started! 🚀', 'success');
  } else if (action === 'pause') {
    const apDot = document.querySelector('.ap-dot');
    if (apDot.classList.contains('paused')) {
      await api('/autopilot/resume', { method: 'POST' });
      showToast('Auto-Pilot resumed', 'info');
    } else {
      await api('/autopilot/pause', { method: 'POST' });
      showToast('Auto-Pilot paused', 'warning');
    }
  } else if (action === 'stop') {
    await api('/autopilot/stop', { method: 'POST' });
    showToast('Auto-Pilot stopped', 'info');
  }

  setTimeout(loadStats, 500);
}

// ================================================
// Manual Reup
// ================================================

async function manualReup() {
  const url = document.getElementById('reupUrl').value.trim();
  if (!url) {
    showToast('Please enter a YouTube URL', 'warning');
    return;
  }

  const category = document.getElementById('reupCategory').value;
  const targets = [];
  if (document.getElementById('reupYt').checked) targets.push('youtube');
  if (document.getElementById('reupFb').checked) targets.push('facebook');

  const resultEl = document.getElementById('reupResult');
  const btn = document.getElementById('btnReup');

  btn.disabled = true;
  btn.textContent = '⏳ Processing...';
  resultEl.className = 'reup-result loading';
  resultEl.textContent = '🔄 Downloading and uploading... This may take a few minutes.';
  resultEl.style.display = 'block';

  try {
    const result = await api('/reup', {
      method: 'POST',
      body: { url, targets, category, format: document.getElementById('reupFormat')?.value || 'youtube_shorts' },
    });

    if (result?.success) {
      resultEl.className = 'reup-result success';
      resultEl.textContent = '✅ Reup complete! Check upload history for details.';
      showToast('Reup completed successfully! 🎉', 'success');
      document.getElementById('reupUrl').value = '';
    } else {
      resultEl.className = 'reup-result error';
      resultEl.textContent = `❌ ${result?.error || 'Reup failed'}`;
      showToast('Reup failed: ' + (result?.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    resultEl.className = 'reup-result error';
    resultEl.textContent = `❌ Error: ${error.message}`;
    showToast('Reup failed: ' + error.message, 'error');
  }

  btn.disabled = false;
  btn.textContent = '🔄 Start Reup';
  loadStats();
}

async function batchReup() {
  const urls = document.getElementById('batchUrls').value.trim().split('\n').filter(Boolean);
  if (urls.length === 0) {
    showToast('Please enter URLs', 'warning');
    return;
  }

  showToast(`Starting batch of ${urls.length} URLs...`, 'info');

  for (const url of urls) {
    document.getElementById('reupUrl').value = url;
    await manualReup();
  }

  showToast('Batch reup complete!', 'success');
}

// ================================================
// SEO Preview
// ================================================

const GENRE_ICONS = {
  gaming: '🎮', comedy: '😂', music: '🎵', food: '🍜', tech: '📱',
  beauty: '💄', sports: '⚽', education: '📚', animals: '🐶', travel: '✈️',
  asmr: '🎧', news: '📰', entertainment: '🎬',
};

async function previewSEO() {
  const title = document.getElementById('reupTitle')?.value?.trim();
  if (!title) {
    showToast('Please enter a video title for SEO analysis', 'warning');
    return;
  }

  const btn = document.getElementById('btnPreviewSEO');
  btn.disabled = true;
  btn.textContent = '⏳ Analyzing...';

  try {
    const category = document.getElementById('reupCategory').value;
    const format = document.getElementById('reupFormat')?.value || 'youtube_shorts';

    const result = await api('/seo-preview', {
      method: 'POST',
      body: { title, format },
    });

    if (!result?.success) {
      showToast('SEO analysis failed', 'error');
      return;
    }

    // Show panel
    document.getElementById('seoPreviewPanel').style.display = '';

    // Genre badge
    const genre = result.genre || 'entertainment';
    document.getElementById('seoGenreIcon').textContent = GENRE_ICONS[genre] || '🎬';
    document.getElementById('seoGenreLabel').textContent = genre.charAt(0).toUpperCase() + genre.slice(1);

    // Content type
    const ct = result.classification;
    document.getElementById('seoContentType').textContent =
      `${ct?.contentType === 'animation' ? '🎨 Animation' : '👤 Real Person'} • ${result.language === 'vi' ? '🇻🇳 Tiếng Việt' : '🇺🇸 English'} • ${result.format}`;

    // Sub-genres
    const subEl = document.getElementById('seoSubGenres');
    subEl.innerHTML = '';
    if (ct?.subGenres) {
      ct.subGenres.forEach(sg => {
        const badge = document.createElement('span');
        badge.style.cssText = 'padding: 3px 8px; border-radius: 6px; font-size: 10px; background: rgba(139,92,246,0.15); color: #a78bfa;';
        badge.textContent = `${GENRE_ICONS[sg] || ''} ${sg}`;
        subEl.appendChild(badge);
      });
    }

    // SEO Score
    const score = result.seoScore || 0;
    document.getElementById('seoScoreValue').textContent = score;
    document.getElementById('seoScoreValue').style.color =
      score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444';
    document.getElementById('seoScoreBar').style.width = score + '%';

    // Optimized title
    document.getElementById('seoTitle').textContent = result.title || '';

    // Hashtags
    const hashEl = document.getElementById('seoHashtags');
    hashEl.innerHTML = '';
    const hashtags = result.hashtags || [];
    document.getElementById('seoHashtagCount').textContent = hashtags.length;
    hashtags.forEach(h => {
      const tag = document.createElement('span');
      tag.style.cssText = 'padding: 4px 10px; border-radius: 8px; font-size: 11px; background: rgba(99,102,241,0.12); color: #818cf8; cursor: pointer;';
      tag.textContent = h;
      tag.onclick = () => { navigator.clipboard.writeText(h); showToast(`Copied: ${h}`, 'info'); };
      hashEl.appendChild(tag);
    });

    // Description
    document.getElementById('seoDescription').textContent = result.description || '';

    showToast(`SEO Score: ${score}/100 | Genre: ${genre}`, score >= 60 ? 'success' : 'warning');

  } catch (e) {
    showToast('SEO Error: ' + e.message, 'error');
  }

  btn.disabled = false;
  btn.textContent = '📈 Preview SEO';
}

// ================================================
// Accounts
// ================================================

async function loadAccounts() {
  const accounts = await api('/accounts');
  const container = document.getElementById('accountsList');

  if (!accounts || accounts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">👤</div>
        <div class="empty-state-text">No accounts connected yet</div>
        <div class="empty-state-sub">Use the CLI to connect YouTube & Facebook accounts</div>
      </div>
    `;
    return;
  }

  container.innerHTML = accounts.map(a => `
    <div class="account-card">
      <div class="account-icon">${a.platform === 'youtube' ? '▶️' : '📘'}</div>
      <div class="account-info">
        <div class="account-name">${escapeHtml(a.name)}</div>
        <div class="account-detail">${a.platform.toUpperCase()} • ${a.auth_type} • ${a.status}</div>
      </div>
      <span class="badge badge-${a.status === 'active' ? 'published' : 'failed'}">${a.status}</span>
    </div>
  `).join('');
}

// ================================================
// Logs
// ================================================

let logAutoScroll = true;

async function loadLogs() {
  const logs = await api('/logs?last=200');
  if (!logs) return;

  const viewer = document.getElementById('logViewer');
  viewer.textContent = logs.join('\n');

  if (logAutoScroll) {
    viewer.scrollTop = viewer.scrollHeight;
  }
}

function clearLogsDisplay() {
  document.getElementById('logViewer').textContent = '';
  showToast('Logs cleared', 'info');
}

// ================================================
// Settings
// ================================================

const SETTINGS_FIELDS = [
  'youtube_client_id', 'youtube_client_secret', 'youtube_redirect_uri',
  'facebook_app_id', 'facebook_app_secret', 'facebook_page_id', 'facebook_page_access_token',
  'upload_interval_minutes', 'max_uploads_per_day', 'download_concurrent',
  'max_duration_youtube', 'max_duration_facebook',
  'autopilot_interval_minutes', 'autopilot_max_videos', 'autopilot_categories', 'autopilot_region',
  'transform_video_speed_factor', 'transform_pitch_factor', 'transform_audio_speed_factor',
  'transform_color_saturation', 'transform_color_contrast', 'transform_color_brightness',
];

const SETTINGS_CHECKBOXES = [
  'target_youtube', 'target_facebook',
  'transform_mirror', 'transform_crop', 'transform_color_grade', 'transform_video_speed',
  'transform_pitch_shift', 'transform_audio_speed',
];

const SETTINGS_SELECTS = ['transform_mode'];

async function loadSettings() {
  const settings = await api('/settings');
  if (!settings) return;

  for (const key of SETTINGS_FIELDS) {
    const el = document.getElementById('s_' + key);
    if (el && settings[key] !== undefined) {
      el.value = settings[key];
    }
  }

  for (const key of SETTINGS_CHECKBOXES) {
    const el = document.getElementById('s_' + key);
    if (el && settings[key] !== undefined) {
      el.checked = settings[key] === true || settings[key] === 'true';
    }
  }

  for (const key of SETTINGS_SELECTS) {
    const el = document.getElementById('s_' + key);
    if (el && settings[key] !== undefined) {
      el.value = settings[key];
    }
  }
}

async function saveSettings() {
  const btn = document.getElementById('btnSaveSettings');
  const status = document.getElementById('saveStatus');
  btn.disabled = true;
  btn.textContent = '⏳ Saving...';

  const data = {};

  for (const key of SETTINGS_FIELDS) {
    const el = document.getElementById('s_' + key);
    if (el) {
      const val = el.value.trim();
      if (val && !val.includes('••••')) {
        data[key] = el.type === 'number' ? Number(val) : val;
      }
    }
  }

  for (const key of SETTINGS_CHECKBOXES) {
    const el = document.getElementById('s_' + key);
    if (el) {
      data[key] = el.checked;
    }
  }

  for (const key of SETTINGS_SELECTS) {
    const el = document.getElementById('s_' + key);
    if (el) {
      data[key] = el.value;
    }
  }

  try {
    const result = await api('/settings', {
      method: 'POST',
      body: data,
    });

    if (result?.success) {
      status.className = 'save-status success';
      status.textContent = '✅ Saved!';
      showToast('Settings saved successfully!', 'success');
    } else {
      status.className = 'save-status error';
      status.textContent = '❌ ' + (result?.error || 'Failed');
      showToast('Failed to save settings', 'error');
    }
  } catch (e) {
    status.className = 'save-status error';
    status.textContent = '❌ ' + e.message;
    showToast('Error: ' + e.message, 'error');
  }

  btn.disabled = false;
  btn.textContent = '💾 Save Settings';

  setTimeout(() => { status.textContent = ''; }, 3000);
}

// ================================================
// Utilities
// ================================================

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent = now.toLocaleString('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}

// ================================================
// Keyboard Shortcuts
// ================================================

document.addEventListener('keydown', (e) => {
  // Alt + number for quick nav
  if (e.altKey) {
    const shortcuts = { '1': 'dashboard', '2': 'autopilot', '3': 'uploads', '4': 'reup', '5': 'analytics', '6': 'accounts', '7': 'logs', '8': 'settings' };
    if (shortcuts[e.key]) {
      e.preventDefault();
      switchPage(shortcuts[e.key]);
    }
  }

  // Ctrl+R to refresh current page data
  if (e.ctrlKey && e.key === 'r' && !e.shiftKey) {
    // Don't prevent default - let browser refresh work too
  }
});

// ================================================
// Account & Rotation Management
// ================================================

let _accountData = null;

async function loadAccountOverview() {
  try {
    const result = await api('/accounts/overview');
    if (!result?.success) return;

    _accountData = result;

    // Update stats
    document.getElementById('accYtCount').textContent = result.totalYouTube || 0;
    document.getElementById('accFbCount').textContent = result.totalFacebook || 0;
    document.getElementById('accPageCount').textContent = result.totalPages || 0;

    // Render account cards
    const list = document.getElementById('accountsList');
    if (!result.accounts || result.accounts.length === 0) {
      list.innerHTML = '<p class="hint" style="text-align: center; padding: 24px;">No accounts connected yet. Use CLI to add accounts.</p>';
    } else {
      list.innerHTML = result.accounts.map(acc => {
        const platformIcon = acc.platform === 'youtube' ? '📺' : '📘';
        const platformClass = acc.platform === 'youtube' ? 'badge-youtube' : 'badge-facebook';

        // Rotation badges
        const rotationBadges = (acc.rotations || []).map(r => {
          const formatLabels = {
            youtube_shorts: '🎬 Shorts (EN)',
            youtube_long: '📺 Video Dài (VN)',
            facebook_reels: '📱 Reels (VN)',
          };
          const label = r.assigned_format ? formatLabels[r.assigned_format] : '🌐 All';
          return `<span class="badge badge-format">${label}${r.daily_limit ? ` • Max ${r.daily_limit}/day` : ''}${r.uploads_today ? ` • ${r.uploads_today} today` : ''}</span>`;
        }).join('');

        // Pages list (for FB)
        const pagesList = (acc.pages || []).map(p =>
          `<div class="page-item">
            <span>📄 ${p.page_name}</span>
            <span class="hint">${p.page_id}</span>
            <button class="btn btn-sm btn-ghost" onclick="removePage(${acc.id}, '${p.page_id}')" title="Remove">🗑️</button>
          </div>`
        ).join('');

        return `
          <div class="account-card">
            <div class="account-header">
              <span class="badge ${platformClass}">${platformIcon} ${acc.platform.toUpperCase()}</span>
              <strong>${acc.name}</strong>
              <span class="badge badge-status">${acc.status}</span>
            </div>
            <div class="account-meta">
              <span>🔐 ${acc.authType}</span>
              ${acc.channelId ? `<span>📡 ${acc.channelId}</span>` : ''}
              ${acc.pageId ? `<span>📄 Page: ${acc.pageId}</span>` : ''}
            </div>
            ${rotationBadges ? `<div class="account-rotations">${rotationBadges}</div>` : ''}
            ${pagesList ? `<div class="account-pages"><strong>Pages:</strong>${pagesList}</div>` : ''}
          </div>
        `;
      }).join('');
    }

    // Populate dropdowns
    populateAccountDropdowns(result.accounts);

  } catch (error) {
    console.error('Failed to load accounts:', error);
  }
}

function populateAccountDropdowns(accounts) {
  // FB account dropdown (for adding pages)
  const fbSelect = document.getElementById('addPageAccount');
  const fbAccounts = accounts.filter(a => a.platform === 'facebook');
  fbSelect.innerHTML = fbAccounts.length === 0
    ? '<option value="">No FB accounts</option>'
    : fbAccounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');

  // All accounts dropdown (for rotation config)
  const rotSelect = document.getElementById('rotationAccount');
  rotSelect.innerHTML = accounts.map(a => {
    const icon = a.platform === 'youtube' ? '📺' : '📘';
    return `<option value="${a.id}">${icon} ${a.name} (${a.platform})</option>`;
  }).join('');
}

async function addFacebookPage() {
  const accountId = document.getElementById('addPageAccount').value;
  const pageId = document.getElementById('addPageId').value.trim();
  const pageName = document.getElementById('addPageName').value.trim();
  const pageAccessToken = document.getElementById('addPageToken').value.trim();

  if (!accountId || !pageId || !pageName) {
    showToast('Please fill in Account, Page ID, and Page Name', 'error');
    return;
  }

  try {
    const result = await api('/accounts/pages', {
      method: 'POST',
      body: { accountId: Number(accountId), pageId, pageName, pageAccessToken: pageAccessToken || null },
    });
    if (result?.success) {
      showToast(`Page "${pageName}" added! 📄`, 'success');
      document.getElementById('addPageId').value = '';
      document.getElementById('addPageName').value = '';
      document.getElementById('addPageToken').value = '';
      loadAccountOverview();
    } else {
      showToast(result?.error || 'Failed to add page', 'error');
    }
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  }
}

async function removePage(accountId, pageId) {
  if (!confirm('Remove this page?')) return;
  try {
    await api('/accounts/pages', {
      method: 'DELETE',
      body: { accountId, pageId },
    });
    showToast('Page removed', 'info');
    loadAccountOverview();
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  }
}

async function saveRotationConfig() {
  const accountId = Number(document.getElementById('rotationAccount').value);
  const format = document.getElementById('rotationFormat').value || null;
  const dailyLimit = Number(document.getElementById('rotationDailyLimit').value) || 0;
  const cooldownMinutes = Number(document.getElementById('rotationCooldown').value) || 0;

  if (!accountId) {
    showToast('Select an account first', 'error');
    return;
  }

  try {
    const result = await api('/accounts/rotation', {
      method: 'POST',
      body: { accountId, format, dailyLimit, cooldownMinutes },
    });
    if (result?.success) {
      showToast('Rotation config saved! 🔄', 'success');
      loadAccountOverview();
    } else {
      showToast(result?.error || 'Failed', 'error');
    }
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  }
}

// ================================================
// Init
// ================================================

loadStats();
loadRecentUploads();
updateClock();

// Auto-refresh intervals
setInterval(loadStats, 5000);
setInterval(loadRecentUploads, 15000);
setInterval(updateClock, 1000);

// Auto-refresh logs when on logs page
setInterval(() => {
  if (document.getElementById('page-logs')?.classList.contains('active')) {
    loadLogs();
  }
}, 3000);

// Show startup toast
setTimeout(() => showToast('Dashboard connected ✨', 'info', 2500), 500);
