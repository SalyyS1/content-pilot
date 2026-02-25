/**
 * Facebook Story Writer — AI-Generated Serial Stories via HTTP
 * 
 * Posts engaging English short stories on Facebook:
 * - Each story has 2 parts (cliffhanger → conclusion)
 * - Diverse genres: Mystery, Romance, Sci-Fi, Horror, Fantasy, etc.
 * - Aesthetic cover image from Lexica.art
 * - Posts via mbasic.facebook.com (cookies, no Playwright!)
 * - 2 posts per day (12h intervals)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import logger from '../core/logger.js';
import { getAccounts } from '../core/database.js';
import AIIntegration from '../seo/ai-integration.js';

// ============================================
//  GENRE CONFIGURATIONS
// ============================================
const GENRES = [
  'Mystery / Thriller',
  'Romance',
  'Sci-Fi',
  'Horror',
  'Fantasy',
  'Psychological Drama',
  'Adventure',
  'Slice of Life',
  'Dark Fantasy',
  'Dystopian',
];

const GENRE_IMAGE_KEYWORDS = {
  'Mystery / Thriller': ['dark detective noir city', 'mysterious shadow alley night', 'crime scene moody film noir'],
  'Romance': ['couple silhouette golden hour', 'love letters vintage aesthetic', 'rainy window romantic mood'],
  'Sci-Fi': ['futuristic cyberpunk city night', 'space station galaxy stars', 'neon lights dystopian'],
  'Horror': ['abandoned house fog dark', 'eerie forest night mist', 'creepy hallway shadow horror'],
  'Fantasy': ['magical enchanted forest glow', 'dragon castle epic landscape', 'wizard tower mystical aurora'],
  'Psychological Drama': ['lonely person rain window', 'broken mirror reflection dark', 'empty room dramatic light'],
  'Adventure': ['mountain expedition dramatic sky', 'ancient temple jungle explore', 'ocean storm ship dramatic'],
  'Slice of Life': ['cozy cafe warm light aesthetic', 'sunset rooftop city peaceful', 'bookshop window rain cozy'],
  'Dark Fantasy': ['dark throne gothic castle', 'demon angel battle dark art', 'cursed forest twisted trees'],
  'Dystopian': ['ruined city post apocalyptic', 'abandoned technology wasteland', 'surveillance dark society control'],
};

const HASHTAGS_BY_GENRE = {
  'Mystery / Thriller': '#mystery #thriller #darkstory #suspense #crime',
  'Romance': '#romance #lovestory #truelove #feelings #romanticstory',
  'Sci-Fi': '#scifi #futuristic #sciencefiction #space #technology',
  'Horror': '#horror #scary #creepy #darkfiction #nightmare',
  'Fantasy': '#fantasy #magic #epic #mythical #enchanted',
  'Psychological Drama': '#drama #psychology #deepstory #emotions #humanity',
  'Adventure': '#adventure #explore #journey #epic #quest',
  'Slice of Life': '#sliceoflife #peaceful #aesthetic #daily #warmth',
  'Dark Fantasy': '#darkfantasy #gothic #demon #darkness #epicfantasy',
  'Dystopian': '#dystopian #society #future #rebellion #survival',
};

// ============================================
//  STATE PERSISTENCE
// ============================================
const STATE_DIR = resolve(process.cwd(), 'data');
const STATE_FILE = join(STATE_DIR, 'story-writer-state.json');

function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    }
  } catch {}
  return { currentStory: null, storyCount: 0, genreHistory: [] };
}

function saveState(state) {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    logger.warn(`Failed to save story state: ${err.message}`);
  }
}

// ============================================
//  STORY WRITER CLASS
// ============================================
export class FacebookStatusPoster {
  constructor(options = {}) {
    this.isRunning = false;
    this._timer = null;
    this._intervalMs = (options.intervalHours || 12) * 60 * 60 * 1000;

    this.ai = new AIIntegration();
    this._state = loadState();

    this.stats = {
      totalPosted: 0,
      totalFailed: 0,
      storiesCompleted: this._state.storyCount || 0,
      aiGenerated: 0,
      lastPostedAt: null,
      lastStoryTitle: this._state.currentStory?.title || null,
      currentPart: this._state.currentStory?.currentPart || null,
      currentGenre: this._state.currentStory?.genre || null,
      startedAt: null,
    };
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.stats.startedAt = new Date().toISOString();

    const aiStatus = this.ai.hasChatGPT ? 'ChatGPT ✓' : this.ai.hasGemini ? 'Gemini ✓' : '⚠️ No AI';
    logger.info(`📖 Story Writer STARTED (AI: ${aiStatus})`);
    logger.info(`  Mode: 2 parts/day, 12h intervals`);
    logger.info(`  Stories completed: ${this.stats.storiesCompleted}`);

    // Start first cycle
    this._postCycle();
  }

  stop() {
    this.isRunning = false;
    if (this._timer) clearTimeout(this._timer);
    saveState(this._state);
    this.ai.close();
    logger.info('⏹️ Story Writer STOPPED');
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      ...this.stats,
      intervalHours: this._intervalMs / 3600000,
      aiAvailable: this.ai.hasChatGPT || this.ai.hasGemini,
      aiProvider: this.ai.hasChatGPT ? 'ChatGPT' : this.ai.hasGemini ? 'Gemini' : 'None',
      currentStory: this._state.currentStory ? {
        title: this._state.currentStory.title,
        genre: this._state.currentStory.genre,
        currentPart: this._state.currentStory.currentPart,
      } : null,
    };
  }

  // ============================================
  //  GENRE SELECTION
  // ============================================
  _pickGenre() {
    // Avoid repeating recent genres
    const recent = this._state.genreHistory || [];
    const available = GENRES.filter(g => !recent.slice(-3).includes(g));
    const list = available.length > 0 ? available : GENRES;
    const genre = list[Math.floor(Math.random() * list.length)];

    // Track genre history
    this._state.genreHistory = [...recent, genre].slice(-10);
    return genre;
  }

  // ============================================
  //  AI STORY GENERATION
  // ============================================
  async _generatePart1(genre) {
    const prompt = `You are a bestselling fiction author. Write Part 1 of a 2-part short story.

GENRE: ${genre}
LANGUAGE: English
LENGTH: 400-600 words

REQUIREMENTS:
- Start with a compelling title on the first line (just the title, no "Title:" prefix)
- Immediately hook the reader in the first sentence
- Build tension and intrigue throughout
- End Part 1 with a DRAMATIC CLIFFHANGER that makes readers desperate for Part 2
- Use vivid, cinematic descriptions
- Create memorable characters with distinct voices
- Write in a modern, engaging style

FORMAT:
[Title on first line]
[Empty line]
[Story text...]

IMPORTANT: ONLY return the title and story. No labels like "Part 1" or "Title:". Just the raw story.`;

    const result = await this.ai.chatgpt(prompt, { temperature: 0.85 })
      || await this.ai.gemini(prompt, { temperature: 0.85, maxTokens: 2048 });

    if (!result) return null;

    // Parse title from first line
    const lines = result.trim().split('\n');
    const title = lines[0].replace(/^[#*"\-]+\s*/, '').replace(/[#*"]+$/, '').trim();
    const body = lines.slice(1).join('\n').trim();

    return { title, body, fullText: result.trim() };
  }

  async _generatePart2(title, genre, part1Summary) {
    const prompt = `You are a bestselling fiction author. Write Part 2 (FINAL) of a 2-part short story.

STORY TITLE: "${title}"
GENRE: ${genre}
PREVIOUS PART SUMMARY: ${part1Summary}
LANGUAGE: English
LENGTH: 400-600 words

REQUIREMENTS:
- Continue EXACTLY where Part 1 left off
- Resolve the cliffhanger in a surprising way
- Build to an emotional or dramatic climax
- End with a satisfying but memorable conclusion (can be bittersweet, twist ending, or hopeful)
- Maintain the same tone and style as Part 1
- Use vivid, cinematic writing

FORMAT: Just write the story continuation. No title needed. No "Part 2" label.
IMPORTANT: ONLY return the story text. No meta commentary.`;

    return await this.ai.chatgpt(prompt, { temperature: 0.85 })
      || await this.ai.gemini(prompt, { temperature: 0.85, maxTokens: 2048 });
  }

  _summarizePart1(body) {
    // Quick summary for Part 2 context (first ~200 chars + last ~200 chars)
    if (body.length <= 400) return body;
    return body.slice(0, 200) + ' [...] ' + body.slice(-200);
  }

  // ============================================
  //  IMAGE SEARCH (Lexica.art — free, no API key)
  // ============================================
  async _searchImage(genre) {
    try {
      const keywords = GENRE_IMAGE_KEYWORDS[genre] || ['dark aesthetic art moody'];
      const keyword = keywords[Math.floor(Math.random() * keywords.length)];

      const res = await fetch(`https://lexica.art/api/v1/search?q=${encodeURIComponent(keyword)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0' },
      });

      if (!res.ok) {
        logger.warn(`Lexica.art search failed: HTTP ${res.status}`);
        return null;
      }

      const data = await res.json();
      const images = data.images || [];

      if (images.length > 0) {
        // Pick a random image from top 20 results
        const top = images.slice(0, 20);
        const img = top[Math.floor(Math.random() * top.length)];
        logger.debug(`🖼️ Found image: ${img.src?.slice(0, 60)}...`);
        return img.src || img.srcSmall;
      }

      return null;
    } catch (err) {
      logger.warn(`Image search failed: ${err.message}`);
      return null;
    }
  }

  async _downloadImage(url) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 Chrome/122.0.0.0' },
      });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      logger.warn(`Image download failed: ${err.message}`);
      return null;
    }
  }

  // ============================================
  //  FACEBOOK POSTING via mbasic (HTTP only!)
  // ============================================

  /**
   * Post text-only status via mbasic.facebook.com
   */
  async _postTextOnly(cookieString, text) {
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12; SM-G991U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
        'Cookie': cookieString,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      };

      // GET mbasic homepage → extract fb_dtsg + compose form
      const homeRes = await fetch('https://mbasic.facebook.com/', { headers, redirect: 'follow' });
      const homeHtml = await homeRes.text();

      // Extract fb_dtsg
      const dtsgMatch = homeHtml.match(/name="fb_dtsg"\s+value="([^"]+)"/)
        || homeHtml.match(/fb_dtsg.*?value="([^"]+)"/s);
      if (!dtsgMatch) {
        throw new Error('Could not find fb_dtsg — cookie may be expired');
      }
      const fbDtsg = dtsgMatch[1];

      // Extract compose form action
      const formMatch = homeHtml.match(/action="(\/composer\/mbasic\/[^"]+)"/);
      const formAction = formMatch ? formMatch[1].replace(/&amp;/g, '&') : '/composer/mbasic/';

      // Extract additional hidden fields
      const jazoestMatch = homeHtml.match(/name="jazoest"\s+value="([^"]+)"/);
      const privacyMatch = homeHtml.match(/name="privacyx"\s+value="([^"]+)"/);

      // POST status
      const formData = new URLSearchParams();
      formData.append('fb_dtsg', fbDtsg);
      if (jazoestMatch) formData.append('jazoest', jazoestMatch[1]);
      if (privacyMatch) formData.append('privacyx', privacyMatch[1]);
      formData.append('xc_message', text);
      formData.append('view_photo', 'Submit');

      const postRes = await fetch(`https://mbasic.facebook.com${formAction}`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://mbasic.facebook.com/',
        },
        body: formData.toString(),
        redirect: 'follow',
      });

      if (postRes.ok || postRes.status === 302) {
        return { success: true };
      }
      throw new Error(`HTTP ${postRes.status}`);
    } catch (err) {
      logger.error(`Post failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Post with image via mbasic.facebook.com photo upload
   */
  async _postWithImage(cookieString, text, imageBuffer) {
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12; SM-G991U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
        'Cookie': cookieString,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      };

      // Step 1: GET mbasic homepage
      const homeRes = await fetch('https://mbasic.facebook.com/', { headers, redirect: 'follow' });
      const homeHtml = await homeRes.text();

      // Step 2: Find the photo upload page link
      const photoLinkMatch = homeHtml.match(/href="(\/composer\/mbasic\/\?[^"]*)"[^>]*>[^<]*(?:Photo|Ảnh)/i)
        || homeHtml.match(/href="(\/photos\/upload\/[^"]+)"/i)
        || homeHtml.match(/href="(\/composer\/mbasic\/[^"]+)"/i);

      if (!photoLinkMatch) {
        logger.warn('Could not find photo upload link, posting text only');
        return this._postTextOnly(cookieString, text);
      }

      const photoPageUrl = `https://mbasic.facebook.com${photoLinkMatch[1].replace(/&amp;/g, '&')}`;
      const photoPageRes = await fetch(photoPageUrl, { headers, redirect: 'follow' });
      const photoPageHtml = await photoPageRes.text();

      // Step 3: Parse the upload form
      const formMatch = photoPageHtml.match(/<form[^>]*enctype="multipart\/form-data"[^>]*action="([^"]+)"([\s\S]*?)<\/form>/i);
      if (!formMatch) {
        logger.warn('Could not find photo upload form, posting text only');
        return this._postTextOnly(cookieString, text);
      }

      const formAction = formMatch[1].replace(/&amp;/g, '&');
      const formBody = formMatch[2];

      // Extract all hidden inputs
      const formData = new FormData();
      const inputRegex = /<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/gi;
      let match;
      while ((match = inputRegex.exec(formBody)) !== null) {
        formData.append(match[1], match[2].replace(/&amp;/g, '&'));
      }

      // Add caption and photo
      formData.append('xc_message', text);
      formData.append('file1', new Blob([imageBuffer], { type: 'image/jpeg' }), 'story_cover.jpg');

      // Step 4: Submit
      const postRes = await fetch(`https://mbasic.facebook.com${formAction}`, {
        method: 'POST',
        headers: {
          'Cookie': cookieString,
          'User-Agent': headers['User-Agent'],
          'Referer': photoPageUrl,
        },
        body: formData,
        redirect: 'follow',
      });

      if (postRes.ok || postRes.status === 302) {
        logger.info('✅ Posted with image via mbasic');
        return { success: true, hasImage: true };
      }
      throw new Error(`HTTP ${postRes.status}`);
    } catch (err) {
      logger.warn(`Photo upload failed (${err.message}), trying text only...`);
      return this._postTextOnly(cookieString, text);
    }
  }

  // ============================================
  //  COOKIE HELPER
  // ============================================
  _getCookieString(credentials) {
    if (!credentials.cookie) return null;
    if (typeof credentials.cookie === 'string' && !credentials.cookie.startsWith('[')) {
      return credentials.cookie;
    }
    try {
      const arr = typeof credentials.cookie === 'string'
        ? JSON.parse(credentials.cookie)
        : credentials.cookie;
      if (Array.isArray(arr)) {
        return arr.filter(c => c.name && c.value).map(c => `${c.name}=${c.value}`).join('; ');
      }
    } catch {}
    return credentials.cookie;
  }

  // ============================================
  //  FORMAT POST
  // ============================================
  _formatPost(title, genre, partNumber, body) {
    const hashtags = HASHTAGS_BY_GENRE[genre] || '#story #fiction #writing';
    const partLabel = partNumber === 1
      ? `📖 "${title}" — Part 1 of 2`
      : `📖 "${title}" — Part 2 of 2 (FINALE)`;

    const genreTag = `📚 Genre: ${genre}`;
    const divider = '━━━━━━━━━━━━━━━━━━━━━━━━━━━';

    let footer;
    if (partNumber === 1) {
      footer = `\n${divider}\n⏳ Part 2 drops soon... Stay tuned! 🔥\n\n${hashtags} #shortstory #fiction #serialfiction #booktok #reading`;
    } else {
      footer = `\n${divider}\n✍️ THE END\n💬 What did you think? Drop a comment!\n🔔 Follow for a new story tomorrow!\n\n${hashtags} #shortstory #fiction #theend #reading`;
    }

    return `${partLabel}\n${genreTag}\n${divider}\n\n${body}\n${footer}`;
  }

  // ============================================
  //  MAIN POST CYCLE
  // ============================================
  async _postCycle() {
    if (!this.isRunning) return;

    logger.info('📖 Story Writer: starting post cycle...');

    try {
      // Get active Facebook account
      const accounts = getAccounts().filter(a => a.platform === 'facebook' && a.status === 'active');
      if (accounts.length === 0) {
        logger.warn('No active Facebook accounts');
        this._scheduleNext();
        return;
      }

      const account = accounts[Math.floor(Math.random() * accounts.length)];
      let credentials;
      try { credentials = JSON.parse(account.credentials || '{}'); }
      catch { credentials = {}; }

      const cookieString = this._getCookieString(credentials);
      if (!cookieString) {
        logger.warn(`Account #${account.id} has no cookies`);
        this._scheduleNext();
        return;
      }

      // Determine if we need Part 1 (new story) or Part 2 (continue)
      const cs = this._state.currentStory;
      let postText, genre, partNum;

      if (cs && cs.currentPart === 1 && cs.part1Body) {
        // ═══ POST PART 2 ═══
        genre = cs.genre;
        partNum = 2;
        logger.info(`📖 Generating Part 2 of "${cs.title}" (${genre})...`);

        const part1Summary = this._summarizePart1(cs.part1Body);
        const part2Body = await this._generatePart2(cs.title, genre, part1Summary);

        if (part2Body) {
          postText = this._formatPost(cs.title, genre, 2, part2Body.trim());
          this.stats.aiGenerated++;
        } else {
          logger.warn('AI failed to generate Part 2, skipping');
          this.stats.totalFailed++;
          // Reset story state, start fresh next cycle
          this._state.currentStory = null;
          saveState(this._state);
          this._scheduleNext();
          return;
        }

        // Mark story as completed
        this._state.currentStory = null;
        this._state.storyCount = (this._state.storyCount || 0) + 1;
        this.stats.storiesCompleted = this._state.storyCount;

      } else {
        // ═══ POST PART 1 (NEW STORY) ═══
        genre = this._pickGenre();
        partNum = 1;
        logger.info(`📖 Generating NEW story — Genre: ${genre}...`);

        const part1 = await this._generatePart1(genre);

        if (part1 && part1.title && part1.body) {
          postText = this._formatPost(part1.title, genre, 1, part1.body);
          this.stats.aiGenerated++;
          this.stats.lastStoryTitle = part1.title;
          this.stats.currentGenre = genre;
          this.stats.currentPart = 1;

          // Save state for Part 2
          this._state.currentStory = {
            title: part1.title,
            genre,
            part1Body: part1.body,
            currentPart: 1,
            createdAt: new Date().toISOString(),
          };
        } else {
          logger.warn('AI failed to generate Part 1, will retry next cycle');
          this.stats.totalFailed++;
          this._scheduleNext();
          return;
        }
      }

      // Search for cover image
      logger.info(`🖼️ Searching aesthetic image for ${genre}...`);
      const imageUrl = await this._searchImage(genre);
      let imageBuffer = null;
      if (imageUrl) {
        imageBuffer = await this._downloadImage(imageUrl);
      }

      // Post to Facebook
      logger.info(`📝 Posting Part ${partNum} → account #${account.id}...`);
      let result;
      if (imageBuffer) {
        result = await this._postWithImage(cookieString, postText, imageBuffer);
      } else {
        result = await this._postTextOnly(cookieString, postText);
      }

      if (result.success) {
        this.stats.totalPosted++;
        this.stats.lastPostedAt = new Date().toISOString();
        this.stats.currentPart = partNum;
        logger.info(`✅ Story Part ${partNum} posted successfully!${result.hasImage ? ' (with image)' : ''}`);
      } else {
        this.stats.totalFailed++;
        logger.error(`❌ Failed to post Part ${partNum}: ${result.error}`);
      }

      // Save state
      saveState(this._state);

    } catch (error) {
      logger.error(`Story Writer error: ${error.message}`);
      this.stats.totalFailed++;
    }

    this._scheduleNext();
  }

  _scheduleNext() {
    if (!this.isRunning) return;
    // Add ±30min jitter for natural timing
    const jitter = (Math.random() - 0.5) * 60 * 60 * 1000;
    const nextMs = this._intervalMs + jitter;
    logger.info(`📖 Next story post in ~${(nextMs / 3600000).toFixed(1)}h`);
    this._timer = setTimeout(() => this._postCycle(), nextMs);
  }
}

export default FacebookStatusPoster;
