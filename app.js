// Entry point for the EXE build
// Combines CLI + Dashboard into a single executable

import { Command } from 'commander';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name('video-reup')
  .description('🎬 Auto Reup YouTube Shorts & Facebook Reels')
  .version('1.0.0');

// Import all CLI commands
import('./src/cli/index.js').catch(() => {
  // CLI handles its own parsing
});
