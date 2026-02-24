/**
 * AI Integration — Session Token Auth (like cliproxyapi)
 * 
 * Flow:
 * 1. User goes to chatgpt.com/api/auth/session
 * 2. Copies "sessionToken" (NOT accessToken)
 * 3. Pastes into CLI → saved
 * 4. App auto-refreshes accessToken from sessionToken
 * 5. Session lasts ~3 MONTHS
 * 
 * For Gemini: uses Google AI Studio API key (free, 15 RPM)
 */

import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { exec } from 'node:child_process';
import logger from '../core/logger.js';

const SESSIONS_DIR = resolve(process.cwd(), 'data', 'sessions');
const TOKENS_FILE = join(SESSIONS_DIR, 'ai-tokens.json');

export class AIIntegration {
  constructor(config = {}) {
    // ChatGPT
    this._sessionToken = null;    // lasts ~3 months
    this._accessToken = null;     // auto-refreshed from session
    this._accessTokenExpiry = 0;
    this._sessionExpiry = 0;

    // Gemini
    this._geminiKey = config.geminiKey || process.env.GEMINI_API_KEY || null;

    if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
    this._loadTokens();
  }

  // ============================================
  // Token persistence
  // ============================================

  _loadTokens() {
    try {
      if (!existsSync(TOKENS_FILE)) return;
      const data = JSON.parse(readFileSync(TOKENS_FILE, 'utf8'));

      if (data.chatgpt) {
        this._sessionToken = data.chatgpt.sessionToken || null;
        this._accessToken = data.chatgpt.accessToken || null;
        this._accessTokenExpiry = data.chatgpt.accessTokenExpiry || 0;
        this._sessionExpiry = data.chatgpt.sessionExpiry || 0;

        if (this._sessionToken) {
          if (this._sessionExpiry > Date.now()) {
            const daysLeft = Math.round((this._sessionExpiry - Date.now()) / 86400000);
            logger.info(`🔑 ChatGPT session loaded (${daysLeft} ngày còn lại)`);
          } else {
            logger.warn('⚠️ ChatGPT session hết hạn. Run: reup auth chatgpt');
          }
        }
      }
      if (data.geminiKey) {
        this._geminiKey = data.geminiKey;
        logger.info('🔑 Gemini API key loaded');
      }
    } catch {}
  }

  _saveTokens() {
    try {
      writeFileSync(TOKENS_FILE, JSON.stringify({
        chatgpt: {
          sessionToken: this._sessionToken,
          sessionExpiry: this._sessionExpiry,
          accessToken: this._accessToken,
          accessTokenExpiry: this._accessTokenExpiry,
        },
        geminiKey: this._geminiKey,
        savedAt: new Date().toISOString(),
      }, null, 2));
    } catch {}
  }

  // ============================================
  // Auth: Manual Paste
  // ============================================

  async authChatGPT() {
    logger.info('🔑 === ChatGPT Auth (Session Token — 3 tháng) ===');
    logger.info('');
    logger.info('Bước 1: Mở browser tới:');
    logger.info('  https://chatgpt.com/api/auth/session');
    logger.info('');
    logger.info('Bước 2: Login nếu chưa login');
    logger.info('Bước 3: Copy giá trị "sessionToken" (KHÔNG phải accessToken)');
    logger.info('  → sessionToken bắt đầu bằng "eyJhbGciOiJkaXIi..."');
    logger.info('  → Nó dài hơn accessToken nhiều');
    logger.info('');

    // Open browser
    const url = 'https://chatgpt.com/api/auth/session';
    const cmd = process.platform === 'win32' ? 'start' :
                 process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${cmd} "${url}"`);

    const token = await this._prompt('Paste sessionToken here: ');

    if (!token || token.length < 100) {
      logger.error('❌ Token quá ngắn! Hãy copy "sessionToken", KHÔNG phải "accessToken".');
      return false;
    }

    this._sessionToken = token;
    // Session token of ChatGPT lasts ~3 months
    this._sessionExpiry = Date.now() + 90 * 24 * 3600 * 1000;
    this._accessToken = null;
    this._accessTokenExpiry = 0;

    // Try to get an access token immediately to verify
    logger.info('🔄 Đang verify session token...');
    const accessToken = await this._refreshAccessToken();

    if (accessToken) {
      logger.info('✅ ChatGPT auth thành công! Session sống 3 tháng.');
      logger.info('   Access token sẽ tự động refresh khi cần.');
      this._saveTokens();
      return true;
    } else {
      logger.error('❌ Session token không hợp lệ. Hãy thử lại.');
      this._sessionToken = null;
      return false;
    }
  }

  async authGemini() {
    logger.info('🔑 === Gemini Auth ===');
    logger.info('');
    logger.info('Lấy API key miễn phí (15 request/phút) tại:');
    logger.info('  https://aistudio.google.com/apikey');
    logger.info('');

    const url = 'https://aistudio.google.com/apikey';
    const cmd = process.platform === 'win32' ? 'start' :
                 process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${cmd} "${url}"`);

