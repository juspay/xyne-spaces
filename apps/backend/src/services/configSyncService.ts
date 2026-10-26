import { repositories } from '../database/repositories';
import { logger } from '../utils/logger';
import { config as appConfig } from '../config/env';

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
}

export const configSyncService = new ConfigSyncService();
