import logger from './logger.js';

/**
 * Video Classifier
 * Phân loại video theo: content type (animation/real) + genre (gaming/comedy/food/etc.)
 * Sử dụng metadata analysis (title, tags, description, channel name)
 */
export class VideoClassifier {
  constructor() {
    // ═══════════════════════════════════════════
    // Genre keyword maps (Vietnamese + English)
    // ═══════════════════════════════════════════
    this.genreKeywords = {
      gaming: {
        keywords: [
          'game', 'gaming', 'gameplay', 'gamer', 'playthrough', 'walkthrough',
          'minecraft', 'fortnite', 'roblox', 'valorant', 'lol', 'pubg', 'cod',
          'genshin', 'free fire', 'liên quân', 'lmht', 'esport',
          'ps5', 'xbox', 'nintendo', 'steam', 'epic games',
          'speedrun', 'lets play', 'stream', 'highlight', 'montage',
          'clutch', 'kill', 'headshot', 'rank', 'tiktok gaming',
        ],
        weight: 1.0,
      },
      comedy: {
        keywords: [
          'funny', 'comedy', 'humor', 'joke', 'prank', 'fail', 'lol', 'lmao',
          'meme', 'troll', 'roast', 'skit', 'parody', 'standup',
          'hài', 'hài hước', 'cười', 'tấu hài', 'ghiền mì gõ', 'lầy',
          'try not to laugh', 'reaction', 'unexpected', 'plot twist',
        ],
        weight: 1.0,
      },
      music: {
        keywords: [
          'music', 'song', 'mv', 'music video', 'official', 'lyric', 'lyrics',
          'remix', 'cover', 'beat', 'instrumental', 'karaoke', 'live performance',
          'rap', 'hip hop', 'edm', 'pop', 'rock', 'kpop', 'vpop', 'bolero',
          'nhạc', 'bài hát', 'ca sĩ', 'ca nhạc', 'nhạc trẻ', 'nhạc chill',
          'album', 'single', 'playlist', 'chill', 'lofi',
          'dance', 'choreography', 'dancer', 'nhảy',
        ],
        weight: 1.0,
      },
      food: {
        keywords: [
          'food', 'cooking', 'recipe', 'chef', 'cuisine', 'eat', 'eating',
          'mukbang', 'asmr eating', 'foodie', 'restaurant', 'review food',
          'nấu ăn', 'ẩm thực', 'món ăn', 'đồ ăn', 'bếp', 'ăn thử',
          'street food', 'đặc sản', 'nhà hàng', 'quán ăn',
          'baking', 'dessert', 'bánh', 'cake', 'drink', 'cocktail', 'trà sữa',
        ],
        weight: 1.0,
      },
      tech: {
        keywords: [
          'tech', 'technology', 'review', 'unboxing', 'gadget', 'smartphone',
          'iphone', 'samsung', 'laptop', 'pc build', 'setup', 'benchmark',
          'programming', 'coding', 'developer', 'software', 'app', 'ai',
          'công nghệ', 'đánh giá', 'mở hộp', 'điện thoại', 'máy tính',
          'tutorial', 'how to', 'tips', 'tricks', 'hack',
        ],
        weight: 1.0,
      },
      beauty: {
        keywords: [
          'beauty', 'makeup', 'skincare', 'fashion', 'style', 'ootd',
          'haul', 'grwm', 'get ready with me', 'transformation',
          'trang điểm', 'làm đẹp', 'dưỡng da', 'thời trang', 'outfit',
          'nail', 'hair', 'tóc', 'routine', 'review mỹ phẩm',
        ],
        weight: 1.0,
      },
      sports: {
        keywords: [
          'sport', 'football', 'soccer', 'basketball', 'boxing', 'mma', 'ufc',
          'goal', 'highlight', 'match', 'championship', 'world cup',
          'gym', 'workout', 'fitness', 'exercise', 'training',
          'bóng đá', 'thể thao', 'bàn thắng', 'võ thuật', 'tập gym',
        ],
        weight: 1.0,
      },
      education: {
        keywords: [
          'learn', 'education', 'tutorial', 'explain', 'study', 'lesson',
          'school', 'university', 'course', 'knowledge', 'science', 'history',
          'học', 'kiến thức', 'bài giảng', 'giải thích', 'chia sẻ',
          'documentary', 'fact', 'did you know', 'top 10',
        ],
        weight: 0.8, // Lower weight since "tutorial" overlaps with tech
      },
      animals: {
        keywords: [
          'pet', 'cat', 'dog', 'puppy', 'kitten', 'animal', 'wildlife',
          'cute', 'adorable', 'zoo', 'bird', 'fish', 'rabbit',
          'chó', 'mèo', 'thú cưng', 'động vật', 'cute pet',
        ],
        weight: 1.0,
      },
      travel: {
        keywords: [
          'travel', 'trip', 'vlog', 'explore', 'adventure', 'tour',
          'hotel', 'beach', 'mountain', 'city', 'country',
          'du lịch', 'khám phá', 'phượt', 'check in', 'review khách sạn',
        ],
        weight: 0.9,
      },
      asmr: {
        keywords: [
          'asmr', 'satisfying', 'relaxing', 'slime', 'oddly satisfying',
          'triggers', 'tingles', 'whisper', 'soap cutting', 'sand',
        ],
        weight: 1.2, // Higher weight because ASMR is very specific
      },
      news: {
        keywords: [
          'news', 'breaking', 'update', 'report', 'politics', 'economy',
          'tin tức', 'thời sự', 'nóng', 'mới nhất', 'cập nhật',
        ],
        weight: 0.8,
      },
      entertainment: {
        keywords: [
          'entertainment', 'show', 'idol', 'celebrity', 'drama', 'movie',
          'phim', 'giải trí', 'nghệ sĩ', 'sao', 'viral', 'trend',
          'challenge', 'tiktok', 'trending', 'story time',
        ],
        weight: 0.7, // Low weight — generic fallback
      },
    };

    // ═══════════════════════════════════════════
    // Content type keywords (Animation vs Real)
    // ═══════════════════════════════════════════
    this.animationKeywords = [
      'anime', 'animation', 'animated', 'cartoon', '3d', 'cgi',
      'hoạt hình', 'manga', 'webtoon', 'vtuber',
      'pixar', 'disney', 'ghibli', 'naruto', 'one piece', 'demon slayer',
      'dragon ball', 'attack on titan', 'jujutsu', 'bleach',
      'amv', 'mmd', 'gacha', 'roblox animation',
      'minecraft animation', 'animated story', 'draw my life',
    ];
  }

