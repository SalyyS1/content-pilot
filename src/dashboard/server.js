import express from 'express';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import logger, { getLogBuffer } from '../core/logger.js';
import { getStats, getUploads, getAccounts, getAccount, addAccount, deleteAccount, getAllAccountsWithStats, updateAccountCredentials } from '../core/database.js';
import { bulkSetSettings, getAllSettings } from '../core/database.js';
import config from '../core/config.js';

const SESSIONS_DIR = resolve(process.cwd(), 'data', 'sessions');
if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });

/**
 * Parse browser extension cookie JSON format into:
 * - cookieString: "name=value; name2=value2" for HTTP requests
 * - playwrightCookies: array of Playwright-compatible cookie objects
 */
function parseCookieInput(rawCookie) {
  let cookieString = '';
  let playwrightCookies = [];
  let c_user = null;

  try {
    const parsed = JSON.parse(rawCookie);
    if (parsed.cookies && Array.isArray(parsed.cookies)) {
      // Browser extension format: {url, cookies: [{domain, name, value, ...}]}
      playwrightCookies = parsed.cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain || '.facebook.com',
        path: c.path || '/',
        httpOnly: c.httpOnly || false,
        secure: c.secure !== false,
        sameSite: c.sameSite === 'no_restriction' ? 'None' : (c.sameSite === 'lax' ? 'Lax' : 'None'),
        expires: c.expirationDate || -1,
      }));
      cookieString = parsed.cookies.map(c => `${c.name}=${c.value}`).join('; ');
      const cUser = parsed.cookies.find(c => c.name === 'c_user');
      if (cUser) c_user = cUser.value;
    } else if (Array.isArray(parsed)) {
      // Direct array format: [{name, value, domain, ...}]
      playwrightCookies = parsed.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain || '.facebook.com',
        path: c.path || '/',
        httpOnly: c.httpOnly || false,
        secure: c.secure !== false,
        sameSite: 'None',
        expires: c.expirationDate || -1,
      }));
      cookieString = parsed.map(c => `${c.name}=${c.value}`).join('; ');
      const cUser = parsed.find(c => c.name === 'c_user');
      if (cUser) c_user = cUser.value;
    }
  } catch {
    // Not JSON — treat as raw cookie string
    cookieString = rawCookie;
    // Try to extract c_user
    const match = rawCookie.match(/c_user=([0-9]+)/);
    if (match) c_user = match[1];
  }

  return { cookieString, playwrightCookies, c_user };
}

/**
 * Save Playwright-compatible session file for an account
 */
function savePlaywrightSession(accountId, playwrightCookies) {
  if (!playwrightCookies.length) return;
  const storagePath = join(SESSIONS_DIR, `${accountId}.json`);
  const storageState = {
    cookies: playwrightCookies,
    origins: [{
      origin: 'https://www.facebook.com',
      localStorage: [],
    }],
  };
  writeFileSync(storagePath, JSON.stringify(storageState, null, 2));
  logger.info(`💾 Session saved for account #${accountId}`);
}

/**
 * Validate Facebook cookies by making an HTTP request to Facebook
 * Uses multiple methods for reliability
 */
async function validateFacebookCookies(cookieString) {
  // Check mbasic.facebook.com with mobile UA (same as posting code) for accurate results
  const headers = {
    'Cookie': cookieString,
    'User-Agent': 'Mozilla/5.0 (Linux; U; Android 4.4.2; en-us; SCH-I535 Build/KOT49H) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  try {
    const res = await fetch('https://mbasic.facebook.com/', {
      method: 'GET',
      headers,
      redirect: 'follow',
    });

    const body = await res.text();

    // 1) Check for fb_dtsg FIRST — if found, user is definitely logged in
    const hasDtsg = body.match(/name="fb_dtsg"\s+value="([^"]+)"/);
    if (hasDtsg) {
      const nameMatch = body.match(/<title>([^<]+)<\/title>/);
      const name = nameMatch ? nameMatch[1].trim() : null;
      return { valid: true, name, canPost: true };
    }

    // 2) No fb_dtsg found — check if it's a login page
    if (body.includes('login_form') || (body.includes('/login.php') && body.includes('password'))) {
      return { valid: false, reason: 'Cookie expired — mbasic redirected to login' };
    }

    // 3) Check for checkpoint
    if (body.includes('/checkpoint/') && !body.includes('fb_dtsg')) {
      return { valid: false, reason: 'Account checkpointed — requires verification' };
    }

    // 4) Page loaded OK but no fb_dtsg — might be "browser not supported" but still logged in
    if (res.ok) {
      // Check for logout link as proof of login
      if (body.includes('logout') || body.includes('mbasic_logout_button')) {
        return { valid: true, name: null, canPost: false };
      }
    }

    return { valid: false, reason: `HTTP ${res.status} — could not verify` };
  } catch (err) {
    return { valid: false, reason: `Network error: ${err.message}` };
  }
}


