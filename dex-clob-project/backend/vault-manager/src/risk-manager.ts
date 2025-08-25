import { DatabaseManager } from './database';
import { Logger } from './logger';

export interface RiskMetrics {
  healthFactor: number;
  collateralRatio: number;
  liquidationThreshold: number;
  borrowUtilization: number;
  isLiquidatable: boolean;
  timeToLiquidation?: number;
}

export interface UserRiskProfile {
  userAddress: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  healthFactor: number;
  maxLeverage: number;
  recommendedAction?: string;
  lastUpdated: number;
}

export interface LiquidationCandidate {
  userAddress: string;
  healthFactor: number;
  totalCollateral: number;
  totalDebt: number;
  priorityScore: number;
  estimatedProfit: number;
}

export class RiskManager {
  private logger: Logger;
  private databaseManager?: DatabaseManager;
  private riskProfiles: Map<string, UserRiskProfile>;
  private monitoringInterval: any = null;

  constructor() {
    this.logger = new Logger('RiskManager');
    this.riskProfiles = new Map();
  }

  public async initialize(databaseManager: DatabaseManager): Promise<void> {
    try {
      this.databaseManager = databaseManager;

      // Start risk monitoring
      this._startRiskMonitoring();

      this.logger.info('RiskManager initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize RiskManager:', error);
      throw error;
    }
  }

  public async calculateHealthFactor(userAddress: string): Promise<number> {
    try {
      if (!this.databaseManager) {
        throw new Error('Database manager not initialized');
      }

      // Get REAL user position from database
      const position = await (this.databaseManager as any).getUserPosition(userAddress);
      
      const totalCollateralValue = parseFloat(position.totalCollateralValue || '0');
      const totalBorrowedValue = parseFloat(position.totalBorrowedValue || '0');
      
      if (totalBorrowedValue === 0) {
        return 999; // No debt = very high health factor
      }

      const healthFactor = totalCollateralValue / totalBorrowedValue;
      
      this.logger.debug('Health factor calculated from REAL data', {
        user: userAddress,
        healthFactor,
        collateralValue: totalCollateralValue,
        debtValue: totalBorrowedValue
      });

      return healthFactor;

    } catch (error) {
      this.logger.error('Failed to calculate health factor:', error);
      
      // Fallback to safe default
      return 999;
    }
  }

  public async updateUserPosition(userAddress: string): Promise<void> {
    try {
      this.logger.info('Updating user position risk', { user: userAddress });

      const healthFactor = await this.calculateHealthFactor(userAddress);
      const riskLevel = this._calculateRiskLevel(healthFactor);
      
      const riskProfile: UserRiskProfile = {
        userAddress,
        riskLevel,
        healthFactor,
        maxLeverage: this._calculateMaxLeverage(healthFactor),
        recommendedAction: this._getRecommendedAction(riskLevel, healthFactor),
        lastUpdated: Date.now()
      };

      this.riskProfiles.set(userAddress, riskProfile);

      // Alert if user is at risk
      if (riskLevel === 'critical' || riskLevel === 'high') {
        await this._alertHighRiskPosition(riskProfile);
      }

      this.logger.info('User position risk updated', {
        user: userAddress,
        healthFactor,
        riskLevel
      });

    } catch (error) {
      this.logger.error('Failed to update user position:', error);
      throw error;
    }
  }

  public async getUserRiskProfile(userAddress: string): Promise<UserRiskProfile> {
    try {
      let profile = this.riskProfiles.get(userAddress);
      
      if (!profile) {
        // Calculate fresh risk profile
        await this.updateUserPosition(userAddress);
        profile = this.riskProfiles.get(userAddress);
        
        if (!profile) {
          throw new Error('Failed to generate risk profile');
        }
      }

      // Check if profile is stale (older than 5 minutes)
      const now = Date.now();
      const profileAge = now - profile.lastUpdated;
      
      if (profileAge > 5 * 60 * 1000) { // 5 minutes
        // Update in background
        this.updateUserPosition(userAddress).catch(error => {
          this.logger.error('Background risk update failed:', error);
        });
      }

      return profile;

    } catch (error) {
      this.logger.error('Failed to get user risk profile:', error);
      throw error;
    }
  }

