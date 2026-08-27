import { repositories } from '../database/repositories';
import { logger } from '../utils/logger';
import { config, ToolStatus, type WorkflowConfig, type AgentConfig } from '../workflows/config';
import { config as appConfig } from '../config/env';
import type { Agent } from '@prisma/client';

export class ConfigSyncService {
  constructor() {
    // No need for configPath since we're importing the config directly
  }

  /**
   * Ensure default models and tools exist in the database
   * This method should be called before syncConfigWithDatabase()
   */
  public async ensureDefaultModelAndTools(): Promise<void> {
    try {
      logger.info('Ensuring default model and tools exist...');

      // Get all workspaces
      const workspaces = await repositories.workspaces.findMany();

      if (workspaces.length === 0) {
        logger.warn('No workspaces found. Skipping default model and tools initialization (will run when a workspace exists).');
        return;
      }

      // Process each workspace
      for (const workspace of workspaces) {
        logger.info(`Processing workspace: ${workspace.name} (${workspace.id})`);

        // Ensure default LiteLLM model exists
        await this.ensureDefaultModel(workspace.id);

        // Ensure default tools exist
        await this.ensureDefaultTools(workspace.id);

        // Ensure default groups and resources exist
        await this.ensureDefaultGroupsAndResources(workspace.id);
      }

      logger.info('Default model and tools check completed for all workspaces');
    } catch (error) {
      logger.error('Failed to ensure default model and tools:', error);
      throw error;
    }
  }

  /**
   * Ensure the default LiteLLM model exists
   */
  private async ensureDefaultModel(workspaceId: string): Promise<void> {
    const defaultModelUserDefinedId = appConfig.workflow.defaultModelId;
    const defaultModelName = appConfig.workflow.defaultModelName;

    // Check if model already exists
    const existingModel = await repositories.models.findByUserDefinedId(defaultModelUserDefinedId);

    if (!existingModel) {
      logger.info(`Creating default model: ${defaultModelUserDefinedId}`);

      await repositories.models.create({
        userDefinedId: defaultModelUserDefinedId,
        name: defaultModelName,
        provider: 'litellm',
        credentials: JSON.stringify({
          apiKey: 'YOUR_ORG_LITELLM_SERVICE_ACCOUNT',
          baseUrl: 'YOUR_LITELLM_BASE_URL',
          timeout: 600000,
          retries: 5
        }),
        workspace: { connect: { id: workspaceId } }
      });

      logger.info(`Successfully created default model: ${defaultModelUserDefinedId}`);
    } else {
      logger.info(`Default model already exists: ${defaultModelUserDefinedId}`);
    }
  }

  /**
   * Ensure all default tools exist
   */
  private async ensureDefaultTools(workspaceId: string): Promise<void> {
    const defaultTools = [
      {
        name: 'read',
        description: 'File reading tool for analyzing code and documentation',
        status: 'Enabled' as const
      },
      {
        name: 'write',
        description: 'File writing tool for creating new files and content',
        status: 'Enabled' as const
      },
      {
        name: 'edit',
        description: 'File editing tool for modifying existing files',
        status: 'Enabled' as const
      },
      {
        name: 'multiedit',
        description: 'Multiple file editing tool for batch operations',
        status: 'Enabled' as const
      },
      {
        name: 'grep',
        description: 'Pattern search tool for finding content in files',
        status: 'Enabled' as const
      },
      {
        name: 'glob',
        description: 'File pattern matching tool for finding files by patterns',
        status: 'Enabled' as const
      },
      {
        name: 'ls',
        description: 'Directory listing tool for exploring file structures',
        status: 'Enabled' as const
      },
      {
        name: 'bash',
        description: 'Command execution tool for running system commands',
        status: 'Enabled' as const
      },
      {
        name: 'todo-write',
        description: 'Task management tool for creating and managing todos',
        status: 'Enabled' as const
      }
    ];

    for (const toolData of defaultTools) {
      // Check if tool already exists
      const existingTool = await repositories.tools.findByName(toolData.name, workspaceId);

      if (!existingTool) {
        logger.info(`Creating default tool: ${toolData.name}`);

        await repositories.tools.create({
          name: toolData.name,
          description: toolData.description,
          status: toolData.status,
          workspace: { connect: { id: workspaceId } }
        });

        logger.info(`Successfully created default tool: ${toolData.name}`);
      } else {
        logger.info(`Default tool already exists: ${toolData.name}`);
      }
    }
  }

