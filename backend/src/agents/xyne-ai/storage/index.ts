/**
 * Xyne AI Storage Module
 * 
 * Uses custom PostgreSQL provider with normalized 2-table schema:
 * - xyne_ai_sessions: Session metadata
 * - xyne_ai_messages: Individual messages with FK to sessions
 * 
 * Message content structure by role:
 * - user: { query: string, timestamp: string }
 * - assistant: Final output only (XyneAIOutput)
 * - tool: { toolName: string, input: unknown, output: unknown }
 */

// Types from types.ts
export type {
  Citation,
  KeyPointWithCitation,
  UserMessageContent,
  UserMessage,
  AssistantMessage,
  HistoryMessage,
  SessionContext,
  XyneAISession,
  ToolInputContent,
  ToolOutputContent,
} from './types';

// Session Store
export {
  sessionStore,
  initializeSessionStore,
  shutdownSessionStore,
  getOrCreateSession,
  type XyneAIFeedback,
} from './sessionStore';

// Custom Memory Provider types
export {
  createXyneAIMemoryProvider,
  type XyneAIMemoryProvider,
  type XyneAIMessageRole,
  type XyneAIFeedback as XyneAIFeedbackType,
  type MessageData,
  type SessionData,
} from './customPostgresProvider';

// Utilities
export { formatHistoryForJAF, convertMessagesToHistory } from './utils';
