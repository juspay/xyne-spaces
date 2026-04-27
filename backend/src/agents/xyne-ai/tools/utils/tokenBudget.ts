/**
 * Token Budget Utility
 *
 * Keeps verbose tool outputs from blowing the model's context window.
 * The heuristic `chars / 3.5` is intentionally cheap — we want a soft cap that's
 * accurate to ~±10%, not a real tokenizer. Swap in a proper tokenizer here later
 * without touching callers.
 */

import type { ToolEntity, ToolMessage } from '../types.js';

const CHARS_PER_TOKEN = 3.5;

export function tokenCount(str: string): number {
  return Math.ceil(str.length / CHARS_PER_TOKEN);
}

/**
 * Walk items in order and keep as many as fit under `budget` tokens.
 * Renders each item via `render` to compute its cost. Guarantees at least one
 * item is kept when the input is non-empty — starving the agent on an oversized
 * single item is worse than overflowing by a bit.
 */
export function enforceTokenBudget<T>(
  items: T[],
  budget: number,
  render: (item: T) => string,
): { kept: T[]; total: number } {
  const total = items.length;
  if (total === 0) return { kept: [], total: 0 };

  const kept: T[] = [];
  let running = 0;
  for (const item of items) {
    const cost = tokenCount(render(item));
    if (kept.length > 0 && running + cost > budget) break;
    kept.push(item);
    running += cost;
  }
  return { kept, total };
}

/**
 * Build an in-band truncation notice for the agent. Returns empty string when
 * nothing was dropped. The hint gives the model a concrete recovery move.
 */
export function formatOverflowNotice(kept: number, total: number, hint: string): string {
  if (kept >= total) return '';
  return `[Truncated: returned ${kept} of ${total} items to fit context. ${hint}]\n\n`;
}

/**
 * Render a ToolEntity in a form close to what the agent will see. The exact
 * prefix (e.g. `[A1]`) is unknown at budgeting time, so we substitute a
 * placeholder of comparable length. Precision doesn't matter here — we only
 * need the item's relative size.
 */
export function renderEntityForBudget(entity: ToolEntity): string {
  const channelInfo = entity.channelName ? ` in **${entity.channelName}**` : '';
  const attachmentNote = entity.hasAttachment ? ' [has attachment]' : '';
  return `[X999] ${entity.authorName} (${entity.timestamp})${channelInfo}${attachmentNote}:\n${entity.content}`;
}

export function renderMessageForBudget(msg: ToolMessage): string {
  const channelInfo = msg.channelName ? ` in **${msg.channelName}**` : '';
  const attachmentNote = msg.hasAttachment ? ' [has attachment]' : '';
  return `[X999] ${msg.authorName} (${msg.timestamp})${channelInfo}${attachmentNote}:\n${msg.content}`;
}
