import type { ChatProjectKnowledgeType } from '../../../services/XyneAI/XyneAISessionsV2Service';

/** Matches ChatProject.instructions in claw-auth. Shown as a counter rather
 *  than silently truncating, so a long paste is visible before it is saved. */
export const PROJECT_INSTRUCTIONS_MAX_CHARS = 10_000;

/** What the counter should read, and whether saving is allowed.
 *
 *  `remaining` goes negative deliberately: a paste over the limit should say
 *  how much has to go, not sit at 0 while the editor refuses to save for no
 *  visible reason. */
export function instructionsCounter(value: string): {
  used: number;
  remaining: number;
  overLimit: boolean;
} {
  const used = value.length;
  return {
    used,
    remaining: PROJECT_INSTRUCTIONS_MAX_CHARS - used,
    overLimit: used > PROJECT_INSTRUCTIONS_MAX_CHARS,
  };
}

const KNOWLEDGE_TYPE_LABELS: Record<ChatProjectKnowledgeType, string> = {
  file: 'File',
  kb_collection: 'Knowledge base',
  channel: 'Channel',
  ticket: 'Ticket',
  canvas: 'Canvas',
};

export function knowledgeTypeLabel(type: string): string {
  return KNOWLEDGE_TYPE_LABELS[type as ChatProjectKnowledgeType] ?? type;
}

/**
 * A byte count for a badge, or null when there is nothing honest to show.
 *
 * Null rather than "0 B" for an absent size: only `file` rows carry one, and a
 * row whose size never got recorded is not a zero-byte file. The run-time
 * injector refuses such a row for the same reason.
 */
export function formatKnowledgeSize(size: number | null | undefined): string | null {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null;
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 10 so 1.4 MB stays distinguishable from 1.9 MB, none
  // above it where the extra digit is noise.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * The short form of a MIME type for a badge: `application/pdf` -> `PDF`.
 *
 * Returns null for a missing or structureless value so the badge is dropped
 * rather than rendered empty.
 */
export function formatKnowledgeMime(mimeType: string | null | undefined): string | null {
  if (!mimeType) return null;
  const subtype = mimeType.split('/')[1]?.split(';')[0]?.trim();
  if (!subtype) return null;
  // `vnd.openxmlformats-officedocument.wordprocessingml.document` and friends:
  // the vendor prefix and the long tail say nothing a user needs.
  const tail = subtype
    .replace(/^vnd\./, '')
    .split('.')
    .pop();
  if (!tail) return null;
  return tail.length > 12 ? tail.slice(0, 12).toUpperCase() : tail.toUpperCase();
}
