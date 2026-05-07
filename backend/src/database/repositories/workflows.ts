import { BaseRepository } from './base';
import {
  Ticket,
  CreateTicketInput,
  UpdateTicketInput,
  Workflow,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  WorkflowWithExecutions,
  WorkflowExecution,
  CreateWorkflowExecutionInput,
  UpdateWorkflowExecutionInput,
  FullWorkflowExecution,
  QueryOptions,
} from '@/types/database';
import { TicketStatusV2 } from '@prisma/client';
import {
  stitchExecutionState,
  stitchExecutionStateMany,
  createExecutionState,
  updateExecutionState,
  deleteExecutionState,
  WorkflowExecutionWithState,
} from './workflowExecutionStateUtils';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';

function buildClaimQuery(workflowType?: string, tags?: string[]): string {
  const tagFilter = tags && tags.length > 0
    ? `AND "tag" IN (${tags.map(t => `'${t.replace(/'/g, "''")}'`).join(', ')})`
    : ''

  const typeFilter = workflowType
    ? `AND "workflowType" = '${workflowType.replace(/'/g, "''")}'`
    : ''

  return `
    WITH claimed AS (
      SELECT "id"
      FROM "workflow_executions"
      WHERE "status" = 'PENDING'
      ${tagFilter}
      ${typeFilter}
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "workflow_executions"
    SET "status" = 'RUNNING', "updatedAt" = NOW()
    FROM claimed
    WHERE "workflow_executions"."id" = claimed."id"
    RETURNING "workflow_executions"."id"
  `
}

export class TicketRepository extends BaseRepository<Ticket, CreateTicketInput, UpdateTicketInput> {
  constructor() {
    super('ticket');
  }

  async create(data: CreateTicketInput): Promise<Ticket> {
    return await this.db.ticket.create({
      data,
    });
  }

  async findById(id: string): Promise<Ticket | null> {
    return await this.db.ticket.findUnique({
      where: { id },
    });
  }

  async findByXyneId(xyneId: string, workspaceId: string): Promise<Ticket | null> {
    return await this.db.ticket.findUnique({
      where: { workspaceId_xyneId: { workspaceId, xyneId } },
    });
  }

  async findMany(options?: QueryOptions): Promise<Ticket[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.ticket.findMany({
      skip,
      take,
      orderBy,
      where,
    });
  }

  async update(id: string, data: UpdateTicketInput): Promise<Ticket> {
    const updatedTicket = await this.db.ticket.update({
      where: { id },
      data,
    });

    await syncConversationTicketMdFromPrismaTicket(this.db, updatedTicket);
    return updatedTicket;
  }

  async delete(id: string): Promise<Ticket> {
    return await this.db.ticket.delete({
      where: { id },
    });
  }

  async findWithWorkflows(id: string): Promise<Ticket | null> {
    return await this.db.ticket.findUnique({
      where: { id },
    });
  }

