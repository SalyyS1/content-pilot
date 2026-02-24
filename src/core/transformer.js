import { WatermarkRemover } from './watermark-remover.js';
import { spawn } from 'child_process';
import { existsSync, unlinkSync, mkdirSync, renameSync } from 'fs';
import { resolve, dirname, basename, extname, join } from 'path';
import logger from './logger.js';
import config from './config.js';
import { CopyrightChecker } from './copyright-checker.js';
import { getSetting } from './database.js';

/**
 * Video Transformer - FFmpeg-based pipeline for copyright avoidance
 *
 * Workflow: Check copyright risk → Apply transforms → Output clean file
 *
 * Transforms available:
 *   Video: mirror, crop, color_grade, speed, overlay_text
 *   Audio: pitch_shift, speed, replace_audio, volume_adjust
 */
export class Transformer {
  constructor(options = {}) {
    this.ffmpegPath = options.ffmpegPath || 'ffmpeg';
    this.watermarkRemover = new WatermarkRemover();
    this.copyrightChecker = new CopyrightChecker(options);
    this.tempDir = options.tempDir || resolve(config.downloadDir, '_transformed');

    if (!existsSync(this.tempDir)) {
      mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Full pipeline: Analyze → Decide → Transform → Return new path
   * @param {string} inputPath - Original video file
   * @param {object} options - Override default transform settings
   * @returns {{ outputPath, analysis, transforms, skipped }}
   */
  async process(inputPath, options = {}) {
    if (!existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }

    // Load settings from DB
    const settings = this._loadSettings(options);

    // Skip if transforms disabled
    if (!settings.enabled) {
      logger.info('🔒 Transforms disabled, skipping');
      return { outputPath: inputPath, analysis: null, transforms: [], skipped: true };
    }

    // Step 1: Analyze copyright risk
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('🔍 STEP 1: Copyright Analysis');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const analysis = await this.copyrightChecker.analyze(inputPath);

    // Step 2: Decide which transforms to apply
    const transforms = this._decideTransforms(analysis, settings);

    if (transforms.length === 0) {
      logger.info('✅ No transforms needed - low risk content');
      return { outputPath: inputPath, analysis, transforms: [], skipped: true };
    }

    // Step 3: Apply transforms via FFmpeg
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(`🔧 STEP 2: Applying ${transforms.length} transforms`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    transforms.forEach(t => logger.info(`  → ${t}`));

    const outputPath = await this._applyTransforms(inputPath, transforms, settings);

    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('✅ STEP 3: Transform complete');
    logger.info(`📁 Output: ${basename(outputPath)}`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return { outputPath, analysis, transforms, skipped: false };
  }

  /**
   * Decide which transforms to apply based on risk level and settings
   */
  _decideTransforms(analysis, settings) {
    const transforms = [];

    // Always apply if mode is 'always'
    if (settings.mode === 'always') {
      if (settings.mirror) transforms.push('video:mirror');
      if (settings.crop) transforms.push('video:crop');
      if (settings.colorGrade) transforms.push('video:color_grade');
      if (settings.videoSpeed) transforms.push('video:speed');
      if (settings.pitchShift) transforms.push('audio:pitch_shift');
      if (settings.audioSpeed) transforms.push('audio:speed');
      return transforms;
    }

    // Auto mode: decide based on risk
    if (settings.mode === 'auto') {
      if (analysis.riskLevel === 'high') {
        // High risk: apply all transforms
        transforms.push('video:mirror', 'video:crop', 'video:color_grade');
        if (analysis.hasAudio) {
          transforms.push('audio:pitch_shift', 'audio:speed');
        }
      } else if (analysis.riskLevel === 'medium') {
        // Medium risk: apply basic transforms
        transforms.push('video:mirror', 'video:crop');
        if (analysis.hasMusicTrack) {
          transforms.push('audio:pitch_shift');
        }
      }
      // Low risk: no transforms needed
    }

    return transforms;
  }

  /**
   * Apply all transforms via a single FFmpeg command
   */
  async _applyTransforms(inputPath, transforms, settings) {
    const ext = extname(inputPath);
    const name = basename(inputPath, ext);
    const outputPath = join(this.tempDir, `${name}_tf${ext}`);

    // Build FFmpeg filter chains
    const videoFilters = [];
    const audioFilters = [];

    for (const transform of transforms) {
      switch (transform) {
        case 'video:mirror':
          videoFilters.push('hflip');
          break;

        case 'video:crop':
          // Crop 4% from edges + slight zoom
          videoFilters.push('crop=iw*0.96:ih*0.96:iw*0.02:ih*0.02');
          videoFilters.push('scale=iw*1.04:ih*1.04');
          break;

        case 'video:color_grade':
          // Slight saturation boost + contrast + brightness shift
          const sat = settings.colorSaturation || 1.15;
          const con = settings.colorContrast || 1.08;
          const bri = settings.colorBrightness || 0.03;
          videoFilters.push(`eq=saturation=${sat}:contrast=${con}:brightness=${bri}`);
          break;

        case 'video:speed':
          // Speed up/down by 3-8%
          const vSpeed = settings.videoSpeedFactor || 1.05;
          videoFilters.push(`setpts=${(1 / vSpeed).toFixed(4)}*PTS`);
          break;

        case 'audio:pitch_shift':
          // Pitch shift by changing sample rate then resampling
          const pitchFactor = settings.pitchFactor || 1.04; // +4% pitch
          audioFilters.push(`asetrate=44100*${pitchFactor}`);
          audioFilters.push('aresample=44100');
          break;

        case 'audio:speed':
          // Audio speed change (separate from video to desync fingerprint)
          const aSpeed = settings.audioSpeedFactor || 1.03;
          audioFilters.push(`atempo=${aSpeed}`);
          break;
      }
    }

    // Build FFmpeg args
    const args = ['-y', '-i', inputPath];

    // Add filter complex if we have both video and audio filters
    if (videoFilters.length > 0 && audioFilters.length > 0) {
      args.push('-vf', videoFilters.join(','));
      args.push('-af', audioFilters.join(','));
    } else if (videoFilters.length > 0) {
      args.push('-vf', videoFilters.join(','));
      args.push('-c:a', 'copy');
    } else if (audioFilters.length > 0) {
      args.push('-c:v', 'copy');
      args.push('-af', audioFilters.join(','));
    }

    // Output encoding
    args.push(
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      outputPath,
    );

    await this._runFFmpeg(args);
    return outputPath;
  }

  /**
   * Load transform settings from DB or use defaults
   */
  _loadSettings(overrides = {}) {
    return {
      enabled: overrides.enabled ?? this._dbBool('transform_enabled', true),
      mode: overrides.mode || this._dbStr('transform_mode', 'auto'), // auto | always | off
      // Video transforms
      mirror: overrides.mirror ?? this._dbBool('transform_mirror', true),
      crop: overrides.crop ?? this._dbBool('transform_crop', true),
      colorGrade: overrides.colorGrade ?? this._dbBool('transform_color_grade', true),
      videoSpeed: overrides.videoSpeed ?? this._dbBool('transform_video_speed', false),
      videoSpeedFactor: overrides.videoSpeedFactor || this._dbNum('transform_video_speed_factor', 1.05),
      // Audio transforms
      pitchShift: overrides.pitchShift ?? this._dbBool('transform_pitch_shift', true),
      audioSpeed: overrides.audioSpeed ?? this._dbBool('transform_audio_speed', true),
      pitchFactor: overrides.pitchFactor || this._dbNum('transform_pitch_factor', 1.04),
      audioSpeedFactor: overrides.audioSpeedFactor || this._dbNum('transform_audio_speed_factor', 1.03),
      // Color settings
      colorSaturation: overrides.colorSaturation || this._dbNum('transform_color_saturation', 1.15),
      colorContrast: overrides.colorContrast || this._dbNum('transform_color_contrast', 1.08),
      colorBrightness: overrides.colorBrightness || this._dbNum('transform_color_brightness', 0.03),
    };
  }

  _dbBool(key, fallback) {
    try {
      const v = getSetting(key);
      if (v === null || v === undefined) return fallback;
      return v === 'true' || v === true || v === '1';
    } catch { return fallback; }
  }

  _dbStr(key, fallback) {
    try {
      const v = getSetting(key);
      return v || fallback;
    } catch { return fallback; }
  }

  _dbNum(key, fallback) {
    try {
      const v = getSetting(key);
      return v ? Number(v) : fallback;
    } catch { return fallback; }
  }

  /**
   * Run FFmpeg command
   */
  _runFFmpeg(args) {
    return new Promise((resolve, reject) => {
      logger.debug(`FFmpeg: ${this.ffmpegPath} ${args.join(' ')}`);

      const proc = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';

      proc.stderr.on('data', d => { stderr += d.toString(); });

      proc.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          logger.error(`FFmpeg failed (code ${code}): ${stderr.slice(-500)}`);
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      proc.on('error', err => {
        if (err.code === 'ENOENT') {
          reject(new Error('FFmpeg not found. Install: https://ffmpeg.org/download.html'));
        } else {
          reject(err);
        }
      });
    });
  }
}

export default Transformer;
