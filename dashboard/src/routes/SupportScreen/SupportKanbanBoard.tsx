import React, {
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useDeferredValue,
} from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  useSensor,
  useSensors,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
} from '@dnd-kit/core';
import type { Ticket, BoardMetadata, TicketStageRequest } from '@xyne/shared';
import { TicketPriority, TicketStatusV2 } from '@xyne/shared';
import { useZero } from '../../hooks/useZero';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { dataLoadDuration, safeRecordMetric } from '../../services/otel';
import { logger, Event } from '../../utils/logger';
import { useGetChannelUserStatus } from '../../hooks/useChannels';
import { useBoardsSlaPolicies } from '../../hooks/useChannelSlaPolicy';
import { useDragAndDrop } from '../../hooks/useDragAndDrop';
import { KanbanColumns } from '../../components/Tickets/KanbanColumns/KanbanColumns';
import { TicketCard } from '../../components/Tickets/TicketCard/TicketCard';
import { StageFormModal } from '../../components/Tickets/StageFormModal/StageFormModal';
import { Button } from '../../components/ui/Button/Button';
import Dialog from '../../components/ui/Dialog';
import { getStageColor, groupTicketsByStage } from '../KanbanBoardScreen/KanbanBoardScreen.utils';
import type { Stage } from '../KanbanBoardScreen/KanbanBoardScreen.types';

const toStageColumn = (stage: { id: string; name: string; sequenceNumber?: number }) => ({
  id: stage.id,
  name: stage.name,
  color: getStageColor(stage.name.toLowerCase().replace(/\s+/g, '_')),
  ...(stage.sequenceNumber !== undefined && { sequenceNumber: stage.sequenceNumber }),
});

export interface SupportKanbanBoardProps {
  channelId: string;
  boardId: string | null;
  onBoardIdResolved: (boardId: string) => void;
  ticketFilter: {
    assignedTo: string[] | undefined;
    priority: TicketPriority[] | undefined;
    stageName: string[] | undefined;
  };
  onTicketClick: (e: React.MouseEvent | KeyboardEvent, ticket: Ticket) => void;
  onTicketsLoaded?: (tickets: Ticket[]) => void;
}

/**
 * Kanban board for the Support screen.
 *
 * Extracted out of SupportScreen so the heavy kanban-only machinery (board/stage
 * subscriptions, ticket grouping, drag-and-drop, stage-form/approval modals) is
 * only ever mounted when the kanban view is active. In list view this component
 * is unmounted, so none of its queries or hooks exist — the same "only fetch
 * what the active view needs" optimization the standalone Kanban board uses.
 */
