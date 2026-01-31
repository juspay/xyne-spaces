import { Request, Response } from 'express';
import { botRegistry } from '../bots/core/bot-registry.js';
import { botProcessor } from '../services/bots/botProcessor.js';
import { ConversationRepository } from '../database/repositories/conversationRepository.js';
import { ChannelRepository } from '../database/repositories/channelRepository.js';

/**
 * Bot information for API response
 */
interface BotInfo {
  name: string;
  description: string;
  version?: string;
  category?: string;
  scope?: 'conversation' | 'thread' | 'all';
  inputSchema: Record<string, unknown>;
}

/**
 * List all registered bots with their metadata and schemas
 * Supports optional scope query parameter to filter by conversation/thread
 */
export const listBots = async (req: Request, res: Response): Promise<void> => {
  try {
    const { scope } = req.query;
    
    let bots;
    
    if (scope) {
      // Validate scope parameter
      if (!['conversation', 'thread'].includes(scope as string)) {
        res.status(400).json({
          success: false,
          error: {
            message: 'Invalid scope. Must be "conversation" or "thread"'
          }
        });
        return;
      }
      
      bots = botRegistry.getBotsByScope(scope as 'conversation' | 'thread');
    } else {
      // No scope provided, return all bots
      bots = botRegistry.getAllBots();
    }
    
    const botList: BotInfo[] = bots.map(bot => ({
      name: bot.metadata.name,
      description: bot.metadata.description,
      version: bot.metadata.version,
      category: bot.metadata.category,
      scope: bot.metadata.scope,
      inputSchema: convertZodSchemaToJson(bot.schemas.input)
    }));

    res.status(200).json({
      success: true,
      data: {
        bots: botList,
        totalCount: botList.length,
        ...(scope && { filteredByScope: scope })
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch bots',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
};

/**
 * Trigger a bot execution with specified context
 * Accepts botName, channelId, conversationId, and parameters
 */
export const triggerBot = async (req: Request, res: Response): Promise<void> => {
  try {
    const { botName, channelId, conversationId, parameters, userId } = req.body;

    // Validate required fields
    if (!botName || !channelId || !conversationId || !userId) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Missing required fields: botName, channelId, conversationId, userId'
        }
      });
      return;
    }

    // Validate bot exists
    const bot = botRegistry.getBot(botName);
    if (!bot) {
      res.status(404).json({
        success: false,
        error: {
          message: `Bot '${botName}' not found`
        }
      });
      return;
    }

    // Validate channel exists
    const channelRepository = new ChannelRepository();
    const channel = await channelRepository.findById(channelId);
    if (!channel) {
      res.status(404).json({
        success: false,
        error: {
          message: `Channel '${channelId}' not found`
        }
      });
      return;
    }

    // Validate conversation exists and belongs to channel
    const conversationRepository = new ConversationRepository();
    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation) {
      res.status(404).json({
        success: false,
        error: {
          message: `Conversation '${conversationId}' not found`
        }
      });
      return;
    }

    if (conversation.channelId !== channelId) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Conversation does not belong to the specified channel'
        }
      });
      return;
    }

    // Validate bot input parameters
    let validatedInput;
    try {
      if (parameters) {
        validatedInput = bot.schemas.input.parse(parameters);
      } else {
        validatedInput = {};
      }
    } catch (error) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid bot parameters',
          details: error instanceof Error ? error.message : 'Validation failed'
        }
      });
      return;
    }

    // Generate execution ID
    const executionId = conversation.initialMessageId;

    // Queue bot execution
    const queued = await botProcessor.queueBotExecution({
      executionId,
      conversationId,
      botName,
      input: validatedInput,
      userId
    });

    if (!queued) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to queue bot execution'
        }
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        executionId,
        botName,
        conversationId,
        channelId,
        status: 'queued',
        queuedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to trigger bot execution',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
};



/**
 * Convert Zod schema to JSON schema representation
 * This is a simplified conversion - in production you might want to use a proper Zod to JSON Schema library
 */
function convertZodSchemaToJson(schema: any): Record<string, unknown> {
  try {
    // Try to get the schema definition
    if (schema._def) {
      const def = schema._def;
      
      // Handle different Zod types
      switch (def.typeName) {
        case 'ZodObject':
          const properties: Record<string, unknown> = {};
          const required: string[] = [];
          
          if (def.shape) {
            for (const [key, value] of Object.entries(def.shape())) {
              properties[key] = convertZodSchemaToJson(value);
              
              // Check if field is optional
              if (!(value as any)._def.typeName?.includes('Optional')) {
                required.push(key);
              }
            }
          }
          
          return {
            type: 'object',
            properties,
            ...(required.length > 0 && { required })
          };
          
        case 'ZodString':
          return { type: 'string' };
          
        case 'ZodNumber':
          return { type: 'number' };
          
        case 'ZodBoolean':
          return { type: 'boolean' };
          
        case 'ZodArray':
          return {
            type: 'array',
            items: convertZodSchemaToJson(def.type)
          };
          
        case 'ZodEnum':
          return {
            type: 'string',
            enum: def.values
          };
          
        case 'ZodOptional':
          return convertZodSchemaToJson(def.innerType);
          
        case 'ZodDefault':
          const baseSchema = convertZodSchemaToJson(def.innerType);
          return {
            ...baseSchema,
            default: def.defaultValue()
          };
          
        default:
          return { type: 'unknown', zodType: def.typeName };
      }
    }
    
    // Fallback for unknown schema types
    return { type: 'unknown' };
  } catch (error) {
    // If conversion fails, return a basic representation
    return { 
      type: 'unknown', 
      error: 'Failed to convert schema',
      details: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}