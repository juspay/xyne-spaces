// ---------------------------------------------------------------------------
// Call detail — pure formatting + parsing helpers.
// Ported from the dashboard's CallDetailScreen.utils, CallTimeline/* and
// TranscriptCitationModal/transcriptCache so both clients read a call the
// same way (marker order, transcript segment numbering, call length).
// ---------------------------------------------------------------------------

type Timestamp = number | string | Date | null | undefined;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function toDate(value: Timestamp): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatClock(date: Date): string {
  const hours24 = date.getHours();
  const hours = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes} ${hours24 < 12 ? 'AM' : 'PM'}`;
}

/** "Tue Aug 4, 2026 · 3:12 PM" — same shape as the dashboard meta line. */
export function formatCallHeldOn(startedAt: Timestamp): string | null {
  const date = toDate(startedAt);
  if (!date) return null;
  const day = `${WEEKDAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  return `${day} · ${formatClock(date)}`;
}

/** "22 min", "1 hr 5 min". Sub-minute calls round up so a 12s call isn't "0 min". */
export function formatCallLength(durationMs: number | null): string | null {
  if (!durationMs || durationMs <= 0) return null;
  const totalMinutes = Math.max(1, Math.round(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

/** "4:32" / "1:04:32" for an offset in seconds. */
export function formatOffset(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = String(safe % 60).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;
  return `${minutes}:${seconds}`;
}

/** Canvas URLs end in the canvas id (`…/chat/canvas/<id>`). */
export function getCanvasIdFromUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  return url.split('/').filter(Boolean).pop() ?? null;
}

// ── Marked items ────────────────────────────────────────────────────────────

export type MarkedItemType = 'decision' | 'action' | 'moment';

export interface MarkedItem {
  type: MarkedItemType;
  /** One-line description; empty for moments marked before any transcript line. */
  text: string;
  /** Offset into the recording, measured from the first transcript line. */
  timestampSeconds: number;
}

const MARKED_ITEM_TYPES = new Set<string>(['decision', 'action', 'moment']);

const isMarkedItem = (item: unknown): item is MarkedItem => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const candidate = item as { type?: unknown; timestampSeconds?: unknown };
  return (
    typeof candidate.type === 'string' &&
    MARKED_ITEM_TYPES.has(candidate.type) &&
    typeof candidate.timestampSeconds === 'number' &&
    Number.isFinite(candidate.timestampSeconds)
  );
};

/** `Call.markedItems` is untyped JSON: keep valid entries, in chronological order. */
export function parseMarkedItems(markedItems: unknown): MarkedItem[] {
  if (!Array.isArray(markedItems)) return [];
  return markedItems
    .filter(isMarkedItem)
    .map(item => ({
      type: item.type,
      text: typeof item.text === 'string' ? item.text : '',
      timestampSeconds: item.timestampSeconds,
    }))
    .sort((left, right) => left.timestampSeconds - right.timestampSeconds);
}

// ── Participant joins / leaves ──────────────────────────────────────────────

export interface ParticipantEvent {
  type: 'join' | 'leave';
  name: string;
  timestampSeconds: number;
}

export interface ParticipantTimes {
  name: string;
  joinedAt?: number | null | undefined;
  leftAt?: number | null | undefined;
}

/** Chronological joins and leaves, measured from `originMs`. */
export function buildParticipantEvents(
  participants: readonly ParticipantTimes[],
  originMs: number,
): ParticipantEvent[] {
  const events: ParticipantEvent[] = [];
  for (const participant of participants) {
    const name = participant.name.trim() || 'Someone';
    if (typeof participant.joinedAt === 'number' && Number.isFinite(participant.joinedAt)) {
      events.push({
        type: 'join',
        name,
        timestampSeconds: Math.max(0, Math.round((participant.joinedAt - originMs) / 1000)),
      });
    }
    if (typeof participant.leftAt === 'number' && Number.isFinite(participant.leftAt)) {
      events.push({
        type: 'leave',
        name,
        timestampSeconds: Math.max(0, Math.round((participant.leftAt - originMs) / 1000)),
      });
    }
  }
  return events.sort((left, right) => left.timestampSeconds - right.timestampSeconds);
}

// ── Recorded spans ──────────────────────────────────────────────────────────

export type CallRecordingType = 'AUDIO_ONLY' | 'AUDIO_SCREEN' | 'AUDIO_VIDEO';

/** One `call_recordings` row, as `GET /calls/:callId/recordings` returns it. */
export interface CallRecordingSession {
  id: string;
  name: string | null;
  recordingType: CallRecordingType;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

export interface RecordedSpan {
  recordingId: string;
  startSeconds: number;
  endSeconds: number;
  name: string | null;
  kind: 'audio' | 'video';
  recordingType: CallRecordingType;
}

const RECORDING_UPLOADED = 'RECORDING_UPLOADED';

/** Sessions that produced a file, measured from `originMs`, in order. */
export function buildRecordedSpans(
  sessions: readonly CallRecordingSession[],
  originMs: number,
): RecordedSpan[] {
  const spans: RecordedSpan[] = [];
  for (const session of sessions) {
    if (session.status !== RECORDING_UPLOADED || !session.endedAt) continue;
    const startMs = new Date(session.startedAt).getTime();
    const endMs = new Date(session.endedAt).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const startSeconds = Math.max(0, (startMs - originMs) / 1000);
    const endSeconds = Math.max(0, (endMs - originMs) / 1000);
    if (endSeconds <= startSeconds) continue;
    spans.push({
      recordingId: session.id,
      startSeconds,
      endSeconds,
      name: session.name,
      kind: session.recordingType === 'AUDIO_ONLY' ? 'audio' : 'video',
      recordingType: session.recordingType,
    });
  }
  return spans.sort((left, right) => left.startSeconds - right.startSeconds);
}

/** Fraction (0..1) along a track of `spanSeconds`, clamped. */
export function trackFraction(seconds: number, spanSeconds: number): number {
  if (spanSeconds <= 0) return 0;
  return Math.min(1, Math.max(0, seconds / spanSeconds));
}

// ── Transcript ──────────────────────────────────────────────────────────────

/** Matches the backend TRANSCRIPT_LINE_RE: "[MM:SS] Speaker: text". */
export const TRANSCRIPT_LINE_RE = /^\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+?):\s*([\s\S]*)$/;

export interface TranscriptLine {
  raw: string;
  timestamp: string | null;
  speaker: string | null;
  text: string | null;
  /** 1-based index among timestamped lines — the backend's `[clf-N]` segment id. */
  segment: number | null;
}

export function parseTranscript(text: string): TranscriptLine[] {
  let segment = 0;
  return text
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(raw => {
      const match = raw.match(TRANSCRIPT_LINE_RE);
      if (match) {
        segment += 1;
        return {
          raw,
          timestamp: match[1] ?? null,
          speaker: match[2] ?? null,
          text: match[3] ?? null,
          segment,
        };
      }
      return { raw, timestamp: null, speaker: null, text: null, segment: null };
    });
}

/** "MM:SS" or "HH:MM:SS" as seconds; null when it isn't one. */
export function parseTranscriptTimestamp(timestamp: string): number | null {
  const parts = timestamp.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const values = parts.map(part => Number(part));
  if (values.some(value => !Number.isFinite(value))) return null;
  return values.reduce((total, value) => total * 60 + value, 0);
}

/** Last timestamped line at or before `seconds`; the first spoken line otherwise. */
export function findIndexByTimeSeconds(lines: readonly TranscriptLine[], seconds: number): number {
  let match = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const timestamp = lines[index]?.timestamp;
    if (!timestamp) continue;
    const lineSeconds = parseTranscriptTimestamp(timestamp);
    if (lineSeconds === null) continue;
    if (lineSeconds > seconds) break;
    match = index;
  }
  return match >= 0 ? match : lines.findIndex(line => line.timestamp !== null);
}

