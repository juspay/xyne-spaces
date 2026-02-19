import { z } from 'zod';
import { Bot, UnifiedBaseBot } from '@/bots/unified/index.js';
import type { BotExecutionContext, InternalBotDefinition, BotEvent } from '@/bots/unified/types/index.js';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { createFlowJson, createSingleLineText, createMultiLineText, createFlexLayout, createTag, createSplitTag, createAvatarGroup } from '@/bots/json-ui';
import type { Component } from '@/bots/json-ui/types';
import type { FlowJson } from '@/bots/json-ui/types';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { MessageRepository } from '@/database/repositories/messageRepository';
import { Ticket, PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { LLMClient, UserMessage, createUserMessage } from '@framework';
import { workflowManager } from '@/workflows/services/workflowManager';
import { workflowRerunService } from '@/workflows/services/workflowRerunService';
import { workflowRegistry } from '@/workflows/registry/workflowRegistry';
import { WorkflowType } from '@/workflows/types/workflow-enums';
import { ConversationSummarizationService } from '@/services/conversationSummarizationService';

// Define types for the bot
type TicketBotInput = {
  title: string;
  description?: string;
  workflowType: string; // Changed from TicketCategory enum to string
  repoUrl?: string;
  maxIterations?: string;
  model?: string;
  pr_url?: string;
  // Coder workflow specific fields
  userPrompt?: string;
  product?: string;
  // Bot output inclusion flag
  botOutput?: string;
};

type TicketBotOutput = {
  ticketId: string;
  xyneId: string; // Changed from humanReadableId
  status: string;
  title: string;
  workflowType: string;
};

// Input schema with string-based validation (frontend sends strings)
const TicketBotInputSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  workflowType: z.string().min(1, 'Workflow type is required'),
  repoUrl: z.string().url().optional().or(z.literal('')),
  maxIterations: z.string().optional(),
  model: z.string().optional(),
  pr_url: z.string().url().optional().or(z.literal('')),
  // Coder workflow specific fields
  userPrompt: z.string().optional(),
  product: z.string().optional(),
  // Bot output inclusion flag
  botOutput: z.string().optional()
});

const TicketBotOutputSchema: z.ZodType<TicketBotOutput> = z.object({
  ticketId: z.string(),
  xyneId: z.string(),
  status: z.string(),
  title: z.string(),
  workflowType: z.string()
});

@Bot({
  id: 'ticket-bot',
  name: 'Ticket Bot',
  email: 'ticket-bot@bot.xyne.ai',
  description: 'Creates tickets with workflow automation',
  inputSchema: TicketBotInputSchema,
  outputSchema: TicketBotOutputSchema,
  scope: 'all',
  interactionMode: 'execute',
})
export class TicketBot extends UnifiedBaseBot<TicketBotInput, TicketBotOutput> {
  protected readonly definition: InternalBotDefinition<TicketBotInput, TicketBotOutput> = {
    id: 'ticket-bot',
    name: 'Ticket Bot',
    email: 'ticket-bot@bot.xyne.ai',
    description: 'Creates tickets with workflow automation',
    runtimeType: 'internal',
    inputSchema: TicketBotInputSchema,
    outputSchema: TicketBotOutputSchema,
    scope: 'all',
  };

  private conversationRepository: ConversationRepository;
  private messageRepository: MessageRepository;
  private llmClient: LLMClient;
  private summarizationService: ConversationSummarizationService;
  private prisma: PrismaClient;

  // Model configuration
  private readonly MODEL = 'glm-latest';
  private readonly COMPACTION_THRESHOLD = 0.95; // 95%

  // Model limits (from framework)
  private readonly MODEL_CONTEXT_WINDOW: number;
  private readonly MAX_OUTPUT_TOKENS = 4000; // Standard output limit

