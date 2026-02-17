import { Request, Response } from 'express';
import { WorkflowRepository } from '../database/repositories/workflowRepository';
import { DatabaseClient } from '@/database/client';
import { workflowRestoreService } from '../workflows/services/workflow-restore-service';
import { workflowDataService } from '../workflows/services/workflow-data-service';
import { workflowRerunService } from '../workflows/services/workflowRerunService';
import { randomUUID } from 'crypto';
import { DBWorkflowStorage } from '../workflows';
import { ticketService } from '../services/ticketService';
import { AI_STAGES } from '@/workflows/types/workflow-enums';
import { logger } from '@/utils/logger';
import { config as appConfig } from '@/config/env';
import { bitbucketManager } from '../bitbucket/apis';
import { extractWorkspace } from '../workflows/framework/agent-executor';
import { calculateDiffStats } from '@/utils/diffUtils';

export class WorkflowController {
  private workflowRepository: WorkflowRepository;

  constructor() {
    this.workflowRepository = new WorkflowRepository();
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

      // Format the response with parsed JSON data
      const response = {
        workflowExecutionId: executionId,
        totalSteps: workflowSteps.length,
        steps: workflowSteps.map((step) => ({
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
        })),
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
          res.status(400).json({
            error: 'Workflow input validation failed',
            details:
              err?.message || 'Workflow input validation failed. Please check the provided data.',
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
          };

          await prisma.message.create({
            data: {
              messageId: botMessageId,
              conversationId,
              senderId: req.user?.id || 'system',
              content: ``,
              msgType: 'SYSTEM',
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
          data: step.data ? JSON.parse(step.data) : null,
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
      const { stepId } = req.body;

      // Validate required fields
      if (!stepId) {
        res.status(400).json({ error: 'stepId is required (DB ID of INPUT step)' });
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

  // POST: Continue an agentic step with user input (preserves conversation history)
  continueAgenticStep = async (req: Request, res: Response): Promise<void> => {
    try {
      const { executionId } = req.params;
      const { stepId, message } = req.body;

      // Validate required fields
      if (!stepId) {
        res.status(400).json({ error: 'stepId is required (DB ID of agentic step INPUT)' });
        return;
      }

      if (!message || typeof message !== 'string' || message.trim() === '') {
        res
          .status(400)
          .json({ error: 'message is required (user input to continue the conversation)' });
        return;
      }

      // Create continuation rerun
      const result = await workflowRestoreService.createContinuationRerun({
        sourceExecutionId: executionId,
        agenticStepId: stepId,
        continuationMessage: message.trim(),
      });

      res.status(201).json({
        rerunExecutionId: result.rerunExecutionId,
        actualRestoreStepId: result.actualRestoreStepId,
        actualRestoreStepName: result.actualRestoreStepName,
        liftedToParallel: result.liftedToParallel,
        liftChain: result.liftChain,
        sourceRootExecutionId: result.sourceRootExecutionId,
        message: `Continuation created for agentic step: ${result.actualRestoreStepName}. The agent will resume with your message appended to the conversation history.`,
      });
    } catch (error) {
      logger.error('Error continuing agentic step:', error);

      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          error: error.message,
        });
        return;
      }

      if (error instanceof Error && error.message.includes('not an agentic')) {
        res.status(400).json({
          error: error.message,
        });
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
      } else if (workflowId && typeof workflowId === 'string') {
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
      if (parsed) {
        const latest = await bitbucketManager.getLatestCommit(parsed.projectName, parsed.repoName, gitInfo.branch);

        const shouldRefresh = latest && (
          latest.id !== gitInfo.commitHash ||
          (!gitInfo.gitDiff?.length && gitInfo.baseCommitHash !== latest.id)
        );

        if (shouldRefresh) {
          logger.info(`[getWorkflowGitDiff] Auto-refreshing via Bitbucket API: ${gitInfo.commitHash} -> ${latest.id}`);
          const gitDiff = await bitbucketManager.getDiff(parsed.projectName, parsed.repoName, gitInfo.baseCommitHash || latest.id, latest.id);
          const diffStats = calculateDiffStats(gitDiff);

          const fullOutput = await storage.loadWorkflowOutput<any>(executionId);
          if (fullOutput?.gitInfo) {
            fullOutput.gitInfo.gitDiff = gitDiff;
            fullOutput.gitInfo.diffStats = diffStats;
            fullOutput.gitInfo.commitHash = latest.id;
            await storage.saveWorkflowOutput(executionId, fullOutput);
            logger.info(`[getWorkflowGitDiff] Persisted diff to storage for ${executionId}`);
          }

          res.status(200).json({
            executionId,
            branch: gitInfo.branch,
            baseCommitHash: gitInfo.baseCommitHash,
            commitHash: latest.id,
            gitDiff: gitDiff,
            stats: diffStats,
            isRefreshed: true
          });
          return;
        }
      }

      if (!gitInfo.gitDiff || !gitInfo.diffStats) {
        res.status(404).json({
          error: 'Git diff not available',
          message:
            'Git diff not available',
        });
        return;
      }

      res.status(200).json({
        executionId,
        branch: gitInfo.branch,
        baseCommitHash: gitInfo.baseCommitHash,
        commitHash: gitInfo.commitHash,
        gitDiff: gitInfo.gitDiff,
        stats: gitInfo.diffStats,
        isRefreshed: false
      });
    } catch (error) {
      logger.error('Error getting git diff:', error);

      res.status(500).json({
        error: 'Failed to get git diff',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };
}
