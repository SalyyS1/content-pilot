/**
 * Preset Manager — Video processing presets & platform export profiles
 * 
 * 3 Presets: minimal, standard, heavy
 * 3 Platforms: youtube_shorts, youtube_long, facebook_reels
 */

// === PROCESSING PRESETS ===
export const PRESETS = {
  minimal: {
    name: 'Tối thiểu',
    description: 'Nhanh nhất — chỉ thay đổi tốc độ nhẹ',
    speed: [1.02, 1.05],
    colorShift: false,
    resize: false,
    enhance: false,
    audio: { mode: 'A', pitch: [-2, 2], speed: [1.02, 1.05], eq: 'flat' },
    watermark: { autoDetect: true, mode: 'crop' },
    variationRanges: {
      speed: [1.01, 1.05],
      pitch: [-2, 2],
      brightness: [-0.02, 0.02],
      contrast: [0.98, 1.02],
      saturation: [0.98, 1.02],
      crop: [0, 1],
      hue: [-3, 3],
    },
  },

  standard: {
    name: 'Tiêu chuẩn',
    description: 'Cân bằng giữa chất lượng và tốc độ xử lý',
    speed: [1.03, 1.08],
    colorShift: true,
    brightness: [-0.05, 0.05],
    contrast: [0.97, 1.03],
    saturation: [0.95, 1.05],
    resize: true,
    enhance: true,
    audio: { mode: 'A', pitch: [-3, 3], speed: [1.02, 1.08], eq: 'warm' },
    watermark: { autoDetect: true, mode: 'smart' },
    variationRanges: {
      speed: [1.02, 1.08],
      pitch: [-3, 3],
      brightness: [-0.05, 0.05],
      contrast: [0.97, 1.03],
      saturation: [0.95, 1.05],
      crop: [1, 3],
      hue: [-5, 5],
    },
  },

  heavy: {
    name: 'Nặng',
    description: 'Thay đổi tối đa — khó bị phát hiện nhất',
    speed: [1.05, 1.15],
    colorShift: true,
    brightness: [-0.1, 0.1],
    contrast: [0.95, 1.05],
    saturation: [0.9, 1.1],
    resize: true,
    enhance: true,
    crop: [1, 3],
    audio: { mode: 'B', pitch: [-5, 5], speed: [1.05, 1.15], eq: 'bass' },
    watermark: { autoDetect: true, mode: 'aggressive' },
    variationRanges: {
      speed: [1.05, 1.15],
      pitch: [-5, 5],
      brightness: [-0.1, 0.1],
      contrast: [0.95, 1.05],
      saturation: [0.9, 1.1],
      crop: [2, 5],
      hue: [-10, 10],
    },
  },
};

// === PLATFORM EXPORT PROFILES ===
export const PLATFORMS = {
  youtube_shorts: {
    name: 'YouTube Shorts',
    width: 1080,
    height: 1920,
    aspect: '9:16',
    maxDuration: 60,
    codec: 'libx264',
    audioCodec: 'aac',
    audioBitrate: '192k',
    container: 'mp4',
    crf: 23,
    ffmpegPreset: 'medium',
    maxBitrate: '4M',
  },

  youtube_long: {
    name: 'YouTube Long',
    width: 1920,
    height: 1080,
    aspect: '16:9',
    maxDuration: null, // no limit
    codec: 'libx264',
    audioCodec: 'aac',
    audioBitrate: '192k',
    container: 'mp4',
    crf: 22,
    ffmpegPreset: 'medium',
    maxBitrate: '8M',
  },

  facebook_reels: {
    name: 'Facebook Reels',
    width: 1080,
    height: 1920,
    aspect: '9:16',
    maxDuration: 90,
    codec: 'libx264',
    audioCodec: 'aac',
    audioBitrate: '192k',
    container: 'mp4',
    crf: 23,
    ffmpegPreset: 'medium',
    maxBitrate: '4M',
  },
};

// === AUDIO EQ PRESETS ===
export const EQ_PRESETS = {
  flat: '',
  warm: 'equalizer=f=200:t=q:w=1:g=3,equalizer=f=3000:t=q:w=1:g=-2',
  bright: 'equalizer=f=5000:t=q:w=1:g=4,equalizer=f=200:t=q:w=1:g=-1',
  bass: 'equalizer=f=100:t=q:w=1:g=5,equalizer=f=1000:t=q:w=1:g=-1',
  vocal: 'equalizer=f=2000:t=q:w=0.5:g=4,equalizer=f=100:t=q:w=1:g=-3',
};

// === HELPERS ===
export function getPreset(name = 'standard') {
  return PRESETS[name] || PRESETS.standard;
}

export function getPlatform(format = 'youtube_shorts') {
  return PLATFORMS[format] || PLATFORMS.youtube_shorts;
}

export function randomInRange([min, max]) {
  return min + Math.random() * (max - min);
}

export function randomInt([min, max]) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default { PRESETS, PLATFORMS, EQ_PRESETS, getPreset, getPlatform, randomInRange, randomInt, pickRandom };
