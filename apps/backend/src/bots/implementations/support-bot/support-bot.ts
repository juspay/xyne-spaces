import { z } from 'zod'
import { Bot, UnifiedBaseBot } from '@/bots/unified/index.js'
import type {
  BotExecutionContext,
  InternalBotDefinition,
  BotEvent,
} from '@/bots/unified/types/index.js'
import { logger } from '@/utils/logger'
import { Channel, User } from '@prisma/client';import axios from 'axios'
import { MessageType } from '@xyne/shared';
import { superpositionClient } from '@/services/superpositionClient'
import { UserGroupRepository, UserRepository } from '@/database/repositories'
import { db } from '@/database/client'
import * as yaml from 'js-yaml'
import jwt from "jsonwebtoken";
import { getStorageService, type FileMetadata } from '@/services/storage'

const CAC_KEYS = {
  support_group_name: 'support_group_name',
} as const

type SupportBotInput = {
  conversationId: string
  ticketId: string
  responseText: string
  escalated?: boolean
  userId: string
  gcsPaths?: string[]
  documentNames?: string[]
  workflowExecutionId?: string
  workflowStepId?: string
}

type SupportBotOutput = {
  messageSent: boolean
  conversationId: string
}

const SupportBotInputSchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID is required'),
  ticketId: z.string().min(1, 'Ticket ID is required'),
  responseText: z.string().min(1, 'Response text is required'),
  escalated: z.boolean().optional(),
  userId: z.string().min(1, 'User ID is required'),
  gcsPaths: z.array(z.string()).optional(),
  documentNames: z.array(z.string()).optional(),
  workflowExecutionId: z.string().optional(),
  workflowStepId: z.string().optional(),
})

const SupportBotOutputSchema: z.ZodType<SupportBotOutput> = z.object({
  messageSent: z.boolean(),
  conversationId: z.string(),
})

const TokenPayloadSchema = z.object({
    appId: z.string().min(1, 'appId is required').trim(),
    userId: z.string().min(1, 'userId is required').trim(),
  });



@Bot({
  id: 'support-bot',
  name: 'Support Bot',
  email: 'support-bot@bot.xyne.ai',
  description: 'Provides support responses for user queries',
  inputSchema: SupportBotInputSchema,
  outputSchema: SupportBotOutputSchema,
  scope: 'all',
  interactionMode: 'execute',
})
export class SupportBot extends UnifiedBaseBot<SupportBotInput, SupportBotOutput> {
  protected readonly definition: InternalBotDefinition<SupportBotInput, SupportBotOutput> = {
    id: 'support-bot',
    name: 'Support Bot',
    email: 'support-bot@bot.xyne.ai',
    description: 'Provides support responses for user queries',
    runtimeType: 'internal',
    inputSchema: SupportBotInputSchema,
    outputSchema: SupportBotOutputSchema,
    scope: 'all',
  }

  private readonly BACKEND_URL: string;
  private readonly APP_JWT_KEY: string;
  private userGroupRepository = new UserGroupRepository();
  private userRepository = new UserRepository();
  private botUserId: string;

  constructor() {
    super();
    const backendUrl = process.env.API_BASE_URL || process.env.BACKEND_URL;
    if (!backendUrl) {
      logger.warn('API_BASE_URL or BACKEND_URL environment variable is not set');
    }
    if (!process.env.APP_JWT_KEY) {
      logger.warn('APP_JWT_KEY environment variable is not set.');
    }
    this.BACKEND_URL = backendUrl || 'http://localhost:3000';
    this.APP_JWT_KEY = process.env.APP_JWT_KEY || '';
    const parsed = TokenPayloadSchema.safeParse(jwt.decode(this.APP_JWT_KEY));
    this.botUserId = parsed.data?.userId || '';

  }

  protected async *executeInternal(
    input: SupportBotInput,
    context: BotExecutionContext
  ): AsyncGenerator<BotEvent> {
    try {
      logger.info(`[SupportBot] Execution started: ${context.executionId}`, {
        conversationId: input.conversationId,
        escalated: input.escalated,
      })

      yield this.createErrorEvent('This bot does not currently accept commands.')
    } catch (error) {
      logger.error(`[SupportBot] Execution failed: ${context.executionId}`, error)
      throw error
    }
  }

  public async getSupportGroup(): Promise<{
    id: string
    name: string
    memberCount: number
  } | null> {
    try {
      const supportGroupAlias = await superpositionClient.getStringValue(CAC_KEYS.support_group_name, "itsupport", {})
      const botUser = await db.user.findUnique({ where: { id: this.botUserId }, select: { workspaceId: true } })
      const supportGroup = await this.userGroupRepository.findByName(supportGroupAlias, botUser?.workspaceId ?? '')
      if (supportGroup) {
        const memberCount = supportGroup ? await this.userGroupRepository.getUserCount(supportGroup.id) : 0
        return {
          id: supportGroup.id,
          name: supportGroup.name,
          memberCount
        }
      }
      return null
    } catch (error) {
      logger.error('[SupportBot] Failed to load support group name:', error)
      return null
    }
  }

  async getUser(userId: string): Promise<User | null> { 
    try { 
      const user = await this.userRepository.findById(userId);
      return user;
    } catch (error) {
      logger.error(`[SupportBot] Failed to fetch user for ID ${userId}:`, error);
      return null;
    }
  }
   
  public getBotUserId(): string {
    return this.botUserId;
  }

