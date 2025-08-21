#!/bin/bash

# DEX CLOB Development Setup Script
# This script sets up the development environment

set -e

echo "🚀 Setting up DEX CLOB Development Environment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker is running${NC}"

# Create logs directories
echo "📁 Creating logs directories..."
mkdir -p backend/matching-engine/logs
mkdir -p backend/batch-settler/logs
mkdir -p logs

# Copy environment files if they don't exist
echo "⚙️ Setting up environment files..."

if [ ! -f backend/matching-engine/.env ]; then
    cp backend/matching-engine/.env.example backend/matching-engine/.env
    echo -e "${YELLOW}📝 Created backend/matching-engine/.env from template${NC}"
fi

if [ ! -f backend/batch-settler/.env ]; then
    cp backend/batch-settler/.env.example backend/batch-settler/.env
    echo -e "${YELLOW}📝 Created backend/batch-settler/.env from template${NC}"
fi

# Install dependencies
echo "📦 Installing dependencies..."

echo "  Installing shared dependencies..."
cd backend/shared && npm install && cd ../..

echo "  Installing matching-engine dependencies..."
cd backend/matching-engine && npm install && cd ../..

echo "  Installing batch-settler dependencies..."
cd backend/batch-settler && npm install && cd ../..

# Build TypeScript projects
echo "🔨 Building TypeScript projects..."

echo "  Building matching-engine..."
cd backend/matching-engine && npm run build && cd ../..

echo "  Building batch-settler..."
cd backend/batch-settler && npm run build && cd ../..

# Start database and cache services
echo "🗄️ Starting database and cache services..."
docker-compose up -d postgres redis

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check if PostgreSQL is ready
echo "🔍 Checking PostgreSQL connection..."
for i in {1..30}; do
    if docker-compose exec -T postgres pg_isready -U dex_user -d dex_clob; then
        echo -e "${GREEN}✅ PostgreSQL is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ PostgreSQL failed to start${NC}"
        exit 1
    fi
    sleep 1
done

# Check if Redis is ready
echo "🔍 Checking Redis connection..."
for i in {1..30}; do
    if docker-compose exec -T redis redis-cli ping | grep -q PONG; then
        echo -e "${GREEN}✅ Redis is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ Redis failed to start${NC}"
        exit 1
    fi
    sleep 1
done

echo -e "${GREEN}🎉 Setup completed successfully!${NC}"
echo ""
echo "📋 Next steps:"
echo "  1. Update .env files with your blockchain RPC URLs and private keys"
echo "  2. Run 'npm run dev' in backend/matching-engine to start the matching engine"
echo "  3. Run 'npm run dev' in backend/batch-settler to start the batch settler"
echo "  4. Or run 'docker-compose up' to start all services"
echo ""
echo "🔗 Service URLs:"
echo "  Matching Engine: http://localhost:3001"
echo "  Batch Settler: http://localhost:3002"
echo "  PostgreSQL: localhost:5432"
echo "  Redis: localhost:6379"
echo "  Health Check: http://localhost:3001/health"
