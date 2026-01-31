import type { ModelHealthStatus, PingResult } from '../../core/types/health.js';
import type { HealthStatus } from '../../core/types/index.js';
import type { LLMProvider } from '../../core/types/providers.js';
import { logger } from '../../../utils/logger.js';

/**
 * Health monitoring configuration
 */
export interface HealthMonitorConfig {
  readonly checkInterval: number; // Minutes between health checks
  readonly retryAttempts: number; // Number of retry attempts for failed checks
  readonly retryDelay: number; // Delay between retries in milliseconds
  readonly healthyThreshold: number; // Max latency for healthy status (ms)
  readonly degradedThreshold: number; // Max latency for degraded status (ms)
  readonly maxHistorySize: number; // Number of health records to keep
  readonly enableBackgroundChecks: boolean; // Whether to run periodic checks
}

/**
 * Health check result with extended metadata
 */
export interface HealthCheckResult extends ModelHealthStatus {
  readonly checkId: string;
  readonly attempts: number;
  readonly retryHistory?: readonly PingResult[];
}

/**
 * Model availability tracking
 */
export interface ModelAvailability {
  readonly modelId: string;
  readonly provider: string;
  readonly isAvailable: boolean;
  readonly lastChecked: Date;
  readonly consecutiveFailures: number;
  readonly totalChecks: number;
  readonly successRate: number; // Percentage of successful checks
  readonly averageLatency: number; // Average response time
  readonly lastSuccessfulCheck?: Date;
  readonly lastFailureReason?: string;
}

/**
 * Health monitoring events
 */
export type HealthEvent = 
  | { type: 'model_healthy'; model: string; provider: string; latency: number }
  | { type: 'model_degraded'; model: string; provider: string; latency: number; threshold: number }
  | { type: 'model_unavailable'; model: string; provider: string; error: string }
  | { type: 'model_recovered'; model: string; provider: string; previousFailures: number }
  | { type: 'provider_unhealthy'; provider: string; unhealthyModels: number; totalModels: number };

/**
 * Health event listener type
 */
export type HealthEventListener = (event: HealthEvent) => void;

/**
 * Comprehensive health monitoring system for LLM providers and models
 * Tracks availability, performance, and provides alerting capabilities
 */
export class HealthMonitor {
  private config: HealthMonitorConfig;
  private readonly healthHistory = new Map<string, HealthCheckResult[]>();
  private readonly availabilityMap = new Map<string, ModelAvailability>();
  private readonly eventListeners = new Set<HealthEventListener>();
  private backgroundIntervalId: NodeJS.Timeout | undefined;
  private readonly providers = new Map<string, LLMProvider>();

  constructor(config?: Partial<HealthMonitorConfig>) {
    this.config = {
      checkInterval: 5, // 5 minutes
      retryAttempts: 3,
      retryDelay: 1000, // 1 second
      healthyThreshold: 2000, // 2 seconds
      degradedThreshold: 5000, // 5 seconds
      maxHistorySize: 100,
      enableBackgroundChecks: false, // Force disabled to prevent continuous API calls
      ...config
    };

    logger.debug('Health monitor initialized', {
      config: this.config
    });
  }

