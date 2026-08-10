import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  MessageSquare,
  MoreVertical,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { CanvasCommentThreadStatus } from '@xyne/shared';
import { useUserGroupSearch } from '@xyne/shared/hooks';
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
import { Badge } from '../../ui/Badge';
import { Tooltip } from '../../ui/Tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { formatRelativeCommentTime } from '../canvasCommentTime';

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
  editable: boolean;
  onClose: () => void;
  onSelectBlock: (blockId: string) => void;
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

interface CanvasCommentThreadSectionProps {
  thread: CanvasCommentThread;
  isSelectedBlock: boolean;
  isExpanded: boolean;
  editable: boolean;
  channelId?: string | undefined;
  currentUserId?: string | undefined;
  allUsers: UserLite[];
  editingCommentId: string | null;
  onSelectBlock: (blockId: string) => void;
  onToggleExpanded: (threadId: string) => void;
  onSetThreadStatus: (threadId: string, status: CanvasCommentThreadStatus) => void;
  onSetEditingCommentId: (commentId: string | null) => void;
  onDeleteComment: (commentId: string) => void;
  onUpdateComment: (
    thread: CanvasCommentThread,
    comment: CanvasComment,
    payload: { body: string; mentionedUserIds: string[] },
  ) => void;
  onReplyToThread: (
    thread: CanvasCommentThread,
    payload: { body: string; mentionedUserIds: string[] },
  ) => void;
}

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
  isSelectedBlock,
  isExpanded,
  editable,
  channelId,
  currentUserId,
  allUsers,
  editingCommentId,
  onSelectBlock,
  onToggleExpanded,
  onSetThreadStatus,
  onSetEditingCommentId,
  onDeleteComment,
  onUpdateComment,
  onReplyToThread,
}: CanvasCommentThreadSectionProps): React.JSX.Element {
  const [loadedComments = []] = useCachedQuery(
    queries.canvasThreadComments({ threadId: thread.id }),
    {
      enabled: isExpanded,
    },
  ) as unknown as [CanvasComment[]];
  const initialComment = thread.initialComment;
  const replies = isExpanded
    ? loadedComments.filter(
        comment =>
          comment.id !== thread.initialCommentId &&
          comment.id !== initialComment?.id &&
          !comment.isInitial,
      )
    : [];
  const expandedComments = isExpanded
    ? ([initialComment, ...replies].filter(Boolean) as CanvasComment[])
    : [];
  const previewComment = initialComment;
  const previewCommentAuthor =
    previewComment && currentUserId === previewComment.createdBy
      ? 'You'
      : getDisplayName(
          previewComment
            ? (allUsers.find(candidate => candidate.id === previewComment.createdBy) ??
                previewComment.createdByUser)
            : null,
        );
  return (
    <section
      className={cn(
        'relative rounded-[14px] border shadow-sm transition-colors',
        isSelectedBlock ? 'border-primary/60 shadow-sm' : 'border-border',
        thread.status === CanvasCommentThreadStatus.OPEN && 'bg-amber-50/20',
        thread.status === CanvasCommentThreadStatus.RESOLVED && 'bg-muted/25 opacity-85',
      )}
    >
      {!isExpanded && (
        <div className='flex items-start justify-between gap-2 border-b border-border px-3 py-2'>
          <button
            type='button'
            className='min-w-0 flex-1 space-y-1 text-left'
            data-track-category='canvas'
            data-track-name='TOGGLE_CANVAS_COMMENT_THREAD'
            onClick={() => {
              onSelectBlock(thread.blockId);
              onToggleExpanded(thread.id);
            }}
            aria-expanded={isExpanded}
          >
            {thread.anchorText && (
              <span className='line-clamp-2 block rounded-sm border-l-2 border-primary bg-muted/30 px-2 py-1 text-xs italic text-muted-foreground'>
                {thread.anchorText}
              </span>
            )}
            {previewComment && (
              <span className='flex items-center gap-2 text-xs'>
                <span className='font-semibold text-foreground'>{previewCommentAuthor}</span>
                <span className='text-muted-foreground'>
                  {formatRelativeCommentTime(previewComment.createdAt)}
                </span>
              </span>
            )}
            {previewComment && (
              <span className='line-clamp-2 block text-sm leading-5 text-foreground'>
                {previewComment.deletedAt
                  ? 'Comment deleted'
                  : renderCommentBody(
                      previewComment.body,
                      parseMentionedUserIds(previewComment.mentionedUserIds),
                      allUsers,
                    )}
              </span>
            )}
            <span className='block text-[11px] text-muted-foreground'>View replies</span>
          </button>
          <span className='flex shrink-0 items-center gap-1'>
            <Badge
              variant={thread.status === CanvasCommentThreadStatus.OPEN ? 'outline' : 'secondary'}
              className={cn(
                'rounded-md',
                thread.status === CanvasCommentThreadStatus.OPEN &&
                  'border-primary/20 bg-primary/10 text-primary',
              )}
            >
              {thread.status === CanvasCommentThreadStatus.OPEN ? 'Open' : 'Resolved'}
            </Badge>
            {editable && thread.status === CanvasCommentThreadStatus.OPEN && (
              <Tooltip content='Resolve comment'>
                <Button
                  variant='ghost'
                  size='iconSm'
                  onClick={() => onSetThreadStatus(thread.id, CanvasCommentThreadStatus.RESOLVED)}
                  aria-label='Resolve comment'
                >
                  <Check className='size-4' />
                </Button>
              </Tooltip>
            )}
            {editable && thread.status === CanvasCommentThreadStatus.RESOLVED && (
              <Tooltip content='Reopen comment'>
                <Button
                  variant='ghost'
                  size='iconSm'
                  onClick={() => onSetThreadStatus(thread.id, CanvasCommentThreadStatus.OPEN)}
                  aria-label='Reopen comment'
                >
                  <RotateCcw className='size-4' />
                </Button>
              </Tooltip>
            )}
            <Button
              variant='ghost'
              size='iconSm'
              onClick={() => {
                onSelectBlock(thread.blockId);
                onToggleExpanded(thread.id);
              }}
              aria-label='Expand comment'
            >
              <ChevronDown className='size-4 text-muted-foreground transition-transform' />
            </Button>
          </span>
        </div>
      )}
      {isExpanded && (
        <span className='absolute right-3 top-3 z-10 flex shrink-0 items-center gap-1'>
          <Badge
            variant={thread.status === CanvasCommentThreadStatus.OPEN ? 'outline' : 'secondary'}
            className={cn(
              'rounded-full px-3',
              thread.status === CanvasCommentThreadStatus.OPEN &&
                'border-amber-100 bg-amber-50 text-amber-700',
            )}
          >
            {thread.status === CanvasCommentThreadStatus.OPEN ? 'Open' : 'Resolved'}
          </Badge>
          {editable && thread.status === CanvasCommentThreadStatus.OPEN && (
            <Tooltip content='Resolve comment'>
              <Button
                variant='ghost'
                size='iconSm'
                onClick={() => onSetThreadStatus(thread.id, CanvasCommentThreadStatus.RESOLVED)}
                aria-label='Resolve comment'
              >
                <Check className='size-4' />
              </Button>
            </Tooltip>
          )}
          {editable && thread.status === CanvasCommentThreadStatus.RESOLVED && (
            <Tooltip content='Reopen comment'>
              <Button
                variant='ghost'
                size='iconSm'
                onClick={() => onSetThreadStatus(thread.id, CanvasCommentThreadStatus.OPEN)}
                aria-label='Reopen comment'
              >
                <RotateCcw className='size-4' />
              </Button>
            </Tooltip>
          )}
          <Button
            variant='ghost'
            size='iconSm'
            onClick={() => {
              onSelectBlock(thread.blockId);
              onToggleExpanded(thread.id);
            }}
            aria-label={isExpanded ? 'Collapse comment' : 'Expand comment'}
          >
            <ChevronDown
              className={cn(
                'size-4 text-muted-foreground transition-transform',
                isExpanded && 'rotate-180',
              )}
            />
          </Button>
        </span>
      )}

      {isExpanded && (
        <div className='space-y-4 p-4 pr-24'>
          {expandedComments.map(comment => {
            const isOwnComment = comment.createdBy === currentUserId;
            const isDeleted = Boolean(comment.deletedAt);
            const isEditing = editingCommentId === comment.id;
            const isInitialComment = comment.id === initialComment?.id;
            const commentAuthor =
              allUsers.find(candidate => candidate.id === comment.createdBy) ??
              comment.createdByUser;

            return (
              <div key={comment.id} className='group flex gap-3'>
                <Avatar userId={comment.createdBy} size='sm' rounded showActiveStatus={false} />
                <div className='min-w-0 flex-1'>
                  <div className='mb-1 flex items-center justify-between gap-2'>
                    <div className='min-w-0'>
                      <p className='flex min-w-0 items-center gap-2 text-sm'>
                        <span className='truncate font-semibold text-foreground'>
                          {currentUserId === comment.createdBy
                            ? 'You'
                            : getDisplayName(commentAuthor)}
                        </span>
                        <span className='shrink-0 text-muted-foreground'>
                          {formatRelativeCommentTime(comment.createdAt)}
                        </span>
                        {comment.editedAt && !isDeleted ? ' · edited' : ''}
                      </p>
                    </div>
                    {editable && isOwnComment && !isDeleted && !isEditing && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant='ghost'
                            size='iconSm'
                            className='opacity-0 group-hover:opacity-100'
                            aria-label='Comment actions'
                          >
                            <MoreVertical className='size-4' />
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
                  </div>
                  {isInitialComment && thread.anchorText && (
                    <blockquote className='mb-2 border-l-2 border-amber-400 pl-3 text-sm text-muted-foreground'>
                      {thread.anchorText}
                    </blockquote>
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
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => onSetEditingCommentId(null)}
                        >
                          Cancel
                        </Button>
                      }
                    />
                  ) : (
                    <p
                      className={cn(
                        'whitespace-pre-wrap break-words text-sm leading-5 text-foreground',
                        isDeleted && 'italic text-muted-foreground',
                      )}
                    >
                      {isDeleted
                        ? 'Comment deleted'
                        : renderCommentBody(
                            comment.body,
                            parseMentionedUserIds(comment.mentionedUserIds),
                            allUsers,
                          )}
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {editable && (
            <div className='border-t border-border pt-3'>
              <CanvasCommentComposer
                id={`canvas-comment-reply-${thread.id}`}
                channelId={channelId}
                currentUserId={currentUserId}
                placeholder='Reply'
                minHeightClassName='min-h-[38px]'
                onSubmit={payload => onReplyToThread(thread, payload)}
              />
            </div>
          )}
        </div>
      )}
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
  editable,
  onClose,
  onSelectBlock,
  onBeforeCreateThread,
  onCreateThreadCreated,
  onCreateThreadFailed,
}: CanvasCommentsPanelProps): React.JSX.Element {
  const zero = useZero();
  const { user } = useAuth();
  const allUsers = useUsers();
  const [expandedThreadIds, setExpandedThreadIds] = useState<Set<string>>(() => new Set());
  const [threadStatusFilter, setThreadStatusFilter] = useState<CanvasCommentThreadFilter>('ALL');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [threads = []] = useCachedQuery(queries.canvasCommentThreads({ canvasId }), {
    enabled: Boolean(canvasId),
  }) as unknown as [CanvasCommentThread[]];

  const orderedThreads = useMemo(() => {
    return [...threads].sort((a, b) => {
      if (a.status !== b.status) return a.status === CanvasCommentThreadStatus.OPEN ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
  }, [threads]);

  const visibleThreads = useMemo(
    () =>
      threadStatusFilter === 'ALL'
        ? orderedThreads
        : orderedThreads.filter(thread => thread.status === threadStatusFilter),
    [orderedThreads, threadStatusFilter],
  );

  const selectedBlockThreads = useMemo(() => {
    if (!activeBlockId) return [];
    return visibleThreads.filter(thread => thread.blockId === activeBlockId);
  }, [activeBlockId, visibleThreads]);

  const openCount = orderedThreads.filter(
    thread => thread.status === CanvasCommentThreadStatus.OPEN,
  ).length;
  const resolvedCount = orderedThreads.filter(
    thread => thread.status === CanvasCommentThreadStatus.RESOLVED,
  ).length;

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

  useEffect(() => {
    if (!activeThreadId) return;
    setExpandedThreadIds(prev => new Set(prev).add(activeThreadId));
  }, [activeThreadId]);

  const toggleThreadExpanded = (threadId: string): void => {
    setExpandedThreadIds(prev => {
      const next = new Set(prev);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      return next;
    });
  };
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
    setExpandedThreadIds(prev => new Set(prev).add(threadId));
  };

  const replyToThread = (
    thread: CanvasCommentThread,
    { body, mentionedUserIds }: { body: string; mentionedUserIds: string[] },
  ): void => {
    const mutationResult = zero.mutate(
      mutators.canvasComment.reply({
        commentId: uuidv4(),
        threadId: thread.id,
        canvasId,
        body,
        mentionedUserIds,
        timestamp: Date.now(),
      }),
    );
    void mutationResult.server
      .then(result => {
        if (result.type !== 'error') {
          sendMentionNotifications(thread.blockId, mentionedUserIds, thread.id);
        }
      })
      .catch(error => {
        logger.error(Event.API_CALL_FAILED, {
          reason: error,
          context: 'canvas_comment_reply',
        });
      });
    setExpandedThreadIds(prev => new Set(prev).add(thread.id));
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
    <aside className='flex h-full w-[390px] shrink-0 flex-col rounded-tl-[18px] border border-r-0 border-input bg-background shadow-[0_0_20px_rgba(15,23,42,0.04)]'>
      <div className='flex items-start justify-between border-b border-border px-4 py-4'>
        <div className='min-w-0 flex-1'>
          <h2 className='truncate text-base font-semibold leading-5 text-foreground'>
            Comment activity
          </h2>
          <p className='mt-1 text-xs text-muted-foreground'>
            {openCount} open · {resolvedCount} resolved
          </p>
          <div className='mt-3 flex items-center gap-2'>
            <Button
              variant={threadStatusFilter === 'ALL' ? 'default' : 'outline'}
              size='sm'
              onClick={() => setThreadStatusFilter('ALL')}
              aria-pressed={threadStatusFilter === 'ALL'}
              className='h-8 rounded-full px-3 text-xs'
            >
              All {orderedThreads.length}
            </Button>
            <Button
              variant={
                threadStatusFilter === CanvasCommentThreadStatus.OPEN ? 'default' : 'outline'
              }
              size='sm'
              onClick={() => setThreadStatusFilter(CanvasCommentThreadStatus.OPEN)}
              aria-pressed={threadStatusFilter === CanvasCommentThreadStatus.OPEN}
              className='h-8 rounded-full px-3 text-xs'
            >
              Open {openCount}
            </Button>
            <Button
              variant={
                threadStatusFilter === CanvasCommentThreadStatus.RESOLVED ? 'default' : 'outline'
              }
              size='sm'
              onClick={() => setThreadStatusFilter(CanvasCommentThreadStatus.RESOLVED)}
              aria-pressed={threadStatusFilter === CanvasCommentThreadStatus.RESOLVED}
              className='h-8 rounded-full px-3 text-xs'
            >
              Resolved {resolvedCount}
            </Button>
          </div>
        </div>
        <Tooltip content='Close comments'>
          <Button
            variant='ghost'
            size='iconSm'
            onClick={onClose}
            aria-label='Close comments'
            className='mt-0.5'
          >
            <X className='size-4' />
          </Button>
        </Tooltip>
      </div>

      <div className='flex-1 overflow-y-auto px-4 py-4'>
        {editable && selectedTextAnchor && (
          <div className='mb-4 rounded-md border border-input bg-background p-3 shadow-sm'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <p className='truncate text-xs font-medium text-muted-foreground'>
                New comment on selected text
              </p>
            </div>
            <blockquote className='mb-2 line-clamp-3 rounded-md border-l-2 border-primary bg-background px-2 py-1 text-xs text-muted-foreground'>
              {selectedTextAnchor.anchorText}
            </blockquote>
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

        {activeBlockId && selectedBlockThreads.length > 0 && (
          <div className='mb-3 text-xs font-medium text-muted-foreground'>
            {selectedBlockThreads.length} on selected block
          </div>
        )}

        {visibleThreads.length === 0 ? (
          <div className='flex h-40 flex-col items-center justify-center rounded-md border border-dashed border-border text-center'>
            <MessageSquare className='mb-2 size-5 text-muted-foreground' />
            <p className='text-sm font-medium text-foreground'>
              {threadStatusFilter === 'ALL'
                ? 'No comments'
                : threadStatusFilter === CanvasCommentThreadStatus.RESOLVED
                  ? 'No resolved comments'
                  : 'No open comments'}
            </p>
            <p className='mt-1 text-xs text-muted-foreground'>
              {threadStatusFilter === 'ALL'
                ? 'Select text and start a thread.'
                : threadStatusFilter === CanvasCommentThreadStatus.RESOLVED
                  ? 'Resolved threads will appear here.'
                  : 'Select text and start a thread.'}
            </p>
          </div>
        ) : (
          <div className='space-y-3'>
            {visibleThreads.map(thread => (
              <CanvasCommentThreadSection
                key={thread.id}
                thread={thread}
                isSelectedBlock={activeBlockId === thread.blockId}
                isExpanded={expandedThreadIds.has(thread.id)}
                editable={editable}
                channelId={channelId}
                currentUserId={user?.id}
                allUsers={allUsers}
                editingCommentId={editingCommentId}
                onSelectBlock={onSelectBlock}
                onToggleExpanded={toggleThreadExpanded}
                onSetThreadStatus={setThreadStatus}
                onSetEditingCommentId={setEditingCommentId}
                onDeleteComment={deleteComment}
                onUpdateComment={updateComment}
                onReplyToThread={replyToThread}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
