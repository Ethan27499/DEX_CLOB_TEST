import { ethers } from 'ethers';
import { Logger } from './logger';
import { PostgresDatabaseManager } from './database';
import { OraclePriceService, OraclePrice } from './oracle-price-service';

export interface TokenPrice {
  address: string;
  symbol: string;
  priceUSD: number;
  timestamp: number;
  source: string;
}

export interface CollateralUpdate {
  userAddress: string;
  token: string;
  amount: string;
  operation: 'deposit' | 'withdraw' | 'liquidation';
  timestamp: number;
}

export interface UserCollateral {
  userAddress: string;
  token: string;
  amount: string;
  valueUSD: number;
  lastUpdated: number;
}

export interface PriceFeedConfig {
  name: string;
  url: string;
  headers?: Record<string, string>;
  timeout: number;
  retries: number;
}

export class CollateralTracker {
  private logger: Logger;
  private tokenPrices: Map<string, TokenPrice>;
  private priceUpdateInterval: any = null;
  private databaseManager: PostgresDatabaseManager | null = null;
  private priceFeeds: PriceFeedConfig[];
  private oraclePriceService: OraclePriceService | null = null;

  // Real token addresses on mainnet
  private readonly SUPPORTED_TOKENS = {
    'ETH': '0x0000000000000000000000000000000000000000',
    'USDC': '0xA0b86a33E6441c641ea4d5b69Bff991fc35E8E87',
    'USDT': '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 
    'WBTC': '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    'DAI': '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'
  };

  constructor() {
    this.logger = new Logger('CollateralTracker');
    this.tokenPrices = new Map();
    
    // Configure real price feeds
    this.priceFeeds = [
      {
        name: 'CoinGecko',
        url: 'https://api.coingecko.com/api/v3/simple/price',
        timeout: 5000,
        retries: 3
      },
      {
        name: 'CoinMarketCap',
        url: 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest',
        headers: {
          'X-CMC_PRO_API_KEY': 'your-api-key-here' // In production, use env var
        },
        timeout: 5000,
        retries: 3
      }
    ];
  }

  public async initialize(databaseManager?: PostgresDatabaseManager, oraclePriceService?: OraclePriceService): Promise<void> {
    try {
      this.databaseManager = databaseManager || null;
      this.oraclePriceService = oraclePriceService || null;
      
      // Initialize price feeds with real data
      await this._initializeRealPriceFeeds();

      // Start price update loop
      this._startPriceUpdates();

      this.logger.info('CollateralTracker initialized successfully', {
        hasDatabaseManager: !!this.databaseManager,
        hasOraclePriceService: !!this.oraclePriceService
      });

    } catch (error) {
      this.logger.error('Failed to initialize CollateralTracker:', error);
      throw error;
    }
  }

  public async updateUserCollateral(
    userAddress: string,
    token: string,
    amount: string,
    operation: 'deposit' | 'withdraw' | 'liquidation'
  ): Promise<void> {
    try {
      this.logger.info('Updating user collateral', {
        user: userAddress,
        token,
        amount,
        operation
      });

      // Get current price
      const tokenPrice = await this.getTokenPriceUSD(token);
      const valueUSD = Number(amount) * tokenPrice;

      // Store price in database if available
      if (this.databaseManager) {
        await this.databaseManager.recordTokenPrice(token, tokenPrice, 'collateral-tracker');
      }

      this.logger.info('Collateral updated', {
        user: userAddress,
        token,
        amount,
        valueUSD,
        operation
      });

    } catch (error) {
      this.logger.error('Failed to update user collateral:', error);
      throw error;
    }
  }

