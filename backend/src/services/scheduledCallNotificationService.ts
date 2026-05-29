import Bull from 'bull';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { notificationService } from '@/services/notificationService';
import { activityService } from '@/services/activity/activityService';
import { CallStatus, NotificationType, ActivityClassification, InvitationResponse, MeetingStatus } from '@prisma/client';
import { formatDateTimeShort } from '@/utils/dateUtils';
import { recurringCallService } from '@/services/recurringCallService';
import { db } from '@/database/client';

interface ScheduledCallReminderData {
  callId: string;
  callExternalId: string;
  title: string;
  startsAt: Date;
  participantIds: string[];
}

interface ScheduledCallAutoEndData {
  callId: string;
  callExternalId: string;
  endsAt: Date;
}

/**
 * Scheduled Call Notification Service
 * 
 * Manages scheduled reminders for calls using Redis job queue (Bull).
 * Sends notifications 10 minutes before a scheduled call starts to:
 * - Electron app (desktop)
 * - Mobile app
 * 
 * Similar to Google Calendar reminders.
 */
class ScheduledCallNotificationService {
  private queue: Bull.Queue<ScheduledCallReminderData | ScheduledCallAutoEndData>;
  private readonly REMINDER_MINUTES_BEFORE = 10;
  private isInitialized = false;

  constructor() {
    // Use the same Redis configuration as other services
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
      ...(process.env.REDIS_TLS === 'true' && {
        tls: {
          rejectUnauthorized: false,
        },
      }),
    };

    // Create dedicated queue for scheduled call reminders
    this.queue = new Bull('scheduled-call-reminders', { redis: redisConfig });

