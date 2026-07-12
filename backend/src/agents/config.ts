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
import { config as envConfig } from '@/config/env';
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
const DEFAULT_TAG_GENERATION_MODEL = 'private-large';
const DEFAULT_TICKET_BOARD_MODEL = 'glm-flash-experimental';
const DEFAULT_RELEASE_NOTES_GENERATOR_MODEL = 'glm-latest';
const DEFAULT_SUMMARISER_MODEL = 'glm-flash-experimental';
const DEFAULT_ATTACHMENT_SUMMARISER_MODEL = 'kimi-latest';
const DEFAULT_CLASSIFICATION_MODEL = 'glm-flash-experimental';
const DEFAULT_DATA_SOURCE_INGEST_TABLE_LIMIT = envConfig.dataSource.ingestTableLimit;
const DEFAULT_EMAIL_QUICK_REWRITE_MODEL = 'glm-flash-experimental';

// Nudge agents defaults
const DEFAULT_NUDGE_CREATE_TICKET_MODEL = 'glm-flash-experimental';
const DEFAULT_NUDGE_RELATED_TICKET_MODEL = 'glm-flash-experimental';
const DEFAULT_NUDGE_RELATED_MESSAGE_MODEL = 'glm-flash-experimental';

// Xyne AI per-tool soft token budgets.
const DEFAULT_XYNE_AI_TOOL_BUDGET_SEARCH_RELEVANT_CONTENT = 10000;
const DEFAULT_XYNE_AI_TOOL_BUDGET_FETCH_CHANNEL_MESSAGES = 40000;
const DEFAULT_XYNE_AI_TOOL_BUDGET_FETCH_THREAD_MESSAGES = 20000;
const DEFAULT_XYNE_AI_TOOL_BUDGET_FETCH_LINK_CONTENT = 20000;
const DEFAULT_XYNE_AI_TOOL_BUDGET_USER_ACTIVITY = 50000;
const DEFAULT_XYNE_AI_TOOL_BUDGET_SEARCH_FILES = 10000;

