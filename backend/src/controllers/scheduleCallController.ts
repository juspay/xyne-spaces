import { Request, Response } from 'express';
import { livekitService } from '@/services/liveKitService';
import { repositories } from '@/database/repositories';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { CallOrigin, CallStatus, CallType } from '@prisma/client';
import { ZodError } from 'zod';
import { scheduledCallNotificationService } from '@/services/scheduledCallNotificationService';
import { ScheduleCallSchema, RecurringScheduleCallSchema, UpdateScheduleCallSchema, UpdateRecurringSeriesSchema } from '@/validators/callValidator';
import { recurringCallService } from '@/services/recurringCallService';
import { addHHMMDuration } from '@/utils/dateUtils';
import rruleLib from 'rrule';
const { RRule } = rruleLib;

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

      // Resolve or create channel
      let finalChannelId = channelId;
      if (!channelId && targetUserIds && targetUserIds.length > 0) {
        finalChannelId = await repositories.channels.findOrCreateDMChannel(
          userId,
          targetUserIds,
          repositories.channelParticipants,
          title,
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

      // inclusive=true so startsOn itself is eligible as the first occurrence
      // notifyParticipants=true so participants get a CALL_SCHEDULED notification for the first instance
      // Series creation and first instance are wrapped in a single transaction for atomicity.
      let firstCallId: string | null = null;
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
        firstCallId = await recurringCallService.createNextInstance(series.id, series.startsOn, true, true, tx);
      });

      logger.info(
        `Recurring series ${seriesId} created by ${userId} — first instance: ${firstCallId ?? 'none'}`,
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

      let finalChannelId = channelId;
      // If no channelId but targetUserIds is provided, find or create DM channel
      if (!channelId && targetUserIds && targetUserIds.length > 0) {
        finalChannelId = await repositories.channels.findOrCreateDMChannel(
          userId,
          targetUserIds,
          repositories.channelParticipants,
          title
        );
      }

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
          title ?? call.title ?? undefined,
        );
        logger.info(`[updateScheduledCall] resolvedChannelId from DM lookup/create=${resolvedChannelId}`);
      } else {
        logger.info(`[updateScheduledCall] no channelId change requested — keeping existing channelId=${call.channelId}`);
      }

      // Compute participant delta when targetUserIds is provided
      let addUserIds: string[] | undefined;
      let removeUserIds: string[] | undefined;

      if (targetUserIds !== undefined) {
        const currentParticipants = await repositories.calls.findParticipants(call.id);
        const currentUserIds = new Set(currentParticipants.map((p) => p.userId));
        // Always keep the organizer in the participant set regardless of what the frontend sends
        const newUserIds = new Set([...targetUserIds, userId]);

        addUserIds = [...newUserIds].filter((id) => !currentUserIds.has(id));
        removeUserIds = [...currentUserIds].filter((id) => !newUserIds.has(id));
        logger.info(`[updateScheduledCall] participant delta | add=${JSON.stringify(addUserIds)} remove=${JSON.stringify(removeUserIds)}`);
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

      // Reschedule Bull jobs if time changed
      if (startsAt !== undefined) {
        try {
          const allParticipants = await repositories.calls.findParticipants(call.id);
          const participantIds = allParticipants.map((p) => p.userId);
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
        const allParticipants = await repositories.calls.findParticipants(call.id);
        const participantIds = allParticipants.map((p) => p.userId);
        await scheduledCallNotificationService.sendCallUpdatedNotifications({
          callId: call.id,
          callExternalId: externalId,
          title: title ?? call.title ?? 'Scheduled Call',
          startsAt: startsAt !== undefined ? new Date(startsAt) : new Date(call.startsAt!),
          endsAt: endsAt !== undefined ? new Date(endsAt) : new Date(call.endsAt!),
          channelId: call.channelId,
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
   * changes to all future SCHEDULED instances. If the recurrence rule or call times
   * change, future SCHEDULED instances are deleted and regenerated.
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
      const { title, recurrenceRule, startTime, endTime, startsOn, endsOn, timezone, targetUserIds, channelId: reqChannelId } = parsedBody;

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
          title ?? series.title ?? undefined,
        );
        logger.info(`[updateRecurringSeries] resolvedChannelId from DM lookup/create=${resolvedChannelId}`);
      } else {
        logger.info(`[updateRecurringSeries] no channelId change — keeping existing channelId=${series.channelId}`);
      }

      // Detect whether recurrence structure changes require instance regeneration
      const ruleChanged = recurrenceRule !== undefined && recurrenceRule !== series.recurrenceRule;
      const startTimeChanged = startTime !== undefined && startTime !== series.startTime;
      const endTimeChanged = endTime !== undefined && endTime !== series.endTime;
      const needsRegeneration = ruleChanged || startTimeChanged || endTimeChanged;

      // Build the series update payload
      const seriesUpdate: Record<string, unknown> = { updatedAt: new Date() };
      if (title !== undefined) seriesUpdate.title = title;
      if (recurrenceRule !== undefined) seriesUpdate.recurrenceRule = recurrenceRule;
      if (startTime !== undefined) seriesUpdate.startTime = startTime;
      if (endTime !== undefined) seriesUpdate.endTime = endTime;
      if (timezone !== undefined) seriesUpdate.timezone = timezone;
      if (endsOn !== undefined) seriesUpdate.endsOn = new Date(endsOn);
      if (resolvedChannelId !== undefined) seriesUpdate.channelId = resolvedChannelId;
      if (startsOn !== undefined) {
        seriesUpdate.startsOn = new Date(startsOn);
      }

      logger.info(`[updateRecurringSeries] seriesUpdate payload=${JSON.stringify(seriesUpdate)}`);

      // Update the series record
      const updatedSeries = await db.recurringCallSeries.update({
        where: { id: seriesId },
        data: seriesUpdate,
      });

      logger.info(`[updateRecurringSeries] series record updated | newChannelId=${updatedSeries.channelId}`);

      const now = new Date();

      // Find all future SCHEDULED instances
      const futureInstances = await db.call.findMany({
        where: {
          recurringSeriesId: seriesId,
          status: CallStatus.SCHEDULED,
          startsAt: { gt: now },
        },
      });

      if (needsRegeneration) {
        // Delete future instances and their participants, remove Bull jobs
        // New instances created by createNextInstance will inherit the updated series channelId
        logger.info(`[updateRecurringSeries] needsRegeneration=true — deleting ${futureInstances.length} future instances`);
        for (const instance of futureInstances) {
          try {
            await scheduledCallNotificationService.removeCallJobs(instance.id);
          } catch (err) {
            logger.error(`Failed to remove Bull jobs for instance ${instance.id}:`, err);
          }
          await db.callParticipant.deleteMany({ where: { callId: instance.id } });
          await db.call.delete({ where: { id: instance.id } });
        }

        // Create the next instance under the new rule
        try {
          await db.$transaction(async (tx) => recurringCallService.createNextInstance(seriesId, now, false, false, tx));
          logger.info(`Regenerated next instance for series ${seriesId} after update`);
        } catch (err) {
          logger.error(`Failed to regenerate next instance for series ${seriesId}:`, err);
        }
      } else {
        // No regeneration needed — cascade title and/or channelId to future instances
        const instanceCascade: Record<string, unknown> = {};
        if (title !== undefined) instanceCascade.title = title;
        if (resolvedChannelId !== undefined) instanceCascade.channelId = resolvedChannelId;

        if (Object.keys(instanceCascade).length > 0 && futureInstances.length > 0) {
          logger.info(`[updateRecurringSeries] cascading ${JSON.stringify(instanceCascade)} to ${futureInstances.length} future instances`);
          await db.call.updateMany({
            where: { id: { in: futureInstances.map((i) => i.id) } },
            data: instanceCascade,
          });
        }

        // Update participants on future instances if targetUserIds provided
        if (targetUserIds !== undefined) {
          for (const instance of futureInstances) {
            const currentParticipants = await repositories.calls.findParticipants(instance.id);
            const currentUserIds = new Set(currentParticipants.map((p) => p.userId));
            // Always keep the series organizer in the participant set
            const newUserIds = new Set([...targetUserIds, userId]);

            const addUserIds = [...newUserIds].filter((id) => !currentUserIds.has(id));
            const removeUserIds = [...currentUserIds].filter((id) => !newUserIds.has(id));

            if (addUserIds.length > 0 || removeUserIds.length > 0) {
              logger.info(`[updateRecurringSeries] updating participants for instance ${instance.id} | add=${JSON.stringify(addUserIds)} remove=${JSON.stringify(removeUserIds)}`);
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
}

export const scheduleCallController = new ScheduleCallController();
