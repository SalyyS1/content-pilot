/**
 * Facebook Status Poster — AI-Generated Motivational Quotes
 * 
 * Uses ChatGPT/Gemini to generate fresh, unique quotes each time
 * Falls back to a small seed list if AI unavailable
 * 
 * Features:
 * - AI-generated quotes (GPT/Gemini)
 * - Random emoji + hashtag styling
 * - Configurable interval (1-12h) with jitter
 * - Duplicate tracking (24h window)
 * - Posts via Playwright browser automation
 */

import logger from '../core/logger.js';
import { getAccounts } from '../core/database.js';
import { AIIntegration } from '../seo/ai-integration.js';

// Small fallback list — only used when AI is unavailable
const FALLBACK_QUOTES = [
  'Cuộc sống không phải là chờ đợi bão tan, mà là học cách nhảy múa dưới mưa.',
  'Hãy sống như ngày mai là ngày cuối cùng, và học hỏi như thể bạn sẽ sống mãi mãi.',
  'Thất bại là mẹ thành công.',
  'Đừng sợ thất bại, hãy sợ mình không bao giờ thử.',
  'Mỗi ngày là một cơ hội mới để thay đổi cuộc đời bạn.',
  'Hãy là phiên bản tốt nhất của chính mình.',
  'Người thành công không phải là người không bao giờ thất bại, mà là người không bao giờ bỏ cuộc.',
  'Kỷ luật là cầu nối giữa ước mơ và thành tựu.',
  'Cuộc sống quá ngắn để sống tầm thường.',
  'Hãy làm việc trong im lặng, để thành công tạo nên tiếng vang.',
];

// AI prompt templates for quote generation
const QUOTE_PROMPTS = [
  `Hãy viết 1 câu đạo lý / triết lý sống ngắn gọn, sâu sắc bằng tiếng Việt (1-2 câu). 
Chủ đề ngẫu nhiên: cuộc sống, tình yêu, thành công, nỗ lực, tư duy tích cực, sức khỏe, ước mơ, tình bạn.
CHỈ trả lời câu đạo lý, không giải thích. Không dùng dấu ngoặc kép.`,

  `Write a short, deep motivational quote (1-2 sentences) in Vietnamese.
Random topic: life wisdom, self-improvement, hustle mindset, relationships, mental health, dreams.
ONLY return the quote text, no explanation. No quotation marks.`,

  `Tạo 1 câu status Facebook ý nghĩa bằng tiếng Việt. Phong cách: sâu sắc, truyền cảm hứng, dễ share.
Có thể mix tiếng Anh nếu hay (kiểu Gen Z). CHỈ trả lời nội dung status.`,

  `Viết 1 câu châm ngôn sống ngắn gọn, hay, dễ nhớ bằng tiếng Việt.
Có thể về: tiền bạc, sự nghiệp, tình yêu, gia đình, bản thân.
CHỈ trả lời câu châm ngôn, không thêm gì khác.`,

  `Hãy viết 1 câu caption Facebook thật sâu, kiểu "đạo lý cuộc sống" bằng tiếng Việt.
Giọng điệu: trưởng thành, nhẹ nhàng, không sáo rỗng. 1-3 câu ngắn.
CHỈ trả lời nội dung, không giải thích.`,
];

// Emoji categories
const EMOJIS = {
  positive: ['✨', '🌟', '💫', '⭐', '🌈', '🔥', '💪', '🎯', '🚀', '💯', '👊', '🏆'],
  heart: ['❤️', '💖', '💝', '💕', '😊', '🥰', '🤗', '☺️', '💗', '💞'],
  nature: ['🌸', '🌺', '🌻', '🍀', '🌿', '🌙', '☀️', '🌅', '🦋', '🌊'],
  wisdom: ['📚', '🧠', '💡', '🔑', '📖', '🎓', '🏅', '🌱', '⚡', '🎭'],
};

const HASHTAGS = [
  '#daoly', '#tuduytichcuc', '#cuocsong', '#trucham', '#quoteshay',
  '#ngamnghi', '#suytuong', '#hanhphuc', '#thanhcong', '#donglucsong',
  '#yeubanthan', '#tuduymoi', '#baihocsong', '#namang', '#trietly',
  '#quotesviet', '#doisong', '#tamsu', '#motivation', '#mindset',
];

/**
 * Facebook Status Poster Engine — AI-Powered
 */
export class FacebookStatusPoster {
  constructor(options = {}) {
    this.isRunning = false;
    this._timer = null;
    this._intervalMs = (options.intervalHours || 3) * 60 * 60 * 1000;
    this._recentQuotes = [];
    this._maxRecent = 30;

    // AI integration
    this.ai = new AIIntegration();

    this.stats = {
      totalPosted: 0,
      totalFailed: 0,
      aiGenerated: 0,
      fallbackUsed: 0,
      lastPostedAt: null,
      lastQuote: null,
      startedAt: null,
    };
  }

