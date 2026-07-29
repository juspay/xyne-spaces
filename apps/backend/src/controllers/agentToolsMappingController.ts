import { Request, Response } from 'express';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { repositories } from '../database/repositories';
import { 
  CreateAgentToolsMappingInput,
  UpdateAgentToolsMappingInput
} from '../types/database';
import {logger} from '@/utils/logger';

export class AgentToolsMappingController {

  createMapping = async (req: Request, res: Response): Promise<void> => {
    try {
      const mappingData: CreateAgentToolsMappingInput = req.body;

      if (!mappingData.agent || !mappingData.tool) {
        res.status(400).json({ 
          error: 'Missing required fields: agent and tool are required' 
        });
        return;
      }

      // Stamp the tenant from the authenticated session, not the request body — a client
      // must not be able to choose the workspace, and the removed stamp extension no longer
      // fills this. Mirrors the sibling enable/disable handlers.
      const mapping = await repositories.agentToolsMappings.create({
        ...mappingData,
        workspaceId: req.user!.workspaceId!,
      });
      res.status(201).json(mapping);
    } catch (error) {
      logger.error('Error creating agent tools mapping:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getMappingById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const mapping = await repositories.agentToolsMappings.findById(id);

      if (!mapping) {
        res.status(404).json({ error: 'Agent tools mapping not found' });
        return;
      }

      res.status(200).json(mapping);
    } catch (error) {
      logger.error('Error getting agent tools mapping:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getAllMappings = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string) : 10;
      const agentId = req.query.agentId as string;
      const toolId = req.query.toolId as string;
      const status = req.query.status as string;

      if (page < 1) {
        res.status(400).json({ error: 'Page must be greater than 0' });
        return;
      }

      if (pageSize < 1 || pageSize > 100) {
        res.status(400).json({ error: 'PageSize must be between 1 and 100' });
        return;
      }

      const where: any = {};
      if (agentId) where.agentId = agentId;
      if (toolId) where.toolId = toolId;
      if (status) where.status = status;

      const skip = (page - 1) * pageSize;
      const take = pageSize;

      const [data, total] = await Promise.all([
        repositories.agentToolsMappings.findMany({
          skip,
          take,
          where: Object.keys(where).length > 0 ? where : undefined,
          orderBy: { createdAt: 'desc' }
        }),
        repositories.agentToolsMappings.findMany({ where: Object.keys(where).length > 0 ? where : undefined }).then(results => results.length)
      ]);

      const totalPages = Math.ceil(total / pageSize);

      res.status(200).json({
        data,
        pagination: {
          page,
          pageSize,
          total,
          totalPages
        }
      });
    } catch (error) {
      logger.error('Error getting all agent tools mappings:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  updateMapping = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const updateData: UpdateAgentToolsMappingInput = req.body;

      const existingMapping = await repositories.agentToolsMappings.findById(id);
      if (!existingMapping) {
        res.status(404).json({ error: 'Agent tools mapping not found' });
        return;
      }

      const updatedMapping = await repositories.agentToolsMappings.update(id, updateData);
      res.status(200).json(updatedMapping);
    } catch (error) {
      logger.error('Error updating agent tools mapping:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getMappingsByAgentId = async (req: Request, res: Response): Promise<void> => {
    try {
      const { agentId } = req.params;

      const mappings = await repositories.agentToolsMappings.findByAgentId(agentId);
      res.status(200).json(mappings);
    } catch (error) {
      logger.error('Error getting mappings by agent ID:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getMappingsByToolId = async (req: Request, res: Response): Promise<void> => {
    try {
      const { toolId } = req.params;

      const mappings = await repositories.agentToolsMappings.findByToolId(toolId);
      res.status(200).json(mappings);
    } catch (error) {
      logger.error('Error getting mappings by tool ID:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getMappingByAgentAndTool = async (req: Request, res: Response): Promise<void> => {
    try {
      const { agentId, toolId } = req.params;

      const mapping = await repositories.agentToolsMappings.findByAgentAndTool(agentId, toolId);

      if (!mapping) {
        res.status(404).json({ error: 'Agent tools mapping not found' });
        return;
      }

      res.status(200).json(mapping);
    } catch (error) {
      logger.error('Error getting mapping by agent and tool:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getMappingsByStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const { status } = req.params;

      const mappings = await repositories.agentToolsMappings.findByStatus(status);
      res.status(200).json(mappings);
    } catch (error) {
      logger.error('Error getting mappings by status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getEnabledMappings = async (_req: Request, res: Response): Promise<void> => {
    try {
      const mappings = await repositories.agentToolsMappings.findEnabledMappings();
      res.status(200).json(mappings);
    } catch (error) {
      logger.error('Error getting enabled mappings:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getMappingsWithDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const { agentId } = req.params;

      const mappings = await repositories.agentToolsMappings.findWithDetails(agentId);
      res.status(200).json(mappings);
    } catch (error) {
      logger.error('Error getting mappings with details:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  enableToolForAgent = async (req: Request, res: Response): Promise<void> => {
    try {
      const { agentId, toolId } = req.params;

      const mapping = await repositories.agentToolsMappings.enableToolForAgent(agentId, toolId);
      res.status(200).json(mapping);
    } catch (error) {
      logger.error('Error enabling tool for agent:', error);
      
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          res.status(400).json({ 
            error: 'Invalid agent or tool ID: Referenced record does not exist',
            code: 'INVALID_REFERENCE'
          });
          return;
        }
      }
      
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  disableToolForAgent = async (req: Request, res: Response): Promise<void> => {
    try {
      const { agentId, toolId } = req.params;

      const mapping = await repositories.agentToolsMappings.disableToolForAgent(agentId, toolId);
      
      if (!mapping) {
        res.status(404).json({ error: 'Agent tools mapping not found' });
        return;
      }

      res.status(200).json(mapping);
    } catch (error) {
      logger.error('Error disabling tool for agent:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Get comprehensive mapping of all agents to all tools
   * Shows which tools each agent has access to and which they don't
   */
  getAllAgentsToolsMapping = async (req: Request, res: Response): Promise<void> => {
    try {
      const includeDisabled = req.query.includeDisabled === 'true';
      const status = req.query.status as string;

      // Get all agents
      const agents = await repositories.agents.findMany();
      
      // Get all tools
      const tools = await repositories.tools.findMany();

      // Get all existing mappings
      const existingMappings = await repositories.agentToolsMappings.findMany({
        where: status ? { status } : undefined
      });

      // Create a mapping structure
      const agentToolsMapping = agents.map(agent => {
        const agentMappings = existingMappings.filter(mapping => mapping.agentId === agent.id);
        
        const toolsData = tools.map(tool => {
          const mapping = agentMappings.find(m => m.toolId === tool.id);
          
          return {
            toolId: tool.id,
            toolName: tool.name,
            toolDescription: tool.description,
            toolStatus: tool.status,
            isMapped: !!mapping,
            mappingStatus: mapping?.status || null,
            specialDescription: mapping?.specialDescription || null,
            mappingId: mapping?.id || null,
            mappingCreatedAt: mapping?.createdAt || null,
            mappingUpdatedAt: mapping?.updatedAt || null
          };
        });

        // Filter tools based on includeDisabled flag
        const filteredTools = includeDisabled ? 
          toolsData : 
          toolsData.filter(tool => 
            tool.isMapped ? tool.mappingStatus === 'Enabled' : true
          );

        return {
          agentId: agent.id,
          agentName: agent.name,
          agentUserDefinedId: agent.userDefinedId,
          agentDescription: agent.description,
          agentStatus: agent.scope,
          agentVersion: agent.version,
          totalToolsAvailable: tools.length,
          totalToolsMapped: agentMappings.length,
          totalToolsEnabled: agentMappings.filter(m => m.status === 'Enabled').length,
          totalToolsDisabled: agentMappings.filter(m => m.status === 'Disabled').length,
          tools: filteredTools
        };
      });

      // Summary statistics
      const summary = {
        totalAgents: agents.length,
        totalTools: tools.length,
        totalMappings: existingMappings.length,
        totalEnabledMappings: existingMappings.filter(m => m.status === 'Enabled').length,
        totalDisabledMappings: existingMappings.filter(m => m.status === 'Disabled').length,
        agentsWithNoTools: agentToolsMapping.filter(agent => agent.totalToolsMapped === 0).length,
        agentsWithAllTools: agentToolsMapping.filter(agent => agent.totalToolsMapped === tools.length).length
      };

      res.status(200).json({
        summary,
        mappings: agentToolsMapping
      });
    } catch (error) {
      logger.error('Error getting all agents tools mapping:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Bulk create mappings - Map specific agents to specific tools
   */
  bulkCreateMappings = async (req: Request, res: Response): Promise<void> => {
    try {
      const { mappings, status = 'Enabled' } = req.body;

      if (!mappings || !Array.isArray(mappings)) {
        res.status(400).json({ 
          error: 'mappings array is required in request body' 
        });
        return;
      }

      const results = [];
      const errors = [];

      for (const mapping of mappings) {
        try {
          const { agentId, toolId, specialDescription } = mapping;

          if (!agentId || !toolId) {
            errors.push({
              mapping,
              error: 'agentId and toolId are required'
            });
            continue;
          }

          // Check if mapping already exists
          const existingMapping = await repositories.agentToolsMappings.findByAgentAndTool(agentId, toolId);
          
          if (existingMapping) {
            // Update existing mapping
            const updatedMapping = await repositories.agentToolsMappings.update(existingMapping.id, {
              status,
              specialDescription
            });
            results.push({
              action: 'updated',
              mapping: updatedMapping
            });
          } else {
            // Create new mapping
            const newMapping = await repositories.agentToolsMappings.create({
              agent: { connect: { id: agentId } },
              tool: { connect: { id: toolId } },
              workspaceId: req.user!.workspaceId!,
              status,
              specialDescription
            });
            results.push({
              action: 'created',
              mapping: newMapping
            });
          }
        } catch (error) {
          errors.push({
            mapping,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      res.status(200).json({
        success: true,
        processed: mappings.length,
        successful: results.length,
        failed: errors.length,
        results,
        errors
      });
    } catch (error) {
      logger.error('Error bulk creating mappings:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Map all available tools to a specific agent
   */
  mapAllToolsToAgent = async (req: Request, res: Response): Promise<void> => {
    try {
      const { agentId } = req.params;
      const { status = 'Enabled', specialDescription } = req.body;

      // Verify agent exists
      const agent = await repositories.agents.findById(agentId);
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      // Get all tools
      const tools = await repositories.tools.findMany();
      
      const results = [];
      const errors = [];

      for (const tool of tools) {
        try {
          const existingMapping = await repositories.agentToolsMappings.findByAgentAndTool(agentId, tool.id);
          
          if (existingMapping) {
            // Update existing mapping
            const updatedMapping = await repositories.agentToolsMappings.update(existingMapping.id, {
              status,
              specialDescription
            });
            results.push({
              action: 'updated',
              toolId: tool.id,
              toolName: tool.name,
              mapping: updatedMapping
            });
          } else {
            // Create new mapping
            const newMapping = await repositories.agentToolsMappings.create({
              agent: { connect: { id: agentId } },
              tool: { connect: { id: tool.id } },
              workspaceId: req.user!.workspaceId!,
              status,
              specialDescription
            });
            results.push({
              action: 'created',
              toolId: tool.id,
              toolName: tool.name,
              mapping: newMapping
            });
          }
        } catch (error) {
          errors.push({
            toolId: tool.id,
            toolName: tool.name,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      res.status(200).json({
        success: true,
        agentId,
        agentName: agent.name,
        totalTools: tools.length,
        successful: results.length,
        failed: errors.length,
        results,
        errors
      });
    } catch (error) {
      logger.error('Error mapping all tools to agent:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Map a specific tool to all agents
   */
  mapToolToAllAgents = async (req: Request, res: Response): Promise<void> => {
    try {
      const { toolId } = req.params;
      const { status = 'Enabled', specialDescription } = req.body;

      // Verify tool exists
      const tool = await repositories.tools.findById(toolId);
      if (!tool) {
        res.status(404).json({ error: 'Tool not found' });
        return;
      }

      // Get all agents
      const agents = await repositories.agents.findMany();
      
      const results = [];
      const errors = [];

      for (const agent of agents) {
        try {
          const existingMapping = await repositories.agentToolsMappings.findByAgentAndTool(agent.id, toolId);
          
          if (existingMapping) {
            // Update existing mapping
            const updatedMapping = await repositories.agentToolsMappings.update(existingMapping.id, {
              status,
              specialDescription
            });
            results.push({
              action: 'updated',
              agentId: agent.id,
              agentName: agent.name,
              mapping: updatedMapping
            });
          } else {
            // Create new mapping
            const newMapping = await repositories.agentToolsMappings.create({
              agent: { connect: { id: agent.id } },
              tool: { connect: { id: toolId } },
              workspaceId: req.user!.workspaceId!,
              status,
              specialDescription
            });
            results.push({
              action: 'created',
              agentId: agent.id,
              agentName: agent.name,
              mapping: newMapping
            });
          }
        } catch (error) {
          errors.push({
            agentId: agent.id,
            agentName: agent.name,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      res.status(200).json({
        success: true,
        toolId,
        toolName: tool.name,
        totalAgents: agents.length,
        successful: results.length,
        failed: errors.length,
        results,
        errors
      });
    } catch (error) {
      logger.error('Error mapping tool to all agents:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
