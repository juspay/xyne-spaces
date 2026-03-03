import { Workflow, WorkflowExecution, WorkflowStep } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import {logger} from '@/utils/logger';
import { getExecutionState } from './workflowExecutionStateUtils';

const prisma = DatabaseClient.getInstance();

export class WorkflowRepository {
  // Existing methods
  async getWorkflowStepsByExecutionId(workflowExecutionId: string) {
    return await prisma.workflowStep.findMany({
      where: { workflowExecutionId },
      orderBy: { createdAt: 'asc' }
    });
  }

  async getWorkflowExecutionById(id: string) {
    return await prisma.workflowExecution.findUnique({
      where: { id },
      include: {
        workflow: true,
        workflowSteps: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });
  }

  async getAllWorkflowExecutions() {
    return await prisma.workflowExecution.findMany({
      include: {
        workflow: true,
        workflowSteps: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  // ========== WORKFLOW CRUD METHODS ==========
  
  // GET: Get workflow by ID or all workflows
  async getWorkflowById(id: string) {
    return await prisma.workflow.findUnique({
      where: { id }
    });
  }

  async getWorkflowWithTicketById(id: string) {
    // Note: No FK relation between Workflow and Ticket
    // Fetch workflow and ticket separately if needed
    const workflow = await prisma.workflow.findUnique({
      where: { id },
    });

    if (!workflow || !workflow.ticketId) {
      return workflow;
    }

    // Manually fetch ticket if ticketId exists
    const ticket = await prisma.ticket.findUnique({
      where: { id: workflow.ticketId }
    });

    return {
      ...workflow,
      ticket
    };
  }

  async getAllWorkflows(page?: number, limit?: number) {
    const skip = page && limit ? (page - 1) * limit : undefined;
    const take = limit || undefined;

    return await prisma.workflow.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take
    });
  }

  async getWorkflowsCount() {
    return await prisma.workflow.count();
  }

  async hasActiveWorkflow(ticketId: string): Promise<boolean> {
    const activeStatuses = [
      'NEW',
      'PENDING',
      'RUNNING',
      'WAIT_FOR_EVENT',
      'WAITING_FOR_CHILD_EXECUTIONS'
    ];

    const count = await prisma.workflow.count({
      where: {
        ticketId,
        status: { in: activeStatuses }
      }
    });

    return count > 0;
  }

  // POST: Create new workflow
  async createWorkflow(data: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'>) {
    return await prisma.workflow.create({
      data
    });
  }

  // PUT: Update workflow
  async updateWorkflow(id: string, data: Partial<Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'>>) {
    return await prisma.workflow.update({
      where: { id },
      data
    });
  }

  // ========== WORKFLOW EXECUTION CRUD METHODS ==========

  // GET: Get workflow execution by ID (simplified version without includes)
  async getWorkflowExecutionByIdSimple(id: string) {
    return await prisma.workflowExecution.findUnique({
      where: { id }
    });
  }

  // GET: Get all workflow executions (simplified version)
  async getAllWorkflowExecutionsSimple(page?: number, limit?: number) {
    const skip = page && limit ? (page - 1) * limit : undefined;
    const take = limit || undefined;

    return await prisma.workflowExecution.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take
    });
  }

  async getWorkflowExecutionsCount() {
    return await prisma.workflowExecution.count();
  }

  // POST: Create new workflow execution
  async createWorkflowExecution(data: Omit<WorkflowExecution, 'id' | 'createdAt' | 'updatedAt'>) {
    return await prisma.workflowExecution.create({
      data
    });
  }

  // PUT: Update workflow execution
  async updateWorkflowExecution(id: string, data: Partial<Omit<WorkflowExecution, 'id' | 'createdAt' | 'updatedAt'>>) {
    return await prisma.workflowExecution.update({
      where: { id },
      data
    });
  }

  // ========== WORKFLOW STEP CRUD METHODS ==========

  // GET: Get workflow step by ID or all steps
  async getWorkflowStepById(id: string) {
    return await prisma.workflowStep.findUnique({
      where: { id }
    });
  }

  async getAllWorkflowSteps(page?: number, limit?: number) {
    const skip = page && limit ? (page - 1) * limit : undefined;
    const take = limit || undefined;

    return await prisma.workflowStep.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take
    });
  }

  async getWorkflowStepsCount() {
    return await prisma.workflowStep.count();
  }

  // POST: Create new workflow step
  async createWorkflowStep(data: Omit<WorkflowStep, 'id' | 'createdAt' | 'updatedAt'>) {
    return await prisma.workflowStep.create({
      data
    });
  }

  // PUT: Update workflow step
  async updateWorkflowStep(id: string, data: Partial<Omit<WorkflowStep, 'id' | 'createdAt' | 'updatedAt'>>) {
    return await prisma.workflowStep.update({
      where: { id },
      data
    });
  }

  // NEW: Get single execution's steps (for execution switching)
  async getSingleExecutionSteps(ticketId: string, executionId: string) {
    // Fetch ONLY this execution with full step data
    const execution = await prisma.workflowExecution.findFirst({
      where: {
        id: executionId,
        workflow: {
          ticketId: ticketId
        }
      },
      include: {
        workflowSteps: {
          orderBy: { createdAt: 'asc' }
        },
        workflow: {
          select: {
            id: true,
            workflowName: true,
            workflowType: true,
            ticketId: true,
            metadata: true,
          }
        }
      }
    });

    if (!execution) return null;

    // Get ALL executions for this workflow (for parallel/agent expansion lookups)
    const allWorkflowExecutions = await prisma.workflowExecution.findMany({
      where: {
        workflowId: execution.workflowId
      },
      include: {
        workflowSteps: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    // Build lookup maps
    const allExecutions = new Map();
    const stepsByExecution = new Map();
    const executionsBySourceStep = new Map();

    allWorkflowExecutions.forEach(exec => {
      allExecutions.set(exec.id, exec);
      stepsByExecution.set(exec.id, exec.workflowSteps);

      if (exec.parentWorkflowExecutionId && exec.sourceStepsId) {
        if (!executionsBySourceStep.has(exec.sourceStepsId)) {
          executionsBySourceStep.set(exec.sourceStepsId, []);
        }
        executionsBySourceStep.get(exec.sourceStepsId).push(exec);
      }
    });

    // Process steps with full expansion
    const processedSteps = this.processStepsOptimized(
      execution.workflowSteps,
      execution,
      allExecutions,
      stepsByExecution,
      executionsBySourceStep
    );

    const rootExecutions = allWorkflowExecutions.filter(
      (exec: any) => !exec.parentWorkflowExecutionId || exec.tag === 'rerun'
    );

    const sortedExecutions = rootExecutions.sort((a: any, b: any) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const executionMetadata = sortedExecutions.map((exec: any) => {
      let sourceStepName = null;

      if (exec.sourceStepsId && exec.parentWorkflowExecutionId) {
        const parentExecution = allExecutions.get(exec.parentWorkflowExecutionId);
        if (parentExecution && parentExecution.workflowSteps) {
          const sourceStep = parentExecution.workflowSteps.find(
            (s: any) => s.id === exec.sourceStepsId
          );
          if (sourceStep) {
            sourceStepName = sourceStep.stepName;
          }
        }
      }

      return {
        executionId: exec.id,
        executionStatus: exec.status,
        tag: exec.tag,
        parentWorkflowExecutionId: exec.parentWorkflowExecutionId,
        sourceStepsId: exec.sourceStepsId,
        sourceStepName: sourceStepName,
        createdAt: exec.createdAt,
        updatedAt: exec.updatedAt
      };
    });

    // Extract gitInfo from the execution's steps
    // const gitInfo = this.extractGitInfoFromSteps(execution.workflowSteps)
    // Fetch state (context/output) for this execution
    const executionState = await getExecutionState(execution.id);
    const gitInfoFromOutput = executionState.output ? this.extractGitInfoFromSteps([JSON.parse(executionState.output)]) : null;;

    // Return in same format as getCombinedWorkflowStepsLightWithMetadata (with workflows array)
    // This ensures frontend can use the same parsing logic
    return {
      workflows: [{
        workflowId: execution.workflowId,
        workflowName: execution.workflow.workflowName,
        workflowType: execution.workflow.workflowType,
        executionId: execution.id,
        executionStatus: execution.status,
        tag: execution.tag,
        parentWorkflowExecutionId: execution.parentWorkflowExecutionId,
        sourceStepsId: execution.sourceStepsId,
        createdAt: execution.createdAt,
        updatedAt: execution.updatedAt,
        output: executionState.output ? JSON.parse(executionState.output) : null,
        steps: processedSteps,
        executionMetadata: executionMetadata,
        // Git info for diff view (only available if baseCommitHash exists)
        gitInfo: gitInfoFromOutput,
        metadata: execution.workflow.metadata ? JSON.parse(execution.workflow.metadata) : null,
      }]
    };
  }

  // NEW: Returns latest execution with full steps + metadata for all executions
  async getCombinedWorkflowStepsLightWithMetadata(ticketId: string) {
    // Query workflows directly using ticketId since the relation was removed
    const workflows = await prisma.workflow.findMany({
      where: { ticketId: ticketId },
      include: {
        workflowExecutions: {
          select: {
            id: true,
            status: true,
            parentWorkflowExecutionId: true,
            tag: true,
            sourceStepsId: true,
            createdAt: true,
            updatedAt: true,
            workflowId: true,
            workflowSteps: {
              select: {
                id: true,
                workflowExecutionId: true,
                stepExecutorType: true,
                stepName: true,
                type: true,
                status: true,
                data: true,
                previousStepId: true,
                createdAt: true,
                updatedAt: true,
              },
              orderBy: { createdAt: 'asc' }
            },
            workflow: {
              select: {
                id: true,
                workflowName: true,
                workflowType: true
              }
            }
          }
        }
      }
    });

    if (!workflows || workflows.length === 0) return null;

    // Fetch all execution states for the executions
    const allExecutionIds = workflows.flatMap(w => w.workflowExecutions.map(e => e.id));
    const states = await prisma.workflowExecutionState.findMany({
      where: { workflowExecutionId: { in: allExecutionIds } }
    });
    const stateMap = new Map(states.map(s => [s.workflowExecutionId, s]));

    // Build lookup maps (with state stitched in)
    const allExecutions = new Map();
    const stepsByExecution = new Map();
    const executionsBySourceStep = new Map();

    workflows.forEach(workflow => {
      workflow.workflowExecutions.forEach((execution: any) => {
        const state = stateMap.get(execution.id);
        const executionWithState = {
          ...execution,
          context: state?.context ?? null,
          output: state?.output ?? null,
        };
        allExecutions.set(execution.id, executionWithState);
        stepsByExecution.set(execution.id, execution.workflowSteps);

        if (execution.parentWorkflowExecutionId && execution.sourceStepsId) {
          if (!executionsBySourceStep.has(execution.sourceStepsId)) {
            executionsBySourceStep.set(execution.sourceStepsId, []);
          }
          executionsBySourceStep.get(execution.sourceStepsId).push(executionWithState);
        }
      });
    });

    // Create a ticket-like object for compatibility with the existing processing function
    const ticketLikeObject = {
      id: ticketId,
      workflows: workflows
    };

    return this.processWorkflowsWithMetadata(ticketLikeObject, allExecutions, stepsByExecution, executionsBySourceStep);
  }

  // Returns combined workflow steps for a specific workflow ID
  async getCombinedWorkflowStepsByWorkflowId(ticketId: string, workflowId: string) {
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      include: {
        workflowExecutions: {
          select: {
            id: true,
            status: true,
            parentWorkflowExecutionId: true,
            tag: true,
            sourceStepsId: true,
            createdAt: true,
            updatedAt: true,
            workflowId: true,
            workflowSteps: {
              select: {
                id: true,
                workflowExecutionId: true,
                stepExecutorType: true,
                stepName: true,
                type: true,
                status: true,
                data: true,
                previousStepId: true,
                createdAt: true,
                updatedAt: true,
              },
              orderBy: { createdAt: 'asc' }
            },
            workflow: {
              select: {
                id: true,
                workflowName: true,
                workflowType: true
              }
            }
          }
        }
      }
    });

    // Return null if workflow doesn't exist or doesn't belong to ticket
    if (!workflow || workflow.ticketId !== ticketId) {
      return null;
    }

    // Fetch all execution states for the executions
    const allExecutionIds = workflow.workflowExecutions.map(e => e.id);
    const states = await prisma.workflowExecutionState.findMany({
      where: { workflowExecutionId: { in: allExecutionIds } }
    });
    const stateMap = new Map(states.map(s => [s.workflowExecutionId, s]));

    // Build lookup maps (with state stitched in)
    const allExecutions = new Map();
    const stepsByExecution = new Map();
    const executionsBySourceStep = new Map();

    workflow.workflowExecutions.forEach((execution: any) => {
      const state = stateMap.get(execution.id);
      const executionWithState = {
        ...execution,
        context: state?.context ?? null,
        output: state?.output ?? null,
      };
      allExecutions.set(execution.id, executionWithState);
      stepsByExecution.set(execution.id, execution.workflowSteps);

      if (execution.parentWorkflowExecutionId && execution.sourceStepsId) {
        if (!executionsBySourceStep.has(execution.sourceStepsId)) {
          executionsBySourceStep.set(execution.sourceStepsId, []);
        }
        executionsBySourceStep.get(execution.sourceStepsId).push(executionWithState);
      }
    });

    // Create a ticket-like object for compatibility with the existing processing function
    const ticketLikeObject = {
      id: ticketId,
      workflows: [workflow]
    };

    return this.processWorkflowsWithMetadata(ticketLikeObject, allExecutions, stepsByExecution, executionsBySourceStep);
  }

  async getWorkflowStepDetails(stepId: string) {
    // First get the step to find its stepName and executionId
    const step = await prisma.workflowStep.findUnique({
      where: { id: stepId },
      include: {
        workflowExecution: {
          include: {
            workflow: true
          }
        }
      }
    });

    if (!step) {
      return null;
    }

    // Now get both input and output steps for the same stepName in the same execution
    const allStepsForName = await prisma.workflowStep.findMany({
      where: {
        stepName: step.stepName,
        workflowExecutionId: step.workflowExecutionId,
        type: {
          in: ['input', 'output']
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    const inputStep = allStepsForName.find(s => s.type === 'input') || null;
    const outputStep = allStepsForName.find(s => s.type === 'output') || null;

    // If this is an agent step, fetch the agent execution data
    if (inputStep && inputStep.stepExecutorType === 'agent') {
      // Find workflow executions where sourceStepsId equals the input step id

      const agentExecutions = await prisma.workflowExecution.findMany({
        where: {
          sourceStepsId: inputStep.id
        },
        include: {
          workflowSteps: {
            orderBy: { createdAt: 'asc' }
          }
        },
        orderBy: { createdAt: 'asc' }
      });

      // Fetch states for agent executions
      const agentExecutionIds = agentExecutions.map(e => e.id);
      const agentStates = await prisma.workflowExecutionState.findMany({
        where: { workflowExecutionId: { in: agentExecutionIds } }
      });
      const agentStateMap = new Map(agentStates.map(s => [s.workflowExecutionId, s]));

      // Structure the data to match the old enhancedStepDetails format
      const expandedExecutions = agentExecutions.map(execution => {
        const state = agentStateMap.get(execution.id);
        const executionSteps = execution.workflowSteps.map(execStep => {
          // Parse step data if it exists
          let parsedData = null;
          if (execStep.data) {
            try {
              parsedData = JSON.parse(execStep.data);
            } catch (error) {
              parsedData = execStep.data;
            }
          }

          return {
            ...execStep,
            data: parsedData
          };
        });

        return {
          executionId: execution.id,
          status: execution.status,
          output: state?.output ?? null,
          steps: executionSteps,
          isFromAgentExecution: true,
          parentStepName: step.stepName
        };
      });

      // Add expandedExecutions to the output step
      if (outputStep) {
        return {
          input: inputStep,
          output: {
            ...outputStep,
            expandedExecutions: expandedExecutions
          },
          stepName: step.stepName,
          workflowExecution: step.workflowExecution,
          originalStep: step
        };
      } else {
        // For failed agent steps, create an output object with expandedExecutions
        return {
          input: inputStep,
          output: {
            expandedExecutions: expandedExecutions,
            data: null // No actual output data for failed steps
          },
          stepName: step.stepName,
          workflowExecution: step.workflowExecution,
          originalStep: step
        }
      }
    }

    // For successful steps, add expandedExecutions to the existing output
    return {
      input: inputStep,
      output: outputStep,
      stepName: step.stepName,
      workflowExecution: step.workflowExecution,
      originalStep: step
    };
  }

  // Helper methods for the above functions

  // Extract gitInfo from workflow steps (looks for output steps with gitInfo in data)
  private extractGitInfoFromSteps(steps: any[]): {
    hasGitInfo: boolean;
    branch?: string;
    repoUrl?: string;
    baseCommitHash?: string;
    commitHash?: string;
    pr_link?: string;
    preview?: {
      type: 'loadUrlWithUserAgent';
      userAgent: string;
      url: string;
    };
  } {
    // Look for output steps that have gitInfo in their data
    for (const step of steps) {
      if(step.gitInfo) {
        const gitInfo = step.gitInfo;
        if (gitInfo && gitInfo.baseCommitHash) {
          return {
            hasGitInfo: true,
            branch: gitInfo.branch,
            repoUrl: gitInfo.repoUrl,
            baseCommitHash: gitInfo.baseCommitHash,
            commitHash: gitInfo.commitHash,
            pr_link: gitInfo.pr_link,
            preview: gitInfo.preview
          };
        }
      }
      if (step.type === 'output' && step.data) {
        try {
          const data = typeof step.data === 'string' ? JSON.parse(step.data) : step.data;
          const gitInfo = data?.result?.gitInfo || data?.gitInfo;

          if(gitInfo) {
            logger.info('Extracted gitInfo from step:')
          }
          
          if (gitInfo && gitInfo.baseCommitHash) {
            return {
              hasGitInfo: true,
              branch: gitInfo.branch,
              repoUrl: gitInfo.repoUrl,
              baseCommitHash: gitInfo.baseCommitHash,
              commitHash: gitInfo.commitHash,
              pr_link: gitInfo.pr_link,
              preview: gitInfo.preview
            };
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
    
    return { hasGitInfo: false };
  }

  // NEW: Process workflows with metadata - returns latest execution + metadata for all
  private processWorkflowsWithMetadata(
    ticket: any,
    allExecutions: Map<any, any>,
    stepsByExecution: Map<any, any>,
    executionsBySourceStep: Map<any, any>
  ) {
    const processedWorkflows = [];

    for (const workflow of ticket.workflows) {
      // Filter root + rerun executions
      const rootExecutions = workflow.workflowExecutions.filter(
        (execution: any) => !execution.parentWorkflowExecutionId || execution.tag === 'rerun'
      );

      if (rootExecutions.length === 0) continue;

      // Sort by createdAt descending to get latest
      const sortedExecutions = rootExecutions.sort((a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      const latestExecution = sortedExecutions[0];

      // Process ONLY latest execution's steps (full expansion)
      const latestSteps = this.processStepsOptimized(
        latestExecution.workflowSteps,
        latestExecution,
        allExecutions,
        stepsByExecution,
        executionsBySourceStep
      );

      // Build metadata array for ALL executions (no steps, lightweight)
      const executionMetadata = sortedExecutions.map((exec: any) => {
        let sourceStepName = null;

        // If this is a rerun with a source step, look up the step name
        if (exec.sourceStepsId && exec.parentWorkflowExecutionId) {
          const parentExecution = allExecutions.get(exec.parentWorkflowExecutionId);
          if (parentExecution && parentExecution.workflowSteps) {
            const sourceStep = parentExecution.workflowSteps.find(
              (s: any) => s.id === exec.sourceStepsId
            );
            if (sourceStep) {
              sourceStepName = sourceStep.stepName;
            }
          }
        }

        return {
          executionId: exec.id,
          executionStatus: exec.status,
          tag: exec.tag,
          parentWorkflowExecutionId: exec.parentWorkflowExecutionId,
          sourceStepsId: exec.sourceStepsId,
          sourceStepName: sourceStepName,
          createdAt: exec.createdAt,
          updatedAt: exec.updatedAt
        };
      });

      // Extract gitInfo from the processed steps
      // const gitInfo = this.extractGitInfoFromSteps(latestExecution.workflowSteps);
      const gitInfoFromOutput = latestExecution.output ? this.extractGitInfoFromSteps([JSON.parse(latestExecution.output)]) : null;

      processedWorkflows.push({
        workflowId: workflow.id,
        status: workflow.status,
        workflowName: workflow.workflowName,
        workflowType: workflow.workflowType,
        // Latest execution with FULL steps
        executionId: latestExecution.id,
        executionStatus: latestExecution.status,
        parentWorkflowExecutionId: latestExecution.parentWorkflowExecutionId,
        sourceStepsId: latestExecution.sourceStepsId,
        tag: latestExecution.tag,
        createdAt: latestExecution.createdAt,
        updatedAt: latestExecution.updatedAt,
        steps: latestSteps,
        output: latestExecution.output ? JSON.parse(latestExecution.output) : null,
        // Metadata for ALL executions
        executionMetadata: executionMetadata,
        // Git info for diff view (only available if baseCommitHash exists)
        gitInfo: gitInfoFromOutput,
        metadata: workflow.metadata ? JSON.parse(workflow.metadata) : null,
      });
    }

    return {
      ...ticket,
      workflows: processedWorkflows
    };
  }

  // NEW: Synchronous version of parent chain traversal for use in processStepsOptimized
  private getStepsFromParentChainSync(
    execution: any,
    sourceStepId: string,
    allExecutionsMap: Map<string, any>,
    depth: number = 0,
    maxDepth: number = 10
  ): any[] {
    // Safety check for infinite recursion
    if (depth >= maxDepth) {
      logger.warn(`Maximum parent chain depth (${maxDepth}) reached for execution: ${execution.id}`);
      return [];
    }

    // If no parent, we're at the root - return empty array
    if (!execution.parentWorkflowExecutionId) {
      return [];
    }

    // Get parent execution
    const parentExecution = allExecutionsMap.get(execution.parentWorkflowExecutionId);
    if (!parentExecution) {
      logger.warn(`Parent execution ${execution.parentWorkflowExecutionId} not found`);
      return [];
    }

    // Get steps from parent that come BEFORE the sourceStepId
    const parentSteps = parentExecution.workflowSteps || [];
    const sourceStepIndex = parentSteps.findIndex((s: any) => s.id === sourceStepId);

    if (sourceStepIndex === -1) {
      logger.warn(`Source step ${sourceStepId} not found in parent execution ${parentExecution.id}`);
      return [];
    }

    // Take all steps BEFORE the source step (not including the source step itself)
    const stepsBeforeSource = parentSteps.slice(0, sourceStepIndex);

    // If parent is also a rerun, recursively get its parent chain steps
    let ancestorSteps: any[] = [];
    if (parentExecution.tag === 'rerun' && parentExecution.sourceStepsId) {
      ancestorSteps = this.getStepsFromParentChainSync(
        parentExecution,
        parentExecution.sourceStepsId,
        allExecutionsMap,
        depth + 1,
        maxDepth
      );
    }

    // Combine: ancestor steps + parent steps before source
    return [...ancestorSteps, ...stepsBeforeSource];
  }

  // OPTIMIZED: Process steps in memory using lookup maps
  private processStepsOptimized(
    steps: any[],
    parentExecution: any,
    _allExecutions: Map<any, any>,
    stepsByExecution: Map<any, any>,
    executionsBySourceStep: Map<any, any>
  ): any[] {
    let stepsToProcess = steps;
    const stepToExecutionMap = new Map<string, string>(); // Map step.id to executionId

    // NEW: If this is a rerun execution from a specific step, merge parent chain steps
    if (parentExecution.tag === 'rerun' && parentExecution.sourceStepsId) {
      const parentChainSteps = this.getStepsFromParentChainSync(
        parentExecution,
        parentExecution.sourceStepsId,
        _allExecutions
      );

      // Track which execution each parent chain step belongs to
      parentChainSteps.forEach(step => {
        stepToExecutionMap.set(step.id, step.workflowExecutionId);
      });

      // Current execution's steps
      steps.forEach(step => {
        stepToExecutionMap.set(step.id, parentExecution.id);
      });

      // Combine: parent chain steps + current execution steps
      stepsToProcess = [...parentChainSteps, ...steps];
    } else {
      // For non-rerun executions, all steps belong to the current execution
      steps.forEach(step => {
        stepToExecutionMap.set(step.id, parentExecution.id);
      });
    }

    const processedSteps: any[] = [];

    for (const step of stepsToProcess) {
      // Get the execution this step belongs to
      const stepExecutionId = stepToExecutionMap.get(step.id) || parentExecution.id;
      const stepExecution = _allExecutions.get(stepExecutionId) || parentExecution;
      const stepExecutionSteps = stepsByExecution.get(stepExecutionId) || steps;

      const { status: computedStatus, duration } = this.computeStepStatus(
        step,
        stepExecutionSteps, // Use the correct execution's steps
        stepExecution.status, // Use the correct execution's status
        [] // Child executions for status computation
      );

      const stepData = {
        id: step.id,
        workflowExecutionId: step.workflowExecutionId,
        stepExecutorType: step.stepExecutorType,
        stepName: step.stepName,
        type: step.type,
        previousStepId: step.previousStepId,
        status: step.status,
        data: step.data, // Include data field for external step metadata
        createdAt: step.createdAt,
        updatedAt: step.updatedAt,
        computedStatus,
        duration
      };

      // Handle parallel and agent steps using in-memory lookup
      if (step.stepExecutorType === 'parallel' && step.stepName) {
        const expandedWorkflows = this.expandParallelWorkflowsOptimized(
          step.id,
          step.stepName,
          parentExecution.id,
          _allExecutions,
          stepsByExecution,
          executionsBySourceStep
        );

        processedSteps.push({
          ...stepData,
          expandedWorkflows: expandedWorkflows,
          parallelGroupId: parentExecution.id,
          isParallelParent: true,
          parallelChildrenCount: expandedWorkflows.length
        });
      } else if (step.stepExecutorType === 'agent' && step.stepName) {
        const expandedExecutions = this.expandAgentExecutionsOptimized(
          step.id,
          step.stepName,
          parentExecution.id,
          _allExecutions,
          stepsByExecution,
          executionsBySourceStep
        );

        processedSteps.push({
          ...stepData,
          expandedExecutions: expandedExecutions
        });
      } else {
        processedSteps.push(stepData);
      }
    }

    return processedSteps;
  }

  // OPTIMIZED: Parallel workflows expansion using in-memory lookup
  private expandParallelWorkflowsOptimized(
    stepId: string,
    stepName: string,
    parentExecutionId: string,
    _allExecutions: Map<any, any>,
    stepsByExecution: Map<any, any>,
    executionsBySourceStep: Map<any, any>
  ): any[] {
    const childExecutions = executionsBySourceStep.get(stepId) || [];
    const expandedWorkflows: any[] = [];

    childExecutions.forEach((childExecution: any, index: number) => {
      const childSteps = stepsByExecution.get(childExecution.id) || [];
      const steps = childSteps.map((step: any) => {
        const { status: computedStatus, duration } = this.computeStepStatus(
          step,
          childSteps,
          childExecution.status,
          []
        );

        return {
          id: step.id,
          workflowExecutionId: step.workflowExecutionId,
          stepExecutorType: step.stepExecutorType,
          stepName: step.stepName,
          type: step.type,
          previousStepId: step.previousStepId,
          status: step.status,
          data: step.data, // Include data field for external step metadata
          createdAt: step.createdAt,
          updatedAt: step.updatedAt,
          computedStatus,
          duration,
          parallelGroupId: parentExecutionId,
          parallelChildIndex: index,
          parallelParentStepName: stepName,
          isParallelChild: true,
        };
      });

      expandedWorkflows.push({
        workflowId: childExecution.workflowId,
        workflowName: childExecution.workflow?.workflowName,
        workflowType: childExecution.workflow?.workflowType,
        executionId: childExecution.id,
        executionStatus: childExecution.status,
        steps: steps
      });
    });

    return expandedWorkflows;
  }

  // OPTIMIZED: Agent executions expansion using in-memory lookup
  private expandAgentExecutionsOptimized(
    stepId: string,
    stepName: string,
    _parentExecutionId: string,
    _allExecutions: Map<any, any>,
    stepsByExecution: Map<any, any>,
    executionsBySourceStep: Map<any, any>
  ): any[] {
    const childExecutions = executionsBySourceStep.get(stepId) || [];
    const expandedExecutions: any[] = [];

    childExecutions.forEach((childExecution: any) => {
      const childSteps = stepsByExecution.get(childExecution.id) || [];
      const executionSteps = childSteps.map((step: any) => {
        const { status: computedStatus, duration } = this.computeStepStatus(
          step,
          childSteps,
          childExecution.status,
          []
        );

        return {
          id: step.id,
          workflowExecutionId: step.workflowExecutionId,
          stepExecutorType: step.stepExecutorType,
          stepName: step.stepName,
          type: step.type,
          previousStepId: step.previousStepId,
          status: step.status,
          data: step.data, // Include data field for external step metadata
          createdAt: step.createdAt,
          updatedAt: step.updatedAt,
          computedStatus,
          duration,
        };
      });

      expandedExecutions.push({
        executionId: childExecution.id,
        status: childExecution.status,
        steps: executionSteps,
        isFromAgentExecution: true,
        parentStepName: stepName
      });
    });

    return expandedExecutions;
  }

  private computeStepStatus(
    step: any,
    allSteps: any[],
    parentExecutionStatus: string,
    childExecutions: any[]
  ): { status: string; duration: string } {
    const stepName = step.stepName;

    const inputStep = allSteps.find(s => s.stepName === stepName && s.type === 'input');
    const outputStep = allSteps.find(s => s.stepName === stepName && s.type === 'output');

    // Calculate duration from input/output step timestamps
    let duration = '0s';
    if (inputStep && outputStep) {
      const startTime = new Date(inputStep.createdAt).getTime();
      const endTime = new Date(outputStep.updatedAt).getTime();
      const durationMs = endTime - startTime;
      const totalSeconds = Math.max(0, Math.round(durationMs / 1000));

      // Format as min:sec for durations >= 60 seconds, otherwise just seconds
      if (totalSeconds >= 60) {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        duration = `${minutes}m ${seconds}s`;
      } else {
        duration = `${totalSeconds}s`;
      }
    }

    // Handle parallel/agentic steps - use child execution status
    if (step.stepExecutorType === 'parallel' || step.stepExecutorType === 'agent') {
      const parentInputStep = allSteps.find(s => s.stepName === stepName && s.type === 'input');

      if (parentInputStep) {
        if (step.stepExecutorType === 'parallel') {
          const childExecs = childExecutions?.filter(child => child.sourceStepsId === parentInputStep.id) || [];
          if (childExecs.length > 0) {
            return {
              status: this.computeParallelStatus(childExecs.map(child => child.status)),
              duration
            };
          }
        } else {
          // agent step
          const childExecution = childExecutions?.find(child => child.sourceStepsId === parentInputStep.id);
          if (childExecution) {
            return {
              status: this.mapExecutionStatusToNodeStatus(childExecution.status),
              duration
            };
          }
        }
      }
    }

    // Check if workflow status is terminal using actual enum values
    const isWorkflowTerminal = (status: string): boolean => {
      const terminalStatuses = ['SUCCESS', 'FAILURE', 'CANCELLED'];
      return terminalStatuses.includes(status);
    };

    // Enhanced status logic with terminal workflow handling
    const isTerminal = isWorkflowTerminal(parentExecutionStatus);

    // If no matched input step found, check if workflow is terminal
    if (!inputStep) {
      if (isTerminal) {
        return { status: 'failed', duration }; // Step was never executed but workflow finished
      } else {
        return { status: 'pending', duration }; // Step hasn't been reached yet
      }
    }

    // If workflow is in terminal state, determine step status based on input/output presence
    if (isTerminal) {
      if (inputStep && outputStep) {
        return { status: 'completed', duration };
      } else if (inputStep && !outputStep) {
        return { status: 'failed', duration }; // Started but didn't complete
      } else if (!inputStep && !outputStep) {
        return { status: 'failed', duration }; // Never started but workflow ended
      }
    }

    // For non-terminal workflows
    if (inputStep && !outputStep) {
      // Check if step is an external step (waiting for user input/webhooks/API callbacks)
      logger.info(`[computeStepStatus] Step "${stepName}": stepExecutorType = "${inputStep.stepExecutorType}"`);
      if (inputStep.stepExecutorType === 'external') {
        logger.info(`[computeStepStatus] ✅ Detected EXTERNAL step - returning 'waiting' status`);
        return { status: 'waiting', duration };
      }
      return { status: 'running', duration }; // Currently executing
    }

    if (inputStep && outputStep) {
      return { status: 'completed', duration }; // Successfully completed
    }

    if (!inputStep && !outputStep) {
      return { status: 'pending', duration }; // Not started yet
    }

    return { status: 'pending', duration };
  }

  private computeParallelStatus(childStatuses: string[]): string {
    if (childStatuses.some(status => status === 'FAILURE')) return 'failed';
    if (childStatuses.some(status => status === 'RUNNING')) return 'running';
    if (childStatuses.every(status => status === 'SUCCESS')) return 'completed';
    return 'running'; // Mixed state
  }

  private mapExecutionStatusToNodeStatus(executionStatus: string): string {
    switch (executionStatus?.toUpperCase()) {
      case 'SUCCESS': return 'completed';
      case 'FAILURE': return 'failed';
      case 'RUNNING': return 'running';
      case 'PENDING':
      default: return 'pending';
    }
  }
}
