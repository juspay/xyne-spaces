import { BaseTransformer } from '../../core/baseTransformer';
import type { NormalizedData, ParseResult } from '../../core/types';
import type { OzonetelPreprocessedPayload, TelephonyEvent } from './types';

function isOzonetelPayload(payload: unknown): payload is OzonetelPreprocessedPayload {
  return (
    !!payload &&
    typeof payload === 'object' &&
    'event' in payload &&
    'channelId' in payload
  );
}

function iso(value: Date | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

function buildSubject(event: TelephonyEvent): string {
  const callType =
    typeof event.metadata?.callType === 'string' && event.metadata.callType.trim()
      ? event.metadata.callType.trim()
      : event.direction === 'INBOUND'
        ? 'Inbound'
        : 'Outbound';
  const callerId =
    typeof event.metadata?.callerId === 'string' && event.metadata.callerId.trim()
      ? event.metadata.callerId.trim()
      : event.fromNumber || event.toNumber || event.externalId;
  return `${callType} call from ${callerId} (${event.externalId})`;
}

function buildContent(event: TelephonyEvent): string {
  const rows = [
    ['Status', event.status],
    ['Direction', event.direction],
    ['From', event.fromNumber],
    ['To', event.toNumber],
    ['Started', iso(event.startedAt)],
    ['Answered', iso(event.answeredAt)],
    ['Ended', iso(event.endedAt)],
    ['Recording', event.recordingUrl],
  ].filter(([, value]) => !!value);

  return rows.map(([label, value]) => `<div><strong>${label}:</strong> ${value}</div>`).join('');
}

export class OzonetelTransformer extends BaseTransformer<OzonetelPreprocessedPayload, NormalizedData> {
  async transform(payload: OzonetelPreprocessedPayload): Promise<ParseResult<NormalizedData>> {
    if (!isOzonetelPayload(payload)) {
      return { success: false, error: 'Invalid Ozonetel preprocessed payload' };
    }

    const event = payload.event;
    const timestamp = event.startedAt ?? event.answeredAt ?? event.endedAt ?? new Date();
    const from = event.fromNumber || 'Telephony';
    const to = event.toNumber ? [event.toNumber] : [];

    return {
      success: true,
      data: {
        externalId: event.externalId,
        externalThreadId: event.externalId,
        creatorUserId: payload.creatorUserId,
        author: {
          name: 'Ozonetel',
          externalId: event.externalId,
        },
        content: buildContent(event),
        emailData: {
          subject: buildSubject(event),
          from,
          to,
        },
        metadata: {
          eventType: 'ozonetel.call',
          timestamp,
          source: 'ozonetel',
          ozonetelChannelId: payload.channelId,
          ozonetelWorkspaceId: event.workspaceId,
          ozonetelStatus: event.status,
          ozonetelDirection: event.direction,
          ozonetelAgentUserId: event.agentUserId,
          ozonetelFromNumber: event.fromNumber,
          ozonetelToNumber: event.toNumber,
          ozonetelRecordingUrl: event.recordingUrl,
          ozonetelStartedAt: iso(event.startedAt),
          ozonetelAnsweredAt: iso(event.answeredAt),
          ozonetelEndedAt: iso(event.endedAt),
          ozonetelTalkTimeSec: event.talkTimeSec,
          ozonetelMetadataJson: JSON.stringify(event.metadata ?? {}),
        },
      },
    };
  }
}
