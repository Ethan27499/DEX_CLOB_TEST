"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseManager = void 0;
const pg_1 = require("pg");
const logger_1 = require("./logger");
class DatabaseManager {
    constructor() {
        this.logger = new logger_1.Logger('DatabaseManager');
        this.pool = new pg_1.Pool({
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
    async connect() {
        try {
            const client = await this.pool.connect();
            await client.query('SELECT NOW()');
            client.release();
            await this.initializeTables();
            this.logger.info('Database connection established');
        }
        catch (error) {
            this.logger.error('Failed to connect to database:', error);
            throw error;
        }
    }
    async disconnect() {
        await this.pool.end();
        this.logger.info('Database connection closed');
    }
    async initializeTables() {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
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
            await client.query(`
        CREATE TABLE IF NOT EXISTS batch_trades (
          batch_id VARCHAR(42) NOT NULL,
          trade_id VARCHAR(42) NOT NULL,
          PRIMARY KEY (batch_id, trade_id),
          FOREIGN KEY (batch_id) REFERENCES batches(id),
          FOREIGN KEY (trade_id) REFERENCES trades(id)
        )
      `);
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
        }
        catch (error) {
            await client.query('ROLLBACK');
            this.logger.error('Failed to initialize database tables:', error);
            throw error;
        }
        finally {
            client.release();
        }
    }
    async saveUser(user) {
        const query = `
      INSERT INTO users (id, address, nonce, is_active, created_at, last_activity)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        nonce = EXCLUDED.nonce,
        is_active = EXCLUDED.is_active,
        last_activity = EXCLUDED.last_activity
    `;
        await this.pool.query(query, [
            user.id,
            user.address,
            user.nonce,
            user.isActive,
            user.createdAt,
            user.lastActivity,
        ]);
    }
    async getUser(userId) {
        const query = 'SELECT * FROM users WHERE id = $1';
        const result = await this.pool.query(query, [userId]);
        if (result.rows.length === 0)
            return null;
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
    async saveOrder(order) {
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
    async updateOrder(order) {
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
    async getOrder(orderId) {
        const query = 'SELECT * FROM orders WHERE id = $1';
        const result = await this.pool.query(query, [orderId]);
        if (result.rows.length === 0)
            return null;
        return this.mapRowToOrder(result.rows[0]);
    }
    async getUserOrders(userId, limit = 50, offset = 0) {
        const query = `
      SELECT * FROM orders 
      WHERE user_id = $1 
      ORDER BY timestamp DESC 
      LIMIT $2 OFFSET $3
    `;
        const result = await this.pool.query(query, [userId, limit, offset]);
        return result.rows.map((row) => this.mapRowToOrder(row));
    }
    async saveTrade(trade) {
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
    async getTrades(pair, limit = 50, offset = 0) {
        let query = 'SELECT * FROM trades';
        const params = [];
        if (pair) {
            query += ' WHERE pair = $1';
            params.push(pair);
        }
        query += ' ORDER BY timestamp DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
        params.push(limit, offset);
        const result = await this.pool.query(query, params);
        return result.rows.map((row) => this.mapRowToTrade(row));
    }
    async saveBatch(batch) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
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
            for (const trade of batch.trades) {
                await client.query('INSERT INTO batch_trades (batch_id, trade_id) VALUES ($1, $2)', [batch.id, trade.id]);
            }
            await client.query('COMMIT');
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async updateBatch(batchId, updates) {
        const setClause = [];
        const values = [];
        let paramIndex = 1;
        Object.entries(updates).forEach(([key, value]) => {
            if (value !== undefined) {
                setClause.push(`${this.camelToSnake(key)} = $${paramIndex}`);
                values.push(value);
                paramIndex++;
            }
        });
        if (setClause.length === 0)
            return;
        const query = `UPDATE batches SET ${setClause.join(', ')} WHERE id = $${paramIndex}`;
        values.push(batchId);
        await this.pool.query(query, values);
    }
    mapRowToOrder(row) {
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
    mapRowToTrade(row) {
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
    camelToSnake(str) {
        return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    }
}
exports.DatabaseManager = DatabaseManager;
//# sourceMappingURL=database.js.map