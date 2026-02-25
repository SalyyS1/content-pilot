import config from '../core/config.js';
import logger from '../core/logger.js';
import {
  addUpload, addVideo, getVideoByUrl, getVideo, getAccounts, getStats,
} from '../core/database.js';
import { YouTubeDownloader } from '../downloader/youtube-downloader.js';
import { YouTubeUploader } from '../uploader/youtube-uploader.js';
import { FacebookUploader } from '../uploader/facebook-uploader.js';
import { Scheduler } from '../scheduler/scheduler.js';
import { getAccountRotation } from '../core/account-rotation.js';
import { getNicheConfig, getAllNiches } from '../core/niche-config.js';

// === NEW: Phase 1-4 modules ===
import { VideoTransformer } from '../processor/video-transformer.js';
import { VariationEngine } from '../processor/variation-engine.js';
import { SEOEngine } from '../seo/seo-engine.js';
import { AIIntegration } from '../seo/ai-integration.js';

/**
 * Auto-Pilot Engine (Upgraded)
 * 
 * Now uses:
 * - VideoTransformer: 5-stage FFmpeg pipeline (replaces old Transformer + ContentProcessor)
 * - VariationEngine: Unique fingerprints per upload
 * - SEOEngine: AI-powered SEO (replaces old SEOOptimizer)
 * - AIIntegration: ChatGPT + Gemini via browser auth
 */
export class AutoPilot {
  constructor(options = {}) {
    this.isRunning = false;
    this._timer = null;
    this._intervalMs = (options.intervalMinutes || config.autopilot.intervalMinutes) * 60 * 1000;
    this._maxPerSession = options.maxVideos || config.autopilot.maxVideosPerSession;
    this._categories = options.categories || config.autopilot.categories;
    this._targets = options.targets || ['youtube', 'facebook'];
    this._currentCategoryIndex = 0;

    this.downloader = new YouTubeDownloader();
    this.ytUploader = new YouTubeUploader();
    this.fbUploader = new FacebookUploader();

    // NEW: Replace old Transformer + ContentProcessor + SEOOptimizer
    this.videoTransformer = new VideoTransformer();
    this.variationEngine = new VariationEngine({ db: options.db || null });
    this.ai = new AIIntegration();
    this.seoEngine = new SEOEngine({ ai: this.ai });

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

    logger.info('🚀 Auto-Pilot STARTED (Upgraded Pipeline)');
    logger.info(`  Interval: ${config.autopilot.intervalMinutes} min`);
    logger.info(`  Categories: ${this._categories.join(', ')}`);
    logger.info(`  Targets: ${this._targets.join(', ')}`);
    logger.info(`  Max per session: ${this._maxPerSession}`);
    logger.info(`  AI: ChatGPT=${this.ai.hasChatGPT ? '✓' : '✗'} Gemini=${this.ai.hasGemini ? '✓' : '✗'}`);

    // Run first cycle immediately
    this._runCycle();
  }

  stop() {
    this.isRunning = false;
    this.scheduler.stop();
    this.ai.close();
    if (this._timer) clearTimeout(this._timer);
    logger.info('⏹️ Auto-Pilot STOPPED');
  }

  pause() {
    this.scheduler.pause();
    if (this._timer) clearTimeout(this._timer);
    logger.info('⏸️ Auto-Pilot PAUSED');
  }

