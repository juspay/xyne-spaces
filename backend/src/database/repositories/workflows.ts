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

  async findByXyneId(xyneId: string): Promise<Ticket | null> {
    return await this.db.ticket.findUnique({
      where: { xyneId },
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
    return await this.db.ticket.update({
      where: { id },
      data,
    });
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

  async create(data: CreateWorkflowExecutionInput): Promise<WorkflowExecution> {
    return await this.db.workflowExecution.create({
      data,
    });
  }

  async findById(id: string): Promise<WorkflowExecution | null> {
    return await this.db.workflowExecution.findUnique({
      where: { id },
    });
  }

  async findMany(options?: QueryOptions): Promise<WorkflowExecution[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.workflowExecution.findMany({
      skip,
      take,
      orderBy,
      where,
    });
  }

  async update(id: string, data: UpdateWorkflowExecutionInput): Promise<WorkflowExecution> {
    return await this.db.workflowExecution.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<WorkflowExecution> {
    return await this.db.workflowExecution.delete({
      where: { id },
    });
  }

  async findFullExecution(id: string): Promise<FullWorkflowExecution | null> {
    return await this.db.workflowExecution.findUnique({
      where: { id },
      include: {
        workflow: true,
        parentWorkflowExecution: true,
        childWorkflowExecutions: true,
        workflowSteps: true,
      },
    });
  }

  async findByStatus(status: string, workflowType?: string, limit?: number): Promise<WorkflowExecution[]> {
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
    
    return await this.db.workflowExecution.findMany({
      where: whereClause,
      include: {
        workflow: true,
        workflowSteps: true,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async findByWorkflowId(workflowId: string): Promise<WorkflowExecution[]> {
    return await this.db.workflowExecution.findMany({
      where: { workflowId },
      include: {
        workflowSteps: true,
      },
    });
  }

  async findPendingExecutions(): Promise<WorkflowExecution[]> {
    return await this.db.workflowExecution.findMany({
      where: {
        status: {
          in: ['NEW', 'PENDING', 'SCHEDULED'],
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async findChildExecutions(parentId: string): Promise<WorkflowExecution[]> {
    return await this.db.workflowExecution.findMany({
      where: {
        parentWorkflowExecutionId: parentId,
      },
    });
  }
}
