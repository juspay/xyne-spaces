import { useEffect, useMemo, useRef, useState } from 'react';
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

const getPopoverStyle = (rect: DOMRect): React.CSSProperties => {
  const width = 520;
  const top = Math.min(rect.bottom + 12, window.innerHeight - 260);
  const preferredLeft = rect.width === 0 ? rect.left : rect.right + 16;
  const left = Math.min(Math.max(preferredLeft, 16), Math.max(window.innerWidth - width - 16, 16));
  const maxHeight = Math.max(260, window.innerHeight - top - 24);
  return { position: 'fixed', top, left, width, maxHeight, zIndex: 80 };
};

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

  return (
    <div
      data-canvas-inline-comment-thread='true'
      className='flex flex-col overflow-hidden rounded-[18px] border border-input bg-background shadow-[0_18px_60px_rgba(15,23,42,0.16)]'
      style={getPopoverStyle(anchorRect)}
    >
      <div
        ref={commentsScrollRef}
        className='thin-scrollbar relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pr-12'
      >
        {visibleComments.map(comment => {
          const isInitialComment = comment.id === initialComment?.id;
          const commentAuthor = getCommentAuthor(comment, allUsers);
          return (
            <div key={comment.id} className='flex gap-3'>
              <Avatar userId={comment.createdBy} size='sm' rounded showActiveStatus={false} />
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-2 text-sm'>
                  <span className='font-semibold text-foreground'>
                    {comment.createdBy === user?.id ? 'You' : getDisplayName(commentAuthor)}
                  </span>
                  <span className='text-muted-foreground'>
                    {formatRelativeCommentTime(comment.createdAt)}
                  </span>
                </div>
                {isInitialComment && (currentThread?.anchorText || activeAnchor?.anchorText) && (
                  <blockquote className='mt-3 border-l-2 border-amber-400 pl-3 text-sm text-muted-foreground'>
                    {currentThread?.anchorText ?? activeAnchor?.anchorText}
                  </blockquote>
                )}
                <p className='mt-1 whitespace-pre-wrap break-words text-sm text-foreground'>
                  {renderCommentBody(
                    comment.body,
                    parseMentionedUserIds(comment.mentionedUserIds),
                    allUsers,
                  )}
                </p>
              </div>
            </div>
          );
        })}
        {!initialComment && (
          <div className='flex gap-3'>
            <Avatar userId={user?.id ?? null} size='sm' rounded showActiveStatus={false} />
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-2 text-sm'>
                <span className='font-semibold text-foreground'>You</span>
              </div>
              {(currentThread?.anchorText || activeAnchor?.anchorText) && (
                <blockquote className='mt-3 border-l-2 border-amber-400 pl-3 text-sm text-muted-foreground'>
                  {currentThread?.anchorText ?? activeAnchor?.anchorText}
                </blockquote>
              )}
            </div>
          </div>
        )}
        <div className='absolute right-3 top-3 flex shrink-0 items-center gap-1'>
          {editable && currentThread?.status === CanvasCommentThreadStatus.OPEN && (
            <Button
              variant='ghost'
              size='iconSm'
              onClick={() => setThreadStatus(CanvasCommentThreadStatus.RESOLVED)}
              aria-label='Resolve comment'
              title='Resolve comment'
            >
              <Check className='size-4' />
            </Button>
          )}
          {editable && currentThread?.status === CanvasCommentThreadStatus.RESOLVED && (
            <Button
              variant='ghost'
              size='iconSm'
              onClick={() => setThreadStatus(CanvasCommentThreadStatus.OPEN)}
              aria-label='Reopen comment'
              title='Reopen comment'
            >
              <RotateCcw className='size-4' />
            </Button>
          )}
          <Button variant='ghost' size='iconSm' onClick={onClose} aria-label='Close comment'>
            <X className='size-4' />
          </Button>
        </div>
      </div>

      {editable && (
        <div className='border-t border-border p-3'>
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
              placeholder={currentThread ? 'Reply' : 'Comment'}
              className={cn(
                'canvas-comment-composer min-h-[38px] rounded-[18px] border border-input bg-background shadow-sm ring-1 ring-border/70 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10',
              )}
              features={{
                richText: true,
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
              hideComposerTools
              hideVoiceInput
              compact
            />
          </OverlayZIndexContext.Provider>
        </div>
      )}
    </div>
  );
}
