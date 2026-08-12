import { ReactElement, useState } from 'react';
import { ClockDefault, File02Default } from '@xyne/icons';
import { Popover } from '../../components/ui/Popover';
import { cn } from '../../utils/classNames';
import { APP_NO_DRAG_STYLE } from '../../utils/electronApp';
import type { DailyBriefHistoryItem } from '../../api/dailyBriefApi';

const HEADER_ICON_CLASS =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-muted-foreground ' +
  'transition-colors hover:bg-accent hover:text-foreground';

function briefMenuLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return `Morning Brief ${date}`;
  const day = parsed.getDate();
  const month = parsed.toLocaleDateString(undefined, { month: 'short' });
  return `Morning Brief ${day} ${month}`;
}

interface BriefHistoryMenuProps {
  history: DailyBriefHistoryItem[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
}

export function BriefHistoryMenu({
  history,
  selectedDate,
  onSelect,
}: BriefHistoryMenuProps): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side='bottom'
      align='end'
      sideOffset={8}
      collisionPadding={12}
      className='w-[232px] max-h-[320px] overflow-y-auto rounded-[12px] border-border bg-popover p-1.5 shadow-lg'
      trigger={
        <button
          type='button'
          aria-label='Brief history'
          style={APP_NO_DRAG_STYLE}
          data-track-category='DailyBrief'
          data-track-name='daily-brief-history-menu'
          className={cn(HEADER_ICON_CLASS, open && 'bg-accent text-foreground')}
        >
          <ClockDefault size={18} />
        </button>
      }
    >
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
                  onClick={() => {
                    onSelect(item.date);
                    setOpen(false);
                  }}
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
    </Popover>
  );
}
