
import { logger } from '@/utils/logger'
import {
  OpenCodeCommitTracker,
  OpenCodeMessage,
  MessagePart,
  TextPart,
  ToolInvocationPart,
  DoomLoopEvent,
  OpenCodeEvent,
  SessionInfo,
  SessionCompactedEvent,
  SessionCreatedEvent,
  SessionUpdatedEvent,
  SessionDeletedEvent,
  MessageUpdatedEvent,
  MessagePartUpdatedEvent,
  SessionErrorEvent,
  SessionStatusEvent,
  SessionDiffEvent,
  PermissionAskedEvent,
  QuestionAskedEvent,
  EventWorktreeReady,
  EventWorktreeFailed,
  normalizeToolInput,
} from './types'
import type {
  EventFileEdited,
  EventCommandExecuted,
  EventTodoUpdated,
} from '@opencode-ai/sdk/v2'
import { WorkflowStorage } from '../../workflow-storage'
import { FullAgenticCheckpointConfig } from '../../workflow-types'
import { hasUncommittedChanges, commitAllChanges, pushCommits } from '@framework'
import { workspaceEventService } from '@/services/workspaceEventService'
import { UpdateAgentStepInput } from '@/types/database'

interface SDKToolPartRaw {
  id: string
  sessionID: string
  messageID: string
  type: 'tool'
  callID: string
  tool: string
  state: {
    status: 'pending' | 'running' | 'completed' | 'error'
    input: Record<string, unknown>
    output?: string
    error?: string
    title?: string
    metadata?: Record<string, unknown>
    time?: {
      start?: number
      end?: number
    }
  }
}

export interface OpenCodeEventHandlerContext {
  inputStepDbId: string
  parentExecutionId: string
  commitTracker: OpenCodeCommitTracker
  repoPath: string
  agentChkConfig: FullAgenticCheckpointConfig
  storage: WorkflowStorage
  abortController: AbortController
  processedToolCalls: Set<string>
  processedToolResults: Set<string>
  checkPauseOrCancel: () => Promise<void>
  grantPermission?: (sessionId: string, permissionId: string) => Promise<void>
  handleQuestion?: (requestId: string, sessionId: string, questions: QuestionAskedEvent['properties']['questions']) => Promise<void>
}

export interface EventProcessingStats {
  toolCallsProcessed: number
  toolResultsProcessed: number
  llmResponsesProcessed: number
  errorsProcessed: number
  doomLoopWarnings: number
  compactionEvents: number
  turnsCompleted: number
  messagesProcessed: number
  partsProcessed: number
  filesEdited: number
  permissionsHandled: number
  retryAttempts: number
  snapshotsCreated: number
  patchesApplied: number
  subtasksCreated: number
}