  resume() {
    this.scheduler.resume();
    this._scheduleNext();
    logger.info('▶️ Auto-Pilot RESUMED');
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      isPaused: this.scheduler.isPaused,
      ...this.stats,
      scheduler: this.scheduler.getStatus(),
      nextCategory: this._categories[this._currentCategoryIndex],
      ai: { chatgpt: this.ai.hasChatGPT, gemini: this.ai.hasGemini },
    };
  }

  // =====================================================
  // Core Cycle (UPGRADED)
  // =====================================================

  async _runCycle() {
    if (!this.isRunning) return;

    this.stats.sessionsRun++;
    const cycleIndex = this.stats.sessionsRun;

    logger.info(`\n========================================`);
    logger.info(`🔄 Auto-Pilot Cycle #${cycleIndex}`);
    logger.info(`========================================`);

    try {
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

        // Step 2: Process + Upload each video
        for (const video of videos) {
          let uploadPath = video.filePath;
          try {
            // NEW: Generate unique variation for this upload
            const variation = this.variationEngine.generateVariation(video.id, format);
            logger.info(`🎲 Variation: ${variation.hash.slice(0, 12)}...`);

            // NEW: 5-stage FFmpeg pipeline with variation params
            const tfResult = await this.videoTransformer.process(video.filePath, {
              format,
              preset: config.processingPreset || 'standard',
              variation: variation.params,
            });
            uploadPath = tfResult.outputPath;
            logger.info(`🔒 Pipeline: ${tfResult.stages?.join(' → ') || 'complete'} (${tfResult.duration || '?'}ms)`);
          } catch (tfError) {
            logger.warn(`⚠️ Pipeline failed, using original: ${tfError.message}`);
          }

          // Step 3: Account rotation
          const rotated = this.accountRotation.getNextAccount(target, format);
          if (!rotated) {
            logger.warn(`No ${target} account configured for ${format}, skipping`);
            continue;
          }
          const { account, page } = rotated;

          // NEW: AI-powered SEO (replaces old seoOptimizer.optimize)
          const optimized = await this.seoEngine.optimize(video, {
            format,
            platform: target,
            niche,
          });

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
            accountId: account.id,  // Bug #4 fix: pass accountId for health tracking + rotation
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
    const { uploadId, filePath, platform, title, description, hashtags, tags, accountId } = payload;

    if (platform === 'youtube') {
      return await this.ytUploader.upload(filePath, {
        title, description, hashtags, tags,
      }, uploadId);
    } else if (platform === 'facebook') {
      // Bug #4 fix: pass accountId so correct account's cookies are used
      return await this.fbUploader.upload(filePath, {
        title, description, hashtags,
      }, uploadId, accountId);
    }

    throw new Error(`Unknown platform: ${platform}`);
  }

  async _handleReup(payload) {
    const { url, targets, category, format: reupFormat } = payload;

    // Step 1: Download
    const video = await this.downloader.download(url);

    // Step 2: Process with new pipeline
    let uploadPath = video.filePath;
    try {
      const variation = this.variationEngine.generateVariation(video.id, reupFormat || 'youtube_shorts');
      const tfResult = await this.videoTransformer.process(video.filePath, {
        format: reupFormat || 'youtube_shorts',
        preset: config.processingPreset || 'standard',
        variation: variation.params,
      });
      uploadPath = tfResult.outputPath;
      logger.info(`🔒 Applied pipeline + variation ${variation.hash.slice(0, 12)}...`);
    } catch (tfError) {
      logger.warn(`⚠️ Pipeline failed, using original: ${tfError.message}`);
    }

    // Step 3: Upload to each target
    const results = [];
    for (const target of (targets || this._targets)) {
      const format = reupFormat
        ? (target === 'facebook' ? 'facebook_reels' : reupFormat)
        : (target === 'facebook' ? 'facebook_reels' : 'youtube_shorts');

      const rotated = this.accountRotation.getNextAccount(target, format);
      if (!rotated) continue;
      const { account, page } = rotated;

      // AI SEO
      const optimized = await this.seoEngine.optimize(video, {
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

      // Upload directly (pass accountId for correct cookie loading)
      if (target === 'youtube') {
        const result = await this.ytUploader.upload(uploadPath, optimized, uploadResult.lastInsertRowid);
        results.push(result);
      } else {
        const result = await this.fbUploader.upload(uploadPath, optimized, uploadResult.lastInsertRowid, account.id);
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
