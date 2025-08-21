// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title HybridCLOB
 * @dev Smart Contract cho Hybrid Central Limit Order Book DEX
 * @notice Hỗ trợ đặt lệnh on-chain, matching off-chain, settlement on-chain
 */
contract HybridCLOB is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // =============================================================================
    // ROLES & CONSTANTS
    // =============================================================================
    
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    uint256 public constant MAX_BATCH_SIZE = 100;
    uint256 public constant ORDER_EXPIRY_TIME = 7 days;

    // =============================================================================
    // STRUCTS & ENUMS
    // =============================================================================
    
    enum OrderStatus {
        Active,      // 0 - Lệnh đang hoạt động
        Cancelled,   // 1 - Lệnh đã bị hủy
        Matched,     // 2 - Lệnh đã được khớp
        Expired      // 3 - Lệnh đã hết hạn
    }

    enum OrderSide {
        Buy,   // 0 - Lệnh mua
        Sell   // 1 - Lệnh bán
    }

    struct Order {
        uint256 id;              // ID duy nhất của lệnh
        address trader;          // Địa chỉ người đặt lệnh
        address baseToken;       // Token cơ sở (VD: ETH trong cặp ETH/USDC)
        address quoteToken;      // Token báo giá (VD: USDC trong cặp ETH/USDC)
        uint256 amount;          // Số lượng baseToken
        uint256 price;           // Giá (theo quoteToken) - scaled by 18 decimals
        OrderSide side;          // Mua hay bán
        OrderStatus status;      // Trạng thái lệnh
        uint256 filledAmount;    // Số lượng đã khớp
        uint256 timestamp;       // Thời gian tạo lệnh
        uint256 expiresAt;       // Thời gian hết hạn
        bytes32 signature;       // Chữ ký xác thực (optional)
    }

    struct Trade {
        uint256 buyOrderId;      // ID lệnh mua
        uint256 sellOrderId;     // ID lệnh bán
        uint256 amount;          // Số lượng giao dịch
        uint256 price;           // Giá giao dịch
        uint256 timestamp;       // Thời gian giao dịch
        address buyer;           // Người mua
        address seller;          // Người bán
    }

    struct SettlementBatch {
        uint256 batchId;         // ID batch
        uint256[] tradeIds;      // Danh sách trade IDs
        uint256 timestamp;       // Thời gian settle
        address settler;         // Người thực hiện settle
        bytes32 merkleRoot;      // Merkle root cho verification (optional)
    }

    // =============================================================================
    // STATE VARIABLES
    // =============================================================================
    
    uint256 public nextOrderId;
    uint256 public nextTradeId;
    uint256 public nextBatchId;
    
    // Mappings
    mapping(uint256 => Order) public orders;
    mapping(uint256 => Trade) public trades;
    mapping(uint256 => SettlementBatch) public batches;
    mapping(address => mapping(address => bool)) public supportedTradingPairs;
    mapping(address => uint256[]) public userOrders;
    mapping(bytes32 => bool) public processedBatches; // Prevent double settlement
    
    // Fee settings
    uint256 public makerFee = 25;  // 0.025% (basis points)
    uint256 public takerFee = 75;  // 0.075% (basis points)
    uint256 public constant FEE_DENOMINATOR = 100000;
    
    address public feeRecipient;

    // =============================================================================
    // EVENTS
    // =============================================================================
    
    event OrderPlaced(
        uint256 indexed orderId,
        address indexed trader,
        address indexed baseToken,
        address quoteToken,
        uint256 amount,
        uint256 price,
        OrderSide side,
        uint256 timestamp
    );
    
    event OrderCancelled(
        uint256 indexed orderId,
        address indexed trader,
        uint256 timestamp
    );
    
    event OrderMatched(
        uint256 indexed tradeId,
        uint256 indexed buyOrderId,
        uint256 indexed sellOrderId,
        uint256 amount,
        uint256 price,
        address buyer,
        address seller,
        uint256 timestamp
    );
    
    event BatchSettled(
        uint256 indexed batchId,
        uint256 tradesCount,
        address indexed settler,
        uint256 timestamp
    );
    
    event TradingPairAdded(
        address indexed baseToken,
        address indexed quoteToken
    );
    
    event TradingPairRemoved(
        address indexed baseToken,
        address indexed quoteToken
    );
    
    event FeesUpdated(
        uint256 makerFee,
        uint256 takerFee
    );

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================
    
    constructor(address _feeRecipient) {
        require(_feeRecipient != address(0), "Invalid fee recipient");
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SETTLER_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
        
        feeRecipient = _feeRecipient;
        nextOrderId = 1;
        nextTradeId = 1;
        nextBatchId = 1;
    }

    // =============================================================================
    // MODIFIERS
    // =============================================================================
    
    modifier validTradingPair(address baseToken, address quoteToken) {
        require(
            supportedTradingPairs[baseToken][quoteToken],
            "Trading pair not supported"
        );
        _;
    }
    
    modifier orderExists(uint256 orderId) {
        require(orders[orderId].trader != address(0), "Order does not exist");
        _;
    }
    
    modifier onlyOrderOwner(uint256 orderId) {
        require(orders[orderId].trader == msg.sender, "Not order owner");
        _;
    }

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================
    
    function addTradingPair(
        address baseToken,
        address quoteToken
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(baseToken != address(0) && quoteToken != address(0), "Invalid tokens");
        require(baseToken != quoteToken, "Tokens must be different");
        
        supportedTradingPairs[baseToken][quoteToken] = true;
        emit TradingPairAdded(baseToken, quoteToken);
    }
    
    function removeTradingPair(
        address baseToken,
        address quoteToken
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        supportedTradingPairs[baseToken][quoteToken] = false;
        emit TradingPairRemoved(baseToken, quoteToken);
    }
    
    function setFees(
        uint256 _makerFee,
        uint256 _takerFee
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_makerFee <= 1000 && _takerFee <= 1000, "Fee too high"); // Max 1%
        
        makerFee = _makerFee;
        takerFee = _takerFee;
        emit FeesUpdated(_makerFee, _takerFee);
    }
    
    function setFeeRecipient(address _feeRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_feeRecipient != address(0), "Invalid recipient");
        feeRecipient = _feeRecipient;
    }
    
    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(EMERGENCY_ROLE) {
        _unpause();
    }

    // =============================================================================
    // ORDER MANAGEMENT
    // =============================================================================
    
    /**
     * @dev Đặt lệnh mới
     * @param baseToken Token cơ sở
     * @param quoteToken Token báo giá
     * @param amount Số lượng baseToken
     * @param price Giá (scaled by 18 decimals)
     * @param side Loại lệnh (Buy/Sell)
     * @param expiresAt Thời gian hết hạn (0 = không hết hạn)
     */
    function placeOrder(
        address baseToken,
        address quoteToken,
        uint256 amount,
        uint256 price,
        OrderSide side,
        uint256 expiresAt
    ) external nonReentrant whenNotPaused validTradingPair(baseToken, quoteToken) returns (uint256) {
        require(amount > 0, "Amount must be positive");
        require(price > 0, "Price must be positive");
        
        if (expiresAt > 0) {
            require(expiresAt > block.timestamp, "Invalid expiry time");
            require(expiresAt <= block.timestamp + ORDER_EXPIRY_TIME, "Expiry too far");
        }
        
        uint256 orderId = nextOrderId++;
        
        // Tạo order
        orders[orderId] = Order({
            id: orderId,
            trader: msg.sender,
            baseToken: baseToken,
            quoteToken: quoteToken,
            amount: amount,
            price: price,
            side: side,
            status: OrderStatus.Active,
            filledAmount: 0,
            timestamp: block.timestamp,
            expiresAt: expiresAt,
            signature: bytes32(0)
        });
        
        // Lock tokens nếu cần
        if (side == OrderSide.Sell) {
            // Lệnh bán: lock baseToken
            IERC20(baseToken).safeTransferFrom(msg.sender, address(this), amount);
        } else {
            // Lệnh mua: lock quoteToken (amount * price)
            uint256 requiredQuote = (amount * price) / 1e18;
            IERC20(quoteToken).safeTransferFrom(msg.sender, address(this), requiredQuote);
        }
        
        // Lưu vào user orders
        userOrders[msg.sender].push(orderId);
        
        emit OrderPlaced(
            orderId,
            msg.sender,
            baseToken,
            quoteToken,
            amount,
            price,
            side,
            block.timestamp
        );
        
        return orderId;
    }
    
    /**
     * @dev Hủy lệnh
     */
    function cancelOrder(uint256 orderId) 
        external 
        nonReentrant 
        orderExists(orderId) 
        onlyOrderOwner(orderId) 
    {
        Order storage order = orders[orderId];
        require(order.status == OrderStatus.Active, "Order not active");
        require(
            order.expiresAt == 0 || block.timestamp < order.expiresAt,
            "Order expired"
        );
        
        order.status = OrderStatus.Cancelled;
        
        // Hoàn trả tokens
        uint256 remainingAmount = order.amount - order.filledAmount;
        if (remainingAmount > 0) {
            if (order.side == OrderSide.Sell) {
                IERC20(order.baseToken).safeTransfer(order.trader, remainingAmount);
            } else {
                uint256 remainingQuote = (remainingAmount * order.price) / 1e18;
                IERC20(order.quoteToken).safeTransfer(order.trader, remainingQuote);
            }
        }
        
        emit OrderCancelled(orderId, msg.sender, block.timestamp);
    }

    // =============================================================================
    // SETTLEMENT FUNCTIONS
    // =============================================================================
    
    /**
     * @dev Settle batch các trades từ off-chain matching
     * @param buyOrderIds Danh sách buy order IDs
     * @param sellOrderIds Danh sách sell order IDs  
     * @param amounts Danh sách amounts cho từng trade
     * @param prices Danh sách prices cho từng trade
     * @param batchHash Hash của batch để verify
     */
    function settleBatch(
        uint256[] calldata buyOrderIds,
        uint256[] calldata sellOrderIds,
        uint256[] calldata amounts,
        uint256[] calldata prices,
        bytes32 batchHash
    ) external nonReentrant onlyRole(SETTLER_ROLE) whenNotPaused {
        require(buyOrderIds.length == sellOrderIds.length, "Arrays length mismatch");
        require(buyOrderIds.length == amounts.length, "Arrays length mismatch");
        require(buyOrderIds.length == prices.length, "Arrays length mismatch");
        require(buyOrderIds.length <= MAX_BATCH_SIZE, "Batch too large");
        require(!processedBatches[batchHash], "Batch already processed");
        
        processedBatches[batchHash] = true;
        uint256 batchId = nextBatchId++;
        uint256[] memory tradeIds = new uint256[](buyOrderIds.length);
        
        for (uint256 i = 0; i < buyOrderIds.length; i++) {
            uint256 tradeId = _settleTrade(
                buyOrderIds[i],
                sellOrderIds[i],
                amounts[i],
                prices[i]
            );
            tradeIds[i] = tradeId;
        }
        
        // Lưu batch info
        batches[batchId] = SettlementBatch({
            batchId: batchId,
            tradeIds: tradeIds,
            timestamp: block.timestamp,
            settler: msg.sender,
            merkleRoot: batchHash
        });
        
        emit BatchSettled(batchId, buyOrderIds.length, msg.sender, block.timestamp);
    }
    
    /**
     * @dev Internal function để settle một trade
     */
    function _settleTrade(
        uint256 buyOrderId,
        uint256 sellOrderId,
        uint256 amount,
        uint256 price
    ) internal returns (uint256) {
        Order storage buyOrder = orders[buyOrderId];
        Order storage sellOrder = orders[sellOrderId];
        
        // Validations
        require(buyOrder.status == OrderStatus.Active, "Buy order not active");
        require(sellOrder.status == OrderStatus.Active, "Sell order not active");
        require(buyOrder.side == OrderSide.Buy, "Invalid buy order");
        require(sellOrder.side == OrderSide.Sell, "Invalid sell order");
        require(buyOrder.baseToken == sellOrder.baseToken, "Token mismatch");
        require(buyOrder.quoteToken == sellOrder.quoteToken, "Token mismatch");
        
        // Check expiry
        if (buyOrder.expiresAt > 0) {
            require(block.timestamp < buyOrder.expiresAt, "Buy order expired");
        }
        if (sellOrder.expiresAt > 0) {
            require(block.timestamp < sellOrder.expiresAt, "Sell order expired");
        }
        
        // Check amounts
        require(
            buyOrder.filledAmount + amount <= buyOrder.amount,
            "Buy order insufficient amount"
        );
        require(
            sellOrder.filledAmount + amount <= sellOrder.amount,
            "Sell order insufficient amount"
        );
        
        uint256 tradeId = nextTradeId++;
        
        // Update order filled amounts
        buyOrder.filledAmount += amount;
        sellOrder.filledAmount += amount;
        
        // Mark orders as matched if fully filled
        if (buyOrder.filledAmount == buyOrder.amount) {
            buyOrder.status = OrderStatus.Matched;
        }
        if (sellOrder.filledAmount == sellOrder.amount) {
            sellOrder.status = OrderStatus.Matched;
        }
        
        // Calculate fees
        uint256 quoteAmount = (amount * price) / 1e18;
        uint256 buyerFee = (quoteAmount * takerFee) / FEE_DENOMINATOR;
        uint256 sellerFee = (quoteAmount * makerFee) / FEE_DENOMINATOR;
        
        // Execute transfers
        // Seller gets quoteToken (minus fees)
        IERC20(sellOrder.quoteToken).safeTransfer(
            sellOrder.trader,
            quoteAmount - sellerFee
        );
        
        // Buyer gets baseToken  
        IERC20(buyOrder.baseToken).safeTransfer(buyOrder.trader, amount);
        
        // Transfer fees to fee recipient
        if (buyerFee > 0) {
            IERC20(buyOrder.quoteToken).safeTransfer(feeRecipient, buyerFee);
        }
        if (sellerFee > 0) {
            IERC20(sellOrder.quoteToken).safeTransfer(feeRecipient, sellerFee);
        }
        
        // Create trade record
        trades[tradeId] = Trade({
            buyOrderId: buyOrderId,
            sellOrderId: sellOrderId,
            amount: amount,
            price: price,
            timestamp: block.timestamp,
            buyer: buyOrder.trader,
            seller: sellOrder.trader
        });
        
        emit OrderMatched(
            tradeId,
            buyOrderId,
            sellOrderId,
            amount,
            price,
            buyOrder.trader,
            sellOrder.trader,
            block.timestamp
        );
        
        return tradeId;
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================
    
    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }
    
    function getTrade(uint256 tradeId) external view returns (Trade memory) {
        return trades[tradeId];
    }
    
    function getBatch(uint256 batchId) external view returns (SettlementBatch memory) {
        return batches[batchId];
    }
    
    function getUserOrders(address user) external view returns (uint256[] memory) {
        return userOrders[user];
    }
    
    function getUserActiveOrders(address user) external view returns (uint256[] memory) {
        uint256[] memory allOrders = userOrders[user];
        uint256 activeCount = 0;
        
        // Count active orders
        for (uint256 i = 0; i < allOrders.length; i++) {
            if (orders[allOrders[i]].status == OrderStatus.Active) {
                activeCount++;
            }
        }
        
        // Build result array
        uint256[] memory activeOrders = new uint256[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < allOrders.length; i++) {
            if (orders[allOrders[i]].status == OrderStatus.Active) {
                activeOrders[index] = allOrders[i];
                index++;
            }
        }
        
        return activeOrders;
    }
    
    function isTradingPairSupported(
        address baseToken,
        address quoteToken
    ) external view returns (bool) {
        return supportedTradingPairs[baseToken][quoteToken];
    }

    // =============================================================================
    // EMERGENCY FUNCTIONS
    // =============================================================================
    
    /**
     * @dev Emergency withdraw function - chỉ dùng trong trường hợp khẩn cấp
     */
    function emergencyWithdraw(
        address token,
        uint256 amount,
        address recipient
    ) external onlyRole(EMERGENCY_ROLE) {
        require(recipient != address(0), "Invalid recipient");
        IERC20(token).safeTransfer(recipient, amount);
    }
    
    /**
     * @dev Batch cancel orders - dùng khi có vấn đề
     */
    function emergencyCancelOrders(
        uint256[] calldata orderIds
    ) external onlyRole(EMERGENCY_ROLE) {
        for (uint256 i = 0; i < orderIds.length; i++) {
            uint256 orderId = orderIds[i];
            Order storage order = orders[orderId];
            
            if (order.status == OrderStatus.Active) {
                order.status = OrderStatus.Cancelled;
                
                // Refund tokens
                uint256 remainingAmount = order.amount - order.filledAmount;
                if (remainingAmount > 0) {
                    if (order.side == OrderSide.Sell) {
                        IERC20(order.baseToken).safeTransfer(order.trader, remainingAmount);
                    } else {
                        uint256 remainingQuote = (remainingAmount * order.price) / 1e18;
                        IERC20(order.quoteToken).safeTransfer(order.trader, remainingQuote);
                    }
                }
                
                emit OrderCancelled(orderId, order.trader, block.timestamp);
            }
        }
    }
}
