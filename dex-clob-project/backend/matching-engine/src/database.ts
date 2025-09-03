import { Pool } from 'pg';
import { Order, Trade, User, Batch } from '../../shared/types';
import { Logger } from './logger';
import { IDatabaseManager } from './database-interface';

export class DatabaseManager implements IDatabaseManager {
  private pool: Pool;
  private logger: Logger;

  constructor() {
    this.logger = new Logger('DatabaseManager');
    this.pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'dex_matching_engine',
      user: process.env.POSTGRES_USER || 'dex_user',
      password: process.env.POSTGRES_PASSWORD || 'dex_password',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  public async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      
      await this.initializeTables();
      this.logger.info('Database connection established');
    } catch (error) {
      this.logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    await this.pool.end();
    this.logger.info('Database connection closed');
  }

  private async initializeTables(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Users table
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(42) PRIMARY KEY,
          address VARCHAR(42) UNIQUE NOT NULL,
          nonce INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT true,
          created_at BIGINT NOT NULL,
          last_activity BIGINT NOT NULL
        )
      `);

      // Orders table
      await client.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id VARCHAR(42) PRIMARY KEY,
          user_id VARCHAR(42) NOT NULL,
          pair VARCHAR(20) NOT NULL,
          side VARCHAR(10) NOT NULL,
          type VARCHAR(10) NOT NULL,
          price DECIMAL(36,18) NOT NULL,
          amount DECIMAL(36,18) NOT NULL,
          filled DECIMAL(36,18) DEFAULT 0,
          remaining DECIMAL(36,18) NOT NULL,
          status VARCHAR(20) NOT NULL,
          timestamp BIGINT NOT NULL,
          nonce INTEGER NOT NULL,
          signature TEXT NOT NULL,
          chain_id INTEGER NOT NULL,
          expires_at BIGINT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);

      // Trades table
      await client.query(`
        CREATE TABLE IF NOT EXISTS trades (
          id VARCHAR(42) PRIMARY KEY,
          order_id VARCHAR(42) NOT NULL,
          counter_order_id VARCHAR(42) NOT NULL,
          pair VARCHAR(20) NOT NULL,
          side VARCHAR(10) NOT NULL,
          price DECIMAL(36,18) NOT NULL,
          amount DECIMAL(36,18) NOT NULL,
          fee DECIMAL(36,18) NOT NULL,
          timestamp BIGINT NOT NULL,
          block_number BIGINT,
          tx_hash VARCHAR(66),
          chain_id INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (order_id) REFERENCES orders(id),
          FOREIGN KEY (counter_order_id) REFERENCES orders(id)
        )
      `);

      // Batches table
      await client.query(`
        CREATE TABLE IF NOT EXISTS batches (
          id VARCHAR(42) PRIMARY KEY,
          status VARCHAR(20) NOT NULL,
          chain_id INTEGER NOT NULL,
          tx_hash VARCHAR(66),
          block_number BIGINT,
          created_at BIGINT NOT NULL,
          submitted_at BIGINT,
          confirmed_at BIGINT,
          gas_used DECIMAL(36,18),
          gas_price DECIMAL(36,18),
          trade_count INTEGER DEFAULT 0
        )
      `);

      // Batch trades junction table
      await client.query(`
        CREATE TABLE IF NOT EXISTS batch_trades (
          batch_id VARCHAR(42) NOT NULL,
          trade_id VARCHAR(42) NOT NULL,
          PRIMARY KEY (batch_id, trade_id),
          FOREIGN KEY (batch_id) REFERENCES batches(id),
          FOREIGN KEY (trade_id) REFERENCES trades(id)
        )
      `);

      // Create indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
        CREATE INDEX IF NOT EXISTS idx_orders_pair ON orders(pair);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_orders_timestamp ON orders(timestamp);
        CREATE INDEX IF NOT EXISTS idx_orders_chain_id ON orders(chain_id);
        
        CREATE INDEX IF NOT EXISTS idx_trades_order_id ON trades(order_id);
        CREATE INDEX IF NOT EXISTS idx_trades_pair ON trades(pair);
        CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
        CREATE INDEX IF NOT EXISTS idx_trades_chain_id ON trades(chain_id);
        
        CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
        CREATE INDEX IF NOT EXISTS idx_batches_chain_id ON batches(chain_id);
        CREATE INDEX IF NOT EXISTS idx_batches_created_at ON batches(created_at);
      `);

      await client.query('COMMIT');
      this.logger.info('Database tables initialized');

    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to initialize database tables:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // User operations
  public async createUser(user: Omit<User, 'id' | 'createdAt' | 'lastActivity'>): Promise<User> {
    const newUser: User = {
      id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...user,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };
    
    await this.saveUser(newUser);
    return newUser;
  }

  public async saveUser(user: any): Promise<User> {
    const query = `
      INSERT INTO users (id, address, nonce, is_active, created_at, last_activity)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        nonce = EXCLUDED.nonce,
        is_active = EXCLUDED.is_active,
        last_activity = EXCLUDED.last_activity
      RETURNING *
    `;
    
    const result = await this.pool.query(query, [
      user.id,
      user.address,
      user.nonce || 0,
      user.isActive !== false,
      user.createdAt || Date.now(),
      user.lastActivity || Date.now(),
    ]);

    const row = result.rows[0];
    return {
      id: row.id,
      address: row.address,
      nonce: row.nonce,
      isActive: row.is_active,
      createdAt: row.created_at,
      lastActivity: row.last_activity,
    };
  }

  public async getUserByAddress(address: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE address = $1';
    const result = await this.pool.query(query, [address]);
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return {
      id: row.id,
      address: row.address,
      nonce: row.nonce,
      isActive: row.is_active,
      createdAt: row.created_at,
      lastActivity: row.last_activity,
    };
  }

  public async getUserById(id: string): Promise<User | null> {
    return this.getUser(id);
  }

  public async getUser(userId: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE id = $1';
    const result = await this.pool.query(query, [userId]);
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return {
      id: row.id,
      address: row.address,
      nonce: row.nonce,
      isActive: row.is_active,
      createdAt: row.created_at,
      lastActivity: row.last_activity,
    };
  }

  // Order operations
  public async saveOrder(order: Order): Promise<void> {
    const query = `
      INSERT INTO orders (
        id, user_id, pair, side, type, price, amount, filled, remaining,
        status, timestamp, nonce, signature, chain_id, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `;
    
    await this.pool.query(query, [
      order.id,
      order.userId,
      order.pair,
      order.side,
      order.type,
      order.price,
      order.amount,
      order.filled,
      order.remaining,
      order.status,
      order.timestamp,
      order.nonce,
      order.signature,
      order.chainId,
      order.expiresAt,
    ]);
  }

  public async updateOrder(order: Order): Promise<void> {
    const query = `
      UPDATE orders SET
        filled = $2,
        remaining = $3,
        status = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `;
    
    await this.pool.query(query, [
      order.id,
      order.filled,
      order.remaining,
      order.status,
    ]);
  }

  public async getOrder(orderId: string): Promise<Order | null> {
    const query = 'SELECT * FROM orders WHERE id = $1';
    const result = await this.pool.query(query, [orderId]);
    
    if (result.rows.length === 0) return null;
    
    return this.mapRowToOrder(result.rows[0]);
  }

  public async getOrderById(orderId: string): Promise<Order | null> {
    return this.getOrder(orderId);
  }

  public async getOrdersByUser(userId: string): Promise<Order[]> {
    const query = `
      SELECT * FROM orders 
      WHERE user_id = $1 
      ORDER BY timestamp DESC
    `;
    
    const result = await this.pool.query(query, [userId]);
    return result.rows.map((row: any) => this.mapRowToOrder(row));
  }

  public async getOrdersByPair(pair: string): Promise<Order[]> {
    const query = `
      SELECT * FROM orders 
      WHERE pair = $1 AND status IN ('pending', 'partial')
      ORDER BY timestamp DESC
    `;
    
    const result = await this.pool.query(query, [pair]);
    return result.rows.map((row: any) => this.mapRowToOrder(row));
  }

  public async updateOrderStatus(orderId: string, status: Order['status'], filledAmount?: string): Promise<void> {
    let query = `
      UPDATE orders SET
        status = $2,
        updated_at = CURRENT_TIMESTAMP
    `;
    let params = [orderId, status];

    if (filledAmount) {
      query += `, filled = $3`;
      params.push(filledAmount);
    }

    query += ` WHERE id = $1`;
    
    await this.pool.query(query, params);
  }

  public async getUserOrders(userId: string, limit: number = 50, offset: number = 0): Promise<Order[]> {
    const query = `
      SELECT * FROM orders 
      WHERE user_id = $1 
      ORDER BY timestamp DESC 
      LIMIT $2 OFFSET $3
    `;
    
    const result = await this.pool.query(query, [userId, limit, offset]);
    return result.rows.map((row: any) => this.mapRowToOrder(row));
  }

  // Trade operations
  public async saveTrade(trade: Trade): Promise<void> {
    const query = `
      INSERT INTO trades (
        id, order_id, counter_order_id, pair, side, price, amount, fee,
        timestamp, block_number, tx_hash, chain_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `;
    
    await this.pool.query(query, [
      trade.id,
      trade.orderId,
      trade.counterOrderId,
      trade.pair,
      trade.side,
      trade.price,
      trade.amount,
      trade.fee,
      trade.timestamp,
      trade.blockNumber,
      trade.txHash,
      trade.chainId,
    ]);
  }

  public async getTrades(pair?: string, limit: number = 50, page: number = 1): Promise<Trade[]> {
    let query = 'SELECT * FROM trades';
    const params: any[] = [];
    
    if (pair) {
      query += ' WHERE pair = $1';
      params.push(pair);
    }
    
    const offset = (page - 1) * limit;
    query += ' ORDER BY timestamp DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);
    
    const result = await this.pool.query(query, params);
    return result.rows.map((row: any) => this.mapRowToTrade(row));
  }

  public async getTradesByPair(pair: string, limit: number = 50): Promise<Trade[]> {
    const query = `
      SELECT * FROM trades 
      WHERE pair = $1 
      ORDER BY timestamp DESC 
      LIMIT $2
    `;
    
    const result = await this.pool.query(query, [pair, limit]);
    return result.rows.map((row: any) => this.mapRowToTrade(row));
  }

  public async getTradesByUser(userId: string): Promise<Trade[]> {
    // Join with orders to find trades by user
    const query = `
      SELECT t.* FROM trades t
      JOIN orders o ON (t.order_id = o.id OR t.counter_order_id = o.id)
      WHERE o.user_id = $1
      ORDER BY t.timestamp DESC
    `;
    
    const result = await this.pool.query(query, [userId]);
    return result.rows.map((row: any) => this.mapRowToTrade(row));
  }

  // Batch operations
  public async createBatch(): Promise<string> {
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const query = `
      INSERT INTO batches (id, status, chain_id, created_at, trade_count)
      VALUES ($1, 'pending', 31337, $2, 0)
      RETURNING id
    `;
    
    const result = await this.pool.query(query, [batchId, Date.now()]);
    return result.rows[0].id;
  }

  public async addTradeToBatch(batchId: string, tradeId: string): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Add trade to batch
      await client.query(
        'INSERT INTO batch_trades (batch_id, trade_id) VALUES ($1, $2)',
        [batchId, tradeId]
      );
      
      // Update trade count
      await client.query(
        'UPDATE batches SET trade_count = trade_count + 1 WHERE id = $1',
        [batchId]
      );
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async settleBatch(batchId: string, txHash: string): Promise<void> {
    const query = `
      UPDATE batches SET 
        status = 'confirmed',
        tx_hash = $2,
        confirmed_at = $3
      WHERE id = $1
    `;
    
    await this.pool.query(query, [batchId, txHash, Date.now()]);
  }

  public async getPendingBatches(): Promise<Batch[]> {
    const query = `
      SELECT b.*, 
             array_agg(t.*) as trades
      FROM batches b
      LEFT JOIN batch_trades bt ON b.id = bt.batch_id
      LEFT JOIN trades t ON bt.trade_id = t.id
      WHERE b.status = 'pending'
      GROUP BY b.id
      ORDER BY b.created_at ASC
    `;
    
    const result = await this.pool.query(query);
    return result.rows.map((row: any) => this.mapRowToBatch(row));
  }

  public async saveBatch(batch: Batch): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Insert batch
      const batchQuery = `
        INSERT INTO batches (
          id, status, chain_id, tx_hash, block_number, created_at,
          submitted_at, confirmed_at, gas_used, gas_price, trade_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `;
      
      await client.query(batchQuery, [
        batch.id,
        batch.status,
        batch.chainId,
        batch.txHash,
        batch.blockNumber,
        batch.createdAt,
        batch.submittedAt,
        batch.confirmedAt,
        batch.gasUsed,
        batch.gasPrice,
        batch.trades.length,
      ]);
      
      // Insert batch-trade relationships
      for (const trade of batch.trades) {
        await client.query(
          'INSERT INTO batch_trades (batch_id, trade_id) VALUES ($1, $2)',
          [batch.id, trade.id]
        );
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async updateBatch(batchId: string, updates: Partial<Batch>): Promise<void> {
    const setClause: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        setClause.push(`${this.camelToSnake(key)} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    if (setClause.length === 0) return;

    const query = `UPDATE batches SET ${setClause.join(', ')} WHERE id = $${paramIndex}`;
    values.push(batchId);

    await this.pool.query(query, values);
  }

  private mapRowToOrder(row: any): Order {
    return {
      id: row.id,
      userId: row.user_id,
      pair: row.pair,
      side: row.side,
      type: row.type,
      price: row.price,
      amount: row.amount,
      filled: row.filled,
      remaining: row.remaining,
      status: row.status,
      timestamp: parseInt(row.timestamp),
      nonce: row.nonce,
      signature: row.signature,
      chainId: row.chain_id,
      expiresAt: row.expires_at ? parseInt(row.expires_at) : undefined,
    };
  }

  private mapRowToTrade(row: any): Trade {
    return {
      id: row.id,
      orderId: row.order_id,
      counterOrderId: row.counter_order_id,
      pair: row.pair,
      side: row.side,
      price: row.price,
      amount: row.amount,
      fee: row.fee,
      timestamp: parseInt(row.timestamp),
      blockNumber: row.block_number ? parseInt(row.block_number) : undefined,
      txHash: row.tx_hash,
      chainId: row.chain_id,
    };
  }

  // Market data and health check
  public async getMarketData(): Promise<any> {
    const query = `
      SELECT 
        pair,
        COUNT(*) as trades_24h,
        SUM(CAST(amount AS DECIMAL)) as volume_24h,
        AVG(CAST(price AS DECIMAL)) as avg_price,
        MAX(CAST(price AS DECIMAL)) as high_24h,
        MIN(CAST(price AS DECIMAL)) as low_24h,
        (SELECT price FROM trades WHERE pair = t.pair ORDER BY timestamp DESC LIMIT 1) as last_price
      FROM trades t
      WHERE timestamp > (EXTRACT(EPOCH FROM NOW()) * 1000 - 86400000)
      GROUP BY pair
      UNION ALL
      SELECT 
        'ETH/USDC' as pair, 0 as trades_24h, 0 as volume_24h, 1000 as avg_price, 1000 as high_24h, 1000 as low_24h, '1000.00' as last_price
      WHERE NOT EXISTS (SELECT 1 FROM trades WHERE pair = 'ETH/USDC')
    `;
    
    const result = await this.pool.query(query);
    return result.rows.map(row => ({
      pair: row.pair,
      lastPrice: row.last_price?.toString() || '1000.00',
      priceChange24h: '0.0',
      volume24h: row.volume_24h?.toString() || '0',
      high24h: row.high_24h?.toString() || '1000.00',
      low24h: row.low_24h?.toString() || '1000.00',
      trades24h: parseInt(row.trades_24h) || 0,
      timestamp: new Date().toISOString()
    }));
  }

  public async healthCheck(): Promise<{ status: string; recordCounts?: any }> {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      // Get record counts
      const userCountResult = await this.pool.query('SELECT COUNT(*) FROM users');
      const orderCountResult = await this.pool.query('SELECT COUNT(*) FROM orders');
      const tradeCountResult = await this.pool.query('SELECT COUNT(*) FROM trades');
      const batchCountResult = await this.pool.query('SELECT COUNT(*) FROM batches');

      return {
        status: 'healthy',
        recordCounts: {
          users: parseInt(userCountResult.rows[0].count),
          orders: parseInt(orderCountResult.rows[0].count),
          trades: parseInt(tradeCountResult.rows[0].count),
          batches: parseInt(batchCountResult.rows[0].count)
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        recordCounts: {
          error: (error as Error).message
        }
      };
    }
  }

  private mapRowToBatch(row: any): Batch {
    return {
      id: row.id,
      trades: row.trades ? row.trades.filter((t: any) => t.id).map((t: any) => this.mapRowToTrade(t)) : [],
      status: row.status,
      chainId: row.chain_id,
      txHash: row.tx_hash,
      blockNumber: row.block_number ? parseInt(row.block_number) : undefined,
      createdAt: parseInt(row.created_at),
      submittedAt: row.submitted_at ? parseInt(row.submitted_at) : undefined,
      confirmedAt: row.confirmed_at ? parseInt(row.confirmed_at) : undefined,
      gasUsed: row.gas_used,
      gasPrice: row.gas_price,
    };
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}
