/**
 * Variation Engine — Generate unique per-upload fingerprints
 * 
 * Each upload of the same source video gets a unique combination of
 * transform params (speed, crop, color, etc.) to avoid duplicate detection.
 * Variations are logged to DB to prevent repeats.
 */

import { createHash } from 'node:crypto';
import logger from '../core/logger.js';
import { getPreset, randomInRange, randomInt, pickRandom } from './preset-manager.js';

export class VariationEngine {
  constructor(options = {}) {
    this.preset = getPreset(options.preset || 'standard');
    this.ranges = this.preset.variationRanges;
    this._db = options.db || null; // Will use database helpers when available
  }

  /**
   * Generate a unique variation for a video
   * @param {number} videoId - Source video ID
   * @returns {object} variation params + hash
   */
  generate(videoId) {
    let variation;
    let attempts = 0;

    do {
      variation = this._randomize();
      variation.hash = this.computeHash(variation);
      attempts++;
    } while (this._isDuplicate(videoId, variation.hash) && attempts < 50);

    if (attempts >= 50) {
      logger.warn(`   ⚠ Could not find unique variation after 50 attempts for video #${videoId}`);
    }

    logger.info(`   🎲 Variation generated (attempt ${attempts}): ${variation.hash}`);
    logger.debug(`      Speed: ${variation.speed.toFixed(3)}, Pitch: ${variation.pitchShift}, B: ${variation.brightness.toFixed(3)}, C: ${variation.contrast.toFixed(3)}, S: ${variation.saturation.toFixed(3)}, Crop: ${variation.cropPercent}%, Hue: ${variation.hue}°, EQ: ${variation.audioEQ}`);

    return variation;
  }

  /**
   * Generate random params within preset ranges
   */
  _randomize() {
    return {
      speed: randomInRange(this.ranges.speed),
      pitchShift: randomInt(this.ranges.pitch),
      brightness: randomInRange(this.ranges.brightness),
      contrast: randomInRange(this.ranges.contrast),
      saturation: randomInRange(this.ranges.saturation),
      cropPercent: randomInt(this.ranges.crop),
      hue: randomInt(this.ranges.hue),
      audioEQ: pickRandom(['warm', 'bright', 'bass', 'flat', 'vocal']),
    };
  }

  /**
   * Compute hash of variation params
   */
  computeHash(variation) {
    const params = {
      speed: Math.round(variation.speed * 1000),
      pitchShift: variation.pitchShift,
      brightness: Math.round(variation.brightness * 1000),
      contrast: Math.round(variation.contrast * 1000),
      saturation: Math.round(variation.saturation * 1000),
      cropPercent: variation.cropPercent,
      hue: variation.hue,
      audioEQ: variation.audioEQ,
    };
    const sorted = JSON.stringify(params, Object.keys(params).sort());
    return createHash('sha256').update(sorted).digest('hex').slice(0, 16);
  }

  /**
   * Check if variation already used for this video (in-memory or DB)
   */
  _isDuplicate(videoId, hash) {
    if (this._db) {
      try {
        const existing = this._db.prepare(
          'SELECT id FROM video_variations WHERE video_id = ? AND variation_hash = ?'
        ).get(videoId, hash);
        return !!existing;
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Log variation to DB after successful upload
   */
  logVariation(videoId, uploadId, variation, platform) {
    if (!this._db) return;

    try {
      this._db.prepare(`
        INSERT INTO video_variations (video_id, upload_id, variation_hash, params, platform)
        VALUES (?, ?, ?, ?, ?)
      `).run(videoId, uploadId, variation.hash, JSON.stringify(variation), platform);

      logger.debug(`   📝 Variation logged: video #${videoId}, hash ${variation.hash}`);
    } catch (err) {
      logger.warn(`   Failed to log variation: ${err.message}`);
    }
  }

  /**
   * Get all variations used for a video
   */
  getVariations(videoId) {
    if (!this._db) return [];
    try {
      return this._db.prepare(
        'SELECT * FROM video_variations WHERE video_id = ? ORDER BY created_at DESC'
      ).all(videoId);
    } catch {
      return [];
    }
  }
}

export default VariationEngine;
