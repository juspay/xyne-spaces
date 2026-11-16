import { stripDangerousMessageMarkup } from '@/utils/contentUtils';

const SANITIZED_OPERATIONS = new Set(['insert', 'update', 'upsert']);

/**
 * Strips script-capable markup from message content on every Zero write, so stored
 * messages are safe whichever mutator wrote them. Other tables and operations pass through.
 */
export function sanitizeMutationArgs(tableName: string, operation: string, args: unknown): unknown {
  if (tableName !== 'messages' || !SANITIZED_OPERATIONS.has(operation)) return args;
  if (!args || typeof args !== 'object') return args;

  const { content } = args as { content?: unknown };
  if (typeof content !== 'string') return args;

  const cleaned = stripDangerousMessageMarkup(content);
  return cleaned === content ? args : { ...args, content: cleaned };
}
