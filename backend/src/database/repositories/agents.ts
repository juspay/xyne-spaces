import { BaseRepository } from './base';
import {
  Agent,
  CreateAgentInput,
  UpdateAgentInput,
  QueryOptions,
  AgentWithModel,
  AgentWithTools,
  FullAgent,
  PaginationOptions,
  PaginatedResult,
} from '@/types/database';

export class AgentRepository extends BaseRepository<Agent, CreateAgentInput, UpdateAgentInput> {
  constructor() {
    super('agent');
  }

  async create(data: CreateAgentInput): Promise<Agent> {
    // Handle model reference - if data contains a model string instead of proper relation
    let createData = { ...data };
    
    if ('model' in data && typeof data.model === 'string') {
      // Look up model by userDefinedId (assuming the string is a userDefinedId)
      const modelUserDefinedId = data.model as string;
      const existingModel = await this.db.model.findUnique({
        where: { userDefinedId: modelUserDefinedId }
      });
      
      if (!existingModel) {
        throw new Error(`Model with userDefinedId '${modelUserDefinedId}' not found. Please create the model first.`);
      }
      
      // Remove the model string and use proper Prisma connect syntax
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { model, ...restData } = data;
      createData = {
        ...restData,
        model: {
          connect: { id: existingModel.id }
        }
      };
    }
    
    return await this.db.agent.create({
      data: createData,
    });
  }

  async findById(id: string): Promise<Agent | null> {
    return await this.db.agent.findUnique({
      where: { id },
    });
  }

  async findByUserDefinedId(userDefinedId: string): Promise<Agent | null> {
    return await this.db.agent.findUnique({
      where: { userDefinedId },
    });
  }

  async findMany(options?: QueryOptions): Promise<Agent[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.agent.findMany({
      skip,
      take,
      orderBy,
      where,
    });
  }

  async findManyPaginated(options: PaginationOptions & { where?: any }): Promise<PaginatedResult<Agent>> {
    const { page, pageSize, where } = options;
    const paginationQuery = this.buildPaginationQuery({ page, pageSize });

    return this.paginate(
      () => this.db.agent.findMany({
        ...paginationQuery,
        where,
      }),
      () => this.db.agent.count({ where }),
      { page, pageSize }
    );
  }

  async update(id: string, data: UpdateAgentInput): Promise<Agent> {
    return await this.db.agent.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<Agent> {
    return await this.db.agent.delete({
      where: { id },
    });
  }

  async findByScope(scope: string): Promise<Agent[]> {
    return await this.db.agent.findMany({
      where: { scope },
    });
  }

  async findByModelId(modelId: string): Promise<Agent[]> {
    return await this.db.agent.findMany({
      where: { modelId },
    });
  }

  async findWithModel(id: string): Promise<AgentWithModel | null> {
    return await this.db.agent.findUnique({
      where: { id },
      include: {
        model: true,
      },
    });
  }


  async findWithTools(id: string): Promise<AgentWithTools | null> {
    return await this.db.agent.findUnique({
      where: { id },
      include: {
        agentToolsMappings: {
          include: {
            tool: true,
          },
        },
      },
    });
  }

  async findFullAgent(id: string): Promise<FullAgent | null> {
    return await this.db.agent.findUnique({
      where: { id },
      include: {
        model: true,
        agentToolsMappings: {
          include: {
            tool: true,
          },
        },
      },
    });
  }

  async findBySearch(searchTerm: string, options?: PaginationOptions): Promise<PaginatedResult<Agent> | Agent[]> {
    const searchFilter = this.createSearchFilter(searchTerm, ['name', 'description', 'userDefinedId']);

    if (options) {
      return this.findManyPaginated({
        ...options,
        where: searchFilter,
      });
    }

    return this.findMany({ where: searchFilter });
  }

  async findByStatus(statuses: string[]): Promise<Agent[]> {
    return await this.db.agent.findMany({
      where: {
        scope: {
          in: statuses,
        },
      },
    });
  }

  async findByTemperatureRange(min: number, max: number): Promise<Agent[]> {
    return await this.db.agent.findMany({
      where: {
        temp: {
          gte: min,
          lte: max,
        },
      },
    });
  }

  async findRecentlyUpdated(days: number): Promise<Agent[]> {
    const date = new Date();
    date.setDate(date.getDate() - days);

    return await this.db.agent.findMany({
      where: {
        updatedAt: {
          gte: date,
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  /**
   * Find the latest version of an agent by name
   * Searches by the 'name' field and returns the agent with the highest version number
   */
  async findLatestByName(name: string): Promise<Agent | null> {
    const agents = await this.db.agent.findMany({
      where: { name },
      orderBy: [
        {
          version: 'desc'
        },
        {
          createdAt: 'desc'
        }
      ]
    });

    if (agents.length === 0) {
      return null;
    }

    // Sort by version number (handle both string and numeric versions)
    const sortedAgents = agents.sort((a, b) => {
      const versionA = Number(a.version) || 0;
      const versionB = Number(b.version) || 0;
      
      if (versionA !== versionB) {
        return versionB - versionA; // Descending order
      }
      
      // If versions are equal, sort by creation date (latest first)
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return sortedAgents[0];
  }

  /**
   * Find the latest version of an agent by name with full details (model and tools)
   */
  async findLatestByNameWithDetails(name: string): Promise<FullAgent | null> {
    const latestAgent = await this.findLatestByName(name);
    
    if (!latestAgent) {
      return null;
    }

    return await this.findFullAgent(latestAgent.id);
  }

  /**
   * Get unique agent names with their latest versions, with pagination
   * This ensures we get truly unique agent names, not multiple versions of the same agent
   */
  async findUniqueAgentNamesPaginated(options: PaginationOptions): Promise<PaginatedResult<Agent>> {
    const { page, pageSize } = options;
    
    // First, get all unique agent names
    const uniqueNames = await this.db.agent.findMany({
      select: { name: true },
      distinct: ['name'],
      orderBy: { name: 'asc' },
    });

    // Calculate pagination for unique names
    const totalUniqueNames = uniqueNames.length;
    const totalPages = Math.ceil(totalUniqueNames / pageSize);
    const skip = (page - 1) * pageSize;
    const paginatedNames = uniqueNames.slice(skip, skip + pageSize);

    // Get the latest version for each paginated name
    const latestAgents = await Promise.all(
      paginatedNames.map(async ({ name }) => {
        return await this.findLatestByName(name);
      })
    );

    // Filter out any null results and sort by name
    const validAgents = latestAgents.filter((agent): agent is Agent => agent !== null);
    validAgents.sort((a, b) => a.name.localeCompare(b.name));

    return {
      data: validAgents,
      pagination: {
        page,
        pageSize,
        total: totalUniqueNames,
        totalPages,
      },
    };
  }
}
