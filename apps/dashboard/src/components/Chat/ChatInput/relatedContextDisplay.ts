/**
 * How related-context items are named and coloured, shared by the composer's chip
 * row and the popup that opens from it, so both describe an item the same way.
 */
import { FileText, MessageSquare, Ticket, Video, type LucideIcon } from 'lucide-react';

import type { RelatedItem, RelatedKind, RelatedLabel } from '../../../types/search';

/**
 * Colours come from the theme's status tokens, which every theme (classic,
 * summer_breeze, midnight) defines for its own background: `tint` colours icons and
 * label text, `dot` and `badge` fill small marks with the same colour.
 */
export const LABELS: Record<
  RelatedLabel,
  { chip: string; hint: string; group: string; tint: string; dot: string }
> = {
  answers_it: {
    chip: 'Answered',
    hint: 'Looks like this has the answer',
    group: 'Answered',
    tint: 'text-status-success',
    dot: 'bg-status-success',
  },
  same_question: {
    chip: 'Asked before',
    hint: 'Looks like this was asked before',
    group: 'Asked before',
    tint: 'text-status-pending',
    dot: 'bg-status-pending',
  },
  related_discussion: {
    chip: 'Discussed',
    hint: 'Looks like this was discussed',
    group: 'Discussed',
    tint: 'text-status-scheduled',
    dot: 'bg-status-scheduled',
  },
};

/** Answers first, then asked-before, then discussed — the order the API ranks them in. */
export const LABEL_ORDER: RelatedLabel[] = ['answers_it', 'same_question', 'related_discussion'];

export const KINDS: Record<RelatedKind, { icon: LucideIcon; name: string }> = {
  thread: { icon: MessageSquare, name: 'Thread' },
  ticket: { icon: Ticket, name: 'Ticket' },
  canvas: { icon: FileText, name: 'Canvas' },
  call: { icon: Video, name: 'Call' },
};

export const plain = (value: string | undefined): string =>
  (value ?? '')
    .replace(/<\/?hi>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The channel a thread lives in, as the sidebar names it: `#name`, or the DM's name. */
export function channelOf(item: Pick<RelatedItem, 'result'>): string {
  const { result } = item;
  const context = result.searchContext;
  const channel = plain(context?.channelTitle ?? result.metadata.channelName).replace(/^#/, '');
  const isDm = context?.scopeType === 'DM' || context?.scopeType === 'GROUP_DM';
  return !channel || isDm ? channel : `#${channel}`;
}

/** Where the item lives, as short as it can be and still be recognised. */
export function whereOf(item: Pick<RelatedItem, 'kind' | 'result'>): string {
  const { result } = item;
  if (item.kind === 'thread') {
    return channelOf(item);
  }
  if (item.kind === 'ticket') {
    return [result.searchContext?.xyneId, plain(result.title)].filter(Boolean).join(' ');
  }
  return plain(result.title);
}

/**
 * The matched text as a sentence: canvas chunks arrive as markdown, so heading and
 * list markers go, and a leading heading that only repeats the title is dropped.
 */
export function snippetOf(item: Pick<RelatedItem, 'result'>): string {
  const text = plain(
    (item.result.context ?? '')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, '')
      // Paired emphasis and inline code only: VPN_ACCESS_GROUP or a*b keep their marks.
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, '$2')
      .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1$2')
      .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, '$1$2'),
  );
  const title = plain(item.result.title);
  return title && text.startsWith(title) ? text.slice(title.length).trim() : text;
}
