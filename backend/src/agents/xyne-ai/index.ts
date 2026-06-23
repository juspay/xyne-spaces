/**
 * Xyne AI Agent - Main Entry Point
 * Call initializeXyneAI() at application startup.
 */

import { initializeLangfuseTracing } from './langfuse/index.js';
import { initializeTools } from './tools/index.js';
import { initializeSessionStore, shutdownSessionStore } from './storage/index.js';
import { logger } from '../../utils/logger.js';

let isInitialized = false;

export async function initializeXyneAI(): Promise<void> {
  if (isInitialized) {
    return;
  }
  
  initializeLangfuseTracing();
  await initializeSessionStore();
  await initializeTools();
  isInitialized = true;
  logger.info('[XyneAI] Initialized');
}

export async function shutdownXyneAI(): Promise<void> {
  if (!isInitialized) {
    return;
  }
  
  await shutdownSessionStore();
  isInitialized = false;
  logger.info('[XyneAI] Shutdown complete');
}

// Agent exports
export { createAgentRunner } from './agent.js';
export { xyneAIStream, type XyneAIStreamRequest } from './stream.js';

// Config exports (CAC - Context Aware Configuration)
export { AgentsConfig } from '../config.js';

// Type exports
export type {
  XyneAIRequest,
  XyneAIStreamChunk,
  XyneAIOutput,
  AgentRawOutput,
} from './types.js';

// Storage exports
export {
  sessionStore,
  getOrCreateSession,
  formatHistoryForJAF,
  initializeSessionStore,
  shutdownSessionStore,
  type SessionContext,
  type XyneAISession,
  type Citation,
  type HistoryMessage,
} from './storage/index.js';

// Tools exports
export {
  initializeTools,
  getXyneAITools,
  getFetchChannelMessagesTool,
  getFetchThreadMessagesTool,
  getSearchRelevantContentTool,
  getAndClearSessionMappings,
  appendSessionMappings,
  buildMessageMappings,
  formatToolResultForContext,
  type XyneAIAgentContext,
  type UserInfo,
  type ToolMessage,
  type ToolResult,
  type MessageMappings,
} from './tools/index.js';

// Langfuse exports
export {
  initializeLangfuseTracing,
  createOnEventHandler,
  getLangfuseConfig,
  getLangfuseClient,
  getPrompt,
  getPromptFromLangfuse,
  PROMPT_NAMES,
  type LangfuseConfig,
  type GetPromptOptions,
} from './langfuse/index.js';

export type { Message } from '@juspay-jaf/jaf';
