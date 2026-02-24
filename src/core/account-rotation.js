import logger from '../core/logger.js';
import { getDb, getAccounts, getSetting, setSetting } from '../core/database.js';

/**
 * Account Rotation Manager
 *
 * Strategies:
 *   - round_robin: Rotate evenly across all accounts
 *   - format_based: Assign specific accounts to specific formats
 *     e.g. YT Acc A = youtube_long, YT Acc B = youtube_shorts
 *   - random: Pick a random active account
 *
 * Features:
 *   - Multiple YT accounts (each can be assigned to shorts/long)
 *   - Multiple FB accounts, each with multiple Pages
 *   - Page rotation within a single FB account
 *   - Cooldown tracking (avoid rate limits)
 */
export class AccountRotation {
  constructor() {
    this._ensureSchema();
    this._rotationState = {};
    this._loadRotationState();
  }

  // ═══════════════════════════════════════════════════════
  // SCHEMA — pages table + rotation config
  // ═══════════════════════════════════════════════════════

  _ensureSchema() {
    const db = getDb();

    // Facebook Pages sub-table (1 account -> many pages)
    db.exec(`
      CREATE TABLE IF NOT EXISTS facebook_pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        page_id TEXT NOT NULL,
        page_name TEXT NOT NULL,
        page_access_token TEXT,
        page_category TEXT,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(account_id, page_id)
      );

      CREATE INDEX IF NOT EXISTS idx_fbpages_account ON facebook_pages(account_id);
    `);

    // Account rotation config
    db.exec(`
      CREATE TABLE IF NOT EXISTS account_rotation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        assigned_format TEXT, -- 'youtube_shorts', 'youtube_long', 'facebook_reels', or NULL (all)
        rotation_group TEXT DEFAULT 'default',
        weight INTEGER DEFAULT 1,
        daily_limit INTEGER DEFAULT 0, -- 0 = unlimited
        uploads_today INTEGER DEFAULT 0,
        last_upload_at DATETIME,
        cooldown_minutes INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'cooldown')),
        UNIQUE(account_id, assigned_format)
      );

      CREATE INDEX IF NOT EXISTS idx_rotation_format ON account_rotation(assigned_format);
    `);

    logger.info('📋 Account rotation schema ready');
  }

  // ═══════════════════════════════════════════════════════
  // ROTATION STATE
  // ═══════════════════════════════════════════════════════

  _loadRotationState() {
    try {
      const saved = getSetting('rotation_state');
      if (saved) this._rotationState = JSON.parse(saved);
    } catch {
      this._rotationState = {};
    }
  }

  _saveRotationState() {
    setSetting('rotation_state', JSON.stringify(this._rotationState));
  }

  // ═══════════════════════════════════════════════════════
  // GET NEXT ACCOUNT — Main rotation logic
  // ═══════════════════════════════════════════════════════

  /**
   * Get the next account to use for a given platform + format
   * @param {string} platform - 'youtube' | 'facebook'
   * @param {string} format - 'youtube_shorts' | 'youtube_long' | 'facebook_reels'
   * @param {string} strategy - 'round_robin' | 'format_based' | 'random'
   * @returns {{ account, page? }} - The account (and optionally FB page) to use
   */
  getNextAccount(platform, format, strategy = 'format_based') {
    const accounts = getAccounts(platform);
    if (accounts.length === 0) return null;

    // If only 1 account, use it
    if (accounts.length === 1) {
      const account = accounts[0];
      const page = platform === 'facebook' ? this._getNextPage(account.id) : null;
      return { account, page };
    }

    let selected;

    switch (strategy) {
      case 'format_based':
        selected = this._selectByFormat(accounts, format);
        break;
      case 'round_robin':
        selected = this._selectRoundRobin(accounts, platform);
        break;
      case 'random':
        selected = accounts[Math.floor(Math.random() * accounts.length)];
        break;
      default:
        selected = accounts[0];
    }

    // For Facebook, also rotate pages
    const page = platform === 'facebook' ? this._getNextPage(selected.id) : null;

    // Track usage
    this._trackUsage(selected.id, format);

    return { account: selected, page };
  }

