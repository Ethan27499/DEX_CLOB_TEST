import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import Joi from 'joi';
import { OrderBookManager } from './orderbook';
import { DatabaseManager } from './database';
import { ContractManager } from './contract-manager';
import { Order, Trade } from '../../shared/types';
import { CryptoUtils, ValidationUtils } from '../../shared/utils';
import { RATE_LIMITS, ORDER_STATUS, TRADING_PAIRS } from '../../shared/constants';
import { Logger } from './logger';

export class APIRouter {
  private router: Router;
  private orderBookManager: OrderBookManager;
  private databaseManager: DatabaseManager;
  private contractManager?: ContractManager;
  private logger: Logger;

  constructor(
    orderBookManager: OrderBookManager, 
    databaseManager: DatabaseManager,
    contractManager?: ContractManager
  ) {
    this.router = Router();
    this.orderBookManager = orderBookManager;
    this.databaseManager = databaseManager;
    this.contractManager = contractManager;
    this.logger = new Logger('APIRouter');
    
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Order routes
    this.router.post('/orders', this.createOrderRateLimit(), this.placeOrder.bind(this));
    this.router.delete('/orders/:id/cancel', this.cancelOrderRateLimit(), this.cancelOrder.bind(this));
    this.router.get('/orders', this.getOrders.bind(this));
    this.router.get('/orders/:id', this.getOrder.bind(this));

    // Contract integration routes
    if (this.contractManager) {
      this.router.get('/contract/stats', this.getContractStats.bind(this));
      this.router.post('/orders/validate', this.validateOrderOnChain.bind(this));
    }

    // Development/testing routes
    this.router.post('/dev/seed-orderbook', this.seedOrderbook.bind(this));

    // Trade routes
    this.router.get('/trades', this.getTrades.bind(this));
    this.router.get('/users/:userId/trades', this.getUserTrades.bind(this));

    // Orderbook routes
    this.router.get('/orderbook/:base/:quote', this.getOrderbook.bind(this));
    this.router.get('/orderbook/:base/:quote/depth', this.getOrderbookDepth.bind(this));
    this.router.get('/orderbook/:base/:quote/trades', this.getOrderbookTrades.bind(this));

    // Market data routes
    this.router.get('/market-data', this.getMarketData.bind(this));
    this.router.get('/market-data/:pair', this.getPairData.bind(this));

    // Batch routes
    this.router.get('/batches', this.getBatches.bind(this));
    this.router.get('/batches/:id', this.getBatch.bind(this));
  }

  private createOrderRateLimit() {
    return rateLimit({
      windowMs: RATE_LIMITS.PLACE_ORDER.windowMs,
      max: RATE_LIMITS.PLACE_ORDER.max,
      message: 'Too many order placements. Please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
    });
  }

  private cancelOrderRateLimit() {
    return rateLimit({
      windowMs: RATE_LIMITS.CANCEL_ORDER.windowMs,
      max: RATE_LIMITS.CANCEL_ORDER.max,
      message: 'Too many order cancellations. Please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
    });
  }

