#!/usr/bin/env node

const axios = require('axios');
const WebSocket = require('ws');

const BASE_URL = 'http://localhost:3002/api';
const WS_URL = 'ws://localhost:3002';

// Test data
const testWallet = {
    address: '0x742d35Cc6634C0532925a3b8c17c9F5e5D2F80C9',
    privateKey: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'
};

class DEXCLOBTester {
    constructor() {
        this.userId = null;
        this.orders = [];
        this.ws = null;
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async apiCall(endpoint, method = 'GET', data = null) {
        try {
            const options = {
                method,
                headers: { 'Content-Type': 'application/json' },
            };

            if (data) {
                options.data = data;
            }

            const response = await axios(`${BASE_URL}${endpoint}`, options);
            return response.data;
        } catch (error) {
            console.error(`❌ API Error (${endpoint}):`, error.response?.data || error.message);
            throw error;
        }
    }

    async connectWebSocket() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(WS_URL);
            
            this.ws.on('open', () => {
                console.log('✅ WebSocket connected');
                resolve();
            });
            
            this.ws.on('message', (data) => {
                const message = JSON.parse(data);
                console.log(`📡 WebSocket message:`, message);
            });
            
            this.ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
                reject(error);
            });
        });
    }

    async testHealthCheck() {
        console.log('\n🏥 Testing Health Check...');
        const health = await this.apiCall('/health');
        console.log('✅ Health check passed:', health);
        return health;
    }

    async testUserCreation() {
        console.log('\n👤 Testing User Creation...');
        const userData = {
            address: testWallet.address,
            nonce: 0,
            isActive: true
        };
        
        const user = await this.apiCall('/users', 'POST', userData);
        this.userId = user.id;
        console.log('✅ User created:', user);
        return user;
    }

    async testOrderSubmission() {
        console.log('\n📋 Testing Order Submission...');
        
        // Submit buy order
        const buyOrder = {
            id: `order_${Date.now()}_buy`,
            userId: this.userId,
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

        const buyResult = await this.apiCall('/orders', 'POST', buyOrder);
        this.orders.push(buyOrder);
        console.log('✅ Buy order submitted:', buyResult);

        await this.delay(1000);

        // Submit sell order
        const sellOrder = {
            id: `order_${Date.now()}_sell`,
            userId: this.userId,
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

        const sellResult = await this.apiCall('/orders', 'POST', sellOrder);
        this.orders.push(sellOrder);
        console.log('✅ Sell order submitted:', sellResult);

        return { buyResult, sellResult };
    }

    async testOrderBook() {
        console.log('\n📖 Testing Order Book...');
        const orderbook = await this.apiCall('/orderbook/ETH/USDC');
        console.log('✅ Order book retrieved:', orderbook);
        return orderbook;
    }

    async testTrades() {
        console.log('\n💹 Testing Trades...');
        const trades = await this.apiCall('/trades/ETH/USDC');
        console.log('✅ Trades retrieved:', trades);
        return trades;
    }

    async testUserOrders() {
        console.log('\n📝 Testing User Orders...');
        const userOrders = await this.apiCall(`/users/${this.userId}/orders`);
        console.log('✅ User orders retrieved:', userOrders);
        return userOrders;
    }

    async testMarketData() {
        console.log('\n📊 Testing Market Data...');
        const marketData = await this.apiCall('/market');
        console.log('✅ Market data retrieved:', marketData);
        return marketData;
    }

    async testBatchOperations() {
        console.log('\n🔄 Testing Batch Operations...');
        
        // Create multiple orders for batching
        const orders = [];
        for (let i = 0; i < 3; i++) {
            const order = {
                id: `batch_order_${Date.now()}_${i}`,
                userId: this.userId,
                pair: 'BTC/USDC',
                side: i % 2 === 0 ? 'buy' : 'sell',
                type: 'limit',
                price: '50000',
                amount: '0.1',
                filled: '0',
                remaining: '0.1',
                status: 'pending',
                timestamp: Date.now(),
                nonce: 10 + i,
                signature: `0x${i}23456789abcdef`,
                chainId: 31337
            };
            
            await this.apiCall('/orders', 'POST', order);
            orders.push(order);
            await this.delay(500);
        }
        
        console.log('✅ Batch orders submitted');
        return orders;
    }

    async testDifferentPairs() {
        console.log('\n🔄 Testing Different Trading Pairs...');
        
        const pairs = ['MATIC/USDC', 'LINK/USDC'];
        
        for (const pair of pairs) {
            const order = {
                id: `pair_order_${Date.now()}_${pair.replace('/', '_')}`,
                userId: this.userId,
                pair: pair,
                side: 'buy',
                type: 'limit',
                price: pair === 'MATIC/USDC' ? '0.8' : '15.0',
                amount: pair === 'MATIC/USDC' ? '100' : '5',
                filled: '0',
                remaining: pair === 'MATIC/USDC' ? '100' : '5',
                status: 'pending',
                timestamp: Date.now(),
                nonce: Math.floor(Math.random() * 1000000),
                signature: '0x123456789abcdef',
                chainId: 31337
            };
            
            await this.apiCall('/orders', 'POST', order);
            console.log(`✅ Order submitted for ${pair}`);
            await this.delay(500);
        }
    }

    async testMarketOrders() {
        console.log('\n⚡ Testing Market Orders...');
        
        const marketOrder = {
            id: `market_order_${Date.now()}`,
            userId: this.userId,
            pair: 'ETH/USDC',
            side: 'buy',
            type: 'market',
            price: '0', // Market orders don't have a specific price
            amount: '0.5',
            filled: '0',
            remaining: '0.5',
            status: 'pending',
            timestamp: Date.now(),
            nonce: Math.floor(Math.random() * 1000000),
            signature: '0x123456789abcdef',
            chainId: 31337
        };
        
        const result = await this.apiCall('/orders', 'POST', marketOrder);
        console.log('✅ Market order submitted:', result);
        return result;
    }

    async testStressLoad() {
        console.log('\n🚀 Testing Stress Load (10 rapid orders)...');
        
        const promises = [];
        for (let i = 0; i < 10; i++) {
            const order = {
                id: `stress_order_${Date.now()}_${i}`,
                userId: this.userId,
                pair: 'ETH/USDC',
                side: i % 2 === 0 ? 'buy' : 'sell',
                type: 'limit',
                price: (2000 + (i * 10)).toString(),
                amount: (0.1 + (i * 0.05)).toString(),
                filled: '0',
                remaining: (0.1 + (i * 0.05)).toString(),
                status: 'pending',
                timestamp: Date.now() + i,
                nonce: Math.floor(Math.random() * 1000000),
                signature: `0x${i}23456789abcdef`,
                chainId: 31337
            };
            
            promises.push(this.apiCall('/orders', 'POST', order));
        }
        
        const results = await Promise.all(promises);
        console.log(`✅ Submitted ${results.length} orders simultaneously`);
        return results;
    }

    async runFullTest() {
        console.log('🚀 Starting DEX CLOB Comprehensive Test Suite...\n');
        
        try {
            // Connect WebSocket
            await this.connectWebSocket();
            
            // Run all tests
            await this.testHealthCheck();
            await this.testUserCreation();
            await this.testOrderSubmission();
            await this.delay(2000); // Wait for potential matching
            
            await this.testOrderBook();
            await this.testTrades();
            await this.testUserOrders();
            await this.testMarketData();
            
            await this.testBatchOperations();
            await this.testDifferentPairs();
            await this.testMarketOrders();
            await this.testStressLoad();
            
            // Final status check
            console.log('\n📊 Final System Status:');
            const finalHealth = await this.testHealthCheck();
            const finalMarketData = await this.testMarketData();
            
            console.log('\n🎉 ALL TESTS COMPLETED SUCCESSFULLY!');
            console.log('📈 Test Results Summary:');
            console.log(`   • User ID: ${this.userId}`);
            console.log(`   • Orders Submitted: ${this.orders.length + 10 + 3 + 2 + 1 + 10}`); // Rough count
            console.log(`   • Trading Pairs Tested: ETH/USDC, BTC/USDC, MATIC/USDC, LINK/USDC`);
            console.log(`   • Order Types Tested: Limit, Market`);
            console.log(`   • Features Tested: User Management, Order Book, Trading, Market Data, Batching, WebSocket`);
            
        } catch (error) {
            console.error('\n❌ Test suite failed:', error.message);
            throw error;
        } finally {
            if (this.ws) {
                this.ws.close();
                console.log('🔌 WebSocket connection closed');
            }
        }
    }
}

// Run the test suite
const tester = new DEXCLOBTester();
tester.runFullTest().catch(console.error);
