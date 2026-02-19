import { WorkflowStorage, FrameworkExecutionResult } from '../../workflow-storage'
import { FullAgenticCheckpointConfig, WorkflowState, BaseWorkflowContext, GitInfo, GitDiffFile, GitDiffStats, AgenticContinuationOverride } from '../../workflow-types'
import { WorkflowExecutionStatus } from '../../types/workflow-enums'
import { WorkflowPausedException, WorkflowCancelledException } from '../../exceptions/workflow-exceptions'
import { BitbucketManager } from '@/bitbucket/apis'
import { TicketRepository, WorkflowRepository } from '@/database/repositories/workflows'
import { logger } from '@/utils/logger'
import { exec } from 'child_process'
import { promisify } from 'util'
import { resolve as pathResolve, normalize as pathNormalize } from 'path'

const execAsync = promisify(exec)

import { cloneRepository, pushCommits } from '@framework'
import { createUserMessage, createToolResultMessage, createAssistantMessage } from '@framework'
import { workspaceEventService } from '@/services/workspaceEventService'

import { OpenCodeClient } from './opencode-client'
import { 
  OpenCodeConfig,
  OpenCodeCommitTracker, 
  SessionInfo, 
  SDKPromptResponse
} from './types'
import type { ToolPart, TextPart, ReasoningPart, StepFinishPart } from '@opencode-ai/sdk'
import { createOpenCodeEventHandler, EventProcessingStats } from './event-mapper'

import type { ConversationRequest, ConversationResult, Message } from '../types.js'

function extractWorkspace(url: string): { projectName: string; repoName: string } {
  const parts = url.split('/');
  const lastPart = parts[parts.length - 1];
  const repoName = lastPart.replace(/\.git$/, "");

  const scmIndex = parts.indexOf('scm');
  let projectName: string;

  if (scmIndex !== -1) {
    projectName = parts[scmIndex + 1];
  } else {
    projectName = parts[3];
  }

  return { projectName, repoName };
}

export class OpenCodeExecutor {
  private baseUrl: string

  constructor(
    private storage: WorkflowStorage,
    private bitbucketManager = new BitbucketManager(),
    openCodeConfig: Partial<OpenCodeConfig> = {},
    private workflowRepo = new WorkflowRepository(),
    private ticketRepo = new TicketRepository()
  ) {
    this.baseUrl = openCodeConfig.baseUrl || 'http://localhost:4096'
  }

  private createScopedClient(directory: string): OpenCodeClient {
    return OpenCodeClient.forDirectory(this.baseUrl, directory)
  }

  async executeWithWorkflowTracking<T extends BaseWorkflowContext>(
    parentExecutionId: string,
    workflowId: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    conversationRequest: ConversationRequest,
    parentState: WorkflowState<T>,
    checkpointId: string,
    continuationOverride?: AgenticContinuationOverride
  ): Promise<{ result: ConversationResult; updatedState: WorkflowState<T>; gitInfo: GitInfo }> {
    if (continuationOverride) {
      return await this.startContinuationExecution(
        parentExecutionId,
        workflowId,
        agentChkConfig,
        conversationRequest,
        parentState,
        checkpointId,
        continuationOverride
      )
    }

    const existingChildExecution = await this.storage.findExistingChildExecution(parentExecutionId, checkpointId)

    if (existingChildExecution) {
      if (existingChildExecution.status === WorkflowExecutionStatus.SUCCESS) {
        const result = await this.storage.getCompletedExecutionResult(existingChildExecution.id)
        if (result) {
          const updatedState = this.buildStateFromCompletedExecution(parentState, result)
          const gitInfo: GitInfo = {
            branch: agentChkConfig.repoInfo?.repoBranch || 'main',
            repoUrl: agentChkConfig.repoInfo?.repoUrl,
            hasCommits: false
          }
          return { result: result as ConversationResult, updatedState, gitInfo }
        }
      }

      return await this.resumeExistingExecution(
        parentExecutionId,
        existingChildExecution.id,
        agentChkConfig,
        conversationRequest,
        parentState
      )
    }

    return await this.startFreshExecution(
      parentExecutionId,
      workflowId,
      agentChkConfig,
      conversationRequest,
      parentState,
      checkpointId
    )
  }

  private async resumeExistingExecution<T extends BaseWorkflowContext>(
    parentExecutionId: string,
    childExecutionId: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    conversationRequest: ConversationRequest,
    parentState: WorkflowState<T>
  ): Promise<{ result: ConversationResult; updatedState: WorkflowState<T>; gitInfo: GitInfo }> {

    const existingSteps = await this.storage.getChildWorkflowSteps(childExecutionId)
    const conversationHistory = this.reconstructConversationFromSteps(existingSteps)

    const resumeRequest: ConversationRequest = {
      ...conversationRequest,
      messages: conversationHistory
    }

    try {
      const { result, gitInfo } = await this.executeOpenCodeWithPauseCheck(
        parentExecutionId,
        childExecutionId,
        agentChkConfig,
        resumeRequest,
        parentState
      )

      const resultWithGitInfo = { ...result, gitInfo } as FrameworkExecutionResult
      await this.storage.markChildExecutionCompleted(childExecutionId, resultWithGitInfo)

      const updatedState = this.buildStateFromCompletedExecution(parentState, result as FrameworkExecutionResult)
      return { result, updatedState, gitInfo }

    } catch (error) {
      await this.handleExecutionError(childExecutionId, error)
      throw error
    }
  }

  private async startFreshExecution<T extends BaseWorkflowContext>(
    parentExecutionId: string,
    workflowId: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    conversationRequest: ConversationRequest,
    parentState: WorkflowState<T>,
    checkpointId: string
  ): Promise<{ result: ConversationResult; updatedState: WorkflowState<T>; gitInfo: GitInfo }> {

    const childExecutionId = await this.storage.createChildWorkflowExecution(
      parentExecutionId,
      workflowId,
      checkpointId
    )

    try {
      const { result, gitInfo } = await this.executeOpenCodeWithPauseCheck(
        parentExecutionId,
        childExecutionId,
        agentChkConfig,
        conversationRequest,
        parentState
      )

      const resultWithGitInfo = { ...result, gitInfo } as FrameworkExecutionResult
      await this.storage.markChildExecutionCompleted(childExecutionId, resultWithGitInfo)

      const updatedState = this.buildStateFromCompletedExecution(parentState, result as FrameworkExecutionResult)
      return { result, updatedState, gitInfo }

    } catch (error) {
      await this.handleExecutionError(childExecutionId, error)
      throw error
    }
  }

