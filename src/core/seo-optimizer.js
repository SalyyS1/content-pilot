import logger from './logger.js';
import { VideoClassifier } from './video-classifier.js';
import { getSetting } from './database.js';

/**
 * SEO Optimizer v2 — Format-Specific Strategy System
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  FORMAT      │ LANGUAGE  │ HASHTAGS    │ TRENDING STYLE │
 * ├─────────────────────────────────────────────────────────┤
 * │  YT Shorts   │ English   │ EN only     │ High-energy    │
 * │  YT Long     │ Tiếng Việt│ VN + EN     │ Informative    │
 * │  FB Reels    │ Tiếng Việt│ VN + EN     │ Engagement     │
 * └─────────────────────────────────────────────────────────┘
 *
 * AI Integration Hooks (future):
 *   - Gemini/ChatGPT for content generation
 *   - Affiliate link injection
 *   - Auto-post with description
 */
export class SEOOptimizer {
  constructor() {
    this.classifier = new VideoClassifier();

    // ═══════════════════════════════════════════════════
    // FORMAT DEFINITIONS — The core strategy matrix
    // ═══════════════════════════════════════════════════
    this.formats = {
      youtube_shorts: {
        lang: 'en',
        maxTitleLen: 80,
        maxDescLen: 5000,
        maxHashtags: 15,
        mustHave: '#Shorts',
        titleStyle: 'high_energy',
        descStyle: 'compact',
        ctaStyle: 'subscribe',
        hashtagLayers: ['trending_en', 'niche_en', 'broad', 'yt_shorts'],
      },
      youtube_long: {
        lang: 'vi',
        maxTitleLen: 100,
        maxDescLen: 5000,
        maxHashtags: 15,
        mustHave: null,
        titleStyle: 'informative',
        descStyle: 'detailed',
        ctaStyle: 'subscribe_vi',
        hashtagLayers: ['trending_vi', 'trending_en', 'niche_vi', 'niche_en', 'broad'],
      },
      facebook_reels: {
        lang: 'vi',
        maxTitleLen: 100,
        maxDescLen: 2200,
        maxHashtags: 30,
        mustHave: null,
        titleStyle: 'engagement',
        descStyle: 'social',
        ctaStyle: 'follow_vi',
        hashtagLayers: ['trending_vi', 'trending_en', 'niche_vi', 'broad', 'fb_reels'],
      },
    };

    // ═══════════════════════════════════════════════════
    // HASHTAG POOLS — Dual-language per genre
    // ═══════════════════════════════════════════════════
    this.hashtagPools = {
      gaming: {
        trending_en: ['#gaming', '#gamer', '#gamingcommunity', '#epicgaming', '#gaminglife', '#gamingsetup'],
        trending_vi: ['#gameviet', '#gamethu', '#chơigame', '#lướtgame', '#gamethủ', '#gamediđộng'],
        niche_en: ['#gameplay', '#gamingclips', '#gamingmoments', '#progamer', '#esports', '#streamer', '#twitch'],
        niche_vi: ['#lienquan', '#freefire', '#pubgmobile', '#valorantvn', '#genshinimpact', '#minecraft'],
        broad: ['#viral', '#fyp', '#trending', '#foryou', '#explore'],
        yt_shorts: ['#Shorts', '#GamingShorts', '#ShortsFeed', '#YouTubeShorts'],
        fb_reels: ['#reels', '#fbreels', '#reelsfb', '#facebookreels', '#reelsviral'],
      },
      comedy: {
        trending_en: ['#funny', '#comedy', '#humor', '#lol', '#comedycentral', '#funnyvideos'],
        trending_vi: ['#hàihước', '#hài', '#cười', '#tấuhài', '#giảitrí', '#hàivl', '#hàivn'],
        niche_en: ['#trynottolaugh', '#memes', '#comedyshow', '#funnymoments', '#jokes', '#skit'],
        niche_vi: ['#hàiviệt', '#cườibểbụng', '#tấuhàiviệt', '#haihướcvl', '#clipvui', '#videohài'],
        broad: ['#viral', '#fyp', '#trending', '#foryou', '#explore'],
        yt_shorts: ['#Shorts', '#FunnyShorts', '#ShortsFeed'],
        fb_reels: ['#reels', '#fbreels', '#reelsviral', '#reelsfunny'],
      },
      music: {
        trending_en: ['#music', '#musician', '#newmusic', '#song', '#musicvideo', '#singer'],
        trending_vi: ['#nhạc', '#nhạctrẻ', '#vpop', '#nhạchay', '#nhạcchill', '#bảnhitmới'],
        niche_en: ['#musicproducer', '#singersongwriter', '#livemusic', '#musiccover', '#remix', '#acoustic'],
        niche_vi: ['#nhạcviệt', '#nhạcbolero', '#nhạcedm', '#coverlov', '#nhạclofi', '#chiasẻnhạc'],
        broad: ['#viral', '#fyp', '#trending', '#foryou', '#explore'],
        yt_shorts: ['#Shorts', '#MusicShorts', '#ShortsFeed'],
        fb_reels: ['#reels', '#fbreels', '#reelsviral', '#nhạcreels'],
      },
      food: {
        trending_en: ['#food', '#foodie', '#cooking', '#recipe', '#yummy', '#delicious'],
        trending_vi: ['#ẩmthực', '#nấuăn', '#mónăn', '#đồăn', '#ănthử', '#reviewăn'],
        niche_en: ['#foodporn', '#homecooking', '#streetfood', '#mukbang', '#foodreview', '#asmrfood'],
        niche_vi: ['#mónăngon', '#nấuănngon', '#ănvặt', '#ănsập', '#foodviệt', '#clipnấuăn'],
        broad: ['#viral', '#fyp', '#trending', '#foryou', '#explore'],
        yt_shorts: ['#Shorts', '#FoodShorts', '#CookingShorts'],
        fb_reels: ['#reels', '#fbreels', '#reelsviral', '#foodreels'],
      },
      tech: {
        trending_en: ['#tech', '#technology', '#gadgets', '#innovation', '#techreview', '#ai'],
        trending_vi: ['#côngnghệ', '#đánhgiá', '#mởhộp', '#điệnthoại', '#máytính', '#thủthuật'],
        niche_en: ['#smartphone', '#unboxing', '#techtips', '#techlife', '#programming', '#apple'],
        niche_vi: ['#côngnghệmới', '#đánhgiáđiệnthoại', '#laptopgiárẻ', '#iphonemới', '#thủthuậtcôngnghệ'],
        broad: ['#viral', '#fyp', '#trending', '#foryou', '#explore'],
        yt_shorts: ['#Shorts', '#TechShorts', '#ShortsFeed'],
        fb_reels: ['#reels', '#fbreels', '#techreels'],
      },
      beauty: {
        trending_en: ['#beauty', '#makeup', '#skincare', '#fashion', '#glam', '#cosmetics'],
        trending_vi: ['#làmđẹp', '#trangđiểm', '#dưỡngda', '#thờitrang', '#reviewmỹphẩm', '#skincareroutine'],
        niche_en: ['#beautytips', '#makeuptutorial', '#skincareroutine', '#ootd', '#grwm', '#nails'],
        niche_vi: ['#mỹphẩm', '#kem chống nắng', '#serum', '#trangđiểmtựnhiên', '#đồnội', '#bíquyếtlàmđẹp'],
        broad: ['#viral', '#fyp', '#trending', '#foryou', '#explore'],
        yt_shorts: ['#Shorts', '#BeautyShorts', '#GRWMShorts'],
        fb_reels: ['#reels', '#fbreels', '#beautyreels'],
      },
      sports: {
        trending_en: ['#sports', '#football', '#basketball', '#fitness', '#workout', '#goals'],
        trending_vi: ['#thểthao', '#bóngđá', '#tậpgym', '#thểhình', '#bànthắng', '#đápháp'],
        niche_en: ['#sportsclips', '#highlights', '#training', '#athlete', '#nba', '#premierleague'],
        niche_vi: ['#bóngđáviệtnam', '#tậpluyện', '#thểthaoviệt', '#cầuthủ', '#sânbóng'],
        broad: ['#viral', '#fyp', '#trending', '#foryou', '#explore'],
        yt_shorts: ['#Shorts', '#SportsShorts', '#ShortsFeed'],
        fb_reels: ['#reels', '#fbreels', '#sportsreels'],
      },
      education: {
        trending_en: ['#education', '#learn', '#knowledge', '#science', '#facts', '#tips'],
        trending_vi: ['#kiếnthức', '#học', '#khoahọc', '#tìmhiểu', '#chiasẻ', '#mẹovặt'],
        niche_en: ['#educational', '#didyouknow', '#learning', '#study', '#tutorial', '#lifehacks'],
        niche_vi: ['#hướngdẫn', '#bíquyết', '#thủthuật', '#khoahọcviệt', '#khoahọc', '#tiếnganh'],
        broad: ['#viral', '#fyp', '#trending', '#foryou', '#explore'],
        yt_shorts: ['#Shorts', '#LearnOnShorts', '#ShortsFeed'],
        fb_reels: ['#reels', '#fbreels', '#educationreels'],
      },
      animals: {
        trending_en: ['#pets', '#cute', '#animals', '#dogs', '#cats', '#puppy'],
        trending_vi: ['#thúcưng', '#chó', '#mèo', '#đángyêu', '#độngvật', '#chómèo'],
        niche_en: ['#cuteanimals', '#petlover', '#doglover', '#catlover', '#puppies', '#kitten'],
        niche_vi: ['#chócưng', '#mèocưng', '#nuôithúcưng', '#chóshiba', '#mèoba tư', '#thúnuôi'],
        broad: ['#viral', '#fyp', '#trending', '#foryou', '#adorable'],
        yt_shorts: ['#Shorts', '#PetShorts', '#CuteShorts'],
        fb_reels: ['#reels', '#fbreels', '#petreels'],
      },
      travel: {
        trending_en: ['#travel', '#wanderlust', '#explore', '#adventure', '#travelgram', '#vacation'],
        trending_vi: ['#dulịch', '#khámphá', '#phượt', '#checkin', '#vietnam', '#đinơi'],
        niche_en: ['#travelvlog', '#traveltips', '#beautifuldestinations', '#backpacking', '#roadtrip', '#beach'],
        niche_vi: ['#dulịchviệtnam', '#dulịchgiárẻ', '#cảnhđẹpviệtnam', '#điểmcheck in', '#khámphávn'],
        broad: ['#viral', '#fyp', '#trending', '#foryou', '#explore'],
        yt_shorts: ['#Shorts', '#TravelShorts', '#ShortsFeed'],
        fb_reels: ['#reels', '#fbreels', '#travelreels'],
      },
      asmr: {
        trending_en: ['#asmr', '#satisfying', '#relaxing', '#oddlysatisfying', '#asmrtriggers', '#asmrsounds'],
        trending_vi: ['#asmrviệtnam', '#thưgiãn', '#asmrnấuăn', '#asmrviệt', '#thưgiãntinh thần'],
        niche_en: ['#asmrvideo', '#asmrsleep', '#tingles', '#relax', '#crunchy', '#slime'],
        niche_vi: ['#asmrnấuăn', '#asmrdọndẹp', '#giảistress'],
        broad: ['#viral', '#fyp', '#trending', '#foryou', '#explore'],
        yt_shorts: ['#Shorts', '#ASMRShorts', '#SatisfyingShorts'],
        fb_reels: ['#reels', '#fbreels', '#asmrreels'],
      },
      news: {
        trending_en: ['#news', '#breaking', '#update', '#trending', '#latest', '#world'],
        trending_vi: ['#tintức', '#thờisự', '#nóng', '#mớinhất', '#cậpnhật', '#tintứcmới'],
        niche_en: ['#breakingnews', '#worldnews', '#newsupdate', '#headlines', '#report', '#politics'],
        niche_vi: ['#tintứcviệtnam', '#thờisựviệt', '#tintứcnóng', '#tintứcmới nhất', '#tinmới'],
        broad: ['#viral', '#fyp', '#trending', '#foryou', '#explore'],
        yt_shorts: ['#Shorts', '#NewsShorts', '#ShortsFeed'],
        fb_reels: ['#reels', '#fbreels', '#newsreels'],
      },
      entertainment: {
        trending_en: ['#entertainment', '#viral', '#trending', '#celebrity', '#drama', '#reaction'],
        trending_vi: ['#giảitrí', '#xuhướng', '#viral', '#drama', '#hot', '#tổnghợp'],
        niche_en: ['#viralvideos', '#incredible', '#amazing', '#mustwatch', '#compilation', '#satisfying'],
        niche_vi: ['#cliphot', '#videohot', '#tổnghợpviral', '#dramaviệt', '#giảitríviệt'],
        broad: ['#viral', '#fyp', '#trending', '#foryou', '#explore'],
        yt_shorts: ['#Shorts', '#ShortsFeed', '#YouTubeShorts'],
        fb_reels: ['#reels', '#fbreels', '#reelsviral'],
      },
    };

    // ═══════════════════════════════════════════════════
    // HOOKS — Bilingual, format-aware
    // ═══════════════════════════════════════════════════
    this.hooks = {
      en: {
        gaming: [
          '🎮 This gameplay is INSANE!',
          '⚡ Wait for the ending...',
          '🔥 Best gaming moment you\'ll see today!',
          '💥 Can you do this?!',
          '😱 NO WAY this just happened!',
          '🏆 This is why I\'m the GOAT!',
        ],
        comedy: [
          '😂 I can\'t stop laughing!',
          '🤣 This got me SO good!',
          '💀 Wait for it... TOO FUNNY!',
          '😭 Why is this SO relatable?!',
          '😂 TRY NOT TO LAUGH challenge!',
        ],
        music: [
          '🎵 This song hits DIFFERENT!',
          '🎶 Put your headphones on!',
          '✨ Can\'t stop replaying this!',
          '🔥 This beat is FIRE!',
        ],
        food: [
          '🍜 This looks SO GOOD!',
          '😋 You NEED to try this!',
          '🔥 Best food content TODAY!',
          '🤤 My mouth is WATERING!',
        ],
        tech: [
          '📱 This changes EVERYTHING!',
          '🤯 Mind blown by this tech!',
          '💻 Best tech tip TODAY!',
          '⚡ You NEED this gadget!',
        ],
        beauty: [
          '💄 STUNNING transformation!',
          '✨ Glow up goals!',
          '💅 This beauty hack is GENIUS!',
        ],
        sports: [
          '⚽ INCREDIBLE play!',
          '🏆 This athlete is NEXT LEVEL!',
          '💪 Jaw-dropping performance!',
        ],
        animals: [
          '🐶 The CUTEST thing today!',
          '❤️ This will melt your heart!',
          '😍 SO adorable it hurts!',
        ],
        travel: [
          '✈️ Paradise FOUND!',
          '🌍 This place is UNREAL!',
          '📸 Bucket list destination!',
        ],
        education: [
          '🧠 I wish I knew this sooner!',
          '💡 Mind-blowing FACT!',
          '📚 Learn something NEW today!',
        ],
        asmr: [
          '😴 So SATISFYING!',
          '✨ Pure RELAXATION!',
          '🎧 Turn up your volume!',
        ],
        news: [
          '🚨 BREAKING NEWS!',
          '⚠️ You need to see this!',
          '📢 This is HUGE!',
        ],
        entertainment: [
          '🔥 This is INSANE!',
          '😱 Wait for the ending!',
          '💯 MUST watch this!',
        ],
      },
      vi: {
        gaming: [
          '🎮 Pha chơi này ĐIÊN thật sự!',
          '⚡ Xem đến cuối mà chấn động!',
          '🔥 Khoảnh khắc ĐỈNH nhất hôm nay!',
          '💥 Ai làm được thế này?!',
          '😱 KHÔNG TIN NỔI đây là thật!',
          '🏆 Tay to mới chơi được thế này!',
        ],
        comedy: [
          '😂 Cười ĐAU BỤNG luôn!',
          '🤣 Xem đi rồi cười!',
          '💀 Xem đến cuối... CƯỜI SẶC!',
          '😭 Sao mà ĐÚNG QUÁ vậy trời!',
          '😂 Thử nhịn cười đi, KHÔNG THỂ ĐÂU!',
        ],
        music: [
          '🎵 Bài này hay ĐỈNH!',
          '🎶 Đeo tai nghe vào nghe đi!',
          '✨ Nghe hoài không chán!',
          '🔥 Beat này GHÊ THIỆT!',
        ],
        food: [
          '🍜 Nhìn mà THÈM quá!',
          '😋 PHẢI thử ngay công thức này!',
          '🔥 Món ĂN NGON nhất hôm nay!',
          '🤤 Chảy nước miếng luôn á!',
        ],
        tech: [
          '📱 Cái này thay đổi TẤT CẢ!',
          '🤯 Sốc với công nghệ này!',
          '💻 Mẹo hay NHẤT hôm nay!',
          '⚡ BẠN CẦN cái này ngay!',
        ],
        beauty: [
          '💄 Biến hình XUẤT SẮC!',
          '✨ Lên đời nhan sắc!',
          '💅 Mẹo làm đẹp THIÊN TÀI!',
        ],
        sports: [
          '⚽ Pha bóng KHÔNG TƯỞNG!',
          '🏆 Vận động viên SIÊU NHÂN!',
          '💪 Màn trình diễn ĐỈNH CAO!',
        ],
        animals: [
          '🐶 CUTE nhất hôm nay!',
          '❤️ Xem là TAN CHẢY liền!',
          '😍 ĐÁNG YÊU quá trời!',
        ],
        travel: [
          '✈️ Thiên đường là ĐÂY!',
          '🌍 Nơi này CÓ THẬT sao?!',
          '📸 Phải đi ngay kẻo lỡ!',
        ],
        education: [
          '🧠 Biết sớm đã XÀI lâu rồi!',
          '💡 Kiến thức HAY KHỎI BÀN!',
          '📚 Học điều MỚI hôm nay!',
        ],
        asmr: [
          '😴 ĐÃ quá đi thôi!',
          '✨ Thư giãn TUYỆT VỜI!',
          '🎧 Mở âm lượng lên đi!',
        ],
        news: [
          '🚨 TIN NÓNG mới nhất!',
          '⚠️ Bạn CẦN biết điều này!',
          '📢 Quá SỐC luôn!',
        ],
        entertainment: [
          '🔥 ĐIÊN THẬT SỰ!',
          '😱 Xem đến cuối mới HIỂU!',
          '💯 PHẢI xem ngay!',
        ],
      },
    };

    // ═══════════════════════════════════════════════════
    // CTAs — Bilingual
    // ═══════════════════════════════════════════════════
    this.ctas = {
      subscribe: [
        '👍 Like & Subscribe for more!',
        '🔔 Turn on notifications!',
        '💬 Comment what you think!',
        '📢 Share with a friend!',
        '➡️ Follow for more!',
      ],
      subscribe_vi: [
        '👍 Nhấn Like & Subscribe để ủng hộ!',
        '🔔 Bật chuông thông báo để không bỏ lỡ!',
        '💬 Bình luận ý kiến của bạn!',
        '📢 Chia sẻ cho bạn bè cùng xem!',
        '➡️ Follow để xem thêm nội dung hay!',
      ],
      follow_vi: [
        '❤️ Thả tim & Follow để xem thêm!',
        '💬 Tag bạn bè cùng xem nào!',
        '📢 Share nếu bạn thích!',
        '👇 Bình luận bên dưới nhé!',
        '🔥 Follow để cập nhật video mới!',
      ],
    };

    // ═══════════════════════════════════════════════════
    // DESCRIPTION TEMPLATES — Format-specific
    // ═══════════════════════════════════════════════════
    this.descTemplates = {
      compact: '{hook}\n\n{hashtags}\n\n{cta}',
      detailed: '{hook}\n\n{description}\n\n{affiliateBlock}\n\n{hashtags}\n\n{cta}',
      social: '{emojis} {hook}\n\n{description}\n\n{affiliateBlock}\n\n{hashtags}',
    };

    // ═══════════════════════════════════════════════════
    // AFFILIATE LINK SYSTEM (placeholder for future)
    // ═══════════════════════════════════════════════════
    this.affiliateEnabled = false;
    this.affiliateLinks = {};

    // ═══════════════════════════════════════════════════
    // AI CONTENT HOOKS (placeholder for future)
    // ═══════════════════════════════════════════════════
    this.aiProvider = null; // 'gemini' | 'chatgpt' | null
    this.aiApiKey = null;
  }