  async findByDateRange(startDate: Date, endDate: Date): Promise<Ticket[]> {
    return await this.db.ticket.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });
  }

  async findScheduledTickets(): Promise<Ticket[]> {
    return await this.db.ticket.findMany({
      where: {
        statusV2: TicketStatusV2.TODO,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }
}

export class WorkflowRepository extends BaseRepository<Workflow, CreateWorkflowInput, UpdateWorkflowInput> {
  constructor() {
    super('workflow');
  }

  async create(data: CreateWorkflowInput): Promise<Workflow> {
    return await this.db.workflow.create({
      data,
    });
  }

  async findById(id: string): Promise<Workflow | null> {
    return await this.db.workflow.findUnique({
      where: { id },
    });
  }

  async findMany(options?: QueryOptions): Promise<Workflow[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.workflow.findMany({
      skip,
      take,
      orderBy,
      where,
    });
  }

  async update(id: string, data: UpdateWorkflowInput): Promise<Workflow> {
    return await this.db.workflow.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<Workflow> {
    return await this.db.workflow.delete({
      where: { id },
    });
  }

  async findByStatus(status: string): Promise<Workflow[]> {
    return await this.db.workflow.findMany({
      where: { status },
    });
  }

  async findByTicketId(ticketId: string): Promise<Workflow[]> {
    return await this.db.workflow.findMany({
      where: { ticketId },
    });
  }

  async findWithExecutions(id: string): Promise<WorkflowWithExecutions | null> {
    return await this.db.workflow.findUnique({
      where: { id },
      include: {
        workflowExecutions: {
          include: {
            childWorkflowExecutions: true,
            workflowSteps: true,
          },
        },
      },
    });
  }

  async findByName(workflowName: string): Promise<Workflow[]> {
    return await this.db.workflow.findMany({
      where: { workflowName },
    });
  }
}

export class WorkflowExecutionRepository extends BaseRepository<WorkflowExecution, CreateWorkflowExecutionInput, UpdateWorkflowExecutionInput> {
  constructor() {
    super('workflowExecution');
  }

  async create(data: CreateWorkflowExecutionInput & { context?: string | null; output?: string | null }): Promise<WorkflowExecutionWithState> {
    // Extract context and output from data (they go to state table)
    const { context, output, ...executionData } = data as any;
    
    const execution = await this.db.workflowExecution.create({
      data: executionData,
    });

    // Create state record with context and output
    if (context !== undefined || output !== undefined) {
      await createExecutionState(execution.id, context, output);
    }

    return { ...execution, context: context ?? null, output: output ?? null };
  }

  async findById(id: string): Promise<WorkflowExecutionWithState | null> {
    const execution = await this.db.workflowExecution.findUnique({
      where: { id },
    });
    return stitchExecutionState(execution);
  }

  async findMany(options?: QueryOptions): Promise<WorkflowExecutionWithState[]> {
    const { skip, take, orderBy, where } = options || {};

    const executions = await this.db.workflowExecution.findMany({
      skip,
      take,
      orderBy,
      where,
    });
    return stitchExecutionStateMany(executions);
  }

  async update(id: string, data: UpdateWorkflowExecutionInput & { context?: string | null; output?: string | null }): Promise<WorkflowExecutionWithState> {
    // Extract context and output from data (they go to state table)
    const { context, output, ...executionData } = data as any;
    
    const execution = await this.db.workflowExecution.update({
      where: { id },
      data: executionData,
    });

    // Update state record if context or output provided
    if (context !== undefined || output !== undefined) {
      await updateExecutionState(id, { context, output });
    }

    return stitchExecutionState(execution) as Promise<WorkflowExecutionWithState>;
  }

  async delete(id: string): Promise<WorkflowExecution> {
    // Delete state first
    await deleteExecutionState(id);
    
    return await this.db.workflowExecution.delete({
      where: { id },
    });
  }

  async findFullExecution(id: string): Promise<(FullWorkflowExecution & { context: string | null; output: string | null }) | null> {
    const execution = await this.db.workflowExecution.findUnique({
      where: { id },
      include: {
        workflow: true,
        parentWorkflowExecution: true,
        childWorkflowExecutions: true,
        workflowSteps: true,
      },
    });
    return stitchExecutionState(execution);
  }

  async findByStatus(status: string, workflowType?: string, limit?: number, tags?: string[]): Promise<WorkflowExecutionWithState[]> {
    const whereClause: any = { status }
    
    if (workflowType) {
      whereClause.OR = [
        { workflowType: workflowType },
        { 
          workflowType: null,
          workflow: { workflowType: workflowType }
        }
      ]
    }

    if (tags && tags.length > 0) {
      whereClause.tag = { in: tags }
    }
    
    const executions = await this.db.workflowExecution.findMany({
      where: whereClause,
      include: {
        workflow: true,
        workflowSteps: true,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return stitchExecutionStateMany(executions);
  }

  async findByWorkflowId(workflowId: string): Promise<WorkflowExecutionWithState[]> {
    const executions = await this.db.workflowExecution.findMany({
      where: { workflowId },
      include: {
        workflowSteps: true,
      },
    });
    return stitchExecutionStateMany(executions);
  }

  async findPendingExecutions(): Promise<WorkflowExecutionWithState[]> {
    const executions = await this.db.workflowExecution.findMany({
      where: {
        status: {
          in: ['NEW', 'PENDING', 'SCHEDULED'],
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
    return stitchExecutionStateMany(executions);
  }

  async findChildExecutions(parentId: string): Promise<WorkflowExecutionWithState[]> {
    const executions = await this.db.workflowExecution.findMany({
      where: {
        parentWorkflowExecutionId: parentId,
      },
    });
    return stitchExecutionStateMany(executions);
  }

  async claimNextPendingExecution(workflowType?: string, tags?: string[]): Promise<WorkflowExecutionWithState | null> {
    const claimed = await this.db.$queryRawUnsafe<Array<{ id: string }>>(
      buildClaimQuery(workflowType, tags)
    )

    if (claimed.length === 0) return null

    const execution = await this.db.workflowExecution.findUnique({
      where: { id: claimed[0].id },
    })

    return stitchExecutionState(execution)
  }

  async findRunningExecutionIds(): Promise<string[]> {
    const executions = await this.db.workflowExecution.findMany({
      where: { status: 'RUNNING' },
      select: { id: true },
    })
    return executions.map(e => e.id)
  }

  async resetExecutionsToPending(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.db.workflowExecution.updateMany({
      where: { id: { in: ids }, status: 'RUNNING' },
      data: { status: 'PENDING' },
    })
  }

  async getCreatedBy(executionId: string): Promise<string | null> {
    const execution = await this.db.workflowExecution.findUnique({
      where: { id: executionId },
      select: { createdBy: true },
    });
    return execution?.createdBy ?? null;
  }
}
