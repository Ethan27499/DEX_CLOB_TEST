import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import { OrderBookManager } from './orderbook';
import { DatabaseManager } from './database';
import { WebSocketManager } from './websocket';
import { APIRouter } from './routes';
import { Logger } from './logger';
import { ContractManager, ContractConfig } from './contract-manager';
import { RATE_LIMITS } from '../../shared/constants';

// Load environment variables
dotenv.config();

export class MatchingEngineServer {
  private app: express.Application;
  private server: any;
  private io: SocketIOServer;
  private orderBookManager: OrderBookManager;
  private databaseManager: DatabaseManager;
  private wsManager: WebSocketManager;
  private contractManager: ContractManager;
  private logger: Logger;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    
    this.logger = new Logger('MatchingEngine');
    this.orderBookManager = new OrderBookManager();
    this.databaseManager = new DatabaseManager();
    
    // Initialize contract manager if blockchain integration is enabled
    if (this.isBlockchainEnabled()) {
      const contractConfig = this.getContractConfig();
      this.contractManager = new ContractManager(contractConfig, this.databaseManager);
    }
    
    this.wsManager = new WebSocketManager(this.io, this.orderBookManager);
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupEventHandlers();
  }

  private isBlockchainEnabled(): boolean {
    return !!(
      process.env.RPC_URL && 
      process.env.PRIVATE_KEY && 
      process.env.HYBRID_CLOB_ADDRESS
    );
  }

  private getContractConfig(): ContractConfig {
    if (!this.isBlockchainEnabled()) {
      throw new Error('Blockchain configuration is incomplete');
    }

    return {
      hybridCLOBAddress: process.env.HYBRID_CLOB_ADDRESS!,
      tokens: {
        BASE: process.env.BASE_TOKEN_ADDRESS || '',
        QUOTE: process.env.QUOTE_TOKEN_ADDRESS || ''
      },
      rpcUrl: process.env.RPC_URL!,
      privateKey: process.env.PRIVATE_KEY!,
      chainId: parseInt(process.env.CHAIN_ID || '31337')
    };
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(compression());

    // Rate limiting
    const limiter = rateLimit({
      windowMs: RATE_LIMITS.API_CALLS.windowMs,
      max: RATE_LIMITS.API_CALLS.max,
      message: 'Too many requests from this IP',
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use('/api/', limiter);

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Logging middleware
    this.app.use((req, res, next) => {
      this.logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
      });
    });

    // API routes
    const apiRouter = new APIRouter(
      this.orderBookManager, 
      this.databaseManager,
      this.contractManager
    );
    this.app.use('/api/v1', apiRouter.getRouter());

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: 'The requested resource was not found',
      });
    });

    // Error handler
    this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      this.logger.error('Unhandled error:', err);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      });
    });
  }

  private setupEventHandlers(): void {
    // Order book events
    this.orderBookManager.on('orderAdded', (order) => {
      this.logger.info(`Order added: ${order.id}`);
      this.databaseManager.saveOrder(order);
      
      // Validate order on-chain if contract manager is available
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
      
      // TODO: Add to settlement batch
      if (this.contractManager) {
        this.logger.info(`Trade ${trade.id} ready for settlement`);
      }
    });

    this.orderBookManager.on('orderBookUpdated', (orderBook) => {
      // Broadcast orderbook updates via WebSocket
      this.wsManager.broadcastOrderBookUpdate(orderBook);
    });

    // Process exit handlers
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

  public async start(): Promise<void> {
    try {
      // Initialize database connection
      await this.databaseManager.connect();
      this.logger.info('Database connected successfully');

      // Initialize contract manager if available
      if (this.contractManager) {
        this.contractManager.startEventListeners();
        this.logger.info('Contract event listeners started');
      }

      // Start server with explicit IPv4 binding  
      const port = Number(process.env.PORT) || 3001;
      
      // Force IPv4 binding with numeric IP
      this.server.listen(port, '0.0.0.0', () => {
        this.logger.info(`Matching Engine Server started on 0.0.0.0:${port}`);
        this.logger.info(`WebSocket server ready for connections`);
        
        if (this.contractManager) {
          this.logger.info(`Blockchain integration enabled`);
        } else {
          this.logger.info(`Running in off-chain mode`);
        }
        
        // Debug actual binding
        const address = this.server.address();
        this.logger.info(`Server actually bound to:`, address);
      });

      // Initialize WebSocket manager
      this.wsManager.initialize();

    } catch (error) {
      this.logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  private async gracefulShutdown(signal: string): Promise<void> {
    this.logger.info(`Received ${signal}, starting graceful shutdown...`);

    try {
      // Close server
      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server.close(() => {
            this.logger.info('HTTP server closed');
            resolve();
          });
        });
      }

      // Close WebSocket connections
      if (this.wsManager) {
        await this.wsManager.close();
        this.logger.info('WebSocket connections closed');
      }

      // Close database connection
      if (this.databaseManager) {
        await this.databaseManager.disconnect();
        this.logger.info('Database connection closed');
      }

      this.logger.info('Graceful shutdown completed');
      process.exit(0);

    } catch (error) {
      this.logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }

  public getApp(): express.Application {
    return this.app;
  }

  public getServer(): any {
    return this.server;
  }

  public getOrderBookManager(): OrderBookManager {
    return this.orderBookManager;
  }
}

// Start server if this file is run directly
if (require.main === module) {
  const server = new MatchingEngineServer();
  server.start().catch((error) => {
    console.error('Failed to start matching engine server:', error);
    process.exit(1);
  });
}
