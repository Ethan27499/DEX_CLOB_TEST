import { DatabaseManager } from './database';
export interface ContractConfig {
    hybridCLOBAddress: string;
    tokens: {
        [symbol: string]: string;
    };
    rpcUrl: string;
    privateKey: string;
    chainId: number;
}
export declare class ContractManager {
    private config;
    private provider;
    private signer;
    private hybridCLOB;
    private tokens;
    private db;
    private logger;
    constructor(config: ContractConfig, databaseManager: DatabaseManager);
    private initializeProvider;
    settleBatch(buyOrderIds: number[], sellOrderIds: number[], amounts: string[], prices: string[]): Promise<string>;
    validateOrderOnChain(order: any): Promise<boolean>;
    startEventListeners(): void;
    getContractStats(): Promise<{
        nextOrderId: string;
        nextTradeId: string;
        makerFee: string;
        takerFee: string;
    }>;
    getTokenInfo(symbol: string): Promise<{
        symbol: string;
        name: string;
        decimals: number;
        totalSupply: string;
        address: string;
    }>;
}
//# sourceMappingURL=contract-manager.d.ts.map