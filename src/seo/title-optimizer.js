/**
 * Title Optimizer — AI-powered title + description generation
 * 
 * Primary: OpenAI gpt-4o-mini
 * Fallback: Template-based generation
 */

import logger from '../core/logger.js';
import { getNicheConfig } from '../core/niche-config.js';
import { pickRandom } from '../processor/preset-manager.js';

// Title templates (fallback)
const TITLE_TEMPLATES = {
  en: {
    youtube_shorts: [
      '😱 {keyword} — You Won\'t Believe This!',
      '{keyword} 🔥 #shorts #viral',
      'Wait For It... {keyword} 😂',
      'POV: {keyword} 💀',
      '{keyword} Gone WRONG 😳',
    ],
    youtube_long: [
      '{keyword} — Full Story [Must Watch]',
      'The Truth About {keyword} (2026)',
      '{keyword}: Everything You Need to Know',
      '{keyword} — Explained in Detail',
    ],
    facebook_reels: [
      '{keyword} 😂🔥',
      'When {keyword}... 💀',
      '{keyword} vibes ✨',
    ],
  },
  vi: {
    youtube_shorts: [
      '😱 {keyword} — Không Thể Tin Được!',
      '{keyword} 🔥 #shorts #xuhuong',
      'Đợi Đến Cuối... {keyword} 😂',
      '{keyword} cực kỳ đỉnh 💯',
    ],
    youtube_long: [
      '{keyword} — Truyện Kinh Dị Đêm Khuya',
      'Bí Ẩn {keyword} [Nghe Là Ghiện]',
      '{keyword} — Câu Chuyện Rùng Rợn',
      '{keyword} Full | Truyện Audio',
    ],
    facebook_reels: [
      '{keyword} ngon quá trời 😋🔥',
      'Ăn thử {keyword} — review thật 💯',
      '{keyword} đỉnh của chóp 🤤',
    ],
  },
};

// Description templates
const DESC_TEMPLATES = {
  en: {
    youtube_shorts: '{title}\n\n{hashtags}\n\n👉 Follow for more {niche} content!\n❤️ Like & Share if you enjoyed!',
    youtube_long: '{title}\n\n🎧 {niche} content\n\n{keywords}\n\n{hashtags}\n\n👉 Subscribe for daily videos!\n🔔 Turn on notifications!',
    facebook_reels: '{title} {hashtags}',
  },
  vi: {
    youtube_shorts: '{title}\n\n{hashtags}\n\n👉 Follow để xem thêm!\n❤️ Like & Share nhé!',
    youtube_long: '{title}\n\n🎧 {niche}\n\n{keywords}\n\n{hashtags}\n\n👉 Đăng ký kênh để nghe hàng ngày!\n🔔 Bật chuông thông báo!',
    facebook_reels: '{title} {hashtags}',
  },
};

export class TitleOptimizer {
  constructor(options = {}) {
    this.ai = options.ai || null; // AIIntegration instance
  }

  /**
   * Generate optimized title + description
   * @returns {{ title: string, description: string, titles: string[] }}
   */
  async optimize(video, trendingData, format, keywordData) {
    const niche = getNicheConfig(format);
    const lang = niche?.language || 'en';
    const genre = niche?.name || 'general';
    const trendingKeywords = (trendingData?.keywords || []).slice(0, 5).map(k => k.keyword);

    // === Title ===
    let titles = null;
    if (this.ai?.hasChatGPT) {
      titles = await this.ai.generateTitle(video, genre, format, lang, trendingKeywords);
    }

    let title;
    if (titles && titles.length > 0) {
      title = titles[0]; // Best AI title
      logger.info(`   🤖 AI title: "${title}"`);
    } else {
      title = this._templateTitle(video, format, lang, trendingKeywords);
      logger.info(`   📝 Template title: "${title}"`);
    }

    // === Description ===
    let description = null;
    if (this.ai?.hasChatGPT) {
      description = await this.ai.generateDescription(video, genre, format, lang, keywordData?.keywords || []);
    }

    if (!description) {
      description = this._templateDescription(title, format, lang, niche, keywordData);
    }

    return {
      title,
      description,
      titles: titles || [title],
    };
  }

  /**
   * Template-based title (fallback)
   */
  _templateTitle(video, format, lang, keywords) {
    const templates = TITLE_TEMPLATES[lang]?.[format] || TITLE_TEMPLATES.en.youtube_shorts;
    const template = pickRandom(templates);
    const keyword = keywords[0] || video.title || 'Amazing Video';
    return template.replace('{keyword}', keyword);
  }

  /**
   * Template-based description (fallback)
   */
  _templateDescription(title, format, lang, niche, keywordData) {
    const template = DESC_TEMPLATES[lang]?.[format] || DESC_TEMPLATES.en.youtube_shorts;

    return template
      .replace('{title}', title)
      .replace('{niche}', niche?.name || 'Entertainment')
      .replace('{hashtags}', (keywordData?.hashtags || []).slice(0, 15).join(' '))
      .replace('{keywords}', (keywordData?.keywords || []).slice(0, 5).join(', '));
  }
}

export default TitleOptimizer;
