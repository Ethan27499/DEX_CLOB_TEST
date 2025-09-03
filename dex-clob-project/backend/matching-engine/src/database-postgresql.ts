import { Pool, PoolClient } from 'pg';
import { IDatabaseManager } from './database-interface';
import { User, Order, Trade, Batch, MarketData } from '../../shared/types';

export class PostgreSQLDatabaseManager implements IDatabaseManager {
  private pool: Pool | null = null;

  async connect(): Promise<void> {
    this.pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'dex_clob',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    await this.createTables();
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  private async createTables(): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    try {
      await client.query(`
        -- Enable UUID extension
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

        -- Users table
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          address VARCHAR(42) UNIQUE NOT NULL,
          nonce INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT true,
          created_at BIGINT NOT NULL,
          last_activity BIGINT NOT NULL,
          CONSTRAINT valid_address CHECK (address ~ '^0x[a-fA-F0-9]{40}$')
        );

        -- Orders table
        CREATE TABLE IF NOT EXISTS orders (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id UUID NOT NULL REFERENCES users(id),
          pair VARCHAR(20) NOT NULL,
          side VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
          type VARCHAR(10) NOT NULL CHECK (type IN ('limit', 'market')),
          price DECIMAL(36, 18) NOT NULL,
          amount DECIMAL(36, 18) NOT NULL,
          filled DECIMAL(36, 18) DEFAULT 0,
          remaining DECIMAL(36, 18) NOT NULL,
          status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'filled', 'cancelled', 'expired')),
          timestamp BIGINT NOT NULL,
          nonce INTEGER NOT NULL,
          signature VARCHAR(132) NOT NULL,
          chain_id INTEGER NOT NULL,
          expires_at BIGINT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Trades table
        CREATE TABLE IF NOT EXISTS trades (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          order_id UUID NOT NULL REFERENCES orders(id),
          counter_order_id UUID NOT NULL REFERENCES orders(id),
          pair VARCHAR(20) NOT NULL,
          side VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
          price DECIMAL(36, 18) NOT NULL,
          amount DECIMAL(36, 18) NOT NULL,
          fee DECIMAL(36, 18) DEFAULT 0,
          timestamp BIGINT NOT NULL,
          block_number BIGINT,
          tx_hash VARCHAR(66),
          chain_id INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Batches table
        CREATE TABLE IF NOT EXISTS batches (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed')),
          chain_id INTEGER NOT NULL,
          tx_hash VARCHAR(66),
          block_number BIGINT,
          created_at BIGINT NOT NULL,
          submitted_at BIGINT,
          confirmed_at BIGINT,
          gas_used DECIMAL(20, 0),
          gas_price DECIMAL(20, 0)
        );

        -- Batch trades junction table
        CREATE TABLE IF NOT EXISTS batch_trades (
          batch_id UUID NOT NULL REFERENCES batches(id),
          trade_id UUID NOT NULL REFERENCES trades(id),
          PRIMARY KEY (batch_id, trade_id)
        );

        -- Indexes for performance
        CREATE INDEX IF NOT EXISTS idx_users_address ON users(address);
        CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
        CREATE INDEX IF NOT EXISTS idx_orders_pair ON orders(pair);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_orders_pair_status ON orders(pair, status);
        CREATE INDEX IF NOT EXISTS idx_trades_pair ON trades(pair);
        CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
        CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);

        -- Update trigger for orders
        CREATE OR REPLACE FUNCTION update_modified_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
        CREATE TRIGGER update_orders_updated_at
          BEFORE UPDATE ON orders
          FOR EACH ROW
          EXECUTE FUNCTION update_modified_column();
      `);
    } finally {
      client.release();
    }
  }

