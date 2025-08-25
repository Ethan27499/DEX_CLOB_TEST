import { ethers } from 'ethers';
import { Logger } from './logger';

// Chainlink Price Feed ABI
const CHAINLINK_ABI = [
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() external view returns (uint8)"
];

// Pyth Network Interface
interface PythPriceData {
  id: string;
  price: {
    price: string;
    conf: string;
    expo: number;
    publishTime: number;
  };
  emaPrice: {
    price: string;
    conf: string;
    expo: number;
    publishTime: number;
  };
}

export interface OraclePrice {
  price: number;
  confidence: number;
  timestamp: number;
  source: 'chainlink' | 'pyth' | 'fallback';
  priceDecimals: number; // Decimals of the price feed (usually 8 for USD pairs)
  tokenDecimals: number; // Decimals of the actual token (18 for ETH, 6 for USDC, etc.)
}

export interface OracleConfig {
  symbol: string;
  chainlinkAddress?: string;
  pythPriceId?: string;
  fallbackPrice: number;
  maxDeviation: number; // Maximum allowed deviation between oracles (%)
  stalePriceThreshold: number; // Time in seconds to consider price stale
}

export class OraclePriceService {
  private logger: Logger;
  private provider: ethers.Provider;
  private chainlinkFeeds: Map<string, ethers.Contract>;
  private pythEndpoint: string;
  
  // Token decimals mapping (actual token decimals)
  private readonly TOKEN_DECIMALS = {
    'ETH': 18,
    'BTC': 8,   // Bitcoin has 8 decimals
    'WBTC': 8,  // Wrapped Bitcoin has 8 decimals
    'USDC': 6,  // USDC has 6 decimals
    'USDT': 6,  // USDT has 6 decimals  
    'DAI': 18   // DAI has 18 decimals
  };
  
  // Mainnet Chainlink Price Feeds
  private readonly CHAINLINK_FEEDS = {
    'ETH': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', // ETH/USD
    'BTC': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c', // BTC/USD  
    'USDC': '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6', // USDC/USD
    'USDT': '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D', // USDT/USD
    'DAI': '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9'   // DAI/USD
  };

  // Pyth Price IDs (mainnet)
  private readonly PYTH_PRICE_IDS = {
    'ETH': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH/USD
    'BTC': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC/USD
    'USDC': '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a', // USDC/USD
    'USDT': '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b', // USDT/USD
    'DAI': '0xb0948a5e5313200c632b51bb5ca32f6de0d36e9950a942d19751e833f70dabfd'   // DAI/USD
  };

  constructor(provider: ethers.Provider, pythEndpoint: string = 'https://hermes.pyth.network') {
    this.logger = new Logger('OraclePriceService');
    this.provider = provider;
    this.chainlinkFeeds = new Map();
    this.pythEndpoint = pythEndpoint;
  }

  public async initialize(): Promise<void> {
    try {
      // Initialize Chainlink price feeds
      for (const [symbol, address] of Object.entries(this.CHAINLINK_FEEDS)) {
        const feed = new ethers.Contract(address, CHAINLINK_ABI, this.provider);
        this.chainlinkFeeds.set(symbol, feed);
      }

      this.logger.info('Oracle Price Service initialized', {
        chainlinkFeeds: this.chainlinkFeeds.size,
        pythPriceIds: Object.keys(this.PYTH_PRICE_IDS).length
      });

    } catch (error) {
      this.logger.error('Failed to initialize Oracle Price Service:', error);
      throw error;
    }
  }

  public async getPrice(symbol: string): Promise<OraclePrice> {
    try {
      const config: OracleConfig = {
        symbol,
        chainlinkAddress: this.CHAINLINK_FEEDS[symbol as keyof typeof this.CHAINLINK_FEEDS],
        pythPriceId: this.PYTH_PRICE_IDS[symbol as keyof typeof this.PYTH_PRICE_IDS],
        fallbackPrice: this._getFallbackPrice(symbol),
        maxDeviation: 5, // 5% max deviation
        stalePriceThreshold: 3600 // 1 hour
      };

      // Try Chainlink first (most reliable for mainnet)
      const chainlinkPrice = await this._getChainlinkPrice(config);
      if (chainlinkPrice && this._isPriceValid(chainlinkPrice, config)) {
        this.logger.debug('Using Chainlink price', { symbol, price: chainlinkPrice });
        return chainlinkPrice;
      }

      // Fallback to Pyth Network
      const pythPrice = await this._getPythPrice(config);
      if (pythPrice && this._isPriceValid(pythPrice, config)) {
        this.logger.debug('Using Pyth price', { symbol, price: pythPrice });
        return pythPrice;
      }

      // Final fallback to external API or static price
      this.logger.warn('Using fallback price for', { symbol });
      return {
        price: config.fallbackPrice,
        confidence: 0,
        timestamp: Date.now(),
        source: 'fallback',
        priceDecimals: 8,
        tokenDecimals: this._getTokenDecimals(symbol)
      };

    } catch (error) {
      this.logger.error(`Failed to get oracle price for ${symbol}:`, error);
      throw error;
    }
  }

