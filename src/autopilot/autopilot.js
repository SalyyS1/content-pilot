import config from '../core/config.js';
import logger from '../core/logger.js';
import {
  addUpload, addVideo, getVideoByUrl, getVideo, getAccounts, getStats,
} from '../core/database.js';
import { YouTubeDownloader } from '../downloader/youtube-downloader.js';
import { YouTubeUploader } from '../uploader/youtube-uploader.js';
import { FacebookUploader } from '../uploader/facebook-uploader.js';
import { ContentProcessor } from '../processor/content-processor.js';
import { Scheduler } from '../scheduler/scheduler.js';
import { Transformer } from '../core/transformer.js';
import { SEOOptimizer } from '../core/seo-optimizer.js';
import { getAccountRotation } from '../core/account-rotation.js';
import { getNicheConfig, getAllNiches } from '../core/niche-config.js';

/**
 * Auto-Pilot Engine
 * Continuously finds trending videos → downloads → processes → uploads
 * Runs on a configurable interval
 */
export class AutoPilot {
  constructor(options = {}) {
    this.isRunning = false;
    this._timer = null;
    this._intervalMs = (options.intervalMinutes || config.autopilot.intervalMinutes) * 60 * 1000;
    this._maxPerSession = options.maxVideos || config.autopilot.maxVideosPerSession;
    this._categories = options.categories || config.autopilot.categories;
    this._targets = options.targets || ['youtube', 'facebook']; // Where to reup
    this._currentCategoryIndex = 0;

    this.downloader = new YouTubeDownloader();
    this.ytUploader = new YouTubeUploader();
    this.fbUploader = new FacebookUploader();
    this.processor = new ContentProcessor();
    this.seoOptimizer = new SEOOptimizer();
    this.transformer = new Transformer();
    this.scheduler = new Scheduler();
    this.accountRotation = getAccountRotation();

    this.stats = {
      sessionsRun: 0,
      totalDownloaded: 0,
      totalUploaded: 0,
      totalFailed: 0,
      startedAt: null,
      lastRunAt: null,
    };

    // Register job handlers
    this.scheduler.registerHandler('download', this._handleDownload.bind(this));
    this.scheduler.registerHandler('upload', this._handleUpload.bind(this));
    this.scheduler.registerHandler('reup', this._handleReup.bind(this));
    this.scheduler.registerHandler('trending', this._handleTrending.bind(this));
  }

  /**
   * Start auto-pilot mode
   */
  start() {
    if (this.isRunning) {
      logger.warn('Auto-pilot already running');
      return;
    }

    this.isRunning = true;
    this.stats.startedAt = new Date().toISOString();
    this.scheduler.start();

    logger.info('🚀 Auto-Pilot STARTED');
    logger.info(`  Interval: ${config.autopilot.intervalMinutes} min`);
    logger.info(`  Categories: ${this._categories.join(', ')}`);
    logger.info(`  Targets: ${this._targets.join(', ')}`);
    logger.info(`  Max per session: ${this._maxPerSession}`);

    // Run first cycle immediately
    this._runCycle();
  }

  /**
   * Stop auto-pilot
   */
  stop() {
    this.isRunning = false;
    this.scheduler.stop();
    if (this._timer) clearTimeout(this._timer);
    logger.info('⏹️ Auto-Pilot STOPPED');
  }

  /**
   * Pause auto-pilot
   */
  pause() {
    this.scheduler.pause();
    if (this._timer) clearTimeout(this._timer);
    logger.info('⏸️ Auto-Pilot PAUSED');
  }

  /**
   * Resume auto-pilot
   */
  resume() {
    this.scheduler.resume();
    this._scheduleNext();
    logger.info('▶️ Auto-Pilot RESUMED');
  }

