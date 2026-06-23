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
  type LangfuseConfig,
} from './config.js';

// ============================================================================
// Tracing exports
// ============================================================================

export {
  initializeLangfuseTracing,
  createOnEventHandler,
  finalizeTrace,
} from './tracing.js';

export {
  getLangfuseClient,
  getPrompt,
  getPromptFromLangfuse,
  PROMPT_NAMES,
  type GetPromptOptions,
} from './prompts.js';

export {
  buildAgentTemplateVariables,
  buildProvidedContextCitationRefs,
  type SourceType,
  type AvailableResearchOptions,
  type ProvidedContextCitationRef,
} from './template-variables.js';

export {
  getFallbackPrompt,
  compileFallbackPrompt,
  FALLBACK_PROMPTS,
} from './fallback-prompts.js';
