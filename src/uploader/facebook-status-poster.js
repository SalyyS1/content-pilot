/**
 * Facebook Status Poster — AI-Generated Quotes via HTTP (no Playwright!)
 * 
 * Posts to Facebook using mbasic.facebook.com + cookies
 * No browser needed — pure HTTP requests
 * 
 * Flow:
 * 1. GET mbasic.facebook.com → parse fb_dtsg + form action
 * 2. AI generates quote (ChatGPT/Gemini)
 * 3. POST form with status text
 */

import logger from '../core/logger.js';
import { getAccounts } from '../core/database.js';
import AIIntegration from '../seo/ai-integration.js';

// AI prompt templates
const QUOTE_PROMPTS = [
  `Hãy viết 1 câu đạo lý / triết lý sống ngắn gọn, sâu sắc bằng tiếng Việt (1-2 câu). 
Chủ đề ngẫu nhiên: cuộc sống, tình yêu, thành công, nỗ lực, tư duy tích cực, ước mơ.
CHỈ trả lời câu đạo lý, không giải thích. Không dùng dấu ngoặc kép.`,

  `Write a short, deep motivational quote (1-2 sentences) in Vietnamese.
Random topic: life wisdom, self-improvement, hustle mindset, dreams.
ONLY return the quote text, no explanation. No quotation marks.`,

  `Tạo 1 câu status Facebook ý nghĩa bằng tiếng Việt. Phong cách: sâu sắc, truyền cảm hứng.
Có thể mix tiếng Anh (kiểu Gen Z). CHỈ trả lời nội dung status.`,

  `Viết 1 câu châm ngôn sống ngắn gọn, hay bằng tiếng Việt.
Có thể về: tiền bạc, sự nghiệp, tình yêu, bản thân.
CHỈ trả lời câu châm ngôn.`,

  `Hãy viết 1 câu caption Facebook thật sâu bằng tiếng Việt.
Giọng điệu: trưởng thành, nhẹ nhàng. 1-3 câu ngắn.
CHỉ trả lời nội dung.`,
];

// Fallback quotes
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

// Emojis & hashtags
const EMOJIS = ['✨', '🌟', '💫', '🔥', '💪', '🎯', '🚀', '💯', '❤️', '💖', '🌸', '🌺', '🍀', '🌙', '☀️', '📚', '🧠', '💡', '🎭', '⚡'];
const HASHTAGS = ['#daoly', '#tuduytichcuc', '#cuocsong', '#quoteshay', '#donglucsong', '#hanhphuc', '#thanhcong', '#trietly', '#motivation', '#mindset'];

/**
 * Facebook Status Poster — HTTP-based (no Playwright)
 */
export class FacebookStatusPoster {
  constructor(options = {}) {
    this.isRunning = false;
    this._timer = null;
    this._intervalMs = (options.intervalHours || 3) * 60 * 60 * 1000;
    this._recentQuotes = [];
    this._maxRecent = 30;

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
    if (this.isRunning) return;
    this.isRunning = true;
    this.stats.startedAt = new Date().toISOString();

    const aiStatus = this.ai.hasChatGPT ? 'ChatGPT ✓' : this.ai.hasGemini ? 'Gemini ✓' : '⚠️ Fallback mode';
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
    if (this.ai.hasChatGPT || this.ai.hasGemini) {
      try {
        const prompt = QUOTE_PROMPTS[Math.floor(Math.random() * QUOTE_PROMPTS.length)];
        let quote = this.ai.hasChatGPT
          ? await this.ai.chatgpt(prompt, { temperature: 0.9 })
          : await this.ai.gemini(prompt, { temperature: 0.9, maxTokens: 200 });

        if (quote) {
          quote = quote.replace(/^["'"'«»]/g, '').replace(/["'"'«»]$/g, '').trim();
          if (quote.length >= 10 && quote.length <= 500 && !this._recentQuotes.includes(quote)) {
            this._recentQuotes.push(quote);
            if (this._recentQuotes.length > this._maxRecent) this._recentQuotes.shift();
            this.stats.aiGenerated++;
            logger.info(`🤖 AI quote: "${quote.slice(0, 60)}..."`);
            return quote;
          }
        }
      } catch (err) {
        logger.warn(`AI quote failed: ${err.message}`);
      }
    }

    // Fallback
    const available = FALLBACK_QUOTES.filter(q => !this._recentQuotes.includes(q));
    const list = available.length > 0 ? available : FALLBACK_QUOTES;
    const quote = list[Math.floor(Math.random() * list.length)];
    this._recentQuotes.push(quote);
    if (this._recentQuotes.length > this._maxRecent) this._recentQuotes.shift();
    this.stats.fallbackUsed++;
    return quote;
  }

  /**
   * Format quote with emojis + hashtags
   */
  _formatStatus(quote) {
    const e1 = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    const e2 = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    const tags = [...HASHTAGS].sort(() => Math.random() - 0.5).slice(0, 4).join(' ');

    const styles = [
      `${e1} ${quote} ${e2}\n\n${tags}`,
      `"${quote}"\n\n${e1}${e2} ${tags}`,
      `✍️ ${quote}\n\n${tags}`,
      `💭 "${quote}"\n\n${tags}`,
    ];
    return styles[Math.floor(Math.random() * styles.length)];
  }

  /**
   * Post status via mbasic.facebook.com (HTTP, no browser!)
   */
  async _postStatus(accountId, cookieString, statusText) {
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Cookie': cookieString,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
      };

      // Step 1: GET mbasic homepage → extract fb_dtsg + compose form
      const homeRes = await fetch('https://mbasic.facebook.com/', { headers, redirect: 'follow' });
      const homeHtml = await homeRes.text();

      // Extract fb_dtsg token
      const dtsgMatch = homeHtml.match(/name="fb_dtsg"\s+value="([^"]+)"/);
      if (!dtsgMatch) {
        // Try alternate pattern
        const dtsg2 = homeHtml.match(/fb_dtsg.*?value="([^"]+)"/s);
        if (!dtsg2) {
          throw new Error('Could not find fb_dtsg — cookie may be expired');
        }
        var fbDtsg = dtsg2[1];
      } else {
        var fbDtsg = dtsgMatch[1];
      }

