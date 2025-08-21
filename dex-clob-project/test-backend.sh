#!/bin/bash

# Simple test script for DEX CLOB Backend
echo "🚀 Testing DEX CLOB Backend..."

# Check if services are running
echo "📋 Checking Docker services..."
cd /workspaces/DEX_CLOB_TEST/dex-clob-project
docker-compose ps

# Start matching engine in background
echo "🔧 Starting Matching Engine..."
cd backend/matching-engine

# Kill any existing process on port 3001
lsof -ti:3001 | xargs kill -9 2>/dev/null || true

# Set environment
export NODE_ENV=development
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_DB=dex_clob
export POSTGRES_USER=dex_user
export POSTGRES_PASSWORD=dex_password
export REDIS_HOST=localhost
export REDIS_PORT=6379

# Start in background using nohup
nohup npm run dev > logs/server.log 2>&1 &
SERVER_PID=$!
echo "📝 Server started with PID: $SERVER_PID"

# Wait for server to start
echo "⏳ Waiting for server to start..."
sleep 8

# Test API endpoints
echo "🧪 Testing API endpoints..."

echo "1. Health Check:"
curl -s http://localhost:3001/health | jq . || echo "❌ Health check failed"

echo -e "\n2. Market Data:"
curl -s http://localhost:3001/api/v1/market-data | jq . || echo "❌ Market data failed"

echo -e "\n3. Orderbook ETH/USDC:"
curl -s http://localhost:3001/api/v1/orderbook/ETH/USDC | jq . || echo "❌ Orderbook failed"

echo -e "\n4. Orders (empty):"
curl -s http://localhost:3001/api/v1/orders | jq . || echo "❌ Orders failed"

echo -e "\n✅ API Testing completed!"
echo "📊 Server logs available at: backend/matching-engine/logs/server.log"
echo "🔗 Server running at: http://localhost:3001"
echo "🛑 To stop server: kill $SERVER_PID"

# Save PID for easy killing later
echo $SERVER_PID > .server.pid
echo "💾 Server PID saved to .server.pid"
