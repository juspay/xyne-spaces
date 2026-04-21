import { BaseRepository } from './base';
import {
  Tool,
  CreateToolInput,
  UpdateToolInput,
  AgentToolsMapping,
  CreateAgentToolsMappingInput,
  UpdateAgentToolsMappingInput,
  QueryOptions,
} from '@/types/database';

export class ToolRepository extends BaseRepository<Tool, CreateToolInput, UpdateToolInput> {
  constructor() {
    super('tool');
  }

  async create(data: CreateToolInput): Promise<Tool> {
    return await this.db.tool.create({
      data,
    });
  }

  async findById(id: string): Promise<Tool | null> {
    return await this.db.tool.findUnique({
      where: { id },
    });
  }

  async findByName(name: string, workspaceId: string): Promise<Tool | null> {
    return await this.db.tool.findFirst({ where: { name, workspaceId } });
  }

  async findMany(options?: QueryOptions): Promise<Tool[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.tool.findMany({
      skip,
      take,
      orderBy,
      where,
    });
  }

  async update(id: string, data: UpdateToolInput): Promise<Tool> {
    return await this.db.tool.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<Tool> {
    return await this.db.tool.delete({
      where: { id },
    });
  }

  async findByStatus(status: string): Promise<Tool[]> {
    return await this.db.tool.findMany({
      where: { status },
    });
  }

  async findEnabledTools(): Promise<Tool[]> {
    return await this.db.tool.findMany({
      where: { status: 'Enabled' },
    });
  }

  async findWithAgents(id: string) {
    return await this.db.tool.findUnique({
      where: { id },
      include: {
        agentToolsMappings: {
          include: {
            agent: true,
          },
        },
      },
    });
  }

  async findBySearch(searchTerm: string): Promise<Tool[]> {
    const searchFilter = this.createSearchFilter(searchTerm, ['name', 'description', 'specialDescription']);
    return this.findMany({ where: searchFilter });
  }
}

export class AgentToolsMappingRepository extends BaseRepository<AgentToolsMapping, CreateAgentToolsMappingInput, UpdateAgentToolsMappingInput> {
  constructor() {
    super('agentToolsMapping');
  }

  async create(data: CreateAgentToolsMappingInput): Promise<AgentToolsMapping> {
    return await this.db.agentToolsMapping.create({
      data,
    });
  }

  async findById(id: string): Promise<AgentToolsMapping | null> {
    return await this.db.agentToolsMapping.findUnique({
      where: { id },
    });
  }

  async findMany(options?: QueryOptions): Promise<AgentToolsMapping[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.agentToolsMapping.findMany({
      skip,
      take,
      orderBy,
      where,
    });
  }

  async update(id: string, data: UpdateAgentToolsMappingInput): Promise<AgentToolsMapping> {
    return await this.db.agentToolsMapping.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<AgentToolsMapping> {
    return await this.db.agentToolsMapping.delete({
      where: { id },
    });
  }

  async findByAgentId(agentId: string): Promise<AgentToolsMapping[]> {
    return await this.db.agentToolsMapping.findMany({
      where: { agentId },
    });
  }

  async findByToolId(toolId: string): Promise<AgentToolsMapping[]> {
    return await this.db.agentToolsMapping.findMany({
      where: { toolId },
    });
  }

  async findByAgentAndTool(agentId: string, toolId: string): Promise<AgentToolsMapping | null> {
    return await this.db.agentToolsMapping.findUnique({
      where: {
        agentId_toolId: {
          agentId,
          toolId,
        },
      },
    });
  }

  async findByStatus(status: string): Promise<AgentToolsMapping[]> {
    return await this.db.agentToolsMapping.findMany({
      where: { status },
    });
  }

  async findEnabledMappings(): Promise<AgentToolsMapping[]> {
    return await this.db.agentToolsMapping.findMany({
      where: { status: 'Enabled' },
    });
  }

  async findWithDetails(agentId: string) {
    return await this.db.agentToolsMapping.findMany({
      where: { agentId },
      include: {
        agent: true,
        tool: true,
      },
    });
  }

  async enableToolForAgent(agentId: string, toolId: string): Promise<AgentToolsMapping> {
    const existing = await this.findByAgentAndTool(agentId, toolId);

    if (existing) {
      return this.update(existing.id, { status: 'Enabled' });
    }

    return this.create({
      agent: { connect: { id: agentId } },
      tool: { connect: { id: toolId } },
      status: 'Enabled',
    });
  }

  async disableToolForAgent(agentId: string, toolId: string): Promise<AgentToolsMapping | null> {
    const existing = await this.findByAgentAndTool(agentId, toolId);

    if (existing) {
      return this.update(existing.id, { status: 'Disabled' });
    }

    return null;
  }
}