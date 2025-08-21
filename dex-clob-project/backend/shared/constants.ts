export const SUPPORTED_CHAINS = {
  OPTIMISM: {
    chainId: 10,
    name: 'Optimism',
    symbol: 'OP',
    rpcUrls: ['https://mainnet.optimism.io'],
    blockTime: 2000, // 2 seconds
  },
  PLASMA: {
    chainId: 1001,
    name: 'Plasma',
    symbol: 'PLASMA',
    rpcUrls: ['https://rpc.plasma.network'],
    blockTime: 12000, // 12 seconds
  },
  PRAXIS: {
    chainId: 2001,
    name: 'Praxis',
    symbol: 'PRAX',
    rpcUrls: ['https://rpc.praxis.network'],
    blockTime: 3000, // 3 seconds
  },
} as const;

export const TRADING_PAIRS = [
  'ETH/USDC',
  'BTC/USDC',
  'PRAX/USDC',
  'OP/USDC',
  'ETH/PRAX',
  'BTC/ETH',
] as const;

export const ORDER_TYPES = {
  LIMIT: 'limit',
  MARKET: 'market',
} as const;

export const ORDER_SIDES = {
  BUY: 'buy',
  SELL: 'sell',
} as const;

export const ORDER_STATUS = {
  PENDING: 'pending',
  PARTIAL: 'partial',
  FILLED: 'filled',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const;

export const BATCH_STATUS = {
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
} as const;

export const WEBSOCKET_EVENTS = {
  // Order events
  ORDER_PLACED: 'order_placed',
  ORDER_CANCELLED: 'order_cancelled',
  ORDER_FILLED: 'order_filled',
  ORDER_PARTIAL_FILL: 'order_partial_fill',
  
  // Orderbook events
  ORDERBOOK_UPDATE: 'orderbook_update',
  ORDERBOOK_SNAPSHOT: 'orderbook_snapshot',
  
  // Trade events
  TRADE_EXECUTED: 'trade_executed',
  
  // Batch events
  BATCH_CREATED: 'batch_created',
  BATCH_SUBMITTED: 'batch_submitted',
  BATCH_CONFIRMED: 'batch_confirmed',
  BATCH_FAILED: 'batch_failed',
  
  // Market data events
  PRICE_UPDATE: 'price_update',
  MARKET_DATA_UPDATE: 'market_data_update',
  
  // User events
  BALANCE_UPDATE: 'balance_update',
  
  // System events
  CONNECTION_ESTABLISHED: 'connection_established',
  HEARTBEAT: 'heartbeat',
  ERROR: 'error',
} as const;

export const API_ENDPOINTS = {
  // Orders
  PLACE_ORDER: '/api/v1/orders',
  CANCEL_ORDER: '/api/v1/orders/:id/cancel',
  GET_ORDERS: '/api/v1/orders',
  GET_ORDER: '/api/v1/orders/:id',
  
  // Trades
  GET_TRADES: '/api/v1/trades',
  GET_USER_TRADES: '/api/v1/users/:userId/trades',
  
  // Orderbook
  GET_ORDERBOOK: '/api/v1/orderbook/:pair',
  
  // Market data
  GET_MARKET_DATA: '/api/v1/market-data',
  GET_PAIR_DATA: '/api/v1/market-data/:pair',
  
  // Batches
  GET_BATCHES: '/api/v1/batches',
  GET_BATCH: '/api/v1/batches/:id',
  
  // Health
  HEALTH: '/health',
  METRICS: '/metrics',
} as const;

export const DEFAULT_PAGINATION = {
  limit: 50,
  offset: 0,
  maxLimit: 1000,
} as const;

export const DECIMAL_PRECISION = 18;
export const PRICE_PRECISION = 8;
export const AMOUNT_PRECISION = 8;

export const FEES = {
  MAKER_FEE: '0.001', // 0.1%
  TAKER_FEE: '0.002', // 0.2%
  SETTLEMENT_FEE: '0.0001', // 0.01%
} as const;

export const RATE_LIMITS = {
  PLACE_ORDER: {
    windowMs: 60000, // 1 minute
    max: 100, // 100 orders per minute
  },
  CANCEL_ORDER: {
    windowMs: 60000,
    max: 200, // 200 cancellations per minute
  },
  API_CALLS: {
    windowMs: 900000, // 15 minutes
    max: 1000, // 1000 calls per 15 minutes
  },
} as const;