  // ═══════════════════════════════════════════════════════
  // MAIN OPTIMIZE PIPELINE
  // ═══════════════════════════════════════════════════════

  /**
   * @param {object} video - { title, description, tags, channelName }
   * @param {object} options - { format, platform, customCategory, forceClassification }
   *
   * format:  'youtube_shorts' | 'youtube_long' | 'facebook_reels'
   * platform is kept for backward compat: 'youtube' -> youtube_shorts, 'facebook' -> facebook_reels
   */
  optimize(video, options = {}) {
    // Resolve format from platform (backward compat)
    let format = options.format;
    if (!format) {
      if (options.platform === 'facebook') {
        format = 'facebook_reels';
      } else {
        // Default to youtube_shorts for short videos
        format = 'youtube_shorts';
      }
    }

    const fmt = this.formats[format] || this.formats.youtube_shorts;
    const lang = fmt.lang;

    // Step 1: Classify video
    const classification = options.forceClassification ||
      this.classifier.classify(video);
    const genre = options.customCategory || classification.genre;

    // Step 2: Optimize title
    const title = this._optimizeTitle(video.title, genre, format, fmt, classification);

    // Step 3: Generate hashtags
    const hashtags = this._generateHashtags(genre, fmt, video.tags);

    // Step 4: Generate description
    const seoHints = this.classifier.getSEOHints(genre);
    const description = this._generateDescription(video, {
      format, fmt, genre, hashtags, seoHints, classification, lang,
    });

    // Step 5: Generate YouTube API tags
    const tags = this._generateTags(genre, video.tags, title, lang);

    // Step 6: Calculate SEO score
    const seoScore = this._calculateSEOScore(title, description, hashtags, tags, format, fmt);

    logger.info(`📈 SEO: ${seoScore}/100 | ${genre} | ${format} | lang=${lang}`);

    return {
      title,
      description,
      hashtags,
      tags,
      classification,
      seoScore,
      genre,
      format,
      language: lang,
    };
  }

