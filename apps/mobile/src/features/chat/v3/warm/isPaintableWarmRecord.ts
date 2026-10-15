import type { WarmWindow } from '../warm/warmWindow.types';

const MARKDOWN_KEYS = ['initial_message_md', 'initialMessageMd'] as const;

export const isPaintableWarmRecord = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (MARKDOWN_KEYS.some(key => typeof record[key] === 'string' && record[key].length > 0)) {
    return true;
  }
  if (typeof record['content'] === 'string' && record['content'].length > 0) {
    return true;
  }
  const attachments = record['attachments'] ?? record['initialMessageAttachments'];
  return Array.isArray(attachments) && attachments.length > 0;
};

export const hasPaintableWarmRecords = (warm: WarmWindow | null): boolean =>
  Boolean(warm?.records.some(isPaintableWarmRecord));
