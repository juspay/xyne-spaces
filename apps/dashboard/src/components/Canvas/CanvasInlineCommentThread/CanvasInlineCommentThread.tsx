import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import { useUserGroupSearch } from '@xyne/shared/hooks';
import { CanvasCommentThreadStatus } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';

import { useAuth } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useMentionSearch } from '../../../hooks/useMentionSearch';
import { useUsers } from '../../../hooks/useUsers';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { cn } from '../../../utils/classNames';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { logger, Event } from '../../../utils/logger';
import { apiInstance } from '../../../services/clients/apiClient';
import { MentionRenderer } from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import Avatar from '../../ui/Avatar/Avatar';
import { InputBox } from '../../ui/InputBox';
import type { MentionResult } from '../../ui/InputBox';
import Button from '../../ui/Button';
import { formatRelativeCommentTime } from '../canvasCommentTime';
import type { CanvasCommentAnchor } from '../CanvasCommentsPanel/CanvasCommentsPanel';
import { OverlayZIndexContext } from '../../../contexts/OverlayZIndexContext';
import type { CanvasCommentHighlightThread } from '../useCanvasCommentHighlights';

type UserLite = {
  id: string;
  name?: string;
  displayName?: string | null;
  email?: string;
};

type CanvasComment = {
  id: string;
  threadId: string;
  canvasId: string;
  body: string;
  mentionedUserIds?: string | null;
  isInitial?: boolean;
  createdBy: string;
  deletedAt?: number | null;
  createdAt: number;
  createdByUser?: UserLite | null;
};

interface CanvasInlineCommentThreadProps {
  canvasId: string;
  canvasTitle?: string | undefined;
  channelId?: string | undefined;
  thread?: CanvasCommentHighlightThread | undefined;
  activeAnchor?: CanvasCommentAnchor | undefined;
  anchorRect: DOMRect;
  editable: boolean;
  onClose: () => void;
  onBeforeCreateThread?: ((threadId: string, anchor: CanvasCommentAnchor) => boolean) | undefined;
  onCreateThreadCreated?: (() => void) | undefined;
  onCreateThreadFailed?: ((anchor: CanvasCommentAnchor) => void) | undefined;
}

const extractMentionedUserIdsFromHtml = (html: string, fallbackIds: string[]): string[] => {
  const ids = new Set<string>();
  const mentionRegex = /data-user-id="([^"]+)"/g;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(html)) !== null) {
    const userId = match[1];
    if (userId) ids.add(userId);
  }

  if (ids.size === 0) {
    fallbackIds.forEach(userId => ids.add(userId));
  }

  return [...ids];
};