  /**
   * Ensure default groups and resources exist in the database
   */
  private async ensureDefaultGroupsAndResources(workspaceId: string): Promise<void> {
    try {
      logger.info('Ensuring default groups and resources exist...');

      // Import DatabaseClient to access Prisma client
      const { DatabaseClient } = await import('../database/client');
      const prisma = DatabaseClient.getInstance();

      // Ensure USER-GROUPS resource exists
      const userGroupsResource = await prisma.resource.findUnique({
        where: { name: 'USER-GROUPS' }
      });

      if (!userGroupsResource) {
        logger.info('Creating USER-GROUPS resource');
        await prisma.resource.create({
          data: {
            name: 'USER-GROUPS',
            description: 'Manage user groups and group assignments'
          }
        });
        logger.info('Successfully created USER-GROUPS resource');
      } else {
        logger.info('USER-GROUPS resource already exists');
      }

      const teamIntelligenceDashboardResource = await prisma.resource.findUnique({
        where: { name: 'TEAM-INTELLIGENCE-DASHBOARD' }
      });

      if (!teamIntelligenceDashboardResource) {
        logger.info('Creating TEAM-INTELLIGENCE-DASHBOARD resource');
        await prisma.resource.create({
          data: {
            name: 'TEAM-INTELLIGENCE-DASHBOARD',
            description: 'Access Team Intelligence dashboard org/team/user endpoints'
          }
        });
        logger.info('Successfully created TEAM-INTELLIGENCE-DASHBOARD resource');
      } else {
        logger.info('TEAM-INTELLIGENCE-DASHBOARD resource already exists');
      }

      // Ensure VESPA resource exists (gates the Vespa backfill / reindex admin endpoints)
      const vespaResource = await prisma.resource.findUnique({
        where: { name: 'VESPA' }
      });

      if (!vespaResource) {
        logger.info('Creating VESPA resource');
        await prisma.resource.create({
          data: {
            name: 'VESPA',
            description: 'Vespa backfill / reindex admin endpoints (/api/admin/vespa-backfill/*, /api/migration/vespa-workspace-backfill/*)'
          }
        });
        logger.info('Successfully created VESPA resource');
      } else {
        logger.info('VESPA resource already exists');
      }

      const releaseManagerResource = await prisma.resource.findUnique({
        where: { name: 'RELEASE-MANAGER' }
      });

      if (!releaseManagerResource) {
        logger.info('Creating RELEASE-MANAGER resource');
        await prisma.resource.create({
          data: {
            name: 'RELEASE-MANAGER',
            description: 'Release-config edit access (/api/commits/analyze/*, save release config). Admins/owners have it by role; grant to other users to let them edit without admin privilege.'
          }
        });
        logger.info('Successfully created RELEASE-MANAGER resource');
      } else {
        logger.info('RELEASE-MANAGER resource already exists');
      }

      // Log final group distribution (only for this workspace)
      const groups = await prisma.userGroup.findMany({
        where: { workspaceId }
      });

      // Fetch all group counts in a single query to avoid N+1 problem
      const groupCounts = await prisma.userGroupMapping.groupBy({
        by: ['userGroupId'],
        _count: {
          userGroupId: true,
        },
      });

      // Create a Map for O(1) lookup
      const countsMap = new Map(
        groupCounts.map((c) => [c.userGroupId, c._count.userGroupId])
      );

      logger.info('Current group distribution:');
      for (const group of groups) {
        const userCount = countsMap.get(group.id) ?? 0;
        logger.info(`  - ${group.name}: ${userCount} users`);
      }

      logger.info('Default groups and resources setup completed');
    } catch (error) {
      logger.error('Failed to ensure default groups and resources:', error);
      throw error;
    }
  }

  /**
   * Synchronize the config.json file with the database
   * This method should be called during server startup
   */
  public async syncConfigWithDatabase(): Promise<void> {
    try {
      logger.info('Starting configuration synchronization...');

      // Get all workspaces
      const workspaces = await repositories.workspaces.findMany();

      if (workspaces.length === 0) {
        logger.warn('No workspaces found. Skipping config synchronization (will run when a workspace exists).');
        return;
      }

      // Read config.json
      const config = await this.readConfig();

      // Process each workspace
      for (const workspace of workspaces) {
        logger.info(`Synchronizing config for workspace: ${workspace.name} (${workspace.id})`);

        // Get the first available model for this workspace (as specified in requirements)
        const models = await repositories.models.findMany({
          where: {
            provider: { not: 'litellm-api' },
            workspaceId: workspace.id
          }
        });
        if (models.length === 0) {
          logger.warn(`No models found for workspace ${workspace.name}. Skipping agent synchronization for this workspace.`);
          continue;
        }
        const defaultModelId = models[0].id;

        // Get all existing tools for validation (scoped to workspace)
        const allTools = await repositories.tools.findMany({
          where: { workspaceId: workspace.id }
        });
        const toolNameToIdMap = new Map(allTools.map(tool => [tool.name, tool.id]));

        // Process each agent in config
        for (const [agentName, agentConfig] of Object.entries(config)) {
          await this.syncAgent(agentName, agentConfig, defaultModelId, toolNameToIdMap, workspace.id);
        }
      }

      logger.info('Configuration synchronization completed successfully for all workspaces');
    } catch (error) {
      logger.error('Configuration synchronization failed:', error);
      throw error;
    }
  }

