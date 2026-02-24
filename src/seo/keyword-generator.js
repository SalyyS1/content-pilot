/**
 * Keyword Generator — AI-powered hashtag + keyword generation
 * 
 * Primary: Gemini 2.0 Flash (FREE tier)
 * Fallback: Static hashtag pools from niche config
 */

import logger from '../core/logger.js';
import { getNicheConfig } from '../core/niche-config.js';

// Static hashtag pools (fallback when AI unavailable)
const STATIC_POOLS = {
  en: {
    generic: ['#viral', '#trending', '#fyp', '#foryou', '#foryoupage', '#explore', '#viralvideo'],
    pets: ['#pets', '#funnyanimals', '#cute', '#dogsoftiktok', '#catsoftiktok', '#petlover', '#animals'],
    gaming: ['#gaming', '#gamer', '#gameplay', '#videogames', '#gamingcommunity'],
    comedy: ['#funny', '#comedy', '#humor', '#lol', '#memes', '#laugh'],
    food: ['#food', '#foodie', '#cooking', '#recipe', '#yummy', '#delicious'],
  },
  vi: {
    generic: ['#viral', '#trending', '#xuhuong', '#foryou', '#vietnam', '#tiktok'],
    stories: ['#truyệnđêmkhuya', '#bíẩn', '#kinhdi', '#truyen', '#audiobook', '#truyệnma'],
    food: ['#ẩmthực', '#ănvặt', '#streetfood', '#monngon', '#doanngon', '#amthucduongpho'],
    comedy: ['#hàihước', '#funny', '#cười', '#haivl', '#giảitrí'],
  },
};

export class KeywordGenerator {
  constructor(options = {}) {
    this.ai = options.ai || null; // AIIntegration instance
  }

  /**
   * Generate keywords + hashtags for a video
   * @returns {{ hashtags: string[], keywords: string[], seoTags: string[] }}
   */
  async generate(video, trendingData, format) {
    const niche = getNicheConfig(format);
    const lang = niche?.language || 'en';
    const genre = niche?.name || 'general';

    // Try AI first (Gemini free), then fallback
    let hashtags = null;
    if (this.ai && this.ai.hasGemini) {
      hashtags = await this.ai.generateHashtags(video, genre, format, 25);
    }

    if (!hashtags || hashtags.length === 0) {
      logger.debug('   Using static hashtag pools (AI unavailable)');
      hashtags = this._staticHashtags(format, lang, genre);
    }

    // Merge with trending keywords
    const trendingTags = (trendingData?.keywords || [])
      .slice(0, 5)
      .map(k => `#${k.keyword.replace(/\s+/g, '').toLowerCase()}`);

    // Merge with niche SEO hashtags
    const nicheHashtags = niche?.seoHashtags || [];

    // Combine & deduplicate
    const allHashtags = [...new Set([...hashtags, ...trendingTags, ...nicheHashtags])].slice(0, 30);

    // Extract plain keywords for description SEO
    const keywords = allHashtags.map(h => h.replace('#', '')).slice(0, 10);

    // SEO tags for YouTube (max 500 chars)
    const seoTags = this._buildSeoTags(keywords, niche);

    return { hashtags: allHashtags, keywords, seoTags };
  }

  /**
   * Get static hashtags (fallback)
   */
  _staticHashtags(format, lang, genre) {
    const pool = STATIC_POOLS[lang] || STATIC_POOLS.en;
    const genreKey = genre.toLowerCase().includes('pet') ? 'pets'
      : genre.toLowerCase().includes('food') || genre.toLowerCase().includes('ẩm thực') ? 'food'
      : genre.toLowerCase().includes('truyện') || genre.toLowerCase().includes('story') ? 'stories'
      : genre.toLowerCase().includes('comedy') || genre.toLowerCase().includes('hài') ? 'comedy'
      : genre.toLowerCase().includes('gaming') ? 'gaming'
      : 'generic';

    const tags = [...(pool[genreKey] || pool.generic), ...(pool.generic || [])];
    return [...new Set(tags)];
  }

  /**
   * Build YouTube SEO tags (max 500 chars total)
   */
  _buildSeoTags(keywords, niche) {
    const baseTags = niche?.seoKeywords || [];
    const all = [...new Set([...baseTags, ...keywords])];
    let total = 0;
    const result = [];
    for (const tag of all) {
      if (total + tag.length + 1 > 500) break;
      result.push(tag);
      total += tag.length + 1;
    }
    return result;
  }
}

export default KeywordGenerator;
