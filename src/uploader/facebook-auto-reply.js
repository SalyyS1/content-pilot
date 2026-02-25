/**
 * Facebook Auto-Reply Comments — AI-Powered
 * 
 * Tự động reply comment trên bài viết Facebook
 * Dùng ChatGPT/Gemini để tạo reply phù hợp
 * 
 * Features:
 * - Scan bài viết gần đây tìm comment chưa reply
 * - AI tạo reply thông minh dựa vào nội dung comment
 * - Delay ngẫu nhiên giữa các reply (tự nhiên)
 * - Tracking comment đã reply (tránh reply 2 lần)
 * - Dashboard controls (bật/tắt/stats)
 */

import logger from '../core/logger.js';
import { getAccounts } from '../core/database.js';
import { AIIntegration } from '../seo/ai-integration.js';

// Reply prompt templates
const REPLY_PROMPTS = [
  (comment) => `Bạn là chủ trang Facebook. Ai đó comment: "${comment}".
Viết 1 câu reply ngắn gọn, thân thiện, tự nhiên bằng tiếng Việt.
CHỈ trả lời nội dung reply, không giải thích. Tối đa 2 câu.`,

  (comment) => `Someone commented on your Facebook post: "${comment}".
Write a short, friendly Vietnamese reply (1-2 sentences max).
Be natural, warm, and engaging. ONLY return the reply text.`,

  (comment) => `Facebook comment: "${comment}"
Hãy reply như một người bình thường, dùng tiếng Việt, thân thiện, có thể kèm emoji.
Ngắn gọn 1-2 câu. CHỈ trả lời nội dung reply.`,
];

// Fallback replies khi AI không available
const FALLBACK_REPLIES = [
  'Cảm ơn bạn nhiều nha! ❤️',
  'Cảm ơn bạn đã ghé thăm! 🙏',
  'Hay quá bạn ơi! 😊',
  'Cảm ơn bạn! 💪',
  'Tuyệt vời! Cảm ơn bạn nha 🌟',
  'Cảm ơn bạn đã chia sẻ! ✨',
  'Đúng rồi bạn! 👍',
  'Cảm ơn bạn nhé! Chúc bạn một ngày tốt lành 😊',
  'Rất vui vì bạn thích! ❤️',
  'Cảm ơn bạn đã ủng hộ! 🔥',
];

/**
 * Facebook Auto-Reply Engine
 */
export class FacebookAutoReply {
  constructor(options = {}) {
    this.isRunning = false;
    this._timer = null;
    this._intervalMs = (options.intervalMinutes || 30) * 60 * 1000; // Default 30 min
    this._maxRepliesPerCycle = options.maxReplies || 5;
    this._repliedComments = new Set(); // Track replied comment IDs
    
    // AI
    this.ai = new AIIntegration();

    this.stats = {
      totalReplied: 0,
      totalFailed: 0,
      totalScanned: 0,
      aiReplies: 0,
      fallbackReplies: 0,
      lastRepliedAt: null,
      lastReply: null,
      startedAt: null,
    };
  }

  start() {
    if (this.isRunning) {
      logger.warn('Auto-Reply already running');
      return;
    }

    this.isRunning = true;
    this.stats.startedAt = new Date().toISOString();

    const aiStatus = this.ai.hasChatGPT ? 'ChatGPT ✓' : this.ai.hasGemini ? 'Gemini ✓' : '⚠️ Fallback mode';
    logger.info(`💬 Auto-Reply STARTED (AI: ${aiStatus})`);
    logger.info(`  Check interval: ${this._intervalMs / 60000} min`);
    logger.info(`  Max replies/cycle: ${this._maxRepliesPerCycle}`);

    // First scan after short delay
    setTimeout(() => this._replyCycle(), 5000);
  }