  /**
   * Get auto-pilot status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isPaused: this.scheduler.isPaused,
      ...this.stats,
      scheduler: this.scheduler.getStatus(),
      nextCategory: this._categories[this._currentCategoryIndex],
    };
  }

  // =====================================================
  // Core Cycle
  // =====================================================

  async _runCycle() {
    if (!this.isRunning) return;

    this.stats.sessionsRun++;
    const cycleIndex = this.stats.sessionsRun;

    logger.info(`\n========================================`);
    logger.info(`🔄 Auto-Pilot Cycle #${cycleIndex}`);
    logger.info(`========================================`);

    try {
      // Run niche-based scanning for each target format
      const formatCycles = [
        { target: 'youtube', format: 'youtube_shorts' },
        { target: 'youtube', format: 'youtube_long' },
        { target: 'facebook', format: 'facebook_reels' },
      ];

      for (const { target, format } of formatCycles) {
        if (!this._targets.includes(target)) continue;

        const niche = getNicheConfig(format);
        logger.info(`\n🎯 Scanning: ${niche.name} (${format})`);

        // Step 1: Download videos by niche
        const videos = await this.downloader.downloadByNiche(format, cycleIndex, {
          limit: Math.min(2, this._maxPerSession),
        });

        this.stats.totalDownloaded += videos.length;
        logger.info(`Downloaded ${videos.length} ${niche.name} videos`);

        // Step 2: Transform + Upload each video
        for (const video of videos) {
          let uploadPath = video.filePath;
          try {
            const tfResult = await this.transformer.process(video.filePath);
            uploadPath = tfResult.outputPath;
            if (!tfResult.skipped) {
              logger.info(`🔒 Transformed: ${tfResult.transforms.join(', ')}`);
            }
          } catch (tfError) {
            logger.warn(`⚠️ Transform failed, using original: ${tfError.message}`);
          }

          // Step 3: Account rotation + SEO + Queue upload
          const rotated = this.accountRotation.getNextAccount(target, format);
          if (!rotated) {
            logger.warn(`No ${target} account configured for ${format}, skipping`);
            continue;
          }
          const { account, page } = rotated;

          // Use niche-specific SEO
          const optimized = this.seoOptimizer.optimize(
            { ...video, ...video.metadata, tags: video.metadata?.tags },
            {
              format,
              platform: target,
              customCategory: niche.name,
              language: niche.language,
              nicheKeywords: niche.seoKeywords,
              nicheHashtags: niche.seoHashtags,
            }
          );

          logger.info(`🏷️ ${target} [${account.name}${page ? ' → ' + page.page_name : ''}]: ${niche.name} | ${format} (${niche.language}) | SEO: ${optimized.seoScore}/100`);

          const uploadResult = addUpload(video.id, account.id, target, {
            title: optimized.title,
            description: optimized.description,
            hashtags: optimized.hashtags,
          });

          this.scheduler.enqueue('upload', {
            uploadId: uploadResult.lastInsertRowid,
            videoId: video.id,
            filePath: uploadPath,
            platform: target,
            format,
            niche: format,
            title: optimized.title,
            description: optimized.description,
            hashtags: optimized.hashtags,
            tags: optimized.tags,
          });
        }
      }

      this.stats.lastRunAt = new Date().toISOString();

    } catch (error) {
      logger.error(`Auto-pilot cycle failed: ${error.message}`);
      this.stats.totalFailed++;
    }

    // Schedule next cycle
    this._scheduleNext();
  }

  _scheduleNext() {
    if (!this.isRunning) return;
    logger.info(`⏰ Next cycle in ${config.autopilot.intervalMinutes} minutes`);
    this._timer = setTimeout(() => this._runCycle(), this._intervalMs);
  }

  // =====================================================
  // Job Handlers
  // =====================================================

  async _handleDownload(payload) {
    const { url, force } = payload;
    return await this.downloader.download(url, { force });
  }

  async _handleUpload(payload) {
    const { uploadId, filePath, platform, title, description, hashtags, tags } = payload;

    if (platform === 'youtube') {
      return await this.ytUploader.upload(filePath, {
        title, description, hashtags, tags,
      }, uploadId);
    } else if (platform === 'facebook') {
      return await this.fbUploader.upload(filePath, {
        title, description, hashtags,
      }, uploadId);
    }

    throw new Error(`Unknown platform: ${platform}`);
  }

  async _handleReup(payload) {
    const { url, targets, category, format: reupFormat } = payload;

    // Step 1: Download
    const video = await this.downloader.download(url);

    // Step 2: Transform (copyright avoidance)
    let uploadPath = video.filePath;
    try {
      const tfResult = await this.transformer.process(video.filePath);
      uploadPath = tfResult.outputPath;
      if (!tfResult.skipped) {
        logger.info(`🔒 Applied: ${tfResult.transforms.join(', ')} | Risk: ${tfResult.analysis?.riskLevel}`);
      }
    } catch (tfError) {
      logger.warn(`⚠️ Transform failed, using original: ${tfError.message}`);
    }

    // Step 3: Upload to each target
    const results = [];
    for (const target of (targets || this._targets)) {
      // Determine format for this target
      const format = reupFormat
        ? (target === 'facebook' ? 'facebook_reels' : reupFormat)
        : (target === 'facebook' ? 'facebook_reels' : 'youtube_shorts');

      // Use rotation manager to pick account
      const rotated = this.accountRotation.getNextAccount(target, format);
      if (!rotated) continue;
      const { account, page } = rotated;

      const optimized = this.seoOptimizer.optimize(video, {
        format,
        platform: target,
        customCategory: category || undefined,
      });

      logger.info(`📈 ${target} [${account.name}${page ? ' → ' + page.page_name : ''}]: ${optimized.genre} | ${format} (${optimized.language}) | SEO: ${optimized.seoScore}/100`);

      const uploadResult = addUpload(video.id, account.id, target, {
        title: optimized.title,
        description: optimized.description,
        hashtags: optimized.hashtags,
      });

      // Upload directly (not queued)
      if (target === 'youtube') {
        const result = await this.ytUploader.upload(uploadPath, optimized, uploadResult.lastInsertRowid);
        results.push(result);
      } else {
        const result = await this.fbUploader.upload(uploadPath, optimized, uploadResult.lastInsertRowid);
        results.push(result);
      }
    }

    this.stats.totalUploaded += results.filter(r => r.success).length;
    return results;
  }

  async _handleTrending(payload) {
    return await this.downloader.downloadTrending(payload);
  }
}

export default AutoPilot;
