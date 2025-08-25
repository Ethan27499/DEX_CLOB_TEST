#!/bin/bash

echo "=== Testing DEX CLOB API Integration ==="
echo

# Wait for backend to be ready
echo "1. Testing Health Endpoint..."
curl -s http://localhost:3002/health | jq . || echo "Backend not ready"
echo

echo "2. Testing Contract Stats Endpoint..."
curl -s http://localhost:3002/api/v1/contract/stats | jq . || echo "Contract stats not available"
echo

echo "3. Seeding OrderBook with Sample Data..."
curl -s -X POST http://localhost:3002/api/v1/dev/seed-orderbook | jq . || echo "Failed to seed orderbook"
echo

echo "4. Testing Order Book Endpoints..."
curl -s http://localhost:3002/api/v1/orderbook/ETH/USDC | jq . || echo "Order book not available"
echo

echo "5. Testing Order Book Depth..."
curl -s "http://localhost:3002/api/v1/orderbook/ETH/USDC/depth?depth=10" | jq . || echo "Order book depth not available"
echo

echo "6. Testing Order Book Trades..."
curl -s "http://localhost:3002/api/v1/orderbook/ETH/USDC/trades?limit=20" | jq . || echo "Order book trades not available"
echo

echo "=== Integration Test Complete ==="
