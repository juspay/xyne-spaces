// Database-based implementation of WorkflowStorage interface

import crypto from 'crypto'
import {
  WorkflowStorage,
  FrameworkExecutionResult,
  WorkflowStepData,
  ChildWorkflowExecution
} from '../workflow-storage'
import { WorkflowState, ParallelWorkflowConfig, BaseWorkflowContext, ValidatedWorkflowTask, AgenticCheckpointConfig, AgenticCheckpointResult } from '../workflow-types'
import { WorkflowStepRepository, WorkflowExecutionRepository, ExternalStepResponseRepository, MessageAttachmentRepository } from '@/database/repositories'
import { repositories } from '@/database/repositories'
import { WorkflowExecutionStatus } from '../types/workflow-enums'
import { AttachmentEntityType } from '@prisma/client'
// import { WorkflowPausedException } from '../exceptions/workflow-exceptions' // Unused for now
import {
  DeserializationError,
  safeSerialize,
  safeDeserialize
} from './serialization'
import { STEP_TYPES } from './step-types'
import { UpdateAgentInput, WorkflowStep } from '@/types/database'
import { AgentStep } from '@prisma/client'
import { WorkflowStepStatus } from '../types/workflow-enums'
import { AgentConfig, createDefaultAgentConfig, Agent, validateAndThrow, ToolAuthorizationContext, LiteLLMConfig, VertexConfig } from 'agentic-framework'
import type { FullAgent } from '@/types/database'
import type { AgentConfigVersions } from '../workflow-types'
import { redisService } from '@/services/redisService'
import { DatabaseClient } from '@/database/client'
import { createKnowledgeCanvas, getCanvasUrl } from '@/services/canvasService'
import { config as appConfig } from '@/config/env'
import type { KnowledgeLearning } from '../utils/knowledge-generator'
// import { websocketService } from '@/services/websocketService'
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service'
import {logger} from '@/utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { buildWorkflowStepKey, WORKFLOW_KEYS_SET } from '@/workflows/utils/workflowStepKeys';
import { getStorageService } from '@/services/storage';
import { config } from '@/config/env';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';

const prisma = DatabaseClient.getInstance()
function normalizeToolName(toolName: string): string {
  const toolMappings: Record<string, string> = {
    'view': 'read',
    'todowrite': 'todo-write',
    'todoread': 'todo-read',
    'patch': 'multiedit',
    'fetch': 'bash',
  }
  
  return toolMappings[toolName] || toolName
}

// Data collected from each agentic checkpoint for consolidated knowledge generation
export interface PendingAgenticResult {
  checkpointId: string
  result: import('@framework').ConversationResult
  gitInfo: import('../workflow-types').GitInfo
}

export class DBWorkflowStorage implements WorkflowStorage {
  private workflowStepRepo: WorkflowStepRepository
  private workflowExecutionRepo: WorkflowExecutionRepository
  private externalStepResponseRepo: ExternalStepResponseRepository
  private messageAttachmentRepo: MessageAttachmentRepository
  
  // In-memory storage for pending agentic results (per execution)
  // Used for consolidated knowledge generation at workflow completion
  private pendingAgenticResults: Map<string, PendingAgenticResult[]> = new Map()

  constructor() {
    this.workflowStepRepo = repositories.workflowSteps
    this.workflowExecutionRepo = repositories.workflowExecutions
    this.externalStepResponseRepo = repositories.externalStepResponses
    this.messageAttachmentRepo = repositories.messageAttachments
  }
  
  // Add pending agentic result for a workflow execution
  addPendingAgenticResult(workflowExecutionId: string, result: PendingAgenticResult): void {
    const existing = this.pendingAgenticResults.get(workflowExecutionId) || []
    existing.push(result)
    this.pendingAgenticResults.set(workflowExecutionId, existing)
    logger.info(`💡 [STORAGE] Added pending agentic result for ${workflowExecutionId}: ${result.checkpointId}`)
  }
  
  // Get all pending agentic results for a workflow execution
  getPendingAgenticResults(workflowExecutionId: string): PendingAgenticResult[] {
    return this.pendingAgenticResults.get(workflowExecutionId) || []
  }
  
  // Clear pending agentic results after processing
  clearPendingAgenticResults(workflowExecutionId: string): void {
    this.pendingAgenticResults.delete(workflowExecutionId)
    logger.info(`🧹 [STORAGE] Cleared pending agentic results for ${workflowExecutionId}`)
  }

  // ========== Execution Mode Management (Manual/Automatic) ==========

  async getExecutionMode(workflowExecutionId: string): Promise<string> {
    const execution = await this.workflowExecutionRepo.findById(workflowExecutionId)
    return execution?.mode || 'AUTOMATIC'
  }

  async setExecutionMode(workflowExecutionId: string, mode: 'AUTOMATIC' | 'MANUAL'): Promise<void> {
    await this.workflowExecutionRepo.update(workflowExecutionId, { mode })
    logger.info(`🎛️ [STORAGE] Set execution mode for ${workflowExecutionId} to: ${mode}`)
  }

  // Helper method to create workflow step and emit real-time event
  private async createStepAndNotify(
    workflowExecutionId: string,
    data: Parameters<WorkflowStepRepository['create']>[0]
  ): Promise<WorkflowStep> {
    const createdStep = await this.workflowStepRepo.create(data)
    // Get parent execution ID if this is a child execution
    // Frontend subscribes to parent execution ID, so we need to broadcast to both
    let parentExecutionId: string | null = null
    try {
      const execution = await this.workflowExecutionRepo.findById(workflowExecutionId)
      parentExecutionId = execution?.parentWorkflowExecutionId || null
    } catch (error) {
      logger.error(`❌ [DB-STORAGE] Failed to get parent execution ID:`, error)
    }

    const eventData = {
      type: 'step_added' as const,
      executionId: workflowExecutionId,
      data: {
        stepId: createdStep.id,
        stepName: createdStep.stepName,
        type: createdStep.type,  // 'input' | 'output' - matches frontend WorkflowStepAddedEvent
        stepExecutorType: createdStep.stepExecutorType
      },
      timestamp: new Date()
    }
    
    // Emit real-time event to subscribers via Redis pub/sub (fire-and-forget)
    // This works from both API server and worker processes
    // Broadcast to current execution ID
    redisService.broadcastWorkflowEvent(workflowExecutionId, eventData).catch((error) => {
      logger.error(`❌ [DB-STORAGE] Failed to broadcast workflow step event:`, error)
    })
    
    // Also broadcast to parent execution ID if this is a child execution
    // This ensures frontend subscribed to parent ID receives child step updates
    if (parentExecutionId) {
      redisService.broadcastWorkflowEvent(parentExecutionId, {
        ...eventData,
        executionId: parentExecutionId,  // Update executionId to match the channel
        data: {
          ...eventData.data,
          childExecutionId: workflowExecutionId  // Include child ID for context
        }
      }).catch((error) => {
        logger.error(`❌ [DB-STORAGE] Failed to broadcast to parent execution:`, error)
      })
    }


    return createdStep
  }

  /**
   * Ensures aggregate WorkflowStep exists for agentic steps with per-step Redis storage.
   * Uses inputStepDbId to link to existing INPUT step and creates MessageAttachment.
   * This is the new method for agentic checkpoints that don't create child executions.
   */
  private async ensureAggregateWorkflowStepWithInputStep(
    workflowExecutionId: string,
    inputStepDbId: string,
    stepName: string,
    stepData: {
      stepId: string;
      stepName: string;
      type: 'input' | 'output';
      data: string;
      status: string;
      stepExecutorType: string;
    }
  ): Promise<string> {
    const now = new Date();

    // For agentic steps, use per-step Redis key format: workflow:{executionId}:{stepName}
    const redisKey = buildWorkflowStepKey(workflowExecutionId, stepName);

    // Check if Redis key exists
    const redisExists = await redisService.exists(redisKey);

    if (redisExists) {
      // Already exists, store step data in Redis and broadcast
      const redisStepData = { ...stepData, createdAt: now, updatedAt: now };
      await redisService.rpush(redisKey, JSON.stringify(redisStepData));
      await this.broadcastAgentStepEvent(workflowExecutionId, redisStepData);
      await redisService.expire(redisKey, 18000);
      return inputStepDbId;
    }

    // Need to create - use lock to prevent race condition
    const lockKey = `lock:workflow:${workflowExecutionId}:${stepName}`;
    const lockAcquired = await redisService.set(lockKey, '1', 10, true);

    if (!lockAcquired) {
      // Another process is creating, wait and retry
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.ensureAggregateWorkflowStepWithInputStep(workflowExecutionId, inputStepDbId, stepName, stepData);
    }

    try {
      // Double-check after acquiring lock
      const redisExistsAfterLock = await redisService.exists(redisKey);
      if (redisExistsAfterLock) {
        return this.ensureAggregateWorkflowStepWithInputStep(workflowExecutionId, inputStepDbId, stepName, stepData);
      }

      // AGENTIC STEP: Create MessageAttachment entry ONCE
      const gcsPath = `workflows/${workflowExecutionId}/${stepName}.json`;
      const gcsUrl = getStorageService(config.gcs.workflowStepsBucketName).buildStorageUri(gcsPath);

      // Check if MessageAttachment already exists for this step
      const existingAttachments = await this.messageAttachmentRepo.findByEntityIdAndType(
        inputStepDbId,
        AttachmentEntityType.WORKFLOW_STEPS
      );

      if (existingAttachments.length === 0) {
        // Create MessageAttachment entry linking to the existing INPUT step
        await this.messageAttachmentRepo.create({
          entityType: AttachmentEntityType.WORKFLOW_STEPS,
          entityId: inputStepDbId,
          storageProvider: 'gcs',
          url: gcsUrl,
          originalFilename: `${stepName}.json`,
          mimetype: 'application/json',
          size: Buffer.byteLength(stepData.data, 'utf-8'),
          uploadedByUserId: 'system',
          createdBy: 'system',
          conversationId: null,
          workspaceId: config.defaultWorkspaceId,
          metadata: {
            workflowExecutionId,
            checkpointId: stepName,
            workflowStepId: inputStepDbId
          }
        });
        logger.info(`[DB-STORAGE] Created MessageAttachment for agentic step ${stepName}`);
      }

      // Add the key to the global workflow keys set for tracking
      await redisService.sadd(WORKFLOW_KEYS_SET, redisKey);

      // Initialize Redis key with 5-hour TTL
      const redisStepData = { ...stepData, createdAt: now, updatedAt: now };
      await redisService.rpush(redisKey, JSON.stringify(redisStepData));
      await redisService.expire(redisKey, 18000);

      // Broadcast event
      await this.broadcastAgentStepEvent(workflowExecutionId, redisStepData);

      return inputStepDbId;
    } finally {
      // Release the lock
      await redisService.del(lockKey);
    }
  }

  /**
   * Broadcast agent step event for real-time UI updates
   * (Same pattern as createStepAndNotify)
   */
  private async broadcastAgentStepEvent(
    workflowExecutionId: string,
    stepData: {
      stepId: string;
      stepName: string | null;
      type: string | null;
      stepExecutorType: string | null;
      createdAt?: Date;
      updatedAt?: Date;
    }
  ): Promise<void> {
    // Get parent execution ID if this is a child execution
    let parentExecutionId: string | null = null;
    try {
      const execution = await this.workflowExecutionRepo.findById(workflowExecutionId);
      parentExecutionId = execution?.parentWorkflowExecutionId || null;
    } catch (error) {
      logger.error(`❌ [DB-STORAGE] Failed to get parent execution ID:`, error);
    }

    const eventData = {
      type: 'step_added' as const,
      executionId: workflowExecutionId,
      data: {
        stepId: stepData.stepId,
        stepName: stepData.stepName,
        type: stepData.type,
        stepExecutorType: stepData.stepExecutorType || undefined
      },
      timestamp: new Date()
    };

    // Broadcast to websocket
    redisService.broadcastWorkflowEvent(workflowExecutionId, eventData).catch((error) => {
      logger.error(`❌ [DB-STORAGE] Failed to broadcast workflow step event:`, error);
    });

    if (parentExecutionId) {
      redisService.broadcastWorkflowEvent(parentExecutionId, {
        ...eventData,
        executionId: parentExecutionId,
        data: { ...eventData.data, childExecutionId: workflowExecutionId }
      }).catch((error) => {
        logger.error(`❌ [DB-STORAGE] Failed to broadcast to parent execution:`, error);
      });
    }

    // Update conversation progress
    // try {
    //   await this.updateConversationMessageWithProgress(workflowExecutionId);
    // } catch (error) {
    //   logger.error(`[WorkflowStorage] Failed to update conversation message for ${workflowExecutionId}:`, error);
    // }
  }


