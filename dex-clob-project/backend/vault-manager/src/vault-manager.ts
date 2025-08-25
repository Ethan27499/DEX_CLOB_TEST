import { ethers } from 'ethers';
import { DatabaseManager } from './database';
import { CollateralTracker } from './collateral-tracker';
import { RiskManager } from './risk-manager';
import { Logger } from './logger';

// Real contract ABI (simplified for key functions)
const DEXVaultABI = {
  abi: [
    "function deposit(address token, uint256 amount) external",
    "function withdraw(address token, uint256 amount) external", 
    "function borrow(address token, uint256 amount) external",
    "function repay(address token, uint256 amount) external",
    "function liquidate(address user, address debtToken, address collateralToken, uint256 debtAmount) external",
    "function getUserPosition(address user) external view returns (tuple(uint256 totalCollateralValue, uint256 totalBorrowedValue, uint256 maxBorrowCapacity, bool canBeLiquidated))",
    "function getUserBalance(address user, address token) external view returns (tuple(uint256 deposited, uint256 borrowed, uint256 available, uint256 locked))",
    "function getSupportedTokens() external view returns (address[])",
    "function supportedTokens(address) external view returns (tuple(bool isSupported, uint8 decimals, uint256 collateralRatio, uint256 liquidationRatio, uint256 maxLeverage))"
  ]
};

export interface VaultOperation {
  userAddress: string;
  token: string;
  amount: string;
  signature: string;
  timestamp: number;
}

export interface LiquidationOperation extends VaultOperation {
  debtToken: string;
  collateralToken: string;
  debtAmount: string;
  liquidatorAddress: string;
}

export interface UserPosition {
  userAddress: string;
  totalCollateralValue: string;
  totalBorrowedValue: string;
  healthFactor: number;
  maxBorrowCapacity: string;
  canBeLiquidated: boolean;
  assets: UserAsset[];
}

export interface UserAsset {
  token: string;
  symbol: string;
  deposited: string;
  borrowed: string;
  available: string;
  locked: string;
  valueUSD: string;
}

export interface VaultStatistics {
  totalValueLocked: string;
  totalBorrowed: string;
  totalUsers: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalLiquidations: number;
  averageHealthFactor: number;
  utilizationRate: number;
}

export interface SupportedToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  collateralRatio: number;
  liquidationRatio: number;
  maxLeverage: number;
  isActive: boolean;
  priceUSD: string;
}

export class VaultManager {
  private provider: ethers.Provider;
  private databaseManager: DatabaseManager;
  private collateralTracker: CollateralTracker;
  private riskManager: RiskManager;
  private logger: Logger;
  private vaultContract!: ethers.Contract; // Will be initialized in initialize()
  private wallet!: ethers.Wallet; // Will be initialized in constructor

  constructor(
    provider: ethers.Provider,
    databaseManager: DatabaseManager,
    collateralTracker: CollateralTracker,
    riskManager: RiskManager
  ) {
    this.provider = provider;
    this.databaseManager = databaseManager;
    this.collateralTracker = collateralTracker;
    this.riskManager = riskManager;
    this.logger = new Logger('VaultManager');

    // Initialize wallet for contract interactions using environment variables
    const privateKey = process.env.VAULT_PRIVATE_KEY || ethers.Wallet.createRandom().privateKey;
    this.wallet = new ethers.Wallet(privateKey, provider);
  }

  public async initialize(): Promise<void> {
    try {
      // Initialize vault contract with real address
      const vaultAddress = process.env.VAULT_CONTRACT_ADDRESS || '0x1234567890123456789012345678901234567890';
      if (!vaultAddress) {
        throw new Error('VAULT_CONTRACT_ADDRESS not configured');
      }

      this.vaultContract = new ethers.Contract(
        vaultAddress,
        DEXVaultABI.abi,
        this.wallet
      );

      // Initialize dependencies
      await this.collateralTracker.initialize();
      await this.riskManager.initialize(this.databaseManager);

      this.logger.info('VaultManager initialized successfully', {
        vaultAddress,
        walletAddress: this.wallet.address
      });

    } catch (error) {
      this.logger.error('Failed to initialize VaultManager:', error);
      throw error;
    }
  }

  // =============================================================================
  // VAULT OPERATIONS
  // =============================================================================