  async createUser(user: Omit<User, 'id' | 'createdAt' | 'lastActivity'>): Promise<User> {
    if (!this.pool) throw new Error('Database not connected');

    const now = Date.now();
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(
        `INSERT INTO users (address, nonce, is_active, created_at, last_activity) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id, address, nonce, is_active, created_at, last_activity`,
        [user.address, user.nonce || 0, user.isActive, now, now]
      );

      const row = result.rows[0];
      return {
        id: row.id,
        address: row.address,
        nonce: row.nonce,
        isActive: row.is_active,
        createdAt: row.created_at,
        lastActivity: row.last_activity
      };
    } finally {
      client.release();
    }
  }

  async saveUser(user: any): Promise<User> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(
        `UPDATE users SET 
          address = $1, 
          nonce = $2, 
          is_active = $3, 
          last_activity = $4 
         WHERE id = $5
         RETURNING id, address, nonce, is_active, created_at, last_activity`,
        [user.address, user.nonce, user.isActive, user.lastActivity, user.id]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      const row = result.rows[0];
      return {
        id: row.id,
        address: row.address,
        nonce: row.nonce,
        isActive: row.is_active,
        createdAt: row.created_at,
        lastActivity: row.last_activity
      };
    } finally {
      client.release();
    }
  }

  async getUserByAddress(address: string): Promise<User | null> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(
        'SELECT id, address, nonce, is_active, created_at, last_activity FROM users WHERE address = $1',
        [address]
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        id: row.id,
        address: row.address,
        nonce: row.nonce,
        isActive: row.is_active,
        createdAt: row.created_at,
        lastActivity: row.last_activity
      };
    } finally {
      client.release();
    }
  }

  async getUserById(id: string): Promise<User | null> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(
        'SELECT id, address, nonce, is_active, created_at, last_activity FROM users WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        id: row.id,
        address: row.address,
        nonce: row.nonce,
        isActive: row.is_active,
        createdAt: row.created_at,
        lastActivity: row.last_activity
      };
    } finally {
      client.release();
    }
  }

  async saveOrder(order: Order): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      await client.query(
        `INSERT INTO orders (
          id, user_id, pair, side, type, price, amount, filled, remaining, 
          status, timestamp, nonce, signature, chain_id, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO UPDATE SET
          price = EXCLUDED.price,
          amount = EXCLUDED.amount,
          filled = EXCLUDED.filled,
          remaining = EXCLUDED.remaining,
          status = EXCLUDED.status`,
        [
          order.id, order.userId, order.pair, order.side, order.type,
          order.price, order.amount, order.filled, order.remaining,
          order.status, order.timestamp, order.nonce, order.signature,
          order.chainId, order.expiresAt
        ]
      );
    } finally {
      client.release();
    }
  }

  async getOrder(orderId: string): Promise<Order | null> {
    return this.getOrderById(orderId);
  }

  async getOrderById(id: string): Promise<Order | null> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(
        'SELECT * FROM orders WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        pair: row.pair,
        side: row.side as 'buy' | 'sell',
        type: row.type as 'limit' | 'market',
        price: row.price.toString(),
        amount: row.amount.toString(),
        filled: row.filled.toString(),
        remaining: row.remaining.toString(),
        status: row.status as 'pending' | 'partial' | 'filled' | 'cancelled' | 'expired',
        timestamp: parseInt(row.timestamp),
        nonce: row.nonce,
        signature: row.signature,
        chainId: row.chain_id,
        expiresAt: row.expires_at ? parseInt(row.expires_at) : undefined
      };
    } finally {
      client.release();
    }
  }

  async getOrdersByUser(userId: string): Promise<Order[]> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(
        'SELECT * FROM orders WHERE user_id = $1 ORDER BY timestamp DESC',
        [userId]
      );

      return result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        pair: row.pair,
        side: row.side as 'buy' | 'sell',
        type: row.type as 'limit' | 'market',
        price: row.price.toString(),
        amount: row.amount.toString(),
        filled: row.filled.toString(),
        remaining: row.remaining.toString(),
        status: row.status as 'pending' | 'partial' | 'filled' | 'cancelled' | 'expired',
        timestamp: parseInt(row.timestamp),
        nonce: row.nonce,
        signature: row.signature,
        chainId: row.chain_id,
        expiresAt: row.expires_at ? parseInt(row.expires_at) : undefined
      }));
    } finally {
      client.release();
    }
  }

  async getUserOrders(userId: string, limit?: number): Promise<Order[]> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      const limitClause = limit ? 'LIMIT $2' : '';
      const params = limit ? [userId, limit] : [userId];
      
      const result = await client.query(
        `SELECT * FROM orders WHERE user_id = $1 ORDER BY timestamp DESC ${limitClause}`,
        params
      );

      return result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        pair: row.pair,
        side: row.side as 'buy' | 'sell',
        type: row.type as 'limit' | 'market',
        price: row.price.toString(),
        amount: row.amount.toString(),
        filled: row.filled.toString(),
        remaining: row.remaining.toString(),
        status: row.status as 'pending' | 'partial' | 'filled' | 'cancelled' | 'expired',
        timestamp: parseInt(row.timestamp),
        nonce: row.nonce,
        signature: row.signature,
        chainId: row.chain_id,
        expiresAt: row.expires_at ? parseInt(row.expires_at) : undefined
      }));
    } finally {
      client.release();
    }
  }

  async getOrdersByPair(pair: string): Promise<Order[]> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(
        'SELECT * FROM orders WHERE pair = $1 AND status IN ($2, $3) ORDER BY timestamp ASC',
        [pair, 'pending', 'partial']
      );

      return result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        pair: row.pair,
        side: row.side as 'buy' | 'sell',
        type: row.type as 'limit' | 'market',
        price: row.price.toString(),
        amount: row.amount.toString(),
        filled: row.filled.toString(),
        remaining: row.remaining.toString(),
        status: row.status as 'pending' | 'partial' | 'filled' | 'cancelled' | 'expired',
        timestamp: parseInt(row.timestamp),
        nonce: row.nonce,
        signature: row.signature,
        chainId: row.chain_id,
        expiresAt: row.expires_at ? parseInt(row.expires_at) : undefined
      }));
    } finally {
      client.release();
    }
  }

  async updateOrder(order: Order): Promise<void> {
    await this.saveOrder(order);
  }

  async updateOrderStatus(orderId: string, status: Order['status'], filledAmount?: string): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      let query = 'UPDATE orders SET status = $1';
      const params: any[] = [status];
      
      if (filledAmount !== undefined) {
        query += ', filled = $2';
        params.push(filledAmount);
        query += ' WHERE id = $3';
        params.push(orderId);
      } else {
        query += ' WHERE id = $2';
        params.push(orderId);
      }

      await client.query(query, params);
    } finally {
      client.release();
    }
  }

  async saveTrade(trade: Trade): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      await client.query(
        `INSERT INTO trades (
          id, order_id, counter_order_id, pair, side, price, amount, fee, 
          timestamp, block_number, tx_hash, chain_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          trade.id, trade.orderId, trade.counterOrderId, trade.pair, trade.side,
          trade.price, trade.amount, trade.fee, trade.timestamp,
          trade.blockNumber, trade.txHash, trade.chainId
        ]
      );
    } finally {
      client.release();
    }
  }

  async getTrades(pair?: string, limit?: number): Promise<Trade[]> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      let query = 'SELECT * FROM trades';
      const params: any[] = [];
      
      if (pair) {
        query += ' WHERE pair = $1';
        params.push(pair);
      }
      
      query += ' ORDER BY timestamp DESC';
      
      if (limit) {
        query += pair ? ' LIMIT $2' : ' LIMIT $1';
        params.push(limit);
      }

      const result = await client.query(query, params);

      return result.rows.map(row => ({
        id: row.id,
        orderId: row.order_id,
        counterOrderId: row.counter_order_id,
        pair: row.pair,
        side: row.side as 'buy' | 'sell',
        price: row.price.toString(),
        amount: row.amount.toString(),
        fee: row.fee.toString(),
        timestamp: parseInt(row.timestamp),
        blockNumber: row.block_number ? parseInt(row.block_number) : undefined,
        txHash: row.tx_hash,
        chainId: row.chain_id
      }));
    } finally {
      client.release();
    }
  }

  async getTradesByPair(pair: string, limit?: number): Promise<Trade[]> {
    return this.getTrades(pair, limit);
  }

  async getTradesByUser(userId: string): Promise<Trade[]> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(
        `SELECT t.* FROM trades t 
         JOIN orders o ON (t.order_id = o.id OR t.counter_order_id = o.id)
         WHERE o.user_id = $1 
         ORDER BY t.timestamp DESC`,
        [userId]
      );

      return result.rows.map(row => ({
        id: row.id,
        orderId: row.order_id,
        counterOrderId: row.counter_order_id,
        pair: row.pair,
        side: row.side as 'buy' | 'sell',
        price: row.price.toString(),
        amount: row.amount.toString(),
        fee: row.fee.toString(),
        timestamp: parseInt(row.timestamp),
        blockNumber: row.block_number ? parseInt(row.block_number) : undefined,
        txHash: row.tx_hash,
        chainId: row.chain_id
      }));
    } finally {
      client.release();
    }
  }

  async createBatch(): Promise<string> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      const now = Date.now();
      const result = await client.query(
        'INSERT INTO batches (status, chain_id, created_at) VALUES ($1, $2, $3) RETURNING id',
        ['pending', 1, now] // Default chain_id = 1
      );

      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async addTradeToBatch(batchId: string, tradeId: string): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      await client.query(
        'INSERT INTO batch_trades (batch_id, trade_id) VALUES ($1, $2)',
        [batchId, tradeId]
      );
    } finally {
      client.release();
    }
  }

  async settleBatch(batchId: string, txHash: string): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      await client.query(
        'UPDATE batches SET status = $1, tx_hash = $2, submitted_at = $3 WHERE id = $4',
        ['submitted', txHash, Date.now(), batchId]
      );
    } finally {
      client.release();
    }
  }

  async getPendingBatches(): Promise<Batch[]> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(
        'SELECT * FROM batches WHERE status = $1 ORDER BY created_at ASC',
        ['pending']
      );

      const batches: Batch[] = [];
      for (const row of result.rows) {
        const trades = await this.getBatchTrades(row.id, client);
        batches.push({
          id: row.id,
          trades,
          status: row.status as 'pending' | 'submitted' | 'confirmed' | 'failed',
          chainId: row.chain_id,
          txHash: row.tx_hash,
          blockNumber: row.block_number ? parseInt(row.block_number) : undefined,
          createdAt: parseInt(row.created_at),
          submittedAt: row.submitted_at ? parseInt(row.submitted_at) : undefined,
          confirmedAt: row.confirmed_at ? parseInt(row.confirmed_at) : undefined,
          gasUsed: row.gas_used?.toString(),
          gasPrice: row.gas_price?.toString()
        });
      }

      return batches;
    } finally {
      client.release();
    }
  }

  private async getBatchTrades(batchId: string, client: PoolClient): Promise<Trade[]> {
    const result = await client.query(
      `SELECT t.* FROM trades t 
       JOIN batch_trades bt ON t.id = bt.trade_id 
       WHERE bt.batch_id = $1`,
      [batchId]
    );

    return result.rows.map(row => ({
      id: row.id,
      orderId: row.order_id,
      counterOrderId: row.counter_order_id,
      pair: row.pair,
      side: row.side as 'buy' | 'sell',
      price: row.price.toString(),
      amount: row.amount.toString(),
      fee: row.fee.toString(),
      timestamp: parseInt(row.timestamp),
      blockNumber: row.block_number ? parseInt(row.block_number) : undefined,
      txHash: row.tx_hash,
      chainId: row.chain_id
    }));
  }

  async getMarketData(): Promise<any> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    
    try {
      // Get latest trade data for market overview
      const result = await client.query(`
        SELECT 
          pair,
          price as last_price,
          amount,
          timestamp
        FROM trades 
        ORDER BY timestamp DESC 
        LIMIT 100
      `);

      return {
        trades: result.rows,
        timestamp: Date.now()
      };
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<{ status: string; recordCounts?: any }> {
    if (!this.pool) {
      return { status: 'disconnected' };
    }

    const client = await this.pool.connect();
    
    try {
      const userCount = await client.query('SELECT COUNT(*) as count FROM users');
      const orderCount = await client.query('SELECT COUNT(*) as count FROM orders');
      const tradeCount = await client.query('SELECT COUNT(*) as count FROM trades');

      return {
        status: 'connected',
        recordCounts: {
          users: parseInt(userCount.rows[0].count),
          orders: parseInt(orderCount.rows[0].count),
          trades: parseInt(tradeCount.rows[0].count)
        }
      };
    } catch (error) {
      return { status: 'error' };
    } finally {
      client.release();
    }
  }
}
