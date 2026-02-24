import { existsSync, readFileSync, statSync } from 'fs';
import { resolve, basename } from 'path';
import config from '../core/config.js';
import logger from '../core/logger.js';
import { getAccounts, updateUpload } from '../core/database.js';
import axios from 'axios';

/**
 * Facebook Reels Uploader
 * Method 1: Graph API (if page access token available)
 * Method 2: Playwright browser automation (cookie-based)
 */
export class FacebookUploader {
  constructor() {
    this.graphApiBase = 'https://graph.facebook.com/v21.0';
    this.ruploadBase = 'https://rupload.facebook.com/video-upload';
  }

  /**
   * Upload a video as Facebook Reel
   * Auto-selects method based on available auth
   */
  async upload(filePath, metadata = {}, uploadId = null) {
    if (!existsSync(filePath)) {
      throw new Error(`Video file not found: ${filePath}`);
    }

    // Try API method first if token available
    const pageToken = config.facebook.pageAccessToken;
    const pageId = config.facebook.pageId;

    if (pageToken && pageId) {
      try {
        return await this._uploadViaAPI(filePath, metadata, uploadId, pageId, pageToken);
      } catch (error) {
        logger.warn(`API upload failed, falling back to browser: ${error.message}`);
      }
    }

    // Fallback to browser method
    return await this._uploadViaBrowser(filePath, metadata, uploadId);
  }

  // =====================================================
  // Method 1: Graph API Upload
  // =====================================================

