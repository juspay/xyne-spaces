import { Request, Response } from 'express';
import { AttachmentEntityType, MessageType, WorkflowExecutionMode } from '@xyne/shared';
import { WorkflowRepository } from '../database/repositories/workflowRepository';
import { DatabaseClient } from '@/database/client';
import { workflowRestoreService } from '../workflows/services/workflow-restore-service';
import { workflowDataService } from '../workflows/services/workflow-data-service';
import { workflowRerunService } from '../workflows/services/workflowRerunService';
import { randomUUID } from 'crypto';
import { DBWorkflowStorage } from '../workflows';
import { createUserMessage } from '@framework';
import { ticketService } from '../services/ticketService';
import { AI_STAGES, WorkflowExecutionStatus } from '@/workflows/types/workflow-enums';
import { logger } from '@/utils/logger';
import { config as appConfig } from '@/config/env';
import { getGitProvider } from '@/git-providers/factory';
import { extractWorkspace } from '../workflows/framework/agent-executor';
import { calculateDiffStats } from '@/utils/diffUtils';
import { redisService } from '@/services/redisService';
import { buildWorkflowStepKey, WORKFLOW_KEYS_SET } from '@/workflows/utils/workflowStepKeys';
import { getStorageService } from '@/services/storage';
import { v4 as uuidv4 } from 'uuid';
import { safeSerialize } from '../workflows/storage/serialization';
import { STEP_TYPES } from '../workflows/storage/step-types';
import { config } from '@/config/env';

export class WorkflowController {
  private workflowRepository: WorkflowRepository;

  constructor() {
    this.workflowRepository = new WorkflowRepository();
  }

