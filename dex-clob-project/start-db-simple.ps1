# DEX CLOB Database Startup Script for Windows
Write-Host "Starting DEX CLOB Database Services..." -ForegroundColor Green

# Start database services
Write-Host "Starting PostgreSQL and Redis..." -ForegroundColor Yellow
docker-compose -f docker-compose.db.yml up -d

# Wait for services to be ready
Write-Host "Waiting for services to be ready..." -ForegroundColor Yellow
Start-Sleep 10

Write-Host "Database services started!" -ForegroundColor Green
Write-Host "PostgreSQL: localhost:5432 (database: dex_clob, user: dex_user)" -ForegroundColor White
Write-Host "Redis: localhost:6379" -ForegroundColor White
Write-Host ""
Write-Host "You can now start the matching engine with: npm start" -ForegroundColor Green
