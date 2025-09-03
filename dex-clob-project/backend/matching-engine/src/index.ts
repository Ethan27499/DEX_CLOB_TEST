import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import Joi from 'joi';

import { OrderBookManager } from './orderbook';
import { InMemoryDatabaseManager } from './database-memory';
import { IDatabaseManager } from './database-interface';
import { WebSocketManager } from './websocket';
import { APIRouter } from './routes';
import { Logger } from './logger';
import { ContractManager, ContractConfig } from './contract-manager';
import { MockContractManager } from './contract-manager-mock';
import { RATE_LIMITS } from '../../shared/constants';

// Load environment variables
dotenv.config();

// Simple types for enhanced security
interface AuthenticatedRequest extends express.Request {
  user?: {
    id: string;
    address: string;
    role: 'user' | 'admin';
    permissions: string[];
  };
  sessionId?: string;
}

// Simple security middleware placeholders
const setupSecurity = () => [
  helmet(),
  compression()
];

const corsConfig = {
  origin: "*",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
};

const optionalAuth = (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  // Simple placeholder - in production would check JWT/session
  next();
};

const ipRateLimit = (maxRequests: number, windowMs: number) => {
  return rateLimit({
    windowMs,
    max: maxRequests,
    message: 'IP rate limit exceeded'
  });
};

const burstProtection = (short: any, long: any) => {
  return rateLimit({
    windowMs: short.window,
    max: short.requests,
    message: 'Burst protection triggered'
  });
};

class SecurityMonitor {
  private static instance: SecurityMonitor;
  private alerts: any[] = [];
  
  static getInstance() {
    if (!SecurityMonitor.instance) {
      SecurityMonitor.instance = new SecurityMonitor();
    }
    return SecurityMonitor.instance;
  }
  
  getRecentAlerts(minutes: number) {
    return this.alerts.slice(-10); // Return last 10 alerts
  }
  
  addAlert(type: string, message: string, ip: string) {
    this.alerts.push({ type, message, ip, timestamp: new Date() });
  }
}

export class MatchingEngineServer {
  private app: express.Application;
  private server: any;
  private io: SocketIOServer;
  private orderBookManager: OrderBookManager;
  private databaseManager: IDatabaseManager;
  private wsManager: WebSocketManager;
  private contractManager: ContractManager | MockContractManager;
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
    
    // Use real database now
    this.databaseManager = new InMemoryDatabaseManager();
    
    // Use mock contract manager for now (until we setup real blockchain)
    if (this.isBlockchainEnabled()) {
      const contractConfig = this.getContractConfig();
      this.contractManager = new MockContractManager(contractConfig, this.databaseManager);
    } else {
      // Create a minimal mock config for off-chain mode
      const mockConfig: ContractConfig = {
        hybridCLOBAddress: '0x0000000000000000000000000000000000000000',
        tokens: { 
          BASE: '0x0000000000000000000000000000000000000000', 
          QUOTE: '0x0000000000000000000000000000000000000000'
        },
        rpcUrl: 'http://localhost:8545',
        privateKey: '0x0000000000000000000000000000000000000000000000000000000000000000',
        chainId: 31337
      };
      this.contractManager = new MockContractManager(mockConfig, this.databaseManager);
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

  private isDatabaseEnabled(): boolean {
    return !!(
      process.env.POSTGRES_HOST && 
      process.env.POSTGRES_USER && 
      process.env.POSTGRES_PASSWORD
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
    // Apply comprehensive security middleware
    const securityMiddleware = setupSecurity();
    securityMiddleware.forEach(middleware => {
      this.app.use(middleware);
    });

    // Enhanced CORS configuration
    this.app.use(cors(corsConfig));
    
    // Compression middleware
    this.app.use(compression());

    // IP-based rate limiting for public endpoints
    this.app.use('/api/public/', ipRateLimit(200, 60 * 1000)); // 200 requests per minute

    // Global rate limiting with burst protection
    this.app.use('/api/', burstProtection(
      { requests: 50, window: 10 * 1000 }, // 50 requests per 10 seconds (burst)
      { requests: 1000, window: 60 * 1000 } // 1000 requests per minute (sustained)
    ));

    // Body parsing with size limits
    this.app.use(express.json({ 
      limit: '10mb',
      verify: (req: any, res, buf) => {
        // Store raw body for signature verification
        req.rawBody = buf;
      }
    }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Security monitoring
    this.app.use((req: AuthenticatedRequest, res, next) => {
      const monitor = SecurityMonitor.getInstance();
      
      // Track suspicious activity
      const suspiciousHeaders = [
        'x-forwarded-for',
        'x-real-ip',
        'x-cluster-client-ip'
      ];
      
      const hasMultipleIPs = suspiciousHeaders.some(header => 
        req.headers[header] && req.headers[header] !== req.ip
      );
      
      if (hasMultipleIPs) {
        monitor.addAlert('WARNING', 'Multiple IP headers detected', req.ip || 'unknown');
      }
      
      next();
    });

    // Request logging with enhanced security context
    this.app.use((req: AuthenticatedRequest, res, next) => {
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

  private setupRoutes(): void {
    // Public health check (no auth required)
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
      });
    });
    
    // API health check with optional auth context
    this.app.get('/api/health', optionalAuth, (req: AuthenticatedRequest, res) => {
      const monitor = SecurityMonitor.getInstance();
      const recentAlerts = monitor.getRecentAlerts(5); // Last 5 minutes
      
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

    // Authentication routes
    this.setupAuthRoutes();
    
    // Secure trading routes
    this.setupSecureTradingRoutes();
    
    // Public market data routes (with rate limiting)
    this.setupPublicRoutes();

    // Admin routes
    this.setupAdminRoutes();

    // API routes (legacy compatibility)
    const apiRouter = new APIRouter(
      this.orderBookManager, 
      this.databaseManager,
      this.contractManager
    );
    
    // Mount both /api and /api/v1 routes for backward compatibility
    this.app.use('/api', optionalAuth, apiRouter.getRouter());
    this.app.use('/api/v1', optionalAuth, apiRouter.getRouter());

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: 'The requested resource was not found',
        timestamp: new Date().toISOString()
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

  private setupAuthRoutes(): void {
    // Authentication implementation will be added here
    // This is a placeholder for the missing import dependencies
  }

  private setupSecureTradingRoutes(): void {
    // Secure trading routes implementation will be added here  
    // This is a placeholder for the missing import dependencies
  }

  private setupPublicRoutes(): void {
    // Public routes implementation will be added here
    // This is a placeholder for the missing import dependencies  
  }

  private setupAdminRoutes(): void {
    // Admin routes implementation will be added here
    // This is a placeholder for the missing import dependencies
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
      this.databaseManager.updateOrderStatus(order.id, order.status);
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
