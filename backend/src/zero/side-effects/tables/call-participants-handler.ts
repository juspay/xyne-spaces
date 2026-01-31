import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { logger } from '@/utils/logger';
import { TableSchema } from '@/zero/acl/core/types';
import { InvitationResponse } from '@prisma/client';
import { UpdateValue } from '@rocicorp/zero';
import { callSideEffectService } from '@/services/callSideEffectService';

export class CallParticipantsSideEffectHandler extends BaseSideEffectHandler {


    async onInsert(job: SideEffectJobConfig): Promise<void> {
        logger.info(`[CallParticipantsHandler] onInsert called for entity: ${job.entityId}`);
        await this.handleNotification(job);
    }

    async onUpdate(job: SideEffectJobConfig): Promise<void> {
        logger.info(`[CallParticipantsHandler] onUpdate called for entity: ${job.entityId}`);

        const args: UpdateValue<TableSchema<'call_participants'>> = job.args;

        if (args?.response === undefined) return;

        // 1. If invited, trigger notification flow (which also schedules timeout)
        if (args.response === InvitationResponse.INVITED) {
            await this.handleNotification(job);
        } 
        // 2. If response changed from INVITED to something else (ACCEPTED/DECLINED)
        else {
             await this.handleResponseChange(job.entityId, args.response as InvitationResponse);
        }
    }

    /**
     * Handle transitions from INVITED -> ACCEPTED/DECLINED
     * - Remove Redis Job
     * - Send CALL_DISMISS push
     */
    private async handleResponseChange(participantId: string, newStatus: InvitationResponse): Promise<void> {
         try {
             await callSideEffectService.handleParticipantResponse(participantId, newStatus);
         } catch (error) {
             logger.error(`[CallParticipantsHandler] Failed to handle response change for ${participantId}:`, error);
         }
    }

    private async handleNotification(job: SideEffectJobConfig): Promise<void> {
        const { entityId: id } = job;
        logger.info(`[CallParticipantsHandler] handleNotification processing for ID: ${id}`);

        try {
            await callSideEffectService.handleParticipantInvited(id);
        } catch (error) {
            logger.error(`[CallParticipantsSideEffectHandler] Failed to handle notification for ${id}:`, error);
        }
    }

}