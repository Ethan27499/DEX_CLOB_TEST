// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title Enhanced Orbital Math Library for 1000+ Token Pools
 * @dev Implements Paradigm's Orbital AMM mathematics for massive multi-asset pools
 * Based on "Orbital" paper by Paradigm (June 2025)
 */
library EnhancedOrbitalMath {
    using SafeMath for uint256;

    uint256 constant PRECISION = 1e18;
    uint256 constant MAX_TOKENS = 10000; // Paradigm's limit
    
    // ============ Core Paradigm Orbital Structs ============
    
    struct OrbitalState {
        uint256 sumReserves;           // Σxᵢ for constant time computation
        uint256 sumSquaredReserves;    // Σxᵢ² for invariant calculation
        uint256 interiorRadius;        // rInt for consolidated interior ticks
        uint256 boundaryRadius;        // rBound for consolidated boundary ticks  
        uint256 boundaryConstant;      // kBound for boundary plane
        uint256 equalPriceProjection;  // α for position on v⃗ axis
        uint256 tokenCount;            // n for dimensional calculations
        bool hasInteriorTicks;         // Whether any ticks are interior
        bool hasBoundaryTicks;         // Whether any ticks are boundary
    }
    
    struct TickPosition {
        uint256 radius;                // Individual tick radius
        uint256 planeConstant;         // k value for this tick's boundary
        bool isInterior;               // Interior vs boundary status
        uint256 normalizedProjection;  // αnorm for tick comparison
        uint256 liquidityWeight;       // Liquidity contribution weight
    }
    
    struct TradeParams {
        uint256 tokenInIndex;          // Index of input token
        uint256 tokenOutIndex;         // Index of output token  
        uint256 amountIn;              // Input amount
        uint256 currentReserveIn;      // Current reserve of input token
        uint256 currentReserveOut;     // Current reserve of output token
    }
    
    // ============ Core Orbital Invariant (Paradigm Formula) ============
    
    /**
     * @dev Calculate the global orbital invariant for consolidated ticks
     * Based on Paradigm's torus equation: rInt² = (αtotal - kbound - rInt/n)² + (||wtotal|| - sboundary)²
     */
    function calculateGlobalInvariant(
        OrbitalState memory state
    ) internal pure returns (uint256) {
        if (!state.hasInteriorTicks) {
            return calculateBoundaryInvariant(state);
        }
        
        if (!state.hasBoundaryTicks) {
            return calculateSphereInvariant(state);
        }
        
        // Combined torus invariant (main Paradigm formula)
        uint256 alphaComponent = (
            state.equalPriceProjection
            .sub(state.boundaryConstant)
            .sub(state.interiorRadius.div(state.tokenCount))
        ) ** 2;
        
        uint256 orthogonalComponent = calculateOrthogonalMagnitude(state);
        uint256 boundaryRadius = calculateBoundaryRadius(state);
        
        if (orthogonalComponent >= boundaryRadius) {
            orthogonalComponent = orthogonalComponent.sub(boundaryRadius);
        } else {
            orthogonalComponent = 0;
        }
        
        return alphaComponent.add(orthogonalComponent ** 2);
    }
    
    /**
     * @dev Calculate ||w⃗total|| - magnitude of orthogonal component
     * Uses Paradigm's formula: ||wtotal|| = ||xtotal - (xtotal⋅v⃗)v⃗||
     */
    function calculateOrthogonalMagnitude(
        OrbitalState memory state
    ) internal pure returns (uint256) {
        // ||x⃗total - αtotal * v⃗||² = Σxᵢ² - (Σxᵢ)²/n
        uint256 totalVariance = state.sumSquaredReserves.sub(
            state.sumReserves.mul(state.sumReserves).div(state.tokenCount)
        );
        
        return sqrt(totalVariance);
    }
    
    /**
     * @dev Calculate boundary radius for consolidated boundary ticks
     * sboundary = √(rboundary² - (kbound - rboundary/n)²)
     */
    function calculateBoundaryRadius(
        OrbitalState memory state
    ) internal pure returns (uint256) {
        if (!state.hasBoundaryTicks) return 0;
        
        uint256 centerOffset = state.boundaryConstant.sub(
            state.boundaryRadius.div(state.tokenCount)
        );
        
        uint256 radiusSquared = state.boundaryRadius ** 2;
        uint256 offsetSquared = centerOffset ** 2;
        
        if (radiusSquared >= offsetSquared) {
            return sqrt(radiusSquared.sub(offsetSquared));
        }
        
        return 0;
    }
    
    // ============ Tick Consolidation (Key Paradigm Innovation) ============
    
    /**
     * @dev Consolidate multiple ticks into interior/boundary categories
     * Based on Paradigm's insight: similar ticks can be treated as single entities
     */
    function consolidateTicks(
        TickPosition[] memory ticks,
        uint256 globalAlphaNorm
    ) internal pure returns (uint256 interiorRadius, uint256 boundaryRadius, uint256 boundaryK) {
        interiorRadius = 0;
        boundaryRadius = 0;
        boundaryK = 0;
        
        for (uint256 i = 0; i < ticks.length; i++) {
            // Determine if tick is interior or boundary
            bool isInterior = ticks[i].normalizedProjection > globalAlphaNorm;
            
            if (isInterior) {
                // Consolidate interior ticks: rinterior = ra + rb + ...
                interiorRadius = interiorRadius.add(
                    ticks[i].radius.mul(ticks[i].liquidityWeight).div(PRECISION)
                );
            } else {
                // Consolidate boundary ticks  
                boundaryRadius = boundaryRadius.add(
                    ticks[i].radius.mul(ticks[i].liquidityWeight).div(PRECISION)
                );
                boundaryK = boundaryK.add(
                    ticks[i].planeConstant.mul(ticks[i].liquidityWeight).div(PRECISION)
                );
            }
        }
    }
    
    // ============ Constant Time Trading (Paradigm's Core Optimization) ============
    
    /**
     * @dev Execute swap using consolidated orbital invariant
     * Complexity: O(1) regardless of number of tokens (per Paradigm paper)
     */
    function calculateSwapOutput(
        OrbitalState memory stateBefore,
        TradeParams memory trade
    ) internal pure returns (uint256 amountOut, OrbitalState memory stateAfter) {
        
        // Update sums for constant-time calculation
        stateAfter = stateBefore;
        stateAfter.sumReserves = stateBefore.sumReserves.add(trade.amountIn);
        
        // Calculate new reserve of input token
        uint256 newReserveIn = trade.currentReserveIn.add(trade.amountIn);
        
        // Solve for output amount using quartic equation (Paradigm's method)
        amountOut = solveQuarticForOutput(
            stateAfter,
            trade.tokenOutIndex,
            trade.currentReserveOut,
            newReserveIn.sub(trade.currentReserveIn)
        );
        
        // Update output reserve and sums
        uint256 newReserveOut = trade.currentReserveOut.sub(amountOut);
        stateAfter.sumReserves = stateAfter.sumReserves.sub(amountOut);
        
        // Update squared sums (only 2 terms change regardless of n)
        stateAfter.sumSquaredReserves = stateBefore.sumSquaredReserves
            .sub(trade.currentReserveIn ** 2)
            .add(newReserveIn ** 2)
            .sub(trade.currentReserveOut ** 2)
            .add(newReserveOut ** 2);
            
        // Update equal price projection
        stateAfter.equalPriceProjection = stateAfter.sumReserves.div(stateAfter.tokenCount);
    }
    
    /**
     * @dev Solve quartic equation for swap output using Newton's method
     * Based on Paradigm's formula for preserving global invariant
     */
    function solveQuarticForOutput(
        OrbitalState memory state,
        uint256, // tokenOutIndex - unused in current implementation
        uint256 currentReserveOut,
        uint256 deltaReserveIn
    ) internal pure returns (uint256) {
        // Newton's method for solving quartic
        uint256 x = currentReserveOut.div(2); // Initial guess
        uint256 invariant = calculateGlobalInvariant(state);
        
        for (uint256 i = 0; i < 10; i++) { // Max 10 iterations
            uint256 fx = evaluateQuartic(state, x, currentReserveOut, deltaReserveIn, invariant);
            uint256 fpx = evaluateQuarticDerivative(state, x, currentReserveOut, deltaReserveIn);
            
            if (fpx == 0) break;
            
            uint256 newX = x.sub(fx.mul(PRECISION).div(fpx));
            
            if (newX >= x && newX.sub(x) < PRECISION.div(1e6)) break;
            if (x > newX && x.sub(newX) < PRECISION.div(1e6)) break;
            
            x = newX;
        }
        
        return currentReserveOut.sub(x);
    }
    
    /**
     * @dev Evaluate quartic equation F(x) for Newton's method
     */
    function evaluateQuartic(
        OrbitalState memory state,
        uint256 x,
        uint256 currentOut,
        uint256 deltaIn,
        uint256 targetInvariant
    ) internal pure returns (uint256) {
        // Simplified version - full implementation would use complete torus equation
        OrbitalState memory testState = state;
        testState.sumReserves = state.sumReserves.add(deltaIn).sub(currentOut.sub(x));
        
        uint256 actualInvariant = calculateGlobalInvariant(testState);
        
        if (actualInvariant >= targetInvariant) {
            return actualInvariant.sub(targetInvariant);
        } else {
            return targetInvariant.sub(actualInvariant);
        }
    }
    
    /**
     * @dev Evaluate quartic derivative F'(x) for Newton's method
     */
    function evaluateQuarticDerivative(
        OrbitalState memory state,
        uint256 x,
        uint256 currentOut,
        uint256 deltaIn
    ) internal pure returns (uint256) {
        // Numerical derivative approximation
        uint256 h = PRECISION.div(1e6);
        uint256 fxh = evaluateQuartic(state, x.add(h), currentOut, deltaIn, 0);
        uint256 fx = evaluateQuartic(state, x, currentOut, deltaIn, 0);
        
        return fxh.sub(fx).mul(PRECISION).div(h);
    }
    
    // ============ Trade Segmentation for Tick Boundary Crossing ============
    
    /**
     * @dev Check if trade crosses tick boundaries and segment if needed
     * Based on Paradigm's boundary crossing detection algorithm
     */
    function checkAndSegmentTrade(
        OrbitalState memory state,
        TickPosition[] memory ticks,
        TradeParams memory trade
    ) internal pure returns (
        bool needsSegmentation,
        uint256 segmentAmount,
        uint256 crossingBoundary
    ) {
        // Calculate potential final state
        OrbitalState memory potentialState = state;
        potentialState.sumReserves = state.sumReserves.add(trade.amountIn);
        potentialState.equalPriceProjection = potentialState.sumReserves.div(state.tokenCount);
        
        // Find boundary crossings
        uint256 kIntMin = findMinInteriorBoundary(ticks, state.equalPriceProjection);
        uint256 kBoundMax = findMaxBoundaryBoundary(ticks, state.equalPriceProjection);
        
        uint256 newAlphaNorm = potentialState.equalPriceProjection;
        
        needsSegmentation = (newAlphaNorm > kIntMin) || (newAlphaNorm < kBoundMax);
        
        if (needsSegmentation) {
            if (newAlphaNorm > kIntMin) {
                crossingBoundary = kIntMin;
            } else {
                crossingBoundary = kBoundMax;
            }
            
            // Calculate trade amount to reach boundary exactly
            segmentAmount = calculateTradeToReachBoundary(
                state,
                trade,
                crossingBoundary
            );
        }
    }
    
    // ============ Utility Functions ============
    
    function calculateSphereInvariant(OrbitalState memory state) internal pure returns (uint256) {
        return state.interiorRadius ** 2;
    }
    
    function calculateBoundaryInvariant(OrbitalState memory state) internal pure returns (uint256) {
        return calculateBoundaryRadius(state) ** 2;
    }
    
    function findMinInteriorBoundary(
        TickPosition[] memory ticks,
        uint256 // currentAlpha - unused in current implementation
    ) internal pure returns (uint256 minBoundary) {
        minBoundary = type(uint256).max;
        
        for (uint256 i = 0; i < ticks.length; i++) {
            if (ticks[i].isInterior && ticks[i].normalizedProjection < minBoundary) {
                minBoundary = ticks[i].normalizedProjection;
            }
        }
    }
    
    function findMaxBoundaryBoundary(
        TickPosition[] memory ticks,
        uint256 // currentAlpha - unused in current implementation
    ) internal pure returns (uint256 maxBoundary) {
        maxBoundary = 0;
        
        for (uint256 i = 0; i < ticks.length; i++) {
            if (!ticks[i].isInterior && ticks[i].normalizedProjection > maxBoundary) {
                maxBoundary = ticks[i].normalizedProjection;
            }
        }
    }
    
    function calculateTradeToReachBoundary(
        OrbitalState memory state,
        TradeParams memory, // trade - unused in current implementation
        uint256 targetBoundary
    ) internal pure returns (uint256) {
        // Solve for trade amount that reaches exact boundary
        uint256 targetSum = targetBoundary.mul(state.tokenCount);
        uint256 currentSum = state.sumReserves;
        
        if (targetSum > currentSum) {
            return targetSum.sub(currentSum);
        } else {
            return currentSum.sub(targetSum);
        }
    }
    
    /**
     * @dev Safe square root function
     */
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}

/**
 * @dev Safe math library for arithmetic operations
 */
library SafeMath {
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, "SafeMath: addition overflow");
        return c;
    }

    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b <= a, "SafeMath: subtraction overflow");
        return a - b;
    }

    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0) return 0;
        uint256 c = a * b;
        require(c / a == b, "SafeMath: multiplication overflow");
        return c;
    }

    function div(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b > 0, "SafeMath: division by zero");
        return a / b;
    }
}
