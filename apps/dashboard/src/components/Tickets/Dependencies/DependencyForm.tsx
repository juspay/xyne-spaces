import { useEffect, useState } from 'react';
import { dependencyPolicy, type DependencyStrength } from '@xyne/shared';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import { searchService } from '../../../services/searchService';
import { dependencyApi } from '../../../services/dependencies/api';
import type { PublicDependencyEdge } from '../../../services/dependencies/types';
import { getSubTicketLinkErrorMessage } from '../../../services/subTicketService';
import { useDependencyData } from '../../../hooks/useDependencyState';

export function DependencyForm({
  ticketId,
  edge,
  onDone,
}: {
  ticketId: string;
  edge?: PublicDependencyEdge;
  onDone: () => void;
}) {
  const [otherId, setOtherId] = useState('');
  const [direction, setDirection] = useState<'BLOCKED_BY' | 'BLOCKS'>('BLOCKED_BY');
  const [strength, setStrength] = useState<DependencyStrength | null>(edge?.strength ?? null);
  const [gatedStageId, setGatedStageId] = useState(edge?.gatedStageId ?? '');
  const [satisfiedStageId, setSatisfiedStageId] = useState(edge?.satisfiedStageId ?? '');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<SelectorOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blockerId = edge?.blockerTicketId ?? (direction === 'BLOCKS' ? ticketId : otherId);
  const dependentId = edge?.dependentTicketId ?? (direction === 'BLOCKS' ? otherId : ticketId);
  const data = useDependencyData([ticketId, blockerId, dependentId]);
  const batches = [...new Set([ticketId, blockerId, dependentId])].flatMap(id => {
    const view = data.get(id);
    return view ? [view.batch] : [];
  });
  const tickets = batches.flatMap(batch => batch.tickets);
  const blocker = tickets.find(ticket => ticket.id === blockerId);
  const dependent = tickets.find(ticket => ticket.id === dependentId);
  const stages = [
    ...new Map(batches.flatMap(batch => batch.stages).map(stage => [stage.id, stage])).values(),
  ];
  const dependentBoard = batches
    .flatMap(batch => batch.boards)
    .find(board => board.id === dependent?.boardId);

  const selectedStrength = strength ?? dependencyPolicy(dependentBoard?.metadata).defaultStrength;
  const otherView = otherId ? data.get(otherId) : undefined;
  const selectionRevoked =
    !!otherView && !otherView.batch.tickets.some(ticket => ticket.id === otherId);
  useEffect(() => {
    if (!selectionRevoked) return;
    setOtherId('');
    setOptions([]);
    setSearch('');
    setError('The selected ticket is unavailable. Search for another ticket.');
  }, [selectionRevoked]);

  useEffect(() => {
    if (edge || search.trim().length < 2) {
      setOptions([]);
      setLoading(false);
      return;
    }
    let current = true;
    setOptions([]);
    setLoading(true);
    const timer = window.setTimeout(() => {
      void searchService
        .vespaSearch({
          query: search.trim(),
          type: 'tickets',
          apps: 'ticket',
          limit: 50,
          offset: 0,
        })
        .then(response => {
          if (!current) return;
          setOptions(
            response.results
              .filter(ticket => ticket.id !== ticketId)
              .map(ticket => ({
                value: ticket.id,
                label: ticket.title.replace(/<\/?hi>/gi, ''),
                subtitle: ticket.searchContext?.xyneId ?? null,
                icon: null,
              })),
          );
        })
        .catch(() => {
          if (current) setError('Ticket search is unavailable. Try again.');
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [edge, search, ticketId]);

  const save = async () => {
    if (busy || !blocker || !dependent || dependentBoard?.boardType === 'FLOW') return;
    setBusy(true);
    setError(null);
    const settings = {
      strength: selectedStrength,
      gatedStageId: gatedStageId || null,
      satisfiedStageId: satisfiedStageId || null,
    };
    try {
      if (edge?.kind === 'CHILD')
        await dependencyApi.updateChild(edge.id, settings, reason.trim() || undefined);
      else if (edge) await dependencyApi.update(edge.id, settings, reason.trim() || undefined);
      else await dependencyApi.create(blockerId, dependentId, settings);
      onDone();
    } catch (error) {
      setError(getSubTicketLinkErrorMessage(error, 'Could not save dependency'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className='space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-xs'
      onSubmit={event => {
        event.preventDefault();
        void save();
      }}
    >
      {!edge && (
        <>
          <label className='block space-y-1'>
            <span>Relationship</span>
            <select
              data-track-category='TICKET_DEPENDENCIES'
              data-track-name='DependencyAction'
              aria-label='Dependency direction'
              value={direction}
              onChange={event => {
                setDirection(event.target.value as typeof direction);
                setGatedStageId('');
                setSatisfiedStageId('');
              }}
              className='w-full rounded border border-border bg-background p-2'
            >
              <option value='BLOCKED_BY'>Blocked by</option>
              <option value='BLOCKS'>Blocks</option>
            </select>
          </label>
          <EntitySelector
            options={options}
            selectedValue={otherId || null}
            onSelect={id => {
              setOtherId(id ?? '');
              setGatedStageId('');
              setSatisfiedStageId('');
            }}
            placeholder='Choose another ticket'
            searchPlaceholder='Search by ID or title (2+ characters)'
            onSearchChange={setSearch}
            disableClientFiltering
            isLoading={loading}
            width='100%'
          />
        </>
      )}
      <div className='grid gap-3 sm:grid-cols-2'>
        <label className='space-y-1'>
          <span>{edge?.kind === 'CHILD' ? "Parent can't move past" : "Dependent can't enter"}</span>
          <select
            data-track-category='TICKET_DEPENDENCIES'
            data-track-name='DependencyAction'
            aria-label='Gated stage'
            value={gatedStageId}
            onChange={event => setGatedStageId(event.target.value)}
            className='w-full rounded border border-border bg-background p-2'
          >
            <option value=''>Terminal stages</option>
            {stages
              .filter(stage => stage.boardId === dependent?.boardId)
              .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
              .map(stage => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
          </select>
        </label>
        {edge?.kind !== 'CHILD' && (
          <label className='space-y-1'>
            <span>Satisfied when blocker reaches</span>
            <select
              data-track-category='TICKET_DEPENDENCIES'
              data-track-name='DependencyAction'
              aria-label='Satisfied-when stage'
              value={satisfiedStageId}
              onChange={event => setSatisfiedStageId(event.target.value)}
              className='w-full rounded border border-border bg-background p-2'
            >
              <option value=''>Completed stage</option>
              {stages
                .filter(stage => stage.boardId === blocker?.boardId)
                .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
                .map(stage => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      <label className='block space-y-1'>
        <span>Strength</span>
        <select
          data-track-category='TICKET_DEPENDENCIES'
          data-track-name='DependencyAction'
          aria-label='Dependency strength'
          value={selectedStrength}
          onChange={event => setStrength(event.target.value as DependencyStrength)}
          className='w-full rounded border border-border bg-background p-2'
        >
          <option value='SOFT'>Soft — proceeding requires a reason</option>
          <option value='HARD'>Hard — board administrator override only</option>
        </select>
      </label>
      <p className='text-muted-foreground'>
        Board policy can make a soft dependency hard. Children clear at completed or cancelled
        stages.
      </p>
      {edge && (
        <label className='block space-y-1'>
          <span>Reason (required to change a hard dependency)</span>
          {/* eslint-disable-next-line local-rules/require-tracking-on-click -- Private override reasons must not enter activity tracking. */}
          <textarea
            className='ph-no-capture w-full rounded border border-border bg-background p-2'
            value={reason}
            onChange={event => setReason(event.target.value)}
            maxLength={2000}
            rows={2}
          />
        </label>
      )}
      {dependentBoard?.boardType === 'FLOW' && (
        <p role='alert' className='text-destructive'>
          FLOW stages are managed by the flow engine.
        </p>
      )}
      {error && (
        <p role='alert' className='text-destructive'>
          {error}
        </p>
      )}
      <div className='flex justify-end gap-2'>
        <button
          data-track-category='TICKET_DEPENDENCIES'
          data-track-name='DependencyAction'
          type='button'
          disabled={busy}
          onClick={onDone}
          className='rounded px-3 py-1.5 hover:bg-muted'
        >
          Cancel
        </button>
        <button
          data-track-category='TICKET_DEPENDENCIES'
          data-track-name='DependencyAction'
          type='submit'
          disabled={busy || !blocker || !dependent || dependentBoard?.boardType === 'FLOW'}
          className='rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50'
        >
          {busy ? 'Saving…' : 'Save dependency'}
        </button>
      </div>
    </form>
  );
}
