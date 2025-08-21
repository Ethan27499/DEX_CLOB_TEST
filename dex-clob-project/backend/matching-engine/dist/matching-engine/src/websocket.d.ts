import { Server as SocketIOServer } from 'socket.io';
import { OrderBookManager } from './orderbook';
import { OrderBook } from '../../shared/types';
export declare class WebSocketManager {
    private io;
    private orderBookManager;
    private logger;
    private connectedUsers;
    constructor(io: SocketIOServer, orderBookManager: OrderBookManager);
    initialize(): void;
    private handleConnection;
    private handleAuthentication;
    private handleOrderbookSubscription;
    private handleOrderbookUnsubscription;
    private handleTradeSubscription;
    private handleUserOrderSubscription;
    private handleDisconnection;
    private setupOrderBookListeners;
    broadcastOrderBookUpdate(orderbook: OrderBook): void;
    private broadcastUserOrderUpdate;
    private broadcastTradeUpdate;
    broadcastPriceUpdate(pair: string, price: string): void;
    broadcastSystemMessage(message: any): void;
    sendToUser(userId: string, event: string, data: any): void;
    getConnectedUserCount(): number;
    getConnectedUsers(): string[];
    close(): Promise<void>;
}
//# sourceMappingURL=websocket.d.ts.map