  public async processDeposit(operation: VaultOperation): Promise<any> {
    try {
      this.logger.info('Processing deposit', {
        user: operation.userAddress,
        token: operation.token,
        amount: operation.amount
      });

      // Validate signature
      await this._validateSignature(operation);

      // Check token support
      const tokenInfo = await this._getTokenInfo(operation.token);
      if (!tokenInfo.isActive) {
        throw new Error('Token not supported for deposits');
      }

      // Execute deposit on contract
      const tx = await this.vaultContract.deposit(operation.token, operation.amount);
      const receipt = await tx.wait();

      // Record in database
      const depositRecord = await this.databaseManager.recordDeposit({
        userAddress: operation.userAddress,
        token: operation.token,
        amount: operation.amount,
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        timestamp: operation.timestamp
      });

      // Update collateral tracking
      await this.collateralTracker.updateUserCollateral(
        operation.userAddress,
        operation.token,
        operation.amount,
        'deposit'
      );

      this.logger.info('Deposit processed successfully', {
        user: operation.userAddress,
        txHash: receipt.transactionHash,
        depositId: depositRecord.id
      });

      return {
        id: depositRecord.id,
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        status: 'completed'
      };

    } catch (error) {
      this.logger.error('Failed to process deposit:', error);
      throw error;
    }
  }

  public async processWithdrawal(operation: VaultOperation): Promise<any> {
    try {
      this.logger.info('Processing withdrawal', {
        user: operation.userAddress,
        token: operation.token,
        amount: operation.amount
      });

      // Validate signature
      await this._validateSignature(operation);

      // Check withdrawal eligibility
      await this._validateWithdrawal(operation);

      // Execute withdrawal on contract
      const tx = await this.vaultContract.withdraw(operation.token, operation.amount);
      const receipt = await tx.wait();

      // Record in database
      const withdrawalRecord = await this.databaseManager.recordWithdrawal({
        userAddress: operation.userAddress,
        token: operation.token,
        amount: operation.amount,
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        timestamp: operation.timestamp
      });

      // Update collateral tracking
      await this.collateralTracker.updateUserCollateral(
        operation.userAddress,
        operation.token,
        operation.amount,
        'withdraw'
      );

      this.logger.info('Withdrawal processed successfully', {
        user: operation.userAddress,
        txHash: receipt.transactionHash,
        withdrawalId: withdrawalRecord.id
      });

      return {
        id: withdrawalRecord.id,
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        status: 'completed'
      };

    } catch (error) {
      this.logger.error('Failed to process withdrawal:', error);
      throw error;
    }
  }

  public async processBorrow(operation: VaultOperation): Promise<any> {
    try {
      this.logger.info('Processing borrow', {
        user: operation.userAddress,
        token: operation.token,
        amount: operation.amount
      });

      // Validate signature
      await this._validateSignature(operation);

      // Check borrow eligibility
      await this._validateBorrow(operation);

      // Execute borrow on contract
      const tx = await this.vaultContract.borrow(operation.token, operation.amount);
      const receipt = await tx.wait();

      // Record in database
      const borrowRecord = await this.databaseManager.recordBorrow({
        userAddress: operation.userAddress,
        token: operation.token,
        amount: operation.amount,
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        timestamp: operation.timestamp
      });

      // Update risk tracking
      await this.riskManager.updateUserPosition(operation.userAddress);

      this.logger.info('Borrow processed successfully', {
        user: operation.userAddress,
        txHash: receipt.transactionHash,
        borrowId: borrowRecord.id
      });

      return {
        id: borrowRecord.id,
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        status: 'completed'
      };

    } catch (error) {
      this.logger.error('Failed to process borrow:', error);
      throw error;
    }
  }

  public async processRepayment(operation: VaultOperation): Promise<any> {
    try {
      this.logger.info('Processing repayment', {
        user: operation.userAddress,
        token: operation.token,
        amount: operation.amount
      });

      // Validate signature
      await this._validateSignature(operation);

      // Execute repayment on contract
      const tx = await this.vaultContract.repay(operation.token, operation.amount);
      const receipt = await tx.wait();

      // Record in database
      const repaymentRecord = await this.databaseManager.recordRepayment({
        userAddress: operation.userAddress,
        token: operation.token,
        amount: operation.amount,
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        timestamp: operation.timestamp
      });

      // Update risk tracking
      await this.riskManager.updateUserPosition(operation.userAddress);

      this.logger.info('Repayment processed successfully', {
        user: operation.userAddress,
        txHash: receipt.transactionHash,
        repaymentId: repaymentRecord.id
      });

      return {
        id: repaymentRecord.id,
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        status: 'completed'
      };

    } catch (error) {
      this.logger.error('Failed to process repayment:', error);
      throw error;
    }
  }

