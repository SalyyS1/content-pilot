#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import config from '../core/config.js';
import logger from '../core/logger.js';

const program = new Command();

program
  .name('video-reup')
  .description('🎬 Auto Reup YouTube Shorts & Facebook Reels')
  .version('1.0.0');

// =====================================================
// DOWNLOAD Commands
// =====================================================

program
  .command('download <url>')
  .description('Download a YouTube Short video')
  .option('-f, --force', 'Force download even if > 180s')
  .action(async (url, opts) => {
    const { YouTubeDownloader } = await import('../downloader/youtube-downloader.js');
    const downloader = new YouTubeDownloader();
    try {
      const result = await downloader.download(url, { force: opts.force });
      console.log(chalk.green(`\n✅ Downloaded: ${result.metadata.title}`));
      console.log(chalk.dim(`   File: ${result.filePath}`));
    } catch (error) {
      console.error(chalk.red(`\n❌ Download failed: ${error.message}`));
    }
  });

program
  .command('download-channel <url>')
  .description('Download Shorts from a YouTube channel')
  .option('-l, --limit <n>', 'Max videos to download', '10')
  .action(async (url, opts) => {
    const { YouTubeDownloader } = await import('../downloader/youtube-downloader.js');
    const downloader = new YouTubeDownloader();
    try {
      const results = await downloader.downloadChannel(url, { limit: parseInt(opts.limit) });
      console.log(chalk.green(`\n✅ Downloaded ${results.length} videos`));
    } catch (error) {
      console.error(chalk.red(`\n❌ Failed: ${error.message}`));
    }
  });

program
  .command('download-trending')
  .description('Download trending YouTube Shorts')
  .option('-c, --category <cat>', 'Category', 'entertainment')
  .option('-r, --region <code>', 'Region code', 'VN')
  .option('-l, --limit <n>', 'Max videos', '5')
  .option('-m, --min-views <n>', 'Minimum views', '10000')
  .action(async (opts) => {
    const { YouTubeDownloader } = await import('../downloader/youtube-downloader.js');
    const downloader = new YouTubeDownloader();
    try {
      const results = await downloader.downloadTrending({
        category: opts.category,
        region: opts.region,
        limit: parseInt(opts.limit),
        minViews: parseInt(opts.minViews),
      });
      console.log(chalk.green(`\n✅ Downloaded ${results.length} trending videos`));
      results.forEach(v => console.log(chalk.dim(`   → ${v.metadata.title}`)));
    } catch (error) {
      console.error(chalk.red(`\n❌ Failed: ${error.message}`));
    }
  });

// =====================================================
// UPLOAD Commands
// =====================================================

const uploadCmd = program.command('upload').description('Upload videos');

uploadCmd
  .command('youtube <file>')
  .description('Upload to YouTube as Short')
  .option('-t, --title <title>', 'Video title')
  .option('-d, --description <desc>', 'Description')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--privacy <p>', 'Privacy: public/private/unlisted', 'public')
  .action(async (file, opts) => {
    const { YouTubeUploader } = await import('../uploader/youtube-uploader.js');
    const uploader = new YouTubeUploader();
    try {
      const result = await uploader.upload(file, {
        title: opts.title,
        description: opts.description,
        tags: opts.tags?.split(','),
        privacy: opts.privacy,
      });
      console.log(chalk.green(`\n✅ Uploaded to YouTube: ${result.videoUrl}`));
    } catch (error) {
      console.error(chalk.red(`\n❌ YouTube upload failed: ${error.message}`));
    }
  });

uploadCmd
  .command('facebook <file>')
  .description('Upload to Facebook Page as Reel')
  .option('-d, --description <desc>', 'Description')
  .option('--tags <tags>', 'Comma-separated hashtags')
  .action(async (file, opts) => {
    const { FacebookUploader } = await import('../uploader/facebook-uploader.js');
    const uploader = new FacebookUploader();
    try {
      const result = await uploader.upload(file, {
        description: opts.description,
        hashtags: opts.tags?.split(','),
      });
      console.log(chalk.green(`\n✅ Uploaded to Facebook! (method: ${result.method})`));
    } catch (error) {
      console.error(chalk.red(`\n❌ Facebook upload failed: ${error.message}`));
    }
  });

// =====================================================
// REUP Command (Download + Upload combo)
// =====================================================

