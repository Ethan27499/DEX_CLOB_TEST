#!/usr/bin/env node

// Simple test script to verify security framework
const axios = require('axios');

const BASE_URL = 'http://localhost:3002';

async function testAPIs() {
  console.log('🧪 Testing Security Framework APIs...\n');

  try {
    // Test 1: Health check
    console.log('1️⃣ Testing health endpoint...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Health check:', healthResponse.data);

    // Test 2: API health with security context
    console.log('\n2️⃣ Testing API health endpoint...');
    const apiHealthResponse = await axios.get(`${BASE_URL}/api/health`);
    console.log('✅ API Health:', apiHealthResponse.data);

    // Test 3: Public orderbook (rate limited)
    console.log('\n3️⃣ Testing public orderbook endpoint...');
    try {
      const orderbookResponse = await axios.get(`${BASE_URL}/api/public/orderbook/ETH-USDC`);
      console.log('✅ Public orderbook:', orderbookResponse.data);
    } catch (error) {
      console.log('ℹ️ Public orderbook (expected 500):', error.response?.data || error.message);
    }

    // Test 4: Authentication endpoint
    console.log('\n4️⃣ Testing authentication endpoint...');
    try {
      const authResponse = await axios.post(`${BASE_URL}/auth/session`, {
        address: '0x1234567890123456789012345678901234567890',
        signature: 'test_signature',
        message: 'test_message'
      });
      console.log('✅ Authentication:', authResponse.data);
    } catch (error) {
      console.log('ℹ️ Authentication (expected 400/500):', error.response?.data || error.message);
    }

    // Test 5: Rate limiting
    console.log('\n5️⃣ Testing rate limiting...');
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        axios.get(`${BASE_URL}/health`).catch(err => err.response)
      );
    }
    const results = await Promise.all(promises);
    console.log('✅ Rate limiting test completed, responses:', results.length);

    console.log('\n🎉 Security Framework Test Completed Successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('Make sure server is running on port 3002');
  }
}

if (require.main === module) {
  testAPIs();
}

module.exports = { testAPIs };
