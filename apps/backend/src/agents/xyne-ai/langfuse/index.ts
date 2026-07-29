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

export {
  getLangfuseClient,
  getPrompt,
  getPromptFromLangfuse,
  PROMPT_NAMES,
  type GetPromptOptions,
} from './prompts.js';

export {
  getFallbackPrompt,
  compileFallbackPrompt,
  FALLBACK_PROMPTS,
} from './fallback-prompts.js';
