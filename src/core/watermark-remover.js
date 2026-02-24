/**
 * Watermark Remover — Auto-detect & remove watermarks from videos
 * 
 * Techniques:
 * 1. Corner crop  — crop 3-5% from edges where watermarks typically appear
 * 2. Delogo       — ffmpeg delogo filter to blur/remove specific regions
 * 3. Smart detect — scan video frames for static overlay (watermark pattern)
 * 4. Overlay      — cover watermark with blur/fill
 * 
 * Common watermark positions:
 *   TikTok:     top-left (username), bottom-right (logo)
 *   YouTube:    bottom-right (subscribe), top-right (channel logo)
 *   Instagram:  center-bottom (username)
 *   CapCut:     bottom-center (CapCut logo)
 *   Generic:    corner areas
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { resolve, dirname, basename, extname } from 'path';
import logger from './logger.js';

// ============================================
// Known Watermark Templates
// ============================================
const WATERMARK_TEMPLATES = {
  // TikTok watermark positions (relative to video dimensions)
  tiktok: {
    name: 'TikTok',
    regions: [
      // Username top-left
      { x: '0', y: '0', w: 'iw*0.4', h: 'ih*0.08', label: 'TikTok username' },
      // Logo bottom-right
      { x: 'iw*0.75', y: 'ih*0.9', w: 'iw*0.25', h: 'ih*0.1', label: 'TikTok logo' },
      // Watermark bottom-center
      { x: 'iw*0.3', y: 'ih*0.92', w: 'iw*0.4', h: 'ih*0.08', label: 'TikTok watermark' },
    ],
    // Detection keywords in metadata
    detectKeywords: ['tiktok', 'douyin', 'musically'],
  },

  // YouTube watermark
  youtube: {
    name: 'YouTube',
    regions: [
      // Subscribe button bottom-right
      { x: 'iw*0.8', y: 'ih*0.85', w: 'iw*0.2', h: 'ih*0.15', label: 'Subscribe button' },
    ],
    detectKeywords: ['youtube', 'yt'],
  },

  // Instagram Reels
  instagram: {
    name: 'Instagram',
    regions: [
      // Username bottom-left
      { x: '0', y: 'ih*0.88', w: 'iw*0.5', h: 'ih*0.12', label: 'IG username' },
      // Reel icon bottom-right
      { x: 'iw*0.85', y: 'ih*0.88', w: 'iw*0.15', h: 'ih*0.12', label: 'Reel icon' },
    ],
    detectKeywords: ['instagram', 'reels', 'ig'],
  },

  // CapCut
  capcut: {
    name: 'CapCut',
    regions: [
      // CapCut logo bottom-center
      { x: 'iw*0.3', y: 'ih*0.93', w: 'iw*0.4', h: 'ih*0.07', label: 'CapCut logo' },
    ],
    detectKeywords: ['capcut', 'cap cut'],
  },

  // Generic — safe fallback (crop all corners slightly)
  generic: {
    name: 'Generic',
    regions: [
      { x: '0', y: '0', w: 'iw*0.15', h: 'ih*0.06', label: 'Top-left corner' },
      { x: 'iw*0.85', y: '0', w: 'iw*0.15', h: 'ih*0.06', label: 'Top-right corner' },
      { x: '0', y: 'ih*0.92', w: 'iw*0.2', h: 'ih*0.08', label: 'Bottom-left corner' },
      { x: 'iw*0.8', y: 'ih*0.92', w: 'iw*0.2', h: 'ih*0.08', label: 'Bottom-right corner' },
    ],
    detectKeywords: [],
  },
};

// ============================================
// Watermark Remover Class
// ============================================
export class WatermarkRemover {
  constructor(options = {}) {
    this.ffmpegPath = options.ffmpegPath || 'ffmpeg';
    this.ffprobePath = options.ffprobePath || 'ffprobe';
    this.outputDir = options.outputDir || resolve(process.cwd(), 'downloads', 'cleaned');
    this.mode = options.mode || 'smart'; // 'smart' | 'aggressive' | 'crop' | 'blur'

    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Remove watermarks from a video
   * @param {string} inputPath - Path to input video
   * @param {object} options - { source, mode, customRegions }
   * @returns {object} - { outputPath, watermarksRemoved, method }
   */
  async remove(inputPath, options = {}) {
    if (!existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }

    const source = options.source || 'auto'; // 'tiktok', 'youtube', 'auto', etc.
    const mode = options.mode || this.mode;

    // Get video info
    const videoInfo = await this._getVideoInfo(inputPath);
    logger.info(`📐 Video: ${videoInfo.width}x${videoInfo.height}, ${videoInfo.duration}s`);

    // Detect watermark source
    const detectedSource = source === 'auto'
      ? this._detectSource(inputPath, options.metadata)
      : source;

    logger.info(`🔍 Watermark source: ${detectedSource}`);

    // Get removal strategy
    const template = WATERMARK_TEMPLATES[detectedSource] || WATERMARK_TEMPLATES.generic;
    const outputName = `clean_${basename(inputPath)}`;
    const outputPath = resolve(this.outputDir, outputName);

    let result;

    switch (mode) {
      case 'crop':
        // Method 1: Smart crop — remove edges where watermarks live
        result = await this._cropWatermarks(inputPath, outputPath, videoInfo);
        break;

      case 'blur':
        // Method 2: Blur regions — blur specific watermark areas
        result = await this._blurRegions(inputPath, outputPath, template, videoInfo);
        break;

      case 'fill':
        // Method 3: Fill — replace watermark area with surrounding pixels
        result = await this._fillRegions(inputPath, outputPath, template, videoInfo);
        break;

      case 'aggressive':
        // Method 4: Aggressive — crop + blur + slight zoom
        result = await this._aggressiveRemoval(inputPath, outputPath, template, videoInfo);
        break;

      case 'smart':
      default:
        // Method 5: Smart — combine best techniques
        result = await this._smartRemoval(inputPath, outputPath, template, videoInfo);
        break;
    }

    logger.info(`✨ Watermark removed: ${result.method} | ${result.regionsProcessed} regions`);
    return {
      outputPath: result.outputPath,
      source: detectedSource,
      method: result.method,
      regionsProcessed: result.regionsProcessed,
      watermarksRemoved: result.regionsProcessed > 0,
    };
  }

  /**
   * Smart removal — the best all-round approach
   * Combines: slight crop (3%) + blur detected regions + overlay fill
   */
  async _smartRemoval(inputPath, outputPath, template, videoInfo) {
    const { width: w, height: h } = videoInfo;
    const filters = [];

    // Step 1: Slight crop to remove thin edge watermarks (3% each side)
    const cropW = Math.floor(w * 0.94);
    const cropH = Math.floor(h * 0.94);
    const cropX = Math.floor(w * 0.03);
    const cropY = Math.floor(h * 0.03);
    filters.push(`crop=${cropW}:${cropH}:${cropX}:${cropY}`);

    // Step 2: Scale back to original size (maintains resolution)
    filters.push(`scale=${w}:${h}:flags=lanczos`);

    // Step 3: Delogo on known watermark regions (after rescale)
    for (const region of template.regions) {
      // Convert expressions to pixel values
      const rx = this._evalExpr(region.x, w, h);
      const ry = this._evalExpr(region.y, w, h);
      const rw = this._evalExpr(region.w, w, h);
      const rh = this._evalExpr(region.h, w, h);

      // Adjust for crop offset
      const adjX = Math.max(0, Math.floor(rx - cropX * (w / cropW)));
      const adjY = Math.max(0, Math.floor(ry - cropY * (h / cropH)));

      filters.push(`delogo=x=${adjX}:y=${adjY}:w=${Math.floor(rw)}:h=${Math.floor(rh)}:show=0`);
    }

    await this._runFfmpeg(inputPath, outputPath, filters);

    return {
      outputPath,
      method: 'smart (crop + delogo)',
      regionsProcessed: template.regions.length,
    };
  }

  /**
   * Crop watermarks — remove edges
   */
  async _cropWatermarks(inputPath, outputPath, videoInfo) {
    const { width: w, height: h } = videoInfo;

    // Crop 5% from top/bottom, 3% from sides
    const cropW = Math.floor(w * 0.94);
    const cropH = Math.floor(h * 0.90);
    const cropX = Math.floor(w * 0.03);
    const cropY = Math.floor(h * 0.05);

    const filters = [
      `crop=${cropW}:${cropH}:${cropX}:${cropY}`,
      `scale=${w}:${h}:flags=lanczos`,
    ];

    await this._runFfmpeg(inputPath, outputPath, filters);

    return {
      outputPath,
      method: 'crop',
      regionsProcessed: 1,
    };
  }

  /**
   * Blur specific regions
   */
  async _blurRegions(inputPath, outputPath, template, videoInfo) {
    const { width: w, height: h } = videoInfo;
    const filters = [];

    for (const region of template.regions) {
      const rx = this._evalExpr(region.x, w, h);
      const ry = this._evalExpr(region.y, w, h);
      const rw = this._evalExpr(region.w, w, h);
      const rh = this._evalExpr(region.h, w, h);

      // Use boxblur on the specific region
      filters.push(
        `split[main][blur]`,
        `[blur]crop=${Math.floor(rw)}:${Math.floor(rh)}:${Math.floor(rx)}:${Math.floor(ry)},boxblur=15:5[blurred]`,
        `[main][blurred]overlay=${Math.floor(rx)}:${Math.floor(ry)}`
      );
    }

    // If multiple regions, chain them with complex filter
    if (template.regions.length > 0) {
      await this._runFfmpegComplex(inputPath, outputPath, template.regions, videoInfo, 'blur');
    } else {
      // No regions — just copy
      await this._runFfmpeg(inputPath, outputPath, []);
    }

    return {
      outputPath,
      method: 'blur',
      regionsProcessed: template.regions.length,
    };
  }

  /**
   * Fill regions with surrounding pixels (delogo)
   */
  async _fillRegions(inputPath, outputPath, template, videoInfo) {
    const { width: w, height: h } = videoInfo;
    const filters = [];

    for (const region of template.regions) {
      const rx = this._evalExpr(region.x, w, h);
      const ry = this._evalExpr(region.y, w, h);
      const rw = this._evalExpr(region.w, w, h);
      const rh = this._evalExpr(region.h, w, h);

      filters.push(`delogo=x=${Math.floor(rx)}:y=${Math.floor(ry)}:w=${Math.floor(rw)}:h=${Math.floor(rh)}:show=0`);
    }

    await this._runFfmpeg(inputPath, outputPath, filters);

    return {
      outputPath,
      method: 'fill (delogo)',
      regionsProcessed: template.regions.length,
    };
  }

  /**
   * Aggressive removal — maximum watermark destruction
   */
  async _aggressiveRemoval(inputPath, outputPath, template, videoInfo) {
    const { width: w, height: h } = videoInfo;
    const filters = [];

    // Step 1: Crop 5% all sides
    const cropW = Math.floor(w * 0.90);
    const cropH = Math.floor(h * 0.88);
    const cropX = Math.floor(w * 0.05);
    const cropY = Math.floor(h * 0.06);
    filters.push(`crop=${cropW}:${cropH}:${cropX}:${cropY}`);

    // Step 2: Scale back
    filters.push(`scale=${w}:${h}:flags=lanczos`);

    // Step 3: Delogo all known regions
    for (const region of template.regions) {
      const rx = this._evalExpr(region.x, w, h);
      const ry = this._evalExpr(region.y, w, h);
      const rw = this._evalExpr(region.w, w, h);
      const rh = this._evalExpr(region.h, w, h);
      filters.push(`delogo=x=${Math.floor(rx)}:y=${Math.floor(ry)}:w=${Math.floor(rw)}:h=${Math.floor(rh)}`);
    }

    // Step 4: Slight zoom effect (1.05x) to hide crop artifacts
    filters.push(`zoompan=z=1.05:d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=30`);

    await this._runFfmpeg(inputPath, outputPath, filters);

    return {
      outputPath,
      method: 'aggressive (crop + delogo + zoom)',
      regionsProcessed: template.regions.length + 1,
    };
  }

  // ============================================
  // Detection
  // ============================================

  /**
   * Auto-detect watermark source from filename/metadata
   */
  _detectSource(filePath, metadata = {}) {
    const filename = basename(filePath).toLowerCase();
    const title = (metadata?.title || '').toLowerCase();
    const channel = (metadata?.channel || '').toLowerCase();
    const description = (metadata?.description || '').toLowerCase();
    const combined = `${filename} ${title} ${channel} ${description}`;

    for (const [key, template] of Object.entries(WATERMARK_TEMPLATES)) {
      if (key === 'generic') continue;
      for (const keyword of template.detectKeywords) {
        if (combined.includes(keyword)) {
          return key;
        }
      }
    }

    return 'generic';
  }

  // ============================================
  // FFmpeg Helpers
  // ============================================

  async _getVideoInfo(inputPath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format', '-show_streams',
        inputPath,
      ];

      const proc = spawn(this.ffprobePath, args, { shell: true });
      let stdout = '';

      proc.stdout.on('data', d => stdout += d.toString());
      proc.on('close', (code) => {
        try {
          const info = JSON.parse(stdout);
          const videoStream = info.streams.find(s => s.codec_type === 'video');
          resolve({
            width: parseInt(videoStream.width),
            height: parseInt(videoStream.height),
            duration: parseFloat(info.format.duration || 0),
            codec: videoStream.codec_name,
          });
        } catch (e) {
          // Fallback defaults
          resolve({ width: 1080, height: 1920, duration: 60, codec: 'h264' });
        }
      });
      proc.on('error', () => resolve({ width: 1080, height: 1920, duration: 60, codec: 'h264' }));
    });
  }

  _evalExpr(expr, w, h) {
    if (typeof expr === 'number') return expr;
    return Function('iw', 'ih', `return ${expr}`)(w, h);
  }

  async _runFfmpeg(inputPath, outputPath, filters) {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', inputPath,
        '-y', // Overwrite
      ];

      if (filters.length > 0) {
        args.push('-vf', filters.join(','));
      }

      args.push(
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',         // High quality
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        outputPath,
      );

      logger.debug(`FFmpeg: ${args.join(' ')}`);

      const proc = spawn(this.ffmpegPath, args, { shell: true });
      let stderr = '';

      proc.stderr.on('data', d => stderr += d.toString());

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(outputPath);
        } else {
          reject(new Error(`FFmpeg failed (code ${code}): ${stderr.slice(-500)}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`FFmpeg not found: ${err.message}. Install ffmpeg first!`));
      });
    });
  }

  async _runFfmpegComplex(inputPath, outputPath, regions, videoInfo, mode) {
    // For complex multi-region blur, build a filter chain
    const { width: w, height: h } = videoInfo;
    let filterComplex = '';
    let currentInput = '0:v';

    regions.forEach((region, i) => {
      const rx = Math.floor(this._evalExpr(region.x, w, h));
      const ry = Math.floor(this._evalExpr(region.y, w, h));
      const rw = Math.floor(this._evalExpr(region.w, w, h));
      const rh = Math.floor(this._evalExpr(region.h, w, h));
      const nextLabel = i === regions.length - 1 ? 'out' : `step${i}`;

      if (mode === 'blur') {
        filterComplex += `[${currentInput}]split[main${i}][blur${i}];`;
        filterComplex += `[blur${i}]crop=${rw}:${rh}:${rx}:${ry},boxblur=20:5[blurred${i}];`;
        filterComplex += `[main${i}][blurred${i}]overlay=${rx}:${ry}[${nextLabel}];`;
      }

      currentInput = nextLabel;
    });

    // Remove trailing semicolon
    filterComplex = filterComplex.slice(0, -1);

    return new Promise((resolve, reject) => {
      const args = [
        '-i', inputPath,
        '-y',
        '-filter_complex', filterComplex,
        '-map', `[out]`,
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',
        '-c:a', 'aac',
        '-b:a', '192k',
        outputPath,
      ];

      const proc = spawn(this.ffmpegPath, args, { shell: true });
      let stderr = '';
      proc.stderr.on('data', d => stderr += d.toString());

      proc.on('close', (code) => {
        if (code === 0) resolve(outputPath);
        else reject(new Error(`FFmpeg complex filter failed: ${stderr.slice(-500)}`));
      });
      proc.on('error', (err) => reject(new Error(`FFmpeg not found: ${err.message}`)));
    });
  }
}

export default WatermarkRemover;
