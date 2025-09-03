import { IDatabaseManager } from './database-interface';
import { User, Order, Trade, Batch } from '../../shared/types';

export class InMemoryDatabaseManager implements IDatabaseManager {
  private users: Map<string, User> = new Map();
  private usersByAddress: Map<string, User> = new Map();
  private orders: Map<string, Order> = new Map();
  private trades: Map<string, Trade> = new Map();
  private batches: Map<string, Batch> = new Map();
  private ordersByUser: Map<string, string[]> = new Map();
  private ordersByPair: Map<string, string[]> = new Map();
  private tradesByPair: Map<string, string[]> = new Map();
  private tradesByUser: Map<string, string[]> = new Map();

  async connect(): Promise<void> {
    console.log('✅ In-memory database initialized');
  }

  async disconnect(): Promise<void> {
    console.log('🔄 In-memory database disconnected');
  }

  async createUser(userData: Omit<User, 'id' | 'createdAt' | 'lastActivity'>): Promise<User> {
    const now = Date.now();
    const user: User = {
      id: `user_${now}_${Math.random().toString(36).substr(2, 9)}`,
      address: userData.address,
      nonce: userData.nonce || 0,
      isActive: userData.isActive ?? true,
      createdAt: now,
      lastActivity: now
    };
    
    this.users.set(user.id, user);
    this.usersByAddress.set(user.address, user);
    return user;
  }

  async saveUser(userData: any): Promise<User> {
    const existingUser = this.usersByAddress.get(userData.address);
    if (existingUser) {
      // Update existing user
      const updatedUser = { ...existingUser, ...userData, lastActivity: Date.now() };
      this.users.set(updatedUser.id, updatedUser);
      this.usersByAddress.set(updatedUser.address, updatedUser);
      return updatedUser;
    } else {
      // Create new user
      return this.createUser(userData);
    }
  }

  async getUserByAddress(address: string): Promise<User | null> {
    return this.usersByAddress.get(address) || null;
  }

  async getUserById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async saveOrder(order: Order): Promise<void> {
    this.orders.set(order.id, order);
    
    // Index by user
    if (!this.ordersByUser.has(order.userId)) {
      this.ordersByUser.set(order.userId, []);
    }
    this.ordersByUser.get(order.userId)!.push(order.id);
    
    // Index by pair
    if (!this.ordersByPair.has(order.pair)) {
      this.ordersByPair.set(order.pair, []);
    }
    this.ordersByPair.get(order.pair)!.push(order.id);
  }

  async getOrder(orderId: string): Promise<Order | null> {
    return this.orders.get(orderId) || null;
  }

  async getOrderById(orderId: string): Promise<Order | null> {
    return this.orders.get(orderId) || null;
  }

  async getOrdersByUser(userId: string): Promise<Order[]> {
    const orderIds = this.ordersByUser.get(userId) || [];
    return orderIds.map(id => this.orders.get(id)).filter(Boolean) as Order[];
  }

  async getUserOrders(userId: string, limit?: number): Promise<Order[]> {
    const orders = await this.getOrdersByUser(userId);
    return limit ? orders.slice(0, limit) : orders;
  }

  async getOrdersByPair(pair: string): Promise<Order[]> {
    const orderIds = this.ordersByPair.get(pair) || [];
    return orderIds.map(id => this.orders.get(id)).filter(Boolean) as Order[];
  }

  async updateOrder(order: Order): Promise<void> {
    this.orders.set(order.id, order);
  }

  async updateOrderStatus(orderId: string, status: Order['status'], filledAmount?: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (order) {
      order.status = status;
      if (filledAmount) {
        order.filled = filledAmount;
        order.remaining = (parseFloat(order.amount) - parseFloat(filledAmount)).toString();
      }
      this.orders.set(orderId, order);
    }
  }