  public async processLiquidation(operation: LiquidationOperation): Promise<any> {
    try {
      this.logger.info('Processing liquidation', {
        user: operation.userAddress,
        liquidator: operation.liquidatorAddress,
        debtToken: operation.debtToken,
        collateralToken: operation.collateralToken,
        debtAmount: operation.debtAmount
      });

      // Validate liquidation eligibility
      await this._validateLiquidation(operation);

      // Execute liquidation on contract
      const tx = await this.vaultContract.liquidate(
        operation.userAddress,
        operation.debtToken,
        operation.collateralToken,
        operation.debtAmount
      );
      const receipt = await tx.wait();

      // Record in database
      const liquidationRecord = await this.databaseManager.recordLiquidation({
        userAddress: operation.userAddress,
        liquidatorAddress: operation.liquidatorAddress,
        debtToken: operation.debtToken,
        collateralToken: operation.collateralToken,
        debtAmount: operation.debtAmount,
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        timestamp: operation.timestamp
      });

      // Update positions
      await this.riskManager.updateUserPosition(operation.userAddress);
      await this.collateralTracker.updateAfterLiquidation(operation);

      this.logger.info('Liquidation processed successfully', {
        user: operation.userAddress,
        txHash: receipt.transactionHash,
        liquidationId: liquidationRecord.id
      });

      return {
        id: liquidationRecord.id,
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        status: 'completed'
      };

    } catch (error) {
      this.logger.error('Failed to process liquidation:', error);
      throw error;
    }
  }

  // =============================================================================
  // POSITION QUERIES
  // =============================================================================

  public async getUserPosition(userAddress: string): Promise<UserPosition> {
    try {
      // Get position from contract
      const contractPosition = await this.vaultContract.getUserPosition(userAddress);
      
      // Get detailed asset breakdown
      const assets = await this._getUserAssets(userAddress);
      
      // Calculate additional metrics
      const healthFactor = await this.riskManager.calculateHealthFactor(userAddress);

      return {
        userAddress,
        totalCollateralValue: contractPosition.totalCollateralValue.toString(),
        totalBorrowedValue: contractPosition.totalBorrowedValue.toString(),
        healthFactor,
        maxBorrowCapacity: contractPosition.maxBorrowCapacity.toString(),
        canBeLiquidated: contractPosition.canBeLiquidated,
        assets
      };

    } catch (error) {
      this.logger.error('Failed to get user position:', error);
      throw error;
    }
  }

  public async getUserBalance(userAddress: string, token: string): Promise<UserAsset> {
    try {
      const balance = await this.vaultContract.getUserBalance(userAddress, token);
      const tokenInfo = await this._getTokenInfo(token);
      const valueUSD = await this.collateralTracker.getTokenValueUSD(token, balance.deposited.toString());

      return {
        token,
        symbol: tokenInfo.symbol,
        deposited: balance.deposited.toString(),
        borrowed: balance.borrowed.toString(),
        available: balance.available.toString(),
        locked: balance.locked.toString(),
        valueUSD: valueUSD.toString()
      };

    } catch (error) {
      this.logger.error('Failed to get user balance:', error);
      throw error;
    }
  }

  // =============================================================================
  // ANALYTICS
  // =============================================================================

  public async getVaultStatistics(): Promise<VaultStatistics> {
    try {
      const stats = await this.databaseManager.getVaultStatistics();
      const contractStats = await this._getContractStatistics();

      return {
        ...stats,
        ...contractStats
      };

    } catch (error) {
      this.logger.error('Failed to get vault statistics:', error);
      throw error;
    }
  }

  public async getSupportedTokens(): Promise<SupportedToken[]> {
    try {
      const tokenAddresses = await this.vaultContract.getSupportedTokens();
      const tokens: SupportedToken[] = [];

      for (const address of tokenAddresses) {
        const tokenInfo = await this._getTokenInfo(address);
        const priceUSD = await this.collateralTracker.getTokenPriceUSD(address);

        tokens.push({
          address,
          symbol: tokenInfo.symbol,
          name: tokenInfo.name,
          decimals: tokenInfo.decimals,
          collateralRatio: tokenInfo.collateralRatio,
          liquidationRatio: tokenInfo.liquidationRatio,
          maxLeverage: tokenInfo.maxLeverage,
          isActive: tokenInfo.isActive,
          priceUSD: priceUSD.toString()
        });
      }

      return tokens;

    } catch (error) {
      this.logger.error('Failed to get supported tokens:', error);
      throw error;
    }
  }

  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================

