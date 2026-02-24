import config from '../core/config.js';
import logger from '../core/logger.js';
import {
  addJob, getNextJob, updateJob, getStats,
  addUpload, getUploads, updateUpload, getAccounts,
  getVideo,
} from '../core/database.js';
import { UploadStrategy } from '../core/upload-strategy.js';

/**
 * Scheduler - manages job queue, rate limiting, and smart upload timing
 * 
 * Anti-suppression features:
 * - Peak hour scheduling per timezone
 * - Dead hour blocking
 * - Upload spacing (min 2-6h between uploads)
 * - Daily limits with warm-up phases
 * - Jitter to avoid pattern detection
 */
export class Scheduler {
  constructor() {
    this.isRunning = false;
    this.isPaused = false;
    this._timer = null;
    this._handlers = {};
    this.currentJob = null;
    this.uploadStrategy = new UploadStrategy();
  }

  /**
   * Register a job handler
   */
  registerHandler(type, handler) {
    this._handlers[type] = handler;
  }

  /**
   * Add a job to the queue
   */
  enqueue(type, payload, priority = 0) {
    const result = addJob(type, payload, priority);
    logger.info(`Job enqueued: ${type} (id: ${result.lastInsertRowid})`);
    return result.lastInsertRowid;
  }

  /**
   * Start processing jobs
   */
  start() {
    if (this.isRunning) {
      logger.warn('Scheduler already running');
      return;
    }

    this.isRunning = true;
    this.isPaused = false;
    logger.info('Scheduler started');
    logger.info(`📊 Upload Strategy: Phase "${this.uploadStrategy.getCurrentPhase().name}" (Channel age: ${this.uploadStrategy.getChannelAgeDays()} days)`);
    this._processNext();
  }

  /**
   * Stop processing
   */
  stop() {
    this.isRunning = false;
    if (this._timer) clearTimeout(this._timer);
    logger.info('Scheduler stopped');
  }

  /**
   * Pause processing (finish current, don't start new)
   */
  pause() {
    this.isPaused = true;
    logger.info('Scheduler paused');
  }

  /**
   * Resume processing
   */
  resume() {
    this.isPaused = false;
    logger.info('Scheduler resumed');
    this._processNext();
  }

  /**
   * Get scheduler status (includes upload strategy info)
   */
  getStatus() {
    const stats = getStats();
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      currentJob: this.currentJob,
      uploadStrategy: this.uploadStrategy.getScheduleOverview(),
      ...stats,
    };
  }

  // Process next job in queue with smart timing
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
        const timingCheck = this.uploadStrategy.canUploadNow(format);

        if (!timingCheck.canUpload) {
          // Can't upload now — delay this job
          const waitMs = Math.max(timingCheck.waitMinutes * 60 * 1000, 60000); // min 1 minute
          logger.info(`⏳ Smart Timing: ${timingCheck.reason}`);
          logger.info(`   Delaying job #${job.id} for ${timingCheck.waitMinutes} minutes`);

          // Put job back and wait
          this._timer = setTimeout(() => this._processNext(), waitMs);
          return;
        }

        // Can upload but timing is poor — log warning
        if (!timingCheck.recommended) {
          logger.warn(`⚠️ ${timingCheck.reason}`);
          logger.info(`   Uploading anyway, but engagement may be lower`);
        } else {
          logger.info(`🟢 ${timingCheck.reason}`);
        }
      } catch (e) {
        // If payload parse fails, proceed anyway
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

    // Smart delay: use upload strategy spacing instead of flat interval
    const phase = this.uploadStrategy.getCurrentPhase();
    const smartDelayMs = phase.minSpacingHours * 60 * 60 * 1000;
    const baseDelayMs = config.uploadIntervalMinutes * 60 * 1000;
    const delayMs = Math.max(smartDelayMs, baseDelayMs);

    logger.debug(`Next job in ${Math.round(delayMs / 60000)} minutes (Phase: ${phase.name}, spacing: ${phase.minSpacingHours}h)`);
    this._timer = setTimeout(() => this._processNext(), delayMs);
  }
}

export default Scheduler;
