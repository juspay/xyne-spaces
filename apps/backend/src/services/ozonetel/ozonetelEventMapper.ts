import { logger } from '@/utils/logger';
import type { TelephonyEvent } from '@/integrations/adapters/ozonetel/types';

const EVENT_STATUS: Record<string, TelephonyEvent['status']> = {
  NewCall: 'RINGING',
  Ringing: 'RINGING',
  Answer: 'ANSWERED',
  Bridge: 'ANSWERED',
  Disconnect: 'ENDED',
  Hangup: 'ENDED',
  Missed: 'MISSED',
  Abandon: 'MISSED',
  Failed: 'FAILED',
};

type SubscribePayload = {
  eventType?: string;
  eventTime?: string;
  username?: string;
  data?: Record<string, unknown>;
};

function isSubscribePayload(rawPayload: unknown): rawPayload is SubscribePayload {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) return false;
  const body = rawPayload as Record<string, unknown>;
  return typeof body.eventType === 'string' || typeof body.data === 'object';
}

function parseDurationToSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const parts = trimmed.split(':').map(part => parseInt(part, 10));
  if (parts.length !== 3 || parts.some(part => Number.isNaN(part))) return undefined;
  const [hours, minutes, seconds] = parts;
  return hours * 3600 + minutes * 60 + seconds;
}

function parseDateTime(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const trimmed = value.trim();
  const istMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/,
  );
  if (istMatch) {
    const [, year, month, day, hour, minute, second] = istMatch;
    const utcMillis =
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      ) -
      (5 * 60 + 30) * 60 * 1000;
    return new Date(utcMillis);
  }

  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isTerminalStatus(status: TelephonyEvent['status']): boolean {
  return status === 'ENDED' || status === 'MISSED' || status === 'FAILED';
}

function normalizeOzonetelBody(body: any): any {
  if (typeof body?.data === 'string') {
    try {
      return JSON.parse(body.data);
    } catch (err) {
      logger.warn('[telephony] webhook_data_parse_failed', { err });
      return body;
    }
  }
  if (
    !body?.eventType &&
    body?.data &&
    typeof body.data === 'object' &&
    !Array.isArray(body.data)
  ) {
    return body.data;
  }
  return body;
}

function resolveWebhookExternalId(body: any): string {
  return String(body?.monitorUCID ?? body?.ucid ?? body?.callId ?? '').trim();
}

function resolveSubscribeExternalId(data: Record<string, unknown>): string {
  return String(data.monitor_ucid ?? data.ucid ?? '').trim();
}

function splitSegments(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split('->')
    .map(segment => segment.trim())
    .filter(Boolean);
}

function pickLastEmailSegment(value: unknown): string | null {
  const segments = splitSegments(value);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(segment)) {
      return segment;
    }
  }
  return segments[segments.length - 1] ?? null;
}

function normalizeAgentIdentifier(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text || text === '0') return null;
  return text;
}

function getSelectedSegment(value: unknown, preferredIndex: number | null): string | null {
  const segments = splitSegments(value);
  if (segments.length === 0) return null;
  if (preferredIndex !== null && preferredIndex >= 0 && preferredIndex < segments.length) {
    return segments[preferredIndex] ?? null;
  }
  return segments[segments.length - 1] ?? null;
}

function getPreferredAgentIndex(agentIds: unknown): number | null {
  const segments = splitSegments(agentIds);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(segments[index] ?? '')) {
      return index;
    }
  }
  return segments.length > 0 ? segments.length - 1 : null;
}

function mapAlternateStatus(body: any): TelephonyEvent['status'] | null {
  const status = String(body?.Status ?? '').toLowerCase();
  const dialStatus = String(body?.DialStatus ?? '').toLowerCase();
  const agentStatus = String(body?.AgentStatus ?? '').toLowerCase();
  const customerStatus = String(body?.CustomerStatus ?? '').toLowerCase();

  if (status === 'connected' || status === 'answered' || dialStatus === 'answered') return 'ANSWERED';
  if (status === 'notanswered' || customerStatus === 'not_answered') return 'MISSED';
  if (dialStatus === 'agent_disconnect' || dialStatus === 'disconnect') return 'ENDED';
  if (status === 'failed' || dialStatus === 'failed') return 'FAILED';
  if (agentStatus === 'answered') return 'ANSWERED';
  return null;
}

