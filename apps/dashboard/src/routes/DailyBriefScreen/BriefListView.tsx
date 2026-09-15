import { ReactElement } from 'react';
import { CalendarFilled, ChevronBigRight, File02Default } from '@xyne/icons';
import { cn } from '../../utils/classNames';
import type { DailyBriefHistoryItem } from '../../api/dailyBriefApi';

function briefMenuLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return `Morning Brief ${date}`;
  const day = parsed.getDate();
  const month = parsed.toLocaleDateString(undefined, { month: 'short' });
  return `Morning Brief ${day} ${month}`;
}

interface BriefListViewProps {
  history: DailyBriefHistoryItem[];
  selectedDate: string | null;
  onSelect: (date: string, source: 'history_menu' | 'date_picker') => void;
  onBrowseDates: () => void;
}

export function BriefListView({
  history,
  selectedDate,
  onSelect,
  onBrowseDates,
}: BriefListViewProps): ReactElement {
  return (
    <div className='flex flex-col'>
      {history.length === 0 ? (
        <div className='px-2.5 py-2 text-[13px] text-muted-foreground'>No past briefs.</div>
      ) : (
        <ul className='flex flex-col gap-px'>
          {history.map(item => {
            const isActive = selectedDate === item.date;
            return (
              <li key={item.date}>
                <button
                  type='button'
                  onClick={() => onSelect(item.date, 'history_menu')}
                  data-track-category='DailyBrief'
                  data-track-name='daily-brief-history-item'
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left',
                    'text-[14px] tracking-[-0.1px] transition-colors',
                    isActive
                      ? 'bg-accent font-medium text-foreground'
                      : 'font-normal text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <File02Default size={16} className='shrink-0 text-muted-foreground' />
                  <span className='truncate'>{briefMenuLabel(item.date)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className='mt-1 border-t border-border pt-1'>
        <button
          type='button'
          onClick={onBrowseDates}
          data-track-category='DailyBrief'
          data-track-name='daily-brief-browse-by-date'
          className='flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[14px] font-normal tracking-[-0.1px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
        >
          <CalendarFilled size={16} className='shrink-0' />
          <span className='flex-1 truncate'>Find a Brief</span>
          <ChevronBigRight size={14} className='shrink-0' />
        </button>
      </div>
    </div>
  );
}