  /**
   * Generic function to send support messages
   * Can be used for initial response or escalation
   */
  public async sendSupportMessage(params: {
    conversationId: string
    ticketId: string
    userId: string
    responseText?: string
    gcsPaths?: string[]
    documentNames?: string[]
    workflowExecutionId?: string
    workflowStepId?: string
    isEscalation?: boolean
  }): Promise<void> {
    try {
      logger.info(`[SupportBot] Sending support message to conversation: ${params.conversationId}`, {
        isEscalation: params.isEscalation,
      })

      const supportGroup = await this.getSupportGroup()

      let messageContent = ''

      if (params.isEscalation) {
        // Fetch team members
        messageContent = `This issue is now escalated to <span data-mention="${supportGroup?.name}" data-mention-type="group" data-group-id="${supportGroup?.id}" data-group-name="${supportGroup?.name}" class="chat-input-group-mention" data-member-count="${supportGroup?.memberCount}">@${supportGroup?.name}</span> (${supportGroup?.memberCount} members)\nYou can reach out to any group member directly or continue the conversation here.`
      } else {
        // Initial response message - full details
        messageContent = params.responseText || ''
      }

      let uploadedFiles: Array<{
        originalName: string
        fileName: string
        fileSize: number
        mimeType: string
        fileUrl: string
      }> | undefined

      if (params.gcsPaths && params.gcsPaths.length > 0 && !params.isEscalation) {
        // Fetch metadata for all files concurrently
        const metadataPromises = params.gcsPaths.map(gcsPath => 
          getStorageService().getFileMetadata(gcsPath)
        )
        const metadataResults: FileMetadata[] = await Promise.all(metadataPromises)

        uploadedFiles = metadataResults.map((metadata, index) => {
          const gcsPath = params.gcsPaths![index]
          const fileName = metadata.name || 'document'
          const originalName = params.documentNames?.[index] || fileName
          const mimeType = metadata.contentType || 'application/octet-stream'
          const fileSize = parseInt(String(metadata.size || '0'), 10)

          return {
            originalName,
            fileName,
            fileSize,
            mimeType,
            fileUrl: gcsPath,
          }
        })
      }

      // Build message content with frontmatter if workflow context exists
      let finalMessageContent = messageContent
      if (params.workflowExecutionId && params.workflowStepId && !params.isEscalation) {
        const frontmatterData = {
          workflowActions: {
            workflowExecutionId: params.workflowExecutionId,
            workflowStepId: params.workflowStepId,
            responded: false,
            buttons: [
              { label: 'Mark as Solved', action: 'resolved', variant: 'outline' },
              { label: 'Escalate to Team', action: 'escalate', variant: 'outline' }
            ]
          }
        }
        finalMessageContent = '---\n' + yaml.dump(frontmatterData) + '---\n\n' + messageContent
      }


      await axios.post(
        `${this.BACKEND_URL}/api/apps/chat/postMessage`,
        {
          conversationId: params.conversationId,
          text: finalMessageContent,
          msgType: MessageType.BOT,
          ...(!params.isEscalation && { contentFormat: 'markdown'}),
          ...(uploadedFiles && { uploadedFiles })
        },
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.APP_JWT_KEY}` 
          },
          timeout: 30000,
        }
      )

      logger.info(`[SupportBot] Message sent to conversation: ${params.conversationId}`)
    } catch (error) {
          // Sanitize error to avoid circular reference issues when logging
    const errorDetails = {
      message: error instanceof Error ? error.message : String(error),
      ...(axios.isAxiosError(error) && {
        status: error.response?.status,
        statusText: error.response?.statusText,
        code: error.code,
        url: error.config?.url,
      }),
    };
      logger.error(`[SupportBot] Failed to send support message:`, errorDetails)
      throw error
    }
  }

  /**
   * Validate if a channel is a support channel
   * @param channelName - The name of the channel to validate
   * @returns boolean indicating if the channel is a support channel
   */
  public async validateChannel(channelId: string): Promise<boolean> {
    try {
      logger.info(`[SupportBot] Validating channel ID: ${channelId}`)
      const response = await axios.post(
        `${this.BACKEND_URL}/api/apps/channel/info`,
        { 
          channelId: channelId
        },
        {
          headers: {
            'Authorization': `Bearer ${this.APP_JWT_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        }
      );
      const channel = response.data as Channel;

      return channel.type === 'SUPPORT';
    } catch (error) {
      const errorDetails = {
        message: error instanceof Error ? error.message : String(error),
        ...(axios.isAxiosError(error) && {
          status: error.response?.status,
          statusText: error.response?.statusText,
          code: error.code,
          url: error.config?.url,
        }),
      };
      logger.error('[SupportBot] Failed to validate channel:', errorDetails);
      return false;
    }
  }

  /**
   * Generic ticket update function
   * @param ticketId - The ID of the ticket to update
   * @param conversationId - The conversation ID for channel validation
   * @param params - Update parameters (pass any combination of assigneeId, stage, groupId)
   * @returns boolean indicating success/failure
   */
  public async updateTicket(
    ticketId: string,
    conversationId: string,
    params: { assigneeId?: string; stage?: string; groupId?: string }
  ): Promise<boolean> {
    try {
      await axios.post(
        `${this.BACKEND_URL}/api/apps/ticket/updateTicket`,
        {
          ticketId,
          conversationId,
          ...params,
        },
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.APP_JWT_KEY}`,
          },
          timeout: 30000,
        }
      );

      logger.info(`[SupportBot] Ticket ${ticketId} updated successfully`);
      return true;
    } catch (error) {
      const errorDetails = {
        message: error instanceof Error ? error.message : String(error),
        ...(axios.isAxiosError(error) && {
          status: error.response?.status,
          statusText: error.response?.statusText,
          code: error.code,
          url: error.config?.url,
        }),
      }; 
      logger.error(`[SupportBot] Failed to update ticket ${ticketId}:`, errorDetails);
      return false;
    }
  }
}
