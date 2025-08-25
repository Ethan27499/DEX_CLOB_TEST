// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./LiquidityPool.sol";

/**
 * @title PoolFactory
 * @dev Factory contract for creating and managing liquidity pools
 * @notice Creates new trading pairs and manages pool registry
 */
contract PoolFactory is AccessControl, ReentrancyGuard {
    
    // =============================================================================
    // ROLES & CONSTANTS
    // =============================================================================
    
    bytes32 public constant POOL_CREATOR_ROLE = keccak256("POOL_CREATOR_ROLE");
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
    
    uint256 public constant DEFAULT_FEE = 30; // 0.30%
    uint256 public constant MAX_FEE = 100; // 1.00%

    // =============================================================================
    // STATE VARIABLES
    // =============================================================================
    
    address public feeTo;
    address public feeToSetter;
    
    mapping(address => mapping(address => address)) public getPool;
    address[] public allPools;
    
    // Pool configuration
    mapping(address => uint256) public poolFees;
    mapping(address => bool) public isPoolActive;
    
    // Factory statistics
    uint256 public totalPools;
    uint256 public totalVolume;
    uint256 public totalFees;

    // =============================================================================
    // EVENTS
    // =============================================================================
    
    event PoolCreated(
        address indexed token0,
        address indexed token1,
        address pool,
        uint256 poolCount
    );
    
    event PoolActivated(address indexed pool);
    event PoolDeactivated(address indexed pool);
    event FeeToChanged(address indexed newFeeTo);

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(POOL_CREATOR_ROLE, msg.sender);
        _grantRole(FEE_MANAGER_ROLE, msg.sender);
        
        feeToSetter = msg.sender;
        feeTo = msg.sender;
    }

    // =============================================================================
    // POOL CREATION
    // =============================================================================
    
    /**
     * @dev Create a new liquidity pool
     * @param tokenA First token address
     * @param tokenB Second token address
     * @return pool Address of created pool
     */
    function createPool(address tokenA, address tokenB) 
        external 
        onlyRole(POOL_CREATOR_ROLE) 
        nonReentrant 
        returns (address pool) 
    {
        require(tokenA != tokenB, "Identical addresses");
        
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "Zero address");
        require(getPool[token0][token1] == address(0), "Pool exists");
        
        // Create pool name and symbol
        string memory token0Symbol = _getTokenSymbol(token0);
        string memory token1Symbol = _getTokenSymbol(token1);
        string memory poolName = string(abi.encodePacked(token0Symbol, "-", token1Symbol, " LP"));
        string memory poolSymbol = string(abi.encodePacked(token0Symbol, token1Symbol, "-LP"));
        
        // Deploy new pool
        pool = address(new LiquidityPool(
            token0,
            token1,
            poolName,
            poolSymbol
        ));
        
        // Register pool
        getPool[token0][token1] = pool;
        getPool[token1][token0] = pool; // populate mapping in the reverse direction
        allPools.push(pool);
        
        // Set initial configuration
        poolFees[pool] = DEFAULT_FEE;
        isPoolActive[pool] = true;
        totalPools++;
        
        emit PoolCreated(token0, token1, pool, allPools.length);
    }
    
    /**
     * @dev Create multiple pools in batch
     * @param tokens Array of token addresses to create pools for
     */
    function createPoolsBatch(address[] calldata tokens) 
        external 
        onlyRole(POOL_CREATOR_ROLE) 
        nonReentrant 
    {
        require(tokens.length >= 2, "Need at least 2 tokens");
        
        for (uint256 i = 0; i < tokens.length; i++) {
            for (uint256 j = i + 1; j < tokens.length; j++) {
                address tokenA = tokens[i];
                address tokenB = tokens[j];
                
                (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
                
                // Only create if pool doesn't exist
                if (getPool[token0][token1] == address(0)) {
                    this.createPool(tokenA, tokenB);
                }
            }
        }
    }

    // =============================================================================
    // POOL MANAGEMENT
    // =============================================================================
    
    /**
     * @dev Set pool fee
     * @param pool Pool address
     * @param fee New fee amount
     */
    function setPoolFee(address pool, uint256 fee) 
        external 
        onlyRole(FEE_MANAGER_ROLE) 
    {
        require(fee <= MAX_FEE, "Fee too high");
        require(_isValidPool(pool), "Invalid pool");
        
        poolFees[pool] = fee;
        
        // Update fee in the pool contract
        LiquidityPool(pool).setTradingFee(fee);
    }
    
    /**
     * @dev Activate pool
     * @param pool Pool address
     */
    function activatePool(address pool) 
        external 
        onlyRole(POOL_CREATOR_ROLE) 
    {
        require(_isValidPool(pool), "Invalid pool");
        require(!isPoolActive[pool], "Pool already active");
        
        isPoolActive[pool] = true;
        emit PoolActivated(pool);
    }
    
    /**
     * @dev Deactivate pool
     * @param pool Pool address
     */
    function deactivatePool(address pool) 
        external 
        onlyRole(POOL_CREATOR_ROLE) 
    {
        require(_isValidPool(pool), "Invalid pool");
        require(isPoolActive[pool], "Pool already inactive");
        
        isPoolActive[pool] = false;
        emit PoolDeactivated(pool);
    }
    
    /**
     * @dev Set fee recipient
     * @param _feeTo New fee recipient address
     */
    function setFeeTo(address _feeTo) external {
        require(msg.sender == feeToSetter, "Forbidden");
        feeTo = _feeTo;
        emit FeeToChanged(_feeTo);
    }
    
    /**
     * @dev Set fee setter
     * @param _feeToSetter New fee setter address
     */
    function setFeeToSetter(address _feeToSetter) external {
        require(msg.sender == feeToSetter, "Forbidden");
        feeToSetter = _feeToSetter;
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================
    
    /**
     * @dev Get all pools
     */
    function getAllPools() external view returns (address[] memory) {
        return allPools;
    }
    
    /**
     * @dev Get active pools
     */
    function getActivePools() external view returns (address[] memory) {
        uint256 activeCount = 0;
        
        // Count active pools
        for (uint256 i = 0; i < allPools.length; i++) {
            if (isPoolActive[allPools[i]]) {
                activeCount++;
            }
        }
        
        // Create array of active pools
        address[] memory activePools = new address[](activeCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allPools.length; i++) {
            if (isPoolActive[allPools[i]]) {
                activePools[index] = allPools[i];
                index++;
            }
        }
        
        return activePools;
    }
    
    /**
     * @dev Get pool by tokens
     * @param tokenA First token
     * @param tokenB Second token
     */
    function getPoolByTokens(address tokenA, address tokenB) external view returns (address) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return getPool[token0][token1];
    }
    
    /**
     * @dev Get pool information
     * @param pool Pool address
     */
    function getPoolInfo(address pool) external view returns (
        address token0,
        address token1,
        uint256 reserve0,
        uint256 reserve1,
        uint256 totalSupply,
        uint256 fee,
        bool active,
        uint256 volume,
        uint256 fees
    ) {
        require(_isValidPool(pool), "Invalid pool");
        
        LiquidityPool poolContract = LiquidityPool(pool);
        (token0, token1, reserve0, reserve1, totalSupply, , volume, fees) = poolContract.getPoolInfo();
        
        fee = poolFees[pool];
        active = isPoolActive[pool];
    }
    
    /**
     * @dev Get factory statistics
     */
    function getFactoryStats() external view returns (
        uint256 _totalPools,
        uint256 _activePools,
        uint256 _totalVolume,
        uint256 _totalFees
    ) {
        uint256 activeCount = 0;
        
        for (uint256 i = 0; i < allPools.length; i++) {
            if (isPoolActive[allPools[i]]) {
                activeCount++;
            }
        }
        
        return (
            totalPools,
            activeCount,
            totalVolume,
            totalFees
        );
    }
    
    /**
     * @dev Find best pool for token pair
     * @param tokenA First token
     * @param tokenB Second token
     */
    function findBestPool(address tokenA, address tokenB) external view returns (
        address bestPool,
        uint256 bestPrice,
        uint256 liquidity
    ) {
        address pool = getPool[tokenA][tokenB];
        
        if (pool != address(0) && isPoolActive[pool]) {
            LiquidityPool poolContract = LiquidityPool(pool);
            (uint112 reserve0, uint112 reserve1,) = poolContract.getReserves();
            
            if (reserve0 > 0 && reserve1 > 0) {
                bestPool = pool;
                
                // Calculate price and liquidity
                address token0 = poolContract.token0();
                if (tokenA == token0) {
                    bestPrice = (uint256(reserve1) * 1e18) / uint256(reserve0);
                    liquidity = uint256(reserve0);
                } else {
                    bestPrice = (uint256(reserve0) * 1e18) / uint256(reserve1);
                    liquidity = uint256(reserve1);
                }
            }
        }
    }

    // =============================================================================
    // ROUTER INTEGRATION
    // =============================================================================
    
    /**
     * @dev Get optimal route for token swap
     * @param tokenIn Input token
     * @param tokenOut Output token
     * @param amountIn Input amount
     */
    function getOptimalRoute(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (
        address[] memory path,
        address[] memory pools,
        uint256 amountOut
    ) {
        // Direct pool
        address directPool = getPool[tokenIn][tokenOut];
        
        if (directPool != address(0) && isPoolActive[directPool]) {
            LiquidityPool pool = LiquidityPool(directPool);
            (uint112 reserve0, uint112 reserve1,) = pool.getReserves();
            
            if (reserve0 > 0 && reserve1 > 0) {
                path = new address[](2);
                pools = new address[](1);
                
                path[0] = tokenIn;
                path[1] = tokenOut;
                pools[0] = directPool;
                
                // Calculate amount out
                address token0 = pool.token0();
                if (tokenIn == token0) {
                    amountOut = pool.getAmountOut(amountIn, reserve0, reserve1);
                } else {
                    amountOut = pool.getAmountOut(amountIn, reserve1, reserve0);
                }
            }
        }
        
        // TODO: Implement multi-hop routing for indirect paths
        // This would require more complex pathfinding algorithms
    }

    // =============================================================================
    // INTERNAL FUNCTIONS
    // =============================================================================
    
    /**
     * @dev Check if address is a valid pool
     */
    function _isValidPool(address pool) internal view returns (bool) {
        for (uint256 i = 0; i < allPools.length; i++) {
            if (allPools[i] == pool) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * @dev Get token symbol (simplified)
     */
    function _getTokenSymbol(address token) internal pure returns (string memory) {
        // In production, this would call the token contract's symbol() function
        // For simplicity, we'll use address-based naming
        if (token == address(0)) return "ETH";
        
        // Convert address to string for unique naming
        bytes memory alphabet = "0123456789ABCDEF";
        bytes memory str = new bytes(8);
        for (uint256 i = 0; i < 4; i++) {
            str[i*2] = alphabet[uint8(uint256(uint160(token)) >> (4 * (7 - i))) & 0xF];
            str[1+i*2] = alphabet[uint8(uint256(uint160(token)) >> (4 * (6 - i))) & 0xF];
        }
        return string(str);
    }
}
