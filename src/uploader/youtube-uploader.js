import { createReadStream, statSync, existsSync } from 'fs';
import { resolve, basename } from 'path';
import config from '../core/config.js';
import logger from '../core/logger.js';
import { getAccounts, updateUpload } from '../core/database.js';

/**
 * YouTube Uploader - uses YouTube Data API v3 (OAuth2)
 */
export class YouTubeUploader {
  constructor() {
    this._youtube = null;
    this._auth = null;
  }

  async _getYouTubeService() {
    if (this._youtube) return this._youtube;

    const { AuthManager } = await import('../auth/auth-manager.js');
    const authManager = new AuthManager();
    const { auth, account } = await authManager.getYouTubeAuth();

    if (!account) {
      throw new Error('YouTube not authenticated. Run: video-reup auth login youtube');
    }

    const { google } = await import('googleapis');
    this._youtube = google.youtube({ version: 'v3', auth });
    this._auth = auth;
    return this._youtube;
  }

  /**
   * Upload a video to YouTube as a Short
   */
  async upload(filePath, metadata = {}, uploadId = null) {
    if (!existsSync(filePath)) {
      throw new Error(`Video file not found: ${filePath}`);
    }

    const youtube = await this._getYouTubeService();

    const title = this._ensureShortTitle(metadata.title || basename(filePath, '.mp4'));
    const description = this._buildDescription(metadata.description, metadata.hashtags);

    logger.info(`Uploading to YouTube: ${title}`);
    if (uploadId) updateUpload(uploadId, { status: 'uploading' });

    try {
      const fileSize = statSync(filePath).size;

      const response = await youtube.videos.insert({
        part: 'snippet,status',
        requestBody: {
          snippet: {
            title: title.slice(0, 100), // YouTube title limit
            description: description.slice(0, 5000),
            tags: metadata.tags || metadata.hashtags || [],
            categoryId: metadata.categoryId || '22', // People & Blogs
            defaultLanguage: metadata.language || 'vi',
          },
          status: {
            privacyStatus: metadata.privacy || 'public',
            selfDeclaredMadeForKids: false,
            embeddable: true,
          },
        },
        media: {
          body: createReadStream(filePath),
        },
      }, {
        onUploadProgress: (evt) => {
          const progress = Math.round((evt.bytesRead / fileSize) * 100);
          if (progress % 20 === 0) {
            logger.debug(`YouTube upload progress: ${progress}%`);
          }
        },
      });

      const videoId = response.data.id;
      const videoUrl = `https://www.youtube.com/shorts/${videoId}`;

      logger.info(`YouTube upload complete: ${videoUrl}`);

      if (uploadId) {
        updateUpload(uploadId, {
          status: 'published',
          target_url: videoUrl,
          uploaded_at: new Date().toISOString(),
        });
      }

      return {
        success: true,
        videoId,
        videoUrl,
        title,
      };
    } catch (error) {
      logger.error(`YouTube upload failed: ${error.message}`);
      if (uploadId) {
        updateUpload(uploadId, {
          status: 'failed',
          error_message: error.message,
        });
      }
      throw error;
    }
  }

  /**
   * Check remaining YouTube API quota
   */
  async checkQuota() {
    // YouTube API doesn't have a direct quota check endpoint
    // We estimate based on today's uploads
    const { getStats } = await import('../core/database.js');
    const stats = getStats();
    const quotaUsed = stats.todayUploads * 100; // ~100 units per upload
    const remaining = 10000 - quotaUsed;

    return {
      totalQuota: 10000,
      used: quotaUsed,
      remaining: Math.max(0, remaining),
      uploadsRemaining: Math.floor(remaining / 100),
    };
  }

  // Ensure title has #Shorts tag
  _ensureShortTitle(title) {
    if (!title.toLowerCase().includes('#shorts')) {
      return `${title} #Shorts`;
    }
    return title;
  }

  // Build description with hashtags
  _buildDescription(description = '', hashtags = []) {
    let desc = description;

    if (hashtags.length > 0) {
      const tagStr = hashtags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ');
      desc += `\n\n${tagStr}`;
    }

    // Always ensure #Shorts is included
    if (!desc.toLowerCase().includes('#shorts')) {
      desc += '\n#Shorts';
    }

    return desc.trim();
  }
}

export default YouTubeUploader;
