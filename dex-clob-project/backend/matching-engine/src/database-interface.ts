import { Order, Trade, User, Batch } from '../../shared/types';

export interface IDatabaseManager {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  
  // User operations
  createUser(user: Omit<User, 'id' | 'createdAt' | 'lastActivity'>): Promise<User>;
  saveUser(user: any): Promise<User>;
  getUserByAddress(address: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  
  // Order operations
  saveOrder(order: Order): Promise<void>;
  getOrder(orderId: string): Promise<Order | null>;
  getOrderById(orderId: string): Promise<Order | null>;
  getOrdersByUser(userId: string): Promise<Order[]>;
  getUserOrders(userId: string, limit?: number): Promise<Order[]>;
  getOrdersByPair(pair: string): Promise<Order[]>;
  updateOrder(order: Order): Promise<void>;
  updateOrderStatus(orderId: string, status: Order['status'], filledAmount?: string): Promise<void>;
  
  // Trade operations
  saveTrade(trade: Trade): Promise<void>;
  getTrades(pair?: string, limit?: number): Promise<Trade[]>;
  getTradesByPair(pair: string, limit?: number): Promise<Trade[]>;
  getTradesByUser(userId: string): Promise<Trade[]>;
  
  // Batch operations
  createBatch(): Promise<string>;
  addTradeToBatch(batchId: string, tradeId: string): Promise<void>;
  settleBatch(batchId: string, txHash: string): Promise<void>;
  getPendingBatches(): Promise<Batch[]>;
  
  // Market data
  getMarketData(): Promise<any>;
  
  // Health check
  healthCheck(): Promise<{ status: string; recordCounts?: any }>;
}