function isAnsweredSummaryCallback(body: any): boolean {
  const hasEndTime = !!parseDateTime(body?.EndTime);
  const status = String(body?.Status ?? '').toLowerCase();
  const dialStatus = String(body?.DialStatus ?? '').toLowerCase();
  const agentStatus = String(body?.AgentStatus ?? '').toLowerCase();
  const customerStatus = String(body?.CustomerStatus ?? '').toLowerCase();
  return (
    hasEndTime &&
    (status === 'answered' ||
      dialStatus.includes('answered') ||
      agentStatus === 'answered' ||
      customerStatus === 'answered')
  );
}

function inferFailureReason(body: any): string | null {
  const rawStatus = String(body?.Status ?? '').trim();
  const dialStatus = String(body?.DialStatus ?? '').trim();
  const agentStatus = String(body?.AgentStatus ?? '').trim();
  const customerStatus = String(body?.CustomerStatus ?? '').trim();
  const normalized = `${dialStatus} ${agentStatus} ${customerStatus} ${rawStatus}`.toLowerCase();

  if (normalized.includes('qtimeexceeded')) return 'Queue Timeout';
  if (normalized.includes('invalidnumber')) return 'Invalid Number';
  if (normalized.includes('notdialed')) return 'Not Dialed';
  if (dialStatus.toLowerCase() === 'error') return 'Dial Error';
  if (normalized.includes('busy')) return 'Busy';
  if (normalized.includes('user_disconnected')) return 'User Disconnected';
  if (normalized.includes('normalunspecified')) return 'Not Answered';
  return null;
}

function inferDirection(body: any): TelephonyEvent['direction'] | undefined {
  const type = String(body?.Type ?? '').toLowerCase();
  if (type === 'manual' || type === 'outbound') return 'OUTBOUND';
  if (type === 'inbound') return 'INBOUND';
  return undefined;
}

function mapPhoneNumbers(body: any, direction?: TelephonyEvent['direction']): {
  fromNumber?: string;
  toNumber?: string;
} {
  const customerNumber = body?.CallerID;
  const didNumber = body?.Did ?? body?.did;
  const agentNumber = body?.DialedNumber ?? body?.AgentPhoneNumber ?? body?.PhoneName;

  if (direction === 'INBOUND') {
    return {
      fromNumber: customerNumber ?? didNumber,
      toNumber: didNumber ?? agentNumber,
    };
  }

  return {
    fromNumber: didNumber ?? agentNumber,
    toNumber: customerNumber ?? agentNumber,
  };
}