  // ═══════════════════════════════════════════════════════
  // TITLE OPTIMIZATION
  // ═══════════════════════════════════════════════════════

  _optimizeTitle(originalTitle, genre, format, fmt, classification) {
    let title = (originalTitle || 'Video').trim();

    // Clean existing hashtags and junk
    title = title.replace(/#[^\s]+/g, '').replace(/\s+/g, ' ').trim();

    const hints = this.classifier.getSEOHints(genre);
    const lang = fmt.lang;

    // Emoji prefix
    const emoji = hints.emojis.slice(0, 2);
    if (!/[\u{1F600}-\u{1FFFF}]/u.test(title.slice(0, 3))) {
      title = `${emoji} ${title}`;
    }

    // Format-specific title strategies
    if (format === 'youtube_shorts') {
      // YT Shorts: English, high-energy, CAPS emphasis
      // Short punchy title
      if (title.length > fmt.maxTitleLen - 10) {
        title = title.slice(0, fmt.maxTitleLen - 13) + '...';
      }
      // Must have #Shorts
      if (!title.toLowerCase().includes('#shorts')) {
        title += ' #Shorts';
      }
    } else if (format === 'youtube_long') {
      // YT Long: Vietnamese, informative, keyword-rich
      if (title.length > fmt.maxTitleLen) {
        title = title.slice(0, fmt.maxTitleLen - 3) + '...';
      }
      // Add genre hint in Vietnamese if title is short
      if (title.length < 40) {
        const viHints = {
          gaming: '| Gameplay Đỉnh Cao',
          comedy: '| Hài Hước VL',
          music: '| Nhạc Hay Nhất',
          food: '| Ẩm Thực Tuyệt Vời',
          tech: '| Review Công Nghệ',
          beauty: '| Bí Quyết Làm Đẹp',
          sports: '| Thể Thao Đỉnh',
          education: '| Kiến Thức Hay',
          animals: '| Thú Cưng Cute',
          travel: '| Du Lịch Khám Phá',
          asmr: '| ASMR Thư Giãn',
          news: '| Tin Tức Nóng',
          entertainment: '| Giải Trí Hot',
        };
        if (viHints[genre]) title += ` ${viHints[genre]}`;
      }
    } else if (format === 'facebook_reels') {
      // FB Reels: Vietnamese, engagement-optimized
      if (title.length > fmt.maxTitleLen) {
        title = title.slice(0, fmt.maxTitleLen - 3) + '...';
      }
      // Trailing emoji for FB engagement
      const lastEmoji = hints.emojis.slice(-2);
      if (title.length < 90) {
        title += ` ${lastEmoji}`;
      }
    }

    return title;
  }

  // ═══════════════════════════════════════════════════════
  // HASHTAG GENERATION — Format-aware layering
  // ═══════════════════════════════════════════════════════

  _generateHashtags(genre, fmt, originalTags) {
    const pool = this.hashtagPools[genre] || this.hashtagPools.entertainment;
    const hashtags = new Set();

    // Apply layers based on format config
    for (const layer of fmt.hashtagLayers) {
      const layerTags = pool[layer];
      if (!layerTags) continue;

      // Pick 3-5 from each layer
      const count = layer.startsWith('broad') || layer.startsWith('yt_') || layer.startsWith('fb_') ? 3 : 4;
      this._pickRandom(layerTags, count).forEach(h => hashtags.add(h));
    }

    // Add original video tags (cleaned)
    if (originalTags) {
      const tags = typeof originalTags === 'string' ?
        ((() => { try { return JSON.parse(originalTags); } catch { return originalTags.split(','); } })()) :
        originalTags;

      tags.slice(0, 3).forEach(t => {
        const clean = t.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, '').toLowerCase();
        if (clean.length > 2 && clean.length < 25) {
          hashtags.add(`#${clean}`);
        }
      });
    }

    return [...hashtags].slice(0, fmt.maxHashtags);
  }

