/**
 * Session Manager — Playwright browser context isolation per account
 * 
 * Each account gets its own browser context with unique:
 * - Proxy (from ProxyManager)
 * - User agent, viewport, locale, timezone
 * - Storage state (cookies/localStorage) persisted per account
 */

import { resolve, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import logger from '../core/logger.js';

const SESSIONS_DIR = resolve(process.cwd(), 'data', 'sessions');

// Browser fingerprint profiles (randomized per account)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
];

export class SessionManager {
  constructor(options = {}) {
    this._proxyManager = options.proxyManager || null;
    this._profiles = new Map(); // accountId -> fingerprint profile

    if (!existsSync(SESSIONS_DIR)) {
      mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }

  /**
   * Get a Playwright browser context for an account
   */
  async getContext(browser, accountId, account = {}) {
    const proxy = this._proxyManager?.getProxy(accountId);
    const profile = this._getFingerprint(accountId, account);
    const storagePath = join(SESSIONS_DIR, `${accountId}.json`);

    const contextOptions = {
      userAgent: profile.userAgent,
      viewport: profile.viewport,
      locale: profile.locale,
      timezoneId: profile.timezone,
    };

    // Proxy config
    if (proxy) {
      contextOptions.proxy = {
        server: `http://${proxy.host}:${proxy.port}`,
      };
      if (proxy.username) {
        contextOptions.proxy.username = proxy.username;
        contextOptions.proxy.password = proxy.password;
      }
    }

    // Restore session state if exists
    if (existsSync(storagePath)) {
      contextOptions.storageState = storagePath;
    }

    const context = await browser.newContext(contextOptions);
    logger.info(`🌐 Session created for account #${accountId} (${profile.userAgent.slice(-20)})`);

    return context;
  }

  /**
   * Save session state after use
   */
  async saveSession(accountId, context) {
    const storagePath = join(SESSIONS_DIR, `${accountId}.json`);
    try {
      await context.storageState({ path: storagePath });
      logger.debug(`   💾 Session saved for account #${accountId}`);
    } catch (err) {
      logger.warn(`   Failed to save session: ${err.message}`);
    }
  }

  /**
   * Get or create a consistent fingerprint for an account
   */
  _getFingerprint(accountId, account = {}) {
    if (this._profiles.has(accountId)) {
      return this._profiles.get(accountId);
    }

    // Deterministic random based on accountId
    const seed = accountId * 7919; // Prime multiplier for spread
    const profile = {
      userAgent: USER_AGENTS[seed % USER_AGENTS.length],
      viewport: VIEWPORTS[seed % VIEWPORTS.length],
      locale: account.language === 'vi' ? 'vi-VN' : 'en-US',
      timezone: account.timezone || (account.language === 'vi' ? 'Asia/Ho_Chi_Minh' : 'America/New_York'),
    };

    this._profiles.set(accountId, profile);
    return profile;
  }

  /**
   * Clear session data for an account
   */
  clearSession(accountId) {
    const storagePath = join(SESSIONS_DIR, `${accountId}.json`);
    try {
      if (existsSync(storagePath)) {
        const { unlinkSync } = require('fs');
        unlinkSync(storagePath);
        logger.info(`🗑 Session cleared for account #${accountId}`);
      }
    } catch {}
    this._profiles.delete(accountId);
  }
}

export default SessionManager;
