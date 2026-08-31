import React, { useMemo, useState, useEffect } from 'react';
import { ChevronRight, Eye, Phone, X } from 'lucide-react';
import { useZero } from '../../../hooks/useZero';
import { toast } from 'sonner';
import { Button } from '../../ui/Button/Button';
import { cn } from '../../../utils/classNames';
import { TicketPriority, NudgeState, NudgeKind, type SurfaceNudge } from '@xyne/shared';
import { mutators } from '../../../zero/mutators';
import { trackNudgeActed, trackNudgeDismissed } from '../../../services/otel/nudgeMetrics';
import { SurfaceNudgeResult } from './SurfaceNudgeResult';
import { useChannel } from '../../../hooks/useChannels';
import { CreateTicketModal } from '../../Tickets/CreateTicketModal/CreateTicketModal';
import type { ConversationWithTicket } from '../../ui/MessageBubble/MessageBubble.types';
import { useNavigate } from 'react-router-dom';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { standaloneNavigate } from '../../../utils/electronApp';
import { getPriorityIcon } from '../../Tickets/TicketCard/TicketCard.utils';
import { SubTicketCountIcon } from '../../../assets/icons';
import { ScheduleCallModal } from '../../Call/ScheduleCallModal/ScheduleCallModal';

const NUDGE_KIND_LABELS: Record<string, string> = {
  CREATE_TICKET_FROM_MESSAGE: 'Create Ticket',
  FIND_RELATED_TICKET_FROM_MESSAGE: 'Related Ticket',
  FIND_RELATED_MESSAGE_FROM_MESSAGE: 'Related Message',
  SCHEDULE_CALL_FROM_THREAD: 'Schedule Call',
};

const getNudgeKindLabel = (kind: string): string => NUDGE_KIND_LABELS[kind] ?? kind;

type ActionsPayload = {
  actionType: string;
  actionMode: 'read' | 'write';
  onSuccess: 'none' | 'acted_on' | 'dismissed';
  createSurfaceLink: boolean;
  data: Record<string, unknown>;
};

type ActionResult = Record<string, unknown>;

interface SurfaceNudgeCardProps {
  nudge: SurfaceNudge;
  channelId?: string | undefined;
  onActionCompleted?: () => void;
}

const parseActions = (actions: unknown): ActionsPayload | null => {
  if (!actions || typeof actions !== 'object' || Array.isArray(actions)) return null;
  const obj = actions as Record<string, unknown>;
  const actionType = typeof obj['actionType'] === 'string' ? obj['actionType'] : null;
  if (!actionType) return null;
  const defaultBehavior = (() => {
    switch (actionType) {
      case 'OPEN_RELATED_MESSAGE':
      case 'OPEN_TICKET':
        return {
          actionMode: 'read' as const,
          onSuccess: 'none' as const,
          createSurfaceLink: false,
        };
      case 'CREATE_TICKET_FROM_MESSAGE':
        return {
          actionMode: 'write' as const,
          onSuccess: 'acted_on' as const,
          createSurfaceLink: true,
        };
      case 'SCHEDULE_CALL_FROM_THREAD':
        return {
          actionMode: 'write' as const,
          onSuccess: 'acted_on' as const,
          createSurfaceLink: false,
        };
      default:
        return {
          actionMode: 'write' as const,
          onSuccess: 'acted_on' as const,
          createSurfaceLink: true,
        };
    }
  })();

  return {
    actionType,
    actionMode:
      obj['actionMode'] === 'read' || obj['actionMode'] === 'write'
        ? obj['actionMode']
        : defaultBehavior.actionMode,
    onSuccess:
      obj['onSuccess'] === 'none' ||
      obj['onSuccess'] === 'acted_on' ||
      obj['onSuccess'] === 'dismissed'
        ? obj['onSuccess']
        : defaultBehavior.onSuccess,
    createSurfaceLink:
      typeof obj['createSurfaceLink'] === 'boolean'
        ? obj['createSurfaceLink']
        : defaultBehavior.createSurfaceLink,
    data: obj,
  };
};

