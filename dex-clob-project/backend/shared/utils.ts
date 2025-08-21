import { ethers } from 'ethers';
import Big from 'big.js';
import { Order, Trade } from './types';

/**
 * Utility functions for mathematical operations with high precision
 */
export class MathUtils {
  static toBig(value: string | number): Big {
    return new Big(value);
  }

  static add(a: string | number, b: string | number): string {
    return new Big(a).plus(new Big(b)).toString();
  }

  static subtract(a: string | number, b: string | number): string {
    return new Big(a).minus(new Big(b)).toString();
  }

  static multiply(a: string | number, b: string | number): string {
    return new Big(a).times(new Big(b)).toString();
  }

  static divide(a: string | number, b: string | number): string {
    return new Big(a).div(new Big(b)).toString();
  }

  static compare(a: string | number, b: string | number): number {
    return new Big(a).cmp(new Big(b));
  }

  static isGreaterThan(a: string | number, b: string | number): boolean {
    return new Big(a).gt(new Big(b));
  }

  static isLessThan(a: string | number, b: string | number): boolean {
    return new Big(a).lt(new Big(b));
  }

  static isEqual(a: string | number, b: string | number): boolean {
    return new Big(a).eq(new Big(b));
  }

  static isGreaterThanOrEqual(a: string | number, b: string | number): boolean {
    return new Big(a).gte(new Big(b));
  }

  static isLessThanOrEqual(a: string | number, b: string | number): boolean {
    return new Big(a).lte(new Big(b));
  }

  static isZero(value: string | number): boolean {
    return new Big(value).eq(0);
  }

  static isPositive(value: string | number): boolean {
    return new Big(value).gt(0);
  }

  static min(a: string | number, b: string | number): string {
    return new Big(a).lt(new Big(b)) ? a.toString() : b.toString();
  }

  static max(a: string | number, b: string | number): string {
    return new Big(a).gt(new Big(b)) ? a.toString() : b.toString();
  }

  static toFixed(value: string | number, decimals: number): string {
    return new Big(value).toFixed(decimals);
  }

  static parseUnits(value: string, decimals: number = 18): string {
    return ethers.parseUnits(value, decimals).toString();
  }

  static formatUnits(value: string, decimals: number = 18): string {
    return ethers.formatUnits(value, decimals);
  }
}

/**
 * Utility functions for validation
 */
export class ValidationUtils {
  static isValidAddress(address: string): boolean {
    return ethers.isAddress(address);
  }

  static isValidAmount(amount: string): boolean {
    try {
      const bigAmount = new Big(amount);
      return bigAmount.gt(0);
    } catch {
      return false;
    }
  }

  static isValidPrice(price: string): boolean {
    try {
      const bigPrice = new Big(price);
      return bigPrice.gt(0);
    } catch {
      return false;
    }
  }

  static isValidOrderSide(side: string): boolean {
    return side === 'buy' || side === 'sell';
  }

  static isValidOrderType(type: string): boolean {
    return type === 'limit' || type === 'market';
  }

  static isValidTradingPair(pair: string): boolean {
    const parts = pair.split('/');
    return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
  }

  static isValidChainId(chainId: number): boolean {
    return chainId > 0 && Number.isInteger(chainId);
  }

  static isValidSignature(signature: string): boolean {
    try {
      const bytes = ethers.getBytes(signature);
      return bytes.length === 65;
    } catch {
      return false;
    }
  }
}

/**
 * Utility functions for order matching
 */
export class MatchingUtils {
  static canMatch(buyOrder: Order, sellOrder: Order): boolean {
    // Check if orders can be matched
    if (buyOrder.pair !== sellOrder.pair) return false;
    if (buyOrder.side !== 'buy' || sellOrder.side !== 'sell') return false;
    if (buyOrder.userId === sellOrder.userId) return false;
    
    // Price matching logic
    if (buyOrder.type === 'market') return true;
    if (sellOrder.type === 'market') return true;
    
    // For limit orders, buy price must be >= sell price
    return MathUtils.isGreaterThanOrEqual(buyOrder.price, sellOrder.price);
  }

