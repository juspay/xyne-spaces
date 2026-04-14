import { Request, Response } from 'express';
import { repositories } from '../database/repositories';
import { UpdateAgentInput, PaginationOptions } from '../types/database';
import {
  makeLiteLLMProvider,
  generateRunId,
  generateTraceId,
  run,
  type Agent,
  type RunState,
  type RunConfig,
} from '@juspay-jaf/jaf';
import { config } from '../config/env.js';
import {logger} from '@/utils/logger';

export class AgentController {
  createAgent = async (req: Request, res: Response): Promise<void> => {
    try {
      const agentData = req.body;

      if (
        !agentData.userDefinedId ||
        (!agentData.modelId && !agentData.model) ||
        !agentData.systemPrompt ||
        !agentData.name
      ) {
        res.status(400).json({
          error:
            'Missing required fields: userDefinedId, model, systemPrompt, and name are required',
        });
        return;
      }

      const agent = await repositories.agents.create(agentData);
      res.status(201).json(agent);
    } catch (error) {
      logger.error('Error creating agent:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  invokeAI = async (req: Request, res: Response): Promise<void> => {
    try {
      const { prompt, systemPrompt } = req.body;

      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({
          error: 'Missing or invalid prompt. Expected a string in the request body.',
        });
        return;
      }

      // Use provided system prompt or fall back to default
      const defaultSystemPrompt =
        'You are a helpful AI assistant. Provide clear, concise, and accurate responses to user queries.';
      const finalSystemPrompt =
        systemPrompt && typeof systemPrompt === 'string' ? systemPrompt : defaultSystemPrompt;

      // Create model provider
      const modelProvider = makeLiteLLMProvider(config.litellm.baseUrl, config.litellm.apiKey);

      // Create a simple generic agent
      const genericAgent: Agent<any, string> = {
        name: 'GenericAI',
        instructions: () => finalSystemPrompt,
        modelConfig: {
          temperature: 0.7,
        },
      };

      // Create agent registry
      const agentRegistry = new Map<string, Agent<any, any>>([['GenericAI', genericAgent]]);

      // Create run configuration
      const runConfig: RunConfig<any> = {
        agentRegistry,
        modelProvider,
        maxTurns: 1,
        modelOverride: 'gemini-3-flash-preview',
      };

      // Create initial state
      const initialState: RunState<any> = {
        runId: generateRunId(),
        traceId: generateTraceId(),
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        currentAgentName: 'GenericAI',
        context: {},
        turnCount: 0,
      };

      // Execute the agent
      const result = await run(initialState, runConfig);

      // Handle the result
      if (result.outcome.status === 'completed') {
        const output = result.outcome.output;
        const response = typeof output === 'string' ? output : JSON.stringify(output);

        res.status(200).json({
          data: response,
        });
      } else if (result.outcome.status === 'error') {
        throw new Error(`AI invocation failed: ${result.outcome.error._tag}`);
      } else {
        throw new Error('AI invocation was interrupted');
      }
    } catch (error) {
      logger.error('Error invoking AI:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Internal server error',
      });
    }
  };

  getAgentById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const includeRelations = req.query.include as string;

      let agent;

      if (includeRelations === 'model') {
        agent = await repositories.agents.findWithModel(id);
      } else if (includeRelations === 'tools') {
        agent = await repositories.agents.findWithTools(id);
      } else if (includeRelations === 'all') {
        agent = await repositories.agents.findFullAgent(id);
      } else {
        agent = await repositories.agents.findById(id);
      }

      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      res.status(200).json(agent);
    } catch (error) {
      logger.error('Error getting agent:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // Get agent by userDefinedId
  getAgentByUserDefinedId = async (req: Request, res: Response): Promise<void> => {
    try {
      const { userDefinedId } = req.params;

      const agent = await repositories.agents.findByUserDefinedId(userDefinedId);

      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      res.status(200).json(agent);
    } catch (error) {
      logger.error('Error getting agent by userDefinedId:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getAllAgents = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string) : 10;
      const search = req.query.search as string;
      const scope = req.query.scope as string;
      const modelId = req.query.modelId as string;

      if (page < 1) {
        res.status(400).json({ error: 'Page must be greater than 0' });
        return;
      }

      if (pageSize < 1 || pageSize > 100) {
        res.status(400).json({ error: 'PageSize must be between 1 and 100' });
        return;
      }

      const paginationOptions: PaginationOptions = { page, pageSize };

      let result;

      if (search) {
        result = await repositories.agents.findBySearch(search, paginationOptions);
      } else {
        const where: any = {};
        if (scope) where.scope = scope;
        if (modelId) where.modelId = modelId;

        result = await repositories.agents.findManyPaginated({
          ...paginationOptions,
          where: Object.keys(where).length > 0 ? where : undefined,
        });
      }

      res.status(200).json(result);
    } catch (error) {
      logger.error('Error getting all agents:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  updateAgent = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const updateData: UpdateAgentInput = req.body;

      const existingAgent = await repositories.agents.findById(id);
      if (!existingAgent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      const updatedAgent = await repositories.agents.update(id, updateData);
      res.status(200).json(updatedAgent);
    } catch (error) {
      logger.error('Error updating agent:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getAgentsByScope = async (req: Request, res: Response): Promise<void> => {
    try {
      const { scope } = req.params;

      const agents = await repositories.agents.findByScope(scope);
      res.status(200).json(agents);
    } catch (error) {
      logger.error('Error getting agents by scope:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getAgentsByModelId = async (req: Request, res: Response): Promise<void> => {
    try {
      const { modelId } = req.params;

      const agents = await repositories.agents.findByModelId(modelId);
      res.status(200).json(agents);
    } catch (error) {
      logger.error('Error getting agents by model ID:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // Get latest agent by name
  getLatestAgentByName = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name } = req.params;
      const includeRelations = req.query.include as string;

      let agent;

      if (includeRelations === 'all') {
        agent = await repositories.agents.findLatestByNameWithDetails(name);
      } else {
        agent = await repositories.agents.findLatestByName(name);
      }

      if (!agent) {
        res.status(404).json({ error: `No agent found with name '${name}'` });
        return;
      }

      res.status(200).json(agent);
    } catch (error) {
      logger.error('Error getting latest agent by name:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // Get unique agent names with latest versions (paginated)
  getUniqueAgentNames = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string) : 10;

      if (page < 1) {
        res.status(400).json({ error: 'Page must be greater than 0' });
        return;
      }

      if (pageSize < 1 || pageSize > 100) {
        res.status(400).json({ error: 'PageSize must be between 1 and 100' });
        return;
      }

      const result = await repositories.agents.findUniqueAgentNamesPaginated({
        page,
        pageSize,
      });

      res.status(200).json(result);
    } catch (error) {
      logger.error('Error getting unique agent names:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
