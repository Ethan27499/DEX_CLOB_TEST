import { Router } from 'express';
import { OrderBookManager } from './orderbook';
import { DatabaseManager } from './database';
import { ContractManager } from './contract-manager';
export declare class APIRouter {
    private router;
    private orderBookManager;
    private databaseManager;
    private contractManager?;
    private logger;
    constructor(orderBookManager: OrderBookManager, databaseManager: DatabaseManager, contractManager?: ContractManager);
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
    private getContractStats;
    private validateOrderOnChain;
    private getOrderbookDepth;
    private getOrderbookTrades;
    private seedOrderbook;
    getRouter(): Router;
}
//# sourceMappingURL=routes.d.ts.map