      // Extract compose form action URL
      const formMatch = homeHtml.match(/action="(\/composer\/mbasic\/[^"]+)"/);
      let formAction = formMatch ? formMatch[1] : null;

      // Also try finding the post form
      if (!formAction) {
        const altForm = homeHtml.match(/action="(\/a\/home\.php[^"]*)".*?method="post"/s);
        formAction = altForm ? altForm[1] : '/composer/mbasic/';
      }

      // Step 2: POST status
      const formData = new URLSearchParams();
      formData.append('fb_dtsg', fbDtsg);
      formData.append('xhpc_context', 'home');
      formData.append('xhpc_publish_type', 'status');
      formData.append('xc_message', statusText);

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
        logger.info(`✅ Status posted via mbasic (account #${accountId})`);
        return { success: true };
      } else {
        throw new Error(`HTTP ${postRes.status}`);
      }

    } catch (error) {
      logger.error(`❌ Status post failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Extract cookie string from account credentials
   */
  _getCookieString(credentials) {
    if (!credentials.cookie) return null;

    // If cookie is already a string (name=val; name2=val2)
    if (typeof credentials.cookie === 'string' && !credentials.cookie.startsWith('[')) {
      return credentials.cookie;
    }

    // If cookie is JSON array (from browser extension)
    try {
      const arr = typeof credentials.cookie === 'string' 
        ? JSON.parse(credentials.cookie) 
        : credentials.cookie;
      if (Array.isArray(arr)) {
        return arr
          .filter(c => c.name && c.value)
          .map(c => `${c.name}=${c.value}`)
          .join('; ');
      }
    } catch {}

    return credentials.cookie;
  }

  /**
   * Post cycle
   */
  async _postCycle() {
    if (!this.isRunning) return;

    logger.info('📝 Status Poster: posting cycle...');

    try {
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

      const quote = await this._generateQuote();
      const statusText = this._formatStatus(quote);

      logger.info(`📝 Posting: "${quote.slice(0, 60)}..." → account #${account.id}`);
      const result = await this._postStatus(account.id, cookieString, statusText);

      if (result.success) {
        this.stats.totalPosted++;
        this.stats.lastPostedAt = new Date().toISOString();
        this.stats.lastQuote = quote;
      } else {
        this.stats.totalFailed++;
      }
    } catch (error) {
      logger.error(`Status poster failed: ${error.message}`);
      this.stats.totalFailed++;
    }

    this._scheduleNext();
  }

  _scheduleNext() {
    if (!this.isRunning) return;
    const jitter = (Math.random() - 0.5) * 60 * 60 * 1000;
    const nextMs = this._intervalMs + jitter;
    logger.info(`📝 Next status in ~${(nextMs / 3600000).toFixed(1)}h`);
    this._timer = setTimeout(() => this._postCycle(), nextMs);
  }
}

export default FacebookStatusPoster;
