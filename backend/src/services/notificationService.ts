import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import webpush from 'web-push';
import { websocketService } from './websocketService';
import {
  createFlowJson,
  createSingleLineText,
  createMultiLineText,
  createFlexLayout,
  createTag,
} from '@/bots/json-ui';
import type { FlowJson } from '@/bots/json-ui/types';
import { ChannelScopeType, NotificationDeliveryMethod, NotificationType } from '@prisma/client';
import { notificationService as realTimeNotificationService } from '@/notification-service';
import { fcmPushService, type MobilePushRegistration } from './fcmService';
import { getNotificationJobsExpected } from '@/services/otel';
import { DatabaseClient } from '@/database/client';
import * as notificationFilterService from './notificationFilterService';

const prisma = DatabaseClient.getInstance();

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
  constructor() {
    this.initializeWebPush();
  }
  /**
   * Helper to create a granular notification entry for a specific session (Mobile or Web)
   */
  async createSessionNotification(
    userId: string,
    data: NotificationData,
    deliveryMethod: NotificationDeliveryMethod = NotificationDeliveryMethod.BROWSER
  ) {
    return await repositories.notifications.create({
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

  private initializeWebPush(): void {
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@xyne.ai';

    if (vapidPublicKey && vapidPrivateKey) {
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    } else {
      logger.warn('VAPID keys not configured. Push notifications will not work.');
    }
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

      const title = isSuccess ? 'Workflow Completed' : 'Workflow Failed';
      const ticketIdDisplay = ticket.xyneId || ticket.id;
      const message = `Workflow for ticket ${ticketIdDisplay} has ${isSuccess ? 'completed successfully' : 'failed'}.`;

      await this.createNotification(createdBy, {
        title,
        message,
        type: notificationType,
        relatedEntityType: 'workflow',
        relatedEntityId: workflowId,
        actionUrl: `/${ticket.workspaceId}/tickets/${ticket.id}`,
        metadata: {
          workflowId,
          ticketId: ticket.id,
          xyneId: ticket.xyneId,
          status
        }
      });
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
          msgType: 'SYSTEM',
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
          msgType: 'BOT',
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
        sessionId: sessionId ?? 'all',
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

    try {
      logger.info(`[NOTIFICATION-SERVICE] createNotification called`, {
        userId,
        notificationType: data.type,
        title: data.title,
        message: data.message,
        relatedEntityType: data.relatedEntityType,
        relatedEntityId: data.relatedEntityId,
        actionUrl: data.actionUrl,
        options: { sendDesktop, sendMobile }
      });

      // ─── MOBILE NOTIFICATIONS ───────────────────────────────────────────────
      if (sendMobile) {
        const hasActiveTokens = await fcmPushService.hasActiveTokens(userId);

        if (hasActiveTokens) {
          logger.info(`[NOTIFICATION-SERVICE] MOBILE SENT: User ${userId} | Type: ${data.type} | Title: "${data.title}"`);

          try {
            const sessions = await fcmPushService.getActiveSessionsWithTokens(userId);

            for (const session of sessions) {
              const deliveryMethod = session.platform === 'ios'
                ? NotificationDeliveryMethod.IOS
                : NotificationDeliveryMethod.ANDROID;

              if(!isSilent){
                const sessionNotification = await this.createSessionNotification(
                  userId,
                  data,
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
        logger.info(`[NOTIFICATION-SERVICE] DESKTOP SENT: User ${userId} | Type: ${data.type} | Title: "${data.title}"`);

        await realTimeNotificationService.sendNotification(
          userId,
          data.type,
          data.title,
          data.message,
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
    );

    logger.info(`[Notification] Filtered channel message recipients`, {
      original: recipientIds.length,
      desktopUsers: desktopUsers.length,
      mobileUsers: mobileUsers.length,
      channelId,
    });

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
      notificationContext
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

  /**
   * Send mention notifications for canvas mentions.
   * Mirrors message mention flow: when canvas is in a channel, use "You were mentioned in #channelName".
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
  ): Promise<{ deliveredUserIds: string[] }> {
    logger.info(`[NOTIFICATION-SERVICE] createCanvasMentionNotifications called`, {
      userIds,
      canvasId,
      canvasTitle,
      senderId,
      senderName,
      channelName,
    });

    const recipientIds = userIds.filter(id => id !== senderId);
    logger.info(`[NOTIFICATION-SERVICE] Filtered recipient IDs (excluding sender)`, {
      originalCount: userIds.length,
      recipientCount: recipientIds.length,
      recipientIds,
      senderId,
    });

    if (recipientIds.length === 0) {
      logger.info(`[NOTIFICATION-SERVICE] No recipients after filtering, skipping notification creation`);
      return { deliveredUserIds: [] };
    }

    getNotificationJobsExpected().add(recipientIds.length, { platform: 'desktop', message_type: 'channel' });

    // Mirror message mentions: "You were mentioned in #channelName" when canvas is in a channel
    const title = channelName
      ? `You were mentioned in #${channelName}`
      : `You were mentioned in ${canvasTitle}`;
    const message = channelName
      ? `${senderName} mentioned you in #${channelName}`
      : `${senderName} mentioned you in a canvas`;

    logger.info(`[NOTIFICATION-SERVICE] Creating ${recipientIds.length} canvas mention notifications`, {
      title,
      message,
      recipientIds,
    });

    const results = await Promise.allSettled(
      recipientIds.map(async userId => {
        const actionUrl = blockId
          ? `/${workspaceId}/chat/canvas/${canvasId}?blockId=${encodeURIComponent(blockId)}`
          : `/${workspaceId}/chat/canvas/${canvasId}`;
        const result = await this.createNotification(userId, {
          title,
          message,
          type: NotificationType.MENTION,
          relatedEntityType: 'canvas',
          relatedEntityId: canvasId,
          actionUrl,
          metadata: {
            canvasId,
            canvasTitle,
            senderId,
            senderName,
            workspaceId,
            ...(blockId ? { blockId } : {}),
          },
        });
        return { userId, deliveredViaApp: result.deliveredViaApp };
      })
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failureCount = results.filter(r => r.status === 'rejected').length;
    const deliveredUserIds = results
      .filter((r): r is PromiseFulfilledResult<{ userId: string; deliveredViaApp: boolean }> => r.status === 'fulfilled')
      .filter(r => r.value.deliveredViaApp)
      .map(r => r.value.userId);

    logger.info(`[NOTIFICATION-SERVICE] Canvas mention notification creation completed`, {
      total: recipientIds.length,
      success: successCount,
      failures: failureCount,
      deliveredViaApp: deliveredUserIds.length,
      results: results.map((r, idx) => ({
        userId: recipientIds[idx],
        status: r.status,
        error: r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : undefined,
      })),
    });

    return { deliveredUserIds };
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
      'thread_reply'
    );

    logger.info(`[Notification] Filtered thread reply recipients`, {
      original: recipientIds.length,
      desktopUsers: desktopUsers.length,
      mobileUsers: mobileUsers.length,
      channelId,
    });

    const notificationData = {
      title: isDMChannel ? `New reply in #${channelName}` : `New reply from #${channelName}`,
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
    isDMChannel: boolean = true,
    senderPicture: string = '',
    channelName?: string,
  ): Promise<{ deliveredUserIds: string[] }> {
    if (recipientIds.length === 0) return { deliveredUserIds: [] };

    getNotificationJobsExpected().add(recipientIds.length, { platform: 'desktop', message_type: 'dm' });
    // For DM channels, only apply device filter (skips pause and notification level checks)
    const { desktopUsers, mobileUsers } = await notificationFilterService.filterUsers(
      recipientIds,
      channelId,
      isDMChannel
    );

    logger.info(`[Notification] Filtered DM recipients`, {
      original: recipientIds.length,
      desktopUsers: desktopUsers.length,
      mobileUsers: mobileUsers.length,
      channelId,
    });

    const notificationData = {
      title: channelName ? `${channelName}` : `New Message from ${senderName}`,
      message: cleanContent.substring(0, 100) + (cleanContent.length > 100 ? '...' : ''),
      type: NotificationType.DIRECT_MESSAGE,
      relatedEntityType: 'message' as const,
      relatedEntityId: conversationId,
      actionUrl: `/${workspaceId}/chat/dm/${channelId}#origin=${conversationId}&messageId=${messageId}`,
      metadata: {
        senderId,
        senderName,
        senderPicture,
        channelId,
        conversationId,
        messageId,
        scopeType
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

      await Promise.allSettled(
        sessions.map(async (session) => {
          // Determine specific delivery method based on platform
          const deliveryMethod = session.platform === 'ios'
            ? NotificationDeliveryMethod.IOS
            : NotificationDeliveryMethod.ANDROID;

          // Create individual tracking entry for this session
          const sessionNotification = await this.createSessionNotification(
            userId,
            data,
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
            logger.error('Failed to queue mobile push notification for session ', session.id, reason);
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

    // Broadcast real-time update
    await websocketService.broadcastNotificationUpdate(userId, notificationId, 'READ');
  }

  async dismiss(notificationId: string, userId: string): Promise<void> {
    await repositories.notifications.dismiss(notificationId, userId);

    // Broadcast real-time update
    await websocketService.broadcastNotificationUpdate(userId, notificationId, 'DISMISSED');
  }

  async markAllAsRead(userId: string): Promise<void> {
    // First, check what notifications exist before update
    const beforeCount = await repositories.notifications.countByUserId(userId, 'UNREAD');

    logger.info(`markAllAsRead: Found ${beforeCount} UNREAD notifications for user ${userId}`);

    await repositories.notifications.markAllAsRead(userId);

    logger.info(`markAllAsRead: Updated ${beforeCount} notifications to READ for user ${userId}`);

    // Broadcast real-time update to all user's connections if any notifications were updated
    if (beforeCount > 0) {
      logger.info(`markAllAsRead: Broadcasting WebSocket update for user ${userId}`);
      await websocketService.broadcastNotificationUpdate(userId, 'all', 'READ');
    }

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
    // Step 1: Get all active users for this member across workspaces
    const users = await prisma.user.findMany({
      where: {
        orgMemberId: memberId,
        leftAt: null,
        status: 'ACTIVE',
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
        status: { in: ['UNREAD', 'DELIVERED'] },
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
  }

  async getUserPreferences(userId: string): Promise<UserPreferences> {
    const preferences = await repositories.notificationPreferences.findByUserId(userId);

    // Default preferences for all notification types
    const defaultPrefs: UserPreferences = {
      TICKET_STATUS_CHANGE: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      TICKET_ASSIGNMENT: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      TICKET_REASSIGNMENT: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
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
        },
      });
      if (!ticket) {
        logger.warn(`Ticket not found: ${ticketId}`);
        return;
      }

      const actionUrl = ticket.channelId && ticket.conversationId
        ? `/${ticket.workspaceId}/chat/dir/${ticket.channelId}?tab=tickets&ticketId=${ticketId}&conversationId=${ticket.conversationId}`
        : `/${ticket.workspaceId}/tickets?tickets=${ticketId}`;

      await this.createNotification(assignedTo, {
        title: 'Ticket Assigned',
        message: `You have been assigned to ticket "${ticket.title}"`,
        type: 'TICKET_ASSIGNMENT',
        relatedEntityType: 'ticket',
        relatedEntityId: ticketId,
        actionUrl,
        metadata: {
          ticketId,
          assignedBy,
          channelId: ticket.channelId,
          conversationId: ticket.conversationId,
        },
      });
    } catch (error) {
      logger.error('Failed to send ticket assignment notification:', error);
    }
  }

  async getStats(): Promise<any> {
    return await realTimeNotificationService.getStats();
  }
}

export const notificationService = new NotificationService();
