// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IOrbitalAMM
 * @dev Interface for Orbital AMM with enhanced price discovery
 */
interface IOrbitalAMM {
    // =============================================================================
    // EVENTS
    // =============================================================================
    
    event Initialize(uint160 sqrtPriceX96, int24 tick);
    event Mint(
        address indexed sender,
        address indexed owner,
        int24 indexed tickLower,
        int24 tickUpper,
        uint128 amount,
        uint256 amount0,
        uint256 amount1
    );
    event Burn(
        address indexed owner,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount,
        uint256 amount0,
        uint256 amount1
    );
    event Swap(
        address indexed sender,
        address indexed recipient,
        int256 amount0,
        int256 amount1,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick
    );
    event Flash(
        address indexed sender,
        address indexed recipient,
        uint256 amount0,
        uint256 amount1,
        uint256 paid0,
        uint256 paid1
    );

    // =============================================================================
    // FUNCTIONS
    // =============================================================================
    
    /**
     * @notice Initialize the pool with a starting price
     * @param sqrtPriceX96 The starting sqrt price of the pool
     */
    function initialize(uint160 sqrtPriceX96) external;
    
    /**
     * @notice Add liquidity to the pool
     * @param recipient The address to receive the liquidity position
     * @param tickLower The lower tick of the position (simplified for orbital AMM)
     * @param tickUpper The upper tick of the position (simplified for orbital AMM)
     * @param amount The amount of liquidity to add
     * @param data Callback data passed to the mint callback
     * @return amount0 The amount of token0 required
     * @return amount1 The amount of token1 required
     */
    function mint(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount,
        bytes calldata data
    ) external returns (uint256 amount0, uint256 amount1);
    
    /**
     * @notice Remove liquidity from the pool
     * @param tickLower The lower tick of the position
     * @param tickUpper The upper tick of the position
     * @param amount The amount of liquidity to remove
     * @return amount0 The amount of token0 to be collected
     * @return amount1 The amount of token1 to be collected
     */
    function burn(
        int24 tickLower,
        int24 tickUpper,
        uint128 amount
    ) external returns (uint256 amount0, uint256 amount1);
    
    /**
     * @notice Collect fees and withdrawn liquidity
     * @param recipient The address to receive the collected tokens
     * @param tickLower The lower tick of the position
     * @param tickUpper The upper tick of the position
     * @param amount0Requested The maximum amount of token0 to collect
     * @param amount1Requested The maximum amount of token1 to collect
     * @return amount0 The amount of token0 collected
     * @return amount1 The amount of token1 collected
     */
    function collect(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external returns (uint128 amount0, uint128 amount1);
    
    /**
     * @notice Swap tokens using orbital curve mechanics
     * @param recipient The address to receive the output tokens
     * @param zeroForOne Whether to swap token0 for token1 or vice versa
     * @param amountSpecified The amount to swap (positive for exact input, negative for exact output)
     * @param sqrtPriceLimitX96 The price limit for the swap (simplified)
     * @param data Callback data passed to the swap callback
     * @return amount0 The amount of token0 transferred
     * @return amount1 The amount of token1 transferred
     */
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
    
    /**
     * @notice Execute a flash loan
     * @param recipient The address to receive the flash loan
     * @param amount0 The amount of token0 to flash loan
     * @param amount1 The amount of token1 to flash loan
     * @param data Callback data passed to the flash callback
     */
    function flash(
        address recipient,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external;
    
    /**
     * @notice Get historical observations (simplified)
     * @param secondsAgos Array of seconds ago to get observations for
     * @return tickCumulatives The cumulative tick values
     * @return secondsPerLiquidityCumulativeX128s The cumulative seconds per liquidity values
     */
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
    
    /**
     * @notice Get cumulative values inside a tick range (simplified)
     * @param tickLower The lower tick
     * @param tickUpper The upper tick
     * @return tickCumulativeInside The cumulative tick inside the range
     * @return secondsPerLiquidityInsideX128 The cumulative seconds per liquidity inside the range
     * @return secondsInside The seconds inside the range
     */
    function snapshotCumulativesInside(int24 tickLower, int24 tickUpper)
        external
        view
        returns (
            int56 tickCumulativeInside,
            uint160 secondsPerLiquidityInsideX128,
            uint32 secondsInside
        );
}

/**
 * @title IOrbitalAMMCallback
 * @dev Interface for callbacks used by OrbitalAMM
 */
interface IOrbitalAMMCallback {
    /**
     * @notice Called when interacting with the OrbitalAMM
     * @param amount0Delta The amount of token0 being requested/returned
     * @param amount1Delta The amount of token1 being requested/returned
     * @param data The data passed through by the caller
     */
    function orbitalAMMCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external;
}
