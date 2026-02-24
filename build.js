/**
 * Build script - creates a portable distribution of Video Reup Tool
 *
 * Strategy:
 * 1. esbuild bundles all ESM → single CJS file
 * 2. Creates a portable dist/ folder with:
 *    - video-reup.cjs  (bundled app)
 *    - video-reup.bat  (launcher)
 *    - node_modules/   (native addons only)
 *    - public/         (dashboard UI)
 *    - .env            (config)
 *
 * Usage: node build.js
 *
 * Note: better-sqlite3 has a native C++ addon (.node file) that CANNOT be
 * embedded inside an .exe. The portable folder approach is the most reliable.
 */

import esbuild from 'esbuild';
import { execSync } from 'child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, statSync, writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DIST = resolve(__dirname, 'dist');
const BUILD = resolve(__dirname, 'build');

console.log('🔨 Video Reup Tool - Build Portable Package\n');

// ============================================================
// Step 1: Clean
// ============================================================
console.log('1️⃣ Cleaning...');
if (existsSync(DIST)) execSync(`rmdir /s /q "${DIST}"`, { shell: true, stdio: 'pipe' });
if (existsSync(BUILD)) execSync(`rmdir /s /q "${BUILD}"`, { shell: true, stdio: 'pipe' });
mkdirSync(DIST, { recursive: true });
mkdirSync(BUILD, { recursive: true });

// ============================================================
// Step 2: Bundle to single CJS file
// ============================================================
console.log('2️⃣ Bundling with esbuild...');