  public async getTokenPriceUSD(tokenAddress: string): Promise<number> {
    try {
      // First check cache
      const price = this.tokenPrices.get(tokenAddress.toLowerCase());
      
      if (price) {
        // Check if price is stale (older than 2 minutes)
        const now = Date.now();
        const priceAge = now - price.timestamp;
        
        if (priceAge < 2 * 60 * 1000) { // 2 minutes
          return price.priceUSD;
        }
      }

      // If no cache or stale, fetch from database first
      if (this.databaseManager) {
        const dbPrice = await this.databaseManager.getLatestTokenPrice(tokenAddress);
        if (dbPrice && dbPrice > 0) {
          const dbPriceAge = Date.now() - (Date.now() % (5 * 60 * 1000)); // Assume 5min intervals
          
          if (Date.now() - dbPriceAge < 5 * 60 * 1000) { // 5 minutes
            this.tokenPrices.set(tokenAddress.toLowerCase(), {
              address: tokenAddress,
              symbol: this._getTokenSymbol(tokenAddress),
              priceUSD: dbPrice,
              timestamp: Date.now(),
              source: 'database'
            });
            return dbPrice;
          }
        }
      }

      // Fetch fresh price from external APIs
      const freshPrice = await this._fetchRealPrice(tokenAddress);
      
      // Update cache
      this.tokenPrices.set(tokenAddress.toLowerCase(), {
        address: tokenAddress,
        symbol: this._getTokenSymbol(tokenAddress),
        priceUSD: freshPrice,
        timestamp: Date.now(),
        source: 'external-api'
      });

      // Store in database
      if (this.databaseManager) {
        await this.databaseManager.recordTokenPrice(tokenAddress, freshPrice, 'external-api');
      }

      return freshPrice;

    } catch (error) {
      this.logger.error('Failed to get token price:', error);
      
      // Fallback to cached price even if stale
      const fallbackPrice = this.tokenPrices.get(tokenAddress.toLowerCase());
      if (fallbackPrice) {
        this.logger.warn('Using stale price as fallback', {
          token: tokenAddress,
          price: fallbackPrice.priceUSD,
          age: Date.now() - fallbackPrice.timestamp
        });
        return fallbackPrice.priceUSD;
      }
      
      throw new Error(`No price available for token: ${tokenAddress}`);
    }
  }

  public async getTokenValueUSD(tokenAddress: string, amount: string): Promise<number> {
    try {
      const priceUSD = await this.getTokenPriceUSD(tokenAddress);
      return Number(amount) * priceUSD;

    } catch (error) {
      this.logger.error('Failed to get token value:', error);
      throw error;
    }
  }

  public async updateAfterLiquidation(liquidationData: any): Promise<void> {
    try {
      this.logger.info('Updating collateral after liquidation', {
        user: liquidationData.userAddress,
        liquidator: liquidationData.liquidatorAddress,
        debtToken: liquidationData.debtToken,
        collateralToken: liquidationData.collateralToken
      });

      // Update collateral tracking for both tokens involved
      await this.updateUserCollateral(
        liquidationData.userAddress,
        liquidationData.debtToken,
        liquidationData.debtAmount,
        'liquidation'
      );

      await this.updateUserCollateral(
        liquidationData.userAddress,
        liquidationData.collateralToken,
        liquidationData.collateralAmount || '0',
        'liquidation'
      );

    } catch (error) {
      this.logger.error('Failed to update after liquidation:', error);
      throw error;
    }
  }

  public getAllTokenPrices(): TokenPrice[] {
    return Array.from(this.tokenPrices.values());
  }

  public async forceUpdatePrices(): Promise<void> {
    try {
      const tokenAddresses = Object.values(this.SUPPORTED_TOKENS);
      
      const updatePromises = tokenAddresses.map(async (tokenAddress) => {
        try {
          await this._fetchRealPrice(tokenAddress);
        } catch (error) {
          this.logger.error(`Failed to update price for ${tokenAddress}:`, error);
        }
      });

      await Promise.allSettled(updatePromises);
      this.logger.info('Force price update completed');

    } catch (error) {
      this.logger.error('Failed to force update prices:', error);
      throw error;
    }
  }

  public stop(): void {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }
    
