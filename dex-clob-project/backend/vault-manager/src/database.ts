import { Pool, Client } from 'pg';
import { Logger } from './logger';

export interface DatabaseManager {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  recordDeposit(data: any): Promise<{ id: string }>;
  recordWithdrawal(data: any): Promise<{ id: string }>;
  recordBorrow(data: any): Promise<{ id: string }>;
  recordRepayment(data: any): Promise<{ id: string }>;
  recordLiquidation(data: any): Promise<{ id: string }>;
  getVaultStatistics(): Promise<any>;
  getTotalUsers(): Promise<number>;
}

export class PostgresDatabaseManager implements DatabaseManager {
  private pool: Pool;
  private logger: Logger;

  constructor() {
    this.logger = new Logger('PostgresDatabaseManager');
    
    // Use same database as matching-engine
    this.pool = new Pool({
      host: 'localhost',
      port: 5432,
      database: 'dex_clob',
      user: 'dex_user',
      password: 'dex_password',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  async connect(): Promise<void> {
    try {
      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      // Create vault tables if they don't exist
      await this.createTables();
      
      this.logger.info('Connected to PostgreSQL database');
    } catch (error) {
      this.logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.pool.end();
      this.logger.info('Disconnected from PostgreSQL database');
    } catch (error) {
      this.logger.error('Error disconnecting from database:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      // Vault deposits table
      await client.query(`
        CREATE TABLE IF NOT EXISTS vault_deposits (
          id SERIAL PRIMARY KEY,
          user_address VARCHAR(42) NOT NULL,
          token VARCHAR(42) NOT NULL,
          amount DECIMAL(78, 0) NOT NULL,
          tx_hash VARCHAR(66) NOT NULL,
          block_number BIGINT NOT NULL,
          timestamp BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Vault withdrawals table
      await client.query(`
        CREATE TABLE IF NOT EXISTS vault_withdrawals (
          id SERIAL PRIMARY KEY,
          user_address VARCHAR(42) NOT NULL,
          token VARCHAR(42) NOT NULL,
          amount DECIMAL(78, 0) NOT NULL,
          tx_hash VARCHAR(66) NOT NULL,
          block_number BIGINT NOT NULL,
          timestamp BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Vault borrows table
      await client.query(`
        CREATE TABLE IF NOT EXISTS vault_borrows (
          id SERIAL PRIMARY KEY,
          user_address VARCHAR(42) NOT NULL,
          token VARCHAR(42) NOT NULL,
          amount DECIMAL(78, 0) NOT NULL,
          tx_hash VARCHAR(66) NOT NULL,
          block_number BIGINT NOT NULL,
          timestamp BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Vault repayments table
      await client.query(`
        CREATE TABLE IF NOT EXISTS vault_repayments (
          id SERIAL PRIMARY KEY,
          user_address VARCHAR(42) NOT NULL,
          token VARCHAR(42) NOT NULL,
          amount DECIMAL(78, 0) NOT NULL,
          tx_hash VARCHAR(66) NOT NULL,
          block_number BIGINT NOT NULL,
          timestamp BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Vault liquidations table
      await client.query(`
        CREATE TABLE IF NOT EXISTS vault_liquidations (
          id SERIAL PRIMARY KEY,
          user_address VARCHAR(42) NOT NULL,
          liquidator_address VARCHAR(42) NOT NULL,
          debt_token VARCHAR(42) NOT NULL,
          collateral_token VARCHAR(42) NOT NULL,
          debt_amount DECIMAL(78, 0) NOT NULL,
          tx_hash VARCHAR(66) NOT NULL,
          block_number BIGINT NOT NULL,
          timestamp BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // User positions cache table
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_positions (
          id SERIAL PRIMARY KEY,
          user_address VARCHAR(42) UNIQUE NOT NULL,
          total_collateral_value DECIMAL(78, 0) NOT NULL DEFAULT 0,
          total_borrowed_value DECIMAL(78, 0) NOT NULL DEFAULT 0,
          health_factor DECIMAL(10, 6) NOT NULL DEFAULT 999,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Price history table
      await client.query(`
        CREATE TABLE IF NOT EXISTS token_prices (
          id SERIAL PRIMARY KEY,
          token_address VARCHAR(42) NOT NULL,
          price_usd DECIMAL(20, 8) NOT NULL,
          source VARCHAR(50) NOT NULL,
          timestamp BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create indexes for better performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_vault_deposits_user ON vault_deposits(user_address);
        CREATE INDEX IF NOT EXISTS idx_vault_withdrawals_user ON vault_withdrawals(user_address);
        CREATE INDEX IF NOT EXISTS idx_vault_borrows_user ON vault_borrows(user_address);
        CREATE INDEX IF NOT EXISTS idx_vault_repayments_user ON vault_repayments(user_address);
        CREATE INDEX IF NOT EXISTS idx_vault_liquidations_user ON vault_liquidations(user_address);
        CREATE INDEX IF NOT EXISTS idx_user_positions_user ON user_positions(user_address);
        CREATE INDEX IF NOT EXISTS idx_token_prices_token ON token_prices(token_address);
        CREATE INDEX IF NOT EXISTS idx_token_prices_timestamp ON token_prices(timestamp);
      `);

      this.logger.info('Database tables created successfully');

    } catch (error) {
      this.logger.error('Error creating tables:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordDeposit(data: any): Promise<{ id: string }> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        INSERT INTO vault_deposits (user_address, token, amount, tx_hash, block_number, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [data.userAddress, data.token, data.amount, data.txHash, data.blockNumber, data.timestamp]);

      const id = result.rows[0].id.toString();
      
      // Update user position cache
      await this.updateUserPositionCache(data.userAddress);
      
      this.logger.info('Deposit recorded', { id, userAddress: data.userAddress });
      return { id };
      
    } catch (error) {
      this.logger.error('Error recording deposit:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordWithdrawal(data: any): Promise<{ id: string }> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        INSERT INTO vault_withdrawals (user_address, token, amount, tx_hash, block_number, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [data.userAddress, data.token, data.amount, data.txHash, data.blockNumber, data.timestamp]);

      const id = result.rows[0].id.toString();
      
      // Update user position cache
      await this.updateUserPositionCache(data.userAddress);
      
      this.logger.info('Withdrawal recorded', { id, userAddress: data.userAddress });
      return { id };
      
    } catch (error) {
      this.logger.error('Error recording withdrawal:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordBorrow(data: any): Promise<{ id: string }> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        INSERT INTO vault_borrows (user_address, token, amount, tx_hash, block_number, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [data.userAddress, data.token, data.amount, data.txHash, data.blockNumber, data.timestamp]);

      const id = result.rows[0].id.toString();
      
      // Update user position cache
      await this.updateUserPositionCache(data.userAddress);
      
      this.logger.info('Borrow recorded', { id, userAddress: data.userAddress });
      return { id };
      
    } catch (error) {
      this.logger.error('Error recording borrow:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordRepayment(data: any): Promise<{ id: string }> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        INSERT INTO vault_repayments (user_address, token, amount, tx_hash, block_number, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [data.userAddress, data.token, data.amount, data.txHash, data.blockNumber, data.timestamp]);

      const id = result.rows[0].id.toString();
      
      // Update user position cache
      await this.updateUserPositionCache(data.userAddress);
      
      this.logger.info('Repayment recorded', { id, userAddress: data.userAddress });
      return { id };
      
    } catch (error) {
      this.logger.error('Error recording repayment:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordLiquidation(data: any): Promise<{ id: string }> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        INSERT INTO vault_liquidations (user_address, liquidator_address, debt_token, collateral_token, debt_amount, tx_hash, block_number, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [data.userAddress, data.liquidatorAddress, data.debtToken, data.collateralToken, data.debtAmount, data.txHash, data.blockNumber, data.timestamp]);

      const id = result.rows[0].id.toString();
      
      // Update user position cache
      await this.updateUserPositionCache(data.userAddress);
      
      this.logger.info('Liquidation recorded', { id, userAddress: data.userAddress });
      return { id };
      
    } catch (error) {
      this.logger.error('Error recording liquidation:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getVaultStatistics(): Promise<any> {
    const client = await this.pool.connect();
    
    try {
      // Get total statistics
      const statsResult = await client.query(`
        SELECT 
          (SELECT COUNT(*) FROM vault_deposits) as total_deposits,
          (SELECT COUNT(*) FROM vault_withdrawals) as total_withdrawals,
          (SELECT COUNT(*) FROM vault_borrows) as total_borrows,
          (SELECT COUNT(*) FROM vault_repayments) as total_repayments,
          (SELECT COUNT(*) FROM vault_liquidations) as total_liquidations,
          (SELECT COUNT(DISTINCT user_address) FROM user_positions) as total_users,
          (SELECT COALESCE(SUM(total_collateral_value::numeric), 0) FROM user_positions) as total_value_locked,
          (SELECT COALESCE(SUM(total_borrowed_value::numeric), 0) FROM user_positions) as total_borrowed
      `);

      const stats = statsResult.rows[0];
      const totalValueLocked = parseFloat(stats.total_value_locked);
      const totalBorrowed = parseFloat(stats.total_borrowed);
      const utilizationRate = totalValueLocked > 0 ? totalBorrowed / totalValueLocked : 0;

      return {
        totalValueLocked: totalValueLocked.toString(),
        totalBorrowed: totalBorrowed.toString(),
        totalUsers: parseInt(stats.total_users),
        totalDeposits: parseInt(stats.total_deposits),
        totalWithdrawals: parseInt(stats.total_withdrawals),
        totalBorrows: parseInt(stats.total_borrows),
        totalRepayments: parseInt(stats.total_repayments),
        totalLiquidations: parseInt(stats.total_liquidations),
        utilizationRate
      };
      
    } catch (error) {
      this.logger.error('Error getting vault statistics:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getTotalUsers(): Promise<number> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT COUNT(DISTINCT user_address) as total_users
        FROM user_positions
        WHERE total_collateral_value > 0 OR total_borrowed_value > 0
      `);

      return parseInt(result.rows[0].total_users);
      
    } catch (error) {
      this.logger.error('Error getting total users:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async updateUserPositionCache(userAddress: string): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      // Calculate user's total positions from transaction history
      // This is a simplified calculation - in production would sync with contract state
      const positionResult = await client.query(`
        WITH user_deposits AS (
          SELECT token, COALESCE(SUM(amount::numeric), 0) as total_deposited
          FROM vault_deposits 
          WHERE user_address = $1 
          GROUP BY token
        ),
        user_withdrawals AS (
          SELECT token, COALESCE(SUM(amount::numeric), 0) as total_withdrawn
          FROM vault_withdrawals 
          WHERE user_address = $1 
          GROUP BY token
        ),
        user_borrows AS (
          SELECT token, COALESCE(SUM(amount::numeric), 0) as total_borrowed
          FROM vault_borrows 
          WHERE user_address = $1 
          GROUP BY token
        ),
        user_repayments AS (
          SELECT token, COALESCE(SUM(amount::numeric), 0) as total_repaid
          FROM vault_repayments 
          WHERE user_address = $1 
          GROUP BY token
        )
        SELECT 
          COALESCE(SUM((COALESCE(d.total_deposited, 0) - COALESCE(w.total_withdrawn, 0)) * 2000), 0) as total_collateral_value,
          COALESCE(SUM((COALESCE(b.total_borrowed, 0) - COALESCE(r.total_repaid, 0)) * 2000), 0) as total_borrowed_value
        FROM user_deposits d
        FULL OUTER JOIN user_withdrawals w ON d.token = w.token
        FULL OUTER JOIN user_borrows b ON COALESCE(d.token, w.token) = b.token
        FULL OUTER JOIN user_repayments r ON COALESCE(d.token, w.token, b.token) = r.token
      `, [userAddress]);

      const position = positionResult.rows[0];
      const totalCollateral = parseFloat(position.total_collateral_value || '0');
      const totalBorrowed = parseFloat(position.total_borrowed_value || '0');
      const healthFactor = totalBorrowed > 0 ? totalCollateral / totalBorrowed : 999;

      // Upsert user position
      await client.query(`
        INSERT INTO user_positions (user_address, total_collateral_value, total_borrowed_value, health_factor, last_updated)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (user_address) 
        DO UPDATE SET 
          total_collateral_value = $2,
          total_borrowed_value = $3,
          health_factor = $4,
          last_updated = CURRENT_TIMESTAMP
      `, [userAddress, totalCollateral.toString(), totalBorrowed.toString(), healthFactor]);

    } catch (error) {
      this.logger.error('Error updating user position cache:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getUserPosition(userAddress: string): Promise<any> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT total_collateral_value, total_borrowed_value, health_factor, last_updated
        FROM user_positions
        WHERE user_address = $1
      `, [userAddress]);

      if (result.rows.length === 0) {
        return {
          totalCollateralValue: '0',
          totalBorrowedValue: '0',
          healthFactor: 999,
          lastUpdated: Date.now()
        };
      }

      const row = result.rows[0];
      return {
        totalCollateralValue: row.total_collateral_value,
        totalBorrowedValue: row.total_borrowed_value,
        healthFactor: parseFloat(row.health_factor),
        lastUpdated: new Date(row.last_updated).getTime()
      };
      
    } catch (error) {
      this.logger.error('Error getting user position:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordTokenPrice(tokenAddress: string, priceUSD: number, source: string): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query(`
        INSERT INTO token_prices (token_address, price_usd, source, timestamp)
        VALUES ($1, $2, $3, $4)
      `, [tokenAddress, priceUSD, source, Date.now()]);
      
    } catch (error) {
      this.logger.error('Error recording token price:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getLatestTokenPrice(tokenAddress: string): Promise<number | null> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT price_usd
        FROM token_prices
        WHERE token_address = $1
        ORDER BY timestamp DESC
        LIMIT 1
      `, [tokenAddress]);

      if (result.rows.length === 0) {
        return null;
      }

      return parseFloat(result.rows[0].price_usd);
      
    } catch (error) {
      this.logger.error('Error getting latest token price:', error);
      return null;
    } finally {
      client.release();
    }
  }
}

// Keep mock for fallback
export class MockDatabaseManager implements DatabaseManager {
  private deposits: Map<string, any> = new Map();
  private withdrawals: Map<string, any> = new Map();
  private borrows: Map<string, any> = new Map();
  private repayments: Map<string, any> = new Map();
  private liquidations: Map<string, any> = new Map();

  async connect(): Promise<void> {
    // Mock connect
  }

  async disconnect(): Promise<void> {
    // Mock disconnect
  }

  async recordDeposit(data: any): Promise<{ id: string }> {
    const id = `deposit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.deposits.set(id, { ...data, id, timestamp: Date.now() });
    return { id };
  }

  async recordWithdrawal(data: any): Promise<{ id: string }> {
    const id = `withdrawal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.withdrawals.set(id, { ...data, id, timestamp: Date.now() });
    return { id };
  }

  async recordBorrow(data: any): Promise<{ id: string }> {
    const id = `borrow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.borrows.set(id, { ...data, id, timestamp: Date.now() });
    return { id };
  }

  async recordRepayment(data: any): Promise<{ id: string }> {
    const id = `repayment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.repayments.set(id, { ...data, id, timestamp: Date.now() });
    return { id };
  }

  async recordLiquidation(data: any): Promise<{ id: string }> {
    const id = `liquidation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.liquidations.set(id, { ...data, id, timestamp: Date.now() });
    return { id };
  }

  async getVaultStatistics(): Promise<any> {
    return {
      totalValueLocked: "10000000", // $10M
      totalBorrowed: "5000000", // $5M
      totalDeposits: this.deposits.size,
      totalWithdrawals: this.withdrawals.size,
      totalLiquidations: this.liquidations.size,
      utilizationRate: 0.5 // 50%
    };
  }

  async getTotalUsers(): Promise<number> {
    const allUsers = new Set();
    
    // Collect unique users from all operations
    this.deposits.forEach(deposit => allUsers.add(deposit.userAddress));
    this.withdrawals.forEach(withdrawal => allUsers.add(withdrawal.userAddress));
    this.borrows.forEach(borrow => allUsers.add(borrow.userAddress));
    this.repayments.forEach(repayment => allUsers.add(repayment.userAddress));
    this.liquidations.forEach(liquidation => allUsers.add(liquidation.userAddress));
    
    return allUsers.size;
  }
}
