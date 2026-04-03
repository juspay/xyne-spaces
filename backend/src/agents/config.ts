/**
 * Shared Agents Configuration
 * 
 * Context-aware configuration (CAC) for all agents.
 * Fetches model names and other configuration values from Superposition at runtime.
 * 
 * Usage:
 * ```typescript
 * import { AgentsConfig } from '@/agents/config';
 * 
 * // Fetch config (usually at the start of a request)
 * const config = await AgentsConfig.fetch({ email: userInfo.userEmail });
 * 
 * // Use model names
 * const modelName = config.xyneAiModelName;
 * const duplicateModel = config.ticketDuplicateModelName;
 * ```
 */

import { superpositionClient, type SuperpositionContext } from '@/services/superpositionClient';
import { logger } from '@/utils/logger';

// ============================================================================
// Default Values
// ============================================================================

// Xyne AI defaults
const DEFAULT_XYNE_AI_TRACING_ENABLED = true;
const DEFAULT_XYNE_AI_MASKING_ENABLED = true;
const DEFAULT_XYNE_AI_MODEL_NAME = 'private-large';
const DEFAULT_XYNE_AI_VISION_MODEL_NAME = 'private-large';

// Other agents defaults
const DEFAULT_TICKET_DUPLICATE_MODEL = 'glm-flash-experimental';
const DEFAULT_TITLE_GENERATOR_MODEL = 'glm-flash-experimental';
const DEFAULT_TICKET_BOARD_MODEL = 'glm-flash-experimental';
const DEFAULT_RELEASE_NOTES_GENERATOR_MODEL = 'glm-latest';
// ============================================================================
// CAC Keys
// ============================================================================

const CAC_KEYS = {
  // Xyne AI keys
  xyneAiTracingEnabled: 'xyne_ai_tracing_enabled',
  xyneAiMaskingEnabled: 'xyne_ai_masking_enabled',
  xyneAiModelName: 'xyne_ai_model_name',
  xyneAiVisionModelName: 'xyne_ai_vision_model_name',
  // Other agents keys
  ticketDuplicateModel: 'ticket_duplicate_model_name',
  titleGeneratorModel: 'title_generator_model_name',
  ticketBoardModel: 'ticket_board_model_name',
  releaseNotesGeneratorModel: 'release_notes_generator_model_name',
} as const;

// ============================================================================
// Configuration Class
// ============================================================================

/**
 * AgentsConfig class - holds CAC configuration values for all agents
 * Fetched once per request in the controller and passed to relevant modules
 */
export class AgentsConfig {
  // Xyne AI config
  public readonly xyneAiTracingEnabled: boolean;
  public readonly xyneAiMaskingEnabled: boolean;
  public readonly xyneAiModelName: string;
  public readonly xyneAiVisionModelName: string;

  // Other agents config
  public readonly ticketDuplicateModelName: string;
  public readonly titleGeneratorModelName: string;
  public readonly ticketBoardModelName: string;
  public readonly releaseNotesGeneratorModelName: string;

  private constructor(
    xyneAiTracingEnabled: boolean,
    xyneAiMaskingEnabled: boolean,
    xyneAiModelName: string,
    xyneAiVisionModelName: string,
    ticketDuplicateModelName: string,
    titleGeneratorModelName: string,
    ticketBoardModelName: string,
    releaseNotesGeneratorModelName: string
  ) {
    this.xyneAiTracingEnabled = xyneAiTracingEnabled;
    this.xyneAiMaskingEnabled = xyneAiMaskingEnabled;
    this.xyneAiModelName = xyneAiModelName;
    this.xyneAiVisionModelName = xyneAiVisionModelName;
    this.ticketDuplicateModelName = ticketDuplicateModelName;
    this.titleGeneratorModelName = titleGeneratorModelName;
    this.ticketBoardModelName = ticketBoardModelName;
    this.releaseNotesGeneratorModelName = releaseNotesGeneratorModelName;
  }

