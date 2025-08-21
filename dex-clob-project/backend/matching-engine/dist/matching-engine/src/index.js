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
const database_1 = require("./database");
const websocket_1 = require("./websocket");
const routes_1 = require("./routes");
const logger_1 = require("./logger");
const contract_manager_1 = require("./contract-manager");
const constants_1 = require("../../shared/constants");
dotenv_1.default.config();
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
        this.databaseManager = new database_1.DatabaseManager();
        if (this.isBlockchainEnabled()) {
            const contractConfig = this.getContractConfig();
            this.contractManager = new contract_manager_1.ContractManager(contractConfig, this.databaseManager);
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
        this.app.use((0, helmet_1.default)());
        this.app.use((0, cors_1.default)());
        this.app.use((0, compression_1.default)());
        const limiter = (0, express_rate_limit_1.default)({
            windowMs: constants_1.RATE_LIMITS.API_CALLS.windowMs,
            max: constants_1.RATE_LIMITS.API_CALLS.max,
            message: 'Too many requests from this IP',
            standardHeaders: true,
            legacyHeaders: false,
        });
        this.app.use('/api/', limiter);
        this.app.use(express_1.default.json({ limit: '10mb' }));
        this.app.use(express_1.default.urlencoded({ extended: true }));
        this.app.use((req, res, next) => {
            this.logger.info(`${req.method} ${req.path}`, {
                ip: req.ip,
                userAgent: req.get('User-Agent'),
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
        const apiRouter = new routes_1.APIRouter(this.orderBookManager, this.databaseManager, this.contractManager);
        this.app.use('/api/v1', apiRouter.getRouter());
        this.app.use('*', (req, res) => {
            res.status(404).json({
                error: 'Not Found',
                message: 'The requested resource was not found',
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
            this.databaseManager.updateOrder(order);
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