  static calculateMatchPrice(buyOrder: Order, sellOrder: Order): string {
    // Price priority: limit orders take precedence over market orders
    if (buyOrder.type === 'market' && sellOrder.type === 'limit') {
      return sellOrder.price;
    }
    if (sellOrder.type === 'market' && buyOrder.type === 'limit') {
      return buyOrder.price;
    }
    if (buyOrder.type === 'limit' && sellOrder.type === 'limit') {
      // Earlier order gets price priority
      return buyOrder.timestamp <= sellOrder.timestamp ? buyOrder.price : sellOrder.price;
    }
    
    // Both market orders - should not happen in practice
    throw new Error('Cannot match two market orders without a reference price');
  }

  static calculateMatchAmount(buyOrder: Order, sellOrder: Order): string {
    const buyRemaining = MathUtils.subtract(buyOrder.amount, buyOrder.filled);
    const sellRemaining = MathUtils.subtract(sellOrder.amount, sellOrder.filled);
    
    return MathUtils.min(buyRemaining, sellRemaining);
  }

  static calculateFee(amount: string, feeRate: string): string {
    return MathUtils.multiply(amount, feeRate);
  }
}

/**
 * Utility functions for cryptographic operations
 */
export class CryptoUtils {
  static generateOrderId(): string {
    return ethers.id(Date.now().toString() + Math.random().toString()).slice(0, 42);
  }

  static generateTradeId(): string {
    return ethers.id(Date.now().toString() + Math.random().toString()).slice(0, 42);
  }

  static generateBatchId(): string {
    return ethers.id(Date.now().toString() + Math.random().toString()).slice(0, 42);
  }

  static hashOrder(order: Order): string {
    const orderData = {
      userId: order.userId,
      pair: order.pair,
      side: order.side,
      type: order.type,
      price: order.price,
      amount: order.amount,
      nonce: order.nonce,
      chainId: order.chainId,
    };
    
    return ethers.id(JSON.stringify(orderData));
  }

  static verifyOrderSignature(order: Order): boolean {
    try {
      const orderHash = this.hashOrder(order);
      const recoveredAddress = ethers.verifyMessage(orderHash, order.signature);
      return recoveredAddress.toLowerCase() === order.userId.toLowerCase();
    } catch {
      return false;
    }
  }
}

/**
 * Utility functions for time operations
 */
export class TimeUtils {
  static now(): number {
    return Date.now();
  }

  static fromUnixTimestamp(timestamp: number): Date {
    return new Date(timestamp * 1000);
  }

  static toUnixTimestamp(date: Date): number {
    return Math.floor(date.getTime() / 1000);
  }

  static addMinutes(timestamp: number, minutes: number): number {
    return timestamp + (minutes * 60 * 1000);
  }

  static addHours(timestamp: number, hours: number): number {
    return timestamp + (hours * 60 * 60 * 1000);
  }

  static addDays(timestamp: number, days: number): number {
    return timestamp + (days * 24 * 60 * 60 * 1000);
  }

  static isExpired(expirationTime: number): boolean {
    return Date.now() > expirationTime;
  }
}

/**
 * Utility functions for logging and debugging
 */
export class LogUtils {
  static formatOrder(order: Order): string {
    return `Order{id:${order.id}, pair:${order.pair}, side:${order.side}, type:${order.type}, price:${order.price}, amount:${order.amount}, status:${order.status}}`;
  }

  static formatTrade(trade: Trade): string {
    return `Trade{id:${trade.id}, pair:${trade.pair}, side:${trade.side}, price:${trade.price}, amount:${trade.amount}}`;
  }

  static formatError(error: any): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return String(error);
  }
}
