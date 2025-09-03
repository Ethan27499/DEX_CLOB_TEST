import { IDatabaseManager } from './database-interface';
import { Logger } from './logger';

export interface ContractConfig {
  hybridCLOBAddress: string;
  tokens: {
    [symbol: string]: string;
  };
  rpcUrl: string;
  privateKey: string;
  chainId: number;
}

export class MockContractManager {
  private logger: Logger;
  private databaseManager: IDatabaseManager;
  private config: ContractConfig;

  constructor(config: ContractConfig, databaseManager: IDatabaseManager) {
    this.config = config;
    this.databaseManager = databaseManager;
    this.logger = new Logger('MockContractManager');
    this.logger.info('Mock contract manager initialized (off-chain mode)', {
      hybridCLOB: config.hybridCLOBAddress,
      network: config.chainId
    });
  }

  public async validateOrderOnChain(order: any): Promise<boolean> {
    this.logger.info('Mock order validation (always returns true)', { orderId: order.id });
    return true;
  }

  public async getContractStats(): Promise<any> {
    return {
      mode: 'mock',
      totalOrders: 0,
      totalTrades: 0,
      totalVolume: '0',
      lastUpdate: Date.now()
    };
  }

  public async startEventListeners(): Promise<void> {
    this.logger.info('Mock event listeners started (no-op)');
  }

  public async stopEventListeners(): Promise<void> {
    this.logger.info('Mock event listeners stopped (no-op)');
  }
}
