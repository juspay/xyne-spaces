import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Ticket } from '@xyne/shared';
import { Bug, GitPullRequest, Loader2, MessageCircle, Plus, Search, X } from 'lucide-react';
import { TicketCard } from '../../components/Tickets/TicketCard/TicketCard';
import { TicketDetails } from '../../components/Tickets/TicketDetails/TicketDetails';
import { KanbanIcon } from '../../components/Tickets/KanbanColumns/KanbanColumns';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { useDragAndDrop } from '../../hooks/useDragAndDrop';
import { useZero } from '../../hooks/useZero';
import type { Stage } from '../KanbanBoardScreen/KanbanBoardScreen.types';
import { groupTicketsByStage } from '../KanbanBoardScreen/KanbanBoardScreen.utils';
import {
  filterTickets,
  latestTicketExecution,
  latestTicketPullRequest,
  ticketAction,
  ticketDebugContext,
  type SdlcTicket,
  type TicketAction,
  type TicketExecution,
} from './ticketPolicy';

type SdlcLink = {
  sourceId: string;
  targetId: string;
  relationType: string;
};

type SdlcCanvas = {
  id: string;
  title: string;
  metadata?: unknown;
};

interface SdlcTicketsBoardProps {
  repoId: string;
  boardId: string;
  channelId: string;
  tickets: readonly SdlcTicket[];
  initialTicketId?: string | null;
  stages: readonly Stage[];
  links: readonly SdlcLink[];
  canvases: readonly SdlcCanvas[];
  busyKey: string | null;
  actionsDisabled: boolean;
  onNewTicket: () => void;
  onStartWork: (ticketId: string) => void;
  onDebugRun: (execution: TicketExecution) => void;
  onOpenCanvas: (canvasId: string) => void;
  onOpenConversations: (ticketId: string) => void;
}

function actionLabel(action: TicketAction): string {
  switch (action) {
    case 'RUNNING':
      return 'Running';
    case 'RETRY':
      return 'Retry work';
    case 'OPEN_PR':
      return 'Open PR';
    case 'LOCKED':
      return 'Workflow complete';
    default:
      return 'Start work';
  }
}

function TicketActionButton({
  ticket,
  busy,
  compact = false,
  onStartWork,
  onDebugRun,
  actionsDisabled = false,
}: {
  ticket: SdlcTicket;
  busy: boolean;
  compact?: boolean;
  onStartWork: (ticketId: string) => void;
  onDebugRun: (execution: TicketExecution) => void;
  actionsDisabled?: boolean;
}): ReactElement {
  const action = ticketAction(ticket);
  const pullRequest = latestTicketPullRequest(ticket);
  const execution = latestTicketExecution(ticket);
  const compactDebug = compact && action === 'RUNNING' && Boolean(ticketDebugContext(execution));
  const disabled =
    (action === 'RUNNING' && !compactDebug) ||
    action === 'LOCKED' ||
    busy ||
    (actionsDisabled && (action === 'START' || action === 'RETRY'));

  const activate = (): void => {
    if (compactDebug && execution) {
      onDebugRun(execution);
      return;
    }
    if (action === 'OPEN_PR' && pullRequest?.prUrl) {
      window.open(pullRequest.prUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action === 'START' || action === 'RETRY') onStartWork(ticket.id);
  };

  return (
    <Button
      size='sm'
      variant={action === 'OPEN_PR' || compactDebug ? 'outline' : 'default'}
      disabled={disabled}
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        activate();
      }}
      className={compact ? 'h-7 w-full text-xs' : undefined}
      data-track-category='SdlcHub'
      data-track-name='TicketAction'
      data-track-metadata={JSON.stringify({
        ticketId: ticket.id,
        action: compactDebug ? 'DEBUG' : action,
      })}
    >
      {busy || (action === 'RUNNING' && !compactDebug) ? (
        <Loader2 className='animate-spin' />
      ) : compactDebug ? (
        <Bug />
      ) : action === 'OPEN_PR' ? (
        <GitPullRequest />
      ) : null}
      {compactDebug ? 'Debug' : actionLabel(action)}
    </Button>
  );
}

