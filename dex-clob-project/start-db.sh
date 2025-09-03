#!/bin/bash

echo "🚀 Starting DEX CLOB Database Services..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Start database services
echo "📦 Starting PostgreSQL and Redis..."
docker-compose -f docker-compose.db.yml up -d

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check if PostgreSQL is ready
echo "🔍 Checking PostgreSQL connection..."
timeout=30
while ! docker exec dex-clob-postgres pg_isready -U dex_user -d dex_clob > /dev/null 2>&1; do
    sleep 1
    timeout=$((timeout-1))
    if [ $timeout -eq 0 ]; then
        echo "❌ PostgreSQL failed to start within 30 seconds"
        exit 1
    fi
done

# Check if Redis is ready
echo "🔍 Checking Redis connection..."
timeout=30
while ! docker exec dex-clob-redis redis-cli ping > /dev/null 2>&1; do
    sleep 1
    timeout=$((timeout-1))
    if [ $timeout -eq 0 ]; then
        echo "❌ Redis failed to start within 30 seconds"
        exit 1
    fi
done

echo "✅ Database services are ready!"
echo "📊 PostgreSQL: localhost:5432 (database: dex_clob, user: dex_user)"
echo "🔴 Redis: localhost:6379"
echo ""
echo "🚀 You can now start the matching engine with: npm start"
