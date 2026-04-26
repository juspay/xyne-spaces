import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { notificationService } from '@/services/notificationService';
import { livekitService } from '@/services/liveKitService';
import { activityService } from '@/services/activity/activityService';
import { callTimeoutWorker } from '@/workers/callTimeoutWorker';
import { websocketService } from '@/services/websocketService';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { MessagesSideEffectHandler } from '@/zero/side-effects/tables/messages-handler';
import { InvitationResponse, NotificationType, ChannelScopeType, CallType } from '@prisma/client';
import { ActivityClassification, MessageType } from '@xyne/shared';

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

        if (invitedParticipants.length === 0) {
            this.logger.debug(`No invited participants pending for call ${callId} — skipping missed call notifications`);
            return;
        }

        const call = await db.call.findUnique({
            where: { id: callId },
            select: { externalId: true, channelId: true, callType: true }
        });

        if (!call) {
            this.logger.warn(`Call record not found for ${callId} — skipping missed call notifications`);
            return;
        }

        const channel = await db.channel.findUnique({
            where: { id: call.channelId ?? undefined },
            select: { scopeType: true }
        });

        if (channel?.scopeType === ChannelScopeType.DEFAULT) {
            this.logger.info(`Skipping missed call notifications for DEFAULT scope channel: ${call.channelId}`);
            return;
        }

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

                const invitedByUserId = participant.invitedBy;
                const caller = await db.user.findUnique({ where: { id: invitedByUserId } });
                const callerName = caller?.name || 'Someone';

                await notificationService.createNotification(participant.userId, {
                    title: 'Missed Call',
                    message: `You missed a call from ${callerName}`,
                    type: NotificationType.MISSED_CALL,
                    relatedEntityType: 'call',
                    relatedEntityId: call.externalId,
                    metadata: {
                        callId: call.externalId,
                        channelId: call.channelId,
                        callerId: invitedByUserId,
                        callerName: callerName,
                        callType: call.callType,
                        reason: 'ended'
                    }
                });
                this.logger.info(`Cleaned up participant ${participant.id}: Job removed, MISSED_CALL sent.`);
            } catch (err) {
                this.logger.error(`Failed to cleanup participant ${participant.id}`, err);
            }
        }));

        // 3. Create Activities
        await activityService.createActivities(invitedParticipants.map(participant => ({
            userId: participant.userId,
            actorId: participant.invitedBy,
            actorAction: 'missed_call',
            actionSource: 'call',
            actionSourceId: call.externalId,
            callId: callId,
            channelId: call.channelId ?? undefined,
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
                this.logger.warn(`Participant ${participantId} not found or not in INVITED state — skipping invite side effects`, {
                    found: !!participant,
                    response: participant?.response,
                });
                return;
            }

            const { callId, userId: recipientId, invitedBy } = participant;
            if (!callId || !recipientId || !invitedBy) {
                this.logger.warn(`Missing callId/recipientId/invitedBy for participant ${participantId} — skipping invite side effects`, {
                    callId,
                    recipientId,
                    invitedBy,
                });
                return;
            }
            if (recipientId === invitedBy) return;

            const call = await db.call.findUnique({
                where: { id: callId },
                select: { externalId: true, callType: true, roomLink: true, channelId: true }
            });

            if (!call) {
                this.logger.warn(`Call not found for participant ${participantId} — skipping invite side effects`, {
                    participantId,
                    callId,
                });
                return;
            }

            const channel = await db.channel.findUnique({
                where: { id: call.channelId ?? undefined },
                select: { scopeType: true }
            });

            if (channel?.scopeType === ChannelScopeType.DEFAULT) {
                this.logger.info(`Skipping side effects for DEFAULT scope channel: ${call.channelId}`);
                return;
            }

            // Skip notifications for HEADLESS calls
            if (call.callType === CallType.HEADLESS) {
                this.logger.info(`Skipping notification for HEADLESS call: ${call.externalId}`);
                return;
            }

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

            const callerName = caller?.name || 'Someone';
            const recipient = await db.user.findUnique({
                where: { id: recipientId },
                select: { name: true, picture: true }
            });

            const token = await livekitService.generateAccessToken({
                userIdentity: recipientId,
                roomName: call.externalId,
                userName: recipient?.name || 'User',
                metadata: JSON.stringify({ picture: recipient?.picture || null }),
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
                    scopeType: channel?.scopeType, // Channel type for CallKit filtering
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
     * Handles call metrics when a call ends:
     * - Increments today's call count in Redis
     * - Adds call duration to Redis
     * Only tracks calls lasting more than 60 seconds.
     */
    async handleCallMetrics(startedAt: Date, endedAt: Date): Promise<void> {
        const callDurationSeconds = (endedAt.getTime() - startedAt.getTime()) / 1000;

        if (callDurationSeconds <= 60) {
            this.logger.info(`Skipping call metrics: duration ${callDurationSeconds}s is <= 60s`);
            return;
        }

        const callDurationMinutes = Math.round((callDurationSeconds / 60) * 10) / 10;

        try {
            await Promise.all([
                websocketService.incrementTodayCallCount(),
                websocketService.addCallDuration(callDurationMinutes),
            ]);
            this.logger.info(`Call metrics updated: duration ${callDurationMinutes}m`);
        } catch (error) {
            this.logger.error('Failed to update call metrics:', error);
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

            if (!participant) {
                this.logger.warn(`Participant ${participantId} not found after response change — skipping CALL_DISMISS`);
                return;
            }

            const call = await db.call.findUnique({
                where: { id: participant.callId }
            });

            if (!call) {
                this.logger.warn(`Call not found for participant ${participantId} — skipping CALL_DISMISS`, {
                    participantId,
                    callId: participant.callId,
                });
                return;
            }

            await notificationService.createFCMNotification(participant.userId, {
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

    async postExternalChatSummary(callId: string, callExternalId: string): Promise<void> {
        this.logger.info(`Checking external chat messages for call: ${callExternalId}`);

        try {
            const messages = await repositories.callMessages.getByCallId(callId);
            if (messages.length === 0) return;

            const externalMessages = messages.filter(m => m.isExternal);
            if (externalMessages.length === 0) return;

            const totalParticipants = new Set(messages.map(m => m.participantId)).size;
            const externalParticipantCount = new Set(externalMessages.map(m => m.participantId)).size;

            const call = await db.call.findUnique({
                where: { id: callId },
                select: { metadata: true, channelId: true },
            });

            if (!call) {
                this.logger.warn(`Call not found for id ${callId} — skipping external chat summary`);
                return;
            }

            const callMetadata = call.metadata as { conversationId?: string } | null;
            if (!callMetadata?.conversationId) {
                this.logger.warn(`No conversationId found for call ${callExternalId} — skipping external chat summary`);
                return;
            }

            const bot = await unifiedBotUserService.getBotByBotId('xyne-automatic');
            if (!bot) {
                this.logger.warn('Xyne Automatic bot not found — skipping external chat summary');
                return;
            }

            const chatHistoryUrl = `/chat/dir/${call.channelId}/${callMetadata.conversationId}?external-call-chat=${callExternalId}`;
            const content = `<b>External Call Chat:</b> ${messages.length} messages from ${totalParticipants} participants (${externalParticipantCount} external). Check full chat <a href="${chatHistoryUrl}" style="color: var(--action-primary); text-decoration: underline;">here</a>.`;

            const message = await repositories.messages.create({
                conversationId: callMetadata.conversationId,
                senderId: bot.id,
                content,
                msgType: MessageType.BOT,
                showInChannel: false,
                metadata: {
                    messageSubtype: 'external_call_chat',
                    callId: callExternalId,
                },
            });
            await repositories.conversations.incrementReplyCount(callMetadata.conversationId);

            const orgMember = await db.orgMember.findUnique({
                where: { email: bot.email },
                select: { memberId: true, role: true },
            });

            const handler = new MessagesSideEffectHandler({
                userID: bot.id,
                workspaceId: bot.workspaceId ?? '',
                role: bot.role ?? 'MEMBER',
                orgRole: orgMember?.role ?? '',
                memberId: orgMember?.memberId ?? '',
            });
            handler.onInsert({ entityId: message.messageId, entityType: 'messages', operation: 'insert' })
                .catch(err => this.logger.error(`[postExternalChatSummary] Side-effect handler error:`, err));

            this.logger.info(`Posted external chat summary for call ${callExternalId} in conversation ${callMetadata.conversationId}`);
        } catch (error) {
            this.logger.error(`Failed to post external chat summary for call ${callExternalId}:`, error);
        }
    }
}

export const callSideEffectService = new CallSideEffectService();
