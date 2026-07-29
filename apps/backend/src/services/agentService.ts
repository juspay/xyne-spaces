import { AgentConfig, createDefaultAgentConfig, Agent, validateAndThrow } from 'agentic-framework';
import type { ProviderConfiguration } from 'agentic-framework';
import { repositories } from '../database/repositories/index.js';
import type { FullAgent } from '../types/database.js';
import { config as appConfig } from '@/config/env'
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';

export interface AgentCredentialSource {
  userId?: string | null;
  ticketId?: string | null;
  workspaceId?: string | null;
}
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
  async createAgentByName(agentName: string, credentialSource?: AgentCredentialSource): Promise<Agent> {
    // Check cache first
    const cacheKey = this.agentCacheKey(agentName, credentialSource);
    if (this.agentCache.has(cacheKey)) {
      return this.agentCache.get(cacheKey)!;
    }

    // Get agent from database
    const dbAgent = await this.getAgentFromDatabase(agentName);
    if (!dbAgent) {
      throw new Error(`Agent '${agentName}' not found in database`);
    }

    // Convert to AgentConfig and create agent using static factory
    const agentConfig = await this.convertDbToAgentConfig(dbAgent, undefined, credentialSource);
    const agent = Agent.create(agentConfig);

    // Cache and return
    this.agentCache.set(cacheKey, agent);
    return agent;
  }

  /**
   * Create agent by userDefinedId
   */
  async createAgentByUserDefinedId(
    userDefinedId: string,
    credentialSource?: AgentCredentialSource,
  ): Promise<Agent> {
    const dbAgent = await repositories.agents.findByUserDefinedId(userDefinedId);
    if (!dbAgent) {
      throw new Error(`Agent with userDefinedId '${userDefinedId}' not found`);
    }

    const fullAgent = await repositories.agents.findFullAgent(dbAgent.id);
    if (!fullAgent) {
      throw new Error(`Failed to load full agent data for '${userDefinedId}'`);
    }

    const agentConfig = await this.convertDbToAgentConfig(fullAgent, undefined, credentialSource);
    return Agent.create(agentConfig);
  }

  /**
   * Get agent configuration without creating instance
   */
  async getAgentConfig(agentName: string, credentialSource?: AgentCredentialSource): Promise<AgentConfig> {
    const dbAgent = await this.getAgentFromDatabase(agentName);
    if (!dbAgent) {
      throw new Error(`Agent '${agentName}' not found in database`);
    }
    return this.convertDbToAgentConfig(dbAgent, undefined, credentialSource);
  }

  async getAgentConfigWithSystemPrompt(
    agentName: string,
    credentialSource?: AgentCredentialSource,
  ): Promise<{ config: AgentConfig; systemPrompt: string }> {
    const dbAgent = await this.getAgentFromDatabase(agentName);
    if (!dbAgent) {
      throw new Error(`Agent '${agentName}' not found in database`);
    }
    return {
      config: await this.convertDbToAgentConfig(dbAgent, 300000, credentialSource),
      systemPrompt: dbAgent.systemPrompt ?? '',
    };
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
  private async convertDbToAgentConfig(
    dbAgent: FullAgent,
    timeout?: number,
    credentialSource?: AgentCredentialSource,
  ): Promise<AgentConfig> {
    // Start with framework defaults
    const defaultConfig = createDefaultAgentConfig();

    const credential = await this.resolveLiteLLMCredential(credentialSource);

    // Build AgentConfig using defaults + DB overrides
    const provider: ProviderConfiguration = {
      type: 'litellm' as const,
      config: {
        baseUrl: credential.baseUrl,
        apiKey: credential.apiKey,
        ...(timeout !== undefined && { timeout }),
      },
    };

    const agentConfig: AgentConfig = {
      // Model config - merge DB data with defaults
      model: {
        provider,
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

  private async resolveLiteLLMCredential(credentialSource?: AgentCredentialSource) {
    const credential = credentialSource?.ticketId
      ? await orgLLMCredentialService.getCredentialByTicketId(
        credentialSource.ticketId,
        OrgLLMServiceAccountPurpose.DEFAULT,
      )
      : credentialSource?.userId
        ? await orgLLMCredentialService.getCredentialByUserId(
          credentialSource.userId,
          OrgLLMServiceAccountPurpose.DEFAULT,
        )
        : credentialSource?.workspaceId
          ? await orgLLMCredentialService.getCredentialByWorkspaceId(
            credentialSource.workspaceId,
            OrgLLMServiceAccountPurpose.DEFAULT,
          )
          : await orgLLMCredentialService.getCredentialByWorkspaceId(
            appConfig.defaultWorkspaceId,
            OrgLLMServiceAccountPurpose.DEFAULT,
          );

    if (!credential) {
      throw new Error('No active DEFAULT LiteLLM service account credential for agent execution');
    }

    return credential;
  }

  private agentCacheKey(agentName: string, credentialSource?: AgentCredentialSource): string {
    return [
      agentName,
      credentialSource?.ticketId ?? '',
      credentialSource?.userId ?? '',
      credentialSource?.workspaceId ?? '',
    ].join(':');
  }
}

// Convenience functions
export const agentService = AgentService.getInstance();

/**
 * Create agent by name - convenience function
 */
export async function createAgentByName(
  agentName: string,
  credentialSource?: AgentCredentialSource,
): Promise<Agent> {
  return agentService.createAgentByName(agentName, credentialSource);
}

/**
 * Create agent by userDefinedId - convenience function
 */
export async function createAgentByUserDefinedId(
  userDefinedId: string,
  credentialSource?: AgentCredentialSource,
): Promise<Agent> {
  return agentService.createAgentByUserDefinedId(userDefinedId, credentialSource);
}

/**
 * Get agent configuration - convenience function
 */
export async function getAgentConfig(
  agentName: string,
  credentialSource?: AgentCredentialSource,
): Promise<AgentConfig> {
  return agentService.getAgentConfig(agentName, credentialSource);
}

/**
 * Get available agents - convenience function
 */
export async function getAvailableAgents(): Promise<Array<{id: string, name: string, userDefinedId: string, description?: string}>> {
  return agentService.getAvailableAgents();
}