  public async getLiquidationCandidates(): Promise<LiquidationCandidate[]> {
    try {
      const candidates: LiquidationCandidate[] = [];
      
      for (const [userAddress, profile] of this.riskProfiles) {
        // Check if user is liquidatable (health factor < 1.05)
        if (profile.healthFactor < 1.05) {
          const candidate: LiquidationCandidate = {
            userAddress,
            healthFactor: profile.healthFactor,
            totalCollateral: 10000, // Mock values
            totalDebt: 9500, // Mock values
            priorityScore: this._calculatePriorityScore(profile.healthFactor),
            estimatedProfit: this._calculateEstimatedProfit(10000, 9500)
          };
          
          candidates.push(candidate);
        }
      }

      // Sort by priority score (descending)
      candidates.sort((a, b) => b.priorityScore - a.priorityScore);

      this.logger.info('Liquidation candidates found', {
        count: candidates.length
      });

      return candidates;

    } catch (error) {
      this.logger.error('Failed to get liquidation candidates:', error);
      throw error;
    }
  }

  public async getAverageHealthFactor(): Promise<number> {
    try {
      if (this.riskProfiles.size === 0) {
        return 999; // No users = very high average
      }

      let totalHealthFactor = 0;
      let validProfiles = 0;

      for (const profile of this.riskProfiles.values()) {
        if (profile.healthFactor < 999) { // Exclude users with no debt
          totalHealthFactor += profile.healthFactor;
          validProfiles++;
        }
      }

      if (validProfiles === 0) {
        return 999;
      }

      const average = totalHealthFactor / validProfiles;
      
      this.logger.debug('Average health factor calculated', {
        average,
        totalProfiles: this.riskProfiles.size,
        validProfiles
      });

      return average;

    } catch (error) {
      this.logger.error('Failed to calculate average health factor:', error);
      throw error;
    }
  }

  public async generateRiskReport(): Promise<any> {
    try {
      const totalUsers = this.riskProfiles.size;
      const averageHealthFactor = await this.getAverageHealthFactor();
      const liquidationCandidates = await this.getLiquidationCandidates();
      
      // Risk distribution
      const riskDistribution = {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0
      };

      for (const profile of this.riskProfiles.values()) {
        riskDistribution[profile.riskLevel]++;
      }

      const report = {
        timestamp: Date.now(),
        totalUsers,
        averageHealthFactor,
        liquidationCandidates: liquidationCandidates.length,
        riskDistribution,
        topRisks: liquidationCandidates.slice(0, 10), // Top 10 highest risk
        systemHealth: this._calculateSystemHealth(riskDistribution, totalUsers)
      };

      this.logger.info('Risk report generated', {
        totalUsers,
        averageHealthFactor,
        liquidationCandidates: liquidationCandidates.length
      });

      return report;

    } catch (error) {
      this.logger.error('Failed to generate risk report:', error);
      throw error;
    }
  }

