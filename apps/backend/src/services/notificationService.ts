import { logger } from '@/utils/logger';
import { runAsSystem } from '@/database/tenant/context';
import { repositories } from '@/database/repositories';
import { websocketService } from './websocketService';
import {
  createFlowJson,
  createSingleLineText,
  createMultiLineText,
  createFlexLayout,
  createTag,
} from '@/bots/json-ui';
import type { FlowJson } from '@/bots/json-ui/types';
import { notificationService as realTimeNotificationService } from '@/notification-service';
import { fcmPushService, type MobilePushRegistration } from './fcmService';
import { getNotificationJobsExpected } from '@/services/otel';
import { DatabaseClient } from '@/database/client';
import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';
import * as notificationFilterService from './notificationFilterService';
import type { PrefetchedFilterData } from './notificationFilterService';
import { serializeInitialMessageMd,
  isDeskChannelType,
  type InitialMessageSummary,
  ChannelScopeType,
  NotificationDeliveryMethod,
  NotificationType, MessageType, NotificationStatus, UserStatus,
  ChannelType } from '@xyne/shared';

const prisma = DatabaseClient.getInstance();

function buildTicketActionUrl(
  ticket: {
    workspaceId: string;
    channelId: string | null;
    conversationId: string | null;
    xyneId: string | null;
    channel?: { type: string | null } | null;
  },
  ticketId: string,
): string {
  if (!ticket.channelId) return `/${ticket.workspaceId}/support`;

  if (isDeskChannelType(ticket.channel?.type) || !ticket.conversationId) {
    return ticket.xyneId
      ? `/${ticket.workspaceId}/support/${ticket.channelId}/${ticket.xyneId}`
      : `/${ticket.workspaceId}/support/${ticket.channelId}`;
  }

  return `/${ticket.workspaceId}/chat/dir/${ticket.channelId}?tab=tickets&ticketId=${ticketId}&conversationId=${ticket.conversationId}`;
}

/**
 * Fetches conversation data for embedding in notification payloads.
 * Builds initial_message_md inline since MessageMetadataService hasn't run yet.
 * This allows the client to cache the conversation on notification receipt,
 * eliminating the loader when navigating to the channel.
 */
async function fetchConversationForNotification(conversationId: string) {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { conversationId },
    });
    if (!conversation) return undefined;

    // Build initial_message_md from the message since MessageMetadataService
    // hasn't run yet at notification time
    let initialMessageMd: string | null = null;
    if (conversation.initialMessageId) {
      const message = await prisma.message.findUnique({
        where: { messageId: conversation.initialMessageId },
      });
      if (message) {
        const summary: InitialMessageSummary = {
          messageId: message.messageId,
          conversationId: message.conversationId,
          senderId: message.senderId,
          content: message.content,
          msgType: message.msgType as InitialMessageSummary['msgType'],
          hasAttachment: message.hasAttachment,
          edited: message.edited,
          isDeleted: message.isDeleted,
          showInChannel: message.showInChannel,
          visibleTo: message.visibleTo,
          createdAt: message.createdAt.getTime(),
          metadata: message.metadata ? JSON.stringify(message.metadata) : null,
          nudgeCount: message.nudgeCount,
          isSent: message.isSent,
          reactions_md: message.reactions_md,
          link_preview_md: message.link_preview_md,
          childConversationId: message.childConversationId,
        };
        initialMessageMd = serializeInitialMessageMd(summary);
      }
    }

    // Fetch attachments via initialMessageId → message_attachments.entityId
    // (matches Zero schema relationship: conversations.initialMessageId → message_attachments.entityId)
    const attachments = conversation.initialMessageId
      ? await prisma.messageAttachment.findMany({
          where: { entityId: conversation.initialMessageId },
        })
      : [];

    return {
      conversationId: conversation.conversationId,
      channelId: conversation.channelId,
      createdBy: conversation.createdBy,
      initialMessageId: conversation.initialMessageId,
      parentMessageId: conversation.parentMessageId,
      lastActivityAt: conversation.lastActivityAt.getTime(),
      replyCount: conversation.replyCount,
      pinned: conversation.pinned,
      ticketId: conversation.ticketId,
      callId: conversation.callId,
      createdAt: conversation.createdAt.getTime(),
      initial_message_md: initialMessageMd,
      initialMessageAttachments: attachments.map(a => ({
        id: a.id,
        entityId: a.entityId,
        entityType: a.entityType,
        originalFilename: a.originalFilename,
        url: a.url,
        size: a.size,
        mimetype: a.mimetype,
        createdAt: a.createdAt.getTime(),
      })),
      initialMessageNudgeCounts: [],
    };
  } catch (error) {
    logger.warn('[NOTIFICATION] Failed to fetch conversation for notification payload', { conversationId, error });
    return undefined;
  }
}

interface BrowserSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}

export interface NotificationData {
  title: string;
  message: string;
  type: NotificationType;
  relatedEntityType?: string;
  relatedEntityId?: string;
  actionUrl?: string;
  metadata?: any;
  imageUrl?: string;
  /**
   * Workspace the notification belongs to. Optional at the call sites; when
   * omitted, createSessionNotification derives it from the recipient's
   * (workspace-scoped) User row. Callers that already know the event's workspace
   * should pass it to avoid the extra lookup.
   */
  workspaceId?: string;
}

interface NotificationOptions {
  page?: number;
  limit?: number;
  status?: string;
}

interface UserPreferences {
  [key: string]: {
    browserEnabled: boolean;
    emailEnabled: boolean;
    slackEnabled: boolean;
  };
}

class NotificationService {
  /**
   * Helper to create a granular notification entry for a specific session (Mobile or Web)
   */
  async createSessionNotification(
    userId: string,
    data: NotificationData,
    deliveryMethod: NotificationDeliveryMethod = NotificationDeliveryMethod.BROWSER
  ) {
    // Prefer a caller-provided workspace (the event's workspace); otherwise derive
    // it from the recipient's own workspace-scoped User row. resolveWorkspaceIdFromModel
    // resolves under a system context, so it is safe even for cross-workspace recipients.
    const workspaceId =
      data.workspaceId ?? (await resolveWorkspaceIdFromModel(prisma, 'user', { id: userId }));
    return await repositories.notifications.create({
      workspaceId,
      userId,
      type: data.type,
      title: data.title,
      message: data.message,
      relatedEntityType: data.relatedEntityType,
      relatedEntityId: data.relatedEntityId,
      actionUrl: data.actionUrl,
      metadata: data.metadata,
      deliveryMethods: [deliveryMethod],
    });
  }

  async sendWorkflowCompletionNotification(workflowId: string, status: string, executionId: string): Promise<void> {
    logger.info(
      `[TicketBot] sendWorkflowCompletionNotification called for workflow ${workflowId} with status ${status}`
    );
    try {
      logger.info(`[TicketBot] Fetching workflow ${workflowId}`);
      const workflow = await repositories.workflows.findById(workflowId);
      if (!workflow || !workflow.ticketId) {
        logger.info(`[TicketBot] Workflow or ticketId not found for notification: ${workflowId}`);
        logger.warn(`Workflow or ticketId not found for notification: ${workflowId}`);
        return;
      }

      // Fetch ticket separately
      const ticket = await prisma.ticket.findUnique({
        where: { id: workflow.ticketId },
        include: { channel: { select: { type: true } } },
      });
      if (!ticket) {
        logger.info(
          `[TicketBot] Ticket not found for workflow: ${workflowId}, ticketId: ${workflow.ticketId}`
        );
        logger.warn(`Ticket not found for workflow: ${workflowId}`);
        return;
      }

      logger.info(
        `[TicketBot] Found workflow with ticket ${ticket.id}, conversationId: ${ticket.conversationId || 'none'}`
      );

      const execution = await repositories.workflowExecutions.findById(executionId);
      if (!execution || !execution.createdBy) {
        logger.warn(`Execution not found or has no createdBy for notification: ${executionId}`);
        return;
      }
      const createdBy = execution.createdBy;

      const isSuccess = status.toUpperCase() === 'SUCCESS';
      const notificationType = isSuccess
        ? NotificationType.WORKFLOW_COMPLETION
        : NotificationType.WORKFLOW_FAILURE;

      // Apply pause and channel-level filtering before delivering.
      const { desktopUsers, mobileUsers } = ticket.channelId
        ? await notificationFilterService.filterUsers([createdBy], ticket.channelId, false, 'mention', {
            notificationType,
          })
        : await notificationFilterService.filterGlobalUsers([createdBy], notificationType, 'mention');

      const receiveDesktop = desktopUsers.includes(createdBy);
      const receiveMobile = mobileUsers.includes(createdBy);

      if (!receiveDesktop && !receiveMobile) {
        return;
      }

      const title = isSuccess ? 'Workflow Completed' : 'Workflow Failed';
      const ticketIdDisplay = ticket.xyneId || ticket.id;
      const message = `Workflow for ticket ${ticketIdDisplay} has ${isSuccess ? 'completed successfully' : 'failed'}.`;

      await this.createNotification(createdBy, {
        title,
        message,
        type: notificationType,
        relatedEntityType: 'workflow',
        relatedEntityId: workflowId,
        actionUrl: buildTicketActionUrl(ticket, ticket.id),
        metadata: {
          workflowId,
          ticketId: ticket.id,
          xyneId: ticket.xyneId,
          status
        }
      }, { sendDesktop: receiveDesktop, sendMobile: receiveMobile });
      logger.info(`[Notification] Sent push notification to user ${createdBy} for workflow ${workflowId} completion.`);

      // Note: Slack notification functionality removed as slackChannelId/slackThreadId fields no longer exist on Ticket model
      logger.info(
        `[TicketBot] Workflow completion notification completed for workflow ${workflowId}`
      );
    } catch (error) {
      logger.info(`[TicketBot] Error in sendWorkflowCompletionNotification:`, error);
      logger.error(
        `Failed to send workflow completion notification for workflow ${workflowId}:`,
        error
      );
    }
  }

