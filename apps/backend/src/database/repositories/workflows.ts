import { BaseRepository } from './base';
import { TicketStatusV2 } from '@xyne/shared';
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
import {
  stitchExecutionState,
  stitchExecutionStateMany,
  createExecutionState,
  updateExecutionState,
  deleteExecutionState,
  WorkflowExecutionWithState,
} from './workflowExecutionStateUtils';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { GENERIC_RECOVERY_EXCLUDED_WORKFLOW_TYPES } from '@/workflows/polling/workflowRecoveryPolicy';

function buildClaimQuery(workflowType?: string, tags?: string[]): string {
  const tagFilter = tags && tags.length > 0
    ? `AND "tag" IN (${tags.map(t => `'${t.replace(/'/g, "''")}'`).join(', ')})`
    : ''

  const typeFilter = workflowType
    ? `AND "workflowType" = '${workflowType.replace(/'/g, "''")}'`
    : ''

  const dedicatedExecutionFilter = `AND ("workflowType" IS NULL OR "workflowType" NOT IN (${GENERIC_RECOVERY_EXCLUDED_WORKFLOW_TYPES.map(type => `'${type}'`).join(', ')}))`

  return `
    WITH claimed AS (
      SELECT "id"
      FROM "workflow"."workflow_executions"
      WHERE "status" = 'PENDING'
      ${tagFilter}
      ${typeFilter}
      ${dedicatedExecutionFilter}
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "workflow"."workflow_executions"
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

  /**
   * All workflow rows in a lineage, keyed by the series' root id. The root
   * row itself has `automationSeriesId: null` (every other row in the
   * lineage points `automationSeriesId` at the root's `id`), so it has to be
   * matched by `id` explicitly or it silently drops out of its own history.
   */
  async findByautomationSeriesId(automationSeriesId: string): Promise<Workflow[]> {
    return await this.db.workflow.findMany({
      where: {
        workflowType: 'Automations',
        OR: [{ automationSeriesId }, { id: automationSeriesId }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPendingProposals(): Promise<Workflow[]> {
    return await this.db.workflow.findMany({
      where: {
        workflowType: 'Automations',
        status: 'PENDING_APPROVAL',
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findSiblingPendingProposals(
    automationSeriesId: string,
    excludeId: string,
  ): Promise<Workflow[]> {
    return await this.db.workflow.findMany({
      where: {
        workflowType: 'Automations',
        automationSeriesId,
        status: 'PENDING_APPROVAL',
        id: { not: excludeId },
      },
    });
  }

  async findLiveForLineage(automationSeriesId: string): Promise<Workflow | null> {
    return await this.db.workflow.findFirst({
      where: {
        workflowType: 'Automations',
        automationSeriesId,
        status: { in: ['ACTIVE', 'DISABLED'] },
      },
    });
  }

  async approveProposal(
    proposalId: string,
  ): Promise<{ approved: Workflow; autoRevoked: Workflow[] }> {
    return await this.db.$transaction(async tx => {
      const proposal = await tx.workflow.findUnique({ where: { id: proposalId } });
      if (!proposal || proposal.workflowType !== 'Automations') {
        throw new Error(`Cannot approve proposal ${proposalId}: not an automation row.`);
      }
      const rootId = proposal.automationSeriesId ?? proposal.id;

      const approved =
        proposal.status === 'DISABLED'
          ? proposal
          : await tx.workflow.update({
              where: { id: proposal.id },
              data: { status: 'DISABLED' },
            });

      const siblings = await tx.workflow.findMany({
        where: {
          workflowType: 'Automations',
          automationSeriesId: rootId,
          status: 'PENDING_APPROVAL',
          id: { not: proposal.id },
        },
      });
      const autoRevoked = await Promise.all(
        siblings.map(s =>
          tx.workflow.update({
            where: { id: s.id },
            data: { status: 'AUTO_REVOKED' },
          }),
        ),
      );

      return { approved, autoRevoked };
    });
  }

  async archivePriorLiveInLineage(
    automationSeriesId: string,
    keepId: string,
  ): Promise<Workflow[]> {
    const prior = await this.db.workflow.findMany({
      where: {
        workflowType: 'Automations',
        automationSeriesId,
        status: { in: ['ACTIVE', 'DISABLED'] },
        id: { not: keepId },
      },
    });
    if (prior.length === 0) return [];
    return await Promise.all(
      prior.map(row =>
        this.db.workflow.update({
          where: { id: row.id },
          data: { status: 'ARCHIVED' },
        }),
      ),
    );
  }

  async rejectProposal(proposalId: string): Promise<Workflow> {
    return await this.db.workflow.update({
      where: { id: proposalId },
      data: { status: 'REJECTED' },
    });
  }

  async revokeProposal(proposalId: string): Promise<Workflow> {
    return await this.db.workflow.update({
      where: { id: proposalId },
      data: { status: 'REVOKED' },
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
      where: {
        status: 'RUNNING',
        NOT: { workflowType: { in: [...GENERIC_RECOVERY_EXCLUDED_WORKFLOW_TYPES] } },
      },
      select: { id: true },
    })
    return executions.map(e => e.id)
  }

  async resetExecutionsToPending(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.db.workflowExecution.updateMany({
      where: {
        id: { in: ids },
        status: 'RUNNING',
        NOT: { workflowType: { in: [...GENERIC_RECOVERY_EXCLUDED_WORKFLOW_TYPES] } },
      },
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