  /**
   * Format-based selection:
   * Look up account_rotation table for accounts assigned to this format
   */
  _selectByFormat(accounts, format) {
    const db = getDb();

    // Find accounts assigned to this format
    const assigned = db.prepare(`
      SELECT ar.*, a.name FROM account_rotation ar
      JOIN accounts a ON ar.account_id = a.id
      WHERE ar.assigned_format = ? AND ar.status = 'active' AND a.status = 'active'
      ORDER BY ar.last_upload_at ASC NULLS FIRST
    `).all(format);

    if (assigned.length > 0) {
      // Pick the one that uploaded least recently
      const pick = assigned[0];
      const account = accounts.find(a => a.id === pick.account_id);
      if (account) {
        logger.info(`🔄 Format-based: ${account.name} → ${format}`);
        return account;
      }
    }

    // Fallback: check accounts assigned to NULL (any format)
    const anyFormat = db.prepare(`
      SELECT ar.*, a.name FROM account_rotation ar
      JOIN accounts a ON ar.account_id = a.id
      WHERE ar.assigned_format IS NULL AND ar.status = 'active' AND a.status = 'active'
      ORDER BY ar.last_upload_at ASC NULLS FIRST
    `).all();

    if (anyFormat.length > 0) {
      const pick = anyFormat[0];
      const account = accounts.find(a => a.id === pick.account_id);
      if (account) return account;
    }

    // Fallback: round robin
    return this._selectRoundRobin(accounts, format);
  }

  /**
   * Round-robin selection
   */
  _selectRoundRobin(accounts, key) {
    const stateKey = `rr_${key}`;
    const lastIndex = this._rotationState[stateKey] || 0;
    const nextIndex = (lastIndex + 1) % accounts.length;

    this._rotationState[stateKey] = nextIndex;
    this._saveRotationState();

    const selected = accounts[nextIndex];
    logger.info(`🔄 Round-robin [${nextIndex + 1}/${accounts.length}]: ${selected.name}`);
    return selected;
  }

  // ═══════════════════════════════════════════════════════
  // PAGE ROTATION — For Facebook
  // ═══════════════════════════════════════════════════════

  /**
   * Get the next Facebook Page to use for an account (round-robin)
   */
  _getNextPage(accountId) {
    const pages = this.getPages(accountId);
    if (pages.length === 0) return null;
    if (pages.length === 1) return pages[0];

    const stateKey = `page_${accountId}`;
    const lastIndex = this._rotationState[stateKey] || 0;
    const nextIndex = (lastIndex + 1) % pages.length;

    this._rotationState[stateKey] = nextIndex;
    this._saveRotationState();

    const page = pages[nextIndex];
    logger.info(`📄 Page rotation [${nextIndex + 1}/${pages.length}]: ${page.page_name}`);
    return page;
  }

  // ═══════════════════════════════════════════════════════
  // PAGE CRUD
  // ═══════════════════════════════════════════════════════

  getPages(accountId) {
    return getDb().prepare(
      'SELECT * FROM facebook_pages WHERE account_id = ? AND status = ? ORDER BY page_name'
    ).all(accountId, 'active');
  }

  getAllPages() {
    return getDb().prepare(`
      SELECT fp.*, a.name as account_name FROM facebook_pages fp
      JOIN accounts a ON fp.account_id = a.id
      WHERE fp.status = 'active'
      ORDER BY a.name, fp.page_name
    `).all();
  }

  addPage(accountId, pageId, pageName, pageAccessToken = null, pageCategory = null) {
    return getDb().prepare(`
      INSERT OR REPLACE INTO facebook_pages (account_id, page_id, page_name, page_access_token, page_category)
      VALUES (?, ?, ?, ?, ?)
    `).run(accountId, pageId, pageName, pageAccessToken, pageCategory);
  }

