"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketManager = void 0;
const constants_1 = require("../shared/constants");
const logger_1 = require("./logger");
class WebSocketManager {
    constructor(io, orderBookManager) {
        this.connectedUsers = new Map();
        this.io = io;
        this.orderBookManager = orderBookManager;
        this.logger = new logger_1.Logger('WebSocketManager');
    }
    initialize() {
        this.io.on('connection', (socket) => {
            this.handleConnection(socket);
        });
        this.setupOrderBookListeners();
    }
    handleConnection(socket) {
        this.logger.info(`New WebSocket connection: ${socket.id}`);
        socket.emit(constants_1.WEBSOCKET_EVENTS.CONNECTION_ESTABLISHED, {
            message: 'Connected to DEX Matching Engine',
            timestamp: Date.now(),
        });
        socket.on('authenticate', (data) => {
            this.handleAuthentication(socket, data);
        });
        socket.on('subscribe_orderbook', (data) => {
            this.handleOrderbookSubscription(socket, data.pair);
        });
        socket.on('unsubscribe_orderbook', (data) => {
            this.handleOrderbookUnsubscription(socket, data.pair);
        });
        socket.on('subscribe_trades', (data) => {
            this.handleTradeSubscription(socket, data.pair);
        });
        socket.on('subscribe_user_orders', (data) => {
            this.handleUserOrderSubscription(socket, data.userId);
        });
        socket.on('heartbeat', () => {
            socket.emit('heartbeat', { timestamp: Date.now() });
        });
        socket.on('disconnect', (reason) => {
            this.handleDisconnection(socket, reason);
        });
        socket.on('error', (error) => {
            this.logger.error(`Socket error for ${socket.id}:`, error);
        });
    }
    handleAuthentication(socket, data) {
        try {
            socket.data.userId = data.userId;
            this.connectedUsers.set(data.userId, socket);
            socket.emit('authenticated', {
                success: true,
                userId: data.userId,
                timestamp: Date.now(),
            });
            this.logger.info(`User authenticated: ${data.userId} on socket ${socket.id}`);
        }
        catch (error) {
            socket.emit('authentication_error', {
                success: false,
                error: 'Authentication failed',
                timestamp: Date.now(),
            });
            this.logger.error(`Authentication failed for socket ${socket.id}:`, error);
        }
    }
    handleOrderbookSubscription(socket, pair) {
        socket.join(`orderbook:${pair}`);
        const orderbook = this.orderBookManager.getOrderBook(pair);
        if (orderbook) {
            socket.emit(constants_1.WEBSOCKET_EVENTS.ORDERBOOK_SNAPSHOT, orderbook);
        }
        this.logger.info(`Socket ${socket.id} subscribed to orderbook: ${pair}`);
    }
    handleOrderbookUnsubscription(socket, pair) {
        socket.leave(`orderbook:${pair}`);
        this.logger.info(`Socket ${socket.id} unsubscribed from orderbook: ${pair}`);
    }
    handleTradeSubscription(socket, pair) {
        const room = pair ? `trades:${pair}` : 'trades:all';
        socket.join(room);
        this.logger.info(`Socket ${socket.id} subscribed to trades: ${pair || 'all'}`);
    }
    handleUserOrderSubscription(socket, userId) {
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
    handleDisconnection(socket, reason) {
        this.logger.info(`Socket disconnected: ${socket.id}, reason: ${reason}`);
        if (socket.data.userId) {
            this.connectedUsers.delete(socket.data.userId);
        }
    }
    setupOrderBookListeners() {
        this.orderBookManager.on('orderAdded', (order) => {
            this.broadcastUserOrderUpdate(order);
        });
        this.orderBookManager.on('orderCancelled', (order) => {
            this.broadcastUserOrderUpdate(order);
        });
        this.orderBookManager.on('orderUpdated', (order) => {
            this.broadcastUserOrderUpdate(order);
        });
        this.orderBookManager.on('tradeExecuted', (trade) => {
            this.broadcastTradeUpdate(trade);
        });
    }
    broadcastOrderBookUpdate(orderbook) {
        this.io.to(`orderbook:${orderbook.pair}`).emit(constants_1.WEBSOCKET_EVENTS.ORDERBOOK_UPDATE, orderbook);
    }
    broadcastUserOrderUpdate(order) {
        this.io.to(`user_orders:${order.userId}`).emit(constants_1.WEBSOCKET_EVENTS.ORDER_FILLED, order);
    }
    broadcastTradeUpdate(trade) {
        this.io.to('trades:all').emit(constants_1.WEBSOCKET_EVENTS.TRADE_EXECUTED, trade);
        this.io.to(`trades:${trade.pair}`).emit(constants_1.WEBSOCKET_EVENTS.TRADE_EXECUTED, trade);
    }
    broadcastPriceUpdate(pair, price) {
        this.io.to(`orderbook:${pair}`).emit(constants_1.WEBSOCKET_EVENTS.PRICE_UPDATE, {
            pair,
            price,
            timestamp: Date.now(),
        });
    }
    broadcastSystemMessage(message) {
        this.io.emit('system_message', {
            ...message,
            timestamp: Date.now(),
        });
    }
    sendToUser(userId, event, data) {
        const socket = this.connectedUsers.get(userId);
        if (socket) {
            socket.emit(event, {
                ...data,
                timestamp: Date.now(),
            });
        }
    }
    getConnectedUserCount() {
        return this.connectedUsers.size;
    }
    getConnectedUsers() {
        return Array.from(this.connectedUsers.keys());
    }
    async close() {
        return new Promise((resolve) => {
            this.io.close(() => {
                this.logger.info('WebSocket server closed');
                resolve();
            });
        });
    }
}
exports.WebSocketManager = WebSocketManager;
//# sourceMappingURL=websocket.js.map