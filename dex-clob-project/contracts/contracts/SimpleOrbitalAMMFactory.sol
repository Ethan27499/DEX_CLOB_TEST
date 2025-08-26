// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./SimpleOrbitalAMM.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SimpleOrbitalAMMFactory  
 * @dev Simple factory for Orbital AMM pools
 */
contract SimpleOrbitalAMMFactory is Ownable {
    // Mapping from token pairs to pool addresses
    mapping(address => mapping(address => address)) public getPool;
    
    // Array of all pools
    address[] public allPools;
    
    event PoolCreated(
        address indexed token0,
        address indexed token1,
        address pool,
        uint256 poolId
    );
    
    constructor() Ownable(msg.sender) {}
    
    /**
     * @notice Create a new pool
     * @param tokenA First token
     * @param tokenB Second token
     * @param fee Fee tier (basis points)
     * @return pool Pool address
     */
    function createPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external returns (address pool) {
        require(tokenA != tokenB, "IDENTICAL_TOKENS");
        require(tokenA != address(0) && tokenB != address(0), "ZERO_ADDRESS");
        
        // Sort tokens
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        
        // Check if pool exists
        require(getPool[token0][token1] == address(0), "POOL_EXISTS");
        
        // Deploy new pool using constructor
        pool = address(new SimpleOrbitalAMM(token0, token1, fee));
        
        // Store pool
        getPool[token0][token1] = pool;
        getPool[token1][token0] = pool;
        allPools.push(pool);
        
        emit PoolCreated(token0, token1, pool, allPools.length - 1);
    }
    
    /**
     * @notice Get number of pools
     */
    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
