import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { ethers } from 'ethers';

import { VaultManager } from './vault-manager';
import { PostgresDatabaseManager } from './database';
import { CollateralTracker } from './collateral-tracker';
import { RiskManager } from './risk-manager';
import { OraclePriceService } from './oracle-price-service';
import { Logger } from './logger';

// Load environment variables
dotenv.config();

export class VaultServer {
  private app: express.Application;
  private server: any;
  private vaultManager: VaultManager;
  private databaseManager: PostgresDatabaseManager;
  private collateralTracker: CollateralTracker;
  private riskManager: RiskManager;
  private oraclePriceService: OraclePriceService;
  private logger: Logger;
  private provider: ethers.Provider;

  constructor() {
    this.app = express();
    this.logger = new Logger('VaultServer');
    
    // Initialize REAL provider - connects to actual blockchain
    const rpcUrl = process.env.RPC_URL || 'https://ethereum.publicnode.com'; // Use mainnet public RPC
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    
    // Initialize Oracle Price Service
    this.oraclePriceService = new OraclePriceService(this.provider);
    
    // Initialize dependencies with REAL database
    this.databaseManager = new PostgresDatabaseManager();
    this.collateralTracker = new CollateralTracker();
    this.riskManager = new RiskManager();
    
    // Initialize VaultManager
    this.vaultManager = new VaultManager(
      this.provider,
      this.databaseManager,
      this.collateralTracker,
      this.riskManager
    );
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet());
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true,
    }));

    // Performance middleware
    this.app.use(compression());

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP',
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use(limiter);

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

    // Vault operations
    this.app.post('/api/v1/vault/deposit', this.deposit.bind(this));
    this.app.post('/api/v1/vault/withdraw', this.withdraw.bind(this));
    this.app.post('/api/v1/vault/borrow', this.borrow.bind(this));
    this.app.post('/api/v1/vault/repay', this.repay.bind(this));

    // Position management
    this.app.get('/api/v1/vault/position/:userAddress', this.getUserPosition.bind(this));
    this.app.get('/api/v1/vault/balance/:userAddress/:token', this.getUserBalance.bind(this));
    this.app.get('/api/v1/vault/health/:userAddress', this.getHealthFactor.bind(this));

    // Risk management
    this.app.get('/api/v1/vault/liquidatable', this.getLiquidatablePositions.bind(this));
    this.app.post('/api/v1/vault/liquidate', this.liquidatePosition.bind(this));

    // Analytics
    this.app.get('/api/v1/vault/stats', this.getVaultStats.bind(this));
    this.app.get('/api/v1/vault/supported-tokens', this.getSupportedTokens.bind(this));
    
    // Oracle price endpoints
    this.app.get('/api/v1/oracle/price/:symbol', this.getOraclePrice.bind(this));
    this.app.get('/api/v1/oracle/prices', this.getOraclePrices.bind(this));
    this.app.post('/api/v1/oracle/validate-price', this.validatePrice.bind(this));

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

  // =============================================================================
  // VAULT OPERATIONS
  // =============================================================================

  private async deposit(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { userAddress, token, amount, signature } = req.body;

      // Validate input
      if (!userAddress || !token || !amount || !signature) {
        res.status(400).json({
          error: 'Missing required fields',
          message: 'userAddress, token, amount, and signature are required'
        });
        return;
      }

      // Process deposit
      const result = await this.vaultManager.processDeposit({
        userAddress,
        token,
        amount,
        signature,
        timestamp: Date.now()
      });

      res.json({
        success: true,
        transaction: result,
        message: 'Deposit processed successfully'
      });

    } catch (error) {
      this.logger.error('Error processing deposit:', error);
      res.status(500).json({
        error: 'Deposit failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async withdraw(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { userAddress, token, amount, signature } = req.body;

      // Validate input
      if (!userAddress || !token || !amount || !signature) {
        res.status(400).json({
          error: 'Missing required fields',
          message: 'userAddress, token, amount, and signature are required'
        });
        return;
      }

      // Process withdrawal
      const result = await this.vaultManager.processWithdrawal({
        userAddress,
        token,
        amount,
        signature,
        timestamp: Date.now()
      });

      res.json({
        success: true,
        transaction: result,
        message: 'Withdrawal processed successfully'
      });

    } catch (error) {
      this.logger.error('Error processing withdrawal:', error);
      res.status(500).json({
        error: 'Withdrawal failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async borrow(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { userAddress, token, amount, signature } = req.body;

      // Process borrow
      const result = await this.vaultManager.processBorrow({
        userAddress,
        token,
        amount,
        signature,
        timestamp: Date.now()
      });

      res.json({
        success: true,
        transaction: result,
        message: 'Borrow processed successfully'
      });

    } catch (error) {
      this.logger.error('Error processing borrow:', error);
      res.status(500).json({
        error: 'Borrow failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async repay(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { userAddress, token, amount, signature } = req.body;

      // Process repayment
      const result = await this.vaultManager.processRepayment({
        userAddress,
        token,
        amount,
        signature,
        timestamp: Date.now()
      });

      res.json({
        success: true,
        transaction: result,
        message: 'Repayment processed successfully'
      });

    } catch (error) {
      this.logger.error('Error processing repayment:', error);
      res.status(500).json({
        error: 'Repayment failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // POSITION QUERIES
  // =============================================================================

  private async getUserPosition(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { userAddress } = req.params;

      const position = await this.vaultManager.getUserPosition(userAddress);

      res.json({
        success: true,
        position
      });

    } catch (error) {
      this.logger.error('Error getting user position:', error);
      res.status(500).json({
        error: 'Failed to get position',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async getUserBalance(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { userAddress, token } = req.params;

      const balance = await this.vaultManager.getUserBalance(userAddress, token);

      res.json({
        success: true,
        balance
      });

    } catch (error) {
      this.logger.error('Error getting user balance:', error);
      res.status(500).json({
        error: 'Failed to get balance',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async getHealthFactor(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { userAddress } = req.params;

      const healthFactor = await this.riskManager.calculateHealthFactor(userAddress);

      res.json({
        success: true,
        healthFactor,
        isLiquidatable: healthFactor < 1.05 // 105% threshold
      });

    } catch (error) {
      this.logger.error('Error calculating health factor:', error);
      res.status(500).json({
        error: 'Failed to calculate health factor',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // RISK MANAGEMENT
  // =============================================================================

  private async getLiquidatablePositions(req: express.Request, res: express.Response): Promise<void> {
    try {
      const positions = await this.riskManager.getLiquidationCandidates();

      res.json({
        success: true,
        positions,
        count: positions.length
      });

    } catch (error) {
      this.logger.error('Error getting liquidatable positions:', error);
      res.status(500).json({
        error: 'Failed to get liquidatable positions',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async liquidatePosition(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { 
        userAddress, 
        debtToken, 
        collateralToken, 
        debtAmount,
        liquidatorAddress,
        signature 
      } = req.body;

      const result = await this.vaultManager.processLiquidation({
        userAddress,
        token: debtToken, // Use debtToken as the main token
        amount: debtAmount, // Use debtAmount as the main amount
        debtToken,
        collateralToken,
        debtAmount,
        liquidatorAddress,
        signature,
        timestamp: Date.now()
      });

      res.json({
        success: true,
        transaction: result,
        message: 'Liquidation processed successfully'
      });

    } catch (error) {
      this.logger.error('Error processing liquidation:', error);
      res.status(500).json({
        error: 'Liquidation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // ANALYTICS
  // =============================================================================

  private async getVaultStats(req: express.Request, res: express.Response): Promise<void> {
    try {
      const stats = await this.vaultManager.getVaultStatistics();

      res.json({
        success: true,
        stats
      });

    } catch (error) {
      this.logger.error('Error getting vault stats:', error);
      res.status(500).json({
        error: 'Failed to get vault statistics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // ORACLE PRICE ENDPOINTS
  // =============================================================================

  private async getOraclePrice(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { symbol } = req.params;
      
      if (!symbol) {
        res.status(400).json({
          error: 'Missing symbol parameter'
        });
        return;
      }

      const price = await this.oraclePriceService.getPrice(symbol.toUpperCase());

      res.json({
        success: true,
        symbol: symbol.toUpperCase(),
        price: price.price,
        confidence: price.confidence,
        timestamp: price.timestamp,
        source: price.source,
        priceDecimals: price.priceDecimals,
        tokenDecimals: price.tokenDecimals
      });

    } catch (error) {
      this.logger.error(`Error getting oracle price for ${req.params.symbol}:`, error);
      res.status(500).json({
        error: 'Failed to get oracle price',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async getOraclePrices(req: express.Request, res: express.Response): Promise<void> {
    try {
      const symbols = req.query.symbols as string;
      
      if (!symbols) {
        res.status(400).json({
          error: 'Missing symbols query parameter'
        });
        return;
      }

      const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());
      const prices = await this.oraclePriceService.getPrices(symbolList);

      const result: Record<string, any> = {};
      for (const [symbol, priceData] of prices) {
        result[symbol] = {
          price: priceData.price,
          confidence: priceData.confidence,
          timestamp: priceData.timestamp,
          source: priceData.source,
          priceDecimals: priceData.priceDecimals,
          tokenDecimals: priceData.tokenDecimals
        };
      }

      res.json({
        success: true,
        prices: result,
        count: prices.size
      });

    } catch (error) {
      this.logger.error('Error getting oracle prices:', error);
      res.status(500).json({
        error: 'Failed to get oracle prices',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async validatePrice(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { symbol, externalPrice } = req.body;
      
      if (!symbol || !externalPrice) {
        res.status(400).json({
          error: 'Missing required fields',
          message: 'symbol and externalPrice are required'
        });
        return;
      }

      const isValid = await this.oraclePriceService.validatePriceDeviation(
        symbol.toUpperCase(), 
        parseFloat(externalPrice)
      );

      res.json({
        success: true,
        symbol: symbol.toUpperCase(),
        externalPrice: parseFloat(externalPrice),
        isValid,
        message: isValid ? 'Price is within acceptable range' : 'Price deviation too high'
      });

    } catch (error) {
      this.logger.error('Error validating price:', error);
      res.status(500).json({
        error: 'Failed to validate price',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async getSupportedTokens(req: express.Request, res: express.Response): Promise<void> {
    try {
      const tokens = await this.vaultManager.getSupportedTokens();

      res.json({
        success: true,
        tokens
      });

    } catch (error) {
      this.logger.error('Error getting supported tokens:', error);
      res.status(500).json({
        error: 'Failed to get supported tokens',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // =============================================================================
  // SERVER LIFECYCLE
  // =============================================================================

  public async start(): Promise<void> {
    try {
      // Connect to database
      // Connect to REAL database
      await this.databaseManager.connect();
      this.logger.info('Database connected successfully');

      // Initialize Oracle Price Service
      await this.oraclePriceService.initialize();
      this.logger.info('Oracle Price Service initialized');

      // Initialize collateral tracker with database and oracle service
      await this.collateralTracker.initialize(this.databaseManager, this.oraclePriceService);

      // Initialize vault manager
      await this.vaultManager.initialize();
      this.logger.info('Vault manager initialized');

      // Start server
      const port = process.env.VAULT_PORT || 3003;
      this.server = this.app.listen(port, () => {
        this.logger.info(`Vault Server started on port ${port}`);
      });

      // Setup graceful shutdown
      this.setupGracefulShutdown();

    } catch (error) {
      this.logger.error('Failed to start vault server:', error);
      throw error;
    }
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      this.logger.info(`Received ${signal}, starting graceful shutdown...`);

      if (this.server) {
        this.server.close(() => {
          this.logger.info('HTTP server closed');
        });
      }

      try {
        // Disconnect from REAL database
        await this.databaseManager.disconnect();
        this.logger.info('Database connection closed');
      } catch (error) {
        this.logger.error('Error closing database connection:', error);
      }

      this.logger.info('Graceful shutdown completed');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }
}

// Start server if this file is run directly
if (require.main === module) {
  const server = new VaultServer();
  server.start().catch(error => {
    console.error('Failed to start vault server:', error);
    process.exit(1);
  });
}
