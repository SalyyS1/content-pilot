import express from 'express';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import config, { saveConfig } from '../core/config.js';
import logger, { getLogBuffer } from '../core/logger.js';
import {
  getStats, getUploads, getAccounts, getVideo,
  addJob, getNextJob, updateJob, setSetting, getSetting,
  getAllSettings, bulkSetSettings,
} from '../core/database.js';
import { AutoPilot } from '../autopilot/autopilot.js';
import { VideoClassifier } from '../core/video-classifier.js';
import { SEOOptimizer } from '../core/seo-optimizer.js';
import { getAccountRotation } from '../core/account-rotation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let autoPilot = null;
const classifier = new VideoClassifier();
const seoOptimizer = new SEOOptimizer();
const accountRotation = getAccountRotation();

export function startDashboard(port = config.dashboard.port) {
  const app = express();

  app.use(express.json());
  app.use(express.static(resolve(__dirname, 'public')));

  // =====================================================
  // API Routes
  // =====================================================

  // Dashboard stats
  app.get('/api/stats', (req, res) => {
    const stats = getStats();
    res.json({
      ...stats,
      autopilot: autoPilot ? autoPilot.getStatus() : { isRunning: false },
      config: {
        uploadInterval: config.uploadIntervalMinutes,
        maxUploadsPerDay: config.maxUploadsPerDay,
        autopilotInterval: config.autopilot.intervalMinutes,
        categories: config.autopilot.categories,
      },
    });
  });

  // Recent uploads
  app.get('/api/uploads', (req, res) => {
    const { status, platform, limit } = req.query;
    const uploads = getUploads({
      status: status || undefined,
      platform: platform || undefined,
      limit: parseInt(limit) || 50,
    });
    res.json(uploads);
  });

  // Accounts
  app.get('/api/accounts', (req, res) => {
    const accounts = getAccounts();
    const safe = accounts.map(a => ({
      ...a,
      credentials: a.credentials ? '***' : null,
    }));
    res.json(safe);
  });

  // Logs (real-time)
  app.get('/api/logs', (req, res) => {
    const logs = getLogBuffer();
    const last = parseInt(req.query.last) || 100;
    res.json(logs.slice(-last));
  });

  // Auto-pilot control
  app.post('/api/autopilot/start', (req, res) => {
    if (!autoPilot) {
      autoPilot = new AutoPilot(req.body || {});
    }
    autoPilot.start();
    res.json({ status: 'started' });
  });

  app.post('/api/autopilot/stop', (req, res) => {
    if (autoPilot) autoPilot.stop();
    res.json({ status: 'stopped' });
  });

  app.post('/api/autopilot/pause', (req, res) => {
    if (autoPilot) autoPilot.pause();
    res.json({ status: 'paused' });
  });

  app.post('/api/autopilot/resume', (req, res) => {
    if (autoPilot) autoPilot.resume();
    res.json({ status: 'resumed' });
  });

  // Manual reup
  app.post('/api/reup', async (req, res) => {
    const { url, targets, category, format } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    try {
      if (!autoPilot) autoPilot = new AutoPilot();
      const result = await autoPilot._handleReup({
        url,
        targets: targets || ['youtube', 'facebook'],
        category: category || 'entertainment',
        format: format || 'youtube_shorts',
      });
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Auth status
  app.get('/api/auth/status', async (req, res) => {
    const { AuthManager } = await import('../auth/auth-manager.js');
    const auth = new AuthManager();
    res.json(auth.getStatus());
  });

  // =====================================================
  // Classify & SEO Preview API
  // =====================================================

  // Classify a video from metadata
  app.post('/api/classify', (req, res) => {
    try {
      const { title, description, tags, channelName } = req.body;
      if (!title) return res.status(400).json({ error: 'Title required' });

      const result = classifier.classify({ title, description, tags, channelName });
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Full SEO preview (classify + optimize)
  app.post('/api/seo-preview', (req, res) => {
    try {
      const { title, description, tags, channelName, format, platform } = req.body;
      if (!title) return res.status(400).json({ error: 'Title required' });

      const result = seoOptimizer.optimize(
        { title, description, tags, channelName },
        { format: format || undefined, platform: platform || 'youtube' }
      );
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // =====================================================
  // Account & Rotation Management API
  // =====================================================

  // Get full account overview (accounts + pages + rotation config)
  app.get('/api/accounts/overview', (req, res) => {
    try {
      const overview = accountRotation.getOverview();
      res.json({ success: true, ...overview });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Set rotation config for an account
  app.post('/api/accounts/rotation', (req, res) => {
    try {
      const { accountId, format, weight, dailyLimit, cooldownMinutes, status } = req.body;
      if (!accountId) return res.status(400).json({ error: 'accountId required' });

      accountRotation.setRotation(accountId, format || null, {
        weight, dailyLimit, cooldownMinutes, status,
      });

      res.json({ success: true, message: 'Rotation config saved' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove rotation config
  app.delete('/api/accounts/rotation', (req, res) => {
    try {
      const { accountId, format } = req.body;
      accountRotation.removeRotation(accountId, format || null);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get pages for a Facebook account
  app.get('/api/accounts/pages/:accountId', (req, res) => {
    try {
      const pages = accountRotation.getPages(Number(req.params.accountId));
      res.json({ success: true, pages });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Add a Facebook Page to an account
  app.post('/api/accounts/pages', (req, res) => {
    try {
      const { accountId, pageId, pageName, pageAccessToken, pageCategory } = req.body;
      if (!accountId || !pageId || !pageName) {
        return res.status(400).json({ error: 'accountId, pageId, pageName required' });
      }

      accountRotation.addPage(accountId, pageId, pageName, pageAccessToken, pageCategory);
      res.json({ success: true, message: `Page ${pageName} added` });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove a Facebook Page
  app.delete('/api/accounts/pages', (req, res) => {
    try {
      const { accountId, pageId } = req.body;
      accountRotation.removePage(accountId, pageId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // =====================================================
  // Settings API
  // =====================================================

  // Get all settings (merged: defaults + env + DB overrides)
  app.get('/api/settings', (req, res) => {
    const dbSettings = getAllSettings();
    // Return current running config merged with DB settings
    res.json({
      // YouTube API
      youtube_client_id: dbSettings.youtube_client_id || config.youtube.clientId || '',
      youtube_client_secret: dbSettings.youtube_client_secret ? '••••••••' : (config.youtube.clientSecret ? '••••••••' : ''),
      youtube_redirect_uri: dbSettings.youtube_redirect_uri || config.youtube.redirectUri || '',

      // Facebook API
      facebook_app_id: dbSettings.facebook_app_id || config.facebook.appId || '',
      facebook_app_secret: dbSettings.facebook_app_secret ? '••••••••' : (config.facebook.appSecret ? '••••••••' : ''),
      facebook_page_id: dbSettings.facebook_page_id || config.facebook.pageId || '',
      facebook_page_access_token: dbSettings.facebook_page_access_token ? '••••••••' : (config.facebook.pageAccessToken ? '••••••••' : ''),

      // Rate Limiting
      upload_interval_minutes: Number(dbSettings.upload_interval_minutes) || config.uploadIntervalMinutes,
      max_uploads_per_day: Number(dbSettings.max_uploads_per_day) || config.maxUploadsPerDay,
      download_concurrent: Number(dbSettings.download_concurrent) || config.downloadConcurrent,

      // Download
      max_duration_youtube: Number(dbSettings.max_duration_youtube) || 180,
      max_duration_facebook: Number(dbSettings.max_duration_facebook) || 600,

      // Dashboard
      dashboard_port: Number(dbSettings.dashboard_port) || config.dashboard.port,

      // Auto-Pilot
      autopilot_enabled: dbSettings.autopilot_enabled === 'true' || dbSettings.autopilot_enabled === true || config.autopilot.enabled,
      autopilot_interval_minutes: Number(dbSettings.autopilot_interval_minutes) || config.autopilot.intervalMinutes,
      autopilot_max_videos: Number(dbSettings.autopilot_max_videos) || config.autopilot.maxVideosPerSession,
      autopilot_categories: dbSettings.autopilot_categories || config.autopilot.categories.join(','),
      autopilot_region: dbSettings.autopilot_region || config.autopilot.region,

      // Targets
      target_youtube: dbSettings.target_youtube !== 'false',
      target_facebook: dbSettings.target_facebook !== 'false',

      // Transform Pipeline
      transform_mode: dbSettings.transform_mode || 'auto',
      transform_mirror: dbSettings.transform_mirror !== 'false',
      transform_crop: dbSettings.transform_crop !== 'false',
      transform_color_grade: dbSettings.transform_color_grade !== 'false',
      transform_video_speed: dbSettings.transform_video_speed === 'true',
      transform_pitch_shift: dbSettings.transform_pitch_shift !== 'false',
      transform_audio_speed: dbSettings.transform_audio_speed !== 'false',
      transform_video_speed_factor: Number(dbSettings.transform_video_speed_factor) || 1.05,
      transform_pitch_factor: Number(dbSettings.transform_pitch_factor) || 1.04,
      transform_audio_speed_factor: Number(dbSettings.transform_audio_speed_factor) || 1.03,
      transform_color_saturation: Number(dbSettings.transform_color_saturation) || 1.15,
      transform_color_contrast: Number(dbSettings.transform_color_contrast) || 1.08,
      transform_color_brightness: Number(dbSettings.transform_color_brightness) || 0.03,
    });
  });

  // Save settings to DB
  app.post('/api/settings', (req, res) => {
    try {
      const data = req.body;

      // Don't save masked values
      const toSave = {};
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' && value.includes('••••')) continue; // skip masked secrets
        toSave[key] = value;
      }

      bulkSetSettings(toSave);
      logger.info('Settings updated from dashboard');
      res.json({ success: true, message: 'Settings saved!' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(resolve(__dirname, 'public', 'index.html'));
  });

  // Start server
  app.listen(port, () => {
    logger.info(`📊 Dashboard running at http://localhost:${port}`);
    console.log(`\n📊 Dashboard: http://localhost:${port}\n`);
  });

  return app;
}

export default { startDashboard };
