import type { PipelineEventSummary } from '@/services/claw/digitalTwinTypes';

const RUN_LABELS: Record<string, string> = {
  backfill: 'History import',
  daily: 'Daily learning',
  upload: 'File import',
  'twin-approval': 'Reply learning',
  synthesize: 'Persona refresh',
  gate: 'Reply decision',
  deletion: 'Memory cleanup',
};

const SOURCE_LABELS: Record<string, string> = {
  message: 'message',
  messages: 'messages',
  call: 'call',
  calls: 'calls',
  canvas: 'canvas',
  canvases: 'canvases',
  conversation: 'conversation',
  conversations: 'conversations',
  mention: 'mention',
  mentions: 'mentions',
  upload: 'uploaded file',
};

export const activityTypeLabel = (runType: string): string =>
  RUN_LABELS[runType] ?? 'Learning activity';

export const activitySourceLabel = (source: string | null | undefined): string =>
  source ? (SOURCE_LABELS[source.toLowerCase()] ?? source) : 'work records';

export const recordTypeLabel = (type: string): string => {
  const normalized = type.toLowerCase();
  if (normalized.includes('mention') && normalized.includes('reply')) return 'Mention + Reply';
  const label = SOURCE_LABELS[normalized] ?? type;
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export const activitySummary = (event: PipelineEventSummary): string => {
  const records = event.recordCount ?? 0;
  const proposed = event.emittedCount ?? event.candidatesCreated ?? 0;
  const accepted = event.approvedCount ?? event.autoApproved ?? 0;
  const source = activitySourceLabel(event.sourceKind ?? event.source);

  if (event.status === 'error') {
    return `This work stopped before it could finish. ${records.toLocaleString()} ${source} were checked.`;
  }
  if (records === 0 && proposed === 0) return 'Nothing new was found during this check.';

  return `Checked ${records.toLocaleString()} ${source}, suggested ${proposed.toLocaleString()} memor${proposed === 1 ? 'y' : 'ies'}, and added ${accepted.toLocaleString()}.`;
};