await esbuild.build({
  entryPoints: ['src/cli/index.js'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: resolve(DIST, 'video-reup.cjs'),
  external: ['better-sqlite3', 'playwright', 'playwright-core', 'fsevents'],
  minify: true,
  banner: {
    js: [
      'var __import_meta_url;',
      'try { __import_meta_url = require("url").pathToFileURL(__filename).href; }',
      'catch(e) { __import_meta_url = "file:///" + __filename.replace(/\\\\/g, "/"); }',
    ].join(' '),
  },
  define: {
    'import.meta.url': '__import_meta_url',
  },
  logLevel: 'warning',
});

console.log('   ✅ Bundled → dist/video-reup.cjs');

// ============================================================
// Step 3: Create launcher files
// ============================================================
console.log('\n3️⃣ Creating launchers...');

// Main CLI launcher
writeFileSync(resolve(DIST, 'video-reup.bat'), [
  '@echo off',
  'title Video Reup Tool',
  'node "%~dp0video-reup.cjs" %*',
  '',
].join('\r\n'));

// Dashboard shortcut
writeFileSync(resolve(DIST, 'dashboard.bat'), [
  '@echo off',
  'title Video Reup Dashboard',
  'echo.',
  'echo  📊 Starting Dashboard...',
  'echo  Open http://localhost:3000 in your browser',
  'echo.',
  'node "%~dp0video-reup.cjs" dashboard %*',
  '',
].join('\r\n'));

// Auto-Pilot shortcut
writeFileSync(resolve(DIST, 'autopilot.bat'), [
  '@echo off',
  'title Video Reup Auto-Pilot',
  'echo.',
  'echo  🚀 Starting Auto-Pilot...',
  'echo  Press Ctrl+C to stop',
  'echo.',
  'node "%~dp0video-reup.cjs" autopilot %*',
  '',
].join('\r\n'));

// Setup script
writeFileSync(resolve(DIST, 'setup.bat'), [
  '@echo off',
  'title Video Reup - Setup',
  'echo.',
  'echo  🎬 Video Reup Tool - Setup',
  'echo  ════════════════════════════',
  'echo.',
  '',
  'echo  Checking Node.js...',
  'node --version >nul 2>&1',
  'if errorlevel 1 (',
  '  echo  ❌ Node.js not found! Please install: https://nodejs.org',
  '  pause',
  '  exit /b 1',
  ')',
  'echo  ✅ Node.js found',
  '',
  'echo  Checking yt-dlp...',
  'yt-dlp --version >nul 2>&1',
  'if errorlevel 1 (',
  '  echo  ⚠️  yt-dlp not found. Installing...',
  '  pip install yt-dlp',
  ')',
  'echo  ✅ yt-dlp OK',
  '',
  'echo  Checking FFmpeg...',
  'ffmpeg -version >nul 2>&1',
  'if errorlevel 1 (',
  '  echo  ⚠️  FFmpeg not found!',
  '  echo  Please install: winget install FFmpeg',
  ')',
  '',
  'echo.',
  'echo  Installing Playwright browsers...',
  'npx playwright install chromium',
  '',
  'echo.',
  'echo  ✅ Setup complete!',
  'echo.',
  'echo  Next steps:',
  'echo    1. Edit .env with your API credentials',
  'echo    2. Run: video-reup.bat auth login youtube',
  'echo    3. Run: video-reup.bat dashboard',
  'echo.',
  'pause',
  '',
].join('\r\n'));

console.log('   ✅ video-reup.bat');
console.log('   ✅ dashboard.bat');
console.log('   ✅ autopilot.bat');
console.log('   ✅ setup.bat');

// ============================================================
// Step 4: Copy native modules + assets
// ============================================================
console.log('\n4️⃣ Copying dependencies...');

// better-sqlite3 (native addon - REQUIRED)
const sqliteSrc = resolve(__dirname, 'node_modules', 'better-sqlite3');
if (existsSync(sqliteSrc)) {
  cpSync(sqliteSrc, resolve(DIST, 'node_modules', 'better-sqlite3'), { recursive: true });
  console.log('   ✅ better-sqlite3 (native)');
}

// bindings (required by better-sqlite3)
const bindingsSrc = resolve(__dirname, 'node_modules', 'bindings');
if (existsSync(bindingsSrc)) {
  cpSync(bindingsSrc, resolve(DIST, 'node_modules', 'bindings'), { recursive: true });
  console.log('   ✅ bindings');
}

// file-uri-to-path (required by bindings)
const furiSrc = resolve(__dirname, 'node_modules', 'file-uri-to-path');
if (existsSync(furiSrc)) {
  cpSync(furiSrc, resolve(DIST, 'node_modules', 'file-uri-to-path'), { recursive: true });
  console.log('   ✅ file-uri-to-path');
}

// prebuild-install + node-addon-api (needed at runtime by better-sqlite3)
for (const dep of ['prebuild-install', 'node-addon-api', 'node-gyp-build']) {
  const src = resolve(__dirname, 'node_modules', dep);
  if (existsSync(src)) {
    cpSync(src, resolve(DIST, 'node_modules', dep), { recursive: true });
  }
}

// playwright
for (const pkg of ['playwright', 'playwright-core']) {
  const src = resolve(__dirname, 'node_modules', pkg);
  if (existsSync(src)) {
    cpSync(src, resolve(DIST, 'node_modules', pkg), { recursive: true });
  }
}
console.log('   ✅ playwright');

// Dashboard UI
const publicSrc = resolve(__dirname, 'src', 'dashboard', 'public');
if (existsSync(publicSrc)) {
  cpSync(publicSrc, resolve(DIST, 'public'), { recursive: true });
  console.log('   ✅ dashboard UI (public/)');
}

// Config files
for (const f of ['.env', '.env.example']) {
  const src = resolve(__dirname, f);
  if (existsSync(src)) copyFileSync(src, resolve(DIST, f));
}
console.log('   ✅ config files');

// README
if (existsSync(resolve(__dirname, 'README.md'))) {
  copyFileSync(resolve(__dirname, 'README.md'), resolve(DIST, 'README.md'));
  console.log('   ✅ README.md');
}

// ============================================================
// Step 5: Calculate sizes
// ============================================================
console.log('\n' + '═'.repeat(50));
console.log('  ✅ BUILD COMPLETE!');
console.log('═'.repeat(50));

const bundleSize = (statSync(resolve(DIST, 'video-reup.cjs')).size / 1024).toFixed(0);
console.log(`\n📁 dist/`);
console.log(`   📦 video-reup.cjs    (${bundleSize} KB - bundled app)`);
console.log('   🖥️  video-reup.bat    (CLI launcher)');
console.log('   📊 dashboard.bat     (Dashboard shortcut)');
console.log('   🚀 autopilot.bat     (Auto-Pilot shortcut)');
console.log('   🔧 setup.bat         (First-time setup)');
console.log('   📂 public/           (Dashboard UI)');
console.log('   📂 node_modules/     (Native addons only)');
console.log('   📄 .env              (Config)');

console.log('\n🎯 Quick Start:');
console.log('   1. Chạy setup.bat        → cài đặt lần đầu');
console.log('   2. Edit .env             → thêm API keys');
console.log('   3. Chạy video-reup.bat   → CLI commands');
console.log('   4. Chạy dashboard.bat    → mở dashboard');
console.log('   5. Chạy autopilot.bat    → bật auto-pilot');

console.log('\n⚠️ Yêu cầu: Node.js 20+, yt-dlp, FFmpeg');
console.log('');
