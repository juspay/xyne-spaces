import { config } from '@/config/env'
import type { AssistantMessage, Part, Project } from '@opencode-ai/sdk'

export interface PermissionRuleset {
  read?: boolean
  write?: boolean
  execute?: boolean
  custom?: Record<string, boolean>
}

export interface CreateSessionOptions {
  title?: string
  directory?: string
  permission?: PermissionRuleset
  systemPrompt?: string
}

export interface SessionInfo {
  id: string
  title: string
  directory: string
  createdAt: string
  updatedAt: string
  status: SessionStatus
  tokenCount?: number
  isCompacted?: boolean
}

export type SessionStatus = 'active' | 'completed' | 'error' | 'compacting'

export type MessagePartType =
  | 'text'
  | 'tool-invocation'
  | 'tool-result'
  | 'reasoning'
  | 'file'
  | 'error'

export interface ToolInvocationPart {
  type: 'tool-invocation'
  toolInvocation: {
    toolCallId: string
    toolName: string
    state: 'pending' | 'running' | 'completed' | 'failed'
    args: Record<string, unknown>
    result?: unknown
  }
}

export interface ToolResultPart {
  type: 'tool-result'
  toolResult: {
    toolCallId: string
    result: unknown
    isError?: boolean
  }
}

export interface TextPart {
  type: 'text'
  text: string
}

export interface ReasoningPart {
  type: 'reasoning'
  reasoning: string
}

export interface ErrorPart {
  type: 'error'
  error: string
}

export type MessagePart =
  | TextPart
  | ToolInvocationPart
  | ToolResultPart
  | ReasoningPart
  | ErrorPart

export interface OpenCodeMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  parts: MessagePart[]
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface OpenCodeEventBase {
  type: string
  timestamp: string
}

export interface SessionCreatedEvent extends OpenCodeEventBase {
  type: 'session.created'
  properties: {
    sessionId: string
    info: SessionInfo
  }
}

export interface SessionUpdatedEvent extends OpenCodeEventBase {
  type: 'session.updated'
  properties: {
    sessionId: string
    info: SessionInfo
  }
}

export interface SessionDeletedEvent extends OpenCodeEventBase {
  type: 'session.deleted'
  properties: {
    sessionId: string
  }
}

export interface SessionCompactedEvent extends OpenCodeEventBase {
  type: 'session.compacted'
  properties: {
    sessionId: string
    previousTokenCount: number
    newTokenCount: number
    summarizedMessages: number
  }
}

export interface MessageUpdatedEvent extends OpenCodeEventBase {
  type: 'message.updated'
  properties: {
    sessionId: string
    message: OpenCodeMessage
  }
}

export interface MessagePartUpdatedEvent extends OpenCodeEventBase {
  type: 'message.part.updated'
  properties: {
    sessionId: string
    messageId: string
    partIndex: number
    part: MessagePart
  }
}

export interface DoomLoopEvent extends OpenCodeEventBase {
  type: 'doom_loop'
  properties: {
    sessionId: string
    toolName: string
    consecutiveCount: number
    threshold: number
    message: string
  }
}

export interface PermissionAskedEvent extends OpenCodeEventBase {
  type: 'permission.asked'
  properties: {
    sessionId: string
    permissionType: string
    resource: string
    requestId: string
  }
}

export interface PermissionUpdatedEvent extends OpenCodeEventBase {
  type: 'permission.updated'
  properties: {
    sessionId?: string
    id?: string
    response?: string
  }
}

export interface ErrorEvent extends OpenCodeEventBase {
  type: 'error'
  properties: {
    sessionId?: string
    error: string
    code?: string
    details?: Record<string, unknown>
  }
}

export interface SessionErrorEvent extends OpenCodeEventBase {
  type: 'session.error'
  properties: {
    sessionID?: string
    error?: {
      name: string
      data: {
        message?: string
        providerID?: string
        statusCode?: number
        isRetryable?: boolean
        [key: string]: unknown
      }
    }
  }
}

export interface SessionStatusEvent extends OpenCodeEventBase {
  type: 'session.status'
  properties: {
    sessionID: string
    status: { type: string }
  }
}

export interface SessionIdleEvent extends OpenCodeEventBase {
  type: 'session.idle'
  properties: {
    sessionID: string
  }
}