  async saveTrade(trade: Trade): Promise<void> {
    this.trades.set(trade.id, trade);
    
    // Index by pair
    if (!this.tradesByPair.has(trade.pair)) {
      this.tradesByPair.set(trade.pair, []);
    }
    this.tradesByPair.get(trade.pair)!.push(trade.id);
    
    // Index by user (based on orders)
    const buyOrder = this.orders.get(trade.orderId);
    const sellOrder = this.orders.get(trade.counterOrderId);
    
    if (buyOrder) {
      if (!this.tradesByUser.has(buyOrder.userId)) {
        this.tradesByUser.set(buyOrder.userId, []);
      }
      this.tradesByUser.get(buyOrder.userId)!.push(trade.id);
    }
    
    if (sellOrder) {
      if (!this.tradesByUser.has(sellOrder.userId)) {
        this.tradesByUser.set(sellOrder.userId, []);
      }
      this.tradesByUser.get(sellOrder.userId)!.push(trade.id);
    }
  }

  async getTrades(pair?: string, limit?: number): Promise<Trade[]> {
    let trades: Trade[];
    
    if (pair) {
      const tradeIds = this.tradesByPair.get(pair) || [];
      trades = tradeIds.map(id => this.trades.get(id)).filter(Boolean) as Trade[];
    } else {
      trades = Array.from(this.trades.values());
    }
    
    // Sort by timestamp desc
    trades.sort((a, b) => b.timestamp - a.timestamp);
    
    return limit ? trades.slice(0, limit) : trades;
  }

  async getTradesByPair(pair: string, limit?: number): Promise<Trade[]> {
    return this.getTrades(pair, limit);
  }

  async getTradesByUser(userId: string): Promise<Trade[]> {
    const tradeIds = this.tradesByUser.get(userId) || [];
    const trades = tradeIds.map(id => this.trades.get(id)).filter(Boolean) as Trade[];
    return trades.sort((a, b) => b.timestamp - a.timestamp);
  }

  async createBatch(): Promise<string> {
    const id = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const batch: Batch = {
      id,
      trades: [],
      status: 'pending',
      chainId: 1,
      createdAt: Date.now()
    };
    
    this.batches.set(id, batch);
    return id;
  }

  async addTradeToBatch(batchId: string, tradeId: string): Promise<void> {
    const batch = this.batches.get(batchId);
    const trade = this.trades.get(tradeId);
    
    if (batch && trade) {
      batch.trades.push(trade);
      this.batches.set(batchId, batch);
    }
  }

  async settleBatch(batchId: string, txHash: string): Promise<void> {
    const batch = this.batches.get(batchId);
    if (batch) {
      batch.status = 'confirmed';
      batch.txHash = txHash;
      batch.confirmedAt = Date.now();
      this.batches.set(batchId, batch);
    }
  }

  async getPendingBatches(): Promise<Batch[]> {
    return Array.from(this.batches.values()).filter(batch => batch.status === 'pending');
  }

  async getMarketData(): Promise<any> {
    const marketData: any = {};
    
    // Get all pairs
    const pairs = Array.from(this.tradesByPair.keys());
    
    for (const pair of pairs) {
      const trades = await this.getTradesByPair(pair, 100);
      
      if (trades.length > 0) {
        const lastPrice = trades[0].price;
        const volume24h = trades.reduce((sum, trade) => sum + parseFloat(trade.amount), 0).toString();
        const prices = trades.map(t => parseFloat(t.price));
        const high24h = Math.max(...prices).toString();
        const low24h = Math.min(...prices).toString();
        
        // Simple price change calculation
        const priceChange24h = trades.length > 1 
          ? ((parseFloat(lastPrice) - parseFloat(trades[trades.length - 1].price)) / parseFloat(trades[trades.length - 1].price) * 100).toString()
          : '0';
        
        marketData[pair] = {
          pair,
          lastPrice,
          volume24h,
          priceChange24h,
          high24h,
          low24h,
          timestamp: Date.now()
        };
      }
    }
    
    return marketData;
  }

  async healthCheck(): Promise<{ status: string; recordCounts?: any }> {
    return {
      status: 'healthy',
      recordCounts: {
        users: this.users.size,
        orders: this.orders.size,
        trades: this.trades.size,
        batches: this.batches.size
      }
    };
  }
}
