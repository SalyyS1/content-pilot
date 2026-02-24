/**
 * Upload Strategy — Anti-suppression algorithm for YouTube Shorts
 * 
 * Goal: Maximize views & reach monetization threshold (1000 subs + 10M Shorts views)
 * 
 * YouTube Shorts Algorithm Rules (reverse-engineered best practices):
 * 1. Upload spacing: Min 3-4 hours between uploads to avoid "spam" flag
 * 2. Daily limit: 3-5 per day for new channels, up to 8 for established
 * 3. Peak hours: Post when target audience is most active
 * 4. Consistency: Same time slots daily builds audience expectation
 * 5. Warm-up: New channels should start slow and ramp up
 * 6. Avoid dead hours: Never post 2AM-6AM target timezone
 * 7. First hour engagement: Title + thumbnail crucial in first 30 min
 * 8. No batch dumps: Spreading uploads throughout the day is KEY
 */

import logger from '../core/logger.js';

// ============================================
// Peak Hours by Target Audience
// ============================================
const PEAK_HOURS = {
  // YouTube Shorts — EN audience (US Eastern timezone, UTC-5)
  youtube_shorts: {
    timezone: 'America/New_York',
    utcOffset: -5,
    // Score 0-100 for each hour (0 = worst, 100 = best)
    hourlyScore: [
      // 0AM  1AM  2AM  3AM  4AM  5AM  6AM  7AM  8AM  9AM  10AM 11AM
         15,  5,   2,   2,   5,   10,  25,  45,  60,  70,  80,  85,
      // 12PM 1PM  2PM  3PM  4PM  5PM  6PM  7PM  8PM  9PM  10PM 11PM
         90,  85,  80,  75,  80,  90,  95,  100, 95,  85,  60,  35,
    ],
    // Best time slots (local time) — staggered throughout the day
    bestSlots: [
      { hour: 8,  minute: 0,  label: 'Morning Commute' },
      { hour: 12, minute: 0,  label: 'Lunch Break' },
      { hour: 17, minute: 30, label: 'After Work' },
      { hour: 19, minute: 0,  label: 'Prime Time' },
      { hour: 21, minute: 0,  label: 'Late Evening' },
    ],
    deadHoursUtc: [7, 8, 9, 10], // 2AM-5AM EST = 7-10 UTC
  },

  // YouTube Long — VN audience (UTC+7)
  youtube_long: {
    timezone: 'Asia/Ho_Chi_Minh',
    utcOffset: 7,
    hourlyScore: [
      // 0AM  1AM  2AM  3AM  4AM  5AM  6AM  7AM  8AM  9AM  10AM 11AM
         30,  15,  5,   2,   2,   5,   15,  30,  45,  55,  60,  65,
      // 12PM 1PM  2PM  3PM  4PM  5PM  6PM  7PM  8PM  9PM  10PM 11PM
         70,  65,  55,  50,  55,  65,  75,  90,  100, 95,  70,  45,
    ],
    bestSlots: [
      { hour: 11, minute: 30, label: 'Trưa' },
      { hour: 19, minute: 0,  label: 'Tối' },
      { hour: 21, minute: 0,  label: 'Đêm khuya' },
    ],
    deadHoursUtc: [19, 20, 21, 22, 23], // 2AM-6AM VN = 19-23 UTC
  },

  // Facebook Reels — VN audience (UTC+7)
  facebook_reels: {
    timezone: 'Asia/Ho_Chi_Minh',
    utcOffset: 7,
    hourlyScore: [
      // 0AM  1AM  2AM  3AM  4AM  5AM  6AM  7AM  8AM  9AM  10AM 11AM
         25,  10,  5,   2,   2,   10,  25,  40,  55,  65,  75,  80,
      // 12PM 1PM  2PM  3PM  4PM  5PM  6PM  7PM  8PM  9PM  10PM 11PM
         85,  80,  70,  65,  70,  80,  90,  100, 95,  85,  55,  35,
    ],
    bestSlots: [
      { hour: 7,  minute: 30, label: 'Sáng sớm' },
      { hour: 11, minute: 30, label: 'Giờ trưa' },
      { hour: 18, minute: 0,  label: 'Tan làm' },
      { hour: 20, minute: 0,  label: 'Buổi tối' },
    ],
    deadHoursUtc: [19, 20, 21, 22, 23], // 2AM-6AM VN
  },
};