function SortableTicketCard({
  ticket,
  busy,
  onOpen,
  onStartWork,
  onDebugRun,
  actionsDisabled,
}: {
  ticket: SdlcTicket;
  busy: boolean;
  onOpen: () => void;
  onStartWork: (ticketId: string) => void;
  onDebugRun: (execution: TicketExecution) => void;
  actionsDisabled: boolean;
}): ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
    data: { ticket },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
      }}
      {...attributes}
      {...listeners}
      className='space-y-1.5'
    >
      <TicketCard ticket={ticket} isCompact onClick={onOpen} />
      <TicketActionButton
        ticket={ticket}
        busy={busy}
        compact
        onStartWork={onStartWork}
        onDebugRun={onDebugRun}
        actionsDisabled={actionsDisabled}
      />
    </div>
  );
}

function TicketColumn({
  stage,
  tickets,
  busyKey,
  onOpen,
  onStartWork,
  onDebugRun,
  actionsDisabled,
}: {
  stage: Stage;
  tickets: readonly SdlcTicket[];
  busyKey: string | null;
  onOpen: (ticketId: string) => void;
  onStartWork: (ticketId: string) => void;
  onDebugRun: (execution: TicketExecution) => void;
  actionsDisabled: boolean;
}): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section
      ref={setNodeRef}
      className={`flex min-h-[28rem] w-72 shrink-0 flex-col rounded-xl border bg-muted/50 transition-colors xl:w-80 ${isOver ? 'border-primary/50 bg-primary/5' : ''}`}
      aria-label={`${stage.name} Tickets`}
    >
      <header className='flex items-center gap-2 border-b px-4 py-3'>
        <KanbanIcon status={stage.defaultTicketStatusV2} />
        <h3 className='min-w-0 flex-1 truncate text-xs font-semibold uppercase'>{stage.name}</h3>
        <span className='rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground'>
          {tickets.length}
        </span>
      </header>
      <SortableContext
        items={tickets.map(ticket => ticket.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className='flex-1 space-y-3 overflow-y-auto p-3'>
          {tickets.map(ticket => (
            <SortableTicketCard
              key={ticket.id}
              ticket={ticket}
              busy={busyKey === `work-${ticket.id}`}
              onOpen={() => onOpen(ticket.id)}
              onStartWork={onStartWork}
              onDebugRun={onDebugRun}
              actionsDisabled={actionsDisabled}
            />
          ))}
          {tickets.length === 0 ? (
            <div className='rounded-lg border border-dashed bg-background/60 p-5 text-center text-xs text-muted-foreground'>
              No Tickets
            </div>
          ) : null}
        </div>
      </SortableContext>
    </section>
  );
}

function ContextRow({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className='flex min-w-0 items-center gap-3 text-sm'>
      <span className='w-24 shrink-0 text-muted-foreground'>{label}</span>
      <div className='min-w-0 flex-1'>{children}</div>
    </div>
  );
}