function buildMetadata(body: any): Record<string, unknown> {
  const preferredAgentIndex = getPreferredAgentIndex(body?.AgentID);
  const normalizedAgentId = pickLastEmailSegment(body?.AgentID);
  const normalizedAgentName = getSelectedSegment(body?.AgentName, preferredAgentIndex);
  const normalizedAgentPhoneNumber = getSelectedSegment(body?.AgentPhoneNumber, preferredAgentIndex);
  const normalizedAgentStatus = getSelectedSegment(body?.AgentStatus, preferredAgentIndex);
  const normalizedDialStatus = getSelectedSegment(body?.DialStatus, preferredAgentIndex);
  const normalizedPhoneName = getSelectedSegment(body?.PhoneName, preferredAgentIndex);
  const normalizedAgentUniqueId = getSelectedSegment(body?.AgentUniqueID, preferredAgentIndex);
  const normalizedDialedNumber = getSelectedSegment(body?.DialedNumber, preferredAgentIndex);
  const agentId =
    normalizeAgentIdentifier(normalizedAgentId) ?? normalizeAgentIdentifier(body?.AgentID) ?? null;

  return {
    callType: body?.Type ?? null,
    uui: body?.UUI ?? null,
    monitorUcid: body?.monitorUCID ?? null,
    ucid: body?.ucid ?? body?.callId ?? null,
    agentId,
    agentName: normalizedAgentName ?? body?.AgentName ?? null,
    agentPhoneNumber: normalizedAgentPhoneNumber ?? body?.AgentPhoneNumber ?? null,
    agentStatus: normalizedAgentStatus ?? body?.AgentStatus ?? null,
    agentUniqueId: normalizedAgentUniqueId ?? body?.AgentUniqueID ?? null,
    customerStatus: body?.CustomerStatus ?? null,
    dialStatus: normalizedDialStatus ?? body?.DialStatus ?? null,
    campaignName: body?.CampaignName ?? null,
    campaignStatus: body?.CampaignStatus ?? null,
    skill: body?.Skill ?? null,
    did: body?.Did ?? body?.did ?? null,
    callerId: body?.CallerID ?? null,
    dialedNumber: normalizedDialedNumber ?? body?.DialedNumber ?? null,
    phoneName: normalizedPhoneName ?? body?.PhoneName ?? null,
    hangupBy: body?.HangupBy ?? null,
    transferType: body?.TransferType ?? null,
    transferredTo: body?.TransferredTo ?? null,
    location: body?.Location ?? null,
    timeToAnswer: body?.TimeToAnswer ?? null,
    wrapUpDuration: body?.WrapUpDuration ?? null,
    holdDuration: body?.HoldDuration ?? null,
    confDuration: body?.ConfDuration ?? null,
    duration: body?.Duration ?? null,
    startTime: body?.StartTime ?? body?.eventTime ?? null,
    endTime: body?.EndTime ?? body?.eventTime ?? null,
    answerTime: body?.AnswerTime ?? body?.eventTime ?? null,
    disposition: body?.Disposition ?? null,
    comments: body?.Comments ?? null,
    rawStatus: body?.Status ?? null,
    failureReason: inferFailureReason(body),
    audioFile: body?.AudioFile ?? null,
    dataUniqueId: body?.DataUniqueId ?? null,
    fallbackRule: body?.FallBackRule ?? null,
    userName: body?.UserName ?? null,
    eventSource: 'webhook',
  };
}

export function mapOzonetelWebhookEvent(
  workspaceId: string,
  rawBody: unknown,
): TelephonyEvent | null {
  const body = normalizeOzonetelBody(rawBody);
  const externalId = resolveWebhookExternalId(body);
  const mappedStatus = EVENT_STATUS[body?.event] ?? mapAlternateStatus(body);
  const status =
    mappedStatus === 'ANSWERED' && isAnsweredSummaryCallback(body) ? 'ENDED' : mappedStatus;
  if (!externalId || !status) return null;

  const direction = inferDirection(body);
  const webhookEventTime = parseDateTime(body?.eventTime);
  const startedAt = parseDateTime(body?.StartTime) ?? webhookEventTime;
  const endedAt =
    status === 'ENDED' || status === 'MISSED' || status === 'FAILED'
      ? parseDateTime(body?.EndTime) ?? webhookEventTime ?? new Date()
      : undefined;
  const answeredAt =
    status === 'ANSWERED'
      ? parseDateTime(body?.AnswerTime) ?? parseDateTime(body?.StartTime) ?? webhookEventTime
      : undefined;
  const { fromNumber, toNumber } = mapPhoneNumbers(body, direction);

  return {
    externalId,
    status,
    workspaceId,
    direction,
    fromNumber,
    toNumber,
    recordingUrl: body?.recordingUrl ?? body?.AudioFile ?? undefined,
    startedAt,
    talkTimeSec: parseDurationToSeconds(
      body?.Duration ?? body?.callDuration ?? body?.CallDuration,
    ),
    answeredAt,
    endedAt,
    metadata: buildMetadata(body),
  };
}

function mapSubscribeActionToStatus(
  action: string,
  data: Record<string, unknown>,
): TelephonyEvent['status'] | null {
  const normalizedAction = action.trim().toLowerCase();
  if (normalizedAction === 'calling') return 'RINGING';
  if (normalizedAction === 'answered') return 'ANSWERED';
  if (normalizedAction === 'disconnect') {
    const dialStatus = String(data.dial_status ?? '').trim().toLowerCase();
    const callStatus = String(data.call_status ?? '').trim().toLowerCase();
    const hasExplicitFailure =
      dialStatus === 'failed' ||
      dialStatus === 'error' ||
      callStatus === 'failed' ||
      callStatus === 'error';
    if (hasExplicitFailure) return 'FAILED';
    return 'MISSED';
  }
  return null;
}

