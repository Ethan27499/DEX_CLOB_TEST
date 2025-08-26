// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ParadigmOrbitalAMM.sol";
import "./HybridRouter.sol";
import "./DepegManager.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title EnhancedHybridRouter
 * @dev Advanced routing system that integrates CLOB + Orbital AMM + Risk Management
 * Implements Paradigm's multi-asset routing with depeg protection
 */
contract EnhancedHybridRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Structs ============

    struct RouteStep {
        address protocol;          // CLOB or AMM address
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        bytes data;               // Protocol-specific data
    }

    struct OptimalRoute {
        RouteStep[] steps;
        uint256 totalAmountOut;
        uint256 totalPriceImpact;
        uint256 totalGasCost;
        string routeType;         // "CLOB_ONLY", "AMM_ONLY", "HYBRID"
    }

    struct ProtocolConfig {
        address contractAddress;
        bool active;
        uint256 weight;           // Weight for route optimization
        uint256 maxSlippage;      // Maximum allowed slippage
    }

    // ============ State Variables ============

    ParadigmOrbitalAMM public orbitalAMM;
    HybridRouter public classicRouter;
    DepegManager public depegManager;

    mapping(string => ProtocolConfig) public protocols;
    mapping(address => bool) public authorizedCallers;
    
    string[] public supportedProtocols;
    uint256 public constant MAX_ROUTE_STEPS = 5;
    uint256 public constant SLIPPAGE_PRECISION = 10000;

    // ============ Events ============

    event RouteExecuted(
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        string routeType,
        uint256 gasUsed
    );

    event ProtocolAdded(string name, address contractAddress);
    event ProtocolUpdated(string name, ProtocolConfig config);
    event OptimalRouteFound(address tokenIn, address tokenOut, uint256 amountIn, string routeType);

    // ============ Constructor ============

    constructor(
        address _orbitalAMM,
        address _classicRouter,
        address _depegManager
    ) Ownable(msg.sender) {
        orbitalAMM = ParadigmOrbitalAMM(_orbitalAMM);
        classicRouter = HybridRouter(_classicRouter);
        depegManager = DepegManager(_depegManager);

        // Initialize protocol configurations
        _addProtocol("ORBITAL_AMM", _orbitalAMM, 100, 300); // 3% max slippage
        _addProtocol("CLASSIC_CLOB", _classicRouter, 80, 500); // 5% max slippage
    }

    // ============ Route Optimization ============

    /**
     * @dev Find optimal route for a trade across all protocols
     * @param tokenIn Input token address
     * @param tokenOut Output token address  
     * @param amountIn Input amount
     * @param maxSlippage Maximum acceptable slippage
     */
    function findOptimalRoute(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 maxSlippage
    ) external returns (OptimalRoute memory) {
        OptimalRoute memory route = _findOptimalRouteInternal(tokenIn, tokenOut, amountIn, maxSlippage);
        emit OptimalRouteFound(tokenIn, tokenOut, amountIn, route.routeType);
        return route;
    }

    /**
     * @dev Execute optimal route trade
     */
    function executeOptimalTrade(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 maxSlippage
    ) external nonReentrant returns (uint256 totalAmountOut) {
        uint256 gasStart = gasleft();

        // Find optimal route internally
        OptimalRoute memory route = _findOptimalRouteInternal(tokenIn, tokenOut, amountIn, maxSlippage);
        require(route.totalAmountOut >= minAmountOut, "Insufficient output amount");

        // Transfer input tokens
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Execute route steps
        uint256 currentAmount = amountIn;
        for (uint256 i = 0; i < route.steps.length; i++) {
            currentAmount = _executeRouteStep(route.steps[i], currentAmount);
        }

        // Transfer final output to user
        IERC20(tokenOut).safeTransfer(msg.sender, currentAmount);

        uint256 gasUsed = gasStart - gasleft();
        
        emit RouteExecuted(
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            currentAmount,
            route.routeType,
            gasUsed
        );

        return currentAmount;
    }

    /**
     * @dev Internal function to find optimal route
     */
    function _findOptimalRouteInternal(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 maxSlippage
    ) internal view returns (OptimalRoute memory) {
        // Check for isolated assets first
        require(!depegManager.isAssetIsolated(tokenIn), "Input token isolated");
        require(!depegManager.isAssetIsolated(tokenOut), "Output token isolated");

        OptimalRoute memory bestRoute;
        uint256 bestAmountOut = 0;

        // 1. Check Orbital AMM route (best for stablecoins)
        OptimalRoute memory orbitalRoute = _getOrbitalRoute(tokenIn, tokenOut, amountIn);
        if (orbitalRoute.totalAmountOut > bestAmountOut && 
            orbitalRoute.totalPriceImpact <= maxSlippage) {
            bestRoute = orbitalRoute;
            bestAmountOut = orbitalRoute.totalAmountOut;
        }

        // 2. Check Classic CLOB route
        OptimalRoute memory clobRoute = _getCLOBRoute(tokenIn, tokenOut, amountIn);
        if (clobRoute.totalAmountOut > bestAmountOut && 
            clobRoute.totalPriceImpact <= maxSlippage) {
            bestRoute = clobRoute;
            bestAmountOut = clobRoute.totalAmountOut;
        }

        // 3. Check Hybrid route (split between protocols)
        OptimalRoute memory hybridRoute = _getHybridRoute(tokenIn, tokenOut, amountIn);
        if (hybridRoute.totalAmountOut > bestAmountOut && 
            hybridRoute.totalPriceImpact <= maxSlippage) {
            bestRoute = hybridRoute;
            bestAmountOut = hybridRoute.totalAmountOut;
        }

        require(bestAmountOut > 0, "No viable route found");
        
        return bestRoute;
    }

    // ============ Internal Route Calculations ============

    function _getOrbitalRoute(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal view returns (OptimalRoute memory) {
        // Find best Orbital AMM pool for this pair
        bytes32[] memory pools = orbitalAMM.getAllPools();
        
        uint256 bestAmountOut = 0;
        bytes32 bestPoolId;
        
        for (uint256 i = 0; i < pools.length; i++) {
            ParadigmOrbitalAMM.Pool memory pool = orbitalAMM.getPool(pools[i]);
            
            // Check if pool contains both tokens
            bool hasTokenIn = false;
            bool hasTokenOut = false;
            
            for (uint256 j = 0; j < pool.tokens.length; j++) {
                if (pool.tokens[j] == tokenIn) hasTokenIn = true;
                if (pool.tokens[j] == tokenOut) hasTokenOut = true;
            }
            
            if (hasTokenIn && hasTokenOut && pool.active) {
                ParadigmOrbitalAMM.SwapQuote memory quote = orbitalAMM.getSwapQuote(
                    pools[i], tokenIn, tokenOut, amountIn
                );
                
                if (quote.amountOut > bestAmountOut) {
                    bestAmountOut = quote.amountOut;
                    bestPoolId = pools[i];
                }
            }
        }

        OptimalRoute memory route;
        if (bestAmountOut > 0) {
            route.steps = new RouteStep[](1);
            route.steps[0] = RouteStep({
                protocol: address(orbitalAMM),
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amountIn: amountIn,
                minAmountOut: (bestAmountOut * 99) / 100, // 1% slippage tolerance
                data: abi.encode(bestPoolId)
            });
            
            route.totalAmountOut = bestAmountOut;
            route.totalPriceImpact = _calculatePriceImpact(tokenIn, tokenOut, amountIn, bestAmountOut);
            route.totalGasCost = 250000; // Estimated gas
            route.routeType = "ORBITAL_AMM";
        }

        return route;
    }

    function _getCLOBRoute(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal view returns (OptimalRoute memory) {
        // Use existing HybridRouter for CLOB routing
        OptimalRoute memory route;
        
        try classicRouter.getOptimalQuote(tokenIn, tokenOut, amountIn, true) returns (HybridRouter.RouteQuote memory quote) {
            if (quote.amountOut > 0) {
                route.steps = new RouteStep[](1);
                route.steps[0] = RouteStep({
                    protocol: address(classicRouter),
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    amountIn: amountIn,
                    minAmountOut: (quote.amountOut * 95) / 100, // 5% slippage tolerance
                    data: abi.encode(quote.routeType)
                });
                
                route.totalAmountOut = quote.amountOut;
                route.totalPriceImpact = quote.priceImpact;
                route.totalGasCost = quote.gasCost;
                route.routeType = "CLOB_ONLY";
            }
        } catch {
            // CLOB route not available
        }

        return route;
    }

    function _getHybridRoute(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal view returns (OptimalRoute memory) {
        // Split trade between protocols for better execution
        OptimalRoute memory orbitalRoute = _getOrbitalRoute(tokenIn, tokenOut, amountIn / 2);
        OptimalRoute memory clobRoute = _getCLOBRoute(tokenIn, tokenOut, amountIn / 2);

        OptimalRoute memory hybridRoute;
        
        if (orbitalRoute.totalAmountOut > 0 && clobRoute.totalAmountOut > 0) {
            hybridRoute.steps = new RouteStep[](2);
            hybridRoute.steps[0] = orbitalRoute.steps[0];
            hybridRoute.steps[1] = clobRoute.steps[0];
            
            // Adjust amounts for split execution
            hybridRoute.steps[0].amountIn = amountIn / 2;
            hybridRoute.steps[1].amountIn = amountIn / 2;
            
            hybridRoute.totalAmountOut = orbitalRoute.totalAmountOut + clobRoute.totalAmountOut;
            hybridRoute.totalPriceImpact = (orbitalRoute.totalPriceImpact + clobRoute.totalPriceImpact) / 2;
            hybridRoute.totalGasCost = orbitalRoute.totalGasCost + clobRoute.totalGasCost;
            hybridRoute.routeType = "HYBRID";
        }

        return hybridRoute;
    }

    function _executeRouteStep(RouteStep memory step, uint256 amount) internal returns (uint256) {
        if (step.protocol == address(orbitalAMM)) {
            // Execute Orbital AMM swap
            bytes32 poolId = abi.decode(step.data, (bytes32));
            
            IERC20(step.tokenIn).approve(address(orbitalAMM), amount);
            
            return orbitalAMM.swap(
                poolId,
                step.tokenIn,
                step.tokenOut,
                amount,
                step.minAmountOut
            );
            
        } else if (step.protocol == address(classicRouter)) {
            // Execute CLOB swap
            IERC20(step.tokenIn).approve(address(classicRouter), amount);
            
            // Create TradeParams for the HybridRouter
            HybridRouter.TradeParams memory tradeParams = HybridRouter.TradeParams({
                tokenIn: step.tokenIn,
                tokenOut: step.tokenOut,
                amountIn: amount,
                minAmountOut: step.minAmountOut,
                maxSlippage: 500, // 5% max slippage
                to: address(this),
                deadline: block.timestamp + 300, // 5 minutes
                preferCLOB: true
            });
            
            HybridRouter.ExecutionResult memory result = classicRouter.executeOptimalTrade(tradeParams);
            return result.amountOut;
        }
        
        revert("Unknown protocol");
    }

    function _calculatePriceImpact(
        address /* tokenIn */,
        address /* tokenOut */,
        uint256 amountIn,
        uint256 amountOut
    ) internal pure returns (uint256) {
        // Simplified price impact calculation
        // In production, use oracle prices for more accuracy
        if (amountIn == 0) return 0;
        
        uint256 expectedRate = 1e18; // Assume 1:1 for stablecoins
        uint256 actualRate = (amountOut * 1e18) / amountIn;
        
        if (expectedRate > actualRate) {
            return ((expectedRate - actualRate) * SLIPPAGE_PRECISION) / expectedRate;
        }
        
        return 0;
    }

    // ============ Admin Functions ============

    function _addProtocol(
        string memory name,
        address contractAddress,
        uint256 weight,
        uint256 maxSlippage
    ) internal {
        protocols[name] = ProtocolConfig({
            contractAddress: contractAddress,
            active: true,
            weight: weight,
            maxSlippage: maxSlippage
        });
        
        supportedProtocols.push(name);
        emit ProtocolAdded(name, contractAddress);
    }

    function updateProtocol(
        string memory name,
        ProtocolConfig memory config
    ) external onlyOwner {
        protocols[name] = config;
        emit ProtocolUpdated(name, config);
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
    }

    // ============ View Functions ============

    function getSupportedProtocols() external view returns (string[] memory) {
        return supportedProtocols;
    }

    function getProtocolConfig(string memory name) external view returns (ProtocolConfig memory) {
        return protocols[name];
    }

    // ============ Emergency Functions ============

    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }

    function pauseProtocol(string memory name) external onlyOwner {
        protocols[name].active = false;
    }

    function unpauseProtocol(string memory name) external onlyOwner {
        protocols[name].active = true;
    }
}
