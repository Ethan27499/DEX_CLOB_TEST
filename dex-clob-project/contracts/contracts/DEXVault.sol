// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title DEXVault
 * @dev Multi-asset custody and collateral management for Hybrid DEX
 * @notice Supports deposits, withdrawals, cross-collateral, and margin trading
 */
contract DEXVault is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // =============================================================================
    // ROLES & CONSTANTS
    // =============================================================================
    
    bytes32 public constant VAULT_MANAGER_ROLE = keccak256("VAULT_MANAGER_ROLE");
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    uint256 public constant MIN_HEALTH_FACTOR = 110; // 110% minimum health factor
    uint256 public constant LIQUIDATION_THRESHOLD = 105; // 105% liquidation threshold
    uint256 public constant LIQUIDATION_BONUS = 5; // 5% liquidation bonus
    uint256 public constant PRECISION = 10000; // 100.00%

    // =============================================================================
    // STRUCTS & MAPPINGS
    // =============================================================================
    
    struct TokenInfo {
        bool isSupported;           // Token is supported for vault operations
        uint256 collateralRatio;    // Collateral value ratio (e.g., 8000 = 80%)
        uint256 liquidationRatio;   // Liquidation threshold ratio
        uint256 maxLeverage;        // Maximum leverage allowed (e.g., 300 = 3x)
        address priceFeed;          // Chainlink price feed address
        uint8 decimals;             // Token decimals
    }
    
    struct UserPosition {
        uint256 totalCollateralValue;  // Total collateral value in USD
        uint256 totalBorrowedValue;    // Total borrowed value in USD
        uint256 healthFactor;          // Current health factor
        uint256 maxBorrowCapacity;     // Maximum borrowing capacity
        bool canBeLiquidated;          // Liquidation status
    }
    
    struct AssetBalance {
        uint256 deposited;    // Deposited amount
        uint256 borrowed;     // Borrowed amount
        uint256 available;    // Available for withdrawal
        uint256 locked;       // Locked in trading positions
    }

    // User balances: user => token => balance info
    mapping(address => mapping(address => AssetBalance)) public userBalances;
    
    // Supported tokens configuration
    mapping(address => TokenInfo) public supportedTokens;
    
    // User position tracking
    mapping(address => UserPosition) public userPositions;
    
    // Total vault statistics
    mapping(address => uint256) public totalDeposited;
    mapping(address => uint256) public totalBorrowed;
    mapping(address => uint256) public totalAvailable;

    // Supported token addresses array for iteration
    address[] public supportedTokenList;

    // =============================================================================
    // EVENTS
    // =============================================================================
    
    event Deposit(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 newBalance
    );
    
    event Withdraw(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 newBalance
    );
    
    event Borrow(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 healthFactor
    );
    
    event Repay(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 healthFactor
    );
    
    event Liquidation(
        address indexed liquidator,
        address indexed user,
        address indexed collateralToken,
        address debtToken,
        uint256 debtAmount,
        uint256 collateralAmount
    );
    
    event TokenAdded(
        address indexed token,
        uint256 collateralRatio,
        uint256 liquidationRatio,
        uint256 maxLeverage
    );

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VAULT_MANAGER_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
    }

    // =============================================================================
    // VAULT OPERATIONS
    // =============================================================================
    
    /**
     * @dev Deposit tokens into vault
     * @param token Token address to deposit
     * @param amount Amount to deposit
     */
    function deposit(address token, uint256 amount) 
        external 
        nonReentrant 
        whenNotPaused 
    {
        require(supportedTokens[token].isSupported, "Token not supported");
        require(amount > 0, "Amount must be greater than 0");
        
        // Transfer tokens from user
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        // Update user balance
        userBalances[msg.sender][token].deposited += amount;
        userBalances[msg.sender][token].available += amount;
        
        // Update vault totals
        totalDeposited[token] += amount;
        totalAvailable[token] += amount;
        
        // Update user position
        _updateUserPosition(msg.sender);
        
        emit Deposit(msg.sender, token, amount, userBalances[msg.sender][token].deposited);
    }
    
    /**
     * @dev Withdraw tokens from vault
     * @param token Token address to withdraw
     * @param amount Amount to withdraw
     */
    function withdraw(address token, uint256 amount) 
        external 
        nonReentrant 
        whenNotPaused 
    {
        require(supportedTokens[token].isSupported, "Token not supported");
        require(amount > 0, "Amount must be greater than 0");
        require(userBalances[msg.sender][token].available >= amount, "Insufficient available balance");
        
        // Check if withdrawal maintains healthy position
        UserPosition memory tempPosition = _calculatePositionAfterWithdrawal(msg.sender, token, amount);
        require(tempPosition.healthFactor >= MIN_HEALTH_FACTOR, "Withdrawal would make position unhealthy");
        
        // Update user balance
        userBalances[msg.sender][token].deposited -= amount;
        userBalances[msg.sender][token].available -= amount;
        
        // Update vault totals
        totalDeposited[token] -= amount;
        totalAvailable[token] -= amount;
        
        // Update user position
        _updateUserPosition(msg.sender);
        
        // Transfer tokens to user
        IERC20(token).safeTransfer(msg.sender, amount);
        
        emit Withdraw(msg.sender, token, amount, userBalances[msg.sender][token].deposited);
    }
    
    /**
     * @dev Borrow tokens against collateral
     * @param token Token to borrow
     * @param amount Amount to borrow
     */
    function borrow(address token, uint256 amount) 
        external 
        nonReentrant 
        whenNotPaused 
    {
        require(supportedTokens[token].isSupported, "Token not supported");
        require(amount > 0, "Amount must be greater than 0");
        require(totalAvailable[token] >= amount, "Insufficient vault liquidity");
        
        // Calculate new position after borrow
        UserPosition memory newPosition = _calculatePositionAfterBorrow(msg.sender, token, amount);
        require(newPosition.healthFactor >= MIN_HEALTH_FACTOR, "Borrow would make position unhealthy");
        
        // Update user balance
        userBalances[msg.sender][token].borrowed += amount;
        
        // Update vault totals
        totalBorrowed[token] += amount;
        totalAvailable[token] -= amount;
        
        // Update user position
        _updateUserPosition(msg.sender);
        
        // Transfer borrowed tokens to user
        IERC20(token).safeTransfer(msg.sender, amount);
        
        emit Borrow(msg.sender, token, amount, userPositions[msg.sender].healthFactor);
    }
    
    /**
     * @dev Repay borrowed tokens
     * @param token Token to repay
     * @param amount Amount to repay
     */
    function repay(address token, uint256 amount) 
        external 
        nonReentrant 
        whenNotPaused 
    {
        require(supportedTokens[token].isSupported, "Token not supported");
        require(amount > 0, "Amount must be greater than 0");
        
        uint256 borrowed = userBalances[msg.sender][token].borrowed;
        require(borrowed > 0, "No debt to repay");
        
        // Calculate actual repay amount (cannot repay more than borrowed)
        uint256 repayAmount = amount > borrowed ? borrowed : amount;
        
        // Transfer tokens from user
        IERC20(token).safeTransferFrom(msg.sender, address(this), repayAmount);
        
        // Update user balance
        userBalances[msg.sender][token].borrowed -= repayAmount;
        
        // Update vault totals
        totalBorrowed[token] -= repayAmount;
        totalAvailable[token] += repayAmount;
        
        // Update user position
        _updateUserPosition(msg.sender);
        
        emit Repay(msg.sender, token, repayAmount, userPositions[msg.sender].healthFactor);
    }

    // =============================================================================
    // LIQUIDATION SYSTEM
    // =============================================================================
    
    /**
     * @dev Liquidate unhealthy position
     * @param user User to liquidate
     * @param debtToken Token to repay
     * @param collateralToken Collateral token to seize
     * @param debtAmount Amount of debt to repay
     */
    function liquidate(
        address user,
        address debtToken,
        address collateralToken,
        uint256 debtAmount
    ) external nonReentrant whenNotPaused onlyRole(LIQUIDATOR_ROLE) {
        require(user != msg.sender, "Cannot liquidate self");
        require(supportedTokens[debtToken].isSupported, "Debt token not supported");
        require(supportedTokens[collateralToken].isSupported, "Collateral token not supported");
        
        UserPosition storage position = userPositions[user];
        require(position.canBeLiquidated, "Position cannot be liquidated");
        require(position.healthFactor < LIQUIDATION_THRESHOLD, "Position is healthy");
        
        uint256 userDebt = userBalances[user][debtToken].borrowed;
        require(userDebt > 0, "User has no debt in this token");
        require(debtAmount <= userDebt, "Debt amount exceeds user debt");
        
        uint256 userCollateral = userBalances[user][collateralToken].deposited;
        require(userCollateral > 0, "User has no collateral in this token");
        
        // Calculate collateral to seize (with liquidation bonus)
        uint256 collateralValue = _getTokenValueInUSD(collateralToken, userCollateral);
        uint256 debtValue = _getTokenValueInUSD(debtToken, debtAmount);
        uint256 collateralToSeize = (debtValue * (PRECISION + LIQUIDATION_BONUS)) / PRECISION;
        collateralToSeize = _getTokenAmountFromUSD(collateralToken, collateralToSeize);
        
        require(collateralToSeize <= userCollateral, "Insufficient collateral");
        
        // Transfer debt payment from liquidator
        IERC20(debtToken).safeTransferFrom(msg.sender, address(this), debtAmount);
        
        // Update user balances
        userBalances[user][debtToken].borrowed -= debtAmount;
        userBalances[user][collateralToken].deposited -= collateralToSeize;
        userBalances[user][collateralToken].available -= collateralToSeize;
        
        // Update vault totals
        totalBorrowed[debtToken] -= debtAmount;
        totalAvailable[debtToken] += debtAmount;
        totalDeposited[collateralToken] -= collateralToSeize;
        totalAvailable[collateralToken] -= collateralToSeize;
        
        // Transfer seized collateral to liquidator
        IERC20(collateralToken).safeTransfer(msg.sender, collateralToSeize);
        
        // Update user position
        _updateUserPosition(user);
        
        emit Liquidation(msg.sender, user, collateralToken, debtToken, debtAmount, collateralToSeize);
    }

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================
    
    /**
     * @dev Add supported token
     */
    function addSupportedToken(
        address token,
        uint256 collateralRatio,
        uint256 liquidationRatio,
        uint256 maxLeverage,
        address priceFeed,
        uint8 decimals
    ) external onlyRole(VAULT_MANAGER_ROLE) {
        require(token != address(0), "Invalid token address");
        require(!supportedTokens[token].isSupported, "Token already supported");
        require(collateralRatio <= PRECISION, "Invalid collateral ratio");
        require(liquidationRatio <= PRECISION, "Invalid liquidation ratio");
        
        supportedTokens[token] = TokenInfo({
            isSupported: true,
            collateralRatio: collateralRatio,
            liquidationRatio: liquidationRatio,
            maxLeverage: maxLeverage,
            priceFeed: priceFeed,
            decimals: decimals
        });
        
        supportedTokenList.push(token);
        
        emit TokenAdded(token, collateralRatio, liquidationRatio, maxLeverage);
    }
    
    /**
     * @dev Emergency pause
     */
    function emergencyPause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }
    
    /**
     * @dev Emergency unpause
     */
    function emergencyUnpause() external onlyRole(EMERGENCY_ROLE) {
        _unpause();
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================
    
    /**
     * @dev Get user position details
     */
    function getUserPosition(address user) external view returns (UserPosition memory) {
        return userPositions[user];
    }
    
    /**
     * @dev Get user balance for specific token
     */
    function getUserBalance(address user, address token) external view returns (AssetBalance memory) {
        return userBalances[user][token];
    }
    
    /**
     * @dev Get all supported tokens
     */
    function getSupportedTokens() external view returns (address[] memory) {
        return supportedTokenList;
    }
    
    /**
     * @dev Check if user position can be liquidated
     */
    function canLiquidate(address user) external view returns (bool) {
        return userPositions[user].canBeLiquidated;
    }

    // =============================================================================
    // INTERNAL FUNCTIONS
    // =============================================================================
    
    /**
     * @dev Update user position calculations
     */
    function _updateUserPosition(address user) internal {
        uint256 totalCollateralValue = 0;
        uint256 totalBorrowedValue = 0;
        
        // Calculate total collateral and borrowed values
        for (uint256 i = 0; i < supportedTokenList.length; i++) {
            address token = supportedTokenList[i];
            AssetBalance storage balance = userBalances[user][token];
            
            if (balance.deposited > 0) {
                uint256 collateralValue = _getTokenValueInUSD(token, balance.deposited);
                totalCollateralValue += (collateralValue * supportedTokens[token].collateralRatio) / PRECISION;
            }
            
            if (balance.borrowed > 0) {
                totalBorrowedValue += _getTokenValueInUSD(token, balance.borrowed);
            }
        }
        
        // Calculate health factor
        uint256 healthFactor = totalBorrowedValue > 0 
            ? (totalCollateralValue * PRECISION) / totalBorrowedValue
            : type(uint256).max;
        
        // Update user position
        userPositions[user] = UserPosition({
            totalCollateralValue: totalCollateralValue,
            totalBorrowedValue: totalBorrowedValue,
            healthFactor: healthFactor,
            maxBorrowCapacity: totalCollateralValue,
            canBeLiquidated: healthFactor < LIQUIDATION_THRESHOLD
        });
    }
    
    /**
     * @dev Calculate position after withdrawal
     */
    function _calculatePositionAfterWithdrawal(
        address user, 
        address token, 
        uint256 amount
    ) internal view returns (UserPosition memory) {
        // This is a simplified calculation - in production you'd want more sophisticated logic
        uint256 withdrawValue = _getTokenValueInUSD(token, amount);
        uint256 collateralValue = (withdrawValue * supportedTokens[token].collateralRatio) / PRECISION;
        
        UserPosition memory currentPosition = userPositions[user];
        uint256 newCollateralValue = currentPosition.totalCollateralValue > collateralValue 
            ? currentPosition.totalCollateralValue - collateralValue 
            : 0;
        
        uint256 newHealthFactor = currentPosition.totalBorrowedValue > 0 
            ? (newCollateralValue * PRECISION) / currentPosition.totalBorrowedValue
            : type(uint256).max;
        
        return UserPosition({
            totalCollateralValue: newCollateralValue,
            totalBorrowedValue: currentPosition.totalBorrowedValue,
            healthFactor: newHealthFactor,
            maxBorrowCapacity: newCollateralValue,
            canBeLiquidated: newHealthFactor < LIQUIDATION_THRESHOLD
        });
    }
    
    /**
     * @dev Calculate position after borrow
     */
    function _calculatePositionAfterBorrow(
        address user, 
        address token, 
        uint256 amount
    ) internal view returns (UserPosition memory) {
        uint256 borrowValue = _getTokenValueInUSD(token, amount);
        
        UserPosition memory currentPosition = userPositions[user];
        uint256 newBorrowedValue = currentPosition.totalBorrowedValue + borrowValue;
        
        uint256 newHealthFactor = newBorrowedValue > 0 
            ? (currentPosition.totalCollateralValue * PRECISION) / newBorrowedValue
            : type(uint256).max;
        
        return UserPosition({
            totalCollateralValue: currentPosition.totalCollateralValue,
            totalBorrowedValue: newBorrowedValue,
            healthFactor: newHealthFactor,
            maxBorrowCapacity: currentPosition.maxBorrowCapacity,
            canBeLiquidated: newHealthFactor < LIQUIDATION_THRESHOLD
        });
    }
    
    /**
     * @dev Get token value in USD (mock implementation)
     * @notice In production, this should use Chainlink price feeds
     */
    function _getTokenValueInUSD(address token, uint256 amount) internal view returns (uint256) {
        // Mock prices for testing - replace with actual price feed in production
        if (token == address(0)) return amount * 2000; // ETH = $2000
        return amount; // Assume other tokens = $1 for simplicity
    }
    
    /**
     * @dev Get token amount from USD value (mock implementation)
     */
    function _getTokenAmountFromUSD(address token, uint256 usdValue) internal view returns (uint256) {
        // Mock implementation - replace with actual price feed logic
        if (token == address(0)) return usdValue / 2000; // ETH = $2000
        return usdValue; // Assume other tokens = $1
    }
}
