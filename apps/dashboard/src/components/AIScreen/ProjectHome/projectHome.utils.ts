import type { ChatProjectKnowledgeType } from '../../../services/XyneAI/XyneAISessionsV2Service';

export const SECTION_HEADING_CLASS =
  'inline-block border-b border-border pb-1.5 text-base font-semibold text-foreground';

export const PROJECT_INSTRUCTIONS_MAX_CHARS = 10_000;

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

/**
 * The project a chat screen should file its conversation into, from the URL.
 *
 * Applies ONLY to a new chat: on an existing thread the filing guard passes for
 * any `chat-` id, so honouring the param there refiled a chat the user had
 * merely opened.
 */
export function pendingProjectFromUrl(
  routeSessionId: string | null | undefined,
  search: string,
): string | null {
  if (routeSessionId && routeSessionId !== 'new') return null;
  return new URLSearchParams(search).get('projectId');
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
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatKnowledgeMime(mimeType: string | null | undefined): string | null {
  if (!mimeType) return null;
  const subtype = mimeType.split('/')[1]?.split(';')[0]?.trim();
  if (!subtype) return null;
  const tail = subtype
    .replace(/^vnd\./, '')
    .split('.')
    .pop();
  if (!tail) return null;
  return tail.length > 12 ? tail.slice(0, 12).toUpperCase() : tail.toUpperCase();
}
