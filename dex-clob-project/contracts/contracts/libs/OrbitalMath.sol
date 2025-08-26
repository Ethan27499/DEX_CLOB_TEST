// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title OrbitalMath
 * @dev Mathematical library for Orbital AMM calculations
 * Implements Paradigm's multi-asset invariant formulas
 */
library OrbitalMath {
    uint256 private constant PRECISION = 1e18;
    uint256 private constant MIN_WEIGHT = 1e16; // 1%
    uint256 private constant MAX_WEIGHT = 98e16; // 98%

    /**
     * @dev Calculate multi-asset invariant: k = Π(xi^wi)
     * Where xi = reserve of token i, wi = weight of token i
     */
    function calculateInvariant(
        uint256[] memory reserves,
        uint256[] memory weights
    ) internal pure returns (uint256) {
        require(reserves.length == weights.length, "Length mismatch");
        
        uint256 invariant = PRECISION;
        
        for (uint256 i = 0; i < reserves.length; i++) {
            if (reserves[i] > 0) {
                // Use logarithmic approach for numerical stability
                uint256 contribution = _pow(reserves[i], weights[i]);
                invariant = (invariant * contribution) / PRECISION;
            }
        }
        
        return invariant;
    }

    /**
     * @dev Calculate optimal swap amount using Orbital formula
     * Implements enhanced constant product with amplification
     */
    function calculateSwapAmount(
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 weightIn,
        uint256 weightOut,
        uint256 amountIn,
        uint256 feeRate,
        uint256 amplification
    ) internal pure returns (uint256) {
        require(reserveIn > 0 && reserveOut > 0, "Invalid reserves");
        require(weightIn > 0 && weightOut > 0, "Invalid weights");
        
        // Apply fee to input amount
        uint256 adjustedAmountIn = (amountIn * (10000 - feeRate)) / 10000;
        
        // Calculate new reserve after adding input
        uint256 newReserveIn = reserveIn + adjustedAmountIn;
        
        // Apply amplification for stablecoin stability
        uint256 ampFactor = _calculateAmplificationFactor(
            reserveIn,
            reserveOut,
            amplification
        );
        
        // Enhanced Orbital formula with amplification
        // amountOut = reserveOut * (1 - (reserveIn / newReserveIn)^(weightIn/weightOut * ampFactor))
        uint256 ratio = (reserveIn * PRECISION) / newReserveIn;
        uint256 weightRatio = (weightIn * PRECISION) / weightOut;
        uint256 adjustedWeightRatio = (weightRatio * ampFactor) / PRECISION;
        
        uint256 powResult = _pow(ratio, adjustedWeightRatio);
        uint256 amountOut = (reserveOut * (PRECISION - powResult)) / PRECISION;
        
        return amountOut;
    }

    /**
     * @dev Calculate LP tokens for initial liquidity provision
     */
    function calculateInitialLP(
        uint256[] memory amounts,
        uint256[] memory weights
    ) internal pure returns (uint256) {
        require(amounts.length == weights.length, "Length mismatch");
        
        uint256 lpTokens = 0;
        
        for (uint256 i = 0; i < amounts.length; i++) {
            // Weight-adjusted contribution
            uint256 contribution = (amounts[i] * weights[i]) / PRECISION;
            lpTokens += contribution;
        }
        
        return lpTokens;
    }

    /**
     * @dev Calculate LP tokens for subsequent liquidity additions
     */
    function calculateLPTokens(
        uint256[] memory amounts,
        uint256[] memory reserves,
        uint256 totalSupply,
        uint256[] memory weights
    ) internal pure returns (uint256) {
        require(amounts.length == reserves.length, "Length mismatch");
        require(reserves.length == weights.length, "Weights mismatch");
        require(totalSupply > 0, "No existing supply");
        
        uint256 lpTokens = type(uint256).max;
        
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] > 0 && reserves[i] > 0) {
                // Calculate proportional LP tokens for this asset
                uint256 tokenLP = (amounts[i] * totalSupply) / reserves[i];
                
                // Take minimum to ensure proportional addition
                if (tokenLP < lpTokens) {
                    lpTokens = tokenLP;
                }
            }
        }
        
        require(lpTokens != type(uint256).max, "Invalid amounts");
        return lpTokens;
    }

    /**
     * @dev Calculate price impact of a swap
     */
    function calculatePriceImpact(
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 amountIn,
        uint256 amountOut
    ) internal pure returns (uint256) {
        // Expected price without slippage
        uint256 expectedPrice = (reserveOut * PRECISION) / reserveIn;
        
        // Actual price with slippage
        uint256 actualPrice = (amountOut * PRECISION) / amountIn;
        
        // Price impact in basis points
        if (expectedPrice > actualPrice) {
            return ((expectedPrice - actualPrice) * 10000) / expectedPrice;
        } else {
            return 0;
        }
    }

    /**
     * @dev Calculate amplification factor for stablecoin stability
     * Higher amplification = more resistance to price changes
     */
    function _calculateAmplificationFactor(
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 amplification
    ) private pure returns (uint256) {
        // Balance ratio - closer to 1:1 = higher amplification effect
        uint256 balanceRatio = reserveIn > reserveOut ? 
            (reserveOut * PRECISION) / reserveIn : 
            (reserveIn * PRECISION) / reserveOut;
        
        // Apply amplification based on balance ratio
        // When pools are balanced (ratio ~1), use full amplification
        // When unbalanced, reduce amplification
        uint256 ampFactor = PRECISION + ((amplification * balanceRatio) / PRECISION);
        
        return ampFactor;
    }

    /**
     * @dev Power function implementation using binary exponentiation
     * Calculates base^exp with 18 decimal precision
     */
    function _pow(uint256 base, uint256 exp) private pure returns (uint256) {
        if (exp == 0) return PRECISION;
        if (base == 0) return 0;
        if (base == PRECISION) return PRECISION;
        
        // Convert to fixed point and use logarithmic approach for better precision
        uint256 result = PRECISION;
        uint256 baseTemp = base;
        uint256 expTemp = exp;
        
        while (expTemp > 0) {
            if (expTemp & 1 == 1) {
                result = (result * baseTemp) / PRECISION;
            }
            baseTemp = (baseTemp * baseTemp) / PRECISION;
            expTemp >>= 1;
        }
        
        return result;
    }

    /**
     * @dev Calculate withdrawal amounts for LP token burning
     */
    function calculateWithdrawal(
        uint256 lpTokens,
        uint256 totalSupply,
        uint256[] memory reserves
    ) internal pure returns (uint256[] memory amounts) {
        require(lpTokens <= totalSupply, "Insufficient LP supply");
        
        amounts = new uint256[](reserves.length);
        
        for (uint256 i = 0; i < reserves.length; i++) {
            amounts[i] = (reserves[i] * lpTokens) / totalSupply;
        }
        
        return amounts;
    }

    /**
     * @dev Validate pool configuration
     */
    function validatePoolConfig(
        uint256[] memory weights,
        uint256 amplification
    ) internal pure returns (bool) {
        require(weights.length >= 2, "Need at least 2 tokens");
        
        uint256 totalWeight = 0;
        for (uint256 i = 0; i < weights.length; i++) {
            require(weights[i] >= MIN_WEIGHT, "Weight too small");
            require(weights[i] <= MAX_WEIGHT, "Weight too large");
            totalWeight += weights[i];
        }
        
        require(totalWeight == PRECISION, "Weights must sum to 1e18");
        require(amplification >= 1 && amplification <= 10000, "Invalid amplification");
        
        return true;
    }

    /**
     * @dev Calculate optimal arbitrage amount
     * Used for rebalancing pools after large trades
     */
    function calculateArbitrageAmount(
        uint256[] memory reserves,
        uint256[] memory weights,
        uint256[] memory targetPrices
    ) internal pure returns (uint256[] memory adjustments) {
        require(reserves.length == weights.length, "Length mismatch");
        require(weights.length == targetPrices.length, "Target prices mismatch");
        
        adjustments = new uint256[](reserves.length);
        
        // Calculate current implied prices
        for (uint256 i = 0; i < reserves.length - 1; i++) {
            for (uint256 j = i + 1; j < reserves.length; j++) {
                uint256 currentPrice = (reserves[j] * weights[i]) / (reserves[i] * weights[j]);
                uint256 targetPrice = (targetPrices[j] * PRECISION) / targetPrices[i];
                
                if (currentPrice != targetPrice) {
                    // Calculate required adjustment
                    uint256 adjustment = currentPrice > targetPrice ?
                        currentPrice - targetPrice :
                        targetPrice - currentPrice;
                    
                    adjustments[i] += adjustment;
                    adjustments[j] += adjustment;
                }
            }
        }
        
        return adjustments;
    }
}
