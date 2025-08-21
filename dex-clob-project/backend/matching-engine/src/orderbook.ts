import { Order, Trade, OrderBook, OrderBookLevel } from '../../shared/types';
import { MathUtils, MatchingUtils, CryptoUtils } from '../../shared/utils';
import { ORDER_STATUS, ORDER_SIDES, FEES } from '../../shared/constants';
import { EventEmitter } from 'events';

export class OrderBookManager extends EventEmitter {
  private orderBooks: Map<string, OrderBook> = new Map();
  private orders: Map<string, Order> = new Map();

  constructor() {
    super();
  }

  public addOrder(order: Order): void {
    // Validate order
    if (!this.validateOrder(order)) {
      throw new Error('Invalid order');
    }

    // Add to orders map
    this.orders.set(order.id, order);

    // Add to orderbook
    this.addToOrderBook(order);

    // Emit event
    this.emit('orderAdded', order);

    // Try to match immediately
    this.matchOrder(order);
  }

  public cancelOrder(orderId: string, userId: string): boolean {
    const order = this.orders.get(orderId);
    if (!order || order.userId !== userId) {
      return false;
    }

    if (order.status !== ORDER_STATUS.PENDING && order.status !== ORDER_STATUS.PARTIAL) {
      return false;
    }

    // Update order status
    order.status = ORDER_STATUS.CANCELLED;
    this.orders.set(orderId, order);

    // Remove from orderbook
    this.removeFromOrderBook(order);

    // Emit event
    this.emit('orderCancelled', order);

    return true;
  }

  public getOrderBook(pair: string): OrderBook | undefined {
    return this.orderBooks.get(pair);
  }

  public getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  public getUserOrders(userId: string): Order[] {
    return Array.from(this.orders.values()).filter(order => order.userId === userId);
  }

  private validateOrder(order: Order): boolean {
    // Basic validation
    if (!order.id || !order.userId || !order.pair || !order.side || !order.type) {
      return false;
    }

    if (!MathUtils.isPositive(order.amount) || !MathUtils.isPositive(order.price)) {
      return false;
    }

    if (order.side !== ORDER_SIDES.BUY && order.side !== ORDER_SIDES.SELL) {
      return false;
    }

    return true;
  }

  private addToOrderBook(order: Order): void {
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

    const levels = order.side === ORDER_SIDES.BUY ? orderBook.bids : orderBook.asks;
    this.insertOrderIntoLevels(order, levels);

    orderBook.lastUpdate = Date.now();
    this.emit('orderBookUpdated', orderBook);
  }

  private removeFromOrderBook(order: Order): void {
    const orderBook = this.orderBooks.get(order.pair);
    if (!orderBook) return;

    const levels = order.side === ORDER_SIDES.BUY ? orderBook.bids : orderBook.asks;
    this.removeOrderFromLevels(order, levels);

    orderBook.lastUpdate = Date.now();
    this.emit('orderBookUpdated', orderBook);
  }

  private insertOrderIntoLevels(order: Order, levels: OrderBookLevel[]): void {
    const remaining = MathUtils.subtract(order.amount, order.filled);
    if (MathUtils.isZero(remaining)) return;

    // Find existing level or create new one
    let levelIndex = levels.findIndex(level => MathUtils.isEqual(level.price, order.price));
    
    if (levelIndex === -1) {
      // Create new level
      const newLevel: OrderBookLevel = {
        price: order.price,
        amount: remaining,
        orderCount: 1,
      };
      
      // Insert in correct position (sorted by price)
      levelIndex = this.findInsertPosition(order.price, levels, order.side === ORDER_SIDES.BUY);
      levels.splice(levelIndex, 0, newLevel);
    } else {
      // Update existing level
      const level = levels[levelIndex];
      level.amount = MathUtils.add(level.amount, remaining);
      level.orderCount += 1;
    }
  }

  private removeOrderFromLevels(order: Order, levels: OrderBookLevel[]): void {
    const remaining = MathUtils.subtract(order.amount, order.filled);
    const levelIndex = levels.findIndex(level => MathUtils.isEqual(level.price, order.price));
    
    if (levelIndex === -1) return;

    const level = levels[levelIndex];
    level.amount = MathUtils.subtract(level.amount, remaining);
    level.orderCount -= 1;

    // Remove level if empty
    if (MathUtils.isZero(level.amount) || level.orderCount <= 0) {
      levels.splice(levelIndex, 1);
    }
  }

