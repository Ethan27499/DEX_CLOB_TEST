# DEX CLOB Database Startup Script for Windows
Write-Host "🚀 Starting DEX CLOB Database Services..." -ForegroundColor Green

# Check if Docker is running
try {
    docker info | Out-Null
} catch {
    Write-Host "❌ Docker is not running. Please start Docker first." -ForegroundColor Red
    exit 1
}

# Start database services
Write-Host "📦 Starting PostgreSQL and Redis..." -ForegroundColor Yellow
docker-compose -f docker-compose.db.yml up -d

# Wait for services to be ready
Write-Host "⏳ Waiting for services to be ready..." -ForegroundColor Yellow
Start-Sleep 10

# Check PostgreSQL
Write-Host "🔍 Checking PostgreSQL connection..." -ForegroundColor Cyan
$timeout = 30
while ($timeout -gt 0) {
    try {
        docker exec dex-clob-postgres pg_isready -U dex_user -d dex_clob | Out-Null
        break
    } catch {
        Start-Sleep 1
        $timeout--
    }
}

if ($timeout -eq 0) {
    Write-Host "❌ PostgreSQL failed to start within 30 seconds" -ForegroundColor Red
    exit 1
}

# Check Redis
Write-Host "🔍 Checking Redis connection..." -ForegroundColor Cyan
$timeout = 30
while ($timeout -gt 0) {
    try {
        docker exec dex-clob-redis redis-cli ping | Out-Null
        break
    } catch {
        Start-Sleep 1
        $timeout--
    }
}

if ($timeout -eq 0) {
    Write-Host "❌ Redis failed to start within 30 seconds" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Database services are ready!" -ForegroundColor Green
Write-Host "📊 PostgreSQL: localhost:5432 (database: dex_clob, user: dex_user)" -ForegroundColor White
Write-Host "🔴 Redis: localhost:6379" -ForegroundColor White
Write-Host ""
Write-Host "🚀 You can now start the matching engine with: npm start" -ForegroundColor Green
