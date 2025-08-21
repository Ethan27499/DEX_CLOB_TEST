"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RATE_LIMITS = exports.FEES = exports.AMOUNT_PRECISION = exports.PRICE_PRECISION = exports.DECIMAL_PRECISION = exports.DEFAULT_PAGINATION = exports.API_ENDPOINTS = exports.WEBSOCKET_EVENTS = exports.BATCH_STATUS = exports.ORDER_STATUS = exports.ORDER_SIDES = exports.ORDER_TYPES = exports.TRADING_PAIRS = exports.SUPPORTED_CHAINS = void 0;
exports.SUPPORTED_CHAINS = {
    OPTIMISM: {
        chainId: 10,
        name: 'Optimism',
        symbol: 'OP',
        rpcUrls: ['https://mainnet.optimism.io'],
        blockTime: 2000,
    },
    PLASMA: {
        chainId: 1001,
        name: 'Plasma',
        symbol: 'PLASMA',
        rpcUrls: ['https://rpc.plasma.network'],
        blockTime: 12000,
    },
    PRAXIS: {
        chainId: 2001,
        name: 'Praxis',
        symbol: 'PRAX',
        rpcUrls: ['https://rpc.praxis.network'],
        blockTime: 3000,
    },
};
exports.TRADING_PAIRS = [
    'ETH/USDC',
    'BTC/USDC',
    'PRAX/USDC',
    'OP/USDC',
    'ETH/PRAX',
    'BTC/ETH',
];
exports.ORDER_TYPES = {
    LIMIT: 'limit',
    MARKET: 'market',
};
exports.ORDER_SIDES = {
    BUY: 'buy',
    SELL: 'sell',
};
exports.ORDER_STATUS = {
    PENDING: 'pending',
    PARTIAL: 'partial',
    FILLED: 'filled',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired',
};
exports.BATCH_STATUS = {
    PENDING: 'pending',
    SUBMITTED: 'submitted',
    CONFIRMED: 'confirmed',
    FAILED: 'failed',
};
exports.WEBSOCKET_EVENTS = {
    ORDER_PLACED: 'order_placed',
    ORDER_CANCELLED: 'order_cancelled',
    ORDER_FILLED: 'order_filled',
    ORDER_PARTIAL_FILL: 'order_partial_fill',
    ORDERBOOK_UPDATE: 'orderbook_update',
    ORDERBOOK_SNAPSHOT: 'orderbook_snapshot',
    TRADE_EXECUTED: 'trade_executed',
    BATCH_CREATED: 'batch_created',
    BATCH_SUBMITTED: 'batch_submitted',
    BATCH_CONFIRMED: 'batch_confirmed',
    BATCH_FAILED: 'batch_failed',
    PRICE_UPDATE: 'price_update',
    MARKET_DATA_UPDATE: 'market_data_update',
    BALANCE_UPDATE: 'balance_update',
    CONNECTION_ESTABLISHED: 'connection_established',
    HEARTBEAT: 'heartbeat',
    ERROR: 'error',
};
exports.API_ENDPOINTS = {
    PLACE_ORDER: '/api/v1/orders',
    CANCEL_ORDER: '/api/v1/orders/:id/cancel',
    GET_ORDERS: '/api/v1/orders',
    GET_ORDER: '/api/v1/orders/:id',
    GET_TRADES: '/api/v1/trades',
    GET_USER_TRADES: '/api/v1/users/:userId/trades',
    GET_ORDERBOOK: '/api/v1/orderbook/:pair',
    GET_MARKET_DATA: '/api/v1/market-data',
    GET_PAIR_DATA: '/api/v1/market-data/:pair',
    GET_BATCHES: '/api/v1/batches',
    GET_BATCH: '/api/v1/batches/:id',
    HEALTH: '/health',
    METRICS: '/metrics',
};
exports.DEFAULT_PAGINATION = {
    limit: 50,
    offset: 0,
    maxLimit: 1000,
};
exports.DECIMAL_PRECISION = 18;
exports.PRICE_PRECISION = 8;
exports.AMOUNT_PRECISION = 8;
exports.FEES = {
    MAKER_FEE: '0.001',
    TAKER_FEE: '0.002',
    SETTLEMENT_FEE: '0.0001',
};
exports.RATE_LIMITS = {
    PLACE_ORDER: {
        windowMs: 60000,
        max: 100,
    },
    CANCEL_ORDER: {
        windowMs: 60000,
        max: 200,
    },
    API_CALLS: {
        windowMs: 900000,
        max: 1000,
    },
};
//# sourceMappingURL=constants.js.map