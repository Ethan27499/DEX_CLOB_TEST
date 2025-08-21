"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.APIRouter = void 0;
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const joi_1 = __importDefault(require("joi"));
const utils_1 = require("../../shared/utils");
const constants_1 = require("../../shared/constants");
const logger_1 = require("./logger");
class APIRouter {
    constructor(orderBookManager, databaseManager, contractManager) {
        this.router = (0, express_1.Router)();
        this.orderBookManager = orderBookManager;
        this.databaseManager = databaseManager;
        this.contractManager = contractManager;
        this.logger = new logger_1.Logger('APIRouter');
        this.setupRoutes();
    }
    setupRoutes() {
        this.router.post('/orders', this.createOrderRateLimit(), this.placeOrder.bind(this));
        this.router.delete('/orders/:id/cancel', this.cancelOrderRateLimit(), this.cancelOrder.bind(this));
        this.router.get('/orders', this.getOrders.bind(this));
        this.router.get('/orders/:id', this.getOrder.bind(this));
        if (this.contractManager) {
            this.router.get('/contract/stats', this.getContractStats.bind(this));
            this.router.post('/orders/validate', this.validateOrderOnChain.bind(this));
        }
        this.router.get('/trades', this.getTrades.bind(this));
        this.router.get('/users/:userId/trades', this.getUserTrades.bind(this));
        this.router.get('/orderbook/:pair', this.getOrderbook.bind(this));
        this.router.get('/market-data', this.getMarketData.bind(this));
        this.router.get('/market-data/:pair', this.getPairData.bind(this));
        this.router.get('/batches', this.getBatches.bind(this));
        this.router.get('/batches/:id', this.getBatch.bind(this));
    }
    createOrderRateLimit() {
        return (0, express_rate_limit_1.default)({
            windowMs: constants_1.RATE_LIMITS.PLACE_ORDER.windowMs,
            max: constants_1.RATE_LIMITS.PLACE_ORDER.max,
            message: 'Too many order placements. Please try again later.',
            standardHeaders: true,
            legacyHeaders: false,
        });
    }
    cancelOrderRateLimit() {
        return (0, express_rate_limit_1.default)({
            windowMs: constants_1.RATE_LIMITS.CANCEL_ORDER.windowMs,
            max: constants_1.RATE_LIMITS.CANCEL_ORDER.max,
            message: 'Too many order cancellations. Please try again later.',
            standardHeaders: true,
            legacyHeaders: false,
        });
    }
    async placeOrder(req, res) {
        try {
            const orderSchema = joi_1.default.object({
                userId: joi_1.default.string().required(),
                pair: joi_1.default.string().valid(...constants_1.TRADING_PAIRS).required(),
                side: joi_1.default.string().valid('buy', 'sell').required(),
                type: joi_1.default.string().valid('limit', 'market').required(),
                price: joi_1.default.string().required(),
                amount: joi_1.default.string().required(),
                nonce: joi_1.default.number().integer().required(),
                signature: joi_1.default.string().required(),
                chainId: joi_1.default.number().integer().required(),
                expiresAt: joi_1.default.number().integer().optional(),
            });
            const { error, value } = orderSchema.validate(req.body);
            if (error) {
                res.status(400).json({
                    error: 'Validation Error',
                    message: error.details[0].message,
                });
                return;
            }
            if (!utils_1.ValidationUtils.isValidAddress(value.userId)) {
                res.status(400).json({
                    error: 'Invalid address format',
                    message: 'userId must be a valid Ethereum address',
                });
                return;
            }
            if (!utils_1.ValidationUtils.isValidAmount(value.amount)) {
                res.status(400).json({
                    error: 'Invalid amount',
                    message: 'Amount must be a positive number',
                });
                return;
            }
            if (!utils_1.ValidationUtils.isValidPrice(value.price)) {
                res.status(400).json({
                    error: 'Invalid price',
                    message: 'Price must be a positive number',
                });
                return;
            }
            const order = {
                id: utils_1.CryptoUtils.generateOrderId(),
                userId: value.userId,
                pair: value.pair,
                side: value.side,
                type: value.type,
                price: value.price,
                amount: value.amount,
                filled: '0',
                remaining: value.amount,
                status: constants_1.ORDER_STATUS.PENDING,
                timestamp: Date.now(),
                nonce: value.nonce,
                signature: value.signature,
                chainId: value.chainId,
                expiresAt: value.expiresAt,
            };
            if (!utils_1.CryptoUtils.verifyOrderSignature(order)) {
                res.status(401).json({
                    error: 'Invalid signature',
                    message: 'Order signature verification failed',
                });
                return;
            }
            this.orderBookManager.addOrder(order);
            res.status(201).json({
                success: true,
                order: {
                    id: order.id,
                    status: order.status,
                    timestamp: order.timestamp,
                },
            });
            this.logger.info(`Order placed: ${order.id} by ${order.userId}`);
        }
        catch (error) {
            this.logger.error('Error placing order:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to place order',
            });
        }
    }
    async cancelOrder(req, res) {
        try {
            const { id } = req.params;
            const { userId } = req.body;
            if (!userId || !utils_1.ValidationUtils.isValidAddress(userId)) {
                res.status(400).json({
                    error: 'Invalid userId',
                    message: 'Valid userId is required for order cancellation',
                });
                return;
            }
            const success = this.orderBookManager.cancelOrder(id, userId);
            if (success) {
                res.json({
                    success: true,
                    message: 'Order cancelled successfully',
                });
                this.logger.info(`Order cancelled: ${id} by ${userId}`);
            }
            else {
                res.status(404).json({
                    error: 'Order not found',
                    message: 'Order not found or cannot be cancelled',
                });
            }
        }
        catch (error) {
            this.logger.error('Error cancelling order:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to cancel order',
            });
        }
    }
    async getOrders(req, res) {
        try {
            const { userId, status, pair, limit = '50', offset = '0' } = req.query;
            if (userId) {
                const orders = await this.databaseManager.getUserOrders(String(userId), parseInt(String(limit)), parseInt(String(offset)));
                res.json({ orders });
            }
            else {
                res.json({ orders: [] });
            }
        }
        catch (error) {
            this.logger.error('Error fetching orders:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to fetch orders',
            });
        }
    }
    async getOrder(req, res) {
        try {
            const { id } = req.params;
            const order = await this.databaseManager.getOrder(id);
            if (order) {
                res.json({ order });
            }
            else {
                res.status(404).json({
                    error: 'Order not found',
                    message: 'Order with specified ID does not exist',
                });
            }
        }
        catch (error) {
            this.logger.error('Error fetching order:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to fetch order',
            });
        }
    }
    async getTrades(req, res) {
        try {
            const { pair, limit = '50', offset = '0' } = req.query;
            const trades = await this.databaseManager.getTrades(String(pair), parseInt(String(limit)), parseInt(String(offset)));
            res.json({ trades });
        }
        catch (error) {
            this.logger.error('Error fetching trades:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to fetch trades',
            });
        }
    }
    async getUserTrades(req, res) {
        try {
            const { userId } = req.params;
            const { limit = '50', offset = '0' } = req.query;
            res.json({ trades: [] });
        }
        catch (error) {
            this.logger.error('Error fetching user trades:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to fetch user trades',
            });
        }
    }
    async getOrderbook(req, res) {
        try {
            const { pair } = req.params;
            if (!constants_1.TRADING_PAIRS.includes(pair)) {
                res.status(400).json({
                    error: 'Invalid trading pair',
                    message: `Supported pairs: ${constants_1.TRADING_PAIRS.join(', ')}`,
                });
                return;
            }
            const orderbook = this.orderBookManager.getOrderBook(pair);
            if (orderbook) {
                res.json({ orderbook });
            }
            else {
                res.json({
                    orderbook: {
                        pair,
                        bids: [],
                        asks: [],
                        lastUpdate: Date.now(),
                    }
                });
            }
        }
        catch (error) {
            this.logger.error('Error fetching orderbook:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to fetch orderbook',
            });
        }
    }
    async getMarketData(req, res) {
        try {
            const marketData = constants_1.TRADING_PAIRS.map(pair => ({
                pair,
                lastPrice: '0',
                priceChange24h: '0',
                volume24h: '0',
                high24h: '0',
                low24h: '0',
                timestamp: Date.now(),
            }));
            res.json({ marketData });
        }
        catch (error) {
            this.logger.error('Error fetching market data:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to fetch market data',
            });
        }
    }
    async getPairData(req, res) {
        try {
            const { pair } = req.params;
            if (!constants_1.TRADING_PAIRS.includes(pair)) {
                res.status(400).json({
                    error: 'Invalid trading pair',
                    message: `Supported pairs: ${constants_1.TRADING_PAIRS.join(', ')}`,
                });
                return;
            }
            const pairData = {
                pair,
                lastPrice: '0',
                priceChange24h: '0',
                volume24h: '0',
                high24h: '0',
                low24h: '0',
                timestamp: Date.now(),
            };
            res.json({ pairData });
        }
        catch (error) {
            this.logger.error('Error fetching pair data:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to fetch pair data',
            });
        }
    }
    async getBatches(req, res) {
        try {
            res.json({ batches: [] });
        }
        catch (error) {
            this.logger.error('Error fetching batches:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to fetch batches',
            });
        }
    }
    async getBatch(req, res) {
        try {
            const { id } = req.params;
            res.status(404).json({
                error: 'Batch not found',
                message: 'Batch with specified ID does not exist',
            });
        }
        catch (error) {
            this.logger.error('Error fetching batch:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to fetch batch',
            });
        }
    }
    async getContractStats(req, res) {
        try {
            if (!this.contractManager) {
                res.status(503).json({
                    error: 'Contract integration not available',
                    message: 'Blockchain integration is not configured'
                });
                return;
            }
            const stats = await this.contractManager.getContractStats();
            res.json({
                success: true,
                data: stats
            });
        }
        catch (error) {
            this.logger.error('Error fetching contract stats:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to fetch contract statistics'
            });
        }
    }
    async validateOrderOnChain(req, res) {
        try {
            if (!this.contractManager) {
                res.status(503).json({
                    error: 'Contract integration not available',
                    message: 'Blockchain integration is not configured'
                });
                return;
            }
            const order = req.body;
            if (!order.id || !order.trader_address || !order.amount) {
                res.status(400).json({
                    error: 'Validation Error',
                    message: 'Missing required order fields'
                });
                return;
            }
            const isValid = await this.contractManager.validateOrderOnChain(order);
            res.json({
                success: true,
                valid: isValid,
                orderId: order.id
            });
        }
        catch (error) {
            this.logger.error('Error validating order on-chain:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to validate order on blockchain'
            });
        }
    }
    getRouter() {
        return this.router;
    }
}
exports.APIRouter = APIRouter;
//# sourceMappingURL=routes.js.map