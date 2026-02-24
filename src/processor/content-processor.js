import logger from '../core/logger.js';
import config from '../core/config.js';

/**
 * Content Processor - handles description generation, hashtag management,
 * and content optimization for reup
 */
export class ContentProcessor {
  constructor(options = {}) {
    // Default hashtag templates by category
    this.hashtagTemplates = {
      entertainment: ['viral', 'trending', 'fyp', 'shorts', 'entertainment', 'funny', 'mustwatch'],
      music: ['music', 'viral', 'fyp', 'shorts', 'newsong', 'trending', 'musicvideo'],
      gaming: ['gaming', 'gamer', 'fyp', 'shorts', 'gameplay', 'trending', 'epicgaming'],
      comedy: ['funny', 'comedy', 'viral', 'fyp', 'shorts', 'humor', 'laugh'],
      tech: ['tech', 'technology', 'viral', 'fyp', 'shorts', 'gadgets', 'innovation'],
      lifestyle: ['lifestyle', 'viral', 'fyp', 'shorts', 'daily', 'motivation', 'life'],
      general: ['viral', 'trending', 'fyp', 'shorts', 'mustwatch', 'foryou'],
    };

    // Description templates
    this.descriptionTemplates = {
      default: '{description}\n\n{hashtags}',
      credit: '{description}\n\n📹 Credit: {source}\n\n{hashtags}',
      minimal: '{hashtags}',
      custom: options.template || '{description}\n\n{hashtags}',
    };
  }

  /**
   * Process video content for upload
   * Returns optimized title, description, hashtags for each platform
   */
  process(video, options = {}) {
    const {
      platform = 'youtube', // 'youtube' | 'facebook'
      template = 'default',
      customDescription = null,
      customHashtags = [],
      category = 'general',
      keepOriginalDescription = true,
      addCredit = false,
      sourceUrl = '',
    } = options;

    // Generate hashtags
    const hashtags = this._generateHashtags(video, category, customHashtags, platform);

    // Generate description
    const description = this._generateDescription(video, {
      template,
      customDescription,
      hashtags,
      keepOriginal: keepOriginalDescription,
      addCredit,
      sourceUrl,
      platform,
    });

    // Generate title
    const title = this._generateTitle(video, platform);

    return {
      title,
      description,
      hashtags,
      tags: hashtags.map(h => h.replace('#', '')),
    };
  }

  /**
   * Generate optimized hashtags
   */
  _generateHashtags(video, category, customHashtags, platform) {
    const tags = new Set();

    // Add custom hashtags first (highest priority)
    customHashtags.forEach(t => tags.add(t.startsWith('#') ? t : `#${t}`));

    // Add category-based hashtags
    const categoryTags = this.hashtagTemplates[category] || this.hashtagTemplates.general;
    categoryTags.forEach(t => tags.add(`#${t}`));

    // Extract hashtags from original video tags
    if (video.tags) {
      const originalTags = typeof video.tags === 'string' ? JSON.parse(video.tags) : video.tags;
      originalTags.slice(0, 5).forEach(t => {
        const clean = t.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, '').toLowerCase();
        if (clean.length > 2 && clean.length < 30) {
          tags.add(`#${clean}`);
        }
      });
    }

    // Platform-specific required tags
    if (platform === 'youtube') {
      tags.add('#Shorts');
    }

    // Limit total hashtags (YouTube: 15, Facebook: 30)
    const maxTags = platform === 'youtube' ? 15 : 30;
    return [...tags].slice(0, maxTags);
  }

  /**
   * Generate optimized description
   */
  _generateDescription(video, options) {
    const { template, customDescription, hashtags, keepOriginal, addCredit, sourceUrl, platform } = options;

    // Base description
    let desc = '';
    if (customDescription) {
      desc = customDescription;
    } else if (keepOriginal && video.description) {
      // Clean original description (remove existing hashtags, links, etc.)
      desc = this._cleanDescription(video.description);
    }

    // Build from template
    const hashtagStr = hashtags.join(' ');
    const tmpl = this.descriptionTemplates[template] || this.descriptionTemplates.default;

    let result = tmpl
      .replace('{description}', desc)
      .replace('{hashtags}', hashtagStr)
      .replace('{source}', sourceUrl || video.source_url || '');

    // Platform-specific limits
    if (platform === 'youtube') {
      result = result.slice(0, 5000);
    } else if (platform === 'facebook') {
      result = result.slice(0, 2200);
    }

    return result.trim();
  }

  /**
   * Generate optimized title
   */
  _generateTitle(video, platform) {
    let title = video.title || 'Video';

    // Remove common reup markers from original
    title = title
      .replace(/#shorts?\b/gi, '')
      .replace(/#reels?\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Truncate
    if (platform === 'youtube') {
      // Ensure room for #Shorts
      if (title.length > 90) title = title.slice(0, 90) + '...';
      if (!title.toLowerCase().includes('#shorts')) {
        title += ' #Shorts';
      }
    } else if (platform === 'facebook') {
      if (title.length > 95) title = title.slice(0, 95) + '...';
    }

    return title;
  }

  /**
   * Clean description - remove links, excessive hashtags, spam
   */
  _cleanDescription(description) {
    return description
      // Remove URLs
      .replace(/https?:\/\/[^\s]+/g, '')
      // Remove hashtag blocks (more than 3 consecutive)
      .replace(/(#\w+\s*){4,}/g, '')
      // Remove "subscribe" / "follow" calls to action
      .replace(/subscribe|follow|like\s+and\s+share|sub\s+for\s+more/gi, '')
      // Remove email addresses
      .replace(/[\w.-]+@[\w.-]+\.\w+/g, '')
      // Clean whitespace
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      // Limit length
      .slice(0, 500);
  }

  /**
   * Get hashtag suggestions for a category
   */
  getSuggestions(category) {
    return this.hashtagTemplates[category] || this.hashtagTemplates.general;
  }

  /**
   * Add custom hashtag template
   */
  addTemplate(name, hashtags) {
    this.hashtagTemplates[name] = hashtags;
  }
}

export default ContentProcessor;
