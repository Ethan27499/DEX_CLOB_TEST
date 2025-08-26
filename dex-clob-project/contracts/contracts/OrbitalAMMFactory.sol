// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./OrbitalAMM.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title OrbitalAMMFactory
 * @dev Factory contract for deploying and managing Orbital AMM pools
 */
contract OrbitalAMMFactory is Ownable, ReentrancyGuard {
    // =============================================================================
    // STORAGE
    // =============================================================================
    
    /// @notice Mapping of token pairs to pool addresses
    mapping(address => mapping(address => mapping(uint24 => address))) public getPool;
    
    /// @notice Array of all created pool addresses
    address[] public allPools;
    
    /// @notice The contract that deployed the factory
    address public immutable deployer;
    
    /// @notice Maximum fee percentage allowed (1% = 10000)
    uint24 public constant MAX_FEE = 100000; // 10%
    
    /// @notice Default protocol fee (0.05% = 500)
    uint24 public protocolFee = 500;
    
    /// @notice Protocol fee recipient
    address public feeRecipient;

    // =============================================================================
    // EVENTS
    // =============================================================================
    
    event PoolCreated(
        address indexed token0,
        address indexed token1,
        uint24 indexed fee,
        address pool,
        uint256 poolId
    );
    
    event ProtocolFeeChanged(uint24 oldFee, uint24 newFee);
    event FeeRecipientChanged(address indexed oldRecipient, address indexed newRecipient);

    // =============================================================================
    // ERRORS
    // =============================================================================
    
    error IdenticalTokens();
    error ZeroAddress();
    error PoolExists();
    error InvalidFee();
    error Unauthorized();

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================
    
    constructor() Ownable(msg.sender) {
        deployer = msg.sender;
        feeRecipient = msg.sender;
    }

    // =============================================================================
    // POOL MANAGEMENT
    // =============================================================================
    
    /**
     * @notice Create a new Orbital AMM pool
     * @param tokenA Address of first token
     * @param tokenB Address of second token
     * @param fee Fee tier for the pool (in basis points)
     * @return pool Address of the created pool
     */
    function createPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external nonReentrant returns (address pool) {
        if (tokenA == tokenB) revert IdenticalTokens();
        if (tokenA == address(0) || tokenB == address(0)) revert ZeroAddress();
        if (fee > MAX_FEE) revert InvalidFee();
        
        // Sort tokens
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        
        // Check if pool already exists
        if (getPool[token0][token1][fee] != address(0)) revert PoolExists();
        
        // Deploy new pool
        bytes memory bytecode = type(OrbitalAMM).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1, fee));
        
        assembly {
            pool := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
        }
        
        // Initialize the pool
        OrbitalAMM(pool).initialize(token0, token1, fee, address(this));
        
        // Store pool addresses
        getPool[token0][token1][fee] = pool;
        getPool[token1][token0][fee] = pool; // populate mapping in the reverse direction
        allPools.push(pool);
        
        emit PoolCreated(token0, token1, fee, pool, allPools.length - 1);
    }
    
    /**
     * @notice Get the number of pools created
     * @return Number of pools
     */
    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
    
    /**
     * @notice Get pool address for a token pair and fee
     * @param tokenA First token
     * @param tokenB Second token
     * @param fee Fee tier
     * @return pool Pool address (address(0) if doesn't exist)
     */
    function getPoolAddress(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external view returns (address pool) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return getPool[token0][token1][fee];
    }

    // =============================================================================
    // PROTOCOL SETTINGS
    // =============================================================================
    
    /**
     * @notice Set protocol fee (only owner)
     * @param newFee New protocol fee in basis points
     */
    function setProtocolFee(uint24 newFee) external onlyOwner {
        if (newFee > MAX_FEE) revert InvalidFee();
        
        uint24 oldFee = protocolFee;
        protocolFee = newFee;
        
        emit ProtocolFeeChanged(oldFee, newFee);
    }
    
    /**
     * @notice Set fee recipient (only owner)
     * @param newRecipient New fee recipient address
     */
    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        
        emit FeeRecipientChanged(oldRecipient, newRecipient);
    }
    
    /**
     * @notice Enable fee collection for a pool (only owner)
     * @param pool Pool address
     * @param protocol0 Protocol fee for token0
     * @param protocol1 Protocol fee for token1
     */
    function setPoolProtocolFee(
        address pool,
        uint8 protocol0,
        uint8 protocol1
    ) external onlyOwner {
        if (pool == address(0)) revert ZeroAddress();
        OrbitalAMM(pool).setFeeProtocol(protocol0, protocol1);
    }
    
    /**
     * @notice Collect protocol fees from a pool (only owner)
     * @param pool Pool address
     * @param recipient Fee recipient
     * @param amount0Requested Amount of token0 requested
     * @param amount1Requested Amount of token1 requested
     * @return amount0 Amount of token0 collected
     * @return amount1 Amount of token1 collected
     */
    function collectProtocolFees(
        address pool,
        address recipient,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external onlyOwner returns (uint128 amount0, uint128 amount1) {
        if (pool == address(0) || recipient == address(0)) revert ZeroAddress();
        return OrbitalAMM(pool).collectProtocol(recipient, amount0Requested, amount1Requested);
    }

    // =============================================================================
    // UTILITY FUNCTIONS
    // =============================================================================
    
    /**
     * @notice Check if an address is a pool created by this factory
     * @param pool Address to check
     * @return True if the address is a pool created by this factory
     */
    function isPool(address pool) external view returns (bool) {
        for (uint256 i = 0; i < allPools.length; i++) {
            if (allPools[i] == pool) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * @notice Get pools for a token pair across all fee tiers
     * @param tokenA First token
     * @param tokenB Second token
     * @return pools Array of pool addresses
     */
    function getPoolsForPair(
        address tokenA,
        address tokenB
    ) external view returns (address[] memory pools) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        
        // Common fee tiers
        uint24[] memory feeTiers = new uint24[](6);
        feeTiers[0] = 100;    // 0.01%
        feeTiers[1] = 500;    // 0.05%
        feeTiers[2] = 3000;   // 0.3%
        feeTiers[3] = 10000;  // 1%
        feeTiers[4] = 30000;  // 3%
        feeTiers[5] = 100000; // 10%
        
        address[] memory tempPools = new address[](feeTiers.length);
        uint256 count = 0;
        
        for (uint256 i = 0; i < feeTiers.length; i++) {
            address pool = getPool[token0][token1][feeTiers[i]];
            if (pool != address(0)) {
                tempPools[count] = pool;
                count++;
            }
        }
        
        // Create properly sized array
        pools = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            pools[i] = tempPools[i];
        }
    }
    
    /**
     * @notice Get pool creation parameters
     * @param pool Pool address
     * @return token0 First token address
     * @return token1 Second token address
     * @return fee Fee tier
     * @return tickSpacing Tick spacing
     */
    function getPoolParameters(address pool)
        external
        view
        returns (
            address token0,
            address token1,
            uint24 fee,
            int24 tickSpacing
        )
    {
        if (pool == address(0)) revert ZeroAddress();
        
        OrbitalAMM poolContract = OrbitalAMM(pool);
        return (
            poolContract.getToken0(),
            poolContract.getToken1(),
            poolContract.fee(),
            poolContract.tickSpacing()
        );
    }
}
