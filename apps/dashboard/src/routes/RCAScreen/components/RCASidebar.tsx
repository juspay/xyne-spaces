import { ClipboardCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { cn } from '../../../utils/classNames';
import type { RCASidebarProps } from '../RCAScreen.types';
import { RCAStatus } from '@xyne/shared';
import { formatRcaValue } from '../rcaCacConfig';

export const RCASidebar = ({
  records,
  ownerItems,
  isLoading,
  isSubmitting,
  onRecordClick,
  hasNextPage,
  hasPreviousPage,
  onNextPage,
  onPreviousPage,
}: RCASidebarProps) => {
  return (
    <aside className='h-full w-full bg-background flex flex-col border border-border rounded-xl shadow-sm overflow-hidden'>
      <div className='p-5 border-b border-border flex items-center justify-between bg-background'>
        <div className='flex items-center gap-2'>
          <ClipboardCheck className='h-4 w-4 text-slate-700' />
          <div>
            <p className='text-sm font-semibold text-slate-900'>RCA Records</p>
          </div>
        </div>
      </div>

      <div className='flex-1 overflow-y-auto' data-id='rca-list'>
        {isLoading && (
          <div className='flex items-center justify-center h-full text-muted-foreground text-sm py-10'>
            Loading RCAs...
          </div>
        )}

        {!isLoading && records?.length === 0 && (
          <div className='flex flex-col items-center justify-center h-full text-muted-foreground text-sm py-10'>
            <ClipboardCheck className='h-8 w-8 text-muted mb-2' />
            No RCAs yet.
          </div>
        )}

        {!isLoading && records?.length > 0 && (
          <div className='hidden md:grid grid-cols-12 gap-3 px-4 py-2 border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted'>
            <p className='col-span-2'>Ticket</p>
            <p className='col-span-2'>Bug Type</p>
            <p className='col-span-2'>Owner</p>
            <p className='col-span-5'>Title</p>
            <p className='col-span-1'>Status</p>
          </div>
        )}

        {records?.map(record => {
          const ticketCode = record.ticket?.xyneId;
          const ticketTitle = record.ticket?.title || 'Ticket details unavailable';
          const ownerLabel =
            ownerItems.find(o => o.value === record.ownerId)?.label ?? record.ownerId;
          const bugTypeLabel = record.bugTypeId ? formatRcaValue(record.bugTypeId) : '-';

          return (
            <button
              key={record.id}
              type='button'
              onClick={() => onRecordClick(record)}
              data-track-category='RCA'
              data-track-name='SelectRCARecord'
              className={cn(
                'w-full text-left border-b border-border px-4 py-3 transition-colors',
                'bg-background hover:bg-muted',
              )}
            >
              <div className='md:hidden space-y-2'>
                <div className='min-w-0'>
                  <p className='text-[11px] font-medium text-slate-500 uppercase tracking-normal truncate'>
                    {ticketCode}
                  </p>
                  <p className='mt-1 text-sm font-medium text-slate-700 line-clamp-1'>
                    {ticketTitle}
                  </p>
                </div>
                <p className='text-xs text-slate-600 line-clamp-1'>Owner: {ownerLabel}</p>
                <p className='text-xs text-slate-600 line-clamp-1'>Bug Type: {bugTypeLabel}</p>
                <p className='text-xs text-slate-600 line-clamp-2 break-words'>
                  {record.title ?? 'Untitled RCA'}
                </p>
                <div className='grid grid-cols-1 gap-2'>
                  <div>
                    <p className='text-[10px] text-muted-foreground uppercase'>Status</p>
                    <Badge
                      variant={record.status === RCAStatus.DRAFT ? 'secondary' : 'success'}
                      className='text-[10px] leading-4 mt-1'
                    >
                      {record.status}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className='hidden md:grid md:grid-cols-12 md:gap-3 md:items-center'>
                <div className='col-span-2 min-w-0'>
                  <p className='text-[11px] font-medium text-slate-500 uppercase tracking-normal truncate'>
                    {ticketCode}
                  </p>
                  <p className='mt-1 text-sm font-medium text-slate-700 line-clamp-1'>
                    {ticketTitle}
                  </p>
                </div>

                <p className='col-span-2 text-xs text-slate-600 line-clamp-1'>{bugTypeLabel}</p>

                <p className='col-span-2 text-xs text-slate-600 line-clamp-1'>{ownerLabel}</p>

                <p className='col-span-5 text-xs text-slate-600 line-clamp-2 break-words'>
                  {record.title ?? 'Untitled RCA'}
                </p>

                <div className='col-span-1'>
                  <Badge
                    variant={record.status === RCAStatus.DRAFT ? 'secondary' : 'success'}
                    className='text-[10px] leading-4'
                  >
                    {record.status}
                  </Badge>
                </div>
              </div>
            </button>
          );
        })}

        {/* Pagination Controls - only show if there's more than one page or we're not on page 1 */}
        {!isLoading && (hasPreviousPage || hasNextPage) && (
          <div className='flex items-center justify-between px-4 py-3 border-t border-border bg-muted'>
            <Button
              variant='outline'
              size='sm'
              onClick={onPreviousPage}
              data-track-category='RCA'
              data-track-name='RCA_PREV_PAGE'
              disabled={!hasPreviousPage || isSubmitting}
              className='gap-1'
            >
              <ChevronLeft className='h-4 w-4' />
              Prev
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={onNextPage}
              data-track-category='RCA'
              data-track-name='RCA_NEXT_PAGE'
              disabled={!hasNextPage || isSubmitting}
              className='gap-1'
            >
              Next
              <ChevronRight className='h-4 w-4' />
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
};
