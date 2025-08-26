// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title OrbitalMath
 * @dev Advanced mathematical operations for Orbital AMM
 */
library OrbitalMath {
    uint256 internal constant Q96 = 0x1000000000000000000000000;
    uint256 internal constant Q128 = 0x100000000000000000000000000000000;
    uint256 internal constant Q192 = Q96 * Q96;
    uint256 internal constant Q224 = Q96 * Q128;
    
    /**
     * @notice Calculates the orbital curve price based on reserves and orbital parameters
     * @param reserveX Reserve of token X
     * @param reserveY Reserve of token Y
     * @param orbitalFactor Orbital curve adjustment factor
     * @return sqrtPriceX96 The sqrt price in Q96 format
     */
    function calculateOrbitalPrice(
        uint256 reserveX,
        uint256 reserveY,
        uint256 orbitalFactor
    ) internal pure returns (uint160 sqrtPriceX96) {
        require(reserveX > 0 && reserveY > 0, "ZERO_RESERVES");
        
        // Enhanced orbital curve: price = (y/x) * orbital_adjustment
        // orbital_adjustment = 1 + sin(orbital_factor * π / 1000) * 0.1
        uint256 basePrice = (reserveY * Q96) / reserveX;
        
        // Approximate sin function for orbital adjustment
        uint256 sinApprox = approximateSin(orbitalFactor);
        uint256 adjustment = Q96 + (sinApprox * Q96) / 10000; // 1% max adjustment
        
        uint256 adjustedPrice = (basePrice * adjustment) / Q96;
        sqrtPriceX96 = uint160(sqrt(adjustedPrice));
    }
    
    /**
     * @notice Calculates liquidity concentration bonus based on price volatility
     * @param currentPrice Current price
     * @param targetPrice Target price for concentration
     * @param concentrationRange Price range for concentration
     * @return bonus Concentration bonus multiplier in Q96
     */
    function calculateConcentrationBonus(
        uint256 currentPrice,
        uint256 targetPrice,
        uint256 concentrationRange
    ) internal pure returns (uint256 bonus) {
        if (concentrationRange == 0) return Q96;
        
        uint256 distance = currentPrice > targetPrice 
            ? currentPrice - targetPrice 
            : targetPrice - currentPrice;
            
        if (distance >= concentrationRange) return Q96;
        
        // Linear bonus: 1x to 2x based on proximity to target
        uint256 proximity = ((concentrationRange - distance) * Q96) / concentrationRange;
        bonus = Q96 + proximity; // 1x + proximity bonus
    }
    
    /**
     * @notice Calculates dynamic fee based on volatility and liquidity
     * @param baseFee Base fee in basis points
     * @param volatility Current volatility factor
     * @param liquidityDepth Current liquidity depth
     * @return dynamicFee Adjusted fee in basis points
     */
    function calculateDynamicFee(
        uint256 baseFee,
        uint256 volatility,
        uint256 liquidityDepth
    ) internal pure returns (uint256 dynamicFee) {
        // Higher volatility = higher fees
        // Higher liquidity = lower fees
        uint256 volatilityAdjustment = (volatility * baseFee) / 10000;
        uint256 liquidityAdjustment = liquidityDepth > 0 
            ? (baseFee * 1000) / (liquidityDepth + 1000)
            : baseFee;
            
        dynamicFee = baseFee + volatilityAdjustment - liquidityAdjustment;
        
        // Cap between 0.01% and 1%
        if (dynamicFee < 1) dynamicFee = 1;
        if (dynamicFee > 10000) dynamicFee = 10000;
    }
    
    /**
     * @notice Calculates impermanent loss protection factor
     * @param initialPriceRatio Initial price ratio when position was created
     * @param currentPriceRatio Current price ratio
     * @param timeHeld Time position has been held
     * @return protectionFactor Factor to reduce impermanent loss (0-100%)
     */
    function calculateILProtection(
        uint256 initialPriceRatio,
        uint256 currentPriceRatio,
        uint256 timeHeld
    ) internal pure returns (uint256 protectionFactor) {
        // Calculate price divergence
        uint256 priceChange = currentPriceRatio > initialPriceRatio
            ? ((currentPriceRatio - initialPriceRatio) * 10000) / initialPriceRatio
            : ((initialPriceRatio - currentPriceRatio) * 10000) / initialPriceRatio;
        
        // Time-based protection: more protection for longer holds
        uint256 timeBonus = timeHeld > 30 days ? 5000 : (timeHeld * 5000) / 30 days; // Up to 50% time bonus
        
        // Base protection inversely related to price change
        uint256 baseProtection = priceChange > 5000 ? 0 : ((5000 - priceChange) * 2000) / 5000; // Up to 20%
        
        protectionFactor = baseProtection + timeBonus;
        if (protectionFactor > 8000) protectionFactor = 8000; // Max 80% protection
    }
    
    /**
     * @notice Approximate sine function for orbital calculations
     * @param x Input value (0-1000 representing 0-π)
     * @return Sine approximation scaled by 10000
     */
    function approximateSin(uint256 x) internal pure returns (uint256) {
        // Taylor series approximation: sin(x) ≈ x - x³/6 + x⁵/120
        if (x > 1000) x = 1000;
        
        uint256 x_scaled = (x * 314159) / 100000; // Convert to radians * 10000
        uint256 x3 = (x_scaled * x_scaled * x_scaled) / (10000 * 10000);
        uint256 x5 = (x3 * x_scaled * x_scaled) / (10000 * 10000);
        
        uint256 result = x_scaled - x3 / 6 + x5 / 120;
        return result > 10000 ? 10000 : result;
    }
    
    /**
     * @notice Calculate square root using Babylonian method
     * @param x Input value
     * @return Square root of x
     */
    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        
        return y;
    }
    
    /**
     * @notice Safe addition that checks for overflow
     */
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, "ADD_OVERFLOW");
        return c;
    }
    
    /**
     * @notice Safe subtraction that checks for underflow
     */
    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b <= a, "SUB_UNDERFLOW");
        return a - b;
    }
    
    /**
     * @notice Safe multiplication that checks for overflow
     */
    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0) return 0;
        uint256 c = a * b;
        require(c / a == b, "MUL_OVERFLOW");
        return c;
    }
    
    /**
     * @notice Safe division that checks for division by zero
     */
    function div(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b > 0, "DIV_BY_ZERO");
        return a / b;
    }
    
    /**
     * @notice Convert int256 to int128 safely
     */
    function toInt128(int256 x) internal pure returns (int128) {
        require(x >= type(int128).min && x <= type(int128).max, "INT128_OVERFLOW");
        return int128(x);
    }
    
    /**
     * @notice Convert uint256 to int256 safely
     */
    function toInt256(uint256 x) internal pure returns (int256) {
        require(x <= uint256(type(int256).max), "INT256_OVERFLOW");
        return int256(x);
    }
    
    /**
     * @notice Absolute value of int256
     */
    function abs(int256 x) internal pure returns (uint256) {
        return uint256(x >= 0 ? x : -x);
    }
}
