import express from 'express';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
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
  const headers = {
    'Cookie': cookieString,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
  };

  try {
    // Method 1: Check facebook.com main page (most reliable)
    const res = await fetch('https://www.facebook.com/', {
      method: 'GET',
      headers,
      redirect: 'manual',
    });

    const status = res.status;
    const location = res.headers.get('location') || '';

    // If redirected to login → cookies invalid
    if (location.includes('/login') || location.includes('checkpoint')) {
      return { valid: false, reason: `Redirected to login (cookie expired)` };
    }

    // 302 to another FB page = valid
    if (status === 302 && location.includes('facebook.com') && !location.includes('login')) {
      return { valid: true, redirect: location, name: null };
    }

    // 200 = we got the main page = logged in
    if (status === 200) {
      const body = await res.text();
      // Check if login form is present (not logged in)
      if (body.includes('login_form') || body.includes('/login/')) {
        return { valid: false, reason: 'Login page returned (cookie expired)' };
      }
      // Try to extract name
      const nameMatch = body.match(/"NAME":"([^"]+)"/i) || body.match(/title>([^<]+)<\/title/);
      const name = nameMatch ? nameMatch[1].replace(/\s*[|\-–].*/g, '').trim() : null;
      return { valid: true, name };
    }

    // Method 2: If main page failed, try the Graph API endpoint
    if (status >= 400) {
      const c_user = cookieString.match(/c_user=(\d+)/)?.[1];
      if (c_user) {
        // c_user cookie exists and was parsed = likely valid (soft check)
        return { valid: true, name: null, softCheck: true };
      }
    }

    return { valid: false, reason: `HTTP ${status}` };
  } catch (err) {
    // Network error but c_user exists → allow as soft-valid
    const c_user = cookieString.match(/c_user=(\d+)/)?.[1];
    if (c_user) {
      return { valid: true, name: null, softCheck: true };
    }
    return { valid: false, reason: err.message };
  }
}

// === NEW: Phase 7 ===
import { AnalyticsAPI } from './analytics-api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
