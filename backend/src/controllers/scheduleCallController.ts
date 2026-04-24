import { Request, Response } from 'express';
import { livekitService } from '@/services/liveKitService';
import { repositories } from '@/database/repositories';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { CallOrigin, CallStatus, CallType, RecurringCallSeriesStatus } from '@prisma/client';
import { ZodError } from 'zod';
import { scheduledCallNotificationService } from '@/services/scheduledCallNotificationService';
import { ScheduleCallSchema, RecurringScheduleCallSchema, UpdateScheduleCallSchema, UpdateRecurringSeriesSchema, CancelScheduledCallSchema, CancelRecurringSeriesSchema } from '@/validators/callValidator';
import { recurringCallService } from '@/services/recurringCallService';
import { addHHMMDuration } from '@/utils/dateUtils';
import rruleLib from 'rrule';
const { RRule } = rruleLib;

// Number of milliseconds to buffer recurring call instances ahead of time (60 days)
const INSTANCE_BUFFER_DAYS = 60 * 24 * 60 * 60 * 1000;

/**
 * If the RRULE contains UNTIL or COUNT, derive the effective end date so that
 * the series.endsOn is always populated — even when the frontend didn't send
 * an explicit endsOn value.
 */
function deriveEndsOnFromRRule(recurrenceRule: string, startsOn: Date): Date | null {
  try {
    const options = RRule.parseString(recurrenceRule);
    options.dtstart = startsOn;
    const rule = new RRule(options);
    if (options.until) {
      // UNTIL date is already the last allowed occurrence date
      return new Date(options.until);
    }
    if (options.count) {
      // Enumerate all occurrences and take the last one
      const all = rule.all();
      return all.length > 0 ? all[all.length - 1]! : null;
    }
    return null;
  } catch {
    return null;
  }
}

