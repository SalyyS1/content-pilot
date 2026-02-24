import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import config from '../core/config.js';
import logger from '../core/logger.js';
import { addAccount, getAccounts, updateAccountCredentials } from '../core/database.js';

/**
 * Auth Manager - handles authentication for YouTube (API) and Facebook (Browser)
 * Hybrid strategy: YouTube = OAuth2 API, Facebook = Playwright browser cookies
 */
export class AuthManager {
  constructor() {
    this.tokensDir = resolve(config.dataDir, 'tokens');
    if (!existsSync(this.tokensDir)) {
      mkdirSync(this.tokensDir, { recursive: true });
    }
  }

  // =====================================================
  // YouTube OAuth2 (API method)
  // =====================================================

  /**
   * Get YouTube OAuth2 client
   */
  async getYouTubeAuth() {
    const { google } = await import('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      config.youtube.clientId,
      config.youtube.clientSecret,
      config.youtube.redirectUri
    );

    // Try loading saved tokens
    const accounts = getAccounts('youtube');
    if (accounts.length > 0) {
      try {
        const creds = JSON.parse(accounts[0].credentials);
        oauth2Client.setCredentials(creds);

        // Auto-refresh if expired
        if (creds.expiry_date && creds.expiry_date < Date.now()) {
          logger.info('YouTube token expired, refreshing...');
          const { credentials: newCreds } = await oauth2Client.refreshAccessToken();
          oauth2Client.setCredentials(newCreds);
          updateAccountCredentials(accounts[0].id, newCreds);
          logger.info('YouTube token refreshed');
        }

        return { auth: oauth2Client, account: accounts[0] };
      } catch (error) {
        logger.warn(`Failed to load YouTube creds: ${error.message}`);
      }
    }

    return { auth: oauth2Client, account: null };
  }

