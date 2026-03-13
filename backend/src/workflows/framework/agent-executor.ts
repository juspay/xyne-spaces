/**
 * Framework Agent Executor with Pause/Resume Support
 *
 * Implements the brilliant architecture:
 * 1. Check if child workflow is completed → return last step output
 * 2. If not, reconstruct conversation from existing steps
 * 3. Continue execution with pause checking on every event
 *
 * Uses proper storage layer abstraction instead of direct database access
 */

import { WorkflowStorage, FrameworkExecutionResult } from '../workflow-storage'
import { FullAgenticCheckpointConfig, WorkflowState, BaseWorkflowContext, GitInfo, GitDiffFile, GitDiffStats, AgenticContinuationOverride } from '../workflow-types'
import { WorkflowPausedException, WorkflowCancelledException, WorkflowExternalWaitException } from '../exceptions/workflow-exceptions'
import { BitbucketManager } from '@/bitbucket/apis'
import { TicketRepository, WorkflowRepository } from '@/database/repositories/workflows'
import { AgentStepRepository } from '@/database/repositories/agentSteps'
import { PRMetricsRepository } from '@/database/repositories/pullRequestsRepository'
import { exec } from 'child_process'
import { promisify } from 'util'
import {logger} from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { buildWorkflowStepKey } from '@/workflows/utils/workflowStepKeys';

const execAsync = promisify(exec)

