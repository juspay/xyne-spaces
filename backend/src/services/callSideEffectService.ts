import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { notificationService } from '@/services/notificationService';
import { livekitService } from '@/services/liveKitService';
import { activityService } from '@/services/activity/activityService';
import { callTimeoutWorker } from '@/workers/callTimeoutWorker';
import { InvitationResponse, NotificationType, ChannelScopeType } from '@prisma/client';
import { ActivityClassification } from '@xyne/shared';

class CallSideEffectService {
    private logger = logger.child({ module: 'CallSideEffectService' });

    /**
     * Handles logic when a call ends:
     * - Updates invited participants to MISSED
     * - Removes timeout jobs
     * - Sends KILL_UI notifications
     * - Creates missed call activities
     */
    async handleCallEnded(callId: string): Promise<void> {
        this.logger.info(`Handling Call Ended for call: ${callId}`);

        const allParticipants = await db.callParticipant.findMany({
            where: { callId },
        });

        // Filter for invited participants who haven't joined or responded
        const invitedParticipants = allParticipants.filter(
            p => p.response === InvitationResponse.INVITED && p.joinedAt === null && p.userId !== p.invitedBy
        );

        if (invitedParticipants.length === 0) return;

        const call = await db.call.findUnique({
            where: { id: callId },
            select: { externalId: true, channelId: true }
        });

        if (!call) return;

        const now = new Date();

        // 1. Update status to MISSED
        await db.callParticipant.updateMany({
            where: {
                id: { in: invitedParticipants.map(p => p.id) }
            },
            data: {
                response: InvitationResponse.MISSED,
                respondedAt: now
            }
        });

        // 2. Cleanup jobs and notify devices
        await Promise.all(invitedParticipants.map(async (participant) => {
            try {
                await callTimeoutWorker.removeJob(participant.id);

                await notificationService.createNotification(participant.userId, {
                    title: 'Call Dismissed',
                    message: 'Call Dismissed',
                    type: NotificationType.CALL_DISMISS,
                    relatedEntityType: 'call',
                    relatedEntityId: call.externalId,
                    metadata: {
                        action: 'CALL_DISMISS',
                        callId: call.externalId,
                        reason: 'ended'
                    }
                });
                this.logger.info(`Cleaned up participant ${participant.id}: Job removed, KILL_UI sent.`);
            } catch (err) {
                this.logger.error(`Failed to cleanup participant ${participant.id}`, err);
            }
        }));

        // 3. Create Activities
        await activityService.createActivities(invitedParticipants.map(participant => ({
            userId: participant.userId,
            actorAction: 'missed_call',
            actionSource: 'call',
            actionSourceId: call.externalId,
            callId: callId,
            channelId: call.channelId,
            isRead: false,
            createdAt: now,
            classification: ActivityClassification.FYI,
        })));
    }

    /**
     * Handles logic when a participant is invited:
     * - Schedules timeout job
     * - Sends Incoming Call notification
     */
    async handleParticipantInvited(participantId: string): Promise<void> {
        this.logger.info(`Handling Participant Invited: ${participantId}`);

        try {
            const participant = await db.callParticipant.findUnique({
                where: { id: participantId },
                select: {
                    callId: true,
                    userId: true,
                    invitedBy: true,
                    response: true,
                    invitedAt: true
                }
            });

            if (!participant || participant.response !== InvitationResponse.INVITED) {
                return;
            }

            const { callId, userId: recipientId, invitedBy } = participant;
            if (!callId || !recipientId || !invitedBy) return;
            if (recipientId === invitedBy) return;

            // Schedule Timeout Job
            const inviteTime = participant.invitedAt ? new Date(participant.invitedAt).getTime() : Date.now();
            await callTimeoutWorker.addJob(participantId, {
                callId: participant.callId,
                participantId,
                invitedByUserId: invitedBy,
                invitedAt: inviteTime
            });

            // Fetch details for notification
            const caller = await db.user.findUnique({
                where: { id: invitedBy },
                select: { name: true, picture: true }
            });

            const call = await db.call.findUnique({
                where: { id: callId },
                select: { externalId: true, callType: true, roomLink: true, channelId: true }
            });

            if (!call) return;

            const channel = await db.channel.findUnique({
                where: { id: call.channelId },
                select: { scopeType: true }
            });

            if (channel?.scopeType === ChannelScopeType.DEFAULT) {
                this.logger.info(`Skipping notification for DEFAULT scope channel: ${call.channelId}`);
                return;
            }

            const callerName = caller?.name || 'Someone';
            const recipient = await db.user.findUnique({
                where: { id: recipientId },
                select: { name: true }
            });

            const token = await livekitService.generateAccessToken({
                userIdentity: recipientId,
                roomName: call.externalId,
                userName: recipient?.name || 'User',
            });

            const liveKitUrl = livekitService.getServerUrl();

            this.logger.info(`Triggering FCM push for user ${recipientId}, call ${call.externalId}`);

            await notificationService.createFCMNotification(recipientId, {
                title: `Incoming ${call.callType === 'VIDEO' ? 'Video' : 'Audio'} Call`,
                message: `${callerName} is calling you`,
                type: NotificationType.INCOMING_CALL,
                relatedEntityType: 'call',
                relatedEntityId: call.externalId,
                actionUrl: call.roomLink || '',
                metadata: {
                    callId: call.externalId,
                    channelId: call.channelId,
                    callerId: invitedBy,
                    callerName: callerName,
                    callType: call.callType,
                    token: token,
                    liveKitUrl: liveKitUrl,
                    serverUrl: liveKitUrl,
                    roomName: call.externalId,
                }
            });
        } catch (error) {
            this.logger.error(`Failed to handle participant invited for ${participantId}:`, error);
        }
    }

    /**
     * Handles logic when a participant response changes (Invited -> Accepted/Declined):
     * - Removes timeout job
     * - Sends KILL_UI notification (unless MISSED)
     */
    async handleParticipantResponse(participantId: string, newStatus: InvitationResponse): Promise<void> {
        this.logger.info(`Handling Participant Response Change: ${participantId} -> ${newStatus}`);

        if (newStatus === InvitationResponse.MISSED) {
            this.logger.info(`Skipping CALL_DISMISS for MISSED status for ${participantId}`);
            return;
        }

        try {
            await callTimeoutWorker.removeJob(participantId);
            
            const participant = await db.callParticipant.findUnique({
                where: { id: participantId },
            });

            if (!participant) return;

            const call = await db.call.findUnique({
                where: { id: participant.callId }
            });

            if (!call) return;

            await notificationService.createNotification(participant.userId, {
                title: 'Call Dismissed',
                message: 'Call Dismissed',
                type: NotificationType.CALL_DISMISS,
                relatedEntityType: 'call',
                relatedEntityId: call.externalId,
                metadata: {
                    action: 'CALL_DISMISS',
                    callId: call.externalId,
                    reason: newStatus === InvitationResponse.ACCEPTED ? 'answered' : 'declined'
                }
            });

            this.logger.info(`Handled response change for ${participantId}: Job removed, CALL_DISMISS sent.`);

        } catch (error) {
            this.logger.error(`Failed to handle response change for ${participantId}:`, error);
        }
    }
}

export const callSideEffectService = new CallSideEffectService();
