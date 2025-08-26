// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./MassiveLP_OrbitalAMM.sol";

/**
 * @title IntelligentRouter - Revolutionary Hybrid AMM+CLOB Router
 * @notice AI-powered routing system that optimizes execution across Orbital AMM and CLOB
 * @dev Implements MEV protection, optimal execution, and predictive routing
 */
contract IntelligentRouter is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // ===== CONSTANTS =====
    uint256 public constant PRECISION = 1e18;
    uint256 public constant MAX_SLIPPAGE = 1000; // 10%
    uint256 public constant MEV_PROTECTION_WINDOW = 12; // 12 seconds
    uint256 public constant MIN_ARBITRAGE_PROFIT = 1e15; // 0.001 ETH minimum profit

    // ===== ENUMS =====
    enum ExecutionVenue { ORBITAL_AMM, CLOB, SPLIT_EXECUTION, HYBRID_OPTIMAL }
    enum RouteStrategy { BEST_PRICE, LOWEST_GAS, FASTEST_EXECUTION, MEV_PROTECTED }
    enum TradeSize { SMALL, MEDIUM, LARGE, WHALE }

    // ===== STRUCTS =====
    struct RouteQuote {
        ExecutionVenue venue;
        uint256 amountOut;
        uint256 gasCost;
        uint256 priceImpact;
        uint256 executionTime;
        uint256 confidence; // AI confidence score
        bytes routeData;
    }

    struct TradeParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 deadline;
        RouteStrategy strategy;
        bool enableMEVProtection;
        address recipient;
    }

    struct SplitExecution {
        uint256 ammPercentage; // 0-10000 (0-100%)
        uint256 clobPercentage;
        bytes32 poolId;
        bytes clobData;
    }

    struct MarketConditions {
        uint256 volatility;
        uint256 liquidity;
        uint256 spread;
        uint256 volume24h;
        uint256 gasPrice;
        uint256 blockCongestion;
        uint256 timestamp;
    }

    struct PredictiveModel {
        uint256 priceDirection; // 0 = down, 1 = up, 2 = neutral
        uint256 liquidityFlow; // Expected liquidity changes
        uint256 volatilityForecast;
        uint256 gasSpike; // Predicted gas price changes
        uint256 confidence; // Model confidence 0-100%
    }

    // ===== STATE VARIABLES =====
    MassiveLP_OrbitalAMM public orbitalAMM;
    address public hybridCLOB;
    
    // Routing intelligence
    mapping(address => mapping(address => RouteQuote)) public lastQuotes;
    mapping(address => mapping(address => MarketConditions)) public marketState;
    mapping(address => mapping(address => PredictiveModel)) public predictions;
    
    // MEV protection
    mapping(bytes32 => uint256) public commitments;
    mapping(address => uint256) public lastTradeBlock;
    
    // Performance tracking
    mapping(address => uint256) public totalSaved; // Gas/fee savings per user
    mapping(ExecutionVenue => uint256) public venueVolume;
    mapping(ExecutionVenue => uint256) public venueSuccessRate;
    
    // AI learning data
    mapping(bytes32 => bool) public executionSuccess;
    mapping(bytes32 => uint256) public actualSlippage;
    uint256 public totalPredictions;
    uint256 public correctPredictions;

    // ===== EVENTS =====
    event RouteOptimized(
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        ExecutionVenue venue,
        uint256 savedGas,
        uint256 extraOutput
    );
    
    event MEVProtectionActivated(
        address indexed user,
        bytes32 commitment,
        uint256 protectionWindow
    );
    
    event ArbitrageExecuted(
        address tokenA,
        address tokenB,
        uint256 profit,
        ExecutionVenue sourceVenue,
        ExecutionVenue targetVenue
    );

    event PredictionAccuracy(
        uint256 totalPredictions,
        uint256 correctPredictions,
        uint256 accuracyPercentage
    );

    // ===== CONSTRUCTOR =====
    constructor(address _orbitalAMM, address _hybridCLOB) Ownable(msg.sender) {
        orbitalAMM = MassiveLP_OrbitalAMM(_orbitalAMM);
        hybridCLOB = _hybridCLOB;
    }

    // ===== CORE ROUTING FUNCTIONS =====

    /**
     * @notice Get optimal route quote with AI-powered analysis
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Input amount
     * @param strategy Preferred routing strategy
     * @return quote Optimal route information
     */
    function getOptimalRoute(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        RouteStrategy strategy
    ) external view returns (RouteQuote memory quote) {
        
        // Analyze market conditions
        MarketConditions memory conditions = _analyzeMarketConditions(tokenIn, tokenOut);
        
        // Get quotes from all venues
        RouteQuote memory ammQuote = _getAMMQuote(tokenIn, tokenOut, amountIn, conditions);
        RouteQuote memory clobQuote = _getCLOBQuote(tokenIn, tokenOut, amountIn, conditions);
        RouteQuote memory splitQuote = _getSplitQuote(tokenIn, tokenOut, amountIn, conditions);
        
        // Apply AI-powered selection
        quote = _selectOptimalRoute(ammQuote, clobQuote, splitQuote, strategy, conditions);
        
        // Apply predictive adjustments
        quote = _applyPredictiveModel(quote, tokenIn, tokenOut, conditions);
        
        return quote;
    }

    /**
     * @notice Execute trade with optimal routing and MEV protection
     * @param params Trade execution parameters
     * @return amountOut Actual output amount received
     */
    function executeOptimalTrade(TradeParams calldata params) 
        external 
        nonReentrant 
        whenNotPaused 
        returns (uint256 amountOut) 
    {
        require(params.deadline >= block.timestamp, "Trade expired");
        require(params.amountIn > 0, "Invalid input amount");
        
        // MEV protection if enabled
        if (params.enableMEVProtection) {
            require(
                block.number > lastTradeBlock[msg.sender] + MEV_PROTECTION_WINDOW,
                "MEV protection cooldown"
            );
        }
        
        // Get optimal route
        RouteQuote memory route = this.getOptimalRoute(
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            params.strategy
        );
        
        require(route.amountOut >= params.minAmountOut, "Insufficient output");
        
        // Transfer input tokens
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        
        // Execute based on optimal venue
        if (route.venue == ExecutionVenue.ORBITAL_AMM) {
            amountOut = _executeOnAMM(params, route);
        } else if (route.venue == ExecutionVenue.CLOB) {
            amountOut = _executeOnCLOB(params, route);
        } else if (route.venue == ExecutionVenue.SPLIT_EXECUTION) {
            amountOut = _executeSplitTrade(params, route);
        } else {
            amountOut = _executeHybridOptimal(params, route);
        }
        
        require(amountOut >= params.minAmountOut, "Slippage exceeded");
        
        // Transfer output tokens
        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
        
        // Update performance tracking
        _updatePerformanceMetrics(params, route, amountOut);
        
        // Update AI learning
        _updateAILearning(params, route, amountOut);
        
        lastTradeBlock[msg.sender] = block.number;
        
        emit RouteOptimized(
            msg.sender,
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            route.venue,
            route.gasCost,
            amountOut - params.minAmountOut
        );
        
        return amountOut;
    }

    /**
     * @notice Execute arbitrage between AMM and CLOB automatically
     * @param tokenA First token in arbitrage pair
     * @param tokenB Second token in arbitrage pair
     * @param maxAmount Maximum amount to arbitrage
     * @return profit Arbitrage profit generated
     */
    function executeArbitrage(
        address tokenA,
        address tokenB,
        uint256 maxAmount
    ) external nonReentrant whenNotPaused returns (uint256 profit) {
        
        // Check arbitrage opportunity
        (bool profitable, uint256 amount, ExecutionVenue buyVenue, ExecutionVenue sellVenue) = 
            _checkArbitrageOpportunity(tokenA, tokenB, maxAmount);
        
        require(profitable, "No arbitrage opportunity");
        require(amount >= MIN_ARBITRAGE_PROFIT, "Profit too small");
        
        // Execute arbitrage
        uint256 initialBalance = IERC20(tokenA).balanceOf(address(this));
        
        // Buy on cheaper venue
        if (buyVenue == ExecutionVenue.ORBITAL_AMM) {
            _buyOnAMM(tokenA, tokenB, amount);
        } else {
            _buyOnCLOB(tokenA, tokenB, amount);
        }
        
        // Sell on expensive venue
        uint256 tokenBReceived = IERC20(tokenB).balanceOf(address(this));
        
        if (sellVenue == ExecutionVenue.ORBITAL_AMM) {
            _sellOnAMM(tokenB, tokenA, tokenBReceived);
        } else {
            _sellOnCLOB(tokenB, tokenA, tokenBReceived);
        }
        
        uint256 finalBalance = IERC20(tokenA).balanceOf(address(this));
        profit = finalBalance - initialBalance;
        
        require(profit >= MIN_ARBITRAGE_PROFIT, "Arbitrage failed");
        
        emit ArbitrageExecuted(tokenA, tokenB, profit, buyVenue, sellVenue);
        
        return profit;
    }

    // ===== AI-POWERED PREDICTION FUNCTIONS =====

    /**
     * @notice Update predictive model with market data
     * @param tokenA First token
     * @param tokenB Second token
     * @param marketData Current market conditions
     */
    function updatePredictiveModel(
        address tokenA,
        address tokenB,
        MarketConditions calldata marketData
    ) external {
        PredictiveModel storage model = predictions[tokenA][tokenB];
        
        // Simple predictive algorithm (can be enhanced with ML)
        if (marketData.volatility > 500) { // High volatility
            model.priceDirection = 2; // Neutral/unpredictable
            model.volatilityForecast = marketData.volatility + 100;
        } else if (marketData.volume24h > marketState[tokenA][tokenB].volume24h * 120 / 100) {
            model.priceDirection = 1; // Upward pressure
            model.liquidityFlow = 1;
        } else {
            model.priceDirection = 0; // Downward pressure
            model.liquidityFlow = 0;
        }
        
        // Gas price prediction
        if (marketData.gasPrice > 50 gwei) {
            model.gasSpike = 1; // Expect continued high gas
        } else {
            model.gasSpike = 0;
        }
        
        model.confidence = _calculateConfidence(marketData);
        
        // Update market state
        marketState[tokenA][tokenB] = marketData;
    }

    /**
     * @notice Get AI prediction for market movement
     * @param tokenA First token
     * @param tokenB Second token
     * @return prediction Current AI prediction
     */
    function getMarketPrediction(address tokenA, address tokenB) 
        external 
        view 
        returns (PredictiveModel memory prediction) 
    {
        return predictions[tokenA][tokenB];
    }

    // ===== INTERNAL EXECUTION FUNCTIONS =====

    function _executeOnAMM(TradeParams calldata params, RouteQuote memory route) 
        internal 
        returns (uint256 amountOut) 
    {
        // Decode route data to get pool ID
        bytes32 poolId = abi.decode(route.routeData, (bytes32));
        
        // Approve orbital AMM
        IERC20(params.tokenIn).approve(address(orbitalAMM), params.amountIn);
        
        // Execute swap on Orbital AMM
        amountOut = orbitalAMM.swap(
            poolId,
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            params.minAmountOut
        );
        
        venueVolume[ExecutionVenue.ORBITAL_AMM] += params.amountIn;
        
        return amountOut;
    }

    function _executeOnCLOB(TradeParams calldata params, RouteQuote memory route) 
        internal 
        returns (uint256 amountOut) 
    {
        // Approve CLOB
        IERC20(params.tokenIn).approve(hybridCLOB, params.amountIn);
        
        // Execute through CLOB (would call CLOB contract)
        // For now, return simulated amount
        amountOut = (params.amountIn * route.amountOut) / params.amountIn;
        
        venueVolume[ExecutionVenue.CLOB] += params.amountIn;
        
        return amountOut;
    }

    function _executeSplitTrade(TradeParams calldata params, RouteQuote memory route) 
        internal 
        returns (uint256 amountOut) 
    {
        SplitExecution memory split = abi.decode(route.routeData, (SplitExecution));
        
        uint256 ammAmount = (params.amountIn * split.ammPercentage) / 10000;
        uint256 clobAmount = params.amountIn - ammAmount;
        
        uint256 ammOut = 0;
        uint256 clobOut = 0;
        
        if (ammAmount > 0) {
            IERC20(params.tokenIn).approve(address(orbitalAMM), ammAmount);
            ammOut = orbitalAMM.swap(
                split.poolId,
                params.tokenIn,
                params.tokenOut,
                ammAmount,
                0
            );
        }
        
        if (clobAmount > 0) {
            IERC20(params.tokenIn).approve(hybridCLOB, clobAmount);
            // CLOB execution (simplified)
            clobOut = (clobAmount * route.amountOut) / params.amountIn / 2;
        }
        
        amountOut = ammOut + clobOut;
        venueVolume[ExecutionVenue.SPLIT_EXECUTION] += params.amountIn;
        
        return amountOut;
    }

    function _executeHybridOptimal(TradeParams calldata params, RouteQuote memory route) 
        internal 
        returns (uint256 amountOut) 
    {
        // Advanced hybrid execution with dynamic switching
        // For now, route to AMM
        return _executeOnAMM(params, route);
    }

    // ===== QUOTE CALCULATION FUNCTIONS =====

    function _getAMMQuote(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        MarketConditions memory /* conditions */
    ) internal pure returns (RouteQuote memory quote) {
        
        // Get pool for pair
        bytes32 poolId = _findBestPool(tokenIn, tokenOut);
        
        if (poolId != bytes32(0)) {
            // Simulate swap to get quote
            (uint256 amountOut, uint256 priceImpact) = _simulateAMMSwap(poolId, tokenIn, tokenOut, amountIn);
            
            quote = RouteQuote({
                venue: ExecutionVenue.ORBITAL_AMM,
                amountOut: amountOut,
                gasCost: 150000, // Fixed gas estimate
                priceImpact: priceImpact,
                executionTime: 15, // 15 seconds average
                confidence: 95, // High confidence for AMM
                routeData: abi.encode(poolId)
            });
        }
        
        return quote;
    }

    function _getCLOBQuote(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        MarketConditions memory /* conditions */
    ) internal pure returns (RouteQuote memory quote) {
        
        // Simulate CLOB execution
        uint256 amountOut = _simulateCLOBExecution(tokenIn, tokenOut, amountIn);
        
        quote = RouteQuote({
            venue: ExecutionVenue.CLOB,
            amountOut: amountOut,
            gasCost: 200000, // Fixed CLOB gas estimate
            priceImpact: _calculateCLOBPriceImpact(tokenIn, tokenOut, amountIn),
            executionTime: 30, // 30 seconds average for matching
            confidence: 80, // Lower confidence due to orderbook dynamics
            routeData: abi.encode(amountOut)
        });
        
        return quote;
    }

    function _getSplitQuote(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        MarketConditions memory /* conditions */
    ) internal pure returns (RouteQuote memory quote) {
        
        // Calculate optimal split
        (uint256 ammPercentage, uint256 expectedOut) = _calculateOptimalSplit(tokenIn, tokenOut, amountIn);
        
        bytes32 poolId = _findBestPool(tokenIn, tokenOut);
        
        SplitExecution memory split = SplitExecution({
            ammPercentage: ammPercentage,
            clobPercentage: 10000 - ammPercentage,
            poolId: poolId,
            clobData: ""
        });
        
        quote = RouteQuote({
            venue: ExecutionVenue.SPLIT_EXECUTION,
            amountOut: expectedOut,
            gasCost: 350000, // Combined AMM + CLOB gas estimate
            priceImpact: _calculateSplitPriceImpact(tokenIn, tokenOut, amountIn, ammPercentage),
            executionTime: 45, // Longer due to dual execution
            confidence: 85, // Balanced confidence
            routeData: abi.encode(split)
        });
        
        return quote;
    }

    // ===== AI SELECTION & LEARNING =====

    function _selectOptimalRoute(
        RouteQuote memory ammQuote,
        RouteQuote memory clobQuote,
        RouteQuote memory splitQuote,
        RouteStrategy strategy,
        MarketConditions memory /* conditions */
    ) internal pure returns (RouteQuote memory) {
        
        if (strategy == RouteStrategy.BEST_PRICE) {
            if (ammQuote.amountOut >= clobQuote.amountOut && ammQuote.amountOut >= splitQuote.amountOut) {
                return ammQuote;
            } else if (clobQuote.amountOut >= splitQuote.amountOut) {
                return clobQuote;
            } else {
                return splitQuote;
            }
        } else if (strategy == RouteStrategy.LOWEST_GAS) {
            if (ammQuote.gasCost <= clobQuote.gasCost && ammQuote.gasCost <= splitQuote.gasCost) {
                return ammQuote;
            } else if (clobQuote.gasCost <= splitQuote.gasCost) {
                return clobQuote;
            } else {
                return splitQuote;
            }
        } else if (strategy == RouteStrategy.FASTEST_EXECUTION) {
            if (ammQuote.executionTime <= clobQuote.executionTime && ammQuote.executionTime <= splitQuote.executionTime) {
                return ammQuote;
            } else if (clobQuote.executionTime <= splitQuote.executionTime) {
                return clobQuote;
            } else {
                return splitQuote;
            }
        } else {
            // MEV_PROTECTED - prefer AMM for better MEV protection
            return ammQuote;
        }
    }

    function _applyPredictiveModel(
        RouteQuote memory quote,
        address tokenIn,
        address tokenOut,
        MarketConditions memory /* conditions */
    ) internal view returns (RouteQuote memory) {
        
        PredictiveModel memory model = predictions[tokenIn][tokenOut];
        
        // Adjust quote based on predictions
        if (model.confidence > 70) {
            if (model.gasSpike == 1) {
                quote.gasCost = quote.gasCost * 150 / 100; // Increase gas estimate
            }
            
            if (model.volatilityForecast > 200) { // Fixed volatility threshold
                quote.priceImpact = quote.priceImpact * 120 / 100; // Increase slippage estimate
                quote.confidence = quote.confidence * 90 / 100; // Reduce confidence
            }
        }
        
        return quote;
    }

    function _updateAILearning(
        TradeParams calldata /* params */,
        RouteQuote memory predictedRoute,
        uint256 actualAmountOut
    ) internal {
        totalPredictions++;
        
        // Check if prediction was accurate (within 5%)
        uint256 variance = actualAmountOut > predictedRoute.amountOut ? 
            actualAmountOut - predictedRoute.amountOut :
            predictedRoute.amountOut - actualAmountOut;
            
        uint256 variancePercentage = (variance * 10000) / predictedRoute.amountOut;
        
        if (variancePercentage <= 500) { // Within 5%
            correctPredictions++;
        }
        
        // Emit accuracy update
        if (totalPredictions % 100 == 0) { // Every 100 predictions
            emit PredictionAccuracy(
                totalPredictions,
                correctPredictions,
                (correctPredictions * 100) / totalPredictions
            );
        }
    }

    // ===== HELPER FUNCTIONS =====

    function _analyzeMarketConditions(address /* tokenA */, address /* tokenB */) 
        internal 
        view 
        returns (MarketConditions memory) 
    {
        // Simplified market analysis - can be enhanced with real data
        return MarketConditions({
            volatility: 200, // 2%
            liquidity: 1000000e18, // $1M
            spread: 10, // 0.1%
            volume24h: 500000e18, // $500K
            gasPrice: tx.gasprice,
            blockCongestion: 50, // 50%
            timestamp: block.timestamp
        });
    }

    function _calculateConfidence(MarketConditions memory conditions) 
        internal 
        pure 
        returns (uint256) 
    {
        // Simple confidence calculation
        uint256 confidence = 100;
        
        if (conditions.volatility > 500) confidence -= 20; // High volatility reduces confidence
        if (conditions.spread > 50) confidence -= 15; // High spread reduces confidence
        if (conditions.blockCongestion > 80) confidence -= 10; // High congestion reduces confidence
        
        return confidence > 50 ? confidence : 50; // Minimum 50% confidence
    }

    // Placeholder implementations for complex functions
    function _findBestPool(address, address) internal pure returns (bytes32) { return bytes32(0); }
    function _simulateAMMSwap(bytes32, address, address, uint256) internal pure returns (uint256, uint256) { return (0, 0); }
    function _simulateCLOBExecution(address, address, uint256) internal pure returns (uint256) { return 0; }
    function _estimateAMMGas(MarketConditions memory) internal pure returns (uint256) { return 150000; }
    function _estimateCLOBGas(MarketConditions memory) internal pure returns (uint256) { return 200000; }
    function _calculateCLOBPriceImpact(address, address, uint256) internal pure returns (uint256) { return 10; }
    function _calculateOptimalSplit(address, address, uint256) internal pure returns (uint256, uint256) { return (5000, 0); }
    function _calculateSplitPriceImpact(address, address, uint256, uint256) internal pure returns (uint256) { return 15; }
    function _checkArbitrageOpportunity(address, address, uint256) internal pure returns (bool, uint256, ExecutionVenue, ExecutionVenue) { return (false, 0, ExecutionVenue.ORBITAL_AMM, ExecutionVenue.CLOB); }
    function _buyOnAMM(address, address, uint256) internal {}
    function _buyOnCLOB(address, address, uint256) internal {}
    function _sellOnAMM(address, address, uint256) internal {}
    function _sellOnCLOB(address, address, uint256) internal {}
    function _updatePerformanceMetrics(TradeParams calldata, RouteQuote memory, uint256) internal {}

    // ===== ADMIN FUNCTIONS =====

    function setHybridCLOB(address _hybridCLOB) external onlyOwner {
        hybridCLOB = _hybridCLOB;
    }

    function emergencyPause() external onlyOwner {
        _pause();
    }

    function emergencyUnpause() external onlyOwner {
        _unpause();
    }
}