const parseMentionedUserIds = (mentionedUserIds?: string | null): string[] => {
  if (!mentionedUserIds) return [];
  try {
    const parsed: unknown = JSON.parse(mentionedUserIds);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const getDisplayName = (user?: UserLite | null): string =>
  user?.displayName || user?.name || user?.email || 'Unknown';

const getCommentAuthor = (
  comment: CanvasComment | undefined,
  users: UserLite[],
): UserLite | null =>
  comment
    ? (users.find(candidate => candidate.id === comment.createdBy) ?? comment.createdByUser ?? null)
    : null;

const renderCommentBody = (
  body: string,
  mentionedUserIds: string[],
  users: UserLite[],
): React.ReactNode[] => {
  if (mentionedUserIds.length === 0 || !body) return [body];

  const nodes: React.ReactNode[] = [];
  let remaining = body;
  mentionedUserIds.forEach(userId => {
    const user = users.find(candidate => candidate.id === userId);
    const displayName = user ? getUserDisplayName(user) : '';
    const token = displayName ? `@${displayName}` : '';
    if (!token || !remaining.includes(token)) return;
    const [before, ...afterParts] = remaining.split(token);
    if (before) nodes.push(before);
    nodes.push(
      <MentionRenderer
        key={`${userId}-${nodes.length}`}
        userId={userId}
        fallbackName={displayName}
      />,
    );
    remaining = afterParts.join(token);
  });
  if (remaining) nodes.push(remaining);
  return nodes.length > 0 ? nodes : [body];
};

const CARD_MAX_WIDTH = 470;
const CARD_GAP = 10;
const VIEWPORT_PADDING = 16;
const CARD_TOP_BOUND = 68;
const CARD_BOTTOM_PADDING = 14;
const CARD_MIN_HEIGHT = 140;

const getCardPlacement = (
  rect: DOMRect,
  cardHeight: number,
): { left: number; top: number; width: number; maxHeight: number } => {
  const width = Math.min(CARD_MAX_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2);
  const bottomBound = window.innerHeight - CARD_BOTTOM_PADDING;
  const anchorTop = Math.min(Math.max(rect.top, CARD_TOP_BOUND), bottomBound);
  const anchorBottom = Math.min(Math.max(rect.bottom, CARD_TOP_BOUND), bottomBound);
  const spaceAbove = anchorTop - CARD_GAP - CARD_TOP_BOUND;
  const spaceBelow = bottomBound - (anchorBottom + CARD_GAP);
  const placeAbove =
    cardHeight > spaceBelow && (cardHeight <= spaceAbove || spaceAbove > spaceBelow);
  const maxHeight = Math.max(CARD_MIN_HEIGHT, placeAbove ? spaceAbove : spaceBelow);
  const preferredTop = placeAbove
    ? Math.max(CARD_TOP_BOUND, anchorTop - CARD_GAP - Math.min(cardHeight, spaceAbove))
    : anchorBottom + CARD_GAP;
  const top = Math.max(
    CARD_TOP_BOUND,
    Math.min(preferredTop, bottomBound - Math.min(cardHeight, maxHeight)),
  );
  const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING);
  const left = Math.min(Math.max(rect.left, VIEWPORT_PADDING), maxLeft);
  return { left, top, width, maxHeight };
};

const getAnchorUnionRect = (element: HTMLElement): DOMRect | null => {
  const rects = [...element.getClientRects()];
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map(rect => rect.left));
  const top = Math.min(...rects.map(rect => rect.top));
  const bottom = Math.max(...rects.map(rect => rect.bottom));
  return new DOMRect(left, top, 0, bottom - top);
};

const escapeSelectorValue = (value: string): string =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&');

