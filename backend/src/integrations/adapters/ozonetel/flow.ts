import { ExternalSource } from '@prisma/client';
import { BaseFlow } from '../../core/baseFlow';
import { logger } from '@/utils/logger';
import { telephonyEmailService } from '@/services/ozonetel/telephonyEmailService';
import {
  mapOzonetelSubscribeCallEvent,
  mapOzonetelWebhookEvent,
} from '@/services/ozonetel/ozonetelEventMapper';
import type { OzonetelPreprocessedPayload } from './types';

export class OzonetelFlow extends BaseFlow {
  async preprocess(rawPayload: unknown, source?: ExternalSource): Promise<unknown> {
    const workspaceId = source?.workspaceId;
    if (!workspaceId) {
      return { __skipIngestion: true, __skipReason: 'missing_workspace' };
    }
    logger.info('[telephony] ingest_received', {
      workspaceId,
      sourceName: source.name,
    });

    try {
      const subscribeEvent = mapOzonetelSubscribeCallEvent(workspaceId, rawPayload);
      const event = subscribeEvent ?? mapOzonetelWebhookEvent(workspaceId, rawPayload);
      if (!event) {
        logger.info('[telephony] ingest_skipped', {
          workspaceId,
          sourceName: source.name,
          reason: 'unrecognized_payload',
        });
        return { __skipIngestion: true, __skipReason: 'ozonetel_unrecognized_payload' };
      }

      const prepared = await telephonyEmailService.prepareCoreIngestion(event, source.id);
      if (!prepared) {
        return { __skipIngestion: true, __skipReason: 'ozonetel_event_deferred' };
      }

      logger.info('[telephony] ingest_preprocessed', {
        workspaceId,
        sourceName: source.name,
        externalId: event.externalId,
        mode: subscribeEvent ? 'subscribe' : 'primary',
        status: event.status,
        channelId: prepared.channelId,
        creatorUserId: prepared.creatorUserId,
      });

      return {
        event,
        channelId: prepared.channelId,
        creatorUserId: prepared.creatorUserId,
      } satisfies OzonetelPreprocessedPayload;
    } catch (error) {
      logger.error('[telephony] ingest_apply_failed', {
        workspaceId,
        sourceName: source.name,
        error,
      });
      throw error;
    }
  }
}