  /**
   * Register a provider for health monitoring
   */
  public registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.name, provider);
    
    // Initialize availability tracking for all supported models
    for (const modelId of provider.supportedModels) {
      const key = this.getModelKey(provider.name, modelId);
      if (!this.availabilityMap.has(key)) {
        this.availabilityMap.set(key, {
          modelId,
          provider: provider.name,
          isAvailable: true, // Assume available until proven otherwise
          lastChecked: new Date(),
          consecutiveFailures: 0,
          totalChecks: 0,
          successRate: 100,
          averageLatency: 0
        });
      }
    }

    logger.info('Provider registered for health monitoring', {
      provider: provider.name,
      models: provider.supportedModels.length
    });
  }

  /**
   * Unregister a provider from health monitoring
   */
  public unregisterProvider(providerName: string): void {
    this.providers.delete(providerName);
    
    // Remove all model availability entries for this provider
    const availabilityEntries = Array.from(this.availabilityMap.entries());
    for (const [key, availability] of availabilityEntries) {
      if (availability.provider === providerName) {
        this.availabilityMap.delete(key);
      }
    }

    // Remove health history for this provider
    const historyKeys = Array.from(this.healthHistory.keys());
    for (const key of historyKeys) {
      if (key.startsWith(`${providerName}:`)) {
        this.healthHistory.delete(key);
      }
    }

    logger.info('Provider unregistered from health monitoring', { provider: providerName });
  }

  /**
   * Perform health check for a specific model
   */
  public async checkModelHealth(
    providerName: string, 
    modelId: string
  ): Promise<HealthCheckResult> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider ${providerName} not registered for health monitoring`);
    }

    const checkId = `${providerName}:${modelId}:${Date.now()}`;
    const key = this.getModelKey(providerName, modelId);
    let attempts = 0;
    const retryHistory: PingResult[] = [];

    // Perform check with retries
    let lastResult: PingResult | undefined;
    
    for (attempts = 1; attempts <= this.config.retryAttempts; attempts++) {
      try {
        logger.debug('Performing health check', {
          provider: providerName,
          model: modelId,
          attempt: attempts,
          checkId
        });

        lastResult = await provider.ping(modelId);
        
        if (lastResult.success) {
          break; // Success, no need to retry
        }

        retryHistory.push(lastResult);
        
        if (attempts < this.config.retryAttempts) {
          await this.delay(this.config.retryDelay);
        }

      } catch (error) {
        const errorResult: PingResult = {
          success: false,
          latency: 0,
          timestamp: new Date(),
          error: error instanceof Error ? error.message : 'Unknown error'
        };
        
        retryHistory.push(errorResult);
        lastResult = errorResult;
        
        if (attempts < this.config.retryAttempts) {
          await this.delay(this.config.retryDelay);
        }
      }
    }

    if (!lastResult) {
      throw new Error('No ping result available');
    }

    // Determine health status
    let status: HealthStatus = 'unknown';
    if (lastResult.success) {
      if (lastResult.latency <= this.config.healthyThreshold) {
        status = 'healthy';
      } else if (lastResult.latency <= this.config.degradedThreshold) {
        status = 'degraded';
      } else {
        status = 'degraded'; // Very slow but working
      }
    } else {
      status = 'unavailable';
    }

    // Create health check result
    const healthResult: HealthCheckResult = {
      provider: providerName,
      model: modelId,
      status,
      latency: lastResult.latency,
      lastChecked: new Date(),
      ...(lastResult.error && { error: lastResult.error }),
      checkId,
      attempts,
      ...(retryHistory.length > 0 && { retryHistory }),
      metadata: {
        retryCount: attempts - 1,
        totalLatency: lastResult.latency
      }
    };

    // Update availability tracking
    this.updateAvailability(key, healthResult);

    // Store in history  
    if (key) {
      this.storeHealthResult(key, healthResult);
    }

    // Emit events
    this.emitHealthEvent(healthResult);

    logger.debug('Health check completed', {
      provider: providerName,
      model: modelId,
      status,
      latency: lastResult.latency,
      attempts,
      checkId
    });

    return healthResult;
  }

  /**
   * Perform health checks for all models of a provider
   */
  public async checkProviderHealth(providerName: string): Promise<HealthCheckResult[]> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider ${providerName} not registered`);
    }

    const results: HealthCheckResult[] = [];
    
    // Check all models concurrently with limited concurrency
    const models = provider.supportedModels;
    const concurrency = Math.min(3, models.length); // Limit to 3 concurrent checks
    
    for (let i = 0; i < models.length; i += concurrency) {
      const batch = models.slice(i, i + concurrency);
      const batchPromises = batch.map(modelId => 
        this.checkModelHealth(providerName, modelId)
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          logger.error('Health check failed for model', result.reason as Error);
        }
      }
    }

    // Check if provider is generally unhealthy
    const unhealthyCount = results.filter(r => r.status === 'unavailable').length;
    if (unhealthyCount > 0) {
      this.emitEvent({
        type: 'provider_unhealthy',
        provider: providerName,
        unhealthyModels: unhealthyCount,
        totalModels: results.length
      });
    }

    return results;
  }

  /**
   * Get current availability status for all monitored models
   */
  public getAvailabilityStatus(): readonly ModelAvailability[] {
    return Array.from(this.availabilityMap.values());
  }

  /**
   * Get availability status for a specific model
   */
  public getModelAvailability(providerName: string, modelId: string): ModelAvailability | undefined {
    const key = this.getModelKey(providerName, modelId);
    return this.availabilityMap.get(key);
  }

  /**
   * Get health history for a model
   */
  public getHealthHistory(
    providerName: string, 
    modelId: string, 
    limit?: number
  ): readonly HealthCheckResult[] {
    const key = this.getModelKey(providerName, modelId);
    const history = this.healthHistory.get(key) || [];
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Get aggregated health metrics for a model
   */
  public getHealthMetrics(providerName: string, modelId: string): {
    readonly successRate: number;
    readonly averageLatency: number;
    readonly totalChecks: number;
    readonly lastHealthy?: Date;
    readonly longestDowntime?: number; // minutes
  } | undefined {
    const history = this.getHealthHistory(providerName, modelId);
    if (history.length === 0) return undefined;

    const successfulChecks = history.filter(h => h.status !== 'unavailable');
    const successRate = (successfulChecks.length / history.length) * 100;
    
    const averageLatency = successfulChecks.length > 0 
      ? successfulChecks.reduce((sum, h) => sum + h.latency, 0) / successfulChecks.length
      : 0;

    const lastHealthy = successfulChecks.length > 0 
      ? successfulChecks[successfulChecks.length - 1]?.lastChecked
      : undefined;

    // Calculate longest downtime period
    let longestDowntime = 0;
    let currentDowntimeStart: Date | undefined;
    
    for (const check of history) {
      if (check.status === 'unavailable') {
        if (!currentDowntimeStart) {
          currentDowntimeStart = check.lastChecked;
        }
      } else {
        if (currentDowntimeStart) {
          const downtime = check.lastChecked.getTime() - currentDowntimeStart.getTime();
          longestDowntime = Math.max(longestDowntime, downtime / (1000 * 60)); // Convert to minutes
          currentDowntimeStart = undefined;
        }
      }
    }

    return {
      successRate,
      averageLatency,
      totalChecks: history.length,
      ...(lastHealthy && { lastHealthy }),
      ...(longestDowntime > 0 && { longestDowntime })
    };
  }

  /**
   * Start background health monitoring
   */
  public startBackgroundMonitoring(): void {
    // Force disabled to prevent continuous API calls to providers
    logger.info('Background health monitoring is force disabled to prevent continuous API calls');
    return;

    const intervalMs = this.config.checkInterval * 60 * 1000; // Convert minutes to milliseconds
    
    this.backgroundIntervalId = setInterval((): void => {
      void (async (): Promise<void> => {
        try {
          logger.debug('Starting background health checks');
          
          // Check all registered providers
          const promises = Array.from(this.providers.keys()).map((providerName) => {
            return this.checkProviderHealth(providerName).catch((error) => {
              logger.error('Background health check failed for provider', error as Error, {
                provider: providerName
              });
            });
          });

          await Promise.allSettled(promises);
          logger.debug('Background health checks completed');
          
        } catch (error) {
          logger.error('Background health monitoring error', error as Error);
        }
      })();
    }, intervalMs);

    logger.info('Background health monitoring started', {
      interval: this.config.checkInterval,
      providers: this.providers.size
    });
  }

  /**
   * Stop background health monitoring
   */
  public stopBackgroundMonitoring(): void {
    if (this.backgroundIntervalId) {
      clearInterval(this.backgroundIntervalId);
      this.backgroundIntervalId = undefined;
      logger.info('Background health monitoring stopped');
    }
  }

  /**
   * Add event listener for health events
   */
  public addEventListener(listener: HealthEventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * Remove event listener
   */
  public removeEventListener(listener: HealthEventListener): void {
    this.eventListeners.delete(listener);
  }

  /**
   * Get health monitor configuration
   */
  public getConfig(): HealthMonitorConfig {
    return { ...this.config };
  }

  /**
   * Update health monitor configuration
   */
  public updateConfig(updates: Partial<HealthMonitorConfig>): void {
    // Create new config with proper type safety
    this.config = {
      ...this.config,
      ...updates
    };
    
    // Restart background monitoring if interval changed
    if (updates.checkInterval !== undefined && this.backgroundIntervalId) {
      this.stopBackgroundMonitoring();
      this.startBackgroundMonitoring();
    }

    logger.info('Health monitor configuration updated', { updates });
  }

  /**
   * Clear all health history and availability data
   */
  public clearHistory(): void {
    this.healthHistory.clear();
    
    // Reset availability data but keep the entries
    const availabilityEntries = Array.from(this.availabilityMap.entries());
    for (const [key, availability] of availabilityEntries) {
      this.availabilityMap.set(key, {
        ...availability,
        totalChecks: 0,
        consecutiveFailures: 0,
        successRate: 100,
        averageLatency: 0,
        lastChecked: new Date(),
      });
    }

    logger.info('Health history cleared');
  }

  /**
   * Private helper methods
   */
  private getModelKey(provider: string, model: string): string {
    return `${provider}:${model}`;
  }

  private updateAvailability(key: string | undefined, result: HealthCheckResult): void {
    if (!key) return;
    const current = this.availabilityMap.get(key);
    if (!current) return;

    const isSuccess = result.status !== 'unavailable';
    const newTotalChecks = current.totalChecks + 1;
    const newSuccessCount = isSuccess 
      ? (current.successRate / 100 * current.totalChecks) + 1
      : (current.successRate / 100 * current.totalChecks);
    
    const updated: ModelAvailability = {
      ...current,
      isAvailable: isSuccess,
      lastChecked: result.lastChecked,
      consecutiveFailures: isSuccess ? 0 : current.consecutiveFailures + 1,
      totalChecks: newTotalChecks,
      successRate: (newSuccessCount / newTotalChecks) * 100,
      averageLatency: isSuccess 
        ? ((current.averageLatency * (current.totalChecks - 1)) + result.latency) / current.totalChecks
        : current.averageLatency,
      ...(isSuccess && { lastSuccessfulCheck: result.lastChecked }),
      ...(!isSuccess && current.lastSuccessfulCheck && { lastSuccessfulCheck: current.lastSuccessfulCheck }),
      ...(result.error && !isSuccess && { lastFailureReason: result.error })
    };

    this.availabilityMap.set(key, updated);
  }

  private storeHealthResult(key: string, result: HealthCheckResult): void {
    let history = this.healthHistory.get(key);
    if (!history) {
      history = [];
      this.healthHistory.set(key, history);
    }

    history.push(result);

    // Trim history if it exceeds max size
    if (history.length > this.config.maxHistorySize) {
      history.splice(0, history.length - this.config.maxHistorySize);
    }
  }

  private emitHealthEvent(result: HealthCheckResult): void {
    const availability = this.availabilityMap.get(this.getModelKey(result.provider, result.model));
    
    switch (result.status) {
      case 'healthy':
        if (availability && availability.consecutiveFailures > 0) {
          this.emitEvent({
            type: 'model_recovered',
            model: result.model,
            provider: result.provider,
            previousFailures: availability.consecutiveFailures
          });
        } else {
          this.emitEvent({
            type: 'model_healthy',
            model: result.model,
            provider: result.provider,
            latency: result.latency
          });
        }
        break;
        
      case 'degraded':
        this.emitEvent({
          type: 'model_degraded',
          model: result.model,
          provider: result.provider,
          latency: result.latency,
          threshold: this.config.healthyThreshold
        });
        break;
        
      case 'unavailable':
        this.emitEvent({
          type: 'model_unavailable',
          model: result.model,
          provider: result.provider,
          error: result.error || 'Unknown error'
        });
        break;
    }
  }

  private emitEvent(event: HealthEvent): void {
    const listeners = Array.from(this.eventListeners);
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error('Health event listener error', error as Error, { event });
      }
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    this.stopBackgroundMonitoring();
    this.eventListeners.clear();
    this.healthHistory.clear();
    this.availabilityMap.clear();
    this.providers.clear();
    logger.info('Health monitor disposed');
  }
}

/**
 * Create a health monitor with default configuration
 */
export function createHealthMonitor(config?: Partial<HealthMonitorConfig>): HealthMonitor {
  return new HealthMonitor(config);
}