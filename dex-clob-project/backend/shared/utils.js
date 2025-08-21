"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogUtils = exports.TimeUtils = exports.CryptoUtils = exports.MatchingUtils = exports.ValidationUtils = exports.MathUtils = void 0;
const ethers_1 = require("ethers");
const big_js_1 = __importDefault(require("big.js"));
class MathUtils {
    static toBig(value) {
        return new big_js_1.default(value);
    }
    static add(a, b) {
        return new big_js_1.default(a).plus(new big_js_1.default(b)).toString();
    }
    static subtract(a, b) {
        return new big_js_1.default(a).minus(new big_js_1.default(b)).toString();
    }
    static multiply(a, b) {
        return new big_js_1.default(a).times(new big_js_1.default(b)).toString();
    }
    static divide(a, b) {
        return new big_js_1.default(a).div(new big_js_1.default(b)).toString();
    }
    static compare(a, b) {
        return new big_js_1.default(a).cmp(new big_js_1.default(b));
    }
    static isGreaterThan(a, b) {
        return new big_js_1.default(a).gt(new big_js_1.default(b));
    }
    static isLessThan(a, b) {
        return new big_js_1.default(a).lt(new big_js_1.default(b));
    }
    static isEqual(a, b) {
        return new big_js_1.default(a).eq(new big_js_1.default(b));
    }
    static isGreaterThanOrEqual(a, b) {
        return new big_js_1.default(a).gte(new big_js_1.default(b));
    }
    static isLessThanOrEqual(a, b) {
        return new big_js_1.default(a).lte(new big_js_1.default(b));
    }
    static isZero(value) {
        return new big_js_1.default(value).eq(0);
    }
    static isPositive(value) {
        return new big_js_1.default(value).gt(0);
    }
    static min(a, b) {
        return new big_js_1.default(a).lt(new big_js_1.default(b)) ? a.toString() : b.toString();
    }
    static max(a, b) {
        return new big_js_1.default(a).gt(new big_js_1.default(b)) ? a.toString() : b.toString();
    }
    static toFixed(value, decimals) {
        return new big_js_1.default(value).toFixed(decimals);
    }
    static parseUnits(value, decimals = 18) {
        return ethers_1.ethers.parseUnits(value, decimals).toString();
    }
    static formatUnits(value, decimals = 18) {
        return ethers_1.ethers.formatUnits(value, decimals);
    }
}
exports.MathUtils = MathUtils;
class ValidationUtils {
    static isValidAddress(address) {
        return ethers_1.ethers.isAddress(address);
    }
    static isValidAmount(amount) {
        try {
            const bigAmount = new big_js_1.default(amount);
            return bigAmount.gt(0);
        }
        catch {
            return false;
        }
    }
    static isValidPrice(price) {
        try {
            const bigPrice = new big_js_1.default(price);
            return bigPrice.gt(0);
        }
        catch {
            return false;
        }
    }
    static isValidOrderSide(side) {
        return side === 'buy' || side === 'sell';
    }
    static isValidOrderType(type) {
        return type === 'limit' || type === 'market';
    }
    static isValidTradingPair(pair) {
        const parts = pair.split('/');
        return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
    }
    static isValidChainId(chainId) {
        return chainId > 0 && Number.isInteger(chainId);
    }
    static isValidSignature(signature) {
        try {
            const bytes = ethers_1.ethers.getBytes(signature);
            return bytes.length === 65;
        }
        catch {
            return false;
        }
    }
}
exports.ValidationUtils = ValidationUtils;
class MatchingUtils {
    static canMatch(buyOrder, sellOrder) {
        if (buyOrder.pair !== sellOrder.pair)
            return false;
        if (buyOrder.side !== 'buy' || sellOrder.side !== 'sell')
            return false;
        if (buyOrder.userId === sellOrder.userId)
            return false;
        if (buyOrder.type === 'market')
            return true;
        if (sellOrder.type === 'market')
            return true;
        return MathUtils.isGreaterThanOrEqual(buyOrder.price, sellOrder.price);
    }
    static calculateMatchPrice(buyOrder, sellOrder) {
        if (buyOrder.type === 'market' && sellOrder.type === 'limit') {
            return sellOrder.price;
        }
        if (sellOrder.type === 'market' && buyOrder.type === 'limit') {
            return buyOrder.price;
        }
        if (buyOrder.type === 'limit' && sellOrder.type === 'limit') {
            return buyOrder.timestamp <= sellOrder.timestamp ? buyOrder.price : sellOrder.price;
        }
        throw new Error('Cannot match two market orders without a reference price');
    }
    static calculateMatchAmount(buyOrder, sellOrder) {
        const buyRemaining = MathUtils.subtract(buyOrder.amount, buyOrder.filled);
        const sellRemaining = MathUtils.subtract(sellOrder.amount, sellOrder.filled);
        return MathUtils.min(buyRemaining, sellRemaining);
    }
    static calculateFee(amount, feeRate) {
        return MathUtils.multiply(amount, feeRate);
    }
}
exports.MatchingUtils = MatchingUtils;
class CryptoUtils {
    static generateOrderId() {
        return ethers_1.ethers.id(Date.now().toString() + Math.random().toString()).slice(0, 42);
    }
    static generateTradeId() {
        return ethers_1.ethers.id(Date.now().toString() + Math.random().toString()).slice(0, 42);
    }
    static generateBatchId() {
        return ethers_1.ethers.id(Date.now().toString() + Math.random().toString()).slice(0, 42);
    }
    static hashOrder(order) {
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
        return ethers_1.ethers.id(JSON.stringify(orderData));
    }
    static verifyOrderSignature(order) {
        try {
            const orderHash = this.hashOrder(order);
            const recoveredAddress = ethers_1.ethers.verifyMessage(orderHash, order.signature);
            return recoveredAddress.toLowerCase() === order.userId.toLowerCase();
        }
        catch {
            return false;
        }
    }
}
exports.CryptoUtils = CryptoUtils;
class TimeUtils {
    static now() {
        return Date.now();
    }
    static fromUnixTimestamp(timestamp) {
        return new Date(timestamp * 1000);
    }
    static toUnixTimestamp(date) {
        return Math.floor(date.getTime() / 1000);
    }
    static addMinutes(timestamp, minutes) {
        return timestamp + (minutes * 60 * 1000);
    }
    static addHours(timestamp, hours) {
        return timestamp + (hours * 60 * 60 * 1000);
    }
    static addDays(timestamp, days) {
        return timestamp + (days * 24 * 60 * 60 * 1000);
    }
    static isExpired(expirationTime) {
        return Date.now() > expirationTime;
    }
}
exports.TimeUtils = TimeUtils;
class LogUtils {
    static formatOrder(order) {
        return `Order{id:${order.id}, pair:${order.pair}, side:${order.side}, type:${order.type}, price:${order.price}, amount:${order.amount}, status:${order.status}}`;
    }
    static formatTrade(trade) {
        return `Trade{id:${trade.id}, pair:${trade.pair}, side:${trade.side}, price:${trade.price}, amount:${trade.amount}}`;
    }
    static formatError(error) {
        if (error instanceof Error) {
            return `${error.name}: ${error.message}`;
        }
        return String(error);
    }
}
exports.LogUtils = LogUtils;
//# sourceMappingURL=utils.js.map