  private async startContinuationExecution<T extends BaseWorkflowContext>(
    parentExecutionId: string,
    workflowId: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    originalConversationRequest: ConversationRequest,
    parentState: WorkflowState<T>,
    checkpointId: string,
    continuationOverride: AgenticContinuationOverride
  ): Promise<{ result: ConversationResult; updatedState: WorkflowState<T>; gitInfo: GitInfo }> {

    const sourceGitInfo = await this.storage.getChildExecutionGitInfo(continuationOverride.sourceChildExecutionId)
    
    if (sourceGitInfo) {
      logger.info(`🔄 [OPENCODE-EXECUTOR] Source execution git info:`)
      logger.info(`   Branch: ${sourceGitInfo.branch}`)
      logger.info(`   Commit: ${sourceGitInfo.commitHash || 'N/A'}`)
      
      if (agentChkConfig.repoInfo) {
        agentChkConfig = {
          ...agentChkConfig,
          repoInfo: {
            ...agentChkConfig.repoInfo,
            repoBranch: sourceGitInfo.branch,
            continuationCommitHash: sourceGitInfo.commitHash,
            existingPrLink: sourceGitInfo.pr_link || sourceGitInfo.pullRequestUrl
          }
        }
      }
    }

    const sourceSteps = await this.storage.getChildWorkflowSteps(continuationOverride.sourceChildExecutionId)
    const reconstructedHistory = this.reconstructConversationFromSteps(sourceSteps)

    const continuationMessage = createUserMessage(continuationOverride.continuationUserMessage)

    const continuationRequest: ConversationRequest = {
      ...originalConversationRequest,
      messages: [...reconstructedHistory, continuationMessage]
    }

    const childExecutionId = await this.storage.createChildWorkflowExecution(
      parentExecutionId,
      workflowId,
      checkpointId
    )

    await this.storage.createUserMessageStep(childExecutionId, continuationOverride.continuationUserMessage)

    try {
      const { result, gitInfo } = await this.executeOpenCodeWithPauseCheck(
        parentExecutionId,
        childExecutionId,
        agentChkConfig,
        continuationRequest,
        parentState,
        true
      )

      const resultWithGitInfo = { ...result, gitInfo } as FrameworkExecutionResult
      await this.storage.markChildExecutionCompleted(childExecutionId, resultWithGitInfo)

      const updatedState = this.buildStateFromCompletedExecution(parentState, result as FrameworkExecutionResult)
      return { result, updatedState, gitInfo }

    } catch (error) {
      await this.handleExecutionError(childExecutionId, error)
      throw error
    }
  }

