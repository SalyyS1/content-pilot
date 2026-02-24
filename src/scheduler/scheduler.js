import config from '../core/config.js';
import logger from '../core/logger.js';
import {
  addJob, getNextJob, updateJob, getStats,
  addUpload, getUploads, updateUpload, getAccounts,
  getVideo,
} from '../core/database.js';
import { UploadStrategy } from '../core/upload-strategy.js';

// === NEW: Phase 5 modules ===
import { AccountHealth } from './account-health.js';
import { BehaviorSimulator } from './behavior-simulator.js';

/**
 * Scheduler (Upgraded with Anti-Ban)
 * 
 * New features:
 * - AccountHealth: health-based scheduling (pause low-health accounts)
 * - BehaviorSimulator: human-like jitter and session simulation
 * - Per-account upload phase tracking
 */
export class Scheduler {
  constructor(options = {}) {
    this.isRunning = false;
    this.isPaused = false;
    this._timer = null;
    this._handlers = {};
    this.currentJob = null;
    this.uploadStrategy = new UploadStrategy();

    // NEW: Anti-ban modules
    this.accountHealth = new AccountHealth({ db: options.db || null });
    this.behaviorSimulator = new BehaviorSimulator();
  }

  registerHandler(type, handler) {
    this._handlers[type] = handler;
  }

  enqueue(type, payload, priority = 0) {
    const result = addJob(type, payload, priority);
    logger.info(`Job enqueued: ${type} (id: ${result.lastInsertRowid})`);
    return result.lastInsertRowid;
  }

  start() {
    if (this.isRunning) {
      logger.warn('Scheduler already running');
      return;
    }

    this.isRunning = true;
    this.isPaused = false;
    logger.info('Scheduler started (Anti-Ban enabled)');
    logger.info(`📊 Upload Strategy: Phase "${this.uploadStrategy.getCurrentPhase().name}" (Channel age: ${this.uploadStrategy.getChannelAgeDays()} days)`);
    this._processNext();
  }

  stop() {
    this.isRunning = false;
    if (this._timer) clearTimeout(this._timer);
    logger.info('Scheduler stopped');
  }

  pause() {
    this.isPaused = true;
    logger.info('Scheduler paused');
  }

  resume() {
    this.isPaused = false;
    logger.info('Scheduler resumed');
    this._processNext();
  }

