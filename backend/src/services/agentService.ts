import { AgentConfig, createDefaultAgentConfig, Agent, validateAndThrow } from 'agentic-framework';
import { repositories } from '../database/repositories/index.js';
import type { FullAgent } from '../types/database.js';

/**
 * Agent Service - Bridge between Database and Framework
 *
 * Minimal service that converts DB records to framework agents
 * using existing framework components.
 */
export class AgentService {
  private static instance: AgentService;
  private agentCache = new Map<string, Agent>();

  private constructor() {}

  public static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService();
    }
    return AgentService.instance;
  }

  /**
   * Create agent by name - main entry point
   */
  async createAgentByName(agentName: string): Promise<Agent> {
    // Check cache first
    if (this.agentCache.has(agentName)) {
      return this.agentCache.get(agentName)!;
    }

    // Get agent from database
    const dbAgent = await this.getAgentFromDatabase(agentName);
    if (!dbAgent) {
      throw new Error(`Agent '${agentName}' not found in database`);
    }

    // Convert to AgentConfig and create agent using static factory
    const agentConfig = this.convertDbToAgentConfig(dbAgent);
    const agent = Agent.create(agentConfig);

    // Cache and return
    this.agentCache.set(agentName, agent);
    return agent;
  }

  /**
   * Create agent by userDefinedId
   */
  async createAgentByUserDefinedId(userDefinedId: string): Promise<Agent> {
    const dbAgent = await repositories.agents.findByUserDefinedId(userDefinedId);
    if (!dbAgent) {
      throw new Error(`Agent with userDefinedId '${userDefinedId}' not found`);
    }

    const fullAgent = await repositories.agents.findFullAgent(dbAgent.id);
    if (!fullAgent) {
      throw new Error(`Failed to load full agent data for '${userDefinedId}'`);
    }

    const agentConfig = this.convertDbToAgentConfig(fullAgent);
    return Agent.create(agentConfig);
  }

  /**
   * Get agent configuration without creating instance
   */
  async getAgentConfig(agentName: string): Promise<AgentConfig> {
    const dbAgent = await this.getAgentFromDatabase(agentName);
    if (!dbAgent) {
      throw new Error(`Agent '${agentName}' not found in database`);
    }
    return this.convertDbToAgentConfig(dbAgent);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.agentCache.clear();
  }

  /**
   * List available agents
   */
  async getAvailableAgents(): Promise<Array<{id: string, name: string, userDefinedId: string, description?: string}>> {
    const agents = await repositories.agents.findMany();
    return agents.map(agent => ({
      id: agent.id,
      name: agent.name,
      userDefinedId: agent.userDefinedId,
      description: agent.description || undefined
    }));
  }

  /**
   * Private: Get agent from database with all relations
   */
  private async getAgentFromDatabase(agentName: string): Promise<FullAgent | null> {
    const agents = await repositories.agents.findBySearch(agentName);

    if (Array.isArray(agents) && agents.length > 0) {
      const agent = agents.find(a => a.name === agentName);
      if (agent) {
        return repositories.agents.findFullAgent(agent.id);
      }
    }

    return null;
  }

  /**
   * Private: Convert DB agent to framework AgentConfig
   */
  private convertDbToAgentConfig(dbAgent: FullAgent): AgentConfig {
    // Start with framework defaults
    const defaultConfig = createDefaultAgentConfig();

    // Parse model credentials
    let modelCredentials;
    try {
      modelCredentials = JSON.parse(dbAgent.model.credentials);
    } catch (error) {
      throw new Error(`Invalid model credentials for agent '${dbAgent.name}': ${error}`);
    }

    // Build AgentConfig using defaults + DB overrides
    const agentConfig: AgentConfig = {
      // Model config - merge DB data with defaults
      model: {
        provider: {
          type: dbAgent.model.provider as 'vertex' | 'litellm',
          config: modelCredentials,
        },
        defaultModel: dbAgent.model.name,
        features: defaultConfig.model.features,
        ...(dbAgent.temp !== null && { temperature: dbAgent.temp }),
      },

      // Tools config - enabled tools from DB + default settings
      tools: {
        enabled: dbAgent.agentToolsMappings
          .filter(mapping => mapping.status === 'Enabled')
          .map(mapping => mapping.tool.name),
        config: defaultConfig.tools.config,
        execution: defaultConfig.tools.execution,
      },

      // Use framework defaults for execution
      execution: defaultConfig.execution,

      // Use framework defaults for events
      events: defaultConfig.events,

      // Metadata from DB
      metadata: {
        name: dbAgent.name,
        version: dbAgent.version.toString(),
        description: dbAgent.description || undefined,
        tags: dbAgent.scope ? [dbAgent.scope] : undefined,
      },
    };

    // Validate and return
    return validateAndThrow(agentConfig);
  }
}

// Convenience functions
export const agentService = AgentService.getInstance();

/**
 * Create agent by name - convenience function
 */
export async function createAgentByName(agentName: string): Promise<Agent> {
  return agentService.createAgentByName(agentName);
}

/**
 * Create agent by userDefinedId - convenience function
 */
export async function createAgentByUserDefinedId(userDefinedId: string): Promise<Agent> {
  return agentService.createAgentByUserDefinedId(userDefinedId);
}

/**
 * Get agent configuration - convenience function
 */
export async function getAgentConfig(agentName: string): Promise<AgentConfig> {
  return agentService.getAgentConfig(agentName);
}

/**
 * Get available agents - convenience function
 */
export async function getAvailableAgents(): Promise<Array<{id: string, name: string, userDefinedId: string, description?: string}>> {
  return agentService.getAvailableAgents();
}
