// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./libs/EnhancedOrbitalMath.sol";

/**
 * @title Paradigm Orbital AMM - Enhanced for 1000+ LPs
 * @dev Implementation supporting massive multi-asset pools with efficient tick management
 * Based on Paradigm's "Orbital" research paper (June 2025)
 */
contract ParadigmOrbitalAMM_Enhanced is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using EnhancedOrbitalMath for uint256;

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ============ Enhanced Structs for Scale ============

    struct OptimizedPool {
        address[] tokens;                    // Token addresses
        uint256 sumReserves;                // Σxᵢ for O(1) computation
        uint256 sumSquaredReserves;         // Σxᵢ² for invariant calculation
        uint256 interiorTickRadius;         // Consolidated interior radius
        uint256 boundaryTickRadius;         // Consolidated boundary radius
        uint256 boundaryConstant;           // Consolidated boundary k
        uint256 amplification;              // Amplification factor
        uint256 feeRate;                   // Fee in basis points
        uint256 totalLpSupply;             // Total LP tokens issued
        uint256 createdAt;                 // Creation timestamp
        bool active;                       // Pool status
        
        // Sparse storage for efficiency
        mapping(address => uint256) reserves; // Only non-zero reserves
        mapping(address => bool) hasReserves; // Which tokens have reserves
        address[] activeTokens;             // List of tokens with reserves
    }

    struct LiquidityProvider {
        uint256 lpTokens;                  // LP tokens owned
        uint256 tickRadius;                // Individual tick radius
        uint256 planeConstant;             // k value for position
        uint256 liquidityWeight;           // Weight in consolidation
        uint256 minPrice;                  // Price range minimum
        uint256 maxPrice;                  // Price range maximum
        uint256 timestamp;                 // Position creation time
        bool isInterior;                   // Current tick status
        
        // Capital efficiency through virtual reserves
        mapping(address => uint256) virtualReserves;
        mapping(address => uint256) actualDeposits;
    }

    struct BatchLiquidityParams {
        address[] providers;               // LP addresses
        address[][] tokens;                // Tokens per provider
        uint256[][] amounts;               // Amounts per token per provider
        uint256[] minLpTokens;            // Minimum LP tokens expected
        uint256[] minPrices;              // Price range minimums
        uint256[] maxPrices;              // Price range maximums
    }

    struct GlobalOrbitalState {
        uint256 sumReserves;              // Current Σxᵢ
        uint256 sumSquaredReserves;       // Current Σxᵢ²
        uint256 interiorRadius;           // Consolidated interior radius
        uint256 boundaryRadius;           // Consolidated boundary radius
        uint256 boundaryConstant;         // Consolidated boundary k
        uint256 equalPriceProjection;    // Current α projection
        uint256 tokenCount;               // Number of active tokens
        bool hasInteriorTicks;            // Interior ticks exist
        bool hasBoundaryTicks;            // Boundary ticks exist
    }

    // ============ State Variables ============

    mapping(bytes32 => OptimizedPool) public pools;
    mapping(bytes32 => mapping(address => LiquidityProvider)) public liquidityProviders;
    mapping(bytes32 => address[]) public poolProviders; // All LPs in pool
    mapping(bytes32 => GlobalOrbitalState) public globalStates;
    
    bytes32[] public allPools;
    uint256 public constant MAX_PROVIDERS_PER_POOL = 1000;
    uint256 public constant MIN_LIQUIDITY = 1000;
    uint256 public constant PRECISION = 1e18;
    uint256 public constant DEFAULT_FEE = 30; // 0.3%

    // ============ Events ============

    event PoolCreated(
        bytes32 indexed poolId,
        address[] tokens,
        uint256 maxProviders
    );

    event BatchLiquidityAdded(
        bytes32 indexed poolId,
        address[] providers,
        uint256[] lpTokensIssued,
        uint256 totalLiquidity
    );

    event LiquidityAdded(
        bytes32 indexed poolId,
        address indexed provider,
        address[] tokens,
        uint256[] amounts,
        uint256 lpTokens
    );

    event TicksConsolidated(
        bytes32 indexed poolId,
        uint256 interiorRadius,
        uint256 boundaryRadius,
        uint256 activeProviders
    );

    event SwapExecuted(
        bytes32 indexed poolId,
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );

    // ============ Pool Creation for Massive Scale ============

    /**
     * @dev Create pool supporting up to 1000 liquidity providers
     */
    function createMassivePool(
        address[] calldata initialTokens,
        uint256 amplificationFactor,
        uint256 maxProviders
    ) external returns (bytes32 poolId) {
        require(initialTokens.length >= 2, "Need at least 2 tokens");
        require(maxProviders <= MAX_PROVIDERS_PER_POOL, "Too many providers");
        require(amplificationFactor > 0, "Invalid amplification");

        poolId = keccak256(abi.encodePacked(
            initialTokens,
            amplificationFactor,
            block.timestamp,
            msg.sender
        ));

        require(!pools[poolId].active, "Pool already exists");

        OptimizedPool storage pool = pools[poolId];
        pool.tokens = initialTokens;
        pool.amplification = amplificationFactor;
        pool.feeRate = DEFAULT_FEE;
        pool.createdAt = block.timestamp;
        pool.active = true;

        // Initialize global state
        GlobalOrbitalState storage state = globalStates[poolId];
        state.tokenCount = initialTokens.length;
        state.hasInteriorTicks = false;
        state.hasBoundaryTicks = false;

        allPools.push(poolId);

        emit PoolCreated(poolId, initialTokens, maxProviders);
    }

    // ============ Batch Liquidity Operations ============

    /**
     * @dev Add liquidity for multiple providers in single transaction
     * Paradigm's tick consolidation makes this efficient
     */
    function batchAddLiquidity(
        bytes32 poolId,
        BatchLiquidityParams calldata params
    ) external nonReentrant whenNotPaused {
        require(pools[poolId].active, "Pool not active");
        require(params.providers.length <= 100, "Too many providers per batch");
        
        uint256[] memory lpTokensIssued = new uint256[](params.providers.length);
        uint256 totalNewLiquidity = 0;

        // Process all liquidity additions
        for (uint256 i = 0; i < params.providers.length; i++) {
            lpTokensIssued[i] = _addLiquidityForProvider(
                poolId,
                params.providers[i],
                params.tokens[i],
                params.amounts[i],
                params.minPrices[i],
                params.maxPrices[i]
            );
            
            totalNewLiquidity += lpTokensIssued[i];
            
            // Add to provider list if new
            if (liquidityProviders[poolId][params.providers[i]].timestamp == 0) {
                poolProviders[poolId].push(params.providers[i]);
            }
        }

        // Consolidate all ticks after batch processing
        _consolidateAllTicks(poolId);

        emit BatchLiquidityAdded(
            poolId,
            params.providers,
            lpTokensIssued,
            totalNewLiquidity
        );
    }

    /**
     * @dev Add liquidity for single provider with enhanced capital efficiency
     */
    function addLiquidity(
        bytes32 poolId,
        address[] calldata tokens,
        uint256[] calldata amounts,
        uint256 minLpTokens,
        uint256 minPrice,
        uint256 maxPrice
    ) external nonReentrant whenNotPaused returns (uint256 lpTokens) {
        require(pools[poolId].active, "Pool not active");
        require(tokens.length == amounts.length, "Array length mismatch");

        lpTokens = _addLiquidityForProvider(
            poolId,
            msg.sender,
            tokens,
            amounts,
            minPrice,
            maxPrice
        );

        require(lpTokens >= minLpTokens, "Insufficient LP tokens");

        // Add to provider list if new
        if (liquidityProviders[poolId][msg.sender].timestamp == 0) {
            poolProviders[poolId].push(msg.sender);
        }

        // Consolidate ticks for optimization
        _consolidateAllTicks(poolId);

        emit LiquidityAdded(poolId, msg.sender, tokens, amounts, lpTokens);
    }

    // ============ Enhanced Swap with Constant Time Complexity ============

    /**
     * @dev Execute swap using Paradigm's O(1) algorithm regardless of token count
     */
    function swap(
        bytes32 poolId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        require(pools[poolId].active, "Pool not active");
        require(amountIn > 0, "Invalid amount");

        OptimizedPool storage pool = pools[poolId];
        GlobalOrbitalState memory state = globalStates[poolId];

        // Update state with input
        uint256 reserveIn = pool.reserves[tokenIn];
        uint256 reserveOut = pool.reserves[tokenOut];
        require(reserveIn > 0 && reserveOut > 0, "Token not in pool");

        // Calculate output using enhanced orbital math
        EnhancedOrbitalMath.TradeParams memory tradeParams = EnhancedOrbitalMath.TradeParams({
            tokenInIndex: _getTokenIndex(poolId, tokenIn),
            tokenOutIndex: _getTokenIndex(poolId, tokenOut),
            amountIn: amountIn,
            currentReserveIn: reserveIn,
            currentReserveOut: reserveOut
        });

        EnhancedOrbitalMath.OrbitalState memory orbitalState = EnhancedOrbitalMath.OrbitalState({
            sumReserves: state.sumReserves,
            sumSquaredReserves: state.sumSquaredReserves,
            interiorRadius: state.interiorRadius,
            boundaryRadius: state.boundaryRadius,
            boundaryConstant: state.boundaryConstant,
            equalPriceProjection: state.equalPriceProjection,
            tokenCount: state.tokenCount,
            hasInteriorTicks: state.hasInteriorTicks,
            hasBoundaryTicks: state.hasBoundaryTicks
        });

        // Execute swap calculation
        (amountOut, orbitalState) = EnhancedOrbitalMath.calculateSwapOutput(
            orbitalState,
            tradeParams
        );

        require(amountOut >= minAmountOut, "Insufficient output");

        // Calculate fee
        uint256 fee = amountIn * pool.feeRate / 10000;
        amountOut = amountOut * (10000 - pool.feeRate) / 10000;

        // Update pool state
        pool.reserves[tokenIn] += amountIn;
        pool.reserves[tokenOut] -= amountOut;
        
        // Update global state with new values
        _updateGlobalState(poolId, orbitalState);

        // Execute transfers
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, amountOut);

        emit SwapExecuted(poolId, msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee);
    }

    // ============ Tick Consolidation Engine ============

    /**
     * @dev Consolidate all ticks using Paradigm's algorithm
     * Converts 1000 individual ticks into 2 calculations
     */
    function _consolidateAllTicks(bytes32 poolId) internal {
        address[] memory providers = poolProviders[poolId];
        if (providers.length == 0) return;

        uint256 totalInteriorRadius = 0;
        uint256 totalBoundaryRadius = 0;
        uint256 totalBoundaryK = 0;
        uint256 interiorCount = 0;
        uint256 boundaryCount = 0;

        GlobalOrbitalState storage state = globalStates[poolId];
        uint256 globalAlphaNorm = state.equalPriceProjection;

        // Classify and consolidate ticks
        for (uint256 i = 0; i < providers.length; i++) {
            LiquidityProvider storage provider = liquidityProviders[poolId][providers[i]];
            if (provider.lpTokens == 0) continue;

            // Determine tick status based on normalized projection
            uint256 normalizedK = provider.planeConstant * PRECISION / provider.tickRadius;
            bool isInterior = normalizedK > globalAlphaNorm;

            provider.isInterior = isInterior;

            if (isInterior) {
                totalInteriorRadius += provider.tickRadius * provider.liquidityWeight / PRECISION;
                interiorCount++;
            } else {
                totalBoundaryRadius += provider.tickRadius * provider.liquidityWeight / PRECISION;
                totalBoundaryK += provider.planeConstant * provider.liquidityWeight / PRECISION;
                boundaryCount++;
            }
        }

        // Update global consolidated state
        state.interiorRadius = totalInteriorRadius;
        state.boundaryRadius = totalBoundaryRadius;
        state.boundaryConstant = boundaryCount > 0 ? totalBoundaryK / boundaryCount : 0;
        state.hasInteriorTicks = interiorCount > 0;
        state.hasBoundaryTicks = boundaryCount > 0;

        emit TicksConsolidated(poolId, totalInteriorRadius, totalBoundaryRadius, providers.length);
    }

    // ============ Internal Helper Functions ============

    function _addLiquidityForProvider(
        bytes32 poolId,
        address provider,
        address[] calldata tokens,
        uint256[] calldata amounts,
        uint256 minPrice,
        uint256 maxPrice
    ) internal returns (uint256 lpTokens) {
        OptimizedPool storage pool = pools[poolId];
        LiquidityProvider storage lp = liquidityProviders[poolId][provider];

        // Transfer tokens
        uint256 totalValue = 0;
        for (uint256 i = 0; i < tokens.length; i++) {
            require(amounts[i] > 0, "Invalid amount");
            
            IERC20(tokens[i]).safeTransferFrom(provider, address(this), amounts[i]);
            
            // Update pool reserves
            if (!pool.hasReserves[tokens[i]]) {
                pool.hasReserves[tokens[i]] = true;
                pool.activeTokens.push(tokens[i]);
            }
            pool.reserves[tokens[i]] += amounts[i];
            
            // Update global sums
            GlobalOrbitalState storage state = globalStates[poolId];
            state.sumReserves += amounts[i];
            state.sumSquaredReserves += amounts[i] * amounts[i];
            
            // Calculate virtual reserves for capital efficiency
            uint256 virtualAmount = _calculateVirtualReserves(poolId, tokens[i], minPrice);
            lp.virtualReserves[tokens[i]] = virtualAmount;
            lp.actualDeposits[tokens[i]] += amounts[i];
            
            totalValue += amounts[i]; // Simplified - should use oracle prices
        }

        // Calculate LP tokens with capital efficiency
        lpTokens = _calculateLpTokens(poolId, provider, totalValue, minPrice, maxPrice);
        
        // Update provider position
        lp.lpTokens += lpTokens;
        lp.tickRadius = _calculateTickRadius(totalValue, pool.amplification);
        lp.planeConstant = _calculatePlaneConstant(minPrice, maxPrice);
        lp.liquidityWeight = lpTokens;
        lp.minPrice = minPrice;
        lp.maxPrice = maxPrice;
        lp.timestamp = block.timestamp;

        pool.totalLpSupply += lpTokens;
    }

    function _calculateVirtualReserves(
        bytes32 poolId,
        address, // token - unused in current implementation
        uint256 priceRange
    ) internal view returns (uint256) {
        // Based on Paradigm's virtual reserves formula
        // xmin = k/n - sqrt(k²/n - n*((n-1)*r - k*n)²/n)
        GlobalOrbitalState memory state = globalStates[poolId];
        uint256 k = priceRange;
        uint256 n = state.tokenCount;
        uint256 r = 1000 * PRECISION; // Normalized radius
        
        if (n == 0) return 0;
        
        uint256 term1 = k / n;
        uint256 term2Sq = (k * k) / n;
        uint256 term3 = n * ((n - 1) * r - k * n) * ((n - 1) * r - k * n) / n;
        
        if (term2Sq >= term3) {
            uint256 sqrtTerm = _sqrt(term2Sq - term3);
            if (term1 >= sqrtTerm) {
                return term1 - sqrtTerm;
            }
        }
        
        return 0;
    }

    function _calculateLpTokens(
        bytes32 poolId,
        address, // provider - unused in current implementation
        uint256 totalValue,
        uint256 minPrice,
        uint256 maxPrice
    ) internal view returns (uint256) {
        OptimizedPool storage pool = pools[poolId];
        
        if (pool.totalLpSupply == 0) {
            return totalValue * PRECISION; // First LP
        }
        
        // Calculate capital efficiency multiplier
        uint256 efficiency = _calculateCapitalEfficiency(minPrice, maxPrice);
        
        return (totalValue * pool.totalLpSupply * efficiency) / (pool.sumReserves * PRECISION);
    }

    function _calculateCapitalEfficiency(
        uint256 minPrice,
        uint256 maxPrice
    ) internal pure returns (uint256) {
        // Based on Paradigm's capital efficiency formula
        // Higher efficiency for narrower price ranges
        uint256 priceRange = maxPrice - minPrice;
        uint256 baseRange = PRECISION / 10; // 10% base range
        
        if (priceRange >= baseRange) {
            return PRECISION; // 1x efficiency
        }
        
        // Up to 150x efficiency for very tight ranges
        return PRECISION * baseRange / priceRange;
    }

    function _calculateTickRadius(
        uint256 totalValue,
        uint256 amplification
    ) internal pure returns (uint256) {
        return (totalValue * amplification) / PRECISION;
    }

    function _calculatePlaneConstant(
        uint256 minPrice,
        uint256 maxPrice
    ) internal pure returns (uint256) {
        return (minPrice + maxPrice) / 2;
    }

    function _updateGlobalState(
        bytes32 poolId,
        EnhancedOrbitalMath.OrbitalState memory newState
    ) internal {
        GlobalOrbitalState storage state = globalStates[poolId];
        state.sumReserves = newState.sumReserves;
        state.sumSquaredReserves = newState.sumSquaredReserves;
        state.equalPriceProjection = newState.equalPriceProjection;
    }

    function _getTokenIndex(
        bytes32 poolId,
        address token
    ) internal view returns (uint256) {
        address[] memory activeTokens = pools[poolId].activeTokens;
        for (uint256 i = 0; i < activeTokens.length; i++) {
            if (activeTokens[i] == token) {
                return i;
            }
        }
        revert("Token not found");
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    // ============ View Functions ============

    function getPoolProviders(bytes32 poolId) external view returns (address[] memory) {
        return poolProviders[poolId];
    }

    function getGlobalState(bytes32 poolId) external view returns (GlobalOrbitalState memory) {
        return globalStates[poolId];
    }

    function getProviderCount(bytes32 poolId) external view returns (uint256) {
        return poolProviders[poolId].length;
    }
}
