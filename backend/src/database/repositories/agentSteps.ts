import { BaseRepository } from './base';
import {
  AgentStep,
  CreateAgentStepInput,
  UpdateAgentStepInput,
  QueryOptions,
} from '@/types/database';

export class AgentStepRepository extends BaseRepository<AgentStep, CreateAgentStepInput, UpdateAgentStepInput> {
  constructor() {
    super('agentStep');
  }

  async create(data: CreateAgentStepInput): Promise<AgentStep> {
    return await this.db.agentStep.create({
      data,
    });
  }

  async findById(id: string): Promise<AgentStep | null> {
    return await this.db.agentStep.findUnique({
      where: { id },
    });
  }

  async findMany(options?: QueryOptions): Promise<AgentStep[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.agentStep.findMany({
      skip,
      take,
      orderBy,
      where,
    });
  }

  async update(id: string, data: UpdateAgentStepInput): Promise<AgentStep> {
    return await this.db.agentStep.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<AgentStep> {
    return await this.db.agentStep.delete({
      where: { id },
    });
  }

  async findByStepsId(stepsId: string): Promise<AgentStep[]> {
    return await this.db.agentStep.findMany({
      where: { stepsId },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async findByAgentId(agentId: string): Promise<AgentStep[]> {
    return await this.db.agentStep.findMany({
      where: { agentId },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findByToolName(toolName: string): Promise<AgentStep[]> {
    return await this.db.agentStep.findMany({
      where: { toolName },
    });
  }


  async findWithAgent(id: string) {
    return await this.db.agentStep.findUnique({
      where: { id },
      include: {
        agent: {
          include: {
            model: true,
          },
        },
      },
    });
  }



  async findByDateRange(startDate: Date, endDate: Date): Promise<AgentStep[]> {
    return await this.db.agentStep.findMany({
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

  async findRecentSteps(limit: number = 10): Promise<AgentStep[]> {
    return await this.db.agentStep.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      include: {
        agent: true,
      },
    });
  }


  async findStepsByTool(toolName: string, limit?: number): Promise<AgentStep[]> {
    return await this.db.agentStep.findMany({
      where: { toolName },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      include: {
        agent: true,
      },
    });
  }
}