/** Line index for a citation, by segment first and timestamp second. */
export function findTranscriptTargetIndex(
  lines: readonly TranscriptLine[],
  target: { segment?: number | null; timestampSeconds?: number | null },
): number {
  if (typeof target.segment === 'number') {
    const bySegment = lines.findIndex(line => line.segment === target.segment);
    if (bySegment >= 0) return bySegment;
  }
  if (typeof target.timestampSeconds === 'number') {
    return findIndexByTimeSeconds(lines, target.timestampSeconds);
  }
  return -1;
}

// ── Summary templates + labels ──────────────────────────────────────────────

export const DEFAULT_SUMMARY_TEMPLATE_ID = 'default';
export const DEFAULT_SUMMARY_TEMPLATE_NAME = 'Default summary';

/** Same glyph rule as the dashboard's template modal. */
export function getTemplateIcon(name: string): string {
  if (name === DEFAULT_SUMMARY_TEMPLATE_NAME) return '⚡';
  const [firstChar] = Array.from(name.trim());
  return firstChar ? firstChar.toUpperCase() : '#';
}

const LABEL_PALETTE = [
  '#2563EB',
  '#047857',
  '#4F46E5',
  '#0891B2',
  '#7C3AED',
  '#B45309',
  '#EA580C',
  '#0D9488',
  '#4D7C0F',
] as const;

/** Deterministic chip colour for a label — same hash as the dashboard's tagTheme. */
export function getLabelColor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = name.charCodeAt(index) + ((hash << 5) - hash);
  }
  return LABEL_PALETTE[Math.abs(hash) % LABEL_PALETTE.length] ?? LABEL_PALETTE[0];
}

/** Trim, collapse whitespace, cap length — what the picker sends for a typed label. */
export function normalizeLabelInput(raw: string, maxLength = 40): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** "detailed-summary" summary format sniffing, as on the dashboard. */
export function callSummaryFormat(aiSummary: string | null | undefined): 'markdown' | 'html' {
  const summary = aiSummary?.trim();
  if (!summary) return 'markdown';
  const hasHtmlTags = /<[^>]+>/i.test(summary);
  const startsWithMarkdown = /^##?\s/.test(summary);
  return !hasHtmlTags || startsWithMarkdown ? 'markdown' : 'html';
}
