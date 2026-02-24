/**
 * AI Integration — OAuth2 Callback Auth (like cliproxyapi)
 * 
 * Flow:
 * 1. Start local HTTP server on localhost:PORT
 * 2. Open browser to auth page (ChatGPT / Google)
 * 3. User logs in on browser
 * 4. After login → redirect to localhost:PORT/callback?code=xxx
 * 5. Local server catches code → exchange for access token
 * 6. Done! Use token for concurrent API calls
 * 
 * No Playwright needed. No API keys needed.
 */

import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import logger from '../core/logger.js';

const SESSIONS_DIR = resolve(process.cwd(), 'data', 'sessions');
const TOKENS_FILE = join(SESSIONS_DIR, 'ai-tokens.json');
const AUTH_PORT = 8976;

// === OpenAI/ChatGPT OAuth config ===
// Public client ID used by ChatGPT web app (Auth0)
const OPENAI_AUTH = {
  clientId: 'pdlLIX2Y72MIl2rhLhTE9VV9bN905kBh',
  authUrl: 'https://auth0.openai.com/authorize',
  tokenUrl: 'https://auth0.openai.com/oauth/token',
  scope: 'openid profile email offline_access',
  audience: 'https://api.openai.com/v1',
};

// === Google/Gemini OAuth config ===
// Google's "TV/Limited Input" client ID (public, used by many CLI tools)
const GOOGLE_AUTH = {
  clientId: '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com',
  clientSecret: 'd-FL95Q19q7MQmFpd7hHD0Ty', // Public secret for installed apps
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scope: 'https://www.googleapis.com/auth/generative-language openid email',
};

