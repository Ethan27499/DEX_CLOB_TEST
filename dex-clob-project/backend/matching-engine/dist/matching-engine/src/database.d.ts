import { Order, Trade, User, Batch } from '../../shared/types';
export declare class DatabaseManager {
    private pool;
    private logger;
    constructor();
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    private initializeTables;
    saveUser(user: User): Promise<void>;
    getUser(userId: string): Promise<User | null>;
    saveOrder(order: Order): Promise<void>;
    updateOrder(order: Order): Promise<void>;
    getOrder(orderId: string): Promise<Order | null>;
    getUserOrders(userId: string, limit?: number, offset?: number): Promise<Order[]>;
    saveTrade(trade: Trade): Promise<void>;
    getTrades(pair?: string, limit?: number, page?: number): Promise<Trade[]>;
    saveBatch(batch: Batch): Promise<void>;
    updateBatch(batchId: string, updates: Partial<Batch>): Promise<void>;
    private mapRowToOrder;
    private mapRowToTrade;
    private camelToSnake;
}
//# sourceMappingURL=database.d.ts.map