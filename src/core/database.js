import Database from 'better-sqlite3';
import config from './config.js';
import { resolve } from 'path';
import logger from './logger.js';

const DB_PATH = resolve(config.dataDir, 'reup.db');

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
    logger.info(`Database initialized at ${DB_PATH}`);
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- Accounts (YouTube / Facebook)
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL CHECK(platform IN ('youtube', 'facebook', 'tiktok')),
      name TEXT NOT NULL,
      auth_type TEXT NOT NULL CHECK(auth_type IN ('api', 'cookie', 'browser')),
      credentials TEXT, -- JSON: tokens, cookies, etc (encrypted in production)
      page_id TEXT,      -- Facebook Page ID
      channel_id TEXT,   -- YouTube Channel ID
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'expired')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Source videos (downloaded)
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT NOT NULL UNIQUE,
      source_platform TEXT DEFAULT 'youtube',
      title TEXT,
      description TEXT,
      tags TEXT,           -- JSON array
      duration INTEGER,    -- seconds
      file_path TEXT,
      thumbnail_path TEXT,
      metadata TEXT,       -- JSON: views, likes, channel info
      status TEXT DEFAULT 'downloaded' CHECK(status IN ('pending', 'downloading', 'downloaded', 'processing', 'ready', 'failed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Upload history
    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES videos(id),
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      platform TEXT NOT NULL CHECK(platform IN ('youtube', 'facebook')),
      target_url TEXT,      -- URL of uploaded video
      title TEXT,
      description TEXT,
      hashtags TEXT,        -- JSON array
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'uploading', 'published', 'failed', 'retry')),
      retry_count INTEGER DEFAULT 0,
      error_message TEXT,
      scheduled_at DATETIME,
      uploaded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Jobs queue
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('download', 'upload', 'reup', 'trending')),
      payload TEXT NOT NULL, -- JSON
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
      priority INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      error_message TEXT,
      result TEXT,          -- JSON
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Settings key-value store
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
    CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);
    CREATE INDEX IF NOT EXISTS idx_uploads_video ON uploads(video_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
  `);
}

// === CRUD Helpers ===

export function addAccount(platform, name, authType, credentials, extra = {}) {
  const stmt = getDb().prepare(`
    INSERT INTO accounts (platform, name, auth_type, credentials, page_id, channel_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(platform, name, authType, JSON.stringify(credentials), extra.pageId || null, extra.channelId || null);
}

export function getAccounts(platform = null) {
  if (platform) {
    return getDb().prepare('SELECT * FROM accounts WHERE platform = ? AND status = ?').all(platform, 'active');
  }
  return getDb().prepare('SELECT * FROM accounts WHERE status = ?').all('active');
}

export function getAccount(id) {
  return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

export function deleteAccount(id) {
  getDb().prepare("UPDATE accounts SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
}

export function getAllAccountsWithStats() {
  return getDb().prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM uploads WHERE account_id = a.id) as total_uploads,
      (SELECT COUNT(*) FROM uploads WHERE account_id = a.id AND uploaded_at >= date('now')) as today_uploads
    FROM accounts WHERE a.status != 'inactive'
    ORDER BY a.created_at DESC
  `).all();
}

export function updateAccountCredentials(id, credentials) {
  getDb().prepare('UPDATE accounts SET credentials = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(credentials), id);
}

export function addVideo(sourceUrl, metadata = {}) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO videos (source_url, source_platform, title, description, tags, duration, file_path, thumbnail_path, metadata, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    sourceUrl,
    metadata.platform || 'youtube',
    metadata.title || null,
    metadata.description || null,
    JSON.stringify(metadata.tags || []),
    metadata.duration || null,
    metadata.filePath || null,
    metadata.thumbnailPath || null,
    JSON.stringify(metadata.extra || {}),
    metadata.status || 'pending'
  );
}

export function getVideo(id) {
  return getDb().prepare('SELECT * FROM videos WHERE id = ?').get(id);
}

export function getVideoByUrl(url) {
  return getDb().prepare('SELECT * FROM videos WHERE source_url = ?').get(url);
}

export function updateVideo(id, updates) {
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  getDb().prepare(`UPDATE videos SET ${fields} WHERE id = ?`).run(...values, id);
}

export function addUpload(videoId, accountId, platform, metadata = {}) {
  const stmt = getDb().prepare(`
    INSERT INTO uploads (video_id, account_id, platform, title, description, hashtags, scheduled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    videoId, accountId, platform,
    metadata.title || null,
    metadata.description || null,
    JSON.stringify(metadata.hashtags || []),
    metadata.scheduledAt || null
  );
}

export function getUploads(filters = {}) {
  let query = 'SELECT u.*, v.source_url, v.file_path, a.name as account_name FROM uploads u JOIN videos v ON u.video_id = v.id JOIN accounts a ON u.account_id = a.id';
  const conditions = [];
  const params = [];

  if (filters.status) { conditions.push('u.status = ?'); params.push(filters.status); }
  if (filters.platform) { conditions.push('u.platform = ?'); params.push(filters.platform); }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY u.created_at DESC';
  if (filters.limit) { query += ' LIMIT ?'; params.push(filters.limit); }

  return getDb().prepare(query).all(...params);
}

export function updateUpload(id, updates) {
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  getDb().prepare(`UPDATE uploads SET ${fields} WHERE id = ?`).run(...values, id);
}

export function addJob(type, payload, priority = 0) {
  const stmt = getDb().prepare(`
    INSERT INTO jobs (type, payload, priority) VALUES (?, ?, ?)
  `);
  return stmt.run(type, JSON.stringify(payload), priority);
}

export function getNextJob() {
  return getDb().prepare(`
    SELECT * FROM jobs WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 1
  `).get();
}

export function updateJob(id, updates) {
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  getDb().prepare(`UPDATE jobs SET ${fields} WHERE id = ?`).run(...values, id);
}

export function getStats() {
  const d = getDb();
  return {
    totalVideos: d.prepare('SELECT COUNT(*) as c FROM videos').get().c,
    totalUploads: d.prepare('SELECT COUNT(*) as c FROM uploads').get().c,
    pendingUploads: d.prepare("SELECT COUNT(*) as c FROM uploads WHERE status = 'pending'").get().c,
    publishedUploads: d.prepare("SELECT COUNT(*) as c FROM uploads WHERE status = 'published'").get().c,
    failedUploads: d.prepare("SELECT COUNT(*) as c FROM uploads WHERE status = 'failed'").get().c,
    todayUploads: d.prepare("SELECT COUNT(*) as c FROM uploads WHERE uploaded_at >= date('now')").get().c,
    activeJobs: d.prepare("SELECT COUNT(*) as c FROM jobs WHERE status IN ('pending', 'running')").get().c,
    accounts: d.prepare("SELECT COUNT(*) as c FROM accounts WHERE status = 'active'").get().c,
  };
}

export function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  getDb().prepare(`
    INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
  `).run(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
}

export function getAllSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
  }
  return settings;
}

export function bulkSetSettings(settingsObj) {
  const stmt = getDb().prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  const tx = getDb().transaction((entries) => {
    for (const [key, value] of entries) {
      stmt.run(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  });
  tx(Object.entries(settingsObj));
}

export default {
  getDb, addAccount, getAccount, getAccounts, getAllAccountsWithStats,
  deleteAccount, updateAccountCredentials,
  addVideo, getVideo, getVideoByUrl, updateVideo,
  addUpload, getUploads, updateUpload,
  addJob, getNextJob, updateJob,
  getStats, getSetting, setSetting, getAllSettings, bulkSetSettings,
};
