import Big from 'big.js';
import { Order, Trade } from './types';
export declare class MathUtils {
    static toBig(value: string | number): Big;
    static add(a: string | number, b: string | number): string;
    static subtract(a: string | number, b: string | number): string;
    static multiply(a: string | number, b: string | number): string;
    static divide(a: string | number, b: string | number): string;
    static compare(a: string | number, b: string | number): number;
    static isGreaterThan(a: string | number, b: string | number): boolean;
    static isLessThan(a: string | number, b: string | number): boolean;
    static isEqual(a: string | number, b: string | number): boolean;
    static isGreaterThanOrEqual(a: string | number, b: string | number): boolean;
    static isLessThanOrEqual(a: string | number, b: string | number): boolean;
    static isZero(value: string | number): boolean;
    static isPositive(value: string | number): boolean;
    static min(a: string | number, b: string | number): string;
    static max(a: string | number, b: string | number): string;
    static toFixed(value: string | number, decimals: number): string;
    static parseUnits(value: string, decimals?: number): string;
    static formatUnits(value: string, decimals?: number): string;
}
export declare class ValidationUtils {
    static isValidAddress(address: string): boolean;
    static isValidAmount(amount: string): boolean;
    static isValidPrice(price: string): boolean;
    static isValidOrderSide(side: string): boolean;
    static isValidOrderType(type: string): boolean;
    static isValidTradingPair(pair: string): boolean;
    static isValidChainId(chainId: number): boolean;
    static isValidSignature(signature: string): boolean;
}
export declare class MatchingUtils {
    static canMatch(buyOrder: Order, sellOrder: Order): boolean;
    static calculateMatchPrice(buyOrder: Order, sellOrder: Order): string;
    static calculateMatchAmount(buyOrder: Order, sellOrder: Order): string;
    static calculateFee(amount: string, feeRate: string): string;
}
export declare class CryptoUtils {
    static generateOrderId(): string;
    static generateTradeId(): string;
    static generateBatchId(): string;
    static hashOrder(order: Order): string;
    static verifyOrderSignature(order: Order): boolean;
}
export declare class TimeUtils {
    static now(): number;
    static fromUnixTimestamp(timestamp: number): Date;
    static toUnixTimestamp(date: Date): number;
    static addMinutes(timestamp: number, minutes: number): number;
    static addHours(timestamp: number, hours: number): number;
    static addDays(timestamp: number, days: number): number;
    static isExpired(expirationTime: number): boolean;
}
export declare class LogUtils {
    static formatOrder(order: Order): string;
    static formatTrade(trade: Trade): string;
    static formatError(error: any): string;
}
//# sourceMappingURL=utils.d.ts.map