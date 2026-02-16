import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Calendar, Check, ChevronRight, Eye } from 'lucide-react';
import { useZero } from '../../../hooks/useZero';
import { toast } from 'sonner';
import { Button } from '../../ui/Button/Button';
import { cn } from '../../../utils/classNames';
import { TicketPriority, type ProactiveNudge } from '@xyne/shared';
import { mutators } from '../../../zero/mutators';
import { ProactiveNudgeActionButton } from './ProactiveNudgeActionButton';
import { ProactiveNudgeResult } from './ProactiveNudgeResult';
import { formatDate } from '../../../utils/dateUtils';
import { useChannel } from '../../../hooks/useChannels';
import { CreateTicketModal } from '../../Tickets/CreateTicketModal/CreateTicketModal';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import type { ConversationWithTicket } from '../../ui/MessageBubble/MessageBubble.types';
import { useNavigate } from 'react-router-dom';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { standaloneNavigate } from '../../../utils/electronApp';
import { SubTicketCountIcon } from '../../../assets/icons';
import { getPriorityIcon } from '../../Tickets/TicketCard/TicketCard.utils';

const NUDGE_TYPE_LABELS: Record<string, string> = {
  EXISTING_TICKET: 'Existing Ticket',
  CREATE_TICKET: 'Create Ticket',
  SET_REMINDER: 'Set A Reminder',
  ADD_TO_KB: 'Add To Knowledge Base',
  REVERSE_KB_LOOKUP: 'Search KB',
  THREAD_FOLLOW_UP: 'Thread Follow-up',
  DECISION_PENDING: 'Decision Pending',
  WAITING_ON_BLOCKED_BY: 'Blocked / Waiting',
};

const getNudgeTypeLabel = (type: ProactiveNudge['type']): string => NUDGE_TYPE_LABELS[type] ?? type;

interface ProactiveNudgeCardProps {
  nudge: ProactiveNudge;
  channelId?: string | undefined;
  onActionCompleted?: () => void;
}

type SuggestedAction = {
  label: string;
  action_type: string;
  payload: Record<string, unknown>;
};

type ProactiveNudgeActionsPayload = {
  suggestedActions: SuggestedAction[];
  actionResult: Record<string, unknown> | null;
};

const getEvidenceText = (nudge: ProactiveNudge): string => {
  if (typeof nudge.evidenceSpans === 'string') {
    return nudge.evidenceSpans.trim();
  }
  return '';
};

