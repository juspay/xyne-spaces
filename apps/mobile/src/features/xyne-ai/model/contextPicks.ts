import type { DisplaySearchResult } from '@/src/types/search';
import { HTML_TAG_OR_EMPTY, stripHtmlTags } from '@/src/utils/htmlText';

import type { AttachedContextItem } from '../api/xyneAIRequest';

/** The server drops all attached context past this many items. */
const MAX_ATTACHED = 20;

const MESSAGE_LABEL_MAX = 80;

/** A label for a single-line pill: line breaks and runs of spaces would leave it blank or ragged. */
export const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

const plain = (value: string | undefined): string =>
  stripHtmlTags(value ?? '', HTML_TAG_OR_EMPTY).trim();

const truncate = (value: string): string =>
  value.length > MESSAGE_LABEL_MAX ? `${value.slice(0, MESSAGE_LABEL_MAX - 1)}…` : value;

function location(ids: Record<string, string | undefined>): Pick<AttachedContextItem, 'metadata'> {
  const set = Object.entries(ids).filter((entry): entry is [string, string] => Boolean(entry[1]));
  return set.length > 0 ? { metadata: Object.fromEntries(set) } : {};
}

export const pickKey = ({ type, id }: AttachedContextItem): string => `${type}:${id}`;

export const isCollectionPick = ({ type }: AttachedContextItem): boolean =>
  type === 'collection' || type === 'folder' || type === 'file';

/** Adds or removes `pick`; adding also keeps `root`, the collection a folder or file is read through. */
export function togglePick(
  picks: AttachedContextItem[],
  pick: AttachedContextItem,
  root?: AttachedContextItem,
): AttachedContextItem[] {
  const has = (item: AttachedContextItem): boolean =>
    picks.some(other => pickKey(other) === pickKey(item));
  if (has(pick)) return picks.filter(other => pickKey(other) !== pickKey(pick));
  const added = root && !has(root) ? [root, pick] : [pick];
  return picks.length + added.length <= MAX_ATTACHED ? [...picks, ...added] : picks;
}

export const personPick = (id: string, name: string): AttachedContextItem => ({
  type: 'user',
  id,
  title: name,
});

export const channelPick = (id: string, name: string): AttachedContextItem => ({
  type: 'channel',
  id,
  title: name.replace(/^#/, ''),
});

/** The attached context for a search hit, as the web composer's @ menu builds it. */
export function pickFromResult(result: DisplaySearchResult): AttachedContextItem | null {
  const context = result.searchContext;
  const title = plain(result.title);
  const threadId = context?.conversationId;
  switch (result.type) {
    case 'user':
      return title ? personPick(result.id, title) : null;
    case 'channel':
      return title ? channelPick(context?.channelId ?? result.id, title) : null;
    case 'conversation':
      return context?.subApp?.toUpperCase() === 'DESK'
        ? null
        : {
            type: 'message',
            id: context?.messageId ?? result.id,
            title: truncate(
              `${context?.senderName?.trim() || 'Someone'}: ${plain(result.context) || title}`,
            ),
            ...(threadId && { threadId }),
            ...location({ channelId: context?.channelId }),
          };
    case 'ticket':
      return {
        type: 'ticket',
        id: result.id,
        title: title || context?.xyneId || 'Ticket',
        ...location({
          xyneId: context?.xyneId,
          channelId: context?.channelId,
          conversationId: threadId,
        }),
      };
    case 'attachment': {
      const subApp = context?.subApp?.toUpperCase();
      const id = context?.attachmentId ?? result.id;
      const name = plain(context?.fileName) || title;
      if (!name || subApp === 'DESK' || subApp === 'RCA') return null;
      if (subApp === 'CANVAS') {
        return { type: 'canvas', id, title: name, ...location({ canvasId: result.id }) };
      }
      return {
        type: subApp === 'TRANSCRIPT' ? 'call' : 'attachment',
        id,
        title: name,
        ...(threadId && { threadId }),
        ...location({ channelId: context?.channelId }),
      };
    }
  }
}