// ============================================
// Channel Warm-up Phases
// ============================================
const WARMUP_PHASES = [
  // Phase 1: New channel (0-7 days) — slow start
  {
    name: 'Khởi động',
    maxDays: 7,
    uploadsPerDay: { youtube_shorts: 2, youtube_long: 1, facebook_reels: 3 },
    minSpacingHours: 6,    // 6 hours between uploads
    description: 'Mới bắt đầu — đăng ít để YouTube "làm quen" với kênh',
  },
  // Phase 2: Building (8-21 days) — moderate
  {
    name: 'Xây dựng',
    maxDays: 21,
    uploadsPerDay: { youtube_shorts: 3, youtube_long: 1, facebook_reels: 5 },
    minSpacingHours: 4,    // 4 hours between uploads
    description: 'Tăng dần tần suất — YouTube bắt đầu push nhiều hơn',
  },
  // Phase 3: Growth (22-60 days) — full speed
  {
    name: 'Tăng trưởng',
    maxDays: 60,
    uploadsPerDay: { youtube_shorts: 5, youtube_long: 2, facebook_reels: 8 },
    minSpacingHours: 3,    // 3 hours between uploads
    description: 'Tốc độ cao — kênh đã được YouTube tin tưởng',
  },
  // Phase 4: Established (60+ days) — max output
  {
    name: 'Ổn định',
    maxDays: Infinity,
    uploadsPerDay: { youtube_shorts: 8, youtube_long: 3, facebook_reels: 10 },
    minSpacingHours: 2,    // 2 hours minimum
    description: 'Kênh đã vững — đăng tối đa mà không bị bóp',
  },
];

// ============================================
// Upload Strategy Engine
// ============================================
export class UploadStrategy {
  constructor(options = {}) {
    this.channelStartDate = options.startDate || new Date();
    this.uploadHistory = []; // Track { format, timestamp, platform }
    this.dailyCounters = {}; // { 'YYYY-MM-DD': { youtube_shorts: N, ... } }
  }

