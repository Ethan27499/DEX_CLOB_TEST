# PowerShell script to start DEX CLOB Matching Engine
Write-Host "🚀 Starting DEX CLOB Matching Engine Server..." -ForegroundColor Green
Write-Host ""

# Change to correct directory
Set-Location "z:\DEX_CLOB\DEX_CLOB_TEST\dex-clob-project\backend\matching-engine"

Write-Host "📁 Current directory: $(Get-Location)" -ForegroundColor Cyan
Write-Host ""

# Build project
Write-Host "🔨 Building project..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "✅ Build successful!" -ForegroundColor Green
Write-Host ""

# Start server
Write-Host "🔐 Starting server with security framework..." -ForegroundColor Magenta
Write-Host "Server will be available at: http://localhost:3002" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""

npm start
