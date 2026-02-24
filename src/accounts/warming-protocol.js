/**
 * Warming Protocol — 21-day automated account warming
 * 
 * Day 1-3:   Watch only (5-10 videos)
 * Day 4-7:   Engage (subscribe 3-5, like 10-15, comment 2-3)
 * Day 8-14:  Light engagement + 1 upload every 2 days
 * Day 15-21: Normal engagement + 1 upload daily
 * Day 22+:   Normal operations
 */

import logger from '../core/logger.js';

const WARMING_SCHEDULE = [
  // Day 1-3: Watch-only phase
  { dayRange: [1, 3], actions: [{ type: 'watch', count: [5, 10] }], uploads: 0 },
  // Day 4-7: Engagement phase
  { dayRange: [4, 7], actions: [
    { type: 'subscribe', count: [3, 5] },
    { type: 'like', count: [10, 15] },
    { type: 'comment', count: [2, 3] },
  ], uploads: 0 },
  // Day 8-14: Light uploads
  { dayRange: [8, 14], actions: [
    { type: 'like', count: [5, 10] },
    { type: 'comment', count: [1, 2] },
  ], uploads: 1, interval: 'every_2_days' },
  // Day 15-21: Daily uploads
  { dayRange: [15, 21], actions: [
    { type: 'like', count: [3, 5] },
  ], uploads: 1, interval: 'daily' },
];

export class WarmingProtocol {
  constructor(options = {}) {
    this._db = options.db || null;
  }

  /**
   * Get the warming schedule for today
   */
  getSchedule(daysActive) {
    for (const phase of WARMING_SCHEDULE) {
      if (daysActive >= phase.dayRange[0] && daysActive <= phase.dayRange[1]) {
        return {
          day: daysActive,
          phase: `Day ${phase.dayRange[0]}-${phase.dayRange[1]}`,
          actions: phase.actions.map(a => ({
            type: a.type,
            count: a.count[0] + Math.floor(Math.random() * (a.count[1] - a.count[0] + 1)),
          })),
          uploads: phase.uploads,
          interval: phase.interval || 'none',
          isWarmingComplete: false,
        };
      }
    }

    // Day 22+: Warming complete
    return {
      day: daysActive,
      phase: 'Normal Operations',
      actions: [],
      uploads: null, // No limit from warming
      interval: null,
      isWarmingComplete: true,
    };
  }

  /**
   * Log warming action to DB
   */
  logAction(accountId, dayNumber, action, targetUrl = null, status = 'completed') {
    if (!this._db) return;
    try {
      this._db.prepare(`
        INSERT INTO warming_log (account_id, day_number, action, target_url, status, completed_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(accountId, dayNumber, action, targetUrl, status);
    } catch {}
  }

  /**
   * Get warming progress for an account
   */
  getProgress(accountId) {
    if (!this._db) return { completed: 0, total: 21 };
    try {
      const days = this._db.prepare(`
        SELECT DISTINCT day_number FROM warming_log
        WHERE account_id = ? AND status = 'completed'
        ORDER BY day_number
      `).all(accountId);

      return {
        completedDays: days.length,
        totalDays: 21,
        lastDay: days[days.length - 1]?.day_number || 0,
        isComplete: days.length >= 21,
        percent: Math.round((days.length / 21) * 100),
      };
    } catch {
      return { completedDays: 0, totalDays: 21, percent: 0 };
    }
  }
}

export default WarmingProtocol;