  public async getPrices(symbols: string[]): Promise<Map<string, OraclePrice>> {
    const prices = new Map<string, OraclePrice>();
    
    // Fetch prices in parallel for better performance
    const pricePromises = symbols.map(async (symbol) => {
      try {
        const price = await this.getPrice(symbol);
        return { symbol, price };
      } catch (error) {
        this.logger.error(`Failed to fetch price for ${symbol}:`, error);
        return { 
          symbol, 
          price: {
            price: this._getFallbackPrice(symbol),
            confidence: 0,
            timestamp: Date.now(),
            source: 'fallback' as const,
            priceDecimals: 8,
            tokenDecimals: this._getTokenDecimals(symbol)
          }
        };
      }
    });

    const results = await Promise.allSettled(pricePromises);
    
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        prices.set(result.value.symbol, result.value.price);
      }
    });

    return prices;
  }

  public async validatePriceDeviation(symbol: string, externalPrice: number): Promise<boolean> {
    try {
      const oraclePrice = await this.getPrice(symbol);
      const deviation = Math.abs(oraclePrice.price - externalPrice) / oraclePrice.price * 100;
      
      this.logger.info('Price deviation check', {
        symbol,
        oraclePrice: oraclePrice.price,
        externalPrice,
        deviation: `${deviation.toFixed(2)}%`,
        source: oraclePrice.source
      });

      return deviation <= 5; // 5% max allowed deviation
      
    } catch (error) {
      this.logger.error('Price validation failed:', error);
      return false;
    }
  }

  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================

  private async _getChainlinkPrice(config: OracleConfig): Promise<OraclePrice | null> {
    try {
      if (!config.chainlinkAddress) {
        return null;
      }

      const feed = this.chainlinkFeeds.get(config.symbol);
      if (!feed) {
        this.logger.warn(`Chainlink feed not found for ${config.symbol}`);
        return null;
      }

      // Add timeout for Chainlink calls
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Chainlink timeout')), 10000);
      });

      // Get latest round data with timeout
      const [roundId, answer, startedAt, updatedAt, answeredInRound] = await Promise.race([
        feed.latestRoundData(),
        timeoutPromise
      ]) as any;
      
      const decimals = await Promise.race([
        feed.decimals(),
        timeoutPromise
      ]) as any;

      // Convert price to USD (Chainlink prices are in wei/decimals)
      const price = Number(answer) / Math.pow(10, Number(decimals));
      const timestamp = Number(updatedAt) * 1000; // Convert to milliseconds

      // Check if price is stale
      const priceAge = Date.now() - timestamp;
      if (priceAge > config.stalePriceThreshold * 1000) {
        this.logger.warn('Chainlink price is stale', {
          symbol: config.symbol,
          priceAge: priceAge / 1000,
          threshold: config.stalePriceThreshold
        });
        return null;
      }

      return {
        price,
        confidence: 99, // Chainlink is highly reliable
        timestamp,
        source: 'chainlink',
        priceDecimals: Number(decimals),
        tokenDecimals: this._getTokenDecimals(config.symbol)
      };

    } catch (error) {
      this.logger.error(`Chainlink price fetch failed for ${config.symbol}:`, error);
      return null;
    }
  }

  private async _getPythPrice(config: OracleConfig): Promise<OraclePrice | null> {
    try {
      if (!config.pythPriceId) {
        return null;
      }

      // Fetch from Pyth API with better URL and longer timeout
      const response = await fetch(
        `${this.pythEndpoint}/api/latest_price_feeds?ids[]=${config.pythPriceId}`,
        {
          method: 'GET',
          headers: { 
            'Accept': 'application/json',
            'User-Agent': 'DEX-Oracle/1.0'
          },
          signal: AbortSignal.timeout(15000) // Increase timeout to 15s
        }
      );

      if (!response.ok) {
        throw new Error(`Pyth API error: ${response.status}`);
      }

      const data = await response.json() as PythPriceData[];
      
      if (!data || data.length === 0) {
        throw new Error('No Pyth price data received');
      }

      const priceData = data[0];
      const price = Number(priceData.price.price) * Math.pow(10, priceData.price.expo);
      const confidence = Number(priceData.price.conf) * Math.pow(10, priceData.price.expo);
      const timestamp = priceData.price.publishTime * 1000;

      // Check if price is stale
      const priceAge = Date.now() - timestamp;
      if (priceAge > config.stalePriceThreshold * 1000) {
        this.logger.warn('Pyth price is stale', {
          symbol: config.symbol,
          priceAge: priceAge / 1000,
          threshold: config.stalePriceThreshold
        });
        return null;
      }

      return {
        price,
        confidence: confidence > 0 ? Math.min(95, 100 - (confidence / price * 100)) : 90,
        timestamp,
        source: 'pyth',
        priceDecimals: Math.abs(priceData.price.expo),
        tokenDecimals: this._getTokenDecimals(config.symbol)
      };

    } catch (error) {
      this.logger.error(`Pyth price fetch failed for ${config.symbol}:`, error);
      return null;
    }
  }

  private _isPriceValid(price: OraclePrice, config: OracleConfig): boolean {
    // Check if price is reasonable (not zero, not negative)
    if (price.price <= 0) {
      return false;
    }

    // Check if price is not too far from expected range
    const fallbackPrice = config.fallbackPrice;
    const deviation = Math.abs(price.price - fallbackPrice) / fallbackPrice * 100;
    
    if (deviation > 50) { // 50% max deviation from fallback
      this.logger.warn('Price deviation too high', {
        symbol: config.symbol,
        oraclePrice: price.price,
        fallbackPrice,
        deviation: `${deviation.toFixed(2)}%`
      });
      return false;
    }

    // Check timestamp (not too old)
    const priceAge = Date.now() - price.timestamp;
    if (priceAge > config.stalePriceThreshold * 1000) {
      return false;
    }

    return true;
  }

  private _getFallbackPrice(symbol: string): number {
    // Updated fallback prices based on current market
    const fallbackPrices: Record<string, number> = {
      'ETH': 4600,
      'BTC': 112000,
      'WBTC': 112000, // Same as BTC
      'USDC': 1,
      'USDT': 1,
      'DAI': 1
    };
    
    return fallbackPrices[symbol] || 1;
  }

  private _getTokenDecimals(symbol: string): number {
    return this.TOKEN_DECIMALS[symbol as keyof typeof this.TOKEN_DECIMALS] || 18;
  }
}