program
  .command('reup <url>')
  .description('Download a video and reup to platforms')
  .option('--to <platforms>', 'Target platforms: youtube,facebook', 'youtube,facebook')
  .option('-c, --category <cat>', 'Content category', 'entertainment')
  .action(async (url, opts) => {
    const { AutoPilot } = await import('../autopilot/autopilot.js');
    const ap = new AutoPilot({ targets: opts.to.split(',') });
    try {
      const results = await ap._handleReup({
        url,
        targets: opts.to.split(','),
        category: opts.category,
      });
      console.log(chalk.green(`\n✅ Reup complete!`));
      results.forEach(r => {
        if (r.success) {
          console.log(chalk.green(`   ✓ ${r.videoUrl || r.reelUrl || 'Published'}`));
        }
      });
    } catch (error) {
      console.error(chalk.red(`\n❌ Reup failed: ${error.message}`));
    }
  });

// =====================================================
// BATCH reup from URL list
// =====================================================

program
  .command('batch <file>')
  .description('Batch reup from a text file (one URL per line)')
  .option('--to <platforms>', 'Target platforms', 'youtube,facebook')
  .option('-c, --category <cat>', 'Category', 'entertainment')
  .action(async (file, opts) => {
    const { readFileSync } = await import('fs');
    const { AutoPilot } = await import('../autopilot/autopilot.js');

    const urls = readFileSync(file, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
    console.log(chalk.cyan(`\n📋 Processing ${urls.length} URLs...`));

    const ap = new AutoPilot({ targets: opts.to.split(',') });

    for (let i = 0; i < urls.length; i++) {
      console.log(chalk.dim(`\n[${i + 1}/${urls.length}] ${urls[i]}`));
      try {
        await ap._handleReup({
          url: urls[i],
          targets: opts.to.split(','),
          category: opts.category,
        });
        console.log(chalk.green(`   ✅ Done`));
      } catch (error) {
        console.error(chalk.red(`   ❌ ${error.message}`));
      }

      // Rate limit delay
      if (i < urls.length - 1) {
        const delay = config.uploadIntervalMinutes * 60 * 1000;
        console.log(chalk.dim(`   ⏳ Waiting ${config.uploadIntervalMinutes} min...`));
        await new Promise(r => setTimeout(r, delay));
      }
    }

    console.log(chalk.green(`\n🎉 Batch complete!`));
  });

// =====================================================
// AUTH Commands
// =====================================================

const authCmd = program.command('auth').description('Authentication management');

authCmd
  .command('login <platform>')
  .description('Login to a platform (youtube/facebook)')
  .option('--cookies <file>', 'Import cookies from JSON file (Facebook only)')
  .action(async (platform, opts) => {
    const { AuthManager } = await import('../auth/auth-manager.js');
    const auth = new AuthManager();

    if (platform === 'youtube') {
      console.log(chalk.cyan('\n🔐 YouTube OAuth2 Login\n'));

      if (!config.youtube.clientId || !config.youtube.clientSecret) {
        console.log(chalk.yellow('⚠️  YouTube API credentials not set!'));
        console.log(chalk.dim('   Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env'));
        console.log(chalk.dim('   See: https://console.cloud.google.com'));
        return;
      }

      const { authUrl, auth: oauthClient } = await auth.startYouTubeLogin();
      console.log(chalk.cyan('Open this URL in your browser:\n'));
      console.log(chalk.underline(authUrl));
      console.log(chalk.dim('\nAfter authorization, you will be redirected.'));
      console.log(chalk.dim('If using CLI only, copy the ?code= parameter and paste below:\n'));

      // Simple stdin reader for the code
      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('Authorization code: ', async (code) => {
        try {
          const result = await auth.completeYouTubeLogin(oauthClient, code.trim());
          console.log(chalk.green(`\n✅ YouTube logged in as: ${result.channelName}`));
        } catch (error) {
          console.error(chalk.red(`\n❌ Login failed: ${error.message}`));
        }
        rl.close();
      });

    } else if (platform === 'facebook') {
      if (opts.cookies) {
        console.log(chalk.cyan('\n🍪 Importing Facebook cookies...\n'));
        try {
          await auth.loginFacebookCookies(opts.cookies);
          console.log(chalk.green('✅ Facebook cookies imported!'));
        } catch (error) {
          console.error(chalk.red(`\n❌ ${error.message}`));
        }
      } else {
        console.log(chalk.cyan('\n🌐 Opening browser for Facebook login...\n'));
        console.log(chalk.dim('Login in the browser window, then it will auto-close.\n'));
        try {
          const result = await auth.loginFacebookBrowser();
          console.log(chalk.green(`\n✅ Facebook logged in as: ${result.userName}`));
        } catch (error) {
          console.error(chalk.red(`\n❌ ${error.message}`));
        }
      }
    } else {
      console.error(chalk.red(`Unknown platform: ${platform}`));
    }
  });

authCmd
  .command('status')
  .description('Show authentication status')
  .action(async () => {
    const { AuthManager } = await import('../auth/auth-manager.js');
    const auth = new AuthManager();
    const status = auth.getStatus();

    console.log(chalk.cyan('\n🔐 Authentication Status\n'));
    console.log(chalk.bold('YouTube:'));
    console.log(`  Status: ${status.youtube.authenticated ? chalk.green('✅ Connected') : chalk.red('❌ Not connected')}`);
    if (status.youtube.authenticated) {
      console.log(`  Name:   ${status.youtube.name}`);
      console.log(`  Method: ${status.youtube.method}`);
    }

    console.log(chalk.bold('\nFacebook:'));
    console.log(`  Status: ${status.facebook.authenticated ? chalk.green('✅ Connected') : chalk.red('❌ Not connected')}`);
    if (status.facebook.authenticated) {
      console.log(`  Name:   ${status.facebook.name}`);
      console.log(`  Method: ${status.facebook.method}`);
      console.log(`  Page:   ${status.facebook.pageId || 'Not set'}`);
    }
    console.log('');
  });

// =====================================================
// AUTOPILOT Command
// =====================================================

program
  .command('autopilot')
  .description('🚀 Start auto-pilot mode (trending → download → reup)')
  .option('-i, --interval <min>', 'Minutes between cycles', String(config.autopilot.intervalMinutes))
  .option('-c, --categories <cats>', 'Categories (comma-separated)', config.autopilot.categories.join(','))
  .option('--to <platforms>', 'Target platforms', 'youtube,facebook')
  .option('-m, --max <n>', 'Max videos per cycle', String(config.autopilot.maxVideosPerSession))
  .action(async (opts) => {
    const { AutoPilot } = await import('../autopilot/autopilot.js');

    console.log(chalk.cyan.bold('\n🚀 AUTO-PILOT MODE\n'));

    const ap = new AutoPilot({
      intervalMinutes: parseInt(opts.interval),
      categories: opts.categories.split(','),
      targets: opts.to.split(','),
      maxVideos: parseInt(opts.max),
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n\n⏹️ Shutting down auto-pilot...'));
      ap.stop();
      process.exit(0);
    });

    ap.start();
  });

// =====================================================
// DASHBOARD Command
// =====================================================

program
  .command('dashboard')
  .description('📊 Open web dashboard')
  .option('-p, --port <port>', 'Port number', String(config.dashboard.port))
  .action(async (opts) => {
    const { startDashboard } = await import('../dashboard/server.js');
    const port = parseInt(opts.port);
    startDashboard(port);
  });

// =====================================================
// STATUS Command
// =====================================================

program
  .command('status')
  .description('Show current status and stats')
  .action(async () => {
    const { getStats } = await import('../core/database.js');
    const stats = getStats();

    console.log(chalk.cyan.bold('\n📊 Video Reup Status\n'));
    console.log(`  Videos Downloaded: ${chalk.bold(stats.totalVideos)}`);
    console.log(`  Total Uploads:     ${chalk.bold(stats.totalUploads)}`);
    console.log(`  Published:         ${chalk.green.bold(stats.publishedUploads)}`);
    console.log(`  Pending:           ${chalk.yellow.bold(stats.pendingUploads)}`);
    console.log(`  Failed:            ${chalk.red.bold(stats.failedUploads)}`);
    console.log(`  Today:             ${chalk.bold(stats.todayUploads)} / ${config.maxUploadsPerDay}`);
    console.log(`  Accounts:          ${chalk.bold(stats.accounts)}`);
    console.log(`  Active Jobs:       ${chalk.bold(stats.activeJobs)}`);
    console.log('');
  });

// =====================================================
// CONFIG Command
// =====================================================

program
  .command('config')
  .description('Show current configuration')
  .action(() => {
    console.log(chalk.cyan.bold('\n⚙️ Configuration\n'));
    console.log(`  Upload Interval:   ${config.uploadIntervalMinutes} min`);
    console.log(`  Max Uploads/Day:   ${config.maxUploadsPerDay}`);
    console.log(`  Download Dir:      ${config.downloadDir}`);
    console.log(`  Data Dir:          ${config.dataDir}`);
    console.log(`  Dashboard:         http://${config.dashboard.host}:${config.dashboard.port}`);
    console.log(`  Auto-Pilot:        ${config.autopilot.enabled ? 'Enabled' : 'Disabled'}`);
    console.log(`  AP Interval:       ${config.autopilot.intervalMinutes} min`);
    console.log(`  AP Categories:     ${config.autopilot.categories.join(', ')}`);
    console.log(`  AP Region:         ${config.autopilot.region}`);
    console.log('');
  });

// Parse and run
program.parse();