  /**
   * Classify a video based on its metadata
   * @param {object} video - { title, description, tags, channelName, thumbnailUrl }
   * @returns {{ genre, contentType, confidence, allScores }}
   */
  classify(video) {
    const title = (video.title || '').toLowerCase();
    const desc = (video.description || '').toLowerCase();
    const tags = this._normalizeTags(video.tags);
    const channel = (video.channelName || video.channel || '').toLowerCase();

    // Combine all text for analysis
    const fullText = `${title} ${desc} ${tags.join(' ')} ${channel}`;

    // ── Genre classification ──
    const genreScores = {};
    let maxScore = 0;
    let bestGenre = 'entertainment'; // fallback

    for (const [genre, config] of Object.entries(this.genreKeywords)) {
      let score = 0;

      for (const keyword of config.keywords) {
        // Title match = highest weight (3x)
        if (title.includes(keyword)) score += 3 * config.weight;
        // Tag match = high weight (2x)
        if (tags.some(t => t.includes(keyword))) score += 2 * config.weight;
        // Description match = normal weight (1x), but cap contribution
        if (desc.includes(keyword)) score += 1 * config.weight;
        // Channel name match = moderate weight (1.5x)
        if (channel.includes(keyword)) score += 1.5 * config.weight;
      }

      genreScores[genre] = Math.round(score * 100) / 100;

      if (score > maxScore) {
        maxScore = score;
        bestGenre = genre;
      }
    }

    // ── Content type classification (animation vs real person) ──
    let animationScore = 0;
    for (const keyword of this.animationKeywords) {
      if (title.includes(keyword)) animationScore += 3;
      if (tags.some(t => t.includes(keyword))) animationScore += 2;
      if (desc.includes(keyword)) animationScore += 1;
      if (channel.includes(keyword)) animationScore += 1.5;
    }

    const contentType = animationScore >= 4 ? 'animation' : 'real_person';
    const contentTypeConfidence = animationScore >= 8 ? 'high' :
                                  animationScore >= 4 ? 'medium' : 'low';

    // ── Confidence calculation ──
    const sortedScores = Object.entries(genreScores).sort((a, b) => b[1] - a[1]);
    const topScore = sortedScores[0]?.[1] || 0;
    const secondScore = sortedScores[1]?.[1] || 0;

    // Confidence = how much the top genre stands out from the rest
    let confidence = 'low';
    if (topScore >= 8 && topScore > secondScore * 2) confidence = 'high';
    else if (topScore >= 4 && topScore > secondScore * 1.3) confidence = 'medium';

    const result = {
      genre: bestGenre,
      contentType,
      contentTypeConfidence,
      confidence,
      score: topScore,
      allScores: Object.fromEntries(sortedScores.slice(0, 5)), // Top 5 genres
      subGenres: sortedScores
        .filter(([, s]) => s >= topScore * 0.5 && s > 2)
        .map(([g]) => g)
        .slice(0, 3),
    };

    logger.info(`🏷️ Classified: "${(video.title || '').slice(0, 50)}" → ${bestGenre} (${confidence}) | ${contentType}`);
    return result;
  }

