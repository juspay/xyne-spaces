/**
 * Pure helpers for Ozonetel call-recording transcripts.
 *
 * Kept free of DB / network imports so they can be unit-tested directly and
 * shared by the API (controller), the worker (processor) and the email service.
 */

export type TelephonyTranscriptionStatus = 'queued' | 'processing' | 'done' | 'failed';

/** Stored under the `transcription` key of the call email's JSON body. */
export interface TelephonyTranscriptionState {
  status: TelephonyTranscriptionStatus;
  error?: string;
  attachmentId?: string;
  updatedAt: string;
}

/** `metadata.type` on the transcript attachment. Must NOT be 'transcript' /
 * 'identified_transcript' / 'recording': attachmentController routes those to
 * the transcription bucket; this file lives in the default attachment bucket. */
export const CALL_TRANSCRIPT_ATTACHMENT_TYPE = 'call_transcript';

const TRANSCRIPTION_STATUSES: ReadonlySet<string> = new Set(['queued', 'processing', 'done', 'failed']);

export function sanitizeTranscriptionState(value: unknown): TelephonyTranscriptionState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.status !== 'string' || !TRANSCRIPTION_STATUSES.has(raw.status)) return undefined;
  return {
    status: raw.status as TelephonyTranscriptionStatus,
    ...(typeof raw.error === 'string' && raw.error.trim() && { error: raw.error.trim() }),
    ...(typeof raw.attachmentId === 'string' && raw.attachmentId.trim() && { attachmentId: raw.attachmentId }),
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : new Date(0).toISOString(),
  };
}

/**
 * Return a copy of a telephony email body with the `transcription` key replaced.
 * Non-lossy: every other key in the stored JSON is preserved verbatim.
 * Passing `null` removes the key. Returns null if the body is not an Ozonetel payload.
 */
export function withTranscriptionState(body: string, state: TelephonyTranscriptionState | null): string | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || payload.provider !== 'ozonetel') return null;
  if (state) {
    payload.transcription = state;
  } else {
    delete payload.transcription;
  }
  return JSON.stringify(payload);
}

/** Minimal attachment shape needed to recognise a transcript (Prisma row or Zero row). */
export interface AttachmentLike {
  id: string;
  metadata?: unknown;
}

export function isCallTranscriptAttachment(attachment: AttachmentLike): boolean {
  const meta = attachment.metadata;
  if (!meta || typeof meta !== 'object') return false;
  return (meta as { type?: unknown }).type === CALL_TRANSCRIPT_ATTACHMENT_TYPE;
}

export function findCallTranscriptAttachment<T extends AttachmentLike>(attachments: T[]): T | undefined {
  return attachments.find(isCallTranscriptAttachment);
}

/** The subset of the call email payload the transcript header uses. */
export interface CallTranscriptHeaderSource {
  from?: string;
  agent?: string;
  callType?: string;
  campaignName?: string;
  startTime?: string;
  endTime?: string;
  duration?: string;
  ucid?: string;
  monitorUcid?: string;
}

export interface CallTranscriptResult {
  text: string;
  provider: string;
}

function pad(label: string): string {
  return `${label}:`.padEnd(16, ' ');
}

/** Plain-text transcript file: a short header of call facts, then the text. */
export function formatCallTranscript(source: CallTranscriptHeaderSource, result: CallTranscriptResult): string {
  const lines: string[] = ['Call transcript', '==============='];
  const push = (label: string, value?: string | null): void => {
    const v = value?.trim();
    if (v) lines.push(`${pad(label)}${v}`);
  };
  push('Caller', source.from);
  push('Agent', source.agent);
  push('Call type', source.callType);
  push('Campaign', source.campaignName);
  push('Started', source.startTime);
  push('Ended', source.endTime);
  push('Duration', source.duration);
  push('UCID', source.ucid);
  push('Monitor UCID', source.monitorUcid);
  push('Transcribed by', result.provider);
  lines.push('---------------', '');
  lines.push(result.text.trim(), '');
  return lines.join('\n');
}

/** `call-transcript-<ucid|monitorUcid|emailId>-<yyyymmdd>.txt` */
export function buildCallTranscriptFilename(source: CallTranscriptHeaderSource, emailId: string, now: Date = new Date()): string {
  const rawId = source.ucid?.trim() || source.monitorUcid?.trim() || emailId;
  const safeId = rawId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || emailId;
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `call-transcript-${safeId}-${yyyymmdd}.txt`;
}
