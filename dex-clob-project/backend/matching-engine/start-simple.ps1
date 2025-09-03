# Simple PowerShell script to start server
Write-Host "Starting DEX CLOB Matching Engine Server..." -ForegroundColor Green

# Change to correct directory
Set-Location "z:\DEX_CLOB\DEX_CLOB_TEST\dex-clob-project\backend\matching-engine"

Write-Host "Current directory: $(Get-Location)" -ForegroundColor Cyan

# Build project
Write-Host "Building project..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Build successful!" -ForegroundColor Green

# Start server
Write-Host "Starting server..." -ForegroundColor Magenta
Write-Host "Server will be available at: http://localhost:3002" -ForegroundColor Cyan

npm start
