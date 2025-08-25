// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title LiquidityPool
 * @dev AMM Liquidity Pool for Hybrid DEX with LP token management
 * @notice Constant product AMM (x * y = k) with yield farming capabilities
 */
contract LiquidityPool is ERC20, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // =============================================================================
    // ROLES & CONSTANTS
    // =============================================================================
    
    bytes32 public constant POOL_MANAGER_ROLE = keccak256("POOL_MANAGER_ROLE");
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    uint256 public constant MINIMUM_LIQUIDITY = 10**3;
    uint256 public constant FEE_DENOMINATOR = 10000; // 100.00%
    uint256 public constant MAX_FEE = 100; // 1.00% maximum fee

    // =============================================================================
    // STATE VARIABLES
    // =============================================================================
    
    address public immutable token0;
    address public immutable token1;
    
    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;
    
    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;
    uint256 public kLast; // reserve0 * reserve1, as of immediately after the most recent liquidity event
    
    // Fee configuration
    uint256 public tradingFee = 30; // 0.30% default trading fee
    uint256 public protocolFee = 5; // 0.05% protocol fee
    address public feeRecipient;
    
    // LP rewards
    uint256 public totalRewards;
    uint256 public rewardPerTokenStored;
    uint256 public lastUpdateTime;
    uint256 public rewardRate; // Rewards per second
    
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    
    // Pool statistics
    uint256 public totalVolume;
    uint256 public totalFees;
    uint256 public dailyVolume;
    uint256 public lastDayTimestamp;

    // =============================================================================
    // EVENTS
    // =============================================================================
    
    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardAdded(uint256 reward);

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================
    
    constructor(
        address _token0,
        address _token1,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) {
        require(_token0 != address(0) && _token1 != address(0), "Invalid token addresses");
        require(_token0 != _token1, "Identical token addresses");
        
        token0 = _token0;
        token1 = _token1;
        feeRecipient = msg.sender;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(POOL_MANAGER_ROLE, msg.sender);
        _grantRole(FEE_MANAGER_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
    }

    // =============================================================================
    // MODIFIERS
    // =============================================================================
    
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    // =============================================================================
    // LIQUIDITY PROVISION
    // =============================================================================
    
    /**
     * @dev Add liquidity to the pool
     * @param amount0Desired Desired amount of token0
     * @param amount1Desired Desired amount of token1
     * @param amount0Min Minimum amount of token0
     * @param amount1Min Minimum amount of token1
     * @param to Recipient of LP tokens
     * @param deadline Transaction deadline
     */
    function addLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline
    ) external nonReentrant whenNotPaused updateReward(to) returns (uint256 liquidity) {
        require(deadline >= block.timestamp, "Transaction expired");
        require(to != address(0), "Invalid recipient");
        
        (uint256 amount0, uint256 amount1) = _addLiquidity(
            amount0Desired,
            amount1Desired,
            amount0Min,
            amount1Min
        );
        
        liquidity = mint(to, amount0, amount1);
    }
    
    /**
     * @dev Remove liquidity from the pool
     * @param liquidity Amount of LP tokens to burn
     * @param amount0Min Minimum amount of token0 to receive
     * @param amount1Min Minimum amount of token1 to receive
     * @param to Recipient of tokens
     * @param deadline Transaction deadline
     */
    function removeLiquidity(
        uint256 liquidity,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline
    ) external nonReentrant whenNotPaused updateReward(msg.sender) returns (uint256 amount0, uint256 amount1) {
        require(deadline >= block.timestamp, "Transaction expired");
        require(to != address(0), "Invalid recipient");
        
        (amount0, amount1) = burn(to, liquidity);
        require(amount0 >= amount0Min, "Insufficient token0 amount");
        require(amount1 >= amount1Min, "Insufficient token1 amount");
    }

    // =============================================================================
    // TRADING (AMM)
    // =============================================================================
    
    /**
     * @dev Swap tokens using AMM
     * @param amount0Out Amount of token0 to receive
     * @param amount1Out Amount of token1 to receive
     * @param to Recipient of output tokens
     * @param data Callback data
     */
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) 
        external 
        nonReentrant 
        whenNotPaused 
    {
        require(amount0Out > 0 || amount1Out > 0, "Insufficient output amount");
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        require(amount0Out < _reserve0 && amount1Out < _reserve1, "Insufficient liquidity");

        uint256 balance0;
        uint256 balance1;
        {
            address _token0 = token0;
            address _token1 = token1;
            require(to != _token0 && to != _token1, "Invalid recipient");
            
            if (amount0Out > 0) IERC20(_token0).safeTransfer(to, amount0Out);
            if (amount1Out > 0) IERC20(_token1).safeTransfer(to, amount1Out);
            
            balance0 = IERC20(_token0).balanceOf(address(this));
            balance1 = IERC20(_token1).balanceOf(address(this));
        }
        
        uint256 amount0In = balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        uint256 amount1In = balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, "Insufficient input amount");
        
        {
            // Apply trading fee
            uint256 balance0Adjusted = balance0 * 1000 - amount0In * tradingFee / 10;
            uint256 balance1Adjusted = balance1 * 1000 - amount1In * tradingFee / 10;
            require(balance0Adjusted * balance1Adjusted >= uint256(_reserve0) * _reserve1 * 1000**2, "K");
        }

        _update(balance0, balance1, _reserve0, _reserve1);
        
        // Update volume and fees
        uint256 swapVolume = amount0In > 0 
            ? _getTokenValueInUSD(token0, amount0In)
            : _getTokenValueInUSD(token1, amount1In);
        
        _updateVolume(swapVolume);
        
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }
    
    /**
     * @dev Get amount out for exact amount in
     * @param amountIn Input amount
     * @param reserveIn Input token reserve
     * @param reserveOut Output token reserve
     */
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public
        view
        returns (uint256 amountOut)
    {
        require(amountIn > 0, "Insufficient input amount");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");
        
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - tradingFee);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
        amountOut = numerator / denominator;
    }
    
    /**
     * @dev Get amount in for exact amount out
     * @param amountOut Output amount
     * @param reserveIn Input token reserve
     * @param reserveOut Output token reserve
     */
    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        public
        view
        returns (uint256 amountIn)
    {
        require(amountOut > 0, "Insufficient output amount");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");
        
        uint256 numerator = reserveIn * amountOut * FEE_DENOMINATOR;
        uint256 denominator = (reserveOut - amountOut) * (FEE_DENOMINATOR - tradingFee);
        amountIn = (numerator / denominator) + 1;
    }

    // =============================================================================
    // YIELD FARMING
    // =============================================================================
    
    /**
     * @dev Claim earned rewards
     */
    function getReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            // In production, this would transfer reward tokens
            // For now, we'll just emit event
            emit RewardPaid(msg.sender, reward);
        }
    }
    
    /**
     * @dev Add rewards to the pool
     * @param reward Amount of rewards to add
     * @param duration Duration of reward distribution
     */
    function addReward(uint256 reward, uint256 duration) 
        external 
        onlyRole(POOL_MANAGER_ROLE) 
        updateReward(address(0)) 
    {
        require(duration > 0, "Invalid duration");
        
        if (block.timestamp >= lastUpdateTime) {
            rewardRate = reward / duration;
        } else {
            uint256 remaining = lastUpdateTime - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (reward + leftover) / duration;
        }
        
        lastUpdateTime = block.timestamp + duration;
        totalRewards += reward;
        
        emit RewardAdded(reward);
    }

    // =============================================================================
    // INTERNAL FUNCTIONS
    // =============================================================================
    
    /**
     * @dev Mint LP tokens
     */
    function mint(address to, uint256 amount0, uint256 amount1) internal returns (uint256 liquidity) {
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        
        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1);
        
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        
        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            liquidity = _sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(address(0), MINIMUM_LIQUIDITY); // permanently lock the first MINIMUM_LIQUIDITY tokens
        } else {
            liquidity = _min(amount0 * _totalSupply / _reserve0, amount1 * _totalSupply / _reserve1);
        }
        
        require(liquidity > 0, "Insufficient liquidity minted");
        _mint(to, liquidity);

        _update(balance0, balance1, _reserve0, _reserve1);
        emit Mint(msg.sender, amount0, amount1);
    }
    
    /**
     * @dev Burn LP tokens
     */
    function burn(address to, uint256 liquidity) internal returns (uint256 amount0, uint256 amount1) {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        
        uint256 _totalSupply = totalSupply();
        amount0 = liquidity * balance0 / _totalSupply;
        amount1 = liquidity * balance1 / _totalSupply;
        
        require(amount0 > 0 && amount1 > 0, "Insufficient liquidity burned");
        
        _burn(msg.sender, liquidity);
        IERC20(token0).safeTransfer(to, amount0);
        IERC20(token1).safeTransfer(to, amount1);
        
        balance0 = IERC20(token0).balanceOf(address(this));
        balance1 = IERC20(token1).balanceOf(address(this));

        _update(balance0, balance1, reserve0, reserve1);
        emit Burn(msg.sender, amount0, amount1, to);
    }
    
    /**
     * @dev Calculate optimal liquidity amounts
     */
    function _addLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min
    ) internal view returns (uint256 amount0, uint256 amount1) {
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        
        if (_reserve0 == 0 && _reserve1 == 0) {
            (amount0, amount1) = (amount0Desired, amount1Desired);
        } else {
            uint256 amount1Optimal = _quote(amount0Desired, _reserve0, _reserve1);
            if (amount1Optimal <= amount1Desired) {
                require(amount1Optimal >= amount1Min, "Insufficient token1 amount");
                (amount0, amount1) = (amount0Desired, amount1Optimal);
            } else {
                uint256 amount0Optimal = _quote(amount1Desired, _reserve1, _reserve0);
                assert(amount0Optimal <= amount0Desired);
                require(amount0Optimal >= amount0Min, "Insufficient token0 amount");
                (amount0, amount1) = (amount0Optimal, amount1Desired);
            }
        }
    }
    
    /**
     * @dev Update reserves
     */
    function _update(uint256 balance0, uint256 balance1, uint112 _reserve0, uint112 _reserve1) private {
        require(balance0 <= type(uint112).max && balance1 <= type(uint112).max, "Overflow");
        
        uint32 blockTimestamp = uint32(block.timestamp % 2**32);
        uint32 timeElapsed = blockTimestamp - blockTimestampLast;
        
        if (timeElapsed > 0 && _reserve0 != 0 && _reserve1 != 0) {
            price0CumulativeLast += uint256(_uq112x112(_reserve1)) * timeElapsed / _reserve0;
            price1CumulativeLast += uint256(_uq112x112(_reserve0)) * timeElapsed / _reserve1;
        }
        
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = blockTimestamp;
        
        emit Sync(reserve0, reserve1);
    }
    
    /**
     * @dev Update volume tracking
     */
    function _updateVolume(uint256 volume) internal {
        totalVolume += volume;
        
        // Update daily volume
        if (block.timestamp / 1 days > lastDayTimestamp / 1 days) {
            dailyVolume = volume;
            lastDayTimestamp = block.timestamp;
        } else {
            dailyVolume += volume;
        }
        
        uint256 fees = volume * tradingFee / FEE_DENOMINATOR;
        totalFees += fees;
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================
    
    /**
     * @dev Get current reserves
     */
    function getReserves() public view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast) {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        _blockTimestampLast = blockTimestampLast;
    }
    
    /**
     * @dev Get pool information
     */
    function getPoolInfo() external view returns (
        address _token0,
        address _token1,
        uint256 _reserve0,
        uint256 _reserve1,
        uint256 _totalSupply,
        uint256 _tradingFee,
        uint256 _totalVolume,
        uint256 _totalFees
    ) {
        (_reserve0, _reserve1,) = getReserves();
        return (
            token0,
            token1,
            _reserve0,
            _reserve1,
            totalSupply(),
            tradingFee,
            totalVolume,
            totalFees
        );
    }
    
    /**
     * @dev Calculate earned rewards
     */
    function earned(address account) public view returns (uint256) {
        return balanceOf(account) * (rewardPerToken() - userRewardPerTokenPaid[account]) / 1e18 + rewards[account];
    }
    
    /**
     * @dev Get reward per token
     */
    function rewardPerToken() public view returns (uint256) {
        if (totalSupply() == 0) {
            return rewardPerTokenStored;
        }
        
        return rewardPerTokenStored + 
            (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18 / totalSupply();
    }
    
    /**
     * @dev Get last applicable reward time
     */
    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < lastUpdateTime ? block.timestamp : lastUpdateTime;
    }

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================
    
    /**
     * @dev Set trading fee
     */
    function setTradingFee(uint256 _fee) external onlyRole(FEE_MANAGER_ROLE) {
        require(_fee <= MAX_FEE, "Fee too high");
        tradingFee = _fee;
    }
    
    /**
     * @dev Set fee recipient
     */
    function setFeeRecipient(address _feeRecipient) external onlyRole(FEE_MANAGER_ROLE) {
        require(_feeRecipient != address(0), "Invalid address");
        feeRecipient = _feeRecipient;
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
    // UTILITY FUNCTIONS
    // =============================================================================
    
    function _quote(uint256 amountA, uint256 reserveA, uint256 reserveB) internal pure returns (uint256 amountB) {
        require(amountA > 0, "Insufficient amount");
        require(reserveA > 0 && reserveB > 0, "Insufficient liquidity");
        amountB = amountA * reserveB / reserveA;
    }
    
    function _sqrt(uint256 y) internal pure returns (uint256 z) {
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
    
    function _min(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = x < y ? x : y;
    }
    
    function _uq112x112(uint112 y) internal pure returns (uint224 z) {
        z = uint224(y) * uint224(2**112);
    }
    
    /**
     * @dev Get token value in USD (mock implementation)
     */
    function _getTokenValueInUSD(address token, uint256 amount) internal pure returns (uint256) {
        // Mock implementation - in production use price feeds
        return amount; // Assume $1 for simplicity
    }
}