export function createOpenCodeEventHandler(
  context: OpenCodeEventHandlerContext
): {
  handleEvent: (event: OpenCodeEvent) => Promise<void>
  getStats: () => EventProcessingStats
} {
  const stats: EventProcessingStats = {
    toolCallsProcessed: 0,
    toolResultsProcessed: 0,
    llmResponsesProcessed: 0,
    errorsProcessed: 0,
    doomLoopWarnings: 0,
    compactionEvents: 0,
    turnsCompleted: 0,
    messagesProcessed: 0,
    partsProcessed: 0,
    filesEdited: 0,
    permissionsHandled: 0,
    retryAttempts: 0,
    snapshotsCreated: 0,
    patchesApplied: 0,
    subtasksCreated: 0
  }

  const handleEvent = async (event: OpenCodeEvent): Promise<void> => {
    await context.checkPauseOrCancel()

    switch (event.type) {
      case 'message.updated':
        await handleMessageUpdated(event as MessageUpdatedEvent, context, stats)
        break

      case 'message.part.updated':
        await handleMessagePartUpdated(event as MessagePartUpdatedEvent, context, stats)
        break

      case 'message.removed':
        break

      case 'message.part.removed':
        break

      case 'session.created': {
        const sessionEvent = event as SessionCreatedEvent
        logger.info(`[OpenCode] Session created: ${sessionEvent.properties.info.id}`)
        break
      }

      case 'session.updated': {
        const sessionEvent = event as SessionUpdatedEvent
        await handleSessionUpdated(sessionEvent.properties.info, context, stats)
        break
      }

      case 'session.deleted': {
        const sessionEvent = event as SessionDeletedEvent
        logger.info(`[OpenCode] Session deleted: ${sessionEvent.properties.sessionId}`)
        break
      }

      case 'session.compacted':
        await handleSessionCompacted(event as SessionCompactedEvent, context, stats)
        break

      case 'session.error':
        await handleSessionError(event as SessionErrorEvent, context, stats)
        break

      case 'session.status':
        await handleSessionStatus(event as SessionStatusEvent, context, stats)
        break

      case 'session.idle':
        logger.info(`[OpenCode] Session idle: ${event.properties.sessionID}`)
        break

      case 'session.diff':
        await handleSessionDiff(event as SessionDiffEvent, context, stats)
        break

      case 'permission.asked':
        await handlePermissionAsked(event as PermissionAskedEvent, context, stats)
        break

      case 'permission.replied':
        stats.permissionsHandled++
        break

      case 'question.asked':
        await handleQuestionAsked(event as QuestionAskedEvent, context)
        break

      case 'question.replied':
      case 'question.rejected':
        break

      case 'file.edited':
        await handleFileEdited(event as EventFileEdited, context, stats)
        break

      case 'file.watcher.updated':
        break

      case 'worktree.ready':
        await handleWorktreeReady(event as EventWorktreeReady, context, stats)
        break

      case 'worktree.failed':
        await handleWorktreeFailed(event as EventWorktreeFailed, context, stats)
        break

      case 'server.connected':
        break

      case 'server.heartbeat':
        break

      case 'server.instance.disposed':
        break

      case 'global.disposed':
        break

      case 'mcp.tools.changed':
        break

      case 'mcp.browser.open.failed':
        logger.error(`MCP browser open failed: ${event.properties.mcpName} -> ${event.properties.url}`)
        break

      case 'lsp.client.diagnostics':
        logger.info(`[OpenCode] LSP diagnostics: ${event.properties.serverID} -> ${event.properties.path}`)
        break

      case 'lsp.updated':
        logger.info(`[OpenCode] LSP updated`)
        break

      case 'command.executed':
        await handleCommandExecuted(event as EventCommandExecuted, context, stats)
        break

      case 'todo.updated':
        await handleTodoUpdated(event as EventTodoUpdated, context, stats)
        break

      case 'vcs.branch.updated':
        break

      case 'project.updated':
        break

      case 'installation.updated':
        break

      case 'installation.update-available':
        break

      case 'message.part.delta':
        break

      case 'doom_loop':
        await handleDoomLoop(event as DoomLoopEvent, context, stats)
        break

      default: {
        const eventType = event && typeof event === 'object' && 'type' in event
          ? String(event.type)
          : 'unknown'
        logger.info(`[OpenCode] Unhandled event type: ${eventType}`)
      }
    }
  }

  return {
    handleEvent,
    getStats: () => ({ ...stats })
  }
}

async function handleMessageUpdated(
  event: MessageUpdatedEvent,
  _context: OpenCodeEventHandlerContext,
  stats: EventProcessingStats
): Promise<void> {
  const info = event.properties.info

  if (!info) {
    logger.debug('[OpenCode] message.updated event missing message data')
    return
  }

  stats.messagesProcessed++
}

async function handleSessionUpdated(
  session: SessionInfo,
  _context: OpenCodeEventHandlerContext,
  _stats: EventProcessingStats
): Promise<void> {
  logger.info(`[OpenCode] Session ${session.id} updated: ${session.title}`)
}