  /**
   * Get channel age in days
   */
  getChannelAgeDays() {
    const now = new Date();
    const diffMs = now - new Date(this.channelStartDate);
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Get current warm-up phase
   */
  getCurrentPhase() {
    const ageDays = this.getChannelAgeDays();
    let cumDays = 0;
    for (const phase of WARMUP_PHASES) {
      cumDays += phase.maxDays;
      if (ageDays < cumDays) return phase;
    }
    return WARMUP_PHASES[WARMUP_PHASES.length - 1];
  }

  /**
   * Check if we can upload right now for a given format
   * Returns { canUpload, reason, nextSlot, waitMinutes }
   */
  canUploadNow(format) {
    const now = new Date();
    const phase = this.getCurrentPhase();
    const peakConfig = PEAK_HOURS[format] || PEAK_HOURS.youtube_shorts;

    // 1. Check dead hours — NEVER upload during dead hours
    const currentUtcHour = now.getUTCHours();
    if (peakConfig.deadHoursUtc.includes(currentUtcHour)) {
      const nextAliveHour = this._getNextAliveHour(peakConfig);
      return {
        canUpload: false,
        reason: `⏳ Dead hour (${this._utcToLocal(currentUtcHour, peakConfig.utcOffset)}:00 local) — audience sleeping`,
        nextSlot: nextAliveHour,
        waitMinutes: this._minutesUntilUtcHour(nextAliveHour),
      };
    }

    // 2. Check daily limit
    const todayKey = now.toISOString().split('T')[0];
    const todayCount = (this.dailyCounters[todayKey] || {})[format] || 0;
    const maxToday = phase.uploadsPerDay[format] || 3;

    if (todayCount >= maxToday) {
      return {
        canUpload: false,
        reason: `🚫 Daily limit reached (${todayCount}/${maxToday}) — Phase: ${phase.name}`,
        nextSlot: null,
        waitMinutes: this._minutesUntilMidnight(),
      };
    }

    // 3. Check spacing from last upload of same format
    const lastUpload = this._getLastUpload(format);
    if (lastUpload) {
      const elapsedMs = now - new Date(lastUpload.timestamp);
      const elapsedHours = elapsedMs / (1000 * 60 * 60);
      const requiredSpacing = phase.minSpacingHours;

      if (elapsedHours < requiredSpacing) {
        const waitMin = Math.ceil((requiredSpacing - elapsedHours) * 60);
        return {
          canUpload: false,
          reason: `⏰ Too soon! Last upload ${Math.floor(elapsedHours * 60)}min ago — need ${requiredSpacing}h spacing`,
          nextSlot: null,
          waitMinutes: waitMin,
        };
      }
    }

    // 4. Check hourly quality score — warn if poor timing
    const localHour = this._utcToLocal(currentUtcHour, peakConfig.utcOffset);
    const hourScore = peakConfig.hourlyScore[localHour] || 50;

    if (hourScore < 30) {
      // Very low score — suggest waiting
      const bestSlot = this._getNextBestSlot(peakConfig);
      return {
        canUpload: true, // CAN upload but not recommended
        reason: `⚠️ Low engagement hour (score: ${hourScore}/100) — better to wait for ${bestSlot.label}`,
        nextSlot: bestSlot,
        waitMinutes: 0,
        hourScore,
        recommended: false,
      };
    }

    return {
      canUpload: true,
      reason: `✅ Good to post! Hour score: ${hourScore}/100 | Phase: ${phase.name} (${todayCount}/${maxToday} today)`,
      hourScore,
      recommended: true,
      phase: phase.name,
      dailyProgress: `${todayCount + 1}/${maxToday}`,
    };
  }

  /**
   * Get the optimal next upload time for a format
   * Returns a scheduled Date object
   */
  getNextOptimalTime(format) {
    const now = new Date();
    const phase = this.getCurrentPhase();
    const peakConfig = PEAK_HOURS[format] || PEAK_HOURS.youtube_shorts;

    // Check if can upload now
    const check = this.canUploadNow(format);
    if (check.canUpload && check.recommended) {
      return { scheduledAt: now, ...check };
    }

    // Find next best slot
    const bestSlot = this._getNextBestSlot(peakConfig);
    const scheduledDate = this._nextSlotDate(bestSlot, peakConfig.utcOffset);

    // Add some randomness (±15 min) to avoid pattern detection
    const jitterMs = (Math.random() * 30 - 15) * 60 * 1000;
    scheduledDate.setTime(scheduledDate.getTime() + jitterMs);

    return {
      scheduledAt: scheduledDate,
      reason: check.reason,
      slot: bestSlot,
      phase: phase.name,
    };
  }

  /**
   * Record an upload (call this after successful upload)
   */
  recordUpload(format, platform) {
    const now = new Date();
    const todayKey = now.toISOString().split('T')[0];

    this.uploadHistory.push({
      format,
      platform,
      timestamp: now.toISOString(),
    });

    // Update daily counter
    if (!this.dailyCounters[todayKey]) {
      this.dailyCounters[todayKey] = {};
    }
    this.dailyCounters[todayKey][format] = (this.dailyCounters[todayKey][format] || 0) + 1;

    // Keep only last 7 days of history
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    this.uploadHistory = this.uploadHistory.filter(u => u.timestamp > sevenDaysAgo);

    logger.info(`📊 Upload recorded: ${format} | Today: ${this.dailyCounters[todayKey][format]}/${this.getCurrentPhase().uploadsPerDay[format] || '?'}`);
  }

  /**
   * Get upload schedule overview for dashboard
   */
  getScheduleOverview() {
    const phase = this.getCurrentPhase();
    const ageDays = this.getChannelAgeDays();
    const todayKey = new Date().toISOString().split('T')[0];
    const todayCounts = this.dailyCounters[todayKey] || {};

    const formats = ['youtube_shorts', 'youtube_long', 'facebook_reels'];
    const schedules = formats.map(format => {
      const check = this.canUploadNow(format);
      const nextTime = this.getNextOptimalTime(format);
      const peakConfig = PEAK_HOURS[format];
      const localHour = this._utcToLocal(new Date().getUTCHours(), peakConfig.utcOffset);

      return {
        format,
        canUploadNow: check.canUpload && check.recommended,
        status: check.reason,
        hourScore: peakConfig.hourlyScore[localHour],
        todayUploaded: todayCounts[format] || 0,
        todayLimit: phase.uploadsPerDay[format] || 0,
        nextOptimalTime: nextTime.scheduledAt,
        nextSlotLabel: nextTime.slot?.label || 'Now',
      };
    });

    return {
      channelAgeDays: ageDays,
      currentPhase: phase.name,
      phaseDescription: phase.description,
      minSpacingHours: phase.minSpacingHours,
      schedules,
      warmupPhases: WARMUP_PHASES.map(p => ({
        name: p.name,
        maxDays: p.maxDays,
        limits: p.uploadsPerDay,
        spacing: p.minSpacingHours,
        active: p.name === phase.name,
      })),
    };
  }

  // === Private Helpers ===

  _getLastUpload(format) {
    const matching = this.uploadHistory
      .filter(u => u.format === format)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return matching[0] || null;
  }

  _utcToLocal(utcHour, offset) {
    return ((utcHour + offset) % 24 + 24) % 24;
  }

  _localToUtc(localHour, offset) {
    return ((localHour - offset) % 24 + 24) % 24;
  }

  _getNextAliveHour(peakConfig) {
    const now = new Date();
    let hour = now.getUTCHours();
    for (let i = 1; i <= 24; i++) {
      const testHour = (hour + i) % 24;
      if (!peakConfig.deadHoursUtc.includes(testHour)) {
        return testHour;
      }
    }
    return (hour + 1) % 24;
  }

  _getNextBestSlot(peakConfig) {
    const now = new Date();
    const currentUtcHour = now.getUTCHours();
    const currentLocalHour = this._utcToLocal(currentUtcHour, peakConfig.utcOffset);

    // Find next slot that hasn't passed yet today
    for (const slot of peakConfig.bestSlots) {
      if (slot.hour > currentLocalHour) {
        return slot;
      }
    }
    // All slots passed today — return first slot tomorrow
    return peakConfig.bestSlots[0];
  }

  _nextSlotDate(slot, utcOffset) {
    const now = new Date();
    const targetUtcHour = this._localToUtc(slot.hour, utcOffset);
    
    const target = new Date(now);
    target.setUTCHours(targetUtcHour, slot.minute, 0, 0);

    // If time already passed today, schedule for tomorrow
    if (target <= now) {
      target.setDate(target.getDate() + 1);
    }

    return target;
  }

  _minutesUntilUtcHour(targetHour) {
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(targetHour, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return Math.ceil((target - now) / 60000);
  }

  _minutesUntilMidnight() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    return Math.ceil((midnight - now) / 60000);
  }
}

export default UploadStrategy;
