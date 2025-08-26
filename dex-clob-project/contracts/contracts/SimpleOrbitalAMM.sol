// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IOrbitalAMM.sol";
import "./libraries/OrbitalMath.sol";

/**
 * @title SimpleOrbitalAMM
 * @dev Simplified Orbital AMM for factory deployment
 */
contract SimpleOrbitalAMM is IOrbitalAMM, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using OrbitalMath for uint256;

    // =============================================================================
    // CONSTANTS
    // =============================================================================
    
    bytes32 public constant POOL_MANAGER_ROLE = keccak256("POOL_MANAGER_ROLE");
    uint256 public constant PRECISION = 1e18;
    uint256 public constant MAX_FEE = 10000;
    uint256 public constant MIN_LIQUIDITY = 1000;
    uint256 internal constant Q96 = 0x1000000000000000000000000;

    // =============================================================================
    // STATE VARIABLES
    // =============================================================================
    
    IERC20 public immutable token0;
    IERC20 public immutable token1;
    uint24 public immutable fee;
    
    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public totalLiquidity;
    
    // Orbital parameters
    uint256 public orbitalFactor = 100;
    
    // Liquidity tracking
    mapping(address => uint256) public liquidityBalances;
    
    // Oracle
    uint256 public lastPrice;
    uint256 public lastUpdateTime;
    
    // Pool state
    bool public initialized;

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================
    
    constructor(
        address _token0,
        address _token1,
        uint24 _fee
    ) {
        require(_token0 != _token1, "IDENTICAL_TOKENS");
        require(_token0 != address(0) && _token1 != address(0), "ZERO_ADDRESS");
        require(_fee <= MAX_FEE, "FEE_TOO_HIGH");
        
        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
        fee = _fee;
        
        lastUpdateTime = block.timestamp;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(POOL_MANAGER_ROLE, msg.sender);
        
        // Also grant roles to tx.origin (the deployer calling through factory)
        _grantRole(DEFAULT_ADMIN_ROLE, tx.origin);
        _grantRole(POOL_MANAGER_ROLE, tx.origin);
    }

    // =============================================================================
    // INITIALIZATION
    // =============================================================================
    
    function initialize(uint160 sqrtPriceX96) external override onlyRole(POOL_MANAGER_ROLE) {
        require(!initialized, "ALREADY_INITIALIZED");
        initialized = true;
        
        // Simple price initialization
        lastPrice = (uint256(sqrtPriceX96) * uint256(sqrtPriceX96)) >> 192;
        
        emit Initialize(sqrtPriceX96, 0);
    }

    // =============================================================================
    // LIQUIDITY FUNCTIONS
    // =============================================================================
    
    function mint(
        address recipient,
        int24,
        int24,
        uint128 amount,
        bytes calldata data
    ) external override nonReentrant returns (uint256 amount0, uint256 amount1) {
        require(amount > 0, "ZERO_AMOUNT");
        require(initialized, "NOT_INITIALIZED");
        
        if (totalLiquidity == 0) {
            // First liquidity
            amount0 = uint256(amount);
            amount1 = uint256(amount);
            
            uint256 liquidity = OrbitalMath.sqrt(amount0 * amount1) - MIN_LIQUIDITY;
            totalLiquidity = liquidity + MIN_LIQUIDITY;
            liquidityBalances[recipient] = liquidity;
        } else {
            // Subsequent liquidity
            uint256 liquidity0 = (uint256(amount) * totalLiquidity) / reserve0;
            uint256 liquidity1 = (uint256(amount) * totalLiquidity) / reserve1;
            uint256 liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
            
            amount0 = (liquidity * reserve0) / totalLiquidity;
            amount1 = (liquidity * reserve1) / totalLiquidity;
            
            totalLiquidity += liquidity;
            liquidityBalances[recipient] += liquidity;
        }
        
        // Callback
        IOrbitalAMMCallback(msg.sender).orbitalAMMCallback(
            int256(amount0),
            int256(amount1),
            data
        );
        
        reserve0 += amount0;
        reserve1 += amount1;
        
        emit Mint(msg.sender, recipient, 0, 0, amount, amount0, amount1);
    }
    
    function burn(
        int24,
        int24,
        uint128 amount
    ) external override nonReentrant returns (uint256 amount0, uint256 amount1) {
        require(amount > 0, "ZERO_AMOUNT");
        require(liquidityBalances[msg.sender] >= amount, "INSUFFICIENT_LIQUIDITY");
        
        uint256 liquidity = uint256(amount);
        amount0 = (liquidity * reserve0) / totalLiquidity;
        amount1 = (liquidity * reserve1) / totalLiquidity;
        
        liquidityBalances[msg.sender] -= liquidity;
        totalLiquidity -= liquidity;
        
        reserve0 -= amount0;
        reserve1 -= amount1;
        
        token0.safeTransfer(msg.sender, amount0);
        token1.safeTransfer(msg.sender, amount1);
    }
    
    function collect(
        address /* recipient */,
        int24,
        int24,
        uint128 /* amount0Requested */,
        uint128 /* amount1Requested */
    ) external pure override returns (uint128 amount0, uint128 amount1) {
        // Simplified - no fee collection for now
        return (0, 0);
    }

    // =============================================================================
    // SWAP FUNCTIONS
    // =============================================================================
    
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160,
        bytes calldata data
    ) external override nonReentrant returns (int256 amount0, int256 amount1) {
        require(amountSpecified != 0, "ZERO_AMOUNT");
        require(totalLiquidity > 0, "NO_LIQUIDITY");
        
        uint256 amountIn = uint256(amountSpecified > 0 ? amountSpecified : -amountSpecified);
        
        if (zeroForOne) {
            uint256 amountOut = _getAmountOut(amountIn, reserve0, reserve1);
            
            amount0 = int256(amountIn);
            amount1 = -int256(amountOut);
            
            reserve0 += amountIn;
            reserve1 -= amountOut;
            
            token1.safeTransfer(recipient, amountOut);
        } else {
            uint256 amountOut = _getAmountOut(amountIn, reserve1, reserve0);
            
            amount0 = -int256(amountOut);
            amount1 = int256(amountIn);
            
            reserve0 -= amountOut;
            reserve1 += amountIn;
            
            token0.safeTransfer(recipient, amountOut);
        }
        
        IOrbitalAMMCallback(msg.sender).orbitalAMMCallback(amount0, amount1, data);
        
        emit Swap(msg.sender, recipient, amount0, amount1, 0, uint128(totalLiquidity), 0);
    }

    // =============================================================================
    // ORACLE & FLASH FUNCTIONS
    // =============================================================================
    
    function flash(
        address recipient,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external override nonReentrant {
        require(amount0 > 0 || amount1 > 0, "ZERO_AMOUNT");
        
        if (amount0 > 0) token0.safeTransfer(recipient, amount0);
        if (amount1 > 0) token1.safeTransfer(recipient, amount1);
        
        IOrbitalAMMCallback(msg.sender).orbitalAMMCallback(
            int256(amount0),
            int256(amount1),
            data
        );
        
        emit Flash(msg.sender, recipient, amount0, amount1, 0, 0);
    }
    
    function observe(uint32[] calldata)
        external
        pure
        override
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        tickCumulatives = new int56[](1);
        secondsPerLiquidityCumulativeX128s = new uint160[](1);
    }
    
    function snapshotCumulativesInside(int24, int24)
        external
        view
        override
        returns (int56, uint160, uint32)
    {
        return (0, 0, uint32(block.timestamp));
    }

    // =============================================================================
    // INTERNAL FUNCTIONS
    // =============================================================================
    
    function _getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal view returns (uint256 amountOut) {
        require(amountIn > 0, "INSUFFICIENT_INPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "INSUFFICIENT_LIQUIDITY");
        
        uint256 amountInWithFee = amountIn * (10000 - fee);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 10000) + amountInWithFee;
        amountOut = numerator / denominator;
        
        // Apply orbital adjustment if enabled
        if (orbitalFactor > 0) {
            uint160 orbitalPrice = OrbitalMath.calculateOrbitalPrice(
                reserveIn,
                reserveOut,
                orbitalFactor
            );
            amountOut = (amountOut * uint256(orbitalPrice)) / Q96;
        }
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================
    
    function getToken0() external view returns (address) {
        return address(token0);
    }
    
    function getToken1() external view returns (address) {
        return address(token1);
    }
    
    function tickSpacing() external pure returns (int24) {
        return 60; // Fixed tick spacing
    }
}
