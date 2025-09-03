#!/usr/bin/env node

const axios = require('axios');

const BASE_URL = 'http://localhost:3002/api';

// Test API endpoints
async function testAPI() {
  try {
    console.log('🚀 Testing DEX CLOB API with Real Data...\n');

    // 1. Health Check
    console.log('1. Testing health check...');
    const health = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Health:', health.data);
    console.log();

    // 2. Create user
    console.log('2. Creating test user...');
    const userResponse = await axios.post(`${BASE_URL}/users`, {
      address: '0x742d35Cc6634C0532925a3b8c17c9F5e5D2F80C9',
      nonce: 0,
      isActive: true
    });
    console.log('✅ User created:', userResponse.data);
    const userId = userResponse.data.id;
    console.log();

    // 3. Get market data
    console.log('3. Getting market data...');
    const marketData = await axios.get(`${BASE_URL}/market`);
    console.log('✅ Market data:', marketData.data);
    console.log();

    // 4. Submit order
    console.log('4. Submitting buy order...');
    const order = {
      id: `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: userId,
      pair: 'ETH/USDC',
      side: 'buy',
      type: 'limit',
      price: '2000',
      amount: '1.5',
      filled: '0',
      remaining: '1.5',
      status: 'pending',
      timestamp: Date.now(),
      nonce: 1,
      signature: '0x123456789abcdef',
      chainId: 31337
    };

    const orderResponse = await axios.post(`${BASE_URL}/orders`, order);
    console.log('✅ Order submitted:', orderResponse.data);
    console.log();

    // 5. Get order book
    console.log('5. Getting order book for ETH/USDC...');
    const orderBook = await axios.get(`${BASE_URL}/orderbook/ETH/USDC`);
    console.log('✅ Order book:', JSON.stringify(orderBook.data, null, 2));
    console.log();

    // 6. Get user orders
    console.log('6. Getting user orders...');
    const userOrders = await axios.get(`${BASE_URL}/users/${userId}/orders`);
    console.log('✅ User orders:', userOrders.data);
    console.log();

    // 7. Submit counter order to create a trade
    console.log('7. Submitting sell order to match...');
    const sellOrder = {
      id: `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: userId,
      pair: 'ETH/USDC',
      side: 'sell',
      type: 'limit',
      price: '2000',
      amount: '1.0',
      filled: '0',
      remaining: '1.0',
      status: 'pending',
      timestamp: Date.now(),
      nonce: 2,
      signature: '0x987654321fedcba',
      chainId: 31337
    };

    const sellOrderResponse = await axios.post(`${BASE_URL}/orders`, sellOrder);
    console.log('✅ Sell order submitted:', sellOrderResponse.data);
    console.log();

    // Wait a bit for matching
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 8. Get trades
    console.log('8. Getting trades...');
    const trades = await axios.get(`${BASE_URL}/trades/ETH/USDC`);
    console.log('✅ Trades:', trades.data);
    console.log();

    // 9. Get updated market data
    console.log('9. Getting updated market data...');
    const updatedMarketData = await axios.get(`${BASE_URL}/market`);
    console.log('✅ Updated market data:', updatedMarketData.data);
    console.log();

    console.log('🎉 All API tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    console.error('Stack:', error.stack);
  }
}

// Run the test
testAPI();
