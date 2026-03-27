import { WorkflowStorage, FrameworkExecutionResult } from '../../workflow-storage'
import { FullAgenticCheckpointConfig, WorkflowState, BaseWorkflowContext, GitInfo, GitDiffFile, GitDiffStats, AgenticContinuationOverride } from '../../workflow-types'
import { WorkflowPausedException, WorkflowCancelledException, WorkflowExternalWaitException } from '../../exceptions/workflow-exceptions'
import { BitbucketManager } from '@/bitbucket/apis'
import { WorkflowRepository, TicketRepository } from '@/database/repositories/workflows'
import { logger } from '@/utils/logger'
import { exec } from 'child_process'
import { promisify } from 'util'
import { realpath } from 'fs/promises'

const execAsync = promisify(exec)

import { cloneRepository, pushCommits, hasUncommittedChanges, commitAllChanges } from '@framework'
import { workspaceEventService } from '@/services/workspaceEventService'

import { OpenCodeClient } from './opencode-client'
import {
  OpenCodeConfig,
  OpenCodeCommitTracker,
  SessionInfo,
  SDKPromptResponse,
  QuestionAskedEvent,
  normalizeToolInput
} from './types'
import type { ToolPart, TextPart, ReasoningPart, StepFinishPart } from '@opencode-ai/sdk/v2'
import { createOpenCodeEventHandler, EventProcessingStats, transformToolOutput } from './event-mapper'
import { formatQuestionsAsText, createQuestionActivity } from '../../utils/external-step-utils'

