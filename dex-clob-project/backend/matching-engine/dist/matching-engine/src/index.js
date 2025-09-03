"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MatchingEngineServer = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const dotenv_1 = __importDefault(require("dotenv"));
const orderbook_1 = require("./orderbook");
const database_memory_1 = require("./database-memory");
const websocket_1 = require("./websocket");
const routes_1 = require("./routes");
const logger_1 = require("./logger");
const contract_manager_mock_1 = require("./contract-manager-mock");
const auth_simple_1 = require("./security/auth-simple");
dotenv_1.default.config();
const setupSecurity = () => [
    (0, helmet_1.default)(),
    (0, compression_1.default)()
];
const corsConfig = {
    origin: "*",
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
};
const optionalAuth = (req, res, next) => {
    next();
};
const ipRateLimit = (maxRequests, windowMs) => {
    return (0, express_rate_limit_1.default)({
        windowMs,
        max: maxRequests,
        message: 'IP rate limit exceeded'
    });
};
const burstProtection = (short, long) => {
    return (0, express_rate_limit_1.default)({
        windowMs: short.window,
        max: short.requests,
        message: 'Burst protection triggered'
    });
};
class SecurityMonitor {
    constructor() {
        this.alerts = [];
    }
    static getInstance() {
        if (!SecurityMonitor.instance) {
            SecurityMonitor.instance = new SecurityMonitor();
        }
        return SecurityMonitor.instance;
    }
    getRecentAlerts(minutes) {
        return this.alerts.slice(-10);
    }
    addAlert(type, message, ip) {
        this.alerts.push({ type, message, ip, timestamp: new Date() });
    }
}
class MatchingEngineServer {
    constructor() {
        this.app = (0, express_1.default)();
        this.server = (0, http_1.createServer)(this.app);
        this.io = new socket_io_1.Server(this.server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        this.logger = new logger_1.Logger('MatchingEngine');
        this.orderBookManager = new orderbook_1.OrderBookManager();
        this.databaseManager = new database_memory_1.InMemoryDatabaseManager();
        if (this.isBlockchainEnabled()) {
            const contractConfig = this.getContractConfig();
            this.contractManager = new contract_manager_mock_1.MockContractManager(contractConfig, this.databaseManager);
        }
        else {
            const mockConfig = {
                hybridCLOBAddress: '0x0000000000000000000000000000000000000000',
                tokens: {
                    BASE: '0x0000000000000000000000000000000000000000',
                    QUOTE: '0x0000000000000000000000000000000000000000'
                },
                rpcUrl: 'http://localhost:8545',
                privateKey: '0x0000000000000000000000000000000000000000000000000000000000000000',
                chainId: 31337
            };
            this.contractManager = new contract_manager_mock_1.MockContractManager(mockConfig, this.databaseManager);
        }
        this.wsManager = new websocket_1.WebSocketManager(this.io, this.orderBookManager);
        this.setupMiddleware();
        this.setupRoutes();
        this.setupEventHandlers();
    }
    isBlockchainEnabled() {
        return !!(process.env.RPC_URL &&
            process.env.PRIVATE_KEY &&
            process.env.HYBRID_CLOB_ADDRESS);
    }
    isDatabaseEnabled() {
        return !!(process.env.POSTGRES_HOST &&
            process.env.POSTGRES_USER &&
            process.env.POSTGRES_PASSWORD);
    }
    getContractConfig() {
        if (!this.isBlockchainEnabled()) {
            throw new Error('Blockchain configuration is incomplete');
        }
        return {
            hybridCLOBAddress: process.env.HYBRID_CLOB_ADDRESS,
            tokens: {
                BASE: process.env.BASE_TOKEN_ADDRESS || '',
                QUOTE: process.env.QUOTE_TOKEN_ADDRESS || ''
            },
            rpcUrl: process.env.RPC_URL,
            privateKey: process.env.PRIVATE_KEY,
            chainId: parseInt(process.env.CHAIN_ID || '31337')
        };
    }
    setupMiddleware() {
        const securityMiddleware = setupSecurity();
        securityMiddleware.forEach(middleware => {
            this.app.use(middleware);
        });
        this.app.use((0, cors_1.default)(corsConfig));
        this.app.use((0, compression_1.default)());
        this.app.use('/api/public/', ipRateLimit(200, 60 * 1000));
        this.app.use('/api/', burstProtection({ requests: 50, window: 10 * 1000 }, { requests: 1000, window: 60 * 1000 }));
        this.app.use(express_1.default.json({
            limit: '10mb',
            verify: (req, res, buf) => {
                req.rawBody = buf;
            }
        }));
        this.app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
        this.app.use((req, res, next) => {
            const monitor = SecurityMonitor.getInstance();
            const suspiciousHeaders = [
                'x-forwarded-for',
                'x-real-ip',
                'x-cluster-client-ip'
            ];
            const hasMultipleIPs = suspiciousHeaders.some(header => req.headers[header] && req.headers[header] !== req.ip);
            if (hasMultipleIPs) {
                monitor.addAlert('WARNING', 'Multiple IP headers detected', req.ip || 'unknown');
            }
            next();
        });
        this.app.use((req, res, next) => {
            const startTime = Date.now();
            res.on('finish', () => {
                const duration = Date.now() - startTime;
                const logData = {
                    method: req.method,
                    url: req.originalUrl,
                    statusCode: res.statusCode,
                    duration: `${duration}ms`,
                    ip: req.ip,
                    userAgent: req.get('User-Agent'),
                    userId: req.user?.id || 'anonymous',
                    contentLength: res.get('Content-Length') || '0'
                };
                const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
                this.logger[logLevel](`${req.method} ${req.originalUrl}`, logData);
            });
            next();
        });
    }
    setupRoutes() {
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                version: process.env.npm_package_version || '1.0.0',
            });
        });
        this.app.get('/api/health', optionalAuth, (req, res) => {
            const monitor = SecurityMonitor.getInstance();
            const recentAlerts = monitor.getRecentAlerts(5);
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                version: process.env.npm_package_version || '1.0.0',
                authenticated: !!req.user,
                userId: req.user?.id || null,
                securityAlerts: recentAlerts.length,
                environment: process.env.NODE_ENV || 'development'
            });
        });
        this.setupAuthRoutes();
        this.setupSecureTradingRoutes();
        this.setupPublicRoutes();
        this.setupAdminRoutes();
        const apiRouter = new routes_1.APIRouter(this.orderBookManager, this.databaseManager, this.contractManager);
        this.app.use('/api', optionalAuth, apiRouter.getRouter());
        this.app.use('/api/v1', optionalAuth, apiRouter.getRouter());
        this.app.use('*', (req, res) => {
            res.status(404).json({
                error: 'Not Found',
                message: 'The requested resource was not found',
                timestamp: new Date().toISOString()
            });
        });
        this.app.use((err, req, res, next) => {
            this.logger.error('Unhandled error:', err);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'An unexpected error occurred',
            });
        });
    }
    setupAuthRoutes() {
        this.app.post('/auth/session', ipRateLimit(5, 15 * 60 * 1000), async (req, res) => {
            try {
                const { address, signature, message } = req.body;
                if (!address || !signature) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid authentication data'
                    });
                }
                const sessionId = (0, auth_simple_1.createSession)(address, address, req.ip || 'unknown');
                res.json({
                    success: true,
                    sessionId,
                    address,
                    expiresIn: '24h'
                });
            }
            catch (error) {
                this.logger.error('Session auth failed:', error);
                res.status(500).json({
                    success: false,
                    error: 'Authentication failed'
                });
            }
        });
        this.app.post('/auth/jwt', ipRateLimit(5, 15 * 60 * 1000), async (req, res) => {
            try {
                const { address, signature, message, chainId } = req.body;
                if (!address || !signature) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid authentication data'
                    });
                }
                const accessToken = (0, auth_simple_1.generateAccessToken)({
                    userId: address,
                    address,
                    role: 'user',
                    chainId: chainId || 1
                });
                const refreshToken = (0, auth_simple_1.generateRefreshToken)({
                    userId: address,
                    address
                });
                res.json({
                    success: true,
                    accessToken,
                    refreshToken,
                    address,
                    expiresIn: '24h'
                });
            }
            catch (error) {
                this.logger.error('JWT auth failed:', error);
                res.status(500).json({
                    success: false,
                    error: 'Token generation failed'
                });
            }
        });
        this.app.post('/auth/logout', optionalAuth, (req, res) => {
            if (req.sessionId) {
                (0, auth_simple_1.destroySession)(req.sessionId);
            }
            res.json({
                success: true,
                message: 'Logged out successfully'
            });
        });
    }
    setupSecureTradingRoutes() {
        this.app.post('/api/v2/orders', optionalAuth, ipRateLimit(10, 60 * 1000), async (req, res) => {
            try {
                const { side, amount, price, tokenIn, tokenOut } = req.body;
                if (!side || !amount || !price || !tokenIn || !tokenOut) {
                    return res.status(400).json({
                        success: false,
                        error: 'Missing required order fields'
                    });
                }
                const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                res.json({
                    success: true,
                    order: {
                        id: orderId,
                        side,
                        amount,
                        price,
                        tokenIn,
                        tokenOut,
                        status: 'pending',
                        timestamp: Date.now()
                    }
                });
            }
            catch (error) {
                this.logger.error('Order placement failed:', error);
                res.status(500).json({
                    success: false,
                    error: 'Order placement failed'
                });
            }
        });
        this.app.post('/api/v2/swap', optionalAuth, ipRateLimit(5, 60 * 1000), async (req, res) => {
            try {
                const { tokenIn, tokenOut, amountIn } = req.body;
                if (!tokenIn || !tokenOut || !amountIn) {
                    return res.status(400).json({
                        success: false,
                        error: 'Missing required swap fields'
                    });
                }
                const swapId = `swap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const amountOut = parseFloat(amountIn) * 0.95;
                res.json({
                    success: true,
                    swap: {
                        id: swapId,
                        tokenIn,
                        tokenOut,
                        amountIn,
                        amountOut: amountOut.toString(),
                        timestamp: Date.now()
                    }
                });
            }
            catch (error) {
                this.logger.error('Swap execution failed:', error);
                res.status(500).json({
                    success: false,
                    error: 'Swap execution failed'
                });
            }
        });
    }
    setupPublicRoutes() {
        this.app.get('/api/public/orderbook/:pair', ipRateLimit(100, 60 * 1000), (req, res) => {
            try {
                const { pair } = req.params;
                const [base, quote] = pair.split('-');
                if (!base || !quote) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid trading pair format. Use BASE-QUOTE'
                    });
                }
                const pair_full = `${base}-${quote}`;
                const orderbook = this.orderBookManager.getOrderBook(pair_full);
                res.json({
                    success: true,
                    pair,
                    orderbook: orderbook || { bids: [], asks: [] },
                    timestamp: Date.now()
                });
            }
            catch (error) {
                this.logger.error('Orderbook fetch failed:', error);
                res.status(500).json({
                    success: false,
                    error: 'Failed to fetch orderbook'
                });
            }
        });
        this.app.get('/api/public/prices', ipRateLimit(120, 60 * 1000), (req, res) => {
            try {
                const prices = {
                    'ETH-USDC': { price: 3500, change24h: 2.5 },
                    'BTC-USDC': { price: 65000, change24h: 1.8 },
                    'USDT-USDC': { price: 1.001, change24h: 0.1 }
                };
                res.json({
                    success: true,
                    prices,
                    timestamp: Date.now()
                });
            }
            catch (error) {
                this.logger.error('Price fetch failed:', error);
                res.status(500).json({
                    success: false,
                    error: 'Failed to fetch prices'
                });
            }
        });
        this.app.get('/api/public/pairs', ipRateLimit(60, 60 * 1000), (req, res) => {
            try {
                const pairs = [
                    { base: 'ETH', quote: 'USDC', active: true },
                    { base: 'BTC', quote: 'USDC', active: true },
                    { base: 'USDT', quote: 'USDC', active: true }
                ];
                res.json({
                    success: true,
                    pairs,
                    timestamp: Date.now()
                });
            }
            catch (error) {
                res.status(500).json({
                    success: false,
                    error: 'Failed to fetch trading pairs'
                });
            }
        });
    }
    setupAdminRoutes() {
        this.app.get('/admin/security', optionalAuth, (req, res) => {
            const monitor = SecurityMonitor.getInstance();
            const alerts = monitor.getRecentAlerts(60);
            res.json({
                success: true,
                alerts,
                summary: {
                    total: alerts.length,
                    critical: alerts.filter(a => a.type === 'CRITICAL').length,
                    warnings: alerts.filter(a => a.type === 'WARNING').length
                },
                timestamp: Date.now()
            });
        });
        this.app.get('/admin/status', optionalAuth, (req, res) => {
            res.json({
                success: true,
                system: {
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    nodeVersion: process.version,
                    environment: process.env.NODE_ENV || 'development'
                },
                database: {
                    connected: true,
                    type: 'in-memory'
                },
                orderbook: {
                    activePairs: Array.from(this.orderBookManager['orderBooks'].keys()),
                    totalOrders: this.orderBookManager['orders'].size
                },
                timestamp: Date.now()
            });
        });
        this.app.get('/admin/config', optionalAuth, (req, res) => {
            res.json({
                success: true,
                config: {
                    blockchain: this.isBlockchainEnabled(),
                    database: this.isDatabaseEnabled(),
                    port: process.env.PORT || 3002,
                    rateLimit: {
                        enabled: true,
                        global: '1000 req/min',
                        trading: '10 orders/min'
                    }
                },
                timestamp: Date.now()
            });
        });
    }
    setupEventHandlers() {
        this.orderBookManager.on('orderAdded', (order) => {
            this.logger.info(`Order added: ${order.id}`);
            this.databaseManager.saveOrder(order);
            if (this.contractManager) {
                this.contractManager.validateOrderOnChain(order).catch((error) => {
                    this.logger.warn(`Failed to validate order ${order.id} on-chain:`, error);
                });
            }
        });
        this.orderBookManager.on('orderCancelled', (order) => {
            this.logger.info(`Order cancelled: ${order.id}`);
            this.databaseManager.updateOrderStatus(order.id, order.status);
        });
        this.orderBookManager.on('tradeExecuted', (trade) => {
            this.logger.info(`Trade executed: ${trade.id}`);
            this.databaseManager.saveTrade(trade);
            if (this.contractManager) {
                this.logger.info(`Trade ${trade.id} ready for settlement`);
            }
        });
        this.orderBookManager.on('orderBookUpdated', (orderBook) => {
            this.wsManager.broadcastOrderBookUpdate(orderBook);
        });
        process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
        process.on('uncaughtException', (error) => {
            this.logger.error('Uncaught Exception:', error);
            this.gracefulShutdown('uncaughtException');
        });
        process.on('unhandledRejection', (reason, promise) => {
            this.logger.error('Unhandled Rejection:', { reason, promise });
            this.gracefulShutdown('unhandledRejection');
        });
    }
    async start() {
        try {
            await this.databaseManager.connect();
            this.logger.info('Database connected successfully');
            if (this.contractManager) {
                this.contractManager.startEventListeners();
                this.logger.info('Contract event listeners started');
            }
            const port = Number(process.env.PORT) || 3001;
            this.server.listen(port, '0.0.0.0', () => {
                this.logger.info(`Matching Engine Server started on 0.0.0.0:${port}`);
                this.logger.info(`WebSocket server ready for connections`);
                if (this.contractManager) {
                    this.logger.info(`Blockchain integration enabled`);
                }
                else {
                    this.logger.info(`Running in off-chain mode`);
                }
                const address = this.server.address();
                this.logger.info(`Server actually bound to:`, address);
            });
            this.wsManager.initialize();
        }
        catch (error) {
            this.logger.error('Failed to start server:', error);
            process.exit(1);
        }
    }
    async gracefulShutdown(signal) {
        this.logger.info(`Received ${signal}, starting graceful shutdown...`);
        try {
            if (this.server) {
                await new Promise((resolve) => {
                    this.server.close(() => {
                        this.logger.info('HTTP server closed');
                        resolve();
                    });
                });
            }
            if (this.wsManager) {
                await this.wsManager.close();
                this.logger.info('WebSocket connections closed');
            }
            if (this.databaseManager) {
                await this.databaseManager.disconnect();
                this.logger.info('Database connection closed');
            }
            this.logger.info('Graceful shutdown completed');
            process.exit(0);
        }
        catch (error) {
            this.logger.error('Error during graceful shutdown:', error);
            process.exit(1);
        }
    }
    getApp() {
        return this.app;
    }
    getServer() {
        return this.server;
    }
    getOrderBookManager() {
        return this.orderBookManager;
    }
}
exports.MatchingEngineServer = MatchingEngineServer;
if (require.main === module) {
    const server = new MatchingEngineServer();
    server.start().catch((error) => {
        console.error('Failed to start matching engine server:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=index.js.map