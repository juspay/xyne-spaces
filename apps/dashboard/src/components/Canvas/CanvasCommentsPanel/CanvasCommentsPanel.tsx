import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  MessageSquare,
  MoreVertical,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { CanvasCommentThreadStatus } from '@xyne/shared';
import { useUserGroupSearch } from '@xyne/shared/hooks';
import { motion } from 'framer-motion';
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
import Button from '../../ui/Button';
import { InputBox } from '../../ui/InputBox';
import type { MentionResult } from '../../ui/InputBox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { formatRelativeCommentTime } from '../canvasCommentTime';
import { useCanvasCommentRail } from '../useCanvasCommentRail';

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
  editedAt?: number | null;
  deletedAt?: number | null;
  createdAt: number;
  createdByUser?: UserLite | null;
};

type CanvasCommentThread = {
  id: string;
  canvasId: string;
  blockId: string;
  anchorText?: string | null;
  initialCommentId?: string | null;
  status: CanvasCommentThreadStatus;
  statusUpdatedBy?: string | null;
  statusUpdatedAt?: number | null;
  createdBy: string;
  createdAt: number;
  initialComment?: CanvasComment | null;
};

type CanvasCommentThreadFilter = 'ALL' | CanvasCommentThreadStatus;

export interface CanvasCommentAnchor {
  blockId: string;
  anchorText: string;
  selectionFrom?: number | undefined;
  selectionTo?: number | undefined;
}

interface CanvasCommentsPanelProps {
  canvasId: string;
  canvasTitle?: string | undefined;
  channelId?: string | undefined;
  activeBlockId: string | null;
  activeThreadId?: string | null | undefined;
  activeAnchor?: CanvasCommentAnchor | null | undefined;
  /**
   * Thread ids whose anchor mark is still in the document, or null while that is unknown.
   * A thread whose commented text was deleted drops off the list until an undo restores it.
   */
  anchoredThreadIds?: Set<string> | null | undefined;
  editable: boolean;
  /** Canvas editor container, used to align each thread with the text it annotates. */
  anchorContainerRef?: React.RefObject<HTMLDivElement | null> | undefined;
  onClose: () => void;
  onSelectBlock: (blockId: string, threadId?: string) => void;
  onBeforeCreateThread?: ((threadId: string, anchor: CanvasCommentAnchor) => boolean) | undefined;
  onCreateThreadCreated?: (() => void) | undefined;
  onCreateThreadFailed?: ((anchor: CanvasCommentAnchor) => void) | undefined;
}

interface CanvasCommentComposerProps {
  id: string;
  channelId?: string | undefined;
  currentUserId?: string | undefined;
  disabled?: boolean;
  placeholder: string;
  value?: string | undefined;
  fallbackMentionedUserIds?: string[] | undefined;
  minHeightClassName: string;
  actions?: React.ReactNode;
  onSubmit: (payload: { body: string; mentionedUserIds: string[] }) => void;
}

interface CanvasCommentBodyProps {
  body: string;
  mentionedUserIds: string[];
  users: UserLite[];
  isDeleted: boolean;
  containerClassName?: string | undefined;
  className?: string | undefined;
}

interface CanvasCommentThreadSectionProps {
  thread: CanvasCommentThread;
  isActive: boolean;
  editable: boolean;
  channelId?: string | undefined;
  currentUserId?: string | undefined;
  allUsers: UserLite[];
  editingCommentId: string | null;
  onSelectBlock: (blockId: string, threadId?: string) => void;
  onSetThreadStatus: (threadId: string, status: CanvasCommentThreadStatus) => void;
  onSetEditingCommentId: (commentId: string | null) => void;
  onDeleteComment: (commentId: string) => void;
  onUpdateComment: (
    thread: CanvasCommentThread,
    comment: CanvasComment,
    payload: { body: string; mentionedUserIds: string[] },
  ) => void;
}

// Written out in full so Tailwind's class scanner can see it.
const COLLAPSED_COMMENT_CLAMP_CLASS = 'overflow-hidden line-clamp-4';

