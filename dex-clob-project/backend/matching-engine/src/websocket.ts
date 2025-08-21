import { Server as SocketIOServer, Socket } from 'socket.io';
import { OrderBookManager } from './orderbook';
import { Order, Trade, OrderBook } from '../../shared/types';
import { WEBSOCKET_EVENTS } from '../../shared/constants';
import { Logger } from './logger';

export class WebSocketManager {
  private io: SocketIOServer;
  private orderBookManager: OrderBookManager;
  private logger: Logger;
  private connectedUsers: Map<string, Socket> = new Map();

  constructor(io: SocketIOServer, orderBookManager: OrderBookManager) {
    this.io = io;
    this.orderBookManager = orderBookManager;
    this.logger = new Logger('WebSocketManager');
  }

  public initialize(): void {
    this.io.on('connection', (socket: Socket) => {
      this.handleConnection(socket);
    });

    // Set up orderbook event listeners
    this.setupOrderBookListeners();
  }

  private handleConnection(socket: Socket): void {
    this.logger.info(`New WebSocket connection: ${socket.id}`);

    socket.emit(WEBSOCKET_EVENTS.CONNECTION_ESTABLISHED, {
      message: 'Connected to DEX Matching Engine',
      timestamp: Date.now(),
    });

    // Handle user authentication/identification
    socket.on('authenticate', (data: { userId: string, signature: string }) => {
      this.handleAuthentication(socket, data);
    });

    // Handle orderbook subscriptions
    socket.on('subscribe_orderbook', (data: { pair: string }) => {
      this.handleOrderbookSubscription(socket, data.pair);
    });

    socket.on('unsubscribe_orderbook', (data: { pair: string }) => {
      this.handleOrderbookUnsubscription(socket, data.pair);
    });

    // Handle trade subscriptions
    socket.on('subscribe_trades', (data: { pair?: string }) => {
      this.handleTradeSubscription(socket, data.pair);
    });

    // Handle user-specific subscriptions
    socket.on('subscribe_user_orders', (data: { userId: string }) => {
      this.handleUserOrderSubscription(socket, data.userId);
    });

    // Handle heartbeat
    socket.on('heartbeat', () => {
      socket.emit('heartbeat', { timestamp: Date.now() });
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      this.handleDisconnection(socket, reason);
    });

    // Error handling
    socket.on('error', (error) => {
      this.logger.error(`Socket error for ${socket.id}:`, error);
    });
  }

  private handleAuthentication(socket: Socket, data: { userId: string, signature: string }): void {
    try {
      // Here you would verify the signature to ensure the user owns the address
      // For now, we'll just store the association
      
      socket.data.userId = data.userId;
      this.connectedUsers.set(data.userId, socket);
      
      socket.emit('authenticated', {
        success: true,
        userId: data.userId,
        timestamp: Date.now(),
      });

      this.logger.info(`User authenticated: ${data.userId} on socket ${socket.id}`);

    } catch (error) {
      socket.emit('authentication_error', {
        success: false,
        error: 'Authentication failed',
        timestamp: Date.now(),
      });
      
      this.logger.error(`Authentication failed for socket ${socket.id}:`, error);
    }
  }

  private handleOrderbookSubscription(socket: Socket, pair: string): void {
    socket.join(`orderbook:${pair}`);
    
    // Send current orderbook snapshot
    const orderbook = this.orderBookManager.getOrderBook(pair);
    if (orderbook) {
      socket.emit(WEBSOCKET_EVENTS.ORDERBOOK_SNAPSHOT, orderbook);
    }

    this.logger.info(`Socket ${socket.id} subscribed to orderbook: ${pair}`);
  }

  private handleOrderbookUnsubscription(socket: Socket, pair: string): void {
    socket.leave(`orderbook:${pair}`);
    this.logger.info(`Socket ${socket.id} unsubscribed from orderbook: ${pair}`);
  }

  private handleTradeSubscription(socket: Socket, pair?: string): void {
    const room = pair ? `trades:${pair}` : 'trades:all';
    socket.join(room);
    this.logger.info(`Socket ${socket.id} subscribed to trades: ${pair || 'all'}`);
  }

  private handleUserOrderSubscription(socket: Socket, userId: string): void {
    // Only allow users to subscribe to their own orders
    if (socket.data.userId !== userId) {
      socket.emit('error', {
        message: 'Unauthorized: Cannot subscribe to other user orders',
        timestamp: Date.now(),
      });
      return;
    }

    socket.join(`user_orders:${userId}`);
    this.logger.info(`Socket ${socket.id} subscribed to user orders: ${userId}`);
  }

  private handleDisconnection(socket: Socket, reason: string): void {
    this.logger.info(`Socket disconnected: ${socket.id}, reason: ${reason}`);
    
    if (socket.data.userId) {
      this.connectedUsers.delete(socket.data.userId);
    }
  }

  private setupOrderBookListeners(): void {
    this.orderBookManager.on('orderAdded', (order: Order) => {
      this.broadcastUserOrderUpdate(order);
    });

    this.orderBookManager.on('orderCancelled', (order: Order) => {
      this.broadcastUserOrderUpdate(order);
    });

    this.orderBookManager.on('orderUpdated', (order: Order) => {
      this.broadcastUserOrderUpdate(order);
    });

    this.orderBookManager.on('tradeExecuted', (trade: Trade) => {
      this.broadcastTradeUpdate(trade);
    });
  }

  public broadcastOrderBookUpdate(orderbook: OrderBook): void {
    this.io.to(`orderbook:${orderbook.pair}`).emit(WEBSOCKET_EVENTS.ORDERBOOK_UPDATE, orderbook);
  }

  private broadcastUserOrderUpdate(order: Order): void {
    this.io.to(`user_orders:${order.userId}`).emit(WEBSOCKET_EVENTS.ORDER_FILLED, order);
  }

  private broadcastTradeUpdate(trade: Trade): void {
    // Broadcast to all trade subscribers
    this.io.to('trades:all').emit(WEBSOCKET_EVENTS.TRADE_EXECUTED, trade);
    
    // Broadcast to pair-specific subscribers
    this.io.to(`trades:${trade.pair}`).emit(WEBSOCKET_EVENTS.TRADE_EXECUTED, trade);
  }

  public broadcastPriceUpdate(pair: string, price: string): void {
    this.io.to(`orderbook:${pair}`).emit(WEBSOCKET_EVENTS.PRICE_UPDATE, {
      pair,
      price,
      timestamp: Date.now(),
    });
  }

  public broadcastSystemMessage(message: any): void {
    this.io.emit('system_message', {
      ...message,
      timestamp: Date.now(),
    });
  }

  public sendToUser(userId: string, event: string, data: any): void {
    const socket = this.connectedUsers.get(userId);
    if (socket) {
      socket.emit(event, {
        ...data,
        timestamp: Date.now(),
      });
    }
  }

  public getConnectedUserCount(): number {
    return this.connectedUsers.size;
  }

  public getConnectedUsers(): string[] {
    return Array.from(this.connectedUsers.keys());
  }

  public async close(): Promise<void> {
    return new Promise((resolve) => {
      this.io.close(() => {
        this.logger.info('WebSocket server closed');
        resolve();
      });
    });
  }
}
