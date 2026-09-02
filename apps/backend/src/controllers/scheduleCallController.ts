import { Request, Response } from 'express';
import { repositories } from '@/database/repositories';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { type Prisma } from '@prisma/client';
import { CallOrigin, CallStatus, CallType, RecurringCallSeriesStatus, CalendarVisibility, ChannelScopeType } from '@xyne/shared';
import { ZodError } from 'zod';
import { scheduledCallNotificationService } from '@/services/scheduledCallNotificationService';
import { ScheduleCallSchema, RecurringScheduleCallSchema, UpdateScheduleCallSchema, UpdateRecurringSeriesSchema, CancelScheduledCallSchema, CancelRecurringSeriesSchema } from '@/validators/callValidator';
import { recurringCallService } from '@/services/recurringCallService';
import { addHHMMDuration } from '@/utils/dateUtils';
import { findNewEmails, normalizeEmailList } from '@/utils/email';
import { deriveEndsOnFromRRule } from '@/utils/recurrenceUtils';
import {
  type CallInvitationParams,
  sendCallInvitationEmail,
  sendCallInvitationReply,
} from '@/services/callInvitationEmailService';
import { CallVespaFeedSource, queueCallVespaFeed } from '@/services/callVespaQueue';
import { buildCallInviteUrl } from '@/utils/urlUtils';

// Number of milliseconds to buffer recurring call instances ahead of time (60 days)
const INSTANCE_BUFFER_DAYS = 60 * 24 * 60 * 60 * 1000;

type ExternalInvitationDelivery = 'standalone' | 'conversation_reply';

function defaultCallInvitation(timezone?: string | null): CallInvitationParams['invitation'] {
  return {
    bodyHtml: "<p>You've been invited to a call. Details below.</p>",
    ...(timezone && { timezone }),
  };
}

