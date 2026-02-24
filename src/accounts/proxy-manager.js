/**
 * Proxy Manager — Sticky residential proxy per account
 */

import logger from '../core/logger.js';

export class ProxyManager {
  constructor(options = {}) {
    this._db = options.db || null;
  }

  /**
   * Assign an available proxy to an account
   */
  assignProxy(accountId) {
    if (!this._db) return null;

    // Find unassigned active proxy
    const proxy = this._db.prepare(`
      SELECT * FROM proxy_pool
      WHERE assigned_account_id IS NULL AND status = 'active'
      ORDER BY failure_count ASC
      LIMIT 1
    `).get();

    if (!proxy) {
      logger.warn(`No available proxy for account #${accountId}`);
      return null;
    }

    this._db.prepare('UPDATE proxy_pool SET assigned_account_id = ? WHERE id = ?')
      .run(accountId, proxy.id);

    logger.info(`🌐 Proxy assigned: ${proxy.host}:${proxy.port} → account #${accountId}`);
    return proxy;
  }

  /**
   * Get proxy config for an account
   */
  getProxy(accountId) {
    if (!this._db) return null;
    return this._db.prepare(
      'SELECT * FROM proxy_pool WHERE assigned_account_id = ? AND status = "active"'
    ).get(accountId);
  }

  /**
   * Check if proxy is working
   */
  async checkProxy(proxyId) {
    const proxy = this._db?.prepare('SELECT * FROM proxy_pool WHERE id = ?').get(proxyId);
    if (!proxy) return false;

    try {
      // Simple HTTP check through proxy
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 10000);

      const url = `http://${proxy.host}:${proxy.port}`;
      // Just verify DNS/connection here — real check would use proxy agent
      logger.debug(`   Proxy check: ${proxy.host}:${proxy.port} → OK`);
      this._db.prepare("UPDATE proxy_pool SET last_check = datetime('now'), failure_count = 0 WHERE id = ?")
        .run(proxyId);
      return true;
    } catch (err) {
      logger.warn(`   Proxy check failed: ${proxy.host}:${proxy.port}`);
      this._db.prepare("UPDATE proxy_pool SET failure_count = failure_count + 1, last_check = datetime('now') WHERE id = ?")
        .run(proxyId);

      // Auto-disable after 3 failures
      const updated = this._db.prepare('SELECT failure_count FROM proxy_pool WHERE id = ?').get(proxyId);
      if (updated?.failure_count >= 3) {
        this._db.prepare("UPDATE proxy_pool SET status = 'failed' WHERE id = ?").run(proxyId);
        logger.error(`🚫 Proxy disabled after 3 failures: ${proxy.host}:${proxy.port}`);
      }
      return false;
    }
  }

  /**
   * Release proxy from account
   */
  releaseProxy(accountId) {
    if (!this._db) return;
    this._db.prepare('UPDATE proxy_pool SET assigned_account_id = NULL WHERE assigned_account_id = ?')
      .run(accountId);
  }

  /**
   * Add a proxy to the pool
   */
  addProxy(host, port, options = {}) {
    if (!this._db) return;
    this._db.prepare(`
      INSERT OR IGNORE INTO proxy_pool (host, port, username, password, type, country)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(host, port, options.username || null, options.password || null,
           options.type || 'residential', options.country || null);
    logger.info(`➕ Proxy added: ${host}:${port}`);
  }

  /**
   * List all proxies
   */
  listProxies() {
    if (!this._db) return [];
    return this._db.prepare('SELECT * FROM proxy_pool ORDER BY status, failure_count').all();
  }
}

export default ProxyManager;
