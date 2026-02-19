
import { logger } from '@/utils/logger'
import {
  OpenCodeCommitTracker,
  OpenCodeMessage,
  MessagePart,
  TextPart,
  ToolInvocationPart,
  ToolResultPart,
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
} from './types'
import type {
  EventFileEdited,
  EventCommandExecuted,
  EventTodoUpdated,
} from '@opencode-ai/sdk/v2'
import { WorkflowStorage } from '../../workflow-storage'
import { FullAgenticCheckpointConfig } from '../../workflow-types'
import { hasUncommittedChanges, commitAllChanges } from '@framework'
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
  childExecutionId: string
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
  lspErrorsDetected: number
  lspErrorsUnfixed: Set<string>
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
    subtasksCreated: 0,
    lspErrorsDetected: 0,
    lspErrorsUnfixed: new Set<string>()
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
  const message = event.properties.message

  if (!message) {
    logger.warn('[OpenCode] message.updated event missing message data')
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
      await handleToolInvocation(part as ToolInvocationPart, syntheticMessage, context, stats)
      break

    case 'tool-result':
      await handleToolResult(part as ToolResultPart, syntheticMessage, context, stats)
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

  if (state.status === 'pending' || state.status === 'running') {
    if (!context.processedToolCalls.has(callId)) {
      context.processedToolCalls.add(callId)

      await context.checkPauseOrCancel()

      await context.storage.createToolExecutionStep(context.childExecutionId, {
        id: callId,
        name: toolName,
        input: state.input,
        output: null,
        duration: 0,
        success: false
      })

      stats.toolCallsProcessed++
      logger.info(`[OpenCode] Tool call created: ${toolName} (${callId})`)
    }
  } else if (state.status === 'completed' || state.status === 'error') {
    if (!context.processedToolResults.has(callId)) {
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
        }
      }

      const agentStep = await context.storage.updateToolExecutionAgentStep(
        callId,
        updateAgentData
      )

      const toolCallStatus = state.status === 'error' ? 'failed' : 'completed'
      const rawOutput = state.status === 'error' 
        ? { error: state.error }
        : (state.output ? tryParseJSON(state.output) : { success: true })

      const transformedInput = transformToolInput(toolName, state.input)
      const output = transformToolOutput(toolName, rawOutput)

      await context.storage.updateToolExecutionStep(
        agentStep.stepsId || '',
        output,
        toolCallStatus,
        transformedInput
      )

      stats.toolResultsProcessed++
    }
  }
}

