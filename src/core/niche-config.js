/**
 * Niche Configuration - Topic-based content strategy per format
 * 
 * Strategy:
 *   YT Shorts (EN): Pets/Animals — always viral, safe, no language barrier
 *   YT Long  (VN):  Audio stories / crazy stories — truyện mất não, bí ẩn
 *   FB Reels (VN):  Mixed food/street food + background audio mix
 */

const NICHE_PROFILES = {
  // ==========================================
  // YouTube Shorts — Pets & Animals (EN)
  // ==========================================
  youtube_shorts: {
    name: 'Pets & Animals',
    language: 'en',
    region: 'US',
    searchQueries: [
      'funny pets shorts',
      'cute animals viral',
      'funny cats shorts',
      'funny dogs compilation shorts',
      'pets being funny shorts',
      'animals doing funny things',
      'cute puppies shorts',
      'cats vs dogs shorts',
      'funny animal fails',
      'adorable pets viral',
    ],
    // Rotate queries each cycle to avoid same results
    queriesPerCycle: 3,
    // YouTube search filters
    filters: {
      maxDuration: 60,       // Shorts < 60s
      minViews: 5000,
      sortBy: 'relevance',   // relevance | viewCount | date
    },
    // SEO keywords for upload
    seoKeywords: ['pets', 'funny animals', 'cute', 'dogs', 'cats', 'viral', 'shorts'],
    seoHashtags: ['#pets', '#funnyanimals', '#cute', '#shorts', '#viral', '#catsoftiktok', '#dogsofyoutube'],
    // Channel whitelist (optional — scrape from known big channels)
    channels: [
      // Add specific pet channels to scrape from
    ],
  },

  // ==========================================
  // YouTube Long-form — Audio Stories (VN)
  // ==========================================
  youtube_long: {
    name: 'Truyện Mất Não / Bí Ẩn',
    language: 'vi',
    region: 'VN',
    searchQueries: [
      'truyện mất não',
      'truyện đêm khuya hay nhất',
      'câu chuyện bí ẩn rùng rợn',
      'truyện kinh dị đêm khuya',
      'top bí ẩn thế giới',
      'chuyện lạ có thật',
      'truyện ma đêm khuya',
      'sự thật đáng sợ',
      'những câu chuyện kỳ lạ',
      'bí ẩn chưa có lời giải',
    ],
    queriesPerCycle: 2,
    filters: {
      minDuration: 300,      // Long-form > 5 minutes
      maxDuration: 3600,     // Max 1 hour
      minViews: 1000,
      sortBy: 'viewCount',
    },
    // Audio-focused reup: extract audio, replace visual with static/slideshow
    audioMode: true,
    seoKeywords: ['truyện đêm khuya', 'bí ẩn', 'truyện mất não', 'kinh dị', 'chuyện lạ'],
    seoHashtags: ['#truyệnđêmkhuya', '#bíẩn', '#truyệnmấtnão', '#kinhdi', '#chuyệnlạ'],
    channels: [],
  },

  // ==========================================
  // Facebook Reels — Mixed Street Food + Audio (VN)
  // ==========================================
  facebook_reels: {
    name: 'Ẩm Thực Đường Phố',
    language: 'vi',
    region: 'VN',
    searchQueries: [
      'ẩm thực đường phố việt nam',
      'street food vietnam shorts',
      'nấu ăn ngon shorts',
      'đồ ăn vặt ngon shorts',
      'ẩm thực hà nội shorts',
      'ẩm thực sài gòn shorts',
      'mukbang vietnam shorts',
      'review đồ ăn shorts',
      // 30% viral mix
      'funny moments viral shorts',
      'satisfying food shorts',
    ],
    queriesPerCycle: 3,
    filters: {
      maxDuration: 90,       // Reels < 90s
      minViews: 3000,
      sortBy: 'relevance',
    },
    // Audio mixing: overlay background music on food clips
    audioMix: true,
    audioMixSources: [
      // Royalty-free background audio styles
      'upbeat cooking music',
      'cheerful background music no copyright',
      'vietnamese background music',
    ],
    seoKeywords: ['ẩm thực', 'đường phố', 'nấu ăn', 'review đồ ăn', 'street food'],
    seoHashtags: ['#ẩmthực', '#streetfood', '#đồăn', '#nấuăn', '#viral', '#reels'],
    channels: [],
  },
};

/**
 * Get niche config for a specific format
 */
export function getNicheConfig(format) {
  return NICHE_PROFILES[format] || NICHE_PROFILES.youtube_shorts;
}

/**
 * Get search queries for this cycle (rotated)
 */
export function getCycleQueries(format, cycleIndex = 0) {
  const niche = getNicheConfig(format);
  const queries = niche.searchQueries;
  const perCycle = niche.queriesPerCycle || 3;
  
  // Rotate queries based on cycle index
  const startIdx = (cycleIndex * perCycle) % queries.length;
  const selected = [];
  for (let i = 0; i < perCycle; i++) {
    selected.push(queries[(startIdx + i) % queries.length]);
  }
  return selected;
}

/**
 * Get all available niche profiles
 */
export function getAllNiches() {
  return Object.entries(NICHE_PROFILES).map(([key, val]) => ({
    format: key,
    name: val.name,
    language: val.language,
    region: val.region,
    queryCount: val.searchQueries.length,
    filters: val.filters,
    audioMode: val.audioMode || false,
    audioMix: val.audioMix || false,
  }));
}

/**
 * Get format type from niche key
 */
export function getFormatType(format) {
  if (format === 'youtube_long') return 'long';
  return 'short'; // youtube_shorts, facebook_reels
}

export default NICHE_PROFILES;