    const key = await this._prompt('Paste Gemini API key here: ');

    if (!key || key.length < 20) {
      logger.error('❌ API key không hợp lệ');
      return false;
    }

    // Verify key
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Hi' }] }] }),
        }
      );
      if (res.status === 200 || res.status === 429) {
        this._geminiKey = key;
        this._saveTokens();
        logger.info('✅ Gemini API key verified & saved!');
        if (res.status === 429) logger.info('   (429 = rate limited, key vẫn hợp lệ)');
        return true;
      } else {
        logger.error(`❌ Gemini key invalid (status: ${res.status})`);
        return false;
      }
    } catch (err) {
      logger.warn(`Gemini verify failed: ${err.message}, saving anyway...`);
      this._geminiKey = key;
      this._saveTokens();
      return true;
    }
  }

  async auth(service) {
    if (service === 'chatgpt' || service === 'openai') {
      return this.authChatGPT();
    } else if (service === 'gemini' || service === 'google') {
      return this.authGemini();
    } else if (service === 'all') {
      const c = await this.authChatGPT();
      const g = await this.authGemini();
      return c && g;
    }
    logger.error(`Unknown service: ${service}. Use: chatgpt, gemini, or all`);
    return false;
  }

  // ============================================
  // Auto-refresh accessToken from sessionToken
  // ============================================

  async _refreshAccessToken() {
    if (!this._sessionToken) return null;

    try {
      const res = await fetch('https://chatgpt.com/api/auth/session', {
        headers: {
          'Cookie': `__Secure-next-auth.session-token=${this._sessionToken}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      });

      if (!res.ok) {
        logger.warn(`Session refresh failed: HTTP ${res.status}`);
        return null;
      }

      const data = await res.json();

      if (data.accessToken) {
        this._accessToken = data.accessToken;

        // Parse JWT exp
        try {
          const payload = JSON.parse(Buffer.from(data.accessToken.split('.')[1], 'base64').toString());
          this._accessTokenExpiry = (payload.exp || 0) * 1000;
        } catch {
          this._accessTokenExpiry = Date.now() + 8 * 3600 * 1000; // fallback: 8h
        }

        // Update session token if server returns a new one
        if (data.sessionToken) {
          this._sessionToken = data.sessionToken;
        }

        // Check set-cookie for refreshed session token
        const setCookie = res.headers.get('set-cookie');
        if (setCookie) {
          const match = setCookie.match(/__Secure-next-auth\.session-token=([^;]+)/);
          if (match) {
            this._sessionToken = match[1];
            logger.debug('🔄 Session token refreshed from cookie');
          }
        }

        this._saveTokens();
        logger.debug('🔄 Access token refreshed');
        return this._accessToken;
      }

      return null;
    } catch (err) {
      logger.warn(`Token refresh error: ${err.message}`);
      return null;
    }
  }

  /**
   * Get valid access token — auto-refreshes if expired
   */
  async getAccessToken() {
    // Token still valid → use it
    if (this._accessToken && this._accessTokenExpiry > Date.now() + 60000) {
      return this._accessToken;
    }

    // Token expired → refresh from session
    logger.info('🔄 Access token expired, refreshing from session...');
    return this._refreshAccessToken();
  }

  // ============================================
  // API Calls
  // ============================================

  get hasChatGPT() { return !!(this._sessionToken && this._sessionExpiry > Date.now()); }
  get hasGemini() { return !!this._geminiKey; }
  get hasOpenAI() { return this.hasChatGPT; }

  /**
   * Call ChatGPT API (via backend-api, free with session)
   */
  async chatgpt(prompt, options = {}) {
    const token = await this.getAccessToken();
    if (!token) {
      logger.warn('ChatGPT: no valid token. Run: reup auth chatgpt');
      return null;
    }

    try {
      const model = options.model || 'auto';
      const response = await fetch('https://chatgpt.com/backend-api/conversation', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        body: JSON.stringify({
          action: 'next',
          messages: [{
            id: randomBytes(16).toString('hex'),
            author: { role: 'user' },
            content: { content_type: 'text', parts: [prompt] },
          }],
          model,
          parent_message_id: randomBytes(16).toString('hex'),
        }),
      });

      if (response.status === 401 || response.status === 403) {
        // Token expired, try refresh once
        logger.info('🔄 Token bị reject, thử refresh...');
        this._accessToken = null;
        this._accessTokenExpiry = 0;
        const newToken = await this._refreshAccessToken();
        if (!newToken) {
          logger.warn('ChatGPT session expired. Run: reup auth chatgpt');
          return null;
        }
        // Retry with new token
        return this.chatgpt(prompt, { ...options, _retried: true });
      }

      // Parse SSE response
      const text = await response.text();
      const lines = text.split('\n').filter(l => l.startsWith('data: '));
      let result = null;

      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          const parts = parsed?.message?.content?.parts;
          if (parts && parts.length > 0) {
            result = parts.join('');
          }
        } catch {}
      }

      if (result) logger.debug(`🤖 ChatGPT: ${result.slice(0, 80)}...`);
      return result?.trim() || null;
    } catch (err) {
      logger.warn(`ChatGPT API failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Call Gemini API (via API key, free 15 RPM)
   */
  async gemini(prompt, options = {}) {
    if (!this.hasGemini) {
      logger.warn('Gemini API key missing. Run: reup auth gemini');
      return null;
    }

    try {
      const model = options.model || 'gemini-2.0-flash';
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this._geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: options.temperature || 0.7,
              maxOutputTokens: options.maxTokens || 1024,
            },
          }),
        }
      );

      if (response.status === 401 || response.status === 403) {
        logger.warn('Gemini API key invalid. Run: reup auth gemini');
        return null;
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) logger.debug(`✨ Gemini: ${text.slice(0, 80)}...`);
      return text?.trim() || null;
    } catch (err) {
      logger.warn(`Gemini API failed: ${err.message}`);
      return null;
    }
  }

  // ============================================
  // High-level methods (used by SEO modules)
  // ============================================

  async generateTitle(video, genre, format, lang, trendingKeywords = []) {
    const formatRules = {
      youtube_shorts: 'Max 60 chars. Emoji. Hook first 3 words.',
      youtube_long: 'Max 80 chars. SEO keyword in first 5 words.',
      facebook_reels: 'Max 50 chars. Casual, emoji.',
    };

    const prompt = `You are a ${lang === 'vi' ? 'Vietnamese' : 'English'} YouTube SEO expert.
Video: "${video.title || 'Untitled'}" | Genre: ${genre} | Format: ${format}
Trending: ${trendingKeywords.join(', ') || 'none'}
Rules: ${formatRules[format] || formatRules.youtube_shorts}
Generate 3 titles, one per line, NO numbering.`;

    const response = await this.chatgpt(prompt);
    if (!response) return null;
    return response.split('\n').map(t => t.trim()).filter(t => t.length > 5 && t.length < 100);
  }

  async generateDescription(video, genre, format, lang, keywords = []) {
    const prompt = `Write a ${format.replace('_', ' ')} video description in ${lang === 'vi' ? 'Vietnamese' : 'English'}.
Video: "${video.title || 'Untitled'}" | Genre: ${genre}
Keywords: ${keywords.join(', ')}
Write ${format === 'youtube_shorts' ? '2-3 lines' : '5-7 lines'} with CTA.`;

    return this.chatgpt(prompt);
  }

  async generateHashtags(video, genre, format, count = 20) {
    const prompt = `Generate ${count} viral hashtags for a ${genre} ${format.replace('_', ' ')} video: "${video.title || 'untitled'}".
Mix popular + niche. Return ONLY #hashtags, space separated.`;

    const response = await this.gemini(prompt) || await this.chatgpt(prompt);
    if (!response) return null;
    return (response.match(/#[\w\u00C0-\u024F\u1E00-\u1EFF]+/g) || []).slice(0, count);
  }

  getAuthStatus() {
    const sessionDays = this._sessionExpiry > Date.now()
      ? `${Math.round((this._sessionExpiry - Date.now()) / 86400000)} ngày`
      : 'expired';
    const accessMin = this._accessTokenExpiry > Date.now()
      ? `${Math.round((this._accessTokenExpiry - Date.now()) / 60000)} phút`
      : 'need refresh';

    return {
      chatgpt: {
        authenticated: this.hasChatGPT,
        sessionExpiry: sessionDays,
        accessTokenStatus: accessMin,
      },
      gemini: {
        authenticated: this.hasGemini,
      },
    };
  }

  // Readline prompt helper
  _prompt(question) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  async close() {
    this._saveTokens();
  }
}

export default AIIntegration;