  /**
   * Get the config from the TypeScript configuration
   */
  private async readConfig(): Promise<WorkflowConfig> {
    try {
      return config;
    } catch (error) {
      throw new Error(`Failed to read configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Synchronize a single agent with the database
   */
  private async syncAgent(
    agentName: string,
    agentConfig: AgentConfig,
    defaultModelId: string,
    toolNameToIdMap: Map<string, string>,
    workspaceId: string
  ): Promise<void> {
    try {
      // Validate that all tools exist in database
      const invalidTools = agentConfig.tools.filter(tool => !toolNameToIdMap.has(tool.name));
      if (invalidTools.length > 0) {
        throw new Error(`Invalid tool names found for agent '${agentName}': ${invalidTools.map(t => t.name).join(', ')}`);
      }

      // Check if agent name already exists using efficient query (scoped to workspace)
      const existingAgents = await repositories.agents.findMany({
        where: { name: agentName, workspaceId }
      });
      const agentExists = existingAgents.length > 0;

      if (agentExists) {
        logger.info(`Agent '${agentName}' already exists, skipping creation`);
        return;
      }

      // Agent doesn't exist, create it as new (version 1)
      logger.info(`Creating new agent: ${agentName}`);
      await this.createNewAgentVersion(agentName, agentConfig, defaultModelId, toolNameToIdMap, 1, "new agent", workspaceId);
    } catch (error) {
      logger.error(`Failed to sync agent '${agentName}':`, error);
      throw error;
    }
  }

  /**
   * Check if a new version is needed
   * COMMENTED OUT - Currently not used since we only create new agents, not versions
   */
  /*
  private async needsNewVersion(
    latestAgent: Agent | null,
    agentConfig: AgentConfig,
    toolNameToIdMap: Map<string, string>
  ): Promise<{ required: boolean; reason: string }> {
    if (!latestAgent) {
      return { required: true, reason: "new" };
    }

    // Check if systemPrompt changed
    if (latestAgent.systemPrompt !== agentConfig.systemPrompt) {
      return { required: true, reason: "systemPrompt updated" };
    }

    // Check if tools changed
    const existingMappings = await repositories.agentToolsMappings.findByAgentId(latestAgent.id);
    const existingToolMap = new Map(
      existingMappings.map(mapping => [mapping.toolId, mapping.status])
    );

    // Create current config tool map
    const configToolMap = new Map(
      agentConfig.tools.map(tool => [
        toolNameToIdMap.get(tool.name)!,
        tool.status === ToolStatus.ENABLED ? 'Enabled' : 'Disabled'
      ])
    );

    // Check if tool sets are different
    if (existingToolMap.size !== configToolMap.size) {
      return { required: true, reason: "tool change" };
    }

    for (const [toolId, status] of configToolMap) {
      if (!existingToolMap.has(toolId) || existingToolMap.get(toolId) !== status) {
        return { required: true, reason: "tool change" };
      }
    }

    return { required: false, reason: "" };
  }
  */

  /**
   * Create a new version of an agent and its tool mappings
   */
  private async createNewAgentVersion(
    agentName: string,
    agentConfig: AgentConfig,
    defaultModelId: string,
    toolNameToIdMap: Map<string, string>,
    version: number,
    reason: string,
  workspaceId: string
  ): Promise<void> {
    // Create unique userDefinedId with version
    const userDefinedId = `${agentName}-v${version}`;

    // Create agent
    const newAgent = await repositories.agents.create({
      userDefinedId: userDefinedId,
      name: agentName,
      model: { connect: { id: defaultModelId } },
      systemPrompt: agentConfig.systemPrompt,
      description: `Version ${version} - ${reason}`,
      version: version,
      temp: 0.1,
      scope: 'project',
      workspace: { connect: { id: workspaceId } }
    });

    // Create tool mappings
    for (const tool of agentConfig.tools) {
      const toolId = toolNameToIdMap.get(tool.name)!;
      await repositories.agentToolsMappings.create({
        agent: { connect: { id: newAgent.id } },
        tool: { connect: { id: toolId } },
        status: tool.status === ToolStatus.ENABLED ? 'Enabled' : 'Disabled',
        specialDescription: `Version ${version} - ${reason}: Auto-configured tool mapping from config.ts`,
        workspaceId
      });
    }

    logger.info(`Successfully created agent '${agentName}' version ${version} with ${agentConfig.tools.length} tool mappings. Reason: ${reason}`);
  }

  /**
   * Get the latest version of an agent by name
   */
  public async getLatestAgentVersion(agentName: string): Promise<Agent | null> {
    const allAgents = await repositories.agents.findMany();
    const relatedAgents = allAgents.filter(agent => agent.name === agentName);
    
    if (relatedAgents.length === 0) {
      return null;
    }

    return relatedAgents.sort((a, b) => Number(b.version) - Number(a.version))[0];
  }
}

export const configSyncService = new ConfigSyncService();