export function CanvasInlineCommentThread({
  canvasId,
  canvasTitle,
  channelId,
  thread,
  activeAnchor,
  anchorRect,
  editable,
  onClose,
  onBeforeCreateThread,
  onCreateThreadCreated,
  onCreateThreadFailed,
}: CanvasInlineCommentThreadProps): React.JSX.Element | null {
  const zero = useZero();
  const { user } = useAuth();
  const allUsers = useUsers();
  const selectedMentionIdsRef = useRef<Set<string>>(new Set());
  const commentsScrollRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(220);
  const [anchorLiveRect, setAnchorLiveRect] = useState<DOMRect>(anchorRect);
  const [hasEntered, setHasEntered] = useState(false);
  const [createdThread, setCreatedThread] = useState<CanvasCommentHighlightThread | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const {
    results,
    allUsers: mentionUsers,
    searchMentions,
  } = useMentionSearch(channelId, undefined, undefined, { includeSpecialMentions: false });
  const fallbackGroups = useUserGroupSearch(mentionQuery, 10);
  const currentThread = createdThread ?? thread;
  const currentThreadId = currentThread?.id;
  const [comments = []] = useCachedQuery(
    queries.canvasThreadComments({ threadId: currentThreadId || '' }),
    {
      enabled: Boolean(currentThreadId),
    },
  );

  const initialComment = comments.find(comment => comment.isInitial);
  const replies = comments.filter(
    comment =>
      comment.id !== currentThread?.initialCommentId &&
      comment.id !== initialComment?.id &&
      !comment.isInitial &&
      !comment.deletedAt,
  );
  const visibleComments = initialComment ? [initialComment, ...replies] : replies;

  useEffect(() => {
    const scrollElement = commentsScrollRef.current;
    if (!scrollElement) return;
    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [currentThreadId, initialComment?.id, replies.length]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setHasEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    setAnchorLiveRect(anchorRect);
  }, [anchorRect]);

  useLayoutEffect(() => {
    const cardElement = cardRef.current;
    if (!cardElement) return;

    const measure = (): void => {
      const nextHeight = Math.max(cardElement.scrollHeight, cardElement.offsetHeight);
      setCardHeight(previous => (Math.abs(nextHeight - previous) > 2 ? nextHeight : previous));
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(cardElement);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!currentThreadId) return;

    const selector = `[data-canvas-comment-thread-id="${escapeSelectorValue(currentThreadId)}"]`;
    const syncAnchorRect = (): void => {
      const anchorElement = document.querySelector<HTMLElement>(selector);
      if (!anchorElement) return;
      const nextRect = getAnchorUnionRect(anchorElement);
      if (!nextRect) return;
      setAnchorLiveRect(previous =>
        Math.abs(previous.top - nextRect.top) < 0.5 && Math.abs(previous.left - nextRect.left) < 0.5
          ? previous
          : nextRect,
      );
    };

    syncAnchorRect();
    window.addEventListener('scroll', syncAnchorRect, true);
    window.addEventListener('resize', syncAnchorRect);
    return () => {
      window.removeEventListener('scroll', syncAnchorRect, true);
      window.removeEventListener('resize', syncAnchorRect);
    };
  }, [currentThreadId]);

  const mentionItems = useMemo<MentionResult[]>(() => {
    const fallbackMentionItems: MentionResult[] = [
      ...mentionUsers,
      ...fallbackGroups.map(group => ({
        id: group.id,
        name: group.name,
        type: 'group' as const,
        ...(group.alias && { alias: group.alias }),
        ...(group.description && { description: group.description }),
        memberCount: 0,
        isDeactivated: group.isActive === false,
      })),
    ];
    const source = channelId ? results : fallbackMentionItems;
    const query = mentionQuery.trim().toLowerCase();
    return source
      .filter(mention => mention.type !== 'channel' && mention.id !== user?.id)
      .filter(mention => {
        if (channelId || !query) return true;
        return (
          mention.name.toLowerCase().includes(query) ||
          (mention.email?.toLowerCase().includes(query) ?? false) ||
          (mention.alias?.toLowerCase().includes(query) ?? false)
        );
      })
      .slice(0, 8);
  }, [channelId, fallbackGroups, mentionQuery, mentionUsers, results, user?.id]);

  if (!currentThread && !activeAnchor) return null;

  const sendMentionNotifications = (
    mentionedUserIds: string[],
    options?: { blockId?: string; commentThreadId?: string },
  ): void => {
    const uniqueMentionedUserIds = [...new Set(mentionedUserIds)].filter(
      mentionedUserId => mentionedUserId && mentionedUserId !== user?.id,
    );
    if (uniqueMentionedUserIds.length === 0) return;

    const blockId = options?.blockId ?? currentThread?.blockId ?? activeAnchor?.blockId;
    const commentThreadId = options?.commentThreadId ?? currentThread?.id;
    if (!blockId || !commentThreadId) return;

    const path = `redirected?type=canvas&canvasId=${encodeURIComponent(canvasId)}&blockId=${encodeURIComponent(blockId)}&commentThreadId=${encodeURIComponent(commentThreadId)}`;
    const slackUrl = `${window.location.origin}/launch?path=${encodeURIComponent(path)}`;

    uniqueMentionedUserIds.forEach(mentionId => {
      apiInstance
        .post(`/canvas/${canvasId}/mentions`, {
          mentionType: 'user',
          mentionId,
          blockId,
          commentThreadId,
          canvasTitle,
          mentionContext: 'comment',
          slackUrl,
        })
        .catch(error => {
          logger.error(Event.API_CALL_FAILED, {
            reason: error,
            context: 'canvas_inline_comment_mention',
          });
        });
    });
  };

  const handleCreateThread = (body: string, mentionedUserIds: string[]): void => {
    if (!activeAnchor) return;

    const nextThreadId = uuidv4();
    if (onBeforeCreateThread?.(nextThreadId, activeAnchor) === false) {
      toast.error('Unable to attach comment to selected text');
      return;
    }

    const mutationResult = zero.mutate(
      mutators.canvasComment.createThread({
        threadId: nextThreadId,
        commentId: uuidv4(),
        canvasId,
        blockId: activeAnchor.blockId,
        anchorText: activeAnchor.anchorText,
        body,
        mentionedUserIds,
        timestamp: Date.now(),
      }),
    );
    void mutationResult.server
      .then(result => {
        if (result.type !== 'error') {
          setCreatedThread({
            id: nextThreadId,
            blockId: activeAnchor.blockId,
            anchorText: activeAnchor.anchorText,
            commentCount: 1,
            status: CanvasCommentThreadStatus.OPEN,
          });
          sendMentionNotifications(mentionedUserIds, {
            blockId: activeAnchor.blockId,
            commentThreadId: nextThreadId,
          });
          onCreateThreadCreated?.();
        } else {
          onCreateThreadFailed?.(activeAnchor);
        }
      })
      .catch(error => {
        onCreateThreadFailed?.(activeAnchor);
        logger.error(Event.API_CALL_FAILED, {
          reason: error,
          context: 'canvas_inline_comment_create',
        });
      });
  };

  const handleReply = (content: string, html: string): void => {
    const body = content.trim();
    if (!body) return;
    const mentionedUserIds = extractMentionedUserIdsFromHtml(html, [
      ...selectedMentionIdsRef.current,
    ]);
    selectedMentionIdsRef.current.clear();

    if (!currentThread) {
      handleCreateThread(body, mentionedUserIds);
      return;
    }

    const mutationResult = zero.mutate(
      mutators.canvasComment.reply({
        commentId: uuidv4(),
        threadId: currentThread.id,
        canvasId,
        body,
        mentionedUserIds,
        timestamp: Date.now(),
      }),
    );
    void mutationResult.server.then(result => {
      if (result.type !== 'error') {
        sendMentionNotifications(mentionedUserIds);
      }
    });
  };

  const setThreadStatus = (status: CanvasCommentThreadStatus): void => {
    if (!currentThread) return;
    zero.mutate(
      mutators.canvasComment.setThreadStatus({
        threadId: currentThread.id,
        status,
        timestamp: Date.now(),
      }),
    );
  };

  const placement = getCardPlacement(anchorLiveRect, cardHeight);
  const anchorQuote = currentThread?.anchorText ?? activeAnchor?.anchorText;
  const isDraft = !currentThread;

  const renderAnchorQuote = (): React.JSX.Element => (
    <div className='ml-[33px] mt-1.5 flex min-w-0'>
      <span className='w-[3px] shrink-0 rounded-sm bg-[#e5a93d]' aria-hidden='true' />
      <span className='min-w-0 flex-1 whitespace-pre-wrap break-words pl-[9px] text-[12.5px] leading-[1.5] text-muted-foreground'>
        {anchorQuote}
      </span>
    </div>
  );

  const threadActions = (
    <span className='flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/card:opacity-100'>
      {editable && currentThread?.status === CanvasCommentThreadStatus.OPEN && (
        <Button
          variant='ghost'
          size='iconSm'
          className='size-6 text-muted-foreground hover:text-emerald-600'
          onClick={() => setThreadStatus(CanvasCommentThreadStatus.RESOLVED)}
          data-track-category='CANVAS'
          data-track-name='RESOLVE_INLINE_COMMENT_THREAD'
          aria-label='Resolve comment'
          title='Resolve comment'
        >
          <Check className='size-[15px]' />
        </Button>
      )}
      {editable && currentThread?.status === CanvasCommentThreadStatus.RESOLVED && (
        <Button
          variant='ghost'
          size='iconSm'
          className='size-6 text-muted-foreground'
          onClick={() => setThreadStatus(CanvasCommentThreadStatus.OPEN)}
          data-track-category='CANVAS'
          data-track-name='REOPEN_INLINE_COMMENT_THREAD'
          aria-label='Reopen comment'
          title='Reopen comment'
        >
          <RotateCcw className='size-[15px]' />
        </Button>
      )}
      <Button
        variant='ghost'
        size='iconSm'
        className='size-6 text-muted-foreground'
        onClick={onClose}
        data-track-category='CANVAS'
        data-track-name='CLOSE_INLINE_COMMENT_THREAD'
        aria-label='Close comment'
      >
        <X className='size-[15px]' />
      </Button>
    </span>
  );

  return (
    <div
      ref={cardRef}
      data-canvas-inline-comment-thread='true'
      className='group/card flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-[0_10px_30px_hsl(var(--foreground)/0.12)]'
      style={{
        position: 'fixed',
        top: placement.top,
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
        zIndex: 80,
        opacity: hasEntered ? 1 : 0,
        transform: hasEntered ? 'none' : 'translateY(-6px) scale(0.985)',
        transition: 'opacity 180ms ease, transform 220ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {!isDraft && (
        <div
          ref={commentsScrollRef}
          className='thin-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-3'
        >
          {visibleComments.map((comment, index) => {
            const isInitialComment = comment.id === initialComment?.id;
            const commentAuthor = getCommentAuthor(comment, allUsers);
            return (
              <div key={comment.id} className='mb-2.5'>
                <div className='flex min-w-0 items-center gap-2'>
                  <Avatar
                    userId={comment.createdBy}
                    size='sm'
                    rounded
                    showActiveStatus={false}
                    className='size-[25px]'
                  />
                  <span className='truncate text-[13px] font-semibold leading-none text-foreground'>
                    {comment.createdBy === user?.id ? 'You' : getDisplayName(commentAuthor)}
                  </span>
                  <span className='shrink-0 text-[11.5px] leading-none text-muted-foreground'>
                    {formatRelativeCommentTime(comment.createdAt)}
                  </span>
                  <span className='flex-1' />
                  {index === 0 && threadActions}
                </div>
                {isInitialComment && anchorQuote && renderAnchorQuote()}
                <p className='ml-[33px] mt-[3px] whitespace-pre-wrap break-words text-[13.5px] leading-[1.55] text-foreground [text-wrap:pretty]'>
                  {renderCommentBody(
                    comment.body,
                    parseMentionedUserIds(comment.mentionedUserIds),
                    allUsers,
                  )}
                </p>
              </div>
            );
          })}
          {!initialComment && (
            <div className='mb-2.5'>
              <div className='flex min-w-0 items-center gap-2'>
                <Avatar
                  userId={user?.id ?? null}
                  size='sm'
                  rounded
                  showActiveStatus={false}
                  className='size-[25px]'
                />
                <span className='truncate text-[13px] font-semibold leading-none text-foreground'>
                  You
                </span>
                <span className='flex-1' />
                {threadActions}
              </div>
              {anchorQuote && renderAnchorQuote()}
            </div>
          )}
        </div>
      )}

      {editable && (
        <div
          className={cn(
            'flex items-center bg-background',
            isDraft ? 'gap-[9px] px-[11px] py-2.5' : 'gap-2 border-t border-border/70 px-3 py-2',
          )}
        >
          <Avatar
            userId={user?.id ?? null}
            size='sm'
            rounded
            showActiveStatus={false}
            className={isDraft ? 'size-[26px]' : 'size-[22px]'}
          />
          <OverlayZIndexContext.Provider value='z-[100]'>
            <InputBox
              id={`canvas-inline-comment-${currentThreadId ?? activeAnchor?.blockId ?? canvasId}`}
              {...(channelId && { channelId })}
              onSendMessage={handleReply}
              mentionItems={mentionItems}
              onMentionSearch={query => {
                setMentionQuery(query);
                searchMentions(query);
              }}
              onMentionSelect={mention => {
                if (mention.type === 'user') selectedMentionIdsRef.current.add(mention.id);
              }}
              placeholder={
                isDraft ? 'Comment — @AI to edit the selection…' : 'Reply — @AI to edit…'
              }
              {...(isDraft && { autoFocus: 'end' as const })}
              className={cn(
                'canvas-inline-comment-composer min-h-[32px] flex-1 rounded-lg border-0 bg-transparent shadow-none',
              )}
              features={{
                richText: false,
                commands: false,
                mentions: true,
                fileAttachments: false,
                emojiPicker: false,
              }}
              blockedExtensions={[
                'heading',
                'bulletList',
                'orderedList',
                'codeBlock',
                'blockquote',
              ]}
              maxFiles={0}
              disableDraftUpload
              hideVoiceInput
              compact
            />
          </OverlayZIndexContext.Provider>
        </div>
      )}
    </div>
  );
}