export function SdlcTicketsBoard({
  repoId,
  boardId,
  channelId,
  tickets,
  initialTicketId = null,
  stages,
  links,
  canvases,
  busyKey,
  actionsDisabled,
  onNewTicket,
  onStartWork,
  onDebugRun,
  onOpenCanvas,
  onOpenConversations,
}: SdlcTicketsBoardProps): ReactElement {
  const zero = useZero();
  const [search, setSearch] = useState('');
  const scopedTickets = useMemo(
    () => filterTickets(tickets, { repoId, boardId, channelId, search: '' }),
    [boardId, channelId, repoId, tickets],
  );
  const visibleTicketIds = useMemo(
    () =>
      new Set(
        filterTickets(scopedTickets, { repoId, boardId, channelId, search }).map(
          ticket => ticket.id,
        ),
      ),
    [boardId, channelId, repoId, scopedTickets, search],
  );
  const [localTickets, setLocalTickets] = useState<Ticket[]>(() => [...scopedTickets]);
  useEffect(() => {
    setLocalTickets([...scopedTickets]);
  }, [scopedTickets]);

  const sortedStages = useMemo(
    () =>
      [...stages].sort((left, right) => (left.sequenceNumber ?? 0) - (right.sequenceNumber ?? 0)),
    [stages],
  );
  const ticketById = useMemo(
    () => new Map(scopedTickets.map(ticket => [ticket.id, ticket])),
    [scopedTickets],
  );
  const groupedTickets = useMemo(() => {
    const grouped = groupTicketsByStage(
      localTickets.filter(ticket => visibleTicketIds.has(ticket.id)),
      sortedStages,
      true,
    );
    return Object.fromEntries(
      Object.entries(grouped).map(([stageId, rows]) => [
        stageId,
        rows.flatMap(row => {
          const ticket = ticketById.get(row.id);
          return ticket ? [ticket] : [];
        }),
      ]),
    );
  }, [localTickets, sortedStages, visibleTicketIds, ticketById]);

  const { activeTicket, handleDragStart, handleDragEnd } = useDragAndDrop({
    localTickets,
    setLocalTickets,
    zero,
    stages: sortedStages,
    mode: 'stage',
    canReorder: true,
    allowCrossColumnMove: false,
  });
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const selectedTicket = selectedTicketId ? ticketById.get(selectedTicketId) : undefined;
  useEffect(() => {
    if (initialTicketId && ticketById.has(initialTicketId)) setSelectedTicketId(initialTicketId);
  }, [initialTicketId, ticketById]);
  const sourceLink = selectedTicket
    ? links.find(link => link.relationType === 'TICKET' && link.targetId === selectedTicket.id)
    : undefined;
  const sourceCanvas = sourceLink
    ? canvases.find(canvas => canvas.id === sourceLink.sourceId)
    : undefined;
  const selectedExecution = selectedTicket ? latestTicketExecution(selectedTicket) : null;
  const selectedDebugContext = ticketDebugContext(selectedExecution);
  const selectedPullRequest = selectedTicket ? latestTicketPullRequest(selectedTicket) : null;
  const selectedPullRequestUrl = selectedPullRequest?.prUrl ?? null;

  return (
    <>
      <section className='flex h-full min-h-0 flex-col'>
        <div className='flex flex-wrap items-center justify-between gap-3 pb-4'>
          <div>
            <h2 className='text-lg font-semibold'>Tickets</h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              Repository tickets whose stages are controlled by coding and pull-request workflows.
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <label className='relative'>
              <Search className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder='Search Tickets'
                className='h-9 w-64 rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring'
                data-track-category='SdlcHub'
                data-track-name='SearchTickets'
              />
            </label>
            <Button disabled={actionsDisabled} onClick={onNewTicket}>
              <Plus />
              New Ticket
            </Button>
          </div>
        </div>

        {sortedStages.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={event => void handleDragEnd(event)}
          >
            <div className='flex min-h-0 flex-1 gap-4 overflow-x-auto pb-3'>
              {sortedStages.map(stage => (
                <TicketColumn
                  key={stage.id}
                  stage={stage}
                  tickets={groupedTickets[stage.id] ?? []}
                  busyKey={busyKey}
                  onOpen={setSelectedTicketId}
                  onStartWork={onStartWork}
                  onDebugRun={onDebugRun}
                  actionsDisabled={actionsDisabled}
                />
              ))}
            </div>
            <DragOverlay>
              {activeTicket ? (
                <div className='w-72 opacity-90'>
                  <TicketCard ticket={activeTicket} isCompact />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          <div className='rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground'>
            The project SDLC board has no stages configured.
          </div>
        )}
      </section>

      <Dialog
        open={Boolean(selectedTicket)}
        onOpenChange={open => {
          if (!open) setSelectedTicketId(null);
        }}
        title={selectedTicket ? `${selectedTicket.xyneId} ${selectedTicket.title}` : 'Ticket'}
        className='flex h-[90vh] max-w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-6xl'
        mobileVariant='dialog'
      >
        {selectedTicket ? (
          <>
            <div className='flex items-start justify-between gap-4 border-b p-5'>
              <div className='min-w-0'>
                <div className='text-xs font-semibold text-primary'>{selectedTicket.xyneId}</div>
                <h2 className='mt-1 truncate text-lg font-semibold'>{selectedTicket.title}</h2>
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                {sourceCanvas ? (
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      setSelectedTicketId(null);
                      onOpenConversations(selectedTicket.id);
                    }}
                    data-track-category='SdlcHub'
                    data-track-name='OpenTicketConversations'
                  >
                    <MessageCircle />
                    Conversations
                  </Button>
                ) : null}
                <button
                  type='button'
                  onClick={() => setSelectedTicketId(null)}
                  className='rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground'
                  aria-label='Close Ticket details'
                  data-track-category='SdlcHub'
                  data-track-name='CloseTicketDetails'
                >
                  <X />
                </button>
              </div>
            </div>
            <div className='space-y-2 border-b bg-muted/30 px-5 py-4'>
              <ContextRow label='Source'>
                {sourceCanvas ? (
                  <button
                    type='button'
                    className='truncate font-medium text-primary hover:underline'
                    data-track-category='SdlcHub'
                    data-track-name='OpenTicketSource'
                    onClick={() => {
                      setSelectedTicketId(null);
                      onOpenCanvas(sourceCanvas.id);
                    }}
                  >
                    {sourceCanvas.title}
                  </button>
                ) : (
                  <span className='text-muted-foreground'>Standalone Ticket</span>
                )}
              </ContextRow>
              <ContextRow label='Execution'>
                <span className='font-medium'>{selectedExecution?.status ?? 'Not started'}</span>
              </ContextRow>
              <ContextRow label='Pull request'>
                {selectedPullRequestUrl ? (
                  <button
                    type='button'
                    className='inline-flex items-center gap-1 font-medium text-primary hover:underline'
                    data-track-category='SdlcHub'
                    data-track-name='OpenTicketPullRequest'
                    onClick={() =>
                      window.open(selectedPullRequestUrl, '_blank', 'noopener,noreferrer')
                    }
                  >
                    <GitPullRequest className='size-4' />
                    {selectedPullRequest?.prId
                      ? `#${selectedPullRequest.prId}`
                      : 'Open pull request'}
                    {selectedPullRequest?.status ? ` · ${selectedPullRequest.status}` : ''}
                  </button>
                ) : (
                  <span className='text-muted-foreground'>Not created</span>
                )}
              </ContextRow>
            </div>
            <div className='min-h-0 flex-1 overflow-y-auto'>
              <TicketDetails ticketId={selectedTicket.id} stageReadOnly />
            </div>
            <div className='flex justify-between gap-2 border-t p-4'>
              {selectedExecution && selectedDebugContext ? (
                <Button
                  variant='outline'
                  onClick={() => onDebugRun(selectedExecution)}
                  data-track-category='SdlcHub'
                  data-track-name='DebugTicketRun'
                >
                  <Bug />
                  Debug run
                </Button>
              ) : (
                <div />
              )}
              <TicketActionButton
                ticket={selectedTicket}
                busy={busyKey === `work-${selectedTicket.id}`}
                onStartWork={onStartWork}
                onDebugRun={onDebugRun}
                actionsDisabled={actionsDisabled}
              />
            </div>
          </>
        ) : null}
      </Dialog>
    </>
  );
}