// === NEW: Phase 7 ===
import { AnalyticsAPI } from './analytics-api.js';
import { AutoPilot } from '../autopilot/autopilot.js';
import { FacebookStatusPoster } from '../uploader/facebook-status-poster.js';
import { FacebookAutoReply } from '../uploader/facebook-auto-reply.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Singleton instances
let autopilotInstance = null;
let statusPosterInstance = null;
let autoReplyInstance = null;

/**
 * Dashboard Server (Upgraded)
 * 
 * New endpoints:
 * - /api/health — Account health scores
 * - /api/calendar — Upload heatmap data
 * - /api/analytics — Overview metrics + revenue estimate
 * - /api/queue — Scheduler queue status
 */
export function startDashboard(options = {}) {
  const app = express();
  const port = config.dashboard?.port || 3000;

  const analytics = new AnalyticsAPI({ db: options.db || null });

  // Static files
  app.use(express.static(resolve(__dirname, 'public')));
  app.use(express.json());

  // === EXISTING: Basic stats ===
  app.get('/api/stats', (req, res) => {
    try {
      const stats = getStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/uploads', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const uploads = getUploads(limit);
      res.json(uploads);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/accounts', (req, res) => {
    try {
      let accounts;
      try {
        accounts = getAllAccountsWithStats();
      } catch {
        accounts = getAccounts();
      }
      res.json(accounts);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/accounts', (req, res) => {
    try {
      const { platform, name, email, cookie, pages } = req.body;
      if (!platform || !name) {
        return res.status(400).json({ error: 'Platform and name are required' });
      }

      const credentials = {};
      if (email) credentials.email = email;
      if (pages) credentials.pages = pages.split(',').map(p => p.trim());

      // Parse cookie input (supports browser extension JSON, raw string, etc.)
      let parsedCookie = null;
      if (cookie) {
        parsedCookie = parseCookieInput(cookie);
        credentials.cookie = parsedCookie.cookieString;
        credentials.rawCookie = cookie; // Keep original for reference
        if (parsedCookie.c_user) credentials.c_user = parsedCookie.c_user;
      }

      const result = addAccount(platform, name, cookie ? 'cookie' : 'api', credentials, {
        pageId: null,
        channelId: null,
      });

      const accountId = result.lastInsertRowid;

      // Save Playwright session file if we have parsed cookies
      if (parsedCookie && parsedCookie.playwrightCookies.length > 0) {
        savePlaywrightSession(accountId, parsedCookie.playwrightCookies);
      }

      logger.info(`✅ Account added: #${accountId} (${platform}/${name}) c_user=${parsedCookie?.c_user || 'N/A'}`);
      res.json({ id: accountId, message: 'Account added!', c_user: parsedCookie?.c_user });
    } catch (error) {
      logger.error(`❌ Add account error: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/accounts/:id', (req, res) => {
    try {
      deleteAccount(parseInt(req.params.id));
      res.json({ message: 'Account deleted' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/accounts/:id/test', async (req, res) => {
    try {
      const account = getAccount(parseInt(req.params.id));
      if (!account) {
        return res.status(404).json({ error: 'Account not found' });
      }

      let credentials;
      try {
        credentials = JSON.parse(account.credentials || '{}');
      } catch {
        credentials = {};
      }

      if (!credentials.cookie) {
        return res.json({ status: 'warning', message: '⚠️ No cookie stored for this account' });
      }

      if (account.platform === 'facebook') {
        const result = await validateFacebookCookies(credentials.cookie);
        if (result.valid) {
          logger.info(`✅ Account #${req.params.id} cookie is valid`);
          return res.json({
            status: 'success',
            message: `✅ Cookie hợp lệ!${result.name ? ' (' + result.name + ')' : ''}`,
            valid: true,
          });
        } else {
          logger.warn(`❌ Account #${req.params.id} cookie invalid: ${result.reason}`);
          return res.json({
            status: 'error',
            message: `❌ Cookie không hợp lệ hoặc đã hết hạn: ${result.reason}`,
            valid: false,
          });
        }
      }

      // For other platforms, basic check
      res.json({ status: 'success', message: '✅ Account data exists' });
    } catch (error) {
      logger.error(`Test account error: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/logs', (req, res) => {
    try {
      const last = parseInt(req.query.last) || 100;
      const logs = getLogBuffer();
      res.json(logs.slice(-last));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/config', (req, res) => {
    try {
      const dbSettings = config;
      res.json({
        maxUploadsPerDay: dbSettings.maxUploadsPerDay,
        uploadIntervalMinutes: dbSettings.uploadIntervalMinutes,
        transformMode: dbSettings.transformMode,
        processingPreset: dbSettings.processingPreset || 'standard',
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/config', (req, res) => {
    try {
      bulkSetSettings(req.body);
      res.json({ message: 'Settings saved!' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // === AUTOPILOT Control endpoints ===

  app.get('/api/autopilot/status', (req, res) => {
    try {
      if (!autopilotInstance) {
        return res.json({ running: false, stats: null });
      }
      const status = autopilotInstance.getStatus();
      res.json({ running: !!status.isRunning, stats: status });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/autopilot/start', (req, res) => {
    try {
      if (autopilotInstance && autopilotInstance.isRunning) {
        return res.json({ message: 'Autopilot đang chạy rồi!', running: true });
      }

      const { targets = ['facebook'], interval = 10, maxVideos = 3 } = req.body || {};

      autopilotInstance = new AutoPilot({
        intervalMinutes: interval,
        targets: Array.isArray(targets) ? targets : targets.split(','),
        maxVideos,
      });

      autopilotInstance.start();
      logger.info(`🚀 Autopilot started from dashboard (targets: ${targets}, interval: ${interval}min)`);
      res.json({ message: '🚀 Autopilot đã bật!', running: true });
    } catch (error) {
      logger.error(`Autopilot start error: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/autopilot/stop', (req, res) => {
    try {
      if (!autopilotInstance || !autopilotInstance.isRunning) {
        return res.json({ message: 'Autopilot chưa chạy', running: false });
      }
      autopilotInstance.stop();
      logger.info('⏹️ Autopilot stopped from dashboard');
      res.json({ message: '⏹️ Autopilot đã tắt', running: false });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // === STATUS POSTER Control endpoints ===

  app.get('/api/status-poster/status', (req, res) => {
    try {
      if (!statusPosterInstance) {
        return res.json({ running: false, stats: null });
      }
      const status = statusPosterInstance.getStatus();
      res.json({ running: !!status.isRunning, stats: status });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/status-poster/start', (req, res) => {
    try {
      if (statusPosterInstance && statusPosterInstance.isRunning) {
        return res.json({ message: 'Status Poster đang chạy rồi!', running: true });
      }

      const { intervalHours = 3 } = req.body || {};

      statusPosterInstance = new FacebookStatusPoster({
        intervalHours: parseFloat(intervalHours),
      });

      statusPosterInstance.start();
      logger.info(`📝 Status Poster started from dashboard (interval: ${intervalHours}h)`);
      res.json({ message: '📝 Status Poster đã bật!', running: true });
    } catch (error) {
      logger.error(`Status Poster start error: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/status-poster/stop', (req, res) => {
    try {
      if (!statusPosterInstance || !statusPosterInstance.isRunning) {
        return res.json({ message: 'Status Poster chưa chạy', running: false });
      }
      statusPosterInstance.stop();
      logger.info('⏹️ Status Poster stopped from dashboard');
      res.json({ message: '⏹️ Status Poster đã tắt', running: false });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // === AUTO-REPLY Control endpoints ===

  app.get('/api/auto-reply/status', (req, res) => {
    try {
      if (!autoReplyInstance) {
        return res.json({ running: false, stats: null });
      }
      const status = autoReplyInstance.getStatus();
      res.json({ running: !!status.isRunning, stats: status });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/auto-reply/start', (req, res) => {
    try {
      if (autoReplyInstance && autoReplyInstance.isRunning) {
        return res.json({ message: 'Auto-Reply đang chạy rồi!', running: true });
      }

      const { intervalMinutes = 30, maxReplies = 5 } = req.body || {};

      autoReplyInstance = new FacebookAutoReply({
        intervalMinutes: parseInt(intervalMinutes),
        maxReplies: parseInt(maxReplies),
      });

      autoReplyInstance.start();
      logger.info(`💬 Auto-Reply started from dashboard (interval: ${intervalMinutes}min)`);
      res.json({ message: '💬 Auto-Reply đã bật!', running: true });
    } catch (error) {
      logger.error(`Auto-Reply start error: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/auto-reply/stop', (req, res) => {
    try {
      if (!autoReplyInstance || !autoReplyInstance.isRunning) {
        return res.json({ message: 'Auto-Reply chưa chạy', running: false });
      }
      autoReplyInstance.stop();
      logger.info('⏹️ Auto-Reply stopped from dashboard');
      res.json({ message: '⏹️ Auto-Reply đã tắt', running: false });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // === NEW: Phase 7 Analytics endpoints ===

  app.get('/api/health', (req, res) => {
    try {
      const data = analytics.getAccountsHealth();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/calendar', (req, res) => {
    try {
      const year = parseInt(req.query.year) || new Date().getFullYear();
      const month = parseInt(req.query.month) || new Date().getMonth() + 1;
      const data = analytics.getCalendarData(year, month);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/analytics', (req, res) => {
    try {
      const overview = analytics.getOverview();
      const revenue = analytics.getRevenueEstimate(30);
      res.json({ ...overview, revenue });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/queue', (req, res) => {
    try {
      const queue = analytics.getQueueStatus();
      res.json(queue);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/ab-tests', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 10;
      const data = analytics.getABTestResults(limit);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // === AI AUTH endpoints ===

  app.get('/api/ai-status', (req, res) => {
    try {
      const tokensFile = resolve(process.cwd(), 'data', 'sessions', 'ai-tokens.json');
      let chatgpt = false, gemini = false, geminiKeyPreview = '', googleOAuth = false, googleEmail = '', openaiKey = false, openaiKeyPreview = '';
      
      if (existsSync(tokensFile)) {
        const data = JSON.parse(readFileSync(tokensFile, 'utf8'));
        if (data.chatgpt?.sessionToken) {
          chatgpt = data.chatgpt.sessionExpiry > Date.now();
        }
        if (data.openaiKey) {
          openaiKey = true;
          chatgpt = true; // API key also enables ChatGPT
          openaiKeyPreview = data.openaiKey.slice(0, 7) + '...' + data.openaiKey.slice(-4);
        }
        if (data.geminiKey) {
          gemini = true;
          geminiKeyPreview = data.geminiKey.slice(0, 8) + '...' + data.geminiKey.slice(-4);
        }
        if (data.google?.refreshToken) {
          googleOAuth = true;
          googleEmail = data.google.email || '';
          gemini = true;
        }
      }
      
      res.json({ chatgpt, gemini, geminiKeyPreview, googleOAuth, googleEmail, openaiKey, openaiKeyPreview });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // === Google OAuth Device Code Flow ===
  let googleDeviceState = null;

  app.post('/api/ai-auth/google/config', (req, res) => {
    try {
      const { clientId, clientSecret } = req.body;
      if (!clientId || !clientSecret) {
        return res.status(400).json({ error: 'Client ID và Secret required' });
      }

      const tokensFile = resolve(SESSIONS_DIR, 'ai-tokens.json');
      let data = {};
      if (existsSync(tokensFile)) {
        try { data = JSON.parse(readFileSync(tokensFile, 'utf8')); } catch {}
      }

      data.google = data.google || {};
      data.google.clientId = clientId.trim();
      data.google.clientSecret = clientSecret.trim();
      data.savedAt = new Date().toISOString();
      writeFileSync(tokensFile, JSON.stringify(data, null, 2));

      logger.info('🔑 Google OAuth credentials saved');
      res.json({ message: '✅ Google OAuth credentials saved!' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/ai-auth/google/start', async (req, res) => {
    try {
      const tokensFile = resolve(SESSIONS_DIR, 'ai-tokens.json');
      if (!existsSync(tokensFile)) {
        return res.status(400).json({ error: 'Cấu hình Google OAuth credentials trước' });
      }
      
      const data = JSON.parse(readFileSync(tokensFile, 'utf8'));
      if (!data.google?.clientId) {
        return res.status(400).json({ error: 'Chưa có Google Client ID. Nhập Client ID + Secret trước.' });
      }

      const deviceRes = await fetch('https://oauth2.googleapis.com/device/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: data.google.clientId,
          scope: 'openid email profile https://www.googleapis.com/auth/generative-language',
        }),
      });

      const deviceData = await deviceRes.json();
      
      if (!deviceRes.ok) {
        return res.status(400).json({ error: deviceData.error_description || deviceData.error || 'Failed to start device flow' });
      }

      googleDeviceState = {
        deviceCode: deviceData.device_code,
        userCode: deviceData.user_code,
        verificationUrl: deviceData.verification_url,
        interval: deviceData.interval || 5,
        expiresIn: deviceData.expires_in,
        startedAt: Date.now(),
      };

      res.json({
        userCode: deviceData.user_code,
        verificationUrl: deviceData.verification_url,
        expiresIn: deviceData.expires_in,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/ai-auth/google/poll', async (req, res) => {
    try {
      if (!googleDeviceState) {
        return res.status(400).json({ error: 'Chưa bắt đầu login. Bấm Login with Google trước.' });
      }

      if (Date.now() - googleDeviceState.startedAt > googleDeviceState.expiresIn * 1000) {
        googleDeviceState = null;
        return res.status(400).json({ error: 'Code hết hạn. Bấm Login lại.' });
      }

      const tokensFile = resolve(SESSIONS_DIR, 'ai-tokens.json');
      const data = JSON.parse(readFileSync(tokensFile, 'utf8'));

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: data.google.clientId,
          client_secret: data.google.clientSecret,
          device_code: googleDeviceState.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });

      const tokenData = await tokenRes.json();

      if (tokenData.error === 'authorization_pending') {
        return res.json({ status: 'pending', message: 'Đang chờ bạn xác nhận...' });
      }
      if (tokenData.error === 'slow_down') {
        return res.json({ status: 'pending', message: 'Đang chờ... (slow down)' });
      }
      if (tokenData.error) {
        googleDeviceState = null;
        return res.status(400).json({ error: tokenData.error_description || tokenData.error });
      }

      // Success! Save tokens
      data.google.accessToken = tokenData.access_token;
      data.google.refreshToken = tokenData.refresh_token;
      data.google.accessTokenExpiry = Date.now() + (tokenData.expires_in * 1000);

      // Get user info
      try {
        const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (userRes.ok) {
          const userInfo = await userRes.json();
          data.google.email = userInfo.email;
          data.google.name = userInfo.name;
        }
      } catch {}

      data.savedAt = new Date().toISOString();
      writeFileSync(tokensFile, JSON.stringify(data, null, 2));
      googleDeviceState = null;

      logger.info(`🔑 Google OAuth connected: ${data.google.email || 'unknown'}`);
      res.json({
        status: 'success',
        message: `✅ Đã kết nối: ${data.google.email || 'Google account'}`,
        email: data.google.email,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/ai-auth/gemini', async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey || apiKey.length < 10) {
        return res.status(400).json({ error: 'API key không hợp lệ' });
      }

      // Validate key by making a real API call
      const testModels = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-pro'];
      let validated = false;
      let validModel = '';

      for (const model of testModels) {
        try {
          const testRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: 'Say "OK" in one word.' }] }],
                generationConfig: { maxOutputTokens: 10 },
              }),
            }
          );

          if (testRes.ok) {
            const testData = await testRes.json();
            const text = testData?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              validated = true;
              validModel = model;
              break;
            }
          }
        } catch {}
      }

      if (!validated) {
        return res.status(400).json({ error: '❌ API key không hoạt động. Kiểm tra lại key tại aistudio.google.com/apikey' });
      }

      // Key works — save it
      const sessionsDir = resolve(process.cwd(), 'data', 'sessions');
      if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });

      const tokensFile = resolve(sessionsDir, 'ai-tokens.json');
      let data = {};
      if (existsSync(tokensFile)) {
        try { data = JSON.parse(readFileSync(tokensFile, 'utf8')); } catch {}
      }

      data.geminiKey = apiKey.trim();
      data.savedAt = new Date().toISOString();
      writeFileSync(tokensFile, JSON.stringify(data, null, 2));

      logger.info(`🔑 Gemini API key saved + validated (model: ${validModel})`);
      res.json({ 
        message: `✅ Gemini API key hoạt động! (${validModel})`, 
        geminiKeyPreview: apiKey.slice(0, 8) + '...' + apiKey.slice(-4),
        validModel,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/ai-auth/chatgpt', (req, res) => {
    try {
      const { sessionToken } = req.body;
      if (!sessionToken || sessionToken.length < 10) {
        return res.status(400).json({ error: 'Session token không hợp lệ' });
      }

      const sessionsDir = resolve(process.cwd(), 'data', 'sessions');
      if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });

      const tokensFile = resolve(sessionsDir, 'ai-tokens.json');
      let data = {};
      if (existsSync(tokensFile)) {
        try { data = JSON.parse(readFileSync(tokensFile, 'utf8')); } catch {}
      }

      data.chatgpt = {
        sessionToken: sessionToken.trim(),
        sessionExpiry: Date.now() + 90 * 24 * 3600 * 1000, // 90 days
        accessToken: null,
        accessTokenExpiry: 0,
      };
      data.savedAt = new Date().toISOString();
      writeFileSync(tokensFile, JSON.stringify(data, null, 2));

      logger.info('🔑 ChatGPT session token saved from dashboard');
      res.json({ message: '✅ ChatGPT token đã lưu! Restart Story Writer để áp dụng.' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // === OpenAI API Key (official, paid) ===
  app.post('/api/ai-auth/openai', async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey || apiKey.length < 10) {
        return res.status(400).json({ error: 'API key không hợp lệ' });
      }

      // Validate by making a real API call
      const testRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Say OK' }],
          max_tokens: 5,
        }),
      });

      if (!testRes.ok) {
        const errBody = await testRes.text().catch(() => '');
        return res.status(400).json({ error: `❌ API key không hoạt động (HTTP ${testRes.status}). Kiểm tra lại key tại platform.openai.com` });
      }

      // Key works — save it
      const sessionsDir = resolve(process.cwd(), 'data', 'sessions');
      if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });

      const tokensFile = resolve(sessionsDir, 'ai-tokens.json');
      let data = {};
      if (existsSync(tokensFile)) {
        try { data = JSON.parse(readFileSync(tokensFile, 'utf8')); } catch {}
      }

      data.openaiKey = apiKey.trim();
      data.savedAt = new Date().toISOString();
      writeFileSync(tokensFile, JSON.stringify(data, null, 2));

      logger.info('🔑 OpenAI API key saved + validated');
      res.json({
        message: '✅ OpenAI API key hoạt động! (gpt-4o-mini)',
        openaiKeyPreview: apiKey.slice(0, 7) + '...' + apiKey.slice(-4),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(resolve(__dirname, 'public', 'index.html'));
  });

  app.listen(port, '0.0.0.0', () => {
    logger.info(`📊 Dashboard running on http://0.0.0.0:${port}`);
    console.log(`\n📊 Dashboard: http://0.0.0.0:${port}\n`);
  });

  return app;
}

export default { startDashboard };

// Auto-start when run directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('server.js') ||
  process.argv[1].includes('dashboard')
);
if (isMain) {
  startDashboard();
}