import type { ConversationRequest, ConversationResult } from '../types.js'

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

  /**
   * NEW: No longer creates child executions. Uses parent execution directly with
   * per-step Redis storage (workflow:{executionId}:{stepName}) and MessageAttachment.
   */
  async executeWithWorkflowTracking<T extends BaseWorkflowContext>(
    parentExecutionId: string,
    workflowId: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    conversationRequest: ConversationRequest,
    parentState: WorkflowState<T>,
    inputStepDbId: string,  // This is the existing INPUT step ID
    _continuationOverride?: AgenticContinuationOverride
  ): Promise<{ result: ConversationResult; updatedState: WorkflowState<T>; gitInfo: GitInfo }> {
    // Get the step info to retrieve the checkpointId (stepName)
    const inputStep = await this.storage.getStepById(inputStepDbId)
    const checkpointId = inputStep?.stepName || inputStepDbId

    // Handle continuation mode - reconstruct history and append user message
    // if (continuationOverride) {
    //   return await this.startContinuationExecution(
    //     parentExecutionId,
    //     workflowId,
    //     agentChkConfig,
    //     conversationRequest,
    //     parentState,
    //     inputStepDbId,
    //     checkpointId,
    //     continuationOverride
    //   )
    // }

    // Check if this checkpoint is already completed
    const isCompleted = await this.storage.isAgenticCheckpointCompleted(parentExecutionId, checkpointId)

    if (isCompleted) {
      const savedState = await this.storage.loadAgenticCheckpointState(parentExecutionId, checkpointId)
      if (savedState) {
        const updatedState = this.buildStateFromCompletedExecution(parentState, savedState.result as FrameworkExecutionResult)
        return { 
          result: savedState.result as ConversationResult, 
          updatedState, 
          gitInfo: savedState.gitInfo 
        }
      }
    }

    // Check if there are existing steps in Redis/GCS to resume from
    const existingSteps = await this.storage.getChildWorkflowSteps(parentExecutionId)
    if (existingSteps.length > 0) {
      return await this.resumeExistingExecution(
        parentExecutionId,
        inputStepDbId,
        checkpointId,
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
      inputStepDbId,
      checkpointId
    )
  }

  /**
   * NEW: Resume from existing state using parent execution and inputStepDbId
   * Loads steps from Redis first, then falls back to GCS for older executions
   */
  private async resumeExistingExecution<T extends BaseWorkflowContext>(
    parentExecutionId: string,
    inputStepDbId: string,
    checkpointId: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    conversationRequest: ConversationRequest,
    parentState: WorkflowState<T>
  ): Promise<{ result: ConversationResult; updatedState: WorkflowState<T>; gitInfo: GitInfo }> {

    // 1. Try to load steps from Redis first, then fall back to GCS
    let redisSteps: Array<{ stepName: string; data: string; createdAt: Date }> = []

    try {
      // Try Redis first (new per-step storage format)
      redisSteps = await this.storage.getAgenticStepsFromRedis(parentExecutionId, checkpointId)
      logger.info(`🔄 [OPENCODE-EXECUTOR] Loaded ${redisSteps.length} steps from Redis for ${checkpointId}`)
    } catch (redisError) {
      logger.warn(`⚠️ [OPENCODE-EXECUTOR] Failed to load from Redis, will try GCS:`, redisError)
    }

    let existingSteps: any[] = []

    if (redisSteps.length > 0) {
      // Use Redis steps - convert format for replay
      existingSteps = redisSteps.map(step => ({
        stepName: step.stepName,
        data: step.data,
        createdAt: step.createdAt
      }))
    } else {
      // Fall back to GCS via MessageAttachment (for old executions or after Redis TTL)
      logger.info(`🔄 [OPENCODE-EXECUTOR] No Redis steps found, trying GCS for ${checkpointId}`)
      const gcsSteps = await this.storage.getAgenticStepsFromGCS(parentExecutionId, inputStepDbId)
      existingSteps = gcsSteps.map(step => ({
        stepName: step.stepName,
        data: JSON.stringify(step.data),
        createdAt: step.createdAt
      }))
    }

    logger.info(`🔄 [OPENCODE-EXECUTOR] Resuming execution with ${existingSteps.length} steps from storage`)

    try {
      const { result, gitInfo } = await this.executeOpenCodeWithPauseCheck(
        parentExecutionId,
        inputStepDbId,
        checkpointId,
        agentChkConfig,
        conversationRequest,
        parentState,
        false,
        existingSteps
      )

      await this.storage.saveAgenticCheckpointState(
        parentExecutionId,
        checkpointId,
        { result, gitInfo }
      )

      const updatedState = this.buildStateFromCompletedExecution(parentState, result as FrameworkExecutionResult)
      return { result, updatedState, gitInfo }

    } catch (error) {
      await this.storage.createErrorStep(parentExecutionId, inputStepDbId, error as Error)
      throw error
    }
  }

  /**
   * NEW: Start fresh execution directly on parent, no child execution creation
   */
  private async startFreshExecution<T extends BaseWorkflowContext>(
    parentExecutionId: string,
    _workflowId: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    conversationRequest: ConversationRequest,
    parentState: WorkflowState<T>,
    inputStepDbId: string,
    checkpointId: string
  ): Promise<{ result: ConversationResult; updatedState: WorkflowState<T>; gitInfo: GitInfo }> {

    try {
      const { result, gitInfo } = await this.executeOpenCodeWithPauseCheck(
        parentExecutionId,
        inputStepDbId,
        checkpointId,
        agentChkConfig,
        conversationRequest,
        parentState
      )

      await this.storage.saveAgenticCheckpointState(
        parentExecutionId,
        checkpointId,
        { result, gitInfo }
      )

      const updatedState = this.buildStateFromCompletedExecution(parentState, result as FrameworkExecutionResult)
      return { result, updatedState, gitInfo }

    } catch (error) {
      await this.storage.createErrorStep(parentExecutionId, inputStepDbId, error as Error)
      throw error
    }
  }

  /**
   * NEW: Continuation execution using parent execution and inputStepDbId
   */
  // private async startContinuationExecution<T extends BaseWorkflowContext>(
  //   parentExecutionId: string,
  //   _workflowId: string,
  //   agentChkConfig: FullAgenticCheckpointConfig,
  //   originalConversationRequest: ConversationRequest,
  //   parentState: WorkflowState<T>,
  //   inputStepDbId: string,
  //   checkpointId: string,
  //   continuationOverride: AgenticContinuationOverride
  // ): Promise<{ result: ConversationResult; updatedState: WorkflowState<T>; gitInfo: GitInfo }> {

  //   const sourceGitInfo = await this.storage.getChildExecutionGitInfo(continuationOverride.sourceChildExecutionId)

  //   if (sourceGitInfo) {
  //     logger.info(`🔄 [OPENCODE-EXECUTOR] Source execution git info:`)
  //     logger.info(`   Branch: ${sourceGitInfo.branch}`)
  //     logger.info(`   Commit: ${sourceGitInfo.commitHash || 'N/A'}`)

  //     if (agentChkConfig.repoInfo) {
  //       agentChkConfig = {
  //         ...agentChkConfig,
  //         repoInfo: {
  //           ...agentChkConfig.repoInfo,
  //           repoBranch: sourceGitInfo.branch,
  //           continuationCommitHash: sourceGitInfo.commitHash,
  //           existingPrLink: sourceGitInfo.pr_link || sourceGitInfo.pullRequestUrl
  //         }
  //       }
  //     }
  //   }

  //   const sourceSteps = await this.storage.getChildWorkflowSteps(continuationOverride.sourceChildExecutionId)

  //   // Note: user_message step is already created by copyParentAgentStepsToExecution() in workflow-engine.ts
  //   // No need to create it again here to avoid duplicate user messages in the UI

  //   try {
  //     const { result, gitInfo } = await this.executeOpenCodeWithPauseCheck(
  //       parentExecutionId,
  //       inputStepDbId,
  //       checkpointId,
  //       agentChkConfig,
  //       originalConversationRequest,
  //       parentState,
  //       true,
  //       sourceSteps,
  //       continuationOverride.continuationUserMessage
  //     )

  //     await this.storage.saveAgenticCheckpointState(
  //       parentExecutionId,
  //       checkpointId,
  //       { result, gitInfo }
  //     )

  //     const updatedState = this.buildStateFromCompletedExecution(parentState, result as FrameworkExecutionResult)
  //     return { result, updatedState, gitInfo }

  //   } catch (error) {
  //     await this.storage.createErrorStep(parentExecutionId, inputStepDbId, error as Error)
  //     throw error
  //   }
  // }

  /**
   * NEW: Uses inputStepDbId instead of childExecutionId for step storage
   */
  private async executeOpenCodeWithPauseCheck<T extends BaseWorkflowContext>(
    parentExecutionId: string,
    inputStepDbId: string,
    _checkpointId: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    conversationRequest: ConversationRequest,
    parentState: WorkflowState<T>,
    isContinuation: boolean = false,
    stepsToReplay?: any[],
    promptOverride?: string
  ): Promise<{ result: ConversationResult; gitInfo: GitInfo }> {
    const repoUrl = agentChkConfig.repoInfo?.repoUrl
    const baseBranch = agentChkConfig.repoInfo?.baseBranch
    const repoBranch = agentChkConfig.repoInfo?.repoBranch
    const checkoutCommit = agentChkConfig.repoInfo?.checkoutCommit
    const continuationCommitHash = agentChkConfig.repoInfo?.continuationCommitHash
    const existingPrLink = agentChkConfig.repoInfo?.existingPrLink
    const shallow = agentChkConfig.repoInfo?.shallow ?? false
    let repoPath: string | undefined
    let branchName: string | undefined
    let projectName: string | undefined
    let repoName: string | undefined

    if (repoUrl) {
      // Use inputStepDbId for workspace events
      await workspaceEventService.publishCloningStarted(parentExecutionId, inputStepDbId)

      const cloneResult = await cloneRepository(
        repoUrl,
        parentExecutionId,
        baseBranch,
        repoBranch,
        isContinuation ? continuationCommitHash : undefined,
        checkoutCommit,
        shallow
      )

      logger.info(`🔧 [OPENCODE-EXECUTOR] Workspace at: ${cloneResult.repoPath}`)
      logger.info(`🔧 [OPENCODE-EXECUTOR] Parent execution ID: ${parentExecutionId}`)
      logger.info(`🔧 [OPENCODE-EXECUTOR] Input step ID: ${inputStepDbId}`)
      
      repoPath = cloneResult.repoPath
      branchName = cloneResult.branchName
      const extractedData = extractWorkspace(repoUrl)
      projectName = extractedData.projectName
      repoName = extractedData.repoName

      await workspaceEventService.publishWorkspaceReady(parentExecutionId, inputStepDbId, repoUrl, branchName, baseBranch)
      
      if (agentChkConfig.repoInfo?.postCloneSetup) {
        await agentChkConfig.repoInfo.postCloneSetup(repoPath, repoName || 'unknown')
      }
    }

    if (repoUrl && !repoPath) {
      throw new Error(`[DIRECTORY-ISOLATION] Clone failed: repoUrl was provided but repoPath is not set. Refusing to fall back to local directory.`)
    }

    if (repoPath) {
      repoPath = await realpath(repoPath)
    }
    const workingDir = repoPath || process.cwd()

    // Directory isolation safety checks
    if (workingDir.includes('..')) {
      throw new Error(`[DIRECTORY-ISOLATION] Path traversal detected: ${workingDir}`)
    }

    if (repoUrl) {
      const tmpPaths = ['/tmp/', '/private/tmp/', '/var/folders/', process.env.TMPDIR || '/tmp/']
      const isIsolated = tmpPaths.some(p => workingDir.startsWith(p))
      if (!isIsolated) {
        throw new Error(`[DIRECTORY-ISOLATION] repoUrl provided but workingDir is not in isolated temp directory. Expected /tmp/{executionId} but got: ${workingDir}`)
      }
    }
    
    const client = this.createScopedClient(workingDir)
    
    const commitTracker: OpenCodeCommitTracker = {
      hasCommits: false,
      branchName: branchName || '',
      repoUrl,
      inputStepDbId,
      parentExecutionId,
      latestCommitHash: undefined,
      commitCount: 0
    }

    let abortController = new AbortController()
    let savedExternalWaitException: WorkflowExternalWaitException | undefined

    const codeQualityInstructions = `
## CODE QUALITY INSTRUCTIONS

### RULE 1: EDIT RETRY ON FAILURE
If an edit fails with "file has been modified" or "must read file first":
- Re-read the file using the read tool
- Retry the edit with fresh content
- Do not give up

### RULE 2: COMPLETION CRITERIA
You are ONLY done when:
- All planned implementation steps are complete
- All todos are verified complete
`

    // Questioning mode determines whether the agent can ask clarifying questions
    const useQuestioningMode = agentChkConfig.useQuestioningMode ?? false
    const questionEnabled = useQuestioningMode
    logger.info(`[OPENCODE-EXECUTOR] useQuestioningMode=${useQuestioningMode}, questionEnabled=${questionEnabled}`)

    const questionRule = questionEnabled
      ? `
### RULE 3: CLARIFYING QUESTIONS (MANDATORY)
You have access to a \`question\` tool that lets you ask the user clarifying questions.

**YOU MUST USE THE \`question\` TOOL** before finalizing your plan. After exploring the codebase and understanding the requirements, ask the user about:
- Ambiguous requirements, design choices, or implementation preferences
- Scope clarifications — what to include vs exclude
- Edge cases or trade-offs that affect the plan
- UI/UX preferences, component layout, or interaction details
- Any assumptions you are making that could be wrong

Workflow:
1. First explore the codebase to understand context
2. Then call the \`question\` tool with your questions (batch them into a single call)
3. Wait for answers before producing your final plan
4. Use the built-in \`question\` tool ONLY — do NOT ask questions in plain text or markdown
5. After receiving answers, incorporate them and finalize your plan
`
      : `
### RULE 3: NO QUESTIONS
Do NOT ask the user any questions. Proceed directly with the task.
- Do NOT use the \`question\` tool.
- Do NOT ask questions in plain text or markdown.
- Make your best judgment call for any ambiguity and proceed.
`

    const additionalInstructions = codeQualityInstructions + questionRule

    const systemPrompt = conversationRequest.systemPrompt
      ? conversationRequest.systemPrompt + `\n\nIMPORTANT: You MUST work in the following directory. All file operations should be relative to or within this path:\n${workingDir}\n${additionalInstructions}`
      : `IMPORTANT: You MUST work in the following directory. All file operations should be relative to or within this path:\n${workingDir}\n${additionalInstructions}`

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
      title: `workflow-${parentExecutionId}-${inputStepDbId}`
    })

    logger.info(`[OPENCODE-EXECUTOR] Created session ${session.id} for ${workingDir}`)

    if (session.directory && session.directory !== workingDir) {
      logger.error(`[DIRECTORY-MISMATCH] Session directory ${session.directory} != expected ${workingDir}`)
    }

    // Replay prior conversation history into the new session using noReply
    if (stepsToReplay && stepsToReplay.length > 0) {
      await this.replayStepsIntoSession(client, session.id, stepsToReplay)
    }

    // Set by the handleQuestion callback when a question is asked — signals the main loop to throw
    let pendingExternalWait: { stepName: string } | undefined
    // Allows the handleQuestion callback to force-resolve the current promptWithStreaming call
    const forceResolveRef: { resolve?: () => void } = {}

    const sseProcessedToolCalls = new Set<string>()
    const sseProcessedToolResults = new Set<string>()
    const { handleEvent, getStats } = createOpenCodeEventHandler({
      inputStepDbId,
      parentExecutionId,
      commitTracker,
      repoPath: workingDir,
      agentChkConfig,
      storage: this.storage,
      abortController,
      processedToolCalls: sseProcessedToolCalls,
      processedToolResults: sseProcessedToolResults,
      checkPauseOrCancel: () => this.checkWorkflowPauseOrCancelStatusAndThrow(inputStepDbId, abortController),
      grantPermission: async (sessionId: string, permissionId: string) => {
        await client.grantPermission(sessionId, permissionId)
      },
      handleQuestion: async (requestId: string, _sessionId: string, questions: QuestionAskedEvent['properties']['questions']) => {
        // Only allow questions when useQuestioningMode is enabled
        if (!questionEnabled) {
          logger.warn(`[OPENCODE-EXECUTOR] Rejecting question ${requestId} — useQuestioningMode is off, questions are disabled`)
          try {
            await client.rejectQuestion(requestId)
          } catch (rejectErr) {
            logger.error(`[OPENCODE-EXECUTOR] Failed to reject question (planning disabled):`, rejectErr)
          }
          return
        }

        // Format questions as readable text and save as assistant message
        const questionText = formatQuestionsAsText(questions)

        // Save the question as an LLM call step so it appears as an assistant message in the UI
        await this.storage.createLLMCallStep(parentExecutionId, inputStepDbId, {
          content: questionText,
        })

        
        // Set MANUAL mode so the continueAgenticStep endpoint routes the user's reply
        // into the Redis message-storage branch (WAIT_FOR_EVENT + MANUAL).
        // The endpoint will reset mode to AUTOMATIC before re-queuing so the agent
        // completes without pausing again after processing the answer.
        await this.storage.setExecutionMode(parentExecutionId, 'MANUAL')

        // Create activity record to notify user about the question
        await createQuestionActivity(parentExecutionId)

        logger.info(`[OPENCODE-EXECUTOR] ❓ Question formatted as assistant message — completing turn in MANUAL mode: ${requestId}`)

        if (forceResolveRef.resolve) {
          forceResolveRef.resolve()
        }

        // Reject the question on OpenCode so the session goes idle naturally
        try {
          await client.rejectQuestion(requestId)
        } catch (rejectErr) {
          logger.error(`[OPENCODE-EXECUTOR] Failed to reject question after question handling:`, rejectErr)
        }
      }
    })

    let unsubscribe = client.subscribeToSessionEvents(session.id, handleEvent)

    // Setup continuation listener via Redis pub/sub
    let continuationMessage: string | null = null;
    let cleanupContinuationListener = await this.setupContinuationListener(
      parentExecutionId,
      _checkpointId,
      abortController,
      (event) => {
        continuationMessage = event.message;
        logger.info(`[OPENCODE-EXECUTOR] Continuation message received: "${event.message?.substring(0, 100)}..."`);
      }
    );

    let result!: ConversationResult
    let promptResponse: SDKPromptResponse | undefined

    try {
      const userMessage = promptOverride || this.extractUserMessage(conversationRequest)
      const MAX_CONTINUATION_ATTEMPTS = questionEnabled ? 8 : 5
      let continuationAttempt = 0
      let isComplete = false

      while (!isComplete && continuationAttempt < MAX_CONTINUATION_ATTEMPTS) {
        // Check if this is a continuation restart (new abort controller after Redis continuation event)
        if (continuationAttempt === 0 && abortController.signal.aborted && continuationMessage) {
          logger.info(`[OPENCODE-EXECUTOR] Detected continuation restart - will process with new session`);
        }

        const isFirstAttempt = continuationAttempt === 0
        let messageToSend: string
        if (isFirstAttempt) {
          if (questionEnabled) {
            messageToSend = [
              `--- TASK ---`,
              userMessage,
              `--- END TASK ---`,
              ``,
              `⚠️ IMPORTANT: You have a \`question\` tool available. You MUST use it whenever you encounter ambiguity during your analysis — unclear requirements, multiple valid implementation approaches, scope questions, design trade-offs, or edge cases.`,
              ``,
              `You can ask questions at ANY point during your work — not just at the beginning. Whenever you realize something is unclear or could go multiple ways, stop and use the \`question\` tool before proceeding further.`,
              ``,
              `Batch related questions into a single \`question\` tool call. Use the built-in \`question\` tool ONLY — do NOT ask questions in plain text or markdown.`,
            ].join('\n')
          } else {
            messageToSend = userMessage
          }
        } else {
          messageToSend = await this.buildContinuationPrompt(getStats(), client, session.id)
        }
        
        // Send system prompt on first attempt
        const systemPromptToUse = isFirstAttempt ? systemPrompt : undefined

        logger.info(`[OPENCODE-EXECUTOR] Sending prompt (attempt=${continuationAttempt}, isFirst=${isFirstAttempt}, systemPrompt=${!!systemPromptToUse})`)
        logger.debug(`[OPENCODE-EXECUTOR] System prompt (first 500 chars): ${systemPromptToUse?.substring(0, 500) ?? 'none'}`)
        logger.debug(`[OPENCODE-EXECUTOR] User message (first 500 chars): ${messageToSend.substring(0, 500)}`)
        
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
              600000, // 10 minute timeout
              undefined, // onEvent
              forceResolveRef // allows handleQuestion to force-resolve this prompt
            )
            break
          } catch (err) {
            lastError = err
            
            if (promptRetry < MAX_PROMPT_RETRIES - 1) {
              promptRetry++
              const backoffMs = Math.min(5000 * Math.pow(2, promptRetry - 1), 30000)
              logger.warn(`[OPENCODE-EXECUTOR] Prompt failed (attempt ${promptRetry}/${MAX_PROMPT_RETRIES}), retrying in ${backoffMs}ms: ${err instanceof Error ? err.message : String(err)}`)
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
              logger.error(`[OPENCODE-EXECUTOR] Prompt failed after ${MAX_PROMPT_RETRIES} attempts: ${err instanceof Error ? err.message : String(err)}`)
              throw err
            }
          }
        }
        
        if (!promptResponse) {
          throw lastError || new Error('No response received after retries')
        }

        // Check if a question was asked during the prompt — if so, halt execution
        // The handleQuestion callback sets pendingExternalWait and force-resolves the prompt
        if (pendingExternalWait) {
          logger.info(`[OPENCODE-EXECUTOR] ❓ Question asked during prompt — halting for external input: ${pendingExternalWait.stepName}`)
          throw new WorkflowExternalWaitException(parentExecutionId, pendingExternalWait.stepName)
        }

        await this.processPromptResponse(
          promptResponse,
          inputStepDbId,
          parentExecutionId,
          commitTracker,
          workingDir,
          agentChkConfig,
          abortController,
          sseProcessedToolCalls
        )

        const finishReason = promptResponse.info?.finish
        const todoCheck = await client.hasIncompleteTodos(session.id)
        const hasIncompleteTodos = todoCheck.hasIncomplete

        // Detect completion or need for continuation
        if (finishReason === 'stop' && !hasIncompleteTodos) {
          logger.info(`✅ [OPENCODE-EXECUTOR] LLM finished with stop, no incomplete todos - task complete`)
          isComplete = true
        } else if (finishReason === 'stop' && hasIncompleteTodos) {
          logger.warn(`[OPENCODE-EXECUTOR] LLM stopped but has ${todoCheck.todos.length} incomplete todos - will re-prompt`)
          continuationAttempt++
        } else {
          isComplete = true
        }

        // Check if this was a continuation abort (continuation message received via Redis)
        if (continuationMessage && abortController.signal.aborted) {
          logger.info(`[OPENCODE-EXECUTOR] Execution aborted for continuation with message`);

          // Store current cleanup listener for cleanup
          const oldCleanupListener = cleanupContinuationListener;

          // Set execution mode to MANUAL when continuation is received
          await this.storage.setExecutionMode(parentExecutionId, 'MANUAL');
          logger.info(`🎛️ [OPENCODE-EXECUTOR] Execution mode set to MANUAL for ${parentExecutionId}`);

          // Fetch full conversation history from Redis/GCS
          const newConversationRequest = await this.buildContinuationConversationRequest(
            parentExecutionId,
            _checkpointId,
            inputStepDbId,
            conversationRequest,
            continuationMessage
          );

          // Create new abort controller for the next execution
          const newAbortController = new AbortController();

          // Re-setup continuation listener for the next potential abort
          await oldCleanupListener();
          const newCleanupContinuationListener = await this.setupContinuationListener(
            parentExecutionId,
            _checkpointId,
            newAbortController,
            (event) => {
              continuationMessage = event.message;
              logger.info(`[OPENCODE-EXECUTOR] Continuation message received: "${event.message?.substring(0, 100)}..."`);
            }
          );

          // Reset session and unsubscribe from old session
          unsubscribe();

          // Create new session for continuation
          session = await client.createSession({
            directory: workingDir,
            title: `workflow-continue-${parentExecutionId}-${inputStepDbId}`
          });

          logger.info(`[OPENCODE-EXECUTOR] Created new session ${session.id} for continuation`);

          // Subscribe to new session events
          unsubscribe = client.subscribeToSessionEvents(session.id, handleEvent);

          // Replay steps from history into new session
          if (newConversationRequest.messages && newConversationRequest.messages.length > 0) {
            // Convert messages to steps format for replay
            const stepsToReplayFromHistory: Array<{stepName: string; data: string; createdAt: Date}> = [];
            for (let idx = 0; idx < newConversationRequest.messages.length; idx++) {
              const msg = newConversationRequest.messages[idx];
              if ('content' in msg && msg.content) {
                const stepName: string = idx === 0 && 'role' in msg && msg.role === 'user'
                  ? 'user_message'
                  : ('role' in msg && msg.role === 'user' ? 'user_continue' : 'assistant_message');
                stepsToReplayFromHistory.push({
                  stepName,
                  data: JSON.stringify({ content: msg.content }),
                  createdAt: new Date(Date.now() + idx)
                });
              }
            }
            await this.replayStepsIntoSession(client, session.id, stepsToReplayFromHistory);
          }

          // Update variables for next iteration
          conversationRequest = newConversationRequest;
          abortController = newAbortController;
          cleanupContinuationListener = newCleanupContinuationListener;
          continuationMessage = null;

          // Reset completion flag to continue the loop
          isComplete = false;
          continuationAttempt = 0;
          continue;
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
      // WorkflowExternalWaitException (e.g., question asked) must NOT be swallowed.
      // We skip push/PR/workspace-close — the workflow is just pausing, not completing.
      // Only session cleanup runs (in finally), then we re-throw immediately.
      if (openCodeError instanceof WorkflowExternalWaitException) {
        logger.info(`[OPENCODE-EXECUTOR] WorkflowExternalWaitException detected — pausing workflow for external input (no push/PR)`)
        savedExternalWaitException = openCodeError
        // Fall through to finally (session cleanup) → then re-throw before push/PR
      } else {

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
            const incompleteTodoList = todoCheck.todos.map(t => `- [${t.status}] ${t.content}`).join('\n')
            const resumePrompt = `The previous execution was interrupted by a network timeout. Please continue the work.

INCOMPLETE TODOS:
${incompleteTodoList}

PROGRESS SO FAR:
- Commits made: ${commitTracker.commitCount}

Please complete the remaining todos. Focus on the incomplete tasks.`

            const MAX_RESUME_RETRIES = 5
            let resumeRetry = 0
            while (resumeRetry < MAX_RESUME_RETRIES) {
              try {
                const resumeSession = await client.createSession({
                  directory: workingDir,
                  title: `resume-${parentExecutionId}-${inputStepDbId}`
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
                  inputStepDbId,
                  parentExecutionId,
                  commitTracker,
                  workingDir,
                  agentChkConfig,
                  abortController,
                  sseProcessedToolCalls
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
        await this.storage.createErrorStep(parentExecutionId, inputStepDbId, openCodeError as Error)
        throw openCodeError
      }

      } // end of non-WorkflowExternalWaitException else block
    } finally {
      unsubscribe()

      // Clean up Redis continuation subscription to prevent leaks
      try {
        await cleanupContinuationListener()
      } catch (cleanupErr) {
        logger.warn(`[OPENCODE-EXECUTOR] Failed to cleanup continuation listener:`, cleanupErr)
      }

      try {
        await client.deleteSession(session.id)
        logger.info(`🧹 [OPENCODE-EXECUTOR] Cleaned up session ${session.id}`)
      } catch (cleanupError) {
        logger.warn(`[OPENCODE-EXECUTOR] Failed to cleanup session:`, cleanupError)
      }
    }

    // If we're pausing for a question, re-throw BEFORE any push/PR/workspace-close logic.
    // The workflow is just halting temporarily — no commits, PRs, or workspace close needed.
    if (savedExternalWaitException) {
      logger.info(`[OPENCODE-EXECUTOR] Re-throwing WorkflowExternalWaitException after session cleanup (skipped push/PR): ${savedExternalWaitException.message}`)
      throw savedExternalWaitException
    }

    if (repoPath) {
      const hasUncommittedWork = await hasUncommittedChanges(repoPath)
      
      if (hasUncommittedWork) {
        const finalCommitMessage = agentChkConfig.repoInfo?.getCommitMessage
          ? agentChkConfig.repoInfo.getCommitMessage('Final auto-commit of remaining changes')
          : 'Final auto-commit of remaining changes'
        
        const coAuthor = agentChkConfig.repoInfo?.coAuthor
        const finalCommitHash = await commitAllChanges(repoPath, finalCommitMessage, coAuthor?.name, coAuthor?.email)
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
          inputStepDbId,
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
          await this.bitbucketManager.raisePr(repoUrl, inputStepDbId, prTargetBranch, branchName, projectName, repoName, ticketTitle, ticketDescription, xyneId, ticketId)
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
      await workspaceEventService.publishWorkspaceClosed(parentExecutionId, inputStepDbId)
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

  /**
   * NEW: Uses inputStepDbId instead of childExecutionId
   */
  private async processPromptResponse(
    response: SDKPromptResponse,
    inputStepDbId: string,
    parentExecutionId: string,
    _commitTracker: OpenCodeCommitTracker,
    _repoPath: string,
    _agentChkConfig: FullAgenticCheckpointConfig,
    abortController: AbortController,
    alreadyProcessedToolCalls?: Set<string>
  ): Promise<{ textContent: string }> {
    if (!response?.parts || !Array.isArray(response.parts)) {
      return { textContent: '' }
    }

    const partTypeCounts: Record<string, number> = {}
    for (const part of response.parts) {
      partTypeCounts[part.type] = (partTypeCounts[part.type] || 0) + 1
    }
    logger.info(`[OPENCODE-EXECUTOR] processPromptResponse: ${response.parts.length} parts, types: ${JSON.stringify(partTypeCounts)}`)

    const processedToolCalls = alreadyProcessedToolCalls || new Set<string>()
    const toolCallsInResponse: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = []
    let textContent = ''
    let reasoningContent = ''
    let stepNumber = 0

    for (const part of response.parts) {
      await this.checkWorkflowPauseOrCancelStatusAndThrow(inputStepDbId, abortController)

      switch (part.type) {
        case 'tool': {
          const toolPart = part as ToolPart
          toolCallsInResponse.push({
            id: toolPart.callID,
            name: toolPart.tool,
            arguments: toolPart.state.input
          })
          
          if (toolPart.state.status === 'completed' || toolPart.state.status === 'error') {
            await this.processCompletedToolPart(toolPart, inputStepDbId, parentExecutionId, processedToolCalls)
          }
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
          await this.storage.createAssistantMessageStep(parentExecutionId, inputStepDbId, {
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
      await this.storage.createLLMCallStep(parentExecutionId, inputStepDbId, {
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
        parentExecutionId,
        inputStepDbId, 
        new Error(`OpenCode error: ${errorMessage}`)
      )
      logger.error(`[OPENCODE-EXECUTOR] Error in response: ${errorMessage}`)
    }

    return { textContent }
  }

  /**
   * Process a completed/error tool part: ensure step exists, parse output,
   * normalize input keys, and update storage with final data.
   */
  private async processCompletedToolPart(
    toolPart: ToolPart,
    inputStepDbId: string,
    parentExecutionId: string,
    processedToolCalls: Set<string>
  ): Promise<void> {
    const toolName = toolPart.tool
    const state = toolPart.state
    const toolCallStatus = state.status === 'error' ? 'failed' : 'completed'

    // Ensure step exists (SSE should have created it, but create if not)
    if (!processedToolCalls.has(toolPart.callID)) {
      processedToolCalls.add(toolPart.callID)
      await this.storage.createToolExecutionStep(parentExecutionId, inputStepDbId, {
        id: toolPart.callID,
        name: toolName,
        input: normalizeToolInput(state.input),
        output: null,
        duration: 0,
        success: state.status === 'completed'
      })
    }

    // Get raw output string (state.output exists on completed, state.error on error)
    const rawOutputStr = state.status === 'completed'
      ? (state as { output: string }).output
      : ''
    const rawErrorStr = state.status === 'error'
      ? (state as { error: string }).error
      : ''

    logger.info(`[OPENCODE-EXECUTOR] Tool ${toolName} (${toolPart.callID}) — input keys: ${JSON.stringify(Object.keys(state.input))}, output length: ${rawOutputStr?.length || 0}, status: ${state.status}`)
    logger.debug(`[OPENCODE-EXECUTOR] Tool ${toolName} raw output: ${(rawOutputStr || rawErrorStr || '').substring(0, 500)}`)

    // Parse output: try JSON first, fallback to {content: str}
    let parsedOutput: unknown
    if (state.status === 'completed') {
      try {
        parsedOutput = JSON.parse(rawOutputStr)
      } catch {
        parsedOutput = { content: rawOutputStr }
      }
    } else {
      parsedOutput = { error: rawErrorStr }
    }
    const finalOutput = transformToolOutput(toolName, parsedOutput)

    const normalizedInput = state.input && Object.keys(state.input).length > 0
      ? normalizeToolInput(state.input)
      : undefined

    await this.storage.updateToolExecutionStep(
      inputStepDbId,
      toolPart.callID,
      finalOutput,
      toolCallStatus,
      normalizedInput
    )
  }

  private buildConversationResultFromResponse(
    response: SDKPromptResponse,
    session: SessionInfo,
    _stats: ReturnType<ReturnType<typeof createOpenCodeEventHandler>['getStats']>
  ): ConversationResult {
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

    const hasError = response.info?.error || session.status === 'error'
    const finishReason = response.info?.finish

    return {
      messages,
      error: hasError ? `Session completed with error` : undefined,
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
    _stats: EventProcessingStats,
    client: OpenCodeClient,
    sessionId: string
  ): Promise<string> {
    const parts: string[] = []
    
    parts.push('🔴 IMPORTANT: You stopped but the task is NOT complete!')
    parts.push('')
    
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
    parts.push('2. Only stop when ALL todos are complete')
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
    inputStepDbId: string,
    abortController: AbortController
  ): Promise<void> {
    const pauseStatus = await this.storage.checkWorkflowPauseOrCancelStatus(inputStepDbId)

    if (pauseStatus.isCancelled) {
      abortController.abort()
      throw new WorkflowCancelledException(
        pauseStatus.parentExecutionId || inputStepDbId,
        'opencode_step_cancelled'
      )
    }

    if (pauseStatus.isPaused) {
      throw new WorkflowPausedException(
        pauseStatus.parentExecutionId || inputStepDbId,
        'opencode_step_paused'
      )
    }
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

  private async replayStepsIntoSession(
    client: OpenCodeClient,
    sessionId: string,
    steps: any[]
  ): Promise<void> {
    const sortedSteps = [...steps].sort((a: any, b: any) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )

    let replayedCount = 0

    for (const step of sortedSteps) {
      if (!step.data) continue

      try {
        const stepData = typeof step.data === 'string' ? JSON.parse(step.data) : step.data
        const stepName = step.stepName || ''

        let textToInject: string | undefined

        if (stepName === 'user_message') {
          textToInject = stepData.content || ''

        } else if (stepName.startsWith('tool_')) {
          // Summarize tool execution as context
          const toolName = stepName.replace('tool_', '')
          const inputSummary = stepData.input ? JSON.stringify(stepData.input).substring(0, 500) : ''
          const outputSummary = stepData.output != null ? JSON.stringify(stepData.output).substring(0, 1000) : 'null'
          const success = stepData.success !== false ? 'succeeded' : 'failed'
          textToInject = `[Prior tool execution] Tool: ${toolName}, Status: ${success}\nInput: ${inputSummary}\nOutput: ${outputSummary}`

        } else if (stepName.startsWith('llm_call_') || stepName === 'assistant_message') {
          const content = stepData.response || stepData.content || stepData.turn?.result?.content
          if (content) {
            textToInject = `[Prior assistant response]\n${content}`
          }
        }
        if (textToInject) {
          await client.injectContextMessage(sessionId, textToInject)
          replayedCount++
        }
      } catch (error) {
        logger.warn(`[OPENCODE-EXECUTOR] Failed to replay step ${step.stepName} into session:`, error)
      }
    }

    logger.info(`[OPENCODE-EXECUTOR] Replayed ${replayedCount}/${sortedSteps.length} steps into session ${sessionId}`)
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

      const filesMatch = stdout.match(/(\d+)\s+files?\s+changed/)
      const insertionsMatch = stdout.match(/(\d+)\s+insertions?\(\+\)/)
      const deletionsMatch = stdout.match(/(\d+)\s+deletions?\(-\)/)

      if (filesMatch) {
        return {
          files: parseInt(filesMatch[1], 10),
          additions: insertionsMatch ? parseInt(insertionsMatch[1], 10) : 0,
          deletions: deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0
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

  /**
   * Setup Redis pub/sub listener for agent continuation events
   */
  private async setupContinuationListener(
    parentExecutionId: string,
    checkpointId: string,
    abortController: AbortController,
    onContinuationEvent: (event: { message: string; type: string; executionId: string; stepName: string; timestamp: string }) => void
  ): Promise<() => Promise<void>> {
    const { redisService } = await import('@/services/redisService')
    const channel = `workflow:${parentExecutionId}:${checkpointId}:continue`;
    logger.info(`[OPENCODE-EXECUTOR] Setting up continuation listener for channel: ${channel}`);

    const continuationCallback = (event: { message: string; type: string; executionId: string; stepName: string; timestamp: string }) => {
      logger.info(`[OPENCODE-EXECUTOR] Received continuation message via Redis pub/sub on channel: ${channel}`);
      onContinuationEvent(event);
      abortController.abort();
    };

    // Subscribe to continuation channel and wait for it to complete
    try {
      await redisService.subscribeToAgentContinuation(
        parentExecutionId,
        checkpointId,
        continuationCallback
      );
      logger.info(`[OPENCODE-EXECUTOR] Successfully subscribed to channel: ${channel}`);
    } catch (error) {
      logger.error(`[OPENCODE-EXECUTOR] Failed to subscribe to continuation channel:`, error);
      throw error;
    }

    // Return cleanup function
    return async () => {
      logger.info(`[OPENCODE-EXECUTOR] Cleaning up continuation listener for channel: ${channel}`);
      try {
        await redisService.unsubscribeFromAgentContinuation(
          parentExecutionId,
          checkpointId,
          continuationCallback
        );
        logger.info(`[OPENCODE-EXECUTOR] Successfully unsubscribed from channel: ${channel}`);
      } catch (error) {
        logger.error(`[OPENCODE-EXECUTOR] Failed to unsubscribe from continuation channel:`, error);
      }
    };
  }

  /**
   * Build a conversation request for continuation by fetching full history from Redis/GCS
   */
  private async buildContinuationConversationRequest(
    parentExecutionId: string,
    checkpointId: string,
    inputStepDbId: string,
    originalRequest: ConversationRequest,
    continuationMessage: string
  ): Promise<ConversationRequest> {
    logger.info(`🔄 [OPENCODE-EXECUTOR] Building continuation conversation request`);

    // 1. Fetch all steps from Redis first
    let redisSteps: Array<{ stepName: string; data: string; createdAt: Date }> = [];

    try {
      redisSteps = await this.storage.getAgenticStepsFromRedis(parentExecutionId, checkpointId);
      logger.info(`🔄 [OPENCODE-EXECUTOR] Loaded ${redisSteps.length} steps from Redis for continuation`);
    } catch (redisError) {
      logger.warn(`⚠️ [OPENCODE-EXECUTOR] Failed to load from Redis for continuation:`, redisError);
    }

    let steps: Array<{ stepName: string; data: string; createdAt: Date }> = [] ;

    if (redisSteps.length > 0) {
      steps = redisSteps;
    } else {
      // Fall back to GCS
      try {
        const gcsSteps = await this.storage.getAgenticStepsFromGCS(parentExecutionId, inputStepDbId);
         steps = gcsSteps
          .filter((step): step is typeof step & { stepName: string } => !!step.stepName).map(step => ({
          stepName: step.stepName,
          data: JSON.stringify(step.data),
          createdAt: step.createdAt
        }));
        logger.info(`🔄 [OPENCODE-EXECUTOR] Loaded ${steps.length} steps from GCS for continuation`);
      } catch (gcsError) {
        logger.error(`❌ [OPENCODE-EXECUTOR] Failed to load steps from GCS:`, gcsError);
      }
    }

    // 2. Sort steps by creation time
    const sortedSteps = steps.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // 3. Build conversation history from steps
    // Build as simple objects first, then cast to Message[] for the ConversationRequest
    const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const step of sortedSteps) {
      if (!step.data) continue;

      try {
        const stepData = JSON.parse(step.data);

        if (step.stepName === 'user_message') {
          conversationHistory.push({
            role: 'user',
            content: stepData.content || ''
          });
        } else if (step.stepName.startsWith('llm_call_') || step.stepName === 'assistant_message') {
          const content = stepData.response || stepData.content || stepData.turn?.result?.content || '';
          if (content) {
            conversationHistory.push({
              role: 'assistant',
              content
            });
          }
        } else if (step.stepName.startsWith('tool_')) {
          // Include tool results as assistant context
          const toolName = step.stepName.replace('tool_', '');
          const outputSummary = stepData.output != null ? JSON.stringify(stepData.output).substring(0, 1000) : 'null';
          conversationHistory.push({
            role: 'assistant',
            content: `[Tool result: ${toolName}] ${outputSummary}`
          });
        }
      } catch (error) {
        logger.warn(`[OPENCODE-EXECUTOR] Failed to parse step ${step.stepName} for continuation:`, error);
      }
    }

    // 4. Add the continuation message as the final user message
    conversationHistory.push({
      role: 'user',
      content: continuationMessage
    });

    // 5. Create user message step in storage so it shows in UI
    await this.storage.createUserMessageStep(parentExecutionId, inputStepDbId, continuationMessage);
    logger.info(`✅ [OPENCODE-EXECUTOR] Created user message step for continuation: "${continuationMessage.substring(0, 100)}..."`);

    logger.info(`🔄 [OPENCODE-EXECUTOR] Built conversation request with ${conversationHistory.length} messages for continuation`);

    return {
      ...originalRequest,
      messages: conversationHistory as any
    };
  }
}