async function handleMessagePartUpdated(
  event: MessagePartUpdatedEvent,
  context: OpenCodeEventHandlerContext,
  stats: EventProcessingStats
): Promise<void> {
  const props = event.properties as {
    sessionId?: string
    sessionID?: string
    messageId?: string
    messageID?: string
    partIndex?: number
    part?: MessagePart | SDKToolPartRaw
    info?: MessagePart | SDKToolPartRaw
    delta?: string
  }

  const part = props.part || props.info
  if (!part) {
    return
  }

  const partType = part && typeof part === 'object' && 'type' in part
    ? String(part.type)
    : 'unknown'

  if (partType === 'unknown') {
    logger.warn('[OpenCode] Unknown part type in message part update:', part)
    return
  }

  stats.partsProcessed++

  const syntheticMessage: OpenCodeMessage = {
    id: props.messageId || props.messageID || 'streaming-part',
    sessionId: props.sessionId || props.sessionID || '',
    role: 'assistant',
    parts: [],
    createdAt: new Date().toISOString()
  }

  if (partType === 'tool') {
    const sdkPart = part as SDKToolPartRaw
    await handleSDKToolPart(sdkPart, syntheticMessage, context, stats)
    return
  }

  switch (partType) {
    case 'tool-invocation':
      logger.debug('[OpenCode] Ignoring legacy tool-invocation part (handled by tool type)')
      break

    case 'tool-result':
      logger.debug('[OpenCode] Ignoring legacy tool-result part (handled by tool type)')
      break

    case 'text':
      break

    case 'reasoning':
      break

    case 'error':
      await handlePartError(part as { type: 'error'; error: string }, syntheticMessage, context, stats)
      break

    case 'step-start':
      logger.info(`[OpenCode] Step started`)
      break

    case 'step-finish':
      logger.info(`[OpenCode] Step finished`)
      break

    default:
      logger.info(`[OpenCode] Unknown part type: ${partType}`)
  }
}

async function handleSDKToolPart(
  part: SDKToolPartRaw,
  _message: OpenCodeMessage,
  context: OpenCodeEventHandlerContext,
  stats: EventProcessingStats
): Promise<void> {
  const callId = part.callID
  const toolName = part.tool
  const state = part.state

  // Skip pending — input is empty at this state
  if (state.status === 'pending') {
    return
  }

  if (!context.processedToolCalls.has(callId)) {
    context.processedToolCalls.add(callId)

    await context.checkPauseOrCancel()

    // Normalize camelCase input keys to snake_case for frontend renderers
    const normalizedInput = normalizeToolInput(state.input)

    await context.storage.createToolExecutionStep(context.parentExecutionId, context.inputStepDbId, {
      id: callId,
      name: toolName,
      input: normalizedInput,
      output: null,
      duration: 0,
      success: state.status === 'completed'
    })

    stats.toolCallsProcessed++
    logger.info(`[OpenCode] Tool call created (${state.status}): ${toolName} (${callId})`)
  }

  // On completed/error, handle commits (side effects only, no data updates)
  if (state.status === 'completed' || state.status === 'error') {
    if (context.processedToolResults.has(callId)) {
      return
    }
    context.processedToolResults.add(callId)

    await context.checkPauseOrCancel()

    const hasChanges = await hasUncommittedChanges(context.repoPath)

    let updateAgentData: UpdateAgentStepInput = {
      repositoryURL: context.commitTracker.repoUrl,
      branch: context.commitTracker.branchName
    }

    if (hasChanges) {
      const commitMessage = `Auto-commit changes from tool execution ${callId}`
      const updatedCommitMessage = context.agentChkConfig.repoInfo?.getCommitMessage
        ? context.agentChkConfig.repoInfo.getCommitMessage(commitMessage)
        : commitMessage

      const coAuthor = context.agentChkConfig.repoInfo?.coAuthor
      const commitHash = await commitAllChanges(
        context.repoPath,
        updatedCommitMessage,
        coAuthor?.name,
        coAuthor?.email
      )

      if (commitHash) {
        updateAgentData = { ...updateAgentData, commitHash: commitHash }
        context.commitTracker.hasCommits = true
        context.commitTracker.latestCommitHash = commitHash
        context.commitTracker.commitCount++

        // Push immediately so backend can pull for live workspace viewing (matches xyne-code pattern)
        if (context.repoPath && context.commitTracker.branchName && context.commitTracker.repoUrl) {
          try {
            await pushCommits(context.repoPath, context.commitTracker.branchName, context.commitTracker.repoUrl)
            logger.info(`[OpenCode] Pushed commit ${commitHash.substring(0, 8)} for live workspace viewing`)

            await workspaceEventService.publishFileTreeUpdate(
              context.parentExecutionId,
              context.inputStepDbId,
              commitHash
            )
          } catch (pushError) {
            logger.error(`[OpenCode] Failed to push commit for live viewing:`, pushError)
          }
        }
      }
    }

    await context.storage.updateToolExecutionAgentStep(
      context.inputStepDbId,
      callId,
      updateAgentData
    )

    stats.toolResultsProcessed++
  }
}

