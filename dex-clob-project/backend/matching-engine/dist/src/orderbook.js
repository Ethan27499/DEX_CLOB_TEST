"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderBookManager = void 0;
const utils_1 = require("../shared/utils");
const constants_1 = require("../shared/constants");
const events_1 = require("events");
class OrderBookManager extends events_1.EventEmitter {
    constructor() {
        super();
        this.orderBooks = new Map();
        this.orders = new Map();
    }
    addOrder(order) {
        if (!this.validateOrder(order)) {
            throw new Error('Invalid order');
        }
        this.orders.set(order.id, order);
        this.addToOrderBook(order);
        this.emit('orderAdded', order);
        this.matchOrder(order);
    }
    cancelOrder(orderId, userId) {
        const order = this.orders.get(orderId);
        if (!order || order.userId !== userId) {
            return false;
        }
        if (order.status !== constants_1.ORDER_STATUS.PENDING && order.status !== constants_1.ORDER_STATUS.PARTIAL) {
            return false;
        }
        order.status = constants_1.ORDER_STATUS.CANCELLED;
        this.orders.set(orderId, order);
        this.removeFromOrderBook(order);
        this.emit('orderCancelled', order);
        return true;
    }
    getOrderBook(pair) {
        return this.orderBooks.get(pair);
    }
    getOrder(orderId) {
        return this.orders.get(orderId);
    }
    getUserOrders(userId) {
        return Array.from(this.orders.values()).filter(order => order.userId === userId);
    }
    validateOrder(order) {
        if (!order.id || !order.userId || !order.pair || !order.side || !order.type) {
            return false;
        }
        if (!utils_1.MathUtils.isPositive(order.amount) || !utils_1.MathUtils.isPositive(order.price)) {
            return false;
        }
        if (order.side !== constants_1.ORDER_SIDES.BUY && order.side !== constants_1.ORDER_SIDES.SELL) {
            return false;
        }
        return true;
    }
    addToOrderBook(order) {
        let orderBook = this.orderBooks.get(order.pair);
        if (!orderBook) {
            orderBook = {
                pair: order.pair,
                bids: [],
                asks: [],
                lastUpdate: Date.now(),
            };
            this.orderBooks.set(order.pair, orderBook);
        }
        const levels = order.side === constants_1.ORDER_SIDES.BUY ? orderBook.bids : orderBook.asks;
        this.insertOrderIntoLevels(order, levels);
        orderBook.lastUpdate = Date.now();
        this.emit('orderBookUpdated', orderBook);
    }
    removeFromOrderBook(order) {
        const orderBook = this.orderBooks.get(order.pair);
        if (!orderBook)
            return;
        const levels = order.side === constants_1.ORDER_SIDES.BUY ? orderBook.bids : orderBook.asks;
        this.removeOrderFromLevels(order, levels);
        orderBook.lastUpdate = Date.now();
        this.emit('orderBookUpdated', orderBook);
    }
    insertOrderIntoLevels(order, levels) {
        const remaining = utils_1.MathUtils.subtract(order.amount, order.filled);
        if (utils_1.MathUtils.isZero(remaining))
            return;
        let levelIndex = levels.findIndex(level => utils_1.MathUtils.isEqual(level.price, order.price));
        if (levelIndex === -1) {
            const newLevel = {
                price: order.price,
                amount: remaining,
                orderCount: 1,
            };
            levelIndex = this.findInsertPosition(order.price, levels, order.side === constants_1.ORDER_SIDES.BUY);
            levels.splice(levelIndex, 0, newLevel);
        }
        else {
            const level = levels[levelIndex];
            level.amount = utils_1.MathUtils.add(level.amount, remaining);
            level.orderCount += 1;
        }
    }
    removeOrderFromLevels(order, levels) {
        const remaining = utils_1.MathUtils.subtract(order.amount, order.filled);
        const levelIndex = levels.findIndex(level => utils_1.MathUtils.isEqual(level.price, order.price));
        if (levelIndex === -1)
            return;
        const level = levels[levelIndex];
        level.amount = utils_1.MathUtils.subtract(level.amount, remaining);
        level.orderCount -= 1;
        if (utils_1.MathUtils.isZero(level.amount) || level.orderCount <= 0) {
            levels.splice(levelIndex, 1);
        }
    }
    findInsertPosition(price, levels, isDescending) {
        for (let i = 0; i < levels.length; i++) {
            const comparison = utils_1.MathUtils.compare(price, levels[i].price);
            if (isDescending) {
                if (comparison > 0)
                    return i;
            }
            else {
                if (comparison < 0)
                    return i;
            }
        }
        return levels.length;
    }
    matchOrder(newOrder) {
        const orderBook = this.orderBooks.get(newOrder.pair);
        if (!orderBook)
            return;
        const oppositeSide = newOrder.side === constants_1.ORDER_SIDES.BUY ? constants_1.ORDER_SIDES.SELL : constants_1.ORDER_SIDES.BUY;
        const oppositeOrders = this.getOrdersForSide(newOrder.pair, oppositeSide);
        oppositeOrders.sort((a, b) => {
            const priceComparison = oppositeSide === constants_1.ORDER_SIDES.SELL
                ? utils_1.MathUtils.compare(a.price, b.price)
                : utils_1.MathUtils.compare(b.price, a.price);
            if (priceComparison !== 0)
                return priceComparison;
            return a.timestamp - b.timestamp;
        });
        for (const oppositeOrder of oppositeOrders) {
            if (this.isOrderFilled(newOrder))
                break;
            if (utils_1.MatchingUtils.canMatch(newOrder.side === constants_1.ORDER_SIDES.BUY ? newOrder : oppositeOrder, newOrder.side === constants_1.ORDER_SIDES.SELL ? newOrder : oppositeOrder)) {
                this.executeMatch(newOrder, oppositeOrder);
            }
        }
    }
    getOrdersForSide(pair, side) {
        return Array.from(this.orders.values()).filter(order => order.pair === pair &&
            order.side === side &&
            (order.status === constants_1.ORDER_STATUS.PENDING || order.status === constants_1.ORDER_STATUS.PARTIAL));
    }
    isOrderFilled(order) {
        return utils_1.MathUtils.isGreaterThanOrEqual(order.filled, order.amount);
    }
    executeMatch(order1, order2) {
        const buyOrder = order1.side === constants_1.ORDER_SIDES.BUY ? order1 : order2;
        const sellOrder = order1.side === constants_1.ORDER_SIDES.SELL ? order1 : order2;
        const matchPrice = utils_1.MatchingUtils.calculateMatchPrice(buyOrder, sellOrder);
        const matchAmount = utils_1.MatchingUtils.calculateMatchAmount(buyOrder, sellOrder);
        if (utils_1.MathUtils.isZero(matchAmount))
            return;
        const trade = {
            id: utils_1.CryptoUtils.generateTradeId(),
            orderId: buyOrder.id,
            counterOrderId: sellOrder.id,
            pair: buyOrder.pair,
            side: constants_1.ORDER_SIDES.BUY,
            price: matchPrice,
            amount: matchAmount,
            fee: utils_1.MatchingUtils.calculateFee(matchAmount, constants_1.FEES.TAKER_FEE),
            timestamp: Date.now(),
            chainId: buyOrder.chainId,
        };
        this.updateOrderAfterMatch(buyOrder, matchAmount);
        this.updateOrderAfterMatch(sellOrder, matchAmount);
        this.emit('tradeExecuted', trade);
        this.emit('orderUpdated', buyOrder);
        this.emit('orderUpdated', sellOrder);
        this.updateOrderBookAfterMatch(buyOrder);
        this.updateOrderBookAfterMatch(sellOrder);
    }
    updateOrderAfterMatch(order, matchAmount) {
        order.filled = utils_1.MathUtils.add(order.filled, matchAmount);
        order.remaining = utils_1.MathUtils.subtract(order.amount, order.filled);
        if (utils_1.MathUtils.isZero(order.remaining)) {
            order.status = constants_1.ORDER_STATUS.FILLED;
        }
        else {
            order.status = constants_1.ORDER_STATUS.PARTIAL;
        }
        this.orders.set(order.id, order);
    }
    updateOrderBookAfterMatch(order) {
        const orderBook = this.orderBooks.get(order.pair);
        if (!orderBook)
            return;
        const levels = order.side === constants_1.ORDER_SIDES.BUY ? orderBook.bids : orderBook.asks;
        const levelIndex = levels.findIndex(level => utils_1.MathUtils.isEqual(level.price, order.price));
        if (levelIndex !== -1) {
            const level = levels[levelIndex];
            level.amount = order.remaining;
            if (utils_1.MathUtils.isZero(level.amount)) {
                level.orderCount -= 1;
                if (level.orderCount <= 0) {
                    levels.splice(levelIndex, 1);
                }
            }
        }
        orderBook.lastUpdate = Date.now();
        this.emit('orderBookUpdated', orderBook);
    }
}
exports.OrderBookManager = OrderBookManager;
//# sourceMappingURL=orderbook.js.map