  private async authorizeExecution(
    req: Request,
    res: Response,
    executionId: string
  ): Promise<boolean> {
    const callerWorkspaceId = req.user?.workspaceId;
    if (!callerWorkspaceId) {
      res.status(401).json({ error: 'Authentication required' });
      return false;
    }

    const prisma = DatabaseClient.getInstance();
    const execution = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
      select: { id: true, workspaceId: true, workflow: { select: { workspaceId: true } } },
    });

    const ownerWorkspaceId = execution?.workflow?.workspaceId ?? execution?.workspaceId ?? null;
    if (!execution || !ownerWorkspaceId || ownerWorkspaceId !== callerWorkspaceId) {
      if (execution) {
        logger.warn(
          `[WorkflowController] Cross-workspace execution access blocked: ${executionId} (${ownerWorkspaceId}) by user ${req.user?.id} (${callerWorkspaceId})`
        );
      }
      res.status(404).json({ error: 'Workflow execution not found' });
      return false;
    }
    return true;
  }

  private async authorizeStep(req: Request, res: Response, stepId: string): Promise<boolean> {
    const callerWorkspaceId = req.user?.workspaceId;
    if (!callerWorkspaceId) {
      res.status(401).json({ error: 'Authentication required' });
      return false;
    }

    const prisma = DatabaseClient.getInstance();
    const step = await prisma.workflowStep.findUnique({
      where: { id: stepId },
      select: {
        id: true,
        workspaceId: true,
        workflowExecution: {
          select: { workspaceId: true, workflow: { select: { workspaceId: true } } },
        },
      },
    });

    const ownerWorkspaceId =
      step?.workflowExecution?.workflow?.workspaceId ??
      step?.workflowExecution?.workspaceId ??
      step?.workspaceId ??
      null;
    if (!step || !ownerWorkspaceId || ownerWorkspaceId !== callerWorkspaceId) {
      if (step) {
        logger.warn(
          `[WorkflowController] Cross-workspace step access blocked: ${stepId} (${ownerWorkspaceId}) by user ${req.user?.id} (${callerWorkspaceId})`
        );
      }
      res.status(404).json({ error: 'Workflow step not found' });
      return false;
    }
    return true;
  }

  /**
   * Copy parent execution's agentic step data to new execution for rerun scenarios.
   * Loads from parent's Redis/GCS storage and copies to new execution's storage.
   * Optionally appends a user continuation message.
   */
  private async copyParentAgentStepsToExecution(
    parentExecutionId: string,
    parentInputStepId: string,
    newExecutionId: string,
    newInputStepDbId: string,
    stepName: string,
    continuationMessage?: string
  ): Promise<void> {
    const now = new Date();

    try {
      // 1. Load parent steps from Redis or GCS
      const parentRedisKey = buildWorkflowStepKey(parentExecutionId, stepName);
      let parentSteps: any[] = [];

      // Try Redis first
      const redisData = await redisService.lrange(parentRedisKey, 0, -1);
      if (redisData && redisData.length > 0) {
        parentSteps = redisData.map(item => JSON.parse(item));
        logger.info(`[WORKFLOW-CONTROLLER] Loaded ${parentSteps.length} steps from parent Redis for ${parentRedisKey}`);
      } else {
        // Fallback to GCS via MessageAttachment
        const { repositories } = await import('@/database/repositories');
        const attachments = await repositories.messageAttachments.findByEntityIdAndType(
          parentInputStepId,
          AttachmentEntityType.WORKFLOW_STEPS
        );

        if (attachments.length > 0 && attachments[0].url?.startsWith('gs://')) {
          const storageService = getStorageService(config.gcs.workflowStepsBucketName);
          const gcsPath = attachments[0].url.replace('gs://', '').split('/').slice(1).join('/');

          try {
            const fileBuffer = await storageService.getFileBuffer(gcsPath);
            if (fileBuffer) {
              const parsedContent = JSON.parse(fileBuffer.toString());
              parentSteps = Array.isArray(parsedContent) ? parsedContent : [parsedContent];
              logger.info(`[WORKFLOW-CONTROLLER] Loaded ${parentSteps.length} steps from parent GCS for ${stepName}`);
            }
          } catch (gcsError) {
            logger.warn(`[WORKFLOW-CONTROLLER] Failed to load from GCS ${gcsPath}:`, gcsError);
          }
        }
      }

      if (parentSteps.length === 0) {
        logger.warn(`[WORKFLOW-CONTROLLER] No parent steps found for ${parentExecutionId}:${stepName}`);
        return;
      }

      // 2. Create new Redis key and MessageAttachment for new execution
      const newRedisKey = buildWorkflowStepKey(newExecutionId, stepName);
      const newGcsPath = `workflows/${newExecutionId}/${stepName}.json`;
      const newGcsUrl = getStorageService(config.gcs.workflowStepsBucketName).buildStorageUri(newGcsPath);

      // Create MessageAttachment for new execution's step
      const { repositories } = await import('@/database/repositories');
      await repositories.messageAttachments.create({
        entityType: AttachmentEntityType.WORKFLOW_STEPS,
        entityId: newInputStepDbId,
        storageProvider: 'gcs',
        url: newGcsUrl,
        originalFilename: `${stepName}.json`,
        mimetype: 'application/json',
        size: 0,
        uploadedByUserId: 'system',
        createdBy: 'system',
        conversationId: null,
        workspaceId: config.defaultWorkspaceId,
        metadata: {
          workflowExecutionId: newExecutionId,
          checkpointId: stepName,
          workflowStepId: newInputStepDbId,
          copiedFromExecution: parentExecutionId
        }
      });

      // 3. Copy parent steps to new Redis key
      for (const step of parentSteps) {
        const stepWithTimestamp = { ...step, copiedAt: now.toISOString() };
        await redisService.rpush(newRedisKey, JSON.stringify(stepWithTimestamp));
      }

      // 4. Append continuation message if provided
      if (continuationMessage) {
        const userStepId = uuidv4();
        const userStep = {
          stepId: userStepId,
          stepName: 'user_message',
          type: 'input',
          data: safeSerialize({
            content: continuationMessage,
            role: 'user'
          }),
          status: 'completed',
          stepExecutorType: STEP_TYPES.AGENT,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString()
        };
        await redisService.rpush(newRedisKey, JSON.stringify(userStep));
        logger.info(`[WORKFLOW-CONTROLLER] Appended continuation message to ${newRedisKey}`);
      }

      // Set TTL (5 hours)
      await redisService.expire(newRedisKey, 18000);

      // Add the key to the global workflow keys set for tracking
      await redisService.sadd(WORKFLOW_KEYS_SET, newRedisKey);

      logger.info(`[WORKFLOW-CONTROLLER] Copied ${parentSteps.length} steps from parent ${parentExecutionId} to ${newExecutionId} for step ${stepName}`);
    } catch (error) {
      logger.error(`[WORKFLOW-CONTROLLER] Failed to copy parent agent steps: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  // ========== EXISTING METHODS ==========
  getWorkflowStepsByExecutionId = async (req: Request, res: Response): Promise<void> => {
    try {
      const { executionId } = req.params;

      const workflowSteps =
        await this.workflowRepository.getWorkflowStepsByExecutionId(executionId);

      if (workflowSteps.length === 0) {
        res.status(404).json({ error: 'No workflow steps found for this execution ID' });
        return;
      }

      // If we have GCS steps, use those instead of DB steps
      let responseSteps;
        // Use DB steps (original behavior)
        responseSteps = workflowSteps 
          .map((step) => ({
            id: step.id,
            workflowExecutionId: step.workflowExecutionId,
            stepExecutorType: step.stepExecutorType,
            stepName: step.stepName,
            type: step.type,
            previousStepId: step.previousStepId,
            data: step.data ? JSON.parse(step.data) : null,
            status: step.status,
            createdAt: step.createdAt,
            updatedAt: step.updatedAt,
          }));
      

      // Format the response with parsed JSON data
      const response = {
        workflowExecutionId: executionId,
        totalSteps: responseSteps.length,
        steps: responseSteps,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('Error getting workflow steps:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getWorkflowExecutionDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const { executionId } = req.params;

      const workflowExecution = await this.workflowRepository.getWorkflowExecutionById(executionId);

      if (!workflowExecution) {
        res.status(404).json({ error: 'Workflow execution not found' });
        return;
      }

      // Format the response with complete execution details
      const response = {
        workflowExecution: {
          id: workflowExecution.id,
          workflowId: workflowExecution.workflowId,
          status: workflowExecution.status,
          parentWorkflowExecutionId: workflowExecution.parentWorkflowExecutionId,
          sourceStepsId: workflowExecution.sourceStepsId,
          createdAt: workflowExecution.createdAt,
          updatedAt: workflowExecution.updatedAt,
        },
        workflow: {
          id: workflowExecution.workflow.id,
          ticketId: workflowExecution.workflow.ticketId,
          context: workflowExecution.workflow.context,
          status: workflowExecution.workflow.status,
          workflowName: workflowExecution.workflow.workflowName,
          metadata: workflowExecution.workflow.metadata
            ? JSON.parse(workflowExecution.workflow.metadata)
            : null,
          configuration: workflowExecution.workflow.configuration
            ? JSON.parse(workflowExecution.workflow.configuration)
            : null,
          workflowType: workflowExecution.workflow.workflowType,
          scheduledAt: workflowExecution.workflow.scheduledAt,
          createdAt: workflowExecution.workflow.createdAt,
          updatedAt: workflowExecution.workflow.updatedAt,
        },
        workflowSteps: workflowExecution.workflowSteps.map((step) => ({
          id: step.id,
          stepExecutorType: step.stepExecutorType,
          stepName: step.stepName,
          type: step.type,
          previousStepId: step.previousStepId,
          data: step.data ? JSON.parse(step.data) : null,
          status: step.status,
          createdAt: step.createdAt,
          updatedAt: step.updatedAt,
        })),
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('Error getting workflow execution details:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // ========== WORKFLOW CRUD METHODS ==========

  // GET: Get workflow by ID or list all workflows
  getWorkflows = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (id) {
        // Get specific workflow by ID
        const workflow = await this.workflowRepository.getWorkflowById(id);

        if (!workflow) {
          res.status(404).json({ error: 'Workflow not found' });
          return;
        }

        // Format the response
        const response = {
          id: workflow.id,
          ticketId: workflow.ticketId,
          context: workflow.context,
          status: workflow.status,
          workflowName: workflow.workflowName,
          metadata: workflow.metadata ? JSON.parse(workflow.metadata) : null,
          configuration: workflow.configuration ? JSON.parse(workflow.configuration) : null,
          workflowType: workflow.workflowType,
          scheduledAt: workflow.scheduledAt,
          createdAt: workflow.createdAt,
          updatedAt: workflow.updatedAt,
        };

        res.status(200).json(response);
      } else {
        // Get all workflows with pagination
        const page = req.query.page ? parseInt(req.query.page as string) : 1;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

        // Validate pagination parameters
        if (page < 1 || limit < 1 || limit > 100) {
          res.status(400).json({
            error: 'Invalid pagination parameters. Page must be >= 1, limit must be 1-100',
          });
          return;
        }

        const [workflows, totalCount] = await Promise.all([
          this.workflowRepository.getAllWorkflows(page, limit),
          this.workflowRepository.getWorkflowsCount(),
        ]);

        const response = workflows.map((workflow) => ({
          id: workflow.id,
          ticketId: workflow.ticketId,
          context: workflow.context,
          status: workflow.status,
          workflowName: workflow.workflowName,
          metadata: workflow.metadata ? JSON.parse(workflow.metadata) : null,
          configuration: workflow.configuration ? JSON.parse(workflow.configuration) : null,
          workflowType: workflow.workflowType,
          scheduledAt: workflow.scheduledAt,
          createdAt: workflow.createdAt,
          updatedAt: workflow.updatedAt,
        }));

        const totalPages = Math.ceil(totalCount / limit);

        res.status(200).json({
          workflows: response,
          pagination: {
            page,
            limit,
            total: totalCount,
            totalPages,
            hasNext: page < totalPages,
            hasPrevious: page > 1,
          },
        });
      }
    } catch (error) {
      logger.error('Error getting workflows:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // POST: Create workflow from form data (replaces old ticket creation workflow logic)
  createWorkflow = async (req: Request, res: Response): Promise<void> => {
    try {
      const { title, workflowType, description, ticketId, executorType, ...customFields } = req.body;
      // Validate required fields
      if (!title) {
        res.status(400).json({ error: 'title is required' });
        return;
      }

      if (!workflowType) {
        res.status(400).json({ error: 'workflowType is required' });
        return;
      }

      if (!ticketId) {
        res.status(400).json({ error: 'ticketId is required' });
        return;
      }

      // Import workflow registry
      const { workflowRegistry } = await import('../workflows');

      // workflowType is already a string, no need to cast
      const workflowTypeValue = workflowType;

      // Get workflow definition
      const def = workflowRegistry.get(workflowTypeValue as any);
      if (!def) {
        res.status(400).json({
          error: `Workflow definition not found for type ${workflowTypeValue}`,
        });
        return;
      }

      // Parse workflow input schema
      let parsedInput = {};
      if (def.inputSchema) {
        try {
          parsedInput = def.inputSchema.parse({
            title,
            description,
            workflowType,
            ticketId,
            ...customFields,
          });
        } catch (err: any) {
          const fieldErrors: Record<string, string> = {};
          if (Array.isArray(err?.issues)) {
            for (const { path, message } of err.issues) {
              if (path?.length > 0) {
                const key = String(path[0]);
                fieldErrors[key] ??= message;
              }
            }
          }
          res.status(400).json({
            error: 'Workflow input validation failed',
            details:
              err?.message || 'Workflow input validation failed. Please check the provided data.',
            fieldErrors,
          });
          return;
        }
      }

      // Ensure contextMapper exists
      if (!def.contextMapper) {
        res.status(500).json({
          error: `Workflow ${workflowTypeValue} does not define a contextMapper`,
        });
        return;
      }

      const imageAttachments = await ticketService.getImagesForTicket(ticketId);

      // Build context - add ticketId and imageAttachments to the parsed input
      const mappedContext = def.contextMapper({
        ...parsedInput,
        ticketId,
        title,
        description,
        imageAttachments,
        executorType: executorType || appConfig.workflow.defaultExecutor,
      });
      const context = {
        ...mappedContext,
        executorType: executorType || appConfig.workflow.defaultExecutor,
      };

      if (!context || typeof context !== 'object' || !Object.keys(context).length) {
        res.status(400).json({
          error: `contextMapper for workflow ${workflowTypeValue} returned an invalid or empty context.`,
        });
        return;
      }

      // Import workflow manager
      const { workflowManager } = await import('../workflows/services/workflowManager');

      // Start workflow and get the result
      const result = await workflowManager.startWorkflow({
        ticketId,
        workflowType: workflowTypeValue,
        context,
        createdBy: req.user?.id,
        metadata: {
          createdFrom: 'form',
          originalRequest: req.body,
        },
      });

      // Update ticket stage to "AI Implementation" after workflow creation
      const userId = req.user?.id || 'system';
      await ticketService.updateTicketStageForWorkflow(ticketId, userId, AI_STAGES.AI_PICKED_UP);

      // Check if conversationId is provided and create bot message
      const { conversationId} = req.body;

      if (conversationId) {
        const prisma = DatabaseClient.getInstance();
        const botMessageId = randomUUID();

        try {
          const messageMetadata = {
            workflowId: result.workflowId,
            workflowName: title,
            workflowType: workflowTypeValue,
            ticketId: ticketId,
            xyneId: ticketId,
            executorType: executorType || appConfig.workflow.defaultExecutor,
            useQuestioningMode: customFields.useQuestioningMode ?? false,
            model: customFields.model || appConfig.workflow.defaultModelName,
            createdBy: req.user?.name || req.user?.id || 'system',
          };

          const conversation = await prisma.conversation.findUniqueOrThrow({
            where: { conversationId },
            select: { workspaceId: true },
          });

          await prisma.message.create({
            data: {
              messageId: botMessageId,
              conversationId,
              senderId: req.user?.id || 'system',
              workspaceId: conversation.workspaceId,
              content: ``,
              msgType: MessageType.SYSTEM,
              metadata: messageMetadata,
            },
          });
          logger.info(
            `Bot message created for workflow ${result.workflowId} in conversation ${conversationId}`
          );
        } catch (messageError) {
          logger.error('Failed to create bot message for workflow:', messageError);
        } finally {
          await prisma.$disconnect();
        }
      }

      // Get the created workflow and execution details for response
      const workflow = await this.workflowRepository.getWorkflowById(result.workflowId);
      const execution = await this.workflowRepository.getWorkflowExecutionByIdSimple(
        result.executionId
      );

      if (!workflow || !execution) {
        res.status(500).json({ error: 'Failed to retrieve created workflow or execution' });
        return;
      }

      // Format response
      const response = {
        workflow: {
          id: workflow.id,
          ticketId: workflow.ticketId,
          status: workflow.status,
          workflowType: workflow.workflowType,
          workflowName: workflow.workflowName,
          createdAt: workflow.createdAt,
        },
        execution: {
          id: execution.id,
          workflowId: execution.workflowId,
          status: execution.status,
          tag: execution.tag,
          createdAt: execution.createdAt,
        },
        message: 'Workflow created and queued for execution',
      };

      res.status(201).json(response);
    } catch (error) {
      logger.error('Error creating workflow from form:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  // PUT: Update workflow
  updateWorkflow = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const updateData = req.body;

      // Convert metadata and configuration to JSON strings if they are objects
      if (updateData.metadata && typeof updateData.metadata === 'object') {
        updateData.metadata = JSON.stringify(updateData.metadata);
      }
      if (updateData.configuration && typeof updateData.configuration === 'object') {
        updateData.configuration = JSON.stringify(updateData.configuration);
      }

      const workflow = await this.workflowRepository.updateWorkflow(id, updateData);

      const response = {
        id: workflow.id,
        ticketId: workflow.ticketId,
        context: workflow.context,
        status: workflow.status,
        workflowName: workflow.workflowName,
        metadata: workflow.metadata ? JSON.parse(workflow.metadata) : null,
        configuration: workflow.configuration ? JSON.parse(workflow.configuration) : null,
        workflowType: workflow.workflowType,
        scheduledAt: workflow.scheduledAt,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('Error updating workflow:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // ========== WORKFLOW EXECUTION CRUD METHODS ==========

  // GET: Get workflow execution by ID or list all executions
  getWorkflowExecutions = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (id) {
        // Get specific workflow execution by ID
        const execution = await this.workflowRepository.getWorkflowExecutionByIdSimple(id);

        if (!execution) {
          res.status(404).json({ error: 'Workflow execution not found' });
          return;
        }

        res.status(200).json(execution);
      } else {
        // Get all workflow executions with pagination
        const page = req.query.page ? parseInt(req.query.page as string) : 1;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

        // Validate pagination parameters
        if (page < 1 || limit < 1 || limit > 100) {
          res.status(400).json({
            error: 'Invalid pagination parameters. Page must be >= 1, limit must be 1-100',
          });
          return;
        }

        const [executions, totalCount] = await Promise.all([
          this.workflowRepository.getAllWorkflowExecutionsSimple(page, limit),
          this.workflowRepository.getWorkflowExecutionsCount(),
        ]);

        const totalPages = Math.ceil(totalCount / limit);

        res.status(200).json({
          workflowExecutions: executions,
          pagination: {
            page,
            limit,
            total: totalCount,
            totalPages,
            hasNext: page < totalPages,
            hasPrevious: page > 1,
          },
        });
      }
    } catch (error) {
      logger.error('Error getting workflow executions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // POST: Create new workflow execution
  createWorkflowExecution = async (req: Request, res: Response): Promise<void> => {
    try {
      const executionData = req.body;

      // Validate required fields
      if (!executionData.workflowId) {
        res.status(400).json({ error: 'workflowId is required' });
        return;
      }

      const execution = await this.workflowRepository.createWorkflowExecution(executionData);
      res.status(201).json(execution);
    } catch (error) {
      logger.error('Error creating workflow execution:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // PUT: Update workflow execution
  updateWorkflowExecution = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      if (!(await this.authorizeExecution(req, res, id))) return;
      const updateData = req.body;

      const execution = await this.workflowRepository.updateWorkflowExecution(id, updateData);
      res.status(200).json(execution);
    } catch (error) {
      logger.error('Error updating workflow execution:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // ========== WORKFLOW STEP CRUD METHODS ==========

  // GET: Get workflow step by ID or list all steps
  getWorkflowSteps = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (id) {
        // Get specific workflow step by ID
        const step = await this.workflowRepository.getWorkflowStepById(id);

        if (!step) {
          res.status(404).json({ error: 'Workflow step not found' });
          return;
        }

        // Format the response with parsed JSON data
        const response = {
          id: step.id,
          workflowExecutionId: step.workflowExecutionId,
          stepExecutorType: step.stepExecutorType,
          stepName: step.stepName,
          type: step.type,
          previousStepId: step.previousStepId,
          data: step.data ? JSON.parse(step.data) : null,
          status: step.status,
          createdAt: step.createdAt,
          updatedAt: step.updatedAt,
        };

        res.status(200).json(response);
      } else {
        // Get all workflow steps with pagination
        const page = req.query.page ? parseInt(req.query.page as string) : 1;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

        // Validate pagination parameters
        if (page < 1 || limit < 1 || limit > 100) {
          res.status(400).json({
            error: 'Invalid pagination parameters. Page must be >= 1, limit must be 1-100',
          });
          return;
        }

        const [steps, totalCount] = await Promise.all([
          this.workflowRepository.getAllWorkflowSteps(page, limit),
          this.workflowRepository.getWorkflowStepsCount(),
        ]);

        const response = steps.map((step) => ({
          id: step.id,
          workflowExecutionId: step.workflowExecutionId,
          stepExecutorType: step.stepExecutorType,
          stepName: step.stepName,
          type: step.type,
          previousStepId: step.previousStepId,
          // Step payloads are returned by the by-id route, not in the list.
          status: step.status,
          createdAt: step.createdAt,
          updatedAt: step.updatedAt,
        }));

        const totalPages = Math.ceil(totalCount / limit);

        res.status(200).json({
          workflowSteps: response,
          pagination: {
            page,
            limit,
            total: totalCount,
            totalPages,
            hasNext: page < totalPages,
            hasPrevious: page > 1,
          },
        });
      }
    } catch (error) {
      logger.error('Error getting workflow steps:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // POST: Create new workflow step
  createWorkflowStep = async (req: Request, res: Response): Promise<void> => {
    try {
      const stepData = req.body;

      // Validate required fields
      if (!stepData.workflowExecutionId) {
        res.status(400).json({ error: 'workflowExecutionId is required' });
        return;
      }

      // Convert data to JSON string if it's an object
      if (stepData.data && typeof stepData.data === 'object') {
        stepData.data = JSON.stringify(stepData.data);
      }

      const step = await this.workflowRepository.createWorkflowStep(stepData);

      const response = {
        id: step.id,
        workflowExecutionId: step.workflowExecutionId,
        stepExecutorType: step.stepExecutorType,
        stepName: step.stepName,
        type: step.type,
        previousStepId: step.previousStepId,
        data: step.data ? JSON.parse(step.data) : null,
        status: step.status,
        createdAt: step.createdAt,
        updatedAt: step.updatedAt,
      };

      res.status(201).json(response);
    } catch (error) {
      logger.error('Error creating workflow step:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // PUT: Update workflow step
  updateWorkflowStep = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      if (!(await this.authorizeStep(req, res, id))) return;
      const updateData = req.body;

      // Convert data to JSON string if it's an object
      if (updateData.data && typeof updateData.data === 'object') {
        updateData.data = JSON.stringify(updateData.data);
      }

      const step = await this.workflowRepository.updateWorkflowStep(id, updateData);

      const response = {
        id: step.id,
        workflowExecutionId: step.workflowExecutionId,
        stepExecutorType: step.stepExecutorType,
        stepName: step.stepName,
        type: step.type,
        previousStepId: step.previousStepId,
        data: step.data ? JSON.parse(step.data) : null,
        status: step.status,
        createdAt: step.createdAt,
        updatedAt: step.updatedAt,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('Error updating workflow step:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // ========== WORKFLOW RESTORE METHODS ==========

  // POST: Create rerun execution from a restore point
  restoreWorkflowExecution = async (req: Request, res: Response): Promise<void> => {
    try {
      const { executionId } = req.params;
      if (!(await this.authorizeExecution(req, res, executionId))) return;
      const { stepId } = req.body;

      // Validate required fields
      if (!stepId) {
        res.status(400).json({ error: 'stepId is required (DB ID of INPUT step)' });
        return;
      }

      const restoreStep = await this.workflowRepository.getWorkflowStepById(stepId);
      if (!restoreStep || restoreStep.workflowExecutionId !== executionId) {
        logger.warn(
          `[WorkflowController] Restore step ${stepId} does not belong to execution ${executionId}; rejecting restore`
        );
        res.status(404).json({ error: 'Step not found' });
        return;
      }

      // Create rerun execution (with lift-to-root logic for child workflows)
      const restoreResult = await workflowRestoreService.createRerunExecution({
        sourceExecutionId: executionId,
        restoreStepId: stepId,
      });

      res.status(201).json({
        rerunExecutionId: restoreResult.rerunExecutionId,
        actualRestoreStepId: restoreResult.actualRestoreStepId,
        actualRestoreStepName: restoreResult.actualRestoreStepName,
        liftedToParallel: restoreResult.liftedToParallel,
        liftChain: restoreResult.liftChain,
        sourceRootExecutionId: restoreResult.sourceRootExecutionId,
        message: restoreResult.liftedToParallel
          ? `Restore point lifted from child workflow to parallel step: ${restoreResult.actualRestoreStepName} (${restoreResult.actualRestoreStepId})`
          : `Rerun execution created from step: ${restoreResult.actualRestoreStepName} (${restoreResult.actualRestoreStepId})`,
      });
    } catch (error) {
      logger.error('Error restoring workflow execution:', error);
      res.status(500).json({
        error: 'Failed to restore workflow execution',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  // POST: Create rerun execution from start (no restore point)
  rerunWorkflowFromStart = async (req: Request, res: Response): Promise<void> => {
    try {
      const { executionId } = req.params;
      if (!(await this.authorizeExecution(req, res, executionId))) return;

      // Use workflow rerun service
      const result = await workflowRerunService.rerunFromExecution(executionId);

      res.status(201).json({
        rerunExecutionId: result.rerunExecutionId,
        sourceExecutionId: result.sourceExecutionId,
        originalRequestedExecutionId: result.originalRequestedExecutionId,
        usedRootExecution: result.usedRootExecution,
        message: result.message,
      });
    } catch (error) {
      logger.error('Error creating rerun from start:', error);

      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          error: error.message,
        });
        return;
      }

      res.status(500).json({
        error: 'Failed to create rerun from start',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  continueAgenticStep = async (req: Request, res: Response): Promise<void> => {
    try {
      const { executionId } = req.params;
      if (!(await this.authorizeExecution(req, res, executionId))) return;
      const { stepId, message } = req.body;

      // Validate required fields
      if (!stepId) {
        res.status(400).json({ error: 'stepId is required (DB ID of agentic step INPUT)' });
        return;
      }

      // Get the step to find its stepName for the Redis channel
      const step = await this.workflowRepository.getWorkflowStepById(stepId);
      if (!step) {
        res.status(404).json({ error: 'Step not found' });
        return;
      }

      if (step.workflowExecutionId !== executionId) {
        logger.warn(
          `[WorkflowController] Step ${stepId} does not belong to execution ${executionId}; rejecting continue`
        );
        res.status(404).json({ error: 'Step not found' });
        return;
      }

      if (step.stepExecutorType !== 'agent') {
        res.status(400).json({ error: 'Step is not an agentic step' });
        return;
      }

      // Get execution status and mode
      const execution = await this.workflowRepository.getWorkflowExecutionByIdSimple(executionId);
      const mode = await this.workflowRepository.getExecutionMode(executionId);
      const hasOutput = await this.workflowRepository.agentStepHasOutput(stepId);

      // Bind the authorized object to the mutated one before any Redis publish.
      // getWorkflowExecutionByIdSimple is workspace-scoped, so a null execution means
      // the id is outside the caller's workspace — reject instead of falling through to the
      // normal-continuation branch that publishes into `workflow:<executionId>:...`.
      // Additionally require the step to belong to THIS execution.
      if (!execution) {
        res.status(404).json({ error: 'Execution not found' });
        return;
      }
      if (step.workflowExecutionId !== executionId) {
        res.status(403).json({ error: 'Step does not belong to this execution' });
        return;
      }

      // If step already has output, create a rerun execution instead of continuing
      if (hasOutput) {
        if (!execution) {
          res.status(404).json({ error: 'Execution not found' });
          return;
        }

        // Validate message is provided for rerun
        if (!message || typeof message !== 'string' || message.trim() === '') {
          res.status(400).json({ error: 'message is required for rerun (user input to continue the conversation)' });
          return;
        }

        // Create rerun execution with:
        // - parentWorkflowExecutionId: current executionId
        // - status: PENDING (for worker to pick up)
        // - sourceStepsId: the INPUT step ID
        // - tag: 'rerun'
        // - stepInputOverrideData: contains continuation info for workflow-engine
        const rerunExecution = await this.workflowRepository.createWorkflowExecution({
          workflowId: execution.workflowId,
          workflowType: execution.workflowType || null,
          context: execution.context || null,
          output: null,
          status: WorkflowExecutionStatus.PENDING,
          tag: 'rerun',
          parentWorkflowExecutionId: executionId,
          sourceStepsId: stepId,
          stepInputOverrideData: JSON.stringify({
            continuationUserMessage: message.trim(),
            sourceChildExecutionId: executionId,
            targetStepId: step.stepName
          }),
          ignoreDuration: 0,
          mode: WorkflowExecutionMode.MANUAL,
          createdBy: execution.createdBy || null,
        });

        logger.info(`[WORKFLOW-CONTROLLER] Created rerun execution ${rerunExecution.id} for step ${stepId} with existing output`);

        // Create INPUT step for the new execution by copying parent's input step
        const newInputStep = await this.workflowRepository.createWorkflowStep({
          workflowExecutionId: rerunExecution.id,
          stepExecutorType: step.stepExecutorType,
          stepName: step.stepName,
          type: step.type,
          data: step.data,
          status: step.status,
          previousStepId: step.previousStepId,
          stepSubType: step.stepSubType,
          markdownSummary: step.markdownSummary,
          attachment: step.attachment,
        });

        // Copy parent agent steps to new execution
        await this.copyParentAgentStepsToExecution(
          executionId,           // Parent execution ID
          stepId,                // Parent's INPUT step ID
          rerunExecution.id,     // New execution ID
          newInputStep.id,       // New INPUT step ID
          step.stepName!,        // Step name
          message.trim()         // User's continuation message
        );

        logger.info(`[WORKFLOW-CONTROLLER] Created INPUT step ${newInputStep.id} and copied parent steps for rerun ${rerunExecution.id}`);

        res.status(201).json({
          rerunExecutionId: rerunExecution.id,
          sourceExecutionId: executionId,
          sourceStepId: stepId,
          stepName: step.stepName,
          message: 'Created rerun execution for step with existing output'
        });
        return;
      }

      // If execution is WAIT_FOR_EVENT in MANUAL mode, or FAILURE/CANCELLED/PAUSED (regardless of mode)
      if ((execution?.status === 'WAIT_FOR_EVENT' && mode === 'MANUAL') || execution?.status === 'FAILURE' || execution?.status === 'CANCELLED' || execution?.status === 'PAUSED') {
        if(!message)
        {
          // this is for continuation or go to next steps

          // just mark the execution as pending to trigger the agent to continue with the next steps (if any)
          await this.workflowRepository.updateWorkflowExecution(executionId, { status: 'PENDING' });
          // change mode to AUTOMATIC
          await this.workflowRepository.setExecutionMode(executionId, WorkflowExecutionMode.AUTOMATIC);
          res.status(200).json({
            executionId,
            stepId,
            stepName: step.stepName,
            message: `Execution marked as pending`,
          });
          return;
        }
        else
        {
          if (!message || typeof message !== 'string' || message.trim() === '') {
        res.status(400).json({ error: 'message is required (user input to continue the conversation)' });
        return;
      }
          try {
            const perStepKey = buildWorkflowStepKey(executionId, step.stepName || 'unknown');
            const exists = await redisService.exists(perStepKey);

            // Build redis representation of the user message using framework helper
            const userMsg = createUserMessage(message.trim());
            const userStepId = randomUUID();
            const nowIso = new Date().toISOString();
            const redisUserStep = {
              stepId: userStepId,
              stepName: 'user_message',
              type: 'input',
              data: typeof userMsg === 'string' ? userMsg : JSON.stringify(userMsg),
              status: 'completed',
              stepExecutorType: 'agent',
              createdAt: nowIso,
              updatedAt: nowIso
            };

            if (exists) {
              // Redis already has data, just append the user message
              await redisService.rpush(perStepKey, JSON.stringify(redisUserStep));
              await redisService.expire(perStepKey, 18000); // 5 hours
            } else {
              // Fetch from GCS and append user message at the end
              try {
                const gcsSteps = await this.workflowRepository.fetchAgentStepsFromAttachment(step.id, executionId!, step.stepName || 'unknown');

                if (Array.isArray(gcsSteps) && gcsSteps.length > 0) {
                  // Push GCS steps as-is since they're already in the correct format
                  for (const s of gcsSteps) {
                    await redisService.rpush(perStepKey, JSON.stringify(s));
                  }
                }
              } catch (innerErr) {
                logger.warn(`[WORKFLOW-CONTROLLER] Failed to fetch agentic steps from storage for ${executionId}:${step.stepName}:`, innerErr);
              }

              // Always push the user message at the end
              await redisService.rpush(perStepKey, JSON.stringify(redisUserStep));
              await redisService.expire(perStepKey, 18000); // 5 hours

              // Add the key to the global workflow keys set for tracking (first time creation)
              await redisService.sadd(WORKFLOW_KEYS_SET, perStepKey);
            }
          } catch (redisErr) {
            logger.error(`[WORKFLOW-CONTROLLER] Failed to push user message into per-step Redis for ${executionId}:${step.stepName}:`, redisErr);
          }


          // Resume execution
          await this.workflowRepository.updateWorkflowExecution(executionId, { status: 'PENDING' });

          res.status(200).json({
            executionId,
            stepId,
            stepName: step.stepName,
            message: `Message stored for next agent iteration. Execution resumed.`,
          });
          return;
        }
        }
         else {
          // Normal continuation (agent is running, not in external wait)
      await redisService.publishAgentContinuation(executionId, step.stepName || 'unknown', message.trim());

      res.status(202).json({
        executionId,
        stepId,
        stepName: step.stepName,
      });
      }

      
    } catch (error) {
      logger.error('Error continuing agentic step:', error);

      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
        return;
      }

      if (error instanceof Error && error.message.includes('not an agentic')) {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({
        error: 'Failed to continue agentic step',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  // GET: Get effective restore point (preview what will be restored)
  getEffectiveRestorePoint = async (req: Request, res: Response): Promise<void> => {
    try {
      const { executionId } = req.params;
      const { stepId } = req.query;

      if (!stepId || typeof stepId !== 'string') {
        res.status(400).json({ error: 'stepId query parameter is required (DB ID of INPUT step)' });
        return;
      }

      const effectivePoint = await workflowRestoreService.getEffectiveRestorePoint(
        executionId,
        stepId
      );

      res.status(200).json({
        effectiveExecutionId: effectivePoint.effectiveExecutionId,
        effectiveStepId: effectivePoint.effectiveStepId,
        effectiveStepName: effectivePoint.effectiveStepName,
        liftedToParallel: effectivePoint.liftedToParallel,
        liftChain: effectivePoint.liftChain,
        message: effectivePoint.liftedToParallel
          ? `Restore will be lifted to parallel step: ${effectivePoint.effectiveStepName} (${effectivePoint.effectiveStepId})`
          : `Restore will resume from step: ${effectivePoint.effectiveStepName} (${effectivePoint.effectiveStepId})`,
      });
    } catch (error) {
      logger.error('Error getting effective restore point:', error);
      res.status(500).json({
        error: 'Failed to get effective restore point',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  // ========== WORKFLOW EXECUTION CONTROL METHODS ==========

  // PUT: Pause workflow execution
  pauseWorkflowExecution = async (req: Request, res: Response): Promise<void> => {
    try {
      const { executionId } = req.params;
      if (!(await this.authorizeExecution(req, res, executionId))) return;

      // Import workflowManager dynamically to avoid circular dependencies
      const { workflowManager } = await import('../workflows/services/workflowManager');

      // Pause the workflow
      await workflowManager.pauseWorkflow(executionId);

      // Get updated execution details
      const execution = await this.workflowRepository.getWorkflowExecutionByIdSimple(executionId);

      res.status(200).json({
        success: true,
        message: 'Workflow execution paused successfully',
        execution,
      });
    } catch (error) {
      logger.error('Error pausing workflow execution:', error);

      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          res.status(404).json({
            success: false,
            error: error.message,
          });
          return;
        }
        if (error.message.includes('not active')) {
          res.status(400).json({
            success: false,
            error: error.message,
          });
          return;
        }
      }

      res.status(500).json({
        success: false,
        error: 'Failed to pause workflow execution',
      });
    }
  };

  // PUT: Resume workflow execution
  resumeWorkflowExecution = async (req: Request, res: Response): Promise<void> => {
    try {
      const { executionId } = req.params;
      if (!(await this.authorizeExecution(req, res, executionId))) return;

      // Import workflowManager dynamically to avoid circular dependencies
      const { workflowManager } = await import('../workflows/services/workflowManager');

      // Resume the workflow
      await workflowManager.resumeWorkflow(executionId);

      // Get updated execution details
      const execution = await this.workflowRepository.getWorkflowExecutionByIdSimple(executionId);

      res.status(200).json({
        success: true,
        message: 'Workflow execution resumed successfully',
        execution,
      });
    } catch (error) {
      logger.error('Error resuming workflow execution:', error);

      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          res.status(404).json({
            success: false,
            error: error.message,
          });
          return;
        }
        if (error.message.includes('not paused')) {
          res.status(400).json({
            success: false,
            error: error.message,
          });
          return;
        }
      }

      res.status(500).json({
        success: false,
        error: 'Failed to resume workflow execution',
      });
    }
  };

  // PUT: Cancel workflow execution
  cancelWorkflowExecution = async (req: Request, res: Response): Promise<void> => {
    try {
      const { executionId } = req.params;
      if (!(await this.authorizeExecution(req, res, executionId))) return;

      // Import workflowManager dynamically to avoid circular dependencies
      const { workflowManager } = await import('../workflows/services/workflowManager');

      // Cancel the workflow
      await workflowManager.cancelWorkflow(executionId);

      // Get updated execution details
      const execution = await this.workflowRepository.getWorkflowExecutionByIdSimple(executionId);

      res.status(200).json({
        success: true,
        message: 'Workflow execution cancelled successfully',
        execution,
      });
    } catch (error) {
      logger.error('Error cancelling workflow execution:', error);

      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          res.status(404).json({
            success: false,
            error: error.message,
          });
          return;
        }
        if (error.message.includes('terminal status')) {
          res.status(400).json({
            success: false,
            error: error.message,
          });
          return;
        }
      }

      res.status(500).json({
        success: false,
        error: 'Failed to cancel workflow execution',
      });
    }
  };

  isWorkflowExecutionLocked = async (req: Request, res: Response): Promise<void> => {
    try {
      const { executionId } = req.params;
      const db = DatabaseClient.getInstance();

      const lock = await db.workflowExecutionLock.findUnique({
        where: {
          workflowExecutionId: executionId,
        },
      });

      res.status(200).json({ isLocked: !!lock });
    } catch (error) {
      logger.error('Error checking workflow execution lock:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // ========== WORKFLOW STEP DATA METHODS ==========

  /**
   * GET: Get all step data (input/output) that occurred before a specific input step,
   * including data from parent executions if this is a rerun.
   *
   * Route: GET /api/workflows/steps/:stepId/preceding-steps
   */
  getPrecedingSteps = async (req: Request, res: Response): Promise<void> => {
    try {
      const { stepId } = req.params;

      // Validate required parameters
      if (!stepId) {
        res.status(400).json({ error: 'stepId is required (DB ID of the input step)' });
        return;
      }

      // Get the preceding steps
      const result = await workflowDataService.getPrecedingSteps(stepId);

      res.status(200).json(result);
    } catch (error) {
      logger.error('Error getting preceding steps:', error);

      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          res.status(404).json({
            error: 'Resource not found',
            message: error.message,
          });
          return;
        }
      }

      res.status(500).json({
        error: 'Failed to get preceding steps',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  getCombinedStepsLight = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticketId } = req.params;
      const { executionId, workflowId } = req.query;
      let combinedSteps;
      if (executionId && typeof executionId === 'string') {
        combinedSteps = await this.workflowRepository.getSingleExecutionSteps(
          ticketId,
          executionId
        );
      } else 
        if (workflowId && typeof workflowId === 'string') {
        combinedSteps = await this.workflowRepository.getCombinedWorkflowStepsByWorkflowId(
          ticketId,
          workflowId
        );
      } else {
        combinedSteps =
          await this.workflowRepository.getCombinedWorkflowStepsLightWithMetadata(ticketId);
      }

      if (!combinedSteps) {
        res.status(404).json({ error: 'Ticket not found or no workflow steps available' });
        return;
      }

      res.status(200).json(combinedSteps);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getWorkflowStepDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const { stepId } = req.params;

      const stepDetails = await this.workflowRepository.getWorkflowStepDetails(stepId);

      if (!stepDetails) {
        res.status(404).json({ error: 'Step not found' });
        return;
      }

      const response = {
        stepName: stepDetails.stepName,
        input: stepDetails.input
          ? {
              ...stepDetails.input,
              data: stepDetails.input.data ? JSON.parse(stepDetails.input.data) : null,
            }
          : null,
        output: stepDetails.output
          ? {
              ...stepDetails.output,
              data: stepDetails.output.data ? JSON.parse(stepDetails.output.data) : null,
            }
          : null,
        workflowExecution: stepDetails.workflowExecution,
        originalStep: stepDetails.originalStep,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('Error getting step details:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getWorkflowGitDiff = async (req: Request, res: Response): Promise<void> => {
    try {
      const { executionId } = req.params;

      if (!executionId) {
        res.status(400).json({
          error: 'Execution ID is required',
          message: 'Please provide a valid execution ID',
        });
        return;
      }

      const storage = new DBWorkflowStorage();
      const gitInfo = await storage.getExecutionGitInfo(executionId);

      if (!gitInfo || !gitInfo.repoUrl || !gitInfo.branch) {
        res.status(404).json({
          error: 'Git information not found',
          message: 'This workflow execution does not have any git information available',
        });
        return;
      }

      const parsed = extractWorkspace(gitInfo.repoUrl);
      if (!parsed) {
        res.status(404).json({
          error: 'Git diff not available',
          message: 'Could not parse repository information',
        });
        return;
      }
      const gitProvider = getGitProvider(gitInfo.repoUrl);
      let gitDiff: any[];
      let diffStats: any;
      let commitHash = gitInfo.commitHash;
      
      // Try PR diff first if PR link exists
      if (gitInfo.pr_link) {
        const prUrl = gitInfo.pr_link;
        const prId = gitProvider.extractPRIdFromUrl(prUrl);
        
        if (prId) {
          logger.info(`[getWorkflowGitDiff] Fetching PR diff for PR #${prId}`);
          
          gitDiff = await gitProvider.getPRDiff(parsed.projectName, parsed.repoName, prId);
          
          if (gitDiff.length > 0) {
            diffStats = calculateDiffStats(gitDiff);
            logger.info(`[getWorkflowGitDiff] Successfully fetched PR diff: ${diffStats.files} files changed`);

            res.status(200).json({
              executionId,
              branch: gitInfo.branch,
              baseCommitHash: gitInfo.baseCommitHash,
              commitHash: gitInfo.commitHash,
              gitDiff: gitDiff,
              stats: diffStats,
            });
            return;
          } else {
            logger.warn(`[getWorkflowGitDiff] PR diff empty for PR #${prId}, falling back to branch diff`);
          }
        } else {
          logger.warn(`[getWorkflowGitDiff] Could not extract PR ID from ${prUrl}, falling back to branch diff`);
        }
      }
      
      // Fallback to branch diff - get latest commit
      const latest = await gitProvider.getLatestCommit(parsed.projectName, parsed.repoName, gitInfo.branch);
      if (latest) {
        commitHash = latest.id;
        logger.info(`[getWorkflowGitDiff] Fetching branch diff for latest commit: ${commitHash}`);
        gitDiff = await gitProvider.getDiff(
          parsed.projectName, 
          parsed.repoName, 
          gitInfo.baseCommitHash || commitHash, 
          commitHash
        );
        diffStats = calculateDiffStats(gitDiff);

        res.status(200).json({
          executionId,
          branch: gitInfo.branch,
          baseCommitHash: gitInfo.baseCommitHash,
          commitHash: commitHash,
          gitDiff: gitDiff,
          stats: diffStats,
        });
        return;
      }

      // If we reach here, we couldn't get the diff
      res.status(404).json({
        error: 'Git diff not available',
        message: 'Could not fetch git diff from repository',
      });
    } catch (error) {
      logger.error('Error getting git diff:', error);

      res.status(500).json({
        error: 'Failed to get git diff',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  // PUT: Set execution mode (MANUAL/AUTOMATIC) for workflow execution
  // This is used to switch between MANUAL mode (agent stays in executor) and AUTOMATIC mode (return to workflow-engine)
  setExecutionMode = async (req: Request, res: Response): Promise<void> => {
    try {
      const { executionId } = req.params;
      if (!(await this.authorizeExecution(req, res, executionId))) return;
      const { mode } = req.body;

      // Validate required fields
      if (!mode || !['MANUAL', 'AUTOMATIC'].includes(mode)) {
        res.status(400).json({
          error: 'mode is required and must be either "MANUAL" or "AUTOMATIC"'
        });
        return;
      }

      // Get the current execution to verify it exists
      const execution = await this.workflowRepository.getWorkflowExecutionByIdSimple(executionId);
      if (!execution) {
        res.status(404).json({ error: 'Workflow execution not found' });
        return;
      }

      // Update mode in database
      await this.workflowRepository.setExecutionMode(executionId, mode);

      // Publish mode change event via Redis pub/sub
      await redisService.publishModeChange(executionId, mode);

      logger.info(`🎛️ [WORKFLOW-CONTROLLER] Set execution mode to ${mode} for ${executionId}`);

      res.status(200).json({
        success: true,
        executionId,
        mode,
        message: `Execution mode set to ${mode}. ${mode === 'AUTOMATIC' ? 'Agent will proceed to workflow-engine on next completion.' : 'Agent will stay in executor on completion.'}`
      });
    } catch (error) {
      logger.error('Error setting execution mode:', error);

      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          error: error.message
        });
        return;
      }

      res.status(500).json({
        error: 'Failed to set execution mode',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  // GET: Get execution mode for workflow execution
  getExecutionMode = async (req: Request, res: Response): Promise<void> => {
    try {
      const { executionId } = req.params;

      // Get the current execution to verify it exists
      const execution = await this.workflowRepository.getWorkflowExecutionByIdSimple(executionId);
      if (!execution) {
        res.status(404).json({ error: 'Workflow execution not found' });
        return;
      }

      // Get mode from database (defaults to 'AUTOMATIC' if not set)
      const mode = await this.workflowRepository.getExecutionMode(executionId);

      res.status(200).json({
        executionId,
        mode
      });
    } catch (error) {
      logger.error('Error getting execution mode:', error);

      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          error: error.message
        });
        return;
      }

      res.status(500).json({
        error: 'Failed to get execution mode',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}
