/**
 * Xyne AI Agent Configuration
 * 
 * Context-aware configuration (CAC) for the Xyne AI agent.
 * Fetches configuration values from Superposition at runtime.
 * 
 * Usage:
 * 1. Fetch config once at the start of each request in the controller
 * 2. Pass the config object to xyneAIStream and other functions that need it
 */

import { superpositionClient, type SuperpositionContext } from '@/services/superpositionClient';
import { logger } from '@/utils/logger';

// ============================================================================
// Default Values
// ============================================================================

const DEFAULT_TRACING_ENABLED = true;
const DEFAULT_MASKING_ENABLED = true;
const DEFAULT_MODEL_NAME = 'private-large';
const DEFAULT_VISION_MODEL_NAME = 'private-large';

// ============================================================================
// Configuration Class
// ============================================================================

/**
 * XyneAIConfig class - holds all CAC configuration values for a single request
 * Fetched once per request in the controller and passed to relevant modules
 */
export class XyneAIConfig {
  public readonly tracingEnabled: boolean;
  public readonly maskingEnabled: boolean;
  public readonly modelName: string;
  public readonly visionModelName: string;

  private constructor(
    tracingEnabled: boolean,
    maskingEnabled: boolean,
    modelName: string,
    visionModelName: string
  ) {
    this.tracingEnabled = tracingEnabled;
    this.maskingEnabled = maskingEnabled;
    this.modelName = modelName;
    this.visionModelName = visionModelName;
  }

  /**
   * Fetch XyneAI configuration from Superposition (CAC)
   * Call this once per request in the controller
   * 
   * @param context - Optional Superposition context for flag evaluation (e.g., email)
   * @returns XyneAIConfig instance with all configuration values
   * 
   * @example
   * ```typescript
   * // In controller, fetch config with context
   * const xyneAIConfig = await XyneAIConfig.fetch({ email: userInfo.userEmail });
   * 
   * // Pass to xyneAIStream
   * const streamGenerator = xyneAIStream({ ...request, xyneAIConfig });
   * ```
   */
  public static async fetch(context?: SuperpositionContext): Promise<XyneAIConfig> {
    try {
      // Fetch all config values in a single call using resolveAllConfigDetails
      const allConfigs = await superpositionClient.resolveAllConfigDetails(context);
      
      // Extract values from resolved configs, falling back to defaults if not present
      const tracingEnabled = allConfigs['xyne_ai_tracing_enabled']?.value as boolean ?? DEFAULT_TRACING_ENABLED;
      const maskingEnabled = allConfigs['xyne_ai_masking_enabled']?.value as boolean ?? DEFAULT_MASKING_ENABLED;
      const modelName = allConfigs['xyne_ai_model_name']?.value as string ?? DEFAULT_MODEL_NAME;
      const visionModelName = allConfigs['xyne_ai_vision_model_name']?.value as string ?? DEFAULT_VISION_MODEL_NAME;

      // Check which values were actually fetched from CAC vs using defaults
      const fromCAC: string[] = [];
      const usingDefaults: string[] = [];
      
      if ('xyne_ai_tracing_enabled' in allConfigs) {
        fromCAC.push('xyne_ai_tracing_enabled');
      } else {
        usingDefaults.push('xyne_ai_tracing_enabled');
      }
      
      if ('xyne_ai_masking_enabled' in allConfigs) {
        fromCAC.push('xyne_ai_masking_enabled');
      } else {
        usingDefaults.push('xyne_ai_masking_enabled');
      }
      
      if ('xyne_ai_model_name' in allConfigs) {
        fromCAC.push('xyne_ai_model_name');
      } else {
        usingDefaults.push('xyne_ai_model_name');
      }
      
      if ('xyne_ai_vision_model_name' in allConfigs) {
        fromCAC.push('xyne_ai_vision_model_name');
      } else {
        usingDefaults.push('xyne_ai_vision_model_name');
      }

      if (usingDefaults.length === 4) {
        logger.info('[XyneAI Config] All configs using DEFAULTS (not configured in CAC)', {
          tracingEnabled: `${tracingEnabled} (default)`,
          maskingEnabled: `${maskingEnabled} (default)`,
          modelName: `${modelName} (default)`,
          visionModelName: `${visionModelName} (default)`,
        });
      } else if (usingDefaults.length > 0) {
        logger.info('[XyneAI Config] Fetched CAC config (some using defaults)', {
          tracingEnabled: usingDefaults.includes('xyne_ai_tracing_enabled') ? `${tracingEnabled} (default)` : `${tracingEnabled} (CAC)`,
          maskingEnabled: usingDefaults.includes('xyne_ai_masking_enabled') ? `${maskingEnabled} (default)` : `${maskingEnabled} (CAC)`,
          modelName: usingDefaults.includes('xyne_ai_model_name') ? `${modelName} (default)` : `${modelName} (CAC)`,
          visionModelName: usingDefaults.includes('xyne_ai_vision_model_name') ? `${visionModelName} (default)` : `${visionModelName} (CAC)`,
          fromCAC,
          usingDefaults,
        });
      } else {
        logger.info('[XyneAI Config] Fetched CAC config (all from CAC)', {
          tracingEnabled: `${tracingEnabled} (CAC)`,
          maskingEnabled: `${maskingEnabled} (CAC)`,
          modelName: `${modelName} (CAC)`,
          visionModelName: `${visionModelName} (CAC)`,
        });
      }

      return new XyneAIConfig(tracingEnabled, maskingEnabled, modelName, visionModelName);
    } catch (error) {
      logger.error('[XyneAI Config] Error fetching CAC config, using DEFAULTS:', error);
      
      return new XyneAIConfig(
        DEFAULT_TRACING_ENABLED,
        DEFAULT_MASKING_ENABLED,
        DEFAULT_MODEL_NAME,
        DEFAULT_VISION_MODEL_NAME
      );
    }
  }

  /**
   * Create a default config instance (for fallback scenarios)
   */
  public static defaults(): XyneAIConfig {
    return new XyneAIConfig(
      DEFAULT_TRACING_ENABLED,
      DEFAULT_MASKING_ENABLED,
      DEFAULT_MODEL_NAME,
      DEFAULT_VISION_MODEL_NAME
    );
  }
}