  /**
   * Fetch agents configuration from Superposition (CAC)
   * Call this once per request in the controller
   * 
   * @param context - Optional Superposition context for flag evaluation (e.g., email)
   * @returns AgentsConfig instance with all configuration values
   * 
   * @example
   * ```typescript
   * // In controller, fetch config with context
   * const agentsConfig = await AgentsConfig.fetch({ email: userInfo.userEmail });
   * 
   * // Pass to xyneAIStream
   * const streamGenerator = xyneAIStream({ ...request, agentsConfig });
   * ```
   */
  public static async fetch(context?: SuperpositionContext): Promise<AgentsConfig> {
    try {
      // Fetch all config values in a single call
      const allConfigs = await superpositionClient.resolveAllConfigDetails(context);

      // Helper to extract value - handles both wrapped {value: x} and direct values
      const getValue = <T>(key: string, defaultValue: T): T => {
        const entry = allConfigs[key];
        if (entry === undefined || entry === null) return defaultValue;
        // Check if it's wrapped in {value: ...} or a direct value
        if (typeof entry === 'object' && 'value' in entry) {
          return (entry.value as T) ?? defaultValue;
        }
        return entry as T;
      };

      // Extract Xyne AI values
      const xyneAiTracingEnabled = getValue<boolean>(CAC_KEYS.xyneAiTracingEnabled, DEFAULT_XYNE_AI_TRACING_ENABLED);
      const xyneAiMaskingEnabled = getValue<boolean>(CAC_KEYS.xyneAiMaskingEnabled, DEFAULT_XYNE_AI_MASKING_ENABLED);
      const xyneAiModelName = getValue<string>(CAC_KEYS.xyneAiModelName, DEFAULT_XYNE_AI_MODEL_NAME);
      const xyneAiVisionModelName = getValue<string>(CAC_KEYS.xyneAiVisionModelName, DEFAULT_XYNE_AI_VISION_MODEL_NAME);

      // Extract other agents values
      const ticketDuplicateModelName = getValue<string>(CAC_KEYS.ticketDuplicateModel, DEFAULT_TICKET_DUPLICATE_MODEL);
      const titleGeneratorModelName = getValue<string>(CAC_KEYS.titleGeneratorModel, DEFAULT_TITLE_GENERATOR_MODEL);
      const ticketBoardModelName = getValue<string>(CAC_KEYS.ticketBoardModel, DEFAULT_TICKET_BOARD_MODEL);
      const releaseNotesGeneratorModelName = getValue<string>(CAC_KEYS.releaseNotesGeneratorModel, DEFAULT_RELEASE_NOTES_GENERATOR_MODEL);

      // Check which values were actually fetched from CAC vs using defaults
      const fromCAC: string[] = [];
      const usingDefaults: string[] = [];

      // Check Xyne AI keys
      if (CAC_KEYS.xyneAiTracingEnabled in allConfigs) {
        fromCAC.push(CAC_KEYS.xyneAiTracingEnabled);
      } else {
        usingDefaults.push(CAC_KEYS.xyneAiTracingEnabled);
      }

      if (CAC_KEYS.xyneAiMaskingEnabled in allConfigs) {
        fromCAC.push(CAC_KEYS.xyneAiMaskingEnabled);
      } else {
        usingDefaults.push(CAC_KEYS.xyneAiMaskingEnabled);
      }

      if (CAC_KEYS.xyneAiModelName in allConfigs) {
        fromCAC.push(CAC_KEYS.xyneAiModelName);
      } else {
        usingDefaults.push(CAC_KEYS.xyneAiModelName);
      }

      if (CAC_KEYS.xyneAiVisionModelName in allConfigs) {
        fromCAC.push(CAC_KEYS.xyneAiVisionModelName);
      } else {
        usingDefaults.push(CAC_KEYS.xyneAiVisionModelName);
      }

      // Check other agents keys
      if (CAC_KEYS.ticketDuplicateModel in allConfigs) {
        fromCAC.push(CAC_KEYS.ticketDuplicateModel);
      } else {
        usingDefaults.push(CAC_KEYS.ticketDuplicateModel);
      }

      if (CAC_KEYS.titleGeneratorModel in allConfigs) {
        fromCAC.push(CAC_KEYS.titleGeneratorModel);
      } else {
        usingDefaults.push(CAC_KEYS.titleGeneratorModel);
      }

      if (CAC_KEYS.ticketBoardModel in allConfigs) {
        fromCAC.push(CAC_KEYS.ticketBoardModel);
      } else {
        usingDefaults.push(CAC_KEYS.ticketBoardModel);
      }

      if (CAC_KEYS.releaseNotesGeneratorModel in allConfigs) {
        fromCAC.push(CAC_KEYS.releaseNotesGeneratorModel);
      } else {
        usingDefaults.push(CAC_KEYS.releaseNotesGeneratorModel);
      }

      const totalKeys = 8;
      if (usingDefaults.length === totalKeys) {
        logger.debug('[Agents Config] All configs using DEFAULTS (not configured in CAC)', {
          xyneAiTracingEnabled: `${xyneAiTracingEnabled} (default)`,
          xyneAiMaskingEnabled: `${xyneAiMaskingEnabled} (default)`,
          xyneAiModelName: `${xyneAiModelName} (default)`,
          xyneAiVisionModelName: `${xyneAiVisionModelName} (default)`,
          ticketDuplicateModelName: `${ticketDuplicateModelName} (default)`,
          titleGeneratorModelName: `${titleGeneratorModelName} (default)`,
          ticketBoardModelName: `${ticketBoardModelName} (default)`,
          releaseNotesGeneratorModelName: `${releaseNotesGeneratorModelName} (default)`,
        });
      } else if (usingDefaults.length > 0) {
        logger.info('[Agents Config] Fetched CAC config (some using defaults)', {
          xyneAiTracingEnabled: usingDefaults.includes(CAC_KEYS.xyneAiTracingEnabled)
            ? `${xyneAiTracingEnabled} (default)`
            : `${xyneAiTracingEnabled} (CAC)`,
          xyneAiMaskingEnabled: usingDefaults.includes(CAC_KEYS.xyneAiMaskingEnabled)
            ? `${xyneAiMaskingEnabled} (default)`
            : `${xyneAiMaskingEnabled} (CAC)`,
          xyneAiModelName: usingDefaults.includes(CAC_KEYS.xyneAiModelName)
            ? `${xyneAiModelName} (default)`
            : `${xyneAiModelName} (CAC)`,
          xyneAiVisionModelName: usingDefaults.includes(CAC_KEYS.xyneAiVisionModelName)
            ? `${xyneAiVisionModelName} (default)`
            : `${xyneAiVisionModelName} (CAC)`,
          ticketDuplicateModelName: usingDefaults.includes(CAC_KEYS.ticketDuplicateModel)
            ? `${ticketDuplicateModelName} (default)`
            : `${ticketDuplicateModelName} (CAC)`,
          titleGeneratorModelName: usingDefaults.includes(CAC_KEYS.titleGeneratorModel)
            ? `${titleGeneratorModelName} (default)`
            : `${titleGeneratorModelName} (CAC)`,
          ticketBoardModelName: usingDefaults.includes(CAC_KEYS.ticketBoardModel)
            ? `${ticketBoardModelName} (default)`
            : `${ticketBoardModelName} (CAC)`,
          releaseNotesGeneratorModelName: usingDefaults.includes(CAC_KEYS.releaseNotesGeneratorModel)
            ? `${releaseNotesGeneratorModelName} (default)`
            : `${releaseNotesGeneratorModelName} (CAC)`,
          fromCAC,
          usingDefaults,
        });
      } else {
        logger.info('[Agents Config] Fetched CAC config (all from CAC)', {
          xyneAiTracingEnabled: `${xyneAiTracingEnabled} (CAC)`,
          xyneAiMaskingEnabled: `${xyneAiMaskingEnabled} (CAC)`,
          xyneAiModelName: `${xyneAiModelName} (CAC)`,
          xyneAiVisionModelName: `${xyneAiVisionModelName} (CAC)`,
          ticketDuplicateModelName: `${ticketDuplicateModelName} (CAC)`,
          titleGeneratorModelName: `${titleGeneratorModelName} (CAC)`,
          ticketBoardModelName: `${ticketBoardModelName} (CAC)`,
          releaseNotesGeneratorModelName: `${releaseNotesGeneratorModelName} (CAC)`,
        });
      }

      return new AgentsConfig(
        xyneAiTracingEnabled,
        xyneAiMaskingEnabled,
        xyneAiModelName,
        xyneAiVisionModelName,
        ticketDuplicateModelName,
        titleGeneratorModelName,
        ticketBoardModelName,
        releaseNotesGeneratorModelName
      );
    } catch (error) {
      logger.error('[Agents Config] Error fetching CAC config, using DEFAULTS:', error);

      return new AgentsConfig(
        DEFAULT_XYNE_AI_TRACING_ENABLED,
        DEFAULT_XYNE_AI_MASKING_ENABLED,
        DEFAULT_XYNE_AI_MODEL_NAME,
        DEFAULT_XYNE_AI_VISION_MODEL_NAME,
        DEFAULT_TICKET_DUPLICATE_MODEL,
        DEFAULT_TITLE_GENERATOR_MODEL,
        DEFAULT_TICKET_BOARD_MODEL,
        DEFAULT_RELEASE_NOTES_GENERATOR_MODEL
      );
    }
  }

  public static defaults(): AgentsConfig {
    return new AgentsConfig(
      DEFAULT_XYNE_AI_TRACING_ENABLED,
      DEFAULT_XYNE_AI_MASKING_ENABLED,
      DEFAULT_XYNE_AI_MODEL_NAME,
      DEFAULT_XYNE_AI_VISION_MODEL_NAME,
      DEFAULT_TICKET_DUPLICATE_MODEL,
      DEFAULT_TITLE_GENERATOR_MODEL,
      DEFAULT_TICKET_BOARD_MODEL,
      DEFAULT_RELEASE_NOTES_GENERATOR_MODEL
    );
  }
}

