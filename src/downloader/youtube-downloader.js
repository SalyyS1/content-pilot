import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve as pathResolve, basename, join } from 'path';
import config from '../core/config.js';
import logger from '../core/logger.js';
import { addVideo, getVideoByUrl, updateVideo } from '../core/database.js';
import { getNicheConfig, getCycleQueries, getFormatType } from '../core/niche-config.js';

/**
 * YouTube/Facebook Downloader - wraps yt-dlp CLI
 * Downloads videos with proxy rotation + metadata extraction
 */
export class YouTubeDownloader {
  constructor(options = {}) {
    this.outputDir = options.outputDir || config.downloadDir;
    this.ytdlpPath = options.ytdlpPath || 'yt-dlp';
    if (!existsSync(this.outputDir)) mkdirSync(this.outputDir, { recursive: true });

    // Load proxy list
    this._proxies = [];
    this._loadProxies();
  }

  _loadProxies() {
    const proxyFile = pathResolve(process.cwd(), 'data', 'socks5.txt');
    if (existsSync(proxyFile)) {
      try {
        const lines = readFileSync(proxyFile, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        this._proxies = lines;
        logger.info(`🌐 Loaded ${this._proxies.length} proxies from socks5.txt`);
      } catch (err) {
        logger.warn(`Failed to load proxies: ${err.message}`);
      }
    } else {
      logger.debug('No proxy file found at data/socks5.txt');
    }
  }

  _getRandomProxy() {
    if (this._proxies.length === 0) return null;
    const raw = this._proxies[Math.floor(Math.random() * this._proxies.length)];
    // Detect protocol by port number
    const port = parseInt(raw.split(':')[1], 10);
    const socksPort = [1080, 1081, 1082, 4145, 4153, 5678, 9050, 9051, 10801, 50161];
    const proto = socksPort.includes(port) ? 'socks5' : 'http';
    return `${proto}://${raw}`;
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
      const outputTemplate = pathResolve(this.outputDir, '%(id)s.%(ext)s');
      const filePath = await this.runWithProxyRetry([
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
      const videoFile = pathResolve(this.outputDir, `${metadata.id}.mp4`);
      const thumbFile = pathResolve(this.outputDir, `${metadata.id}.jpg`);

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
   * Download by niche — PERSISTENT search: shuffles ALL queries, retries
   * up to 3 rounds with different keywords. Never gives up after 1 empty search.
   */
  async downloadByNiche(format, cycleIndex = 0, options = {}) {
    const niche = getNicheConfig(format);
    const formatType = getFormatType(format);
    const limit = options.limit || 3;

    // Use ALL queries (not just cycle subset), shuffle them
    const allQueries = [...niche.searchQueries].sort(() => Math.random() - 0.5);
    
    logger.info(`🎯 Niche scan: ${niche.name} (${format})`);
    logger.info(`   ${allQueries.length} keywords available, searching until found...`);
    logger.info(`   Region: ${niche.region}, Language: ${niche.language}`);

    const allUrls = [];
    const maxRounds = 3; // Try up to 3 full rounds
    let round = 0;

    while (allUrls.length < limit && round < maxRounds) {
      round++;
      const queriesThisRound = round === 1 ? allQueries : allQueries.sort(() => Math.random() - 0.5);
      
      for (const q of queriesThisRound) {
        if (allUrls.length >= limit) break;
        try {
          const searchQuery = formatType === 'long' ? q : `${q} #shorts`;
          logger.info(`🔍 [Round ${round}] Searching: "${searchQuery}"`);
          const urls = await this._searchVideos(searchQuery, niche.region, limit - allUrls.length, formatType);
          
          // Only add new URLs
          for (const u of urls) {
            if (!allUrls.includes(u) && !getVideoByUrl(u)) {
              allUrls.push(u);
            }
          }
          
          if (urls.length > 0) {
            logger.info(`   ✅ Found ${urls.length} results (total: ${allUrls.length})`);
          }
        } catch (error) {
          logger.warn(`Search failed for "${q}": ${error.message}`);
        }
        
        // Small delay between searches to avoid rate limiting
        if (allUrls.length < limit) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      
      if (allUrls.length === 0 && round < maxRounds) {
        logger.info(`⏳ Round ${round} found nothing, trying round ${round + 1}...`);
      }
    }

    logger.info(`Found ${allUrls.length} unique ${niche.name} videos after ${round} round(s)`);

    // Download with relaxed filters
    const results = [];
    const { maxDuration } = niche.filters;

    for (const url of allUrls.slice(0, limit)) {
      try {
        const metadata = await this.getMetadata(url);
        if (!metadata) continue;

        if (maxDuration && metadata.duration > maxDuration) {
          logger.debug(`Skipping too long (${metadata.duration}s): ${url}`);
          continue;
        }

        const result = await this.download(url, {
          force: false,
          maxDuration: maxDuration || 180,
          niche: format,
        });
        result.niche = format;
        result.nicheProfile = niche;
        results.push(result);
        logger.info(`✅ Downloaded: ${metadata.title?.slice(0, 60)}`);
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

      const output = await this.runWithProxyRetry(args, true);
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
      // Inject JS runtime flag — 'node' (NOT 'nodejs')
      const fullArgs = ['--js-runtimes', 'node', '--extractor-retries', '3', ...args];

      // Add cookies file if exists (bypasses YouTube 429 rate limit)
      const cookieFile = pathResolve(process.cwd(), 'data', 'youtube-cookies.txt');
      if (existsSync(cookieFile)) {
        fullArgs.unshift('--cookies', cookieFile);
      }

      // Add random proxy from pool
      const proxy = this._getRandomProxy();
      if (proxy) {
        fullArgs.unshift('--proxy', proxy);
        if (!captureOutput) logger.debug(`🌐 Using proxy: ${proxy}`);
      }

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
          // Mark proxy as dead if timeout
          if (proxy && (stderr.includes('timed out') || stderr.includes('Connection refused') || stderr.includes('SOCKS'))) {
            this._markProxyDead(proxy);
          }
          reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(0, 500)}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to run yt-dlp: ${err.message}. Make sure yt-dlp is installed.`));
      });
    });
  }

  /**
   * Run yt-dlp with proxy retry — tries up to maxRetries different proxies on timeout
   */
  async runWithProxyRetry(args, captureOutput = false, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this._runYtdlp(args, captureOutput);
      } catch (err) {
        const isProxyError = err.message.includes('timed out') || 
          err.message.includes('Connection refused') || 
          err.message.includes('SOCKS') ||
          err.message.includes('proxy');
        
        if (isProxyError && attempt < maxRetries && this._proxies.length > 0) {
          logger.warn(`🔄 Proxy failed (attempt ${attempt}/${maxRetries}), trying another proxy...`);
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Mark a proxy as dead — remove from pool for this session
   */
  _markProxyDead(proxy) {
    const raw = proxy.replace(/^(socks5|http):\/\//, '');
    const idx = this._proxies.indexOf(raw);
    if (idx !== -1) {
      this._proxies.splice(idx, 1);
      logger.debug(`🚫 Removed dead proxy: ${raw} (${this._proxies.length} remaining)`);
    }
  }
}

export default YouTubeDownloader;