  // ═══════════════════════════════════════════════════════
  // DESCRIPTION GENERATION
  // ═══════════════════════════════════════════════════════

  _generateDescription(video, opts) {
    const { format, fmt, genre, hashtags, seoHints, lang } = opts;

    const template = this.descTemplates[fmt.descStyle] || this.descTemplates.compact;

    // Clean original description
    let originalDesc = (video.description || '').trim();
    originalDesc = originalDesc
      .replace(/https?:\/\/[^\s]+/g, '')
      .replace(/(#\w+\s*){4,}/g, '')
      .replace(/subscribe|follow|like\s+and\s+share|sub\s+for\s+more/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (originalDesc.length > 350) originalDesc = originalDesc.slice(0, 350) + '...';

    // Generate components
    const hook = this._generateHook(genre, lang);
    const cta = this._generateCTA(fmt.ctaStyle);
    const affiliateBlock = this._getAffiliateBlock(genre);

    // Build
    let desc = template
      .replace('{hook}', hook)
      .replace('{description}', originalDesc || hook)
      .replace('{hashtags}', hashtags.join(' '))
      .replace('{cta}', cta)
      .replace('{emojis}', seoHints.emojis.slice(0, 4))
      .replace('{affiliateBlock}', affiliateBlock);

    // Clean double newlines from empty blocks
    desc = desc.replace(/\n{3,}/g, '\n\n').trim();

    return desc.slice(0, fmt.maxDescLen);
  }

  _generateHook(genre, lang) {
    const langHooks = this.hooks[lang] || this.hooks.en;
    const genreHooks = langHooks[genre] || langHooks.entertainment;
    return genreHooks[Math.floor(Math.random() * genreHooks.length)];
  }

  _generateCTA(style) {
    const ctas = this.ctas[style] || this.ctas.subscribe;
    return ctas[Math.floor(Math.random() * ctas.length)];
  }

  // ═══════════════════════════════════════════════════════
  // TAG GENERATION (YouTube API)
  // ═══════════════════════════════════════════════════════

  _generateTags(genre, originalTags, title, lang) {
    const tags = new Set();
    const pool = this.hashtagPools[genre] || this.hashtagPools.entertainment;

    // EN trending + niche always included
    [...(pool.trending_en || []), ...(pool.niche_en || [])].forEach(h => {
      tags.add(h.replace('#', ''));
    });

    // If lang=vi, also include Vietnamese tags
    if (lang === 'vi') {
      [...(pool.trending_vi || []), ...(pool.niche_vi || [])].forEach(h => {
        tags.add(h.replace('#', ''));
      });
    }

    // Keywords from title
    const titleWords = (title || '').toLowerCase()
      .replace(/[^a-zA-Z0-9\s\u00C0-\u024F\u1E00-\u1EFF]/g, '')
      .split(/\s+/).filter(w => w.length > 3);
    titleWords.slice(0, 5).forEach(w => tags.add(w));

    // Original tags
    if (originalTags) {
      const parsed = typeof originalTags === 'string' ?
        ((() => { try { return JSON.parse(originalTags); } catch { return originalTags.split(','); } })()) :
        originalTags;
      parsed.slice(0, 8).forEach(t => tags.add(t.trim().toLowerCase()));
    }

    // YouTube limit: 500 chars
    const result = [];
    let total = 0;
    for (const tag of tags) {
      if (total + tag.length + 1 > 480) break;
      result.push(tag);
      total += tag.length + 1;
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════
  // SEO SCORE
  // ═══════════════════════════════════════════════════════

  _calculateSEOScore(title, description, hashtags, tags, format, fmt) {
    let score = 0;

    // Title (30 pts)
    if (title.length >= 30 && title.length <= fmt.maxTitleLen) score += 10;
    if (/[\u{1F600}-\u{1FFFF}]/u.test(title)) score += 5;
    if (/[A-Z]{2,}/.test(title)) score += 3;
    if (/[!?]/.test(title)) score += 5;
    if (format === 'youtube_shorts' && title.includes('#Shorts')) score += 7;
    if (format === 'youtube_long' && /[\u00C0-\u024F\u1E00-\u1EFF]/.test(title)) score += 7; // Has Vietnamese
    if (format === 'facebook_reels' && /[\u00C0-\u024F\u1E00-\u1EFF]/.test(title)) score += 7;

    // Description (25 pts)
    if (description.length >= 50) score += 5;
    if (description.length >= 150) score += 5;
    if (description.includes('#')) score += 5;
    if (/like|subscribe|follow|share|comment|thả tim|nhấn like|chia sẻ|bình luận/i.test(description)) score += 5;
    if (/[\u{1F600}-\u{1FFFF}]/u.test(description)) score += 5;

    // Hashtags (25 pts)
    if (hashtags.length >= 5) score += 5;
    if (hashtags.length >= 10) score += 5;
    if (hashtags.length >= 15) score += 5;
    // Format-appropriate hashtag check
    if (format === 'youtube_shorts' && hashtags.includes('#Shorts')) score += 5;
    if (format === 'facebook_reels' && hashtags.some(h => h.includes('reels'))) score += 5;
    if (format !== 'youtube_shorts') {
      // Vietnamese hashtags bonus for VN formats
      const viTags = hashtags.filter(h => /[\u00C0-\u024F\u1E00-\u1EFF]/.test(h));
      if (viTags.length >= 2) score += 5;
    }

    // Tags (20 pts)
    if (tags.length >= 5) score += 5;
    if (tags.length >= 10) score += 5;
    if (tags.length >= 15) score += 5;
    if (tags.length >= 20) score += 5;

    return Math.min(100, score);
  }

  // ═══════════════════════════════════════════════════════
  // AFFILIATE LINK SYSTEM (placeholder)
  // ═══════════════════════════════════════════════════════

  /**
   * Configure affiliate links
   * @param {object} links - { [genre]: [{ label, url }] }
   */
  setAffiliateLinks(links) {
    this.affiliateLinks = links;
    this.affiliateEnabled = Object.keys(links).length > 0;
  }

  _getAffiliateBlock(genre) {
    if (!this.affiliateEnabled) return '';

    const links = this.affiliateLinks[genre] || this.affiliateLinks['*'] || [];
    if (links.length === 0) return '';

    const lines = links.map(l => `🔗 ${l.label}: ${l.url}`);
    return '━━━━━━━━━━━━━━━━━━━━━━\n' + lines.join('\n') + '\n━━━━━━━━━━━━━━━━━━━━━━';
  }

  // ═══════════════════════════════════════════════════════
  // AI CONTENT GENERATION HOOKS (placeholder)
  // ═══════════════════════════════════════════════════════

  /**
   * Configure AI provider for content generation
   * @param {string} provider - 'gemini' | 'chatgpt'
   * @param {string} apiKey - API key
   */
  configureAI(provider, apiKey) {
    this.aiProvider = provider;
    this.aiApiKey = apiKey;
    logger.info(`🤖 AI provider configured: ${provider}`);
  }

  /**
   * Generate AI-enhanced content (future implementation)
   * Will use Gemini/ChatGPT to:
   *   - Generate original descriptions/captions
   *   - Write blog posts / content articles
   *   - Create affiliate review content
   *   - Translate and localize content
   *
   * @param {object} video - Video metadata
   * @param {object} options - { style, length, lang, includeAffLinks }
   * @returns {Promise<{ title, description, content }>}
   */
  async generateAIContent(video, options = {}) {
    if (!this.aiProvider || !this.aiApiKey) {
      logger.warn('🤖 AI not configured. Use configureAI() first.');
      return null;
    }

    // Placeholder — will integrate Gemini/ChatGPT API here
    const prompt = this._buildAIPrompt(video, options);

    if (this.aiProvider === 'gemini') {
      // TODO: Integrate Google Gemini API
      // const response = await fetch('https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent', { ... });
      logger.info('🤖 Gemini AI content generation — ready for integration');
      return { prompt, provider: 'gemini', status: 'not_integrated' };
    } else if (this.aiProvider === 'chatgpt') {
      // TODO: Integrate OpenAI ChatGPT API
      // const response = await fetch('https://api.openai.com/v1/chat/completions', { ... });
      logger.info('🤖 ChatGPT content generation — ready for integration');
      return { prompt, provider: 'chatgpt', status: 'not_integrated' };
    }

    return null;
  }

  _buildAIPrompt(video, options) {
    const lang = options.lang || 'vi';
    const style = options.style || 'engaging';

    return {
      system: lang === 'vi'
        ? 'Bạn là chuyên gia SEO video và content creator. Viết nội dung hấp dẫn, viral cho mạng xã hội.'
        : 'You are a video SEO expert and content creator. Write engaging, viral content for social media.',
      user: lang === 'vi'
        ? `Viết mô tả SEO cho video: "${video.title}". Phong cách: ${style}. Bao gồm: hook mở đầu, nội dung chính, CTA.`
        : `Write SEO description for video: "${video.title}". Style: ${style}. Include: opening hook, main content, CTA.`,
      parameters: {
        maxTokens: options.length === 'long' ? 1000 : 300,
        temperature: 0.8,
        video,
        affiliateLinks: this.affiliateLinks,
      },
    };
  }

  // ═══════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════

  _pickRandom(arr, n) {
    const shuffled = [...arr].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, n);
  }

  /**
   * Get all supported formats with their config
   */
  getFormats() {
    return Object.entries(this.formats).map(([key, config]) => ({
      id: key,
      ...config,
    }));
  }
}

export default SEOOptimizer;