  async _uploadViaAPI(filePath, metadata, uploadId, pageId, pageToken) {
    logger.info('Uploading Facebook Reel via Graph API...');
    if (uploadId) updateUpload(uploadId, { status: 'uploading' });

    try {
      // Step 1: Initialize upload session
      const initResponse = await axios.post(
        `${this.graphApiBase}/${pageId}/video_reels`,
        null,
        {
          params: {
            upload_phase: 'start',
            access_token: pageToken,
          },
        }
      );

      const videoId = initResponse.data.video_id;
      const uploadUrl = initResponse.data.upload_url;
      logger.info(`Upload session started: video_id=${videoId}`);

      // Step 2: Upload video binary
      const fileBuffer = readFileSync(filePath);
      const fileSize = statSync(filePath).size;

      await axios.post(uploadUrl, fileBuffer, {
        headers: {
          'Authorization': `OAuth ${pageToken}`,
          'offset': '0',
          'file_size': String(fileSize),
          'Content-Type': 'application/octet-stream',
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      logger.info('Video binary uploaded');

      // Step 3: Publish the Reel
      const description = this._buildDescription(metadata.description, metadata.hashtags);

      const publishResponse = await axios.post(
        `${this.graphApiBase}/${pageId}/video_reels`,
        null,
        {
          params: {
            upload_phase: 'finish',
            video_id: videoId,
            title: (metadata.title || '').slice(0, 100),
            description: description.slice(0, 2200),
            access_token: pageToken,
          },
        }
      );

      const reelUrl = `https://www.facebook.com/reel/${videoId}`;
      logger.info(`Facebook Reel published: ${reelUrl}`);

      if (uploadId) {
        updateUpload(uploadId, {
          status: 'published',
          target_url: reelUrl,
          uploaded_at: new Date().toISOString(),
        });
      }

      return {
        success: true,
        videoId,
        reelUrl,
        method: 'api',
      };
    } catch (error) {
      const errMsg = error.response?.data?.error?.message || error.message;
      logger.error(`Facebook API upload failed: ${errMsg}`);
      if (uploadId) {
        updateUpload(uploadId, { status: 'failed', error_message: errMsg });
      }
      throw new Error(`Facebook API upload failed: ${errMsg}`);
    }
  }

  // =====================================================
  // Method 2: Browser Automation Upload
  // =====================================================

  async _uploadViaBrowser(filePath, metadata, uploadId) {
    logger.info('Uploading Facebook Reel via browser automation...');
    if (uploadId) updateUpload(uploadId, { status: 'uploading' });

    const { AuthManager } = await import('../auth/auth-manager.js');
    const authManager = new AuthManager();

    let browser, context;
    try {
      ({ browser, context } = await authManager.getFacebookContext({ headless: false }));

      const page = await context.newPage();

      // Navigate to Facebook Reels creator
      // For Pages, we go through Creator Studio / Meta Business Suite
      const pageId = config.facebook.pageId;
      let creatorUrl;

      if (pageId) {
        // Meta Business Suite → Create Reel
        creatorUrl = `https://business.facebook.com/latest/home?asset_id=${pageId}`;
      } else {
        // Personal -> Creator studio
        creatorUrl = 'https://www.facebook.com/reels/create';
      }

      await page.goto(creatorUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Method: Direct Facebook Reels creation
      await page.goto('https://www.facebook.com/reels/create', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Look for file input and upload
      const absolutePath = resolve(filePath);

      // Try to find upload button / file input
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(absolutePath);
        logger.info('Video file selected');
      } else {
        // Try clicking upload area first
        const uploadArea = await page.$('[role="button"]:has-text("Upload"), [aria-label*="upload" i], [data-testid*="upload"]');
        if (uploadArea) {
          const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            uploadArea.click(),
          ]);
          await fileChooser.setFiles(absolutePath);
          logger.info('Video file uploaded via file chooser');
        } else {
          throw new Error('Could not find upload element on Facebook Reels creation page');
        }
      }

      // Wait for video to process
      await page.waitForTimeout(5000);

      // Fill in description
      const description = this._buildDescription(metadata.description, metadata.hashtags);

      // Look for description/caption input
      const descSelectors = [
        'div[contenteditable="true"][role="textbox"]',
        'textarea[placeholder*="description" i]',
        'textarea[placeholder*="caption" i]',
        'div[aria-label*="description" i][contenteditable="true"]',
        'div[data-testid="reel-description-input"]',
      ];

      for (const sel of descSelectors) {
        const descInput = await page.$(sel);
        if (descInput) {
          await descInput.click();
          await page.waitForTimeout(500);
          await descInput.fill('');
          await page.keyboard.type(description, { delay: 30 });
          logger.info('Description filled');
          break;
        }
      }

      // Wait for processing
      await page.waitForTimeout(3000);

      // Click publish/share button
      const publishSelectors = [
        'div[role="button"]:has-text("Share")',
        'div[role="button"]:has-text("Publish")',
        'div[role="button"]:has-text("Chia sẻ")',
        'div[role="button"]:has-text("Đăng")',
        'button:has-text("Share")',
        'button:has-text("Publish")',
        '[aria-label="Share"]',
        '[aria-label="Publish"]',
      ];

      let published = false;
      for (const sel of publishSelectors) {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          published = true;
          logger.info('Publish button clicked');
          break;
        }
      }

      if (!published) {
        logger.warn('Could not find publish button - video may need manual publishing');
      }

      // Wait for upload to complete
      await page.waitForTimeout(10000);

      await browser.close();

      if (uploadId) {
        updateUpload(uploadId, {
          status: published ? 'published' : 'failed',
          uploaded_at: published ? new Date().toISOString() : null,
          error_message: published ? null : 'Manual publish required',
        });
      }

      return {
        success: published,
        method: 'browser',
      };
    } catch (error) {
      if (browser) await browser.close();
      logger.error(`Facebook browser upload failed: ${error.message}`);
      if (uploadId) {
        updateUpload(uploadId, { status: 'failed', error_message: error.message });
      }
      throw error;
    }
  }

  // Build description with hashtags
  _buildDescription(description = '', hashtags = []) {
    let desc = description;
    if (hashtags.length > 0) {
      const tagStr = hashtags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ');
      desc += `\n\n${tagStr}`;
    }
    return desc.trim();
  }
}

export default FacebookUploader;