  /**
   * Unsubscribe from workflow events and clean up
   */
  // @ts-expect-error - Unused method kept for future implementation
  private async postWorkflowOutputToConversation(
    workflowId: string,
    conversationId: string,
    status: string
  ): Promise<void> {
    try {
      logger.info(
        `[TicketBot] Starting to post workflow output to conversation ${conversationId} for workflow ${workflowId}`
      );

      // Get the workflow to find ticketId
      const workflow = await repositories.workflows.findById(workflowId);
      if (!workflow || !workflow.ticketId) {
        logger.info(`[TicketBot] Workflow or ticketId not found for workflow ${workflowId}`);
        logger.warn(`Workflow or ticketId not found for workflow ${workflowId}`);
        return;
      }

      const ticketId = workflow.ticketId;
      logger.info(`[TicketBot] Found ticket ${ticketId} for workflow ${workflowId}`);

      // Get primary workflow execution (not child executions)
      logger.info(`[TicketBot] Fetching primary workflow executions for workflow ${workflowId}`);
      const primaryExecutions = await repositories.workflowExecutions.findMany({
        where: {
          workflowId: workflowId,
          parentWorkflowExecutionId: null,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (primaryExecutions.length === 0) {
        logger.info(`[TicketBot] No primary executions found for workflow ${workflowId}`);
        logger.warn(`No primary executions found for workflow ${workflowId}`);
        return;
      }

      logger.info(
        `[TicketBot] Found ${primaryExecutions.length} primary execution(s) for workflow ${workflowId}`
      );

      // Get the most recent execution
      const execution = primaryExecutions[0];
      logger.info(`[TicketBot] Using execution ${execution.id} with status ${execution.status}`);

      // Find the existing SYSTEM message for this workflow to update it
      logger.info(`[TicketBot] Looking for existing SYSTEM message with workflowId ${workflowId}`);
      const existingMessages = await repositories.messages.findMany({
        where: {
          conversationId: conversationId,
          msgType: MessageType.SYSTEM,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Find the message with matching workflowId in metadata
      const existingWorkflowMessage = existingMessages.find((msg) => {
        const metadata = msg.metadata as any;
        return metadata?.workflowId === workflowId;
      });

      // Fetch workflow steps to get the last step's output (using EXACT dashboard logic)
      logger.info(`[TicketBot] Fetching workflow steps for ticket ${ticketId}`);
      // TODO: Method getCombinedWorkflowStepsLight removed during ticket/workflow decoupling
      const combinedSteps: any = null; // await repositories.tickets.getCombinedWorkflowStepsLight(ticketId);

      // Find the most recent completed step's output
      let lastStepOutput: any = null;
      if (combinedSteps && combinedSteps.workflows) {
        const targetWorkflow = combinedSteps.workflows.find(
          (w: any) => w.workflowId === workflowId
        );
        if (targetWorkflow && targetWorkflow.steps) {
          // Helper function to recursively flatten all steps (including nested)
          const flattenAllSteps = (steps: any[]): any[] => {
            const flattened: any[] = [];

            for (const step of steps) {
              // Add the step itself
              flattened.push(step);

              // Recursively flatten expandedExecutions (agent steps)
              if (step.expandedExecutions && Array.isArray(step.expandedExecutions)) {
                for (const execution of step.expandedExecutions) {
                  if (execution.steps && Array.isArray(execution.steps)) {
                    flattened.push(...flattenAllSteps(execution.steps));
                  }
                }
              }

              // Recursively flatten expandedWorkflows (parallel steps)
              if (step.expandedWorkflows && Array.isArray(step.expandedWorkflows)) {
                for (const workflow of step.expandedWorkflows) {
                  if (workflow.steps && Array.isArray(workflow.steps)) {
                    flattened.push(...flattenAllSteps(workflow.steps));
                  }
                }
              }
            }

            return flattened;
          };

          // Flatten all steps including nested ones
          const allFlatSteps = flattenAllSteps(targetWorkflow.steps);
          logger.info(
            `[TicketBot] Flattened ${allFlatSteps.length} total steps (including nested)`
          );

          // Filter for output steps only
          const outputSteps = allFlatSteps.filter((step: any) => step.type === 'output');
          logger.info(`[TicketBot] Found ${outputSteps.length} output steps`);

          // Helper to detect loop wrapper steps by checking for child iteration steps
          const isLoopWrapper = (step: any): boolean => {
            if (!step.stepName) return false;
            // Look for child steps with names like: "{stepName}.iter_0.anything", "{stepName}.iter_1.anything", etc.
            const loopIterationPattern = new RegExp(
              `^${step.stepName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.iter_\\d+\\.`
            );
            return allFlatSteps.some(
              (s: any) => s.stepName && loopIterationPattern.test(s.stepName)
            );
          };

          // Filter out parent/wrapper steps - only keep leaf output steps
          const leafOutputSteps = outputSteps.filter((step: any) => {
            const hasExpandedExecutions =
              step.expandedExecutions && step.expandedExecutions.length > 0;
            const hasExpandedWorkflows =
              step.expandedWorkflows && step.expandedWorkflows.length > 0;
            const isLoop = isLoopWrapper(step);
            const isParentWrapper = hasExpandedExecutions || hasExpandedWorkflows || isLoop;

            if (isParentWrapper) {
              logger.info(
                `[TicketBot] Filtering out parent wrapper step: ${step.stepName} (hasExecutions: ${hasExpandedExecutions}, hasWorkflows: ${hasExpandedWorkflows}, isLoop: ${isLoop})`
              );
            }

            return !isParentWrapper; // Only keep leaf nodes
          });

          logger.info(
            `[TicketBot] After filtering parent wrappers: ${leafOutputSteps.length} leaf output steps`
          );

          if (leafOutputSteps.length > 0) {
            // Sort by updatedAt to get the most recent
            leafOutputSteps.sort((a: any, b: any) => {
              const dateA = new Date(a.updatedAt || a.createdAt).getTime();
              const dateB = new Date(b.updatedAt || b.createdAt).getTime();
              return dateB - dateA; // Most recent first
            });

            // Log top 3 candidates for debugging
            logger.info(`[TicketBot] Top 3 candidate steps by recency:`);
            leafOutputSteps.slice(0, 3).forEach((s: any, idx: number) => {
              logger.info(`[TicketBot]   ${idx + 1}. ${s.stepName} (updated: ${s.updatedAt})`);
            });

            const mostRecentStep = leafOutputSteps[0];
            logger.info(
              `[TicketBot] Selected most recent leaf output step: ${mostRecentStep.stepName} (updated: ${mostRecentStep.updatedAt})`
            );

            // Use the EXACT same API as dashboard: getWorkflowStepDetails
            // TODO: Method getWorkflowStepDetails removed during ticket/workflow decoupling
            const stepDetails: any = null; // await repositories.tickets.getWorkflowStepDetails(mostRecentStep.id);

            if (stepDetails && stepDetails.output && stepDetails.output.data) {
              // Use the exact same data format as dashboard
              lastStepOutput = stepDetails.output.data;
              logger.info(
                `[TicketBot] Successfully extracted step output using dashboard API:`,
                JSON.stringify(lastStepOutput).substring(0, 200) + '...'
              );
            } else {
              logger.info(`[TicketBot] No output data found in step details`);
            }
          } else {
            logger.info(`[TicketBot] No output steps found in workflow`);
          }
        }
      }

      // Create FlowJson for workflow completion using last step's output
      logger.info(`[TicketBot] Creating FlowJson for workflow completion`);
      let completionFlowJson = this.createWorkflowCompletionFlowJson(
        status,
        lastStepOutput,
        execution
      );
      logger.info(`[TicketBot] FlowJson created successfully`);

      // Check content length and truncate if necessary
      let flowJsonString = JSON.stringify(completionFlowJson);
      const MAX_MESSAGE_LENGTH = 9500; // Leave 500 char buffer for safety

      if (flowJsonString.length > MAX_MESSAGE_LENGTH) {
        logger.info(
          `[TicketBot] FlowJson exceeds limit (${flowJsonString.length} chars), truncating...`
        );

        // Recreate with truncated output
        const truncatedOutput = this.truncateOutputForMessage(lastStepOutput, ticketId);
        completionFlowJson = this.createWorkflowCompletionFlowJson(
          status,
          truncatedOutput,
          execution
        );
        flowJsonString = JSON.stringify(completionFlowJson);

        logger.info(`[TicketBot] Truncated FlowJson to ${flowJsonString.length} chars`);
      }

      // Update existing message or create new one if not found
      if (existingWorkflowMessage) {
        logger.info(
          `[TicketBot] Updating existing SYSTEM message ${existingWorkflowMessage.messageId} with workflow completion result`
        );

        const existingMetadata = (existingWorkflowMessage.metadata as any) || {};
        let updatedMetadata = {
          ...existingMetadata,
          workflowStatus:
            status === 'SUCCESS' ? 'SUCCESS' : status === 'FAILURE' ? 'FAILED' : status,
          executionTime:
            execution.updatedAt && execution.createdAt
              ? Math.round(
                (new Date(execution.updatedAt).getTime() -
                  new Date(execution.createdAt).getTime()) /
                1000
              ).toString()
              : undefined,
          workflowCreatedAt: workflow.createdAt, // Store workflow DB creation time
        };

        if (execution && execution.output && JSON.parse(execution.output).gitInfo) {
          updatedMetadata.gitInfo = JSON.parse(execution.output).gitInfo;
        }

        await repositories.messages.update(existingWorkflowMessage.messageId, {
          metadata: updatedMetadata,
        });

        logger.info(
          `[TicketBot] Successfully updated SYSTEM message ${existingWorkflowMessage.messageId} in conversation ${conversationId} for workflow ${workflowId}`
        );
      } else {
        logger.info(`[TicketBot] No existing SYSTEM message found, creating new message`);

        // Fallback: Create new message if no existing one found
        const botInfo = {
          id: 'ticket-bot',
          name: 'Ticket Bot',
          email: 'bot@system.in',
        };

        await repositories.messages.create({
          conversationId: conversationId,
          senderId: botInfo.id,
          content: flowJsonString,
          msgType: MessageType.BOT,
          hasAttachment: false,
        });

        logger.info(
          `[TicketBot] Created new BOT message in conversation ${conversationId} for workflow ${workflowId}`
        );
      }

      // Note: Knowledge canvas is created separately after knowledge capture completes
      // (triggered from saveWorkflowKnowledge in db-storage.ts to avoid race condition)

      logger.info(
        `Workflow completion processed for conversation ${conversationId} and workflow ${workflowId}`
      );
    } catch (error) {
      logger.info(`[TicketBot] Error posting workflow output to conversation:`, error);
      logger.error(`Failed to post workflow output to conversation:`, error);
      throw error;
    }
  }

  private truncateOutputForMessage(output: any, ticketId: string): any {
    const MAX_OUTPUT_SIZE = 7000;

    if (!output) return output;

    // Convert to string to check size
    let outputText: string;
    if (typeof output === 'string') {
      outputText = output;
    } else if (output && typeof output === 'object') {
      if (output.result && output.result.analysis) {
        outputText = output.result.analysis;
      } else if (output.analysis) {
        outputText = output.analysis;
      } else if (output.result) {
        outputText =
          typeof output.result === 'string'
            ? output.result
            : JSON.stringify(output.result, null, 2);
      } else {
        outputText = JSON.stringify(output, null, 2);
      }
    } else {
      outputText = String(output);
    }

    // If within limit, return as-is
    if (outputText.length <= MAX_OUTPUT_SIZE) {
      return output;
    }

    // Truncate and add notice
    const truncatedText = outputText.substring(0, MAX_OUTPUT_SIZE);
    const viewFullLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/tickets/${ticketId}`;
    const truncationNotice = `\n\n... (Output truncated due to length)\n\n📋 View full output in ticket details: ${viewFullLink}`;

    return truncatedText + truncationNotice;
  }

  private createWorkflowCompletionFlowJson(
    status: string,
    workflowOutput: any,
    execution: any
  ): FlowJson {
    const getStatusColor = (
      status: string
    ): 'success' | 'warning' | 'error' | 'info' | 'neutral' => {
      const statusUpper = status.toUpperCase();
      if (statusUpper === 'SUCCESS') return 'success';
      if (statusUpper === 'FAILURE' || statusUpper === 'FAILED') return 'error';
      if (statusUpper === 'CANCELLED') return 'warning';
      return 'neutral';
    };

    // Header with status
    const headerComponent = createSingleLineText('Workflow Execution Completed', {
      weight: 'bold',
      size: 'lg',
      color: '#181B1D',
    });

    // Status tag
    const statusTag = createTag(status.toUpperCase(), {
      variant: 'subtle',
      color: getStatusColor(status),
      size: 'md',
    });

    // Execution time
    const executionTime =
      execution.updatedAt && execution.createdAt
        ? `Completed in ${Math.round((new Date(execution.updatedAt).getTime() - new Date(execution.createdAt).getTime()) / 1000)}s`
        : 'Execution time unknown';

    const timeComponent = createSingleLineText(executionTime, {
      weight: 'normal',
      size: 'sm',
      color: '#8492A1',
    });

    // Output data section
    const components = [
      headerComponent,
      createFlexLayout([statusTag, timeComponent], {
        direction: 'row',
        gap: 12,
        align: 'center',
      }),
    ];

    // Add output data if available
    if (workflowOutput) {
      const outputLabel = createSingleLineText('Output Data:', {
        weight: 'semibold',
        size: 'md',
        color: '#181B1D',
      });

      // Format output as readable text
      let outputText: string;
      if (typeof workflowOutput === 'string') {
        outputText = workflowOutput;
      } else if (workflowOutput && typeof workflowOutput === 'object') {
        // Try to extract meaningful content from common workflow output structures
        if (workflowOutput.result && workflowOutput.result.analysis) {
          outputText = workflowOutput.result.analysis;
        } else if (workflowOutput.analysis) {
          outputText = workflowOutput.analysis;
        } else if (workflowOutput.result) {
          outputText =
            typeof workflowOutput.result === 'string'
              ? workflowOutput.result
              : JSON.stringify(workflowOutput.result, null, 2);
        } else {
          outputText = JSON.stringify(workflowOutput, null, 2);
        }
      } else {
        outputText = String(workflowOutput);
      }

      const outputContent = createMultiLineText(outputText, {
        weight: 'normal',
        size: 'sm',
        color: '#4A5568',
      });

      components.push(
        createFlexLayout([outputLabel, outputContent], {
          direction: 'column',
          gap: 8,
          padding: 12,
          background: '#F7F8FA',
          borderRadius: 8,
        })
      );
    } else {
      const noOutputComponent = createSingleLineText('No output data available', {
        weight: 'normal',
        size: 'sm',
        color: '#8492A1',
      });
      components.push(noOutputComponent);
    }

    // Root container
    const rootComponent = createFlexLayout(components, {
      direction: 'column',
      gap: 16,
      padding: 16,
      background: '#FFFFFF',
      borderRadius: 12,
    });

    const flowJsonResult = createFlowJson('ticket-bot', rootComponent);

    if (!flowJsonResult.success) {
      // Fallback to simple text format
      const fallbackText = `Workflow completed with status: ${status}`;
      const fallbackComponent = createSingleLineText(fallbackText);
      const fallbackResult = createFlowJson('ticket-bot', fallbackComponent);
      return fallbackResult.success
        ? fallbackResult.data
        : {
          version: '1.0',
          metadata: { botName: 'ticket-bot', timestamp: new Date().toISOString() },
          root: { type: 'singleLineText', props: { text: fallbackText } },
        };
    }

    return flowJsonResult.data;
  }

  async saveSubscription(userId: string, subscription: BrowserSubscription): Promise<void> {
    try {
      await repositories.browserNotificationSubscriptions.upsertSubscription({
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        userAgent: subscription.userAgent,
      });

      logger.info(`Saved notification subscription for user ${userId}`);
    } catch (error) {
      logger.error('Failed to save notification subscription:', error);
      throw error;
    }
  }

  async removeSubscription(userId: string, endpoint: string): Promise<void> {
    try {
      await repositories.browserNotificationSubscriptions.deactivateByEndpoint(endpoint);

      logger.info(`Removed notification subscription for user ${userId}`);
    } catch (error) {
      logger.error('Failed to remove notification subscription:', error);
      throw error;
    }
  }

  async registerMobilePushToken(
    userId: string,
    registration: MobilePushRegistration,
  ): Promise<void> {
    try {
      await fcmPushService.registerToken(userId, registration);
      logger.info(`Registered mobile push token for user ${userId}`, {
        deviceId: registration.deviceId ?? null,
        platform: registration.platform ?? 'unknown',
      });
    } catch (error) {
      logger.error('Failed to register mobile push token:', error);
      throw error;
    }
  }

  async unregisterMobilePushToken(
    userId: string,
    sessionId?: string
  ): Promise<void> {
    try {
      if (sessionId) {
        await fcmPushService.clearSessionPushToken(sessionId);
      } else {
        await fcmPushService.unregisterUserTokens(userId);
      }
      logger.info('Unregistered mobile push token', {
        userId,
        scope: sessionId ? 'single_session' : 'all_sessions',
      });
    } catch (error) {
      logger.error('Failed to unregister mobile push token:', error);
      throw error;
    }
  }

  isMobilePushEnabled(): boolean {
    return fcmPushService.isSendEnabled();
  }

  /**
   * Unified notification delivery method for both desktop (WebSocket) and mobile (FCM) channels.
   *
   * By default, sends to both channels. Pass `options.sendDesktop = false` or
   * `options.sendMobile = false` to restrict delivery to a single channel.
   *
   * Callers that use `notificationFilterService` to split recipients into `desktopUsers` and
   * `mobileUsers` should call this method twice:
   *   - `createNotification(userId, data, { sendDesktop: true, sendMobile: false })` for desktopUsers
   *   - `createNotification(userId, data, { sendDesktop: false, sendMobile: true })` for mobileUsers
   *
   * Callers that do not use the pause filter (calls, canvas, tickets, etc.) should omit
   * the options parameter so that both channels are used by default.
   *
   * Returns delivery status indicating whether the notification was successfully delivered
   * via the app (WebSocket or mobile push). This is used to skip redundant Slack notifications.
   *
   * Note: The desktop delivery check is a probabilistic heuristic — it verifies active WebSocket
   * connections AFTER sending, which narrows but does not eliminate the race window. A user could
   * disconnect between send and check, or WebSocket "send" only confirms server push, not client
   * receipt. This is acceptable for reducing duplicate notifications but is not deterministic.
   */
  async createNotification(
    userId: string,
    data: NotificationData,
    { sendDesktop, sendMobile, isSilent }: { sendDesktop: boolean; sendMobile: boolean, isSilent?: boolean } = { sendDesktop: true, sendMobile: true, isSilent: false }
  ): Promise<{ deliveredViaApp: boolean }> {
    let deliveredViaApp = false;

    // No actionUrl builder knows the SDLC routes. Builders already put the entity
    // ids in metadata, so drop the URL and add the one key they lack — which hub.
    const sdlcChannelId = await this.sdlcChannelId(data);
    if (sdlcChannelId) {
      data = {
        ...data,
        actionUrl: undefined,
        metadata: { ...(data.metadata ?? {}), sdlcChannelId },
      };
    }

    try {
      logger.info(`[NOTIFICATION-SERVICE] createNotification called`, {
        userId,
        notificationType: data.type,
        relatedEntityType: data.relatedEntityType,
        relatedEntityId: data.relatedEntityId,
        actionUrl: data.actionUrl,
        options: { sendDesktop, sendMobile }
      });

      // ─── MOBILE NOTIFICATIONS ───────────────────────────────────────────────
      if (sendMobile) {
        const hasActiveTokens = await fcmPushService.hasActiveTokens(userId);

        if (hasActiveTokens) {
          logger.info(`[NOTIFICATION-SERVICE] MOBILE SENT: User ${userId} | Type: ${data.type}`);

          try {
            const sessions = await fcmPushService.getActiveSessionsWithTokens(userId);

            // Resolve the tenant ONCE — see createFCMNotification.
            const sessionData: NotificationData = {
              ...data,
              workspaceId: data.workspaceId ?? (await resolveWorkspaceIdFromModel(prisma, 'user', { id: userId })),
            };

            for (const session of sessions) {
              const deliveryMethod = session.platform === 'ios'
                ? NotificationDeliveryMethod.IOS
                : NotificationDeliveryMethod.ANDROID;

              if(!isSilent){
                const sessionNotification = await this.createSessionNotification(
                  userId,
                  sessionData,
                  deliveryMethod
                );
                const mobilePayload = {
                  type: data.type,
                  title: data.title,
                  message: data.message,
                  notificationId: sessionNotification.id,
                  actionUrl: data.actionUrl,
                  relatedEntityType: data.relatedEntityType,
                  relatedEntityId: data.relatedEntityId,
                  metadata: data.metadata,
                };
                await realTimeNotificationService.queueMobilePush(userId, session, mobilePayload);
              } else {
                await realTimeNotificationService.queueMobilePush(userId, session, {
                  type: data.type,
                  title: data.title,
                  message: data.message,
                  relatedEntityId: data.relatedEntityId,
                  metadata: data.metadata,
                });
              }
            }
            logger.info(`[NOTIFICATION-SERVICE] MOBILE QUEUED: ${sessions.length} sessions for user ${userId}`);

            deliveredViaApp = true;
            logger.info(`[NOTIFICATION-SERVICE] Mobile delivery tracked for user ${userId}, type: ${data.type}`);
          } catch (error) {
            logger.error(`[NOTIFICATION-SERVICE] MOBILE FAILED: User ${userId}`, { error });
          }
        } else {
          logger.info(`[NOTIFICATION-SERVICE] MOBILE SKIPPED (no tokens): User ${userId} | Type: ${data.type}`);
        }
      } else {
        logger.info(`[NOTIFICATION-SERVICE] MOBILE SKIPPED (sendMobile=false): User ${userId} | Type: ${data.type}`);
      }

      // ─── DESKTOP NOTIFICATIONS ───────────────────────────────────────────────
      if (sendDesktop) {
        logger.info(`[NOTIFICATION-SERVICE] DESKTOP SENT: User ${userId} | Type: ${data.type}`);

        await realTimeNotificationService.sendNotification(
          userId,
          data.type,
          data.title,
          (data.metadata?.scopeType !== ChannelScopeType.DM && data.metadata?.senderName) ? `${data.metadata.senderName}: ${data.message}` : data.message,
          {
            ...data.metadata,
            relatedEntityType: data.relatedEntityType,
            relatedEntityId: data.relatedEntityId,
          },
          data.actionUrl
        );

        // Probabilistic heuristic: check active connections AFTER sending.
        // This narrows the race window vs checking before, but does not guarantee
        // the client received the message — only that the server pushed it and
        // the user had active WebSocket connections at check time.
        const hasActiveConnections = await websocketService.isUserOnline(userId);
        if (hasActiveConnections) {
          deliveredViaApp = true;
          logger.info(`[NOTIFICATION-SERVICE] Spaces delivery detected for user ${userId}, type: ${data.type}`);
        }
      } else {
        logger.info(`[NOTIFICATION-SERVICE] DESKTOP SKIPPED (sendDesktop=false): User ${userId} | Type: ${data.type}`);
      }
    } catch (error) {
      logger.error('[NOTIFICATION-SERVICE] FAILED to create notification:', { userId, type: data.type, error });
      throw error;
    }

    return { deliveredViaApp };
  }

  /** The SDLC hub a notification belongs to, or null everywhere else. */
  private async sdlcChannelId(data: NotificationData): Promise<string | null> {
    const metadata = (data.metadata ?? {}) as Record<string, unknown>;
    const asId = (value: unknown): string | undefined =>
      typeof value === 'string' && value.length > 0 ? value : undefined;
    const related = (type: string): string | undefined =>
      data.relatedEntityType === type ? asId(data.relatedEntityId) : undefined;

    try {
      const canvasId = asId(metadata['canvasId']) ?? related('canvas');
      const ticketId = asId(metadata['ticketId']) ?? related('ticket');
      const channelId =
        asId(metadata['channelId']) ??
        (canvasId
          ? (await prisma.canvas.findUnique({ where: { id: canvasId }, select: { channelId: true } }))
              ?.channelId
          : ticketId
            ? (await prisma.ticket.findUnique({ where: { id: ticketId }, select: { channelId: true } }))
                ?.channelId
            : undefined);
      if (!channelId) return null;
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { type: true },
      });
      return channel?.type === ChannelType.SDLC ? channelId : null;
    } catch (error) {
      // Routing must never take a notification down; fall back to the actionUrl.
      logger.warn('[SDLC] failed to resolve notification channel', { error });
      return null;
    }
  }

  async createChannelMessageNotifications(
    userIds: string[],
    messageId: string,
    conversationId: string,
    channelId: string,
    channelName: string,
    senderId: string,
    senderName: string,
    cleanContent: string,
    workspaceId: string,
    senderPicture: string = '',
    prefetchedData?: PrefetchedFilterData,
  ): Promise<{ deliveredUserIds: string[] }> {
    const recipientIds = userIds.filter(id => id !== senderId);

    if (recipientIds.length === 0) {
      return { deliveredUserIds: [] };
    }

    getNotificationJobsExpected().add(recipientIds.length, {
      platform: 'desktop',
      message_type: 'channel',
    });

    const { desktopUsers, mobileUsers } = await notificationFilterService.filterUsers(
      recipientIds,
      channelId,
      false,
      'channel_message',
      { notificationType: NotificationType.CHANNEL_MESSAGE },
      prefetchedData,
    );

    logger.info(`[Notification] Filtered channel message recipients`, {
      original: recipientIds.length,
      desktopUsers: desktopUsers.length,
      mobileUsers: mobileUsers.length,
      channelId,
    });

    const conversationData = await fetchConversationForNotification(conversationId);

    const notificationData = {
      title: `New message in #${channelName}`,
      message: `${cleanContent.substring(0, 100)}${cleanContent.length > 100 ? '...' : ''}`,
      type: NotificationType.CHANNEL_MESSAGE,
      relatedEntityType: 'message' as const,
      relatedEntityId: messageId,
      actionUrl: `/${workspaceId}/chat/${channelId}#origin=${conversationId}&messageId=${messageId}`,
      metadata: {
        channelId,
        conversationId,
        messageId,
        senderId,
        senderName,
        senderPicture,
        channelTitle: channelName,
        messageType: 'channel_message',
        conversation: conversationData,
      },
    };

    getNotificationJobsExpected().add(desktopUsers.length, {
      platform: 'desktop',
      message_type: 'channel',
    });
    const desktopResults = await Promise.allSettled(
      desktopUsers.map(async userId => {
        const result = await this.createNotification(userId, notificationData, {
          sendDesktop: true,
          sendMobile: false,
        });
        return { userId, deliveredViaApp: result.deliveredViaApp };
      }),
    );

    getNotificationJobsExpected().add(mobileUsers.length, {
      platform: 'mobile',
      message_type: 'channel',
    });
    const mobileResults = await Promise.allSettled(
      mobileUsers.map(async userId => {
        const result = await this.createNotification(userId, notificationData, {
          sendDesktop: false,
          sendMobile: true,
        });
        return { userId, deliveredViaApp: result.deliveredViaApp };
      }),
    );

    void this.sendOwnMessagePrefetchToMobile(senderId, notificationData);

    const deliveredUserIds = [
      ...desktopResults
        .filter((r): r is PromiseFulfilledResult<{ userId: string; deliveredViaApp: boolean }> => r.status === 'fulfilled')
        .filter(r => r.value.deliveredViaApp)
        .map(r => r.value.userId),
      ...mobileResults
        .filter((r): r is PromiseFulfilledResult<{ userId: string; deliveredViaApp: boolean }> => r.status === 'fulfilled')
        .filter(r => r.value.deliveredViaApp)
        .map(r => r.value.userId),
    ];

    return { deliveredUserIds: [...new Set(deliveredUserIds)] };
  }

  async createMentionNotifications(
    userIds: string[],
    messageId: string,
    conversationId: string,
    channelId: string,
    channelName: string,
    senderId: string,
    senderName: string,
    cleanContent: string,
    workspaceId: string,
    mentionType?: string,
    isDMChannel: boolean = false,
    isThreadMessage: boolean = false,
    senderPicture: string = '',
    prefetchedData?: PrefetchedFilterData,
    isGroupDM: boolean = false,
  ): Promise<{ deliveredUserIds: string[] }> {
    const title = mentionType
      ? `${mentionType} in #${channelName}`
      : `You were mentioned in #${channelName}`;

    const recipientIds = userIds.filter(id => id !== senderId);

    getNotificationJobsExpected().add(recipientIds.length, { platform: 'desktop', message_type: 'channel' });
    // Filter users based on device preferences, pause settings and notification level.
    // For DM channels, only device filter is applied (skips notification level checks).
    // context='thread_mention': passes for ALL, MENTIONS_ONLY, and UI Default (THREADS_ONLY) — a direct
    //   @mention inside a thread is relevant to both mention and thread-reply subscribers.
    // context='mention': passes for ALL, MENTIONS_ONLY, and UI Default (THREADS_ONLY).
    const notificationContext = isThreadMessage && !isDMChannel ? 'thread_mention' : 'mention';
    const { desktopUsers, mobileUsers } = await notificationFilterService.filterUsers(
      recipientIds,
      channelId,
      isDMChannel,
      notificationContext,
      {
        notificationType: NotificationType.MENTION,
        mentionType: (mentionType === '@channel' || mentionType === '@here') ? mentionType : undefined,
      },
      prefetchedData,
      isGroupDM,
    );

    logger.info(`[Notification] Filtered mention recipients`, {
      original: recipientIds.length,
      desktopUsers: desktopUsers.length,
      mobileUsers: mobileUsers.length,
      channelId,
      mentionType,
      notificationContext,
    });

    const mentionActionUrl = isThreadMessage
      ? `/${workspaceId}/chat/${channelId}/${conversationId}#origin=${conversationId}&messageId=${messageId}`
      : `/${workspaceId}/chat/${channelId}#origin=${conversationId}&messageId=${messageId}`;

    const conversationData = await fetchConversationForNotification(conversationId);

    const notificationData = {
      title,
      message: `${cleanContent.substring(0, 100)}${cleanContent.length > 100 ? '...' : ''}`,
      type: NotificationType.MENTION,
      relatedEntityType: 'message' as const,
      relatedEntityId: messageId,
      actionUrl: mentionActionUrl,
      metadata: {
        channelId,
        conversationId,
        messageId,
        senderId,
        senderName,
        senderPicture,
        channelTitle: channelName,
        mentionType,
        conversation: conversationData,
      },
    };

    // Send desktop-only notifications (pauseFilter already determined these users should get desktop)
    getNotificationJobsExpected().add(desktopUsers.length, { platform: 'desktop', message_type: 'channel' });
    const desktopResults = await Promise.allSettled(
      desktopUsers.map(async userId => {
        const result = await this.createNotification(userId, notificationData, { sendDesktop: true, sendMobile: false });
        return { userId, deliveredViaApp: result.deliveredViaApp };
      })
    );

    // Send mobile-only notifications (pauseFilter already determined these users should get mobile)
    getNotificationJobsExpected().add(mobileUsers.length, { platform: 'mobile', message_type: 'channel' });
    const mobileResults = await Promise.allSettled(
      mobileUsers.map(async userId => {
        const result = await this.createNotification(userId, notificationData, { sendDesktop: false, sendMobile: true });
        return { userId, deliveredViaApp: result.deliveredViaApp };
      })
    );

    void this.sendOwnMessagePrefetchToMobile(senderId, notificationData);

    // Collect all users who were successfully notified via Spaces (WebSocket only)
    const deliveredUserIds = [
      ...desktopResults
        .filter((r): r is PromiseFulfilledResult<{ userId: string; deliveredViaApp: boolean }> => r.status === 'fulfilled')
        .filter(r => r.value.deliveredViaApp)
        .map(r => r.value.userId),
      ...mobileResults
        .filter((r): r is PromiseFulfilledResult<{ userId: string; deliveredViaApp: boolean }> => r.status === 'fulfilled')
        .filter(r => r.value.deliveredViaApp)
        .map(r => r.value.userId),
    ];

    return { deliveredUserIds: [...new Set(deliveredUserIds)] };
  }

  async createKeywordNotifications(
    userIds: string[],
    messageId: string,
    conversationId: string,
    channelId: string,
    channelName: string,
    senderId: string,
    senderName: string,
    cleanContent: string,
    workspaceId: string,
    matchedKeywordsByUser: Map<string, string[]>,
    isThreadMessage: boolean = false,
    senderPicture: string = '',
    prefetchedData?: PrefetchedFilterData,
  ): Promise<{ deliveredUserIds: string[] }> {
    const recipientIds = userIds.filter(id => id !== senderId);
    if (recipientIds.length === 0) {
      return { deliveredUserIds: [] };
    }

    // Keyword matches break through like mentions: 'thread_mention' for thread
    // replies (notifies even unsubscribed users), 'mention' for top-level.
    const notificationContext = isThreadMessage ? 'thread_mention' : 'mention';
    const { desktopUsers, mobileUsers } = await notificationFilterService.filterUsers(
      recipientIds,
      channelId,
      false,
      notificationContext,
      { notificationType: NotificationType.MENTION },
      prefetchedData,
    );

    logger.info(`[Notification] Filtered keyword-match recipients`, {
      original: recipientIds.length,
      desktopUsers: desktopUsers.length,
      mobileUsers: mobileUsers.length,
      channelId,
      notificationContext,
    });

    const actionUrl = isThreadMessage
      ? `/${workspaceId}/chat/${channelId}/${conversationId}#origin=${conversationId}&messageId=${messageId}`
      : `/${workspaceId}/chat/${channelId}#origin=${conversationId}&messageId=${messageId}`;

    const conversationData = await fetchConversationForNotification(conversationId);

    const buildNotificationData = (userId: string) => ({
      title: `Matched a keyword in #${channelName}`,
      message: `${cleanContent.substring(0, 100)}${cleanContent.length > 100 ? '...' : ''}`,
      type: NotificationType.MENTION,
      relatedEntityType: 'message' as const,
      relatedEntityId: messageId,
      actionUrl,
      metadata: {
        channelId,
        conversationId,
        messageId,
        senderId,
        senderName,
        senderPicture,
        channelTitle: channelName,
        keywordMatch: true,
        matchedKeywords: matchedKeywordsByUser.get(userId) ?? [],
        conversation: conversationData,
      },
    });

    getNotificationJobsExpected().add(desktopUsers.length, { platform: 'desktop', message_type: 'channel' });
    const desktopResults = await Promise.allSettled(
      desktopUsers.map(async userId => {
        const result = await this.createNotification(userId, buildNotificationData(userId), { sendDesktop: true, sendMobile: false });
        return { userId, deliveredViaApp: result.deliveredViaApp };
      })
    );

    getNotificationJobsExpected().add(mobileUsers.length, { platform: 'mobile', message_type: 'channel' });
    const mobileResults = await Promise.allSettled(
      mobileUsers.map(async userId => {
        const result = await this.createNotification(userId, buildNotificationData(userId), { sendDesktop: false, sendMobile: true });
        return { userId, deliveredViaApp: result.deliveredViaApp };
      })
    );

    const deliveredUserIds = [
      ...desktopResults
        .filter((r): r is PromiseFulfilledResult<{ userId: string; deliveredViaApp: boolean }> => r.status === 'fulfilled')
        .filter(r => r.value.deliveredViaApp)
        .map(r => r.value.userId),
      ...mobileResults
        .filter((r): r is PromiseFulfilledResult<{ userId: string; deliveredViaApp: boolean }> => r.status === 'fulfilled')
        .filter(r => r.value.deliveredViaApp)
        .map(r => r.value.userId),
    ];

    return { deliveredUserIds: [...new Set(deliveredUserIds)] };
  }

  /**
   * Send mention notifications for canvas mentions.
   * Mirrors message mention flow: when canvas is in a channel, use "You were mentioned in #channelName".
   * Respects global pause and channel notification level (NONE = silenced).
   */
  async createCanvasMentionNotifications(
    userIds: string[],
    canvasId: string,
    canvasTitle: string,
    senderId: string,
    senderName: string,
    workspaceId: string,
    channelName?: string,
    blockId?: string,
    commentThreadId?: string,
    channelId?: string | null,
    mentionContext: 'canvas' | 'comment' = 'canvas',
  ): Promise<{ deliveredUserIds: string[] }> {
    const recipientIds = userIds.filter(id => id !== senderId);
    if (recipientIds.length === 0) {
      logger.info(`[NOTIFICATION-SERVICE] No recipients after filtering, skipping notification creation`);
      return { deliveredUserIds: [] };
    }

    // Apply pause and channel-level filtering.
    // If the canvas is in a channel, use channel-level settings; otherwise fall back to global pause only.
    // Canvas mentions use 'mention' context — delivered unless channel is muted (NONE) or notifications are paused.
    const { desktopUsers, mobileUsers } = channelId
      ? await notificationFilterService.filterUsers(recipientIds, channelId, false, 'mention', {
          notificationType: NotificationType.MENTION,
        })
      : await notificationFilterService.filterGlobalUsers(recipientIds, NotificationType.MENTION, 'mention');

    if (desktopUsers.length === 0 && mobileUsers.length === 0) {
      return { deliveredUserIds: [] };
    }

    getNotificationJobsExpected().add(desktopUsers.length + mobileUsers.length, { platform: 'desktop', message_type: 'channel' });

    // Mirror message mentions for canvas body; make comment mentions explicit.
    const isCommentMention = mentionContext === 'comment';
    const title = isCommentMention
      ? `You were mentioned in a comment on ${canvasTitle}`
      : channelName
        ? `You were mentioned in #${channelName}`
        : `You were mentioned in ${canvasTitle}`;
    const message = isCommentMention
      ? ''
      : channelName
        ? `${senderName} mentioned you in #${channelName}`
        : `${senderName} mentioned you in a canvas`;

    const notificationData = {
      title,
      message,
      type: NotificationType.MENTION,
      relatedEntityType: 'canvas' as const,
      relatedEntityId: canvasId,
      metadata: {
        canvasId,
        canvasTitle,
        senderId,
        ...(!isCommentMention ? { senderName } : {}),
        workspaceId,
        mentionContext,
        ...(blockId ? { blockId } : {}),
        ...(commentThreadId ? { commentThreadId } : {}),
      },
    };

    const canvasQueryParams = new URLSearchParams();
    if (blockId) canvasQueryParams.set('blockId', blockId);
    if (commentThreadId) canvasQueryParams.set('commentThreadId', commentThreadId);
    const queryString = canvasQueryParams.toString();
    const actionUrl = queryString
      ? `/${workspaceId}/chat/canvas/${canvasId}?${queryString}`
      : `/${workspaceId}/chat/canvas/${canvasId}`;

    // Send desktop-only notifications
    getNotificationJobsExpected().add(desktopUsers.length, { platform: 'desktop', message_type: 'channel' });
    const desktopResults = await Promise.allSettled(
      desktopUsers.map(async userId => {
        const result = await this.createNotification(
          userId,
          { ...notificationData, actionUrl },
          { sendDesktop: true, sendMobile: false },
        );
        return { userId, deliveredViaApp: result.deliveredViaApp };
      })
    );

    // Send mobile-only notifications
    getNotificationJobsExpected().add(mobileUsers.length, { platform: 'mobile', message_type: 'channel' });
    const mobileResults = await Promise.allSettled(
      mobileUsers.map(async userId => {
        const result = await this.createNotification(
          userId,
          { ...notificationData, actionUrl },
          { sendDesktop: false, sendMobile: true },
        );
        return { userId, deliveredViaApp: result.deliveredViaApp };
      })
    );

    const deliveredUserIds = [
      ...desktopResults
        .filter((r): r is PromiseFulfilledResult<{ userId: string; deliveredViaApp: boolean }> => r.status === 'fulfilled')
        .filter(r => r.value.deliveredViaApp)
        .map(r => r.value.userId),
      ...mobileResults
        .filter((r): r is PromiseFulfilledResult<{ userId: string; deliveredViaApp: boolean }> => r.status === 'fulfilled')
        .filter(r => r.value.deliveredViaApp)
        .map(r => r.value.userId),
    ];

    return { deliveredUserIds: [...new Set(deliveredUserIds)] };
  }

  async createCanvasSharedNotifications(
    recipientUserIds: string[],
    canvasId: string,
    canvasTitle: string,
    actorId: string,
    actorName: string,
    role: string,
    actorAction: 'canvas_shared' | 'canvas_role_changed' | 'canvas_access_revoked',
  ): Promise<{ deliveredUserIds: string[] }> {
    const recipientIds = recipientUserIds.filter(id => id !== actorId);

    if (recipientIds.length === 0) {
      return { deliveredUserIds: [] };
    }

    getNotificationJobsExpected().add(recipientIds.length, { platform: 'desktop', message_type: 'canvas' });

    const title = actorAction === 'canvas_shared'
      ? `${actorName} shared a canvas with you`
      : actorAction === 'canvas_access_revoked'
        ? `Your access to a canvas was revoked`
        : `${actorName} changed your role on ${canvasTitle}`;
    const message = actorAction === 'canvas_shared'
      ? `${actorName} shared "${canvasTitle}" with you as ${role}`
      : actorAction === 'canvas_access_revoked'
        ? `Your access to "${canvasTitle}" was revoked by ${actorName}`
        : `${actorName} changed your role to ${role} on "${canvasTitle}"`;

    const results = await Promise.allSettled(
      recipientIds.map(async userId => {
        await this.createNotification(userId, {
          title,
          message,
          type: 'CANVAS_SHARED' as NotificationType,
          relatedEntityType: 'canvas',
          relatedEntityId: canvasId,
          metadata: {
            canvasId,
            actorId,
            actorName,
            role,
            actorAction,
          },
        });
        return userId;
      })
    );

    const deliveredUserIds = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
      .map(r => r.value);

    return { deliveredUserIds };
  }

  async createRecordingSharedNotifications(
    recipientUserIds: string[],
    callId: string,
    recordingTitle: string,
    actorId: string,
    actorName: string,
    actorAction: 'recording_shared' | 'recording_access_revoked',
  ): Promise<{ deliveredUserIds: string[] }> {
    const recipientIds = recipientUserIds.filter(id => id !== actorId);

    if (recipientIds.length === 0) {
      return { deliveredUserIds: [] };
    }

    getNotificationJobsExpected().add(recipientIds.length, {
      platform: 'desktop',
      message_type: 'recording',
    });

    const isRevoked = actorAction === 'recording_access_revoked';
    const title = isRevoked
      ? `${actorName} removed your access to a recording`
      : `${actorName} shared a recording with you`;
    const message = isRevoked
      ? `${actorName} removed your access to "${recordingTitle}"`
      : `${actorName} shared "${recordingTitle}" with you`;

    const results = await Promise.allSettled(
      recipientIds.map(async userId => {
        await this.createNotification(userId, {
          title,
          message,
          type: 'RECORDING_SHARED' as NotificationType,
          relatedEntityType: 'call',
          relatedEntityId: callId,
          metadata: {
            callId,
            actorId,
            actorName,
            actorAction,
          },
        });
        return userId;
      }),
    );

    const deliveredUserIds = results
      .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
      .map(result => result.value);

    return { deliveredUserIds };
  }

  async createSummaryTemplateSharedNotifications(
    recipientUserIds: string[],
    templateId: string,
    templateName: string,
    workspaceId: string,
    actorId: string,
    actorName: string,
    actorAction: 'summary_template_shared' | 'summary_template_access_revoked',
  ): Promise<{ deliveredUserIds: string[] }> {
    const recipientIds = recipientUserIds.filter(id => id !== actorId);
    if (recipientIds.length === 0) return { deliveredUserIds: [] };

    getNotificationJobsExpected().add(recipientIds.length, {
      platform: 'desktop',
      message_type: 'summary_template',
    });

    const isRevoked = actorAction === 'summary_template_access_revoked';
    const title = isRevoked
      ? `${actorName} removed your access to a summary template`
      : `${actorName} shared a summary template with you`;
    const message = isRevoked
      ? `${actorName} removed your access to "${templateName}"`
      : `${actorName} shared "${templateName}" with you`;
    const actionUrl = `/recordings?templates=1&summaryTemplateId=${encodeURIComponent(templateId)}`;

    const results = await Promise.allSettled(
      recipientIds.map(async userId => {
        await this.createNotification(userId, {
          title,
          message,
          type: NotificationType.SUMMARY_TEMPLATE_SHARED,
          relatedEntityType: 'summary_template',
          relatedEntityId: templateId,
          actionUrl,
          workspaceId,
          metadata: {
            summaryTemplateId: templateId,
            templateName,
            actorId,
            actorName,
            actorAction,
          },
        });
        return userId;
      }),
    );

    return {
      deliveredUserIds: results
        .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
        .map(result => result.value),
    };
  }

  async createThreadReplyNotifications(
    userIds: string[],
    replyMessageId: string,
    conversationId: string,
    channelId: string,
    channelName: string,
    senderId: string,
    senderName: string,
    cleanContent: string,
    workspaceId: string,
    isDMChannel: boolean = false,
    senderPicture: string = '',
    prefetchedData?: PrefetchedFilterData,
    isGroupDM: boolean = false,
  ): Promise<{ deliveredUserIds: string[] }> {
    const recipientIds = userIds.filter(id => id !== senderId);

    getNotificationJobsExpected().add(recipientIds.length, { platform: 'desktop', message_type: 'channel' });
    // Filter users based on device preferences, pause settings and notification level.
    // For DM channels, only device filter is applied (skips notification level checks).
    // context='thread_reply': ALL or THREADS_ONLY passes; MENTIONS_ONLY blocks (even for subscribed threads).
    const { desktopUsers, mobileUsers } = await notificationFilterService.filterUsers(
      recipientIds,
      channelId,
      isDMChannel,
      'thread_reply',
      { notificationType: NotificationType.THREAD_REPLY },
      prefetchedData,
      isGroupDM,
    );

    logger.info(`[Notification] Filtered thread reply recipients`, {
      original: recipientIds.length,
      desktopUsers: desktopUsers.length,
      mobileUsers: mobileUsers.length,
      channelId,
    });

    const conversationData = await fetchConversationForNotification(conversationId);

    const notificationData = {
      title: isDMChannel ? `New reply from ${senderName}` : `New reply in #${channelName}`,
      message: `${cleanContent.substring(0, 100)}${cleanContent.length > 100 ? '...' : ''}`,
      type: NotificationType.THREAD_REPLY,
      relatedEntityType: 'message' as const,
      relatedEntityId: replyMessageId,
      actionUrl: `/${workspaceId}/chat/${channelId}/${conversationId}#origin=${conversationId}&messageId=${replyMessageId}`,
      metadata: {
        channelId,
        conversationId,
        messageId: replyMessageId,
        senderId,
        senderName,
        senderPicture,
        channelTitle: channelName,
        messageType: 'thread_reply',
        conversation: conversationData,
      },
    };

    // Send desktop-only notifications (pauseFilter already determined these users should get desktop)
    getNotificationJobsExpected().add(desktopUsers.length, { platform: 'desktop', message_type: 'channel' });
    const desktopResults = await Promise.allSettled(
      desktopUsers.map(async userId => {
        const result = await this.createNotification(userId, notificationData, { sendDesktop: true, sendMobile: false });
        return { userId, deliveredViaApp: result.deliveredViaApp };
      })
    );

    // Send mobile-only notifications (pauseFilter already determined these users should get mobile)
    getNotificationJobsExpected().add(mobileUsers.length, { platform: 'mobile', message_type: 'channel' });
    const mobileResults = await Promise.allSettled(
      mobileUsers.map(async userId => {
        const result = await this.createNotification(userId, notificationData, { sendDesktop: false, sendMobile: true });
        return { userId, deliveredViaApp: result.deliveredViaApp };
      })
    );

    void this.sendOwnMessagePrefetchToMobile(senderId, notificationData);

    // Collect all users who were successfully notified via Spaces
    const deliveredUserIds = [
      ...desktopResults
        .filter((r): r is PromiseFulfilledResult<{ userId: string; deliveredViaApp: boolean }> => r.status === 'fulfilled')
        .filter(r => r.value.deliveredViaApp)
        .map(r => r.value.userId),
      ...mobileResults
        .filter((r): r is PromiseFulfilledResult<{ userId: string; deliveredViaApp: boolean }> => r.status === 'fulfilled')
        .filter(r => r.value.deliveredViaApp)
        .map(r => r.value.userId),
    ];

    return { deliveredUserIds };
  }

  async createDirectMessageNotifications(
    recipientIds: string[],
    messageId: string,
    conversationId: string,
    channelId: string,
    senderId: string,
    senderName: string,
    cleanContent: string,
    workspaceId: string,
    scopeType: ChannelScopeType,
    senderPicture: string = '',
    channelName?: string,
    prefetchedData?: PrefetchedFilterData,
  ): Promise<{ deliveredUserIds: string[] }> {
    if (recipientIds.length === 0) return { deliveredUserIds: [] };

    // 1:1 DMs use the DM shortcut path (NONE check only — level picker does not apply).
    // GROUP_DMs go through the regular channel path but skip the global preference
    // and default to ALL, matching 1:1 DM semantics for the system-level default.
    const isOneToOneDM = scopeType === ChannelScopeType.DM;
    const isGroupDM    = scopeType === ChannelScopeType.GROUP_DM;

    getNotificationJobsExpected().add(recipientIds.length, { platform: 'desktop', message_type: 'dm' });
    const { desktopUsers, mobileUsers } = await notificationFilterService.filterUsers(
      recipientIds,
      channelId,
      isOneToOneDM,
      isOneToOneDM ? 'mention' : 'channel_message',
      {},
      prefetchedData,
      isGroupDM,
    );

    logger.info(`[Notification] Filtered DM recipients`, {
      original: recipientIds.length,
      desktopUsers: desktopUsers.length,
      mobileUsers: mobileUsers.length,
      desktopUserIds: desktopUsers,
      mobileUserIds: mobileUsers,
      channelId,
    });

    const conversationData = await fetchConversationForNotification(conversationId);

    const notificationData = {
      title: scopeType === 'DM' ? `${senderName}` : (channelName ? `${channelName}` : `New Message from ${senderName}`),
      message: cleanContent.substring(0, 100) + (cleanContent.length > 100 ? '...' : ''),
      type: NotificationType.DIRECT_MESSAGE,
      relatedEntityType: 'message' as const,
      relatedEntityId: messageId,
      actionUrl: `/${workspaceId}/chat/dm/${channelId}#origin=${conversationId}&messageId=${messageId}`,
      metadata: {
        workspaceId,
        senderId,
        senderName,
        senderPicture,
        channelId,
        conversationId,
        messageId,
        scopeType,
        conversation: conversationData,
      },
    };

    // Send desktop-only notifications (pauseFilter already determined these users should get desktop)
    getNotificationJobsExpected().add(desktopUsers.length, { platform: 'desktop', message_type: 'dm' });
    const desktopResults = await Promise.allSettled(
      desktopUsers.map(async recipientId => {
        const result = await this.createNotification(recipientId, notificationData, { sendDesktop: true, sendMobile: false });
        return { userId: recipientId, deliveredViaApp: result.deliveredViaApp };
      })
    );

    // Send mobile-only notifications (pauseFilter already determined these users should get mobile)
    getNotificationJobsExpected().add(mobileUsers.length, { platform: 'mobile', message_type: 'dm' });
    const mobileResults = await Promise.allSettled(
      mobileUsers.map(async recipientId => {
        const result = await this.createNotification(recipientId, notificationData, { sendDesktop: false, sendMobile: true });
        return { userId: recipientId, deliveredViaApp: result.deliveredViaApp };
      })
    );

    void this.sendOwnMessagePrefetchToMobile(senderId, notificationData);

    const deliveredUserIds = [
      ...desktopResults
        .filter((r): r is PromiseFulfilledResult<{ userId: string; deliveredViaApp: boolean }> => r.status === 'fulfilled')
        .filter(r => r.value.deliveredViaApp)
        .map(r => r.value.userId),
      ...mobileResults
        .filter((r): r is PromiseFulfilledResult<{ userId: string; deliveredViaApp: boolean }> => r.status === 'fulfilled')
        .filter(r => r.value.deliveredViaApp)
        .map(r => r.value.userId),
    ];

    return { deliveredUserIds: [...new Set(deliveredUserIds)] };
  }

  async createParticipantAddedNotifications(
    userIds: string[],
    channelId: string,
    channelName: string,
    adderId: string,
    adderName: string,
    workspaceId: string
  ): Promise<void> {
    if (userIds.length === 0) return;

    const title = `Added to ${channelName}`;
    const message = `${adderName} added you to ${channelName}`;

    await Promise.allSettled(
      userIds.map(userId =>
        this.createNotification(userId, {
          title,
          message,
          type: NotificationType.DIRECT_MESSAGE,
          relatedEntityType: 'channel',
          relatedEntityId: channelId,
          actionUrl: `/${workspaceId}/chat/dir/${channelId}`,
          metadata: {
            channelId,
            addedBy: adderId,
            adderName,
          },
        })
      )
    );
  }

  async createFCMNotification(userId: string, data: NotificationData): Promise<void> {
    try {
      const shouldSendToMobile = await fcmPushService.hasActiveTokens(userId);
      if (!shouldSendToMobile) {
        return;
      }

      const sessions = await fcmPushService.getActiveSessionsWithTokens(userId);

      // Resolve the tenant ONCE. userId is fixed for this call, so leaving it to
      // createSessionNotification would repeat the same lookup for every session.
      const sessionData: NotificationData = {
        ...data,
        workspaceId: data.workspaceId ?? (await resolveWorkspaceIdFromModel(prisma, 'user', { id: userId })),
      };

      await Promise.allSettled(
        sessions.map(async (session) => {
          // Determine specific delivery method based on platform
          const deliveryMethod = session.platform === 'ios'
            ? NotificationDeliveryMethod.IOS
            : NotificationDeliveryMethod.ANDROID;

          // Create individual tracking entry for this session
          const sessionNotification = await this.createSessionNotification(
            userId,
            sessionData,
            deliveryMethod
          );

          const mobilePayload = {
            type: data.type,
            title: data.title,
            message: data.message,
            notificationId: sessionNotification.id, // Use the specific session notification ID
            actionUrl: data.actionUrl,
            relatedEntityType: data.relatedEntityType,
            relatedEntityId: data.relatedEntityId,
            metadata: data.metadata
          };

          try {
            await realTimeNotificationService.queueMobilePush(userId, session, mobilePayload);
          } catch (reason) {
            logger.error('Failed to queue mobile push notification', {
              userId,
              notificationId: sessionNotification.id,
              reason,
            });
          }
        })
      );
      logger.info('[NotificationService] Created FCM notifications for all sessions', {
        userId,
        type: data.type,
        sessionCount: sessions.length,
      });
    } catch (error) {
      logger.info('[NotificationService] Failed to create notification:', error);
      throw error;
    }
  }


  async getUserNotifications(userId: string, options: NotificationOptions = {}): Promise<any> {
    const { page = 1, limit = 20, status } = options;
    const offset = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      repositories.notifications.findByUserId(userId, {
        status,
        limit,
        offset,
      }),
      repositories.notifications.countByUserId(userId, status),
    ]);

    return {
      notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async markAsRead(notificationId: string, userId: string): Promise<void> {
    await repositories.notifications.markAsRead(notificationId, userId);
  }

  async dismiss(notificationId: string, userId: string): Promise<void> {
    await repositories.notifications.dismiss(notificationId, userId);
  }

  async markAllAsRead(userId: string): Promise<void> {
    // First, check what notifications exist before update
    const beforeCount = await repositories.notifications.countByUserId(userId, 'UNREAD');

    logger.info(`markAllAsRead: Found ${beforeCount} UNREAD notifications for user ${userId}`);

    await repositories.notifications.markAllAsRead(userId);

    logger.info(`markAllAsRead: Updated ${beforeCount} notifications to READ for user ${userId}`);

    // Verify the change
    const afterCount = await repositories.notifications.countByUserId(userId, 'UNREAD');

    logger.info(
      `markAllAsRead: After update, ${afterCount} UNREAD notifications remain for user ${userId}`
    );
  }

  async getUnreadCount(userId: string): Promise<number> {
    return repositories.notifications.countByUserId(userId, 'UNREAD');
  }

  async getWorkspaceNotificationCounts(memberId: string): Promise<
    Array<{
      workspaceId: string;
      userId: string;
      count: number;
    }>
  > {
    // Spans the caller's own identities across workspaces.
    return runAsSystem(async () => {
      // Step 1: Get all active users for this member across workspaces
      const users = await prisma.user.findMany({
        where: {
          orgMemberId: memberId,
          leftAt: null,
          status: UserStatus.ACTIVE,
        },
        select: {
          id: true,
          workspaceId: true,
        },
      });

      if (users.length === 0) {
        return [];
      }

      const userIds = users.map(u => u.id);

      // Step 2: Count unread+delivered notifications per user
      const notificationCounts = await prisma.notification.groupBy({
        by: ['userId'],
        where: {
          userId: { in: userIds },
          status: { in: [NotificationStatus.UNREAD, NotificationStatus.DELIVERED] },
          readAt: null,
          dismissedAt: null,
        },
        _count: {
          id: true,
        },
      });

      // Build a map: userId -> count
      const countMap = new Map<string, number>();
      for (const nc of notificationCounts) {
        countMap.set(nc.userId, nc._count.id);
      }

      // Step 3: Merge users with their counts
      return users.map(u => ({
        workspaceId: u.workspaceId,
        userId: u.id,
        count: countMap.get(u.id) ?? 0,
      }));
    });
  }

  async getUserPreferences(userId: string): Promise<UserPreferences> {
    const preferences = await repositories.notificationPreferences.findByUserId(userId);

    // Default preferences for all notification types
    const defaultPrefs: UserPreferences = {
      TICKET_STATUS_CHANGE: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      TICKET_ASSIGNMENT: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      TICKET_REASSIGNMENT: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      TICKET_DUE_DATE_CHANGED: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      TICKET_PRIORITY_CHANGED: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      TICKET_USER_GROUP_CHANGED: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      TICKET_TITLE_CHANGED: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      TICKET_DESCRIPTION_CHANGED: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      TICKET_RCA_CREATED: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      TICKET_RCA_UPDATED: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      TICKET_SUBTICKET_ADDED: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      TICKET_RELATED_TICKET_ADDED: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      TICKET_RELATED_TICKET_REMOVED: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      CHANNEL_MESSAGE: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      MENTION: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      DIRECT_MESSAGE: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      WORKFLOW_COMPLETION: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      WORKFLOW_FAILURE: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
    };

    // Override with user's actual preferences
    preferences.forEach((pref) => {
      defaultPrefs[pref.notificationType] = {
        browserEnabled: pref.browserEnabled,
        emailEnabled: pref.emailEnabled,
        slackEnabled: pref.slackEnabled,
      };
    });

    return defaultPrefs;
  }

  async updateUserPreferences(userId: string, preferences: UserPreferences): Promise<void> {
    // Filter out invalid notification types for migration (like old SYSTEM_ALERTS)
    const validNotificationTypes = [
      'TICKET_STATUS_CHANGE',
      'TICKET_ASSIGNMENT',
      'TICKET_REASSIGNMENT',
      'TICKET_DUE_DATE_CHANGED',
      'TICKET_PRIORITY_CHANGED',
      'TICKET_USER_GROUP_CHANGED',
      'TICKET_TITLE_CHANGED',
      'TICKET_DESCRIPTION_CHANGED',
      'TICKET_RCA_CREATED',
      'TICKET_RCA_UPDATED',
      'TICKET_SUBTICKET_ADDED',
      'TICKET_RELATED_TICKET_ADDED',
      'TICKET_RELATED_TICKET_REMOVED',
      'CHANNEL_MESSAGE',
      'MENTION',
      'DIRECT_MESSAGE',
      'WORKFLOW_COMPLETION',
      'WORKFLOW_FAILURE',
    ];

    const filteredPreferences = Object.entries(preferences).filter(([type]) =>
      validNotificationTypes.includes(type)
    );

    const updatePromises = filteredPreferences.map(([type, prefs]) => {
      return repositories.notificationPreferences.upsertPreference(userId, type, prefs);
    });

    await Promise.all(updatePromises);

    // Clean up any old invalid notification types
    const allUserPrefs = await repositories.notificationPreferences.findByUserId(userId);
    const invalidPrefs = allUserPrefs.filter(
      (pref) => !validNotificationTypes.includes(pref.notificationType)
    );

    for (const invalidPref of invalidPrefs) {
      await repositories.notificationPreferences.delete(invalidPref.id);
    }
  }

  async sendTicketAssignmentNotification(
    ticketId: string,
    assignedTo: string,
    assignedBy: string
  ): Promise<void> {
    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          xyneId: true,
          title: true,
          channelId: true,
          conversationId: true,
          workspaceId: true,
          channel: { select: { type: true } },
        },
      });
      if (!ticket) {
        logger.warn(`Ticket not found: ${ticketId}`);
        return;
      }

      // Apply pause and channel-level filtering before delivering.
      const { desktopUsers, mobileUsers } = ticket.channelId
        ? await notificationFilterService.filterUsers([assignedTo], ticket.channelId, false, 'mention', {
            notificationType: NotificationType.TICKET_ASSIGNMENT,
          })
        : await notificationFilterService.filterGlobalUsers([assignedTo], NotificationType.TICKET_ASSIGNMENT, 'mention');

      const receiveDesktop = desktopUsers.includes(assignedTo);
      const receiveMobile = mobileUsers.includes(assignedTo);

      if (!receiveDesktop && !receiveMobile) {
        return;
      }

      const actionUrl = buildTicketActionUrl(ticket, ticketId);

      await this.createNotification(assignedTo, {
        title: 'Ticket Assigned',
        message: `You have been assigned to ticket "${ticket.title}"`,
        type: NotificationType.TICKET_ASSIGNMENT,
        relatedEntityType: 'ticket',
        relatedEntityId: ticketId,
        actionUrl,
        metadata: {
          ticketId,
          assignedBy,
          channelId: ticket.channelId,
          conversationId: ticket.conversationId,
        },
      }, { sendDesktop: receiveDesktop, sendMobile: receiveMobile });
    } catch (error) {
      logger.error('Failed to send ticket assignment notification:', error);
    }
  }

  /**
   * Notify a user about a stage-change approval event. Used in three cases:
   *  - kind=REQUESTED → approver is being asked to review a newly submitted request
   *  - kind=APPROVED  → submitter is being told their request was approved
   *  - kind=REJECTED  → submitter is being told their request was rejected
   * Activity entries for these transitions are emitted separately by the
   * ticketStageRequest.upsert mutator (as system messages); this method only
   * handles the push-notification side.
   */
  async sendStageApprovalNotification(
    recipientUserId: string,
    ticketId: string,
    kind: 'REQUESTED' | 'APPROVED' | 'REJECTED',
    actorUserId: string,
    stageName: string | null,
  ): Promise<void> {
    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          xyneId: true,
          title: true,
          channelId: true,
          conversationId: true,
          workspaceId: true,
          channel: { select: { type: true } },
        },
      });
      if (!ticket) {
        logger.warn(`Stage approval notification: ticket not found: ${ticketId}`);
        return;
      }

      const notificationType: NotificationType =
        kind === 'REQUESTED'
          ? NotificationType.STAGE_APPROVAL_REQUESTED
          : kind === 'APPROVED'
            ? NotificationType.STAGE_APPROVAL_APPROVED
            : NotificationType.STAGE_APPROVAL_REJECTED;

      // Apply pause + channel-level filtering, same pattern as ticket-assignment.
      const { desktopUsers, mobileUsers } = ticket.channelId
        ? await notificationFilterService.filterUsers([recipientUserId], ticket.channelId, false, 'mention', {
            notificationType,
          })
        : await notificationFilterService.filterGlobalUsers([recipientUserId], notificationType, 'mention');

      const receiveDesktop = desktopUsers.includes(recipientUserId);
      const receiveMobile = mobileUsers.includes(recipientUserId);

      if (!receiveDesktop && !receiveMobile) {
        return;
      }

      const stageLabel = stageName ? ` for stage "${stageName}"` : '';
      const ticketLabel = ticket.title ? `"${ticket.title}"` : `#${ticket.xyneId}`;

      const title =
        kind === 'REQUESTED'
          ? 'Stage change requested'
          : kind === 'APPROVED'
            ? 'Stage change approved'
            : 'Stage change rejected';

      const message =
        kind === 'REQUESTED'
          ? `A stage change${stageLabel} on ticket ${ticketLabel} is awaiting your approval`
          : kind === 'APPROVED'
            ? `Your stage change${stageLabel} on ticket ${ticketLabel} was approved`
            : `Your stage change${stageLabel} on ticket ${ticketLabel} was rejected`;

      const actionUrl = buildTicketActionUrl(ticket, ticketId);

      await this.createNotification(recipientUserId, {
        title,
        message,
        type: notificationType,
        relatedEntityType: 'ticket',
        relatedEntityId: ticketId,
        actionUrl,
        metadata: {
          ticketId,
          actorUserId,
          channelId: ticket.channelId,
          conversationId: ticket.conversationId,
          stageName,
          kind,
        },
      }, { sendDesktop: receiveDesktop, sendMobile: receiveMobile });
    } catch (error) {
      logger.error('Failed to send stage approval notification:', error);
    }
  }

  async getStats(): Promise<any> {
    return await realTimeNotificationService.getStats();
  }

  async sendTicketReassignmentNotification(
    ticketId: string,
    recipients: string[],
    oldAssigneeName: string,
    newAssigneeName: string,
    actorId: string,
  ): Promise<void> {
    if (recipients.length === 0) return;

    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          xyneId: true,
          title: true,
          channelId: true,
          conversationId: true,
          workspaceId: true,
          channel: { select: { type: true } },
        },
      });
      if (!ticket) {
        logger.warn(`[NotificationService] Ticket not found: ${ticketId}`);
        return;
      }

      const actionUrl = buildTicketActionUrl(ticket, ticketId);

      const ticketDisplayId = ticket.xyneId || ticket.id;
      const title = 'Ticket Reassigned';
      const message = `Ticket '${ticketDisplayId}' reassigned from ${oldAssigneeName} to ${newAssigneeName}`;

      await Promise.allSettled(
        recipients.map(async (userId) => {
          if (userId === actorId) return;

          const { desktopUsers, mobileUsers } = ticket.channelId
            ? await notificationFilterService.filterUsers([userId], ticket.channelId, false, 'mention', {
                notificationType: NotificationType.TICKET_REASSIGNMENT,
              })
            : await notificationFilterService.filterGlobalUsers([userId], NotificationType.TICKET_REASSIGNMENT, 'mention');

          const receiveDesktop = desktopUsers.includes(userId);
          const receiveMobile = mobileUsers.includes(userId);

          if (!receiveDesktop && !receiveMobile) return;

          await this.createNotification(userId, {
            title,
            message,
            type: NotificationType.TICKET_REASSIGNMENT,
            relatedEntityType: 'ticket',
            relatedEntityId: ticketId,
            actionUrl,
            metadata: {
              ticketId,
              actorId,
              channelId: ticket.channelId,
              conversationId: ticket.conversationId,
            },
          }, { sendDesktop: receiveDesktop, sendMobile: receiveMobile });
        }),
      );
    } catch (error) {
      logger.error('[NotificationService] Failed to send ticket reassignment notification:', error);
    }
  }

  async sendTicketDueDateChangedNotification(
    ticketId: string,
    recipients: string[],
    newDueDate: string,
    actorId: string,
  ): Promise<void> {
    if (recipients.length === 0) return;

    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          xyneId: true,
          title: true,
          channelId: true,
          conversationId: true,
          workspaceId: true,
          channel: { select: { type: true } },
        },
      });
      if (!ticket) {
        logger.warn(`[NotificationService] Ticket not found: ${ticketId}`);
        return;
      }

      const actionUrl = buildTicketActionUrl(ticket, ticketId);

      const ticketDisplayId = ticket.xyneId || ticket.id;
      const title = 'Due Date Changed';
      const message = `Due date for ticket '${ticketDisplayId}' changed to ${newDueDate}`;

      await Promise.allSettled(
        recipients.map(async (userId) => {
          if (userId === actorId) return;

          const { desktopUsers, mobileUsers } = ticket.channelId
            ? await notificationFilterService.filterUsers([userId], ticket.channelId, false, 'mention', {
                notificationType: NotificationType.TICKET_DUE_DATE_CHANGED,
              })
            : await notificationFilterService.filterGlobalUsers([userId], NotificationType.TICKET_DUE_DATE_CHANGED, 'mention');

          const receiveDesktop = desktopUsers.includes(userId);
          const receiveMobile = mobileUsers.includes(userId);

          if (!receiveDesktop && !receiveMobile) return;

          await this.createNotification(userId, {
            title,
            message,
            type: NotificationType.TICKET_DUE_DATE_CHANGED,
            relatedEntityType: 'ticket',
            relatedEntityId: ticketId,
            actionUrl,
            metadata: {
              ticketId,
              actorId,
              channelId: ticket.channelId,
              conversationId: ticket.conversationId,
              newDueDate,
            },
          }, { sendDesktop: receiveDesktop, sendMobile: receiveMobile });
        }),
      );
    } catch (error) {
      logger.error('[NotificationService] Failed to send ticket due date changed notification:', error);
    }
  }

  async sendTicketStatusChangeNotification(
    ticketId: string,
    recipients: string[],
    newStatus: string,
    actorId: string,
  ): Promise<void> {
    if (recipients.length === 0) return;

    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          xyneId: true,
          title: true,
          channelId: true,
          conversationId: true,
          workspaceId: true,
          channel: { select: { type: true } },
        },
      });
      if (!ticket) {
        logger.warn(`[NotificationService] Ticket not found: ${ticketId}`);
        return;
      }

      const actionUrl = buildTicketActionUrl(ticket, ticketId);

      const ticketDisplayId = ticket.xyneId || ticket.id;
      const title = 'Status Changed';
      const message = `Ticket '${ticketDisplayId}' status changed to ${newStatus}`;

      await Promise.allSettled(
        recipients.map(async (userId) => {
          if (userId === actorId) return;

          const { desktopUsers, mobileUsers } = ticket.channelId
            ? await notificationFilterService.filterUsers([userId], ticket.channelId, false, 'mention', {
                notificationType: NotificationType.TICKET_STATUS_CHANGE,
              })
            : await notificationFilterService.filterGlobalUsers([userId], NotificationType.TICKET_STATUS_CHANGE, 'mention');

          const receiveDesktop = desktopUsers.includes(userId);
          const receiveMobile = mobileUsers.includes(userId);

          if (!receiveDesktop && !receiveMobile) return;

          await this.createNotification(userId, {
            title,
            message,
            type: NotificationType.TICKET_STATUS_CHANGE,
            relatedEntityType: 'ticket',
            relatedEntityId: ticketId,
            actionUrl,
            metadata: {
              ticketId,
              actorId,
              channelId: ticket.channelId,
              conversationId: ticket.conversationId,
              newStatus,
            },
          }, { sendDesktop: receiveDesktop, sendMobile: receiveMobile });
        }),
      );
    } catch (error) {
      logger.error('[NotificationService] Failed to send ticket status change notification:', error);
    }
  }

  async sendTicketPriorityChangeNotification(
    ticketId: string,
    recipients: string[],
    oldPriority: string,
    newPriority: string,
    actorId: string,
  ): Promise<void> {
    if (recipients.length === 0) return;

    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          xyneId: true,
          title: true,
          channelId: true,
          conversationId: true,
          workspaceId: true,
          channel: { select: { type: true } },
        },
      });
      if (!ticket) {
        logger.warn(`[NotificationService] Ticket not found: ${ticketId}`);
        return;
      }

      const actionUrl = buildTicketActionUrl(ticket, ticketId);

      const ticketDisplayId = ticket.xyneId || ticket.id;
      const title = 'Priority Changed';
      const message = `Ticket '${ticketDisplayId}' priority changed from ${oldPriority} to ${newPriority}`;

      await Promise.allSettled(
        recipients.map(async (userId) => {
          if (userId === actorId) return;

          const { desktopUsers, mobileUsers } = ticket.channelId
            ? await notificationFilterService.filterUsers([userId], ticket.channelId, false, 'mention', {
                notificationType: NotificationType.TICKET_PRIORITY_CHANGED,
              })
            : await notificationFilterService.filterGlobalUsers([userId], NotificationType.TICKET_PRIORITY_CHANGED, 'mention');

          const receiveDesktop = desktopUsers.includes(userId);
          const receiveMobile = mobileUsers.includes(userId);

          if (!receiveDesktop && !receiveMobile) return;

          await this.createNotification(userId, {
            title,
            message,
            type: NotificationType.TICKET_PRIORITY_CHANGED,
            relatedEntityType: 'ticket',
            relatedEntityId: ticketId,
            actionUrl,
            metadata: {
              ticketId,
              actorId,
              channelId: ticket.channelId,
              conversationId: ticket.conversationId,
              oldPriority,
              newPriority,
            },
          }, { sendDesktop: receiveDesktop, sendMobile: receiveMobile });
        }),
      );
    } catch (error) {
      logger.error('[NotificationService] Failed to send ticket priority change notification:', error);
    }
  }

  async sendTicketUserGroupChangeNotification(
    ticketId: string,
    recipients: string[],
    newUserGroupName: string,
    actorId: string,
  ): Promise<void> {
    if (recipients.length === 0) return;

    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          xyneId: true,
          title: true,
          channelId: true,
          conversationId: true,
          workspaceId: true,
          channel: { select: { type: true } },
        },
      });
      if (!ticket) {
        logger.warn(`[NotificationService] Ticket not found: ${ticketId}`);
        return;
      }

      const actionUrl = buildTicketActionUrl(ticket, ticketId);

      const ticketDisplayId = ticket.xyneId || ticket.id;
      const title = 'User Group Changed';
      const message = `Ticket '${ticketDisplayId}' assigned to user group ${newUserGroupName}`;

      await Promise.allSettled(
        recipients.map(async (userId) => {
          if (userId === actorId) return;

          const { desktopUsers, mobileUsers } = ticket.channelId
            ? await notificationFilterService.filterUsers([userId], ticket.channelId, false, 'mention', {
                notificationType: NotificationType.TICKET_USER_GROUP_CHANGED,
              })
            : await notificationFilterService.filterGlobalUsers([userId], NotificationType.TICKET_USER_GROUP_CHANGED, 'mention');

          const receiveDesktop = desktopUsers.includes(userId);
          const receiveMobile = mobileUsers.includes(userId);

          if (!receiveDesktop && !receiveMobile) return;

          await this.createNotification(userId, {
            title,
            message,
            type: NotificationType.TICKET_USER_GROUP_CHANGED,
            relatedEntityType: 'ticket',
            relatedEntityId: ticketId,
            actionUrl,
            metadata: {
              ticketId,
              actorId,
              channelId: ticket.channelId,
              conversationId: ticket.conversationId,
              newUserGroupName,
            },
          }, { sendDesktop: receiveDesktop, sendMobile: receiveMobile });
        }),
      );
    } catch (error) {
      logger.error('[NotificationService] Failed to send ticket user group change notification:', error);
    }
  }

  async sendTicketTitleChangeNotification(
    ticketId: string,
    recipients: string[],
    newTitle: string,
    actorId: string,
  ): Promise<void> {
    if (recipients.length === 0) return;

    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          xyneId: true,
          title: true,
          channelId: true,
          conversationId: true,
          workspaceId: true,
          channel: { select: { type: true } },
        },
      });
      if (!ticket) {
        logger.warn(`[NotificationService] Ticket not found: ${ticketId}`);
        return;
      }

      const actionUrl = buildTicketActionUrl(ticket, ticketId);

      const ticketDisplayId = ticket.xyneId || ticket.id;
      const title = 'Title Changed';
      const message = `Ticket '${ticketDisplayId}' renamed to ${newTitle}`;

      await Promise.allSettled(
        recipients.map(async (userId) => {
          if (userId === actorId) return;

          const { desktopUsers, mobileUsers } = ticket.channelId
            ? await notificationFilterService.filterUsers([userId], ticket.channelId, false, 'mention', {
                notificationType: NotificationType.TICKET_TITLE_CHANGED,
              })
            : await notificationFilterService.filterGlobalUsers([userId], NotificationType.TICKET_TITLE_CHANGED, 'mention');

          const receiveDesktop = desktopUsers.includes(userId);
          const receiveMobile = mobileUsers.includes(userId);

          if (!receiveDesktop && !receiveMobile) return;

          await this.createNotification(userId, {
            title,
            message,
            type: NotificationType.TICKET_TITLE_CHANGED,
            relatedEntityType: 'ticket',
            relatedEntityId: ticketId,
            actionUrl,
            metadata: {
              ticketId,
              actorId,
              channelId: ticket.channelId,
              conversationId: ticket.conversationId,
              newTitle,
            },
          }, { sendDesktop: receiveDesktop, sendMobile: receiveMobile });
        }),
      );
    } catch (error) {
      logger.error('[NotificationService] Failed to send ticket title change notification:', error);
    }
  }

  async sendTicketDescriptionChangeNotification(
    ticketId: string,
    recipients: string[],
    actorId: string,
  ): Promise<void> {
    if (recipients.length === 0) return;

    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          xyneId: true,
          title: true,
          channelId: true,
          conversationId: true,
          workspaceId: true,
          channel: { select: { type: true } },
        },
      });
      if (!ticket) {
        logger.warn(`[NotificationService] Ticket not found: ${ticketId}`);
        return;
      }

      const actionUrl = buildTicketActionUrl(ticket, ticketId);

      const ticketDisplayId = ticket.xyneId || ticket.id;
      const title = 'Description Updated';
      const message = `Ticket '${ticketDisplayId}' description was updated`;

      await Promise.allSettled(
        recipients.map(async (userId) => {
          if (userId === actorId) return;

          const { desktopUsers, mobileUsers } = ticket.channelId
            ? await notificationFilterService.filterUsers([userId], ticket.channelId, false, 'mention', {
                notificationType: NotificationType.TICKET_DESCRIPTION_CHANGED,
              })
            : await notificationFilterService.filterGlobalUsers([userId], NotificationType.TICKET_DESCRIPTION_CHANGED, 'mention');

          const receiveDesktop = desktopUsers.includes(userId);
          const receiveMobile = mobileUsers.includes(userId);

          if (!receiveDesktop && !receiveMobile) return;

          await this.createNotification(userId, {
            title,
            message,
            type: NotificationType.TICKET_DESCRIPTION_CHANGED,
            relatedEntityType: 'ticket',
            relatedEntityId: ticketId,
            actionUrl,
            metadata: {
              ticketId,
              actorId,
              channelId: ticket.channelId,
              conversationId: ticket.conversationId,
            },
          }, { sendDesktop: receiveDesktop, sendMobile: receiveMobile });
        }),
      );
    } catch (error) {
      logger.error('[NotificationService] Failed to send ticket description change notification:', error);
    }
  }

  async sendTicketRcaCreatedNotification(
    ticketId: string,
    recipients: string[],
    actorId: string,
  ): Promise<void> {
    if (recipients.length === 0) return;

    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          xyneId: true,
          title: true,
          channelId: true,
          conversationId: true,
          workspaceId: true,
          channel: { select: { type: true } },
        },
      });
      if (!ticket) {
        logger.warn(`[NotificationService] Ticket not found: ${ticketId}`);
        return;
      }

      const actionUrl = buildTicketActionUrl(ticket, ticketId);

      const ticketDisplayId = ticket.xyneId || ticket.id;
      const title = 'RCA Added';
      const message = `An RCA was added to ticket '${ticketDisplayId}'`;

      await Promise.allSettled(
        recipients.map(async (userId) => {
          if (userId === actorId) return;

          const { desktopUsers, mobileUsers } = ticket.channelId
            ? await notificationFilterService.filterUsers([userId], ticket.channelId, false, 'mention', {
                notificationType: NotificationType.TICKET_RCA_CREATED,
              })
            : await notificationFilterService.filterGlobalUsers([userId], NotificationType.TICKET_RCA_CREATED, 'mention');

          const receiveDesktop = desktopUsers.includes(userId);
          const receiveMobile = mobileUsers.includes(userId);

          if (!receiveDesktop && !receiveMobile) return;

          await this.createNotification(userId, {
            title,
            message,
            type: NotificationType.TICKET_RCA_CREATED,
            relatedEntityType: 'ticket',
            relatedEntityId: ticketId,
            actionUrl,
            metadata: {
              ticketId,
              actorId,
              channelId: ticket.channelId,
              conversationId: ticket.conversationId,
            },
          }, { sendDesktop: receiveDesktop, sendMobile: receiveMobile });
        }),
      );
    } catch (error) {
      logger.error('[NotificationService] Failed to send ticket RCA created notification:', error);
    }
  }

  async sendTicketRcaUpdatedNotification(
    ticketId: string,
    recipients: string[],
    actorId: string,
  ): Promise<void> {
    if (recipients.length === 0) return;

    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          xyneId: true,
          title: true,
          channelId: true,
          conversationId: true,
          workspaceId: true,
          channel: { select: { type: true } },
        },
      });
      if (!ticket) {
        logger.warn(`[NotificationService] Ticket not found: ${ticketId}`);
        return;
      }

      const actionUrl = buildTicketActionUrl(ticket, ticketId);

      const ticketDisplayId = ticket.xyneId || ticket.id;
      const title = 'RCA Updated';
      const message = `RCA was updated for ticket '${ticketDisplayId}'`;

      await Promise.allSettled(
        recipients.map(async (userId) => {
          if (userId === actorId) return;

          const { desktopUsers, mobileUsers } = ticket.channelId
            ? await notificationFilterService.filterUsers([userId], ticket.channelId, false, 'mention', {
                notificationType: NotificationType.TICKET_RCA_UPDATED,
              })
            : await notificationFilterService.filterGlobalUsers([userId], NotificationType.TICKET_RCA_UPDATED, 'mention');

          const receiveDesktop = desktopUsers.includes(userId);
          const receiveMobile = mobileUsers.includes(userId);

          if (!receiveDesktop && !receiveMobile) return;

          await this.createNotification(userId, {
            title,
            message,
            type: NotificationType.TICKET_RCA_UPDATED,
            relatedEntityType: 'ticket',
            relatedEntityId: ticketId,
            actionUrl,
            metadata: {
              ticketId,
              actorId,
              channelId: ticket.channelId,
              conversationId: ticket.conversationId,
            },
          }, { sendDesktop: receiveDesktop, sendMobile: receiveMobile });
        }),
      );
    } catch (error) {
      logger.error('[NotificationService] Failed to send ticket RCA updated notification:', error);
    }
  }

  async sendTicketSubticketAddedNotification(
    ticketId: string,
    recipients: string[],
    subticketTitle: string,
    actorId: string,
  ): Promise<void> {
    if (recipients.length === 0) return;

    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          xyneId: true,
          title: true,
          channelId: true,
          conversationId: true,
          workspaceId: true,
          channel: { select: { type: true } },
        },
      });
      if (!ticket) {
        logger.warn(`[NotificationService] Ticket not found: ${ticketId}`);
        return;
      }

      const actionUrl = buildTicketActionUrl(ticket, ticketId);

      const ticketDisplayId = ticket.xyneId || ticket.id;
      const title = 'Sub-ticket Added';
      const message = `Sub-ticket "${subticketTitle}" was added to ticket '${ticketDisplayId}'`;

      await Promise.allSettled(
        recipients.map(async (userId) => {
          if (userId === actorId) return;

          const { desktopUsers, mobileUsers } = ticket.channelId
            ? await notificationFilterService.filterUsers([userId], ticket.channelId, false, 'mention', {
                notificationType: NotificationType.TICKET_SUBTICKET_ADDED,
              })
            : await notificationFilterService.filterGlobalUsers([userId], NotificationType.TICKET_SUBTICKET_ADDED, 'mention');

          const receiveDesktop = desktopUsers.includes(userId);
          const receiveMobile = mobileUsers.includes(userId);

          if (!receiveDesktop && !receiveMobile) return;

          await this.createNotification(userId, {
            title,
            message,
            type: NotificationType.TICKET_SUBTICKET_ADDED,
            relatedEntityType: 'ticket',
            relatedEntityId: ticketId,
            actionUrl,
            metadata: {
              ticketId,
              actorId,
              channelId: ticket.channelId,
              conversationId: ticket.conversationId,
              subticketTitle,
            },
          }, { sendDesktop: receiveDesktop, sendMobile: receiveMobile });
        }),
      );
    } catch (error) {
      logger.error('[NotificationService] Failed to send ticket subticket added notification:', error);
    }
  }

  async sendTicketRelatedTicketAddedNotification(
    ticketId: string,
    recipients: string[],
    relatedTicketTitle: string,
    relationType: string,
    actorId: string,
  ): Promise<void> {
    if (recipients.length === 0) return;

    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          xyneId: true,
          title: true,
          channelId: true,
          conversationId: true,
          workspaceId: true,
          channel: { select: { type: true } },
        },
      });
      if (!ticket) {
        logger.warn(`[NotificationService] Ticket not found: ${ticketId}`);
        return;
      }

      const actionUrl = buildTicketActionUrl(ticket, ticketId);

      const ticketDisplayId = ticket.xyneId || ticket.id;
      const title = 'Related Ticket Added';
      const message = `Related ticket "${relatedTicketTitle}" (${relationType}) was linked to ticket '${ticketDisplayId}'`;

      await Promise.allSettled(
        recipients.map(async (userId) => {
          if (userId === actorId) return;

          const { desktopUsers, mobileUsers } = ticket.channelId
            ? await notificationFilterService.filterUsers([userId], ticket.channelId, false, 'mention', {
                notificationType: NotificationType.TICKET_RELATED_TICKET_ADDED,
              })
            : await notificationFilterService.filterGlobalUsers([userId], NotificationType.TICKET_RELATED_TICKET_ADDED, 'mention');

          const receiveDesktop = desktopUsers.includes(userId);
          const receiveMobile = mobileUsers.includes(userId);

          if (!receiveDesktop && !receiveMobile) return;

          await this.createNotification(userId, {
            title,
            message,
            type: NotificationType.TICKET_RELATED_TICKET_ADDED,
            relatedEntityType: 'ticket',
            relatedEntityId: ticketId,
            actionUrl,
            metadata: {
              ticketId,
              actorId,
              channelId: ticket.channelId,
              conversationId: ticket.conversationId,
              relatedTicketTitle,
              relationType,
            },
          }, { sendDesktop: receiveDesktop, sendMobile: receiveMobile });
        }),
      );
    } catch (error) {
      logger.error('[NotificationService] Failed to send ticket related ticket added notification:', error);
    }
  }

  async sendTicketRelatedTicketRemovedNotification(
    ticketId: string,
    recipients: string[],
    relatedTicketTitle: string,
    relationType: string,
    actorId: string,
  ): Promise<void> {
    if (recipients.length === 0) return;

    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          xyneId: true,
          title: true,
          channelId: true,
          conversationId: true,
          workspaceId: true,
          channel: { select: { type: true } },
        },
      });
      if (!ticket) {
        logger.warn(`[NotificationService] Ticket not found: ${ticketId}`);
        return;
      }

      const actionUrl = buildTicketActionUrl(ticket, ticketId);

      const ticketDisplayId = ticket.xyneId || ticket.id;
      const title = 'Related Ticket Removed';
      const message = `Related ticket "${relatedTicketTitle}" (${relationType}) was unlinked from ticket '${ticketDisplayId}'`;

      await Promise.allSettled(
        recipients.map(async (userId) => {
          if (userId === actorId) return;

          const { desktopUsers, mobileUsers } = ticket.channelId
            ? await notificationFilterService.filterUsers([userId], ticket.channelId, false, 'mention', {
                notificationType: NotificationType.TICKET_RELATED_TICKET_REMOVED,
              })
            : await notificationFilterService.filterGlobalUsers([userId], NotificationType.TICKET_RELATED_TICKET_REMOVED, 'mention');

          const receiveDesktop = desktopUsers.includes(userId);
          const receiveMobile = mobileUsers.includes(userId);

          if (!receiveDesktop && !receiveMobile) return;

          await this.createNotification(userId, {
            title,
            message,
            type: NotificationType.TICKET_RELATED_TICKET_REMOVED,
            relatedEntityType: 'ticket',
            relatedEntityId: ticketId,
            actionUrl,
            metadata: {
              ticketId,
              actorId,
              channelId: ticket.channelId,
              conversationId: ticket.conversationId,
              relatedTicketTitle,
              relationType,
            },
          }, { sendDesktop: receiveDesktop, sendMobile: receiveMobile });
        }),
      );
    } catch (error) {
      logger.error('[NotificationService] Failed to send ticket related ticket removed notification:', error);
    }
  }

  /**
   * Silent prefetch push to the sender's own mobile devices so a message they sent
   * from another platform (web/desktop) warms the mobile cache before the app is
   * opened. Not fanned out to desktop/WebSocket (Zero already syncs those) and never
   * writes a DB `sessionNotification` row — this is purely a wake-up hint.
   *
   * Fires per message (once). Idempotent on the receiving device: if the sender's
   * mobile app also originated the message, Zero has already stored the row locally
   * and the prefetch is a no-op.
   *
   * Gated by env `LOTUS_OWN_MESSAGE_PREFETCH_ENABLED=true`. Kept off by default so
   * lotus can ship the client-side `prefetchOnly` handler first and reach adoption
   * before the backend starts sending these pushes. Older lotus builds have no
   * short-circuit and would draw a spurious "New message" banner with empty body
   * for the sender's own messages.
   */
  async sendOwnMessagePrefetchToMobile(
    senderId: string,
    data: NotificationData,
  ): Promise<void> {
    if (process.env.LOTUS_OWN_MESSAGE_PREFETCH_ENABLED !== 'true') return;
    try {
      const sessions = await fcmPushService.getActiveSessionsWithTokens(senderId);
      const mobileSessions = sessions.filter(
        s => s.platform === 'ios' || s.platform === 'android',
      );
      if (mobileSessions.length === 0) {
        logger.info('[NOTIFICATION-SERVICE] OWN-PREFETCH SKIPPED (no mobile sessions)', {
          senderId,
          type: data.type,
        });
        return;
      }

      await Promise.allSettled(
        mobileSessions.map(session =>
          realTimeNotificationService.queueMobilePush(senderId, session, {
            type: data.type,
            title: data.title,
            message: data.message,
            actionUrl: data.actionUrl,
            relatedEntityType: data.relatedEntityType,
            relatedEntityId: data.relatedEntityId,
            metadata: data.metadata,
            prefetchOnly: true,
          }),
        ),
      );

      logger.info('[NOTIFICATION-SERVICE] OWN-PREFETCH QUEUED', {
        senderId,
        type: data.type,
        sessions: mobileSessions.length,
      });
    } catch (error) {
      logger.error('[NOTIFICATION-SERVICE] OWN-PREFETCH FAILED', {
        senderId,
        type: data.type,
        error,
      });
    }
  }
}

export const notificationService = new NotificationService();