  private async executeOpenCodeWithPauseCheck<T extends BaseWorkflowContext>(
    parentExecutionId: string,
    childExecutionId: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    conversationRequest: ConversationRequest,
    parentState: WorkflowState<T>,
    isContinuation: boolean = false
  ): Promise<{ result: ConversationResult; gitInfo: GitInfo }> {
    const repoUrl = agentChkConfig.repoInfo?.repoUrl
    const baseBranch = agentChkConfig.repoInfo?.baseBranch
    const repoBranch = agentChkConfig.repoInfo?.repoBranch
    const checkoutCommit = agentChkConfig.repoInfo?.checkoutCommit
    const continuationCommitHash = agentChkConfig.repoInfo?.continuationCommitHash
    const existingPrLink = agentChkConfig.repoInfo?.existingPrLink
    let repoPath: string | undefined
    let branchName: string | undefined
    let projectName: string | undefined
    let repoName: string | undefined

    if (repoUrl) {
      await workspaceEventService.publishCloningStarted(parentExecutionId, childExecutionId)

      const cloneResult = await cloneRepository(
        repoUrl,
        parentExecutionId,
        baseBranch,
        repoBranch,
        isContinuation ? continuationCommitHash : undefined,
        checkoutCommit
      )

      logger.info(`🔧 [OPENCODE-EXECUTOR] Workspace at: ${cloneResult.repoPath}`)
      logger.info(`🔧 [OPENCODE-EXECUTOR] Parent execution ID: ${parentExecutionId}`)
      logger.info(`🔧 [OPENCODE-EXECUTOR] Child execution ID: ${childExecutionId}`)
      
      repoPath = cloneResult.repoPath
      branchName = cloneResult.branchName
      const extractedData = extractWorkspace(repoUrl)
      projectName = extractedData.projectName
      repoName = extractedData.repoName

      await workspaceEventService.publishWorkspaceReady(parentExecutionId, childExecutionId, repoUrl, branchName, baseBranch)
      
      if (agentChkConfig.repoInfo?.postCloneSetup) {
        await agentChkConfig.repoInfo.postCloneSetup(repoPath, repoName || 'unknown')
      }
    }

    if (repoUrl && !repoPath) {
      throw new Error(`[DIRECTORY-ISOLATION] Clone failed: repoUrl was provided but repoPath is not set. Refusing to fall back to local directory.`)
    }
    
    const workingDir = repoPath || process.cwd()
    const normalizedWorkingDir = pathResolve(pathNormalize(workingDir))

    const isIsolated = (() => {
      try {
        const allowedPaths = [
          pathResolve('/tmp/'),
          pathResolve('/var/folders/'),
          pathResolve(process.env.TMPDIR || '/tmp/')
        ]
        
        return allowedPaths.some(allowedPath => 
          normalizedWorkingDir.startsWith(allowedPath) && 
          !normalizedWorkingDir.includes('..')
        )
      } catch {
        return false
      }
    })()

    const isLocalRepo = (() => {
      try {
        const normalizedCwd = pathResolve(process.cwd())
        return normalizedWorkingDir.startsWith(normalizedCwd) && 
               normalizedWorkingDir.includes('xyne-spaces') &&
               !isIsolated
      } catch {
        return false
      }
    })()
    
    if (normalizedWorkingDir.includes('..')) {
      throw new Error(`[DIRECTORY-ISOLATION] Path traversal detected: ${workingDir}`)
    }
    
    if (repoUrl && !isIsolated) {
      throw new Error(`[DIRECTORY-ISOLATION] repoUrl provided but workingDir is not in isolated temp directory. Expected /tmp/{executionId} but got: ${normalizedWorkingDir}`)
    }
    
    if (isLocalRepo) {
      throw new Error(`[DIRECTORY-ISOLATION] workingDir is a local xyne-spaces checkout: ${normalizedWorkingDir}. Use an isolated temp directory instead.`)
    }
    
    const client = this.createScopedClient(normalizedWorkingDir)
    
    const commitTracker: OpenCodeCommitTracker = {
      hasCommits: false,
      branchName: branchName || '',
      repoUrl,
      childExecutionId,
      parentExecutionId,
      latestCommitHash: undefined,
      commitCount: 0
    }

    const abortController = new AbortController()

    const lspInstructions = `
## � CODE QUALITY INSTRUCTIONS - READ CAREFULLY 🔧

### RULE 1: COMPLETE IMPLEMENTATION FIRST, THEN FIX LSP ERRORS
When you see LSP errors after an edit:
- **DO NOT** immediately try to fix them by removing code
- **CONTINUE** with your implementation - the errors may resolve as you add more code
- LSP errors often occur because:
  - You declared something you'll use later in the implementation
  - You imported something you'll need in subsequent edits
  - You added a partial implementation that will be completed
- **ONLY** after completing ALL implementation steps, check for remaining LSP errors
- If errors persist after full implementation, THEN fix them minimally

### RULE 2: DO NOT DELETE CODE TO FIX LSP ERRORS
- NEVER remove implementation code just because of temporary LSP errors
- If a variable is "declared but never read", you probably need to USE it, not delete it
- If "Cannot find name X", add the import, don't remove the usage
- Prefer adding code (imports, usages) over removing code

### RULE 3: PROJECT-WIDE DIAGNOSTICS CHECK
After completing ALL implementation:
- Run the \`diagnostics\` tool with an EMPTY file_path parameter
- This checks ALL files in the project for errors
- Fix any remaining errors that are genuine issues (not temporary)

### RULE 4: EDIT RETRY ON FAILURE
If an edit fails with "file has been modified" or "must read file first":
- Re-read the file using the read tool
- Retry the edit with fresh content
- Do not give up

### RULE 5: COMPLETION CRITERIA
You are ONLY done when:
- All planned implementation steps are complete
- Running \`diagnostics\` with empty file_path shows no errors
- All todos are verified complete

**REMEMBER: Complete the implementation first. Many LSP errors resolve themselves as you add more code.**
`

    const systemPrompt = conversationRequest.systemPrompt
      ? conversationRequest.systemPrompt + `\n\nIMPORTANT: You MUST work in the following directory. All file operations should be relative to or within this path:\n${workingDir}\n${lspInstructions}`
      : `IMPORTANT: You MUST work in the following directory. All file operations should be relative to or within this path:\n${workingDir}\n${lspInstructions}`

    const dbModel = agentChkConfig.agentConfig?.model?.defaultModel
    const dbProviderType = agentChkConfig.agentConfig?.model?.provider?.type
    let modelOverride: { providerID: string; modelID: string } | undefined
    if (dbModel) {
      const providerID = dbProviderType === 'litellm' ? 'litellm' : 
                         dbProviderType === 'vertex' ? 'vertex' : 
                         'litellm'
      modelOverride = {
        providerID,
        modelID: dbModel
      }
    }

    let session = await client.createSession({
      directory: workingDir,
      title: `workflow-${parentExecutionId}-${childExecutionId}`
    })

    logger.info(`[OPENCODE-EXECUTOR] Created session ${session.id} for ${workingDir}`)

    if (session.directory && session.directory !== workingDir) {
      logger.error(`[DIRECTORY-MISMATCH] Session directory ${session.directory} != expected ${workingDir}`)
    }

    const { handleEvent, getStats } = createOpenCodeEventHandler({
      childExecutionId,
      parentExecutionId,
      commitTracker,
      repoPath: workingDir,
      agentChkConfig,
      storage: this.storage,
      abortController,
      processedToolCalls: new Set(),
      processedToolResults: new Set(),
      checkPauseOrCancel: () => this.checkWorkflowPauseOrCancelStatusAndThrow(childExecutionId, abortController),
      grantPermission: async (sessionId: string, permissionId: string) => {
        await client.grantPermission(sessionId, permissionId)
      }
    })

    const unsubscribe = client.subscribeToSessionEvents(session.id, handleEvent)

    let result: ConversationResult
    let promptResponse: SDKPromptResponse | undefined
    
    try {
      const userMessage = this.extractUserMessage(conversationRequest)
      const MAX_CONTINUATION_ATTEMPTS = 5
      let continuationAttempt = 0
      let isComplete = false
      
      while (!isComplete && continuationAttempt < MAX_CONTINUATION_ATTEMPTS) {
        const isFirstAttempt = continuationAttempt === 0
        const messageToSend = isFirstAttempt 
          ? userMessage 
          : await this.buildContinuationPrompt(getStats(), client, session.id)
        
        const systemPromptToUse = isFirstAttempt ? systemPrompt : undefined
        const MAX_PROMPT_RETRIES = 5
        let promptRetry = 0
        let lastError: unknown
        
        while (promptRetry < MAX_PROMPT_RETRIES) {
          try {
            // Use streaming prompt to avoid headers timeout issues
            promptResponse = await client.promptWithStreaming(
              session.id, 
              messageToSend, 
              systemPromptToUse, 
              modelOverride,
              600000 // 10 minute timeout
            )
            break
          } catch (err) {
            lastError = err
            const errorWithCause = err as Error & { cause?: Error }
            const isTimeoutError = err instanceof Error && 
              (err.message.includes('fetch failed') || 
               err.message.includes('HeadersTimeoutError') ||
               err.message.includes('timed out') ||
               errorWithCause.cause?.message?.includes('Headers Timeout'));
            
            if (isTimeoutError && promptRetry < MAX_PROMPT_RETRIES - 1) {
              promptRetry++
              const backoffMs = Math.min(5000 * Math.pow(2, promptRetry - 1), 30000)
              logger.warn(`[OPENCODE-EXECUTOR] Prompt timeout (attempt ${promptRetry}/${MAX_PROMPT_RETRIES}), retrying in ${backoffMs}ms...`)
              await new Promise(resolve => setTimeout(resolve, backoffMs))
              try {
                const sessionStatus = await client.getSession(session.id)
                const sessionWithStatus = sessionStatus as { status?: string }
                if (!sessionStatus || sessionWithStatus.status === 'error') {
                  logger.error('[OPENCODE-EXECUTOR] Session became invalid, stopping retries')
                  throw new Error('Session became invalid after timeout')
                }
              } catch (sessionErr) {
                logger.error(`[OPENCODE-EXECUTOR] Session check failed, stopping retries:`, sessionErr)
                throw new Error(`Session validation failed after ${promptRetry} retries: ${sessionErr instanceof Error ? sessionErr.message : String(sessionErr)}`)
              }
            } else {
              throw err
            }
          }
        }
        
        if (!promptResponse) {
          throw lastError || new Error('No response received after retries')
        }

        await this.processPromptResponse(
          promptResponse,
          childExecutionId,
          parentExecutionId,
          commitTracker,
          workingDir,
          agentChkConfig,
          abortController
        )

        const stats = getStats()
        const hasUnfixedLspErrors = stats.lspErrorsUnfixed.size > 0
        const finishReason = promptResponse.info?.finish
        const todoCheck = await client.hasIncompleteTodos(session.id)
        const hasIncompleteTodos = todoCheck.hasIncomplete

        if (finishReason === 'stop' && !hasUnfixedLspErrors && !hasIncompleteTodos) {
          logger.info(`✅ [OPENCODE-EXECUTOR] LLM finished with stop, no LSP errors, no incomplete todos - task complete`)
          isComplete = true
        } else if (finishReason === 'stop' && (hasUnfixedLspErrors || hasIncompleteTodos)) {
          const reasons: string[] = []
          if (hasUnfixedLspErrors) reasons.push(`${stats.lspErrorsUnfixed.size} unfixed LSP errors`)
          if (hasIncompleteTodos) reasons.push(`${todoCheck.todos.length} incomplete todos`)
          logger.warn(`[OPENCODE-EXECUTOR] LLM stopped but has ${reasons.join(' and ')} - will re-prompt`)
          continuationAttempt++
        } else if (finishReason === 'tool-calls') {
          isComplete = true
        } else {
          isComplete = true
        }
      }
      
      if (continuationAttempt >= MAX_CONTINUATION_ATTEMPTS) {
        logger.warn(`[OPENCODE-EXECUTOR] Reached max continuation attempts (${MAX_CONTINUATION_ATTEMPTS}), stopping`)
      }

      if (!promptResponse) {
        throw new Error('No response received from OpenCode')
      }
      result = this.buildConversationResultFromResponse(promptResponse, session, getStats())

    } catch (openCodeError) {
      logger.error(`[OPENCODE-EXECUTOR] OpenCode execution failed:`, openCodeError)

      const errorWithCause = openCodeError as Error & { cause?: Error }
      const isTimeoutError = openCodeError instanceof Error && 
        (openCodeError.message.includes('fetch failed') || 
         openCodeError.message.includes('HeadersTimeoutError') ||
         errorWithCause.cause?.message?.includes('Headers Timeout'));

      if (isTimeoutError) {
        logger.warn(`[OPENCODE-EXECUTOR] Timeout error detected - checking if we can resume...`)
        try {
          const todoCheck = await client.hasIncompleteTodos(session.id)
          if (todoCheck.hasIncomplete) {
            const stats = getStats()
            const incompleteTodoList = todoCheck.todos.map(t => `- [${t.status}] ${t.content}`).join('\n')
            const resumePrompt = `The previous execution was interrupted by a network timeout. Please continue the work.

INCOMPLETE TODOS:
${incompleteTodoList}

PROGRESS SO FAR:
- Commits made: ${commitTracker.commitCount}
- LSP errors detected: ${stats.lspErrorsDetected}
- LSP errors remaining: ${stats.lspErrorsUnfixed.size}

Please complete the remaining todos. Focus on the incomplete tasks.`

            const MAX_RESUME_RETRIES = 5
            let resumeRetry = 0
            while (resumeRetry < MAX_RESUME_RETRIES) {
              try {
                const resumeSession = await client.createSession({
                  directory: workingDir,
                  title: `resume-${parentExecutionId}-${childExecutionId}`
                })
                
                // Use streaming prompt to avoid headers timeout
                promptResponse = await client.promptWithStreaming(
                  resumeSession.id, 
                  resumePrompt, 
                  systemPrompt, 
                  modelOverride,
                  600000
                )
                await this.processPromptResponse(
                  promptResponse,
                  childExecutionId,
                  parentExecutionId,
                  commitTracker,
                  workingDir,
                  agentChkConfig,
                  abortController
                )
                session = resumeSession
                break
              } catch (resumePromptError) {
                resumeRetry++
                const isResumeTimeout = resumePromptError instanceof Error &&
                  (resumePromptError.message.includes('fetch failed') ||
                   resumePromptError.message.includes('HeadersTimeoutError') ||
                   resumePromptError.message.includes('timed out'));
                
                if (isResumeTimeout && resumeRetry < MAX_RESUME_RETRIES) {
                  const backoffMs = 10000 * resumeRetry
                  logger.warn(`[OPENCODE-EXECUTOR] Resume attempt ${resumeRetry} timed out, retrying in ${backoffMs}ms...`)
                  await new Promise(r => setTimeout(r, backoffMs))
                } else {
                  logger.error(`[OPENCODE-EXECUTOR] Resume failed after ${resumeRetry} attempts:`, resumePromptError)
                  break
                }
              }
            }
          }
        } catch (resumeError) {
          logger.error(`[OPENCODE-EXECUTOR] Failed to check/resume after timeout:`, resumeError)
        }
      }

      if (commitTracker.hasCommits) {
        if (promptResponse) {
          const baseResult = this.buildConversationResultFromResponse(promptResponse, session, getStats())
          result = { ...baseResult, error: `Completed with error: ${openCodeError}` }
        } else {
          result = this.buildErrorResultWithCommits(openCodeError, commitTracker)
        }
      } else {
        await this.handleExecutionError(childExecutionId, openCodeError)
        throw openCodeError
      }
    } finally {
      unsubscribe()

      try {
        await client.deleteSession(session.id)
        logger.info(`🧹 [OPENCODE-EXECUTOR] Cleaned up session ${session.id}`)
      } catch (cleanupError) {
        logger.warn(`[OPENCODE-EXECUTOR] Failed to cleanup session:`, cleanupError)
      }
    }

    if (repoPath) {
      const { hasUncommittedChanges: checkUncommitted, commitAllChanges: doCommit } = await import('@framework')
      
      const hasUncommittedWork = await checkUncommitted(repoPath)
      
      if (hasUncommittedWork) {
        const finalCommitMessage = agentChkConfig.repoInfo?.getCommitMessage
          ? agentChkConfig.repoInfo.getCommitMessage('Final auto-commit of remaining changes')
          : 'Final auto-commit of remaining changes'
        
        const coAuthor = agentChkConfig.repoInfo?.coAuthor
        const finalCommitHash = await doCommit(repoPath, finalCommitMessage, coAuthor?.name, coAuthor?.email)
        if (finalCommitHash) {
          commitTracker.hasCommits = true
          commitTracker.latestCommitHash = finalCommitHash
          commitTracker.commitCount++
          logger.info(`[OPENCODE-EXECUTOR] Final commit created: ${finalCommitHash.substring(0, 8)}`)
        }
      }
    }
    
    let pushResult: { repoUrl?: string; pullRequestUrl?: string } | undefined

    if (commitTracker.hasCommits && repoPath && branchName) {
      pushResult = await pushCommits(repoPath, branchName, repoUrl)
      logger.info(`[OPENCODE-EXECUTOR] Pushed ${commitTracker.commitCount} commit(s) to ${branchName}`)

      if (commitTracker.latestCommitHash) {
        await workspaceEventService.publishFileTreeUpdate(
          parentExecutionId,
          childExecutionId,
          commitTracker.latestCommitHash
        )
      }

      if (isContinuation && existingPrLink) {
        if (pushResult) {
          pushResult.pullRequestUrl = existingPrLink
        } else {
          pushResult = { pullRequestUrl: existingPrLink, repoUrl }
        }
      } else {
        const workflow = await this.workflowRepo.findById(parentState.workflowId)
        const ticketId = workflow?.ticketId || ''
        const ticket = ticketId ? await this.ticketRepo.findById(ticketId) : null
        const xyneId = ticket?.xyneId
        const ticketTitle: string | undefined = ticket?.title || ('title' in parentState.context ? parentState.context.title : null) as string | undefined
        const ticketDescription = await this.generatePRDescription(conversationRequest, parentState)

        try {
          const prTargetBranch = baseBranch || 'main'
          await this.bitbucketManager.raisePr(repoUrl, childExecutionId, prTargetBranch, branchName, projectName, repoName, ticketTitle, ticketDescription, xyneId, ticketId)
        } catch (error) {
          logger.error(`[OPENCODE-EXECUTOR] Failed to create PR:`, error)
        }
      }
    }

    let customPrLink: string | undefined
    if (commitTracker.latestCommitHash && agentChkConfig.repoInfo?.getPrLink) {
      const targetBranch = agentChkConfig.repoInfo.baseBranch || 'staging'
      const repository = agentChkConfig.repoInfo.repository || 'unknown'
      try {
        customPrLink = agentChkConfig.repoInfo.getPrLink({
          commitHash: commitTracker.latestCommitHash,
          baseBranch: targetBranch,
          repository: repository
        })
      } catch (error) {
        logger.error(`[OPENCODE-EXECUTOR] Failed to generate PR link:`, error)
      }
    }

    let gitDiff: GitDiffFile[] | undefined
    let diffStats: GitDiffStats | undefined
    let baseCommitHash: string | undefined
    
    if (repoPath && baseBranch && commitTracker.hasCommits) {
      try {
        const { stdout } = await execAsync(`git merge-base HEAD origin/${baseBranch}`, { cwd: repoPath })
        baseCommitHash = stdout.trim()
        logger.info(`[OPENCODE-EXECUTOR] Using merge-base: ${baseCommitHash.substring(0, 8)} (vs ${baseBranch})`)

        const diffResult = await this.computeGitDiff(repoPath, baseCommitHash)
        gitDiff = diffResult.gitDiff
        diffStats = diffResult.diffStats
      } catch (error) {
        logger.error(`[OPENCODE-EXECUTOR] Failed to compute git diff with merge-base:`, error)
      }
    }

    const gitInfo: GitInfo = {
      branch: branchName || agentChkConfig.repoInfo?.repoBranch || 'main',
      repoUrl: commitTracker.repoUrl,
      commitHash: commitTracker.latestCommitHash,
      baseCommitHash,
      pullRequestUrl: pushResult?.pullRequestUrl,
      pr_link: customPrLink || pushResult?.pullRequestUrl,
      gitDiff,
      diffStats
    }

    if (repoPath) {
      await workspaceEventService.publishWorkspaceClosed(parentExecutionId, childExecutionId)
    }

    if (result.error && !commitTracker.hasCommits) {
      throw new Error(result.error)
    }

    return { result, gitInfo }
  }