  getStatus() {
    const stats = getStats();
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      currentJob: this.currentJob,
      uploadStrategy: this.uploadStrategy.getScheduleOverview(),
      antiBan: {
        behaviorSimulator: 'active',
        healthEngine: 'active',
      },
      ...stats,
    };
  }

  // Process next job in queue with smart timing + anti-ban
  async _processNext() {
    if (!this.isRunning || this.isPaused) return;

    // Check global rate limits
    const stats = getStats();
    if (stats.todayUploads >= config.maxUploadsPerDay) {
      logger.warn(`Daily upload limit reached (${config.maxUploadsPerDay}). Waiting until tomorrow.`);
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const delay = tomorrow - now;
      this._timer = setTimeout(() => this._processNext(), delay);
      return;
    }

    const job = getNextJob();
    if (!job) {
      this._timer = setTimeout(() => this._processNext(), 10000);
      return;
    }

    const handler = this._handlers[job.type];
    if (!handler) {
      logger.error(`No handler for job type: ${job.type}`);
      updateJob(job.id, { status: 'failed', error_message: 'No handler registered' });
      this._processNext();
      return;
    }

    // === SMART TIMING CHECK for upload jobs ===
    if (job.type === 'upload') {
      try {
        const payload = JSON.parse(job.payload);
        const format = payload.format || payload.niche || 'youtube_shorts';

        // NEW: Check account health before uploading
        if (payload.accountId) {
          const healthCheck = this.accountHealth.shouldPause(payload.accountId);
          if (healthCheck.pause) {
            logger.warn(`🚫 Account #${payload.accountId} paused: ${healthCheck.reason} (score: ${healthCheck.score})`);
            // Delay job and try another
            updateJob(job.id, { status: 'pending' });
            this._timer = setTimeout(() => this._processNext(), healthCheck.duration * 3600 * 1000);
            return;
          }

          // NEW: Check account phase limits
          const phase = this.accountHealth.getPhase(payload.accountId);
          logger.debug(`   Account #${payload.accountId} phase: ${phase.name} (max ${phase.uploadsPerDay}/day)`);
        }

        // NEW: Human-time check
        if (!this.behaviorSimulator.isHumanLikeTime(config.timezone || 'UTC')) {
          const waitMs = this.behaviorSimulator.humanUploadDelay(60); // Wait ~1h
          logger.info(`🌙 Not human hours — delaying ${Math.round(waitMs / 60000)} min`);
          this._timer = setTimeout(() => this._processNext(), waitMs);
          return;
        }

        const timingCheck = this.uploadStrategy.canUploadNow(format);

        if (!timingCheck.canUpload) {
          const waitMs = Math.max(timingCheck.waitMinutes * 60 * 1000, 60000);
          logger.info(`⏳ Smart Timing: ${timingCheck.reason}`);
          logger.info(`   Delaying job #${job.id} for ${timingCheck.waitMinutes} minutes`);
          this._timer = setTimeout(() => this._processNext(), waitMs);
          return;
        }

        if (!timingCheck.recommended) {
          logger.warn(`⚠️ ${timingCheck.reason}`);
          logger.info(`   Uploading anyway, but engagement may be lower`);
        } else {
          logger.info(`🟢 ${timingCheck.reason}`);
        }
      } catch (e) {
        logger.debug(`Could not check timing: ${e.message}`);
      }
    }

    // Execute job
    this.currentJob = job;
    updateJob(job.id, { status: 'running', started_at: new Date().toISOString() });
    logger.info(`Processing job #${job.id}: ${job.type}`);

    try {
      const payload = JSON.parse(job.payload);
      const result = await handler(payload);

      updateJob(job.id, {
        status: 'completed',
        result: JSON.stringify(result || {}),
        completed_at: new Date().toISOString(),
      });
      logger.info(`Job #${job.id} completed`);

      // Record upload in strategy tracker
      if (job.type === 'upload') {
        const format = payload.format || payload.niche || 'youtube_shorts';
        const platform = payload.platform || 'youtube';
        this.uploadStrategy.recordUpload(format, platform);

        // NEW: Record activity for health tracking
        if (payload.accountId) {
          this.accountHealth.recordActivity(payload.accountId);
        }
      }
    } catch (error) {
      const retryCount = job.retry_count + 1;
      if (retryCount < job.max_retries) {
        logger.warn(`Job #${job.id} failed (attempt ${retryCount}/${job.max_retries}): ${error.message}`);
        updateJob(job.id, {
          status: 'pending',
          retry_count: retryCount,
          error_message: error.message,
        });
      } else {
        logger.error(`Job #${job.id} permanently failed: ${error.message}`);
        updateJob(job.id, {
          status: 'failed',
          retry_count: retryCount,
          error_message: error.message,
          completed_at: new Date().toISOString(),
        });
      }
    }

    this.currentJob = null;

    // Smart delay with behavior jitter
    const phase = this.uploadStrategy.getCurrentPhase();
    const smartDelayMs = phase.minSpacingHours * 60 * 60 * 1000;
    const baseDelayMs = config.uploadIntervalMinutes * 60 * 1000;
    const rawDelayMs = Math.max(smartDelayMs, baseDelayMs);

    // NEW: Add human-like jitter (±15-45 min)
    const delayMs = this.behaviorSimulator.addJitter(rawDelayMs);

    logger.debug(`Next job in ${Math.round(delayMs / 60000)} minutes (Phase: ${phase.name}, +jitter)`);
    this._timer = setTimeout(() => this._processNext(), delayMs);
  }
}

export default Scheduler;
