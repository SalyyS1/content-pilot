/**
 * Account Pool — Multi-account management
 * 
 * Add/remove/list accounts with niche, language, platform, timezone
 * Health-based weighted round-robin for upload distribution
 */

import logger from '../core/logger.js';
import { encrypt, decrypt } from '../core/credential-encryption.js';

export class AccountPool {
  constructor(options = {}) {
    this._db = options.db || null;
    this._healthEngine = options.healthEngine || null;
  }

  /**
   * Add a new account to the pool
   */
  addAccount(platform, name, credentials, options = {}) {
    if (!this._db) throw new Error('Database not initialized');

    const encryptedCreds = encrypt(JSON.stringify(credentials));

    const result = this._db.prepare(`
      INSERT INTO accounts (platform, name, credentials, niche, language, timezone, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(
      platform,
      name,
      encryptedCreds,
      options.niche || 'general',
      options.language || 'en',
      options.timezone || 'UTC'
    );

    const accountId = result.lastInsertRowid;

    // Init health for new account
    if (this._healthEngine) {
      this._healthEngine._initAccount(accountId);
    }

    logger.info(`➕ Account added: ${name} (${platform}) → #${accountId}`);
    return accountId;
  }

  /**
   * Remove an account (soft delete)
   */
  removeAccount(accountId) {
    if (!this._db) return;
    this._db.prepare("UPDATE accounts SET status = 'inactive' WHERE id = ?").run(accountId);
    logger.info(`➖ Account #${accountId} deactivated`);
  }

  /**
   * List accounts with optional filters
   */
  listAccounts(filters = {}) {
    if (!this._db) return [];

    let query = "SELECT id, platform, name, niche, language, timezone, status FROM accounts WHERE 1=1";
    const params = [];

    if (filters.platform) { query += " AND platform = ?"; params.push(filters.platform); }
    if (filters.status) { query += " AND status = ?"; params.push(filters.status); }
    if (filters.niche) { query += " AND niche = ?"; params.push(filters.niche); }

    const accounts = this._db.prepare(query).all(...params);

    // Add health scores
    if (this._healthEngine) {
      return accounts.map(a => ({
        ...a,
        healthScore: this._healthEngine.calculate(a.id),
        phase: this._healthEngine.getPhase(a.id),
        shouldPause: this._healthEngine.shouldPause(a.id),
      }));
    }

    return accounts;
  }

  /**
   * Get the best account for uploading (health-based weighted selection)
   */
  getAccountForUpload(platform, format) {
    const accounts = this.listAccounts({ platform, status: 'active' });

    if (accounts.length === 0) return null;

    // Filter out paused accounts
    const eligible = accounts.filter(a => !a.shouldPause?.pause);
    if (eligible.length === 0) {
      logger.warn(`All ${platform} accounts paused or in cooldown`);
      return null;
    }

    // Weighted random selection based on health score
    const totalWeight = eligible.reduce((sum, a) => sum + Math.pow((a.healthScore || 50) / 100, 2), 0);
    let random = Math.random() * totalWeight;

    for (const account of eligible) {
      const weight = Math.pow((account.healthScore || 50) / 100, 2);
      random -= weight;
      if (random <= 0) {
        return account;
      }
    }

    return eligible[0]; // Fallback
  }

  /**
   * Get decrypted credentials for an account
   */
  getCredentials(accountId) {
    if (!this._db) return null;
    const row = this._db.prepare('SELECT credentials FROM accounts WHERE id = ?').get(accountId);
    if (!row) return null;

    try {
      return JSON.parse(decrypt(row.credentials));
    } catch (err) {
      logger.error(`Failed to decrypt credentials for account #${accountId}: ${err.message}`);
      return null;
    }
  }
}

export default AccountPool;
