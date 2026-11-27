import { useState } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { useDependencyData, useTicketDependenciesEnabled } from '../../../hooks/useDependencyState';
import { dependencyApi, invalidateDependencies } from '../../../services/dependencies/api';
import { getSubTicketLinkErrorMessage } from '../../../services/subTicketService';
import type { PublicDependencyEdge } from '../../../services/dependencies/types';
import type { DependencyPanelProps } from './Dependencies.types';
import { dependencyOtherLabel, dependencyOtherTicket } from './Dependencies.utils';
import { DependencyForm } from './DependencyForm';

export function DependencyPanel(props: Omit<DependencyPanelProps, 'ticketOptions'>) {
  const { user } = useAuth();
  const enabled = useTicketDependenciesEnabled();
  if (!enabled || !user) return null;
  return (
    <DependencyPanelContent
      key={JSON.stringify([user.workspaceId, user.id, props.ticketId])}
      {...props}
    />
  );
}

function DependencyPanelContent({
  ticketId,
  linkedTicketIds = [],
  onOpen,
}: Omit<DependencyPanelProps, 'ticketOptions'>) {
  const enabled = useTicketDependenciesEnabled();
  const view = useDependencyData([ticketId]).get(ticketId);
  const [editing, setEditing] = useState<PublicDependencyEdge | 'new' | null>(null);
  const [confirm, setConfirm] = useState<{
    edge: PublicDependencyEdge;
    action: 'remove' | 'satisfy';
  } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!enabled) return null;
  const batch = view?.batch;
  const edges =
    batch?.edges.filter(
      edge => edge.blockerTicketId === ticketId || edge.dependentTicketId === ticketId,
    ) ?? [];
  const act = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    setError(null);
    try {
      await dependencyApi[confirm.action](confirm.edge.id, reason.trim() || undefined);
      setConfirm(null);
      setReason('');
    } catch (error) {
      setError(getSubTicketLinkErrorMessage(error, 'Could not change dependency'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label='Dependencies' className='mb-3 space-y-2' data-testid='ticket-dependencies'>
      <div className='flex items-center justify-between'>
        <h3 className='text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
          Dependencies
        </h3>
        <button
          data-track-category='TICKET_DEPENDENCIES'
          data-track-name='DependencyAction'
          type='button'
          className='rounded px-2 py-1 text-xs hover:bg-muted'
          onClick={() => {
            setEditing('new');
            setConfirm(null);
            setError(null);
          }}
        >
          + Add dependency
        </button>
      </div>
      {(view?.error || error) && (
        <p role='alert' className='text-xs text-destructive'>
          {error ?? view?.error}{' '}
          <button
            data-track-category='TICKET_DEPENDENCIES'
            data-track-name='DependencyAction'
            type='button'
            className='underline'
            onClick={invalidateDependencies}
          >
            Refresh
          </button>
        </p>
      )}
      {!view && <p className='text-xs text-muted-foreground'>Loading dependencies…</p>}
      {batch &&
        (
          [
            ['Waiting on', true],
            ['Waiting on this', false],
          ] as const
        ).map(([label, incoming]) => {
          const group = edges.filter(edge => (edge.dependentTicketId === ticketId) === incoming);
          if (!group.length) return null;
          return (
            <div key={String(label)} className='space-y-1'>
              <h4 className='text-xs text-muted-foreground'>{label}</h4>
              {group.map(edge => {
                const other = dependencyOtherTicket(ticketId, edge, batch);
                const stage = edge.restricted
                  ? undefined
                  : batch.stages.find(stage => stage.id === edge.gatedStageId);
                const satisfiedStage = edge.restricted
                  ? undefined
                  : batch.stages.find(stage => stage.id === edge.satisfiedStageId);
                return (
                  <div
                    key={`${edge.kind}:${edge.id}`}
                    className='rounded-lg border border-border p-2 text-xs'
                  >
                    <div className='flex items-start justify-between gap-2'>
                      {other && onOpen ? (
                        <button
                          data-track-category='TICKET_DEPENDENCIES'
                          data-track-name='DependencyAction'
                          type='button'
                          className='text-left font-medium hover:underline'
                          onClick={() => onOpen(other.id)}
                        >
                          {dependencyOtherLabel(ticketId, edge, batch)}
                        </button>
                      ) : (
                        <span>{dependencyOtherLabel(ticketId, edge, batch)}</span>
                      )}
                      {other && linkedTicketIds.includes(other.id) && (
                        <span className='shrink-0 text-muted-foreground'>Also linked</span>
                      )}
                    </div>
                    <p className='mt-1 text-muted-foreground'>
                      {edge.kind === 'CHILD' ? 'Child' : 'Blocks'} · Configured{' '}
                      {edge.strength.toLowerCase()} · Gates {stage?.name ?? 'terminal stages'} ·
                      Clears at{' '}
                      {satisfiedStage?.name ??
                        (edge.kind === 'CHILD' ? 'any terminal stage' : 'completed stage')}
                      {edge.satisfiedAt
                        ? ' · Satisfied'
                        : edge.reviewNeededAt
                          ? ' · Needs review'
                          : ''}
                    </p>
                    {!edge.restricted && (
                      <div className='mt-1 flex flex-wrap gap-3'>
                        <button
                          data-track-category='TICKET_DEPENDENCIES'
                          data-track-name='DependencyAction'
                          type='button'
                          className='hover:underline'
                          onClick={() => {
                            setEditing(edge);
                            setConfirm(null);
                            setError(null);
                          }}
                        >
                          Edit gating
                        </button>
                        {edge.kind === 'BLOCKS' && (
                          <button
                            data-track-category='TICKET_DEPENDENCIES'
                            data-track-name='DependencyAction'
                            type='button'
                            className='text-destructive hover:underline'
                            onClick={() => {
                              setConfirm({ edge, action: 'remove' });
                              setEditing(null);
                              setReason('');
                              setError(null);
                            }}
                          >
                            Remove dependency
                          </button>
                        )}
                        {edge.kind === 'BLOCKS' && edge.reviewNeededAt && !edge.satisfiedAt && (
                          <button
                            data-track-category='TICKET_DEPENDENCIES'
                            data-track-name='DependencyAction'
                            type='button'
                            className='hover:underline'
                            onClick={() => {
                              setConfirm({ edge, action: 'satisfy' });
                              setEditing(null);
                              setReason('');
                              setError(null);
                            }}
                          >
                            Mark as satisfied
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      {view && !view.error && !edges.length && (
        <p className='text-xs text-muted-foreground'>No dependencies.</p>
      )}
      {editing && (
        <DependencyForm
          key={editing === 'new' ? 'new' : editing.id}
          ticketId={ticketId}
          {...(editing === 'new' ? {} : { edge: editing })}
          onDone={() => setEditing(null)}
        />
      )}
      {confirm && (
        <form
          className='space-y-2 rounded-lg border border-border p-3 text-xs'
          onSubmit={event => {
            event.preventDefault();
            void act();
          }}
        >
          <p>
            {confirm.action === 'remove'
              ? 'Remove this dependency? The linked ticket will not be deleted.'
              : 'Mark this dependency as satisfied? This cannot be undone by reopening the blocker.'}
          </p>
          <label className='block'>
            Reason (required for a hard dependency)
            {/* eslint-disable-next-line local-rules/require-tracking-on-click -- Private override reasons must not enter activity tracking. */}
            <textarea
              maxLength={2000}
              value={reason}
              onChange={event => setReason(event.target.value)}
              className='ph-no-capture mt-1 w-full rounded border border-border bg-background p-2'
            />
          </label>
          <p className='text-muted-foreground'>
            Hard changes require a board administrator. Permissions are checked when you confirm.
          </p>
          <div className='flex justify-end gap-3'>
            <button
              data-track-category='TICKET_DEPENDENCIES'
              data-track-name='DependencyAction'
              type='button'
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              Cancel
            </button>
            <button
              data-track-category='TICKET_DEPENDENCIES'
              data-track-name='DependencyAction'
              type='submit'
              disabled={busy}
              className='rounded bg-primary px-3 py-1.5 text-primary-foreground'
            >
              {busy ? 'Saving…' : 'Confirm'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
