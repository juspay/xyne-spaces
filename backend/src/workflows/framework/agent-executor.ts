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
import { WorkflowExecutionStatus } from '../types/workflow-enums'
import { WorkflowPausedException, WorkflowCancelledException } from '../exceptions/workflow-exceptions'
import { BitbucketManager } from '@/bitbucket/apis'
import { TicketRepository, WorkflowRepository } from '@/database/repositories/workflows'
import { exec } from 'child_process'
import { promisify } from 'util'
import {logger} from '@/utils/logger';

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
  childExecutionId: string
  parentExecutionId: string  // Added for workspace events
  latestCommitHash?: string
  baseCommitHash?: string  // Commit hash before agent started making changes
  commitCount: number
}

export class AgentExecutor {
  constructor(private storage: WorkflowStorage, private bitbucketManager = new BitbucketManager(), private workflowRepo = new WorkflowRepository(), private ticketRepo = new TicketRepository()) {}

  /**
   * Execute framework agent with pause/resume support
   * Core Logic: Check completion → Reconstruct state → Continue with pause checking
   * 
   * Supports continuation mode: When continuationOverride is provided,
   * reconstructs conversation from source child execution and appends user message.
   */
  async executeWithWorkflowTracking<T extends BaseWorkflowContext>(
    parentExecutionId: string,
    workflowId: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    conversationRequest: ConversationRequest,
    parentState: WorkflowState<T>,
    checkpointId: string,
    continuationOverride?: AgenticContinuationOverride
  ): Promise<{ result: ConversationResult; updatedState: WorkflowState<T>; gitInfo: GitInfo }> {
    // Handle continuation mode - reconstruct history and append user message
    if (continuationOverride) {
      logger.info(`🔄 [AGENT-EXECUTOR] Continuation mode activated`)
      logger.info(`   Source child execution: ${continuationOverride.sourceChildExecutionId}`)
      
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

    // 1. Check if child workflow execution already exists and is completed
    const existingChildExecution = await this.storage.findExistingChildExecution(parentExecutionId, checkpointId)

    if (existingChildExecution) {
      if (existingChildExecution.status === WorkflowExecutionStatus.SUCCESS) {
        // Child workflow completed - return the last step output
        const result = await this.storage.getCompletedExecutionResult(existingChildExecution.id)
        if (result) {
          const updatedState = this.buildStateFromCompletedExecution(parentState, result)
          const gitInfo: GitInfo = {
            branch: agentChkConfig.repoInfo?.repoBranch || 'main',
            repoUrl: agentChkConfig.repoInfo?.repoUrl,
            hasCommits: false // From cached result, no new commits
          }
          return { result: result as ConversationResult, updatedState, gitInfo }
        }
      }

      // Child workflow exists but not completed - resume from existing state
      return await this.resumeExistingExecution(
        parentExecutionId,
        existingChildExecution.id,
        agentChkConfig,
        conversationRequest,
        parentState
      )
    }

    // 2. No existing child workflow - start fresh execution
    return await this.startFreshExecution(
      parentExecutionId,
      workflowId,
      agentChkConfig,
      conversationRequest,
      parentState,
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
   * Resume execution from existing child workflow
   */
  private async resumeExistingExecution<T extends BaseWorkflowContext>(
    parentExecutionId: string,
    childExecutionId: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    conversationRequest: ConversationRequest,
    parentState: WorkflowState<T>
  ): Promise<{ result: ConversationResult; updatedState: WorkflowState<T>; gitInfo: GitInfo }> {

    // 1. Get all existing steps from child workflow
    const existingSteps = await this.storage.getChildWorkflowSteps(childExecutionId)

    // 2. Reconstruct conversation history from steps
    const conversationHistory = this.reconstructConversationFromSteps(existingSteps)

    // 3. Build framework state from reconstructed history
    const resumeRequest: ConversationRequest = {
      ...conversationRequest,
      messages: conversationHistory
    }

    try {
      const { result, gitInfo } = await this.executeFrameworkWithPauseCheck(
        parentExecutionId,
        childExecutionId,
        agentChkConfig,
        resumeRequest,
        parentState
      )

      // 5. Mark child execution as completed and save final result WITH gitInfo
      const resultWithGitInfo = { ...result, gitInfo } as FrameworkExecutionResult
      await this.storage.markChildExecutionCompleted(childExecutionId, resultWithGitInfo)

      const updatedState = this.buildStateFromCompletedExecution(parentState, result as FrameworkExecutionResult)
      return { result, updatedState, gitInfo }

    } catch(error) {
      // Handle execution error
      await this.handleExecutionError(childExecutionId, error);
      throw error
    }
  }

  /**
   * Start fresh framework execution
   */
  private async startFreshExecution<T extends BaseWorkflowContext>(
    parentExecutionId: string,
    workflowId: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    conversationRequest: ConversationRequest,
    parentState: WorkflowState<T>,
    checkpointId: string
  ): Promise<{ result: ConversationResult; updatedState: WorkflowState<T>; gitInfo: GitInfo }> {

    // 1. Create new child workflow execution
    const childExecutionId = await this.storage.createChildWorkflowExecution(
      parentExecutionId,
      workflowId,
      checkpointId
    )

    try {
      // 2. Execute framework with pause checking
      const { result, gitInfo } = await this.executeFrameworkWithPauseCheck(
        parentExecutionId,
        childExecutionId,
        agentChkConfig,
        conversationRequest,
        parentState
      )

      // 3. Mark execution as completed WITH gitInfo
      const resultWithGitInfo = { ...result, gitInfo } as FrameworkExecutionResult
      await this.storage.markChildExecutionCompleted(childExecutionId, resultWithGitInfo)

      const updatedState = this.buildStateFromCompletedExecution(parentState, result as FrameworkExecutionResult)
      return { result, updatedState, gitInfo }

    } catch (error) {
      // Handle execution error
      await this.handleExecutionError(childExecutionId, error);
      throw error
    }
  }

  /**
   * Start continuation execution - reconstructs conversation from source child
   * and appends user's continuation message.
   * 
   * Key difference from fresh execution:
   * 1. Reconstructs conversation history from source child execution
   * 2. Uses the same branch/commit from the original execution
   * 3. Updates existing PR instead of creating new one
   */
  private async startContinuationExecution<T extends BaseWorkflowContext>(
    parentExecutionId: string,
    workflowId: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    originalConversationRequest: ConversationRequest,
    parentState: WorkflowState<T>,
    checkpointId: string,
    continuationOverride: AgenticContinuationOverride
  ): Promise<{ result: ConversationResult; updatedState: WorkflowState<T>; gitInfo: GitInfo }> {

    // 1. Get git info from source child execution to use the same branch/commit
    const sourceGitInfo = await this.storage.getChildExecutionGitInfo(continuationOverride.sourceChildExecutionId)
    
    if (sourceGitInfo) {
      logger.info(`🔄 [AGENT-EXECUTOR] Source execution git info:`)
      logger.info(`   Branch: ${sourceGitInfo.branch}`)
      logger.info(`   Commit: ${sourceGitInfo.commitHash || 'N/A'}`)
      logger.info(`   PR: ${sourceGitInfo.pr_link || sourceGitInfo.pullRequestUrl || 'N/A'}`)
      
      // Override repoInfo to use the same branch from the original execution
      // This ensures the continuation clones the same branch with the agent's changes
      if (agentChkConfig.repoInfo) {
        agentChkConfig = {
          ...agentChkConfig,
          repoInfo: {
            ...agentChkConfig.repoInfo,
            repoBranch: sourceGitInfo.branch,
            // Store the commit hash for checkout and existing PR link for updates
            continuationCommitHash: sourceGitInfo.commitHash,
            existingPrLink: sourceGitInfo.pr_link || sourceGitInfo.pullRequestUrl
          }
        }
      }
    }

    // 2. Get conversation history from source child execution
    const sourceSteps = await this.storage.getChildWorkflowSteps(continuationOverride.sourceChildExecutionId)
    const reconstructedHistory = this.reconstructConversationFromSteps(sourceSteps)

    logger.info(`🔄 [AGENT-EXECUTOR] Reconstructed ${reconstructedHistory.length} messages from source child execution`)

    // 3. Create user message from continuation input
    const continuationMessage = createUserMessage(continuationOverride.continuationUserMessage)

    // 4. Build conversation request with history + user message
    const continuationRequest: ConversationRequest = {
      ...originalConversationRequest,
      messages: [...reconstructedHistory, continuationMessage]
    }

    logger.info(`🔄 [AGENT-EXECUTOR] Continuation request has ${continuationRequest.messages.length} messages (including user's new message)`)

    // 5. Create new child workflow execution for this continuation
    const childExecutionId = await this.storage.createChildWorkflowExecution(
      parentExecutionId,
      workflowId,
      checkpointId
    )

    // Create user message step so it shows in the UI
    await this.storage.createUserMessageStep(childExecutionId, continuationOverride.continuationUserMessage)
    logger.info(`✅ [AGENT-EXECUTOR] Created user message step for continuation: "${continuationOverride.continuationUserMessage}"`)

    try {
      // 6. Execute framework with the reconstructed history + user message
      // The modified agentChkConfig will use the same branch and checkout the commit
      const { result, gitInfo } = await this.executeFrameworkWithPauseCheck(
        parentExecutionId,
        childExecutionId,
        agentChkConfig,
        continuationRequest,
        parentState,
        true // isContinuation flag
      )

      // 7. Mark execution as completed WITH gitInfo
      const resultWithGitInfo = { ...result, gitInfo } as FrameworkExecutionResult
      await this.storage.markChildExecutionCompleted(childExecutionId, resultWithGitInfo)

      const updatedState = this.buildStateFromCompletedExecution(parentState, result as FrameworkExecutionResult)
      return { result, updatedState, gitInfo }

    } catch (error) {
      // Handle execution error
      await this.handleExecutionError(childExecutionId, error);
      throw error
    }
  }

  /**
   * Execute framework agent with pause checking on every event
   * @param parentExecutionId - Parent workflow execution ID (for workspace events)
   * @param isContinuation - If true, this is a continuation of a previous execution.
   *                         The agent will checkout the specific commit and update existing PR.
   */
  private async executeFrameworkWithPauseCheck<T extends BaseWorkflowContext>(
    parentExecutionId: string,
    childExecutionId: string,
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
    let repoPath: string | undefined;
    let branchName: string | undefined;
    let projectName: string | undefined;
    let repoName: string | undefined;

    // Clone repository if URL is provided
    // Use parentExecutionId for workspace path so all agentic steps in a workflow share the same /tmp/{parentExecutionId} directory
    let baseCommitHash: string | undefined;
    if (repoUrl) {
      // Publish cloning_started event so frontend can show "Cloning in Remote..." status
      await workspaceEventService.publishCloningStarted(parentExecutionId, childExecutionId);

      // For continuation, pass the commit hash to checkout the exact state
      // Use parentExecutionId so workspace is reused across agentic steps
      const cloneResult = await cloneRepository(
        repoUrl, 
        parentExecutionId, 
        baseBranch, 
        repoBranch,
        isContinuation ? continuationCommitHash : undefined,
        checkoutCommit
      );

      logger.info(`🔧 [AGENT-EXECUTOR] Workspace at: ${cloneResult.repoPath}`);
      logger.info(`🔧 [AGENT-EXECUTOR] Parent execution ID: ${parentExecutionId}`);
      logger.info(`🔧 [AGENT-EXECUTOR] Child execution ID: ${childExecutionId}`);
      logger.info(`🔧 [AGENT-EXECUTOR] Workspace location: /tmp/${parentExecutionId}`);
      repoPath = cloneResult.repoPath;
      branchName = cloneResult.branchName;
      baseCommitHash = cloneResult.baseCommitHash;
      const extractedData = extractWorkspace(repoUrl);
      projectName = extractedData.projectName
      repoName = extractedData.repoName
      
      if (isContinuation && continuationCommitHash) {
        logger.info(`🔄 [AGENT-EXECUTOR] Continuation: Cloned branch ${branchName} at commit ${continuationCommitHash}`)
      }

      // Publish workspace_ready event with repo info so backend can clone for cross-pod file viewing
      // Pass baseBranch so backend can clone from it (feature branch may not exist on remote yet)
      await workspaceEventService.publishWorkspaceReady(parentExecutionId, childExecutionId, repoUrl, branchName, baseBranch)
    }

    const agenticConfig = { ...agentChkConfig.agentConfig, cwd: repoPath };

    // Initialize framework agent
    const agent = Agent.create(agenticConfig);

    // Track if any commits were made during execution
    const commitTracker: AgentTracker = {
      hasCommits: false,
      branchName: branchName || '',
      repoUrl,
      childExecutionId,
      parentExecutionId,
      latestCommitHash: undefined,
      baseCommitHash,
      commitCount: 0
    }

    const abortController = new AbortController();

    // Setup event handlers with pause and cancellation checking
    const eventHandler = this.createPauseOrCancellationAwareEventHandler(childExecutionId, commitTracker, repoPath || ".", agentChkConfig, abortController)

    // Add event listener for all orchestrator events
    agent.addEventListener(eventHandler)

    // Execute conversation - will throw WorkflowPausedException if paused
    let result;
    try {
      result = await agent.execute({
        ...conversationRequest,
        systemPrompt: conversationRequest.systemPrompt
          ? conversationRequest.systemPrompt + `\n\nCurrent Dir - ${repoPath || ''} \n\n`
          : conversationRequest.systemPrompt,
        abortSignal: abortController.signal,
      })
    } catch (agentError) {
      logger.error(`Agent execution failed:`, agentError);

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
        await this.handleExecutionError(childExecutionId, agentError);
      } else {
        await this.handleExecutionError(childExecutionId, agentError);
        throw agentError;
      }
    }

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
          await this.bitbucketManager.raisePr(repoUrl, childExecutionId, baseBranch, repoBranch, projectName, repoName, ticketTitle, ticketDescription, xyneId, ticketId);
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
    if (repoPath && commitTracker.baseCommitHash && commitTracker.hasCommits) {
      let diffBaseCommit = commitTracker.baseCommitHash;
      if (baseBranch) {
        try {
          const { stdout } = await execAsync(`git merge-base HEAD origin/${baseBranch}`, { cwd: repoPath });
          diffBaseCommit = stdout.trim();
          logger.info(`[AGENT-EXECUTOR] Using merge-base: ${diffBaseCommit.substring(0, 8)} (vs ${baseBranch})`)
        } catch {
          logger.info(`[AGENT-EXECUTOR] merge-base failed, using HEAD: ${diffBaseCommit.substring(0, 8)}`)
        }
      }

      const diffResult = await this.computeGitDiff(repoPath, diffBaseCommit)
      gitDiff = diffResult.gitDiff
      diffStats = diffResult.diffStats
    }

    // Build git info from commit tracker (including cached diff)
    const gitInfo: GitInfo = {
      branch: branchName || agentChkConfig.repoInfo?.repoBranch || 'main',
      repoUrl: commitTracker.repoUrl,
      commitHash: commitTracker.latestCommitHash,
      baseCommitHash: commitTracker.baseCommitHash,
      pullRequestUrl: pushResult?.pullRequestUrl,
      pr_link: customPrLink || pushResult?.pullRequestUrl,
      gitDiff,
      diffStats
    }

    // Note: Workspace cleanup is deferred to workflow completion (in workflowRegistry)
    // This allows subsequent agentic steps to reuse the same /tmp/{parentExecutionId} workspace
    // Publish workspace_closed event to notify frontend this step is done
    if (repoPath) {
      await workspaceEventService.publishWorkspaceClosed(parentExecutionId, childExecutionId)
    }

    if (result.error) {
      // Only throw if no commits were made (i.e., the main task failed)
      if (!commitTracker.hasCommits) {
        throw new Error(result.error)
      } else {
        logger.warn(`Agent had errors but commits were made and PR was created, considering workflow successful:`, result.error);
      }
    }

    return { result, gitInfo }
  }

  /**
   * Create event handler that checks pause and cancellation status after each event
   */
  private createPauseOrCancellationAwareEventHandler(
    childExecutionId: string,
    commitTracker: AgentTracker,
    repoPath: string,
    agentChkConfig: FullAgenticCheckpointConfig,
    abortController: AbortController
  ): OrchestratorEventHandler {
    return {
      onToolCallsRequested: async (toolCalls) => {
        await this.checkWorkflowPauseOrCancelStatusAndThrow(childExecutionId, abortController)

        // Track tool calls
        for (const toolCall of toolCalls) {
          await this.storage.createToolExecutionStep(childExecutionId, {
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
        await this.checkWorkflowPauseOrCancelStatusAndThrow(childExecutionId, abortController)

        logger.info("Tool result received:", result);
        const parsed: any = JSON.parse(result.content);

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

          const commitHash = await commitAllChanges(repoPath, updatedCommitMessage);

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
                    childExecutionId,
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

        const agentStep = await this.storage.updateToolExecutionAgentStep(result.toolCallId, updateAgentData);
        const toolCallStatus = result.error ? 'failed' : (result.success ? 'completed' : 'failed');
        await this.storage.updateToolExecutionStep(agentStep.stepsId || '', parsed, toolCallStatus);
      },

      onLLMResponse: async (response) => {
        // Track LLM response
        await this.storage.createLLMCallStep(childExecutionId, {
          content: response.content,
          thinking: response.thinking,
          toolCalls: response.toolCalls,
          tokens: response.tokens
        })

        // Check pause status
        await this.checkWorkflowPauseOrCancelStatusAndThrow(childExecutionId, abortController)
      },

      onError: async (error) => {
        // Always track errors
        await this.storage.createErrorStep(childExecutionId, error)

        // Check pause status
        await this.checkWorkflowPauseOrCancelStatusAndThrow(childExecutionId, abortController)
      },

      onTurnComplete: async (turn, result) => {
        // Track turn completion
        await this.storage.createAssistantMessageStep(childExecutionId, {
          turn,
          result
        })

        // Check pause status
        await this.checkWorkflowPauseOrCancelStatusAndThrow(childExecutionId, abortController)
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
  private async checkWorkflowPauseOrCancelStatusAndThrow(childExecutionId: string, abortController: AbortController): Promise<void> {
    const pauseStatus = await this.storage.checkWorkflowPauseOrCancelStatus(childExecutionId)

    if (pauseStatus.isCancelled) {
      abortController.abort();
      throw new WorkflowCancelledException(
        pauseStatus.parentExecutionId || childExecutionId,
        'framework_step_cancelled'
      )
    }

    if (pauseStatus.isPaused) {
      // Throw WorkflowPausedException to stop framework execution
      throw new WorkflowPausedException(
        pauseStatus.parentExecutionId || childExecutionId,
        'framework_step_paused'
      )
    }
  }

  private async handleExecutionError(childExecutionId: string, error: unknown): Promise<void> {
    if (error instanceof WorkflowCancelledException) {
      await this.storage.markChildExecutionCancelled(childExecutionId, 'workflow_cancelled');
      return;
    }
    
    if (error instanceof Error && error.message === 'Execution aborted') {
      await this.storage.markChildExecutionCancelled(childExecutionId, 'execution_aborted');
      throw new WorkflowCancelledException(childExecutionId, 'framework_step_cancelled');
    }
    
    await this.storage.markChildExecutionFailed(childExecutionId, this.serializeError(error as Error));
  }

  /**
   * Reconstruct conversation history from WorkflowSteps
   */
  private reconstructConversationFromSteps(steps: Array<{ stepName?: string | null; data?: string | null; createdAt: Date }>): Message[] {
    const conversationHistory: Message[] = []

    // Sort steps by creation time
    const sortedSteps = steps.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    for (const step of sortedSteps) {
      if (!step.data) continue

      try {
        const stepData = JSON.parse(step.data)

        // Map WorkflowSteps back to framework message format
        if (step.stepName?.startsWith('tool_')) {
          // For tool executions, we'll create a tool result message
          if (stepData.output !== null) {
            const toolResultMessage = createToolResultMessage(
              JSON.stringify(stepData.output),
              stepData.id || `tool_${Date.now()}`,
              stepData.success !== false, // default to true if not specified
              {
                error: stepData.error,
                executionTime: stepData.duration
              }
            )
            conversationHistory.push(toolResultMessage)
          }

        } else if (step.stepName?.startsWith('llm_call_') || step.stepName === 'assistant_message') {
          // LLM response or assistant message
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
        // Skip malformed steps
        continue
      }
    }

    return conversationHistory
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
}