export const SupportKanbanBoard = ({
  channelId,
  boardId,
  onBoardIdResolved,
  ticketFilter,
  onTicketClick,
  onTicketsLoaded,
}: SupportKanbanBoardProps): ReactElement => {
  const zero = useZero();

  const channelUserStatus = useGetChannelUserStatus(channelId);
  const isMember = !!channelUserStatus;

  // Channel-scoped tickets. Gated on channelId only (NOT boardId), so it loads
  // immediately on first kanban visit; the board id is then derived from the
  // first row below.
  const [supportTickets, supportTicketsDetails] = useCachedQuery(
    queries.supportTicketsFilteredV3({
      channelId,
      isMember,
      ...ticketFilter,
    }),
    { enabled: !!channelId },
  );

  // Record kanban ticket load duration once the query completes. Mirrors the
  // list view's SUPPORT_TICKETS_LOADED instrumentation so both views are
  // comparable. The timer resets per channel + filter combination.
  const filterKey = useMemo(
    () =>
      JSON.stringify({
        c: channelId,
        a: ticketFilter.assignedTo ?? null,
        p: ticketFilter.priority ?? null,
        s: ticketFilter.stageName ?? null,
      }),
    [channelId, ticketFilter.assignedTo, ticketFilter.priority, ticketFilter.stageName],
  );
  const loadStartTimeRef = useRef<number | null>(Date.now());
  useEffect(() => {
    loadStartTimeRef.current = Date.now();
  }, [filterKey]);
  useEffect(() => {
    if (supportTicketsDetails.type !== 'complete') return;
    if (loadStartTimeRef.current === null) return;
    const duration = Date.now() - loadStartTimeRef.current;
    logger.info(Event.SUPPORT_TICKETS_LOADED, {
      source: 'SupportKanbanBoard',
      message: 'Support kanban tickets loaded',
      durationMs: duration,
      channelId,
      url: window.location.href,
    });
    safeRecordMetric(() => {
      dataLoadDuration.record(duration, {
        source: 'SupportKanbanBoard',
        event: Event.SUPPORT_TICKETS_LOADED,
        platform: logger.platformName,
      });
    });
    loadStartTimeRef.current = null;
  }, [supportTicketsDetails.type, filterKey, channelId]);

  // Resolve the board id from the first loaded ticket. Previously this only
  // happened in the list view (via onBoardIdReady), so visiting kanban first
  // left boardId null and the stage columns never loaded — tickets had nowhere
  // to render. Deriving it here makes kanban work on first visit.
  const firstRowBoardId = supportTickets?.[0]?.boardId;
  useEffect(() => {
    if (firstRowBoardId) onBoardIdResolved(firstRowBoardId);
  }, [firstRowBoardId, onBoardIdResolved]);

  // Report loaded tickets up so the parent can source the merge dialog.
  useEffect(() => {
    if (supportTickets) onTicketsLoaded?.(supportTickets as Ticket[]);
  }, [supportTickets, onTicketsLoaded]);

  const effectiveBoardId = boardId ?? firstRowBoardId ?? undefined;

  const [stages] = useCachedQuery(queries.stagesByBoard({ boardId: effectiveBoardId || '' }), {
    enabled: !!effectiveBoardId,
  });

  // Board metadata to determine the active SLA mechanism. getBoardById is
  // lightweight (board + project only, no stages) and is a separate subscription
  // from stagesByBoard, which returns stages not board rows.
  const [boardForSla] = useCachedQuery(queries.getBoardById({ boardId: effectiveBoardId || '' }), {
    enabled: !!effectiveBoardId,
  });
  const isBoardPrioritySla =
    (boardForSla?.metadata as BoardMetadata | null | undefined)?.slaPolicyType === 'priority';

  // SLA policies only when the board uses priority-based SLA. Boards using
  // stage-based SLA (the default) have no active entries, so we skip the
  // subscription entirely rather than firing an empty query.
  const slaPolicies = useBoardsSlaPolicies(
    isBoardPrioritySla && effectiveBoardId ? [effectiveBoardId] : [],
  );

  const [localTickets, setLocalTickets] = useState<Ticket[]>([]);
  useEffect(() => {
    if (supportTickets) {
      setLocalTickets(supportTickets as Ticket[]);
    }
  }, [supportTickets]);

  // Stages fetched dynamically from the board configured in EmailChannelPreference.
  // Empty if no board is configured — kanban will show no stages.
  const stageColumns = useMemo(() => stages?.map(toStageColumn) ?? [], [stages]);

  // Full stage objects (with formId and approvers) used for drag-and-drop and form checks.
  const stagesForDragDrop = useMemo<Stage[]>(() => {
    if (!stages) return [];
    return stages.map(stage => {
      const formId =
        stage.formContextMappings?.find(
          (m: { contextType: string; entityType: string; formId: string }) =>
            m.contextType === 'STAGE' && m.entityType === 'TICKET',
        )?.formId ?? null;
      return {
        id: stage.id,
        name: stage.name,
        color: getStageColor(stage.name.toLowerCase().replace(/\s+/g, '_')),
        ...(stage.sequenceNumber !== undefined ? { sequenceNumber: stage.sequenceNumber } : {}),
        ...(stage.defaultTicketStatusV2 !== undefined
          ? { defaultTicketStatusV2: stage.defaultTicketStatusV2 }
          : {}),
        ...(formId ? { formId } : {}),
        ...(stage.approvers ? { approvers: stage.approvers } : {}),
      } satisfies Stage;
    });
  }, [stages]);

  // Map of stageId -> formId for quick lookup during drag-and-drop.
  const stageFormMap = useMemo(() => {
    const map = new Map<string, string>();
    stagesForDragDrop.forEach(stage => {
      if (stage.formId) {
        map.set(stage.id, stage.formId);
      }
    });
    return map;
  }, [stagesForDragDrop]);

  // Defer the grouping input so a burst of ticket updates (or a filter change)
  // doesn't block the UI while we re-bucket every ticket into its column. The
  // drag-and-drop hook reads the live `localTickets` directly, so reordering is
  // unaffected — only the settled column layout is deferred a frame.
  const deferredLocalTickets = useDeferredValue(localTickets);
  const ticketsByStage = useMemo(
    () => groupTicketsByStage(deferredLocalTickets, stageColumns),
    [deferredLocalTickets, stageColumns],
  );

  // Stage form modal state — shown when moving a ticket to a stage that has a form.
  const [stageFormModal, setStageFormModal] = useState<{
    ticket: Ticket;
    targetStage: Stage;
    sourceStageName: string;
    formId: string;
    hasApprovers: boolean;
    existingRequest?: TicketStageRequest | null;
  } | null>(null);

  // Backward movement confirmation dialog state.
  const [showBackwardConfirmDialog, setShowBackwardConfirmDialog] = useState(false);
  const [backwardStageChange, setBackwardStageChange] = useState<{
    stageName: string;
    fromSequenceNumber: number;
    newStatus?: TicketStatusV2;
    ticketId: string;
  } | null>(null);

  // Handler for when a stage transition requires a form to be filled out.
  const handleStageFormRequired = useCallback(
    async (data: { ticket: Ticket; targetStage: Stage; formId: string; hasApprovers: boolean }) => {
      const sourceStage = stagesForDragDrop.find(s => s.name === data.ticket.stageName);
      const ticketRequests = await zero.run(
        queries.getTicketStageRequests({ ticketId: data.ticket.id }),
        { type: 'complete' },
      );
      const existingRequest = ticketRequests?.find(
        (r: TicketStageRequest) => r.stageId === data.targetStage.id,
      );
      setStageFormModal({
        ...data,
        sourceStageName: sourceStage?.name || data.ticket.stageName || '',
        existingRequest: existingRequest || null,
      });
    },
    [stagesForDragDrop, zero],
  );

  // Handler for backward stage movement — shows a confirmation dialog.
  const handleBackwardStageChange = useCallback(
    (data: {
      ticket: Ticket;
      stageName: string;
      fromSequenceNumber: number;
      newStatus?: TicketStatusV2;
    }) => {
      setBackwardStageChange({
        stageName: data.stageName,
        fromSequenceNumber: data.fromSequenceNumber,
        ...(data.newStatus !== undefined && { newStatus: data.newStatus }),
        ticketId: data.ticket.id,
      });
      setShowBackwardConfirmDialog(true);
    },
    [],
  );

  const { activeTicket, handleDragStart, handleDragEnd } = useDragAndDrop({
    localTickets,
    setLocalTickets,
    zero,
    stages: stagesForDragDrop,
    mode: 'stage',
    canReorder: false,
    onStageFormRequired: handleStageFormRequired,
    onBackwardStageChange: handleBackwardStageChange,
    stageFormMap,
  });

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor),
  );

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={event => void handleDragEnd(event)}
      >
        <KanbanColumns
          stages={stageColumns}
          ticketsByStage={ticketsByStage}
          onTicketClick={onTicketClick}
          containerClassName='h-full'
          slaPolicies={slaPolicies}
        />
        <DragOverlay>
          {activeTicket ? (
            <TicketCard
              ticket={activeTicket}
              isCompact={true}
              onClick={() => {}}
              data-track-category='Support'
              data-track-name='DragOverlayTicketClick'
              data-track-metadata={JSON.stringify({ ticketId: activeTicket?.id })}
              slaPolicies={slaPolicies}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Stage Form Modal — shown when a ticket is moved to a stage that has a form */}
      {stageFormModal && (
        <StageFormModal
          isOpen={!!stageFormModal}
          onClose={() => setStageFormModal(null)}
          ticket={stageFormModal.ticket}
          targetStage={stageFormModal.targetStage}
          sourceStageName={stageFormModal.sourceStageName}
          existingRequest={stageFormModal.existingRequest ?? null}
          formId={stageFormModal.formId}
          hasApprovers={stageFormModal.hasApprovers ?? false}
          onSuccess={() => setStageFormModal(null)}
        />
      )}

      {/* Backward stage movement confirmation dialog */}
      {backwardStageChange && (
        <Dialog
          open={showBackwardConfirmDialog}
          onOpenChange={setShowBackwardConfirmDialog}
          title='Confirm Stage Change'
        >
          <div className='p-6'>
            <p className='text-sm text-muted-foreground mb-6'>
              Moving to a previous stage will clear all status change requests for status after this
              one. These requests will need to be submitted again. Do you want to continue?
            </p>
            <div className='flex justify-end gap-3'>
              <Button
                variant='secondary'
                onClick={() => setShowBackwardConfirmDialog(false)}
                data-track-category='Support'
                data-track-name='CancelBackwardStageChange'
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (backwardStageChange) {
                    void zero.mutate(
                      mutators.cleanupStageApprovals({
                        ticketId: backwardStageChange.ticketId,
                        fromSequenceNumber: backwardStageChange.fromSequenceNumber,
                      }),
                    );
                    void zero.mutate(
                      mutators.ticket.update({
                        id: backwardStageChange.ticketId,
                        stageName: backwardStageChange.stageName,
                        updatedAt: Date.now(),
                      }),
                    );
                  }
                  setShowBackwardConfirmDialog(false);
                  setBackwardStageChange(null);
                }}
                data-track-category='Support'
                data-track-name='ConfirmBackwardStageChange'
              >
                Continue
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
};
