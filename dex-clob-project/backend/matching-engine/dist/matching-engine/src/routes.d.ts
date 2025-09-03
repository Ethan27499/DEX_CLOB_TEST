import { Router } from 'express';
import { OrderBookManager } from './orderbook';
import { IDatabaseManager } from './database-interface';
import { ContractManager } from './contract-manager';
import { MockContractManager } from './contract-manager-mock';
export declare class APIRouter {
    private router;
    private orderBookManager;
    private databaseManager;
    private contractManager?;
    private logger;
    constructor(orderBookManager: OrderBookManager, databaseManager: IDatabaseManager, contractManager?: ContractManager | MockContractManager);
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