export function extractWorkspace(url: string): { projectName: string; repoName: string } {
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


// Import framework types from our type bridge
import type {
  ConversationRequest,
  ConversationResult,
  Message
} from './types.js'
import { Agent, createAssistantMessage, createToolResultMessage, createUserMessage } from '@framework'
import { cloneRepository, pushCommits, hasUncommittedChanges, commitAllChanges } from '@framework'
import type { OrchestratorEventHandler } from '@framework'
import { UpdateAgentStepInput } from '@/types/database'
import { workspaceEventService } from '@/services/workspaceEventService'

interface AgentTracker {
  hasCommits: boolean
  branchName: string
  repoUrl?: string
  inputStepDbId: string
  parentExecutionId: string  // Added for workspace events
  latestCommitHash?: string
  commitCount: number
}

export class AgentExecutor {
  constructor(private storage: WorkflowStorage, private bitbucketManager = new BitbucketManager(), private workflowRepo = new WorkflowRepository(), private ticketRepo = new TicketRepository()) {}

  /**
   * Execute framework agent with pause/resume support
   * Core Logic: Check completion → Reconstruct state → Continue with pause checking
   * 
   * Supports continuation mode: When continuationOverride is provided,
   * reconstructs conversation from source and appends user message.
   * 
   * NEW: No longer creates child executions. Uses parent execution directly with
   * per-step Redis storage (workflow:{executionId}:{stepName}) and MessageAttachment.
   */
  async executeWithWorkflowTracking<T extends BaseWorkflowContext>(
    parentExecutionId: string,
    workflowId: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    conversationRequest: ConversationRequest,
    parentState: WorkflowState<T>,
    inputStepDbId: string,  // This is the existing INPUT step ID (checkpointId is the stepName)
    _continuationOverride?: AgenticContinuationOverride
  ): Promise<{ result: ConversationResult; updatedState: WorkflowState<T>; gitInfo: GitInfo }> {
    // Get the step info to retrieve the checkpointId (stepName)
    const inputStep = await this.storage.getStepById(inputStepDbId)
    const checkpointId = inputStep?.stepName || inputStepDbId

    // Handle continuation mode - reconstruct history and append user message
    // if (continuationOverride) {
    //   logger.info(`🔄 [AGENT-EXECUTOR] Continuation mode activated`)
    //   logger.info(`   Source: ${continuationOverride.sourceChildExecutionId}`)
      
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

    // 1. Check if this checkpoint is already completed
    const isCompleted = await this.storage.isAgenticCheckpointCompleted(parentExecutionId, checkpointId)

    if (isCompleted) {
      // Checkpoint completed - load the saved result
      const savedState = await this.storage.loadAgenticCheckpointState(parentExecutionId, checkpointId)
      if (savedState) {
        const updatedState = this.buildStateFromCompletedExecution(parentState, savedState.result as FrameworkExecutionResult)
        return { 
          result: savedState.result, 
          updatedState, 
          gitInfo: savedState.gitInfo 
        }
      }
    }

    // 2. Check if there are existing steps in Redis/GCS to resume from
    const existingSteps = await this.storage.getChildWorkflowSteps(parentExecutionId)
    if (existingSteps.length > 0) {
      // Resume from existing state (loaded from GCS via MessageAttachment)
      return await this.resumeExistingExecution(
        parentExecutionId,
        inputStepDbId,
        checkpointId,
        agentChkConfig,
        conversationRequest,
        parentState
      )
    }

    // 3. Start fresh execution directly on parent
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

  private serializeError(err: Error): string {
    return JSON.stringify({
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
  }

  /**
   * Resume execution from existing state (loaded from Redis or GCS via MessageAttachment)
   * NEW: Uses parent execution directly with inputStepDbId
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
      // remove frame_work error from here
      logger.info(`🔄 [AGENT-EXECUTOR] Loaded ${redisSteps.length} steps from Redis for ${checkpointId}`)
    } catch (redisError) {
      logger.warn(`⚠️ [AGENT-EXECUTOR] Failed to load from Redis, will try GCS:`, redisError)
    }

    let conversationHistory: Message[] = []

    if (redisSteps.length > 0) {
      // Use Redis steps
      conversationHistory = this.reconstructConversationFromRedisSteps(redisSteps)
    } else {
      // Fall back to GCS via MessageAttachment (for old executions or after Redis TTL)
      logger.info(`🔄 [AGENT-EXECUTOR] No Redis steps found, trying GCS for ${checkpointId}`)
      const gcsSteps = await this.storage.getAgenticStepsFromGCS(parentExecutionId, inputStepDbId)
      const validGcsSteps = gcsSteps.filter(
        (s): s is typeof s & { stepName: string; data: string } => !!s.stepName && !!s.data
      );
      conversationHistory = this.reconstructConversationFromRedisSteps(validGcsSteps)
    }

    // If no history could be reconstructed, use the original conversation request
    // This handles the case where steps exist but couldn't be parsed
    const resumeRequest: ConversationRequest = {
      ...conversationRequest,
      messages: conversationHistory.length > 0 ? conversationHistory : conversationRequest.messages
    }

    logger.info(`🔄 [AGENT-EXECUTOR] Resuming execution with ${resumeRequest.messages.length} messages (${conversationHistory.length} reconstructed)`)

    try {
      const { result, gitInfo } = await this.executeFrameworkWithPauseCheck(
        parentExecutionId,
        inputStepDbId,
        checkpointId,
        agentChkConfig,
        resumeRequest,
        parentState
      )
      

      // Note: saveAgenticCheckpointState is called by workflow-engine.ts
      // We just return the result here
      const updatedState = this.buildStateFromCompletedExecution(parentState, result as FrameworkExecutionResult)
      return { result, updatedState, gitInfo }

    } catch(error) {
      // Handle execution error - create error step
      await this.storage.createErrorStep(parentExecutionId, inputStepDbId, error as Error);
      throw error
    }
  }

  /**
   * Reconstruct conversation history from Redis steps (per-step storage format)
   */
  private reconstructConversationFromRedisSteps(steps: Array<{ stepName: string; data: string; createdAt: Date }>): Message[] {
    const conversationHistory: Message[] = []

    // Sort steps by creation time
    const sortedSteps = steps.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    for (const step of sortedSteps) {
      if (!step.data) continue

      try {
        const stepData = JSON.parse(step.data)

        // Handle different step types based on stepName
        // Note: stepData is already parsed from step.data (which is a JSON string)
        if (step.stepName.startsWith('tool_')) {
          // Tool execution step - fields are directly in stepData
         
            const toolResultMessage = createToolResultMessage(
              typeof stepData.output === 'string' ? stepData.output : JSON.stringify(stepData.output),
              stepData.id || step.stepName,
              stepData.success !== false,
              {
                error: stepData.error,
                executionTime: stepData.duration
              }
            )
            conversationHistory.push(toolResultMessage)
          
        } else if (step.stepName.startsWith('llm_call_')) {
          // LLM call step - fields are directly in stepData: response, thinking, toolCalls
          const content = stepData.response || stepData.content || ''
          // Include step if there's any content, thinking, or toolCalls (even if response is empty)
          if (content || stepData.thinking || stepData.toolCalls?.length > 0) {
            const assistantMessage = createAssistantMessage(content, {
              thinking: stepData.thinking,
              toolCalls: stepData.toolCalls
            })
            conversationHistory.push(assistantMessage)
          }
        } else if (step.stepName === 'assistant_message') {
          // Assistant message step
          const content = stepData.turn?.result?.content || stepData.content || ''
          if (content) {
            const assistantMessage = createAssistantMessage(content, {
              thinking: stepData.thinking,
              toolCalls: stepData.toolCalls
            })
            conversationHistory.push(assistantMessage)
          }
        } else if (step.stepName === 'user_message') {
          // User message step - include in reconstruction for multi-continuation support
          // Format: {"content":"message text","role":"user"}
          const content = stepData.content || ''
          if (content) {
            const userMessage = createUserMessage(content)
            conversationHistory.push(userMessage)
            logger.info(`[AGENT-EXECUTOR] Reconstructed user_message: "${content.substring(0, 50)}..."`)
          }
        }
      } catch (error) {
        logger.error(`Error parsing Redis step data for ${step.stepName}:`, error)
        continue
      }
    }

    return conversationHistory
  }

  /**
   * Start fresh framework execution directly on parent
   * NEW: No child execution creation, uses inputStepDbId directly
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
      // Execute framework with pause checking directly on parent
      const { result, gitInfo } = await this.executeFrameworkWithPauseCheck(
        parentExecutionId,
        inputStepDbId,
        checkpointId,
        agentChkConfig,
        conversationRequest,
        parentState
      )

      // Note: saveAgenticCheckpointState is called by workflow-engine.ts
      // We just return the result here
      const updatedState = this.buildStateFromCompletedExecution(parentState, result as FrameworkExecutionResult)
      return { result, updatedState, gitInfo }

    } catch (error) {
      // Handle execution error - create error step
      await this.storage.createErrorStep(parentExecutionId, inputStepDbId, error as Error);
      throw error
    }
  }

  /**
   * Start continuation execution - reconstructs conversation from source
   * and appends user's continuation message.
   * NEW: Uses parent execution directly with inputStepDbId
   */
  // private async startContinuationExecution<T extends BaseWorkflowContext>(
  //   parentExecutionId: string,
  //   _workflowId: string,
  //   agentChkConfig: FullAgenticCheckpointConfig,
  //   originalConversationRequest: ConversationRequest,
  //   parentState: WorkflowState<T>,
  //   inputStepDbId: string,
  //   _checkpointId: string,
  //   continuationOverride: AgenticContinuationOverride
  // ): Promise<{ result: ConversationResult; updatedState: WorkflowState<T>; gitInfo: GitInfo }> {

  //   // 1. Get git info from source execution to use the same branch/commit
  //   const sourceGitInfo = await this.storage.getChildExecutionGitInfo(continuationOverride.sourceChildExecutionId)
    
  //   if (sourceGitInfo) {
  //     logger.info(`🔄 [AGENT-EXECUTOR] Source execution git info:`)
  //     logger.info(`   Branch: ${sourceGitInfo.branch}`)
  //     logger.info(`   Commit: ${sourceGitInfo.commitHash || 'N/A'}`)
  //     logger.info(`   PR: ${sourceGitInfo.pr_link || sourceGitInfo.pullRequestUrl || 'N/A'}`)
      
  //     // Override repoInfo to use the same branch from the original execution
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

  //   // 2. Get conversation history from source execution
  //   const sourceSteps = await this.storage.getChildWorkflowSteps(continuationOverride.sourceChildExecutionId)
  //   const reconstructedHistory = this.reconstructConversationFromSteps(sourceSteps)

  //   logger.info(`🔄 [AGENT-EXECUTOR] Reconstructed ${reconstructedHistory.length} messages from source execution`)

  //   // 3. Create user message from continuation input
  //   const continuationMessage = createUserMessage(continuationOverride.continuationUserMessage)

  //   // 4. Build conversation request with history + user message
  //   const continuationRequest: ConversationRequest = {
  //     ...originalConversationRequest,
  //     messages: [...reconstructedHistory, continuationMessage]
  //   }

  //   logger.info(`🔄 [AGENT-EXECUTOR] Continuation request has ${continuationRequest.messages.length} messages (including user's new message)`)

  //   // Note: user_message step is already created by copyParentAgentStepsToExecution() in workflow-engine.ts
  //   // No need to create it again here to avoid duplicate user messages in the UI

  //   try {
  //     // 6. Execute framework with the reconstructed history + user message
  //     const { result, gitInfo } = await this.executeFrameworkWithPauseCheck(
  //       parentExecutionId,
  //       inputStepDbId,
  //       _checkpointId,
  //       agentChkConfig,
  //       continuationRequest,
  //       parentState,
  //       true // isContinuation flag
  //     )

  //     // Note: saveAgenticCheckpointState is called by workflow-engine.ts
  //     // We just return the result here
  //     const updatedState = this.buildStateFromCompletedExecution(parentState, result as FrameworkExecutionResult)
  //     return { result, updatedState, gitInfo }

  //   } catch (error) {
  //     // Handle execution error
  //     await this.storage.createErrorStep(parentExecutionId, inputStepDbId, error as Error);
  //     throw error
  //   }
  // }

  /**
   * Execute framework agent with pause checking on every event
   * NEW: Uses inputStepDbId instead of childExecutionId for step storage
   * @param parentExecutionId - Parent workflow execution ID (for workspace events and step storage)
   * @param inputStepDbId - The existing INPUT step ID for agentic checkpoint
   * @param _checkpointId - The checkpoint/step name for this agentic execution
   * @param isContinuation - If true, this is a continuation of a previous execution.
   */
  private async executeFrameworkWithPauseCheck<T extends BaseWorkflowContext>(
    parentExecutionId: string,
    inputStepDbId: string,
    _checkpointId: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    conversationRequest: ConversationRequest,
    parentState: WorkflowState<T>,
    isContinuation: boolean = false
  ): Promise<{ result: ConversationResult; gitInfo: GitInfo }> {
    const repoUrl = agentChkConfig.repoInfo?.repoUrl;
    const baseBranch = agentChkConfig.repoInfo?.baseBranch;
    const repoBranch = agentChkConfig.repoInfo?.repoBranch;
    const checkoutCommit = agentChkConfig.repoInfo?.checkoutCommit;
    const continuationCommitHash = agentChkConfig.repoInfo?.continuationCommitHash;
    const existingPrLink = agentChkConfig.repoInfo?.existingPrLink;
    const shallow = agentChkConfig.repoInfo?.shallow ?? false;
    let repoPath: string | undefined;
    let branchName: string | undefined;
    let projectName: string | undefined;
    let repoName: string | undefined;

    // Clone repository if URL is provided
    // Use parentExecutionId for workspace path so all agentic steps in a workflow share the same /tmp/{parentExecutionId} directory
    if (repoUrl) {
      // Publish cloning_started event so frontend can show "Cloning in Remote..." status
      await workspaceEventService.publishCloningStarted(parentExecutionId, inputStepDbId);

      // For continuation, pass the commit hash to checkout the exact state
      // Use parentExecutionId so workspace is reused across agentic steps
      const cloneResult = await cloneRepository(
        repoUrl, 
        parentExecutionId, 
        baseBranch, 
        repoBranch,
        isContinuation ? continuationCommitHash : undefined,
        checkoutCommit,
        shallow
      );

      logger.info(`🔧 [AGENT-EXECUTOR] Workspace at: ${cloneResult.repoPath}`);
      logger.info(`🔧 [AGENT-EXECUTOR] Parent execution ID: ${parentExecutionId}`);
      logger.info(`🔧 [AGENT-EXECUTOR] Input step ID: ${inputStepDbId}`);
      logger.info(`🔧 [AGENT-EXECUTOR] Workspace location: /tmp/${parentExecutionId}`);
      repoPath = cloneResult.repoPath;
      branchName = cloneResult.branchName;
      const extractedData = extractWorkspace(repoUrl);
      projectName = extractedData.projectName
      repoName = extractedData.repoName
      
      if (isContinuation && continuationCommitHash) {
        logger.info(`🔄 [AGENT-EXECUTOR] Continuation: Cloned branch ${branchName} at commit ${continuationCommitHash}`)
      }

      // Publish workspace_ready event with repo info so backend can clone for cross-pod file viewing
      // Pass baseBranch so backend can clone from it (feature branch may not exist on remote yet)
      await workspaceEventService.publishWorkspaceReady(parentExecutionId, inputStepDbId, repoUrl, branchName, baseBranch)
    }

    const agenticConfig = { ...agentChkConfig.agentConfig, cwd: repoPath };

    // Initialize framework agent
    const agent = Agent.create(agenticConfig);

    // Track if any commits were made during execution
    const commitTracker: AgentTracker = {
      hasCommits: false,
      branchName: branchName || '',
      repoUrl,
      inputStepDbId,
      parentExecutionId,
      latestCommitHash: undefined,
      commitCount: 0
    }

    let abortController = new AbortController();

    // Setup continuation listener via Redis pub/sub
    let continuationMessage: string | null = null;
    let cleanupContinuationListener = await this.setupContinuationListener(
      parentExecutionId,
      _checkpointId,
      abortController,
      (event) => {
        continuationMessage = event.message;
        logger.info(`[AGENT-EXECUTOR] Continuation message received: "${event.message?.substring(0, 100)}..."`);
      }
    );

    // Setup event handlers with pause and cancellation checking
    const eventHandler = this.createPauseOrCancellationAwareEventHandler(parentExecutionId, inputStepDbId, commitTracker, repoPath || ".", agentChkConfig, abortController)

    // Add event listener for all orchestrator events
    agent.addEventListener(eventHandler)

    // Execute conversation with internal continuation support
    let result: ConversationResult | undefined;
    let isRunning = true;

    // If mode is AUTOMATIC and last message is an assistant message,
    // skip agent execution - the agent already completed its work in the previous run
    // (which ended with WorkflowExternalWaitException in MANUAL mode).
    // All git side-effects (push, PR) already happened, and commitTracker is fresh
    // so the post-loop git operations will naturally be skipped.
    const currentExecutionMode = await this.storage.getExecutionMode(parentExecutionId);
    const lastMessage = conversationRequest.messages[conversationRequest.messages.length - 1];

    if (currentExecutionMode === 'AUTOMATIC' && lastMessage?.type === 'assistant') {
      logger.info(`[AGENT-EXECUTOR] AUTOMATIC mode with last message as assistant - skipping agent execution, returning conversation as result`);

      cleanupContinuationListener();

      // Fetch last commit hash from agentSteps table for this step
      const agentStepRepo = new AgentStepRepository();
      const agentSteps = await agentStepRepo.findByStepsId(inputStepDbId);
      const lastCommitStep = [...agentSteps].reverse().find(s => s.commitHash);
      const latestCommitHash = lastCommitStep?.commitHash || undefined;

      // Fetch PR URL from pullRequests table for this execution
      const pullRequestRepository = new PRMetricsRepository();
      const prRecord = await pullRequestRepository.findByWorkflowExecutionId(parentExecutionId);
      const pullRequestUrl = prRecord?.prUrl || undefined;

      result = {
        messages: [...conversationRequest.messages],
        toolExecutions: [],
        metrics: {
          totalDuration: 0,
          llmCalls: 0,
          totalTokens: 0,
          toolExecutions: 0,
          averageToolDuration: 0,
          conversationTurns: 0,
          startTime: new Date(),
          endTime: new Date()
        },
        status: 'completed' as const
      };

      // Compute git diff BEFORE cleanup (while repo is still available)
      let gitDiff: GitDiffFile[] | undefined
      let diffStats: GitDiffStats | undefined
      let baseCommitHash: string | undefined

      if (repoPath && baseBranch && latestCommitHash) {
        try {
          const { stdout } = await execAsync(`git merge-base HEAD origin/${baseBranch}`, { cwd: repoPath });
          baseCommitHash = stdout.trim();
          logger.info(`[AGENT-EXECUTOR] AUTOMATIC mode - Using merge-base: ${baseCommitHash.substring(0, 8)} (vs ${baseBranch})`)

          const diffResult = await this.computeGitDiff(repoPath, baseCommitHash)
          gitDiff = diffResult.gitDiff
          diffStats = diffResult.diffStats
        } catch (error) {
          logger.error(`[AGENT-EXECUTOR] AUTOMATIC mode - Failed to compute git diff with merge-base:`, error)
        }
      }

      if (repoPath) {
        await workspaceEventService.publishWorkspaceClosed(parentExecutionId, inputStepDbId);
      }

      const gitInfo: GitInfo = {
        branch: branchName || agentChkConfig.repoInfo?.repoBranch || 'main',
        repoUrl: commitTracker.repoUrl,
        commitHash: latestCommitHash,
        baseCommitHash,
        pullRequestUrl,
        pr_link: pullRequestUrl,
        gitDiff,
        diffStats
      };

      return { result, gitInfo };
    }

    while (isRunning) {
      try {
        result = await agent.execute({
          ...conversationRequest,
          systemPrompt: conversationRequest.systemPrompt
            ? conversationRequest.systemPrompt + `\n\nCurrent Dir - ${repoPath || ''} \n\n`
            : conversationRequest.systemPrompt,
          abortSignal: abortController.signal,
        });

        // Check if this was a continuation abort (agent returns error instead of throwing)
        if (continuationMessage && abortController.signal.aborted) {
          logger.info(`[AGENT-EXECUTOR] Agent aborted for continuation with message`);

          // Handle continuation and restart agent execution
          const continuationResult = await this.handleContinuationAndRestart(
            parentExecutionId,
            _checkpointId,
            inputStepDbId,
            conversationRequest,
            continuationMessage,
            abortController,
            cleanupContinuationListener,
            (newRequest, newController, newCleanup) => {
              conversationRequest = newRequest;
              abortController = newController;
              cleanupContinuationListener = newCleanup;
              continuationMessage = null;
            }
          );

          if (continuationResult) {
            continue;
          }
        }

        // Normal completion - exit loop
        isRunning = false;

      } catch (agentError) {
        // Check if this was a continuation abort (thrown error)
        if (continuationMessage && abortController.signal.aborted) {
          logger.info(`[AGENT-EXECUTOR] Agent aborted for continuation with message (from catch)`);

          // Handle continuation and restart agent execution
          const continuationResult = await this.handleContinuationAndRestart(
            parentExecutionId,
            _checkpointId,
            inputStepDbId,
            conversationRequest,
            continuationMessage,
            abortController,
            cleanupContinuationListener,
            (newRequest, newController, newCleanup) => {
              conversationRequest = newRequest;
              abortController = newController;
              cleanupContinuationListener = newCleanup;
              continuationMessage = null;
            }
          );

          if (continuationResult) {
            continue;
          }
        }

        // Not a continuation - handle as real error
        logger.error(`Agent execution failed:`, agentError);

        // Clean up listener
        cleanupContinuationListener();

        // Check if we have commits - if so, the main task was successful
        if (commitTracker.hasCommits) {
          logger.info(`Main task completed successfully (commits made), continuing with git operations despite agent error`);
          // Create a minimal result to continue
          result = {
            error: `Agent execution failed but commits were made: ${agentError}`,
            messages: [],
            toolExecutions: [],
            metrics: {
              totalDuration: 0,
              llmCalls: 0,
              totalTokens: 0,
              toolExecutions: 0,
              averageToolDuration: 0,
              conversationTurns: 0,
              startTime: new Date(),
              endTime: new Date()
            },
            status: 'error' as const
          };
          await this.handleExecutionError(parentExecutionId, agentError);
          isRunning = false;
          break;
        } else {
          await this.handleExecutionError(parentExecutionId, agentError);
          throw agentError;
        }
      }
    }

    // Clean up continuation listener
    cleanupContinuationListener();

    let pushResult: { repoUrl?: string; pullRequestUrl?: string } | undefined;

    // Push commits if any were made during execution
    if (commitTracker.hasCommits && repoPath && branchName) {
      pushResult = await pushCommits(repoPath, branchName, repoUrl);

      // For continuation, skip creating new PR - the existing PR will be auto-updated
      // since we push to the same branch
      if (isContinuation && existingPrLink) {
        logger.info(`🔄 [AGENT-EXECUTOR] Continuation: Pushed to existing PR branch, PR will be auto-updated`)
        logger.info(`   Existing PR: ${existingPrLink}`)
        // Use the existing PR link - ensure pushResult is defined
        if (pushResult) {
          pushResult.pullRequestUrl = existingPrLink;
        } else {
          pushResult = { pullRequestUrl: existingPrLink, repoUrl };
        }
      } else {
        // Traditional PR scenario: Create PR at the end
        // Fetch workflow to get ticketId
       
        const workflow = await this.workflowRepo.findById(parentState.workflowId)
        const ticketId = workflow?.ticketId || ''
        
        // Get ticket details using ticketId from workflow
        const ticket = ticketId ? await this.ticketRepo.findById(ticketId) : null
        const xyneId = ticket?.xyneId
        const ticketTitle: string | undefined = ticket?.title
        
        const ticketDescription = await this.generatePRDescription(
          agent,
          conversationRequest,
          parentState
        );

        try {
          const prUrl = await this.bitbucketManager.raisePr(repoUrl, parentExecutionId, baseBranch, repoBranch, projectName, repoName, ticketTitle, ticketDescription, xyneId, ticketId);
          
          if (prUrl) {
            logger.info(`[AGENT-EXECUTOR] PR created: ${prUrl}`);
            if (pushResult) {
              pushResult.pullRequestUrl = prUrl;
            } else {
              pushResult = { pullRequestUrl: prUrl, repoUrl };
            }
          }
        } catch (error) {
          logger.error(`Failed to create PR:`, error);
        }
      }
    }

    // Generate custom PR link using callback if provided
    let customPrLink: string | undefined;
    if (commitTracker.latestCommitHash && agentChkConfig.repoInfo?.getPrLink) {
      const targetBranch = agentChkConfig.repoInfo.baseBranch || 'staging';
      const repository = agentChkConfig.repoInfo.repository || 'unknown';
      try {
        customPrLink = agentChkConfig.repoInfo.getPrLink({
          commitHash: commitTracker.latestCommitHash,
          baseBranch: targetBranch,
          repository: repository
        });
      } catch (error) {
        logger.error(`Failed to generate PR link using callback:`, error);
      }
    }

    // Compute and cache git diff BEFORE cleanup (while repo is still available)
    let gitDiff: GitDiffFile[] | undefined
    let diffStats: GitDiffStats | undefined
    let baseCommitHash: string | undefined

    if (repoPath && baseBranch && commitTracker.hasCommits) {
      try {
        const { stdout } = await execAsync(`git merge-base HEAD origin/${baseBranch}`, { cwd: repoPath });
        baseCommitHash = stdout.trim();
        logger.info(`[AGENT-EXECUTOR] Using merge-base: ${baseCommitHash.substring(0, 8)} (vs ${baseBranch})`)
        
        const diffResult = await this.computeGitDiff(repoPath, baseCommitHash)
        gitDiff = diffResult.gitDiff
        diffStats = diffResult.diffStats
      } catch (error) {
        logger.error(`[AGENT-EXECUTOR] Failed to compute git diff with merge-base:`, error)
      }
    }

    // Build git info from commit tracker (including cached diff)
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

    // Note: Workspace cleanup is deferred to workflow completion (in workflowRegistry)
    // This allows subsequent agentic steps to reuse the same /tmp/{parentExecutionId} workspace
    // Publish workspace_closed event to notify frontend this step is done
    if (repoPath) {
      await workspaceEventService.publishWorkspaceClosed(parentExecutionId, inputStepDbId)
    }

    if (!result) {
      throw new Error('Agent execution completed but no result was returned');
    }

    if (result.error) {
      // Only throw if no commits were made (i.e., the main task failed)
      if (!commitTracker.hasCommits) {
        throw new Error(result.error)
      } else {
        logger.warn(`Agent had errors but commits were made and PR was created, considering workflow successful:`, result.error);
      }
    }

    // Check if we're in MANUAL mode - if so, throw external wait exception to pause
    const currentMode = await this.storage.getExecutionMode(parentExecutionId);
    if (currentMode === 'MANUAL') {
      logger.info(`[AGENT-EXECUTOR] Agent completed in MANUAL mode - pausing for external input`);
      throw new WorkflowExternalWaitException(parentExecutionId, inputStepDbId);
    }

    return { result, gitInfo }
  }

  /**
   * Create event handler that checks pause and cancellation status after each event
   * NEW: Uses parentExecutionId and inputStepDbId instead of childExecutionId
   */
  private createPauseOrCancellationAwareEventHandler(
    parentExecutionId: string,
    inputStepDbId: string,
    commitTracker: AgentTracker,
    repoPath: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    abortController: AbortController
  ): OrchestratorEventHandler {
    return {
      onToolCallsRequested: async (toolCalls) => {
        await this.checkWorkflowPauseOrCancelStatusAndThrow(parentExecutionId, abortController)

        // Track tool calls - use new signature with workflowExecutionId and inputStepDbId
        for (const toolCall of toolCalls) {
          await this.storage.createToolExecutionStep(parentExecutionId, inputStepDbId, {
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.arguments,
            output: null,
            duration: 0,
            success: false
          })
        }
      },

      onToolResult: async (result) => {
        await this.checkWorkflowPauseOrCancelStatusAndThrow(parentExecutionId, abortController)

        logger.info("Tool result received:", result);
        let parsed: any;
        try {
          parsed = JSON.parse(result.content);
        } catch {
          parsed = { output: result.content };
        }

        // Check for uncommitted changes in the repository
        const hasChanges = await hasUncommittedChanges(repoPath);

        let updateAgentData: UpdateAgentStepInput = {
          repositoryURL: commitTracker.repoUrl,
          branch: commitTracker.branchName
        }

        if (hasChanges) {
          const commitMessage = `Auto-commit changes from tool execution ${result.toolCallId}`;
          const updatedCommitMessage = agentChkConfig.repoInfo?.getCommitMessage
            ? agentChkConfig.repoInfo.getCommitMessage(commitMessage)
            : commitMessage;

          const coAuthor = agentChkConfig.repoInfo?.coAuthor;
          const commitHash = await commitAllChanges(
            repoPath,
            updatedCommitMessage,
            coAuthor?.name,
            coAuthor?.email
          );

          if (commitHash) {
            updateAgentData = { ...updateAgentData, commitHash: commitHash };
            commitTracker.hasCommits = true;
            commitTracker.latestCommitHash = commitHash;
                        
            // Push commits immediately so backend can pull them for live workspace viewing
            // This enables cross-pod file viewing without shared storage
            if (repoPath && commitTracker.branchName && commitTracker.repoUrl) {
              try {
                await pushCommits(repoPath, commitTracker.branchName, commitTracker.repoUrl);
                logger.info(`✅ [AGENT-EXECUTOR] Pushed commit ${commitHash.substring(0, 8)} for live workspace viewing`);
                
                // Publish file tree update event after push succeeds
                if (commitTracker.parentExecutionId) {
                  await workspaceEventService.publishFileTreeUpdate(
                    commitTracker.parentExecutionId,
                    inputStepDbId,
                    commitHash
                  )
                }
              } catch (pushError) {
                logger.error(`❌ [AGENT-EXECUTOR] Failed to push commit for live viewing:`, pushError);
                // Still mark as having commits - final push will happen at end of execution
              }
            }
          } else {
            logger.error(`Failed to create commit`);
          }
        }

        // Update Redis step first (critical for status tracking), then DB agent step (non-critical)
        const toolCallStatus = result.error ? 'failed' : (result.success !== false ? 'completed' : 'failed');
        await this.storage.updateToolExecutionStep(inputStepDbId, result.toolCallId, parsed, toolCallStatus);

        try {
          await this.storage.updateToolExecutionAgentStep(inputStepDbId, result.toolCallId, updateAgentData);
        } catch (agentStepError) {
          logger.error(`[AGENT-EXECUTOR] Failed to update agent step (non-critical):`, agentStepError);
        }
      },

      onLLMResponse: async (response) => {
        // Track LLM response - use new signature
        await this.storage.createLLMCallStep(parentExecutionId, inputStepDbId, {
          content: response.content,
          thinking: response.thinking,
          toolCalls: response.toolCalls,
          tokens: response.tokens
        })

        // Check pause status
        await this.checkWorkflowPauseOrCancelStatusAndThrow(parentExecutionId, abortController)
      },

      onError: async (error) => {
        // Always track errors - use new signature
        await this.storage.createErrorStep(parentExecutionId, inputStepDbId, error)

        // Check pause status
        await this.checkWorkflowPauseOrCancelStatusAndThrow(parentExecutionId, abortController)
      },

      onTurnComplete: async (turn, result) => {
        // Track turn completion - use parentExecutionId and inputStepDbId
        await this.storage.createAssistantMessageStep(parentExecutionId, inputStepDbId, {
          turn,
          result
        })

        // Check pause status
        await this.checkWorkflowPauseOrCancelStatusAndThrow(parentExecutionId, abortController)
      }
    }
  }

  /**
   * Generate PR description by combining ticket info with LLM-generated summary
   */
  private async generatePRDescription<T extends BaseWorkflowContext>(
    agent: any,
    conversationRequest: ConversationRequest,
    parentState: WorkflowState<T>
  ): Promise<string> {
    const ticketDescription: string | undefined = ('description' in parentState.context ? parentState.context.description : null) as string | undefined

    // Prepare fallback description
    const fallbackDescription = ticketDescription || 'Automated changes from DevTestWorkflow';

    try {
      const suggestedPRSummary = await agent.execute({
        ...conversationRequest,
        systemPrompt: 'Based on the given conversation details, summarize whatever you did. This summary should be suitable to be used as a pull request description'
      })

      if (suggestedPRSummary.messages.length > 0) {
        const summaryContent = suggestedPRSummary.messages[suggestedPRSummary.messages.length - 1].content;

        // Check if the summary content contains error messages
        if (summaryContent && !summaryContent.toLowerCase().includes('error') && !summaryContent.toLowerCase().includes('failed')) {
          return `### Ticket Description:\n${fallbackDescription}\n\n### LLM Changes Summary:\n${summaryContent}`;
        } else {
          logger.warn(`LLM summary contains errors, using ticket description as fallback`);
          return fallbackDescription;
        }
      } else {
        logger.warn(`No summary messages returned, using ticket description as fallback`);
        return fallbackDescription;
      }
    } catch (summaryError) {
      logger.warn(`Failed to generate PR summary, using ticket description as fallback:`, summaryError);
      return fallbackDescription;
    }
  }

  /**
   * Check if workflow (parent or child) is paused or cancelled - throw appropriate exception if so
   */
  private async checkWorkflowPauseOrCancelStatusAndThrow(workflowExecutionId: string, abortController: AbortController): Promise<void> {
    const pauseStatus = await this.storage.checkWorkflowPauseOrCancelStatus(workflowExecutionId)

    if (pauseStatus.isCancelled) {
      abortController.abort();
      throw new WorkflowCancelledException(
        pauseStatus.parentExecutionId || workflowExecutionId,
        'framework_step_cancelled'
      )
    }

    if (pauseStatus.isPaused) {
      // Throw WorkflowPausedException to stop framework execution
      throw new WorkflowPausedException(
        pauseStatus.parentExecutionId || workflowExecutionId,
        'framework_step_paused'
      )
    }
  }

  private async handleExecutionError(workflowExecutionId: string, error: unknown): Promise<void> {
    if (error instanceof WorkflowCancelledException) {
      await this.storage.markChildExecutionCancelled(workflowExecutionId, 'workflow_cancelled');
      return;
    }
    
    if (error instanceof Error && error.message === 'Execution aborted') {
      await this.storage.markChildExecutionCancelled(workflowExecutionId, 'execution_aborted');
      throw new WorkflowCancelledException(workflowExecutionId, 'framework_step_cancelled');
    }
    
    await this.storage.markChildExecutionFailed(workflowExecutionId, this.serializeError(error as Error));
  }

  /**
   * Build updated workflow state from completed execution
   */
  private buildStateFromCompletedExecution<T extends BaseWorkflowContext>(parentState: WorkflowState<T>, result: FrameworkExecutionResult): WorkflowState<T> {
    return {
      ...parentState,
      context: {
        ...parentState.context,
        agentResult: result
      } as T
    }
  }

  /**
   * Compute git diff between baseCommitHash and HEAD
   * This is called before repo cleanup to cache the diff in gitInfo
   */
  private async computeGitDiff(repoPath: string, baseCommitHash: string): Promise<{ gitDiff: GitDiffFile[]; diffStats: GitDiffStats }> {
    try {
      // Get raw diff
      const { stdout: diffOutput } = await execAsync(`git diff --unified=3 ${baseCommitHash}..HEAD`, {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large diffs
      })

      // Get diff stats
      const diffStats = await this.getGitDiffStats(repoPath, baseCommitHash)

      // Parse diff output
      const gitDiff = this.parseGitDiff(diffOutput)

      logger.info(`📊 [AGENT-EXECUTOR] Computed git diff: ${diffStats.files} files, +${diffStats.additions}/-${diffStats.deletions} lines`)

      return { gitDiff, diffStats }
    } catch (error) {
      logger.error(`[AGENT-EXECUTOR] Failed to compute git diff:`, error)
      return { gitDiff: [], diffStats: { additions: 0, deletions: 0, files: 0 } }
    }
  }

  private async getGitDiffStats(repoPath: string, baseCommitHash: string): Promise<GitDiffStats> {
    try {
      const { stdout } = await execAsync(`git diff --stat ${baseCommitHash}..HEAD`, {
        cwd: repoPath
      })

      // Parse stats 
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
    } catch (error) {
      logger.error('[AGENT-EXECUTOR] Error getting git diff stats:', error)
      return { additions: 0, deletions: 0, files: 0 }
    }
  }

  private parseGitDiff(diffOutput: string): GitDiffFile[] {
    const files: GitDiffFile[] = []
    const lines = diffOutput.split('\n')
    let currentFile: GitDiffFile | null = null
    let currentHunk: { oldStart: number; oldLines: number; newStart: number; newLines: number; content: string } | null = null
    let hunkLines: string[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // File header
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
      }

      // File type indicators
      else if (line.startsWith('new file mode')) {
        if (currentFile) {
          currentFile.type = 'add'
        }
      }
      else if (line.startsWith('deleted file mode')) {
        if (currentFile) {
          currentFile.type = 'delete'
        }
      }
      else if (line.startsWith('rename from')) {
        if (currentFile) {
          currentFile.type = 'rename'
        }
      }

      // Hunk header
      else if (line.startsWith('@@')) {
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
      }

      // Hunk content
      else if (currentFile && currentHunk) {
        hunkLines.push(line)
      }
    }

    // Add the last file
    if (currentFile) {
      if (currentHunk && hunkLines.length > 0) {
        currentHunk.content = hunkLines.join('\n')
        currentFile.hunks.push(currentHunk)
      }
      files.push(currentFile)
    }

    return files
  }

  // ============== REDIS PUB/SUB CONTINUATION SUPPORT ==============

  /**
   * Setup Redis pub/sub listener for continuation events
   * This allows external signals to abort the agent and trigger a continuation
   */
  private async setupContinuationListener(
    parentExecutionId: string,
    checkpointId: string,
    abortController: AbortController,
    onContinuationEvent: (event: { message: string; type: string; executionId: string; stepName: string; timestamp: string }) => void
  ): Promise<() => Promise<void>> {
    const channel = `workflow:${parentExecutionId}:${checkpointId}:continue`;
    logger.info(`[AGENT-EXECUTOR] Setting up continuation listener for channel: ${channel}`);

    const continuationCallback = (event: { message: string; type: string; executionId: string; stepName: string; timestamp: string }) => {
      logger.info(`[AGENT-EXECUTOR] Received continuation message via Redis pub/sub on channel: ${channel}`);
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
      logger.info(`[AGENT-EXECUTOR] Successfully subscribed to channel: ${channel}`);
    } catch (error) {
      logger.error(`[AGENT-EXECUTOR] Failed to subscribe to continuation channel:`, error);
      throw error;
    }

    // Return cleanup function
    return async () => {
      logger.info(`[AGENT-EXECUTOR] Cleaning up continuation listener for channel: ${channel}`);
      try {
        await redisService.unsubscribeFromAgentContinuation(
          parentExecutionId,
          checkpointId,
          continuationCallback
        );
        logger.info(`[AGENT-EXECUTOR] Successfully unsubscribed from channel: ${channel}`);
      } catch (error) {
        logger.error(`[AGENT-EXECUTOR] Failed to unsubscribe from continuation channel:`, error);
      }
    };
  }

  /**
   * Handle continuation by fetching conversation history, resetting state, and preparing for restart.
   * This function encapsulates the common continuation logic used in both try and catch blocks.
   *
   * @returns true if continuation was handled successfully and execution should restart, false otherwise
   */
  private async handleContinuationAndRestart(
    parentExecutionId: string,
    checkpointId: string,
    inputStepDbId: string,
    conversationRequest: ConversationRequest,
    continuationMessage: string,
    _abortController: AbortController,
    cleanupContinuationListener: () => Promise<void>,
    updateState: (newRequest: ConversationRequest, newController: AbortController, newCleanup: () => Promise<void>) => void
  ): Promise<boolean> {
    // Set execution mode to MANUAL when continuation is received
    await this.storage.setExecutionMode(parentExecutionId, 'MANUAL');
    logger.info(`🎛️ [AGENT-EXECUTOR] Execution mode set to MANUAL for ${parentExecutionId}`);

    // Fetch full conversation history from Redis/GCS including all LLM calls and tool executions
    // Note: initialUserMessage is now automatically included via the user_message step stored in Redis
    const newConversationRequest = await this.buildContinuationConversationRequest(
      parentExecutionId,
      checkpointId,
      inputStepDbId,
      conversationRequest,
      continuationMessage
    );

    // Create new abort controller for the next execution
    const newAbortController = new AbortController();

    // Re-setup continuation listener for the next potential abort
    await cleanupContinuationListener();
    let newCleanupContinuationListener = await this.setupContinuationListener(
      parentExecutionId,
      checkpointId,
      newAbortController,
      (event) => {
        // This callback will be used by the caller to set continuationMessage
        logger.info(`[AGENT-EXECUTOR] Continuation message received: "${event.message?.substring(0, 100)}..."`);
      }
    );

    // Update state in the caller
    updateState(newConversationRequest, newAbortController, newCleanupContinuationListener);

    // Continue the loop to restart agent.execute
    logger.info(`🔄 [AGENT-EXECUTOR] Restarting agent execution with full conversation history (${newConversationRequest.messages.length} messages)`);
    return true;
  }

  /**
   * Load agent checkpoint from Redis
   * Returns null if no checkpoint exists
   */
  async loadAgentCheckpoint(
    parentExecutionId: string,
    checkpointId: string
  ): Promise<any | null> {
    const checkpointKey = buildWorkflowStepKey(parentExecutionId, `${checkpointId}:checkpoint`);
    const checkpointData = await redisService.get(checkpointKey);

    if (!checkpointData) {
      return null;
    }

    try {
      return JSON.parse(checkpointData);
    } catch (error) {
      logger.error(`[AGENT-EXECUTOR] Failed to parse checkpoint data:`, error);
      return null;
    }
  }

  /**
   * Clear agent checkpoint from Redis after successful continuation
   */
  async clearAgentCheckpoint(
    parentExecutionId: string,
    checkpointId: string
  ): Promise<void> {
    const checkpointKey = buildWorkflowStepKey(parentExecutionId, `${checkpointId}:checkpoint`);
    await redisService.del(checkpointKey);
    logger.info(`[AGENT-EXECUTOR] Cleared checkpoint from Redis: ${checkpointKey}`);
  }

  /**
   * Build a conversation request for continuation by fetching full history from Redis/GCS
   * This includes all LLM calls and tool executions that happened during the current execution
   */
  private async buildContinuationConversationRequest(
    parentExecutionId: string,
    checkpointId: string,
    inputStepDbId: string,
    originalRequest: ConversationRequest,
    continuationMessage: string
  ): Promise<ConversationRequest> {
    logger.info(`🔄 [AGENT-EXECUTOR] Building continuation conversation request`);

    // 1. Fetch all steps from Redis first
    let redisSteps: Array<{ stepName: string; data: string; createdAt: Date }> = [];

    try {
      redisSteps = await this.storage.getAgenticStepsFromRedis(parentExecutionId, checkpointId);
      logger.info(`🔄 [AGENT-EXECUTOR] Loaded ${redisSteps.length} steps from Redis for continuation`);
    } catch (redisError) {
      logger.warn(`⚠️ [AGENT-EXECUTOR] Failed to load from Redis for continuation:`, redisError);
    }

    let conversationHistory: Message[] = [];

    if (redisSteps.length > 0) {
      // Use Redis steps - reconstruct full conversation including LLM calls and tool executions
      conversationHistory = this.reconstructConversationFromRedisSteps(redisSteps);
    } else {
      // Fall back to GCS via MessageAttachment
      logger.info(`🔄 [AGENT-EXECUTOR] No Redis steps found, trying GCS for continuation`);
      try {
        const gcsSteps = await this.storage.getAgenticStepsFromGCS(parentExecutionId, inputStepDbId);
        const validGcsSteps = gcsSteps.filter(
          (s): s is typeof s & { stepName: string; data: string } => !!s.stepName && !!s.data
        );
        conversationHistory = this.reconstructConversationFromRedisSteps(validGcsSteps);
      } catch (gcsError) {
        logger.warn(`⚠️ [AGENT-EXECUTOR] Failed to load from GCS for continuation:`, gcsError);
      }
    }

    // If no history could be reconstructed, fall back to original request messages
    if (conversationHistory.length === 0) {
      logger.warn(`⚠️ [AGENT-EXECUTOR] No history found, using original request messages`);
      conversationHistory = [...originalRequest.messages];
    }

    // 2. Create the new user message from continuation
    const newUserMessage = createUserMessage(continuationMessage);

    // 3. Create user message step in storage so it shows in UI
    await this.storage.createUserMessageStep(parentExecutionId, inputStepDbId, continuationMessage);
    logger.info(`✅ [AGENT-EXECUTOR] Created user message step for continuation: "${continuationMessage.substring(0, 100)}..."`);

    // 4. Build and return updated conversation request
    const updatedRequest: ConversationRequest = {
      ...originalRequest,
      messages: [...conversationHistory, newUserMessage]
    };

    logger.info(`✅ [AGENT-EXECUTOR] Continuation request built with ${updatedRequest.messages.length} messages (${conversationHistory.length} history + 1 new)`);

    return updatedRequest;
  }
}