    logger.info('📅 Scheduled Call Notification Service created');
  }

  /**
   * Initialize the worker to process scheduled reminders
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Scheduled call notification service already initialized');
      return;
    }

    // Set up the worker to process reminder jobs
    this.queue.process('call-reminder', async (job) => {
      const { callId, callExternalId, title, startsAt, participantIds } = job.data as ScheduledCallReminderData;

      logger.info(`📢 Processing call reminder for call ${callExternalId}`, {
        callId,
        title,
        startsAt,
        participantCount: participantIds.length,
      });

      try {
        // Verify the call still exists and is scheduled
        const call = await repositories.calls.findByExternalId(callExternalId);

        if (!call) {
          logger.warn(`Call ${callId} not found, skipping reminder`);
          return;
        }

        if (call.status === CallStatus.CANCELLED) {
          logger.info(`Call ${callId} has been cancelled, skipping reminder`);
          return;
        }

        // Filter out participants who declined, hidden the call, or have already joined
        const [declinedUserIds, hiddenUserIds, joinedUserIds] = await Promise.all([
          repositories.calls.getParticipantIdsByMeetingStatus(callId, MeetingStatus.DECLINED),
          repositories.calls.getParticipantIdsByMeetingStatus(callId, MeetingStatus.HIDDEN),
          repositories.calls.getParticipantIdsByResponse(callId, InvitationResponse.ACCEPTED),
        ]);
        const excludedUserIdsSet = new Set([...declinedUserIds, ...hiddenUserIds, ...joinedUserIds]);

        // Send reminders to everyone except those who said NO, hidden the call, or are already in the call
        const participantsToRemind = participantIds.filter(id => !excludedUserIdsSet.has(id));

        if (participantsToRemind.length === 0) {
          logger.info(`All participants for call ${callExternalId} have either declined, hidden, or already joined, skipping reminders`);
          return;
        }

        if (declinedUserIds.length > 0) {
          logger.info(`Skipping reminder for ${declinedUserIds.length} participant(s) who declined RSVP for call ${callExternalId}`);
        }
        if (hiddenUserIds.length > 0) {
          logger.info(`Skipping reminder for ${hiddenUserIds.length} participant(s) who hid call ${callExternalId}`);
        }
        if (joinedUserIds.length > 0) {
          logger.info(`Skipping reminder for ${joinedUserIds.length} participant(s) who already joined call ${callExternalId}`);
        }

        // Send notification to participants not currently in the call
        await this.sendRemindersToParticipants(call, participantsToRemind);

        logger.info(`✅ Successfully sent reminders for call ${callExternalId} to ${participantsToRemind.length} participants`);
      } catch (error) {
        logger.error(`Failed to send reminders for call ${callId}:`, error);
        throw error; // Bull will retry based on configuration
      }
    });

    // Set up the worker to process auto-end jobs
    this.queue.process('call-auto-end', async (job) => {
      const { callId, callExternalId, endsAt } = job.data as ScheduledCallAutoEndData;

      logger.info(`⏰ Processing auto-end for call ${callExternalId}`, {
        callId,
        endsAt,
      });

      try {
        // Verify the call still exists
        const call = await repositories.calls.findByExternalId(callExternalId);

        if (!call) {
          logger.warn(`Call ${callId} not found, skipping auto-end`);
          return;
        }

        // ── Attempt to end the call if applicable ──
        if (call.status === CallStatus.CANCELLED) {
          logger.info(`Call ${callId} has been cancelled, skipping auto-end attempt`);
        } else if (call.status === CallStatus.SCHEDULED) {
          const participants = await repositories.calls.findParticipantsWithStatus(callId);
          const activeParticipants = participants.filter(
            (p) => p.response === InvitationResponse.ACCEPTED,
          );

          if (activeParticipants.length > 0) {
            logger.info(
              `Call ${callId} has ${activeParticipants.length} active participant(s) at endsAt — not ending`,
            );
          } else {
            await repositories.calls.update(callId, { status: CallStatus.ENDED });
            logger.info(`✅ Auto-ended call ${callExternalId} — no active participants at scheduled end time`);
          }
        } else {
          logger.info(`Call ${callId} status is ${call.status} — skipping auto-end`);
        }

        // ── Buffer replenishment for recurring series ──
        // After an instance ends, trigger buffer replenishment to maintain 60-day count
        // AND schedule Bull jobs for the next instance (lazy job creation)
        if (call.recurringSeriesId) {
          try {
            await recurringCallService.replenishInstanceBuffer(call.recurringSeriesId);
            logger.info(`📅 Replenished instance buffer for series ${call.recurringSeriesId}`);
          } catch (replenishError) {
            logger.error(
              `Failed to replenish instance buffer for series ${call.recurringSeriesId}:`,
              replenishError,
            );
          }

          // Schedule Bull jobs for the next instance in the series
          try {
            await recurringCallService.scheduleJobsForNextInstance(call.recurringSeriesId, call.endsAt || endsAt);
            logger.info(`📅 Scheduled Bull jobs for next instance in series ${call.recurringSeriesId}`);
          } catch (scheduleError) {
            logger.error(
              `Failed to schedule jobs for next instance in series ${call.recurringSeriesId}:`,
              scheduleError,
            );
          }
        }
      } catch (error) {
        logger.error(`Failed to auto-end call ${callId}:`, error);
        throw error; // Bull will retry based on configuration
      }
    });

    // Event handlers
    this.queue.on('completed', (job) => {
      logger.info(`✅ Reminder job completed for call`, {
        jobId: job.id,
        callExternalId: job.data.callExternalId,
      });
    });

    this.queue.on('failed', (job, err) => {
      logger.error(`❌ Reminder job failed for call`, {
        jobId: job.id,
        callExternalId: job.data?.callExternalId,
        error: err.message,
      });
    });

    this.queue.on('stalled', (job) => {
      logger.warn(`⚠️  Reminder job stalled for call`, {
        jobId: job.id,
        callExternalId: job.data?.callExternalId,
      });
    });

    this.isInitialized = true;
    logger.info('📅 Scheduled Call Notification Service initialized');
  }

  /**
   * Schedule a reminder for a call
   * 
   * @param callId - Internal database ID of the call
   * @param callExternalId - External/public ID of the call
   * @param title - Title of the call
   * @param startsAt - When the call starts
   * @param participantIds - Array of user IDs to notify
   */
  async scheduleCallReminder(
    callId: string,
    callExternalId: string,
    title: string,
    startsAt: Date,
    participantIds: string[]
  ): Promise<void> {
    if (!this.isInitialized) {
      logger.warn('Scheduled call notification service not initialized');
      return;
    }

    try {
      // Calculate when to send the reminder (10 minutes before start)
      const reminderTime = new Date(startsAt.getTime() - this.REMINDER_MINUTES_BEFORE * 60 * 1000);
      const now = new Date();

      // Don't schedule if the reminder time is in the past
      if (reminderTime <= now) {
        logger.info(`Reminder time for call ${callExternalId} is in the past, skipping`, {
          reminderTime,
          startsAt,
        });
        return;
      }

      const delay = reminderTime.getTime() - now.getTime();

      // Create the job with delay
      const job = await this.queue.add(
        'call-reminder',
        {
          callId,
          callExternalId,
          title: title || 'Scheduled Call',
          startsAt,
          participantIds,
        },
        {
          delay, // Delay in milliseconds
          jobId: `call-reminder-${callId}`, // Unique job ID to prevent duplicates
          removeOnComplete: true,
          removeOnFail: false,
          attempts: 3, // Retry up to 3 times on failure
          backoff: {
            type: 'exponential',
            delay: 5000, // Start with 5 second delay
          },
        }
      );

      logger.info(`📅 Scheduled reminder for call ${callExternalId}`, {
        callId,
        title,
        reminderTime: reminderTime.toISOString(),
        startsAt: startsAt.toISOString(),
        participantCount: participantIds.length,
        delayMs: delay,
        jobId: job.id,
      });
    } catch (error) {
      logger.error(`Failed to schedule reminder for call ${callId}:`, error);
      throw error;
    }
  }

  /**
   * Schedule an auto-end job for a call
   * This job will run at the exact endsAt time and mark the call as ENDED if no one is there
   * 
   * @param callId - Internal database ID of the call
   * @param callExternalId - External/public ID of the call
   * @param endsAt - When the call is scheduled to end
   */
  async scheduleCallAutoEnd(
    callId: string,
    callExternalId: string,
    endsAt: Date
  ): Promise<void> {
    if (!this.isInitialized) {
      logger.warn('Scheduled call notification service not initialized');
      return;
    }

    try {
      const now = new Date();

      // Don't schedule if the end time is in the past
      if (endsAt <= now) {
        logger.info(`End time for call ${callExternalId} is in the past, skipping auto-end schedule`, {
          endsAt,
        });
        return;
      }

      const delay = endsAt.getTime() - now.getTime();

      // Create the job with delay
      const job = await this.queue.add(
        'call-auto-end',
        {
          callId,
          callExternalId,
          endsAt,
        },
        {
          delay, // Delay in milliseconds
          jobId: `call-auto-end-${callId}`, // Unique job ID to prevent duplicates
          removeOnComplete: true,
          removeOnFail: false,
          attempts: 3, // Retry up to 3 times on failure
          backoff: {
            type: 'exponential',
            delay: 5000, // Start with 5 second delay
          },
        }
      );

      logger.info(`⏰ Scheduled auto-end for call ${callExternalId}`, {
        callId,
        endsAt: endsAt.toISOString(),
        delayMs: delay,
        jobId: job.id,
      });
    } catch (error) {
      logger.error(`Failed to schedule auto-end for call ${callId}:`, error);
      throw error;
    }
  }

  /**
   * Send immediate CALL_SCHEDULED notifications + create activities for all participants
   * when a call is first scheduled. Excludes the organizer.
   *
   * Called directly from the controller right after the call is created.
   */
  async sendScheduledCallNotifications(params: {
    callId: string;
    callExternalId: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    channelId: string;
    organizerUserId: string;
    participantUserIds: string[];
  }): Promise<void> {
    const { callId, callExternalId, title, startsAt, endsAt, channelId, organizerUserId, participantUserIds } = params;

    // Exclude the organizer from notifications and activities
    const participantsToNotify = participantUserIds.filter((id) => id !== organizerUserId);

    if (participantsToNotify.length === 0) return;

    const startTime = formatDateTimeShort(new Date(startsAt));

    // Fetch workspaceId for notification URL
    const workspaceId = await repositories.channels.getWorkspaceId(channelId);

    // Send notification to each participant
    const notificationPromises = participantsToNotify.map(async (participantId) => {
      try {
        await notificationService.createNotification(participantId, {
          type: 'CALL_SCHEDULED' as NotificationType,
          title: `📅 ${title}`,
          message: `You have a scheduled call "${title}" at ${startTime}`,
          relatedEntityType: 'call',
          relatedEntityId: callExternalId,
          actionUrl: `/${workspaceId}/calls?tab=upcoming&callId=${callId}`,
          metadata: {
            callId,
            callExternalId,
            startsAt,
            endsAt,
            startTime,
          },
        });
      } catch (error) {
        logger.error(`Failed to send scheduled notification to user ${participantId}:`, error);
      }
    });

    await Promise.all(notificationPromises);
    logger.info(`Sent CALL_SCHEDULED notifications for call ${callExternalId} to ${participantsToNotify.length} participants`);

    // Create activities for all notified participants in batch
    try {
      await activityService.createActivities(
        participantsToNotify.map((participantId) => ({
          userId: participantId,
          actorId: organizerUserId,
          actorAction: 'scheduled_call',
          actionSource: 'call',
          actionSourceId: callExternalId,
          callId,
          channelId,
          classification: ActivityClassification.FYI,
        }))
      );
      logger.info(`Created scheduled_call activities for ${participantsToNotify.length} participants`);
    } catch (activityError) {
      logger.error(`Failed to create activities for scheduled call ${callId}:`, activityError);
    }
  }

  /**
   * Send reminders to all participants
   */
  private async sendRemindersToParticipants(call: any, participantIds: string[]): Promise<void> {
    const minutesUntilStart = this.REMINDER_MINUTES_BEFORE;
    const title = call.title || 'Scheduled Call';

    const startTime = formatDateTimeShort(new Date(call.startsAt));

    // Fetch workspaceId for notification URL
    const workspaceId = await repositories.channels.getWorkspaceId(call.channelId);

    // Send notification + create activity for each participant
    const notificationPromises = participantIds.map(async (userId) => {
      try {
        // Use CALL_SCHEDULED type to match the initial scheduled notification format
        await notificationService.createNotification(userId, {
          type: NotificationType.CALL_REMINDER,
          title: `📅 ${title}`,
          message: `Your call "${title}" starts in ${minutesUntilStart} minutes at ${startTime}`,
          relatedEntityType: 'call',
          relatedEntityId: call.externalId,
          actionUrl: `/${workspaceId}/calls?tab=upcoming&callId=${call.id}`,
          metadata: {
            callId: call.id,
            callExternalId: call.externalId,
            startsAt: call.startsAt,
            endsAt: call.endsAt,
            startTime,
          },
        });

        // Create a corresponding activity for this reminder
        await activityService.createActivity({
          userId,
          actorId: call.createdByUserId,
          actorAction: 'call_reminder',
          actionSource: 'call',
          actionSourceId: call.externalId,
          callId: call.id,
          channelId: call.channelId,
          classification: ActivityClassification.FYI,
        });

        logger.debug(`Sent reminder + created activity for user ${userId} for call ${call.externalId}`);
      } catch (error) {
        logger.error(`Failed to send reminder to user ${userId}:`, error);
        // Continue with other participants even if one fails
      }
    });

    await Promise.all(notificationPromises);
  }

  /**
   * Cleanup - close the queue
   */
  async shutdown(): Promise<void> {
    try {
      await this.queue.close();
      this.isInitialized = false;
      logger.info('📅 Scheduled Call Notification Service shutdown completed');
    } catch (error) {
      logger.error('Error during scheduled call notification service shutdown:', error);
    }
  }

  /**
   * Remove the Bull reminder job for a call (used before rescheduling).
   */
  private async removeReminderJob(callId: string): Promise<void> {
    try {
      const job = await this.queue.getJob(`call-reminder-${callId}`);
      if (job) {
        await job.remove();
        logger.info(`🗑️  Removed existing reminder job for call ${callId}`);
      }
    } catch (error) {
      logger.warn(`Failed to remove reminder job for call ${callId}:`, error);
    }
  }

  /**
   * Remove the Bull auto-end job for a call (used before rescheduling).
   */
  private async removeAutoEndJob(callId: string): Promise<void> {
    try {
      const job = await this.queue.getJob(`call-auto-end-${callId}`);
      if (job) {
        await job.remove();
        logger.info(`🗑️  Removed existing auto-end job for call ${callId}`);
      }
    } catch (error) {
      logger.warn(`Failed to remove auto-end job for call ${callId}:`, error);
    }
  }

  /**
   * Remove both Bull jobs (reminder + auto-end) for a call.
   * Used when deleting call instances during a series update.
   */
  async removeCallJobs(callId: string): Promise<void> {
    await Promise.all([this.removeReminderJob(callId), this.removeAutoEndJob(callId)]);
  }

  /**
   * Reschedule the reminder job for a call after its start time has changed.
   */
  async rescheduleCallReminder(
    callId: string,
    callExternalId: string,
    title: string,
    newStartsAt: Date,
    participantIds: string[],
  ): Promise<void> {
    await this.removeReminderJob(callId);
    await this.scheduleCallReminder(callId, callExternalId, title, newStartsAt, participantIds);
  }

  /**
   * Reschedule the auto-end job for a call after its end time has changed.
   */
  async rescheduleCallAutoEnd(
    callId: string,
    callExternalId: string,
    newEndsAt: Date,
  ): Promise<void> {
    await this.removeAutoEndJob(callId);
    await this.scheduleCallAutoEnd(callId, callExternalId, newEndsAt);
  }

  /**
   * Send CALL_SCHEDULED notifications to all participants informing them that a
   * scheduled call has been updated (title, time, or participant list changed).
   * Excludes the organizer. Uses CALL_SCHEDULED notification type with an
   * "updated" message so existing notification rendering is reused.
   */
  async sendCallUpdatedNotifications(params: {
    callId: string;
    callExternalId: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    channelId: string;
    organizerUserId: string;
    participantUserIds: string[];
  }): Promise<void> {
    const { callId, callExternalId, title, startsAt, endsAt, channelId, organizerUserId, participantUserIds } = params;

    const participantsToNotify = participantUserIds.filter((id) => id !== organizerUserId);
    if (participantsToNotify.length === 0) return;

    const startTime = formatDateTimeShort(new Date(startsAt));

    // Fetch workspaceId for notification URL
    const workspaceId = await repositories.channels.getWorkspaceId(channelId);

    const notificationPromises = participantsToNotify.map(async (participantId) => {
      try {
        await notificationService.createNotification(participantId, {
          type: NotificationType.CALL_UPDATED,
          title: `📅 ${title} (Updated)`,
          message: `The scheduled call "${title}" has been updated — new time: ${startTime}`,
          relatedEntityType: 'call',
          relatedEntityId: callExternalId,
          actionUrl: `/${workspaceId}/calls?tab=upcoming&callId=${callId}`,
          metadata: {
            callId,
            callExternalId,
            startsAt,
            endsAt,
            startTime,
            isUpdate: true,
          },
        });
      } catch (error) {
        logger.error(`Failed to send update notification to user ${participantId}:`, error);
      }
    });

    await Promise.all(notificationPromises);
    logger.info(`Sent CALL_UPDATED notifications for call ${callExternalId} to ${participantsToNotify.length} participants`);

    try {
      await activityService.createActivities(
        participantsToNotify.map((participantId) => ({
          userId: participantId,
          actorId: organizerUserId,
          actorAction: 'call_updated',
          actionSource: 'call',
          actionSourceId: callExternalId,
          callId,
          channelId,
          classification: ActivityClassification.FYI,
        }))
      );
    } catch (activityError) {
      logger.error(`Failed to create update activities for call ${callId}:`, activityError);
    }
   }

   /**
    * Update meeting status (RSVP) for a participant, with optional series update.
    * Also creates a meeting_accepted/meeting_declined activity for the organizer
    * when the responder is not the organizer themselves.
    */
   async updateParticipantMeetingStatus(params: {
     participantId: string;
     meetingStatus: MeetingStatus;
     respondedAt: Date;
     isSeries: boolean;
     recurringSeriesId?: string;
     userId: string;
     // For activity creation
     organizerId: string;
     callId: string;
     callExternalId: string;
     channelId?: string;
   }): Promise<number> {
     const { participantId, meetingStatus, respondedAt, isSeries, recurringSeriesId, userId,
             organizerId, callId, callExternalId, channelId } = params;
     let updatedCount = 1;

     await db.$transaction(async (tx) => {
       await repositories.calls.updateParticipantMeetingStatus(participantId, meetingStatus, respondedAt, tx);

       if (isSeries && recurringSeriesId) {
         updatedCount = await repositories.calls.updateRecurringSeriesMeetingStatus({
           recurringSeriesId,
           userId,
           meetingStatus,
           respondedAt,
           tx,
         });
       }
     });

     // Create activity for the organizer when a participant accepts or declines
     if (userId !== organizerId &&
         (meetingStatus === MeetingStatus.ACCEPTED || meetingStatus === MeetingStatus.DECLINED)) {
       try {
         await activityService.createActivity({
           userId: organizerId,
           actorId: userId,
           actorAction: meetingStatus === MeetingStatus.ACCEPTED ? 'meeting_accepted' : 'meeting_declined',
           actionSource: 'call',
           actionSourceId: callExternalId,
           callId,
           channelId,
           classification: ActivityClassification.FYI,
         });
       } catch (activityErr) {
         logger.error(`Failed to create meeting_${meetingStatus === MeetingStatus.ACCEPTED ? 'accepted' : 'declined'} activity:`, activityErr);
       }
     }

     return updatedCount;
   }
 }
 
 // Export singleton instance
 export const scheduledCallNotificationService = new ScheduledCallNotificationService();