  // Context and output storage (NEW)
  async saveInitialContext<TContext extends BaseWorkflowContext>(
    workflowExecutionId: string,
    context: TContext
  ): Promise<void> {
    try {
      const execution = await this.workflowExecutionRepo.findById(workflowExecutionId)
      if (!execution) {
        throw new Error(`Execution not found: ${workflowExecutionId}`)
      }

      // Store context in Workflow.context (shared by all executions of same workflow)
      await repositories.workflows.update(execution.workflowId, {
        context: safeSerialize(context)
      })
    } catch (error) {
      throw new Error(
        `Failed to save initial context for ${workflowExecutionId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async loadInitialContext<TContext extends BaseWorkflowContext>(
    workflowExecutionId: string
  ): Promise<TContext | null> {
    try {
      const execution = await this.workflowExecutionRepo.findById(workflowExecutionId)
      if (!execution) {
        return null
      }

      // For child executions, context is stored in WorkflowExecution table
      if (execution.context) {
        return safeDeserialize<TContext>(execution.context)
      }

      // For parent executions, context is in Workflow table
      const workflow = await repositories.workflows.findById(execution.workflowId)
      if (!workflow || !workflow.context) {
        return null
      }

      return safeDeserialize<TContext>(workflow.context)
    } catch (error) {
      if (error instanceof DeserializationError) {
        logger.error(`Failed to deserialize initial context for ${workflowExecutionId}:`, error)
        return null
      }
      throw error
    }
  }

  async saveWorkflowOutput<TOutput>(
    workflowExecutionId: string,
    output: TOutput
  ): Promise<void> {
    try {
      await this.workflowExecutionRepo.update(workflowExecutionId, {
        output: safeSerialize(output)
      })
    } catch (error) {
      throw new Error(
        `Failed to save workflow output for ${workflowExecutionId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async loadWorkflowOutput<TOutput>(
    workflowExecutionId: string
  ): Promise<TOutput | null> {
    try {
      const execution = await this.workflowExecutionRepo.findById(workflowExecutionId)
      if (!execution || !execution.output) {
        return null
      }

      return safeDeserialize<TOutput>(execution.output)
    } catch (error) {
      if (error instanceof DeserializationError) {
        logger.error(`Failed to deserialize workflow output for ${workflowExecutionId}:`, error)
        return null
      }
      throw error
    }
  }

  // New step-centric storage methods
  async saveStepInput<Args extends unknown[]>(
    workflowExecutionId: string,
    stepId: string,
    args: Args,
    lookupParentIfInheriting?: boolean
  ): Promise<string | null> {
    try {
      await this.ensureWorkflowExecution(workflowExecutionId)

      // If lookupParentIfInheriting flag is true, search parent chain for INPUT
      // This is used during restore to get parent's INPUT DB ID without creating duplicates
      if (lookupParentIfInheriting) {
        const chain = await this.getParentChain(workflowExecutionId)

        for (const executionId of chain) {
          const inputSteps = await this.workflowStepRepo.findMany({
            where: {
              stepName: stepId,
              type: 'input',
              workflowExecutionId: executionId
            }
          })

          if (inputSteps.length > 0) {
            // Found INPUT in parent chain, return its DB ID for matching
            return inputSteps[0].id
          }
        }

        // Not found in parent chain, return null
        return null
      }

      // Normal flow: check if input exists in current execution
      const inputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: stepId,
          type: 'input',
          workflowExecutionId: workflowExecutionId
        }
      })

      if (inputSteps.length > 0) {
        // Input already exists, return its DB ID
        return inputSteps[0].id
      }

      // Create input step and return its DB ID
      const createdStep = await this.createStepAndNotify(workflowExecutionId, {
        workflowExecution: { connect: { id: workflowExecutionId } },
        stepExecutorType: STEP_TYPES.DETERMINISTIC,
        stepName: stepId,
        type: 'input',
        data: safeSerialize(args)
      })

      return createdStep.id
    } catch (error) {
      throw new Error(
        `Failed to save step input for ${workflowExecutionId}:${stepId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async saveStepOutput<R>(
    workflowExecutionId: string,
    stepId: string,
    result: R
  ): Promise<void> {
    try {
      await this.ensureWorkflowExecution(workflowExecutionId)

      await this.createStepAndNotify(workflowExecutionId, {
        workflowExecution: { connect: { id: workflowExecutionId } },
        stepExecutorType: STEP_TYPES.DETERMINISTIC,
        stepName: stepId,
        type: 'output',
        data: safeSerialize(result)
      })
    } catch (error) {
      throw new Error(
        `Failed to save step output for ${workflowExecutionId}:${stepId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async loadStepOutput<R>(
    workflowExecutionId: string,
    stepId: string
  ): Promise<R | null> {
    try {
      const outputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: stepId,
          type: 'output',
          workflowExecutionId: workflowExecutionId
        },
        orderBy: {
          createdAt: 'desc'
        }
      })

      if (outputSteps.length === 0 || !outputSteps[0].data) {
        return null
      }

      return safeDeserialize<R>(outputSteps[0].data)
    } catch (error) {
      if (error instanceof DeserializationError) {
        logger.error(`Failed to deserialize step output for ${workflowExecutionId}:${stepId}:`, error)
        return null
      }
      throw error
    }
  }

  async isCheckpointCompleted(workflowExecutionId: string, checkpointId: string): Promise<boolean> {
    try {
      const outputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: checkpointId,
          type: 'output',
          workflowExecutionId: workflowExecutionId
        }
      })
      return outputSteps.length > 0 && outputSteps[0].data !== null
    } catch (error) {
      // Returning false on a transient DB error re-runs a checkpoint that may
      // already have completed — worth knowing about.
      logger.error('checkpoint_output_check_failed', { workflowExecutionId, checkpointId, error })
      return false
    }
  }

  async saveCheckpointInputIfNotExists<TContext extends BaseWorkflowContext>(workflowExecutionId: string, checkpointId: string, _state: WorkflowState<TContext>, parentStepId?: string): Promise<void> {
    try {
      const inputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: checkpointId,
          type: 'input',
          workflowExecutionId: workflowExecutionId
        }
      })

      if (inputSteps.length > 0) {
        return
      }

      await this.ensureWorkflowExecution(workflowExecutionId)

      await this.createStepAndNotify(workflowExecutionId, {
        workflowExecution: { connect: { id: workflowExecutionId } },
        stepExecutorType: STEP_TYPES.DETERMINISTIC,
        stepName: checkpointId,
        type: 'input',
        data: safeSerialize(null),
        previousStepId: parentStepId,
        status: WorkflowStepStatus.PENDING
      })
    } catch (error) {
      throw new Error(
        `Failed to save checkpoint input for ${workflowExecutionId}:${checkpointId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async saveCheckpointState<TContext extends BaseWorkflowContext>(
    workflowExecutionId: string,
    checkpointId: string,
    _state: WorkflowState<TContext>,
    parentStepId?: string
  ): Promise<void> {
    try {
      await this.ensureWorkflowExecution(workflowExecutionId)

      await this.createStepAndNotify(workflowExecutionId, {
        workflowExecution: { connect: { id: workflowExecutionId } },
        stepExecutorType: STEP_TYPES.DETERMINISTIC,
        stepName: checkpointId,
        type: 'output',
        data: safeSerialize(null),
        previousStepId: parentStepId,
        status: WorkflowStepStatus.COMPLETED
      })
    } catch (error) {
      throw new Error(
        `Failed to save checkpoint state for ${workflowExecutionId}:${checkpointId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async loadCheckpointState<TContext extends BaseWorkflowContext>(workflowExecutionId: string, checkpointId: string): Promise<WorkflowState<TContext> | null> {
    try {
      const outputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: checkpointId,
          type: 'output', 
          workflowExecutionId: workflowExecutionId
        },
        orderBy: {
          createdAt: 'desc'
        }
      })

      if (outputSteps.length === 0 || !outputSteps[0].data) {
        return null
      }

      // Get workflowId from execution
      const execution = await this.workflowExecutionRepo.findById(workflowExecutionId)
      if (!execution) {
        throw new Error(`Workflow execution not found: ${workflowExecutionId}`)
      }

      // Load context from workflow
      const context = await this.loadInitialContext<TContext>(workflowExecutionId)

      return {
        workflowId: execution.workflowId,
        workflowExecutionId,
        context: context || ({} as TContext)
      }
    } catch (error) {
      if (error instanceof DeserializationError) {
        logger.error(`Failed to deserialize checkpoint state for ${workflowExecutionId}:${checkpointId}:`, error)
        return null
      }
      throw error
    }
  }

  async isAgenticCheckpointCompleted(workflowId: string, checkpointId: string): Promise<boolean> {
    try {
      // Find output step with this stepName and type='output' and stepExecutorType='agent'
      const outputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: checkpointId,
          type: 'output',
          stepExecutorType: STEP_TYPES.AGENT,
          workflowExecutionId: workflowId
        }
      })
      return outputSteps.length > 0 && outputSteps[0].data !== null
    } catch (error) {
      logger.error(`Error checking agentic checkpoint completion for ${workflowId}:${checkpointId}:`, error)
      return false
    }
  }

  async saveAgenticCheckpointInputIfNotExists(workflowExecutionId: string, checkpointId: string, config: AgenticCheckpointConfig, parentStepId?: string, lookupParentIfInheriting?: boolean): Promise<string | null> {
    try {
      // If lookupParentIfInheriting flag is true, search parent chain for INPUT
      if (lookupParentIfInheriting) {
        const chain = await this.getParentChain(workflowExecutionId)

        for (const executionId of chain) {
          const inputSteps = await this.workflowStepRepo.findMany({
            where: {
              stepName: checkpointId,
              type: 'input',
              stepExecutorType: STEP_TYPES.AGENT,
              workflowExecutionId: executionId
            }
          })

          if (inputSteps.length > 0) {
            // Found INPUT in parent chain, return its DB ID for matching
            return inputSteps[0].id
          }
        }

        // Not found in parent chain, return null
        return null
      }

      // Check if input step already exists in current execution
      const inputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: checkpointId,
          type: 'input',
          stepExecutorType: STEP_TYPES.AGENT,
          workflowExecutionId: workflowExecutionId
        }
      })

      if (inputSteps.length > 0) {
        // Input already exists, return its DB ID
        return inputSteps[0].id
      }

      await this.ensureWorkflowExecution(workflowExecutionId)

      // Create input step and return its DB ID
      // Input step starts as RUNNING (not PENDING) since it's actively being processed
      const createdStep = await this.createStepAndNotify(workflowExecutionId, {
        workflowExecution: { connect: { id: workflowExecutionId } },
        stepExecutorType: STEP_TYPES.AGENT,
        stepName: checkpointId,
        type: 'input',
        data: safeSerialize(config),
        previousStepId: parentStepId,
        status: WorkflowStepStatus.RUNNING
      })

      // If there's an initialUserMessage, store it as a user_message step in Redis/GCS
      // This ensures it's automatically included in conversation history reconstruction
      if (config.conversationContext?.initialUserMessage) {
        const stepId = uuidv4();
        const userMessageData = safeSerialize({
          content: config.conversationContext.initialUserMessage,
          role: 'user'
        });

        // Store in Redis/GCS using the same pattern as createUserMessageStep
        // This stores it with stepName='user_message' so it's reconstructed as a user message
        await this.ensureAggregateWorkflowStepWithInputStep(
          workflowExecutionId,
          createdStep.id,
          checkpointId,
          {
            stepId,
            stepName: 'user_message',
            type: 'input',
            data: userMessageData,
            status: 'completed',
            stepExecutorType: STEP_TYPES.AGENT
          }
        );

        logger.info(`[DB-STORAGE] Stored initialUserMessage as user_message step for ${workflowExecutionId}:${checkpointId}`);
      }

      return createdStep.id
    } catch (error) {
      throw new Error(
        `Failed to save agentic checkpoint input for ${workflowExecutionId}:${checkpointId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async saveAgenticCheckpointState(workflowExecutionId: string, checkpointId: string, output: AgenticCheckpointResult, parentStepId?: string): Promise<void> {
    try {
      await this.ensureWorkflowExecution(workflowExecutionId)

      // Update INPUT step status to COMPLETED
      const inputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: checkpointId,
          type: 'input',
          stepExecutorType: STEP_TYPES.AGENT,
          workflowExecutionId: workflowExecutionId
        }
      })

      if (inputSteps.length > 0) {
        await this.workflowStepRepo.updateStepStatus(inputSteps[0].id, WorkflowStepStatus.COMPLETED)
        logger.info(`[DB-STORAGE] Updated INPUT step ${checkpointId} to COMPLETED`)
      }

      // Create output step
      await this.createStepAndNotify(workflowExecutionId, {
        workflowExecution: { connect: { id: workflowExecutionId } },
        stepExecutorType: STEP_TYPES.AGENT,
        stepName: checkpointId,
        type: 'output',
        data: safeSerialize(output),
        previousStepId: parentStepId,
        status: WorkflowStepStatus.COMPLETED,
      })
    } catch (error) {
      throw new Error(
        `Failed to save agentic checkpoint state for ${workflowExecutionId}:${checkpointId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }


  async loadAgenticCheckpointState(workflowExecutionId: string, checkpointId: string): Promise<AgenticCheckpointResult> {
    try {
      const outputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: checkpointId,
          type: 'output',
          stepExecutorType: STEP_TYPES.AGENT,
          workflowExecutionId: workflowExecutionId
        },
        orderBy: {
          createdAt: 'desc'
        }
      })

      if (outputSteps.length === 0 || !outputSteps[0].data) {
        throw new Error("Output steps not found")
      }

      return safeDeserialize(outputSteps[0].data) as unknown as  AgenticCheckpointResult

    } catch (error) {
      if (error instanceof DeserializationError) {
        logger.error(`Failed to deserialize agentic checkpoint state for ${workflowExecutionId}:${checkpointId}:`, error)
      }
      throw error
    }
  }

  async saveConditionalInputIfNotExists<Args extends unknown[]>(workflowExecutionId: string, conditionalId: string, args: Args, parentStepId?: string, lookupParentIfInheriting?: boolean): Promise<string | null> {
    try {
      // If lookupParentIfInheriting flag is true, search parent chain for INPUT
      if (lookupParentIfInheriting) {
        const chain = await this.getParentChain(workflowExecutionId)

        for (const executionId of chain) {
          const inputSteps = await this.workflowStepRepo.findMany({
            where: {
              stepName: conditionalId,
              type: 'input',
              workflowExecutionId: executionId
            }
          })

          if (inputSteps.length > 0) {
            // Found INPUT in parent chain, return its DB ID for matching
            return inputSteps[0].id
          }
        }

        // Not found in parent chain, return null
        return null
      }

      // Check if input step already exists in current execution
      const inputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: conditionalId,
          type: 'input',
          workflowExecutionId: workflowExecutionId
        }
      })

      if (inputSteps.length > 0) {
        // Input already exists, return its DB ID
        return inputSteps[0].id
      }

      await this.ensureWorkflowExecution(workflowExecutionId)

      // Create input step and return its DB ID
      const createdStep = await this.createStepAndNotify(workflowExecutionId, {
        workflowExecution: { connect: { id: workflowExecutionId } },
        stepExecutorType: STEP_TYPES.CONDITIONAL,
        stepName: conditionalId,
        type: 'input',
        data: safeSerialize(args),
        previousStepId: parentStepId,
        status: WorkflowStepStatus.PENDING
      })

      return createdStep.id
    } catch (error) {
      throw new Error(
        `Failed to save conditional input for ${workflowExecutionId}:${conditionalId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async saveConditionalResult(workflowExecutionId: string, conditionalId: string, result: boolean): Promise<void> {
    try {
      await this.ensureWorkflowExecution(workflowExecutionId)

      // Create output step with boolean result
      await this.createStepAndNotify(workflowExecutionId, {
        workflowExecution: { connect: { id: workflowExecutionId } },
        stepExecutorType: STEP_TYPES.CONDITIONAL,
        stepName: conditionalId,
        type: 'output',
        data: safeSerialize(result),
        status: WorkflowStepStatus.COMPLETED
      })
    } catch (error) {
      throw new Error(
        `Failed to save conditional result for ${workflowExecutionId}:${conditionalId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async loadConditionalResult(workflowExecutionId: string, conditionalId: string): Promise<boolean | null> {
    try {
      const outputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: conditionalId,
          type: 'output',
           workflowExecutionId: workflowExecutionId
        },
        orderBy: {
          createdAt: 'desc'
        }
      })

      if (outputSteps.length === 0 || !outputSteps[0].data) {
        return null
      }

      // Directly deserialize boolean result
      const result = safeDeserialize<boolean>(outputSteps[0].data)
      return result
    } catch (error) {
      if (error instanceof DeserializationError) {
        logger.error(`Failed to deserialize conditional result for ${workflowExecutionId}:${conditionalId}:`, error)
        return null
      }
      throw error
    }
  }

  async saveExternalStepInputIfNotExists(workflowExecutionId: string, stepId: string, data: unknown, stepSubType?: string, parentStepId?: string, lookupParentIfInheriting?: boolean): Promise<WorkflowStep | null> {
    try {
      // If lookupParentIfInheriting flag is true, search parent chain for INPUT
      if (lookupParentIfInheriting) {
        const chain = await this.getParentChain(workflowExecutionId)

        for (const executionId of chain) {
          const inputSteps = await this.workflowStepRepo.findMany({
            where: {
              stepName: stepId,
              type: 'input',
              workflowExecutionId: executionId
            }
          })

          if (inputSteps.length > 0) {
            // Found INPUT in parent chain, return its DB ID for matching
            return inputSteps[0]
          }
        }

        // Not found in parent chain, return null
        return null
      }

      // Check if input step already exists in current execution
      const inputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: stepId,
          type: 'input',
          workflowExecutionId: workflowExecutionId
        }
      })

      if (inputSteps.length > 0) {
        return inputSteps[0]
      }

      await this.ensureWorkflowExecution(workflowExecutionId)

      // Create input step and return its DB ID
      const createdStep = await this.createStepAndNotify(workflowExecutionId, {
        workflowExecution: { connect: { id: workflowExecutionId } },
        stepExecutorType: STEP_TYPES.EXTERNAL,
        stepSubType: stepSubType,
        stepName: stepId,
        type: 'input',
        data: safeSerialize(data),
        previousStepId: parentStepId,
      })

      if (stepSubType === 'user_approval') {
        try {
          await this.sendApprovalNudgeMessage(workflowExecutionId, stepId, data)
        } catch (error) {
          logger.error(`[DB-STORAGE] Failed to send approval nudge message:`, error)
        }
      }

      return createdStep
    } catch (error) {
      throw new Error(
        `Failed to save external step input for ${workflowExecutionId}:${stepId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async saveExternalStepData<R>(workflowExecutionId: string, stepId: string, data: R, timeToIgnore?: number): Promise<void> {
    try {
      await this.ensureWorkflowExecution(workflowExecutionId)

      // Create output step with external data
      await this.createStepAndNotify(workflowExecutionId, {
        workflowExecution: { connect: { id: workflowExecutionId } },
        stepExecutorType: STEP_TYPES.EXTERNAL,
        stepName: stepId,
        type: 'output',
        data: safeSerialize(data),
        status: WorkflowStepStatus.COMPLETED
      })

      if (timeToIgnore) {
        await repositories.workflowExecutions.update(workflowExecutionId, {
          ignoreDuration: {
            increment: timeToIgnore
          }
        })
      }

    } catch (error) {
      throw new Error(
        `Failed to save external step data for ${workflowExecutionId}:${stepId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async updateExternalStepRequestHandlerFlag(workflowExecutionId: string, stepId: string, updatedData: unknown): Promise<void> {
    try {
      // Find the input step for this external step
      const inputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: stepId,
          type: 'input',
          workflowExecutionId: workflowExecutionId
        }
      })

      if (inputSteps.length === 0) {
        throw new Error(`No input step found for external step ${stepId} in workflow ${workflowExecutionId}`)
      }

      // Update the input step's data with the requestHandlerExecuted flag
      await this.workflowStepRepo.update(inputSteps[0].id, {
        data: safeSerialize(updatedData)
      })

      logger.info(`External step requestHandler flag updated for ${stepId}`)
    } catch (error) {
      throw new Error(
        `Failed to update external step requestHandler flag for ${workflowExecutionId}:${stepId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async getExternalStepData<R>(workflowExecutionId: string, stepId: string): Promise<R | null> {
    try {
      const outputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: stepId,
          type: 'output',
          workflowExecutionId: workflowExecutionId
        },
        orderBy: {
          createdAt: 'desc'
        }
      })

      if (outputSteps.length > 0 && outputSteps[0].data) {
        const output = safeDeserialize<R>(outputSteps[0].data)
        return output
      }

      return null
    } catch (error) {
      if (error instanceof DeserializationError) {
        logger.error(`Failed to get external step data for ${workflowExecutionId}:${stepId}:`, error)
        return null
      }
      throw error
    }
  }

  async getExternalStepRawResponse(workflowExecutionId: string, stepId: string): Promise<string | null> {
    try {
      const inputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: stepId,
          type: 'input',
          workflowExecutionId: workflowExecutionId
        },
        orderBy: {
          createdAt: 'desc'
        }
      })

      if (inputSteps.length > 0) {
        const workflowStepId = inputSteps[0].id
        const externalResponse = await this.externalStepResponseRepo.findByWorkflowStepId(workflowStepId)

        if (externalResponse) {
          return externalResponse.rawResponse
        }
      }

      return null
    } catch (error) {
      logger.error(`Failed to get external step raw response for ${workflowExecutionId}:${stepId}:`, error)
      return null
    }
  }

  async saveWhileLoopInputIfNotExists(workflowExecutionId: string, loopId: string, maxIterations: number, parentStepId?: string): Promise<string> {
    try {
      // Check if input step already exists
      const inputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: loopId,
          type: 'input',
          workflowExecutionId: workflowExecutionId
        }
      })

      if (inputSteps.length > 0) {
        return inputSteps[0].id
      }

      await this.ensureWorkflowExecution(workflowExecutionId)

      // Create input step with loop config AND initial state
      // This step will be updated to track mutable loop state during execution
      const step = await this.createStepAndNotify(workflowExecutionId, {
        workflowExecution: { connect: { id: workflowExecutionId } },
        stepExecutorType: STEP_TYPES.LOOPS,
        stepName: loopId,
        type: 'input',
        data: safeSerialize({
          maxIterations,
          currentIteration: 0,
          status: 'running',
          startedAt: new Date().toISOString()
        }),
        previousStepId: parentStepId,
        status: WorkflowStepStatus.RUNNING,
      })
      return step.id
    } catch (error) {
      throw new Error(
        `Failed to save while loop input for ${workflowExecutionId}:${loopId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }


  async getLoopState(workflowId: string, loopId: string): Promise<{currentIteration: number, status: string} | null> {
    try {
      // Read loop state from INPUT step (mutable state tracking)
      const inputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: loopId,
          type: 'input',
          workflowExecutionId: workflowId
        },
        orderBy: {
          createdAt: 'desc'
        }
      })

      if (inputSteps.length === 0 || !inputSteps[0].data) {
        return null
      }

      const input = safeDeserialize<{
        currentIteration: number
        status: string
      }>(inputSteps[0].data)

      return {
        currentIteration: input.currentIteration,
        status: input.status
      }
    } catch (error) {
      if (error instanceof DeserializationError) {
        logger.error(`Failed to get loop state for ${workflowId}:${loopId}:`, error)
        return null
      }
      throw error
    }
  }

  async updateLoopState(workflowExecutionId: string, loopId: string, iteration: number, status: string): Promise<void> {
    try {
      await this.ensureWorkflowExecution(workflowExecutionId)

      // Update INPUT step (mutable state tracking)
      const inputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: loopId,
          type: 'input',
          workflowExecutionId: workflowExecutionId
        },
        orderBy: {
          createdAt: 'desc'
        }
      })

      if (inputSteps.length === 0) {
        throw new Error(`Loop input step not found for ${workflowExecutionId}:${loopId}`)
      }

      // Deserialize current state to preserve config
      let currentInput: {
        maxIterations: number
        currentIteration: number
        status: string
        startedAt: string
      }

      if (inputSteps[0].data) {
        currentInput = safeDeserialize(inputSteps[0].data)
      } else {
        throw new Error(`Loop input step has no data for ${workflowExecutionId}:${loopId}`)
      }

      // Update only the mutable fields (preserve maxIterations and startedAt)
      const updatedInput = {
        ...currentInput,
        currentIteration: iteration,
        status,
      }

      await this.workflowStepRepo.update(inputSteps[0].id, {
        data: safeSerialize(updatedInput),
        status: status === 'completed' ? WorkflowStepStatus.COMPLETED : WorkflowStepStatus.RUNNING
      })
    } catch (error) {
      throw new Error(
        `Failed to update loop state for ${workflowExecutionId}:${loopId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async saveWhileLoopOutput(
    workflowExecutionId: string,
    loopId: string,
    finalIteration: number,
    completionReason: 'break' | 'max_iterations'
  ): Promise<void> {
    try {
      await this.ensureWorkflowExecution(workflowExecutionId)

      // Create OUTPUT step with final loop result (written once, immutable)
      await this.createStepAndNotify(workflowExecutionId, {
        workflowExecution: { connect: { id: workflowExecutionId } },
        stepExecutorType: STEP_TYPES.LOOPS,
        stepName: loopId,
        type: 'output',
        data: safeSerialize({
          totalIterations: finalIteration + 1, // 0-indexed to 1-indexed
          finalIteration,
          completionReason,
          status: 'completed',
          completedAt: new Date().toISOString()
        }),
        status: WorkflowStepStatus.COMPLETED
      })
    } catch (error) {
      throw new Error(
        `Failed to save while loop output for ${workflowExecutionId}:${loopId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  // Framework child workflow methods

  async findExistingChildExecution(parentExecutionId: string, checkpointId: string): Promise<ChildWorkflowExecution | null> {
    try {
      const childExecutions = await this.workflowExecutionRepo.findMany({
        where: {
          parentWorkflowExecutionId: parentExecutionId,
          sourceStepsId: checkpointId
        }
      })

      if (childExecutions.length === 0) {
        return null
      }

      const childExecution = childExecutions[0]
      return {
        id: childExecution.id,
        status: childExecution.status,
        parentWorkflowExecutionId: childExecution.parentWorkflowExecutionId,
        sourceStepsId: childExecution.sourceStepsId
      }
    } catch (error) {
      logger.error(`Error finding child execution for parent ${parentExecutionId}, checkpoint ${checkpointId}:`, error)
      return null
    }
  }

  async createChildWorkflowExecution(parentExecutionId: string, workflowId: string, checkpointId: string): Promise<string> {
    try {
      const childExecution = await this.workflowExecutionRepo.create({
        workflow: { connect: { id: workflowId } },
        parentWorkflowExecution: { connect: { id: parentExecutionId } },
        sourceStepsId: checkpointId,
        status: WorkflowExecutionStatus.RUNNING,
        tag: 'child'
      })

      return childExecution.id
    } catch (error) {
      throw new Error(`Failed to create child workflow execution: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async getChildWorkflowSteps(childExecutionId: string): Promise<WorkflowStepData[]> {
    try {
      const steps = await this.workflowStepRepo.findByWorkflowExecutionId(childExecutionId)

      return steps.map(step => ({
        stepName: step.stepName,
        data: step.data,
        createdAt: step.createdAt
      }))
    } catch (error) {
      logger.error(`Error getting child workflow steps for ${childExecutionId}:`, error)
      return []
    }
  }

  async getParentExecutionInputStepId(workflowExecutionId: string, stepName: string): Promise<string | null> {
    try {
      const executionInfo = await this.getExecutionInfo(workflowExecutionId)
      if (!executionInfo) return null

      const parentExecutionId = executionInfo.parentExecutionId
      if (!parentExecutionId) return null

      const parentSteps = await this.getChildWorkflowStepsWithDetails(parentExecutionId)
      const matchingStep = parentSteps.find(s => s.stepName === stepName && s.type === 'input')

      if (matchingStep) return matchingStep.id
      return null
    } catch (error) {
      logger.error(`Error getting parent execution input step ID for ${workflowExecutionId}:${stepName}:`, error)
      return null
    }
  }

  async getChildWorkflowStepsWithDetails(childExecutionId: string): Promise<Array<{id: string, stepName: string | null, type: string | null, data: string | null, createdAt: Date}>> {
    try {
      const steps = await this.workflowStepRepo.findByWorkflowExecutionId(childExecutionId)

      return steps.map(step => ({
        id: step.id,
        stepName: step.stepName,
        type: step.type,
        data: step.data,
        createdAt: step.createdAt
      }))
    } catch (error) {
      logger.error(`Error getting child workflow steps with details for ${childExecutionId}:`, error)
      return []
    }
  }

  async getCompletedExecutionResult(childExecutionId: string): Promise<FrameworkExecutionResult | null> {
    try {
      const steps = await this.workflowStepRepo.findByWorkflowExecutionId(childExecutionId)

      // Find the final result step
      const resultStep = steps
        .filter(step => step.stepName === 'final_result')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]

      if (resultStep?.data) {
        return JSON.parse(resultStep.data) as FrameworkExecutionResult
      }

      return null
    } catch (error) {
      logger.error(`Error getting completed execution result for ${childExecutionId}:`, error)
      return null
    }
  }

  async markChildExecutionCompleted(childExecutionId: string, result: FrameworkExecutionResult): Promise<void> {
    try {
      // Update execution status AND save output (includes gitInfo for agentic checkpoints)
      await this.workflowExecutionRepo.update(childExecutionId, {
        status: WorkflowExecutionStatus.SUCCESS,
        output: safeSerialize(result)  // Save the full result including gitInfo
      })

       // Save final result as a workflow step
      await this.createStepAndNotify(childExecutionId, {
        workflowExecution: { connect: { id: childExecutionId } },
        stepExecutorType: STEP_TYPES.AGENT,
        stepName: 'final_result',
        type: 'output',
        data: safeSerialize(result),
        status: 'completed'
      })
    } catch (error) {
      throw new Error(`Failed to mark child execution completed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async markChildExecutionFailed(childExecutionId: string, reason: string): Promise<void> {
    try {
      await this.workflowExecutionRepo.update(childExecutionId, {
        status: WorkflowExecutionStatus.FAILURE,
        output: reason
      })
    } catch (error) {
      throw new Error(`Failed to mark child execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async markChildExecutionCancelled(childExecutionId: string, reason: string): Promise<void> {
    try {
      await this.workflowExecutionRepo.update(childExecutionId, {
        status: WorkflowExecutionStatus.CANCELLED,
        output: reason
      })
    } catch (error) {
      throw new Error(`Failed to mark child execution cancelled: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Framework step creation methods
  // These methods now use inputStepDbId to get stepName and use parent execution directly

  async getStepById(stepId: string): Promise<WorkflowStep | null> {
    try {
      const steps = await this.workflowStepRepo.findMany({
        where: { id: stepId }
      });
      return steps.length > 0 ? steps[0] : null;
    } catch (error) {
      logger.error(`Failed to get step by ID ${stepId}:`, error);
      return null;
    }
  }

  async createToolExecutionStep(workflowExecutionId: string, inputStepDbId: string, toolExecution: any): Promise<void> {
    try {
      // Get the INPUT step to retrieve its stepName
      const inputStep = await this.getStepById(inputStepDbId);
      if (!inputStep) {
        throw new Error(`Input step not found: ${inputStepDbId}`);
      }

      const normalizedToolName = normalizeToolName(toolExecution.name);
      const stepId = uuidv4();
      const stepData = safeSerialize({
        id: toolExecution.id,
        input: toolExecution.input,
        output: toolExecution.output,
        duration: toolExecution.duration
      });

      await this.ensureAggregateWorkflowStepWithInputStep(
        workflowExecutionId,
        inputStepDbId,
        inputStep.stepName || 'unknown',
        {
          stepId,
          stepName: `tool_${normalizedToolName}`,
          type: 'output',
          data: stepData,
          status: toolExecution.success ? 'completed' : 'failed',
          stepExecutorType: STEP_TYPES.AGENT
        }
      );

      // Create AgentStep linking to the INPUT step
      await repositories.agentSteps.create({
        stepsId: inputStepDbId,
        toolCallId: toolExecution.id,
        stepType: 'tool',
        toolName: normalizedToolName
      });
    } catch (error) {
      throw new Error(`Failed to create tool execution step: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async updateToolExecutionAgentStep(inputStepDbId: string, toolCallId: string, agentData: UpdateAgentInput): Promise<AgentStep> {
    const maxRetries = 5;
    const baseDelay = 100; // ms

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Look up agent step by stepsId (inputStepDbId) and toolCallId
        const agentSteps = await repositories.agentSteps.findMany({
          where: {
            stepsId: inputStepDbId,
            toolCallId: toolCallId
          }
        })

        if (agentSteps && agentSteps.length > 0) {
          return await repositories.agentSteps.update(agentSteps[0].id, {...agentData})
        }

        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        throw new Error(
          `Failed to update tool execution agent step for inputStepDbId=${inputStepDbId}, toolCallId=${toolCallId}: Agent step not found after ${maxRetries} attempts`
        )
      } catch (error) {
        throw new Error(
          `Failed to update tool execution agent step for inputStepDbId=${inputStepDbId}, toolCallId=${toolCallId}: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }

    // This should never be reached, but TypeScript needs it
    throw new Error(
      `Failed to update tool execution agent step for inputStepDbId=${inputStepDbId}, toolCallId=${toolCallId}: Unexpected error in retry loop`
    )
  }

  async updateToolExecutionStep(workflowStep: string, toolCallId: string, toolData: any, toolCallStatus: string, toolInput?: Record<string, unknown>): Promise<void> {
    try {
      // Get workflow step from DB to find executionId and stepName (needed for Redis key)
      // Note: The actual step data is stored in Redis, not in the DB's data field
      const workflowStepList = await repositories.workflowSteps.findMany({
        where: { id: workflowStep }
      });

      if (!workflowStepList || workflowStepList.length === 0) {
        return;
      }

      const workflowStepDB = workflowStepList[0];

      // Read the current step data from Redis (source of truth)
      const redisKey = buildWorkflowStepKey(workflowStepDB.workflowExecutionId, workflowStepDB.stepName || 'unknown');
      const redisData = await redisService.lrange(redisKey, 0, -1);

      // Find the entry matching the toolCallId
      const entryIndex = redisData.findIndex((item) => {
        try {
          const parsed = JSON.parse(item);
          const stepData = safeDeserialize(parsed.data || '{}') as { id?: string };
          return stepData.id === toolCallId;
        } catch {
          return false;
        }
      });

      if (entryIndex >= 0) {
        try {
          const stepEntry = JSON.parse(redisData[entryIndex]);

          // Deserialize the existing data from Redis, update it, and re-serialize
          const prevData: any = safeDeserialize(stepEntry.data || '{}');
          prevData['output'] = toolData;

          if (toolInput && Object.keys(toolInput).length > 0) {
            prevData['input'] = toolInput;
          }

          const serializedData = safeSerialize(prevData);

          const updatedEntry = JSON.stringify({
            ...stepEntry,
            data: serializedData,
            status: toolCallStatus,
            updatedAt: new Date()
          });

          // Use LSET to atomically update the specific index (no race condition)
          await redisService.lset(redisKey, entryIndex, updatedEntry);
          await redisService.expire(redisKey, 18000); // Reset TTL
        } catch {
          // Skip if entry can't be parsed
        }
      }
    } catch (error) {
      throw new Error(
        `Failed to update tool execution step for id ${workflowStep}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async createLLMCallStep(workflowExecutionId: string, inputStepDbId: string, llmCall: any): Promise<void> {
    try {
      // Get the INPUT step to retrieve its stepName
      const inputStep = await this.getStepById(inputStepDbId);
      if (!inputStep) {
        throw new Error(`Input step not found: ${inputStepDbId}`);
      }

      const llmStepData: Record<string, unknown> = {
        messages: llmCall.messages || [],
        response: llmCall.content,
        tokens: llmCall.tokens
      };

      if (llmCall.thinking) {
        llmStepData.thinking = llmCall.thinking;
      }

      if (llmCall.toolCalls && llmCall.toolCalls.length > 0) {
        llmStepData.toolCalls = llmCall.toolCalls;
      }

      const stepId = uuidv4();
      const serializedData = safeSerialize(llmStepData);

      // Use ensureAggregateWorkflowStepWithInputStep for agentic steps
      await this.ensureAggregateWorkflowStepWithInputStep(
        workflowExecutionId,
        inputStepDbId,
        inputStep.stepName || 'unknown',
        {
          stepId,
          stepName: `llm_call_${Date.now()}`,
          type: 'output',
          data: serializedData,
          status: 'completed',
          stepExecutorType: STEP_TYPES.AGENT
        }
      );

      // Create AgentStep linking to the INPUT step
      await repositories.agentSteps.create({
        stepsId: inputStepDbId,
        stepType: 'llm-call'
      });
    } catch (error) {
      throw new Error(`Failed to create LLM call step: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createAssistantMessageStep(workflowExecutionId: string, inputStepDbId: string, message: any): Promise<void> {
    try {
      // Get the INPUT step to retrieve its stepName
      const inputStep = await this.getStepById(inputStepDbId);
      if (!inputStep) {
        throw new Error(`Input step not found: ${inputStepDbId}`);
      }

      let msgStepData: Record<string, unknown>;
      const stepName = 'assistant_message';

      if (message.turn !== undefined && message.result) {
        msgStepData = {
          turn: message.turn,
          content: message.result.content,
          thinking: message.result.thinking,
          finish: message.result.finish,
          tokens: message.result.tokens,
          cost: message.result.cost,
          role: 'assistant'
        };
      } else {
        msgStepData = {
          content: message.content,
          role: message.role || 'assistant'
        };
      }

      const stepId = uuidv4();
      const serializedData = safeSerialize(msgStepData);

      // Use ensureAggregateWorkflowStepWithInputStep for agentic steps
      await this.ensureAggregateWorkflowStepWithInputStep(
        workflowExecutionId,
        inputStepDbId,
        inputStep.stepName || 'unknown',
        {
          stepId,
          stepName,
          type: 'output',
          data: serializedData,
          status: 'completed',
          stepExecutorType: STEP_TYPES.AGENT
        }
      );

      // Create AgentStep linking to the INPUT step
      await repositories.agentSteps.create({
        stepsId: inputStepDbId,
        stepType: 'assistant-message'
      });
    } catch (error) {
      throw new Error(`Failed to create assistant message step: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createUserMessageStep(workflowExecutionId: string, inputStepDbId: string, userMessage: string): Promise<void> {
    try {
      // Get the INPUT step to retrieve its stepName
      const inputStep = await this.getStepById(inputStepDbId);
      if (!inputStep) {
        throw new Error(`Input step not found: ${inputStepDbId}`);
      }

      const stepId = uuidv4();
      const stepData = safeSerialize({
        content: userMessage,
        role: 'user'
      });

      // Use ensureAggregateWorkflowStepWithInputStep for agentic steps
      await this.ensureAggregateWorkflowStepWithInputStep(
        workflowExecutionId,
        inputStepDbId,
        inputStep.stepName || 'unknown',
        {
          stepId,
          stepName: 'user_message',
          type: 'input',
          data: stepData,
          status: 'completed',
          stepExecutorType: STEP_TYPES.AGENT
        }
      );

      // Create AgentStep linking to the INPUT step
      await repositories.agentSteps.create({
        stepsId: inputStepDbId,
        stepType: 'user-message'
      });
    } catch (error) {
      throw new Error(`Failed to create user message step: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async createErrorStep(workflowExecutionId: string, inputStepDbId: string, error: Error): Promise<void> {
    try {
      // Get the INPUT step to retrieve its stepName
      const inputStep = await this.getStepById(inputStepDbId);
      if (!inputStep) {
        throw new Error(`Input step not found: ${inputStepDbId}`);
      }

      const stepId = uuidv4();
      const stepData = safeSerialize({
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });

      // Use ensureAggregateWorkflowStepWithInputStep for agentic steps
      await this.ensureAggregateWorkflowStepWithInputStep(
        workflowExecutionId,
        inputStepDbId,
        inputStep.stepName || 'unknown',
        {
          stepId,
          stepName: 'framework_error',
          type: 'output',
          data: stepData,
          status: 'failed',
          stepExecutorType: STEP_TYPES.AGENT
        }
      );

      // Create AgentStep linking to the INPUT step
      await repositories.agentSteps.create({
        stepsId: inputStepDbId,
        stepType: 'hooks'
      });
    } catch (err) {
      throw new Error(`Failed to create error step: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // Get agentic steps from Redis (new per-step storage format)
  // Falls back to GCS if Redis data is not available
  async getAgenticStepsFromRedis(
    workflowExecutionId: string,
    checkpointId: string
  ): Promise<Array<{ stepName: string; data: string; createdAt: Date }>> {
    try {
      const redisKey = buildWorkflowStepKey(workflowExecutionId, checkpointId);
      const redisData = await redisService.lrange(redisKey, 0, -1);

      if (redisData.length === 0) {
        // Fallback to GCS - try to load from the execution's steps file
        logger.info(`[DB-STORAGE] Redis empty for ${workflowExecutionId}:${checkpointId}, trying GCS`);
        return await this.getAgenticStepsFromGCSByExecution(workflowExecutionId, checkpointId);
      }

      return redisData.map(item => {
        try {
          const parsed = JSON.parse(item);
          return {
            stepName: parsed.stepName || 'unknown',
            data: parsed.data || '{}',
            createdAt: new Date(parsed.createdAt || Date.now())
          };
        } catch {
          return { stepName: 'unknown', data: item, createdAt: new Date() };
        }
      });
    } catch (error) {
      logger.error(`[DB-STORAGE] Failed to get agentic steps from Redis for ${workflowExecutionId}:${checkpointId}:`, error);
      // Try GCS as fallback on error too
      return await this.getAgenticStepsFromGCSByExecution(workflowExecutionId, checkpointId);
    }
  }

  // Helper: Get agentic steps directly from GCS by execution and checkpoint
  private async getAgenticStepsFromGCSByExecution(
    workflowExecutionId: string,
    checkpointId: string
  ): Promise<Array<{ stepName: string; data: string; createdAt: Date }>> {
    try {
      // Import GCS service factory and config
      const { getStorageService } = await import('@/services/storage');
      const { config } = await import('@/config/env');
      const storageService = getStorageService(config.gcs.workflowStepsBucketName);

      // Try per-step file only: workflows/{executionId}/{checkpointId}.json
      const gcsPath = `workflows/${workflowExecutionId}/${checkpointId}.json`;
      let fileContent: Buffer | null = null;
      try {
        fileContent = await storageService.getFileBuffer(gcsPath);
        if (!fileContent) {
          logger.warn(`[DB-STORAGE] No per-step GCS file found at ${gcsPath} for ${workflowExecutionId}:${checkpointId}`);
          return [];
        }
        logger.info(`[DB-STORAGE] Loaded per-step GCS file ${gcsPath} for ${workflowExecutionId}:${checkpointId}`);
      } catch (e) {
        logger.warn(`[DB-STORAGE] Failed to fetch per-step GCS file ${gcsPath} for ${workflowExecutionId}:${checkpointId}:`, e instanceof Error ? e.message : String(e));
        return [];
      }

      const gcsSteps = JSON.parse(fileContent.toString('utf-8'));
      if (!Array.isArray(gcsSteps) || gcsSteps.length === 0) {
        logger.warn(`[DB-STORAGE] GCS file empty or invalid for ${workflowExecutionId}`);
        return [];
      }

      return gcsSteps.map((step: any) => ({
        stepName: step.stepName || 'unknown',
        data: typeof step.data === 'string' ? step.data : JSON.stringify(step.data),
        createdAt: new Date(step.createdAt || Date.now())
      }));
    } catch (error) {
      logger.error(`[DB-STORAGE] Failed to get agentic steps from GCS for ${workflowExecutionId}:${checkpointId}:`, error);
      return [];
    }
  }

  // Get agentic steps from GCS (fallback when Redis TTL expires)
  async getAgenticStepsFromGCS(
    _workflowExecutionId: string,
    inputStepDbId: string
  ): Promise<WorkflowStepData[]> {
    try {
      // Get the INPUT step to find the stepName and MessageAttachment
      const inputStep = await this.getStepById(inputStepDbId);
      if (!inputStep || !inputStep.stepName) {
        logger.warn(`[DB-STORAGE] Input step not found or missing stepName for ${inputStepDbId}`);
        return [];
      }

      // Try to get steps from MessageAttachment (linked to the INPUT step)
      const attachments = await this.messageAttachmentRepo.findByEntityIdAndType(
        inputStepDbId,
        AttachmentEntityType.WORKFLOW_STEPS
      );

      if (attachments.length === 0) {
        logger.warn(`[DB-STORAGE] No MessageAttachment found for step ${inputStepDbId}`);
        return [];
      }

      const stepData: WorkflowStepData[] = [];

      // Fetch from GCS using the attachment URL
      const { getStorageService } = await import('@/services/storage');
      const storageService = getStorageService(config.gcs.workflowStepsBucketName);

      for (const attachment of attachments) {
        if (attachment.url && attachment.url.startsWith('gs://')) {
          try {
            const gcsPath = attachment.url.replace('gs://', '').split('/').slice(1).join('/');
            const fileBuffer = await storageService.getFileBuffer(gcsPath);

            if (fileBuffer) {
              const parsedContent = JSON.parse(fileBuffer.toString());
              const steps = Array.isArray(parsedContent) ? parsedContent : [parsedContent];

              for (const step of steps) {
                stepData.push({
                  stepName: step.stepName || inputStep.stepName,
                  data: typeof step.data === 'string' ? step.data : JSON.stringify(step.data || {}),
                  createdAt: step.createdAt ? new Date(step.createdAt) : new Date()
                });
              }
            }
          } catch (gcsError) {
            logger.warn(`[DB-STORAGE] Failed to fetch GCS data from ${attachment.url}:`, gcsError);
          }
        }
      }

      // Also include the INPUT step itself if no GCS data was found
      if (stepData.length === 0) {
        stepData.push({
          stepName: inputStep.stepName,
          data: inputStep.data || '{}',
          createdAt: inputStep.createdAt
        });
      }

      return stepData;
    } catch (error) {
      logger.error(`[DB-STORAGE] Failed to get agentic steps from GCS for ${inputStepDbId}:`, error);
      return [];
    }
  }

  // Pause/Cancel status checking

  async checkWorkflowPauseOrCancelStatus(childExecutionId: string): Promise<{ isPaused: boolean; isCancelled: boolean; parentExecutionId?: string }> {
    try {
      // Get child execution to find parent
      const childExecution = await this.workflowExecutionRepo.findById(childExecutionId)
      if (!childExecution) {
        return { isPaused: false, isCancelled: false }
      }

      const parentExecutionId = childExecution.parentWorkflowExecutionId
      if (!parentExecutionId) {
        return { isPaused: false, isCancelled: false }
      }

      // Check both parent and child execution status
      const [parentExecution, childExecutionCurrent] = await Promise.all([
        this.workflowExecutionRepo.findById(parentExecutionId),
        this.workflowExecutionRepo.findById(childExecutionId)
      ])

      // Check if either workflow is paused
      const isPaused = parentExecution?.status === WorkflowExecutionStatus.PAUSED ||
                      childExecutionCurrent?.status === WorkflowExecutionStatus.PAUSED

      // Check if either workflow is cancelled
      const isCancelled = parentExecution?.status === WorkflowExecutionStatus.CANCELLED ||
                          childExecutionCurrent?.status === WorkflowExecutionStatus.CANCELLED

      return { isPaused, isCancelled, parentExecutionId }
    } catch (error) {
      logger.error(`Error checking pause status for ${childExecutionId}:`, error)
      return { isPaused: false, isCancelled: false }
    }
  }

  // Parallel workflow storage methods
  async saveParallelWorkflowInputIfNotExists<
    Tasks extends readonly import('../workflow-types').ValidatedWorkflowTask[],
    TFinalResult
  >(
    workflowExecutionId: string,
    parallelId: string,
    config: ParallelWorkflowConfig<Tasks, TFinalResult>,
    parentStepId?: string,
    lookupParentIfInheriting?: boolean
  ): Promise<string | null> {
    try {
      await this.ensureWorkflowExecution(workflowExecutionId)

      // If lookupParentIfInheriting flag is true, search parent chain for INPUT
      if (lookupParentIfInheriting) {
        const chain = await this.getParentChain(workflowExecutionId)

        for (const executionId of chain) {
          const inputSteps = await this.workflowStepRepo.findMany({
            where: {
              workflowExecutionId: executionId,
              stepName: parallelId,
              type: 'input',
              stepExecutorType: STEP_TYPES.PARALLEL
            },
            take: 1
          })

          if (inputSteps.length > 0) {
            // Found INPUT in parent chain, return its DB ID for matching
            return inputSteps[0].id
          }
        }

        // Not found in parent chain, return null
        return null
      }

      // Check if input step already exists in current execution
      const existingInputs = await this.workflowStepRepo.findMany({
        where: {
          workflowExecutionId,
          stepName: parallelId,
          type: 'input',
          stepExecutorType: STEP_TYPES.PARALLEL,
          previousStepId: parentStepId || null
        },
        take: 1
      })
      const existingInput = existingInputs[0] || null

      if (existingInput) {
        return existingInput.id
      }

      const createdStep = await this.createStepAndNotify(workflowExecutionId, {
        workflowExecution: { connect: { id: workflowExecutionId } },
        stepExecutorType: STEP_TYPES.PARALLEL,
        stepName: parallelId,
        type: 'input',
        previousStepId: parentStepId || null,
        data: safeSerialize({
          config,
          processedCallbacks: [],  // Track which child callbacks have been executed
          createdAt: new Date().toISOString()
        }),
        status: WorkflowStepStatus.RUNNING
      })

      return createdStep.id
    } catch (error) {
      throw new Error(
        `Failed to save parallel workflow input for ${workflowExecutionId}:${parallelId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async getOrCreateChildExecutions<
    Tasks extends readonly import('../workflow-types').ValidatedWorkflowTask[],
    TFinalResult
  >(
    workflowExecutionId: string,
    parallelId: string,
    parallelStepDbId: string,
    config: ParallelWorkflowConfig<Tasks, TFinalResult>
  ): Promise<Array<{
    executionId: string
    workflowId: string
    workflowType: string
    context: BaseWorkflowContext
    status: string
  }>> {
    try {
      await this.ensureWorkflowExecution(workflowExecutionId)

      // Check if child executions already exist by looking for actual child workflow executions
      // Use parallelStepDbId (WorkflowStep DB ID) instead of parallelId (step name)
      const existingChildExecutions = await this.workflowExecutionRepo.findMany({
        where: {
          parentWorkflowExecutionId: workflowExecutionId,
          sourceStepsId: parallelStepDbId
        }
      })

      if (existingChildExecutions.length > 0) {
        // Return existing child executions with their contexts and status
        const childrenWithContext = existingChildExecutions.map((child) => {
          const context = child.context ? safeDeserialize<BaseWorkflowContext>(child.context) : {}
          return {
            workflowId: child.workflowId,
            executionId: child.id,
            workflowType: child.workflowType || 'unknown',
            context: context as BaseWorkflowContext,
            status: child.status
          }
        })
        return childrenWithContext
      }

      // Create actual child workflow executions in the database
      const childExecutions = []

      // Get parent execution to connect children properly
      const parentExecution = await this.workflowExecutionRepo.findById(workflowExecutionId)
      if (!parentExecution) {
        throw new Error(`Parent workflow execution not found: ${workflowExecutionId}`)
      }

      // Get parent workflow
      const parentWorkflow = await repositories.workflows.findById(parentExecution.workflowId)
      if (!parentWorkflow) {
        throw new Error(`Parent workflow not found: ${parentExecution.workflowId}`)
      }

      for (let index = 0; index < config.workflows.length; index++) {
        const workflowTask = config.workflows[index]

        // Create child execution directly (NO intermediate Workflow record)
        // Links to parent Workflow, stores workflowType + context in execution
        const childExecution = await this.workflowExecutionRepo.create({
          workflow: { connect: { id: parentWorkflow.id } }, // Link to parent workflow (not child workflow)
          workflowType: workflowTask.workflowType,           // Store type in execution
          context: workflowTask.initialContext
            ? safeSerialize(workflowTask.initialContext)
            : null,   
          tag: "child",                                 // Store context in execution
          status: 'PENDING',  // Child starts as PENDING, worker poller will pick it up
          parentWorkflowExecution: { connect: { id: workflowExecutionId } },
          sourceStepsId: parallelStepDbId  // Use WorkflowStep DB ID, not step name
        })

        childExecutions.push({
          workflowId: parentWorkflow.id,                   // Parent workflow ID (not child workflow)
          executionId: childExecution.id,
          workflowType: workflowTask.workflowType,
          context: workflowTask.initialContext || {},
          status: 'PENDING'
        })
      }

      return childExecutions
    } catch (error) {
      throw new Error(
        `Failed to get or create child executions for ${workflowExecutionId}:${parallelId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async saveParallelWorkflowResult<TResult = unknown>(
    workflowExecutionId: string,
    parallelId: string,
    result: TResult
  ): Promise<void> {
    try {
      await this.ensureWorkflowExecution(workflowExecutionId)

      await this.createStepAndNotify(workflowExecutionId, {
        workflowExecution: { connect: { id: workflowExecutionId } },
        stepExecutorType: STEP_TYPES.PARALLEL,
        stepName: parallelId,
        type: 'output',
        data: safeSerialize(result)
      })
    } catch (error) {
      throw new Error(
        `Failed to save parallel workflow result for ${workflowExecutionId}:${parallelId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async loadParallelWorkflowResult<R>(
    workflowExecutionId: string,
    parallelId: string
  ): Promise<R | null> {
    try {
      await this.ensureWorkflowExecution(workflowExecutionId)

      const outputSteps = await this.workflowStepRepo.findMany({
        where: {
          workflowExecutionId,
          stepName: parallelId,
          type: 'output',
          stepExecutorType: STEP_TYPES.PARALLEL
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 1
      })
      const outputStep = outputSteps[0] || null

      if (!outputStep || !outputStep.data) {
        return null
      }

      return safeDeserialize(outputStep.data)
    } catch (error) {
      if (error instanceof DeserializationError) {
        throw error
      }
      throw new Error(
        `Failed to load parallel workflow result for ${workflowExecutionId}:${parallelId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async isParallelWorkflowCompleted(
    workflowExecutionId: string,
    parallelId: string
  ): Promise<boolean> {
    try {
      await this.ensureWorkflowExecution(workflowExecutionId)

      const outputSteps = await this.workflowStepRepo.findMany({
        where: {
          workflowExecutionId,
          stepName: parallelId,
          type: 'output',
          stepExecutorType: STEP_TYPES.PARALLEL
        },
        take: 1
      })
      const outputStep = outputSteps?.[0]?.data || null

      return !!outputStep
    } catch (error) {
      throw new Error(
        `Failed to check parallel workflow completion for ${workflowExecutionId}:${parallelId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async updateChildWorkflowStatus(childExecutionId: string, status: string): Promise<void> {
    try {
      await this.workflowExecutionRepo.update(childExecutionId, { status })
    } catch (error) {
      throw new Error(
        `Failed to update child workflow status for ${childExecutionId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async getProcessedCallbacks(workflowExecutionId: string, parallelId: string): Promise<string[]> {
    try {
      await this.ensureWorkflowExecution(workflowExecutionId)

      const inputSteps = await this.workflowStepRepo.findMany({
        where: {
          workflowExecutionId,
          stepName: parallelId,
          type: 'input',
          stepExecutorType: STEP_TYPES.PARALLEL
        },
        take: 1
      })

      if (inputSteps.length === 0) {
        return []
      }

      const inputData = safeDeserialize<{
        config: ParallelWorkflowConfig<readonly ValidatedWorkflowTask[], unknown>
        processedCallbacks: string[]
        createdAt: string
      }>(inputSteps[0].data || '{}')

      return inputData.processedCallbacks || []
    } catch (error) {
      throw new Error(
        `Failed to get processed callbacks for ${workflowExecutionId}:${parallelId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async markCallbackProcessed(workflowExecutionId: string, parallelId: string, childExecutionId: string): Promise<void> {
    try {
      await this.ensureWorkflowExecution(workflowExecutionId)

      const inputSteps = await this.workflowStepRepo.findMany({
        where: {
          workflowExecutionId,
          stepName: parallelId,
          type: 'input',
          stepExecutorType: STEP_TYPES.PARALLEL
        },
        take: 1
      })

      if (inputSteps.length === 0) {
        throw new Error(`Input step not found for parallel workflow ${parallelId}`)
      }

      const inputStep = inputSteps[0]
      const currentData = safeDeserialize<{
        config: ParallelWorkflowConfig<readonly ValidatedWorkflowTask[], unknown>
        processedCallbacks: string[]
        createdAt: string
      }>(inputStep.data || '{}')

      // Add to processed callbacks if not already there
      if (!currentData.processedCallbacks.includes(childExecutionId)) {
        currentData.processedCallbacks.push(childExecutionId)

        await this.workflowStepRepo.update(inputStep.id, {
          data: safeSerialize(currentData)
        })
      }
    } catch (error) {
      throw new Error(
        `Failed to mark callback processed for ${workflowExecutionId}:${parallelId}:${childExecutionId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async loadChildResult<R>(childExecutionId: string): Promise<import('../workflow-types').ChildWorkflowResult<R>> {
    try {
      const execution = await this.workflowExecutionRepo.findById(childExecutionId)
      if (!execution) {
        throw new Error(`Child execution not found: ${childExecutionId}`)
      }

      const result = execution.output ? safeDeserialize<R>(execution.output) : null
      const status = execution.status

      let childStatus: 'completed' | 'failed' | 'cancelled'
      if (status === 'SUCCESS') {
        childStatus = 'completed'
      } else if (status === 'CANCELLED') {
        childStatus = 'cancelled'
      } else {
        childStatus = 'failed'
      }

      return {
        executionId: execution.id,
        workflowType: execution.workflowType || 'unknown',
        result: result as R,
        status: childStatus
      }
    } catch (error) {
      throw new Error(
        `Failed to load child result for ${childExecutionId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async loadAllChildResults(
    childExecutions: Array<{ executionId: string; workflowType: string; status: string }>
  ): Promise<Array<import('../workflow-types').ChildWorkflowResult<unknown>>> {
    try {
      const results = await Promise.all(
        childExecutions.map(async (child) => {
          return await this.loadChildResult<unknown>(child.executionId)
        })
      )
      return results
    } catch (error) {
      throw new Error(
        `Failed to load all child results: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async cancelSiblingWorkflows(
    parentExecutionId: string,
    sourceStepsId: string,
    completedExecutionId: string
  ): Promise<void> {
    try {
      // Find all sibling executions
      const siblings = await this.workflowExecutionRepo.findMany({
        where: {
          parentWorkflowExecutionId: parentExecutionId,
          sourceStepsId: sourceStepsId
        }
      })

      // Cancel all siblings except the completed one
      for (const sibling of siblings) {
        if (sibling.id !== completedExecutionId && sibling.status === 'PENDING') {
          await this.workflowExecutionRepo.update(sibling.id, { status: 'CANCELLED' })
        }
      }
    } catch (error) {
      throw new Error(
        `Failed to cancel sibling workflows for ${parentExecutionId}:${sourceStepsId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async updateExecutionStatus(executionId: string, status: string): Promise<void> {
    try {
      await this.workflowExecutionRepo.update(executionId, { status })
    } catch (error) {
      throw new Error(
        `Failed to update execution status for ${executionId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Get git info from a completed child execution (for continuation)
   * This allows continuation to checkout the same branch/commit as the original execution
   */
  async getChildExecutionGitInfo(childExecutionId: string): Promise<{
    branch: string
    repoUrl?: string
    commitHash?: string
    baseCommitHash?: string
    pullRequestUrl?: string
    pr_link?: string
  } | null> {
    try {
      const execution = await this.workflowExecutionRepo.findById(childExecutionId)
      if (!execution || !execution.output) {
        return null
      }

      // Parse the output which contains gitInfo
      const output = typeof execution.output === 'string' 
        ? JSON.parse(execution.output) 
        : execution.output

      // gitInfo is stored directly in the output or nested
      const gitInfo = output.gitInfo || output

      if (!gitInfo.branch) {
        return null
      }

      return {
        branch: gitInfo.branch,
        repoUrl: gitInfo.repoUrl,
        commitHash: gitInfo.commitHash,
        baseCommitHash: gitInfo.baseCommitHash,
        pullRequestUrl: gitInfo.pullRequestUrl,
        pr_link: gitInfo.pr_link
      }
    } catch (error) {
      logger.error(`Failed to get git info for child execution ${childExecutionId}:`, error)
      return null
    }
  }

  async getExecutionGitInfo(executionId: string): Promise<{
    branch: string
    repoUrl?: string
    commitHash?: string
    baseCommitHash?: string
    pr_link?: string
    gitDiff?: Array<{
      oldPath: string
      newPath: string
      type: 'add' | 'delete' | 'modify' | 'rename'
      hunks: Array<{
        oldStart: number
        oldLines: number
        newStart: number
        newLines: number
        content: string
      }>
    }>
    diffStats?: {
      additions: number
      deletions: number
      files: number
    }
  } | null> {
    try {
      // First, check execution.output directly (same logic as gitInfoFromOutput in workflowRepository)
      const execution = await this.workflowExecutionRepo.findById(executionId)
      if (execution && execution.output) {
        try {
          const output = typeof execution.output === 'string' 
            ? JSON.parse(execution.output) 
            : execution.output
          
          // Check for gitInfo directly on output object (matches extractGitInfoFromSteps logic)
          const gitInfo = output?.gitInfo
          if (gitInfo && gitInfo.baseCommitHash) {
            logger.info(`[getExecutionGitInfo] Found gitInfo with baseCommitHash in execution.output`)
            return {
              branch: gitInfo.branch,
              repoUrl: gitInfo.repoUrl,
              commitHash: gitInfo.commitHash,
              baseCommitHash: gitInfo.baseCommitHash,
              pr_link: gitInfo.pr_link || gitInfo.pullRequestUrl,
              gitDiff: gitInfo.gitDiff,
              diffStats: gitInfo.diffStats
            }
          }
        } catch (parseError) {
          logger.error(`[getExecutionGitInfo] Failed to parse execution.output:`, parseError)
        }
      }

      // Fallback: Get all output steps for this execution
      const steps = await this.workflowStepRepo.findMany({
        where: {
          workflowExecutionId: executionId,
          type: 'output'
        }
      })

      logger.info(`[getExecutionGitInfo] Found ${steps.length} output steps for execution ${executionId}`)

      // Search through steps for gitInfo
      for (const step of steps) {
        if (step.data) {
          try {
            const data = typeof step.data === 'string' ? JSON.parse(step.data) : step.data
            const gitInfo = data?.result?.gitInfo || data?.gitInfo

            logger.info(`[getExecutionGitInfo] Step ${step.stepName} gitInfo:`, gitInfo ? 'found' : 'not found')

            if (gitInfo && gitInfo.baseCommitHash) {
              logger.info(`[getExecutionGitInfo] Found gitInfo with baseCommitHash in step ${step.stepName}`)
              logger.info(`[getExecutionGitInfo] Has cached gitDiff: ${gitInfo.gitDiff ? 'yes' : 'no'}`)
              return {
                branch: gitInfo.branch,
                repoUrl: gitInfo.repoUrl,
                commitHash: gitInfo.commitHash,
                baseCommitHash: gitInfo.baseCommitHash,
                pr_link: gitInfo.pr_link || gitInfo.pullRequestUrl,
                gitDiff: gitInfo.gitDiff,
                diffStats: gitInfo.diffStats
              }
            }
          } catch (parseError) {
            logger.error(`[getExecutionGitInfo] Failed to parse step data for step ${step.stepName}:`, parseError)
          }
        }
      }

      // Fallback: Search child executions for gitInfo (for parent workflow executions on rerun)
      logger.info(`[getExecutionGitInfo] Searching child executions for gitInfo...`)
      const childExecutions = await this.workflowExecutionRepo.findMany({
        where: {
          parentWorkflowExecutionId: executionId
        },
        orderBy: {
          createdAt: 'desc'
        }
      })

      logger.info(`[getExecutionGitInfo] Found ${childExecutions.length} child executions`)

      for (const childExec of childExecutions) {
        // Check child execution output
        if (childExec.output) {
          try {
            const output = typeof childExec.output === 'string' 
              ? JSON.parse(childExec.output) 
              : childExec.output
            
            const childGitInfo = output?.gitInfo
            if (childGitInfo && childGitInfo.baseCommitHash) {
              logger.info(`[getExecutionGitInfo] Found gitInfo in child execution ${childExec.id}`)
              return {
                branch: childGitInfo.branch,
                repoUrl: childGitInfo.repoUrl,
                commitHash: childGitInfo.commitHash,
                baseCommitHash: childGitInfo.baseCommitHash,
                pr_link: childGitInfo.pr_link || childGitInfo.pullRequestUrl,
                gitDiff: childGitInfo.gitDiff,
                diffStats: childGitInfo.diffStats
              }
            }
          } catch (parseError) {
            logger.error(`[getExecutionGitInfo] Failed to parse child execution output:`, parseError)
          }
        }

        // Check child execution steps
        const childSteps = await this.workflowStepRepo.findMany({
          where: {
            workflowExecutionId: childExec.id,
            type: 'output'
          }
        })

        for (const childStep of childSteps) {
          if (childStep.data) {
            try {
              const data = typeof childStep.data === 'string' ? JSON.parse(childStep.data) : childStep.data
              const childGitInfo = data?.result?.gitInfo || data?.gitInfo

              if (childGitInfo && childGitInfo.baseCommitHash) {
                logger.info(`[getExecutionGitInfo] Found gitInfo in child execution step ${childStep.stepName}`)
                return {
                  branch: childGitInfo.branch,
                  repoUrl: childGitInfo.repoUrl,
                  commitHash: childGitInfo.commitHash,
                  baseCommitHash: childGitInfo.baseCommitHash,
                  pr_link: childGitInfo.pr_link || childGitInfo.pullRequestUrl,
                  gitDiff: childGitInfo.gitDiff,
                  diffStats: childGitInfo.diffStats
                }
              }
            } catch (parseError) {
              logger.error(`[getExecutionGitInfo] Failed to parse child step data:`, parseError)
            }
          }
        }
      }

      logger.info(`[getExecutionGitInfo] No gitInfo with baseCommitHash found for execution ${executionId}`)
      return null
    } catch (error) {
      logger.error(`Failed to get git info for execution ${executionId}:`, error)
      return null
    }
  }

  async getExecutionInfo(workflowExecutionId: string): Promise<{
    executionId: string
    workflowId: string
    status: string
    parentExecutionId: string | null
    parentWorkflowId: string | null
    parentStatus: string | null
    tag: string
    sourceStepsId: string | null
    stepInputOverrideData: string | null
  } | null> {
    try {
      const execution = await this.workflowExecutionRepo.findById(workflowExecutionId)
      if (!execution) {
        return null
      }

      // If no parent, return execution info without parent details
      if (!execution.parentWorkflowExecutionId) {
        return {
          executionId: execution.id,
          workflowId: execution.workflowId,
          status: execution.status,
          parentExecutionId: null,
          parentWorkflowId: null,
          parentStatus: null,
          tag: execution.tag || 'root',
          sourceStepsId: execution.sourceStepsId || null,
          stepInputOverrideData: execution.stepInputOverrideData || null
        }
      }

      // Get parent execution info
      const parentExecution = await this.workflowExecutionRepo.findById(execution.parentWorkflowExecutionId)

      return {
        executionId: execution.id,
        workflowId: execution.workflowId,
        status: execution.status,
        parentExecutionId: execution.parentWorkflowExecutionId,
        parentWorkflowId: parentExecution?.workflowId || null,
        parentStatus: parentExecution?.status || null,
        tag: execution.tag || 'root',
        sourceStepsId: execution.sourceStepsId || null,
        stepInputOverrideData: execution.stepInputOverrideData || null
      }
    } catch (error) {
      throw new Error(
        `Failed to get execution info for ${workflowExecutionId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async getWorkflowInfo(workflowId: string): Promise<{
    workflowId: string
    status: string
    workflowName: string | null
    workflowType: string | null
  } | null> {
    try {
      const workflow = await repositories.workflows.findById(workflowId)
      if (!workflow) {
        return null
      }

      return {
        workflowId: workflow.id,
        status: workflow.status,
        workflowName: workflow.workflowName || null,
        workflowType: workflow.workflowType || null
      }
    } catch (error) {
      throw new Error(
        `Failed to get workflow info for ${workflowId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async updateStepStatus(workflowExecutionId: string, stepName: string, stepType: 'input' | 'output', status: WorkflowStepStatus): Promise<void> {
    try {
      const steps = await this.workflowStepRepo.findMany({
        where: {
          stepName: stepName,
          type: stepType,
          workflowExecutionId: workflowExecutionId
        }
      })

      if (steps.length > 0) {
        const step = steps[0]
        await this.workflowStepRepo.updateStepStatus(step.id, status)

        // Broadcast step status update event
        const eventData = {
          type: 'step_updated' as const,
          executionId: workflowExecutionId,
          data: {
            stepId: step.id,
            stepName: stepName,
            type: stepType,
            status: status,
            stepExecutorType: step.stepExecutorType
          },
          timestamp: new Date()
        }

        // Broadcast to current execution
        redisService.broadcastWorkflowEvent(workflowExecutionId, eventData)
          .catch(error => logger.error(`[WorkflowStorage] Failed to broadcast step update for ${workflowExecutionId}:`, error))

        // Also broadcast to parent execution if this is a child workflow
        const execution = await this.workflowExecutionRepo.findById(workflowExecutionId)
        if (execution?.parentWorkflowExecutionId) {
          redisService.broadcastWorkflowEvent(execution.parentWorkflowExecutionId, {
            ...eventData,
            executionId: execution.parentWorkflowExecutionId,
            data: { ...eventData.data, childExecutionId: workflowExecutionId }
          }).catch(error => logger.error(`[WorkflowStorage] Failed to broadcast step update to parent:`, error))
        }

      }
    } catch (error) {
      throw new Error(
        `Failed to update step status for ${workflowExecutionId}:${stepName}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Update conversation message metadata with workflow step progress
   * Called after updating step status to keep conversation message in sync
   */

  async saveStepMarkdownSummary(
    workflowExecutionId: string,
    stepName: string,
    markdownSummary: string
  ): Promise<void> {
    try {
      // Find the output step for this checkpoint
      const outputSteps = await this.workflowStepRepo.findMany({
        where: {
          stepName: stepName,
          type: 'output',
          workflowExecutionId: workflowExecutionId
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 1
      })

      if (outputSteps.length > 0) {
        await this.workflowStepRepo.update(outputSteps[0].id, {
          markdownSummary
        })
      } else {
        logger.warn(`No output step found for ${workflowExecutionId}:${stepName} to save markdown summary`)
      }
    } catch (error) {
      throw new Error(
        `Failed to save markdown summary for ${workflowExecutionId}:${stepName}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  // Agent creation methods

  async getAgentConfigFromDb(
    name: string,
    agentConfigVersions?: AgentConfigVersions,
    maxTurns?: number,
    modelName?: string,
    context?: BaseWorkflowContext,
  ): Promise<Agent> {
    let preferredVersion: number | undefined;
    if (agentConfigVersions && agentConfigVersions[name]) {
      preferredVersion = agentConfigVersions[name];
    }

    let fullAgent;
    
    // If a preferred version is specified, find agent directly with name and version
    if (preferredVersion) {
      // Since name+version is unique, we can find exactly one agent
      const versionedAgents = await repositories.agents.findMany({
        where: {
          name: name,
          version: preferredVersion
        }
      });
      
      if (versionedAgents.length > 0) {
        // Get full agent details for the specific version
        fullAgent = await repositories.agents.findFullAgent(versionedAgents[0].id);
      }
    }
    
    // If no specific version found or no version requested, get latest
    if (!fullAgent) {
      fullAgent = await repositories.agents.findLatestByNameWithDetails(name);
    }
    
    if (!fullAgent) {
      throw new Error(`Agent with name '${name}' not found`);
    }

    let agentConfig = await this.convertDbToAgentConfig(fullAgent, maxTurns, context);

    // If modelName is provided, override the defaultModel
    if (modelName) {
      // Get workspaceId from the agent's model if available, otherwise use default
      const workspaceId = fullAgent.model?.workspaceId;
      const model = await repositories.models.findByName(modelName, workspaceId);
      if (model && model.length > 0) {
        agentConfig = {
          ...agentConfig,
          model: {
            ...agentConfig.model,
            defaultModel: modelName
          }
        };
      }
    }

    return Agent.create(agentConfig);
  }

  /**
   * Private: Apply provider-specific configuration settings
   */
  private async applyProviderConfiguration(
    providerType: string,
    originalConfig: LiteLLMConfig | VertexConfig,
    context?: BaseWorkflowContext,
  ): Promise<LiteLLMConfig | VertexConfig> {
    if (providerType === 'litellm') {
      const credential = context?.ticketId
        ? await orgLLMCredentialService.getCredentialByTicketId(
          context.ticketId,
          OrgLLMServiceAccountPurpose.DEFAULT,
        )
        : context?.userId
          ? await orgLLMCredentialService.getCredentialByUserId(
            context.userId,
            OrgLLMServiceAccountPurpose.DEFAULT,
          )
          : await orgLLMCredentialService.getCredentialByWorkspaceId(
            appConfig.defaultWorkspaceId,
            OrgLLMServiceAccountPurpose.DEFAULT,
          );

      if (!credential) {
        throw new Error('No active DEFAULT LiteLLM service account credential for workflow agent execution');
      }

      // For LiteLLM provider, create new config with API key and base URL
      return {
        ...originalConfig,
        apiKey: credential.apiKey,
        baseUrl: credential.baseUrl,
      };
    } else if (providerType === 'vertex') {
      throw new Error('Vertex provider is not supported. Only LiteLLM provider is supported.');
    } else {
      // For other providers, use original config
      return originalConfig;
    }
  }

  /**
   * Private: Convert DB agent to framework AgentConfig
   */
  private async convertDbToAgentConfig(
    dbAgent: FullAgent,
    maxTurns?: number,
    context?: BaseWorkflowContext,
  ): Promise<AgentConfig> {
    // Start with framework defaults
    const defaultConfig = createDefaultAgentConfig();

    // Parse model credentials
    let modelCredentials;
    try {
      modelCredentials = JSON.parse(dbAgent.model.credentials);
    } catch (error) {
      throw new Error(`Invalid model credentials for agent '${dbAgent.name}': ${error}`);
    }

    // Apply provider-specific configuration
    const modifiedProviderConfig = await this.applyProviderConfiguration(
      dbAgent.model.provider,
      modelCredentials,
      context,
    );

    // Build provider configuration according to framework types
    const providerConfig = dbAgent.model.provider === 'vertex' 
      ? { type: 'vertex' as const, config: modifiedProviderConfig as VertexConfig }
      : { type: 'litellm' as const, config: modifiedProviderConfig as LiteLLMConfig };

    // Build AgentConfig using defaults + DB overrides
    const defaultModelName = appConfig.workflow.defaultModelName || dbAgent.model.name
    const agentConfig: AgentConfig = {
      // Model config - merge DB data with defaults
      model: {
        provider: providerConfig,
        defaultModel: defaultModelName,
        features: defaultConfig.model.features,
        ...(dbAgent.temp !== null && { temperature: dbAgent.temp }),
      },

      // Tools config - enabled tools from DB + default settings
      tools: {
        enabled: dbAgent.agentToolsMappings
          .filter(mapping => mapping.status === 'Enabled')
          .map(mapping => mapping.tool.name),
        config: defaultConfig.tools.config,
        execution: defaultConfig.tools.execution,
      },

      // Use framework defaults for execution, override maxTurns if specified
      execution: {...defaultConfig.execution,...(maxTurns !== undefined && { maxTurns }),toolAuthorization: async (
        _toolName: string,
        _parameters: Record<string, unknown>,
        _context: ToolAuthorizationContext
      ) => {
        return null;
      }},

      // Use framework defaults for events
      events: defaultConfig.events,

      // Metadata from DB
      metadata: {
        name: dbAgent.name,
        version: dbAgent.version.toString(),
        description: dbAgent.systemPrompt || undefined,
        tags: dbAgent.scope ? [dbAgent.scope] : undefined,
      },
      
    };

    // Validate and return
    return validateAndThrow(agentConfig);
  }

  // Helper methods

  private async ensureWorkflowExecution(workflowExecutionId: string): Promise<string> {
    // Check if workflow exists
    const workflowExecution = await this.workflowExecutionRepo.findById(workflowExecutionId)
    if (!workflowExecution) {
      throw new Error(`Workflow not found: ${workflowExecutionId}`)
    }
    return workflowExecution.id
  }

  /**
   * Get parent chain execution IDs for rerun executions.
   * Traverses up the parent chain while tag='rerun', returns array of execution IDs
   * in order from current to root (current execution first, root execution last).
   *
   * @param workflowExecutionId - Starting execution ID
   * @returns Array of execution IDs [current, parent, grandparent, ...]
   */
  private async getParentChain(workflowExecutionId: string): Promise<string[]> {
    const chain: string[] = [workflowExecutionId]
    let currentExecutionId = workflowExecutionId
    const visited = new Set<string>([workflowExecutionId])

    while (currentExecutionId) {
      const execution = await this.workflowExecutionRepo.findById(currentExecutionId)

      // Stop if execution not found or not a rerun
      if (!execution || execution.tag !== 'rerun') {
        break
      }

      // Stop if no parent or already visited (circular reference protection)
      if (!execution.parentWorkflowExecutionId || visited.has(execution.parentWorkflowExecutionId)) {
        break
      }

      currentExecutionId = execution.parentWorkflowExecutionId
      visited.add(currentExecutionId)
      chain.push(currentExecutionId)
    }

    return chain
  }

  // Parent chain lookup methods for restore functionality
  async loadStepOutputWithParentChain<R>(
    workflowExecutionId: string,
    stepId: string
  ): Promise<R | null> {
    const chain = await this.getParentChain(workflowExecutionId)

    for (const executionId of chain) {
      const result = await this.loadStepOutput<R>(executionId, stepId)
      if (result !== null) {
        return result
      }
    }

    return null
  }



  async loadConditionalResultWithParentChain(
    workflowExecutionId: string,
    conditionalId: string
  ): Promise<boolean | null> {
    const chain = await this.getParentChain(workflowExecutionId)

    for (const executionId of chain) {
      const result = await this.loadConditionalResult(executionId, conditionalId)
      if (result !== null) {
        return result
      }
    }

    return null
  }

  async getExternalStepDataWithParentChain<R>(
    workflowExecutionId: string,
    stepId: string
  ): Promise<R | null> {
    const chain = await this.getParentChain(workflowExecutionId)

    for (const executionId of chain) {
      const result = await this.getExternalStepData<R>(executionId, stepId)
      if (result !== null) {
        return result
      }
    }

    return null
  }

  async isAgenticCheckpointCompletedWithParentChain(
    workflowExecutionId: string,
    checkpointId: string
  ): Promise<boolean> {
    const chain = await this.getParentChain(workflowExecutionId)

    for (const executionId of chain) {
      const isCompleted = await this.isAgenticCheckpointCompleted(executionId, checkpointId)
      if (isCompleted) {
        return true
      }
    }

    return false
  }

  async loadAgenticCheckpointStateWithParentChain(
    workflowExecutionId: string,
    checkpointId: string
  ): Promise<AgenticCheckpointResult | null> {
    const chain = await this.getParentChain(workflowExecutionId)

    for (const executionId of chain) {
      try{
        const state = await this.loadAgenticCheckpointState(executionId, checkpointId)
        if (state !== null) {
          return state
        }
      } catch (error) {
        // A load failure is otherwise indistinguishable from "no checkpoint
        // here", which silently restarts the workflow from scratch.
        logger.error('agentic_checkpoint_load_failed', { executionId, checkpointId, error })
        continue;
      }
    }

    return null
  }

  async isParallelWorkflowCompletedWithParentChain(
    workflowExecutionId: string,
    parallelId: string
  ): Promise<boolean> {
    const chain = await this.getParentChain(workflowExecutionId)

    for (const executionId of chain) {
      const isCompleted = await this.isParallelWorkflowCompleted(executionId, parallelId)
      if (isCompleted) {
        return true
      }
    }

    return false
  }

  async loadParallelWorkflowResultWithParentChain<R>(
    workflowExecutionId: string,
    parallelId: string
  ): Promise<R | null> {
    const chain = await this.getParentChain(workflowExecutionId)

    for (const executionId of chain) {
      const result = await this.loadParallelWorkflowResult<R>(executionId, parallelId)
      if (result !== null) {
        return result
      }
    }

    return null
  }

  async saveWorkflowKnowledge(
    workflowExecutionId: string,
    checkpointId: string,
    learnings: KnowledgeLearning[]
  ): Promise<void> {
    logger.info(`💡 [KNOWLEDGE] Saving ${learnings.length} learnings for checkpoint: ${checkpointId}`)
    
    const db = DatabaseClient.getInstance()
    
    // Use Prisma createMany for batch insert
    await db.workflowKnowledge.createMany({
      data: learnings.map((learning) => ({
        id: crypto.randomUUID(),
        workflowExecutionId,
        checkpointId,
        learningType: learning.learningType,
        title: learning.title,
        content: learning.content,
        codeContext: learning.codeContext || null,
        filePaths: learning.filePaths || [],
        createdAt: new Date()
      }))
    })
    
    logger.info(`✅ [KNOWLEDGE] Saved ${learnings.length} learnings to database`)
    
    // NOTE: Canvas creation is now deferred to workflow completion
    // The consolidated canvas will be created via triggerConsolidatedKnowledgeCanvas
    // after all agentic checkpoints complete successfully
  }

  /**
   * Trigger consolidated knowledge canvas creation after all learnings are saved
   * Called at workflow completion with all accumulated learnings
   * Looks up conversationId from workflowExecutionId → workflow → ticket chain
   */
  async triggerConsolidatedKnowledgeCanvas(
    workflowExecutionId: string,
    learnings: KnowledgeLearning[]
  ): Promise<void> {
    const db = DatabaseClient.getInstance()
    
    // Get execution → workflow → ticket → conversation chain
    // First get execution to find workflowId
    const execution = await db.workflowExecution.findUnique({
      where: { id: workflowExecutionId },
      select: { workflowId: true }
    })
    
    if (!execution?.workflowId) {
      logger.info(`ℹ️ [KNOWLEDGE] No workflow found for execution ${workflowExecutionId}`)
      return
    }
    
    // Then get workflow to find ticketId
    const workflow = await db.workflow.findUnique({
      where: { id: execution.workflowId },
      select: { id: true, ticketId: true, workflowName: true }
    })
    
    if (!workflow?.ticketId) {
      logger.info(`ℹ️ [KNOWLEDGE] No ticket found for workflow ${execution.workflowId}`)
      return
    }
    
    // Then get ticket to find conversationId and projectId
    const ticket = await db.ticket.findUnique({
      where: { id: workflow.ticketId },
      select: { conversationId: true, projectId: true, title: true, xyneId: true }
    })
    
    const conversationId = ticket?.conversationId
    const projectId = ticket?.projectId

    if (!conversationId) {
      logger.info(`ℹ️ [KNOWLEDGE] No conversation found for ticket ${workflow.ticketId}, skipping canvas notification`)
      return
    }

    if (!projectId) {
      logger.info(`ℹ️ [KNOWLEDGE] No projectId found for ticket ${workflow.ticketId}, skipping canvas notification`)
      return
    }

    // Generate dynamic title from workflow name or ticket title
    const canvasTitle = workflow.workflowName || ticket.title || `Knowledge Learnings - ${new Date().toLocaleDateString()}`

    logger.info(`📤 [KNOWLEDGE] Triggering canvas notification for conversation ${conversationId}`)
    
    // Get repository URL from agent steps if available
    const agentStep = await db.agentStep.findFirst({
      where: { 
        stepsId: { not: null },
        repositoryURL: { not: null }
      },
      select: { repositoryURL: true },
      orderBy: { createdAt: 'desc' }
    })
    const repositoryUrl = agentStep?.repositoryURL || null
    
    // Get a user from the conversation for canvas ownership
    const firstMessage = await db.message.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { senderId: true }
    })
    const userId = firstMessage?.senderId || 'system'
    
    // Fetch saved learning IDs for this execution
    const savedLearnings = await db.workflowKnowledge.findMany({
      where: { workflowExecutionId },
      select: { id: true }
    })
    const learningIds = savedLearnings.map(l => l.id)
    
    // Create the canvas with metadata for approval
    const canvasId = await createKnowledgeCanvas(
      workflowExecutionId,
      learnings,
      userId,
      {
        projectId,
        conversationId,
        repositoryUrl,
        learningIds
      },
      canvasTitle
    )

    if (!canvasId) {
      logger.info(`ℹ️ [KNOWLEDGE] No canvas created (possibly no learnings)`)
      return
    }

    const canvasUrl = getCanvasUrl(canvasId)
    logger.info(`📋 [KNOWLEDGE] Created canvas with URL: ${canvasUrl}`)
    
    // Post message to conversation
    const messageContent = JSON.stringify({
      version: '1.0',
      metadata: { botName: 'Knowledge Bot', timestamp: new Date().toISOString() },
      root: {
        type: 'flexLayout',
        props: {
          direction: 'column',
          gap: 12,
          padding: 16,
          background: '#F0F9FF',
          borderRadius: 8
        },
        children: [
          {
            type: 'singleLineText',
            props: {
              text: '💡 Knowledge Base Updated',
              weight: 'bold',
              size: 'md',
              color: '#0369A1'
            }
          },
          {
            type: 'singleLineText',
            props: {
              text: `Captured ${learnings.length} learnings from this workflow.`,
              weight: 'normal',
              size: 'sm',
              color: '#4A5568'
            }
          },
          {
            type: 'singleLineText',
            props: {
              text: `📋 View Canvas: ${canvasUrl}`,
              weight: 'normal',
              size: 'sm',
              color: '#0284C7'
            }
          }
        ]
      }
    })
    
    await repositories.messages.create({
      conversationId,
      senderId: 'Knowledge Bot',
      content: messageContent,
      msgType: 'BOT',
      hasAttachment: false,
    })
    
    logger.info(`✅ [KNOWLEDGE] Posted canvas link to conversation ${conversationId}`)
  }

  private async sendApprovalNudgeMessage(
    workflowExecutionId: string,
    stepId: string,
    _data: unknown
  ): Promise<void> {
    try {
      const execution = await prisma.workflowExecution.findUnique({
        where: { id: workflowExecutionId },
        select: { workflowId: true }
      })

      if (!execution?.workflowId) {
        logger.info(`ℹ️ [APPROVAL-NUDGE] No workflow found for execution ${workflowExecutionId}`)
        return
      }

      const workflow = await prisma.workflow.findUnique({
        where: { id: execution.workflowId },
        select: { ticketId: true, workflowName: true }
      })

      if (!workflow?.ticketId) {
        logger.info(`ℹ️ [APPROVAL-NUDGE] No ticket found for workflow ${execution.workflowId}`)
        return
      }

      const ticket = await prisma.ticket.findUnique({
        where: { id: workflow.ticketId },
        select: { conversationId: true, xyneId: true, workspaceId: true }
      })

      if (!ticket?.conversationId) {
        logger.info(`ℹ️ [APPROVAL-NUDGE] No conversation found for ticket ${workflow.ticketId}`)
        return
      }

      const workflowBot = await unifiedBotUserService.getBotByEmail('workflow-bot@bot.xyne.ai', ticket.workspaceId)
      const senderId = workflowBot?.id || 'Workflow Bot'

      const messageContent = `⏳ The workflow needs your input to proceed. Please visit Ticket Details section and resume the workflow.`

      await repositories.messages.create({
        conversationId: ticket.conversationId,
        senderId,
        content: messageContent,
        msgType: 'BOT',
        hasAttachment: false,
      })

      logger.info(`✅ [APPROVAL-NUDGE] Sent approval nudge to conversation ${ticket.conversationId} for step ${stepId}`)
    } catch (error) {
      logger.error(`❌ [APPROVAL-NUDGE] Failed to send approval nudge message:`, error)
    }
  }
}







