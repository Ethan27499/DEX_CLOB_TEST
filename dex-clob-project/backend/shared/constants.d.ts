export declare const SUPPORTED_CHAINS: {
    readonly OPTIMISM: {
        readonly chainId: 10;
        readonly name: "Optimism";
        readonly symbol: "OP";
        readonly rpcUrls: readonly ["https://mainnet.optimism.io"];
        readonly blockTime: 2000;
    };
    readonly PLASMA: {
        readonly chainId: 1001;
        readonly name: "Plasma";
        readonly symbol: "PLASMA";
        readonly rpcUrls: readonly ["https://rpc.plasma.network"];
        readonly blockTime: 12000;
    };
    readonly PRAXIS: {
        readonly chainId: 2001;
        readonly name: "Praxis";
        readonly symbol: "PRAX";
        readonly rpcUrls: readonly ["https://rpc.praxis.network"];
        readonly blockTime: 3000;
    };
};
export declare const TRADING_PAIRS: readonly ["ETH/USDC", "BTC/USDC", "PRAX/USDC", "OP/USDC", "ETH/PRAX", "BTC/ETH"];
export declare const ORDER_TYPES: {
    readonly LIMIT: "limit";
    readonly MARKET: "market";
};
export declare const ORDER_SIDES: {
    readonly BUY: "buy";
    readonly SELL: "sell";
};
export declare const ORDER_STATUS: {
    readonly PENDING: "pending";
    readonly PARTIAL: "partial";
    readonly FILLED: "filled";
    readonly CANCELLED: "cancelled";
    readonly EXPIRED: "expired";
};
export declare const BATCH_STATUS: {
    readonly PENDING: "pending";
    readonly SUBMITTED: "submitted";
    readonly CONFIRMED: "confirmed";
    readonly FAILED: "failed";
};
export declare const WEBSOCKET_EVENTS: {
    readonly ORDER_PLACED: "order_placed";
    readonly ORDER_CANCELLED: "order_cancelled";
    readonly ORDER_FILLED: "order_filled";
    readonly ORDER_PARTIAL_FILL: "order_partial_fill";
    readonly ORDERBOOK_UPDATE: "orderbook_update";
    readonly ORDERBOOK_SNAPSHOT: "orderbook_snapshot";
    readonly TRADE_EXECUTED: "trade_executed";
    readonly BATCH_CREATED: "batch_created";
    readonly BATCH_SUBMITTED: "batch_submitted";
    readonly BATCH_CONFIRMED: "batch_confirmed";
    readonly BATCH_FAILED: "batch_failed";
    readonly PRICE_UPDATE: "price_update";
    readonly MARKET_DATA_UPDATE: "market_data_update";
    readonly BALANCE_UPDATE: "balance_update";
    readonly CONNECTION_ESTABLISHED: "connection_established";
    readonly HEARTBEAT: "heartbeat";
    readonly ERROR: "error";
};
export declare const API_ENDPOINTS: {
    readonly PLACE_ORDER: "/api/v1/orders";
    readonly CANCEL_ORDER: "/api/v1/orders/:id/cancel";
    readonly GET_ORDERS: "/api/v1/orders";
    readonly GET_ORDER: "/api/v1/orders/:id";
    readonly GET_TRADES: "/api/v1/trades";
    readonly GET_USER_TRADES: "/api/v1/users/:userId/trades";
    readonly GET_ORDERBOOK: "/api/v1/orderbook/:pair";
    readonly GET_MARKET_DATA: "/api/v1/market-data";
    readonly GET_PAIR_DATA: "/api/v1/market-data/:pair";
    readonly GET_BATCHES: "/api/v1/batches";
    readonly GET_BATCH: "/api/v1/batches/:id";
    readonly HEALTH: "/health";
    readonly METRICS: "/metrics";
};
export declare const DEFAULT_PAGINATION: {
    readonly limit: 50;
    readonly offset: 0;
    readonly maxLimit: 1000;
};
export declare const DECIMAL_PRECISION = 18;
export declare const PRICE_PRECISION = 8;
export declare const AMOUNT_PRECISION = 8;
export declare const FEES: {
    readonly MAKER_FEE: "0.001";
    readonly TAKER_FEE: "0.002";
    readonly SETTLEMENT_FEE: "0.0001";
};
export declare const RATE_LIMITS: {
    readonly PLACE_ORDER: {
        readonly windowMs: 60000;
        readonly max: 100;
    };
    readonly CANCEL_ORDER: {
        readonly windowMs: 60000;
        readonly max: 200;
    };
    readonly API_CALLS: {
        readonly windowMs: 900000;
        readonly max: 1000;
    };
};
//# sourceMappingURL=constants.d.ts.map