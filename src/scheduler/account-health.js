/**
 * Account Health — Health score engine for anti-ban system
 * 
 * Score 0-100 based on positive/negative signals.
 * Auto-pause at <40, danger alert at <20.
 */

import logger from '../core/logger.js';

export class AccountHealth {
  constructor(options = {}) {
    this._db = options.db || null;
  }

  /**
   * Calculate health score for an account
   */
  calculate(accountId) {
    const data = this._getData(accountId);
    if (!data) return 50; // Default for new accounts

    let score = 0;

    // Positive signals
    score += data.profile_complete ? 20 : 0;
    score += Math.min(data.days_active || 0, 30); // +1/day, cap 30
    score += Math.min((data.total_engagements || 0) * 0.5, 20); // +0.5/engagement, cap 20
    score += 5; // Consistent schedule bonus (simplified)

    // Negative signals
    score -= (data.strikes || 0) * 25;
    score -= (data.warnings || 0) * 10;
    if (data.shadow_ban_suspected) score -= 15;
    if (data.last_ctr !== null && data.last_ctr < 0.005) score -= 10; // CTR < 0.5%

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Check if account should be paused
   */
  shouldPause(accountId) {
    const score = this.calculate(accountId);

    if (score < 20) {
      return { pause: true, reason: '🚨 DANGER: Health critically low', duration: 72, score };
    }
    if (score < 40) {
      return { pause: true, reason: '⚠️ Health below threshold', duration: 48, score };
    }

    // Check cooldown
    const data = this._getData(accountId);
    if (data?.cooldown_until) {
      const cooldownEnd = new Date(data.cooldown_until);
      if (cooldownEnd > new Date()) {
        const hoursLeft = Math.ceil((cooldownEnd - new Date()) / 3600000);
        return { pause: true, reason: `🕐 Cooldown active (${hoursLeft}h left)`, duration: hoursLeft, score };
      }
    }

    return { pause: false, score };
  }

  /**
   * Detect shadow ban signals
   * Compares last 48h view velocity vs 7-day average
   */
  async checkShadowBan(accountId) {
    const data = this._getData(accountId);
    if (!data) return { suspected: false };

    // Simplified: check if last_view_velocity dropped >60% from average
    const lastVelocity = data.last_view_velocity || 0;
    // Would need historical data - for now flag if velocity is very low
    const suspected = lastVelocity > 0 && lastVelocity < 1; // Less than 1 view/hour

    if (suspected && !data.shadow_ban_suspected) {
      this._update(accountId, { shadow_ban_suspected: 1 });
      logger.warn(`🚫 Shadow ban suspected for account #${accountId}`);
    }

    return { suspected, velocity: lastVelocity };
  }

  /**
   * Get account's current phase based on days active
   */
  getPhase(accountId) {
    const data = this._getData(accountId);
    const daysActive = data?.days_active || 0;

    if (daysActive <= 14) return { name: 'warming', uploadsPerDay: 1, minSpacing: 24 };
    if (daysActive <= 28) return { name: 'ramp_up', uploadsPerDay: 2, minSpacing: 8 };
    if (daysActive <= 56) return { name: 'growth', uploadsPerDay: 4, minSpacing: 4 };
    return { name: 'established', uploadsPerDay: 6, minSpacing: 3 };
  }

  /**
   * Record a new day of activity
   */
  recordActivity(accountId) {
    const data = this._getData(accountId);
    if (data) {
      this._update(accountId, {
        days_active: (data.days_active || 0) + 1,
        last_health_check: new Date().toISOString(),
      });
    }
  }

  /**
   * Set cooldown for an account
   */
  setCooldown(accountId, hours) {
    const until = new Date(Date.now() + hours * 3600000).toISOString();
    this._update(accountId, { cooldown_until: until });
    logger.info(`⏸ Account #${accountId} cooldown set: ${hours}h`);
  }

  // === DB helpers ===
  _getData(accountId) {
    if (!this._db) return null;
    try {
      return this._db.prepare('SELECT * FROM account_health WHERE account_id = ?').get(accountId);
    } catch { return null; }
  }

  _update(accountId, fields) {
    if (!this._db) return;
    const sets = Object.entries(fields).map(([k, v]) => `${k} = ?`).join(', ');
    const values = Object.values(fields);
    try {
      this._db.prepare(`UPDATE account_health SET ${sets}, updated_at = datetime('now') WHERE account_id = ?`)
        .run(...values, accountId);
    } catch {}
  }

  _initAccount(accountId) {
    if (!this._db) return;
    try {
      this._db.prepare(`
        INSERT OR IGNORE INTO account_health (account_id, health_score, phase)
        VALUES (?, 50, 'warming')
      `).run(accountId);
    } catch {}
  }
}

export default AccountHealth;