const parseActionResult = (actions: unknown): ActionResult | null => {
  if (!actions || typeof actions !== 'object' || Array.isArray(actions)) return null;
  const obj = actions as Record<string, unknown>;
  const result = obj['actionResult'];
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  return result as ActionResult;
};

export const SurfaceNudgeCard: React.FC<SurfaceNudgeCardProps> = ({
  nudge,
  channelId,
  onActionCompleted,
}) => {
  const zero = useZero();
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();
  const channel = useChannel(channelId ?? '');

  const actionsPayload = useMemo(() => parseActions(nudge.actions), [nudge.actions]);
  const persistedActionResult = useMemo(() => parseActionResult(nudge.actions), [nudge.actions]);

  const [localActionResult, setLocalActionResult] = useState<ActionResult | null>(
    persistedActionResult,
  );
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isActing, setIsActing] = useState(false);
  useEffect(() => {
    setLocalActionResult(persistedActionResult);
  }, [persistedActionResult]);

  const isActionable = nudge.state === NudgeState.ACTIVE;
  const canDismiss = nudge.state === NudgeState.ACTIVE || nudge.state === NudgeState.ACTED_ON;
  const isCreateTicket = nudge.nudgeKind === NudgeKind.CREATE_TICKET_FROM_MESSAGE;
  const isRelatedTicket = nudge.nudgeKind === NudgeKind.FIND_RELATED_TICKET_FROM_MESSAGE;
  const isRelatedMessage = nudge.nudgeKind === NudgeKind.FIND_RELATED_MESSAGE_FROM_MESSAGE;
  const isScheduleCall = nudge.nudgeKind === NudgeKind.SCHEDULE_CALL_FROM_THREAD;

  const [isScheduleCallModalOpen, setIsScheduleCallModalOpen] = useState(false);

  // For CREATE_TICKET: build sourceConversation from actions payload (no extra query needed)
  const sourceConversation = useMemo((): ConversationWithTicket | undefined => {
    if (!isCreateTicket || !actionsPayload) return undefined;
    const conversationId = actionsPayload.data['conversationId'];
    if (typeof conversationId !== 'string' || !conversationId) return undefined;
    const initialMessageId =
      typeof actionsPayload.data['initialMessageId'] === 'string'
        ? actionsPayload.data['initialMessageId']
        : nudge.sourceId;
    return {
      conversationId,
      initialMessageId,
    } as ConversationWithTicket;
  }, [isCreateTicket, actionsPayload, nudge.sourceId]);

  // Extract create ticket suggestions from actions payload
  const titleSuggestion = useMemo(() => {
    if (!isCreateTicket || !actionsPayload) return nudge.title;
    const val = actionsPayload.data['title_suggestion'];
    return typeof val === 'string' && val.trim() ? val.trim() : nudge.title;
  }, [isCreateTicket, actionsPayload, nudge.title]);

  const descriptionSuggestion = useMemo(() => {
    if (!isCreateTicket || !actionsPayload) return nudge.description;
    const val = actionsPayload.data['description_suggestion'];
    return typeof val === 'string' && val.trim() ? val.trim() : nudge.description;
  }, [isCreateTicket, actionsPayload, nudge.description]);

  const initialSubTickets = useMemo(() => {
    if (!isCreateTicket || !actionsPayload) return [];
    const raw = actionsPayload.data['subticket_suggestions'];
    if (!Array.isArray(raw)) return [];

    return raw
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
  }, [isCreateTicket, actionsPayload]);

  const createTicketCount = useMemo(() => initialSubTickets.length, [initialSubTickets.length]);

  const priorityLabel = useMemo(() => {
    const normalized =
      typeof nudge.priority === 'string' ? nudge.priority.trim().toLowerCase() : 'low';
    if (['critical', 'high', 'medium', 'low'].includes(normalized)) return normalized;
    return 'low';
  }, [nudge.priority]);

  const initialPriority = useMemo((): TicketPriority => {
    if (priorityLabel === 'critical') return TicketPriority.CRITICAL;
    if (priorityLabel === 'high') return TicketPriority.HIGH;
    if (priorityLabel === 'medium') return TicketPriority.MEDIUM;
    return TicketPriority.LOW;
  }, [priorityLabel]);

  const evidenceText = useMemo(() => {
    const raw = actionsPayload?.data?.['evidence'];
    return typeof raw === 'string' ? raw.trim() : '';
  }, [actionsPayload]);

  const handleReview = (): void => {
    if (!channelId || !channel?.projectId) {
      toast.error('Channel not available for review');
      return;
    }
    setIsEditModalOpen(true);
  };

  const handleOpenRelatedTicket = (): void => {
    if (!actionsPayload || isActing) return;
    const ticketId =
      typeof actionsPayload.data['entityId'] === 'string'
        ? actionsPayload.data['entityId']
        : undefined;
    const targetChannelId =
      typeof actionsPayload.data['channelId'] === 'string'
        ? actionsPayload.data['channelId']
        : channelId;
    const conversationId =
      typeof actionsPayload.data['conversationId'] === 'string'
        ? actionsPayload.data['conversationId']
        : undefined;

    if (!ticketId || !targetChannelId) {
      toast.error('Missing ticket context');
      return;
    }

    if (actionsPayload.onSuccess !== 'none' || actionsPayload.createSurfaceLink) {
      setIsActing(true);
      trackNudgeActed(nudge.nudgeKind);
      const nextActionResult: ActionResult = {
        actionType: 'OPEN_TICKET',
        result: {
          entityId: ticketId,
          channelId: targetChannelId,
          ...(conversationId ? { conversationId } : {}),
        },
      };

      setLocalActionResult(nextActionResult);
      void zero.mutate(
        mutators.nudges.act({
          nudgeId: nudge.id,
          actionResult: nextActionResult,
          timestamp: Date.now(),
        }),
      );
      onActionCompleted?.();
    }

    const route = `${baseRoute}/${targetChannelId}?tab=tickets&ticketId=${ticketId}${
      conversationId ? `&conversationId=${conversationId}` : ''
    }`;
    standaloneNavigate(navigate, route);
    toast.success('Opened related ticket');
  };

  const handleOpenRelatedMessage = (): void => {
    if (!actionsPayload || isActing) return;
    const relatedMessageId =
      typeof actionsPayload.data['entityId'] === 'string'
        ? actionsPayload.data['entityId']
        : undefined;
    const targetChannelId =
      typeof actionsPayload.data['channelId'] === 'string'
        ? actionsPayload.data['channelId']
        : channelId;
    const conversationId =
      typeof actionsPayload.data['conversationId'] === 'string'
        ? actionsPayload.data['conversationId']
        : undefined;

    if (!relatedMessageId || !targetChannelId) {
      toast.error('Missing message context');
      return;
    }

    if (actionsPayload.onSuccess !== 'none' || actionsPayload.createSurfaceLink) {
      setIsActing(true);
      trackNudgeActed(nudge.nudgeKind);
      const nextActionResult: ActionResult = {
        actionType: 'OPEN_RELATED_MESSAGE',
        result: {
          entityId: relatedMessageId,
          channelId: targetChannelId,
          ...(conversationId ? { conversationId } : {}),
        },
      };

      setLocalActionResult(nextActionResult);
      void zero.mutate(
        mutators.nudges.act({
          nudgeId: nudge.id,
          actionResult: nextActionResult,
          timestamp: Date.now(),
        }),
      );
      onActionCompleted?.();
    }

    const route = conversationId
      ? `${baseRoute}/${targetChannelId}/${conversationId}${relatedMessageId ? `?messageId=${relatedMessageId}` : ''}`
      : `${baseRoute}/${targetChannelId}`;
    standaloneNavigate(navigate, route);
    toast.success('Opened related message');
  };

  const handleDismiss = (): void => {
    if (isActing) return;
    setIsActing(true);
    trackNudgeDismissed(nudge.nudgeKind);
    void zero.mutate(
      mutators.nudges.dismiss({
        nudgeId: nudge.id,
        timestamp: Date.now(),
      }),
    );
    toast('Nudge dismissed');
  };

  return (
    <div
      className={cn(
        'w-full rounded-xl border border-border bg-card p-3',
        'text-[13px]',
        isScheduleCall ? 'max-w-[360px]' : 'max-w-[520px]',
      )}
    >
      {/* Header row */}
      {isCreateTicket ? (
        <div className='flex items-center gap-0.5'>
          <span className='text-xs font-[450] text-muted-foreground'>
            {getNudgeKindLabel(nudge.nudgeKind)}
          </span>
          {createTicketCount > 0 && (
            <>
              <ChevronRight className='h-[13px] w-[13px] text-muted-foreground' strokeWidth={1.8} />
              <div className='flex items-center gap-1 text-muted-foreground'>
                <SubTicketCountIcon className='h-3.5 w-3.5' />
                <span className='text-xs font-[450]'>{createTicketCount}</span>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className='flex items-center justify-between'>
          <span className='text-xs font-[450] text-muted-foreground'>
            {getNudgeKindLabel(nudge.nudgeKind)}
          </span>
          {isScheduleCall && canDismiss && (
            <button
              onClick={handleDismiss}
              disabled={isActing}
              data-track-category='NUDGES'
              data-track-name='dismiss_schedule_call_nudge'
              className='p-0.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/50 disabled:opacity-50'
            >
              <X className='h-3.5 w-3.5' />
            </button>
          )}
        </div>
      )}

      {/* Title */}
      <div className='mt-2 text-sm font-medium leading-[18px] text-foreground line-clamp-2'>
        {nudge.title}
      </div>

      {/* Metadata + action row for CREATE_TICKET */}
      {isCreateTicket && (
        <div className='mt-3 flex items-center justify-between gap-3'>
          <div className='flex min-w-0 items-center gap-2'>
            <span className='inline-flex h-6 items-center gap-[6px] rounded-[6px] border border-border bg-muted px-2 py-1'>
              <span className='inline-flex items-center'>{getPriorityIcon(initialPriority)}</span>
              <span className='text-[13px] font-medium capitalize leading-[22px] text-muted-foreground'>
                {priorityLabel}
              </span>
            </span>
          </div>

          {isActionable ? (
            <Button
              size='sm'
              variant='outline'
              disabled={isActing}
              onClick={handleReview}
              data-track-category='NUDGES'
              data-track-name='REVIEW_NUDGE'
              className='h-8 rounded-[8px] border-border px-[10px] text-sm text-muted-foreground hover:bg-muted/50'
            >
              <Eye className='h-4 w-4' />
              Review
            </Button>
          ) : (
            <span className='text-xs font-medium text-emerald-600'>Action completed</span>
          )}
        </div>
      )}

      {/* Action buttons for FIND_RELATED_TICKET */}
      {isRelatedTicket && (
        <div className='mt-3 flex items-center justify-end gap-3'>
          {isActionable && (
            <Button
              size='sm'
              variant='outline'
              disabled={isActing}
              onClick={handleOpenRelatedTicket}
              data-track-category='NUDGES'
              data-track-name='OPEN_NUDGE_TICKET'
              className='h-8 rounded-lg border-border px-3 text-sm text-foreground'
            >
              Open ticket
            </Button>
          )}
        </div>
      )}

      {/* Action buttons for FIND_RELATED_MESSAGE */}
      {isRelatedMessage && (
        <div className='mt-3 flex items-center justify-end gap-3'>
          {isActionable && (
            <Button
              size='sm'
              variant='outline'
              disabled={isActing}
              onClick={handleOpenRelatedMessage}
              data-track-category='NUDGES'
              data-track-name='OPEN_NUDGE_MESSAGE'
              className='h-8 rounded-lg border-border px-3 text-sm text-foreground'
            >
              View message
            </Button>
          )}
        </div>
      )}

      {/* Action buttons for SCHEDULE_CALL_FROM_THREAD */}
      {isScheduleCall && (
        <div className='mt-3 flex items-center justify-end gap-3'>
          {isActionable && (
            <Button
              size='sm'
              variant='outline'
              disabled={isActing}
              onClick={() => setIsScheduleCallModalOpen(true)}
              data-track-category='NUDGES'
              data-track-name='OPEN_NUDGE_SCHEDULE_CALL'
              className='h-8 rounded-lg border-border px-3 text-sm text-foreground'
            >
              <Phone className='mr-1 h-3.5 w-3.5' />
              Schedule Xyne Call
            </Button>
          )}
        </div>
      )}

      {/* Action result */}
      {localActionResult && (
        <SurfaceNudgeResult actionResult={localActionResult} channelId={channelId} />
      )}

      {/* Dismiss fallback - only for non-schedule call nudges */}
      {!isScheduleCall && canDismiss && (
        <div className='mt-3 flex items-center justify-end'>
          <Button
            size='sm'
            variant='ghost'
            disabled={isActing}
            onClick={handleDismiss}
            data-track-category='NUDGES'
            data-track-name='DISMISS_NUDGE'
            className='text-muted-foreground'
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Evidence quote */}
      {evidenceText && (
        <div className='mt-3 rounded-tr-lg rounded-br-lg border-l-2 border-border bg-muted/50 px-2 py-1.5'>
          <p className='text-sm italic text-muted-foreground line-clamp-3'>
            &ldquo;{evidenceText}&rdquo;
          </p>
        </div>
      )}

      {/* Edit modal for CREATE_TICKET */}
      {isCreateTicket && channelId && (
        <CreateTicketModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          channelId={channelId}
          {...(channel?.projectId ? { projectId: channel.projectId } : {})}
          initialTitle={titleSuggestion}
          initialDescription={descriptionSuggestion}
          initialSubTickets={initialSubTickets}
          initialPriority={initialPriority}
          sourceConversation={sourceConversation}
          onTicketCreated={ticket => {
            setIsEditModalOpen(false);
            trackNudgeActed(nudge.nudgeKind);
            const nextActionResult: ActionResult = {
              actionType: 'CREATE_TICKET_FROM_MESSAGE',
              result: {
                entityId: ticket.id,
                xyneId: ticket.xyneId,
                conversationId: ticket.conversationId,
              },
            };

            setLocalActionResult(nextActionResult);
            void zero.mutate(
              mutators.nudges.act({
                nudgeId: nudge.id,
                actionResult: nextActionResult,
                timestamp: Date.now(),
              }),
            );
            // Auto-dismiss after ticket creation
            setTimeout(() => {
              void zero.mutate(
                mutators.nudges.dismiss({
                  nudgeId: nudge.id,
                  timestamp: Date.now(),
                }),
              );
            }, 3000);
            toast.success('Ticket created');
            onActionCompleted?.();
          }}
        />
      )}

      {/* Schedule Call modal for SCHEDULE_CALL_FROM_THREAD */}
      {isScheduleCall && (
        <ScheduleCallModal
          isOpen={isScheduleCallModalOpen}
          onClose={() => setIsScheduleCallModalOpen(false)}
          {...(typeof actionsPayload?.data['channelId'] === 'string' &&
          actionsPayload.data['channelId']
            ? { channelId: actionsPayload.data['channelId'] }
            : {})}
          {...(typeof actionsPayload?.data['conversationId'] === 'string' &&
          actionsPayload.data['conversationId']
            ? { conversationId: actionsPayload.data['conversationId'] }
            : {})}
          {...(typeof actionsPayload?.data['suggestedTitle'] === 'string' &&
          actionsPayload.data['suggestedTitle']
            ? { initialTitle: actionsPayload.data['suggestedTitle'] }
            : {})}
          onSuccess={() => {
            setIsScheduleCallModalOpen(false);
            setIsActing(true);
            void zero.mutate(
              mutators.nudges.act({
                nudgeId: nudge.id,
                actionResult: {
                  actionType: 'SCHEDULE_CALL_FROM_THREAD',
                  result: { scheduled: true },
                },
                timestamp: Date.now(),
              }),
            );
            onActionCompleted?.();
          }}
        />
      )}
    </div>
  );
};
