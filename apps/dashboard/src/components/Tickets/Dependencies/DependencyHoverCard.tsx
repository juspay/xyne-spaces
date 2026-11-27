import type { DependencyHoverCardProps } from './Dependencies.types';
import { dependencyOtherLabel, dependencyOtherTicket } from './Dependencies.utils';

export function DependencyHoverCard({ ticketId, batch, onOpen }: DependencyHoverCardProps) {
  const groups = [
    [
      'Waiting on',
      batch.edges.filter(edge => edge.dependentTicketId === ticketId && edge.satisfiedAt === null),
    ],
    [
      'Waiting on this',
      batch.edges.filter(edge => edge.blockerTicketId === ticketId && edge.satisfiedAt === null),
    ],
  ] as const;
  return (
    <div className='space-y-3 text-xs'>
      {groups.map(
        ([title, edges]) =>
          edges.length > 0 && (
            <section key={title}>
              <h4 className='mb-1 font-medium text-foreground'>{title}</h4>
              <ul className='space-y-2'>
                {edges.map(edge => {
                  const other = dependencyOtherTicket(ticketId, edge, batch);
                  const stageId =
                    edge.dependentTicketId === ticketId ? edge.satisfiedStageId : edge.gatedStageId;
                  const stage = edge.restricted
                    ? undefined
                    : batch.stages.find(stage => stage.id === stageId);
                  return (
                    <li key={`${edge.kind}:${edge.id}`}>
                      {other && onOpen ? (
                        <button
                          data-track-category='TICKET_DEPENDENCIES'
                          data-track-name='DependencyAction'
                          type='button'
                          className='text-left underline underline-offset-2'
                          onClick={() => onOpen(other.id)}
                        >
                          {dependencyOtherLabel(ticketId, edge, batch)}
                        </button>
                      ) : (
                        <span>{dependencyOtherLabel(ticketId, edge, batch)}</span>
                      )}
                      {other && (
                        <div className='text-muted-foreground'>
                          {other.stageName}
                          {other.eta ? ` · ETA ${new Date(other.eta).toLocaleDateString()}` : ''}
                        </div>
                      )}
                      <div className='text-muted-foreground'>
                        Needs{' '}
                        {stage?.name ??
                          (edge.dependentTicketId === ticketId && edge.kind === 'BLOCKS'
                            ? 'completed stage'
                            : 'terminal stage')}{' '}
                        · Configured {edge.strength.toLowerCase()}
                        {edge.reviewNeededAt ? ' · Needs review' : ''}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ),
      )}
      {!groups.some(([, edges]) => edges.length) && (
        <p className='text-muted-foreground'>No outstanding dependencies.</p>
      )}
    </div>
  );
}