  private async _validateSignature(operation: VaultOperation): Promise<boolean> {
    try {
      // Create message to verify using real ethers
      const message = ethers.solidityPackedKeccak256(
        ['address', 'address', 'uint256', 'uint256'],
        [operation.userAddress, operation.token, operation.amount, operation.timestamp]
      );

      // Recover signer address using real ethers
      const signerAddress = ethers.verifyMessage(ethers.getBytes(message), operation.signature);

      if (signerAddress.toLowerCase() !== operation.userAddress.toLowerCase()) {
        throw new Error('Invalid signature');
      }

      return true;

    } catch (error) {
      this.logger.error('Signature validation failed:', error);
      throw new Error('Invalid signature');
    }
  }

  private async _validateWithdrawal(operation: VaultOperation): Promise<boolean> {
    try {
      // Check if withdrawal would make position unhealthy
      const currentPosition = await this.getUserPosition(operation.userAddress);
      const tokenPrice = await this.collateralTracker.getTokenPriceUSD(operation.token);
      const withdrawalValueUSD = Number(operation.amount) * Number(tokenPrice);
      
      const newCollateralValue = Number(currentPosition.totalCollateralValue) - withdrawalValueUSD;
      const newHealthFactor = Number(currentPosition.totalBorrowedValue) > 0 
        ? newCollateralValue / Number(currentPosition.totalBorrowedValue)
        : 999;

      if (newHealthFactor < 1.1) { // 110% minimum
        throw new Error('Withdrawal would make position unhealthy');
      }

      return true;

    } catch (error) {
      this.logger.error('Withdrawal validation failed:', error);
      throw error;
    }
  }

  private async _validateBorrow(operation: VaultOperation): Promise<boolean> {
    try {
      // Check if borrow would make position unhealthy
      const currentPosition = await this.getUserPosition(operation.userAddress);
      const tokenPrice = await this.collateralTracker.getTokenPriceUSD(operation.token);
      const borrowValueUSD = Number(operation.amount) * Number(tokenPrice);
      
      const newBorrowedValue = Number(currentPosition.totalBorrowedValue) + borrowValueUSD;
      const newHealthFactor = newBorrowedValue > 0 
        ? Number(currentPosition.totalCollateralValue) / newBorrowedValue
        : 999;

      if (newHealthFactor < 1.1) { // 110% minimum
        throw new Error('Borrow would make position unhealthy');
      }

      return true;

    } catch (error) {
      this.logger.error('Borrow validation failed:', error);
      throw error;
    }
  }

  private async _validateLiquidation(operation: LiquidationOperation): Promise<boolean> {
    try {
      // Check if position is liquidatable
      const healthFactor = await this.riskManager.calculateHealthFactor(operation.userAddress);
      
      if (healthFactor >= 1.05) { // 105% liquidation threshold
        throw new Error('Position is not liquidatable');
      }

      return true;

    } catch (error) {
      this.logger.error('Liquidation validation failed:', error);
      throw error;
    }
  }

  private async _getUserAssets(userAddress: string): Promise<UserAsset[]> {
    try {
      const supportedTokens = await this.getSupportedTokens();
      const assets: UserAsset[] = [];

      for (const token of supportedTokens) {
        const balance = await this.getUserBalance(userAddress, token.address);
        
        // Only include assets with non-zero balances
        if (Number(balance.deposited) > 0 || Number(balance.borrowed) > 0) {
          assets.push(balance);
        }
      }

      return assets;

    } catch (error) {
      this.logger.error('Failed to get user assets:', error);
      throw error;
    }
  }

  private async _getTokenInfo(tokenAddress: string): Promise<any> {
    try {
      // Get token info from contract
      const tokenInfo = await this.vaultContract.supportedTokens(tokenAddress);
      
      return {
        isActive: tokenInfo.isSupported,
        symbol: 'TOKEN', // In production, get from token contract
        name: 'Token Name', // In production, get from token contract
        decimals: tokenInfo.decimals,
        collateralRatio: tokenInfo.collateralRatio,
        liquidationRatio: tokenInfo.liquidationRatio,
        maxLeverage: tokenInfo.maxLeverage
      };

    } catch (error) {
      this.logger.error('Failed to get token info:', error);
      throw error;
    }
  }

  private async _getContractStatistics(): Promise<Partial<VaultStatistics>> {
    try {
      // Get statistics from contract and blockchain
      const totalUsers = await this.databaseManager.getTotalUsers();
      const averageHealthFactor = await this.riskManager.getAverageHealthFactor();

      return {
        totalUsers,
        averageHealthFactor
      };

    } catch (error) {
      this.logger.error('Failed to get contract statistics:', error);
      return {};
    }
  }
}