function mapSubscribeDirection(callType: unknown): TelephonyEvent['direction'] | undefined {
  const normalized = String(callType ?? '').trim().toLowerCase();
  if (normalized === 'inbound') return 'INBOUND';
  if (
    normalized === 'manual' ||
    normalized === 'preview' ||
    normalized === 'progressive' ||
    normalized === 'predictive'
  ) {
    return 'OUTBOUND';
  }
  return undefined;
}

function mapSubscribeMetadata(data: Record<string, unknown>, username?: string): Record<string, unknown> {
  const agentId = normalizeAgentIdentifier(data.agent_id);
  const subscribeEventTime = data.event_time ?? null;
  return {
    callType: data.call_type ?? null,
    uui: data.uui ?? null,
    monitorUcid: data.monitor_ucid ?? null,
    ucid: data.ucid ?? null,
    agentId,
    agentName: data.agent_name ?? null,
    agentPhoneNumber: data.agent_number ?? null,
    agentStatus: data.agent_status ?? null,
    agentUniqueId: data.agent_unique_id ?? null,
    customerStatus: data.customer_status ?? null,
    dialStatus: data.dial_status ?? null,
    campaignName: data.campaign_name ?? null,
    campaignStatus: data.campaign_status ?? null,
    skill: data.skill ?? null,
    did: data.did ?? null,
    callerId: data.caller_id ?? null,
    dialedNumber: data.agent_number ?? null,
    phoneName: data.agent_number ?? null,
    hangupBy: data.hangup_by ?? null,
    transferType: data.transfer_type ?? null,
    transferredTo: data.transferred_to ?? null,
    location: data.location ?? null,
    timeToAnswer: data.time_to_answer ?? null,
    wrapUpDuration: data.wrap_up_duration ?? null,
    holdDuration: data.hold_duration ?? null,
    confDuration: data.conf_duration ?? null,
    duration: data.duration ?? null,
    startTime: data.start_time ?? subscribeEventTime,
    endTime: data.end_time ?? subscribeEventTime,
    disposition: data.disposition ?? null,
    comments: data.comments ?? data.comment ?? null,
    rawStatus: data.action ?? null,
    failureReason: data.failure_reason ?? null,
    audioFile: data.audio_file ?? null,
    dataUniqueId: data.data_id ?? null,
    fallbackRule: data.fallback_rule ?? null,
    userName: username ?? null,
    subscribeEventAction: data.action ?? null,
    subscribeEventTime,
    eventSource: 'subscribe',
  };
}

export function mapOzonetelSubscribeCallEvent(
  workspaceId: string,
  rawBody: unknown,
): TelephonyEvent | null {
  if (!isSubscribePayload(rawBody)) return null;
  const body = rawBody;
  if (String(body.eventType ?? '').trim().toLowerCase() !== 'call') return null;
  const data = body.data ?? {};
  const externalId = resolveSubscribeExternalId(data);
  if (!externalId) return null;

  const action = String(data.action ?? '').trim();
  const direction = mapSubscribeDirection(data.call_type);
  const status = mapSubscribeActionToStatus(action, data);
  if (!status) return null;

  const eventTime = parseDateTime(data.event_time ?? body.eventTime);
  const startedAt = isTerminalStatus(status)
    ? undefined
    : parseDateTime(data.start_time) ?? eventTime ?? new Date();
  const answeredAt = status === 'ANSWERED' ? eventTime ?? new Date() : undefined;
  const endedAt = isTerminalStatus(status) ? eventTime ?? new Date() : undefined;

  const fromNumber =
    direction === 'INBOUND'
      ? String(data.caller_id ?? '').trim() || undefined
      : String(data.did ?? data.agent_number ?? '').trim() || undefined;
  const toNumber =
    direction === 'INBOUND'
      ? String(data.did ?? data.agent_number ?? '').trim() || undefined
      : String(data.caller_id ?? '').trim() || undefined;

  return {
    externalId,
    status,
    workspaceId,
    direction,
    fromNumber,
    toNumber,
    recordingUrl:
      typeof data.audio_file === 'string' && data.audio_file.trim()
        ? data.audio_file.trim()
        : undefined,
    startedAt,
    answeredAt,
    endedAt,
    metadata: mapSubscribeMetadata(data, body.username),
  };
}
