import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, basename } from 'path';
import config from '../core/config.js';
import logger from '../core/logger.js';
import { addVideo, getVideoByUrl, updateVideo } from '../core/database.js';
import { getNicheConfig, getCycleQueries, getFormatType } from '../core/niche-config.js';

/**
 * YouTube Downloader - wraps yt-dlp CLI
 * Downloads YouTube Shorts with metadata extraction
 */
export class YouTubeDownloader {
  constructor(options = {}) {
    this.outputDir = options.outputDir || config.downloadDir;
    this.ytdlpPath = options.ytdlpPath || 'yt-dlp';
    if (!existsSync(this.outputDir)) mkdirSync(this.outputDir, { recursive: true });
  }

  /**
   * Download a single video
   */
  async download(url, options = {}) {
    // Check if already downloaded
    const existing = getVideoByUrl(url);
    if (existing && existing.status === 'downloaded' && existing.file_path && existsSync(existing.file_path)) {
      logger.info(`Already downloaded: ${url}`);
      return existing;
    }

    logger.info(`Downloading: ${url}`);

    // First get metadata
    const metadata = await this.getMetadata(url);
    if (!metadata) {
      throw new Error(`Failed to get metadata for ${url}`);
    }

    // Check duration based on format
    const maxDuration = options.maxDuration || 180;
    if (metadata.duration > maxDuration && !options.force) {
      logger.warn(`Video too long (${metadata.duration}s, max ${maxDuration}s): ${url}`);
      throw new Error(`Video too long: ${metadata.duration}s (max ${maxDuration}s)`);
    }

    // Save to DB
    const dbResult = addVideo(url, {
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags || [],
      duration: metadata.duration,
      platform: 'youtube',
      status: 'downloading',
      extra: {
        channel: metadata.channel,
        channelId: metadata.channel_id,
        viewCount: metadata.view_count,
        likeCount: metadata.like_count,
        uploadDate: metadata.upload_date,
        thumbnail: metadata.thumbnail,
      }
    });

    const videoId = dbResult.lastInsertRowid || (existing && existing.id);

    try {
      const outputTemplate = resolve(this.outputDir, '%(id)s.%(ext)s');
      const filePath = await this._runYtdlp([
        url,
        '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '-o', outputTemplate,
        '--no-playlist',
        '--write-thumbnail',
        '--convert-thumbnails', 'jpg',
        '--no-overwrites',
      ]);

      // Find the downloaded file
      const videoFile = resolve(this.outputDir, `${metadata.id}.mp4`);
      const thumbFile = resolve(this.outputDir, `${metadata.id}.jpg`);

      updateVideo(videoId, {
        file_path: videoFile,
        thumbnail_path: existsSync(thumbFile) ? thumbFile : null,
        status: 'downloaded',
      });

      logger.info(`Downloaded: ${metadata.title} → ${videoFile}`);

      return {
        id: videoId,
        url,
        filePath: videoFile,
        thumbnailPath: existsSync(thumbFile) ? thumbFile : null,
        metadata,
      };
    } catch (error) {
      updateVideo(videoId, { status: 'failed' });
      throw error;
    }
  }

