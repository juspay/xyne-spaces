import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, MessageSquare, MoreVertical, Pencil, Trash2, X } from 'lucide-react';
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
  status: CanvasCommentThreadStatus;
  statusUpdatedBy?: string | null;
  statusUpdatedAt?: number | null;
  createdBy: string;
  createdAt: number;
  comments?: CanvasComment[];
};

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

const getDisplayName = (user?: UserLite | null): string =>
  user?.displayName || user?.name || user?.email || 'Unknown';

const formatCommentTime = (timestamp: number): string =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));

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

  const mentionItems = useMemo(() => {
    const source = channelId ? results : allUsers;
    const query = fallbackMentionQuery.trim().toLowerCase();
    return source
      .filter(mention => mention.type === 'user' && mention.id !== currentUserId)
      .filter(mention => {
        if (channelId || !query) return true;
        return (
          mention.name.toLowerCase().includes(query) ||
          (mention.email?.toLowerCase().includes(query) ?? false)
        );
      })
      .slice(0, 8);
  }, [allUsers, channelId, currentUserId, fallbackMentionQuery, results]);

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
          'canvas-comment-composer rounded-md border border-border bg-background',
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
      />
      {actions && <div className='flex items-center justify-start gap-2'>{actions}</div>}
    </div>
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
  onCreateThreadFailed,
}: CanvasCommentsPanelProps): React.JSX.Element {
  const zero = useZero();
  const { user } = useAuth();
  const allUsers = useUsers();
  const [expandedThreadIds, setExpandedThreadIds] = useState<Set<string>>(() => new Set());
  const [threadStatusFilter, setThreadStatusFilter] = useState<CanvasCommentThreadStatus>(
    CanvasCommentThreadStatus.OPEN,
  );
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
    () => orderedThreads.filter(thread => thread.status === threadStatusFilter),
    [orderedThreads, threadStatusFilter],
  );

  const selectedBlockThreads = useMemo(() => {
    if (!activeBlockId) return [];
    return visibleThreads.filter(thread => thread.blockId === activeBlockId);
  }, [activeBlockId, visibleThreads]);

  const openCount = orderedThreads.filter(thread => thread.status === CanvasCommentThreadStatus.OPEN).length;
  const resolvedCount = orderedThreads.filter(thread => thread.status === CanvasCommentThreadStatus.RESOLVED).length;

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
    const activeThreadAnchor =
      activeAnchor?.blockId === activeBlockId && activeAnchor.anchorText ? activeAnchor : null;

    if (activeThreadAnchor && onBeforeCreateThread?.(threadId, activeThreadAnchor) === false) {
      toast.error('Unable to attach comment to selected text');
      return;
    }

    const mutationResult = zero.mutate(
      mutators.canvasComment.createThread({
        threadId,
        commentId: uuidv4(),
        canvasId,
        blockId: activeBlockId,
        ...(activeThreadAnchor && {
          anchorText: activeThreadAnchor.anchorText,
        }),
        body,
        mentionedUserIds,
        timestamp: Date.now(),
      }),
    );
    void mutationResult.server
      .then(result => {
        if (result.type !== 'error') {
          sendMentionNotifications(activeBlockId, mentionedUserIds, threadId);
        } else if (activeThreadAnchor) {
          onCreateThreadFailed?.(activeThreadAnchor);
        }
      })
      .catch(error => {
        if (activeThreadAnchor) {
          onCreateThreadFailed?.(activeThreadAnchor);
        }
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

  const resolveThread = (threadId: string): void => {
    zero.mutate(
      mutators.canvasComment.resolveThread({
        threadId,
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
    <aside className='flex h-full w-[390px] shrink-0 flex-col border-l border-border bg-background'>
      <div className='flex items-center justify-between border-b border-border px-4 py-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <MessageSquare className='size-4 text-muted-foreground' />
          <h2 className='truncate text-sm font-semibold text-foreground'>Comments</h2>
          <Button
            variant={threadStatusFilter === CanvasCommentThreadStatus.OPEN ? 'secondary' : 'ghost'}
            size='sm'
            onClick={() => setThreadStatusFilter(CanvasCommentThreadStatus.OPEN)}
            aria-pressed={threadStatusFilter === CanvasCommentThreadStatus.OPEN}
            className='h-7 px-2 text-xs'
          >
            {openCount} open
          </Button>
          <Button
            variant={threadStatusFilter === CanvasCommentThreadStatus.RESOLVED ? 'secondary' : 'ghost'}
            size='sm'
            onClick={() => setThreadStatusFilter(CanvasCommentThreadStatus.RESOLVED)}
            aria-pressed={threadStatusFilter === CanvasCommentThreadStatus.RESOLVED}
            className='h-7 px-2 text-xs'
          >
            {resolvedCount} resolved
          </Button>
        </div>
        <Tooltip content='Close comments'>
          <Button variant='ghost' size='iconSm' onClick={onClose} aria-label='Close comments'>
            <X className='size-4' />
          </Button>
        </Tooltip>
      </div>

      <div className='flex-1 overflow-y-auto px-4 py-4'>
        {editable && (
          <div className='mb-4 rounded-md border border-border bg-muted/20 p-3'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <p className='truncate text-xs font-medium text-muted-foreground'>
                {activeBlockId ? 'New comment on selected block' : 'Select a block to comment'}
              </p>
            </div>
            {activeAnchor?.blockId === activeBlockId && activeAnchor.anchorText && (
              <blockquote className='mb-2 line-clamp-3 rounded-md border-l-2 border-primary bg-background px-2 py-1 text-xs text-muted-foreground'>
                {activeAnchor.anchorText}
              </blockquote>
            )}
            <CanvasCommentComposer
              id={`canvas-comment-new-${canvasId}`}
              channelId={channelId}
              currentUserId={user?.id}
              placeholder='Add a comment'
              disabled={!activeBlockId}
              minHeightClassName='min-h-[84px]'
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
              {threadStatusFilter === CanvasCommentThreadStatus.RESOLVED ? 'No resolved comments' : 'No open comments'}
            </p>
            <p className='mt-1 text-xs text-muted-foreground'>
              {threadStatusFilter === CanvasCommentThreadStatus.RESOLVED
                ? 'Resolved threads will appear here.'
                : 'Select a block and start a thread.'}
            </p>
          </div>
        ) : (
          <div className='space-y-3'>
            {visibleThreads.map(thread => {
              const comments = thread.comments || [];
              const visibleComments = comments.filter(comment => !comment.deletedAt);
              const previewComment = visibleComments[visibleComments.length - 1] ?? comments[0];
              const isSelectedBlock = activeBlockId === thread.blockId;
              const isExpanded = expandedThreadIds.has(thread.id);
              const replyCount = Math.max(comments.length - 1, 0);

              return (
                <section
                  key={thread.id}
                  className={cn(
                    'rounded-md border bg-background transition-colors',
                    isSelectedBlock ? 'border-primary/60 shadow-sm' : 'border-border',
                    thread.status === CanvasCommentThreadStatus.RESOLVED && 'bg-muted/20 opacity-80',
                  )}
                >
                  <div className='flex items-start justify-between gap-2 border-b border-border px-3 py-2'>
                    <button
                      type='button'
                      className='min-w-0 flex-1 space-y-1 text-left'
                      data-track-category='canvas'
                      data-track-name='TOGGLE_CANVAS_COMMENT_THREAD'
                      onClick={() => {
                        onSelectBlock(thread.blockId);
                        toggleThreadExpanded(thread.id);
                      }}
                      aria-expanded={isExpanded}
                    >
                      {thread.anchorText && (
                        <span className='line-clamp-2 block rounded-sm border-l-2 border-primary bg-muted/30 px-2 py-1 text-xs italic text-muted-foreground'>
                          {thread.anchorText}
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
                      <span className='block text-[11px] text-muted-foreground'>
                        {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
                      </span>
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
                            onClick={() => resolveThread(thread.id)}
                            aria-label='Resolve comment'
                          >
                            <Check className='size-4' />
                          </Button>
                        </Tooltip>
                      )}
                      <Button
                        variant='ghost'
                        size='iconSm'
                        onClick={() => {
                          onSelectBlock(thread.blockId);
                          toggleThreadExpanded(thread.id);
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
                  </div>

                  {isExpanded && (
                    <div className='space-y-3 p-3'>
                      {comments.map(comment => {
                        const isOwnComment = comment.createdBy === user?.id;
                        const isDeleted = Boolean(comment.deletedAt);
                        const isEditing = editingCommentId === comment.id;
                        const commentAuthor =
                          allUsers.find(candidate => candidate.id === comment.createdBy) ??
                          comment.createdByUser;

                        return (
                          <div key={comment.id} className='group'>
                            <div className='mb-1 flex items-center justify-between gap-2'>
                              <div className='min-w-0'>
                                <p className='truncate text-xs font-semibold text-foreground'>
                                  {getDisplayName(commentAuthor)}
                                </p>
                                <p className='text-[11px] text-muted-foreground'>
                                  {formatCommentTime(comment.createdAt)}
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
                                    <DropdownMenuItem
                                      onClick={() => setEditingCommentId(comment.id)}
                                    >
                                      <Pencil className='size-4' />
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className='text-destructive focus:text-destructive'
                                      onClick={() => deleteComment(comment.id)}
                                    >
                                      <Trash2 className='size-4' />
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                            {isEditing ? (
                              <CanvasCommentComposer
                                id={`canvas-comment-edit-${comment.id}`}
                                channelId={channelId}
                                currentUserId={user?.id}
                                placeholder='Edit comment'
                                value={comment.body}
                                fallbackMentionedUserIds={parseMentionedUserIds(comment.mentionedUserIds)}
                                minHeightClassName='min-h-[64px]'
                                onSubmit={payload => updateComment(thread, comment, payload)}
                                actions={
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    onClick={() => setEditingCommentId(null)}
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
                        );
                      })}

                      {editable && (
                        <div className='border-t border-border pt-3'>
                          <CanvasCommentComposer
                            id={`canvas-comment-reply-${thread.id}`}
                            channelId={channelId}
                            currentUserId={user?.id}
                            placeholder='Reply'
                            minHeightClassName='min-h-[64px]'
                            onSubmit={payload => replyToThread(thread, payload)}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
