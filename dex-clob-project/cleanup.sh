#!/bin/bash

# 🧹 Clean-up script for Massive LP Orbital AMM

echo "🧹 CLEANING UP DEX CLOB PROJECT..."
echo "=================================="

# Clean contracts
echo "📄 Cleaning contracts..."
cd contracts
if [ -d "cache" ]; then
    rm -rf cache
    echo "   ✅ Removed cache directory"
fi

if [ -d "artifacts" ]; then
    rm -rf artifacts
    echo "   ✅ Removed artifacts directory"
fi

if [ -d "typechain-types" ]; then
    rm -rf typechain-types
    echo "   ✅ Removed typechain-types directory"
fi

if [ -d "node_modules" ]; then
    echo "   🔄 Removing node_modules..."
    rm -rf node_modules
    echo "   ✅ Removed node_modules"
fi

# Clean and reinstall
echo "   📦 Reinstalling dependencies..."
npm install
echo "   ✅ Dependencies reinstalled"

# Recompile
echo "   🔨 Recompiling contracts..."
npx hardhat compile
echo "   ✅ Contracts recompiled"

cd ..

# Clean backend
echo "🚀 Cleaning backend..."
cd backend/matching-engine

if [ -d "node_modules" ]; then
    echo "   🔄 Removing node_modules..."
    rm -rf node_modules
    echo "   ✅ Removed node_modules"
fi

if [ -d "dist" ]; then
    rm -rf dist
    echo "   ✅ Removed dist directory"
fi

# Clean and reinstall
echo "   📦 Reinstalling dependencies..."
npm install
echo "   ✅ Dependencies reinstalled"

# Build
echo "   🏗️ Building backend..."
npm run build
echo "   ✅ Backend built"

cd ../..

# Clean logs
echo "🗂️ Cleaning logs..."
if [ -d "logs" ]; then
    rm -rf logs
    echo "   ✅ Removed logs directory"
fi

# Clean Docker volumes (optional)
echo "🐳 Cleaning Docker..."
docker system prune -f
echo "   ✅ Docker system cleaned"

echo ""
echo "🎉 CLEANUP COMPLETE!"
echo "==================="
echo "✅ All caches cleared"
echo "✅ Dependencies updated"
echo "✅ Contracts recompiled"
echo "✅ Backend rebuilt"
echo "✅ System ready for deployment"
echo ""
echo "🚀 Ready to revolutionize DeFi!"
