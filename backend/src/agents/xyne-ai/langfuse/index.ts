/**
 * Langfuse Integration for Xyne AI Agent
 * 
 * Provides prompt management and tracing with graceful fallback
 * when Langfuse credentials are not configured.
 */

export {
  initializeLangfuseTracing,
  isLangfuseEnabled,
  createOnEventHandler,
  getLangfuseConfig,
  type LangfuseConfig,
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
