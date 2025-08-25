// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./HybridCLOB.sol";
import "./LiquidityPool.sol";
import "./PoolFactory.sol";

/**
 * @title HybridRouter
 * @dev Smart router for optimal execution across CLOB and AMM
 * @notice Routes trades through best available liquidity sources
 */
contract HybridRouter is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =============================================================================
    // ROLES & CONSTANTS
    // =============================================================================
    
    bytes32 public constant ROUTER_MANAGER_ROLE = keccak256("ROUTER_MANAGER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    uint256 public constant MAX_SLIPPAGE = 1000; // 10% maximum slippage
    uint256 public constant SLIPPAGE_PRECISION = 10000; // 100.00%

    // =============================================================================
    // STATE VARIABLES
    // =============================================================================
    
    HybridCLOB public immutable hybridCLOB;
    PoolFactory public immutable poolFactory;
    
    // Routing configuration
    bool public clobEnabled = true;
    bool public ammEnabled = true;
    uint256 public defaultSlippage = 100; // 1% default slippage
    uint256 public minTradeSize = 1e6; // Minimum trade size (adjusted for decimals)
    
    // Statistics
    uint256 public totalCLOBVolume;
    uint256 public totalAMMVolume;
    uint256 public totalHybridTrades;
    
    mapping(address => uint256) public userTradeCounts;

    // =============================================================================
    // STRUCTS & ENUMS
    // =============================================================================
    
    enum RouteType {
        CLOB_ONLY,
        AMM_ONLY,
        HYBRID_CLOB_FIRST,
        HYBRID_AMM_FIRST
    }
    
    struct RouteQuote {
        RouteType routeType;
        uint256 amountOut;
        uint256 priceImpact;
        uint256 gasCost;
        address[] pools;
        uint256 clobFillRatio;
        uint256 ammFillRatio;
    }
    
    struct TradeParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 maxSlippage;
        address to;
        uint256 deadline;
        bool preferCLOB;
    }
    
    struct ExecutionResult {
        uint256 amountOut;
        uint256 actualSlippage;
        RouteType usedRoute;
        uint256 clobAmount;
        uint256 ammAmount;
        uint256 gasUsed;
    }

    // =============================================================================
    // EVENTS
    // =============================================================================
    
    event TradeExecuted(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        RouteType routeType,
        uint256 slippage
    );
    
    event RouteOptimized(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        RouteType selectedRoute,
        uint256 expectedAmountOut
    );
    
    event ConfigurationUpdated(
        bool clobEnabled,
        bool ammEnabled,
        uint256 defaultSlippage,
        uint256 minTradeSize
    );

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================
    
    constructor(address _hybridCLOB, address _poolFactory) {
        require(_hybridCLOB != address(0), "Invalid CLOB address");
        require(_poolFactory != address(0), "Invalid factory address");
        
        hybridCLOB = HybridCLOB(_hybridCLOB);
        poolFactory = PoolFactory(_poolFactory);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ROUTER_MANAGER_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
    }

    // =============================================================================
    // ROUTING FUNCTIONS
    // =============================================================================
    
    /**
     * @dev Get optimal route quote for a trade
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Input amount
     * @param preferCLOB Whether to prefer CLOB over AMM
     */
    function getOptimalQuote(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bool preferCLOB
    ) external view returns (RouteQuote memory bestQuote) {
        require(tokenIn != tokenOut, "Identical tokens");
        require(amountIn > 0, "Invalid amount");
        
        RouteQuote memory clobQuote;
        RouteQuote memory ammQuote;
        RouteQuote memory hybridQuote;
        
        // Get CLOB quote
        if (clobEnabled) {
            clobQuote = _getCLOBQuote(tokenIn, tokenOut, amountIn);
        }
        
        // Get AMM quote
        if (ammEnabled) {
            ammQuote = _getAMMQuote(tokenIn, tokenOut, amountIn);
        }
        
        // Get hybrid quote (split execution)
        if (clobEnabled && ammEnabled) {
            hybridQuote = _getHybridQuote(tokenIn, tokenOut, amountIn);
        }
        
        // Select best quote
        bestQuote = _selectBestQuote(clobQuote, ammQuote, hybridQuote, preferCLOB);
    }
    
    /**
     * @dev Execute optimal trade
     * @param params Trade parameters
     */
    function executeOptimalTrade(TradeParams calldata params) 
        external 
        nonReentrant 
        returns (ExecutionResult memory result) 
    {
        require(params.deadline >= block.timestamp, "Trade expired");
        require(params.amountIn >= minTradeSize, "Trade too small");
        require(params.maxSlippage <= MAX_SLIPPAGE, "Slippage too high");
        require(params.to != address(0), "Invalid recipient");
        
        // Get optimal quote
        RouteQuote memory quote = this.getOptimalQuote(
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            params.preferCLOB
        );
        
        require(quote.amountOut >= params.minAmountOut, "Insufficient output amount");
        
        // Transfer tokens from user
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        
        // Execute trade based on optimal route
        result = _executeTrade(params, quote);
        
        // Transfer output tokens to user
        IERC20(params.tokenOut).safeTransfer(params.to, result.amountOut);
        
        // Update statistics
        _updateStatistics(params, result);
        
        emit TradeExecuted(
            msg.sender,
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            result.amountOut,
            result.usedRoute,
            result.actualSlippage
        );
    }
    
    /**
     * @dev Execute trade through CLOB only
     * @param tokenIn Input token
     * @param tokenOut Output token  
     * @param amountIn Input amount
     * @param minAmountOut Minimum output amount
     * @param to Recipient address
     * @param deadline Transaction deadline
     */
    function swapExactTokensForTokensCLOB(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address to,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        require(clobEnabled, "CLOB disabled");
        require(deadline >= block.timestamp, "Trade expired");
        
        // Transfer tokens from user
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        
        // Execute CLOB trade
        amountOut = _executeCLOBTrade(tokenIn, tokenOut, amountIn);
        require(amountOut >= minAmountOut, "Insufficient output amount");
        
        // Transfer output tokens
        IERC20(tokenOut).safeTransfer(to, amountOut);
        
        totalCLOBVolume += amountIn;
        userTradeCounts[msg.sender]++;
        
        emit TradeExecuted(
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut,
            RouteType.CLOB_ONLY,
            _calculateSlippage(amountIn, amountOut)
        );
    }
    
    /**
     * @dev Execute trade through AMM only
     * @param tokenIn Input token
     * @param tokenOut Output token
     * @param amountIn Input amount  
     * @param minAmountOut Minimum output amount
     * @param to Recipient address
     * @param deadline Transaction deadline
     */
    function swapExactTokensForTokensAMM(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address to,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        require(ammEnabled, "AMM disabled");
        require(deadline >= block.timestamp, "Trade expired");
        
        // Find pool
        address pool = poolFactory.getPoolByTokens(tokenIn, tokenOut);
        require(pool != address(0), "Pool not found");
        
        // Transfer tokens from user
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        
        // Execute AMM trade
        amountOut = _executeAMMTrade(pool, tokenIn, tokenOut, amountIn);
        require(amountOut >= minAmountOut, "Insufficient output amount");
        
        // Transfer output tokens
        IERC20(tokenOut).safeTransfer(to, amountOut);
        
        totalAMMVolume += amountIn;
        userTradeCounts[msg.sender]++;
        
        emit TradeExecuted(
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut,
            RouteType.AMM_ONLY,
            _calculateSlippage(amountIn, amountOut)
        );
    }

    // =============================================================================
    // LIQUIDITY FUNCTIONS
    // =============================================================================
    
    /**
     * @dev Add liquidity to AMM pool
     * @param tokenA First token
     * @param tokenB Second token
     * @param amountADesired Desired amount of tokenA
     * @param amountBDesired Desired amount of tokenB
     * @param amountAMin Minimum amount of tokenA
     * @param amountBMin Minimum amount of tokenB
     * @param to LP token recipient
     * @param deadline Transaction deadline
     */
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        require(deadline >= block.timestamp, "Transaction expired");
        
        // Find or create pool
        address pool = poolFactory.getPoolByTokens(tokenA, tokenB);
        require(pool != address(0), "Pool not found");
        
        // Transfer tokens to pool
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountADesired);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountBDesired);
        
        // Approve pool to spend tokens
        IERC20(tokenA).safeApprove(pool, amountADesired);
        IERC20(tokenB).safeApprove(pool, amountBDesired);
        
        // Add liquidity through pool
        liquidity = LiquidityPool(pool).addLiquidity(
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin,
            to,
            deadline
        );
        
        // Calculate actual amounts used
        amountA = amountADesired; // Simplified - in production, calculate actual amounts
        amountB = amountBDesired;
        
        // Refund unused tokens
        uint256 balanceA = IERC20(tokenA).balanceOf(address(this));
        uint256 balanceB = IERC20(tokenB).balanceOf(address(this));
        
        if (balanceA > 0) IERC20(tokenA).safeTransfer(msg.sender, balanceA);
        if (balanceB > 0) IERC20(tokenB).safeTransfer(msg.sender, balanceB);
    }
    
    /**
     * @dev Remove liquidity from AMM pool
     * @param tokenA First token
     * @param tokenB Second token
     * @param liquidity LP tokens to burn
     * @param amountAMin Minimum tokenA to receive
     * @param amountBMin Minimum tokenB to receive
     * @param to Token recipient
     * @param deadline Transaction deadline
     */
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountA, uint256 amountB) {
        require(deadline >= block.timestamp, "Transaction expired");
        
        // Find pool
        address pool = poolFactory.getPoolByTokens(tokenA, tokenB);
        require(pool != address(0), "Pool not found");
        
        // Transfer LP tokens from user
        IERC20(pool).safeTransferFrom(msg.sender, address(this), liquidity);
        
        // Remove liquidity
        (amountA, amountB) = LiquidityPool(pool).removeLiquidity(
            liquidity,
            amountAMin,
            amountBMin,
            to,
            deadline
        );
    }

    // =============================================================================
    // INTERNAL FUNCTIONS
    // =============================================================================
    
    /**
     * @dev Get CLOB quote
     */
    function _getCLOBQuote(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal view returns (RouteQuote memory quote) {
        // This would integrate with CLOB orderbook to get quote
        // For now, return mock data
        quote.routeType = RouteType.CLOB_ONLY;
        quote.amountOut = amountIn * 99 / 100; // 1% spread
        quote.priceImpact = 50; // 0.5%
        quote.gasCost = 150000; // Estimated gas
        quote.clobFillRatio = 10000; // 100%
        quote.ammFillRatio = 0;
    }
    
    /**
     * @dev Get AMM quote
     */
    function _getAMMQuote(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal view returns (RouteQuote memory quote) {
        address pool = poolFactory.getPoolByTokens(tokenIn, tokenOut);
        
        if (pool != address(0)) {
            LiquidityPool poolContract = LiquidityPool(pool);
            (uint112 reserve0, uint112 reserve1,) = poolContract.getReserves();
            
            if (reserve0 > 0 && reserve1 > 0) {
                address token0 = poolContract.token0();
                
                uint256 reserveIn = tokenIn == token0 ? reserve0 : reserve1;
                uint256 reserveOut = tokenIn == token0 ? reserve1 : reserve0;
                
                quote.routeType = RouteType.AMM_ONLY;
                quote.amountOut = poolContract.getAmountOut(amountIn, reserveIn, reserveOut);
                quote.priceImpact = _calculatePriceImpact(amountIn, reserveIn);
                quote.gasCost = 100000; // Estimated gas
                quote.pools = new address[](1);
                quote.pools[0] = pool;
                quote.clobFillRatio = 0;
                quote.ammFillRatio = 10000; // 100%
            }
        }
    }
    
    /**
     * @dev Get hybrid quote (split execution)
     */
    function _getHybridQuote(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal view returns (RouteQuote memory quote) {
        RouteQuote memory clobQuote = _getCLOBQuote(tokenIn, tokenOut, amountIn / 2);
        RouteQuote memory ammQuote = _getAMMQuote(tokenIn, tokenOut, amountIn / 2);
        
        if (clobQuote.amountOut > 0 && ammQuote.amountOut > 0) {
            quote.routeType = RouteType.HYBRID_CLOB_FIRST;
            quote.amountOut = clobQuote.amountOut + ammQuote.amountOut;
            quote.priceImpact = (clobQuote.priceImpact + ammQuote.priceImpact) / 2;
            quote.gasCost = clobQuote.gasCost + ammQuote.gasCost;
            quote.pools = ammQuote.pools;
            quote.clobFillRatio = 5000; // 50%
            quote.ammFillRatio = 5000; // 50%
        }
    }
    
    /**
     * @dev Select best quote among options
     */
    function _selectBestQuote(
        RouteQuote memory clobQuote,
        RouteQuote memory ammQuote,
        RouteQuote memory hybridQuote,
        bool preferCLOB
    ) internal pure returns (RouteQuote memory bestQuote) {
        // Simple selection logic - in production, this would be more sophisticated
        if (preferCLOB && clobQuote.amountOut > 0) {
            bestQuote = clobQuote;
        } else if (hybridQuote.amountOut > clobQuote.amountOut && hybridQuote.amountOut > ammQuote.amountOut) {
            bestQuote = hybridQuote;
        } else if (ammQuote.amountOut > clobQuote.amountOut) {
            bestQuote = ammQuote;
        } else {
            bestQuote = clobQuote;
        }
    }
    
    /**
     * @dev Execute trade based on selected route
     */
    function _executeTrade(
        TradeParams calldata params,
        RouteQuote memory quote
    ) internal returns (ExecutionResult memory result) {
        uint256 gasStart = gasleft();
        
        if (quote.routeType == RouteType.CLOB_ONLY) {
            result.amountOut = _executeCLOBTrade(params.tokenIn, params.tokenOut, params.amountIn);
            result.clobAmount = params.amountIn;
            
        } else if (quote.routeType == RouteType.AMM_ONLY) {
            result.amountOut = _executeAMMTrade(quote.pools[0], params.tokenIn, params.tokenOut, params.amountIn);
            result.ammAmount = params.amountIn;
            
        } else if (quote.routeType == RouteType.HYBRID_CLOB_FIRST || quote.routeType == RouteType.HYBRID_AMM_FIRST) {
            uint256 clobAmount = params.amountIn * quote.clobFillRatio / 10000;
            uint256 ammAmount = params.amountIn - clobAmount;
            
            uint256 clobOut = _executeCLOBTrade(params.tokenIn, params.tokenOut, clobAmount);
            uint256 ammOut = _executeAMMTrade(quote.pools[0], params.tokenIn, params.tokenOut, ammAmount);
            
            result.amountOut = clobOut + ammOut;
            result.clobAmount = clobAmount;
            result.ammAmount = ammAmount;
        }
        
        result.usedRoute = quote.routeType;
        result.actualSlippage = _calculateSlippage(params.amountIn, result.amountOut);
        result.gasUsed = gasStart - gasleft();
    }
    
    /**
     * @dev Execute CLOB trade (mock implementation)
     */
    function _executeCLOBTrade(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256 amountOut) {
        // Mock implementation - in production, this would interact with CLOB
        amountOut = amountIn * 99 / 100; // 1% spread simulation
    }
    
    /**
     * @dev Execute AMM trade
     */
    function _executeAMMTrade(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256 amountOut) {
        LiquidityPool poolContract = LiquidityPool(pool);
        
        // Approve pool to spend tokens
        IERC20(tokenIn).safeApprove(pool, amountIn);
        
        // Get reserves and calculate amounts
        (uint112 reserve0, uint112 reserve1,) = poolContract.getReserves();
        address token0 = poolContract.token0();
        
        uint256 amount0Out = 0;
        uint256 amount1Out = 0;
        
        if (tokenIn == token0) {
            amount1Out = poolContract.getAmountOut(amountIn, reserve0, reserve1);
            amountOut = amount1Out;
        } else {
            amount0Out = poolContract.getAmountOut(amountIn, reserve1, reserve0);
            amountOut = amount0Out;
        }
        
        // Transfer tokens to pool
        IERC20(tokenIn).safeTransfer(pool, amountIn);
        
        // Execute swap
        poolContract.swap(amount0Out, amount1Out, address(this), "");
    }
    
    /**
     * @dev Calculate price impact
     */
    function _calculatePriceImpact(uint256 amountIn, uint256 reserve) internal pure returns (uint256) {
        if (reserve == 0) return 0;
        return (amountIn * 10000) / reserve; // Price impact in basis points
    }
    
    /**
     * @dev Calculate slippage
     */
    function _calculateSlippage(uint256 amountIn, uint256 amountOut) internal pure returns (uint256) {
        if (amountIn == 0) return 0;
        return ((amountIn - amountOut) * 10000) / amountIn; // Slippage in basis points
    }
    
    /**
     * @dev Update trading statistics
     */
    function _updateStatistics(TradeParams calldata params, ExecutionResult memory result) internal {
        if (result.usedRoute == RouteType.CLOB_ONLY) {
            totalCLOBVolume += params.amountIn;
        } else if (result.usedRoute == RouteType.AMM_ONLY) {
            totalAMMVolume += params.amountIn;
        } else {
            totalCLOBVolume += result.clobAmount;
            totalAMMVolume += result.ammAmount;
        }
        
        totalHybridTrades++;
        userTradeCounts[msg.sender]++;
    }

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================
    
    /**
     * @dev Update router configuration
     */
    function updateConfiguration(
        bool _clobEnabled,
        bool _ammEnabled,
        uint256 _defaultSlippage,
        uint256 _minTradeSize
    ) external onlyRole(ROUTER_MANAGER_ROLE) {
        require(_defaultSlippage <= MAX_SLIPPAGE, "Slippage too high");
        
        clobEnabled = _clobEnabled;
        ammEnabled = _ammEnabled;
        defaultSlippage = _defaultSlippage;
        minTradeSize = _minTradeSize;
        
        emit ConfigurationUpdated(_clobEnabled, _ammEnabled, _defaultSlippage, _minTradeSize);
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================
    
    /**
     * @dev Get router statistics
     */
    function getRouterStats() external view returns (
        uint256 _totalCLOBVolume,
        uint256 _totalAMMVolume,
        uint256 _totalHybridTrades,
        bool _clobEnabled,
        bool _ammEnabled
    ) {
        return (
            totalCLOBVolume,
            totalAMMVolume,
            totalHybridTrades,
            clobEnabled,
            ammEnabled
        );
    }
    
    /**
     * @dev Get user trading statistics
     */
    function getUserStats(address user) external view returns (uint256 tradeCount) {
        return userTradeCounts[user];
    }
}