interface ToolOutput {
  error?: string
  content?: string
  stdout?: string
  stderr?: string
  exitCode?: number
  success?: boolean
  message?: string
  files?: string[]
  count?: number
  todosUpdated?: number
  todos?: unknown[]
  [key: string]: unknown
}

export function transformToolOutput(toolName: string, rawOutput: unknown): ToolOutput {
  if (typeof rawOutput === 'string') {
    return transformStringOutput(toolName, rawOutput)
  }

  if (Array.isArray(rawOutput)) {
    if (toolName === 'todoread' || toolName === 'todowrite') {
      return {
        success: true,
        todosUpdated: rawOutput.length,
        todos: rawOutput
      }
    }
  }

  if (!rawOutput || typeof rawOutput !== 'object') {
    return { error: 'Invalid output format' }
  }

  const output = rawOutput as Record<string, unknown>

  if (output.error) {
    return output as ToolOutput
  }

  switch (toolName) {
    case 'bash':
      if (output.content) {
        return {
          stdout: String(output.content),
          stderr: '',
          exitCode: 0
        }
      }
      if (output.stdout !== undefined) {
        return output as ToolOutput
      }
      return { stdout: JSON.stringify(output), stderr: '', exitCode: 0 }

    case 'todoread':
    case 'todowrite':
      if (output.content && typeof output.content === 'string') {
        try {
          const todos = JSON.parse(output.content)
          if (Array.isArray(todos)) {
            return {
              success: true,
              todosUpdated: todos.length,
              todos: todos
            }
          }
        } catch {
          // Fall through
        }
      }
      return { success: true, ...output }

    case 'glob':
      if (output.content && typeof output.content === 'string') {
        const files = output.content.split('\n').filter((f: string) => f.trim().length > 0)
        return {
          files: files,
          count: files.length
        }
      }
      if (output.content === '' || (typeof output.content === 'string' && !output.content.trim())) {
        return {
          files: [],
          count: 0
        }
      }
      if (Array.isArray(output.files)) {
        return {
          files: output.files as string[],
          count: (output.count as number) || output.files.length
        }
      }
      return { files: [], count: 0 }

    case 'read':
      if (output.content) {
        return { content: String(output.content) }
      }
      return output as ToolOutput

    case 'write':
      if (output.content && typeof output.content === 'string') {
        return {
          success: output.content.toLowerCase().includes('success'),
          message: output.content
        }
      }
      return { success: true, ...output }

    case 'edit':
      return output as ToolOutput

    case 'background_task':
    case 'background_output':
      return parseBackgroundTaskOutput(rawOutput) as ToolOutput

    default:
      return output as ToolOutput
  }
}

