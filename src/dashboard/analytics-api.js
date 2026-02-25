/**
 * Analytics API — Data aggregation for the dashboard
 * 
 * Provides health scores, calendar heatmap, A/B test results,
 * revenue estimates, and overview metrics.
 */

import logger from '../core/logger.js';
import { getDb } from '../core/database.js';

// CPM rates by niche (estimated, in USD)
const CPM_RATES = {
  gaming: 4, comedy: 3, music: 2, tech: 6,
  beauty: 5, education: 8, pets: 3.5, food: 3,
  fitness: 5, travel: 4, entertainment: 2.5,
  general: 2.5,
};

export class AnalyticsAPI {
  constructor(options = {}) {
    // db now loaded via getDb() — no injection needed
  }

  /**
   * Get all accounts with health scores
   */
  getAccountsHealth() {
    if (!getDb()) return [];
    try {
      return getDb().prepare(`
        SELECT a.id, a.name, a.platform, a.niche, a.status,
               h.health_score, h.phase, h.days_active, h.shadow_ban_suspected,
               h.cooldown_until, h.last_health_check,
               (SELECT COUNT(*) FROM uploads WHERE account_id = a.id AND date(created_at) = date('now')) as today_uploads,
               (SELECT MAX(created_at) FROM uploads WHERE account_id = a.id) as last_upload
        FROM accounts a
        LEFT JOIN account_health h ON a.id = h.account_id
        WHERE a.status = 'active'
        ORDER BY h.health_score DESC
      `).all();
    } catch {
      return [];
    }
  }

  /**
   * Get metrics for a specific account
   */
  getAccountMetrics(accountId, days = 7) {
    if (!getDb()) return {};
    try {
      const uploads = getDb().prepare(`
        SELECT date(created_at) as day, COUNT(*) as count, platform
        FROM uploads
        WHERE account_id = ? AND created_at > datetime('now', '-${days} days')
        GROUP BY day, platform
        ORDER BY day
      `).all(accountId);

      const totalUploads = uploads.reduce((s, u) => s + u.count, 0);

      return {
        accountId,
        period: `${days}d`,
        totalUploads,
        dailyAvg: (totalUploads / days).toFixed(1),
        uploads,
      };
    } catch {
      return { accountId, totalUploads: 0 };
    }
  }

  /**
   * Get upload calendar heatmap data
   */
  getCalendarData(year, month) {
    if (!getDb()) return [];
    try {
      const y = year || new Date().getFullYear();
      const m = month || new Date().getMonth() + 1;
      const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
      const endDate = `${y}-${String(m).padStart(2, '0')}-31`;

      return getDb().prepare(`
        SELECT date(created_at) as date, COUNT(*) as count,
               SUM(CASE WHEN platform = 'youtube' THEN 1 ELSE 0 END) as youtube,
               SUM(CASE WHEN platform = 'facebook' THEN 1 ELSE 0 END) as facebook
        FROM uploads
        WHERE date(created_at) BETWEEN ? AND ?
        GROUP BY date(created_at)
        ORDER BY date
      `).all(startDate, endDate);
    } catch {
      return [];
    }
  }

  /**
   * Get A/B test results — compare variations of the same source video
   */
  getABTestResults(limit = 10) {
    if (!getDb()) return [];
    try {
      return getDb().prepare(`
        SELECT u.id, u.title, u.platform, u.created_at,
               v.variation_hash, v.params
        FROM uploads u
        LEFT JOIN video_variations v ON u.video_id = v.video_id
        WHERE v.variation_hash IS NOT NULL
        ORDER BY u.created_at DESC
        LIMIT ?
      `).all(limit);
    } catch {
      return [];
    }
  }

  /**
   * Get revenue estimate based on views and niche CPM
   */
  getRevenueEstimate(days = 30) {
    if (!getDb()) return { total: 0, currency: 'USD' };
    try {
      const data = getDb().prepare(`
        SELECT a.niche, SUM(u.views) as total_views
        FROM uploads u
        JOIN accounts a ON u.account_id = a.id
        WHERE u.created_at > datetime('now', '-${days} days')
        GROUP BY a.niche
      `).all();

      let total = 0;
      const breakdown = data.map(d => {
        const cpm = CPM_RATES[d.niche?.toLowerCase()] || CPM_RATES.general;
        const revenue = (d.total_views || 0) * cpm / 1000;
        total += revenue;
        return { niche: d.niche, views: d.total_views, cpm, revenue: revenue.toFixed(2) };
      });

      return { total: total.toFixed(2), currency: 'USD', period: `${days}d`, breakdown };
    } catch {
      return { total: '0.00', currency: 'USD' };
    }
  }

  /**
   * Get overview — aggregate metrics
   */
  getOverview() {
    if (!getDb()) return {};
    try {
      const stats = getDb().prepare(`
        SELECT
          (SELECT COUNT(*) FROM accounts WHERE status = 'active') as active_accounts,
          (SELECT COUNT(*) FROM accounts) as total_accounts,
          (SELECT COUNT(*) FROM uploads WHERE date(created_at) = date('now')) as today_uploads,
          (SELECT COUNT(*) FROM uploads WHERE created_at > datetime('now', '-7 days')) as week_uploads,
          (SELECT COUNT(*) FROM uploads WHERE created_at > datetime('now', '-30 days')) as month_uploads
      `).get();

      return stats || {};
    } catch {
      return {};
    }
  }

  /**
   * Get scheduler queue status
   */
  getQueueStatus() {
    if (!getDb()) return [];
    try {
      return getDb().prepare(`
        SELECT id, type, status, priority, scheduled_at, started_at
        FROM jobs
        WHERE status IN ('pending', 'processing')
        ORDER BY priority DESC, scheduled_at ASC
        LIMIT 20
      `).all();
    } catch {
      return [];
    }
  }
}

export default AnalyticsAPI;
