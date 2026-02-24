/**
 * Video Transformer — 5-stage FFmpeg processing pipeline
 * 
 * Pipeline: ANALYZE → CLEAN → TRANSFORM → ENHANCE → EXPORT
 * 
 * Uses fluent-ffmpeg for chainable API with progress events.
 * Each stage produces a temp file; final output is the EXPORT result.
 */

import ffmpeg from 'fluent-ffmpeg';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { resolve, dirname, basename, extname, join } from 'path';
import { EventEmitter } from 'events';
import logger from '../core/logger.js';
import { getPreset, getPlatform, randomInRange, randomInt } from './preset-manager.js';

const TEMP_DIR = resolve(process.cwd(), 'downloads', 'tmp');

export class VideoTransformer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.preset = getPreset(options.preset || 'standard');
    this.platform = getPlatform(options.platform || 'youtube_shorts');
    this.tempFiles = [];

    // Ensure temp dir exists
    if (!existsSync(TEMP_DIR)) {
      mkdirSync(TEMP_DIR, { recursive: true });
    }
  }

  /**
   * Analyze video metadata via ffprobe
   * @param {string} inputPath
   * @returns {Promise<object>} { width, height, duration, fps, codec, bitrate, audioCodec, sampleRate }
   */
  async analyze(inputPath) {
    this.emit('stage:start', { stage: 'analyze', input: inputPath });
    logger.info('🔍 Stage 1/5: ANALYZE');

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          logger.error(`FFprobe failed: ${err.message}`);
          // Return defaults on failure
          resolve({
            width: 1080, height: 1920, duration: 60,
            fps: 30, codec: 'h264', bitrate: 0,
            audioCodec: 'aac', sampleRate: 44100,
          });
          return;
        }

        const videoStream = metadata.streams.find(s => s.codec_type === 'video') || {};
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio') || {};

        const info = {
          width: videoStream.width || 1080,
          height: videoStream.height || 1920,
          duration: parseFloat(metadata.format.duration || 0),
          fps: eval(videoStream.r_frame_rate || '30/1'),
          codec: videoStream.codec_name || 'h264',
          bitrate: parseInt(metadata.format.bit_rate || 0),
          audioCodec: audioStream.codec_name || 'aac',
          sampleRate: parseInt(audioStream.sample_rate || 44100),
          hasAudio: !!audioStream.codec_name,
        };

        logger.info(`   📐 ${info.width}x${info.height} | ${info.duration.toFixed(1)}s | ${info.fps}fps | ${info.codec}`);
        this.emit('stage:complete', { stage: 'analyze', data: info });
        resolve(info);
      });
    });
  }

  /**
   * Run the full 5-stage pipeline
   * @param {string} inputPath - Source video
   * @param {string} outputPath - Final output path
   * @param {object} variation - Optional variation params from VariationEngine
   * @returns {Promise<object>} { outputPath, stages, duration, metadata }
   */
  async process(inputPath, outputPath, variation = null) {
    if (!existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }

    const startTime = Date.now();
    const stages = [];
    let currentPath = inputPath;

    try {
      // Stage 1: ANALYZE
      const metadata = await this.analyze(inputPath);

      // Stage 2: CLEAN — strip metadata, remove embedded subs
      currentPath = await this._clean(currentPath, metadata);
      stages.push('clean');

      // Stage 3: TRANSFORM — resize, speed, crop
      currentPath = await this._transform(currentPath, metadata, variation);
      stages.push('transform');

      // Stage 4: ENHANCE — brightness, contrast, saturation, hue
      if (this.preset.enhance || this.preset.colorShift) {
        currentPath = await this._enhance(currentPath, metadata, variation);
        stages.push('enhance');
      }

      // Stage 5: EXPORT — platform-specific encoding
      await this._export(currentPath, outputPath, metadata);
      stages.push('export');

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`✅ Pipeline complete: ${stages.length} stages in ${elapsed}s`);
      logger.info(`   📦 Output: ${outputPath}`);

      this.emit('complete', { outputPath, stages, duration: elapsed, metadata });

      return {
        outputPath,
        stages,
        duration: parseFloat(elapsed),
        metadata,
        preset: this.preset.name,
        platform: this.platform.name,
      };
    } catch (error) {
      logger.error(`Pipeline failed at stage "${stages[stages.length - 1] || 'init'}": ${error.message}`);
      this.emit('error', { stage: stages[stages.length - 1], error });
      throw error;
    } finally {
      // Cleanup temp files
      this._cleanup();
    }
  }

  // ============================================
  // Stage 2: CLEAN — Strip metadata
  // ============================================
  async _clean(inputPath, metadata) {
    this.emit('stage:start', { stage: 'clean' });
    logger.info('🧹 Stage 2/5: CLEAN (strip metadata)');

    const tempPath = this._tempPath('clean');

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-map_metadata', '-1',     // Strip all metadata
          '-map_chapters', '-1',     // Remove chapters
          '-fflags', '+bitexact',    // Deterministic output
          '-flags:v', '+bitexact',
          '-flags:a', '+bitexact',
        ])
        .videoCodec('copy')   // No re-encode for speed
        .audioCodec('copy')
        .output(tempPath)
        .on('end', () => {
          logger.info('   ✓ Metadata stripped');
          this.emit('stage:complete', { stage: 'clean' });
          resolve(tempPath);
        })
        .on('error', (err) => {
          logger.warn(`   Clean stage failed: ${err.message}, using original`);
          resolve(inputPath); // Graceful fallback
        })
        .run();
    });
  }

  // ============================================
  // Stage 3: TRANSFORM — Resize, speed, crop
  // ============================================
  async _transform(inputPath, metadata, variation) {
    this.emit('stage:start', { stage: 'transform' });
    logger.info('🔄 Stage 3/5: TRANSFORM (resize, speed, crop)');

    const tempPath = this._tempPath('transform');
    const vFilters = [];
    const aFilters = [];

    // Speed adjustment
    const speed = variation?.speed || randomInRange(this.preset.speed);
    const setpts = (1 / speed).toFixed(4);
    vFilters.push(`setpts=${setpts}*PTS`);
    aFilters.push(`atempo=${speed.toFixed(4)}`);
    logger.info(`   ↔ Speed: ${speed.toFixed(3)}x`);

    // Crop (if enabled or from variation)
    const cropPercent = variation?.cropPercent || (this.preset.crop ? randomInt(this.preset.crop) : 0);
    if (cropPercent > 0) {
      const factor = (100 - cropPercent) / 100;
      const offsetFactor = cropPercent / 200;
      vFilters.push(`crop=in_w*${factor.toFixed(4)}:in_h*${factor.toFixed(4)}:in_w*${offsetFactor.toFixed(4)}:in_h*${offsetFactor.toFixed(4)}`);
      logger.info(`   ✂ Crop: ${cropPercent}%`);
    }

    // Resize to platform dimensions
    if (this.preset.resize) {
      vFilters.push(`scale=${this.platform.width}:${this.platform.height}:force_original_aspect_ratio=decrease`);
      vFilters.push(`pad=${this.platform.width}:${this.platform.height}:(ow-iw)/2:(oh-ih)/2:black`);
      logger.info(`   📐 Resize: ${this.platform.width}x${this.platform.height}`);
    }

    // Duration limit
    const inputOptions = [];
    if (this.platform.maxDuration && metadata.duration > this.platform.maxDuration) {
      inputOptions.push(`-t ${this.platform.maxDuration}`);
      logger.info(`   ⏱ Duration limited: ${this.platform.maxDuration}s`);
    }

    return new Promise((resolve, reject) => {
      let cmd = ffmpeg(inputPath);

      if (inputOptions.length) {
        cmd = cmd.inputOptions(inputOptions);
      }

      cmd
        .videoFilters(vFilters)
        .audioFilters(aFilters)
        .videoCodec('libx264')
        .addOptions(['-preset', 'fast', '-crf', '20'])
        .audioCodec('aac')
        .audioBitrate('192k')
        .output(tempPath)
        .on('progress', (p) => {
          this.emit('progress', { stage: 'transform', percent: p.percent });
        })
        .on('end', () => {
          logger.info('   ✓ Transform complete');
          this.emit('stage:complete', { stage: 'transform' });
          resolve(tempPath);
        })
        .on('error', (err) => {
          logger.error(`   Transform failed: ${err.message}`);
          reject(err);
        })
        .run();
    });
  }

  // ============================================
  // Stage 4: ENHANCE — Color grading
  // ============================================
  async _enhance(inputPath, metadata, variation) {
    this.emit('stage:start', { stage: 'enhance' });
    logger.info('🎨 Stage 4/5: ENHANCE (color grading)');

    const tempPath = this._tempPath('enhance');
    const eqParts = [];

    // Brightness
    const brightness = variation?.brightness || randomInRange(this.preset.brightness || [-0.03, 0.03]);
    eqParts.push(`brightness=${brightness.toFixed(4)}`);

    // Contrast
    const contrast = variation?.contrast || randomInRange(this.preset.contrast || [0.98, 1.02]);
    eqParts.push(`contrast=${contrast.toFixed(4)}`);

    // Saturation
    const saturation = variation?.saturation || randomInRange(this.preset.saturation || [0.97, 1.03]);
    eqParts.push(`saturation=${saturation.toFixed(4)}`);

    logger.info(`   🎨 B:${brightness.toFixed(3)} C:${contrast.toFixed(3)} S:${saturation.toFixed(3)}`);

    const vFilters = [`eq=${eqParts.join(':')}`];

    // Hue shift
    const hue = variation?.hue || 0;
    if (hue !== 0) {
      vFilters.push(`hue=h=${hue}`);
      logger.info(`   🌈 Hue: ${hue}°`);
    }

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoFilters(vFilters)
        .videoCodec('libx264')
        .addOptions(['-preset', 'fast', '-crf', '20'])
        .audioCodec('copy') // Don't re-encode audio
        .output(tempPath)
        .on('progress', (p) => {
          this.emit('progress', { stage: 'enhance', percent: p.percent });
        })
        .on('end', () => {
          logger.info('   ✓ Enhancement applied');
          this.emit('stage:complete', { stage: 'enhance' });
          resolve(tempPath);
        })
        .on('error', (err) => {
          logger.warn(`   Enhance failed: ${err.message}, using input`);
          resolve(inputPath); // Graceful fallback
        })
        .run();
    });
  }

  // ============================================
  // Stage 5: EXPORT — Platform-specific encoding
  // ============================================
  async _export(inputPath, outputPath, metadata) {
    this.emit('stage:start', { stage: 'export' });
    logger.info(`📦 Stage 5/5: EXPORT (${this.platform.name})`);

    // Ensure output directory exists
    const outDir = dirname(outputPath);
    if (!existsSync(outDir)) {
      mkdirSync(outDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoCodec(this.platform.codec)
        .audioCodec(this.platform.audioCodec)
        .audioBitrate(this.platform.audioBitrate)
        .addOptions([
          '-crf', String(this.platform.crf),
          '-preset', this.platform.ffmpegPreset,
          '-maxrate', this.platform.maxBitrate,
          '-bufsize', this.platform.maxBitrate.replace('M', '') * 2 + 'M',
          '-movflags', '+faststart',
          '-pix_fmt', 'yuv420p',
        ])
        .output(outputPath)
        .on('progress', (p) => {
          this.emit('progress', { stage: 'export', percent: p.percent });
        })
        .on('end', () => {
          logger.info(`   ✓ Exported: ${this.platform.name} (${this.platform.width}x${this.platform.height})`);
          this.emit('stage:complete', { stage: 'export' });
          resolve(outputPath);
        })
        .on('error', (err) => {
          logger.error(`   Export failed: ${err.message}`);
          reject(err);
        })
        .run();
    });
  }

  // ============================================
  // Helpers
  // ============================================

  _tempPath(stage) {
    const name = `tmp_${stage}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`;
    const p = join(TEMP_DIR, name);
    this.tempFiles.push(p);
    return p;
  }

  _cleanup() {
    for (const f of this.tempFiles) {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch (e) {
        logger.debug(`Cleanup failed for ${f}: ${e.message}`);
      }
    }
    this.tempFiles = [];
    logger.debug('🗑 Temp files cleaned');
  }
}

export default VideoTransformer;
