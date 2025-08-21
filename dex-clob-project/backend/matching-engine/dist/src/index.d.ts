import express from 'express';
import { OrderBookManager } from './orderbook';
export declare class MatchingEngineServer {
    private app;
    private server;
    private io;
    private orderBookManager;
    private databaseManager;
    private wsManager;
    private logger;
    constructor();
    private setupMiddleware;
    private setupRoutes;
    private setupEventHandlers;
    start(): Promise<void>;
    private gracefulShutdown;
    getApp(): express.Application;
    getServer(): any;
    getOrderBookManager(): OrderBookManager;
}
//# sourceMappingURL=index.d.ts.map