// Xyne AI session-history compaction thresholds. Trigger > estimated full
// input tokens (baseline + history + current query) → drop oldest turn pairs
// until <= target. Sized for a 256k model window with ~16k baseline overhead
// and up to ~80k tool trajectory + ~8k response growth during the turn, which
// leaves ~170k as the safe pre-turn ceiling. Gap between trigger and target
// prevents thrashing when the next turn is also near the edge.
const DEFAULT_XYNE_AI_HISTORY_COMPACTION_TRIGGER = 170000;
const DEFAULT_XYNE_AI_HISTORY_COMPACTION_TARGET = 120000;

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
  tagGenerationModel: 'tag_generation_model_name',
  ticketBoardModel: 'ticket_board_model_name',
  releaseNotesGeneratorModel: 'release_notes_generator_model_name',
  summariserModel: 'summariser_model_name',
  attachmentSummariserModel: 'attachment_summariser_model_name',
  nudgeCreateTicketModel: 'nudge_create_ticket_model_name',
  nudgeRelatedTicketModel: 'nudge_related_ticket_model_name',
  nudgeRelatedMessageModel: 'nudge_related_message_model_name',
  classificationModel: 'email_classification_model_name',
  // Dashboard data source
  dataSourceIngestTableLimit: 'data_source_ingest_table_limit',
  emailQuickRewriteModel: 'email_quick_rewrite_model_name',
  // Xyne AI per-tool soft token budgets
  xyneAiToolBudgetSearchRelevantContent: 'xyne_ai_tool_budget_search_relevant_content',
  xyneAiToolBudgetFetchChannelMessages: 'xyne_ai_tool_budget_fetch_channel_messages',
  xyneAiToolBudgetFetchThreadMessages: 'xyne_ai_tool_budget_fetch_thread_messages',
  xyneAiToolBudgetFetchLinkContent: 'xyne_ai_tool_budget_fetch_link_content',
  xyneAiToolBudgetUserActivity: 'xyne_ai_tool_budget_user_activity',
  xyneAiToolBudgetSearchFiles: 'xyne_ai_tool_budget_search_files',
  // Xyne AI session-history compaction thresholds
  xyneAiHistoryCompactionTrigger: 'xyne_ai_history_compaction_trigger',
  xyneAiHistoryCompactionTarget: 'xyne_ai_history_compaction_target',
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
  public readonly tagGenerationModelName: string;
  public readonly ticketBoardModelName: string;
  public readonly releaseNotesGeneratorModelName: string;
  public readonly summariserModelName: string;
  public readonly attachmentSummariserModelName: string;

  // Nudge agents config
  public readonly nudgeCreateTicketModelName: string;
  public readonly nudgeRelatedTicketModelName: string;
  public readonly nudgeRelatedMessageModelName: string;

  // Email classification config
  public readonly classificationModelName: string;

  // Email quick rewrite config
  public readonly emailQuickRewriteModelName: string;

  // Xyne AI per-tool soft token budgets
  public readonly xyneAiToolBudgetSearchRelevantContent: number;
  public readonly xyneAiToolBudgetFetchChannelMessages: number;
  public readonly xyneAiToolBudgetFetchThreadMessages: number;
  public readonly xyneAiToolBudgetFetchLinkContent: number;
  public readonly xyneAiToolBudgetUserActivity: number;
  public readonly xyneAiToolBudgetSearchFiles: number;

  // Xyne AI session-history compaction thresholds
  public readonly xyneAiHistoryCompactionTrigger: number;
  public readonly xyneAiHistoryCompactionTarget: number;

  // Dashboard data-source ingest cap (UI + API + LLM prompt)
  public readonly dataSourceIngestTableLimit: number;

  private constructor(
    xyneAiTracingEnabled: boolean,
    xyneAiMaskingEnabled: boolean,
    xyneAiModelName: string,
    xyneAiVisionModelName: string,
    ticketDuplicateModelName: string,
    titleGeneratorModelName: string,
    tagGenerationModelName: string,
    ticketBoardModelName: string,
    releaseNotesGeneratorModelName: string,
    summariserModelName: string,
    attachmentSummariserModelName: string,
    nudgeCreateTicketModelName: string,
    nudgeRelatedTicketModelName: string,
    nudgeRelatedMessageModelName: string,
    classificationModelName: string,
    emailQuickRewriteModelName: string,
    xyneAiToolBudgetSearchRelevantContent: number,
    xyneAiToolBudgetFetchChannelMessages: number,
    xyneAiToolBudgetFetchThreadMessages: number,
    xyneAiToolBudgetFetchLinkContent: number,
    xyneAiToolBudgetUserActivity: number,
    xyneAiToolBudgetSearchFiles: number,
    xyneAiHistoryCompactionTrigger: number,
    xyneAiHistoryCompactionTarget: number,
    dataSourceIngestTableLimit: number,
  ) {
    this.xyneAiTracingEnabled = xyneAiTracingEnabled;
    this.xyneAiMaskingEnabled = xyneAiMaskingEnabled;
    this.xyneAiModelName = xyneAiModelName;
    this.xyneAiVisionModelName = xyneAiVisionModelName;
    this.ticketDuplicateModelName = ticketDuplicateModelName;
    this.titleGeneratorModelName = titleGeneratorModelName;
    this.tagGenerationModelName = tagGenerationModelName;
    this.ticketBoardModelName = ticketBoardModelName;
    this.releaseNotesGeneratorModelName = releaseNotesGeneratorModelName;
    this.summariserModelName = summariserModelName;
    this.attachmentSummariserModelName = attachmentSummariserModelName;
    this.nudgeCreateTicketModelName = nudgeCreateTicketModelName;
    this.nudgeRelatedTicketModelName = nudgeRelatedTicketModelName;
    this.nudgeRelatedMessageModelName = nudgeRelatedMessageModelName;
    this.classificationModelName = classificationModelName;
    this.emailQuickRewriteModelName = emailQuickRewriteModelName;
    this.xyneAiToolBudgetSearchRelevantContent = xyneAiToolBudgetSearchRelevantContent;
    this.xyneAiToolBudgetFetchChannelMessages = xyneAiToolBudgetFetchChannelMessages;
    this.xyneAiToolBudgetFetchThreadMessages = xyneAiToolBudgetFetchThreadMessages;
    this.xyneAiToolBudgetFetchLinkContent = xyneAiToolBudgetFetchLinkContent;
    this.xyneAiToolBudgetUserActivity = xyneAiToolBudgetUserActivity;
    this.xyneAiToolBudgetSearchFiles = xyneAiToolBudgetSearchFiles;
    this.xyneAiHistoryCompactionTrigger = xyneAiHistoryCompactionTrigger;
    this.xyneAiHistoryCompactionTarget = xyneAiHistoryCompactionTarget;
    this.dataSourceIngestTableLimit = dataSourceIngestTableLimit;
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
      const tagGenerationModelName = getValue<string>(CAC_KEYS.tagGenerationModel, DEFAULT_TAG_GENERATION_MODEL);
      const ticketBoardModelName = getValue<string>(CAC_KEYS.ticketBoardModel, DEFAULT_TICKET_BOARD_MODEL);
      const releaseNotesGeneratorModelName = getValue<string>(CAC_KEYS.releaseNotesGeneratorModel, DEFAULT_RELEASE_NOTES_GENERATOR_MODEL);
      const summariserModelName = getValue<string>(CAC_KEYS.summariserModel, DEFAULT_SUMMARISER_MODEL);
      const attachmentSummariserModelName = getValue<string>(CAC_KEYS.attachmentSummariserModel, DEFAULT_ATTACHMENT_SUMMARISER_MODEL);

      // Extract nudge agents values
      const nudgeCreateTicketModelName = getValue<string>(CAC_KEYS.nudgeCreateTicketModel, DEFAULT_NUDGE_CREATE_TICKET_MODEL);
      const nudgeRelatedTicketModelName = getValue<string>(CAC_KEYS.nudgeRelatedTicketModel, DEFAULT_NUDGE_RELATED_TICKET_MODEL);
      const nudgeRelatedMessageModelName = getValue<string>(CAC_KEYS.nudgeRelatedMessageModel, DEFAULT_NUDGE_RELATED_MESSAGE_MODEL);
      const classificationModelName = getValue<string>(CAC_KEYS.classificationModel, DEFAULT_CLASSIFICATION_MODEL);
      const emailQuickRewriteModelName = getValue<string>(CAC_KEYS.emailQuickRewriteModel, DEFAULT_EMAIL_QUICK_REWRITE_MODEL);

      // Extract Xyne AI tool budget values
      const xyneAiToolBudgetSearchRelevantContent = getValue<number>(CAC_KEYS.xyneAiToolBudgetSearchRelevantContent, DEFAULT_XYNE_AI_TOOL_BUDGET_SEARCH_RELEVANT_CONTENT);
      const xyneAiToolBudgetFetchChannelMessages = getValue<number>(CAC_KEYS.xyneAiToolBudgetFetchChannelMessages, DEFAULT_XYNE_AI_TOOL_BUDGET_FETCH_CHANNEL_MESSAGES);
      const xyneAiToolBudgetFetchThreadMessages = getValue<number>(CAC_KEYS.xyneAiToolBudgetFetchThreadMessages, DEFAULT_XYNE_AI_TOOL_BUDGET_FETCH_THREAD_MESSAGES);
      const xyneAiToolBudgetFetchLinkContent = getValue<number>(CAC_KEYS.xyneAiToolBudgetFetchLinkContent, DEFAULT_XYNE_AI_TOOL_BUDGET_FETCH_LINK_CONTENT);
      const xyneAiToolBudgetUserActivity = getValue<number>(CAC_KEYS.xyneAiToolBudgetUserActivity, DEFAULT_XYNE_AI_TOOL_BUDGET_USER_ACTIVITY);
      const xyneAiToolBudgetSearchFiles = getValue<number>(CAC_KEYS.xyneAiToolBudgetSearchFiles, DEFAULT_XYNE_AI_TOOL_BUDGET_SEARCH_FILES);

      // Extract Xyne AI history compaction thresholds
      const xyneAiHistoryCompactionTrigger = getValue<number>(CAC_KEYS.xyneAiHistoryCompactionTrigger, DEFAULT_XYNE_AI_HISTORY_COMPACTION_TRIGGER);
      const xyneAiHistoryCompactionTarget = getValue<number>(CAC_KEYS.xyneAiHistoryCompactionTarget, DEFAULT_XYNE_AI_HISTORY_COMPACTION_TARGET);

      // Extract dashboard data-source ingest cap
      const dataSourceIngestTableLimit = getValue<number>(CAC_KEYS.dataSourceIngestTableLimit, DEFAULT_DATA_SOURCE_INGEST_TABLE_LIMIT);

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

      if (CAC_KEYS.tagGenerationModel in allConfigs) {
        fromCAC.push(CAC_KEYS.tagGenerationModel);
      } else {
        usingDefaults.push(CAC_KEYS.tagGenerationModel);
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

      if (CAC_KEYS.summariserModel in allConfigs) {
        fromCAC.push(CAC_KEYS.summariserModel);
      } else {
        usingDefaults.push(CAC_KEYS.summariserModel);
      }

      if (CAC_KEYS.attachmentSummariserModel in allConfigs) {
        fromCAC.push(CAC_KEYS.attachmentSummariserModel);
      } else {
        usingDefaults.push(CAC_KEYS.attachmentSummariserModel);
      }

      if (CAC_KEYS.nudgeCreateTicketModel in allConfigs) {
        fromCAC.push(CAC_KEYS.nudgeCreateTicketModel);
      } else {
        usingDefaults.push(CAC_KEYS.nudgeCreateTicketModel);
      }

      if (CAC_KEYS.nudgeRelatedTicketModel in allConfigs) {
        fromCAC.push(CAC_KEYS.nudgeRelatedTicketModel);
      } else {
        usingDefaults.push(CAC_KEYS.nudgeRelatedTicketModel);
      }

      if (CAC_KEYS.nudgeRelatedMessageModel in allConfigs) {
        fromCAC.push(CAC_KEYS.nudgeRelatedMessageModel);
      } else {
        usingDefaults.push(CAC_KEYS.nudgeRelatedMessageModel);
      }

      if (CAC_KEYS.classificationModel in allConfigs) {
        fromCAC.push(CAC_KEYS.classificationModel);
      } else {
        usingDefaults.push(CAC_KEYS.classificationModel);
      }

      if (CAC_KEYS.xyneAiToolBudgetSearchRelevantContent in allConfigs) {
        fromCAC.push(CAC_KEYS.xyneAiToolBudgetSearchRelevantContent);
      } else {
        usingDefaults.push(CAC_KEYS.xyneAiToolBudgetSearchRelevantContent);
      }

      if (CAC_KEYS.xyneAiToolBudgetFetchChannelMessages in allConfigs) {
        fromCAC.push(CAC_KEYS.xyneAiToolBudgetFetchChannelMessages);
      } else {
        usingDefaults.push(CAC_KEYS.xyneAiToolBudgetFetchChannelMessages);
      }

      if (CAC_KEYS.xyneAiToolBudgetFetchThreadMessages in allConfigs) {
        fromCAC.push(CAC_KEYS.xyneAiToolBudgetFetchThreadMessages);
      } else {
        usingDefaults.push(CAC_KEYS.xyneAiToolBudgetFetchThreadMessages);
      }

      if (CAC_KEYS.xyneAiToolBudgetFetchLinkContent in allConfigs) {
        fromCAC.push(CAC_KEYS.xyneAiToolBudgetFetchLinkContent);
      } else {
        usingDefaults.push(CAC_KEYS.xyneAiToolBudgetFetchLinkContent);
      }

      if (CAC_KEYS.xyneAiToolBudgetUserActivity in allConfigs) {
        fromCAC.push(CAC_KEYS.xyneAiToolBudgetUserActivity);
      } else {
        usingDefaults.push(CAC_KEYS.xyneAiToolBudgetUserActivity);
      }

      if (CAC_KEYS.xyneAiToolBudgetSearchFiles in allConfigs) {
        fromCAC.push(CAC_KEYS.xyneAiToolBudgetSearchFiles);
      } else {
        usingDefaults.push(CAC_KEYS.xyneAiToolBudgetSearchFiles);
      }

      if (CAC_KEYS.xyneAiHistoryCompactionTrigger in allConfigs) {
        fromCAC.push(CAC_KEYS.xyneAiHistoryCompactionTrigger);
      } else {
        usingDefaults.push(CAC_KEYS.xyneAiHistoryCompactionTrigger);
      }

      if (CAC_KEYS.xyneAiHistoryCompactionTarget in allConfigs) {
        fromCAC.push(CAC_KEYS.xyneAiHistoryCompactionTarget);
      } else {
        usingDefaults.push(CAC_KEYS.xyneAiHistoryCompactionTarget);
      }

      if (CAC_KEYS.dataSourceIngestTableLimit in allConfigs) {
        fromCAC.push(CAC_KEYS.dataSourceIngestTableLimit);
      } else {
        usingDefaults.push(CAC_KEYS.dataSourceIngestTableLimit);
      }

      const totalKeys = 25;
      if (usingDefaults.length === totalKeys) {
        logger.debug('[Agents Config] All configs using DEFAULTS (not configured in CAC)', {
          xyneAiTracingEnabled: `${xyneAiTracingEnabled} (default)`,
          xyneAiMaskingEnabled: `${xyneAiMaskingEnabled} (default)`,
          xyneAiModelName: `${xyneAiModelName} (default)`,
          xyneAiVisionModelName: `${xyneAiVisionModelName} (default)`,
          ticketDuplicateModelName: `${ticketDuplicateModelName} (default)`,
          titleGeneratorModelName: `${titleGeneratorModelName} (default)`,
          tagGenerationModelName: `${tagGenerationModelName} (default)`,
          ticketBoardModelName: `${ticketBoardModelName} (default)`,
          releaseNotesGeneratorModelName: `${releaseNotesGeneratorModelName} (default)`,
          summariserModelName: `${summariserModelName} (default)`,
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
          tagGenerationModelName: usingDefaults.includes(CAC_KEYS.tagGenerationModel)
            ? `${tagGenerationModelName} (default)`
            : `${tagGenerationModelName} (CAC)`,
          ticketBoardModelName: usingDefaults.includes(CAC_KEYS.ticketBoardModel)
            ? `${ticketBoardModelName} (default)`
            : `${ticketBoardModelName} (CAC)`,
          releaseNotesGeneratorModelName: usingDefaults.includes(CAC_KEYS.releaseNotesGeneratorModel)
            ? `${releaseNotesGeneratorModelName} (default)`
            : `${releaseNotesGeneratorModelName} (CAC)`,
          summariserModelName: usingDefaults.includes(CAC_KEYS.summariserModel)
            ? `${summariserModelName} (default)`
            : `${summariserModelName} (CAC)`,
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
          tagGenerationModelName: `${tagGenerationModelName} (CAC)`,
          ticketBoardModelName: `${ticketBoardModelName} (CAC)`,
          releaseNotesGeneratorModelName: `${releaseNotesGeneratorModelName} (CAC)`,
          summariserModelName: `${summariserModelName} (CAC)`,
        });
      }

      return new AgentsConfig(
        xyneAiTracingEnabled,
        xyneAiMaskingEnabled,
        xyneAiModelName,
        xyneAiVisionModelName,
        ticketDuplicateModelName,
        titleGeneratorModelName,
        tagGenerationModelName,
        ticketBoardModelName,
        releaseNotesGeneratorModelName,
        summariserModelName,
        attachmentSummariserModelName,
        nudgeCreateTicketModelName,
        nudgeRelatedTicketModelName,
        nudgeRelatedMessageModelName,
        classificationModelName,
        emailQuickRewriteModelName,
        xyneAiToolBudgetSearchRelevantContent,
        xyneAiToolBudgetFetchChannelMessages,
        xyneAiToolBudgetFetchThreadMessages,
        xyneAiToolBudgetFetchLinkContent,
        xyneAiToolBudgetUserActivity,
        xyneAiToolBudgetSearchFiles,
        xyneAiHistoryCompactionTrigger,
        xyneAiHistoryCompactionTarget,
        dataSourceIngestTableLimit,
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
        DEFAULT_TAG_GENERATION_MODEL,
        DEFAULT_TICKET_BOARD_MODEL,
        DEFAULT_RELEASE_NOTES_GENERATOR_MODEL,
        DEFAULT_SUMMARISER_MODEL,
        DEFAULT_ATTACHMENT_SUMMARISER_MODEL,
        DEFAULT_NUDGE_CREATE_TICKET_MODEL,
        DEFAULT_NUDGE_RELATED_TICKET_MODEL,
        DEFAULT_NUDGE_RELATED_MESSAGE_MODEL,
        DEFAULT_CLASSIFICATION_MODEL,
        DEFAULT_EMAIL_QUICK_REWRITE_MODEL,
        DEFAULT_XYNE_AI_TOOL_BUDGET_SEARCH_RELEVANT_CONTENT,
        DEFAULT_XYNE_AI_TOOL_BUDGET_FETCH_CHANNEL_MESSAGES,
        DEFAULT_XYNE_AI_TOOL_BUDGET_FETCH_THREAD_MESSAGES,
        DEFAULT_XYNE_AI_TOOL_BUDGET_FETCH_LINK_CONTENT,
        DEFAULT_XYNE_AI_TOOL_BUDGET_USER_ACTIVITY,
        DEFAULT_XYNE_AI_TOOL_BUDGET_SEARCH_FILES,
        DEFAULT_XYNE_AI_HISTORY_COMPACTION_TRIGGER,
        DEFAULT_XYNE_AI_HISTORY_COMPACTION_TARGET,
        DEFAULT_DATA_SOURCE_INGEST_TABLE_LIMIT,
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
      DEFAULT_TAG_GENERATION_MODEL,
      DEFAULT_TICKET_BOARD_MODEL,
      DEFAULT_RELEASE_NOTES_GENERATOR_MODEL,
      DEFAULT_SUMMARISER_MODEL,
      DEFAULT_ATTACHMENT_SUMMARISER_MODEL,
      DEFAULT_NUDGE_CREATE_TICKET_MODEL,
      DEFAULT_NUDGE_RELATED_TICKET_MODEL,
      DEFAULT_NUDGE_RELATED_MESSAGE_MODEL,
      DEFAULT_CLASSIFICATION_MODEL,
      DEFAULT_EMAIL_QUICK_REWRITE_MODEL,
      DEFAULT_XYNE_AI_TOOL_BUDGET_SEARCH_RELEVANT_CONTENT,
      DEFAULT_XYNE_AI_TOOL_BUDGET_FETCH_CHANNEL_MESSAGES,
      DEFAULT_XYNE_AI_TOOL_BUDGET_FETCH_THREAD_MESSAGES,
      DEFAULT_XYNE_AI_TOOL_BUDGET_FETCH_LINK_CONTENT,
      DEFAULT_XYNE_AI_TOOL_BUDGET_USER_ACTIVITY,
      DEFAULT_XYNE_AI_TOOL_BUDGET_SEARCH_FILES,
      DEFAULT_XYNE_AI_HISTORY_COMPACTION_TRIGGER,
      DEFAULT_XYNE_AI_HISTORY_COMPACTION_TARGET,
      DEFAULT_DATA_SOURCE_INGEST_TABLE_LIMIT,
    );
  }
}

