import { Router } from 'express';
import { OrderBookManager } from './orderbook';
import { DatabaseManager } from './database';
export declare class APIRouter {
    private router;
    private orderBookManager;
    private databaseManager;
    private logger;
    constructor(orderBookManager: OrderBookManager, databaseManager: DatabaseManager);
    private setupRoutes;
    private createOrderRateLimit;
    private cancelOrderRateLimit;
    private placeOrder;
    private cancelOrder;
    private getOrders;
    private getOrder;
    private getTrades;
    private getUserTrades;
    private getOrderbook;
    private getMarketData;
    private getPairData;
    private getBatches;
    private getBatch;
    getRouter(): Router;
}
//# sourceMappingURL=routes.d.ts.map