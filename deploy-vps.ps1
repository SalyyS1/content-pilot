# ============================================
# Video Reup Tool - VPS Deploy Script
# Run this on the VPS via RDP (PowerShell Admin)
# ============================================

$ErrorActionPreference = "Stop"
$DEPLOY_DIR = "C:\VideoReup"
$REPO_URL = "https://github.com/SalyyS1/content-pilot.git"

Write-Host "`n=== Video Reup Tool - VPS Deployment ===" -ForegroundColor Cyan

# Step 1: Check/Install Node.js
Write-Host "`n[1/5] Checking Node.js..." -ForegroundColor Yellow
$nodeExists = where.exe node 2>$null
if (-not $nodeExists) {
    Write-Host "Installing Node.js LTS..." -ForegroundColor Yellow
    # Download Node.js MSI installer
    $nodeUrl = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi"
    $nodeInstaller = "$env:TEMP\node-installer.msi"
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeInstaller -UseBasicParsing
    Start-Process msiexec.exe -Wait -ArgumentList "/i `"$nodeInstaller`" /quiet /norestart"
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "Node.js installed!" -ForegroundColor Green
} else {
    $ver = node --version
    Write-Host "Node.js $ver found" -ForegroundColor Green
}

# Step 2: Check/Install Git
Write-Host "`n[2/5] Checking Git..." -ForegroundColor Yellow
$gitExists = where.exe git 2>$null
if (-not $gitExists) {
    Write-Host "Installing Git..." -ForegroundColor Yellow
    $gitUrl = "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe"
    $gitInstaller = "$env:TEMP\git-installer.exe"
    Invoke-WebRequest -Uri $gitUrl -OutFile $gitInstaller -UseBasicParsing
    Start-Process $gitInstaller -Wait -ArgumentList "/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS=`"icons,ext\reg\shellhere,assoc,assoc_sh`""
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "Git installed!" -ForegroundColor Green
} else {
    Write-Host "Git found" -ForegroundColor Green
}

# Step 3: Clone/Pull repository (src only, no junk)
Write-Host "`n[3/5] Getting source code..." -ForegroundColor Yellow
if (Test-Path $DEPLOY_DIR) {
    Write-Host "Directory exists, pulling latest..." -ForegroundColor Yellow
    Push-Location $DEPLOY_DIR
    git pull origin master 2>$null
    Pop-Location
} else {
    Write-Host "Cloning from GitHub..." -ForegroundColor Yellow
    git clone $REPO_URL $DEPLOY_DIR
}

# Clean up junk files
Push-Location $DEPLOY_DIR
$junkFiles = @("bat-test.txt","bat-test2.txt","bat-test3.txt","debug.txt","debug2.txt","debug3.txt","debug4.txt","dist-test.txt","error.txt","exe-test.txt","exe-test2.txt","exe-test3.txt","build.js")
foreach ($f in $junkFiles) {
    if (Test-Path $f) { Remove-Item $f -Force }
}
if (Test-Path "build") { Remove-Item "build" -Recurse -Force }
if (Test-Path "dist") { Remove-Item "dist" -Recurse -Force }
Write-Host "Source code ready at $DEPLOY_DIR" -ForegroundColor Green

# Step 4: Install dependencies
Write-Host "`n[4/5] Installing dependencies (npm install)..." -ForegroundColor Yellow
npm install --production 2>&1
Write-Host "Dependencies installed!" -ForegroundColor Green

# Step 5: Create .env if not exists
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env" -Force
    Write-Host "Created .env from .env.example - edit it with your API keys!" -ForegroundColor Yellow
}

# Step 6: Create startup script
$startScript = @"
@echo off
cd /d $DEPLOY_DIR
node src/cli/index.js dashboard
pause
"@
$startScript | Out-File -FilePath "$DEPLOY_DIR\start.bat" -Encoding ASCII

# Step 7: Open firewall port 3000
Write-Host "`n[5/5] Opening firewall port 3000..." -ForegroundColor Yellow
netsh advfirewall firewall add rule name="Video Reup Dashboard" dir=in action=allow protocol=tcp localport=3000 | Out-Null
Write-Host "Firewall port 3000 opened!" -ForegroundColor Green

Pop-Location

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Location: $DEPLOY_DIR" -ForegroundColor White
Write-Host "  Start:    cd $DEPLOY_DIR; node src/cli/index.js dashboard" -ForegroundColor White
Write-Host "  URL:      http://180.93.98.159:3000" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Or double-click: $DEPLOY_DIR\start.bat" -ForegroundColor White
Write-Host ""

# Auto-start the dashboard
Write-Host "Starting dashboard now..." -ForegroundColor Cyan
Push-Location $DEPLOY_DIR
node src/cli/index.js dashboard