export class ScheduleCallController {
  private sendExternalInvitationInBackground(params: {
    invitationParams: CallInvitationParams;
    delivery?: ExternalInvitationDelivery;
    conversationId?: string;
    context: string;
  }): void {
    const { invitationParams, delivery, conversationId, context } = params;

    setImmediate(() => {
      void (async () => {
        try {
          if (delivery === 'conversation_reply' && conversationId) {
            await sendCallInvitationReply({
              ...invitationParams,
              conversationId,
            });
          } else {
            await sendCallInvitationEmail(invitationParams);
          }
        } catch (error) {
          logger.error(
            `[${context}] Failed to send external call invitation in background | callExternalId=${invitationParams.externalId} invitees=${invitationParams.externalInvitees.join(', ')} error=${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })();
    });
  }

  /**
   * Compute the participant add/remove delta for a call.
   * - If `targetUserIds` is provided, use it as the desired final set.
   * - Otherwise fetch the members of `newChannelId` as the desired final set.
   * The organizer (`organizerId`) is always kept in the set.
   * Returns { addUserIds, removeUserIds } relative to the call's current participants.
   */
  private async resolveParticipantDelta(
    callId: string,
    organizerId: string,
    targetUserIds: string[] | undefined,
    newChannelId: string,
    logPrefix: string,
  ): Promise<{ addUserIds: string[]; removeUserIds: string[] }> {
    let effectiveTargetUserIds: string[];
    if (targetUserIds !== undefined) {
      effectiveTargetUserIds = targetUserIds;
    } else {
      const newChannelParticipants = await repositories.channelParticipants.getChannelParticipants(newChannelId);
      effectiveTargetUserIds = newChannelParticipants.map((p) => p.userId);
      logger.info(`${logPrefix} channel changed — using ${effectiveTargetUserIds.length} participants from channel ${newChannelId}`);
    }

    const currentParticipants = await repositories.calls.findParticipants(callId);
    const currentUserIds = new Set(currentParticipants.map((p) => p.userId));
    // Always keep the organizer in the participant set
    const newUserIds = new Set([...effectiveTargetUserIds, organizerId]);

    const addUserIds = [...newUserIds].filter((id) => !currentUserIds.has(id));
    const removeUserIds = [...currentUserIds].filter((id) => !newUserIds.has(id));
    logger.info(`${logPrefix} participant delta | add=${JSON.stringify(addUserIds)} remove=${JSON.stringify(removeUserIds)}`);

    return { addUserIds, removeUserIds };
  }

  /**
   * Decide what `userId` may change on `call`:
   *   - organizer                                    → every field
   *   - participant of a direct (DM/GROUP_DM) call   → may only change the invite list:
   *     add anyone, and remove only the people they themselves invited
   *   - anyone else                                  → nothing
   * On success returns the participants that must survive the edit: empty for the
   * organizer, and for a participant editor everyone they did NOT invite, so a missing id
   * in their `targetUserIds` can only ever remove their own invitees.
   */
  private async authorizeScheduledCallEdit(params: {
    call: { id: string; channelId: string | null; createdByUserId: string };
    userId: string;
    edits: {
      title?: unknown;
      startsAt?: unknown;
      endsAt?: unknown;
      channelId?: unknown;
      callUpdatesChannel?: unknown;
      externalInvitees?: unknown;
      targetUserIds?: string[] | undefined;
    };
  }): Promise<
    { allowed: true; pinnedParticipantIds: string[] } | { allowed: false; status: number; error: string }
  > {
    const { call, userId, edits } = params;

    if (call.createdByUserId === userId) {
      return { allowed: true, pinnedParticipantIds: [] };
    }

    // Read the scope via getScopeType, not findById: the channel behind a large group call
    // is the organizer's self-DM, which this caller isn't a member of, so the per-user
    // channel ACL would hide it and every non-organizer edit would 403.
    const channelScopeType = call.channelId
      ? await repositories.channels.getScopeType(call.channelId)
      : null;
    const isDirectCall =
      channelScopeType === ChannelScopeType.DM || channelScopeType === ChannelScopeType.GROUP_DM;
    const isParticipant = !!(await repositories.calls.findParticipant(call.id, userId));

    // Calls scoped to a real channel stay organizer-only: their invite list is the channel's.
    if (!isDirectCall || !isParticipant) {
      logger.warn(
        `[authorizeScheduledCallEdit] forbidden | callId=${call.id} userId=${userId} channelScopeType=${channelScopeType} isParticipant=${isParticipant}`,
      );
      return { allowed: false, status: 403, error: 'Only the organizer can edit a scheduled call' };
    }

    const editsBeyondParticipants =
      edits.title !== undefined ||
      edits.startsAt !== undefined ||
      edits.endsAt !== undefined ||
      edits.channelId !== undefined ||
      edits.callUpdatesChannel !== undefined ||
      edits.externalInvitees !== undefined;

    if (editsBeyondParticipants || edits.targetUserIds === undefined) {
      return {
        allowed: false,
        status: 403,
        error: 'Participants can only change who is invited to this call',
      };
    }

    // Pin everyone this editor did not invite — they may drop their own invitees, but
    // nobody else's. findParticipants already excludes external invitees.
    const pinnedParticipantIds = (await repositories.calls.findParticipants(call.id))
      .filter((p) => p.invitedBy !== userId)
      .map((p) => p.userId);
    return { allowed: true, pinnedParticipantIds };
  }

  /**
   * Series counterpart of `authorizeScheduledCallEdit` — same rule, one level up:
   *   - organizer                                       → every field
   *   - participant of a direct (DM/GROUP_DM) series     → may only change the invite list:
   *     add anyone, and remove only the people they themselves invited
   *   - anyone else                                     → nothing
   * Returns the participants that must survive the edit: empty for the organizer, and for a
   * participant editor everyone they did NOT invite.
   */
  private async authorizeRecurringSeriesEdit(params: {
    series: { id: string; channelId: string; organizerId: string };
    userId: string;
    edits: {
      title?: unknown;
      recurrenceRule?: unknown;
      startTime?: unknown;
      endTime?: unknown;
      startsOn?: unknown;
      endsOn?: unknown;
      timezone?: unknown;
      channelId?: unknown;
      callUpdatesChannel?: unknown;
      externalInvitees?: unknown;
      targetUserIds?: string[] | undefined;
    };
  }): Promise<
    { allowed: true; pinnedParticipantIds: string[] } | { allowed: false; status: number; error: string }
  > {
    const { series, userId, edits } = params;

    if (series.organizerId === userId) {
      return { allowed: true, pinnedParticipantIds: [] };
    }

    // getScopeType, not findById — see authorizeScheduledCallEdit for why the ACL can't be used.
    const channelScopeType = await repositories.channels.getScopeType(series.channelId);
    const isDirectCall =
      channelScopeType === ChannelScopeType.DM || channelScopeType === ChannelScopeType.GROUP_DM;
    const seriesParticipants = await repositories.recurringCallParticipants.findInternalParticipants(
      series.id,
    );
    const isParticipant = seriesParticipants.some((p) => p.userId === userId);

    if (!isDirectCall || !isParticipant) {
      logger.warn(
        `[authorizeRecurringSeriesEdit] forbidden | seriesId=${series.id} userId=${userId} channelScopeType=${channelScopeType} isParticipant=${isParticipant}`,
      );
      return { allowed: false, status: 403, error: 'Only the organizer can edit this series' };
    }

    const editsBeyondParticipants =
      edits.title !== undefined ||
      edits.recurrenceRule !== undefined ||
      edits.startTime !== undefined ||
      edits.endTime !== undefined ||
      edits.startsOn !== undefined ||
      edits.endsOn !== undefined ||
      edits.timezone !== undefined ||
      edits.channelId !== undefined ||
      edits.callUpdatesChannel !== undefined ||
      edits.externalInvitees !== undefined;

    if (editsBeyondParticipants || edits.targetUserIds === undefined) {
      return {
        allowed: false,
        status: 403,
        error: 'Participants can only change who is invited to this series',
      };
    }

    const pinnedParticipantIds = seriesParticipants
      .filter((p) => p.invitedBy !== userId)
      .map((p) => p.userId);
    return { allowed: true, pinnedParticipantIds };
  }

  private async resolveRecurringInternalParticipantUserIds(params: {
    targetUserIds: string[] | undefined;
    channelId: string;
    logPrefix: string;
  }): Promise<string[]> {
    const { targetUserIds, channelId, logPrefix } = params;

    if (targetUserIds !== undefined) {
      return targetUserIds;
    }

    const channelParticipants = await repositories.channelParticipants.getChannelParticipants(channelId);
    const participantUserIds = channelParticipants.map((p) => p.userId);
    logger.info(`${logPrefix} materializing ${participantUserIds.length} participants from channel ${channelId}`);
    return participantUserIds;
  }

  // POST /api/calls/series - Create a recurring call series
  createRecurringSeries = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const {
        title,
        description,
        channelId,
        targetUserIds,
        callUpdatesChannel: reqCallUpdatesChannel,
        timezone,
        recurrenceRule,
        startTime,
        endTime,
        startsOn,
        endsOn,
        externalInvitees,
        invitation,
      } = RecurringScheduleCallSchema.parse(req.body);
      const normalizedExternalInvitees = normalizeEmailList(externalInvitees);

      // Scope is fully decided by the frontend; the backend does NO scopeType inspection:
      //   - channelId present [+ targetUserIds subset] → channel-scoped call, keep channelId
      //   - no channelId (targetUserIds only)          → group call, create a GROUP_DM
      // `callUpdatesChannel` is an orthogonal broadcast override, stored whenever provided, so a
      // selective channel call can also post its updates to a different channel.
      let finalChannelId = channelId;
      const callUpdatesChannel: string | null = reqCallUpdatesChannel ?? null;
      if (!channelId && targetUserIds?.length) {
        // No channel supplied → direct group call, create a GROUP_DM for the participants.
        finalChannelId = await repositories.channels.findOrCreateDMChannel(
          userId,
          targetUserIds,
          repositories.channelParticipants,
          req.user!.workspaceId!,
        );
      }

      const seriesId = uuidv4();
      const dbClient = DatabaseClient.getInstance();

      // Resolve endsOn: explicit value > derived from COUNT/UNTIL > null (open-ended)
      const resolvedEndsOn: Date | null =
        endsOn ? new Date(endsOn) : deriveEndsOnFromRRule(recurrenceRule, new Date(startsOn));

      // #7 — Guard: if the RRULE/endsOn resolves to a date that is not after startsOn,
      // the rule produces no future occurrences — reject early.
      if (resolvedEndsOn && resolvedEndsOn.getTime() <= startsOn) {
        res.status(400).json({
          success: false,
          error: 'The recurrence rule produces no future occurrences from startsOn (UNTIL/COUNT resolves to a past date)',
        });
        return;
      }

      const recurringParticipantUserIds = await this.resolveRecurringInternalParticipantUserIds({
        targetUserIds,
        channelId: finalChannelId!,
        logPrefix: '[createRecurringSeries]',
      });

      // Create series and pre-create all instances for the next 60 days
      // Only the first upcoming instance notifies participants (to avoid spam)
      let createdCallIds: string[] = [];
      await dbClient.$transaction(async (tx) => {
        const series = await repositories.recurringCallSeries.create({
          id: seriesId,
          title,
          description,
          workspaceId: req.user!.workspaceId!,
          organizerId: userId,
          channelId: finalChannelId!,
          recurrenceRule,
          timezone,
          startTime,
          endTime,
          startsOn: new Date(startsOn),
          endsOn: resolvedEndsOn,
          createdAt: new Date(),
          updatedAt: new Date(),
          callUpdatesChannel,
        }, tx);

        await repositories.recurringCallParticipants.replaceInternalParticipants({
          recurringSeriesId: series.id,
          organizerId: userId,
          userIds: recurringParticipantUserIds,
          workspaceId: req.user!.workspaceId!,
          tx,
        });

        if (normalizedExternalInvitees.length > 0) {
          await repositories.recurringCallParticipants.replaceExternalInvitees({
            recurringSeriesId: series.id,
            organizerId: userId,
            externalInvitees: normalizedExternalInvitees,
            workspaceId: req.user!.workspaceId!,
            tx,
          });
        }

        // Pre-create all instances for the next buffer period.
        // RecurringCallParticipant rows are the source for internal participants and external invitees.
        const fromDate = new Date(startsOn);
        const toDate = new Date(Date.now() + INSTANCE_BUFFER_DAYS);
        const finalToDate = resolvedEndsOn && resolvedEndsOn < toDate ? resolvedEndsOn : toDate;

        createdCallIds = await recurringCallService.createInstancesForDateRange(
          series,
          fromDate,
          finalToDate,
          tx,
          callUpdatesChannel,
        );
      });

      logger.info(
        `Recurring series ${seriesId} created by ${userId} — ${createdCallIds.length} instances pre-created`,
      );

      if (normalizedExternalInvitees.length > 0 && invitation) {
        const inviteCall = await repositories.scheduledCalls.findFirstUpcomingSeriesInstance({ seriesId });
        if (inviteCall?.startsAt && inviteCall.endsAt) {
          this.sendExternalInvitationInBackground({
            context: 'createRecurringSeries',
            delivery: 'standalone',
            invitationParams: {
              externalId: inviteCall.externalId,
              callTitle: inviteCall.title ?? title,
              startsAt: inviteCall.startsAt,
              endsAt: inviteCall.endsAt,
              organizerUserId: userId,
              externalInvitees: normalizedExternalInvitees,
              invitation,
            },
          });
        } else {
          logger.warn(
            `[createRecurringSeries] Skipping external invite email because no upcoming instance was found | seriesId=${seriesId} invitees=${normalizedExternalInvitees.join(', ')}`,
          );
        }
      }

      res.json({
        success: true,
        seriesId,
        channelId: finalChannelId,
      });
    } catch (error) {
      logger.error('Failed to create recurring call series:', error);
      res.status(500).json({ success: false, error: 'Failed to create recurring call series' });
    }
  };

  // POST /api/calls/schedule - Schedule a call for a future time
  scheduleCall = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      // Validate request body with Zod
      const {
        title,
        startsAt,
        endsAt,
        channelId,
        targetUserIds,
        callUpdatesChannel: reqCallUpdatesChannel,
        conversationId,
        externalInvitees,
        externalInviteDelivery,
        invitation,
      } = ScheduleCallSchema.parse(req.body);

      // Scope is fully decided by the frontend; the backend does NO scopeType inspection
      // (see createRecurringSeries for the full rationale):
      //   - channelId present [+ targetUserIds subset] → channel-scoped call, keep channelId
      //   - no channelId (targetUserIds only)          → group call, create a GROUP_DM
      // `callUpdatesChannel` is an orthogonal broadcast override, stored whenever provided.
      let finalChannelId = channelId;
      const callUpdatesChannel: string | null = reqCallUpdatesChannel ?? null;

      if (!channelId && targetUserIds?.length) {
        // No channel supplied → direct group call, create a GROUP_DM for the participants.
        finalChannelId = await repositories.channels.findOrCreateDMChannel(
          userId,
          targetUserIds,
          repositories.channelParticipants,
          req.user!.workspaceId!,
        );
      }

      // Generate IDs
      const callId = uuidv4();
      const externalId = uuidv4();

      // Generate room link for scheduled call
      const roomLink = buildCallInviteUrl(externalId);

      const normalizedExternalInvitees = normalizeEmailList(externalInvitees);
      const hasExternals = !!(
        normalizedExternalInvitees.length > 0 && invitation
      );
      const hasConversation = !!conversationId;
      const sendAsConversationReply = hasExternals && externalInviteDelivery === 'conversation_reply';

      if (hasExternals) {
        logger.info(
          `[scheduleCall] External invitees detected | callId=${callId} externalId=${externalId} inviteeCount=${normalizedExternalInvitees.length} delivery=${externalInviteDelivery ?? 'standalone'} hasConversation=${hasConversation}`,
        );
      }

      const db = DatabaseClient.getInstance();

      const { participantUserIds } = await db.$transaction(async (tx) => {
        const result = await repositories.calls.createCallWithParticipants({
          callId,
          externalId,
          title,
          createdByUserId: userId,
          channelId: finalChannelId!,
          callType: CallType.AUDIO,
          callOrigin: conversationId ? CallOrigin.CONVERSATION : CallOrigin.CHANNEL,
          roomLink,
          timezone: 'UTC',
          isRecurring: false,
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          ...(targetUserIds?.length && { targetUserIds }),
          ...(conversationId && { metadata: { conversationId } }),
          callUpdatesChannel,
          ...(normalizedExternalInvitees.length && { externalInvitees: normalizedExternalInvitees }),
        }, tx);

        return result;
      });

      if (hasExternals) {
        this.sendExternalInvitationInBackground({
          context: 'scheduleCall',
          delivery: sendAsConversationReply ? 'conversation_reply' : 'standalone',
          ...(conversationId && { conversationId }),
          invitationParams: {
            externalId,
            callTitle: title,
            startsAt: new Date(startsAt),
            endsAt: new Date(endsAt),
            organizerUserId: userId,
            externalInvitees: normalizedExternalInvitees,
            invitation: invitation!,
          },
        });
      }

      queueCallVespaFeed(callId, { source: CallVespaFeedSource.ScheduleCallControllerCreateScheduledCall });

      // Send immediate notifications + create activities for all participants (excluding organizer)
      try {
        await scheduledCallNotificationService.sendScheduledCallNotifications({
          callId,
          callExternalId: externalId,
          title,
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          channelId: finalChannelId!,
          organizerUserId: userId,
          participantUserIds,
        });
      } catch (error) {
        logger.error(`Failed to send immediate notifications for call ${callId}:`, error);
      }

      // Schedule 10-minute reminder notification for all participants
      try {
        await scheduledCallNotificationService.scheduleCallReminder(
          callId,
          externalId,
          title,
          new Date(startsAt),
          participantUserIds
        );
        logger.info(`Scheduled 10-minute reminder for call ${externalId} with ${participantUserIds.length} participants`);
      } catch (error) {
        // Log error but don't fail the call creation
        logger.error(`Failed to schedule reminder for call ${callId}:`, error);
      }

      // Schedule auto-end job at endsAt time
      try {
        await scheduledCallNotificationService.scheduleCallAutoEnd(
          callId,
          externalId,
          new Date(endsAt)
        );
        logger.info(`Scheduled auto-end for call ${externalId} at ${new Date(endsAt).toISOString()}`);
      } catch (error) {
        // Log error but don't fail the call creation
        logger.error(`Failed to schedule auto-end for call ${callId}:`, error);
      }

      logger.info(`Scheduled call created: ${externalId} for channel ${finalChannelId} by user ${userId}`);

      res.json({
        success: true,
        callId: callId,
        externalId: externalId,
        channelId: finalChannelId,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid schedule call request',
          details: error.errors,
        });
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to schedule call: ${message}`);
      res.status(500).json({ success: false, error: 'Failed to schedule call', message });
    }
  };

  /**
   * PATCH /api/calls/:callId
   * Update a single SCHEDULED call instance (title, time, participants).
   * The organizer can edit every field. A non-organizer participant of a direct
   * (DM/GROUP_DM-backed) call may only change the invite list — adding anyone, and
   * removing only the people they themselves added — and nothing else.
   * Only SCHEDULED calls may be edited.
   */
  updateScheduledCall = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId: externalId } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!externalId) {
      res.status(400).json({ success: false, error: 'callId is required' });
      return;
    }

    try {
      const parsedBody = UpdateScheduleCallSchema.parse(req.body);
      const { title, startsAt, endsAt, targetUserIds, channelId: reqChannelId, callUpdatesChannel: reqCallUpdatesChannel, externalInvitees } = parsedBody;
      const normalizedExternalInvitees = externalInvitees !== undefined
        ? normalizeEmailList(externalInvitees)
        : undefined;

      logger.info(`[updateScheduledCall] request | externalId=${externalId} userId=${userId} reqChannelId=${reqChannelId} targetUserIds=${JSON.stringify(targetUserIds)} externalInvitees=${JSON.stringify(normalizedExternalInvitees)} title=${title} startsAt=${startsAt} endsAt=${endsAt}`);

      const call = await repositories.calls.findByExternalId(externalId);
      if (!call) {
        logger.warn(`[updateScheduledCall] call not found | externalId=${externalId}`);
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      logger.info(`[updateScheduledCall] call found | callId=${call.id} currentChannelId=${call.channelId} status=${call.status} organizer=${call.createdByUserId}`);

      const auth = await this.authorizeScheduledCallEdit({
        call,
        userId,
        edits: {
          title,
          startsAt,
          endsAt,
          channelId: reqChannelId,
          callUpdatesChannel: reqCallUpdatesChannel,
          externalInvitees: normalizedExternalInvitees,
          targetUserIds,
        },
      });
      if (!auth.allowed) {
        res.status(auth.status).json({ success: false, error: auth.error });
        return;
      }

      if (call.status !== CallStatus.SCHEDULED) {
        res.status(400).json({ success: false, error: 'Only SCHEDULED calls can be edited' });
        return;
      }

      // Channel/participant/broadcast changes are detected from which fields the frontend sent.
      // Resolution is the same as scheduleCall: channelId present → keep it; absent → GROUP_DM;
      // callUpdatesChannel is stored orthogonally. No scopeType inspection.
      const modeChanged = reqChannelId !== undefined || targetUserIds !== undefined || reqCallUpdatesChannel !== undefined;

      // The frontend omits the viewer from `targetUserIds`, so fold the actor back in, along
      // with the organizer and whatever the authorization pinned (see above).
      const desiredParticipantIds =
        targetUserIds !== undefined
          ? Array.from(
              new Set([
                ...targetUserIds,
                ...auth.pinnedParticipantIds,
                userId,
                call.createdByUserId,
              ]),
            )
          : undefined;

      let resolvedChannelId: string | undefined;
      let newCallUpdatesChannel: string | null | undefined; // undefined = don't touch

      if (modeChanged) {
        // Resolve the call's channel — frontend owns scope, backend does NO scopeType inspection.
        if (reqChannelId) {
          // Channel-scoped call: keep channelId. A selective subset (targetUserIds) is applied
          // via the participant delta below, not by switching channels.
          resolvedChannelId = reqChannelId;
        } else if (targetUserIds !== undefined && targetUserIds.length > 0) {
          // Direct group call — create a GROUP_DM for the participants.
          logger.info(`[updateScheduledCall] group call: creating GROUP_DM for targetUserIds=${JSON.stringify(targetUserIds)}`);
          // Anchored on the organizer, not the actor: a participant editing the list must
          // not drag the call onto their own DM/self-DM.
          resolvedChannelId = await repositories.channels.findOrCreateDMChannel(
            call.createdByUserId,
            desiredParticipantIds!.filter((id) => id !== call.createdByUserId),
            repositories.channelParticipants,
            req.user!.workspaceId!,
          );
        }
        // callUpdatesChannel is orthogonal: apply the organizer's requested value, clearing it
        // when they omit it. A participant editor may never send the field at all, so their
        // silence must leave the organizer's choice alone instead of reading as "clear it".
        newCallUpdatesChannel =
          call.createdByUserId === userId ? (reqCallUpdatesChannel ?? null) : undefined;
        logger.info(`[updateScheduledCall] resolvedChannelId=${resolvedChannelId} newCallUpdatesChannel=${newCallUpdatesChannel}`);
      } else {
        logger.info(`[updateScheduledCall] no channel/participant change — keeping existing channelId=${call.channelId}`);
      }

      // Compute participant delta when targetUserIds is provided, OR when the channel changes
      // without an explicit targetUserIds (in that case we use the new channel's members).
      let addUserIds: string[] | undefined;
      let removeUserIds: string[] | undefined;

      const channelChanged = resolvedChannelId !== undefined && resolvedChannelId !== call.channelId;

      if (targetUserIds !== undefined || channelChanged) {
        ({ addUserIds, removeUserIds } = await this.resolveParticipantDelta(
          call.id,
          userId,
          desiredParticipantIds,
          resolvedChannelId ?? call.channelId ?? '',
          '[updateScheduledCall]',
        ));
      }

      let newlyAddedExternalInvitees: string[] = [];
      if (normalizedExternalInvitees !== undefined) {
        const currentExternalInvitees = await repositories.calls.findExternalInviteeEmails(call.id);
        newlyAddedExternalInvitees = findNewEmails(normalizedExternalInvitees, currentExternalInvitees);
        logger.info(
          `[updateScheduledCall] external invitee delta | added=${JSON.stringify(newlyAddedExternalInvitees)} total=${JSON.stringify(normalizedExternalInvitees)}`,
        );
      }

      logger.info(`[updateScheduledCall] calling updateScheduledCall repo | callId=${call.id} resolvedChannelId=${resolvedChannelId}`);

      const updatedCall = await repositories.calls.updateScheduledCall({
        callId: call.id,
        title,
        startsAt: startsAt !== undefined ? new Date(startsAt) : undefined,
        endsAt: endsAt !== undefined ? new Date(endsAt) : undefined,
        channelId: resolvedChannelId,
        addUserIds,
        removeUserIds,
        invitedByUserId: userId,
        callUpdatesChannel: newCallUpdatesChannel,
        externalInvitees: normalizedExternalInvitees,
      });

      logger.info(`[updateScheduledCall] repo update complete | callId=${call.id} resolvedChannelId=${resolvedChannelId}`);

      if (newlyAddedExternalInvitees.length > 0) {
        const inviteStartsAt = updatedCall.startsAt ?? call.startsAt;
        const inviteEndsAt = updatedCall.endsAt ?? call.endsAt;

        if (inviteStartsAt && inviteEndsAt) {
          this.sendExternalInvitationInBackground({
            context: 'updateScheduledCall',
            delivery: 'standalone',
            invitationParams: {
              externalId,
              callTitle: updatedCall.title ?? call.title ?? 'Scheduled Call',
              startsAt: inviteStartsAt,
              endsAt: inviteEndsAt,
              organizerUserId: userId,
              externalInvitees: newlyAddedExternalInvitees,
              invitation: defaultCallInvitation(updatedCall.timezone ?? call.timezone),
            },
          });
        } else {
          logger.warn(
            `[updateScheduledCall] Skipping external invite email for newly added invitees because call time is missing | callId=${call.id} invitees=${newlyAddedExternalInvitees.join(', ')}`,
          );
        }
      }

      // Fetch participants once for both rescheduling and update notifications
      const allParticipants = await repositories.calls.findParticipants(call.id);
      const participantIds = allParticipants.map((p) => p.userId);

      // Reschedule Bull jobs if time changed
      if (startsAt !== undefined) {
        try {
          await scheduledCallNotificationService.rescheduleCallReminder(
            call.id,
            externalId,
            title ?? call.title ?? 'Scheduled Call',
            new Date(startsAt),
            participantIds,
          );
        } catch (err) {
          logger.error(`Failed to reschedule reminder for call ${call.id}:`, err);
        }
      }

      if (endsAt !== undefined) {
        try {
          await scheduledCallNotificationService.rescheduleCallAutoEnd(
            call.id,
            externalId,
            new Date(endsAt),
          );
        } catch (err) {
          logger.error(`Failed to reschedule auto-end for call ${call.id}:`, err);
        }
      }

      // Notify participants of the update
      try {
        await scheduledCallNotificationService.sendCallUpdatedNotifications({
          callId: call.id,
          callExternalId: externalId,
          title: title ?? call.title ?? 'Scheduled Call',
          startsAt: startsAt !== undefined ? new Date(startsAt) : new Date(call.startsAt!),
          endsAt: endsAt !== undefined ? new Date(endsAt) : new Date(call.endsAt!),
          channelId: call.channelId ?? '',
          organizerUserId: userId,
          participantUserIds: participantIds,
        });
      } catch (err) {
        logger.error(`Failed to send update notifications for call ${call.id}:`, err);
      }

      logger.info(`Call ${externalId} updated by organizer ${userId}`);
      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to update scheduled call:', error);
      if (error instanceof ZodError) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to update scheduled call' });
    }
  };

  /**
   * PATCH /api/calls/series/:seriesId
   * Update a recurring call series (title, recurrence rule, time, participants).
   * The organizer can edit every field. A non-organizer participant of a direct
   * (DM/GROUP_DM-backed) series may only change the invite list — adding anyone, and
   * removing only the people they themselves added. Updates the series record and cascades
   * title/time changes to ALL SCHEDULED instances in the series. If the recurrence rule or call times
   * change, all SCHEDULED instances are deleted and regenerated.
   *
   * Scope: All SCHEDULED instances in the series are affected by series edits.
   */
  updateRecurringSeries = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { seriesId } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!seriesId) {
      res.status(400).json({ success: false, error: 'seriesId is required' });
      return;
    }

    try {
      const parsedBody = UpdateRecurringSeriesSchema.parse(req.body);
      const { title, recurrenceRule, startTime, endTime, endsOn, timezone, targetUserIds, channelId: reqChannelId, callUpdatesChannel: reqCallUpdatesChannel, externalInvitees } = parsedBody;
      const normalizedExternalInvitees = externalInvitees !== undefined
        ? normalizeEmailList(externalInvitees)
        : undefined;

      logger.info(`[updateRecurringSeries] request | seriesId=${seriesId} userId=${userId} reqChannelId=${reqChannelId} targetUserIds=${JSON.stringify(targetUserIds)} externalInvitees=${JSON.stringify(normalizedExternalInvitees)} title=${title}`);

      const db = DatabaseClient.getInstance();
      const series = await repositories.recurringCallSeries.findById(seriesId);

      if (!series) {
        res.status(404).json({ success: false, error: 'Series not found' });
        return;
      }

      logger.info(`[updateRecurringSeries] series found | currentChannelId=${series.channelId} organizerId=${series.organizerId}`);

      const auth = await this.authorizeRecurringSeriesEdit({
        series,
        userId,
        edits: {
          title,
          recurrenceRule,
          startTime,
          endTime,
          endsOn,
          timezone,
          channelId: reqChannelId,
          callUpdatesChannel: reqCallUpdatesChannel,
          externalInvitees: normalizedExternalInvitees,
          targetUserIds,
        },
      });
      if (!auth.allowed) {
        res.status(auth.status).json({ success: false, error: auth.error });
        return;
      }

      // The frontend omits the viewer from `targetUserIds`, so fold the actor back in, along
      // with the organizer and whatever the authorization pinned (see above).
      const desiredParticipantIds =
        targetUserIds !== undefined
          ? Array.from(
              new Set([...targetUserIds, ...auth.pinnedParticipantIds, userId, series.organizerId]),
            )
          : undefined;

      if (series.status === 'CANCELLED') {
        res.status(400).json({ success: false, error: 'Cannot edit a cancelled series' });
        return;
      }

      // Channel/participant/broadcast changes are detected from which fields the frontend sent.
      // Resolution is the same as scheduleCall: channelId present → keep it; absent → GROUP_DM;
      // callUpdatesChannel is stored orthogonally. No scopeType inspection.
      const seriesModeChanged = reqChannelId !== undefined || targetUserIds !== undefined || reqCallUpdatesChannel !== undefined;

      let newlyAddedExternalInvitees: string[] = [];
      if (normalizedExternalInvitees !== undefined) {
        const currentExternalInvitees =
          await repositories.recurringCallParticipants.findExternalInviteeEmails(seriesId);
        newlyAddedExternalInvitees = findNewEmails(normalizedExternalInvitees, currentExternalInvitees);
        logger.info(
          `[updateRecurringSeries] external invitee delta | added=${JSON.stringify(newlyAddedExternalInvitees)} total=${JSON.stringify(normalizedExternalInvitees)}`,
        );
      }

      let resolvedChannelId: string | undefined;
      let newCallUpdatesChannel: string | null | undefined; // undefined = don't touch

      if (seriesModeChanged) {
        // Resolve the series' channel — frontend owns scope, backend does NO scopeType inspection.
        if (reqChannelId) {
          // Channel-scoped call: keep channelId. A selective subset (targetUserIds) is applied
          // via the per-instance participant delta below, not by switching channels.
          resolvedChannelId = reqChannelId;
        } else if (targetUserIds !== undefined && targetUserIds.length > 0) {
          // Direct group call — create a GROUP_DM for the participants.
          logger.info(`[updateRecurringSeries] group call: creating GROUP_DM for targetUserIds=${JSON.stringify(targetUserIds)}`);
          // Anchored on the organizer, not the actor: a participant editing the list must
          // not drag the series onto their own DM/self-DM.
          resolvedChannelId = await repositories.channels.findOrCreateDMChannel(
            series.organizerId,
            desiredParticipantIds!.filter((id) => id !== series.organizerId),
            repositories.channelParticipants,
            req.user!.workspaceId!,
          );
        }
        // callUpdatesChannel is orthogonal: apply the organizer's requested value, clearing it
        // when they omit it. A participant editor may never send the field at all, so their
        // silence must leave the organizer's choice alone instead of reading as "clear it".
        newCallUpdatesChannel =
          series.organizerId === userId ? (reqCallUpdatesChannel ?? null) : undefined;
        logger.info(`[updateRecurringSeries] resolvedChannelId=${resolvedChannelId} newCallUpdatesChannel=${newCallUpdatesChannel}`);
      } else {
        logger.info(`[updateRecurringSeries] no channelId change — keeping existing channelId=${series.channelId}`);
      }

      const shouldReplaceRecurringInternalParticipants =
        targetUserIds !== undefined || resolvedChannelId !== undefined;
      const recurringParticipantUserIds = shouldReplaceRecurringInternalParticipants
        ? await this.resolveRecurringInternalParticipantUserIds({
          targetUserIds: desiredParticipantIds,
          channelId: resolvedChannelId ?? series.channelId,
          logPrefix: '[updateRecurringSeries]',
        })
        : undefined;

      // Detect whether recurrence structure changes require instance regeneration.
      // Only recurrenceRule changes require delete+regenerate.
      const ruleChanged = recurrenceRule !== undefined && recurrenceRule !== series.recurrenceRule;
      const needsRegeneration = ruleChanged;

      // Build the series update payload
      const seriesUpdate: Prisma.RecurringCallSeriesUncheckedUpdateInput = { updatedAt: new Date() };
      if (title !== undefined) seriesUpdate.title = title;
      if (recurrenceRule !== undefined) seriesUpdate.recurrenceRule = recurrenceRule;
      if (startTime !== undefined) seriesUpdate.startTime = startTime;
      if (endTime !== undefined) seriesUpdate.endTime = endTime;
      if (timezone !== undefined) seriesUpdate.timezone = timezone;
      if (endsOn !== undefined) seriesUpdate.endsOn = new Date(endsOn);
      if (resolvedChannelId !== undefined) seriesUpdate.channelId = resolvedChannelId;
      if (newCallUpdatesChannel !== undefined) seriesUpdate.callUpdatesChannel = newCallUpdatesChannel;
      // NOTE: We intentionally do NOT update startsOn. The original series.startsOn is the
      // RRULE dtstart anchor and must remain unchanged. The frontend may send startsOn as the
      // instance date, but overwriting the series start would corrupt the recurrence calculation.

      logger.info(`[updateRecurringSeries] seriesUpdate payload=${JSON.stringify(seriesUpdate)}`);

      const updatedSeries = await db.$transaction(async (tx) => {
        const seriesAfterUpdate = await repositories.recurringCallSeries.update(
          seriesId,
          seriesUpdate,
          tx,
        );

        if (recurringParticipantUserIds !== undefined) {
          await repositories.recurringCallParticipants.replaceInternalParticipants({
            recurringSeriesId: seriesId,
            organizerId: series.organizerId,
            // Credit the editor on rows they add, so they can remove them later.
            invitedByUserId: userId,
            userIds: recurringParticipantUserIds,
            workspaceId: req.user!.workspaceId!,
            tx,
          });
        }

        if (normalizedExternalInvitees !== undefined) {
          await repositories.recurringCallParticipants.replaceExternalInvitees({
            recurringSeriesId: seriesId,
            organizerId: series.organizerId,
            externalInvitees: normalizedExternalInvitees,
            workspaceId: req.user!.workspaceId!,
            tx,
          });
        }

        return seriesAfterUpdate;
      });

      logger.info(`[updateRecurringSeries] source transaction committed | newChannelId=${updatedSeries.channelId}`);

      if (needsRegeneration) {
        // Delete ALL SCHEDULED instances and recreate them with the new recurrence rule.
        // Use the ORIGINAL series.startsOn (not the updated one) so the RRULE generates
        // occurrences from the true series start date.
        const baseDate = new Date(series.startsOn);
        logger.info(`[updateRecurringSeries] needsRegeneration=true — regenerating all instances from ${baseDate.toISOString()}`);

        const seriesForRegeneration: typeof updatedSeries = {
          ...updatedSeries,
          // Override startsOn and recurrenceRule to their correct values for regeneration
          startsOn: series.startsOn,  // Use ORIGINAL startsOn, not the updated one
          recurrenceRule: recurrenceRule ?? updatedSeries.recurrenceRule,
        };
        // updatedSeries.callUpdatesChannel is already the correct value (series was just updated above).
        await recurringCallService.regenerateFutureInstances(
          seriesForRegeneration,
          baseDate,
        );
      } else {
        // No regeneration needed — cascade title, channelId, and/or time changes to ALL SCHEDULED instances
        // Update all SCHEDULED instances (not just future ones) to keep the series consistent
        const allScheduledInstances = await repositories.scheduledCalls.findScheduledInstances({
          seriesId,
          tx: db,
        });

        const instanceCascade: Record<string, unknown> = {};
        if (title !== undefined) instanceCascade.title = title;
        if (resolvedChannelId !== undefined) instanceCascade.channelId = resolvedChannelId;

        // Cascade startTime/endTime changes in-place by updating startsAt/endsAt on each instance.
        // We preserve the date portion and only change the time portion.
        const startTimeChanged = startTime !== undefined && startTime !== series.startTime;
        const endTimeChanged = endTime !== undefined && endTime !== series.endTime;
        const timeChanged = startTimeChanged || endTimeChanged;

        // Collect instances that need time updates for Bull job rescheduling
        const instancesNeedingTimeUpdate: { id: string; externalId: string; startsAt: Date; endsAt: Date }[] = [];

        if (timeChanged && allScheduledInstances.length > 0) {
          const newStartTime = startTime ?? series.startTime;
          const newEndTime = endTime ?? series.endTime;

          // Compute the delta in milliseconds between the old and new HH:mm strings.
          // Both are in the user's timezone, so subtracting them is timezone-agnostic.
          // Applying this delta to the existing UTC timestamps avoids the setHours() trap
          // of interpreting the time in server-local time (UTC in prod) instead of the
          // user's timezone.
          const [oldStartH, oldStartM] = series.startTime.split(':').map(Number);
          const [newStartH, newStartM] = newStartTime.split(':').map(Number);
          const startDeltaMs = ((newStartH! * 60 + newStartM!) - (oldStartH! * 60 + oldStartM!)) * 60_000;

          const [oldEndH, oldEndM] = series.endTime.split(':').map(Number);
          const [newEndH, newEndM] = newEndTime.split(':').map(Number);
          const endDeltaMs = ((newEndH! * 60 + newEndM!) - (oldEndH! * 60 + oldEndM!)) * 60_000;

          for (const instance of allScheduledInstances) {
            const existingStart = instance.startsAt!;
            const existingEnd = instance.endsAt!;
            const newStartsAt = new Date(existingStart.getTime() + startDeltaMs);
            const newEndsAt = new Date(existingEnd.getTime() + endDeltaMs);

            await repositories.scheduledCalls.updateScheduledInstanceTimes({
              callId: instance.id,
              startsAt: newStartsAt,
              endsAt: newEndsAt,
            });
            queueCallVespaFeed(instance.id, { source: CallVespaFeedSource.ScheduleCallControllerUpdateRecurringSeriesTimeChanged });

            instancesNeedingTimeUpdate.push({
              id: instance.id,
              externalId: instance.externalId,
              startsAt: newStartsAt,
              endsAt: newEndsAt,
            });

            logger.info(`[updateRecurringSeries] updated instance ${instance.id} time: ${existingStart.toISOString()} -> ${newStartsAt.toISOString()}`);
          }
        }

        // Cascade callUpdatesChannel when mode changed — safe to use updateMany on a plain column
        if (newCallUpdatesChannel !== undefined) instanceCascade.callUpdatesChannel = newCallUpdatesChannel;

        if (Object.keys(instanceCascade).length > 0 && allScheduledInstances.length > 0) {
          logger.info(`[updateRecurringSeries] cascading ${JSON.stringify(instanceCascade)} to ${allScheduledInstances.length} instances`);
          await repositories.scheduledCalls.updateScheduledInstanceFields({
            callIds: allScheduledInstances.map((i) => i.id),
            title: title !== undefined ? title : undefined,
            channelId: resolvedChannelId,
            callUpdatesChannel: newCallUpdatesChannel,
          });
          allScheduledInstances.forEach((instance) => queueCallVespaFeed(instance.id, {
            source: CallVespaFeedSource.ScheduleCallControllerUpdateRecurringSeriesCascade,
          }));
        }

        // Reschedule Bull jobs for instances with time changes
        if (instancesNeedingTimeUpdate.length > 0) {
          const callTitle = title ?? series.title;
          for (const instance of instancesNeedingTimeUpdate) {
            try {
              const participants = await repositories.calls.findParticipants(instance.id);
              const participantIds = participants.map((p) => p.userId);

              await scheduledCallNotificationService.rescheduleCallReminder(
                instance.id,
                instance.externalId,
                callTitle,
                instance.startsAt,
                participantIds,
              );
              await scheduledCallNotificationService.rescheduleCallAutoEnd(
                instance.id,
                instance.externalId,
                instance.endsAt,
              );
              logger.info(`[updateRecurringSeries] rescheduled Bull jobs for instance ${instance.id}`);
            } catch (err) {
              logger.error(`[updateRecurringSeries] failed to reschedule Bull jobs for instance ${instance.id}:`, err);
            }
          }
        }

        // Update participants on all scheduled instances from the series source table.
        if (recurringParticipantUserIds !== undefined) {
          const effectiveChannelIdForDelta = resolvedChannelId ?? series.channelId;
          for (const instance of allScheduledInstances) {
            const { addUserIds, removeUserIds } = await this.resolveParticipantDelta(
              instance.id,
              series.organizerId,
              recurringParticipantUserIds,
              effectiveChannelIdForDelta,
              `[updateRecurringSeries] instance=${instance.id}`,
            );
            if (addUserIds.length > 0 || removeUserIds.length > 0) {
              await repositories.calls.updateScheduledCall({
                callId: instance.id,
                addUserIds: addUserIds.length > 0 ? addUserIds : undefined,
                removeUserIds: removeUserIds.length > 0 ? removeUserIds : undefined,
                invitedByUserId: userId,
              });
            }
          }
        }

        if (normalizedExternalInvitees !== undefined && allScheduledInstances.length > 0) {
          logger.info(
            `[updateRecurringSeries] syncing external invitees to ${allScheduledInstances.length} scheduled instances`,
          );
          for (const instance of allScheduledInstances) {
            await repositories.calls.updateScheduledCall({
              callId: instance.id,
              externalInvitees: normalizedExternalInvitees,
            });
          }
        }
      }

      if (newlyAddedExternalInvitees.length > 0) {
        const inviteCall = await repositories.scheduledCalls.findFirstUpcomingSeriesInstance({ seriesId });
        if (inviteCall?.startsAt && inviteCall.endsAt) {
          this.sendExternalInvitationInBackground({
            context: 'updateRecurringSeries',
            delivery: 'standalone',
            invitationParams: {
              externalId: inviteCall.externalId,
              callTitle: inviteCall.title ?? title ?? series.title,
              startsAt: inviteCall.startsAt,
              endsAt: inviteCall.endsAt,
              organizerUserId: userId,
              externalInvitees: newlyAddedExternalInvitees,
              invitation: defaultCallInvitation(timezone ?? series.timezone),
            },
          });
        } else {
          logger.warn(
            `[updateRecurringSeries] Skipping external invite email because no upcoming instance was found | seriesId=${seriesId} invitees=${newlyAddedExternalInvitees.join(', ')}`,
          );
        }
      }

      // updatedSeries.startsOn is the UTC dtstart sent directly by the frontend;
      // use it as the notification start. endsAt is derived by adding the call duration.
      const effectiveStartTime = startTime ?? series.startTime;
      const effectiveEndTime = endTime ?? series.endTime;
      const notifyStartsAt = new Date(updatedSeries.startsOn);
      const notifyEndsAt = addHHMMDuration(notifyStartsAt, effectiveStartTime, effectiveEndTime);

      // Notify all participants of the series change
      try {
        const effectiveChannelId = resolvedChannelId ?? series.channelId;
        const storedParticipantIds =
          await repositories.recurringCallParticipants.findInternalParticipantUserIds(seriesId);
        const participantIds = storedParticipantIds.length > 0
          ? storedParticipantIds
          : (await repositories.channelParticipants.getChannelParticipants(effectiveChannelId))
            .map((p) => p.userId);

        await scheduledCallNotificationService.sendCallUpdatedNotifications({
          callId: seriesId,
          callExternalId: seriesId,
          title: title ?? series.title,
          startsAt: notifyStartsAt,
          endsAt: notifyEndsAt,
          channelId: effectiveChannelId,
          organizerUserId: userId,
          participantUserIds: participantIds,
        });
      } catch (err) {
        logger.error(`Failed to send update notifications for series ${seriesId}:`, err);
      }

      logger.info(`[updateRecurringSeries] done | seriesId=${seriesId} resolvedChannelId=${resolvedChannelId}`);
      res.json({ success: true, seriesId });
    } catch (error) {
      logger.error('Failed to update recurring series:', error);
      if (error instanceof ZodError) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to update recurring series' });
    }
  };
  /**
   * DELETE /api/calls/:callId
   * Cancel a single SCHEDULED call instance.
   * Marks the instance as CANCELLED (preserves record) and triggers buffer
   * replenishment so the 60-day buffer is maintained.
   */
  cancelScheduledCall = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId: externalId } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!externalId) {
      res.status(400).json({ success: false, error: 'callId is required' });
      return;
    }

    try {
      CancelScheduledCallSchema.parse(req.body);

      const call = await repositories.calls.findByExternalId(externalId);
      if (!call) {
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      if (call.createdByUserId !== userId) {
        res.status(403).json({ success: false, error: 'Only the organizer can cancel a scheduled call' });
        return;
      }

      if (call.status !== CallStatus.SCHEDULED) {
        res.status(400).json({ success: false, error: 'Only SCHEDULED calls can be cancelled' });
        return;
      }

      // Remove Bull jobs for this instance
      try {
        await scheduledCallNotificationService.removeCallJobs(call.id);
      } catch (err) {
        logger.error(`Failed to remove Bull jobs for call ${call.id}:`, err);
      }

      // Mark the instance as CANCELLED (preserve record)
      await repositories.scheduledCalls.cancelCall(call.id);

      logger.info(`Call ${externalId} cancelled by organizer ${userId}`);

      // Trigger buffer replenishment for recurring series
      if (call.recurringSeriesId) {
        try {
          await recurringCallService.replenishInstanceBuffer(call.recurringSeriesId);
          logger.info(`Buffer replenished for series ${call.recurringSeriesId} after instance cancellation`);
        } catch (err) {
          logger.error(`Failed to replenish buffer for series ${call.recurringSeriesId}:`, err);
        }

        // Transfer the Bull job chain to the next instance.
        // Instances beyond the first are created without Bull jobs (scheduleJobs=false),
        // relying on the previous instance's auto-end job to call scheduleJobsForNextInstance.
        // When that previous instance is cancelled instead of auto-ended, the chain is broken
        // and the next instance never gets its auto-end job — leaving it stuck in SCHEDULED.
        if (call.endsAt) {
          try {
            await recurringCallService.scheduleJobsForNextInstance(call.recurringSeriesId, call.endsAt);
            logger.info(`Bull jobs transferred to next instance in series ${call.recurringSeriesId}`);
          } catch (err) {
            logger.error(`Failed to schedule jobs for next instance in series ${call.recurringSeriesId}:`, err);
          }
        }
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to cancel scheduled call:', error);
      res.status(500).json({ success: false, error: 'Failed to cancel scheduled call' });
    }
  };

  /**
   * DELETE /api/calls/series/:seriesId
   * Cancel an entire recurring series.
   * Marks all future SCHEDULED instances as CANCELLED (preserves records),
   * removes their Bull jobs, and marks the series as CANCELLED.
   */
  cancelRecurringSeries = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { seriesId } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!seriesId) {
      res.status(400).json({ success: false, error: 'seriesId is required' });
      return;
    }

    try {
      CancelRecurringSeriesSchema.parse(req.body);

      const series = await repositories.recurringCallSeries.findById(seriesId);

      if (!series) {
        res.status(404).json({ success: false, error: 'Series not found' });
        return;
      }

      if (series.organizerId !== userId) {
        res.status(403).json({ success: false, error: 'Only the organizer can cancel this series' });
        return;
      }

      if (series.status === RecurringCallSeriesStatus.CANCELLED) {
        res.status(400).json({ success: false, error: 'Series is already cancelled' });
        return;
      }

      const { cancelledCalls } = await recurringCallService.cancelSeries(seriesId);

      logger.info(`Series ${seriesId} cancelled by organizer ${userId}: ${cancelledCalls} future instances cancelled`);
      res.json({ success: true, cancelledCalls });
    } catch (error) {
      logger.error('Failed to cancel recurring series:', error);
      res.status(500).json({ success: false, error: 'Failed to cancel recurring series' });
    }
  };

  // GET /api/calls/user/:userId/scheduled
  getOtherUserScheduledCalls = async (req: Request, res: Response): Promise<void> => {
    try {
      const requesterId = req.user?.id;
      if (!requesterId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { userId } = req.params;
      const { from, to } = req.query;

      if (!from || !to) {
        res.status(400).json({ success: false, error: '`from` and `to` query params are required' });
        return;
      }

      const fromDate = new Date(from as string);
      const toDate = new Date(to as string);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        res.status(400).json({ success: false, error: '`from` and `to` must be valid ISO dates' });
        return;
      }

      const targetUser = await repositories.users.findById(userId!);
      if (!targetUser) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      if (targetUser.workspaceId !== req.user!.workspaceId!) {
        res.status(403).json({ success: false, error: 'Forbidden' });
        return;
      }

      const calls = await repositories.calls.getScheduledCallsForUser(userId!, fromDate, toDate);

      if (targetUser.calendarVisibility === CalendarVisibility.PRIVATE) {
        const busySlots = calls.map(c => ({ startsAt: c.startsAt, endsAt: c.endsAt }));
        res.json({ success: true, calendarVisibility: CalendarVisibility.PRIVATE, calls: busySlots });
        return;
      }

      const safeCalls = calls.map(({ roomLink, transcript, aiSummary, metadata, ...rest }) => rest);
      res.json({ success: true, calendarVisibility: CalendarVisibility.PUBLIC, calls: safeCalls });
    } catch (error) {
      logger.error('Failed to fetch other user scheduled calls:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch scheduled calls' });
    }
  };
}

export const scheduleCallController = new ScheduleCallController();