  constructor() {
    super();
    this.conversationRepository = new ConversationRepository();
    this.messageRepository = new MessageRepository();
    this.prisma = DatabaseClient.getInstance();

    if (!process.env.LITELLM_API_KEY) {
      throw new Error('LITELLM_API_KEY is not set in the environment variables.');
    }
    this.llmClient = new LLMClient({
      provider: {
        type: 'litellm',
        config: {
          apiKey: process.env.LITELLM_API_KEY,
          baseUrl: process.env.LITELLM_BASE_URL,
          timeout: 120000, // 2 minutes for large summarization tasks
        },
      },
      defaultModel: this.MODEL,
    });

    // Get model context window from framework
    this.MODEL_CONTEXT_WINDOW = this.llmClient.getContextWindow(this.MODEL);

    // Initialize summarization service
    this.summarizationService = new ConversationSummarizationService(this.llmClient, {
      defaultChunkSize: 30000, // Reduced from 55500 to 30000 for faster processing
      modelLimits: {
        contextWindow: this.MODEL_CONTEXT_WINDOW,
        maxOutputTokens: this.MAX_OUTPUT_TOKENS,
        safetyMargin: 0.85
      }
    });

    logger.info(`[TicketBot] Summarization service initialized (model: ${this.MODEL}, context: ${this.MODEL_CONTEXT_WINDOW}, threshold: 95%)`);
  }

  /**
   * Summarize bot messages (always summarizes when called)
   */
  private async _summarizeBotMessages(botMessages: string[]): Promise<string> {
    logger.info(`[TicketBot] Summarizing ${botMessages.length} bot messages`);
    
    if (!botMessages || botMessages.length === 0) {
      logger.info('[TicketBot] No bot messages to summarize.');
      return '';
    }

    const formattedMessages = botMessages.join('\n\n');

    const prompt = `Please summarize the following bot responses from a conversation. Focus on highlighting:
- Key actions taken by the bot
- Important results or outputs
- Any errors or issues encountered
- Relevant information for understanding what the bot did

Bot messages:
${formattedMessages}

Provide a concise but informative summary:`;

    const llmMessages: UserMessage[] = [createUserMessage(prompt)];

    try {
      const response = await this.llmClient.generate({
        model: config.workflow.defaultModelName,
        messages: llmMessages,
      });

      const summary = response.content || 'Could not summarize bot messages.';
      logger.info(`[TicketBot] Received summary from LLM: ${summary.substring(0, 100)}...`);
      return summary;
    } catch (error) {
      logger.error(`[TicketBot] Error summarizing bot messages:`, error);
      return 'Error generating bot message summary.';
    }
  }

