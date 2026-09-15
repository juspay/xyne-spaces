import { BaseSideEffectHandler } from '../base-handler';
import { ActivityClassification, TicketStatusV2 } from '@xyne/shared';
import type { SideEffectJobConfig, TicketPreviousValue } from '../types';
import { db } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { buildKanbanCountsSnapshot } from '@/services/tickets/kanbanCountsSnapshotService';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { userActivityTrackingService } from '@/services/userActivityTrackingService';
import { websocketService } from '@/services/websocketService';
import { maybeCreateEntryApprovalRequest } from '@/services/stageTransition/stageEntryApproval';
import { getFormFieldUserActors } from '@/utils/ticketActorUtils';
import {
  dispatchEtaNotifications,
  drainEtaActivityOutbox,
  drainedOutboxTimestamp,
  etaSystemMessageContent,
  etaSignalsFromMetadataDiff,
  writeEtaActivitiesPrisma,
} from '@/services/etaManagement';

import {
  emitTicketUpdated,
  TicketUpdatedFieldSchema,
  type TicketChanges,
  type TicketUpdatedField,
} from '@/automations/triggers/ticket-updated.trigger';
import { logger } from '@/utils/logger';
import type { TicketLike } from '@/automations/triggers/ticket-context';

const TICKET_UPDATED_FIELDS: ReadonlyArray<TicketUpdatedField> = TicketUpdatedFieldSchema.options;

interface TicketActivity {
  activityType: string;
  value: {
    oldValue: any;
    newValue: any;
  };
}

async function fetchTicketActors(ticketId: string): Promise<string[]> {
  const [roleAssignments, formFieldUserActors] = await Promise.all([
    db.ticketAssignment.findMany({
      where: { ticketId },
      select: { userId: true },
    }),
    getFormFieldUserActors(ticketId),
  ]);

  return roleAssignments.map(a => a.userId).filter((id): id is string => Boolean(id)).concat(formFieldUserActors);
}

export class TicketsSideEffectHandler extends BaseSideEffectHandler {
  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const { entityId: ticketId, args, previousValue } = job;

    if (!previousValue) {
      logger.warn(`[TicketsSideEffectHandler] No previousValue for ticket ${ticketId}`);
      return;
    }

    const prev = previousValue as TicketPreviousValue;
    const actorId = this.ctx.userID;

    // Detect field changes and build activities
    const activities: TicketActivity[] = [];
    const changedFields: string[] = [];
    const fieldMap: Record<string, string> = {
      stageName: 'STATUS',
      statusV2: 'STATUS_V2',
      priority: 'PRIORITY',
      eta: 'ETA',
      assignedTo: 'ASSIGNED',
      boardId: 'BOARD',
      userGroupId: 'USER_GROUP',
      title: 'TITLE',
      description: 'DESCRIPTION',
    };

    for (const [field, activityType] of Object.entries(fieldMap)) {
      const newValue = args[field];
      const prevValue = (prev as unknown as Record<string, any>)[field];
      if (newValue !== undefined && newValue !== prevValue) {
        activities.push({
          activityType,
          value: {
            oldValue: prevValue,
            newValue,
          },
        });
        changedFields.push(field);
      }
    }

    if (changedFields.length > 0) {
      void userActivityTrackingService.trackTicketUpdated(actorId, {
        ticketId,
        fields: changedFields,
        boardId: args.boardId || prev.boardId || undefined,
      }).catch(error => {
        logger.error('[UserActivityTracking] Failed to track ticket updated activity:', {
          ticketId,
          error: error,
        });
      });
    }

