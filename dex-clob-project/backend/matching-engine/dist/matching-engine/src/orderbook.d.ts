import { Order, OrderBook } from '../../shared/types';
import { EventEmitter } from 'events';
export declare class OrderBookManager extends EventEmitter {
    private orderBooks;
    private orders;
    constructor();
    addOrder(order: Order): void;
    cancelOrder(orderId: string, userId: string): boolean;
    getOrderBook(pair: string): OrderBook | undefined;
    getOrder(orderId: string): Order | undefined;
    getUserOrders(userId: string): Order[];
    private validateOrder;
    private addToOrderBook;
    private removeFromOrderBook;
    private insertOrderIntoLevels;
    private removeOrderFromLevels;
    private findInsertPosition;
    private matchOrder;
    private getOrdersForSide;
    private isOrderFilled;
    private executeMatch;
    private updateOrderAfterMatch;
    private updateOrderBookAfterMatch;
}
//# sourceMappingURL=orderbook.d.ts.map