  protected async *executeInternal(
    input: TicketBotInput,
    context: BotExecutionContext
  ): AsyncGenerator<BotEvent> {
    try {
      logger.info(`[TicketBot] Execution started with executionId: ${context.executionId}`, { input, context });
      logger.info(`[TicketBot] Input product:`, input.product);
      logger.info(`[TicketBot] Input userPrompt:`, input.userPrompt);
      logger.info(`[TicketBot] Input botOutput:`, input.botOutput);
      logger.info(`Ticket Bot execution started: ${context.executionId}`);

      // Parse botOutput flag (default: false)
      const includeBotOutput = input.botOutput?.toLowerCase() === 'true';
      logger.info(`[TicketBot] Include bot output in description: ${includeBotOutput}`);

      let description = input.description;
      if (context.conversationId) {
        logger.info(`[TicketBot] ConversationId found: ${context.conversationId}. Fetching all messages.`);
        try {
          // Fetch all messages from the conversation
          const messages = await this.messageRepository.findMany({ conversationId: context.conversationId });

          if (messages && messages.length > 0) {
            // Helper function to strip HTML tags and extract plain text
            const stripHtml = (html: string): string => {
              return html
                .replace(/<[^>]*>/g, '') // Remove HTML tags
                .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
                .replace(/&/g, '&')  // Replace & with &
                .replace(/</g, '<')   // Replace < with <
                .replace(/>/g, '>')   // Replace > with >
                .replace(/"/g, '"') // Replace " with "
                .trim();
            };

            // Helper function to check if message is a bot message (JSON format)
            const isBotMessage = (content: string): boolean => {
              try {
                const parsed = JSON.parse(content);
                return parsed.version && parsed.metadata && parsed.root;
              } catch {
                return false;
              }
            };

            // Helper function to extract readable content from bot FlowJSON
            const extractBotContent = (content: string): string => {
              try {
                const parsed = JSON.parse(content);
                if (parsed.version && parsed.metadata && parsed.root) {
                  // This is FlowJSON - try to extract meaningful text
                  const extractTextFromNode = (node: any): string => {
                    let text = '';
                    if (node.type === 'singleLineText' || node.type === 'multiLineText') {
                      text += node.props?.text || '';
                    }
                    if (node.children && Array.isArray(node.children)) {
                      text += node.children.map(extractTextFromNode).join(' ');
                    }
                    return text;
                  };
                  return extractTextFromNode(parsed.root).trim();
                }
              } catch {
                // Not valid JSON, return as is
              }
              return stripHtml(content);
            };

            // Helper function to clean error messages (same logic as botExecutionSession)
            const cleanErrorMessage = (error: string): string => {
              let cleanedError = error;

              // Remove "Bot execution failed:" prefix
              cleanedError = cleanedError.replace(/Bot execution failed:\s*/, '');

              // For Prisma errors, extract the meaningful message at the end
              if (cleanedError.includes('Invalid `prisma.') && cleanedError.includes('A record with this')) {
                const meaningfulMatch = cleanedError.match(/A record with this \w+ already exists/);
                if (meaningfulMatch) {
                  return meaningfulMatch[0];
                }
              }

              // Handle other common Prisma constraint errors
              cleanedError = cleanedError.replace(/Unique constraint failed on the fields: \(`(\w+)`\)/, 'A record with this $1 already exists');

              // Remove Prisma invocation details (everything before the meaningful message)
              cleanedError = cleanedError.replace(/Invalid `prisma\.\w+\.\w+\(\)` invocation[\s\S]*?(?=A record with this|Unique constraint|$)/g, '');

              return cleanedError.trim();
            };

            // Helper function to filter out ticket-bot command lines and clean error messages
            const filterTicketBotCommands = (text: string): string => {
              return text
                .split('\n')
                .map(line => {
                  const trimmedLine = line.trim();

                  // Filter out /ticket-bot commands
                  if (trimmedLine.startsWith('/ticket-bot')) return null;

                  // Check if this is a JSON error message from bots
                  try {
                    const parsed = JSON.parse(trimmedLine);
                    if (parsed.error && parsed.botName && parsed.messageType === 'error') {
                      // Return cleaned error message instead of filtering out completely
                      return `Error: ${cleanErrorMessage(parsed.error)}`;
                    }
                  } catch {
                    // Not JSON, check if it's a raw error message that needs cleaning
                    if (trimmedLine.includes('Invalid `prisma.') || trimmedLine.includes('Bot execution failed:')) {
                      return `Error: ${cleanErrorMessage(trimmedLine)}`;
                    }
                  }

                  return trimmedLine;
                })
                .filter(line => line !== null && line.length > 0) // Remove null and empty lines
                .join('\n')
                .trim();
            };

            // Process messages based on botOutput flag
            if (includeBotOutput) {
              // Separate user messages and bot messages
              const userMessages: string[] = [];
              const botMessages: string[] = [];

              messages.forEach((msg: any) => {
                if (msg.msgType === 'BOT' && isBotMessage(msg.content)) {
                  const botContent = extractBotContent(msg.content);
                  const filteredBotContent = filterTicketBotCommands(botContent);
                  if (filteredBotContent) {
                    botMessages.push(filteredBotContent);
                  }
                } else {
                  const userContent = stripHtml(msg.content);
                  const filteredUserContent = filterTicketBotCommands(userContent);
                  if (filteredUserContent) {
                    userMessages.push(filteredUserContent);
                  }
                }
              });

              logger.info(`[TicketBot] Separated messages: ${userMessages.length} user messages, ${botMessages.length} bot messages`);

              // Build description with user messages and summarized bot messages
              const userSection = userMessages.join('\n');
              
              let botSection = '';
              if (botMessages.length > 0) {
                logger.info(`[TicketBot] Summarizing ${botMessages.length} bot messages...`);
                const botSummary = await this._summarizeBotMessages(botMessages);
                if (botSummary) {
                  botSection = `\n\n--- Bot Output Summary ---\n${botSummary}`;
                }
              }

              description = userSection + botSection || input.description || 'No conversation content found.';
              logger.info(`[TicketBot] Combined description length: ${description.length} characters`);
            } else {
              // Only include user messages (existing behavior)
              const processedMessages = messages
                .filter((msg: any) => !isBotMessage(msg.content)) // Filter out bot messages
                .map((msg: any) => stripHtml(msg.content))       // Strip HTML tags
                .map((text: string) => filterTicketBotCommands(text)) // Remove /ticket-bot commands
                .filter((text: string) => text.length > 0);         // Remove empty messages

              description = processedMessages.join('\n') || input.description || 'No conversation content found.';
              logger.info(`[TicketBot] Extracted ${messages.length} messages (includeBotOutput: ${includeBotOutput}), processed to: ${(description || '').substring(0, 200)}...`);
            }
          } else {
            logger.info('[TicketBot] No messages found in conversation.');
            description = input.description || 'No conversation history found.';
          }
        } catch (fetchError) {
          logger.error(`[TicketBot] Failed to fetch messages:`, fetchError);
          description = input.description || 'Failed to fetch conversation messages';
        }
      } else {
        logger.info('[TicketBot] No conversationId found. Using input description.');
      }

      // Check if description exceeds token threshold and summarize if needed
      if (description && description.length > 0) {
        logger.info(`[TicketBot] Checking description token count...`);
        
        try {
          // Count tokens in the final description
          const descriptionTokens = await this.llmClient.countTokens(
            [createUserMessage(description)],
            [], // No tools
            this.MAX_OUTPUT_TOKENS
          );
          
          const threshold = Math.floor((this.MODEL_CONTEXT_WINDOW - this.MAX_OUTPUT_TOKENS) * this.COMPACTION_THRESHOLD);
          
          logger.info(
            `[TicketBot] Description tokens: ${descriptionTokens}/${this.MODEL_CONTEXT_WINDOW} ` +
            `(${(descriptionTokens / this.MODEL_CONTEXT_WINDOW * 100).toFixed(1)}% of context, ` +
            `${(descriptionTokens / threshold * 100).toFixed(1)}% of threshold)` +
            ` [using framework token counter]`
          );

          if (descriptionTokens >= threshold) {
            logger.info(`[TicketBot] Description exceeds threshold! Summarizing...`);
            
            try {
              const result = await this.summarizationService.summarize({
                messages: [description],
                context: { type: 'general' },
                chunkingConfig: {
                  enabled: true,
                  chunkSize: 30000
                }
              });

              logger.info(
                `[TicketBot] Description summarized: ${description.length} chars → ${result.summary.length} chars ` +
                `(used ${result.tokensUsed.total} tokens for summarization)`
              );

              description = result.summary;
              logger.info(`[TicketBot] ✅ Using summarized description. Preview: ${description.substring(0, 200)}...`);
            } catch (summarizeError) {
              logger.error(`[TicketBot] ⚠️ Description summarization failed, using original:`, summarizeError);
            }
          } else {
            logger.info(`[TicketBot] ✅ Description within limits, using as is`);
          }
        } catch (tokenCountError) {
          logger.error(`[TicketBot] ⚠️ Token counting failed, using description as is:`, tokenCountError);
        }
      }

      // Get the initial message of the conversation to update it later
      logger.info(`[TicketBot] Finding conversation: ${context.conversationId}`);
      const conversation = await this.conversationRepository.findById(context.conversationId);
      if (!conversation || !conversation.initialMessageId) {
        yield this.createErrorEvent('Could not find conversation or initial message to update', { channelId: context.channelId });
        return;
      }
      logger.info(`[TicketBot] Found conversation with initialMessageId: ${conversation.initialMessageId}`);

      // Check for existing ticket with same conversation
      const existingTicket = await this.prisma.ticket.findFirst({
        where: { conversationId: context.conversationId }
      });

      let ticket;
      let isUpdate = false;

      if (existingTicket) {
        logger.info(`[TicketBot] Found existing ticket ${existingTicket.xyneId} for conversation ${context.conversationId}`);

        // Check if workflow is already running
        const { WorkflowRepository } = await import('@/database/repositories/workflowRepository');
        const workflowRepo = new WorkflowRepository();
        const hasActiveWorkflow = await workflowRepo.hasActiveWorkflow(existingTicket.id);

        if (hasActiveWorkflow) {
          // Return error - workflow already running
          yield this.createErrorEvent(
            `Ticket ${existingTicket.xyneId} already has a running workflow. ` +
            `Please wait for it to complete before starting a new run.`,
            { channelId: context.channelId }
          );
          return;
        }

        // TODO: Update ticket using Zero mutators when ticket-bot is refactored
        // For now, just reuse the existing ticket without updating
        ticket = existingTicket;
        isUpdate = true;

        logger.info(`Ticket reused for workflow: ${ticket.xyneId}`);
        logger.info(`[TicketBot] Reusing existing ticket: ${ticket.xyneId}`);
      } else {
        // Ticket creation is now done via API only
        yield this.createErrorEvent('Ticket creation via bot is disabled. Please create tickets using the API endpoint POST /tickets', { channelId: context.channelId });
        return;
      }

      // Create FlowJson for the ticket creation result
      logger.info(`[TicketBot] Creating FlowJson for ticket`);
      const ticketFlowJson = this.createTicketFlowJson(ticket);
      logger.info(`[TicketBot] FlowJson created successfully`);

      // Post the ticket creation result as a new bot message
      logger.info(`[TicketBot] Posting ticket creation result as bot message to conversation ${context.conversationId}`);

      // Get bot info for message creation
      const botId = this.getBotId();
      const botName = this.getBotName();
      const botEmail = this.getBotEmail();
      const botPicture = this.getBotPicture();
      logger.info(`[TicketBot] Bot info:`, { id: botId, name: botName, email: botEmail });

      // Import repositories and services to create the bot message
      const { repositories } = await import('@/database/repositories');
      const { websocketService } = await import('@/services/websocketService');
      const { redisService } = await import('@/services/redisService');

      // Ensure bot user exists in the database
      try {
        let botUser = await repositories.users.findById(botId);
        if (!botUser) {
          logger.info(`[TicketBot] Bot user not found, creating bot user: ${botId}`);
          botUser = await repositories.users.create({
            id: botId,
            name: botName,
            email: botEmail,
            picture: botPicture,
            providerUserId: botId, // Use bot ID as provider user ID
            // Add any other required fields for user creation
          });
          logger.info(`[TicketBot] Bot user created successfully:`, botUser);
        } else {
          logger.info(`[TicketBot] Bot user already exists:`, botUser);
        }
      } catch (userError) {
        logger.error(`[TicketBot] Error handling bot user:`, userError);
      }

      const messageData = {
        conversationId: context.conversationId,
        senderId: botId,
        content: JSON.stringify(ticketFlowJson),
        msgType: 'BOT' as const,
        hasAttachment: false
      };
      logger.info(`[TicketBot] Creating message with data:`, messageData);

      const createdMessage = await repositories.messages.create(messageData);
      logger.info(`[TicketBot] Message created in database:`, createdMessage.messageId);

      // Broadcast the message to frontend
      const chatMessage = {
        messageId: createdMessage.messageId,
        conversationId: createdMessage.conversationId,
        senderId: createdMessage.senderId,
        senderName: botName,
        senderPicture: botPicture,
        content: createdMessage.content,
        msgType: createdMessage.msgType,
        createdAt: createdMessage.createdAt,
      };

      logger.info(`[TicketBot] Broadcasting message via WebSocket and Redis`);
      
      // Broadcast via WebSocket
      await websocketService.broadcastToSession(context.conversationId, 'new_message', chatMessage);
      
      // Broadcast via Redis for horizontal scaling
      await redisService.broadcastMessageToSession(context.conversationId, chatMessage);

      // Update conversation reply count and last activity
      await this.conversationRepository.incrementReplyCount(context.conversationId);

      // Update channel last activity
      const conversationForChannel = await this.conversationRepository.findById(context.conversationId);
      if (conversationForChannel) {
        const { ChannelRepository } = await import('@/database/repositories/channelRepository');
        const channelRepository = new ChannelRepository();
        await channelRepository.updateLastActivity(conversationForChannel.channelId);
      }

      logger.info(`[TicketBot] Bot message posted and broadcasted successfully`);

      // Trigger workflow execution asynchronously
      setImmediate(async () => {
        try {
          logger.info(`[TicketBot] Starting workflow execution for ticket ${ticket.id}`);

          // Convert TicketCategory to WorkflowType
          const workflowType = input.workflowType as string as WorkflowType;

          // Use schema-based context building (replaces manual context building)
          const workflowDef = workflowRegistry.get(workflowType);
          if (!workflowDef) {
            throw new Error(`Workflow definition not found for type ${workflowType}`);
          }

          if (!workflowDef.inputSchema || !workflowDef.contextMapper) {
            throw new Error(`Workflow ${workflowType} is missing inputSchema or contextMapper`);
          }

          // Build unified input payload for schema validation
          const inputPayload = {
            ticketId: ticket.id,
            bugId: ticket.id,
            description: description || '',
            severity: 'medium' as 'low' | 'medium' | 'high' | 'critical', // Default severity
            reportedBy: context.userId,
          };

          // Validate input and build context using schema-based approach
          const validatedInput = workflowDef.inputSchema.parse(inputPayload);
          const workflowContext = workflowDef.contextMapper(validatedInput);

          if (isUpdate) {
            // For updates, use workflow rerun service
            const rerunResult = await workflowRerunService.rerunFromStart({
              ticketId: ticket.id,
              updatedContext: workflowContext
            });

            logger.info(`[TicketBot] Created rerun execution ${rerunResult.rerunExecutionId} for ticket ${ticket.id}`);
          } else {
            // For new tickets, use original workflow start logic
            const workflowRequest = {
              ticketId: ticket.id,
              workflowType,
              context: workflowContext,
              xyneId: ticket.xyneId, 
              conversationId: context.conversationId,
              createdBy: ticket.createdBy,
            };

            logger.info(`[TicketBot] Triggering workflow with context:`, workflowRequest);
            await workflowManager.startWorkflow(workflowRequest);
            logger.info(`[TicketBot] Workflow started successfully for ticket ${ticket.id}`);
          }
        } catch (workflowError) {
          logger.error(`[TicketBot] Failed to start workflow for ticket ${ticket.id}:`, workflowError);
          logger.error('Failed to start workflow from ticket-bot:', workflowError);
        }
      });

      yield this.createDoneEvent({
        fullContent: `Ticket ${ticket.xyneId} processed successfully`,
        channelId: context.channelId,
      });

    } catch (error) {
      logger.error(`Ticket Bot execution failed: ${context.executionId}`, error);
      yield this.createErrorEvent(
        error instanceof Error ? error.message : 'Unknown error occurred',
        { channelId: context.channelId }
      );
    }
  }

  protected createInputFlowJson(input: TicketBotInput): FlowJson {
    // Create components showing the ticket creation request
    const titleComponent = createSingleLineText('Ticket Creation Request:', {
      weight: 'bold',
      size: 'md'
    });

    const ticketTitleComponent = createSingleLineText(`Title: ${input.title}`, {
      weight: 'medium'
    });

    const workflowTypeComponent = createSingleLineText(`Workflow Type: ${input.workflowType}`, {
      weight: 'medium'
    });

    const components: Component[] = [titleComponent, ticketTitleComponent, workflowTypeComponent];

    if (input.description) {
      components.push(createMultiLineText(`Description: ${input.description}`, {
        weight: 'normal',
        maxLines: 3
      }));
    }

    if (input.repoUrl) {
      components.push(createSingleLineText(`Repository: ${input.repoUrl}`, {
        weight: 'normal'
      }));
    }

    // Create layout with all components
    const rootComponent = createFlexLayout(components, {
      direction: 'column',
      gap: 8
    });

    const flowJsonResult = createFlowJson('ticket-bot', rootComponent);
    
    if (!flowJsonResult.success) {
      // Fallback to simple format
      const fallbackText = `Ticket Request: ${input.title} (${input.workflowType})`;
      const fallbackComponent = createSingleLineText(fallbackText);
      const fallbackResult = createFlowJson('ticket-bot', fallbackComponent);
      return fallbackResult.success ? fallbackResult.data : {
        version: '1.0',
        metadata: { botName: 'ticket-bot', timestamp: new Date().toISOString() },
        root: { type: 'singleLineText', props: { text: fallbackText } }
      };
    }

    return flowJsonResult.data;
  }

  private createTicketFlowJson(ticket: Ticket): FlowJson {
    // Map ticket status to tag color
    const getStatusColor = (status: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' => {
      const statusLower = status.toLowerCase();
      if (statusLower === 'completed' || statusLower === 'closed' || statusLower === 'resolved') return 'success';
      if (statusLower === 'in_progress' || statusLower === 'open' || statusLower === 'processing') return 'info';
      if (statusLower === 'blocked' || statusLower === 'failed') return 'error';
      if (statusLower === 'pending' || statusLower === 'review') return 'warning';
      return 'neutral';
    };

    // Map ticket type to tag color
    const getTypeColor = (workflowType: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' => {
      const typeLower = workflowType.toLowerCase();
      if (typeLower.includes('bug')) return 'error';
      if (typeLower.includes('feature') || typeLower.includes('enhancement')) return 'info';
      return 'neutral';
    };

    // Ticket ID (simple text)
    const ticketIdComponent = createSingleLineText(ticket.xyneId, {
      weight: 'medium',
      size: 'xs',
      color: '#8492A1'
    });

    // Title
    const titleComponent = createSingleLineText(ticket.title, {
      weight: 'semibold',
      size: 'md',
      color: '#181B1D'
    });

    // Status tag - SplitTag with status formatted
    // Format status: split by underscore or use as-is, capitalize first letter
    const formatStatusForSplitTag = (status: string): { primary: string; secondary: string } => {
      const statusUpper = status.toUpperCase();
      // If status has underscore, split it (e.g., "IN_PROGRESS" -> "IN" / "PROGRESS")
      if (statusUpper.includes('_')) {
        const parts = statusUpper.split('_');
        return {
          primary: parts[0],
          secondary: parts.slice(1).join(' ')
        };
      }
      // Otherwise, use "STATUS" as primary and status as secondary
      return {
        primary: statusUpper,
        secondary: '0%'
      };
    };
    
    const statusParts = formatStatusForSplitTag(ticket.statusV2);
    const statusTag = createSplitTag(
      statusParts.primary,
      statusParts.secondary,
      {
        variant: 'subtle',
        color: getStatusColor(ticket.statusV2),
        size: 'sm'
      }
    );

    // // Created date text
    const createdDateText = createSingleLineText(`Created on ${new Date(ticket.createdAt).toLocaleDateString()}`, {
      weight: 'normal',
      size: 'sm',
      color: '#8492A1'
    });

    // Status row (tag + created date)
    const statusRow = createFlexLayout([
      statusTag,
      createdDateText
    ], {
      direction: 'row',
      gap: 6,
      align: 'start',
    });
    

    // Title row with status and date aligned horizontally
    const titleRow = createFlexLayout([
      ticketIdComponent,
      titleComponent,
    ], {
      direction: 'column',
      gap: 2,
      align: 'start',
      justify: 'between',
    });

    // Header group (ID + Title row)
    const headerGroup = createFlexLayout([
      titleRow,
      statusRow
    ], {
      direction: 'column',
      gap: 15,
      width: '100%',
    });

    // Type tag (using workflowType from metadata)
    const workflowType = (ticket.metadata as any)?.workflowType || 'unknown';
    const typeTag = createTag(workflowType, {
      variant: 'subtle',
      color: getTypeColor(workflowType),
      size: 'sm'
    });

    // Stage tag (using statusV2 as currentNode equivalent)
    const stageTag = createTag(ticket.statusV2, {
      variant: 'subtle',
      color: getStatusColor(ticket.statusV2),
      size: 'sm'
    });

    // Assigned To - AvatarGroup
    const assignedToAvatars = ticket.assignedTo
      ? [{ name: ticket.assignedTo }]
      : [{ name: 'Unassigned' }];

    const assignedToComponent = createAvatarGroup(assignedToAvatars, {
      size: 'sm'
    });

    // Details grid with Tags for Type, Stage, and Assigned To
    const detailsGrid = createFlexLayout([
      createFlexLayout([
        createSingleLineText('TYPE', {
          weight: 'medium',
          size: 'xs',
          color: '#8492A1'
        }),
        typeTag
      ], {
        direction: 'column',
        gap: 4
      }),
      createFlexLayout([
        createSingleLineText('STAGE', {
          weight: 'medium',
          size: 'xs',
          color: '#8492A1'
        }),
        stageTag
      ], {
        direction: 'column',
        gap: 4
      }),
      createFlexLayout([
        createSingleLineText('ASSIGNED TO', {
          weight: 'medium',
          size: 'xs',
          color: '#8492A1'
        }),
        assignedToComponent
      ], {
        direction: 'column',
        gap: 4
      })
    ], {
      direction: 'row',
      justify: 'between',
      align: 'start',
      padding: 16,
      background: '#F7F8FA',
      borderRadius: 12,
      width: '100%'
    });

   

    // Root container matching simplified TicketCard structure
    const rootComponent = createFlexLayout([
      headerGroup,
      detailsGrid,
    ], {
      direction: 'column',
      gap: 20,
      padding: 16,
      background: '#FFFFFF',
      borderRadius: 12
    });

    const flowJsonResult = createFlowJson('ticket-bot', rootComponent);

    if (!flowJsonResult.success) {
      // Fallback
      const fallbackText = `✅ Ticket ${ticket.xyneId} created successfully`;
      const fallbackComponent = createSingleLineText(fallbackText);
      const fallbackResult = createFlowJson('ticket-bot', fallbackComponent);
      return fallbackResult.success ? fallbackResult.data : {
        version: '1.0',
        metadata: { 
          botName: 'ticket-bot', 
          timestamp: new Date().toISOString(),
          ticketId: ticket.id,
          xyneId: ticket.xyneId
        },
        root: { type: 'singleLineText', props: { text: fallbackText } }
      };
    }

    // Add ticket metadata to the successful result
    const result = flowJsonResult.data;
    result.metadata = {
      ...result.metadata,
      ticketId: ticket.id,
      xyneId: ticket.xyneId
    };

    return result;
  }
}
