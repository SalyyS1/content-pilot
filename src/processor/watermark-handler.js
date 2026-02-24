/**
 * Watermark Handler — Detect & remove watermarks from source videos
 * 
 * Plugs into VideoTransformer pipeline between CLEAN and TRANSFORM stages.
 * Uses ffmpeg crop + delogo filters.
 */

import ffmpeg from 'fluent-ffmpeg';
import { existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import logger from '../core/logger.js';

const TEMP_DIR = resolve(process.cwd(), 'downloads', 'tmp');

// Known watermark positions (relative to video size)
const WATERMARK_PROFILES = {
  tiktok: {
    name: 'TikTok',
    regions: [
      { label: 'Username banner', crop: 'crop=in_w:in_h*0.92:0:in_h*0.08' },
      { label: 'Logo', delogo: { x: 'W*0.75', y: 'H*0.85', w: 'W*0.2', h: 'H*0.12' } },
    ],
    keywords: ['tiktok', 'douyin', 'musically', 'tiktok.com'],
  },
  capcut: {
    name: 'CapCut',
    regions: [
      { label: 'Bottom bar', crop: 'crop=in_w:in_h*0.95:0:0' },
    ],
    keywords: ['capcut', 'cap cut'],
  },
  instagram: {
    name: 'Instagram',
    regions: [
      { label: 'Bottom bar', crop: 'crop=in_w:in_h*0.95:0:0' },
    ],
    keywords: ['instagram', 'reels', 'ig'],
  },
  youtube: {
    name: 'YouTube',
    regions: [
      { label: 'Subscribe button', delogo: { x: 'W*0.8', y: 'H*0.85', w: 'W*0.18', h: 'H*0.12' } },
    ],
    keywords: ['youtube', 'subscribe'],
  },
};

export class WatermarkHandler {
  constructor() {
    if (!existsSync(TEMP_DIR)) {
      mkdirSync(TEMP_DIR, { recursive: true });
    }
  }

  /**
   * Detect watermark source from filename + metadata
   */
  detectSource(filePath, metadata = {}) {
    const combined = [
      filePath, metadata?.title || '', metadata?.channel || '',
      metadata?.description || '', metadata?.uploader || '',
    ].join(' ').toLowerCase();

    for (const [source, profile] of Object.entries(WATERMARK_PROFILES)) {
      if (profile.keywords.some(k => combined.includes(k))) {
        logger.info(`🔍 Watermark detected: ${profile.name}`);
        return source;
      }
    }
    return 'unknown';
  }

  /**
   * Remove watermarks using ffmpeg
   * @returns {Promise<{outputPath, source, removed}>}
   */
  async removeWatermark(inputPath, source, outputPath) {
    if (source === 'unknown' || !WATERMARK_PROFILES[source]) {
      logger.info('   No known watermark — skipping removal');
      return { outputPath: inputPath, source, removed: false };
    }

    const profile = WATERMARK_PROFILES[source];
    const regions = profile.regions;
    const filters = [];

    // Build filter chain
    for (const region of regions) {
      if (region.crop) {
        filters.push(region.crop);
      }
      if (region.delogo) {
        const { x, y, w, h } = region.delogo;
        filters.push(`delogo=x=${x}:y=${y}:w=${w}:h=${h}:show=0`);
      }
    }

    if (filters.length === 0) {
      return { outputPath: inputPath, source, removed: false };
    }

    logger.info(`🧹 Removing ${profile.name} watermark (${regions.length} regions)`);

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoFilters(filters)
        .videoCodec('libx264')
        .addOptions(['-preset', 'fast', '-crf', '20'])
        .audioCodec('copy')
        .output(outputPath)
        .on('end', () => {
          logger.info(`   ✓ ${profile.name} watermark removed`);
          resolve({ outputPath, source, removed: true });
        })
        .on('error', (err) => {
          logger.warn(`   Watermark removal failed: ${err.message}`);
          resolve({ outputPath: inputPath, source, removed: false });
        })
        .run();
    });
  }
}

export default WatermarkHandler;
