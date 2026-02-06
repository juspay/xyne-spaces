export { OpenCodeExecutor } from './opencode-executor'

export { OpenCodeClient, OpenCodeAPIError } from './opencode-client'

export {
  createOpenCodeEventHandler,
  extractToolCallsFromMessage,
  extractTextFromMessage,
  convertToFrameworkMessage,
  type OpenCodeEventHandlerContext,
  type EventProcessingStats
} from './event-mapper'

export type {
  PermissionRuleset,
  CreateSessionOptions,
  SessionInfo,
  SessionStatus,
  MessagePartType,
  ToolInvocationPart,
  ToolResultPart,
  TextPart,
  ReasoningPart,
  ErrorPart,
  MessagePart,
  OpenCodeMessage,
  OpenCodeEventBase,
  SessionCreatedEvent,
  SessionUpdatedEvent,
  SessionDeletedEvent,
  SessionCompactedEvent,
  MessageUpdatedEvent,
  MessagePartUpdatedEvent,
  DoomLoopEvent,
  PermissionAskedEvent,
  ErrorEvent,
  OpenCodeEvent,
  OpenCodeConfig,
  OpenCodeExecutionResult,
  OpenCodeExecutionMetrics,
  OpenCodeCommitTracker,
  CreateSessionRequest,
  PromptRequest,
  CreateSessionResponse,
  GetSessionResponse
} from './types'

export { DEFAULT_OPENCODE_CONFIG } from './types'

export {
  openCodeServer,
  initializeOpenCode,
  shutdownOpenCode
} from './opencode-server'
