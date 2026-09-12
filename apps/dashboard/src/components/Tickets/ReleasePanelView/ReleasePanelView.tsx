import { useNavigate, useLocation } from 'react-router-dom';
import { useReleaseForDevTicket } from '../../../hooks/useReleaseForDevTicket';
import { Rocket, SquareArrowOutUpRight, ArrowRight } from 'lucide-react';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

interface ReleasePanelViewProps {
  ticketId: string;
}

// Per-ticket "Release" tab: the release a dev ticket belongs to plus a jump to
// the full Release Detail screen. Mounted only when the ticket has ART rows.
export const ReleasePanelView = ({ ticketId }: ReleasePanelViewProps): React.ReactElement => {
  const navigate = useNavigate();
  const location = useLocation();

  const { releaseIds, primaryReleaseId, isHotfix } = useReleaseForDevTicket(ticketId);

  const [releaseTicket] = useCachedQuery(queries.ticketByIdV2({ ticketId: primaryReleaseId }), {
    enabled: !!primaryReleaseId,
  });
  const [events] = useCachedQuery(
    queries.releaseEventsByReleaseId({ releaseId: primaryReleaseId, limit: 20 }),
    { enabled: !!primaryReleaseId },
  );

  if (!primaryReleaseId) {
    return (
      <div className='flex flex-col items-center justify-center h-full gap-3 p-6 text-muted-foreground'>
        <Rocket className='h-12 w-12 text-muted' />
        <p className='text-sm font-medium text-foreground'>Not part of any release</p>
        <p className='text-xs'>This ticket hasn’t been picked up by a release yet.</p>
      </div>
    );
  }

  const openReleaseView = (): void => {
    if (!releaseTicket?.projectId) return;
    void navigate(`/listProjects/${releaseTicket.projectId}/releases/${primaryReleaseId}`, {
      state: { returnToUrl: location.pathname + location.search },
    });
  };

  return (
    <div className='flex flex-col h-full overflow-y-auto p-4 gap-4'>
      <div className='rounded-xl border border-border bg-background p-4'>
        <div className='flex items-center gap-2'>
          <span className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
            Release
          </span>
          {isHotfix && (
            <span className='rounded px-2 py-0.5 text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'>
              🔥 Hotfix
            </span>
          )}
        </div>
        <div className='mt-2 flex items-baseline gap-2'>
          <span className='font-mono text-sm text-primary'>{releaseTicket?.xyneId ?? '—'}</span>
          <span className='text-sm text-foreground'>
            {releaseTicket?.title ?? 'Release ticket'}
          </span>
        </div>
        {releaseTicket?.stageName && (
          <div className='mt-1 text-xs text-muted-foreground'>
            Status: {releaseTicket.stageName}
          </div>
        )}
        {releaseIds.length > 1 && (
          <div className='mt-1 text-xs text-muted-foreground'>
            Also part of {releaseIds.length - 1} other release{releaseIds.length > 2 ? 's' : ''}.
          </div>
        )}
      </div>

      <button
        type='button'
        onClick={openReleaseView}
        data-track-category='Tickets'
        data-track-name='OpenReleaseViewFromReleaseTab'
        data-testid='open-release-view-from-tab'
        className='group flex items-center justify-between gap-3 w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground shadow-sm hover:shadow-md hover:border-input transition-all'
      >
        <span className='inline-flex items-center gap-3'>
          <span className='flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground'>
            <SquareArrowOutUpRight size={18} />
          </span>
          <span className='flex flex-col text-left'>
            <span className='text-sm font-semibold text-foreground'>Open release view</span>
            <span className='text-xs text-muted-foreground'>
              Dev tickets, envs, migrations &amp; timeline for this release
            </span>
          </span>
        </span>
        <ArrowRight className='h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5' />
      </button>

      <div>
        <h3 className='text-sm font-semibold text-foreground'>Activity</h3>
        {(events ?? []).length === 0 ? (
          <p className='mt-2 text-xs text-muted-foreground'>No release activity yet.</p>
        ) : (
          <ul className='mt-2 flex flex-col gap-2'>
            {(events ?? []).map(ev => (
              <li key={ev.id} className='rounded-lg border border-border bg-background px-3 py-2'>
                <div className='text-sm text-foreground'>{ev.message || ev.eventName}</div>
                <div className='mt-0.5 text-xs text-muted-foreground'>
                  {ev.userName ? `${ev.userName} · ` : ''}
                  {new Date(ev.createdAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