  /**
   * Normalize tags from various formats
   */
  _normalizeTags(tags) {
    if (!tags) return [];
    if (typeof tags === 'string') {
      try { tags = JSON.parse(tags); } catch { tags = tags.split(','); }
    }
    return tags.map(t => String(t).toLowerCase().trim()).filter(Boolean);
  }

  /**
   * Get category-specific SEO suggestions
   */
  getSEOHints(genre) {
    const hints = {
      gaming:        { emojis: '🎮🔥⚡💥🏆', style: 'energetic', hook: 'Did you see that?!' },
      comedy:        { emojis: '😂🤣💀😭🔥', style: 'casual', hook: 'Wait for it...' },
      music:         { emojis: '🎵🎶🔥✨💫', style: 'aesthetic', hook: '' },
      food:          { emojis: '🍜🔥😋🤤✨', style: 'appetizing', hook: 'You NEED to try this!' },
      tech:          { emojis: '📱💻🔥⚡🤯', style: 'informative', hook: 'This changes everything!' },
      beauty:        { emojis: '💄✨💅🌟💖', style: 'aesthetic', hook: 'Glow up!' },
      sports:        { emojis: '⚽🏀🔥💪🏆', style: 'energetic', hook: 'Unbelievable!' },
      education:     { emojis: '📚🧠💡✨🔍', style: 'informative', hook: 'You won\'t believe...' },
      animals:       { emojis: '🐱🐶❤️😍🥰', style: 'cute', hook: 'So adorable!' },
      travel:        { emojis: '✈️🌍🏖️📸✨', style: 'aesthetic', hook: 'Paradise found!' },
      asmr:          { emojis: '🎧✨😌💤🫧', style: 'calm', hook: '' },
      news:          { emojis: '📰🚨⚡🔴📢', style: 'urgent', hook: 'BREAKING:' },
      entertainment: { emojis: '🔥✨💫😱🎬', style: 'viral', hook: 'OMG!' },
    };
    return hints[genre] || hints.entertainment;
  }
}

export default VideoClassifier;