export interface SessionDiffEvent extends OpenCodeEventBase {
  type: 'session.diff'
  properties: {
    sessionID: string
    diff: Array<{
      file: string
      additions: number
      deletions: number
    }>
  }
}

export interface ServerConnectedEvent extends OpenCodeEventBase {
  type: 'server.connected'
  properties: Record<string, unknown>
}

export interface ServerHeartbeatEvent extends OpenCodeEventBase {
  type: 'server.heartbeat'
  properties: Record<string, unknown>
}

export type OpenCodeEvent =
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | SessionDeletedEvent
  | SessionCompactedEvent
  | SessionErrorEvent
  | SessionStatusEvent
  | SessionIdleEvent
  | SessionDiffEvent
  | ServerConnectedEvent
  | ServerHeartbeatEvent
  | MessageUpdatedEvent
  | MessagePartUpdatedEvent
  | DoomLoopEvent
  | PermissionAskedEvent
  | PermissionUpdatedEvent
  | ErrorEvent
  | { type: string; properties: Record<string, unknown>; timestamp?: string }

export interface OpenCodeConfig {
  baseUrl: string
  directory?: string
  timeout?: number
  fetchTimeoutMs?: number
  autoCompact?: boolean
  maxRetries?: number
}

export const DEFAULT_OPENCODE_CONFIG: OpenCodeConfig = {
  baseUrl: config.openCode.baseUrl,
  timeout: config.openCode.timeoutMs,
  fetchTimeoutMs: config.openCode.timeoutMs,
  autoCompact: config.openCode.autoCompact,
  maxRetries: 3
}

export interface OpenCodeExecutionResult {
  messages: OpenCodeMessage[]
  success: boolean
  error?: string
  session: SessionInfo
  metrics: OpenCodeExecutionMetrics
}

export interface OpenCodeExecutionMetrics {
  totalDuration: number
  llmCalls: number
  totalTokens: number
  toolExecutions: number
  compactionEvents: number
  doomLoopWarnings: number
  startTime: Date
  endTime: Date
}

export interface OpenCodeCommitTracker {
  hasCommits: boolean
  branchName: string
  repoUrl?: string
  childExecutionId: string
  parentExecutionId: string
  latestCommitHash?: string
  baseCommitHash?: string
  commitCount: number
}

export interface CreateSessionRequest {
  title?: string
  directory?: string
  permission?: PermissionRuleset
}

export interface PromptRequest {
  message: string
}

export interface CreateSessionResponse {
  session: SessionInfo
}

export interface GetSessionResponse {
  session: SessionInfo
  messages: OpenCodeMessage[]
}

export interface SDKPromptResponse {
  info: AssistantMessage
  parts: Part[]
}

export interface SDKSubtaskPart {
  id: string
  sessionID: string
  messageID: string
  type: 'subtask'
  prompt: string
  description: string
  agent: string
  model?: {
    providerID: string
    modelID: string
  }
  command?: string
}

export interface EventServerHeartbeat {
  type: 'server.heartbeat'
  properties: Record<string, unknown>
}

export interface EventGlobalDisposed {
  type: 'global.disposed'
  properties: Record<string, unknown>
}

export interface EventProjectUpdated {
  type: 'project.updated'
  properties: Project
}

export interface EventLspDiagnostics {
  type: 'lsp.client.diagnostics'
  properties: {
    serverID: string
    path: string
  }
}

export interface EventWorktreeReady {
  type: 'worktree.ready'
  properties: {
    name: string
    branch: string
  }
}

export interface EventWorktreeFailed {
  type: 'worktree.failed'
  properties: {
    message: string
  }
}

export interface EventMcpBrowserOpenFailed {
  type: 'mcp.browser.open.failed'
  properties: {
    mcpName: string
    url: string
  }
}

export interface EventMcpToolsChanged {
  type: 'mcp.tools.changed'
  properties: Record<string, unknown>
}

export interface EventPermissionAsked {
  type: 'permission.asked'
  properties: SDKPermissionRequest
}

export interface SDKPermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: {
    messageID: string
    callID: string
  }
}

export interface SDKPermissionRuleset {
  [key: string]: SDKPermissionRule[]
}

export interface SDKPermissionRule {
  pattern: string
  action: 'allow' | 'deny' | 'ask'
}