  private findInsertPosition(price: string, levels: OrderBookLevel[], isDescending: boolean): number {
    for (let i = 0; i < levels.length; i++) {
      const comparison = MathUtils.compare(price, levels[i].price);
      
      if (isDescending) {
        // For bids (buy orders), higher prices come first
        if (comparison > 0) return i;
      } else {
        // For asks (sell orders), lower prices come first
        if (comparison < 0) return i;
      }
    }
    
    return levels.length;
  }

  private matchOrder(newOrder: Order): void {
    const orderBook = this.orderBooks.get(newOrder.pair);
    if (!orderBook) return;

    // Get opposite side orders
    const oppositeSide = newOrder.side === ORDER_SIDES.BUY ? ORDER_SIDES.SELL : ORDER_SIDES.BUY;
    const oppositeOrders = this.getOrdersForSide(newOrder.pair, oppositeSide);

    // Sort orders by price and time priority
    oppositeOrders.sort((a, b) => {
      const priceComparison = oppositeSide === ORDER_SIDES.SELL 
        ? MathUtils.compare(a.price, b.price) // Sells: lowest price first
        : MathUtils.compare(b.price, a.price); // Buys: highest price first
      
      if (priceComparison !== 0) return priceComparison;
      return a.timestamp - b.timestamp; // Time priority
    });

    // Match against opposite orders
    for (const oppositeOrder of oppositeOrders) {
      if (this.isOrderFilled(newOrder)) break;
      
      if (MatchingUtils.canMatch(
        newOrder.side === ORDER_SIDES.BUY ? newOrder : oppositeOrder,
        newOrder.side === ORDER_SIDES.SELL ? newOrder : oppositeOrder
      )) {
        this.executeMatch(newOrder, oppositeOrder);
      }
    }
  }

  private getOrdersForSide(pair: string, side: string): Order[] {
    return Array.from(this.orders.values()).filter(order => 
      order.pair === pair && 
      order.side === side && 
      (order.status === ORDER_STATUS.PENDING || order.status === ORDER_STATUS.PARTIAL)
    );
  }

  private isOrderFilled(order: Order): boolean {
    return MathUtils.isGreaterThanOrEqual(order.filled, order.amount);
  }

  private executeMatch(order1: Order, order2: Order): void {
    const buyOrder = order1.side === ORDER_SIDES.BUY ? order1 : order2;
    const sellOrder = order1.side === ORDER_SIDES.SELL ? order1 : order2;

    const matchPrice = MatchingUtils.calculateMatchPrice(buyOrder, sellOrder);
    const matchAmount = MatchingUtils.calculateMatchAmount(buyOrder, sellOrder);

    if (MathUtils.isZero(matchAmount)) return;

    // Create trade
    const trade: Trade = {
      id: CryptoUtils.generateTradeId(),
      orderId: buyOrder.id,
      counterOrderId: sellOrder.id,
      pair: buyOrder.pair,
      side: ORDER_SIDES.BUY, // Trade side from buyer's perspective
      price: matchPrice,
      amount: matchAmount,
      fee: MatchingUtils.calculateFee(matchAmount, FEES.TAKER_FEE),
      timestamp: Date.now(),
      chainId: buyOrder.chainId,
    };

    // Update orders
    this.updateOrderAfterMatch(buyOrder, matchAmount);
    this.updateOrderAfterMatch(sellOrder, matchAmount);

    // Emit events
    this.emit('tradeExecuted', trade);
    this.emit('orderUpdated', buyOrder);
    this.emit('orderUpdated', sellOrder);

    // Update orderbook
    this.updateOrderBookAfterMatch(buyOrder);
    this.updateOrderBookAfterMatch(sellOrder);
  }

  private updateOrderAfterMatch(order: Order, matchAmount: string): void {
    order.filled = MathUtils.add(order.filled, matchAmount);
    order.remaining = MathUtils.subtract(order.amount, order.filled);

    if (MathUtils.isZero(order.remaining)) {
      order.status = ORDER_STATUS.FILLED;
    } else {
      order.status = ORDER_STATUS.PARTIAL;
    }

    this.orders.set(order.id, order);
  }

  private updateOrderBookAfterMatch(order: Order): void {
    const orderBook = this.orderBooks.get(order.pair);
    if (!orderBook) return;

    const levels = order.side === ORDER_SIDES.BUY ? orderBook.bids : orderBook.asks;
    const levelIndex = levels.findIndex(level => MathUtils.isEqual(level.price, order.price));
    
    if (levelIndex !== -1) {
      const level = levels[levelIndex];
      level.amount = order.remaining;
      
      if (MathUtils.isZero(level.amount)) {
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
