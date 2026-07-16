import { ReactElement } from 'react';
import { AlertTriangleIcon, CalendarClockIcon, Loader2 } from 'lucide-react';
import { useOutletContext, useParams } from 'react-router-dom';
import { useTeamTicketRecaps } from '@/hooks/useTeamIntelligence';
import { TeamIntelligenceOutletContext } from '@/routes/TeamIntelligenceScreen/TeamIntelligenceScreen';
import { cn } from '@/utils/classNames';
import { format } from 'date-fns';

const formatDate = (value: string | null | undefined): string => {
  if (!value) return 'Not available';

  return format(new Date(value), 'MMM d, yyyy');
};

const statusPillClassName = (status: string): string =>
  cn(
    'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide',
    status === 'TODO' && 'bg-slate-500/10 text-slate-600',
    status === 'STARTED' && 'bg-blue-500/10 text-blue-600',
    status === 'PAUSED' && 'bg-amber-500/10 text-amber-700',
    status === 'COMPLETED' && 'bg-green-500/10 text-green-600',
    status === 'CANCELLED' && 'bg-rose-500/10 text-rose-600',
    !['TODO', 'STARTED', 'PAUSED', 'COMPLETED', 'CANCELLED'].includes(status) &&
      'bg-muted text-muted-foreground',
  );

export const TeamOverdueTickets = (): ReactElement => {
  const { dateRange } = useOutletContext<TeamIntelligenceOutletContext>();
  const { teamId } = useParams<{ teamId: string }>();

  const { data, isLoading, error } = useTeamTicketRecaps(teamId!, {
    from: dateRange.from,
    to: dateRange.to,
    page: 1,
    limit: 1,
  });

  if (isLoading) {
    return (
      <section className='space-y-4'>
        <div className='flex items-center gap-3'>
          <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-red-600/10'>
            <AlertTriangleIcon className='h-4 w-4 text-red-600' />
          </div>
          <h3 className='text-lg font-semibold text-foreground'>Overdue Tickets</h3>
        </div>

        <div className='w-full rounded-xl border border-border/50 bg-card p-5 flex items-center justify-center gap-2'>
          <Loader2 size={16} className='animate-spin text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>Loading tickets...</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className='space-y-4'>
        <div className='flex items-center gap-3'>
          <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-red-600/10'>
            <AlertTriangleIcon className='h-4 w-4 text-red-600' />
          </div>
          <h3 className='text-lg font-semibold text-foreground'>Overdue Tickets</h3>
        </div>

        <div className='rounded-xl border border-border/50 bg-card p-5'>
          <p className='text-sm text-muted-foreground'>
            Oops! Something went wrong while fetching overdue tickets.
          </p>
        </div>
      </section>
    );
  }

  const overdueTickets = data?.overdueTickets ?? [];
  const overdueCount = data?.ticketMetrics?.overdueCount ?? overdueTickets.length;

  return (
    <section className='space-y-4'>
      <div className='flex items-center gap-3'>
        <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-red-600/10'>
          <AlertTriangleIcon className='h-4 w-4 text-red-600' />
        </div>
        <div>
          <h3 className='text-lg font-semibold text-foreground'>Overdue Tickets</h3>
          <p className='text-xs text-muted-foreground'>
            {overdueCount} overdue ticket{overdueCount === 1 ? '' : 's'} in the selected range
          </p>
        </div>
      </div>

      {overdueTickets.length === 0 ? (
        <div className='rounded-xl border border-border/50 bg-card p-5'>
          <p className='text-sm text-muted-foreground'>
            No overdue tickets found for the selected date range.
          </p>
        </div>
      ) : (
        <div className='grid gap-4 grid-cols-1 md:grid-cols-2'>
          {overdueTickets.map(ticket => (
            <article
              key={ticket.id}
              className='rounded-xl border bg-card p-5 shadow-sm h-full flex flex-col gap-2'
            >
              <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0 space-y-1'>
                  <h4 className='line-clamp-2 text-sm font-semibold text-foreground'>
                    {ticket.title}
                  </h4>
                  <h4 className='line-clamp-2 text-xs font-light text-muted-foreground'>
                    {ticket.description || 'No description provided.'}
                  </h4>
                </div>

                <span className={statusPillClassName(ticket.statusV2)}>{ticket.statusV2}</span>
              </div>

              <div className='w-full flex items-center gap-1 mt-auto'>
                <div className='flex items-center gap-2 text-xs font-medium text-muted-foreground'>
                  <CalendarClockIcon className='h-3.5 w-3.5' />

                  <p className='text-xs font-normal text-muted-foreground'>
                    {formatDate(ticket.eta ?? null)}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};

export default TeamOverdueTickets;