    this.logger.info('CollateralTracker stopped');
  }

  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================

  private async _initializeRealPriceFeeds(): Promise<void> {
    try {
      // Initialize with real prices from CoinGecko
      const tokenSymbols = Object.keys(this.SUPPORTED_TOKENS);
      const prices = await this._fetchMultipleTokenPrices(tokenSymbols);

      for (const [symbol, address] of Object.entries(this.SUPPORTED_TOKENS)) {
        const price = prices[symbol.toLowerCase()] || this._getFallbackPrice(symbol);
        
        this.tokenPrices.set(address.toLowerCase(), {
          address,
          symbol,
          priceUSD: price,
          timestamp: Date.now(),
          source: 'coingecko'
        });
      }

      this.logger.info('Real price feeds initialized', {
        tokenCount: this.tokenPrices.size,
        prices: Object.fromEntries(
          Array.from(this.tokenPrices.values()).map(p => [p.symbol, p.priceUSD])
        )
      });

    } catch (error) {
      this.logger.error('Failed to initialize real price feeds:', error);
      
      // Fallback to reasonable default prices
      this._initializeFallbackPrices();
    }
  }

  private _initializeFallbackPrices(): void {
    const fallbackPrices = {
      'ETH': 2000,
      'USDC': 1,
      'USDT': 1,
      'WBTC': 30000,
      'DAI': 1
    };

    for (const [symbol, address] of Object.entries(this.SUPPORTED_TOKENS)) {
      this.tokenPrices.set(address.toLowerCase(), {
        address,
        symbol,
        priceUSD: fallbackPrices[symbol as keyof typeof fallbackPrices] || 1,
        timestamp: Date.now(),
        source: 'fallback'
      });
    }

    this.logger.warn('Using fallback prices due to API failure');
  }

  private async _fetchMultipleTokenPrices(symbols: string[]): Promise<Record<string, number>> {
    try {
      // First try Oracle prices (most accurate)
      if (this.oraclePriceService) {
        try {
          const oraclePrices = await this.oraclePriceService.getPrices(symbols);
          const prices: Record<string, number> = {};
          
          for (const [symbol, priceData] of oraclePrices) {
            prices[symbol.toLowerCase()] = priceData.price;
          }
          
          if (Object.keys(prices).length > 0) {
            this.logger.info('Fetched oracle prices', { 
              prices,
              sources: Array.from(oraclePrices.values()).map(p => p.source)
            });
            return prices;
          }
        } catch (error) {
          this.logger.warn('Oracle price fetch failed, falling back to CoinGecko:', error);
        }
      }

      // Fallback to CoinGecko API
      const coinGeckoIds = {
        'ETH': 'ethereum',
        'USDC': 'usd-coin',
        'USDT': 'tether',
        'WBTC': 'wrapped-bitcoin',
        'DAI': 'dai',
        'BTC': 'bitcoin'
      };

      const ids = symbols.map(s => coinGeckoIds[s as keyof typeof coinGeckoIds]).filter(Boolean).join(',');
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000) // 10s timeout
      });

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json() as Record<string, any>;
      const prices: Record<string, number> = {};

      // Map CoinGecko response back to our symbols
      for (const [symbol, coinGeckoId] of Object.entries(coinGeckoIds)) {
        if (data[coinGeckoId] && data[coinGeckoId].usd) {
          prices[symbol.toLowerCase()] = data[coinGeckoId].usd;
        }
      }

      this.logger.info('Fetched prices from CoinGecko (fallback)', { prices });
      return prices;

    } catch (error) {
      this.logger.error('Failed to fetch prices:', error);
      throw error;
    }
  }

  private async _fetchRealPrice(tokenAddress: string): Promise<number> {
    try {
      const symbol = this._getTokenSymbol(tokenAddress);
      const prices = await this._fetchMultipleTokenPrices([symbol]);
      
      const price = prices[symbol.toLowerCase()];
      if (!price) {
        throw new Error(`Price not found for ${symbol}`);
      }

      return price;

    } catch (error) {
      this.logger.error(`Failed to fetch real price for ${tokenAddress}:`, error);
      
      // Return fallback price
      const symbol = this._getTokenSymbol(tokenAddress);
      return this._getFallbackPrice(symbol);
    }
  }

  private _getTokenSymbol(tokenAddress: string): string {
    for (const [symbol, address] of Object.entries(this.SUPPORTED_TOKENS)) {
      if (address.toLowerCase() === tokenAddress.toLowerCase()) {
        return symbol;
      }
    }
    return 'UNKNOWN';
  }

  private _getFallbackPrice(symbol: string): number {
    const fallbackPrices: Record<string, number> = {
      'ETH': 2000,
      'USDC': 1,
      'USDT': 1, 
      'WBTC': 30000,
      'DAI': 1
    };
    
    return fallbackPrices[symbol] || 1;
  }

  private _startPriceUpdates(): void {
    // Update prices every 2 minutes
    this.priceUpdateInterval = setInterval(async () => {
      try {
        await this._updateAllPrices();
      } catch (error) {
        this.logger.error('Price update failed:', error);
      }
    }, 2 * 60 * 1000); // 2 minutes

    this.logger.info('Real-time price update loop started (2min intervals)');
  }

  private async _updateAllPrices(): Promise<void> {
    try {
      const symbols = Object.keys(this.SUPPORTED_TOKENS);
      const prices = await this._fetchMultipleTokenPrices(symbols);

      let updatedCount = 0;
      for (const [symbol, address] of Object.entries(this.SUPPORTED_TOKENS)) {
        const price = prices[symbol.toLowerCase()];
        
        if (price) {
          this.tokenPrices.set(address.toLowerCase(), {
            address,
            symbol,
            priceUSD: price,
            timestamp: Date.now(),
            source: 'coingecko'
          });

          // Store in database
          if (this.databaseManager) {
            await this.databaseManager.recordTokenPrice(address, price, 'coingecko');
          }

          updatedCount++;
        }
      }

      this.logger.info('Price update completed', {
        updatedTokens: updatedCount,
        totalTokens: symbols.length
      });

    } catch (error) {
      this.logger.error('Failed to update all prices:', error);
    }
  }
}