  start() {
    if (this.isRunning) {
      logger.warn('Status Poster already running');
      return;
    }

    this.isRunning = true;
    this.stats.startedAt = new Date().toISOString();

    const aiStatus = this.ai.hasChatGPT ? 'ChatGPT ✓' : this.ai.hasGemini ? 'Gemini ✓' : '⚠️ No AI (fallback mode)';
    logger.info(`📝 Status Poster STARTED (AI: ${aiStatus})`);
    logger.info(`  Interval: ${this._intervalMs / 3600000}h`);

    this._postCycle();
  }

  stop() {
    this.isRunning = false;
    if (this._timer) clearTimeout(this._timer);
    this.ai.close();
    logger.info('⏹️ Status Poster STOPPED');
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      ...this.stats,
      intervalHours: this._intervalMs / 3600000,
      aiAvailable: this.ai.hasChatGPT || this.ai.hasGemini,
      aiProvider: this.ai.hasChatGPT ? 'ChatGPT' : this.ai.hasGemini ? 'Gemini' : 'None',
      recentCount: this._recentQuotes.length,
    };
  }

  /**
   * Generate quote using AI, fallback to seed list
   */
  async _generateQuote() {
    // Try AI first
    if (this.ai.hasChatGPT || this.ai.hasGemini) {
      try {
        const prompt = QUOTE_PROMPTS[Math.floor(Math.random() * QUOTE_PROMPTS.length)];

        let quote = null;

        // Try ChatGPT first, then Gemini
        if (this.ai.hasChatGPT) {
          quote = await this.ai.chatgpt(prompt, { temperature: 0.9 });
        }
        if (!quote && this.ai.hasGemini) {
          quote = await this.ai.gemini(prompt, { temperature: 0.9, maxTokens: 200 });
        }

        if (quote) {
          // Clean up AI response
          quote = quote
            .replace(/^["'"'«»]/g, '')   // Remove leading quotes
            .replace(/["'"'«»]$/g, '')   // Remove trailing quotes
            .replace(/^(Câu đạo lý|Quote|Status|Caption|Châm ngôn):?\s*/i, '') // Remove labels
            .trim();

          // Verify it's not too long or too short
          if (quote.length >= 10 && quote.length <= 500) {
            // Check not recently used
            if (!this._recentQuotes.includes(quote)) {
              this._recentQuotes.push(quote);
              if (this._recentQuotes.length > this._maxRecent) this._recentQuotes.shift();
              this.stats.aiGenerated++;
              logger.info(`🤖 AI-generated quote: "${quote.slice(0, 60)}..."`);
              return quote;
            }
          }
        }
      } catch (err) {
        logger.warn(`AI quote generation failed: ${err.message}`);
      }
    }

    // Fallback to seed list
    const available = FALLBACK_QUOTES.filter(q => !this._recentQuotes.includes(q));
    const list = available.length > 0 ? available : FALLBACK_QUOTES;
    const quote = list[Math.floor(Math.random() * list.length)];
    this._recentQuotes.push(quote);
    if (this._recentQuotes.length > this._maxRecent) this._recentQuotes.shift();
    this.stats.fallbackUsed++;
    logger.info(`📝 Fallback quote: "${quote.slice(0, 60)}..."`);
    return quote;
  }

  /**
   * Format quote with emojis and hashtags
   */
  _formatStatus(quote) {
    const allEmojis = Object.values(EMOJIS).flat();
    const emojiCount = 2 + Math.floor(Math.random() * 2);
    const emojis = [];
    for (let i = 0; i < emojiCount; i++) {
      emojis.push(allEmojis[Math.floor(Math.random() * allEmojis.length)]);
    }

    const tagCount = 3 + Math.floor(Math.random() * 3);
    const shuffled = [...HASHTAGS].sort(() => Math.random() - 0.5);
    const tags = shuffled.slice(0, tagCount);

    const styles = [
      () => `${emojis[0]} ${quote} ${emojis.slice(1).join('')}\n\n${tags.join(' ')}`,
      () => `"${quote}"\n\n${emojis.join(' ')}\n\n${tags.join(' ')}`,
      () => `${emojis[0]} ${quote}\n\n${tags.join(' ')} ${emojis[1] || ''}`,
      () => `✍️ ${quote}\n\n${emojis.join('')} ${tags.join(' ')}`,
      () => `💭 "${quote}"\n\n${tags.join(' ')}`,
    ];

    return styles[Math.floor(Math.random() * styles.length)]();
  }

  /**
   * Post status to Facebook using Playwright
   */
  async _postStatus(accountId, cookies, statusText) {
    let browser = null;
    try {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ headless: true });

      let cookieArr;
      if (typeof cookies === 'string') {
        try {
          cookieArr = JSON.parse(cookies);
        } catch {
          cookieArr = cookies.split(';').map(c => {
            const [name, ...rest] = c.trim().split('=');
            return {
              name: name.trim(),
              value: rest.join('=').trim(),
              domain: '.facebook.com',
              path: '/',
            };
          }).filter(c => c.name && c.value);
        }
      } else if (Array.isArray(cookies)) {
        cookieArr = cookies.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain || '.facebook.com',
          path: c.path || '/',
        }));
      }

      if (!cookieArr || cookieArr.length === 0) {
        throw new Error('No valid cookies');
      }

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'vi-VN',
      });

      await context.addCookies(cookieArr);
      const page = await context.newPage();

      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Check if logged in
      const isLoggedIn = await page.locator('[aria-label="Facebook"]').count() > 0
                        || await page.locator('[role="banner"]').count() > 0;

      if (!isLoggedIn) {
        throw new Error('Not logged in — cookie expired?');
      }

      // Click "What's on your mind?" 
      const statusSelectors = [
        '[aria-label="Bạn đang nghĩ gì?"]',
        '[aria-label="What\'s on your mind"]',
        '[aria-label*="Bạn đang nghĩ"]',
        '[aria-label*="What\'s on your mind"]',
        'div[role="button"][tabindex="0"] span:has-text("Bạn đang nghĩ gì")',
        'div[role="button"][tabindex="0"] span:has-text("What\'s on your mind")',
      ];

      let clicked = false;
      for (const sel of statusSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.count() > 0) {
            await el.click();
            clicked = true;
            break;
          }
        } catch {}
      }

      if (!clicked) {
        const composer = page.locator('[data-pagelet="FeedComposer"] [role="button"]').first();
        if (await composer.count() > 0) {
          await composer.click();
          clicked = true;
        }
      }

      if (!clicked) throw new Error('Could not find status input area');

      await page.waitForTimeout(2000);

      // Find editor
      const editorSelectors = [
        '[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"][data-lexical-editor="true"]',
        'div[contenteditable="true"]',
      ];

      let editor = null;
      for (const sel of editorSelectors) {
        const el = page.locator(sel).first();
        if (await el.count() > 0) { editor = el; break; }
      }

      if (!editor) throw new Error('Could not find post editor');

      await editor.click();
      await page.waitForTimeout(500);
      await editor.fill(statusText);
      await page.waitForTimeout(1000);

      // Click Post button
      const postButtons = [
        'div[aria-label="Đăng"]',
        'div[aria-label="Post"]',
        'button:has-text("Đăng")',
        'button:has-text("Post")',
      ];

      let posted = false;
      for (const sel of postButtons) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.count() > 0 && await btn.isEnabled()) {
            await btn.click();
            posted = true;
            break;
          }
        } catch {}
      }

      if (!posted) throw new Error('Could not find Post button');

      await page.waitForTimeout(5000);
      await context.close();

      logger.info(`✅ Status posted successfully (account #${accountId})`);
      return { success: true };

    } catch (error) {
      logger.error(`❌ Status post failed: ${error.message}`);
      return { success: false, error: error.message };
    } finally {
      if (browser) await browser.close();
    }
  }

  /**
   * Post cycle — AI generate quote → format → post to FB
   */
  async _postCycle() {
    if (!this.isRunning) return;

    logger.info('📝 Status Poster: posting cycle...');

    try {
      const accounts = getAccounts().filter(a => a.platform === 'facebook' && a.status === 'active');

      if (accounts.length === 0) {
        logger.warn('No active Facebook accounts for status posting');
        this._scheduleNext();
        return;
      }

      const account = accounts[Math.floor(Math.random() * accounts.length)];

      let credentials;
      try { credentials = JSON.parse(account.credentials || '{}'); } 
      catch { credentials = {}; }

      if (!credentials.cookie) {
        logger.warn(`Account #${account.id} has no cookies for posting`);
        this._scheduleNext();
        return;
      }

      // AI-generate quote
      const quote = await this._generateQuote();
      const statusText = this._formatStatus(quote);

      logger.info(`📝 Posting: "${quote.slice(0, 60)}..." → account #${account.id}`);

      const result = await this._postStatus(account.id, credentials.cookie, statusText);

      if (result.success) {
        this.stats.totalPosted++;
        this.stats.lastPostedAt = new Date().toISOString();
        this.stats.lastQuote = quote;
      } else {
        this.stats.totalFailed++;
      }

    } catch (error) {
      logger.error(`Status poster cycle failed: ${error.message}`);
      this.stats.totalFailed++;
    }

    this._scheduleNext();
  }

  _scheduleNext() {
    if (!this.isRunning) return;
    const jitter = (Math.random() - 0.5) * 60 * 60 * 1000; // ±30min
    const nextMs = this._intervalMs + jitter;
    const nextHours = (nextMs / 3600000).toFixed(1);
    logger.info(`📝 Next status in ~${nextHours}h`);
    this._timer = setTimeout(() => this._postCycle(), nextMs);
  }
}

export default FacebookStatusPoster;
