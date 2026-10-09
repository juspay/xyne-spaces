import {
  Fragment,
  cloneElement,
  isValidElement,
  useCallback,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Activity, BookOpen, FileText, FolderGit2, Paperclip } from 'lucide-react';
import {
  ChatDefault,
  File02Default,
  File02Text,
  FolderDefault,
  Hashtag,
  PhoneDefault,
  TicketToken,
} from '@xyne/icons';
import Avatar from '../ui/Avatar/Avatar';
import {
  metadataString,
  type AttachedContextItem,
} from '../Chat/XyneAISidebar/components/ContextPickerPanel';
import type { UserTag } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import { sentMentionToken } from '../Composer/Composer.utils';
import { useAllChannels } from '../../hooks/useChannels';
import { useAuthContextValues } from '../../hooks/useAuth';
import { navigateToTicket, navigateToUser } from '../../utils/searchNavigation';
import type { DisplaySearchResult } from '../../types/search';
import { cn } from '../../utils/classNames';

const itemKey = (item: AttachedContextItem): string => `${item.type}:${item.id}`;

// ── Opening what a pill names ───────────────────────────────────────────────

/**
 * What clicking a sent context item does: open it where it lives, the way ⌘K
 * does. Null for an item that carries no location (KB scopes, older messages).
 */
export function useOpenContextItem(): (item: AttachedContextItem) => (() => void) | null {
  const navigate = useNavigate();
  const channels = useAllChannels();
  const { userID } = useAuthContextValues();

  return useCallback(
    (item: AttachedContextItem): (() => void) | null => {
      const asResult = (
        searchContext: DisplaySearchResult['searchContext'],
      ): DisplaySearchResult => ({
        id: item.id,
        type: item.type === 'user' ? 'user' : 'ticket',
        title: item.title,
        subtitle: '',
        relevanceScore: 0,
        metadata: {},
        ...(searchContext ? { searchContext } : {}),
      });
      const channelId = metadataString(item, 'channelId');
      switch (item.type) {
        case 'channel':
          return (): void => void navigate(`/chat/dir/${item.id}`);
        case 'user':
          return (): void => {
            navigateToUser(asResult(undefined), navigate, channels, {
              ...(userID ? { callerUserId: userID } : {}),
            }).catch(() => toast.error(`Couldn't open a chat with ${item.title}`));
          };
        case 'message':
          return channelId && item.threadId
            ? (): void =>
                void navigate(
                  `/chat/dir/${channelId}/${item.threadId}#origin=${item.threadId}&messageId=${item.id}`,
                )
            : null;
        case 'ticket': {
          const conversationId = metadataString(item, 'conversationId');
          const xyneId = metadataString(item, 'xyneId');
          return channelId && conversationId
            ? (): void =>
                navigateToTicket(
                  asResult({
                    ticketId: item.id,
                    channelId,
                    conversationId,
                    ...(xyneId ? { xyneId } : {}),
                  }),
                  navigate,
                  channels,
                )
            : null;
        }
        case 'canvas': {
          const canvasId = metadataString(item, 'canvasId');
          return canvasId ? (): void => void navigate(`/chat/canvas/${canvasId}`) : null;
        }
        case 'call':
          return channelId
            ? (): void =>
                void navigate(
                  item.threadId
                    ? `/chat/dir/${channelId}/${item.threadId}`
                    : `/chat/dir/${channelId}`,
                )
            : null;
        case 'attachment':
          return channelId
            ? (): void =>
                void navigate(`/chat/dir/${channelId}`, {
                  state: { attachmentId: item.id, openAttachment: true },
                })
            : null;
        default:
          return null;
      }
    },
    [navigate, channels, userID],
  );
}

// ── Mentions in the sent text ───────────────────────────────────────────────

interface SentToken {
  text: string;
  item: AttachedContextItem;
}

/** The pill an @/# mention keeps after sending — the composer's look, now a link. */
function SentMention({
  token,
  item,
  open,
}: {
  token: SentToken['text'];
  item: AttachedContextItem;
  open: (() => void) | null;
}): ReactElement {
  const pill =
    'inline-block max-w-[260px] truncate align-bottom rounded-[5px] bg-[var(--mention-bg)] px-1 font-medium text-[color:var(--mention-color)]';
  if (!open) {
    return (
      <span className={pill} title={item.title}>
        {token}
      </span>
    );
  }
  return (
    <button
      type='button'
      onClick={open}
      title={`Open ${item.title}`}
      className={cn(
        pill,
        'cursor-pointer underline-offset-2 transition-colors hover:bg-[var(--mention-bg-hover)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--mention-color)]/40',
      )}
      data-track-category='XyneAI'
      data-track-name='OPEN_SENT_MENTION'
      data-track-metadata={JSON.stringify({ type: item.type })}
    >
      {token}
    </button>
  );
}

