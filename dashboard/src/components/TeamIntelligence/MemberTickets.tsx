import { ReactElement } from 'react';
import { CalendarClockIcon, TicketIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/utils/classNames';
import { Ticket } from '@/services/TeamIntelligence/teamIntelligenceService';

const formatDate = (value: string | null | undefined): string => {
  if (!value) return 'Not available';
  return format(new Date(value), 'MMM d, yyyy');
};

const statusPillClassName = (status: string): string =>
  cn(
    'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide',
    status === 'TODO' && 'bg-slate-500/10 text-slate-600',
    status === 'STARTED' && 'bg-blue-500/10 text-blue-600',
    status === 'IN_PROGRESS' && 'bg-blue-500/10 text-blue-600',
    status === 'PAUSED' && 'bg-amber-500/10 text-amber-700',
    status === 'COMPLETED' && 'bg-green-500/10 text-green-600',
    status === 'CANCELLED' && 'bg-rose-500/10 text-rose-600',
    !['TODO', 'STARTED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED'].includes(status) &&
      'bg-muted text-muted-foreground',
  );

const MemberTickets = ({ tickets }: { tickets: Ticket[] }): ReactElement => {
  return (
    <section className='space-y-4'>
      <div className='flex items-center gap-3'>
        <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-red-600/10'>
          <TicketIcon className='h-4 w-4 text-red-600' />
        </div>
        <div>
          <h3 className='text-lg font-semibold text-foreground'>Member Tickets</h3>
          <p className='text-xs text-muted-foreground'>
            {tickets.length} ticket{tickets.length === 1 ? '' : 's'} in the selected range
          </p>
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className='rounded-xl border border-border/50 bg-card p-5'>
          <p className='text-sm text-muted-foreground'>
            No tickets found for the selected date range.
          </p>
        </div>
      ) : (
        <div className='grid gap-4 grid-cols-1 md:grid-cols-2'>
          {tickets.map(ticket => (
            <article
              key={ticket.id}
              className='rounded-xl border bg-card p-5 shadow-sm h-full flex flex-col gap-2'
            >
              <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0 space-y-1'>
                  <h4 className='line-clamp-2 text-sm font-semibold text-foreground'>
                    {ticket.title}
                  </h4>
                  <p className='line-clamp-2 text-xs font-light text-muted-foreground'>
                    {ticket.description || 'No description provided.'}
                  </p>
                </div>

                <div className='flex flex-col items-end gap-1'>
                  <span className={statusPillClassName(ticket.statusV2)}>{ticket.statusV2}</span>
                </div>
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

export default MemberTickets;
