// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title DepegManager
 * @dev Manages depeg detection and asset isolation for Orbital AMM
 * Implements Paradigm's risk isolation mechanisms
 */
contract DepegManager is Ownable, Pausable {
    
    // ============ Structs ============
    
    struct AssetState {
        uint256 lastPrice;              // Last known good price
        uint256 priceDeviation;         // Current deviation from peg
        uint256 deviationStartTime;     // When deviation began
        uint256 isolationTimestamp;     // When asset was isolated
        bool isIsolated;                // Whether asset is currently isolated
        uint256 violationCount;         // Number of depeg violations
        string lastReason;              // Reason for last isolation
    }
    
    struct DepegConfig {
        uint256 deviationThreshold;     // Maximum allowed deviation (basis points)
        uint256 timeThreshold;          // Time before triggering isolation (seconds)
        uint256 recoveryThreshold;      // Threshold for asset recovery
        uint256 maxViolations;          // Max violations before permanent isolation
        bool autoIsolation;             // Whether to auto-isolate on depeg
    }
    
    // ============ State Variables ============
    
    mapping(address => AssetState) public assetStates;
    mapping(address => DepegConfig) public assetConfigs;
    mapping(address => bool) public authorizedOracles;
    mapping(address => bool) public emergencyOperators;
    
    address[] public monitoredAssets;
    
    // Default configuration
    DepegConfig public defaultConfig = DepegConfig({
        deviationThreshold: 200,        // 2%
        timeThreshold: 300,             // 5 minutes
        recoveryThreshold: 100,         // 1%
        maxViolations: 3,               // 3 violations max
        autoIsolation: true             // Auto-isolate enabled
    });
    
    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant MAX_DEVIATION = 1000; // 10% max
    
    // ============ Events ============
    
    event AssetIsolated(
        address indexed asset,
        uint256 deviation,
        uint256 timestamp,
        string reason
    );
    
    event AssetRestored(
        address indexed asset,
        uint256 timestamp,
        string reason
    );
    
    event DepegDetected(
        address indexed asset,
        uint256 currentPrice,
        uint256 deviation,
        uint256 duration
    );
    
    event ConfigUpdated(
        address indexed asset,
        DepegConfig newConfig
    );
    
    event EmergencyAction(
        address indexed operator,
        address indexed asset,
        string action,
        uint256 timestamp
    );
    
    // ============ Constructor ============
    
    constructor() Ownable(msg.sender) {
        // Initialize empty - assets will be added via configuration
    }
    
    // ============ Depeg Detection ============
    
    /**
     * @dev Check if an asset is depegged and should be isolated
     * @param asset Asset address to check
     * @param currentPrice Current price from oracle
     */
    function checkDepeg(address asset, uint256 currentPrice) external {
        require(authorizedOracles[msg.sender] || msg.sender == owner(), "Unauthorized");
        
        AssetState storage state = assetStates[asset];
        DepegConfig memory config = _getAssetConfig(asset);
        
        uint256 deviation = _calculateDeviation(currentPrice, PRICE_PRECISION);
        
        emit DepegDetected(asset, currentPrice, deviation, 
            block.timestamp - state.deviationStartTime);
        
        if (deviation > config.deviationThreshold) {
            if (state.priceDeviation <= config.deviationThreshold) {
                // First time exceeding threshold
                state.deviationStartTime = block.timestamp;
            }
            
            state.priceDeviation = deviation;
            
            // Check if isolation should be triggered
            uint256 deviationDuration = block.timestamp - state.deviationStartTime;
            
            if (deviationDuration >= config.timeThreshold && 
                config.autoIsolation && 
                !state.isIsolated) {
                
                _isolateAsset(asset, "Persistent price deviation");
            }
            
        } else {
            // Price is back within threshold
            if (state.priceDeviation > config.deviationThreshold) {
                state.deviationStartTime = 0;
                state.priceDeviation = deviation;
            }
        }
        
        state.lastPrice = currentPrice;
    }
    
    /**
     * @dev Manually isolate an asset (emergency function)
     */
    function emergencyIsolate(address asset, string memory reason) 
        external onlyEmergencyOperator {
        
        _isolateAsset(asset, reason);
        
        emit EmergencyAction(msg.sender, asset, "EMERGENCY_ISOLATE", block.timestamp);
    }
    
    /**
     * @dev Attempt to restore an isolated asset
     */
    function restoreAsset(address asset, string memory reason) external onlyOwner {
        AssetState storage state = assetStates[asset];
        require(state.isIsolated, "Asset not isolated");
        
        DepegConfig memory config = _getAssetConfig(asset);
        
        // Check if asset is stable enough for restoration
        require(state.priceDeviation <= config.recoveryThreshold, "Price still unstable");
        require(block.timestamp - state.isolationTimestamp >= 3600, "Isolation too recent"); // 1 hour minimum
        
        state.isIsolated = false;
        state.isolationTimestamp = 0;
        state.deviationStartTime = 0;
        
        emit AssetRestored(asset, block.timestamp, reason);
    }
    
    // ============ Internal Functions ============
    
    function _isolateAsset(address asset, string memory reason) internal {
        AssetState storage state = assetStates[asset];
        
        if (state.isIsolated) return; // Already isolated
        
        state.isIsolated = true;
        state.isolationTimestamp = block.timestamp;
        state.violationCount += 1;
        state.lastReason = reason;
        
        emit AssetIsolated(asset, state.priceDeviation, block.timestamp, reason);
    }
    
    function _calculateDeviation(uint256 price, uint256 target) internal pure returns (uint256) {
        if (price > target) {
            return ((price - target) * 10000) / target;
        } else {
            return ((target - price) * 10000) / target;
        }
    }
    
    function _getAssetConfig(address asset) internal view returns (DepegConfig memory) {
        DepegConfig memory config = assetConfigs[asset];
        
        // Use default config if not set
        if (config.deviationThreshold == 0) {
            return defaultConfig;
        }
        
        return config;
    }
    
    function _addMonitoredAsset(address asset) internal {
        monitoredAssets.push(asset);
        
        // Initialize with default state
        assetStates[asset] = AssetState({
            lastPrice: PRICE_PRECISION,
            priceDeviation: 0,
            deviationStartTime: 0,
            isolationTimestamp: 0,
            isIsolated: false,
            violationCount: 0,
            lastReason: ""
        });
    }
    
    // ============ View Functions ============
    
    function isAssetIsolated(address asset) external view returns (bool) {
        return assetStates[asset].isIsolated;
    }
    
    function getAssetState(address asset) external view returns (AssetState memory) {
        return assetStates[asset];
    }
    
    function getMonitoredAssets() external view returns (address[] memory) {
        return monitoredAssets;
    }
    
    function shouldIsolate(address asset, uint256 currentPrice) external view returns (bool) {
        AssetState memory state = assetStates[asset];
        DepegConfig memory config = _getAssetConfig(asset);
        
        if (state.isIsolated) return false;
        
        uint256 deviation = _calculateDeviation(currentPrice, PRICE_PRECISION);
        
        if (deviation <= config.deviationThreshold) return false;
        
        uint256 deviationDuration = block.timestamp - state.deviationStartTime;
        
        return deviationDuration >= config.timeThreshold && config.autoIsolation;
    }
    
    // ============ Admin Functions ============
    
    function setAssetConfig(address asset, DepegConfig memory config) external onlyOwner {
        require(config.deviationThreshold <= MAX_DEVIATION, "Threshold too high");
        require(config.recoveryThreshold < config.deviationThreshold, "Invalid recovery threshold");
        
        assetConfigs[asset] = config;
        emit ConfigUpdated(asset, config);
    }
    
    function setDefaultConfig(DepegConfig memory config) external onlyOwner {
        require(config.deviationThreshold <= MAX_DEVIATION, "Threshold too high");
        require(config.recoveryThreshold < config.deviationThreshold, "Invalid recovery threshold");
        
        defaultConfig = config;
    }
    
    function addMonitoredAsset(address asset) external onlyOwner {
        _addMonitoredAsset(asset);
    }
    
    function setOracle(address oracle, bool authorized) external onlyOwner {
        authorizedOracles[oracle] = authorized;
    }
    
    function setEmergencyOperator(address operator, bool authorized) external onlyOwner {
        emergencyOperators[operator] = authorized;
    }
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
    
    // ============ Modifiers ============
    
    modifier onlyEmergencyOperator() {
        require(emergencyOperators[msg.sender] || msg.sender == owner(), "Not emergency operator");
        _;
    }
    
    modifier onlyOracle() {
        require(authorizedOracles[msg.sender], "Not authorized oracle");
        _;
    }
    
    // ============ Batch Operations ============

    /**
     * @dev Batch check multiple assets for depeg
     */
    function batchCheckDepeg(address[] memory assets, uint256[] memory prices) external {
        require(authorizedOracles[msg.sender] || msg.sender == owner(), "Unauthorized");
        require(assets.length == prices.length, "Length mismatch");
        
        for (uint256 i = 0; i < assets.length; i++) {
            // Internal batch check logic
            AssetState storage state = assetStates[assets[i]];
            DepegConfig memory config = _getAssetConfig(assets[i]);
            
            uint256 deviation = _calculateDeviation(prices[i], PRICE_PRECISION);
            
            emit DepegDetected(assets[i], prices[i], deviation, 
                block.timestamp - state.deviationStartTime);
            
            if (deviation > config.deviationThreshold) {
                if (state.priceDeviation <= config.deviationThreshold) {
                    state.deviationStartTime = block.timestamp;
                }
                
                state.priceDeviation = deviation;
                
                uint256 deviationDuration = block.timestamp - state.deviationStartTime;
                
                if (deviationDuration >= config.timeThreshold && 
                    config.autoIsolation && 
                    !state.isIsolated) {
                    
                    _isolateAsset(assets[i], "Persistent price deviation");
                }
                
            } else {
                if (state.priceDeviation > config.deviationThreshold) {
                    state.deviationStartTime = 0;
                    state.priceDeviation = deviation;
                }
            }
            
            state.lastPrice = prices[i];
        }
    }
    
    /**
     * @dev Get isolation status for multiple assets
     */
    function batchGetIsolationStatus(address[] memory assets) 
        external view returns (bool[] memory isolated) {
        
        isolated = new bool[](assets.length);
        
        for (uint256 i = 0; i < assets.length; i++) {
            isolated[i] = assetStates[assets[i]].isIsolated;
        }
    }
}
