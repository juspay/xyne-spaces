import { ExternalSource } from '@prisma/client';
import { BaseFlow } from '../../core/baseFlow';
import { logger } from '@/utils/logger';
import { callConnectionService } from '@/services/telephony/callConnectionService';
import { telephonyEmailService } from '@/services/ozonetel/telephonyEmailService';
import {
  mapOzonetelSubscribeCallEvent,
  mapOzonetelWebhookEvent,
} from '@/services/ozonetel/ozonetelEventMapper';
import type { OzonetelPreprocessedPayload } from './types';

// Logs name the connection by id: source.name contains the webhook secret.
export class OzonetelFlow extends BaseFlow {
  async preprocess(rawPayload: unknown, source?: ExternalSource): Promise<unknown> {
    const workspaceId = source?.workspaceId;
    if (!source || !workspaceId) {
      return { __skipIngestion: true, __skipReason: 'missing_workspace' };
    }
    const connectionId = source.id;
    logger.info('[telephony] ingest_received', { workspaceId, connectionId });

    try {
      const subscribeEvent = mapOzonetelSubscribeCallEvent(workspaceId, rawPayload);
      const event = subscribeEvent ?? mapOzonetelWebhookEvent(workspaceId, rawPayload);
      if (!event) {
        logger.info('[telephony] ingest_skipped', {
          workspaceId,
          connectionId,
          reason: 'unrecognized_payload',
        });
        return { __skipIngestion: true, __skipReason: 'ozonetel_unrecognized_payload' };
      }

      const connection = await callConnectionService.fromSource(source);
      if (!connection) {
        logger.warn('[telephony] ingest_skipped', {
          workspaceId,
          connectionId,
          reason: 'connection_unavailable',
        });
        return { __skipIngestion: true, __skipReason: 'ozonetel_connection_unavailable' };
      }

      const prepared = await telephonyEmailService.prepareCoreIngestion(event, connection);
      if (!prepared) {
        return { __skipIngestion: true, __skipReason: 'ozonetel_event_deferred' };
      }

      logger.info('[telephony] ingest_preprocessed', {
        workspaceId,
        connectionId,
        externalId: event.externalId,
        mode: subscribeEvent ? 'subscribe' : 'primary',
        status: event.status,
        channelId: prepared.channelId,
        creatorUserId: prepared.creatorUserId,
        targetConversationId: prepared.targetConversationId,
      });

      return {
        event,
        channelId: prepared.channelId,
        creatorUserId: prepared.creatorUserId,
        targetConversationId: prepared.targetConversationId,
      } satisfies OzonetelPreprocessedPayload;
    } catch (error) {
      logger.error('[telephony] ingest_apply_failed', {
        workspaceId,
        connectionId,
        error,
      });
      throw error;
    }
  }
}