  /**
   * Start YouTube OAuth2 login flow
   * Returns auth URL for user to visit
   */
  async startYouTubeLogin() {
    const { auth } = await this.getYouTubeAuth();

    const authUrl = auth.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube',
        'https://www.googleapis.com/auth/youtube.readonly',
      ],
      prompt: 'consent',
    });

    return { authUrl, auth };
  }

  /**
   * Complete YouTube OAuth2 login with auth code
   */
  async completeYouTubeLogin(auth, code) {
    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);

    // Get channel info
    const { google } = await import('googleapis');
    const youtube = google.youtube({ version: 'v3', auth });
    const response = await youtube.channels.list({
      part: 'snippet',
      mine: true,
    });

    const channel = response.data.items?.[0];
    const channelName = channel?.snippet?.title || 'YouTube Account';
    const channelId = channel?.id || '';

    // Save to DB
    const accounts = getAccounts('youtube');
    if (accounts.length > 0) {
      updateAccountCredentials(accounts[0].id, tokens);
    } else {
      addAccount('youtube', channelName, 'api', tokens, { channelId });
    }

    logger.info(`YouTube logged in as: ${channelName}`);
    return { channelName, channelId, tokens };
  }

  // =====================================================
  // Facebook Browser Auth (Playwright)
  // =====================================================

  /**
   * Login to Facebook using Playwright browser
   * Opens a visible browser for the user to login manually
   */
  async loginFacebookBrowser() {
    const { chromium } = await import('playwright');

    logger.info('Opening browser for Facebook login...');
    logger.info('Please login to your Facebook account in the browser window.');

    const browser = await chromium.launch({
      headless: false,
      args: ['--start-maximized'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();
    await page.goto('https://www.facebook.com/login');

    // Wait for user to login (detect navigation to facebook.com main page)
    logger.info('Waiting for login... (close browser when done)');

    try {
      // Wait until we're on the main FB page (logged in)
      await page.waitForURL('**/facebook.com/**', {
        timeout: 300000, // 5 min timeout
        waitUntil: 'domcontentloaded',
      });

      // Give extra time for cookies to settle
      await page.waitForTimeout(3000);

      // Extract cookies
      const cookies = await context.cookies();
      const fbCookies = cookies.filter(c =>
        c.domain.includes('facebook.com')
      );

      if (fbCookies.length === 0) {
        throw new Error('No Facebook cookies found');
      }

      // Check for essential cookies
      const hasCUser = fbCookies.some(c => c.name === 'c_user');
      if (!hasCUser) {
        logger.warn('Missing c_user cookie - login may not be complete');
        // Wait more
        await page.waitForTimeout(5000);
        const retryC = (await context.cookies()).filter(c => c.domain.includes('facebook.com'));
        if (retryC.some(c => c.name === 'c_user')) {
          fbCookies.length = 0;
          fbCookies.push(...retryC.filter(c => c.domain.includes('facebook.com')));
        }
      }

      // Get user name from page
      let userName = 'Facebook User';
      try {
        await page.goto('https://www.facebook.com/me');
        await page.waitForTimeout(2000);
        userName = await page.title();
        userName = userName.replace(/\s*\|\s*Facebook.*$/i, '').trim() || 'Facebook User';
      } catch {}

      await browser.close();

      // Save to DB
      const accounts = getAccounts('facebook');
      if (accounts.length > 0) {
        updateAccountCredentials(accounts[0].id, { cookies: fbCookies });
      } else {
        addAccount('facebook', userName, 'browser', { cookies: fbCookies }, {
          pageId: config.facebook.pageId,
        });
      }

      logger.info(`Facebook logged in as: ${userName} (${fbCookies.length} cookies saved)`);
      return { userName, cookies: fbCookies };
    } catch (error) {
      await browser.close();
      throw new Error(`Facebook login failed: ${error.message}`);
    }
  }

  /**
   * Login to Facebook using exported cookie file (JSON)
   */
  async loginFacebookCookies(cookieFilePath) {
    if (!existsSync(cookieFilePath)) {
      throw new Error(`Cookie file not found: ${cookieFilePath}`);
    }

    const cookies = JSON.parse(readFileSync(cookieFilePath, 'utf-8'));

    // Normalize cookie format (support various export formats)
    const normalized = cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain || '.facebook.com',
      path: c.path || '/',
      httpOnly: c.httpOnly !== false,
      secure: c.secure !== false,
      sameSite: c.sameSite || 'Lax',
    }));

    // Validate essential cookies
    const hasCUser = normalized.some(c => c.name === 'c_user');
    const hasXs = normalized.some(c => c.name === 'xs');
    if (!hasCUser || !hasXs) {
      throw new Error('Invalid cookies: missing c_user or xs cookie');
    }

    // Test cookies
    const isValid = await this._testFacebookCookies(normalized);
    if (!isValid) {
      throw new Error('Facebook cookies are invalid or expired');
    }

    // Save to DB
    const accounts = getAccounts('facebook');
    if (accounts.length > 0) {
      updateAccountCredentials(accounts[0].id, { cookies: normalized });
    } else {
      addAccount('facebook', 'Facebook (Cookie)', 'cookie', { cookies: normalized }, {
        pageId: config.facebook.pageId,
      });
    }

    logger.info(`Facebook cookies imported (${normalized.length} cookies)`);
    return { cookies: normalized };
  }

  /**
   * Load Facebook Playwright context with saved cookies
   */
  async getFacebookContext(options = {}) {
    const accounts = getAccounts('facebook');
    if (accounts.length === 0) {
      throw new Error('No Facebook account configured. Run: video-reup auth login facebook');
    }

    const creds = JSON.parse(accounts[0].credentials);
    if (!creds.cookies || creds.cookies.length === 0) {
      throw new Error('No Facebook cookies found. Please re-login.');
    }

    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: options.headless !== false,
      args: ['--disable-blink-features=AutomationControlled'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    await context.addCookies(creds.cookies);

    return { browser, context, account: accounts[0] };
  }

  /**
   * Test if Facebook cookies are still valid
   */
  async _testFacebookCookies(cookies) {
    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      await context.addCookies(cookies);

      const page = await context.newPage();
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2000);

      // Check if logged in by looking for login form absence
      const loginForm = await page.$('form[action*="login"]');
      const isLoggedIn = !loginForm;

      await browser.close();
      return isLoggedIn;
    } catch {
      return false;
    }
  }

  /**
   * Get auth status for all platforms
   */
  getStatus() {
    const ytAccounts = getAccounts('youtube');
    const fbAccounts = getAccounts('facebook');

    return {
      youtube: {
        authenticated: ytAccounts.length > 0,
        method: ytAccounts[0]?.auth_type || 'none',
        name: ytAccounts[0]?.name || 'Not connected',
        channelId: ytAccounts[0]?.channel_id || null,
      },
      facebook: {
        authenticated: fbAccounts.length > 0,
        method: fbAccounts[0]?.auth_type || 'none',
        name: fbAccounts[0]?.name || 'Not connected',
        pageId: fbAccounts[0]?.page_id || config.facebook.pageId || null,
      },
    };
  }
}

// Singleton
let instance;
export function getAuthManager() {
  if (!instance) instance = new AuthManager();
  return instance;
}

export default AuthManager;
