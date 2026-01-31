import { BaseRepository } from './base';
import {
  WorkflowStep,
  CreateWorkflowStepInput,
  UpdateWorkflowStepInput,
  QueryOptions,
} from '@/types/database';

export class WorkflowStepRepository extends BaseRepository<WorkflowStep, CreateWorkflowStepInput, UpdateWorkflowStepInput> {
  constructor() {
    super('workflowStep');
  }

  async create(data: CreateWorkflowStepInput): Promise<WorkflowStep> {
    return await this.db.workflowStep.create({
      data,
    });
  }

  async findById(id: string): Promise<WorkflowStep | null> {
    return await this.db.workflowStep.findUnique({
      where: { id },
    });
  }

  async findMany(options?: QueryOptions): Promise<WorkflowStep[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.workflowStep.findMany({
      skip,
      take,
      orderBy,
      where,
    });
  }

  async update(id: string, data: UpdateWorkflowStepInput): Promise<WorkflowStep> {
    return await this.db.workflowStep.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<WorkflowStep> {
    return await this.db.workflowStep.delete({
      where: { id },
    });
  }


  async findByWorkflowExecutionId(workflowExecutionId: string): Promise<WorkflowStep[]> {
    return await this.db.workflowStep.findMany({
      where: { workflowExecutionId },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async findByStepExecutorType(stepExecutorType: string): Promise<WorkflowStep[]> {
    return await this.db.workflowStep.findMany({
      where: { stepExecutorType },
    });
  }

  async findWithExecution(id: string) {
    return await this.db.workflowStep.findUnique({
      where: { id },
      include: {
        workflowExecution: true,
      },
    });
  }

  async findByStepName(stepName: string): Promise<WorkflowStep[]> {
    return await this.db.workflowStep.findMany({
      where: { stepName },
    });
  }

  async findStepsWithData(): Promise<WorkflowStep[]> {
    return await this.db.workflowStep.findMany({
      where: {
        data: {
          not: null,
        },
      },
    });
  }

  async findStepsByType(type: string): Promise<WorkflowStep[]> {
    return await this.db.workflowStep.findMany({
      where: {
        type: type,
      },
    });
  }

  async findPendingSteps(): Promise<WorkflowStep[]> {
    return await this.db.workflowStep.findMany({
      where: {
        status: null,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async findCompletedSteps(): Promise<WorkflowStep[]> {
    return await this.db.workflowStep.findMany({
      where: {
        status: 'completed',
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async findByDateRange(startDate: Date, endDate: Date): Promise<WorkflowStep[]> {
    return await this.db.workflowStep.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async updateStepData(id: string, data: string, type?: string, status?: string): Promise<WorkflowStep> {
    const updateData: any = { data };
    if (type) updateData.type = type;
    if (status) updateData.status = status;
    return this.update(id, updateData);
  }

  async updateStepStatus(id: string, status: string): Promise<WorkflowStep> {
    return this.update(id, { status });
  }

  async findByPreviousStepId(previousStepId: string): Promise<WorkflowStep[]> {
    return await this.db.workflowStep.findMany({
      where: { previousStepId },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }
}
