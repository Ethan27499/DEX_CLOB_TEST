// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./libs/OrbitalMath.sol";

/**
 * @title ParadigmOrbitalAMM
 * @dev Enhanced Orbital AMM implementation inspired by Paradigm's design
 * Supports multi-asset pools with risk isolation and concentrated liquidity
 */
contract ParadigmOrbitalAMM is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using OrbitalMath for uint256;

    // ============ Structs ============

    struct Pool {
        address[] tokens;           // Array of token addresses
        uint256[] reserves;         // Current reserves for each token
        uint256[] weights;          // Weight of each token (must sum to 1e18)
        uint256[] priceRanges;      // Price ranges for concentrated liquidity
        uint256 amplification;      // Amplification parameter (higher = more stable)
        uint256 totalSupply;        // Total LP token supply
        uint256 feeRate;           // Fee rate (basis points)
        bool[] isolated;           // Whether each token is isolated due to depeg
        uint256 createdAt;         // Pool creation timestamp
        bool active;               // Whether pool is active
    }

    struct LiquidityPosition {
        uint256 lpTokens;          // LP tokens owned
        uint256[] tokenAmounts;    // Original token amounts deposited
        uint256 timestamp;         // When position was created
        uint256 minPrice;          // Minimum price range
        uint256 maxPrice;          // Maximum price range
    }

    struct SwapQuote {
        uint256 amountOut;         // Expected output amount
        uint256 priceImpact;       // Price impact in basis points
        uint256 fee;               // Fee amount
        address[] route;           // Swap route
        uint256 gasEstimate;       // Estimated gas cost
    }

    // ============ State Variables ============

    mapping(bytes32 => Pool) public pools;
    mapping(bytes32 => mapping(address => LiquidityPosition)) public positions;
    mapping(address => bool) public authorizedOracles;
    mapping(address => uint256) public lastKnownPrices; // Cache for oracle prices
    
    bytes32[] public allPools;
    uint256 public constant MIN_POOL_TOKENS = 2;
    uint256 public constant MAX_POOL_TOKENS = 10000; // Paradigm's spec: up to 10k assets
    uint256 public constant DEFAULT_FEE = 30; // 0.3%
    uint256 public constant DEPEG_THRESHOLD = 200; // 2%
    uint256 public constant PRICE_PRECISION = 1e18;

    // ============ Events ============

    event PoolCreated(
        bytes32 indexed poolId,
        address[] tokens,
        uint256[] weights,
        uint256 amplification
    );

    event LiquidityAdded(
        bytes32 indexed poolId,
        address indexed provider,
        uint256[] amounts,
        uint256 lpTokens,
        uint256 minPrice,
        uint256 maxPrice
    );

    event LiquidityRemoved(
        bytes32 indexed poolId,
        address indexed provider,
        uint256[] amounts,
        uint256 lpTokens
    );

    event Swap(
        bytes32 indexed poolId,
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );

    event AssetIsolated(
        bytes32 indexed poolId,
        address indexed token,
        uint256 timestamp,
        string reason
    );

    event AssetRestored(
        bytes32 indexed poolId,
        address indexed token,
        uint256 timestamp
    );

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {
        // Initialize contract
    }

    // ============ Pool Management ============

    /**
     * @dev Create a new multi-asset stablecoin pool
     * @param tokens Array of token addresses (2-10000 assets)
     * @param weights Array of weights (must sum to 1e18)
     * @param amplification Amplification parameter for stability
     * @param priceRanges Price ranges for concentrated liquidity
     */
    function createPool(
        address[] memory tokens,
        uint256[] memory weights,
        uint256 amplification,
        uint256[] memory priceRanges
    ) external onlyOwner returns (bytes32 poolId) {
        require(tokens.length >= MIN_POOL_TOKENS, "Too few tokens");
        require(tokens.length <= MAX_POOL_TOKENS, "Too many tokens");
        require(tokens.length == weights.length, "Weights length mismatch");
        require(tokens.length == priceRanges.length, "Price ranges length mismatch");
        require(amplification > 0, "Invalid amplification");

        // Validate weights sum to 1e18
        uint256 totalWeight = 0;
        for (uint256 i = 0; i < weights.length; i++) {
            totalWeight += weights[i];
        }
        require(totalWeight == PRICE_PRECISION, "Weights must sum to 1e18");

        // Generate pool ID
        poolId = keccak256(abi.encodePacked(tokens, weights, block.timestamp));
        
        // Initialize pool
        Pool storage pool = pools[poolId];
        pool.tokens = tokens;
        pool.reserves = new uint256[](tokens.length);
        pool.weights = weights;
        pool.priceRanges = priceRanges;
        pool.amplification = amplification;
        pool.feeRate = DEFAULT_FEE;
        pool.isolated = new bool[](tokens.length);
        pool.createdAt = block.timestamp;
        pool.active = true;

        allPools.push(poolId);

        emit PoolCreated(poolId, tokens, weights, amplification);
    }

    /**
     * @dev Add liquidity to a pool with concentrated range
     * @param poolId Pool identifier
     * @param amounts Array of token amounts to deposit
     * @param minLPTokens Minimum LP tokens to receive
     * @param minPrice Minimum price range for concentrated liquidity
     * @param maxPrice Maximum price range for concentrated liquidity
     */
    function addLiquidity(
        bytes32 poolId,
        uint256[] memory amounts,
        uint256 minLPTokens,
        uint256 minPrice,
        uint256 maxPrice
    ) external nonReentrant whenNotPaused returns (uint256 lpTokens) {
        Pool storage pool = pools[poolId];
        require(pool.active, "Pool not active");
        require(amounts.length == pool.tokens.length, "Invalid amounts length");
        require(minPrice < maxPrice, "Invalid price range");

        // Check for depegged assets
        _checkDepegStatus(poolId);

        // Calculate LP tokens to mint
        if (pool.totalSupply == 0) {
            // First liquidity provider
            lpTokens = OrbitalMath.calculateInitialLP(amounts, pool.weights);
        } else {
            // Subsequent liquidity providers
            lpTokens = OrbitalMath.calculateLPTokens(
                amounts,
                pool.reserves,
                pool.totalSupply,
                pool.weights
            );
        }

        require(lpTokens >= minLPTokens, "Insufficient LP tokens");

        // Transfer tokens from user
        for (uint256 i = 0; i < pool.tokens.length; i++) {
            if (amounts[i] > 0 && !pool.isolated[i]) {
                IERC20(pool.tokens[i]).safeTransferFrom(
                    msg.sender,
                    address(this),
                    amounts[i]
                );
                pool.reserves[i] += amounts[i];
            }
        }

        // Update user position
        LiquidityPosition storage position = positions[poolId][msg.sender];
        position.lpTokens += lpTokens;
        position.tokenAmounts = amounts;
        position.timestamp = block.timestamp;
        position.minPrice = minPrice;
        position.maxPrice = maxPrice;

        pool.totalSupply += lpTokens;

        emit LiquidityAdded(poolId, msg.sender, amounts, lpTokens, minPrice, maxPrice);
    }

    /**
     * @dev Execute swap between two assets in a pool
     * @param poolId Pool identifier
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Input amount
     * @param minAmountOut Minimum output amount
     */
    function swap(
        bytes32 poolId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        Pool storage pool = pools[poolId];
        require(pool.active, "Pool not active");
        
        // Find token indices
        (uint256 indexIn, uint256 indexOut) = _getTokenIndices(pool, tokenIn, tokenOut);
        
        // Check isolation status
        require(!pool.isolated[indexIn], "Input token isolated");
        require(!pool.isolated[indexOut], "Output token isolated");

        // Check for depeg before swap
        _checkDepegStatus(poolId);

        // Calculate swap amount using Orbital mathematics
        amountOut = OrbitalMath.calculateSwapAmount(
            pool.reserves[indexIn],
            pool.reserves[indexOut],
            pool.weights[indexIn],
            pool.weights[indexOut],
            amountIn,
            pool.feeRate,
            pool.amplification
        );

        require(amountOut >= minAmountOut, "Insufficient output amount");

        // Calculate fee
        uint256 fee = (amountIn * pool.feeRate) / 10000;

        // Update reserves
        pool.reserves[indexIn] += amountIn;
        pool.reserves[indexOut] -= amountOut;

        // Transfer tokens
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);

        emit Swap(poolId, msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee);
    }

    /**
     * @dev Get swap quote without executing
     */
    function getSwapQuote(
        bytes32 poolId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (SwapQuote memory quote) {
        Pool storage pool = pools[poolId];
        require(pool.active, "Pool not active");

        (uint256 indexIn, uint256 indexOut) = _getTokenIndices(pool, tokenIn, tokenOut);
        
        require(!pool.isolated[indexIn], "Input token isolated");
        require(!pool.isolated[indexOut], "Output token isolated");

        uint256 amountOut = OrbitalMath.calculateSwapAmount(
            pool.reserves[indexIn],
            pool.reserves[indexOut],
            pool.weights[indexIn],
            pool.weights[indexOut],
            amountIn,
            pool.feeRate,
            pool.amplification
        );

        uint256 priceImpact = OrbitalMath.calculatePriceImpact(
            pool.reserves[indexIn],
            pool.reserves[indexOut],
            amountIn,
            amountOut
        );

        uint256 fee = (amountIn * pool.feeRate) / 10000;

        quote = SwapQuote({
            amountOut: amountOut,
            priceImpact: priceImpact,
            fee: fee,
            route: new address[](2),
            gasEstimate: 250000
        });
        
        quote.route[0] = tokenIn;
        quote.route[1] = tokenOut;
    }

    // ============ Risk Management ============

    /**
     * @dev Check for depegged assets and isolate if necessary
     */
    function _checkDepegStatus(bytes32 poolId) internal {
        Pool storage pool = pools[poolId];
        
        for (uint256 i = 0; i < pool.tokens.length; i++) {
            if (pool.isolated[i]) continue;
            
            uint256 currentPrice = _getOraclePrice(pool.tokens[i]);
            uint256 deviation = _calculateDeviation(currentPrice, PRICE_PRECISION);
            
            if (deviation > DEPEG_THRESHOLD) {
                _isolateAsset(poolId, i, "Price deviation exceeds threshold");
            }
        }
    }

    /**
     * @dev Isolate a depegged asset
     */
    function _isolateAsset(bytes32 poolId, uint256 tokenIndex, string memory reason) internal {
        Pool storage pool = pools[poolId];
        pool.isolated[tokenIndex] = true;
        
        emit AssetIsolated(poolId, pool.tokens[tokenIndex], block.timestamp, reason);
    }

    /**
     * @dev Restore an isolated asset (admin only)
     */
    function restoreAsset(bytes32 poolId, uint256 tokenIndex) external onlyOwner {
        Pool storage pool = pools[poolId];
        require(pool.isolated[tokenIndex], "Asset not isolated");
        
        // Check price stability before restoring
        uint256 currentPrice = _getOraclePrice(pool.tokens[tokenIndex]);
        uint256 deviation = _calculateDeviation(currentPrice, PRICE_PRECISION);
        require(deviation <= DEPEG_THRESHOLD / 2, "Price still unstable");
        
        pool.isolated[tokenIndex] = false;
        
        emit AssetRestored(poolId, pool.tokens[tokenIndex], block.timestamp);
    }

    // ============ Internal Functions ============

    function _getTokenIndices(Pool storage pool, address tokenIn, address tokenOut) 
        internal view returns (uint256 indexIn, uint256 indexOut) {
        indexIn = type(uint256).max;
        indexOut = type(uint256).max;
        
        for (uint256 i = 0; i < pool.tokens.length; i++) {
            if (pool.tokens[i] == tokenIn) {
                indexIn = i;
            }
            if (pool.tokens[i] == tokenOut) {
                indexOut = i;
            }
        }
        
        require(indexIn != type(uint256).max, "Token in not found");
        require(indexOut != type(uint256).max, "Token out not found");
    }

    function _getOraclePrice(address /* token */) internal pure returns (uint256) {
        // Mock oracle - in production use Chainlink or similar
        return PRICE_PRECISION; // $1.00
    }

    function _calculateDeviation(uint256 price, uint256 target) internal pure returns (uint256) {
        if (price > target) {
            return ((price - target) * 10000) / target;
        } else {
            return ((target - price) * 10000) / target;
        }
    }

    // ============ View Functions ============

    function getPool(bytes32 poolId) external view returns (Pool memory) {
        return pools[poolId];
    }

    function getAllPools() external view returns (bytes32[] memory) {
        return allPools;
    }

    function getUserPosition(bytes32 poolId, address user) 
        external view returns (LiquidityPosition memory) {
        return positions[poolId][user];
    }

    // ============ Admin Functions ============

    function setOracle(address oracle, bool authorized) external onlyOwner {
        authorizedOracles[oracle] = authorized;
    }

    function pausePool(bytes32 poolId) external onlyOwner {
        pools[poolId].active = false;
    }

    function unpausePool(bytes32 poolId) external onlyOwner {
        pools[poolId].active = true;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
