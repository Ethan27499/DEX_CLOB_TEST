import { Order, Trade, User, Batch } from '../../shared/types';
import { IDatabaseManager } from './database-interface';
export declare class DatabaseManager implements IDatabaseManager {
    private pool;
    private logger;
    constructor();
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    private initializeTables;
    createUser(user: Omit<User, 'id' | 'createdAt' | 'lastActivity'>): Promise<User>;
    saveUser(user: any): Promise<User>;
    getUserByAddress(address: string): Promise<User | null>;
    getUserById(id: string): Promise<User | null>;
    getUser(userId: string): Promise<User | null>;
    saveOrder(order: Order): Promise<void>;
    updateOrder(order: Order): Promise<void>;
    getOrder(orderId: string): Promise<Order | null>;
    getOrderById(orderId: string): Promise<Order | null>;
    getOrdersByUser(userId: string): Promise<Order[]>;
    getOrdersByPair(pair: string): Promise<Order[]>;
    updateOrderStatus(orderId: string, status: Order['status'], filledAmount?: string): Promise<void>;
    getUserOrders(userId: string, limit?: number, offset?: number): Promise<Order[]>;
    saveTrade(trade: Trade): Promise<void>;
    getTrades(pair?: string, limit?: number, page?: number): Promise<Trade[]>;
    getTradesByPair(pair: string, limit?: number): Promise<Trade[]>;
    getTradesByUser(userId: string): Promise<Trade[]>;
    createBatch(): Promise<string>;
    addTradeToBatch(batchId: string, tradeId: string): Promise<void>;
    settleBatch(batchId: string, txHash: string): Promise<void>;
    getPendingBatches(): Promise<Batch[]>;
    saveBatch(batch: Batch): Promise<void>;
    updateBatch(batchId: string, updates: Partial<Batch>): Promise<void>;
    private mapRowToOrder;
    private mapRowToTrade;
    getMarketData(): Promise<any>;
    healthCheck(): Promise<{
        status: string;
        recordCounts?: any;
    }>;
    private mapRowToBatch;
    private camelToSnake;
}
//# sourceMappingURL=database.d.ts.map