export class AIIntegration {
  constructor(config = {}) {
    this._chatgptToken = null;
    this._chatgptTokenExpiry = 0;
    this._chatgptRefreshToken = null;

    this._geminiToken = null;
    this._geminiTokenExpiry = 0;
    this._geminiRefreshToken = null;

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
        this._chatgptToken = data.chatgpt.token;
        this._chatgptTokenExpiry = data.chatgpt.expiry || 0;
        this._chatgptRefreshToken = data.chatgpt.refreshToken || null;
        if (this._chatgptToken && this._chatgptTokenExpiry > Date.now()) {
          logger.info('🔑 ChatGPT token loaded from cache (valid)');
        }
      }
      if (data.gemini) {
        this._geminiToken = data.gemini.token;
        this._geminiTokenExpiry = data.gemini.expiry || 0;
        this._geminiRefreshToken = data.gemini.refreshToken || null;
        if (this._geminiToken && this._geminiTokenExpiry > Date.now()) {
          logger.info('🔑 Gemini token loaded from cache (valid)');
        }
      }
    } catch {}
  }

  _saveTokens() {
    try {
      writeFileSync(TOKENS_FILE, JSON.stringify({
        chatgpt: {
          token: this._chatgptToken,
          expiry: this._chatgptTokenExpiry,
          refreshToken: this._chatgptRefreshToken,
        },
        gemini: {
          token: this._geminiToken,
          expiry: this._geminiTokenExpiry,
          refreshToken: this._geminiRefreshToken,
        },
        savedAt: new Date().toISOString(),
      }, null, 2));
    } catch {}
  }

  // ============================================
  // OAuth2 Callback Server (shared)
  // ============================================

  /**
   * Start local server, open browser, wait for callback
   * Returns the authorization code from the callback
   */
  _waitForCallback(authUrl, port = AUTH_PORT) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://localhost:${port}`);

        if (url.pathname === '/callback' || url.pathname === '/') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <html><body style="background:#1a1a2e;color:#e6edf3;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
                <div style="text-align:center">
                  <h1 style="color:#3fb950">✅ Đăng nhập thành công!</h1>
                  <p>Bạn có thể đóng tab này và quay lại terminal.</p>
                </div>
              </body></html>
            `);
            server.close();
            resolve(code);
          } else {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <html><body style="background:#1a1a2e;color:#e6edf3;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
                <div style="text-align:center">
                  <h1 style="color:#f85149">❌ Đăng nhập thất bại</h1>
                  <p>${error || 'Unknown error'}</p>
                </div>
              </body></html>
            `);
            server.close();
            reject(new Error(error || 'Auth failed'));
          }
        } else {
          // For manual paste mode: user can paste the full callback URL
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <html><body style="background:#1a1a2e;color:#e6edf3;font-family:sans-serif;padding:40px">
              <h2>🔑 Đang chờ đăng nhập...</h2>
              <p>Nếu browser không tự động mở, copy link này:</p>
              <textarea style="width:100%;height:60px;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:10px;font-size:12px" readonly>${authUrl}</textarea>
            </body></html>
          `);
        }
      });

      server.listen(port, () => {
        logger.info(`🌐 Auth server started on http://localhost:${port}`);
        logger.info(`📋 Opening browser for login...`);

        // Open browser
        const { exec } = require('child_process');
        const cmd = process.platform === 'win32' ? 'start' :
                     process.platform === 'darwin' ? 'open' : 'xdg-open';
        exec(`${cmd} "${authUrl}"`);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('Auth timeout (5 min)'));
      }, 300000);
    });
  }

  // ============================================
  // ChatGPT OAuth
  // ============================================

  /**
   * Login to ChatGPT via OAuth2 callback
   */
  async authChatGPT() {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const state = randomBytes(16).toString('hex');
    const redirectUri = `http://localhost:${AUTH_PORT}/callback`;

    const authUrl = `${OPENAI_AUTH.authUrl}?` + new URLSearchParams({
      client_id: OPENAI_AUTH.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: OPENAI_AUTH.scope,
      audience: OPENAI_AUTH.audience,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'login',
    }).toString();

    logger.info('🔑 === ChatGPT Login ===');
    logger.info('Mở browser để đăng nhập...');

    const code = await this._waitForCallback(authUrl);

    // Exchange code for token
    const tokenRes = await fetch(OPENAI_AUTH.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: OPENAI_AUTH.clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.access_token) {
      this._chatgptToken = tokenData.access_token;
      this._chatgptTokenExpiry = Date.now() + (tokenData.expires_in || 3600) * 1000;
      this._chatgptRefreshToken = tokenData.refresh_token || null;
      this._saveTokens();
      logger.info('✅ ChatGPT auth thành công! Token saved.');
      return true;
    } else {
      logger.error(`❌ ChatGPT token exchange failed: ${JSON.stringify(tokenData)}`);
      return false;
    }
  }

  /**
   * Get valid ChatGPT token (auto-refresh if expired)
   */
  async getChatGPTToken() {
    if (this._chatgptToken && this._chatgptTokenExpiry > Date.now()) {
      return this._chatgptToken;
    }

    // Try refresh
    if (this._chatgptRefreshToken) {
      try {
        const res = await fetch(OPENAI_AUTH.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            client_id: OPENAI_AUTH.clientId,
            refresh_token: this._chatgptRefreshToken,
          }),
        });
        const data = await res.json();
        if (data.access_token) {
          this._chatgptToken = data.access_token;
          this._chatgptTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
          if (data.refresh_token) this._chatgptRefreshToken = data.refresh_token;
          this._saveTokens();
          logger.info('🔄 ChatGPT token refreshed');
          return this._chatgptToken;
        }
      } catch (err) {
        logger.warn(`ChatGPT refresh failed: ${err.message}`);
      }
    }

    // Need re-auth
    logger.warn('ChatGPT token expired. Run "reup auth chatgpt" to re-login.');
    return null;
  }

  // ============================================
  // Gemini OAuth
  // ============================================

  async authGemini() {
    const state = randomBytes(16).toString('hex');
    const redirectUri = `http://localhost:${AUTH_PORT}/callback`;

    const authUrl = `${GOOGLE_AUTH.authUrl}?` + new URLSearchParams({
      client_id: GOOGLE_AUTH.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_AUTH.scope,
      state,
      access_type: 'offline',
      prompt: 'consent',
    }).toString();

    logger.info('🔑 === Gemini (Google) Login ===');
    logger.info('Mở browser để đăng nhập Google...');

    const code = await this._waitForCallback(authUrl);

    // Exchange code for tokens
    const tokenRes = await fetch(GOOGLE_AUTH.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: GOOGLE_AUTH.clientId,
        client_secret: GOOGLE_AUTH.clientSecret,
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.access_token) {
      this._geminiToken = tokenData.access_token;
      this._geminiTokenExpiry = Date.now() + (tokenData.expires_in || 3600) * 1000;
      this._geminiRefreshToken = tokenData.refresh_token || null;
      this._saveTokens();
      logger.info('✅ Gemini auth thành công! Token saved.');
      return true;
    } else {
      logger.error(`❌ Gemini token exchange failed: ${JSON.stringify(tokenData)}`);
      return false;
    }
  }

  async getGeminiToken() {
    if (this._geminiToken && this._geminiTokenExpiry > Date.now()) {
      return this._geminiToken;
    }

    // Try refresh
    if (this._geminiRefreshToken) {
      try {
        const res = await fetch(GOOGLE_AUTH.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: GOOGLE_AUTH.clientId,
            client_secret: GOOGLE_AUTH.clientSecret,
            refresh_token: this._geminiRefreshToken,
          }).toString(),
        });
        const data = await res.json();
        if (data.access_token) {
          this._geminiToken = data.access_token;
          this._geminiTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
          this._saveTokens();
          logger.info('🔄 Gemini token refreshed');
          return this._geminiToken;
        }
      } catch (err) {
        logger.warn(`Gemini refresh failed: ${err.message}`);
      }
    }

    logger.warn('Gemini token expired. Run "reup auth gemini" to re-login.');
    return null;
  }

  // ============================================
  // API Calls (concurrent-safe, no browser needed)
  // ============================================

  /**
   * Call ChatGPT API
   */
  async chatgpt(prompt, options = {}) {
    const token = await this.getChatGPTToken();
    if (!token) return null;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: options.maxTokens || 1024,
          temperature: options.temperature || 0.7,
        }),
      });

      if (response.status === 401) {
        this._chatgptToken = null;
        this._chatgptTokenExpiry = 0;
        logger.warn('ChatGPT token expired, need re-auth');
        return null;
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text) logger.debug(`🤖 ChatGPT: ${text.slice(0, 80)}...`);
      return text?.trim() || null;
    } catch (err) {
      logger.warn(`ChatGPT API failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Call Gemini API
   */
  async gemini(prompt, options = {}) {
    const token = await this.getGeminiToken();
    if (!token) return null;

    try {
      const model = options.model || 'gemini-2.0-flash';
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: options.temperature || 0.7,
              maxOutputTokens: options.maxTokens || 1024,
            },
          }),
        }
      );

      if (response.status === 401) {
        this._geminiToken = null;
        this._geminiTokenExpiry = 0;
        logger.warn('Gemini token expired, need re-auth');
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

  async generateDaoLyStatus(topic, lang = 'vi', count = 3) {
    const prompt = lang === 'vi'
      ? `Viết ${count} câu status đạo lý về "${topic}". Mỗi câu 1-2 dòng. Không đánh số. Emoji nhẹ.`
      : `Write ${count} motivational quotes about "${topic}". One per line. Subtle emoji.`;

    const response = await this.chatgpt(prompt);
    if (!response) return null;
    return response.split('\n').map(s => s.trim()).filter(s => s.length > 0);
  }

  async generateHashtags(video, genre, format, count = 20) {
    const prompt = `Generate ${count} viral hashtags for a ${genre} ${format.replace('_', ' ')} video: "${video.title || 'untitled'}".
Mix popular + niche. Return ONLY #hashtags, space separated.`;

    const response = await this.gemini(prompt);
    if (!response) return null;
    return (response.match(/#[\w\u00C0-\u024F\u1E00-\u1EFF]+/g) || []).slice(0, count);
  }

  // Auth command handler (for CLI)
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

  get hasChatGPT() { return !!(this._chatgptToken && this._chatgptTokenExpiry > Date.now()) || !!this._chatgptRefreshToken; }
  get hasGemini() { return !!(this._geminiToken && this._geminiTokenExpiry > Date.now()) || !!this._geminiRefreshToken; }
  get hasOpenAI() { return this.hasChatGPT; }

  getAuthStatus() {
    return {
      chatgpt: {
        authenticated: this.hasChatGPT,
        expiresAt: this._chatgptTokenExpiry ? new Date(this._chatgptTokenExpiry).toISOString() : null,
        hasRefreshToken: !!this._chatgptRefreshToken,
      },
      gemini: {
        authenticated: this.hasGemini,
        expiresAt: this._geminiTokenExpiry ? new Date(this._geminiTokenExpiry).toISOString() : null,
        hasRefreshToken: !!this._geminiRefreshToken,
      },
    };
  }

  async close() {
    this._saveTokens();
  }
}

export default AIIntegration;