export const ProactiveNudgeCard: React.FC<ProactiveNudgeCardProps> = ({
  nudge,
  channelId,
  onActionCompleted,
}) => {
  const zero = useZero();
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();
  const channel = useChannel(channelId ?? '');
  const coerceActionResult = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  };
  const actionsPayload = useMemo((): ProactiveNudgeActionsPayload => {
    if (!nudge.actions || typeof nudge.actions !== 'object' || Array.isArray(nudge.actions)) {
      return {
        suggestedActions: [],
        actionResult: null,
      };
    }

    const payload = nudge.actions as Record<string, unknown>;
    const suggestedActions = Array.isArray(payload['suggestedActions'])
      ? (payload['suggestedActions'] as SuggestedAction[])
      : [];
    const actionResult = coerceActionResult(payload['actionResult']);

    return {
      suggestedActions,
      actionResult,
    };
  }, [nudge.actions]);

  const [localActionResult, setLocalActionResult] = useState<Record<string, unknown> | null>(
    actionsPayload.actionResult,
  );
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const autoDismissedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setLocalActionResult(actionsPayload.actionResult);
  }, [actionsPayload.actionResult]);

  useEffect(() => {
    if (!localActionResult) return;
    if (nudge.state !== 'ACTED_ON') return;
    if (autoDismissedRef.current.has(nudge.id)) return;

    const actionType =
      (localActionResult['actionType'] as string | undefined) ||
      (localActionResult['action_type'] as string | undefined);
    if (actionType !== 'CREATE_TICKET_FROM_MESSAGE') return;

    autoDismissedRef.current.add(nudge.id);
    const timeout = setTimeout(() => {
      void zero.mutate(
        mutators.nudges.dismiss({
          nudgeId: nudge.id,
        }),
      );
    }, 4000);

    return () => clearTimeout(timeout);
  }, [localActionResult, nudge.id, nudge.state, zero]);

  const actions = actionsPayload.suggestedActions;

  const isActionable = nudge.state === 'ACTIVE';
  const isCreateTicketNudge = nudge.type === 'CREATE_TICKET';
  const isExistingTicketNudge = nudge.type === 'EXISTING_TICKET';
  const isReminderNudge = nudge.type === 'SET_REMINDER';

  const [messageWithConversation] = useCachedQuery(
    queries.getMessageForActivity({ messageId: nudge.messageId }),
    { enabled: isCreateTicketNudge && !!nudge.messageId },
  );

  const sourceConversation = useMemo(() => {
    const conversation = messageWithConversation?.conversation;
    return (conversation ?? undefined) as ConversationWithTicket | undefined;
  }, [messageWithConversation]);

  const [secondaryAction, primaryAction] = useMemo(() => {
    if (actions.length === 0) return [null, null];
    if (actions.length === 1) return [null, actions[0]];
    return [actions[0], actions[actions.length - 1]];
  }, [actions]);

  const createTicketAction = useMemo(() => {
    return actions.find(action => action.action_type === 'CREATE_TICKET_FROM_MESSAGE') ?? null;
  }, [actions]);

  const openTicketAction = useMemo(() => {
    return actions.find(action => action.action_type === 'OPEN_TICKET') ?? null;
  }, [actions]);

  const editTitle = useMemo(() => {
    const payload = createTicketAction?.payload;
    const titleValue = payload?.['title_suggestion'];
    const titleSuggestion = typeof titleValue === 'string' ? titleValue.trim() : '';
    return titleSuggestion || nudge.title || 'Create ticket';
  }, [createTicketAction, nudge.title]);

  const editDescription = useMemo(() => {
    const payload = createTicketAction?.payload;
    const descriptionValue = payload?.['description_suggestion'];
    const descriptionSuggestion =
      typeof descriptionValue === 'string' ? descriptionValue.trim() : '';
    return descriptionSuggestion || nudge.description || '';
  }, [createTicketAction, nudge.description]);

  const initialSubTickets = useMemo(() => {
    const payload = createTicketAction?.payload;
    const rawSubtickets = payload?.['subticket_suggestions'];
    if (!Array.isArray(rawSubtickets)) return [];

    return rawSubtickets
      .map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const record = item as Record<string, unknown>;
        const title = typeof record['title'] === 'string' ? record['title'].trim() : '';
        if (!title) return null;
        const description =
          typeof record['description'] === 'string' && record['description'].trim()
            ? record['description'].trim()
            : undefined;
        return { title, ...(description ? { description } : {}) };
      })
      .filter((item): item is { title: string; description?: string } => item !== null)
      .slice(0, 6);
  }, [createTicketAction]);

  // Extract suggested tags from the first CREATE_TICKET action payload
  const suggestedTags = useMemo(() => {
    if (!isCreateTicketNudge) return [];
    const payload = createTicketAction?.payload;
    const tagsRaw = payload?.['suggested_tags'] ?? payload?.['tags'];
    if (!Array.isArray(tagsRaw)) return [];
    return tagsRaw.filter((tag): tag is string => typeof tag === 'string');
  }, [isCreateTicketNudge, createTicketAction]);

  const createTicketCount = useMemo(() => initialSubTickets.length, [initialSubTickets.length]);

  const primaryMetadataTag = useMemo(() => {
    const firstTag = suggestedTags[0]?.trim();
    return firstTag && firstTag.length > 0 ? firstTag : 'metadata';
  }, [suggestedTags]);

  const additionalMetadataCount = useMemo(
    () => Math.max(suggestedTags.length - 1, 0),
    [suggestedTags.length],
  );

  const priorityLabel = useMemo(() => {
    const normalized =
      typeof nudge.priority === 'string' ? nudge.priority.trim().toLowerCase() : 'low';
    if (
      normalized === 'critical' ||
      normalized === 'high' ||
      normalized === 'medium' ||
      normalized === 'low'
    ) {
      return normalized;
    }
    return 'low';
  }, [nudge.priority]);

  const initialPriority = useMemo((): TicketPriority => {
    if (priorityLabel === 'critical') return TicketPriority.CRITICAL;
    if (priorityLabel === 'high') return TicketPriority.HIGH;
    if (priorityLabel === 'medium') return TicketPriority.MEDIUM;
    return TicketPriority.LOW;
  }, [priorityLabel]);

  const initialTags = useMemo(
    () => suggestedTags.map(tag => tag.trim()).filter(tag => tag.length > 0),
    [suggestedTags],
  );

  const reminderDateLabel = useMemo(() => {
    if (!isReminderNudge) return '';
    const reminderAction = actions.find(
      action =>
        action.action_type === 'CREATE_REMINDER' ||
        action.action_type === 'CREATE_FOLLOWUP_REMINDER',
    );
    const payload = reminderAction?.payload;
    const dueDatetime =
      typeof payload?.['due_datetime_iso'] === 'string' ? payload['due_datetime_iso'] : null;
    if (dueDatetime) {
      return formatDate(new Date(dueDatetime));
    }
    const dueText = typeof payload?.['due_text'] === 'string' ? payload['due_text'] : null;
    if (dueText) {
      return dueText;
    }
    if (nudge.createdAt) return formatDate(new Date(nudge.createdAt));
    return '';
  }, [actions, isReminderNudge, nudge.createdAt]);

  const evidenceText = getEvidenceText(nudge);

  const handleReview = (): void => {
    if (!channelId || !channel?.projectId) {
      toast.error('Channel not available for review');
      return;
    }
    setIsEditModalOpen(true);
  };

  const handleOpenExistingTicket = (): void => {
    if (!openTicketAction) return;

    const payload = openTicketAction.payload ?? {};
    const ticketId = typeof payload['ticketId'] === 'string' ? payload['ticketId'] : undefined;
    const targetChannelId =
      typeof payload['channelId'] === 'string' ? payload['channelId'] : channelId;
    const conversationId =
      typeof payload['conversationId'] === 'string'
        ? payload['conversationId']
        : sourceConversation?.conversationId;

    if (!ticketId || !targetChannelId) {
      toast.error('Missing ticket context');
      return;
    }

    const nextActionResult: Record<string, unknown> = {
      actionType: 'OPEN_TICKET',
      result: {
        ticketId,
        channelId: targetChannelId,
        ...(conversationId ? { conversationId } : {}),
      },
    };

    setLocalActionResult(nextActionResult);

    void zero.mutate(
      mutators.nudges.act({
        nudgeId: nudge.id,
        actionResult: nextActionResult,
      }),
    );

    const route = `${baseRoute}/${targetChannelId}?tab=tickets&ticketId=${ticketId}${
      conversationId ? `&conversationId=${conversationId}` : ''
    }`;
    standaloneNavigate(navigate, route);

    toast.success('Opened existing ticket');
    onActionCompleted?.();
  };

  const handleDismiss = (): void => {
    void zero.mutate(
      mutators.nudges.dismiss({
        nudgeId: nudge.id,
      }),
    );
    toast('Nudge dismissed');
  };

  return (
    <div
      className={cn(
        'w-full max-w-[520px] rounded-xl border border-gray-200 bg-white p-3',
        'text-[13px]',
      )}
    >
      {/* Header row */}
      {isCreateTicketNudge ? (
        <div className='flex items-center gap-0.5'>
          <span className='text-xs font-[450] text-[#788187]'>{getNudgeTypeLabel(nudge.type)}</span>
          {createTicketCount > 0 && (
            <>
              <ChevronRight className='h-[13px] w-[13px] text-[#788187]' strokeWidth={1.8} />
              <div className='flex items-center gap-1 text-[#788187]'>
                <SubTicketCountIcon className='h-3.5 w-3.5' />
                <span className='text-xs font-[450]'>{createTicketCount}</span>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className='flex items-center'>
          <span className='text-xs font-[450] text-gray-500'>{getNudgeTypeLabel(nudge.type)}</span>
        </div>
      )}

      {/* Title */}
      <div className='mt-2 text-sm font-medium leading-[18px] text-gray-900 line-clamp-2'>
        {nudge.title}
      </div>

      {/* Metadata row — only for CREATE_TICKET */}
      {isCreateTicketNudge && (
        <div className='mt-3 flex items-center justify-between gap-3'>
          <div className='flex min-w-0 items-center gap-2'>
            <span className='inline-flex items-center gap-[5px] rounded-[4px] border border-[#f0f0f0] bg-[#fcfcfc] px-[6px] py-[3px]'>
              <span className='h-1.5 w-1.5 rounded-full bg-[#bb7cf5]' />
              <span className='text-xs font-medium tracking-[0.36px] text-[#838383]'>
                {primaryMetadataTag}
              </span>
            </span>

            {additionalMetadataCount > 0 && (
              <span className='inline-flex items-center rounded-[4px] border border-[#f0f0f0] bg-[#fcfcfc] px-[6px] py-[3px] text-xs font-medium tracking-[0.36px] text-[#838383]'>
                +{additionalMetadataCount}
              </span>
            )}

            <span className='inline-flex h-6 items-center gap-[6px] rounded-[6px] border border-[#f2f2f3] bg-[#fafafa] px-2 py-1'>
              <span className='inline-flex items-center'>{getPriorityIcon(initialPriority)}</span>
              <span className='text-[13px] font-medium capitalize leading-[22px] text-[#505b62]'>
                {priorityLabel}
              </span>
            </span>
          </div>

          {isActionable ? (
            <Button
              size='sm'
              variant='outline'
              onClick={handleReview}
              className='h-8 rounded-[8px] border-[#e4e6e7] px-[10px] text-sm text-[#787878] hover:bg-gray-50'
            >
              <Eye className='h-4 w-4' />
              Review
            </Button>
          ) : (
            <span className='text-xs font-medium text-emerald-600'>Action completed</span>
          )}
        </div>
      )}

      {/* Date row — only for SET_REMINDER */}
      {isReminderNudge && reminderDateLabel && (
        <div className='mt-3 flex items-center gap-2 text-xs text-gray-500'>
          <Calendar className='h-3.5 w-3.5 text-gray-400' />
          <span>{reminderDateLabel}</span>
        </div>
      )}

      {/* Action buttons */}
      {!isCreateTicketNudge && (
        <div className='mt-3 flex items-center justify-end gap-3'>
          {isActionable && isExistingTicketNudge && openTicketAction ? (
            <Button
              size='sm'
              variant='outline'
              onClick={handleOpenExistingTicket}
              className='h-8 rounded-lg border-gray-300 px-3 text-sm text-gray-900'
            >
              Open ticket
            </Button>
          ) : (
            <>
              {isActionable && secondaryAction && (
                <ProactiveNudgeActionButton
                  nudgeId={nudge.id}
                  actionIndex={actions.indexOf(secondaryAction)}
                  label='Edit'
                  onActionResult={result => {
                    setLocalActionResult(result);
                    onActionCompleted?.();
                  }}
                  variant='ghost'
                  className='h-8 px-2 text-sm text-gray-500 hover:text-gray-800'
                />
              )}
              {isActionable && primaryAction && (
                <ProactiveNudgeActionButton
                  nudgeId={nudge.id}
                  actionIndex={actions.indexOf(primaryAction)}
                  label='Approve'
                  onActionResult={result => {
                    setLocalActionResult(result);
                    onActionCompleted?.();
                  }}
                  icon={Check}
                  variant='outline'
                  className='h-8 rounded-lg border-gray-300 px-3 text-sm text-gray-900'
                />
              )}
            </>
          )}
        </div>
      )}

      {/* Action result */}
      {localActionResult && (
        <ProactiveNudgeResult actionResult={localActionResult} channelId={channelId} />
      )}

      {/* Dismiss fallback when no actions available */}
      {isActionable && actions.length === 0 && (
        <div className='mt-3'>
          <Button size='sm' variant='ghost' onClick={handleDismiss}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Evidence quote */}
      {evidenceText && (
        <div className='mt-3 rounded-tr-lg rounded-br-lg border-l-2 border-gray-400 bg-gray-50 px-2 py-1.5'>
          <p className='text-sm italic text-gray-500 line-clamp-3'>&ldquo;{evidenceText}&rdquo;</p>
        </div>
      )}

      {/* Edit modal for CREATE_TICKET */}
      {isCreateTicketNudge && channelId && channel?.projectId && (
        <CreateTicketModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          channelId={channelId}
          projectId={channel.projectId}
          initialTitle={editTitle}
          initialDescription={editDescription}
          initialSubTickets={initialSubTickets}
          initialPriority={initialPriority}
          initialTags={initialTags}
          sourceConversation={sourceConversation}
          onTicketCreated={ticket => {
            setIsEditModalOpen(false);
            const nextActionResult: Record<string, unknown> = {
              actionType: 'CREATE_TICKET_FROM_MESSAGE',
              result: {
                ticketId: ticket.id,
                xyneId: ticket.xyneId,
                conversationId: ticket.conversationId,
              },
            };

            setLocalActionResult(nextActionResult);
            void zero.mutate(
              mutators.nudges.act({
                nudgeId: nudge.id,
                actionResult: nextActionResult,
              }),
            );
            toast.success('Ticket created');
            onActionCompleted?.();
          }}
        />
      )}
    </div>
  );
};
