/**
 * SEO Engine — Main orchestrator replacing old seo-optimizer.js
 * 
 * Combines: AI Integration + Trending Scanner + Keyword Generator + Title Optimizer
 */

import logger from '../core/logger.js';
import { AIIntegration } from './ai-integration.js';
import { TrendingScanner } from './trending-scanner.js';
import { KeywordGenerator } from './keyword-generator.js';
import { TitleOptimizer } from './title-optimizer.js';
import { getNicheConfig } from '../core/niche-config.js';

export class SEOEngine {
  constructor(options = {}) {
    this.ai = new AIIntegration();
    this.trendingScanner = new TrendingScanner({ db: options.db });
    this.keywordGenerator = new KeywordGenerator({ ai: this.ai });
    this.titleOptimizer = new TitleOptimizer({ ai: this.ai });
  }

  /**
   * Full SEO optimization pipeline
   * @param {object} video - { title, metadata, tags }
   * @param {object} options - { format, platform, niche, language }
   * @returns {object} { title, description, hashtags, keywords, seoTags, trendingScore }
   */
  async optimize(video, options = {}) {
    const format = options.format || 'youtube_shorts';
    const niche = getNicheConfig(format);
    const category = niche?.name || options.customCategory || 'general';
    const region = niche?.region || 'US';

    logger.info(`🏷 SEO Engine: ${category} (${format})`);
    logger.info(`   AI: ChatGPT=${this.ai.hasChatGPT ? '✓' : '✗'} Gemini=${this.ai.hasGemini ? '✓' : '✗'}`);

    // Step 1: Scan trending
    let trendingData = { keywords: [], trendingScore: 0 };
    try {
      trendingData = await this.trendingScanner.scan(category, region);
    } catch (err) {
      logger.warn(`   Trending scan failed: ${err.message}`);
    }

    // Step 2: Generate keywords + hashtags
    const keywordData = await this.keywordGenerator.generate(video, trendingData, format);

    // Step 3: Generate title + description
    const { title, description, titles } = await this.titleOptimizer.optimize(
      video, trendingData, format, keywordData
    );

    const result = {
      title,
      description,
      titles,
      hashtags: keywordData.hashtags,
      keywords: keywordData.keywords,
      seoTags: keywordData.seoTags,
      trendingScore: trendingData.trendingScore,
      format,
      niche: category,
      aiUsed: {
        title: this.ai.hasOpenAI,
        hashtags: this.ai.hasGemini,
        trending: trendingData.trendingScore > 0,
      },
    };

    logger.info(`   ✅ SEO complete: "${title.slice(0, 50)}..." | Score: ${trendingData.trendingScore}/100`);
    logger.info(`   📊 ${keywordData.hashtags.length} hashtags, ${keywordData.seoTags.length} tags`);

    return result;
  }

  /**
   * Generate đạo lý status for Facebook/YouTube community posts
   */
  async generateStatus(topic, lang = 'vi', count = 3) {
    if (!this.ai.hasOpenAI) {
      logger.warn('OpenAI not configured — cannot generate status');
      return null;
    }
    return this.ai.generateDaoLyStatus(topic, lang, count);
  }

  /**
   * Get current trending data (cached)
   */
  async getTrending(category, region = 'VN') {
    return this.trendingScanner.scan(category, region);
  }
}

export default SEOEngine;