/** Splits text at the mentions it contains; a mention starts a word and ends one. */
function splitAtMentions(text: string, tokens: SentToken[]): Array<string | SentToken> {
  const parts: Array<string | SentToken> = [];
  let last = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if ((ch !== '@' && ch !== '#') || (i > 0 && !/[\s(]/.test(text[i - 1] ?? ''))) continue;
    const hit = tokens.find(
      t => text.startsWith(t.text, i) && !/[\p{L}\p{N}_]/u.test(text[i + t.text.length] ?? ''),
    );
    if (!hit) continue;
    if (i > last) parts.push(text.slice(last, i));
    parts.push(hit);
    i += hit.text.length - 1;
    last = i + 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export interface SentMentions {
  /** The message text (a string or rendered markdown) with its mentions as pills. */
  render: (node: ReactNode) => ReactNode;
}

/**
 * A sent user message's @/# mentions as the pills they were in the composer,
 * each opening what it names. The tokens are rebuilt from the message's
 * attached context (and inline people from its user tags). The text between
 * them goes through `renderText` — the surface's user-tag chips — so older
 * messages read as before. Keep `renderText` stable (useCallback).
 */
export function useSentMentions(
  items: AttachedContextItem[] | undefined,
  userTags: Record<string, UserTag> | undefined,
  renderText: (text: string) => ReactNode,
): SentMentions {
  const opener = useOpenContextItem();

  const tokens = useMemo(() => {
    const byText = new Map<string, SentToken>();
    for (const item of items ?? []) {
      const token = sentMentionToken(item);
      if (token && !byText.has(token)) byText.set(token, { text: token, item });
    }
    for (const [key, tag] of Object.entries(userTags ?? {})) {
      const token = `@${key.replace(/^<|>$/g, '')}`;
      if (!byText.has(token)) {
        byText.set(token, { text: token, item: { type: 'user', id: tag.userId, title: tag.name } });
      }
    }
    // Longest first, so "@Samit Barai" wins over a shorter "@Samit".
    return [...byText.values()].sort((a, b) => b.text.length - a.text.length);
  }, [items, userTags]);

  const render = useCallback(
    (node: ReactNode): ReactNode => {
      const walk = (current: ReactNode): ReactNode => {
        if (typeof current === 'string') {
          if (tokens.length === 0) return renderText(current);
          return splitAtMentions(current, tokens).map((part, index) =>
            typeof part === 'string' ? (
              <Fragment key={index}>{renderText(part)}</Fragment>
            ) : (
              <SentMention
                key={index}
                token={part.text}
                item={part.item}
                open={opener(part.item)}
              />
            ),
          );
        }
        if (Array.isArray(current)) {
          return current.map((child: ReactNode, index) => (
            <Fragment key={index}>{walk(child)}</Fragment>
          ));
        }
        if (
          isValidElement<{ children?: ReactNode }>(current) &&
          current.props.children !== undefined
        ) {
          return cloneElement(current, { children: walk(current.props.children) });
        }
        return current;
      };
      return walk(node);
    },
    [tokens, renderText, opener],
  );

  return { render };
}

// ── The strip under the message ─────────────────────────────────────────────

const ICON = 'size-3.5 shrink-0';

/** Same icons the composer's tray uses, so a pill reads the same before and after sending. */
function iconFor(item: AttachedContextItem): ReactElement {
  switch (item.type) {
    case 'channel':
      return <Hashtag className={ICON} />;
    case 'message':
      return <ChatDefault className={ICON} />;
    case 'user':
      return (
        <Avatar userId={item.id} size='xs' rounded showActiveStatus={false} className='size-3.5' />
      );
    case 'attachment':
      return <File02Default className={ICON} />;
    case 'canvas':
      return <File02Text className={ICON} />;
    case 'ticket':
      return <TicketToken className={ICON} />;
    case 'call':
      return <PhoneDefault className={ICON} />;
    case 'collection':
      return <BookOpen className={ICON} aria-hidden />;
    case 'folder':
      return <FolderDefault className={ICON} />;
    case 'file':
      return <FileText className={ICON} aria-hidden />;
    case 'local-folder':
      return <FolderGit2 className={ICON} aria-hidden />;
    default:
      return <Activity className={ICON} aria-hidden />;
  }
}

/**
 * Everything the user attached to a turn — what the text mentions and what it
 * doesn't (collections, a thread or canvas the sidebar opened on). Persisted
 * per message, so it survives a reload. Collapsed to a paperclip with a count;
 * opening it lays the pills out to its left, in the composer tray's style, and
 * each opens what it names.
 */
export function ReadonlyContextPills({
  items,
  className,
}: {
  items: AttachedContextItem[];
  className?: string;
}): ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const opener = useOpenContextItem();
  const shown = items ?? [];
  if (shown.length === 0) return null;
  const summary = `${shown.length} attached ${shown.length === 1 ? 'item' : 'items'}`;

  return (
    <div className={cn('mt-1 flex flex-wrap items-center justify-end gap-0.5', className)}>
      {expanded &&
        shown.map((item, index) => {
          const open = opener(item);
          const content = (
            <>
              {iconFor(item)}
              <span className='max-w-[180px] truncate'>{item.title}</span>
            </>
          );
          const pill =
            'flex h-6 items-center gap-1.5 rounded-lg px-1.5 text-[13px] text-muted-foreground transition-colors duration-150 animate-in fade-in-0 slide-in-from-right-1';
          return open ? (
            <button
              key={`${itemKey(item)}-${index}`}
              type='button'
              onClick={open}
              title={`Open ${item.title}`}
              className={cn(pill, 'hover:bg-secondary hover:text-foreground')}
              data-track-category='XyneAI'
              data-track-name='OPEN_SENT_CONTEXT'
              data-track-metadata={JSON.stringify({ type: item.type })}
            >
              {content}
            </button>
          ) : (
            <span key={`${itemKey(item)}-${index}`} className={pill} title={item.title}>
              {content}
            </span>
          );
        })}
      <button
        type='button'
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? `Hide ${summary}` : `Show ${summary}`}
        title={summary}
        className={cn(
          'flex h-6 items-center gap-1 rounded-lg px-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
          expanded && 'bg-secondary text-foreground',
        )}
        data-track-category='XyneAI'
        data-track-name='TOGGLE_CONTEXT_PILLS'
      >
        <Paperclip className={ICON} aria-hidden />
        {shown.length}
      </button>
    </div>
  );
}