export class ScheduleCallController {
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
        timezone,
        recurrenceRule,
        startTime,
        endTime,
        startsOn,
        endsOn,
      } = RecurringScheduleCallSchema.parse(req.body);

      // update-channel mode: channelId is the broadcast channel, targetUserIds are the actual participants
      const isUpdateChannelMode = !!(channelId && targetUserIds?.length);

      let finalChannelId = channelId;
      if (!channelId && targetUserIds?.length) {
        finalChannelId = await repositories.channels.findOrCreateDMChannel(
          userId,
          targetUserIds,
          repositories.channelParticipants,
          req.user!.workspaceId!,
          title,
        );
      }

      // Always include the organizer in the participant list
      const finalTargetUserIds = isUpdateChannelMode
        ? [...new Set([userId, ...targetUserIds!])]
        : undefined;

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

      // Create series and pre-create all instances for the next 60 days
      // Only the first upcoming instance notifies participants (to avoid spam)
      let createdCallIds: string[] = [];
      await dbClient.$transaction(async (tx) => {
        const series = await tx.recurringCallSeries.create({
          data: {
            id: seriesId,
            title,
            description,
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
          },
        });

        // Pre-create all instances for the next buffer period
        const fromDate = new Date(startsOn);
        const toDate = new Date(Date.now() + INSTANCE_BUFFER_DAYS);
        const finalToDate = resolvedEndsOn && resolvedEndsOn < toDate ? resolvedEndsOn : toDate;

        createdCallIds = await recurringCallService.createInstancesForDateRange(
          series,
          fromDate,
          finalToDate,
          tx,
          finalTargetUserIds,
        );
      });

      logger.info(
        `Recurring series ${seriesId} created by ${userId} — ${createdCallIds.length} instances pre-created`,
      );

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
      const { title, startsAt, endsAt, channelId, targetUserIds } = ScheduleCallSchema.parse(req.body);

      // update-channel mode: channelId is the broadcast channel, targetUserIds are the actual participants
      const isUpdateChannelMode = !!(channelId && targetUserIds?.length);

      let finalChannelId = channelId;
      if (!channelId && targetUserIds?.length) {
        finalChannelId = await repositories.channels.findOrCreateDMChannel(
          userId,
          targetUserIds,
          repositories.channelParticipants,
          req.user!.workspaceId!,
          title
        );
      }

      // Always include the organizer in the participant list
      const finalTargetUserIds = isUpdateChannelMode
        ? [...new Set([userId, ...targetUserIds!])]
        : undefined;

      // Generate IDs
      const callId = uuidv4();
      const externalId = uuidv4();

      // Generate room link for scheduled call
      const roomLink = `${livekitService.getClientUrl()}/call/${externalId}?type=${CallType.AUDIO}`;

      // Create the scheduled call and participants atomically via repository
      const db = DatabaseClient.getInstance();
      const { participantUserIds } = await db.$transaction(async (tx) => repositories.calls.createCallWithParticipants({
        callId,
        externalId,
        title,
        createdByUserId: userId,
        channelId: finalChannelId!,
        callType: CallType.AUDIO,
        callOrigin: CallOrigin.CHANNEL,
        roomLink,
        timezone: 'UTC',
        isRecurring: false,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        ...(finalTargetUserIds && { targetUserIds: finalTargetUserIds }),
      }, tx));

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
      logger.error('Failed to schedule call:', error);
      res.status(500).json({ success: false, error: 'Failed to schedule call' });
    }
  };

  /**
   * PATCH /api/calls/:callId
   * Update a single SCHEDULED call instance (title, time, participants).
   * Only the organizer can edit. Only SCHEDULED calls may be edited.
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
      const { title, startsAt, endsAt, targetUserIds, channelId: reqChannelId } = parsedBody;

      logger.info(`[updateScheduledCall] request | externalId=${externalId} userId=${userId} reqChannelId=${reqChannelId} targetUserIds=${JSON.stringify(targetUserIds)} title=${title} startsAt=${startsAt} endsAt=${endsAt}`);

      const call = await repositories.calls.findByExternalId(externalId);
      if (!call) {
        logger.warn(`[updateScheduledCall] call not found | externalId=${externalId}`);
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      logger.info(`[updateScheduledCall] call found | callId=${call.id} currentChannelId=${call.channelId} status=${call.status} organizer=${call.createdByUserId}`);

      if (call.createdByUserId !== userId) {
        res.status(403).json({ success: false, error: 'Only the organizer can edit a scheduled call' });
        return;
      }

      if (call.status !== CallStatus.SCHEDULED) {
        res.status(400).json({ success: false, error: 'Only SCHEDULED calls can be edited' });
        return;
      }

      // Resolve the channel: explicit channelId → find/create DM from targetUserIds → keep existing
      let resolvedChannelId: string | undefined;
      if (reqChannelId) {
        resolvedChannelId = reqChannelId;
        logger.info(`[updateScheduledCall] using explicit channelId=${resolvedChannelId}`);
      } else if (targetUserIds !== undefined && targetUserIds.length > 0) {
        logger.info(`[updateScheduledCall] resolving DM channel for targetUserIds=${JSON.stringify(targetUserIds)}`);
        resolvedChannelId = await repositories.channels.findOrCreateDMChannel(
          userId,
          targetUserIds,
          repositories.channelParticipants,
          req.user!.workspaceId!,
          title ?? call.title ?? undefined,
        );
        logger.info(`[updateScheduledCall] resolvedChannelId from DM lookup/create=${resolvedChannelId}`);
      } else {
        logger.info(`[updateScheduledCall] no channelId change requested — keeping existing channelId=${call.channelId}`);
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
          targetUserIds,
          resolvedChannelId ?? call.channelId ?? '',
          '[updateScheduledCall]',
        ));
      }

      logger.info(`[updateScheduledCall] calling updateScheduledCall repo | callId=${call.id} resolvedChannelId=${resolvedChannelId}`);

      await repositories.calls.updateScheduledCall({
        callId: call.id,
        title,
        startsAt: startsAt !== undefined ? new Date(startsAt) : undefined,
        endsAt: endsAt !== undefined ? new Date(endsAt) : undefined,
        channelId: resolvedChannelId,
        addUserIds,
        removeUserIds,
      });

      logger.info(`[updateScheduledCall] repo update complete | callId=${call.id} resolvedChannelId=${resolvedChannelId}`);

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
   * Only the organizer can edit. Updates the series record and cascades title/time
   * changes to ALL SCHEDULED instances in the series. If the recurrence rule or call times
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
      const { title, recurrenceRule, startTime, endTime, endsOn, timezone, targetUserIds, channelId: reqChannelId } = parsedBody;

      logger.info(`[updateRecurringSeries] request | seriesId=${seriesId} userId=${userId} reqChannelId=${reqChannelId} targetUserIds=${JSON.stringify(targetUserIds)} title=${title}`);

      const db = DatabaseClient.getInstance();
      const series = await db.recurringCallSeries.findUnique({ where: { id: seriesId } });

      if (!series) {
        res.status(404).json({ success: false, error: 'Series not found' });
        return;
      }

      logger.info(`[updateRecurringSeries] series found | currentChannelId=${series.channelId} organizerId=${series.organizerId}`);

      if (series.organizerId !== userId) {
        res.status(403).json({ success: false, error: 'Only the organizer can edit this series' });
        return;
      }

      if (series.status === 'CANCELLED') {
        res.status(400).json({ success: false, error: 'Cannot edit a cancelled series' });
        return;
      }

      // Resolve the channel: explicit channelId → find/create DM from targetUserIds → keep existing
      let resolvedChannelId: string | undefined;
      if (reqChannelId) {
        resolvedChannelId = reqChannelId;
        logger.info(`[updateRecurringSeries] using explicit channelId=${resolvedChannelId}`);
      } else if (targetUserIds !== undefined && targetUserIds.length > 0) {
        logger.info(`[updateRecurringSeries] resolving DM channel for targetUserIds=${JSON.stringify(targetUserIds)}`);
        resolvedChannelId = await repositories.channels.findOrCreateDMChannel(
          userId,
          targetUserIds,
          repositories.channelParticipants,
          req.user!.workspaceId!,
          title ?? series.title ?? undefined,
        );
        logger.info(`[updateRecurringSeries] resolvedChannelId from DM lookup/create=${resolvedChannelId}`);
      } else {
        logger.info(`[updateRecurringSeries] no channelId change — keeping existing channelId=${series.channelId}`);
      }

      // Detect whether recurrence structure changes require instance regeneration.
      // Only recurrenceRule changes require delete+regenerate.
      const ruleChanged = recurrenceRule !== undefined && recurrenceRule !== series.recurrenceRule;
      const needsRegeneration = ruleChanged;

      // Build the series update payload
      const seriesUpdate: Record<string, unknown> = { updatedAt: new Date() };
      if (title !== undefined) seriesUpdate.title = title;
      if (recurrenceRule !== undefined) seriesUpdate.recurrenceRule = recurrenceRule;
      if (startTime !== undefined) seriesUpdate.startTime = startTime;
      if (endTime !== undefined) seriesUpdate.endTime = endTime;
      if (timezone !== undefined) seriesUpdate.timezone = timezone;
      if (endsOn !== undefined) seriesUpdate.endsOn = new Date(endsOn);
      if (resolvedChannelId !== undefined) seriesUpdate.channelId = resolvedChannelId;
      // NOTE: We intentionally do NOT update startsOn. The original series.startsOn is the
      // RRULE dtstart anchor and must remain unchanged. The frontend may send startsOn as the
      // instance date, but overwriting the series start would corrupt the recurrence calculation.

      logger.info(`[updateRecurringSeries] seriesUpdate payload=${JSON.stringify(seriesUpdate)}`);

      // Update the series record
      const updatedSeries = await db.recurringCallSeries.update({
        where: { id: seriesId },
        data: seriesUpdate,
      });

      logger.info(`[updateRecurringSeries] series record updated | newChannelId=${updatedSeries.channelId}`);


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
        await recurringCallService.regenerateFutureInstances(seriesForRegeneration, baseDate);
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

          for (const instance of allScheduledInstances) {
            // Calculate new startsAt by applying new startTime to the existing date
            const existingStart = instance.startsAt!;
            const existingEnd = instance.endsAt!;
            const newStartsAt = new Date(existingStart);
            const [newStartHours, newStartMinutes] = newStartTime.split(':').map(Number);
            newStartsAt.setHours(newStartHours, newStartMinutes, 0, 0);

            const newEndsAt = new Date(existingEnd);
            const [newEndHours, newEndMinutes] = newEndTime.split(':').map(Number);
            newEndsAt.setHours(newEndHours, newEndMinutes, 0, 0);

            // Update startsAt and endsAt in-place
            await db.call.update({
              where: { id: instance.id },
              data: { startsAt: newStartsAt, endsAt: newEndsAt },
            });

            instancesNeedingTimeUpdate.push({
              id: instance.id,
              externalId: instance.externalId,
              startsAt: newStartsAt,
              endsAt: newEndsAt,
            });

            logger.info(`[updateRecurringSeries] updated instance ${instance.id} time: ${existingStart.toISOString()} -> ${newStartsAt.toISOString()}`);
          }
        }

        if (Object.keys(instanceCascade).length > 0 && allScheduledInstances.length > 0) {
          logger.info(`[updateRecurringSeries] cascading ${JSON.stringify(instanceCascade)} to ${allScheduledInstances.length} instances`);
          await db.call.updateMany({
            where: { id: { in: allScheduledInstances.map((i) => i.id) } },
            data: instanceCascade,
          });
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

        // Update participants on ALL scheduled instances if targetUserIds provided, OR if the
        // channel changed without explicit targetUserIds (use the new channel's members).
        const seriesChannelChanged = resolvedChannelId !== undefined && resolvedChannelId !== series.channelId;

        if (targetUserIds !== undefined || seriesChannelChanged) {
          const effectiveChannelIdForDelta = resolvedChannelId ?? series.channelId;
          for (const instance of allScheduledInstances) {
            const { addUserIds, removeUserIds } = await this.resolveParticipantDelta(
              instance.id,
              userId,
              targetUserIds,
              effectiveChannelIdForDelta,
              `[updateRecurringSeries] instance=${instance.id}`,
            );
            if (addUserIds.length > 0 || removeUserIds.length > 0) {
              await repositories.calls.updateScheduledCall({
                callId: instance.id,
                addUserIds: addUserIds.length > 0 ? addUserIds : undefined,
                removeUserIds: removeUserIds.length > 0 ? removeUserIds : undefined,
              });
            }
          }
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
        const channelParticipants = await repositories.channelParticipants.getChannelParticipants(
          effectiveChannelId,
        );
        const participantIds = channelParticipants.map((p) => p.userId);

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

      const db = DatabaseClient.getInstance();
      const series = await db.recurringCallSeries.findUnique({ where: { id: seriesId } });

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
}

export const scheduleCallController = new ScheduleCallController();
