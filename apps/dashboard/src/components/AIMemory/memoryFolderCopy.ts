import type { MemoryBankMemory, PipelineEventDetail } from '@/services/claw/digitalTwinTypes';
import { subsystemLabel } from '@/components/ClawAgents/digitalTwin/subsystems';
import { memorySubsystemKey, memoryTitle } from './memoryUtils';

export interface MemoryFolderCopy {
  id: string;
  title: string;
  hook: string;
  metaLine: string;
  eyebrow: string;
  body: string;
  sourcePlace: string;
  evidence: string | null;
  how: string;
  whenRelative: string;
  whenAbsolute: string;
  after: string | null;
}

const firstSentence = (text: string): string => {
  const sentence = text.split(/(?<=[.!?])\s+/, 1)[0]?.trim() ?? text.trim();
  if (!sentence) return text.trim();
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
};

const formatRelativeLong = (iso: string | null): string => {
  if (!iso) return 'just now';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return 'just now';
  const minutes = Math.max(1, Math.floor((Date.now() - parsed) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
};

const formatAbsoluteLong = (iso: string): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const channelLabel = (name: string | undefined): string | null => {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^#/, '');
};

const originFromEvent = (
  event: PipelineEventDetail | null | undefined,
): { sourcePlace: string; originShort: string } => {
  if (!event) {
    return { sourcePlace: 'Approved in Review', originShort: 'Review' };
  }

  const record = event.records?.[0];
  const channel = channelLabel(record?.channelName);
  const kind = (event.sourceKind ?? record?.type ?? '').toLowerCase();
  const runType = event.runType.toLowerCase();

  if (runType === 'synthesize') {
    return { sourcePlace: 'Persona refresh', originShort: 'persona refresh' };
  }

  if (kind.includes('call')) {
    return {
      sourcePlace: channel ? `Call · ${channel}` : 'Call',
      originShort: 'a call',
    };
  }

  if (kind.includes('canvas') || kind.includes('file')) {
    return {
      sourcePlace: channel ? `Canvas · ${channel}` : 'Canvas',
      originShort: 'a canvas',
    };
  }

  if (kind.includes('message') || kind.includes('conversation') || kind.includes('mention')) {
    if (runType === 'backfill') {
      return {
        sourcePlace: channel ? `Message in #${channel}` : 'Earlier messages',
        originShort: 'earlier messages',
      };
    }
    return {
      sourcePlace: channel ? `Message in #${channel}` : 'Message',
      originShort: channel ? `#${channel}` : 'messages',
    };
  }

  if (runType === 'backfill' || runType === 'upload') {
    return { sourcePlace: 'Work records', originShort: 'earlier history' };
  }

  return { sourcePlace: 'Work records', originShort: 'work records' };
};

const howFromEvent = (event: PipelineEventDetail | null | undefined): string => {
  if (!event) return 'You approved this from daily learning';
  const runType = event.runType.toLowerCase();
  if (runType === 'backfill' || runType === 'upload') return 'Imported from earlier history';
  if (runType === 'twin-approval') return 'You approved this from daily learning';
  return 'Learned automatically while you worked';
};

const evidenceFromEvent = (
  memory: MemoryBankMemory,
  event: PipelineEventDetail | null | undefined,
): string | null => {
  const preview = event?.records?.find(record => record.textPreview.trim())?.textPreview.trim();
  if (preview) return preview;
  const fallback = firstSentence(memory.content);
  return fallback || null;
};

export const buildMemoryFolderCopy = (
  memory: MemoryBankMemory,
  event?: PipelineEventDetail | null,
): MemoryFolderCopy => {
  const origin = originFromEvent(event);
  const how = howFromEvent(event);
  const evidence = evidenceFromEvent(memory, event);
  const savedRelative = formatRelativeLong(memory.createdAt);
  const metaParts: string[] = [];

  if (origin.originShort.startsWith('#')) metaParts.push(`From ${origin.originShort}`);
  else if (origin.originShort === 'Review') metaParts.push('You approved this');
  else metaParts.push(`From ${origin.originShort}`);
  metaParts.push(`Saved ${savedRelative}`);
  if (memory.recallHits7d > 0) metaParts.push(`Used ${memory.recallHits7d}×`);

  const after =
    memory.recallHits7d > 0
      ? `Used ${memory.recallHits7d} time${memory.recallHits7d === 1 ? '' : 's'} this week${
          memory.lastRecalledAt ? `\nLast used ${formatRelativeLong(memory.lastRecalledAt)}` : ''
        }`
      : null;

  return {
    id: memory.hindsightMemoryId,
    title: memoryTitle(memory),
    hook: memory.content,
    metaLine: metaParts.join(' · '),
    eyebrow: subsystemLabel(memorySubsystemKey(memory)),
    body: memory.content,
    sourcePlace: origin.sourcePlace,
    evidence,
    how,
    whenRelative: `Saved ${savedRelative}`,
    whenAbsolute: formatAbsoluteLong(memory.createdAt),
    after,
  };
};