  /**
   * Download all Shorts from a channel
   */
  async downloadChannel(channelUrl, options = {}) {
    const limit = options.limit || 10;
    logger.info(`Fetching Shorts from channel: ${channelUrl} (limit: ${limit})`);

    // Ensure URL points to shorts tab
    let shortsUrl = channelUrl;
    if (!shortsUrl.includes('/shorts')) {
      shortsUrl = shortsUrl.replace(/\/?$/, '/shorts');
    }

    // Get video URLs from channel
    const urls = await this._getPlaylistUrls(shortsUrl, limit);
    logger.info(`Found ${urls.length} Shorts to download`);

    const results = [];
    for (const url of urls) {
      try {
        const result = await this.download(url, options);
        results.push(result);
      } catch (error) {
        logger.error(`Failed to download ${url}: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Search and download trending Shorts
   */
  async downloadTrending(options = {}) {
    const {
      query = '',
      category = 'entertainment',
      region = config.autopilot.region || 'VN',
      limit = 10,
      minViews = 10000,
    } = options;

    logger.info(`Searching trending Shorts: category=${category}, region=${region}, limit=${limit}`);

    // Build search query for trending shorts
    const searchQueries = this._buildTrendingQueries(query, category);
    const allUrls = [];

    for (const q of searchQueries) {
      if (allUrls.length >= limit) break;
      try {
        const urls = await this._searchShorts(q, region, limit - allUrls.length);
        allUrls.push(...urls);
      } catch (error) {
        logger.warn(`Search failed for "${q}": ${error.message}`);
      }
    }

    // Deduplicate
    const uniqueUrls = [...new Set(allUrls)];
    logger.info(`Found ${uniqueUrls.length} unique trending Shorts`);

    // Download each, filtering by view count
    const results = [];
    for (const url of uniqueUrls.slice(0, limit)) {
      try {
        // Check if already processed
        const existing = getVideoByUrl(url);
        if (existing) {
          logger.debug(`Skipping already known: ${url}`);
          continue;
        }

        const metadata = await this.getMetadata(url);
        if (metadata && metadata.view_count >= minViews && metadata.duration <= 180) {
          const result = await this.download(url, { force: false });
          results.push(result);
        }
      } catch (error) {
        logger.warn(`Failed to process ${url}: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Download by niche configuration — format-specific content scanning
   * This is the main method used by autopilot for niche-based downloading
   */
  async downloadByNiche(format, cycleIndex = 0, options = {}) {
    const niche = getNicheConfig(format);
    const formatType = getFormatType(format);
    const queries = getCycleQueries(format, cycleIndex);
    const limit = options.limit || 3;

    logger.info(`🎯 Niche scan: ${niche.name} (${format})`);
    logger.info(`   Queries: ${queries.join(' | ')}`);
    logger.info(`   Region: ${niche.region}, Language: ${niche.language}`);

    const allUrls = [];

    for (const q of queries) {
      if (allUrls.length >= limit) break;
      try {
        const searchQuery = formatType === 'long' ? q : `${q} #shorts`;
        const urls = await this._searchVideos(searchQuery, niche.region, limit - allUrls.length, formatType);
        allUrls.push(...urls);
      } catch (error) {
        logger.warn(`Search failed for "${q}": ${error.message}`);
      }
    }

    // Deduplicate
    const uniqueUrls = [...new Set(allUrls)];
    logger.info(`Found ${uniqueUrls.length} unique ${niche.name} videos`);

    // Download with niche-specific filters
    const results = [];
    const { minViews = 5000, maxDuration, minDuration } = niche.filters;

    for (const url of uniqueUrls.slice(0, limit)) {
      try {
        const existing = getVideoByUrl(url);
        if (existing) {
          logger.debug(`Skipping already known: ${url}`);
          continue;
        }

        const metadata = await this.getMetadata(url);
        if (!metadata) continue;

        // Apply niche-specific filters
        if (metadata.view_count < minViews) {
          logger.debug(`Skipping low views (${metadata.view_count}): ${url}`);
          continue;
        }
        if (maxDuration && metadata.duration > maxDuration) {
          logger.debug(`Skipping too long (${metadata.duration}s): ${url}`);
          continue;
        }
        if (minDuration && metadata.duration < minDuration) {
          logger.debug(`Skipping too short (${metadata.duration}s): ${url}`);
          continue;
        }

        const downloadOpts = {
          force: false,
          maxDuration: maxDuration || 180,
          niche: format,
        };

        const result = await this.download(url, downloadOpts);
        result.niche = format;
        result.nicheProfile = niche;
        results.push(result);
      } catch (error) {
        logger.warn(`Failed to process ${url}: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Search videos (supports both shorts and long-form)
   */
  async _searchVideos(query, region, limit, formatType = 'short') {
    try {
      const args = [
        `ytsearch${limit}:${query}`,
        '--flat-playlist',
        '--dump-json',
        '--no-download',
        '--geo-bypass-country', region,
      ];

      const output = await this._runYtdlp(args, true);
      const lines = output.trim().split('\n').filter(l => l.trim());

      return lines.map(line => {
        try {
          const data = JSON.parse(line);
          if (formatType === 'short') {
            return `https://www.youtube.com/shorts/${data.id}`;
          }
          return `https://www.youtube.com/watch?v=${data.id}`;
        } catch { return null; }
      }).filter(Boolean);
    } catch (error) {
      logger.error(`Search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Get video metadata without downloading
   */
  async getMetadata(url) {
    try {
      const output = await this._runYtdlp([
        url,
        '--dump-json',
        '--no-download',
        '--no-playlist',
      ], true);

      return JSON.parse(output);
    } catch (error) {
      logger.error(`Metadata extraction failed for ${url}: ${error.message}`);
      return null;
    }
  }

  // === Private Methods ===

  _buildTrendingQueries(query, category) {
    // Check if category matches a niche format key
    const nicheConfig = getNicheConfig(category);
    if (nicheConfig && nicheConfig.searchQueries) {
      // Use niche-specific queries (pick 3 random)
      const queries = [...nicheConfig.searchQueries];
      const shuffled = queries.sort(() => Math.random() - 0.5);
      return shuffled.slice(0, 3);
    }

    const categoryMap = {
      entertainment: ['trending shorts', 'viral shorts', 'funny shorts', 'best shorts today'],
      music: ['trending music shorts', 'viral music clips', 'new songs shorts'],
      gaming: ['gaming shorts trending', 'game highlights shorts', 'gaming funny moments'],
      comedy: ['funny shorts viral', 'comedy shorts trending', 'humor shorts'],
      tech: ['tech shorts trending', 'technology shorts viral'],
      lifestyle: ['lifestyle shorts', 'daily vlog shorts', 'motivation shorts'],
      // Niche categories
      pets: ['funny pets shorts', 'cute animals viral', 'funny cats shorts', 'funny dogs shorts'],
      food: ['street food shorts', 'cooking shorts viral', 'mukbang shorts', 'food review shorts'],
      stories: ['truyện đêm khuya', 'bí ẩn thế giới', 'truyện mất não', 'câu chuyện kỳ lạ'],
    };

    if (query) return [query];
    return categoryMap[category] || categoryMap.entertainment;
  }

  async _searchShorts(query, region, limit) {
    try {
      const output = await this._runYtdlp([
        `ytsearch${limit}:${query} #shorts`,
        '--flat-playlist',
        '--dump-json',
        '--no-download',
        '--geo-bypass-country', region,
      ], true);

      const lines = output.trim().split('\n').filter(l => l.trim());
      return lines.map(line => {
        try {
          const data = JSON.parse(line);
          return `https://www.youtube.com/shorts/${data.id}`;
        } catch { return null; }
      }).filter(Boolean);
    } catch (error) {
      logger.error(`Search failed: ${error.message}`);
      return [];
    }
  }

  async _getPlaylistUrls(url, limit) {
    try {
      const output = await this._runYtdlp([
        url,
        '--flat-playlist',
        '--dump-json',
        '--no-download',
        '--playlist-end', String(limit),
      ], true);

      const lines = output.trim().split('\n').filter(l => l.trim());
      return lines.map(line => {
        try {
          const data = JSON.parse(line);
          return data.url || `https://www.youtube.com/watch?v=${data.id}`;
        } catch { return null; }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  _runYtdlp(args, captureOutput = false) {
    return new Promise((resolve, reject) => {
      // Inject JS runtime flag to avoid 'No supported JavaScript runtime' error
      const fullArgs = ['--js-runtimes', 'nodejs', ...args];
      const proc = spawn(this.ytdlpPath, fullArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const line = data.toString();
        stdout += line;
        if (!captureOutput) {
          // Parse progress
          const match = line.match(/\[download\]\s+(\d+\.?\d*)%/);
          if (match) {
            logger.debug(`Download progress: ${match[1]}%`);
          }
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(captureOutput ? stdout : '');
        } else {
          reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(0, 500)}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to run yt-dlp: ${err.message}. Make sure yt-dlp is installed.`));
      });
    });
  }
}

export default YouTubeDownloader;