    const changes: TicketChanges = {};
    for (const field of TICKET_UPDATED_FIELDS) {
      const next = args[field];
      const previous = (prev as unknown as Record<string, unknown>)[field];
      if (next !== undefined && next !== previous) {
        changes[field] = {
          previousValue: (previous as string | number | null | undefined) ?? null,
          newValue: (next as string | number | null | undefined) ?? null,
        };
      }
    }
    if (Object.keys(changes).length > 0) {
      const fullTicket = await db.ticket.findUnique({ where: { id: ticketId } });
      if (fullTicket) {
        void emitTicketUpdated({ ticket: fullTicket as TicketLike, changes, performedById: actorId });
        const snapshot = (await buildKanbanCountsSnapshot(ticketId)) ?? {
          id: fullTicket.id,
          workspaceId: fullTicket.workspaceId,
          boardId: fullTicket.boardId,
          projectId: fullTicket.projectId,
          stageName: fullTicket.stageName,
          statusV2: fullTicket.statusV2,
          priority: fullTicket.priority,
          assignedTo: fullTicket.assignedTo,
          createdBy: fullTicket.createdBy,
          userGroupId: fullTicket.userGroupId,
          ticketType: fullTicket.ticketType,
          isStageOverdue: Boolean((fullTicket as typeof fullTicket & { isStageOverdue?: boolean | null }).isStageOverdue),
          eta: fullTicket.eta?.getTime() ?? null,
          createdAt: fullTicket.createdAt.getTime(),
          tags: [],
          prReviewers: [],
          qaAssigned: [],
          roleAssignments: [],
          formFieldValues: {},
        };
        websocketService.broadcastTicketCountsUpdate({
          operation: 'update',
          ticket: snapshot,
          previousTicket: {
            ...snapshot,
            stageName: prev.stageName,
            statusV2: prev.statusV2,
            priority: prev.priority,
            assignedTo: prev.assignedTo,
          },
        });
      }
    }

    // Send notification to the newly assigned user (original behavior preserved)
    const assignedToChanged = args.assignedTo !== undefined && args.assignedTo !== prev.assignedTo;
    const newAssignee = args.assignedTo;

    if (assignedToChanged && newAssignee && newAssignee !== actorId) {
      try {
        await notificationService.sendTicketAssignmentNotification(ticketId, newAssignee, actorId);
        logger.info(`[TicketsSideEffectHandler] Sent ticket assignment notification for ticket ${ticketId} to user ${newAssignee}`);
      } catch (error) {
        logger.error(`[TicketsSideEffectHandler] Failed to send ticket assignment notification:`, error);
      }
    }

    // Check for notifiable changes
    const stageNameChanged = args.stageName !== undefined && args.stageName !== prev.stageName;
    const priorityChanged = args.priority !== undefined && args.priority !== prev.priority;
    const etaChanged = args.eta !== undefined && args.eta !== prev.eta;
    const userGroupChanged = args.userGroupId !== undefined && args.userGroupId !== prev.userGroupId;
    const titleChanged = args.title !== undefined && args.title !== prev.title;
    const descriptionChanged = args.description !== undefined && args.description !== prev.description;

    const hasNotifiableChange = assignedToChanged || stageNameChanged || priorityChanged || etaChanged || userGroupChanged || titleChanged || descriptionChanged;

    // On-entry auto-approval: when a ticket enters a new stage via a Zero mutation
    // (drag/move, or an approval completing and advancing the ticket to the next
    // stage), auto-create the approval request for that stage's single outgoing
    // transition if it's configured for on-entry approval. Runs purely on the
    // stage change — independent of notification recipients below. Side effects
    // execute post-commit, so the ticket's new stageName is already persisted.
    // Fire-and-forget: best-effort and self-contained (swallows its own errors),
    // so awaiting would only delay the side-effect worker.
    if (stageNameChanged && args.stageName) {
      void maybeCreateEntryApprovalRequest(ticketId, actorId, args.stageName);
    }