function transformStringOutput(toolName: string, rawOutput: string): ToolOutput {
  switch (toolName) {
    case 'read':
      return { content: rawOutput }

    case 'write':
      return { 
        success: rawOutput.toLowerCase().includes('success'),
        message: rawOutput
      }

    case 'edit':
      return {
        success: !rawOutput.toLowerCase().includes('error'),
        message: rawOutput
      }

    default:
      return { content: rawOutput }
  }
}

interface BackgroundTaskSummaryItem {
  id: string
  tool: string
  state: {
    status: 'pending' | 'running' | 'completed' | 'error'
    title?: string
  }
}

interface ParsedBackgroundTaskOutput {
  content: string
  isInitialLaunch: boolean
  sessionId?: string | null
  taskTitle?: string
  summary?: BackgroundTaskSummaryItem[]
  toolCallsSummary?: string
  [key: string]: unknown
}

interface BackgroundTaskRawOutput {
  content?: string
  metadata?: {
    sessionId?: string
    summary?: BackgroundTaskSummaryItem[]
  }
  title?: string
  output?: unknown
}

function parseBackgroundTaskOutput(rawOutput: unknown): ParsedBackgroundTaskOutput {
  if (typeof rawOutput === 'string') {
    return parseBackgroundTaskString(rawOutput)
  }

  if (!rawOutput || typeof rawOutput !== 'object') {
    return {
      content: JSON.stringify(rawOutput),
      isInitialLaunch: false
    }
  }

  const output = rawOutput as BackgroundTaskRawOutput

  if (output.content && typeof output.content === 'string') {
    const parsed = parseBackgroundTaskString(output.content)
    if (output.metadata) {
      return {
        ...parsed,
        sessionId: output.metadata.sessionId || parsed.sessionId,
        summary: output.metadata.summary || parsed.summary,
        toolCallsSummary: formatToolCallsSummary(output.metadata.summary),
        taskTitle: output.title || parsed.taskTitle
      }
    }
    return parsed
  }

  if (output.metadata?.summary) {
    const sessionId = output.metadata.sessionId
    const summary = output.metadata.summary
    const taskOutput = typeof output.output === 'string' ? output.output : JSON.stringify(output.output)
    
    logger.info(`[OpenCode] Background task completed - Session: ${sessionId}, Tools executed: ${summary.length}`)
    
    return {
      content: formatBackgroundTaskContent(output.title, taskOutput, summary, sessionId),
      isInitialLaunch: false,
      sessionId,
      taskTitle: output.title,
      summary,
      toolCallsSummary: formatToolCallsSummary(summary)
    }
  }

  return {
    content: JSON.stringify(rawOutput),
    isInitialLaunch: false
  }
}

