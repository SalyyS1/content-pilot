# Full VPS Deploy Script for ReupVideo
# Run this ON THE VPS in PowerShell
# Downloads ALL source files from GitHub and restarts PM2

$base = "https://raw.githubusercontent.com/SalyyS1/content-pilot/master"
$root = "C:\Users\Administrator\ReupVideo"

Write-Host "=== FULL DEPLOY: ReupVideo ===" -ForegroundColor Cyan

# Create all directories
$dirs = @(
    "src\accounts", "src\auth", "src\autopilot", "src\cli", "src\core",
    "src\dashboard", "src\dashboard\public", "src\downloader",
    "src\processor", "src\scheduler", "src\seo", "src\uploader"
)
foreach ($d in $dirs) {
    $path = Join-Path $root $d
    if (!(Test-Path $path)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
}

# Download all source files
$files = @(
    # Root files
    "app.js",
    "package.json",

    # Core
    "src/core/config.js",
    "src/core/database.js",
    "src/core/db-migration.js",
    "src/core/logger.js",
    "src/core/niche-config.js",
    "src/core/account-rotation.js",
    "src/core/copyright-checker.js",
    "src/core/credential-encryption.js",
    "src/core/seo-optimizer.js",
    "src/core/transformer.js",
    "src/core/upload-strategy.js",
    "src/core/video-classifier.js",
    "src/core/watermark-remover.js",

    # Dashboard
    "src/dashboard/server.js",
    "src/dashboard/analytics-api.js",
    "src/dashboard/public/index.html",
    "src/dashboard/public/style.css",
    "src/dashboard/public/app.js",

    # Downloader
    "src/downloader/youtube-downloader.js",

    # Uploader
    "src/uploader/facebook-uploader.js",
    "src/uploader/youtube-uploader.js",
    "src/uploader/facebook-status-poster.js",
    "src/uploader/facebook-auto-reply.js",

    # Autopilot
    "src/autopilot/autopilot.js",

    # CLI
    "src/cli/index.js",

    # Processor
    "src/processor/audio-processor.js",
    "src/processor/content-processor.js",
    "src/processor/preset-manager.js",
    "src/processor/variation-engine.js",
    "src/processor/video-transformer.js",
    "src/processor/watermark-handler.js",

    # Scheduler
    "src/scheduler/scheduler.js",
    "src/scheduler/account-health.js",
    "src/scheduler/behavior-simulator.js",

    # SEO
    "src/seo/ai-integration.js",
    "src/seo/keyword-generator.js",
    "src/seo/seo-engine.js",
    "src/seo/title-optimizer.js",
    "src/seo/trending-scanner.js",

    # Accounts
    "src/accounts/account-pool.js",
    "src/accounts/proxy-manager.js",
    "src/accounts/session-manager.js",
    "src/accounts/warming-protocol.js",

    # Auth
    "src/auth/auth-manager.js"
)

$total = $files.Count
$count = 0
$errors = @()

foreach ($f in $files) {
    $count++
    $url = "$base/$f"
    $outPath = Join-Path $root ($f -replace '/', '\')
    $pct = [math]::Round(($count / $total) * 100)

    Write-Host "[$pct%] $f..." -NoNewline
    try {
        Invoke-WebRequest -Uri $url -OutFile $outPath -ErrorAction Stop
        Write-Host " OK" -ForegroundColor Green
    }
    catch {
        Write-Host " FAIL" -ForegroundColor Red
        $errors += $f
    }
}

Write-Host ""
Write-Host "=== Download Complete ===" -ForegroundColor Cyan
Write-Host "  Total: $total files"
Write-Host "  Success: $($total - $errors.Count)" -ForegroundColor Green
if ($errors.Count -gt 0) {
    Write-Host "  Failed: $($errors.Count)" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "    - $_" -ForegroundColor Red }
}

# Restart PM2
Write-Host ""
Write-Host "Restarting PM2..." -ForegroundColor Yellow
pm2 restart all
pm2 status

Write-Host ""
Write-Host "=== DEPLOY DONE ===" -ForegroundColor Green
Write-Host "Dashboard: http://localhost:3000" -ForegroundColor Cyan