  removePage(accountId, pageId) {
    return getDb().prepare(
      'UPDATE facebook_pages SET status = ? WHERE account_id = ? AND page_id = ?'
    ).run('inactive', accountId, pageId);
  }

  // ═══════════════════════════════════════════════════════
  // ROTATION CONFIG CRUD
  // ═══════════════════════════════════════════════════════

  getRotationConfig() {
    return getDb().prepare(`
      SELECT ar.*, a.name as account_name, a.platform 
      FROM account_rotation ar
      JOIN accounts a ON ar.account_id = a.id
      WHERE a.status = 'active'
      ORDER BY a.platform, ar.assigned_format
    `).all();
  }

  setRotation(accountId, format, options = {}) {
    const db = getDb();
    const existing = db.prepare(
      'SELECT id FROM account_rotation WHERE account_id = ? AND assigned_format IS ?'
    ).get(accountId, format || null);

    if (existing) {
      const updates = [];
      const values = [];
      if (options.weight !== undefined) { updates.push('weight = ?'); values.push(options.weight); }
      if (options.dailyLimit !== undefined) { updates.push('daily_limit = ?'); values.push(options.dailyLimit); }
      if (options.cooldownMinutes !== undefined) { updates.push('cooldown_minutes = ?'); values.push(options.cooldownMinutes); }
      if (options.status !== undefined) { updates.push('status = ?'); values.push(options.status); }
      if (updates.length > 0) {
        values.push(existing.id);
        db.prepare(`UPDATE account_rotation SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }
    } else {
      db.prepare(`
        INSERT INTO account_rotation (account_id, assigned_format, weight, daily_limit, cooldown_minutes)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        accountId,
        format || null,
        options.weight || 1,
        options.dailyLimit || 0,
        options.cooldownMinutes || 0
      );
    }
  }

  removeRotation(accountId, format) {
    getDb().prepare(
      'DELETE FROM account_rotation WHERE account_id = ? AND assigned_format IS ?'
    ).run(accountId, format || null);
  }

  // ═══════════════════════════════════════════════════════
  // USAGE TRACKING
  // ═══════════════════════════════════════════════════════

  _trackUsage(accountId, format) {
    const db = getDb();
    const row = db.prepare(
      'SELECT id FROM account_rotation WHERE account_id = ? AND (assigned_format = ? OR assigned_format IS NULL)'
    ).get(accountId, format);

    if (row) {
      db.prepare(`
        UPDATE account_rotation SET 
          uploads_today = uploads_today + 1,
          last_upload_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(row.id);
    }
  }

  /**
   * Reset daily upload counters (call at midnight or start of day)
   */
  resetDailyCounters() {
    getDb().prepare('UPDATE account_rotation SET uploads_today = 0').run();
    logger.info('🔄 Daily upload counters reset');
  }

  // ═══════════════════════════════════════════════════════
  // STATUS / OVERVIEW
  // ═══════════════════════════════════════════════════════

  getOverview() {
    const accounts = getAccounts();
    const pages = this.getAllPages();
    const rotations = this.getRotationConfig();

    return {
      accounts: accounts.map(a => ({
        id: a.id,
        platform: a.platform,
        name: a.name,
        authType: a.auth_type,
        channelId: a.channel_id,
        pageId: a.page_id,
        status: a.status,
        pages: pages.filter(p => p.account_id === a.id),
        rotations: rotations.filter(r => r.account_id === a.id),
      })),
      totalYouTube: accounts.filter(a => a.platform === 'youtube').length,
      totalFacebook: accounts.filter(a => a.platform === 'facebook').length,
      totalPages: pages.length,
    };
  }
}

// Singleton
let instance;
export function getAccountRotation() {
  if (!instance) instance = new AccountRotation();
  return instance;
}

export default AccountRotation;
