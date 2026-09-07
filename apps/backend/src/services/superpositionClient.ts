/**
 * Superposition Client Service
 * Feature flag and configuration management using Superposition
 * Based on OpenFeature SDK with Superposition provider
 *
 * Usage Example:
 * ```typescript
 * import { superpositionClient } from '@/services/superpositionClient';
 *
 * // Initialize (usually done at app startup)
 * await superpositionClient.initialize();
 *
 * // Get boolean flag
 * const isFeatureEnabled = await superpositionClient.getBooleanValue('my-feature', false, { userId: '123' });
 *
 * // Get string flag
 * const configValue = await superpositionClient.getStringValue('api-url', 'https://default.com', { env: 'prod' });
 *
 * // Get number flag
 * const maxRetries = await superpositionClient.getNumberValue('max-retries', 3, { service: 'email' });
 *
 * // Get all config
 * const allConfig = await superpositionClient.resolveAllConfigDetails({ userId: '123' });
 * ```
 */

import { OpenFeature, Client, EvaluationContext, JsonValue } from '@openfeature/server-sdk';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { SuperpositionProvider } from 'superposition-provider';

/**
 * Encode string to base64 (preserving newline if needed for compatibility)
 * @param value - Plain text string to encode
 * @returns Base64 encoded string
 */
function encodeBase64(value: string): string {
  if (!value || value.trim().length === 0) {
    return value;
  }
  // Add newline at the end to match the original working token format
  const tokenWithNewline = value.trim() + '\n';
  return Buffer.from(tokenWithNewline, 'utf-8').toString('base64');
}

export interface SuperpositionConfig {
  endpoint: string;
  token: string;
  org_id: string;
  workspace_id: string;
  refreshStrategy?: {
    interval: number;
    timeout?: number;
  };
}

/**
 * Superposition context for flag evaluation
 * Compatible with OpenFeature's EvaluationContext
 */
export type SuperpositionContext = EvaluationContext;

export interface ResolvedConfigDetails {
  [key: string]: {
    value: unknown;
    variant?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  };
}

export class SuperpositionClient {
  private static instance: SuperpositionClient | null = null;
  private provider: SuperpositionProvider | null = null;
  private client: Client | null = null;
  private isInitialized = false;
  private config: SuperpositionConfig;

  // ============================================================================
  // Static/Factory Methods
  // ============================================================================

  /**
   * method to get the instance of the SuperpositionClient
   */
  public static getInstance(): SuperpositionClient {
    if (!SuperpositionClient.instance) {
      SuperpositionClient.instance = new SuperpositionClient();
    }
    return SuperpositionClient.instance;
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private constructor() {
    this.config = {
      endpoint: config.superposition.endpoint,
      token: encodeBase64(config.superposition.token), // Use the encoded base64 token
      org_id: config.superposition.orgId,
      workspace_id: config.superposition.workspaceId,
      refreshStrategy: {
        interval: config.superposition.pollingInterval ?? 60000,
        timeout: config.superposition.timeout ?? 30000,
      },
    };

    try {
      this.provider = new SuperpositionProvider(this.config);
    } catch (error) {
      logger.error('[SuperpositionClient] Failed to create provider:', error);
    }
  }

  /**
   * Initialize the client and provider
   * Must be called before using feature flags
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!this.provider) {
      throw new Error('SuperpositionProvider not available');
    }

    await OpenFeature.setProviderAndWait(this.provider);
    this.client = OpenFeature.getClient();
    this.isInitialized = true;
  }

  // ============================================================================
  // Public API - Flag Evaluation
  // ============================================================================

  /**
   * Get boolean feature flag value
   * @param flagKey - The feature flag key
   * @param defaultValue - Default value if flag is not found
   * @param context - Optional context for flag evaluation
   * @returns Boolean value of the feature flag
   */
  public async getBooleanValue(
    flagKey: string,
    defaultValue: boolean,
    context?: SuperpositionContext
  ): Promise<boolean> {
    await this.ensureInitialized();
    try {
      return await this.client!.getBooleanValue(flagKey, defaultValue, context);
    } catch (error) {
      logger.error(`[SuperpositionClient] Error getting boolean flag '${flagKey}':`, error);
      return defaultValue;
    }
  }

  /**
   * Get string feature flag value
   * @param flagKey - The feature flag key
   * @param defaultValue - Default value if flag is not found
   * @param context - Optional context for flag evaluation
   * @returns String value of the feature flag
   */
  public async getStringValue(
    flagKey: string,
    defaultValue: string,
    context?: SuperpositionContext
  ): Promise<string> {
    await this.ensureInitialized();
    try {
      return await this.client!.getStringValue(flagKey, defaultValue, context);
    } catch (error) {
      logger.error(`[SuperpositionClient] Error getting string flag '${flagKey}':`, error);
      return defaultValue;
    }
  }

  /**
   * Get number feature flag value
   * @param flagKey - The feature flag key
   * @param defaultValue - Default value if flag is not found
   * @param context - Optional context for flag evaluation
   * @returns Number value of the feature flag
   */
  public async getNumberValue(
    flagKey: string,
    defaultValue: number,
    context?: SuperpositionContext
  ): Promise<number> {
    await this.ensureInitialized();
    try {
      return await this.client!.getNumberValue(flagKey, defaultValue, context);
    } catch (error) {
      logger.error(`[SuperpositionClient] Error getting number flag '${flagKey}':`, error);
      return defaultValue;
    }
  }

  public async getObjectValue(
    flagKey: string,
    defaultValue: JsonValue,
    context?: SuperpositionContext
  ): Promise<JsonValue> {
    await this.ensureInitialized();
    try {
      return await this.client!.getObjectValue(flagKey, defaultValue, context);
    } catch (error) {
      logger.error(`[SuperpositionClient] Error getting object flag '${flagKey}':`, error);
      return defaultValue;
    }
  } 

  /**
   * Resolve all configuration details
   * @param context - Optional context for flag evaluation
   * @returns All resolved configuration with details
   */
  public async resolveAllConfigDetails(
    context?: SuperpositionContext
  ): Promise<ResolvedConfigDetails> {
    await this.ensureInitialized();
    if (!this.provider?.resolveAllConfigDetails) {
      return {};
    }
    try {
      return await this.provider.resolveAllConfigDetails({}, context || {});
    } catch (error) {
      logger.error('[SuperpositionClient] Error resolving all config details:', error);
      return {};
    }
  }

  // ============================================================================
  // State/Status
  // ============================================================================

  /**
   * Check if client is initialized
   */
  public isReady(): boolean {
    return this.isInitialized;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Close the OpenFeature client and cleanup resources
   * Cleans up provider connections, polling intervals, and other resources
   */
  public async close(): Promise<void> {
    try {
      await this.provider?.onClose();
      await OpenFeature.close();
    } catch (error) {
      logger.error('[SuperpositionClient] Error closing client:', error);
    } finally {
      this.isInitialized = false;
      this.client = null;
      this.provider = null;
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Ensure client is initialized before use
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }
}

// Export singleton instance
export const superpositionClient = SuperpositionClient.getInstance();