  private extractUserMessage(conversationRequest: ConversationRequest): string {
    const messages = conversationRequest.messages || []
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      
      if (msg && typeof msg === 'object' && 'role' in msg && 'content' in msg) {
        const typedMsg = msg as { role?: string; type?: string; content?: string }
        if (typedMsg.role === 'user' || typedMsg.type === 'user') {
          return typedMsg.content || ''
        }
      }
    }
    const firstMsg = messages[0]
    if (firstMsg && typeof firstMsg === 'object' && 'content' in firstMsg) {
      return (firstMsg as { content?: string }).content || ''
    }
    
    return ''
  }

  private async processPromptResponse(
    response: SDKPromptResponse,
    childExecutionId: string,
    parentExecutionId: string,
    commitTracker: OpenCodeCommitTracker,
    repoPath: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    abortController: AbortController
  ): Promise<void> {
    if (!response?.parts || !Array.isArray(response.parts)) {
      return
    }

    const partTypeCounts: Record<string, number> = {}
    for (const part of response.parts) {
      partTypeCounts[part.type] = (partTypeCounts[part.type] || 0) + 1
    }

    const processedToolCalls = new Set<string>()
    const toolCallsInResponse: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = []
    let textContent = ''
    let reasoningContent = ''
    let stepNumber = 0

    for (const part of response.parts) {
      await this.checkWorkflowPauseOrCancelStatusAndThrow(childExecutionId, abortController)

      switch (part.type) {
        case 'tool': {
          const toolPart = part as ToolPart
          if (!processedToolCalls.has(toolPart.callID)) {
            toolCallsInResponse.push({
              id: toolPart.callID,
              name: toolPart.tool,
              arguments: toolPart.state.input
            })
          }
          await this.processToolPart(
            toolPart,
            childExecutionId,
            commitTracker,
            parentExecutionId,
            repoPath,
            agentChkConfig,
            processedToolCalls
          )
          break
        }

        case 'text': {
          const textPart = part as TextPart
          textContent += textPart.text
          break
        }

        case 'reasoning': {
          const reasoningPart = part as ReasoningPart
          reasoningContent += reasoningPart.text
          break
        }

        case 'step-start': {
          stepNumber++
          break
        }

        case 'step-finish': {
          const stepFinish = part as StepFinishPart
          await this.storage.createAssistantMessageStep(childExecutionId, {
            turn: stepNumber,
            result: {
              content: textContent,
              thinking: reasoningContent || undefined,
              finish: stepFinish.reason,
              tokens: stepFinish.tokens,
              cost: stepFinish.cost
            }
          })
          break
        }

        default:
          break
      }
    }

    if (textContent || reasoningContent || toolCallsInResponse.length > 0) {
      await this.storage.createLLMCallStep(childExecutionId, {
        messages: [],
        content: textContent,
        thinking: reasoningContent || undefined,
        toolCalls: toolCallsInResponse.length > 0 ? toolCallsInResponse : undefined,
        tokens: response.info?.tokens
      })
    }

    if (response.info?.error) {
      const error = response.info.error
      const errorMessage = ('data' in error && error.data && 'message' in error.data) 
        ? error.data.message 
        : ('name' in error ? error.name : 'Unknown error')
      await this.storage.createErrorStep(
        childExecutionId, 
        new Error(`OpenCode error: ${errorMessage}`)
      )
      logger.error(`[OPENCODE-EXECUTOR] Error in response: ${errorMessage}`)
    }
  }

  private async processToolPart(
    toolPart: ToolPart,
    childExecutionId: string,
    commitTracker: OpenCodeCommitTracker,
    parentExecutionId: string,
    repoPath: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    processedToolCalls: Set<string>
  ): Promise<void> {
    const callId = toolPart.callID
    if (processedToolCalls.has(callId)) {
      return
    }
    processedToolCalls.add(callId)

    const toolName = toolPart.tool
    const state = toolPart.state

    await this.storage.createToolExecutionStep(childExecutionId, {
      id: callId,
      name: toolName,
      input: state.input,
      output: null,
      duration: 0,
      success: false
    })

    if (state.status === 'completed') {
      const { hasUncommittedChanges, commitAllChanges } = await import('@framework')
      
      const hasChanges = await hasUncommittedChanges(repoPath)

      let updateAgentData: any = {
        repositoryURL: commitTracker.repoUrl,
        branch: commitTracker.branchName
      }

      if (hasChanges) {
        const commitMessage = `Auto-commit changes from tool execution ${callId}`
        const updatedCommitMessage = agentChkConfig.repoInfo?.getCommitMessage
          ? agentChkConfig.repoInfo.getCommitMessage(commitMessage)
          : commitMessage

        const coAuthor = agentChkConfig.repoInfo?.coAuthor
        const commitHash = await commitAllChanges(
          repoPath,
          updatedCommitMessage,
          coAuthor?.name,
          coAuthor?.email
        )

        if (commitHash) {
          updateAgentData = { ...updateAgentData, commitHash }
          commitTracker.hasCommits = true
          commitTracker.latestCommitHash = commitHash
          commitTracker.commitCount++

          if (repoPath && commitTracker.branchName && commitTracker.repoUrl) {
            try {
              await pushCommits(repoPath, commitTracker.branchName, commitTracker.repoUrl)

              await workspaceEventService.publishFileTreeUpdate(
                parentExecutionId,
                childExecutionId,
                commitHash
              )
            } catch (pushError) {
              logger.error(`[OPENCODE-EXECUTOR] Failed to push commit:`, pushError)
            }
          }
        }
      }

      const agentStep = await this.storage.updateToolExecutionAgentStep(callId, updateAgentData)
      let parsedOutput: unknown
      try {
        parsedOutput = JSON.parse(state.output)
      } catch (parseError) {
        logger.warn(`[OPENCODE-EXECUTOR] Failed to parse tool output as JSON for ${toolName}:`, {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          toolId: callId
        })
        
        const trimmedOutput = state.output?.trim() || ''
        if (trimmedOutput.startsWith('{') || trimmedOutput.startsWith('[')) {
          logger.error(`[OPENCODE-EXECUTOR] Tool ${toolName} returned malformed JSON`)
        }
        
        parsedOutput = { 
          content: state.output,
          _parseError: true
        }
      }

      const transformedInput = this.transformToolInput(toolName, state.input as Record<string, unknown>)
      const transformedOutput = this.transformToolOutput(toolName, parsedOutput)

      await this.storage.updateToolExecutionStep(
        agentStep.stepsId || '',
        transformedOutput,
        'completed',
        transformedInput
      )

    } else if (state.status === 'error') {
      await this.storage.createErrorStep(
        childExecutionId,
        new Error(`Tool ${toolName} failed: ${state.error}`)
      )

      const agentStep = await this.storage.updateToolExecutionAgentStep(callId, {
        repositoryURL: commitTracker.repoUrl,
        branch: commitTracker.branchName
      })

      await this.storage.updateToolExecutionStep(
        agentStep.stepsId || '',
        { error: state.error },
        'failed',
        state.input as Record<string, unknown>
      )

      logger.error(`[OPENCODE-EXECUTOR] Tool ${toolName} failed: ${state.error}`)
    }
  }

  private transformToolInput(toolName: string, rawInput: Record<string, unknown>): Record<string, unknown> {
    if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
      logger.warn(`[OPENCODE-EXECUTOR] Invalid tool input for ${toolName}:`, rawInput)
      return {}
    }

    if (
      Object.prototype.hasOwnProperty.call(rawInput, '__proto__') ||
      Object.prototype.hasOwnProperty.call(rawInput, 'constructor') ||
      Object.prototype.hasOwnProperty.call(rawInput, 'prototype')
    ) {
      logger.warn(`[OPENCODE-EXECUTOR] Potentially malicious input detected for ${toolName}`)
      return {}
    }

    const validateString = (value: unknown, fallback: string = ''): string => {
      return typeof value === 'string' ? value : fallback
    }

    switch (toolName) {
      case 'read':
        return {
          file_path: validateString(rawInput.filePath || rawInput.file_path || rawInput.path),
          ...rawInput
        }

      case 'write':
        return {
          file_path: validateString(rawInput.filePath || rawInput.file_path),
          content: validateString(rawInput.content),
          ...rawInput
        }

      case 'edit':
        return {
          file_path: validateString(rawInput.filePath || rawInput.file_path),
          old_string: validateString(rawInput.oldString || rawInput.old_string),
          new_string: validateString(rawInput.newString || rawInput.new_string),
          ...rawInput
        }

      case 'glob':
        return {
          pattern: validateString(rawInput.pattern),
          path: validateString(rawInput.path || rawInput.directory),
          ...rawInput
        }

      default:
        return rawInput
    }
  }

  private transformToolOutput(toolName: string, rawOutput: any): any {
    if (rawOutput?.error) {
      return rawOutput
    }

    switch (toolName) {
      case 'bash':
        if (rawOutput?.content) {
          return {
            stdout: rawOutput.content,
            stderr: '',
            exitCode: 0
          }
        }
        if (rawOutput?.stdout !== undefined) {
          return rawOutput
        }
        return { stdout: JSON.stringify(rawOutput), stderr: '', exitCode: 0 }

      case 'todoread':
      case 'todowrite':
        if (Array.isArray(rawOutput)) {
          return {
            success: true,
            todosUpdated: rawOutput.length,
            todos: rawOutput
          }
        }
        if (rawOutput?.content && typeof rawOutput.content === 'string') {
          try {
            const todos = JSON.parse(rawOutput.content)
            if (Array.isArray(todos)) {
              return {
                success: true,
                todosUpdated: todos.length,
                todos: todos
              }
            }
          } catch {
            // Not JSON, keep as-is
          }
        }
        return { success: true, ...rawOutput }

      case 'glob':
        if (rawOutput?.content && typeof rawOutput.content === 'string') {
          const files = rawOutput.content.split('\n').filter((f: string) => f.trim().length > 0)
          return {
            files: files,
            count: files.length
          }
        }
        if (rawOutput?.content === '' || (typeof rawOutput?.content === 'string' && !rawOutput.content.trim())) {
          return {
            files: [],
            count: 0
          }
        }
        if (Array.isArray(rawOutput?.files)) {
          return {
            files: rawOutput.files,
            count: rawOutput.count || rawOutput.files.length
          }
        }
        return { files: [], count: 0 }

      case 'read':
        if (typeof rawOutput === 'string') {
          return { content: rawOutput }
        }
        if (rawOutput?.content) {
          return { content: rawOutput.content }
        }
        return rawOutput

      case 'write':
        if (typeof rawOutput === 'string') {
          return { 
            success: rawOutput.toLowerCase().includes('success'),
            message: rawOutput
          }
        }
        if (rawOutput?.content && typeof rawOutput.content === 'string') {
          return {
            success: rawOutput.content.toLowerCase().includes('success'),
            message: rawOutput.content
          }
        }
        return { success: true, ...rawOutput }

      case 'edit':
        if (typeof rawOutput === 'string') {
          return { 
            success: !rawOutput.toLowerCase().includes('error'),
            message: rawOutput
          }
        }
        return rawOutput

      default:
        return rawOutput
    }
  }

  private buildConversationResultFromResponse(
    response: SDKPromptResponse,
    session: SessionInfo,
    stats: ReturnType<ReturnType<typeof createOpenCodeEventHandler>['getStats']>
  ): ConversationResult {
    if (stats.lspErrorsUnfixed.size > 0) {
      const unfixedFiles = Array.from(stats.lspErrorsUnfixed).join(', ')
      logger.warn(`[OPENCODE-EXECUTOR] LSP errors remain unfixed in: ${unfixedFiles}`)
    }

    const textContent = response.parts
      ?.filter((p): p is TextPart => p.type === 'text')
      .map(p => p.text)
      .join('\n') || ''

    const messages: any[] = [
      {
        role: 'assistant',
        content: textContent,
        toolCalls: response.parts
          ?.filter((p): p is ToolPart => p.type === 'tool')
          .map(p => ({
            id: p.callID,
            name: p.tool,
            arguments: p.state.input
          }))
      }
    ]

    const hasLspErrors = stats.lspErrorsUnfixed.size > 0
    const hasError = response.info?.error || session.status === 'error' || hasLspErrors
    const finishReason = response.info?.finish

    return {
      messages,
      error: hasError 
        ? hasLspErrors 
          ? `Session completed with ${stats.lspErrorsUnfixed.size} files having unfixed LSP errors`
          : `Session completed with error`
        : undefined,
      toolExecutions: [],
      metrics: {
        totalDuration: response.info?.time?.completed 
          ? (response.info.time.completed - response.info.time.created) 
          : 0,
        llmCalls: 1,
        totalTokens: (response.info?.tokens?.input || 0) + (response.info?.tokens?.output || 0),
        toolExecutions: response.parts?.filter(p => p.type === 'tool').length || 0,
        averageToolDuration: 0,
        conversationTurns: 1,
        startTime: new Date(response.info?.time?.created || Date.now()),
        endTime: new Date(response.info?.time?.completed || Date.now())
      },
      status: finishReason === 'stop' && !hasError ? 'completed' : 'error'
    }
  }

  private buildErrorResultWithCommits(error: unknown, commitTracker: OpenCodeCommitTracker): ConversationResult {
    return {
      error: `OpenCode execution failed but commits were made: ${error}`,
      messages: [],
      toolExecutions: [],
      metrics: {
        totalDuration: 0,
        llmCalls: 0,
        totalTokens: 0,
        toolExecutions: commitTracker.commitCount,
        averageToolDuration: 0,
        conversationTurns: 0,
        startTime: new Date(),
        endTime: new Date()
      },
      status: 'error' as const
    }
  }

  private async buildContinuationPrompt(
    stats: EventProcessingStats, 
    client: OpenCodeClient, 
    sessionId: string
  ): Promise<string> {
    const parts: string[] = []
    
    parts.push('🔴 IMPORTANT: You stopped but the task is NOT complete!')
    parts.push('')
    
    if (stats.lspErrorsUnfixed.size > 0) {
      parts.push(`⚠️ There are ${stats.lspErrorsUnfixed.size} files with UNFIXED LSP errors:`)
      stats.lspErrorsUnfixed.forEach(file => {
        parts.push(`  - ${file}`)
      })
      parts.push('')
      parts.push('You MUST fix these LSP errors before the task can be considered complete.')
      parts.push('Please read each file with errors and fix them now.')
      parts.push('')
    }

    try {
      const todoCheck = await client.hasIncompleteTodos(sessionId)
      if (todoCheck.hasIncomplete) {
        parts.push(`📋 You have ${todoCheck.todos.length} INCOMPLETE todo items:`)
        todoCheck.todos.forEach(todo => {
          parts.push(`  - [${todo.status}] ${todo.content}`)
        })
        parts.push('')
        parts.push('You must complete ALL todo items before stopping.')
        parts.push('')
      }
    } catch (error) {
      logger.error(`[OPENCODE-EXECUTOR] Failed to fetch todos for continuation prompt:`, error)
    }
    
    parts.push('Instructions:')
    parts.push('1. Check your todo list - complete all incomplete items')
    parts.push('2. For each file with LSP errors, read it and fix the errors')
    parts.push('3. After fixing, run the `diagnostics` tool with empty file_path to verify')
    parts.push('4. Only stop when ALL todos are complete AND there are no LSP errors')
    parts.push('')
    parts.push('Continue working on the task now.')
    
    return parts.join('\n')
  }

  private async generatePRDescription<T extends BaseWorkflowContext>(
    _conversationRequest: ConversationRequest,
    parentState: WorkflowState<T>
  ): Promise<string> {
    const ticketDescription: string | undefined = ('description' in parentState.context ? parentState.context.description : null) as string | undefined
    return ticketDescription || 'Automated changes from OpenCode workflow'
  }

  private async checkWorkflowPauseOrCancelStatusAndThrow(
    childExecutionId: string,
    abortController: AbortController
  ): Promise<void> {
    const pauseStatus = await this.storage.checkWorkflowPauseOrCancelStatus(childExecutionId)

    if (pauseStatus.isCancelled) {
      abortController.abort()
      throw new WorkflowCancelledException(
        pauseStatus.parentExecutionId || childExecutionId,
        'opencode_step_cancelled'
      )
    }

    if (pauseStatus.isPaused) {
      throw new WorkflowPausedException(
        pauseStatus.parentExecutionId || childExecutionId,
        'opencode_step_paused'
      )
    }
  }

  private async handleExecutionError(childExecutionId: string, error: unknown): Promise<void> {
    if (error instanceof WorkflowCancelledException) {
      await this.storage.markChildExecutionCancelled(childExecutionId, 'workflow_cancelled')
      return
    }

    if (error instanceof Error && error.message === 'Execution aborted') {
      await this.storage.markChildExecutionCancelled(childExecutionId, 'execution_aborted')
      throw new WorkflowCancelledException(childExecutionId, 'opencode_step_cancelled')
    }

    if (error instanceof WorkflowPausedException) {
      throw error
    }

    await this.storage.markChildExecutionFailed(childExecutionId, this.serializeError(error as Error))
  }

  private serializeError(err: Error): string {
    return JSON.stringify({
      name: err.name,
      message: err.message,
      stack: err.stack,
    })
  }

  private buildStateFromCompletedExecution<T extends BaseWorkflowContext>(
    parentState: WorkflowState<T>,
    result: FrameworkExecutionResult
  ): WorkflowState<T> {
    return {
      ...parentState,
      context: {
        ...parentState.context,
        agentResult: result
      } as T
    }
  }

  private reconstructConversationFromSteps(steps: any[]): Message[] {
    const conversationHistory: Message[] = []

    const sortedSteps = steps.sort((a: any, b: any) => 
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )

    for (const step of sortedSteps) {
      if (!step.data) continue

      try {
        const stepData = typeof step.data === 'string' ? JSON.parse(step.data) : step.data
        const stepName = step.stepName || ''

        if (stepName === 'user_message') {
          conversationHistory.push({
            role: 'user',
            content: stepData.content || ''
          } as unknown as Message)

        } else if (stepName.startsWith('tool_')) {
          if (stepData.output !== null && stepData.output !== undefined) {
            const toolResultMessage = createToolResultMessage(
              JSON.stringify(stepData.output),
              stepData.id || `tool_${Date.now()}`,
              stepData.success !== false,
              {
                error: stepData.error,
                executionTime: stepData.duration
              }
            )
            conversationHistory.push(toolResultMessage)
          }

        } else if (stepName.startsWith('llm_call_') || stepName === 'assistant_message') {
          const content = stepData.response || stepData.content || stepData.turn?.result?.content
          if (content) {
            const assistantMessage = createAssistantMessage(content, {
              thinking: stepData.thinking,
              toolCalls: stepData.toolCalls
            })
            conversationHistory.push(assistantMessage)
          }
        }
      } catch (error) {
        logger.error(`Error parsing step data for ${step.stepName}:`, error)
        continue
      }
    }

    return conversationHistory
  }

  private async computeGitDiff(
    repoPath: string,
    baseCommitHash: string
  ): Promise<{ gitDiff: GitDiffFile[]; diffStats: GitDiffStats }> {
    try {
      const { stdout: diffOutput } = await execAsync(`git diff --unified=3 ${baseCommitHash}..HEAD`, {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024
      })

      const diffStats = await this.getGitDiffStats(repoPath, baseCommitHash)
      const gitDiff = this.parseGitDiff(diffOutput)

      return { gitDiff, diffStats }
    } catch (error) {
      logger.error(`[OPENCODE-EXECUTOR] Failed to compute git diff:`, error)
      return { gitDiff: [], diffStats: { additions: 0, deletions: 0, files: 0 } }
    }
  }

  private async getGitDiffStats(repoPath: string, baseCommitHash: string): Promise<GitDiffStats> {
    try {
      const { stdout } = await execAsync(`git diff --stat ${baseCommitHash}..HEAD`, {
        cwd: repoPath
      })

      const statsMatch = stdout.match(/(\d+)\s+files?\s+changed,\s+(\d+)\s+insertions?\(\+\),\s+(\d+)\s+deletions?\(-\)/)

      if (statsMatch) {
        return {
          files: parseInt(statsMatch[1], 10),
          additions: parseInt(statsMatch[2], 10),
          deletions: parseInt(statsMatch[3], 10)
        }
      }

      return { additions: 0, deletions: 0, files: 0 }
    } catch {
      return { additions: 0, deletions: 0, files: 0 }
    }
  }

  private parseGitDiff(diffOutput: string): GitDiffFile[] {
    const files: GitDiffFile[] = []
    const lines = diffOutput.split('\n')
    let currentFile: GitDiffFile | null = null
    let currentHunk: { oldStart: number; oldLines: number; newStart: number; newLines: number; content: string } | null = null
    let hunkLines: string[] = []

    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        if (currentFile) {
          if (currentHunk && hunkLines.length > 0) {
            currentHunk.content = hunkLines.join('\n')
            currentFile.hunks.push(currentHunk)
          }
          files.push(currentFile)
        }

        const match = line.match(/diff --git a\/(.+) b\/(.+)/)
        if (match) {
          currentFile = {
            oldPath: match[1],
            newPath: match[2],
            type: 'modify',
            hunks: []
          }
          currentHunk = null
          hunkLines = []
        }
      } else if (line.startsWith('new file mode')) {
        if (currentFile) currentFile.type = 'add'
      } else if (line.startsWith('deleted file mode')) {
        if (currentFile) currentFile.type = 'delete'
      } else if (line.startsWith('rename from')) {
        if (currentFile) currentFile.type = 'rename'
      } else if (line.startsWith('@@')) {
        if (currentFile && currentHunk && hunkLines.length > 0) {
          currentHunk.content = hunkLines.join('\n')
          currentFile.hunks.push(currentHunk)
        }

        const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
        if (match) {
          currentHunk = {
            oldStart: parseInt(match[1], 10),
            oldLines: parseInt(match[2] || '1', 10),
            newStart: parseInt(match[3], 10),
            newLines: parseInt(match[4] || '1', 10),
            content: ''
          }
          hunkLines = []
        }
      } else if (currentFile && currentHunk) {
        hunkLines.push(line)
      }
    }

    if (currentFile) {
      if (currentHunk && hunkLines.length > 0) {
        currentHunk.content = hunkLines.join('\n')
        currentFile.hunks.push(currentHunk)
      }
      files.push(currentFile)
    }

    return files
  }
}
