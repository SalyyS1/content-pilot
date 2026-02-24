/**
 * Trending Scanner — Multi-source trending data collection
 * 
 * Sources: Google Trends API + YouTube search
 * Caches results in SQLite (6h TTL)
 * Outputs Trending Score 0-100
 */

import logger from '../core/logger.js';

export class TrendingScanner {
  constructor(options = {}) {
    this._db = options.db || null;
    this._cacheTTL = 6 * 60 * 60 * 1000; // 6 hours
  }

  /**
   * Scan trending data for a category
   * @returns {{ keywords: Array, trendingScore: number, source: string }}
   */
  async scan(category, region = 'VN') {
    // Check cache first
    const cached = this._getCache(category, region);
    if (cached) {
      logger.debug(`   📦 Using cached trending data for ${category} (${region})`);
      return cached;
    }

    logger.info(`🔍 Scanning trending: ${category} (${region})`);

    const results = await Promise.allSettled([
      this._googleTrends(category, region),
      this._youtubeTrending(category, region),
    ]);

    const gTrends = results[0].status === 'fulfilled' ? results[0].value : [];
    const ytTrending = results[1].status === 'fulfilled' ? results[1].value : [];

    // Aggregate
    const allKeywords = [...gTrends, ...ytTrending];
    const trendingScore = this._calculateScore(allKeywords);

    const data = {
      keywords: allKeywords.slice(0, 30),
      trendingScore,
      category,
      region,
      fetchedAt: new Date().toISOString(),
    };

    // Cache
    this._setCache(category, region, data);
    logger.info(`   📊 Trending score: ${trendingScore}/100 (${allKeywords.length} keywords)`);

    return data;
  }

  /**
   * Google Trends — rising queries
   */
  async _googleTrends(category, region) {
    try {
      const googleTrends = (await import('google-trends-api')).default;

      const result = await googleTrends.relatedQueries({
        keyword: category,
        geo: region,
        hl: region === 'VN' ? 'vi' : 'en',
      });

      const parsed = JSON.parse(result);
      const rising = parsed?.default?.rankedList?.[1]?.rankedKeyword || [];

      return rising.map(item => ({
        keyword: item.query,
        score: item.value || 0,
        velocity: 'rising',
        source: 'google_trends',
      }));
    } catch (err) {
      logger.debug(`   Google Trends failed: ${err.message}`);
      return [];
    }
  }

  /**
   * YouTube Trending — top video tags in category
   */
  async _youtubeTrending(category, region) {
    // Use yt-dlp to search trending videos and extract tags
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const exec = promisify(execFile);

      const { stdout } = await exec('yt-dlp', [
        `ytsearch5:${category} trending ${new Date().getFullYear()}`,
        '--flat-playlist', '--dump-json', '--no-download',
        '--geo-bypass-country', region,
      ], { timeout: 15000 });

      const videos = stdout.split('\n').filter(Boolean).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);

      // Extract unique tags
      const tagMap = new Map();
      for (const v of videos) {
        for (const tag of (v.tags || [])) {
          const t = tag.toLowerCase();
          tagMap.set(t, (tagMap.get(t) || 0) + 1);
        }
      }

      return Array.from(tagMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([keyword, count]) => ({
          keyword,
          score: count * 20,
          velocity: count >= 3 ? 'hot' : 'rising',
          source: 'youtube',
        }));
    } catch (err) {
      logger.debug(`   YouTube trending scan failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Calculate Trending Score 0-100
   * Weights: search velocity 30%, social 20%, competition 20%, history 15%, season 15%
   */
  _calculateScore(keywords) {
    if (keywords.length === 0) return 0;

    // More keywords = more trending
    const volumeScore = Math.min(keywords.length / 30, 1) * 30;

    // Rising keywords
    const risingCount = keywords.filter(k => k.velocity === 'rising' || k.velocity === 'hot').length;
    const velocityScore = Math.min(risingCount / 10, 1) * 30;

    // Multi-source diversity
    const sources = new Set(keywords.map(k => k.source));
    const diversityScore = (sources.size / 3) * 20;

    // High-score keywords
    const avgScore = keywords.reduce((s, k) => s + (k.score || 0), 0) / keywords.length;
    const qualityScore = Math.min(avgScore / 100, 1) * 20;

    return Math.round(volumeScore + velocityScore + diversityScore + qualityScore);
  }

  // === Cache ===
  _getCache(category, region) {
    if (!this._db) return null;
    try {
      const row = this._db.prepare(
        'SELECT * FROM trending_cache WHERE category = ? AND region = ? AND expires_at > datetime("now")'
      ).get(category, region);
      if (row) return { ...row, keywords: JSON.parse(row.keywords) };
    } catch {}
    return null;
  }

  _setCache(category, region, data) {
    if (!this._db) return;
    try {
      this._db.prepare(`
        INSERT OR REPLACE INTO trending_cache (category, region, source, keywords, trending_score, expires_at)
        VALUES (?, ?, 'aggregate', ?, ?, datetime('now', '+6 hours'))
      `).run(category, region, JSON.stringify(data.keywords), data.trendingScore);
    } catch {}
  }
}

export default TrendingScanner;