  stop() {
    this.isRunning = false;
    if (this._timer) clearTimeout(this._timer);
    this.ai.close();
    logger.info('⏹️ Auto-Reply STOPPED');
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      ...this.stats,
      intervalMinutes: this._intervalMs / 60000,
      maxRepliesPerCycle: this._maxRepliesPerCycle,
      aiAvailable: this.ai.hasChatGPT || this.ai.hasGemini,
      aiProvider: this.ai.hasChatGPT ? 'ChatGPT' : this.ai.hasGemini ? 'Gemini' : 'None',
      trackedComments: this._repliedComments.size,
    };
  }

  /**
   * Generate AI reply for a comment
   */
  async _generateReply(commentText) {
    if (this.ai.hasChatGPT || this.ai.hasGemini) {
      try {
        const promptFn = REPLY_PROMPTS[Math.floor(Math.random() * REPLY_PROMPTS.length)];
        const prompt = promptFn(commentText);

        let reply = null;
        if (this.ai.hasChatGPT) {
          reply = await this.ai.chatgpt(prompt, { temperature: 0.8 });
        }
        if (!reply && this.ai.hasGemini) {
          reply = await this.ai.gemini(prompt, { temperature: 0.8, maxTokens: 150 });
        }

        if (reply) {
          reply = reply
            .replace(/^["'"'«»]/g, '')
            .replace(/["'"'«»]$/g, '')
            .replace(/^(Reply|Trả lời|Response):?\s*/i, '')
            .trim();

          if (reply.length >= 3 && reply.length <= 300) {
            this.stats.aiReplies++;
            return reply;
          }
        }
      } catch (err) {
        logger.warn(`AI reply generation failed: ${err.message}`);
      }
    }

    // Fallback
    this.stats.fallbackReplies++;
    return FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
  }

  /**
   * Scan posts and reply to comments using Playwright
   */
  async _scanAndReply(accountId, cookies) {
    let browser = null;
    let repliedCount = 0;

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

      if (!cookieArr || cookieArr.length === 0) throw new Error('No valid cookies');

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 900 },
        locale: 'vi-VN',
      });

      await context.addCookies(cookieArr);
      const page = await context.newPage();

      // Go to own profile to see recent posts
      await page.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Check logged in
      const isLoggedIn = await page.locator('[role="banner"]').count() > 0;
      if (!isLoggedIn) throw new Error('Not logged in — cookie expired?');

      // Scroll down to load a few posts
      await page.mouse.wheel(0, 800);
      await page.waitForTimeout(2000);

      // Find posts with comments
      // Look for "comment" links/buttons on posts
      const commentLinks = page.locator('[aria-label*="comment" i], [aria-label*="bình luận" i]');
      const commentCount = await commentLinks.count();
      
      logger.info(`💬 Found ${commentCount} posts with comment sections`);
      this.stats.totalScanned += commentCount;

      // Process up to 3 recent posts
      const postsToCheck = Math.min(commentCount, 3);

      for (let i = 0; i < postsToCheck && repliedCount < this._maxRepliesPerCycle; i++) {
        try {
          // Click to expand comments on this post
          const commentLink = commentLinks.nth(i);
          await commentLink.click();
          await page.waitForTimeout(2000);

          // Find individual comments
          // Comments are usually in div[role="article"] within the comment section
          const comments = page.locator('div[role="article"]');
          const totalComments = await comments.count();

          for (let j = 0; j < totalComments && repliedCount < this._maxRepliesPerCycle; j++) {
            try {
              const comment = comments.nth(j);
              
              // Get comment text
              const textEl = comment.locator('div[dir="auto"]').first();
              if (await textEl.count() === 0) continue;
              
              const commentText = await textEl.textContent();
              if (!commentText || commentText.trim().length < 2) continue;

              // Create a pseudo-ID from text + position
              const commentId = `${accountId}-${i}-${commentText.slice(0, 30).trim()}`;
              
              if (this._repliedComments.has(commentId)) continue;

              // Check if already has a reply from us (look for "Trả lời" or "Reply" near our name)
              // Simple heuristic: skip if this is our own comment
              const authorEl = comment.locator('a[role="link"] span').first();
              const authorName = await authorEl.textContent().catch(() => '');
              
              // Skip own comments
              // We'll try to reply to others' comments

              // Find "Reply" / "Trả lời" button for this comment
              const replyBtn = comment.locator('div[role="button"]:has-text("Trả lời"), div[role="button"]:has-text("Reply")').first();
              
              if (await replyBtn.count() === 0) continue;

              // Generate AI reply
              const replyText = await this._generateReply(commentText.trim());
              
              logger.info(`💬 Replying to "${commentText.slice(0, 40)}..." → "${replyText.slice(0, 40)}..."`);

              // Click reply
              await replyBtn.click();
              await page.waitForTimeout(1000);

              // Type reply in the reply input
              const replyInput = page.locator('[contenteditable="true"][role="textbox"]').last();
              if (await replyInput.count() > 0) {
                await replyInput.click();
                await page.waitForTimeout(300);
                await replyInput.fill(replyText);
                await page.waitForTimeout(500);

                // Press Enter to submit
                await replyInput.press('Enter');
                await page.waitForTimeout(2000);

                this._repliedComments.add(commentId);
                repliedCount++;
                this.stats.totalReplied++;
                this.stats.lastRepliedAt = new Date().toISOString();
                this.stats.lastReply = replyText;

                logger.info(`✅ Replied successfully (#${repliedCount})`);

                // Random delay between replies (15-45s) to look human
                const delay = 15000 + Math.random() * 30000;
                await page.waitForTimeout(delay);
              }

            } catch (commentErr) {
              logger.debug(`Skip comment: ${commentErr.message}`);
            }
          }

        } catch (postErr) {
          logger.debug(`Skip post: ${postErr.message}`);
        }
      }

      await context.close();

    } catch (error) {
      logger.error(`❌ Auto-reply scan failed: ${error.message}`);
      this.stats.totalFailed++;
    } finally {
      if (browser) await browser.close();
    }

    return repliedCount;
  }

  /**
   * Reply cycle — scan accounts, find comments, reply
   */
  async _replyCycle() {
    if (!this.isRunning) return;

    logger.info('💬 Auto-Reply: scanning for comments...');

    try {
      const accounts = getAccounts().filter(a => a.platform === 'facebook' && a.status === 'active');

      if (accounts.length === 0) {
        logger.warn('No active Facebook accounts for auto-reply');
        this._scheduleNext();
        return;
      }

      // Process each account
      for (const account of accounts) {
        if (!this.isRunning) break;

        let credentials;
        try { credentials = JSON.parse(account.credentials || '{}'); }
        catch { credentials = {}; }

        if (!credentials.cookie) continue;

        logger.info(`💬 Scanning comments for account #${account.id}...`);
        const replied = await this._scanAndReply(account.id, credentials.cookie);
        logger.info(`💬 Replied to ${replied} comments (account #${account.id})`);
      }

    } catch (error) {
      logger.error(`Auto-reply cycle failed: ${error.message}`);
    }

    this._scheduleNext();
  }

  _scheduleNext() {
    if (!this.isRunning) return;
    // Add jitter ±5 min
    const jitter = (Math.random() - 0.5) * 10 * 60 * 1000;
    const nextMs = this._intervalMs + jitter;
    const nextMin = Math.round(nextMs / 60000);
    logger.info(`💬 Next comment scan in ~${nextMin} min`);
    this._timer = setTimeout(() => this._replyCycle(), nextMs);
  }

  /**
   * Clean up old tracked comments (keep last 500)
   */
  cleanup() {
    if (this._repliedComments.size > 500) {
      const arr = [...this._repliedComments];
      this._repliedComments = new Set(arr.slice(-300));
      logger.debug(`Cleaned tracked comments: ${arr.length} → ${this._repliedComments.size}`);
    }
  }
}

export default FacebookAutoReply;
