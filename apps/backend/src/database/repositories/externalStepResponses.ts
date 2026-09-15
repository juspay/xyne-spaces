import { BaseRepository } from './base';
import {
  ExternalStepResponse,
  CreateExternalStepResponseInput,
  UpdateExternalStepResponseInput,
  QueryOptions,
} from '@/types/database';

export class ExternalStepResponseRepository extends BaseRepository<ExternalStepResponse, CreateExternalStepResponseInput, UpdateExternalStepResponseInput> {
  constructor() {
    super('externalStepResponse');
  }

  async create(data: CreateExternalStepResponseInput): Promise<ExternalStepResponse> {
    return await this.db.externalStepResponse.create({
      data,
    });
  }

  async findById(id: string): Promise<ExternalStepResponse | null> {
    return await this.db.externalStepResponse.findUnique({
      where: { id },
    });
  }

  async findMany(options?: QueryOptions): Promise<ExternalStepResponse[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.externalStepResponse.findMany({
      skip,
      take,
      orderBy,
      where,
    });
  }

  async update(id: string, data: UpdateExternalStepResponseInput): Promise<ExternalStepResponse> {
    return await this.db.externalStepResponse.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<ExternalStepResponse> {
    return await this.db.externalStepResponse.delete({
      where: { id },
    });
  }

  async findByWorkflowExecutionId(workflowExecutionId: string): Promise<ExternalStepResponse[]> {
    return await this.db.externalStepResponse.findMany({
      where: { workflowExecutionId },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findByWorkflowStepId(workflowStepId: string): Promise<ExternalStepResponse | null> {
    return await this.db.externalStepResponse.findUnique({
      where: {
        workflowStepId: workflowStepId
      },
    });
  }

  async findByExecutionAndStepId(_workflowExecutionId: string, workflowStepId: string): Promise<ExternalStepResponse | null> {
    return await this.db.externalStepResponse.findUnique({
      where: {
        workflowStepId
      },
    });
  }

  async upsertByExecutionAndStepId(
    workflowExecutionId: string,
    workflowStepId: string,
    rawResponse: string
  ): Promise<ExternalStepResponse> {
    // Stamp the denormalized tenant key from the owning execution.
    const execution = await this.db.workflowExecution.findUnique({
      where: { id: workflowExecutionId },
      select: { workspaceId: true },
    });
    if (!execution) {
      throw new Error(`Workflow execution not found: ${workflowExecutionId}`);
    }
    return await this.db.externalStepResponse.upsert({
      where: {
        workflowStepId
      },
      update: {
        rawResponse,
        updatedAt: new Date()
      },
      create: {
        workflowExecutionId,
        workflowStepId,
        rawResponse,
        workspaceId: execution.workspaceId
      }
    });
  }

  async deleteByWorkflowStepId(workflowStepId: string): Promise<ExternalStepResponse> {
    return await this.db.externalStepResponse.delete({
      where: {
        workflowStepId
      }
    });
  }

  async hasResponseForExecution(workflowExecutionId: string): Promise<boolean> {
    const count = await this.db.externalStepResponse.count({
      where: { workflowExecutionId }
    });
    return count > 0;
  }
}