  public stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    this.logger.info('RiskManager stopped');
  }

  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================

  private _startRiskMonitoring(): void {
    // Monitor risk every 60 seconds
    this.monitoringInterval = setInterval(async () => {
      try {
        await this._performRiskScan();
      } catch (error) {
        this.logger.error('Risk monitoring failed:', error);
      }
    }, 60000);

    this.logger.info('Risk monitoring started');
  }

  private async _performRiskScan(): Promise<void> {
    try {
      // Get liquidation candidates
      const candidates = await this.getLiquidationCandidates();
      
      if (candidates.length > 0) {
        this.logger.warn('Liquidation candidates detected', {
          count: candidates.length,
          topCandidate: candidates[0]
        });

        // In production, this would trigger automated liquidation or alerts
        for (const candidate of candidates.slice(0, 5)) { // Top 5
          await this._alertLiquidationOpportunity(candidate);
        }
      }

      // Check system health
      const avgHealthFactor = await this.getAverageHealthFactor();
      
      if (avgHealthFactor < 1.5) {
        this.logger.warn('System health degraded', {
          averageHealthFactor: avgHealthFactor
        });
        
        // In production, trigger system-wide alerts
      }

    } catch (error) {
      this.logger.error('Risk scan failed:', error);
    }
  }

  private _calculateRiskLevel(healthFactor: number): 'low' | 'medium' | 'high' | 'critical' {
    if (healthFactor >= 2.0) return 'low';
    if (healthFactor >= 1.5) return 'medium';
    if (healthFactor >= 1.1) return 'high';
    return 'critical';
  }

  private _calculateMaxLeverage(healthFactor: number): number {
    // Lower health factor = lower max leverage
    if (healthFactor >= 2.0) return 10;
    if (healthFactor >= 1.5) return 5;
    if (healthFactor >= 1.2) return 2;
    return 1;
  }

  private _getRecommendedAction(riskLevel: string, healthFactor: number): string {
    switch (riskLevel) {
      case 'critical':
        return 'URGENT: Add collateral or repay debt immediately to avoid liquidation';
      case 'high':
        return 'WARNING: Position at risk, consider adding collateral or reducing debt';
      case 'medium':
        return 'CAUTION: Monitor position closely, consider reducing leverage';
      case 'low':
        return 'Position healthy, can consider additional leverage if desired';
      default:
        return 'Monitor position regularly';
    }
  }

  private _calculatePriorityScore(healthFactor: number): number {
    // Lower health factor = higher priority for liquidation
    return Math.max(0, (1.05 - healthFactor) * 1000);
  }

  private _calculateEstimatedProfit(collateralValue: number, debtValue: number): number {
    // Simplified liquidation profit calculation
    // In reality, this would consider liquidation penalties, gas costs, etc.
    const liquidationBonus = 0.05; // 5% bonus
    return debtValue * liquidationBonus;
  }

  private _calculateSystemHealth(riskDistribution: any, totalUsers: number): string {
    if (totalUsers === 0) return 'healthy';
    
    const criticalPercentage = (riskDistribution.critical / totalUsers) * 100;
    const highRiskPercentage = ((riskDistribution.critical + riskDistribution.high) / totalUsers) * 100;
    
    if (criticalPercentage > 10) return 'critical';
    if (highRiskPercentage > 30) return 'warning';
    if (highRiskPercentage > 15) return 'caution';
    return 'healthy';
  }

  private async _alertHighRiskPosition(profile: UserRiskProfile): Promise<void> {
    try {
      this.logger.warn('High risk position detected', {
        user: profile.userAddress,
        riskLevel: profile.riskLevel,
        healthFactor: profile.healthFactor,
        recommendedAction: profile.recommendedAction
      });

      // In production, this would:
      // - Send notifications to user
      // - Update risk dashboards
      // - Trigger automated risk management

    } catch (error) {
      this.logger.error('Failed to alert high risk position:', error);
    }
  }

  private async _alertLiquidationOpportunity(candidate: LiquidationCandidate): Promise<void> {
    try {
      this.logger.info('Liquidation opportunity detected', {
        user: candidate.userAddress,
        healthFactor: candidate.healthFactor,
        estimatedProfit: candidate.estimatedProfit,
        priorityScore: candidate.priorityScore
      });

      // In production, this would:
      // - Notify liquidation bots
      // - Execute automated liquidation
      // - Update liquidation dashboards

    } catch (error) {
      this.logger.error('Failed to alert liquidation opportunity:', error);
    }
  }
}