function transformToolInput(toolName: string, rawInput: Record<string, unknown>): Record<string, unknown> {
  if (!rawInput || typeof rawInput !== 'object') {
    return rawInput
  }

  switch (toolName) {
    case 'read':
      return {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        file_path: rawInput.filePath || rawInput.file_path || rawInput.path || '',
        ...rawInput
      }

    case 'write':
      return {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        file_path: rawInput.filePath || rawInput.file_path || '',
        content: rawInput.content || '',
        ...rawInput
      }

    case 'edit':
      return {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        file_path: rawInput.filePath || rawInput.file_path || '',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        old_string: rawInput.oldString || rawInput.old_string || '',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        new_string: rawInput.newString || rawInput.new_string || '',
        ...rawInput
      }

    case 'glob':
      return {
        pattern: rawInput.pattern || '',
        path: rawInput.path || rawInput.directory || '',
        ...rawInput
      }

    default:
      return rawInput
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
  hasLspErrors?: boolean
  errorCount?: number
  filePath?: string | null
  projectDir?: string | null
  originalOutput?: string
  files?: string[]
  count?: number
  todosUpdated?: number
  todos?: unknown[]
  [key: string]: unknown
}

function transformToolOutput(toolName: string, rawOutput: unknown): ToolOutput {
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
      if (output.content && typeof output.content === 'string') {
        const content = output.content
        const hasLspErrors = content.includes('LSP errors detected') || content.includes('<diagnostics')
        
        if (hasLspErrors) {
          const fileMatch = content.match(/file="([^"]+)"/)
          const filePath = fileMatch ? fileMatch[1] : null
          const dirMatch = filePath?.match(/\/tmp\/[^\/]+\/([^\/]+)/)
          const projectDir = dirMatch ? dirMatch[1] : null
          const errorMatches = content.match(/ERROR \[/g)
          const errorCount = errorMatches ? errorMatches.length : 0
          
          logger.warn(`[OpenCode] LSP ERRORS DETECTED: ${errorCount} errors in ${filePath || 'file'}`)
          
          return {
            ...output,
            success: false,
            hasLspErrors: true,
            errorCount,
            filePath,
            projectDir,
            content: `🔴🔴🔴 STOP - LSP ERRORS DETECTED 🔴🔴🔴\n\n${content}\n\n` +
              `⚠️ CRITICAL: You MUST fix these ${errorCount} LSP errors before proceeding.\n` +
              `DO NOT move to the next task. Fix the errors in this file first.` +
              (projectDir ? `\n💡 TIP: After fixing, run \`diagnostics\` tool with empty file_path to check all ${projectDir}/ errors.` : '')
          }
        }
      }
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

    case 'edit': {
      const hasLspErrors = rawOutput.includes('LSP errors detected') || rawOutput.includes('<diagnostics')
      const success = !rawOutput.toLowerCase().includes('error') || (rawOutput.includes('Edit applied successfully') && hasLspErrors)
      
      const fileMatch = rawOutput.match(/file="([^"]+)"/)
      const filePath = fileMatch ? fileMatch[1] : null
      let projectDir = null
      if (filePath) {
        const dirMatch = filePath.match(/\/tmp\/[^\/]+\/([^\/]+)/)
        projectDir = dirMatch ? dirMatch[1] : null
      }
      
      if (hasLspErrors) {
        const errorMatches = rawOutput.match(/ERROR \[/g)
        const errorCount = errorMatches ? errorMatches.length : 0
        
        logger.warn(`[OpenCode] LSP ERRORS DETECTED: ${errorCount} errors in ${filePath || 'file'}`)
        
        const enhancedOutput = `🔴🔴🔴 STOP - LSP ERRORS DETECTED 🔴🔴🔴\n\n${rawOutput}\n\n` +
          `⚠️ CRITICAL: You MUST fix these ${errorCount} LSP errors before proceeding.\n` +
          `DO NOT move to the next task. Fix the errors in this file first.\n` +
          (projectDir ? `\n💡 TIP: After fixing, run \`diagnostics\` tool with empty file_path to check for project-wide errors in ${projectDir}/.` : '')
        
        return {
          success: false,
          hasLspErrors: true,
          errorCount,
          filePath,
          projectDir,
          message: enhancedOutput,
          originalOutput: rawOutput
        }
      }
      
      return { 
        success,
        hasLspErrors: false,
        message: rawOutput
      }
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

function tryParseJSON(str: string): any {
  try {
    return JSON.parse(str)
  } catch {
    return { content: str }
  }
}

async function handleToolInvocation(
  part: ToolInvocationPart,
  _message: OpenCodeMessage,
  context: OpenCodeEventHandlerContext,
  stats: EventProcessingStats
): Promise<void> {
  const toolCall = part.toolInvocation
  
  if (context.processedToolCalls.has(toolCall.toolCallId)) return
  if (toolCall.state !== 'pending' && toolCall.state !== 'running') return

  context.processedToolCalls.add(toolCall.toolCallId)

  await context.checkPauseOrCancel()

  await context.storage.createToolExecutionStep(context.childExecutionId, {
    id: toolCall.toolCallId,
    name: toolCall.toolName,
    input: toolCall.args,
    output: null,
    duration: 0,
    success: false
  })

  stats.toolCallsProcessed++
}

async function handleToolResult(
  part: ToolResultPart,
  _message: OpenCodeMessage,
  context: OpenCodeEventHandlerContext,
  stats: EventProcessingStats
): Promise<void> {
  const toolResult = part.toolResult

  if (context.processedToolResults.has(toolResult.toolCallId)) return

  context.processedToolResults.add(toolResult.toolCallId)

  await context.checkPauseOrCancel()

  const resultStr = typeof toolResult.result === 'string' 
    ? toolResult.result 
    : JSON.stringify(toolResult.result)
  
  if (resultStr.includes('LSP errors detected') || resultStr.includes('<diagnostics')) {
    const fileMatch = resultStr.match(/file="([^"]+)"/)
    const filePath = fileMatch ? fileMatch[1] : 'unknown'
    const errorMatches = resultStr.match(/ERROR \[/g)
    const errorCount = errorMatches ? errorMatches.length : 0
    
    stats.lspErrorsDetected += errorCount
    stats.lspErrorsUnfixed.add(filePath)
    
    logger.info(`[OpenCode] LSP ERRORS in tool result: ${errorCount} errors in ${filePath}`)
  } else if (resultStr.includes('Edit applied successfully') && !resultStr.includes('ERROR')) {
    const fileMatch = resultStr.match(/file="([^"]+)"/)
    if (fileMatch) {
      stats.lspErrorsUnfixed.delete(fileMatch[1])
    }
  }

  const hasChanges = await hasUncommittedChanges(context.repoPath)

  let updateAgentData: UpdateAgentStepInput = {
    repositoryURL: context.commitTracker.repoUrl,
    branch: context.commitTracker.branchName
  }

  if (hasChanges) {
    const commitMessage = `Auto-commit changes from tool execution ${toolResult.toolCallId}`
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
    }
  }

  const agentStep = await context.storage.updateToolExecutionAgentStep(
    toolResult.toolCallId,
    updateAgentData
  )

  const toolCallStatus = toolResult.isError ? 'failed' : 'completed'
  await context.storage.updateToolExecutionStep(
    agentStep.stepsId || '',
    toolResult.result,
    toolCallStatus
  )

  stats.toolResultsProcessed++
}

async function handlePartError(
  part: { type: 'error'; error: string },
  _message: OpenCodeMessage,
  context: OpenCodeEventHandlerContext,
  stats: EventProcessingStats
): Promise<void> {
  await context.storage.createErrorStep(context.childExecutionId, new Error(part.error))
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
    context.childExecutionId,
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

  await context.storage.createAssistantMessageStep(context.childExecutionId, {
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
  await context.storage.createErrorStep(context.childExecutionId, new Error(errorMessage))
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
    
    await context.storage.createAssistantMessageStep(context.childExecutionId, {
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
  context: OpenCodeEventHandlerContext,
  stats: EventProcessingStats
): Promise<void> {
  const { file } = event.properties
  stats.filesEdited++
  
  logger.info(`[OpenCode] File edited: ${file}`)
  
  const hasChanges = await hasUncommittedChanges(context.repoPath)
  if (hasChanges) {
    const commitMessage = `Auto-commit: edited ${file}`
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
      context.commitTracker.hasCommits = true
      context.commitTracker.latestCommitHash = commitHash
      context.commitTracker.commitCount++
      logger.info(`[OpenCode] Auto-committed: ${file}`)
    }
  }
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
    context.childExecutionId,
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
  
  await context.storage.createAssistantMessageStep(context.childExecutionId, {
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
  await context.storage.createErrorStep(context.childExecutionId, error)

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