  private async placeOrder(req: Request, res: Response): Promise<void> {
    try {
      // Validate request body
      const orderSchema = Joi.object({
        userId: Joi.string().required(),
        pair: Joi.string().valid(...TRADING_PAIRS).required(),
        side: Joi.string().valid('buy', 'sell').required(),
        type: Joi.string().valid('limit', 'market').required(),
        price: Joi.string().required(),
        amount: Joi.string().required(),
        nonce: Joi.number().integer().required(),
        signature: Joi.string().required(),
        chainId: Joi.number().integer().required(),
        expiresAt: Joi.number().integer().optional(),
      });

      const { error, value } = orderSchema.validate(req.body);
      if (error) {
        res.status(400).json({
          error: 'Validation Error',
          message: error.details[0].message,
        });
        return;
      }

      // Additional validation
      if (!ValidationUtils.isValidAddress(value.userId)) {
        res.status(400).json({
          error: 'Invalid address format',
          message: 'userId must be a valid Ethereum address',
        });
        return;
      }

      if (!ValidationUtils.isValidAmount(value.amount)) {
        res.status(400).json({
          error: 'Invalid amount',
          message: 'Amount must be a positive number',
        });
        return;
      }

      if (!ValidationUtils.isValidPrice(value.price)) {
        res.status(400).json({
          error: 'Invalid price',
          message: 'Price must be a positive number',
        });
        return;
      }

      // Create order object
      const order: Order = {
        id: CryptoUtils.generateOrderId(),
        userId: value.userId,
        pair: value.pair,
        side: value.side,
        type: value.type,
        price: value.price,
        amount: value.amount,
        filled: '0',
        remaining: value.amount,
        status: ORDER_STATUS.PENDING,
        timestamp: Date.now(),
        nonce: value.nonce,
        signature: value.signature,
        chainId: value.chainId,
        expiresAt: value.expiresAt,
      };

      // Verify signature
      if (!CryptoUtils.verifyOrderSignature(order)) {
        res.status(401).json({
          error: 'Invalid signature',
          message: 'Order signature verification failed',
        });
        return;
      }

      // Add order to matching engine
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

    } catch (error) {
      this.logger.error('Error placing order:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to place order',
      });
    }
  }

  private async cancelOrder(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { userId } = req.body;

      if (!userId || !ValidationUtils.isValidAddress(userId)) {
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
      } else {
        res.status(404).json({
          error: 'Order not found',
          message: 'Order not found or cannot be cancelled',
        });
      }

    } catch (error) {
      this.logger.error('Error cancelling order:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to cancel order',
      });
    }
  }

  private async getOrders(req: Request, res: Response): Promise<void> {
    try {
      const { userId, status, pair, limit = '50', offset = '0' } = req.query;

      if (userId) {
        const orders = await this.databaseManager.getUserOrders(
          String(userId),
          parseInt(String(limit)),
          parseInt(String(offset))
        );
        res.json({ orders });
      } else {
        // For now, return empty array. In production, you might want to implement
        // a global orders endpoint with proper pagination and filtering
        res.json({ orders: [] });
      }

    } catch (error) {
      this.logger.error('Error fetching orders:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch orders',
      });
    }
  }

  private async getOrder(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const order = await this.databaseManager.getOrder(id);

      if (order) {
        res.json({ order });
      } else {
        res.status(404).json({
          error: 'Order not found',
          message: 'Order with specified ID does not exist',
        });
      }

    } catch (error) {
      this.logger.error('Error fetching order:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch order',
      });
    }
  }

  private async getTrades(req: Request, res: Response): Promise<void> {
    try {
      const { pair, limit = '50', page = '1' } = req.query;
      
      const trades = await this.databaseManager.getTrades(
        pair ? String(pair) : undefined,
        parseInt(String(limit)),
        parseInt(String(page))
      );

      res.json({ trades });

    } catch (error) {
      this.logger.error('Error fetching trades:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch trades',
      });
    }
  }

  private async getUserTrades(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const { limit = '50', offset = '0' } = req.query;

      // This would require a more complex query in the database
      // For now, return empty array
      res.json({ trades: [] });

    } catch (error) {
      this.logger.error('Error fetching user trades:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch user trades',
      });
    }
  }

  private async getOrderbook(req: Request, res: Response): Promise<void> {
    try {
      const { base, quote } = req.params;
      const pair = `${base}/${quote}`;

      if (!TRADING_PAIRS.includes(pair as any)) {
        res.status(400).json({
          error: 'Invalid trading pair',
          message: `Supported pairs: ${TRADING_PAIRS.join(', ')}`,
        });
        return;
      }

      const orderbook = this.orderBookManager.getOrderBook(pair);

      if (orderbook) {
        res.json({ orderbook });
      } else {
        res.json({
          orderbook: {
            pair,
            bids: [],
            asks: [],
            lastUpdate: Date.now(),
          }
        });
      }

    } catch (error) {
      this.logger.error('Error fetching orderbook:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch orderbook',
      });
    }
  }

  private async getMarketData(req: Request, res: Response): Promise<void> {
    try {
      // This would typically fetch from a market data service
      // For now, return mock data
      const marketData = TRADING_PAIRS.map(pair => ({
        pair,
        lastPrice: '0',
        priceChange24h: '0',
        volume24h: '0',
        high24h: '0',
        low24h: '0',
        timestamp: Date.now(),
      }));

      res.json({ marketData });

    } catch (error) {
      this.logger.error('Error fetching market data:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch market data',
      });
    }
  }

  private async getPairData(req: Request, res: Response): Promise<void> {
    try {
      const { pair } = req.params;

      if (!TRADING_PAIRS.includes(pair as any)) {
        res.status(400).json({
          error: 'Invalid trading pair',
          message: `Supported pairs: ${TRADING_PAIRS.join(', ')}`,
        });
        return;
      }

      // Mock data for now
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

    } catch (error) {
      this.logger.error('Error fetching pair data:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch pair data',
      });
    }
  }

  private async getBatches(req: Request, res: Response): Promise<void> {
    try {
      // This would fetch batches from database
      // For now, return empty array
      res.json({ batches: [] });

    } catch (error) {
      this.logger.error('Error fetching batches:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch batches',
      });
    }
  }

  private async getBatch(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      // This would fetch specific batch from database
      res.status(404).json({
        error: 'Batch not found',
        message: 'Batch with specified ID does not exist',
      });

    } catch (error) {
      this.logger.error('Error fetching batch:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch batch',
      });
    }
  }

  // Contract integration methods
  private async getContractStats(req: Request, res: Response): Promise<void> {
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

    } catch (error) {
      this.logger.error('Error fetching contract stats:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch contract statistics'
      });
    }
  }

  private async validateOrderOnChain(req: Request, res: Response): Promise<void> {
    try {
      if (!this.contractManager) {
        res.status(503).json({
          error: 'Contract integration not available',
          message: 'Blockchain integration is not configured'
        });
        return;
      }

      // Simple validation - reuse existing schema if available
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

    } catch (error) {
      this.logger.error('Error validating order on-chain:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to validate order on blockchain'
      });
    }
  }

  // New OrderBook endpoints
  private async getOrderbookDepth(req: Request, res: Response): Promise<void> {
    try {
      const { base, quote } = req.params;
      const pair = `${base}/${quote}`;
      const depth = parseInt(req.query.depth as string) || 20; // Default 20 levels

      if (!TRADING_PAIRS.includes(pair as any)) {
        res.status(400).json({
          error: 'Invalid trading pair',
          message: `Supported pairs: ${TRADING_PAIRS.join(', ')}`,
        });
        return;
      }

      const orderbook = this.orderBookManager.getOrderBook(pair);

      if (orderbook) {
        // Limit depth to requested number of levels
        const bids = orderbook.bids.slice(0, depth);
        const asks = orderbook.asks.slice(0, depth);

        res.json({
          pair,
          bids,
          asks,
          depth,
          lastUpdate: orderbook.lastUpdate,
        });
      } else {
        res.json({
          pair,
          bids: [],
          asks: [],
          depth,
          lastUpdate: Date.now(),
        });
      }

    } catch (error) {
      this.logger.error('Error fetching orderbook depth:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch orderbook depth',
      });
    }
  }

  private async getOrderbookTrades(req: Request, res: Response): Promise<void> {
    try {
      const { base, quote } = req.params;
      const pair = `${base}/${quote}`;
      const limit = parseInt(req.query.limit as string) || 50; // Default 50 trades

      if (!TRADING_PAIRS.includes(pair as any)) {
        res.status(400).json({
          error: 'Invalid trading pair',
          message: `Supported pairs: ${TRADING_PAIRS.join(', ')}`,
        });
        return;
      }

      // Get recent trades for this pair from database
      const trades = await this.databaseManager.getTrades(
        pair,
        limit,
        parseInt(req.query.page as string) || 1
      );

      res.json({
        pair,
        trades,
        limit,
      });

    } catch (error) {
      this.logger.error('Error fetching orderbook trades:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch orderbook trades',
      });
    }
  }

  // Development/testing methods
  private async seedOrderbook(req: Request, res: Response): Promise<void> {
    try {
      const pair = 'ETH/USDC';
      
      // First, create test users
      const testUsers = [
        'test_user_1', 'test_user_2', 'test_user_3', 
        'test_user_4', 'test_user_5', 'test_user_6'
      ];
      
      for (const userId of testUsers) {
        await this.databaseManager.saveUser({
          id: userId,
          address: userId, // In real scenario, this would be actual wallet address
          nonce: 0,
          isActive: true,
          createdAt: Date.now(),
          lastActivity: Date.now()
        });
      }
      
      // Create sample buy orders (bids)
      const timestamp = Date.now();
      const buyOrders = [
        {
          id: `buy_${timestamp}_1`,
          userId: 'test_user_1',
          pair,
          side: 'buy',
          type: 'limit',
          price: '2000',
          amount: '1.5',
          filled: '0',
          remaining: '1.5',
          status: 'pending',
          timestamp: timestamp - 5000,
          nonce: 1,
          signature: 'test_signature_1',
          chainId: 31337,
        },
        {
          id: `buy_${timestamp}_2`,
          userId: 'test_user_2',
          pair,
          side: 'buy',
          type: 'limit',
          price: '1999',
          amount: '2.0',
          filled: '0',
          remaining: '2.0',
          status: 'pending',
          timestamp: timestamp - 4000,
          nonce: 1,
          signature: 'test_signature_2',
          chainId: 31337,
        },
        {
          id: `buy_${timestamp}_3`,
          userId: 'test_user_3',
          pair,
          side: 'buy',
          type: 'limit',
          price: '1998',
          amount: '0.5',
          filled: '0',
          remaining: '0.5',
          status: 'pending',
          timestamp: timestamp - 3000,
          nonce: 1,
          signature: 'test_signature_3',
          chainId: 31337,
        }
      ];

      // Create sample sell orders (asks)
      const sellOrders = [
        {
          id: `sell_${timestamp}_1`,
          userId: 'test_user_4',
          pair,
          side: 'sell',
          type: 'limit',
          price: '2002',
          amount: '1.0',
          filled: '0',
          remaining: '1.0',
          status: 'pending',
          timestamp: timestamp - 2000,
          nonce: 1,
          signature: 'test_signature_4',
          chainId: 31337,
        },
        {
          id: `sell_${timestamp}_2`,
          userId: 'test_user_5',
          pair,
          side: 'sell',
          type: 'limit',
          price: '2003',
          amount: '2.5',
          filled: '0',
          remaining: '2.5',
          status: 'pending',
          timestamp: timestamp - 1000,
          nonce: 1,
          signature: 'test_signature_5',
          chainId: 31337,
        },
        {
          id: `sell_${timestamp}_3`,
          userId: 'test_user_6',
          pair,
          side: 'sell',
          type: 'limit',
          price: '2004',
          amount: '1.8',
          filled: '0',
          remaining: '1.8',
          status: 'pending',
          timestamp: timestamp,
          nonce: 1,
          signature: 'test_signature_6',
          chainId: 31337,
        }
      ];

      // Add orders to order book
      const allOrders = [...buyOrders, ...sellOrders];
      for (const order of allOrders) {
        this.orderBookManager.addOrder(order as Order);
      }

      res.json({
        success: true,
        message: 'OrderBook seeded with sample data',
        pair,
        ordersAdded: allOrders.length,
        buyOrders: buyOrders.length,
        sellOrders: sellOrders.length,
      });

    } catch (error) {
      this.logger.error('Error seeding orderbook:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to seed orderbook',
      });
    }
  }

  public getRouter(): Router {
    return this.router;
  }
}
