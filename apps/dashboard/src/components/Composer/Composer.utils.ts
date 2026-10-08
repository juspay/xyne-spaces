import type { DisplaySearchResult } from '../../types/search';
import type { ContextSelections } from '../Chat/XyneAISidebar/components/ContextPickerPanel';
import type { ContextRef, PickedContext, TriggerChar } from './Composer.types';

// ── Triggers ────────────────────────────────────────────────────────────────

/** Stand-in for an inline mention (an atom) in text read back from the editor. */
export const ATOM_PLACEHOLDER = '\ufffc';
const ZWSP = /\u200b/g;

/**
 * The trigger the caret is in, read from the text of the current paragraph up
 * to the caret. A trigger starts a word (start of line, after whitespace or an
 * opening bracket) so "a@b.com", "and/or" and "https://" never open a menu,
 * and its query runs to the caret without whitespace — so typing a space is
 * what closes "#" and "/" and leaves the text as typed. ("@" opens a picker
 * that outlives spaces; see the composer's mention session.) A "/" mid-message
 * still lists commands; the pick moves to the start, where the agent reads it.
 */
export function findTrigger(
  blockTextBefore: string,
): { char: TriggerChar; query: string; offset: number } | null {
  const match = /(^|[\s(\ufffc])([@#/])([^\s@#/\ufffc]{0,60})$/.exec(blockTextBefore);
  if (!match) return null;
  const char = match[2] as TriggerChar;
  const offset = match.index + (match[1]?.length ?? 0);
  return { char, query: match[3] ?? '', offset };
}

/** Plain text as the agent reads it: mentions as their tokens, no guard characters. */
export function cleanEditorText(text: string): string {
  return text.replace(ZWSP, '');
}

// ── Picked context ──────────────────────────────────────────────────────────

export const refKey = (ref: ContextRef): string => `${ref.kind}:${ref.id}`;

/** Text inline in the message for a picked item — what the agent reads. */
export function mentionToken(kind: ContextRef['kind'], mention: string): string {
  return kind === 'channel' ? `#${mention}` : `@${mention}`;
}

const stripTags = (value: string): string =>
  value
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/**
 * Map a search row to what the composer attaches. Null for rows the agent
 * cannot take as context (mail, knowledge-base hits — those come in through
 * the "+" menu's Collections).
 */
export function pickFromResult(result: DisplaySearchResult): PickedContext | null {
  const ctx = result.searchContext;
  const title = stripTags(result.title || '');
  switch (result.type) {
    case 'user':
      // Local directory rows and Vespa user hits both carry the user id as `id`.
      return title ? { kind: 'person', id: result.id, label: title, mention: title } : null;
    case 'channel': {
      const name = title.replace(/^#/, '');
      const id = ctx?.channelId ?? result.id;
      return name
        ? {
            kind: 'channel',
            id,
            label: name,
            mention: name,
            isPrivate: (ctx?.scopeType ?? '').toUpperCase() === 'PRIVATE',
          }
        : null;
    }
    case 'conversation': {
      if (ctx?.subApp?.toUpperCase() === 'DESK') return null;
      const sender = ctx?.senderName?.trim() || 'Someone';
      const text = stripTags(result.context ?? '') || title;
      return {
        kind: 'message',
        id: ctx?.messageId ?? result.id,
        label: truncate(`${sender}: ${text}`, 80),
        mention: `${firstName(sender)}'s message`,
        ...(ctx?.conversationId ? { conversationId: ctx.conversationId } : {}),
        ...(ctx?.channelId ? { channelId: ctx.channelId } : {}),
      };
    }
    case 'ticket':
      return {
        kind: 'ticket',
        id: result.id,
        label: title || ctx?.xyneId || 'Ticket',
        mention: ctx?.xyneId || truncate(title, 40),
        ...(ctx?.xyneId ? { xyneId: ctx.xyneId } : {}),
        ...(ctx?.ticketStatus ? { status: ctx.ticketStatus } : {}),
        ...(ctx?.channelId ? { channelId: ctx.channelId } : {}),
        ...(ctx?.conversationId ? { conversationId: ctx.conversationId } : {}),
      };
    case 'attachment': {
      const subApp = ctx?.subApp?.toUpperCase();
      const id = ctx?.attachmentId ?? result.id;
      const name = stripTags(ctx?.fileName ?? '') || title;
      if (!name) return null;
      if (subApp === 'CANVAS') {
        return { kind: 'canvas', id, label: name, mention: name, canvasId: result.id };
      }
      if (subApp === 'TRANSCRIPT') {
        return {
          kind: 'call',
          id,
          label: name,
          mention: name,
          ...(ctx?.channelId ? { channelId: ctx.channelId } : {}),
          ...(ctx?.conversationId ? { conversationId: ctx.conversationId } : {}),
          ...(ctx?.externalId ? { externalId: ctx.externalId } : {}),
        };
      }
      if (subApp === 'DESK' || subApp === 'RCA') return null;
      return {
        kind: 'attachment',
        id,
        label: name,
        mention: name,
        ...(ctx?.conversationId ? { conversationId: ctx.conversationId } : {}),
        ...(ctx?.channelId ? { channelId: ctx.channelId } : {}),
      };
    }
    default:
      return null;
  }
}

export function pickFromChannel(
  channel: { id: string; visibility?: string | null },
  displayName: string,
): PickedContext {
  return {
    kind: 'channel',
    id: channel.id,
    label: displayName,
    mention: displayName,
    isPrivate: (channel.visibility ?? '').toUpperCase() === 'PRIVATE',
  };
}

/**
 * The inline token the composer wrote for an attached item — "#general",
 * "@Samit Barai", "@Prakhar's message", "@XYS-9" — rebuilt from what the sent
 * message keeps (its attached context), so the message can show it as a pill
 * again. Mirrors the `mention` each branch of {@link pickFromResult} picks.
 * Null for context that is never written inline (collections, folders, …).
 */
export function sentMentionToken(item: {
  type: string;
  title: string;
  metadata?: Record<string, unknown>;
}): string | null {
  const title = item.title.trim();
  if (!title) return null;
  switch (item.type) {
    case 'channel':
      return mentionToken('channel', title);
    case 'user':
    case 'attachment':
    case 'canvas':
    case 'call':
      return mentionToken('person', title);
    case 'message': {
      // The pill reads "Sender: text"; the inline token is "First's message".
      const sender = title.split(': ')[0]?.trim() || 'Someone';
      return mentionToken('message', `${firstName(sender)}'s message`);
    }
    case 'ticket': {
      const xyneId = item.metadata?.['xyneId'];
      return mentionToken(
        'ticket',
        typeof xyneId === 'string' && xyneId ? xyneId : truncate(title, 40),
      );
    }
    default:
      return null;
  }
}

// ── Selections ──────────────────────────────────────────────────────────────

export const MAX_CHANNELS = 5;
/** claw-auth drops ALL attached context past 20 items, so never send more. */
export const MAX_ATTACHED = 20;

/** Items `toAttachedContext` will send for these selections. */
export function countAttached(s: ContextSelections): number {
  return (
    s.channels.length +
    s.tickets.length +
    s.canvases.length +
    s.transcripts.length +
    s.recordings.length +
    (s.messages?.length ?? 0) +
    (s.people?.length ?? 0) +
    (s.sharedFiles?.length ?? 0) +
    (s.files?.length ?? 0) +
    (s.folders?.length ?? 0) +
    (s.collections?.length ?? 0) +
    s.localFolders.length
  );
}

/** `${kind}:${id}` for everything in the selections the menus can attach. */
export function pickedRefsOf(s: ContextSelections): Set<string> {
  const refs = new Set<string>();
  s.channels.forEach(c => refs.add(refKey({ kind: 'channel', id: c.id })));
  s.tickets.forEach(t => refs.add(refKey({ kind: 'ticket', id: t.id })));
  s.canvases.forEach(c => refs.add(refKey({ kind: 'canvas', id: c.id })));
  s.transcripts.forEach(t => refs.add(refKey({ kind: 'call', id: t.id })));
  s.recordings.forEach(r => refs.add(refKey({ kind: 'call', id: r.id })));
  s.messages?.forEach(m => refs.add(refKey({ kind: 'message', id: m.id })));
  s.people?.forEach(p => refs.add(refKey({ kind: 'person', id: p.id })));
  s.sharedFiles?.forEach(f => refs.add(refKey({ kind: 'attachment', id: f.id })));
  return refs;
}

/**
 * Selections with `item` attached, or why it can't be. Already attached is
 * not an error — the mention still goes in, pointing at the same pill.
 * `extraCount` is context the host sends outside these selections (KB scopes
 * it keeps elsewhere), so the cap covers everything that is sent.
 */
export function addPicked(
  s: ContextSelections,
  item: PickedContext,
  extraCount = 0,
): { next: ContextSelections } | { error: string } {
  if (pickedRefsOf(s).has(refKey(item))) return { next: s };
  if (item.kind === 'channel' && s.channels.length >= MAX_CHANNELS) {
    return { error: `You can add up to ${MAX_CHANNELS} channels` };
  }
  if (countAttached(s) + extraCount >= MAX_ATTACHED) {
    return { error: `You can add up to ${MAX_ATTACHED} items of context` };
  }
  switch (item.kind) {
    case 'channel':
      return {
        next: {
          ...s,
          channels: [...s.channels, { id: item.id, name: item.label, isPrivate: item.isPrivate }],
        },
      };
    case 'person':
      return { next: { ...s, people: [...(s.people ?? []), { id: item.id, name: item.label }] } };
    case 'message':
      return {
        next: {
          ...s,
          messages: [
            ...(s.messages ?? []),
            {
              id: item.id,
              title: item.label,
              ...(item.conversationId ? { conversationId: item.conversationId } : {}),
              ...(item.channelId ? { channelId: item.channelId } : {}),
            },
          ],
        },
      };
    case 'attachment':
      return {
        next: {
          ...s,
          sharedFiles: [
            ...(s.sharedFiles ?? []),
            {
              id: item.id,
              name: item.label,
              ...(item.conversationId ? { conversationId: item.conversationId } : {}),
              ...(item.channelId ? { channelId: item.channelId } : {}),
            },
          ],
        },
      };
    case 'canvas':
      return {
        next: {
          ...s,
          canvases: [
            ...s.canvases,
            {
              id: item.id,
              title: item.label,
              ...(item.canvasId ? { canvasId: item.canvasId } : {}),
            },
          ],
        },
      };
    case 'ticket':
      return {
        next: {
          ...s,
          tickets: [
            ...s.tickets,
            {
              id: item.id,
              title: item.label,
              ...(item.xyneId ? { xyneId: item.xyneId } : {}),
              ...(item.status ? { status: item.status } : {}),
              ...(item.channelId ? { channelId: item.channelId } : {}),
              ...(item.conversationId ? { conversationId: item.conversationId } : {}),
            },
          ],
        },
      };
    case 'call':
      return {
        next: {
          ...s,
          transcripts: [
            ...s.transcripts,
            {
              id: item.id,
              title: item.label,
              ...(item.channelId ? { channelId: item.channelId } : {}),
              ...(item.conversationId ? { conversationId: item.conversationId } : {}),
            },
          ],
        },
      };
  }
}

export function removePicked(s: ContextSelections, ref: ContextRef): ContextSelections {
  const without = <T extends { id: string }>(list: T[]): T[] => list.filter(i => i.id !== ref.id);
  switch (ref.kind) {
    case 'channel':
      return { ...s, channels: without(s.channels) };
    case 'person':
      return { ...s, people: without(s.people ?? []) };
    case 'message':
      return { ...s, messages: without(s.messages ?? []) };
    case 'attachment':
      return { ...s, sharedFiles: without(s.sharedFiles ?? []) };
    case 'canvas':
      return { ...s, canvases: without(s.canvases) };
    case 'ticket':
      return { ...s, tickets: without(s.tickets) };
    case 'call':
      return { ...s, transcripts: without(s.transcripts), recordings: without(s.recordings) };
  }
}

// ── Models ──────────────────────────────────────────────────────────────────

export const AUTO_MODEL_DESCRIPTION = 'Balanced quality and speed recommended for most tasks';

// ── Tray ────────────────────────────────────────────────────────────────────

/**
 * How many pills fit on one line of `trackWidth`, leaving room for the "+N
 * more" pill when some don't.
 */
export function fitCount(
  widths: number[],
  trackWidth: number,
  moreWidth: number,
  gap: number,
): number {
  let used = 0;
  let count = 0;
  for (const width of widths) {
    const next = used + width + (count > 0 ? gap : 0);
    if (next > trackWidth) break;
    used = next;
    count += 1;
  }
  if (count < widths.length) {
    while (count > 0 && used + gap + moreWidth > trackWidth) {
      count -= 1;
      used -= (widths[count] ?? 0) + (count > 0 ? gap : 0);
    }
  }
  return count;
}
