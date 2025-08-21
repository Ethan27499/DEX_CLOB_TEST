export interface Order {
    id: string;
    userId: string;
    pair: string;
    side: 'buy' | 'sell';
    type: 'limit' | 'market';
    price: string;
    amount: string;
    filled: string;
    remaining: string;
    status: 'pending' | 'partial' | 'filled' | 'cancelled' | 'expired';
    timestamp: number;
    nonce: number;
    signature: string;
    chainId: number;
    expiresAt?: number;
}
export interface Trade {
    id: string;
    orderId: string;
    counterOrderId: string;
    pair: string;
    side: 'buy' | 'sell';
    price: string;
    amount: string;
    fee: string;
    timestamp: number;
    blockNumber?: number;
    txHash?: string;
    chainId: number;
}
export interface OrderBook {
    pair: string;
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
    lastUpdate: number;
}
export interface OrderBookLevel {
    price: string;
    amount: string;
    orderCount: number;
}
export interface Batch {
    id: string;
    trades: Trade[];
    status: 'pending' | 'submitted' | 'confirmed' | 'failed';
    chainId: number;
    txHash?: string;
    blockNumber?: number;
    createdAt: number;
    submittedAt?: number;
    confirmedAt?: number;
    gasUsed?: string;
    gasPrice?: string;
}
export interface ChainConfig {
    chainId: number;
    name: string;
    rpcUrl: string;
    contractAddress: string;
    privateKey: string;
    gasLimit: number;
    gasPrice?: string;
    blockTime: number;
}
export interface User {
    id: string;
    address: string;
    nonce: number;
    isActive: boolean;
    createdAt: number;
    lastActivity: number;
}
export interface MarketData {
    pair: string;
    lastPrice: string;
    priceChange24h: string;
    volume24h: string;
    high24h: string;
    low24h: string;
    timestamp: number;
}
export interface BalanceUpdate {
    userId: string;
    token: string;
    balance: string;
    chainId: number;
    timestamp: number;
}
export interface DisputeEvidence {
    batchId: string;
    evidence: any;
    submitter: string;
    timestamp: number;
}
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market';
export type OrderStatus = 'pending' | 'partial' | 'filled' | 'cancelled' | 'expired';
export type BatchStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';
//# sourceMappingURL=types.d.ts.map