const getDisplayName = (user?: UserLite | null): string =>
  user?.displayName || user?.name || user?.email || 'Unknown';

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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseMentionedUserIds = (mentionedUserIds?: string | null): string[] => {
  if (!mentionedUserIds) return [];
  try {
    const parsed: unknown = JSON.parse(mentionedUserIds);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const renderCommentBody = (
  body: string,
  mentionedUserIds: string[],
  users: UserLite[],
): React.ReactNode[] => {
  if (mentionedUserIds.length === 0 || !body) return [body];

  const mentionTargets = mentionedUserIds
    .map(userId => {
      const user = users.find(candidate => candidate.id === userId);
      const displayName = user ? getUserDisplayName(user) : '';
      return displayName ? { userId, token: `@${displayName}`, displayName } : null;
    })
    .filter((target): target is { userId: string; token: string; displayName: string } =>
      Boolean(target),
    )
    .sort((a, b) => b.token.length - a.token.length);

  if (mentionTargets.length === 0) return [body];

  const tokenPattern = mentionTargets.map(target => escapeRegExp(target.token)).join('|');
  const tokenRegex = new RegExp(`(${tokenPattern})`, 'g');
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0];
    const start = match.index;
    if (start > lastIndex) {
      nodes.push(body.slice(lastIndex, start));
    }

    const target = mentionTargets.find(candidate => candidate.token === token);
    if (target) {
      nodes.push(
        <MentionRenderer
          key={`${target.userId}-${start}`}
          userId={target.userId}
          fallbackName={target.displayName}
        />,
      );
    } else {
      nodes.push(token);
    }

    lastIndex = start + token.length;
  }

  if (lastIndex < body.length) {
    nodes.push(body.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [body];
};

function CanvasCommentBody({
  body,
  mentionedUserIds,
  users,
  isDeleted,
  containerClassName,
  className,
}: CanvasCommentBodyProps): React.JSX.Element {
  const bodyRef = useRef<HTMLParagraphElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);

  useLayoutEffect(() => {
    const node = bodyRef.current;
    // While expanded the clamp is off, so overflow can no longer be measured —
    // keep the last collapsed measurement so "Show less" stays available.
    if (!node || isExpanded) return;

    const measure = (): void => {
      setIsClamped(node.scrollHeight - node.clientHeight > 1);
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return (): void => observer.disconnect();
  }, [body, isDeleted, isExpanded]);

  return (
    <div className={cn('flex flex-col items-start', containerClassName)}>
      <p
        ref={bodyRef}
        className={cn(
          'w-full whitespace-pre-wrap break-words [text-wrap:pretty]',
          !isExpanded && COLLAPSED_COMMENT_CLAMP_CLASS,
          className,
        )}
      >
        {isDeleted ? 'Comment deleted' : renderCommentBody(body, mentionedUserIds, users)}
      </p>
      {!isDeleted && isClamped && (
        <button
          type='button'
          onClick={() => setIsExpanded(previous => !previous)}
          className='py-1 text-[12px] font-bold text-foreground'
          data-track-category='CANVAS'
          data-track-name='comment_body_toggle_expand'
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function CanvasCommentComposer({
  id,
  channelId,
  currentUserId,
  disabled = false,
  placeholder,
  value,
  fallbackMentionedUserIds = [],
  minHeightClassName,
  actions,
  onSubmit,
}: CanvasCommentComposerProps): React.JSX.Element {
  const selectedMentionIdsRef = useRef<Set<string>>(new Set());
  const [fallbackMentionQuery, setFallbackMentionQuery] = useState('');
  const { results, allUsers, searchMentions } = useMentionSearch(channelId, undefined, undefined, {
    includeSpecialMentions: false,
  });
  const fallbackGroups = useUserGroupSearch(fallbackMentionQuery, 10);

  const fallbackMentionItems = useMemo<MentionResult[]>(
    () => [
      ...allUsers,
      ...fallbackGroups.map(
        (group): MentionResult => ({
          id: group.id,
          name: group.name,
          type: 'group',
          ...(group.alias && { alias: group.alias }),
          ...(group.description && { description: group.description }),
          memberCount: 0,
          isDeactivated: group.isActive === false,
        }),
      ),
    ],
    [allUsers, fallbackGroups],
  );

  const mentionItems = useMemo(() => {
    const source = channelId ? results : fallbackMentionItems;
    const query = fallbackMentionQuery.trim().toLowerCase();
    return source
      .filter(mention => mention.type !== 'channel' && mention.id !== currentUserId)
      .filter(mention => {
        if (channelId || !query) return true;
        return (
          mention.name.toLowerCase().includes(query) ||
          (mention.email?.toLowerCase().includes(query) ?? false) ||
          (mention.alias?.toLowerCase().includes(query) ?? false)
        );
      })
      .slice(0, 8);
  }, [channelId, currentUserId, fallbackMentionItems, fallbackMentionQuery, results]);

  const handleMentionSearch = (query: string): void => {
    setFallbackMentionQuery(query);
    searchMentions(query);
  };

  const handleMentionSelect = (mention: MentionResult): void => {
    if (mention.type === 'user') {
      selectedMentionIdsRef.current.add(mention.id);
    }
  };

  const handleSend = (content: string, html: string): void => {
    const body = content.trim();
    if (!body) return;

    const retainedFallbackMentionIds = fallbackMentionedUserIds.filter(userId => {
      const mention = allUsers.find(
        candidate => candidate.type === 'user' && candidate.id === userId,
      );
      return mention ? body.includes(`@${mention.name}`) : true;
    });
    const mentionedUserIds = extractMentionedUserIdsFromHtml(html, [
      ...selectedMentionIdsRef.current,
      ...retainedFallbackMentionIds,
    ]);
    selectedMentionIdsRef.current.clear();
    onSubmit({ body, mentionedUserIds });
  };

  return (
    <div className='space-y-2'>
      <InputBox
        id={id}
        {...(channelId && { channelId })}
        onSendMessage={handleSend}
        mentionItems={mentionItems}
        onMentionSearch={handleMentionSearch}
        onMentionSelect={handleMentionSelect}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        className={cn(
          'canvas-comment-composer rounded-[18px] border border-input bg-background shadow-sm ring-1 ring-border/70 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10',
          minHeightClassName,
        )}
        features={{
          richText: true,
          commands: false,
          mentions: true,
          fileAttachments: false,
          emojiPicker: false,
        }}
        blockedExtensions={['heading', 'bulletList', 'orderedList', 'codeBlock', 'blockquote']}
        maxFiles={0}
        disableDraftUpload
        hideComposerTools
        hideVoiceInput
        compact
      />
      {actions && <div className='flex items-center justify-start gap-2'>{actions}</div>}
    </div>
  );
}

function CanvasCommentThreadSection({
  thread,
  isActive,
  editable,
  channelId,
  currentUserId,
  allUsers,
  editingCommentId,
  onSelectBlock,
  onSetThreadStatus,
  onSetEditingCommentId,
  onDeleteComment,
  onUpdateComment,
}: CanvasCommentThreadSectionProps): React.JSX.Element {
  const [loadedComments = []] = useCachedQuery(
    queries.canvasThreadComments({ threadId: thread.id }),
    {
      enabled: Boolean(thread.id),
    },
  ) as unknown as [CanvasComment[]];
  const initialComment =
    thread.initialComment ??
    loadedComments.find(comment => comment.id === thread.initialCommentId || comment.isInitial);
  const replies = loadedComments.filter(
    comment =>
      comment.id !== thread.initialCommentId &&
      comment.id !== initialComment?.id &&
      !comment.isInitial,
  );
  const expandedComments = [initialComment, ...replies].filter(Boolean) as CanvasComment[];

  const isResolved = thread.status === CanvasCommentThreadStatus.RESOLVED;

  return (
    <section
      className={cn(
        'group flex flex-col gap-2 rounded-md border border-border p-2 transition-colors',
        isActive
          ? 'border-emerald-300/70 bg-emerald-50 dark:border-emerald-500/35 dark:bg-emerald-500/10'
          : isResolved
            ? 'bg-muted/40 hover:bg-accent'
            : 'bg-background hover:bg-accent',
      )}
    >
      {expandedComments.map((comment, index) => {
        const isOwnComment = comment.createdBy === currentUserId;
        const isDeleted = Boolean(comment.deletedAt);
        const isEditing = editingCommentId === comment.id;
        const isInitialComment = comment.id === initialComment?.id;
        const isReply = index > 0;
        const commentAuthor =
          allUsers.find(candidate => candidate.id === comment.createdBy) ?? comment.createdByUser;
        const authorName =
          currentUserId === comment.createdBy ? 'You' : getDisplayName(commentAuthor);

        return (
          <div key={comment.id} className={cn('group flex flex-col gap-2', isReply && 'gap-1')}>
            <div className='flex min-w-0 items-center gap-2'>
              <Avatar
                userId={comment.createdBy}
                size='sm'
                rounded
                showActiveStatus={false}
                className={isReply ? 'size-5' : 'size-[22px]'}
              />
              <span
                className={cn(
                  'truncate font-semibold leading-none text-foreground',
                  isReply ? 'text-xs' : 'text-[13px]',
                )}
              >
                {authorName}
              </span>
              <span className='shrink-0 text-[11.5px] leading-none text-muted-foreground'>
                {formatRelativeCommentTime(comment.createdAt)}
                {comment.editedAt && !isDeleted ? ' · edited' : ''}
              </span>
              <span className='flex-1' />
              {editable && isOwnComment && !isDeleted && !isEditing && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='ghost'
                      size='iconSm'
                      className='size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100'
                      aria-label='Comment actions'
                    >
                      <MoreVertical className='size-[15px]' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    <DropdownMenuItem onClick={() => onSetEditingCommentId(comment.id)}>
                      <Pencil className='size-4' />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className='text-destructive focus:text-destructive'
                      onClick={() => onDeleteComment(comment.id)}
                    >
                      <Trash2 className='size-4' />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {index === 0 && (
                <span
                  className={cn(
                    'flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-[11px] font-semibold',
                    isResolved
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-amber-50 text-amber-800 [[data-theme=midnight]_&]:bg-amber-400/15 [[data-theme=midnight]_&]:text-amber-300',
                  )}
                >
                  <span
                    className={cn(
                      'size-[5px] rounded-full',
                      isResolved ? 'bg-muted-foreground/60' : 'bg-amber-500',
                    )}
                    aria-hidden='true'
                  />
                  {isResolved ? 'Resolved' : 'Open'}
                </span>
              )}
            </div>

            {isInitialComment && thread.anchorText && (
              <div className='flex min-w-0 gap-2'>
                <span className='w-[2px] shrink-0 rounded-sm bg-[#e5a93d]' aria-hidden='true' />
                <span className='line-clamp-3 min-w-0 flex-1 overflow-hidden whitespace-pre-wrap break-words text-[12.5px] leading-[1.5] text-muted-foreground'>
                  {thread.anchorText}
                </span>
              </div>
            )}

            {isEditing ? (
              <CanvasCommentComposer
                id={`canvas-comment-edit-${comment.id}`}
                channelId={channelId}
                currentUserId={currentUserId}
                placeholder='Edit comment'
                value={comment.body}
                fallbackMentionedUserIds={parseMentionedUserIds(comment.mentionedUserIds)}
                minHeightClassName='min-h-[38px]'
                onSubmit={payload => onUpdateComment(thread, comment, payload)}
                actions={
                  <Button variant='ghost' size='sm' onClick={() => onSetEditingCommentId(null)}>
                    Cancel
                  </Button>
                }
              />
            ) : (
              <CanvasCommentBody
                body={comment.body}
                mentionedUserIds={parseMentionedUserIds(comment.mentionedUserIds)}
                users={allUsers}
                isDeleted={isDeleted}
                containerClassName={isReply ? 'pl-7' : undefined}
                className={cn(
                  isReply
                    ? 'text-[13px] leading-[1.55] text-muted-foreground'
                    : 'text-[13.5px] leading-[1.6] text-foreground',
                  isDeleted && 'italic text-muted-foreground',
                )}
              />
            )}
          </div>
        );
      })}

      <div className='flex items-center gap-1.5 pt-0.5'>
        <Button
          variant='outline'
          size='sm'
          onClick={() => onSelectBlock(thread.blockId, thread.id)}
          className='h-[26px] gap-1.5 rounded-[7px] px-2.5 text-xs font-medium'
        >
          <ArrowRight className='size-3.5' />
          Go to text
        </Button>
        <span className='flex-1' />
        {editable && !isResolved && (
          <Button
            variant='outline'
            size='sm'
            onClick={() => onSetThreadStatus(thread.id, CanvasCommentThreadStatus.RESOLVED)}
            className='h-[26px] gap-1.5 rounded-[7px] px-2.5 text-xs font-medium active:scale-[0.96]'
          >
            <Check className='size-3.5' />
            Resolve
          </Button>
        )}
        {editable && isResolved && (
          <Button
            variant='outline'
            size='sm'
            onClick={() => onSetThreadStatus(thread.id, CanvasCommentThreadStatus.OPEN)}
            className='h-[26px] gap-1.5 rounded-[7px] px-2.5 text-xs font-medium active:scale-[0.96]'
          >
            <RotateCcw className='size-3.5' />
            Reopen
          </Button>
        )}
      </div>
    </section>
  );
}

export function CanvasCommentsPanel({
  canvasId,
  canvasTitle,
  channelId,
  activeBlockId,
  activeThreadId,
  activeAnchor,
  anchoredThreadIds,
  editable,
  anchorContainerRef,
  onClose,
  onSelectBlock,
  onBeforeCreateThread,
  onCreateThreadCreated,
  onCreateThreadFailed,
}: CanvasCommentsPanelProps): React.JSX.Element {
  const zero = useZero();
  const { user } = useAuth();
  const allUsers = useUsers();
  const [threadStatusFilter, setThreadStatusFilter] = useState<CanvasCommentThreadFilter>('ALL');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [threads = []] = useCachedQuery(queries.canvasCommentThreads({ canvasId }), {
    enabled: Boolean(canvasId),
  }) as unknown as [CanvasCommentThread[]];

  // A thread lives as long as the text it annotates: the editor drops its id from this set when
  // the anchor is deleted and puts it back on undo.
  const anchoredThreads = useMemo(
    () =>
      anchoredThreadIds ? threads.filter(thread => anchoredThreadIds.has(thread.id)) : threads,
    [anchoredThreadIds, threads],
  );

  const orderedThreads = useMemo(() => {
    return [...anchoredThreads].sort((a, b) => {
      if (a.status !== b.status) return a.status === CanvasCommentThreadStatus.OPEN ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
  }, [anchoredThreads]);

  const visibleThreads = useMemo(
    () =>
      threadStatusFilter === 'ALL'
        ? orderedThreads
        : orderedThreads.filter(thread => thread.status === threadStatusFilter),
    [orderedThreads, threadStatusFilter],
  );

  const openCount = orderedThreads.filter(
    thread => thread.status === CanvasCommentThreadStatus.OPEN,
  ).length;
  const resolvedCount = orderedThreads.filter(
    thread => thread.status === CanvasCommentThreadStatus.RESOLVED,
  ).length;

  const railScrollRef = useRef<HTMLDivElement | null>(null);
  const railTrackRef = useRef<HTMLDivElement | null>(null);
  const rail = useCanvasCommentRail({
    anchorContainerRef,
    railScrollRef,
    railTrackRef,
    threads: visibleThreads,
    enabled: Boolean(anchorContainerRef),
  });

  const filterTabs: { value: CanvasCommentThreadFilter; label: string; count: number }[] = [
    { value: 'ALL', label: 'All', count: orderedThreads.length },
    { value: CanvasCommentThreadStatus.OPEN, label: 'Open', count: openCount },
    { value: CanvasCommentThreadStatus.RESOLVED, label: 'Resolved', count: resolvedCount },
  ];

  const sendMentionNotifications = useCallback(
    (blockId: string, mentionedUserIds: string[], commentThreadId?: string): void => {
      const uniqueMentionedUserIds = [...new Set(mentionedUserIds)].filter(
        mentionedUserId => mentionedUserId && mentionedUserId !== user?.id,
      );
      if (uniqueMentionedUserIds.length === 0) return;

      const path = `redirected?type=canvas&canvasId=${encodeURIComponent(canvasId)}&blockId=${encodeURIComponent(blockId)}${
        commentThreadId ? `&commentThreadId=${encodeURIComponent(commentThreadId)}` : ''
      }`;
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
              context: 'canvas_comment_mention',
            });
          });
      });
    },
    [canvasId, canvasTitle, user?.id],
  );

  const selectedTextAnchor =
    activeAnchor?.blockId === activeBlockId && activeAnchor.anchorText ? activeAnchor : null;

  const createThread = ({
    body,
    mentionedUserIds,
  }: {
    body: string;
    mentionedUserIds: string[];
  }): void => {
    if (!activeBlockId) {
      toast.error('Place the cursor in a canvas block first');
      return;
    }

    const threadId = uuidv4();

    if (!selectedTextAnchor) {
      toast.error('Select text to add a comment');
      return;
    }

    if (onBeforeCreateThread?.(threadId, selectedTextAnchor) === false) {
      toast.error('Unable to attach comment to selected text');
      return;
    }

    const mutationResult = zero.mutate(
      mutators.canvasComment.createThread({
        threadId,
        commentId: uuidv4(),
        canvasId,
        blockId: activeBlockId,
        anchorText: selectedTextAnchor.anchorText,
        body,
        mentionedUserIds,
        timestamp: Date.now(),
      }),
    );
    void mutationResult.server
      .then(result => {
        if (result.type !== 'error') {
          sendMentionNotifications(activeBlockId, mentionedUserIds, threadId);
          onCreateThreadCreated?.();
        } else {
          onCreateThreadFailed?.(selectedTextAnchor);
        }
      })
      .catch(error => {
        onCreateThreadFailed?.(selectedTextAnchor);
        logger.error(Event.API_CALL_FAILED, {
          reason: error,
          context: 'canvas_comment_create',
        });
      });
  };

  const setThreadStatus = (threadId: string, status: CanvasCommentThreadStatus): void => {
    zero.mutate(
      mutators.canvasComment.setThreadStatus({
        threadId,
        status,
        timestamp: Date.now(),
      }),
    );
  };

  const deleteComment = (commentId: string): void => {
    zero.mutate(
      mutators.canvasComment.deleteComment({
        commentId,
        timestamp: Date.now(),
      }),
    );
  };

  const updateComment = (
    thread: CanvasCommentThread,
    comment: CanvasComment,
    { body, mentionedUserIds }: { body: string; mentionedUserIds: string[] },
  ): void => {
    const mutationResult = zero.mutate(
      mutators.canvasComment.updateComment({
        commentId: comment.id,
        body,
        mentionedUserIds,
        timestamp: Date.now(),
      }),
    );
    void mutationResult.server
      .then(result => {
        if (result.type !== 'error') {
          const previousMentionedUserIds = new Set(parseMentionedUserIds(comment.mentionedUserIds));
          const newlyMentionedUserIds = mentionedUserIds.filter(
            mentionedUserId => !previousMentionedUserIds.has(mentionedUserId),
          );
          sendMentionNotifications(thread.blockId, newlyMentionedUserIds, thread.id);
        }
      })
      .catch(error => {
        logger.error(Event.API_CALL_FAILED, {
          reason: error,
          context: 'canvas_comment_update',
        });
      });
    setEditingCommentId(null);
  };

  return (
    <motion.aside
      className='absolute inset-y-0 right-0 z-20 flex w-full shrink-0 flex-col border-l border-border bg-background shadow-xl md:relative md:z-auto md:w-80 md:shadow-none'
      initial={{ x: 14, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 12, opacity: 0, transition: { duration: 0.15, ease: 'easeIn' } }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className='flex h-14 shrink-0 items-center justify-between border-b border-border px-4'>
        <div className='flex items-center gap-2 text-sm font-semibold text-foreground'>
          <MessageSquare size={16} />
          Comments
        </div>
        <Button variant='ghost' size='iconSm' onClick={onClose} aria-label='Close comments'>
          <X size={16} />
        </Button>
      </div>

      <div className='flex shrink-0 items-center gap-1 border-b border-border px-3 py-2'>
        {filterTabs.map(tab => (
          <button
            key={tab.value}
            type='button'
            data-track-category='CANVAS'
            data-track-name='comment_panel_status_filter'
            onClick={() => setThreadStatusFilter(tab.value)}
            aria-pressed={threadStatusFilter === tab.value}
            className={cn(
              'h-7 shrink-0 rounded-full border px-[11px] text-[12.5px] tabular-nums transition-[background-color,border-color,color,scale] duration-150 ease-out active:scale-[0.96]',
              threadStatusFilter === tab.value
                ? 'border-foreground bg-foreground font-semibold text-background'
                : 'border-border bg-background font-medium text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
            )}
          >
            {tab.label} {tab.count}
          </button>
        ))}
      </div>

      <div
        ref={railScrollRef}
        className={cn(
          'thin-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pt-3',
          rail.isAligned ? 'relative' : 'pb-6',
        )}
      >
        {editable && selectedTextAnchor && (
          <div
            className={cn(
              'rounded-md border border-border bg-background p-2',
              // Overlaid while aligned so the composer cannot push the rail off its anchors.
              rail.isAligned ? 'absolute inset-x-3 top-3 z-10 shadow-sm' : 'mb-2',
            )}
          >
            <p className='mb-2 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
              New comment on selected text
            </p>
            <div className='mb-2 flex min-w-0 gap-2'>
              <span className='w-[2px] shrink-0 rounded-sm bg-[#e5a93d]' aria-hidden='true' />
              <span className='line-clamp-3 min-w-0 flex-1 text-[12.5px] leading-[1.5] text-muted-foreground'>
                {selectedTextAnchor.anchorText}
              </span>
            </div>
            <CanvasCommentComposer
              id={`canvas-comment-new-${canvasId}`}
              channelId={channelId}
              currentUserId={user?.id}
              placeholder='Add a comment'
              minHeightClassName='min-h-[38px]'
              onSubmit={createThread}
            />
          </div>
        )}

        {visibleThreads.length === 0 ? (
          <div className='flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground'>
            {threadStatusFilter === 'ALL'
              ? 'No comments yet'
              : threadStatusFilter === CanvasCommentThreadStatus.RESOLVED
                ? 'No resolved comments'
                : 'No open comments'}
          </div>
        ) : (
          <div
            ref={railTrackRef}
            className={rail.isAligned ? 'relative' : 'space-y-2'}
            style={rail.isAligned ? { height: rail.trackHeight } : undefined}
          >
            {visibleThreads.map(thread => (
              <div
                key={thread.id}
                ref={
                  rail.isAligned
                    ? (element): void => rail.registerCard(thread.id, element)
                    : undefined
                }
                className={rail.isAligned ? 'absolute inset-x-0' : undefined}
                style={rail.isAligned ? { top: rail.cardTops[thread.id] ?? 0 } : undefined}
              >
                <CanvasCommentThreadSection
                  thread={thread}
                  isActive={activeThreadId === thread.id}
                  editable={editable}
                  channelId={channelId}
                  currentUserId={user?.id}
                  allUsers={allUsers}
                  editingCommentId={editingCommentId}
                  onSelectBlock={onSelectBlock}
                  onSetThreadStatus={setThreadStatus}
                  onSetEditingCommentId={setEditingCommentId}
                  onDeleteComment={deleteComment}
                  onUpdateComment={updateComment}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.aside>
  );
}
