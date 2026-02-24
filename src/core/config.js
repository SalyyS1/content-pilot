import dotenv from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '../..');

dotenv.config({ path: resolve(ROOT_DIR, '.env') });

const DEFAULT_CONFIG = {
  // Paths
  downloadDir: resolve(ROOT_DIR, process.env.DOWNLOAD_DIR || './downloads'),
  dataDir: resolve(ROOT_DIR, process.env.DATA_DIR || './data'),

  // YouTube API
  youtube: {
    clientId: process.env.YOUTUBE_CLIENT_ID || '',
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
    redirectUri: process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3001/auth/youtube/callback',
  },

  // Facebook API
  facebook: {
    appId: process.env.FACEBOOK_APP_ID || '',
    appSecret: process.env.FACEBOOK_APP_SECRET || '',
    pageId: process.env.FACEBOOK_PAGE_ID || '',
    pageAccessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '',
  },

  // Rate Limiting
  uploadIntervalMinutes: parseInt(process.env.UPLOAD_INTERVAL_MINUTES) || 5,
  maxUploadsPerDay: parseInt(process.env.MAX_UPLOADS_PER_DAY) || 50,
  downloadConcurrent: parseInt(process.env.DOWNLOAD_CONCURRENT) || 3,

  // Dashboard
  dashboard: {
    port: parseInt(process.env.DASHBOARD_PORT) || 3000,
    host: process.env.DASHBOARD_HOST || 'localhost',
  },

  // Auto-Pilot
  autopilot: {
    enabled: process.env.AUTOPILOT_ENABLED === 'true',
    intervalMinutes: parseInt(process.env.AUTOPILOT_INTERVAL_MINUTES) || 10,
    maxVideosPerSession: parseInt(process.env.AUTOPILOT_MAX_VIDEOS_PER_SESSION) || 20,
    categories: (process.env.AUTOPILOT_CATEGORIES || 'entertainment,music,gaming,comedy').split(','),
    region: process.env.AUTOPILOT_REGION || 'VN',
  },
};

// Load user config.json overrides
function loadUserConfig() {
  const configPath = resolve(ROOT_DIR, 'config.json');
  if (existsSync(configPath)) {
    try {
      const userConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      return deepMerge(DEFAULT_CONFIG, userConfig);
    } catch {
      return DEFAULT_CONFIG;
    }
  }
  return DEFAULT_CONFIG;
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// Ensure directories exist
function ensureDirs(config) {
  [config.downloadDir, config.dataDir].forEach(dir => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  });
}

const config = loadUserConfig();
ensureDirs(config);

export function saveConfig(updates) {
  const configPath = resolve(ROOT_DIR, 'config.json');
  let existing = {};
  if (existsSync(configPath)) {
    try { existing = JSON.parse(readFileSync(configPath, 'utf-8')); } catch {}
  }
  const merged = deepMerge(existing, updates);
  writeFileSync(configPath, JSON.stringify(merged, null, 2));
  // Re-merge with defaults
  return deepMerge(DEFAULT_CONFIG, merged);
}

export { config, ROOT_DIR };
export default config;
