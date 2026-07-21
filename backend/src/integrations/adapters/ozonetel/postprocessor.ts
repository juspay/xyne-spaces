import { BasePostprocessor } from '../../core/basePostprocessor';
import type { PostprocessContext } from '../../core/types';
import { logger } from '@/utils/logger';
import { telephonyEmailService } from '@/services/ozonetel/telephonyEmailService';
import type { TelephonyEvent } from './types';

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function dateValue(value: unknown): Date | undefined {
  const valueString = stringValue(value);
  if (!valueString) return undefined;
  const date = new Date(valueString);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function metadataJson(value: unknown): Record<string, unknown> {
  const valueString = stringValue(value);
  if (!valueString) return {};
  try {
    const parsed = JSON.parse(valueString) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export class OzonetelPostprocessor extends BasePostprocessor {
  async process(context: PostprocessContext): Promise<void> {
    const metadata = context.normalizedData.metadata;
    if (metadata.source !== 'ozonetel') return;

    const externalId = context.normalizedData.externalId;
    const workspaceId = stringValue(metadata.ozonetelWorkspaceId);
    const status = stringValue(metadata.ozonetelStatus) as TelephonyEvent['status'] | undefined;
    if (!workspaceId || !status) {
      logger.warn('[telephony] postprocess_skipped_missing_metadata', {
        externalId,
        workspaceId,
        status,
      });
      return;
    }

    const event: TelephonyEvent = {
      externalId,
      workspaceId,
      status,
      direction: stringValue(metadata.ozonetelDirection) as TelephonyEvent['direction'] | undefined,
      agentUserId: stringValue(metadata.ozonetelAgentUserId),
      fromNumber: stringValue(metadata.ozonetelFromNumber),
      toNumber: stringValue(metadata.ozonetelToNumber),
      recordingUrl: stringValue(metadata.ozonetelRecordingUrl),
      startedAt: dateValue(metadata.ozonetelStartedAt),
      answeredAt: dateValue(metadata.ozonetelAnsweredAt),
      endedAt: dateValue(metadata.ozonetelEndedAt),
      talkTimeSec: numberValue(metadata.ozonetelTalkTimeSec),
      metadata: metadataJson(metadata.ozonetelMetadataJson),
    };

    const result = await telephonyEmailService.applyEvent(event, context.entityId);
    logger.info('[telephony] postprocess_applied', {
      workspaceId,
      externalId,
      status,
      emailId: result.emailId,
      ticketId: result.ticketId,
    });
  }
}
