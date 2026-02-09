/**
 * Langfuse Integration for Xyne AI Agent
 * 
 * Provides prompt management and tracing with graceful fallback
 * when Langfuse credentials are not configured.
 */

// ============================================================================
// Langfuse Configuration (shared between prompts and tracing)
// ============================================================================

export {
  getLangfuseConfig,
  isLangfuseEnabled,
  type LangfuseConfig,
} from './config.js';

// ============================================================================
// Tracing exports
// ============================================================================

export {
  initializeLangfuseTracing,
  createOnEventHandler,
} from './tracing.js';

export {
  getLangfuseClient,
  getPrompt,
  getPromptFromLangfuse,
  compilePrompt,
  prefetchPrompts,
  clearPromptCache,
  PROMPT_NAMES,
  type PromptName,
  type GetPromptOptions,
} from './prompts.js';

export {
  buildAgentTemplateVariables,
  type SourceType,
  type AvailableResearchOptions,
} from './template-variables.js';

export {
  getFallbackPrompt,
  compileFallbackPrompt,
  FALLBACK_PROMPTS,
} from './fallback-prompts.js';
