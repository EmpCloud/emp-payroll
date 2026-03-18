# ============================================================================
# EMP-PAYROLL — Windows Setup Script
# Run in PowerShell: .\setup.ps1
# ============================================================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  EMP-PAYROLL — Windows Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# -----------------------------------------------------------------------
# 1. Check prerequisites
# -----------------------------------------------------------------------
Write-Host "[1/7] Checking prerequisites..." -ForegroundColor Yellow

# Node.js
$nodeVersion = node --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: Node.js not found. Install from https://nodejs.org (v20+)" -ForegroundColor Red
    exit 1
}
Write-Host "  Node.js: $nodeVersion" -ForegroundColor Green

# npm
$npmVersion = npm --version 2>$null
Write-Host "  npm: $npmVersion" -ForegroundColor Green

# Docker
$dockerVersion = docker --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  WARNING: Docker not found. Install Docker Desktop for Windows." -ForegroundColor Yellow
    Write-Host "  You can still run the app with a local MySQL/Redis install." -ForegroundColor Yellow
} else {
    Write-Host "  Docker: $dockerVersion" -ForegroundColor Green
}

# Git
$gitVersion = git --version 2>$null
Write-Host "  Git: $gitVersion" -ForegroundColor Green

# -----------------------------------------------------------------------
# 2. Configure Git for LF line endings
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "[2/7] Configuring Git for LF line endings..." -ForegroundColor Yellow
git config core.autocrlf false
git config core.eol lf
Write-Host "  git core.autocrlf = false" -ForegroundColor Green
Write-Host "  git core.eol = lf" -ForegroundColor Green

# -----------------------------------------------------------------------
# 3. Copy .env
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "[3/7] Setting up environment..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "  Created .env from .env.example" -ForegroundColor Green
    Write-Host "  Edit .env with your database credentials before starting." -ForegroundColor Yellow
} else {
    Write-Host "  .env already exists, skipping." -ForegroundColor Green
}

# -----------------------------------------------------------------------
# 4. Install dependencies
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "[4/7] Installing dependencies (this may take a minute)..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: npm install failed." -ForegroundColor Red
    exit 1
}
Write-Host "  Dependencies installed." -ForegroundColor Green

# -----------------------------------------------------------------------
# 5. Setup Husky git hooks
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "[5/7] Setting up Git hooks (Husky)..." -ForegroundColor Yellow
npx husky 2>$null
Write-Host "  Pre-commit hooks configured." -ForegroundColor Green

# -----------------------------------------------------------------------
# 6. Start Docker infra (if available)
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "[6/7] Starting infrastructure (Docker)..." -ForegroundColor Yellow
$dockerRunning = docker info 2>$null
if ($LASTEXITCODE -eq 0) {
    docker compose up -d
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  MySQL + Redis started." -ForegroundColor Green
    }
} else {
    Write-Host "  Docker not running. Start Docker Desktop and run:" -ForegroundColor Yellow
    Write-Host "    docker compose up -d" -ForegroundColor White
}

# -----------------------------------------------------------------------
# 7. Done!
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "[7/7] Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Next steps:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Edit .env with your DB credentials" -ForegroundColor White
Write-Host "  2. Start Docker:  docker compose up -d" -ForegroundColor White
Write-Host "  3. Run migrations: npm run db:migrate" -ForegroundColor White
Write-Host "  4. Start dev:     npm run dev" -ForegroundColor White
Write-Host ""
Write-Host "  Server: http://localhost:4000" -ForegroundColor White
Write-Host "  Client: http://localhost:5173" -ForegroundColor White
Write-Host ""
Write-Host "  Open in VS Code:  code emp-payroll.code-workspace" -ForegroundColor White
Write-Host ""
