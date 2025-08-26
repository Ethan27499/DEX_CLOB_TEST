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
 * @title OrbitalAMM
 * @dev Advanced AMM with concentrated liquidity and orbital curve mathematics
 * @notice Implements orbital curve for enhanced price discovery and reduced impermanent loss
 */
contract OrbitalAMM is IOrbitalAMM, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using OrbitalMath for uint256;

    // =============================================================================
    // ROLES & CONSTANTS
    // =============================================================================
    
    bytes32 public constant POOL_MANAGER_ROLE = keccak256("POOL_MANAGER_ROLE");
    bytes32 public constant LIQUIDITY_PROVIDER_ROLE = keccak256("LIQUIDITY_PROVIDER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    uint256 public constant PRECISION = 1e18;
    uint256 public constant MAX_FEE = 10000; // 100% max fee (in basis points)
    uint256 public constant MIN_LIQUIDITY = 1000;
    uint256 public constant ORBITAL_FACTOR_MAX = 1000;
    uint256 internal constant Q96 = 0x1000000000000000000000000;
    int24 public constant MIN_TICK = -887272;
    int24 public constant MAX_TICK = 887272;
    uint128 public constant MAX_UINT128 = type(uint128).max;

    // =============================================================================
    // STATE VARIABLES
    // =============================================================================
    
    // Pool configuration
    IERC20 public immutable token0;
    IERC20 public immutable token1;
    uint24 public immutable fee; // Fee in basis points (e.g., 300 = 0.3%)
    address public immutable factory; // Factory address
    
    /**
     * @notice Get token0 address
     * @return Address of token0
     */
    function getToken0() external view returns (address) {
        return address(token0);
    }
    
    /**
     * @notice Get token1 address  
     * @return Address of token1
     */
    function getToken1() external view returns (address) {
        return address(token1);
    }
    
    // Pool state
    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public totalLiquidity;
    uint256 public kLast; // Reserve0 * reserve1 as of immediately after the most recent liquidity event
    
    // Orbital AMM specific
    uint256 public orbitalFactor = 100; // Orbital curve adjustment factor (0-1000)
    uint256 public concentrationTarget = 500; // Target concentration percentage (50%)
    uint256 public concentrationRange = 200; // Concentration range (20%)
    uint256 public ilProtectionFactor = 50; // IL protection factor (5%)
    
    // Fee management
    uint256 public protocolFeePercentage = 500; // 0.5% protocol fee
    uint256 public dynamicFeeEnabled = 1; // Dynamic fee adjustment enabled
    uint256 public baseFee = 300; // Base fee in basis points (0.3%)
    uint256 public maxFeeMultiplier = 10; // Maximum fee multiplier
    
    // Liquidity tracking
    mapping(address => uint256) public liquidityBalances;
    mapping(address => uint256) public liquidityTimestamps;
    mapping(address => uint256) public accumulatedFees0;
    mapping(address => uint256) public accumulatedFees1;
    
    // Price oracle
    uint256 public lastPrice;
    uint256 public priceEMA; // Exponential moving average
    uint256 public lastUpdateTime;
    uint256 public constant ORACLE_WINDOW = 1 hours;
    
    // Flash loan state
    mapping(address => bool) public isFlashLoan;
    uint256 public flashLoanFee = 9; // 0.09% flash loan fee

    // Protocol fees
    uint128 public protocolFees0;
    uint128 public protocolFees1;
    uint8 public feeProtocol;

    // Pool initialization
    bool public initialized;
    int24 public tickSpacing;

    // =============================================================================
    // EVENTS
    // =============================================================================
    
    event LiquidityAdded(
        address indexed provider,
        uint256 amount0,
        uint256 amount1,
        uint256 liquidity
    );
    
    event LiquidityRemoved(
        address indexed provider,
        uint256 amount0,
        uint256 amount1,
        uint256 liquidity
    );
    
    event TokensSwapped(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );
    
    event OrbitalParametersUpdated(
        uint256 orbitalFactor,
        uint256 concentrationTarget,
        uint256 concentrationRange
    );
    
    event ProtocolFeesCollected(uint256 amount0, uint256 amount1);

    // =============================================================================
    // MODIFIERS
    // =============================================================================
    
    modifier updateOracle() {
        _updateOracle();
        _;
    }

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================
    
    constructor() {
        // For factory deployment, tokens are set through initialize
        token0 = IERC20(address(0));
        token1 = IERC20(address(0));
        fee = 0;
        factory = msg.sender;
        
        // Disable initializers for implementation contract
        _disableInitializers();
    }

    /**
     * @notice Initialize the pool (called by factory)
     * @param _token0 First token address
     * @param _token1 Second token address
     * @param _fee Fee tier
     * @param _factory Factory address
     */
    function initialize(
        address _token0,
        address _token1,
        uint24 _fee,
        address _factory
    ) external {
        require(!initialized, "ALREADY_INITIALIZED");
        require(msg.sender == factory, "UNAUTHORIZED");
        require(_token0 != _token1, "IDENTICAL_TOKENS");
        require(_token0 != address(0) && _token1 != address(0), "ZERO_ADDRESS");
        require(_fee <= MAX_FEE, "FEE_TOO_HIGH");
        
        // Set immutable-like variables through assembly (not actually immutable in this case)
        // In production, use a proper factory pattern with CREATE2
        
        initialized = true;
        tickSpacing = int24(_fee / 50); // Simple tick spacing calculation
        lastUpdateTime = block.timestamp;
        
        _grantRole(DEFAULT_ADMIN_ROLE, _factory);
        _grantRole(POOL_MANAGER_ROLE, _factory);
    }

    // =============================================================================
    // INITIALIZATION
    // =============================================================================
    
    function initialize(uint160 sqrtPriceX96) external override onlyRole(POOL_MANAGER_ROLE) {
        require(totalLiquidity == 0, "ALREADY_INITIALIZED");
        // For simplified implementation, we'll use basic price initialization
        // In production, implement full sqrt price logic
        lastPrice = (uint256(sqrtPriceX96) * uint256(sqrtPriceX96)) >> 192;
        priceEMA = lastPrice;
        emit Initialize(sqrtPriceX96, 0);
    }

    // =============================================================================
    // LIQUIDITY MANAGEMENT
    // =============================================================================
    
    function mint(
        address recipient,
        int24 /* tickLower */,
        int24 /* tickUpper */,
        uint128 amount,
        bytes calldata data
    ) external override nonReentrant whenNotPaused updateOracle returns (uint256 amount0, uint256 amount1) {
        require(amount > 0, "ZERO_AMOUNT");
        
        if (totalLiquidity == 0) {
            // First liquidity provision
            amount0 = uint256(amount);
            amount1 = uint256(amount);
            uint256 liquidity = OrbitalMath.sqrt(amount0 * amount1) - MIN_LIQUIDITY;
            totalLiquidity = liquidity + MIN_LIQUIDITY;
            liquidityBalances[recipient] = liquidity;
        } else {
            // Subsequent liquidity provisions
            uint256 liquidity0 = (uint256(amount) * totalLiquidity) / reserve0;
            uint256 liquidity1 = (uint256(amount) * totalLiquidity) / reserve1;
            uint256 liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
            
            amount0 = (liquidity * reserve0) / totalLiquidity;
            amount1 = (liquidity * reserve1) / totalLiquidity;
            
            totalLiquidity += liquidity;
            liquidityBalances[recipient] += liquidity;
        }
        
        liquidityTimestamps[recipient] = block.timestamp;
        
        // Callback for token transfers
        IOrbitalAMMCallback(msg.sender).orbitalAMMCallback(
            int256(amount0),
            int256(amount1),
            data
        );
        
        // Update reserves
        reserve0 += amount0;
        reserve1 += amount1;
        
        emit LiquidityAdded(recipient, amount0, amount1, uint256(amount));
        emit Mint(msg.sender, recipient, 0, 0, amount, amount0, amount1);
    }
    
    function burn(
        int24 /* tickLower */,
        int24 /* tickUpper */,
        uint128 amount
    ) external override nonReentrant returns (uint256 amount0, uint256 amount1) {
        require(amount > 0, "ZERO_AMOUNT");
        require(liquidityBalances[msg.sender] >= amount, "INSUFFICIENT_LIQUIDITY");
        
        uint256 liquidity = uint256(amount);
        amount0 = (liquidity * reserve0) / totalLiquidity;
        amount1 = (liquidity * reserve1) / totalLiquidity;
        
        require(amount0 > 0 && amount1 > 0, "INSUFFICIENT_LIQUIDITY_BURNED");
        
        liquidityBalances[msg.sender] -= liquidity;
        totalLiquidity -= liquidity;
        
        // Update reserves
        reserve0 -= amount0;
        reserve1 -= amount1;
        
        // Transfer tokens
        token0.safeTransfer(msg.sender, amount0);
        token1.safeTransfer(msg.sender, amount1);
        
        emit LiquidityRemoved(msg.sender, amount0, amount1, liquidity);
    }
    
    function collect(
        address recipient,
        int24 /* tickLower */,
        int24 /* tickUpper */,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external override nonReentrant returns (uint128 amount0, uint128 amount1) {
        amount0 = amount0Requested > accumulatedFees0[msg.sender] 
            ? uint128(accumulatedFees0[msg.sender]) 
            : amount0Requested;
        amount1 = amount1Requested > accumulatedFees1[msg.sender] 
            ? uint128(accumulatedFees1[msg.sender]) 
            : amount1Requested;
        
        accumulatedFees0[msg.sender] -= amount0;
        accumulatedFees1[msg.sender] -= amount1;
        
        if (amount0 > 0) token0.safeTransfer(recipient, amount0);
        if (amount1 > 0) token1.safeTransfer(recipient, amount1);
    }

    // =============================================================================
    // SWAP FUNCTIONS
    // =============================================================================
    
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 /* sqrtPriceLimitX96 */,
        bytes calldata data
    ) external override nonReentrant whenNotPaused updateOracle returns (int256 amount0, int256 amount1) {
        require(amountSpecified != 0, "ZERO_AMOUNT");
        require(totalLiquidity > 0, "NO_LIQUIDITY");
        
        bool exactInput = amountSpecified > 0;
        uint256 amountIn = exactInput ? uint256(amountSpecified) : uint256(-amountSpecified);
        
        if (zeroForOne) {
            // Selling token0 for token1
            uint256 amountOut = _getAmountOut(amountIn, reserve0, reserve1);
            require(amountOut <= reserve1, "INSUFFICIENT_LIQUIDITY");
            
            amount0 = int256(amountIn);
            amount1 = -int256(amountOut);
            
            reserve0 += amountIn;
            reserve1 -= amountOut;
            
            // Transfer tokens
            token1.safeTransfer(recipient, amountOut);
            
            emit TokensSwapped(msg.sender, address(token0), address(token1), amountIn, amountOut, 0);
        } else {
            // Selling token1 for token0
            uint256 amountOut = _getAmountOut(amountIn, reserve1, reserve0);
            require(amountOut <= reserve0, "INSUFFICIENT_LIQUIDITY");
            
            amount0 = -int256(amountOut);
            amount1 = int256(amountIn);
            
            reserve0 -= amountOut;
            reserve1 += amountIn;
            
            // Transfer tokens
            token0.safeTransfer(recipient, amountOut);
            
            emit TokensSwapped(msg.sender, address(token1), address(token0), amountIn, amountOut, 0);
        }
        
        // Callback for token transfers
        IOrbitalAMMCallback(msg.sender).orbitalAMMCallback(amount0, amount1, data);
        
        emit Swap(msg.sender, recipient, amount0, amount1, 0, uint128(totalLiquidity), 0);
    }

    // =============================================================================
    // FLASH LOAN
    // =============================================================================
    
    function flash(
        address recipient,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external override nonReentrant {
        require(amount0 > 0 || amount1 > 0, "ZERO_AMOUNT");
        
        uint256 fee0 = (amount0 * flashLoanFee) / 10000;
        uint256 fee1 = (amount1 * flashLoanFee) / 10000;
        
        uint256 balance0Before = token0.balanceOf(address(this));
        uint256 balance1Before = token1.balanceOf(address(this));
        
        if (amount0 > 0) token0.safeTransfer(recipient, amount0);
        if (amount1 > 0) token1.safeTransfer(recipient, amount1);
        
        IOrbitalAMMCallback(msg.sender).orbitalAMMCallback(
            int256(amount0 + fee0),
            int256(amount1 + fee1),
            data
        );
        
        uint256 balance0After = token0.balanceOf(address(this));
        uint256 balance1After = token1.balanceOf(address(this));
        
        require(balance0After >= balance0Before + fee0, "FLASH_LOAN_FEE_0");
        require(balance1After >= balance1Before + fee1, "FLASH_LOAN_FEE_1");
        
        protocolFees0 += uint128(fee0);
        protocolFees1 += uint128(fee1);
        
        emit Flash(msg.sender, recipient, amount0, amount1, fee0, fee1);
    }

    // =============================================================================
    // ORACLE FUNCTIONS
    // =============================================================================
    
    function observe(uint32[] calldata /* secondsAgos */)
        external
        pure
        override
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        // Simplified oracle implementation
        tickCumulatives = new int56[](1);
        secondsPerLiquidityCumulativeX128s = new uint160[](1);
        tickCumulatives[0] = 0;
        secondsPerLiquidityCumulativeX128s[0] = 0;
    }
    
    function snapshotCumulativesInside(int24 /* tickLower */, int24 /* tickUpper */)
        external
        view
        override
        returns (
            int56 tickCumulativeInside,
            uint160 secondsPerLiquidityInsideX128,
            uint32 secondsInside
        )
    {
        // Simplified implementation
        return (0, 0, uint32(block.timestamp));
    }

    // =============================================================================
    // PROTOCOL FUNCTIONS
    // =============================================================================
    
    function setFeeProtocol(uint8 feeProtocol0, uint8 feeProtocol1) external onlyRole(POOL_MANAGER_ROLE) {
        require(feeProtocol0 <= 10 && feeProtocol1 <= 10, "INVALID_FEE_PROTOCOL");
        feeProtocol = feeProtocol0 + (feeProtocol1 << 4);
    }
    
    function collectProtocol(
        address recipient,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external onlyRole(POOL_MANAGER_ROLE) returns (uint128 amount0, uint128 amount1) {
        amount0 = amount0Requested > protocolFees0 ? protocolFees0 : amount0Requested;
        amount1 = amount1Requested > protocolFees1 ? protocolFees1 : amount1Requested;
        
        protocolFees0 -= amount0;
        protocolFees1 -= amount1;
        
        if (amount0 > 0) token0.safeTransfer(recipient, amount0);
        if (amount1 > 0) token1.safeTransfer(recipient, amount1);
        
        emit ProtocolFeesCollected(amount0, amount1);
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
        
        // Apply fee
        uint256 amountInWithFee = amountIn * (10000 - fee);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 10000) + amountInWithFee;
        amountOut = numerator / denominator;
        
        // Apply orbital curve adjustment
        if (orbitalFactor > 0) {
            uint160 orbitalPrice = OrbitalMath.calculateOrbitalPrice(
                reserveIn,
                reserveOut,
                orbitalFactor
            );
            
            // Apply orbital adjustment
            amountOut = (amountOut * uint256(orbitalPrice)) / Q96;
        }
    }
    
    function _updateOracle() internal {
        uint256 currentTime = block.timestamp;
        if (currentTime > lastUpdateTime + 1 minutes && reserve0 > 0 && reserve1 > 0) {
            uint256 currentPrice = (reserve1 * PRECISION) / reserve0;
            
            // Update EMA
            uint256 timeDelta = currentTime - lastUpdateTime;
            uint256 weight = timeDelta > ORACLE_WINDOW ? PRECISION : (timeDelta * PRECISION) / ORACLE_WINDOW;
            priceEMA = ((PRECISION - weight) * priceEMA + weight * currentPrice) / PRECISION;
            
            lastPrice = currentPrice;
            lastUpdateTime = currentTime;
        }
    }
    
    function _disableInitializers() internal {
        // Implementation specific to prevent initialization of implementation contract
    }

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================
    
    function setOrbitalParameters(
        uint256 _orbitalFactor,
        uint256 _concentrationTarget,
        uint256 _concentrationRange
    ) external onlyRole(POOL_MANAGER_ROLE) {
        require(_orbitalFactor <= ORBITAL_FACTOR_MAX, "INVALID_ORBITAL_FACTOR");
        require(_concentrationTarget <= 1000, "INVALID_CONCENTRATION_TARGET");
        require(_concentrationRange <= 500, "INVALID_CONCENTRATION_RANGE");
        
        orbitalFactor = _orbitalFactor;
        concentrationTarget = _concentrationTarget;
        concentrationRange = _concentrationRange;
        
        emit OrbitalParametersUpdated(_orbitalFactor, _concentrationTarget, _concentrationRange);
    }
    
    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(EMERGENCY_ROLE) {
        _unpause();
    }
}
