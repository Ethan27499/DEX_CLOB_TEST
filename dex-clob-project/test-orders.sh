#!/bin/bash

# Test Order Placement Script
echo "🧪 Testing Order Placement..."

# Test data
USER_ID="0x1234567890123456789012345678901234567890"
PAIR="ETH/USDC"
PRICE="2000.50"
AMOUNT="1.5"
NONCE=1
CHAIN_ID=10

# Mock signature (in real app this would be signed with private key)
SIGNATURE="0x1234567890abcdef"

echo "📤 Placing buy order..."

# Place buy order
curl -X POST http://localhost:3001/api/v1/orders \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"pair\": \"$PAIR\",
    \"side\": \"buy\",
    \"type\": \"limit\",
    \"price\": \"$PRICE\",
    \"amount\": \"$AMOUNT\",
    \"nonce\": $NONCE,
    \"signature\": \"$SIGNATURE\",
    \"chainId\": $CHAIN_ID
  }" | jq .

echo -e "\n📤 Placing sell order..."

# Place sell order
curl -X POST http://localhost:3001/api/v1/orders \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"pair\": \"$PAIR\",
    \"side\": \"sell\",
    \"type\": \"limit\",
    \"price\": \"2001.00\",
    \"amount\": \"1.0\",
    \"nonce\": 2,
    \"signature\": \"$SIGNATURE\",
    \"chainId\": $CHAIN_ID
  }" | jq .

echo -e "\n📊 Checking updated orderbook..."
sleep 1

curl -s "http://localhost:3001/api/v1/orderbook/ETH%2FUSDC" | jq .

echo -e "\n📋 Checking orders..."
curl -s "http://localhost:3001/api/v1/orders?userId=$USER_ID" | jq .

echo -e "\n🏁 Order testing completed!"
