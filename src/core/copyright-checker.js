import { spawn } from 'child_process';
import { existsSync, statSync, unlinkSync, readFileSync } from 'fs';
import { resolve, dirname, basename, extname, join } from 'path';
import logger from './logger.js';
import config from './config.js';

/**
 * Copyright Checker - Analyzes video/audio for potential copyright issues
 * Uses FFprobe metadata analysis + audio fingerprint heuristics
 */
export class CopyrightChecker {
  constructor(options = {}) {
    this.ffprobePath = options.ffprobePath || 'ffprobe';
  }

  /**
   * Analyze a video file for potential copyright risks
   * Returns: { hasAudio, hasMusicTrack, riskLevel, details, recommendations }
   */
  async analyze(filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    logger.info(`🔍 Analyzing copyright risk: ${basename(filePath)}`);

    const result = {
      filePath,
      hasAudio: false,
      hasMusicTrack: false,
      riskLevel: 'low', // low | medium | high
      audioStreams: 0,
      audioBitrate: 0,
      duration: 0,
      details: [],
      recommendations: [],
    };

    try {
      // Get detailed stream info via FFprobe
      const probeData = await this._probe(filePath);

      // Parse audio streams
      const audioStreams = probeData.streams?.filter(s => s.codec_type === 'audio') || [];
      result.audioStreams = audioStreams.length;
      result.hasAudio = audioStreams.length > 0;
      result.duration = parseFloat(probeData.format?.duration || 0);

      if (audioStreams.length === 0) {
        result.riskLevel = 'low';
        result.details.push('No audio track detected');
        result.recommendations.push('Safe to upload - no audio copyright risk');
        return result;
      }

      // Analyze audio characteristics
      const mainAudio = audioStreams[0];
      result.audioBitrate = parseInt(mainAudio.bit_rate || 0);

      // Heuristic checks for music presence
      const checks = this._runHeuristics(mainAudio, probeData, result.duration);
      result.hasMusicTrack = checks.likelyMusic;
      result.details.push(...checks.details);

      // Determine risk level
      if (checks.likelyMusic && result.audioBitrate > 128000) {
        result.riskLevel = 'high';
        result.recommendations.push(
          'HIGH RISK: Audio likely contains copyrighted music',
          '→ Recommended: Apply pitch shift + speed change',
          '→ Alternative: Replace audio track entirely',
        );
      } else if (checks.likelyMusic) {
        result.riskLevel = 'medium';
        result.recommendations.push(
          'MEDIUM RISK: Audio may contain copyrighted music',
          '→ Recommended: Apply basic audio transformations',
        );
      } else {
        result.riskLevel = 'low';
        result.recommendations.push('Low risk - likely speech/ambient/no music');
      }

    } catch (error) {
      logger.warn(`⚠️ Copyright analysis failed: ${error.message}`);
      // Default to medium risk if analysis fails
      result.riskLevel = 'medium';
      result.hasAudio = true;
      result.hasMusicTrack = true;
      result.recommendations.push('Analysis failed - applying transforms as precaution');
    }

    logger.info(`📊 Copyright risk: ${result.riskLevel.toUpperCase()} | Audio: ${result.hasAudio} | Music: ${result.hasMusicTrack}`);
    return result;
  }

  /**
   * Run heuristic checks to determine if audio contains music
   */
  _runHeuristics(audioStream, probeData, duration) {
    const result = { likelyMusic: false, details: [], score: 0 };

    // 1. High bitrate audio (>128kbps) → likely music
    const bitrate = parseInt(audioStream.bit_rate || 0);
    if (bitrate > 128000) {
      result.score += 30;
      result.details.push(`High audio bitrate: ${Math.round(bitrate / 1000)}kbps`);
    } else if (bitrate > 64000) {
      result.score += 15;
      result.details.push(`Medium audio bitrate: ${Math.round(bitrate / 1000)}kbps`);
    }

    // 2. Stereo audio → more likely music
    const channels = parseInt(audioStream.channels || 1);
    if (channels >= 2) {
      result.score += 20;
      result.details.push('Stereo audio detected');
    }

    // 3. High sample rate (>44.1kHz) → likely music production
    const sampleRate = parseInt(audioStream.sample_rate || 0);
    if (sampleRate >= 44100) {
      result.score += 15;
      result.details.push(`High sample rate: ${sampleRate}Hz`);
    }

    // 4. AAC/MP3 codec → common for music
    const codec = audioStream.codec_name?.toLowerCase() || '';
    if (['aac', 'mp3', 'flac', 'vorbis', 'opus'].includes(codec)) {
      result.score += 10;
      result.details.push(`Music-common codec: ${codec.toUpperCase()}`);
    }

    // 5. Video duration > 15s with audio → higher chance of music
    if (duration > 15) {
      result.score += 10;
      result.details.push(`Duration: ${Math.round(duration)}s (>15s with audio)`);
    }

    // 6. Check metadata for music-related tags
    const metadata = probeData.format?.tags || {};
    const musicTags = ['artist', 'album', 'genre', 'composer', 'performer'];
    const foundTags = musicTags.filter(tag =>
      Object.keys(metadata).some(k => k.toLowerCase().includes(tag))
    );
    if (foundTags.length > 0) {
      result.score += 40;
      result.details.push(`Music metadata found: ${foundTags.join(', ')}`);
    }

    // Final determination (threshold: 40)
    result.likelyMusic = result.score >= 40;
    result.details.push(`Music confidence score: ${result.score}/100`);

    return result;
  }

  /**
   * Run FFprobe on a file
   */
  _probe(filePath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath,
      ];

      const proc = spawn(this.ffprobePath, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', d => stdout += d);
      proc.stderr.on('data', d => stderr += d);

      proc.on('close', code => {
        if (code === 0 && stdout) {
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error('Failed to parse FFprobe output'));
          }
        } else {
          reject(new Error(`FFprobe failed (code ${code}): ${stderr}`));
        }
      });

      proc.on('error', err => reject(err));
    });
  }
}

export default CopyrightChecker;
