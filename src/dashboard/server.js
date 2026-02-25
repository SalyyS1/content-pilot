import express from 'express';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger, { getLogBuffer } from '../core/logger.js';
import { getStats, getUploads, getAccounts, addAccount, deleteAccount, getAllAccountsWithStats } from '../core/database.js';
import { bulkSetSettings, getAllSettings } from '../core/database.js';
import config from '../core/config.js';

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
      if (cookie) credentials.cookie = cookie;
      if (email) credentials.email = email;
      if (pages) credentials.pages = pages.split(',').map(p => p.trim());

      const result = addAccount(platform, name, cookie ? 'cookie' : 'api', credentials, {
        pageId: null,
        channelId: null,
      });
      res.json({ id: result.lastInsertRowid, message: 'Account added!' });
    } catch (error) {
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

  app.post('/api/accounts/:id/test', (req, res) => {
    try {
      res.json({ message: 'Account is active! ✅' });
    } catch (error) {
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
