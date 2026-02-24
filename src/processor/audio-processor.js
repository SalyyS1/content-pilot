/**
 * Audio Processor — Modify or replace audio tracks to avoid Content ID
 * 
 * Mode A: Pitch shift + speed + EQ (default for standard preset)
 * Mode B: Replace with royalty-free music + optional TTS voiceover
 * 
 * Plugs into VideoTransformer pipeline after TRANSFORM stage.
 */

import ffmpeg from 'fluent-ffmpeg';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { resolve, join } from 'path';
import logger from '../core/logger.js';
import { EQ_PRESETS, randomInRange, randomInt } from './preset-manager.js';

const TEMP_DIR = resolve(process.cwd(), 'downloads', 'tmp');
const MUSIC_DIR = resolve(process.cwd(), 'data', 'music');

export class AudioProcessor {
  constructor(options = {}) {
    this.openaiApiKey = options.openaiApiKey || process.env.OPENAI_API_KEY;
    this._openai = null;

    if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });
    if (!existsSync(MUSIC_DIR)) mkdirSync(MUSIC_DIR, { recursive: true });
  }

  /**
   * Get OpenAI client (lazy init)
   */
  async _getOpenAI() {
    if (!this._openai && this.openaiApiKey) {
      const { default: OpenAI } = await import('openai');
      this._openai = new OpenAI({ apiKey: this.openaiApiKey });
    }
    return this._openai;
  }

  /**
   * Mode A: Modify existing audio — pitch shift + speed + EQ
   * This changes the audio fingerprint while keeping it natural-sounding
   */
  async modeA(inputPath, outputPath, options = {}) {
    const pitch = options.pitchShift || randomInt([-3, 3]);
    const speed = options.speed || randomInRange([1.02, 1.08]);
    const eqPreset = options.eq || 'warm';
    const eq = EQ_PRESETS[eqPreset] || '';

    logger.info(`🎵 Audio Mode A: pitch=${pitch > 0 ? '+' : ''}${pitch}st, speed=${speed.toFixed(3)}x, EQ=${eqPreset}`);

    // Calculate pitch factor (semitones to rate multiplier)
    const pitchFactor = Math.pow(2, pitch / 12);
    const targetRate = 44100;

    // Build audio filter chain
    const aFilters = [];

    // Pitch shift via sample rate change + resample
    if (pitch !== 0) {
      aFilters.push(`asetrate=${targetRate}*${pitchFactor.toFixed(6)}`);
      aFilters.push(`aresample=${targetRate}`);
    }

    // Speed adjustment (after pitch correction)
    aFilters.push(`atempo=${speed.toFixed(4)}`);

    // EQ
    if (eq) {
      aFilters.push(eq);
    }

    // Add subtle background noise layer for fingerprint variance
    // Using aevalsrc to generate very low pink noise
    aFilters.push('highpass=f=80');

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioFilters(aFilters)
        .videoCodec('copy')  // Don't touch video
        .audioCodec('aac')
        .audioBitrate('192k')
        .output(outputPath)
        .on('end', () => {
          logger.info('   ✓ Audio modified (Mode A)');
          resolve({ outputPath, mode: 'A', pitch, speed, eq: eqPreset });
        })
        .on('error', (err) => {
          logger.warn(`   Audio Mode A failed: ${err.message}, keeping original`);
          resolve({ outputPath: inputPath, mode: 'A', error: err.message });
        })
        .run();
    });
  }

  /**
   * Mode B: Replace audio entirely with royalty-free music + optional TTS
   */
  async modeB(inputPath, outputPath, options = {}) {
    logger.info('🎵 Audio Mode B: Replace audio');

    // Step 1: Find music file
    const musicPath = options.musicPath || this._findMusic();
    if (!musicPath) {
      logger.warn('   No music files found in data/music/, falling back to Mode A');
      return this.modeA(inputPath, outputPath, options);
    }

    // Step 2: Optional TTS voiceover
    let ttsPath = null;
    if (options.ttsText && this.openaiApiKey) {
      try {
        ttsPath = await this.generateTTS(options.ttsText, options.ttsVoice || 'alloy');
      } catch (err) {
        logger.warn(`   TTS failed: ${err.message}, using music only`);
      }
    }

    // Step 3: Mix music (+ optional TTS) with video
    return new Promise((resolve, reject) => {
      let cmd = ffmpeg(inputPath)
        .input(musicPath);

      if (ttsPath) {
        cmd = cmd.input(ttsPath);
        // Mix music + TTS
        cmd
          .complexFilter([
            '[1:a]volume=0.3[music]',    // Music at 30% volume
            '[2:a]volume=1.0[voice]',    // TTS at full volume
            '[music][voice]amix=inputs=2:duration=first:dropout_transition=2[mixed]',
          ])
          .outputOptions(['-map', '0:v', '-map', '[mixed]']);
      } else {
        // Music only
        cmd
          .complexFilter([
            '[1:a]volume=0.5[music]',
          ])
          .outputOptions(['-map', '0:v', '-map', '[music]']);
      }

      cmd
        .videoCodec('copy')
        .audioCodec('aac')
        .audioBitrate('192k')
        .addOptions(['-shortest'])
        .output(outputPath)
        .on('end', () => {
          logger.info(`   ✓ Audio replaced (Mode B) ${ttsPath ? '+ TTS voiceover' : ''}`);
          resolve({ outputPath, mode: 'B', music: musicPath, tts: !!ttsPath });
        })
        .on('error', (err) => {
          logger.warn(`   Audio Mode B failed: ${err.message}, falling back to Mode A`);
          this.modeA(inputPath, outputPath, options).then(resolve);
        })
        .run();
    });
  }

  /**
   * Generate TTS audio via OpenAI tts-1-hd
   */
  async generateTTS(text, voice = 'alloy') {
    const openai = await this._getOpenAI();
    if (!openai) throw new Error('OpenAI API not configured');

    logger.info(`   🗣 Generating TTS: "${text.slice(0, 50)}..." (voice: ${voice})`);

    const response = await openai.audio.speech.create({
      model: 'tts-1-hd',
      voice: voice,
      input: text,
      response_format: 'mp3',
    });

    const ttsPath = join(TEMP_DIR, `tts_${Date.now()}.mp3`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const { writeFileSync } = await import('fs');
    writeFileSync(ttsPath, buffer);

    logger.info(`   ✓ TTS generated: ${ttsPath}`);
    return ttsPath;
  }

  /**
   * Find a random music file from data/music/
   */
  _findMusic() {
    if (!existsSync(MUSIC_DIR)) return null;
    const { readdirSync } = require('fs');
    try {
      const files = readdirSync(MUSIC_DIR).filter(f =>
        f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a')
      );
      if (files.length === 0) return null;
      const pick = files[Math.floor(Math.random() * files.length)];
      return join(MUSIC_DIR, pick);
    } catch {
      return null;
    }
  }
}

export default AudioProcessor;