function parseBackgroundTaskString(content: string): ParsedBackgroundTaskOutput {
  if (content.includes('Session ID: undefined')) {
    logger.info(`[OpenCode] background_task launched - session ID will be available on status check`)
    const enhancedContent = content.replace(
      'Session ID: undefined',
      'Session ID: (creating... check status for ID)'
    )
    return { 
      content: enhancedContent,
      isInitialLaunch: true,
      sessionId: null
    }
  }

  const sessionMatch = content.match(/Session ID[:|]\s*`?([^`\n|]+)`?/i)
  const sessionId = sessionMatch ? sessionMatch[1].trim() : null

  const taskMetadataMatch = content.match(/<task_metadata>\s*session_id:\s*([^\n<]+)\s*<\/task_metadata>/i)
  const taskSessionId = taskMetadataMatch ? taskMetadataMatch[1].trim() : null

  return {
    content,
    isInitialLaunch: false,
    sessionId: taskSessionId || (sessionId !== 'undefined' ? sessionId : null)
  }
}

function formatToolCallsSummary(summary?: BackgroundTaskSummaryItem[]): string | undefined {
  if (!summary || summary.length === 0) return undefined
  
  const completed = summary.filter(s => s.state.status === 'completed').length
  const failed = summary.filter(s => s.state.status === 'error').length
  const pending = summary.filter(s => s.state.status === 'pending' || s.state.status === 'running').length

  let statusStr = `${summary.length} tool${summary.length !== 1 ? 's' : ''} executed`
  if (completed > 0) statusStr += ` (${completed} completed`
  if (failed > 0) statusStr += `, ${failed} failed`
  if (pending > 0) statusStr += `, ${pending} pending`
  if (completed > 0 || failed > 0 || pending > 0) statusStr += ')'

  const toolList = summary.map(s => {
    const status = s.state.status === 'completed' ? '✓' : 
                   s.state.status === 'error' ? '✗' : '⋯'
    const title = s.state.title ? `: ${s.state.title}` : ''
    return `  ${status} ${s.tool}${title}`
  }).join('\n')

  return `${statusStr}:\n${toolList}`
}

function formatBackgroundTaskContent(
  title: string | undefined, 
  output: string, 
  summary: BackgroundTaskSummaryItem[],
  sessionId: string | undefined
): string {
  const lines: string[] = []

  if (title) {
    lines.push(`📋 Task: ${title}`)
    lines.push('')
  }

  if (sessionId) {
    lines.push(`🔑 Session ID: ${sessionId}`)
    lines.push('')
  }

  const toolsSummary = formatToolCallsSummary(summary)
  if (toolsSummary) {
    lines.push(`🛠️ ${toolsSummary}`)
    lines.push('')
  }

  if (output) {
    const cleanOutput = output.replace(/<task_metadata>[\s\S]*?<\/task_metadata>/gi, '').trim()
    if (cleanOutput) {
      lines.push('📄 Output:')
      lines.push(cleanOutput)
    }
  }

  return lines.join('\n')
}

// Legacy handleToolInvocation and handleToolResult removed —
// tool-invocation/tool-result part types are superseded by the `tool` part type
// handled by handleSDKToolPart above.

async function handlePartError(
  part: { type: 'error'; error: string },
  _message: OpenCodeMessage,
  context: OpenCodeEventHandlerContext,
  stats: EventProcessingStats
): Promise<void> {
  await context.storage.createErrorStep(context.parentExecutionId, context.inputStepDbId, new Error(part.error))
  stats.errorsProcessed++
  logger.error(`[OpenCode] Error in message: ${part.error}`)
}


async function handleDoomLoop(
  event: DoomLoopEvent,
  context: OpenCodeEventHandlerContext,
  stats: EventProcessingStats
): Promise<void> {
  stats.doomLoopWarnings++

  const { toolName, consecutiveCount, threshold, message: errorMessage } = event.properties

  logger.warn(`[OpenCode] DOOM LOOP DETECTED: Tool "${toolName}" called ${consecutiveCount} times (threshold: ${threshold})`)

  await context.storage.createErrorStep(
    context.parentExecutionId,
    context.inputStepDbId,
    new Error(`Doom loop detected: ${errorMessage}`)
  )

  if (consecutiveCount > threshold + 2) {
    logger.error('[OpenCode] Doom loop exceeded threshold by 2+, aborting execution')
    context.abortController.abort()
  }
}

async function handleSessionCompacted(
  event: SessionCompactedEvent,
  context: OpenCodeEventHandlerContext,
  stats: EventProcessingStats
): Promise<void> {
  stats.compactionEvents++

  const { previousTokenCount, newTokenCount, summarizedMessages } = event.properties

  logger.info(`📦 [OpenCode] Context compacted: ${previousTokenCount} → ${newTokenCount} tokens`)
  logger.info(`   Summarized ${summarizedMessages} messages`)

  await context.storage.createAssistantMessageStep(context.parentExecutionId, context.inputStepDbId, {
    compaction: {
      previousTokenCount,
      newTokenCount,
      summarizedMessages,
      tokensReduced: previousTokenCount - newTokenCount
    }
  })
}

async function handleSessionError(
  event: SessionErrorEvent,
  context: OpenCodeEventHandlerContext,
  stats: EventProcessingStats
): Promise<void> {
  stats.errorsProcessed++

  const errorData = event.properties.error
  let errorMessage = 'Unknown session error'
  
  if (errorData) {
    switch (errorData.name) {
      case 'ProviderAuthError':
        errorMessage = `Provider auth error (${errorData.data.providerID}): ${errorData.data.message}`
        break
      case 'UnknownError':
        errorMessage = `Unknown error: ${errorData.data.message}`
        break
      case 'MessageOutputLengthError':
        errorMessage = `Output length exceeded`
        break
      case 'MessageAbortedError':
        errorMessage = `Message aborted: ${errorData.data.message}`
        break
      case 'APIError':
        errorMessage = `API error (${errorData.data.statusCode}): ${errorData.data.message}`
        if (!errorData.data.isRetryable) {
          context.abortController.abort()
        }
        break
    }
  }

  logger.error(`[OpenCode] Session error: ${errorMessage}`)
  await context.storage.createErrorStep(context.parentExecutionId, context.inputStepDbId, new Error(errorMessage))
}

async function handleSessionStatus(
  event: SessionStatusEvent,
  _context: OpenCodeEventHandlerContext,
  stats: EventProcessingStats
): Promise<void> {
  const { sessionID, status } = event.properties
  
  if (status.type === 'retry') {
    stats.retryAttempts++
    const retryStatus = status as { type: 'retry'; attempt: number; message: string; next: number }
    logger.info(`[OpenCode] Session ${sessionID} retry attempt ${retryStatus.attempt}: ${retryStatus.message}`)
    logger.info(`   Next attempt at: ${new Date(retryStatus.next).toISOString()}`)
  } else {
    logger.info(`[OpenCode] Session ${sessionID} status: ${status.type}`)
  }
}

async function handleSessionDiff(
  event: SessionDiffEvent,
  context: OpenCodeEventHandlerContext,
  _stats: EventProcessingStats
): Promise<void> {
  const { diff } = event.properties
  
  if (diff && diff.length > 0) {
    const additions = diff.reduce((sum: number, d) => sum + d.additions, 0)
    const deletions = diff.reduce((sum: number, d) => sum + d.deletions, 0)
    
    await context.storage.createAssistantMessageStep(context.parentExecutionId, context.inputStepDbId, {
      diff: {
        files: diff.map(d => ({
          path: d.file,
          additions: d.additions,
          deletions: d.deletions
        })),
        totalAdditions: additions,
        totalDeletions: deletions
      }
    })
  }
}

async function handlePermissionAsked(
  event: PermissionAskedEvent,
  context: OpenCodeEventHandlerContext,
  stats: EventProcessingStats
): Promise<void> {
  const permission = event.properties
  
  logger.info(`🔓 [OpenCode] Permission requested: ${permission.permissionType}`)
  logger.info(`   Resource: ${permission.resource}`)
  logger.info(`   Request ID: ${permission.requestId}`)
  logger.info(`   Session ID: ${permission.sessionId}`)

  stats.permissionsHandled++

  if (context.grantPermission && permission.requestId && permission.sessionId) {
    try {
      await context.grantPermission(permission.sessionId, permission.requestId)
    } catch (error) {
      logger.error('Failed to auto-grant permission:', error)
    }
  } else {
    logger.warn('Cannot auto-grant permission - no callback or missing IDs')
  }
}

async function handleQuestionAsked(
  event: QuestionAskedEvent,
  context: OpenCodeEventHandlerContext,
): Promise<void> {
  const { id: requestId, sessionID, questions } = event.properties

  const questionTexts = questions?.map(q => q.header || q.question).join(', ') || 'unknown'
  logger.info(`❓ [OpenCode] Question asked: ${questionTexts}, requestId=${requestId}`)

  if (context.handleQuestion && requestId) {
    try {
      await context.handleQuestion(requestId, sessionID, questions)
    } catch (error) {
      logger.error(`[OpenCode] Failed to handle question ${requestId}:`, error)
    }
  } else {
    logger.warn('[OpenCode] Cannot handle question - no callback or missing requestId')
  }
}

async function handleFileEdited(
  event: EventFileEdited,
  _context: OpenCodeEventHandlerContext,
  stats: EventProcessingStats
): Promise<void> {
  const { file } = event.properties
  stats.filesEdited++
  
  logger.info(`[OpenCode] File edited: ${file}`)
}

async function handleWorktreeReady(
  event: EventWorktreeReady,
  _context: OpenCodeEventHandlerContext,
  _stats: EventProcessingStats
): Promise<void> {
  const { name, branch } = event.properties
  logger.info(`[OpenCode] Worktree ready: ${name} on branch ${branch}`)
}

async function handleWorktreeFailed(
  event: EventWorktreeFailed,
  context: OpenCodeEventHandlerContext,
  _stats: EventProcessingStats
): Promise<void> {
  const { message } = event.properties
  logger.error(`[OpenCode] Worktree failed: ${message}`)
  
  await context.storage.createErrorStep(
    context.parentExecutionId,
    context.inputStepDbId,
    new Error(`Worktree failed: ${message}`)
  )
}

async function handleCommandExecuted(
  event: EventCommandExecuted,
  context: OpenCodeEventHandlerContext,
  _stats: EventProcessingStats
): Promise<void> {
  const { name, arguments: args, sessionID, messageID } = event.properties
  
  logger.info(`[OpenCode] Command executed: ${name} with args: ${args}`)
  
  await context.storage.createAssistantMessageStep(context.parentExecutionId, context.inputStepDbId, {
    command: {
      name,
      arguments: args,
      sessionID,
      messageID
    }
  })
}

async function handleTodoUpdated(
  event: EventTodoUpdated,
  _context: OpenCodeEventHandlerContext,
  _stats: EventProcessingStats
): Promise<void> {
  const { todos } = event.properties
  
  const completed = todos.filter((t: { status: string }) => t.status === 'completed').length
  const total = todos.length
  
  logger.info(`[OpenCode] Todos updated: ${completed}/${total} completed`)
}

export async function handleError(
  event: { type: 'error'; properties: { error: string; code?: string } },
  context: OpenCodeEventHandlerContext,
  stats: EventProcessingStats
): Promise<void> {
  stats.errorsProcessed++

  const error = new Error(event.properties.error)
  await context.storage.createErrorStep(context.parentExecutionId, context.inputStepDbId, error)

  logger.error(`[OpenCode] Error event: ${event.properties.error}`)

  if (event.properties.code === 'FATAL' || event.properties.code === 'CONTEXT_OVERFLOW') {
    context.abortController.abort()
  }
}

export function extractToolCallsFromMessage(message: OpenCodeMessage): Array<{
  id: string
  name: string
  arguments: Record<string, unknown>
}> {
  return message.parts
    .filter((part): part is ToolInvocationPart => part.type === 'tool-invocation')
    .map((part) => ({
      id: part.toolInvocation.toolCallId,
      name: part.toolInvocation.toolName,
      arguments: part.toolInvocation.args
    }))
}

export function extractTextFromMessage(message: OpenCodeMessage): string {
  return message.parts
    .filter((part): part is TextPart => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

export function convertToFrameworkMessage(message: OpenCodeMessage): {
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
} {
  return {
    role: message.role,
    content: extractTextFromMessage(message),
    toolCalls: message.role === 'assistant' ? extractToolCallsFromMessage(message) : undefined
  }
}
