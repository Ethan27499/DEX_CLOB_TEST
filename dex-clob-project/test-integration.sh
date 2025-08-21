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

echo "3. Testing Order Validation Endpoint..."
curl -s -X POST http://localhost:3002/api/v1/orders/validate \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test_order_1",
    "trader_address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "amount": "1000000000000000000",
    "price": "2000000000000000000000",
    "base_token": "ETH",
    "quote_token": "USDC",
    "side": "buy"
  }' | jq . || echo "Order validation failed"
echo

echo "4. Testing Order Book..."
curl -s http://localhost:3002/api/v1/orderbook/ETH/USDC | jq . || echo "Order book not available"
echo

echo "=== Integration Test Complete ==="