    // Fetch ticket details for notifications and activities
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        xyneId: true,
        title: true,
        channelId: true,
        conversationId: true,
        workspaceId: true,
        createdBy: true,
        assignedTo: true,
        userGroupId: true,
        boardId: true,
        eta: true,
        statusV2: true,
        metadata: true,
      },
    });

    if (!ticket) {
      logger.warn(`[TicketsSideEffectHandler] Ticket ${ticketId} not found`);
      return;
    }

    try {
      const etaIntents = drainEtaActivityOutbox({
        previousMetadata: prev.metadata,
        currentMetadata: args.metadata,
      });
      if (etaIntents.length > 0) {
        const messageActorIds = [
          ...new Set(etaIntents.map(i => i.actorId).filter((id): id is string => !!id)),
        ];
        const messageActors = messageActorIds.length
          ? await db.user.findMany({
              where: { id: { in: messageActorIds } },
              select: { id: true, name: true, displayName: true },
            })
          : [];
        const actorNames = new Map(
          messageActors.map(u => [u.id, u.displayName || u.name || 'Someone']),
        );

        const intentsWithMessages = etaIntents.map(intent => {
          const actorName = intent.actorId ? actorNames.get(intent.actorId) : undefined;
          const content = actorName ? etaSystemMessageContent(intent, actorName) : null;
          return content ? { ...intent, systemMessageContent: content } : intent;
        });

        await writeEtaActivitiesPrisma(db, intentsWithMessages, {
          ticketId,
          workspaceId: ticket.workspaceId,
          channelId: ticket.channelId,
          conversationId: ticket.conversationId,
          timestamp: drainedOutboxTimestamp(args.metadata) ?? Date.now(),
        });
      }
    } catch (error) {
      logger.error(`[TicketsSideEffectHandler] Failed to write staged ETA activities:`, error);
    }

    // ETA planning-risk alerts. Driven off the committed before-vs-after state rather
    // than the in-transaction evaluation result, so one place covers every Zero mutator
    // that writes a ticket (ticket.update, nonLinear.transition, ticketStageEta.update).
    // The Prisma write paths own their own post-commit dispatch - they never reach here.
    //
    // Diffed against THIS job's own `args.metadata`, never the re-fetched `ticket.metadata`
    // - same reason as the outbox drain above: one logical mutation can emit several
    // `tickets.update` jobs (board transfer does), and `ticket.metadata` is the FINAL state
    // for all of them. Using it as "current" for every job made every job whose own prev
    // predated the risk-detecting write compute an identical "risk just appeared" diff
    // against that same final state - not idempotent, a genuine duplicate alert per extra
    // job. Gating on `args.metadata !== undefined` means only the one job that actually
    // carried the metadata write evaluates a diff at all; jobs that only touched
    // stageName/kanbanPosition/boardId etc. skip this block entirely.
    //
    // Deliberately drops the `newEta` signal: a due-date change is already notified by
    // the generic `etaChanged` branch below, to the same awareness recipient set. Only
    // the risk alert (which goes to the narrower "action recipients" set) is new here.
    //
    // Suppressed while paused - risk state stays visible, just labeled paused. Mirrors
    // the guard in stageEtaDeadlineWorker.ts's reconciliation pass.
    if (ticket.statusV2 !== TicketStatusV2.PAUSED && args.metadata !== undefined) {
      try {
        const { riskAlert } = etaSignalsFromMetadataDiff({
          previousMetadata: prev.metadata,
          currentMetadata: args.metadata,
          previousEta: prev.eta,
          currentEta: ticket.eta?.getTime() ?? null,
        });
        await dispatchEtaNotifications(
          { riskAlert, newEta: null },
          {
            ticketId,
            createdBy: ticket.createdBy,
            assignedTo: ticket.assignedTo,
            ticketUserGroupId: ticket.userGroupId,
            boardId: ticket.boardId,
            actorId,
          },
        );
      } catch (error) {
        logger.error(`[TicketsSideEffectHandler] Failed to dispatch ETA planning-risk notification:`, error);
      }
    }

    // Fetch all role assignments (manager, team lead, dev, qa, pr reviewer, etc.)
    // and board form field users of type USER
    const extraActors = await fetchTicketActors(ticketId);

    // All actors: creator, old/new assignee, role holders, and form field users
    const allActorIds = [
      prev.createdBy,
      prev.assignedTo,
      args.assignedTo,
      ...extraActors,
    ].filter((id, index, arr): id is string => Boolean(id) && arr.indexOf(id) === index);

    // Fetch subscribed conversation participants for activities
    let subscribedParticipants: string[] = [];
    if (ticket.conversationId) {
      try {
        // Fans out to every subscriber, so it runs above the caller's own scope.
        const participants = await withWorkspaceScope(() =>
          db.conversationParticipant.findMany({
            where: {
              conversationId: ticket.conversationId,
              isSubscribed: true,
            },
            select: { userId: true },
          }),
        );
        subscribedParticipants = participants.map(p => p.userId);
      } catch (error) {
        logger.warn(`[TicketsSideEffectHandler] Failed to fetch conversation participants for ticket ${ticketId}:`, error);
      }
    }

    // Activity recipients: subscribed participants + all actors, excluding the actor
    const activityRecipients = [
      ...subscribedParticipants,
      ...allActorIds,
    ].filter((id, index, arr) => arr.indexOf(id) === index && id !== actorId);

    // Send group notifications for specific changes
    if (hasNotifiableChange && allActorIds.length > 0) {
      try {
        const notificationRecipients = allActorIds.filter(id => id !== actorId);

        if (assignedToChanged) {
          const oldAssigneeId = prev.assignedTo;
          const newAssigneeId = args.assignedTo;

          const users = await db.user.findMany({
            where: {
              id: {
                in: [oldAssigneeId, newAssigneeId].filter(Boolean) as string[],
              },
            },
            select: { id: true, name: true, displayName: true },
          });

          const userNameMap = new Map(users.map(u => [u.id, u.displayName || u.name || 'Unknown']));
          const oldAssigneeName = oldAssigneeId ? userNameMap.get(oldAssigneeId) || 'Unassigned' : 'Unassigned';
          const newAssigneeName = newAssigneeId ? userNameMap.get(newAssigneeId) || 'Unassigned' : 'Unassigned';

          await notificationService.sendTicketReassignmentNotification(
            ticketId,
            notificationRecipients,
            oldAssigneeName,
            newAssigneeName,
            actorId,
          );
          logger.info(`[TicketsSideEffectHandler] Sent reassignment notification for ticket ${ticketId} to users: ${notificationRecipients.join(', ')}`);
        }

        if (stageNameChanged) {
          await notificationService.sendTicketStatusChangeNotification(
            ticketId,
            notificationRecipients,
            args.stageName as string,
            actorId,
            ticket.xyneId || ticketId,
          );
          logger.info(`[TicketsSideEffectHandler] Sent status change notification for ticket ${ticketId} to users: ${notificationRecipients.join(', ')}`);
        }

        if (priorityChanged) {
          await notificationService.sendTicketPriorityChangeNotification(
            ticketId,
            notificationRecipients,
            prev.priority || 'None',
            args.priority as string,
            actorId,
          );
          logger.info(`[TicketsSideEffectHandler] Sent priority change notification for ticket ${ticketId} to users: ${notificationRecipients.join(', ')}`);
        }

        // No notifications while paused. This is a plain field diff (fires for ANY eta
        // write), and moving into a paused stage is itself a stage entry, which can
        // trigger an automatic forecast extension - without this guard that extension
        // would notify even though the ticket is being paused, not worked.
        if (etaChanged && args.eta !== undefined && ticket.statusV2 !== TicketStatusV2.PAUSED) {
          const formattedDate = new Date(args.eta).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
          });

          await notificationService.sendTicketDueDateChangedNotification(
            ticketId,
            notificationRecipients,
            formattedDate,
            actorId,
          );
          logger.info(`[TicketsSideEffectHandler] Sent due date change notification for ticket ${ticketId} to users: ${notificationRecipients.join(', ')}`);
        }

        if (userGroupChanged) {
          await notificationService.sendTicketUserGroupChangeNotification(
            ticketId,
            notificationRecipients,
            args.userGroupId as string,
            actorId,
          );
          logger.info(`[TicketsSideEffectHandler] Sent user group change notification for ticket ${ticketId} to users: ${notificationRecipients.join(', ')}`);
        }

        if (titleChanged) {
          await notificationService.sendTicketTitleChangeNotification(
            ticketId,
            notificationRecipients,
            args.title as string,
            actorId,
          );
          logger.info(`[TicketsSideEffectHandler] Sent title change notification for ticket ${ticketId} to users: ${notificationRecipients.join(', ')}`);
        }

        if (descriptionChanged) {
          await notificationService.sendTicketDescriptionChangeNotification(
            ticketId,
            notificationRecipients,
            actorId,
          );
          logger.info(`[TicketsSideEffectHandler] Sent description change notification for ticket ${ticketId} to users: ${notificationRecipients.join(', ')}`);
        }
      } catch (error) {
        logger.error(`[TicketsSideEffectHandler] Failed to send group notifications:`, error);
      }
    }

    // Create activities for ALL changes (including title/description/board/userGroup)
    const relevantActivities = activities.filter(a =>
      ['STATUS', 'STATUS_V2', 'PRIORITY', 'ETA', 'BOARD', 'ASSIGNED', 'USER_GROUP', 'TITLE', 'DESCRIPTION'].includes(a.activityType)
    );

    if (activityRecipients.length === 0 || relevantActivities.length === 0) {
      return;
    }

    try {
      for (const activity of relevantActivities) {
        const actorAction = `ticket_${activity.activityType.toLowerCase()}`;

        logger.info(`[TicketsSideEffectHandler] Creating activity: ${actorAction} for users: ${activityRecipients.join(', ')}`);

        await Promise.all(
          activityRecipients.map(userId =>
            activityService.createActivity({
              userId,
              actorAction,
              actionSource: 'ticket',
              actionSourceId: ticketId,
              ticketId,
              channelId: ticket.channelId || undefined,
              actorId,
              classification: ActivityClassification.ACTIONABLE,
            })
          )
        );
      }

      logger.info(`[TicketsSideEffectHandler] Created activities for ticket ${ticketId} for users: ${activityRecipients.join(', ')}`);
    } catch (error) {
      logger.error(`[TicketsSideEffectHandler] Failed to create activities:`, error);
    }
  }

  /**
   * Helper function to create ETA breach activities (overall ETA or stage ETA).
   * Can be called from outside (e.g., etaDeadlineQueue, stageEtaDeadlineQueue) to create activities.
   * This is a static method - does not use side effect context.
   */
  static async createEtaBreachActivities(params: {
    ticketId: string;
    xyneId: string;
    channelId: string;
    userIds: string[];
    actorAction: 'eta_breach' | 'stage_eta_breach';
    actorId?: string;
    stageName?: string;
    daysOverdue?: number;
  }): Promise<void> {
    const { ticketId, xyneId, channelId, userIds, actorAction, actorId = 'system', stageName, daysOverdue } = params;

    if (userIds.length === 0) {
      return;
    }

    try {
      // Create activities for each user
      const activityPromises = userIds.map(userId =>
        activityService.createActivity({
          userId,
          actorAction,
          actionSource: 'ticket',
          actionSourceId: ticketId,
          ticketId: ticketId,
          channelId: channelId || undefined,
          actorId,
          classification: ActivityClassification.ACTIONABLE,
        })
      );

      await Promise.all(activityPromises);

      logger.info(
        `[TicketsSideEffectHandler] Created ${userIds.length} ${actorAction} activities for ticket ${xyneId}` +
        `${stageName ? ` (stage: ${stageName})` : ''}` +
        `${daysOverdue !== undefined ? ` (${daysOverdue} days overdue)` : ''}`
      );
    } catch (error) {
      logger.error(`[TicketsSideEffectHandler] Failed to create ${actorAction} activities:`, error);
      throw error;
    }
  }

  /**
   * Create Zero-side notification activities when a ticket is merged into another.
   * Called from ticketController.mergeTicket after the Prisma transaction commits.
   * This is a static method - does not use side effect context.
   */
  static async handleTicketMerged(params: {
    sourceTicketId: string;
    targetTicketId: string;
    sourceXyneId: string;
    targetXyneId: string;
    sourceTitle: string;
    targetTitle: string;
    actorId: string;
    channelId: string | null;
  }): Promise<void> {
    const {
      sourceTicketId,
      targetTicketId,
      sourceXyneId,
      targetXyneId,
      sourceTitle,
      targetTitle,
      actorId,
      channelId,
    } = params;

    try {
      // Create both activities in parallel (same pattern as createEtaBreachActivities)
      await Promise.all([
        activityService.createActivity({
          userId: actorId,
          actorAction: 'ticket_merged',
          actionSource: 'ticket',
          actionSourceId: sourceTicketId,
          ticketId: sourceTicketId,
          channelId: channelId || undefined,
          actorId,
          classification: ActivityClassification.ACTIONABLE,
        }),
        activityService.createActivity({
          userId: actorId,
          actorAction: 'ticket_merged_target',
          actionSource: 'ticket',
          actionSourceId: targetTicketId,
          ticketId: targetTicketId,
          channelId: channelId || undefined,
          actorId,
          classification: ActivityClassification.ACTIONABLE,
        }),
      ]);

      logger.info(
        `[TicketsSideEffectHandler] Created merge activities: ${sourceXyneId} (${sourceTitle}) → ${targetXyneId} (${targetTitle})`
      );
    } catch (error) {
      logger.error(`[TicketsSideEffectHandler] Failed to create merge activities:`, error);
      // Don't throw — merge succeeded in DB; notification failure is non-critical
    }
  }

  /**
   * Create Zero-side notification activities when a ticket is unmerged.
   * Called from ticketController.unmergeTicket after the Prisma transaction commits.
   * This is a static method - does not use side effect context.
   */
  static async handleTicketUnmerged(params: {
    sourceTicketId: string;
    targetTicketId: string;
    sourceXyneId: string;
    targetXyneId: string;
    sourceTitle: string;
    targetTitle: string;
    actorId: string;
    channelId: string | null;
  }): Promise<void> {
    const {
      sourceTicketId,
      targetTicketId,
      sourceXyneId,
      targetXyneId,
      sourceTitle,
      targetTitle,
      actorId,
      channelId,
    } = params;

    try {
      // Create both activities in parallel (same pattern as createEtaBreachActivities)
      await Promise.all([
        activityService.createActivity({
          userId: actorId,
          actorAction: 'ticket_unmerged',
          actionSource: 'ticket',
          actionSourceId: sourceTicketId,
          ticketId: sourceTicketId,
          channelId: channelId || undefined,
          actorId,
          classification: ActivityClassification.ACTIONABLE,
        }),
        activityService.createActivity({
          userId: actorId,
          actorAction: 'ticket_unmerged_target',
          actionSource: 'ticket',
          actionSourceId: targetTicketId,
          ticketId: targetTicketId,
          channelId: channelId || undefined,
          actorId,
          classification: ActivityClassification.ACTIONABLE,
        }),
      ]);

      logger.info(
        `[TicketsSideEffectHandler] Created unmerge activities: ${sourceXyneId} (${sourceTitle}) restored from ${targetXyneId} (${targetTitle})`
      );
    } catch (error) {
      logger.error(`[TicketsSideEffectHandler] Failed to create unmerge activities:`, error);
      // Don't throw — unmerge succeeded in DB; notification failure is non-critical
    }
  }
}
