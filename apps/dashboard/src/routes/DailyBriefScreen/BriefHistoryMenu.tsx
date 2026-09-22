import { ReactElement, Ref, useCallback, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMeasure } from 'react-use';
import { ClockDefault } from '@xyne/icons';
import { Popover } from '../../components/ui/Popover';
import { cn } from '../../utils/classNames';
import { APP_NO_DRAG_STYLE } from '../../utils/electronApp';
import { BriefListView } from './BriefListView';
import { CalendarView } from './CalendarView';
import type { DailyBriefHistoryItem } from '../../api/dailyBriefApi';

export const HEADER_ICON_CLASS =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-muted-foreground ' +
  'transition-colors hover:bg-accent hover:text-foreground';

type BriefMenuView = 'list' | 'calendar';

interface BriefHistoryMenuProps {
  history: DailyBriefHistoryItem[];
  availableDates: string[];
  selectedDate: string | null;
  onSelect: (date: string, source: 'history_menu' | 'date_picker') => void;
}

export function BriefHistoryMenu({
  history,
  availableDates,
  selectedDate,
  onSelect,
}: BriefHistoryMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<BriefMenuView>('list');
  const [elementRef, bounds] = useMeasure();

  const handleOpenChange = useCallback((next: boolean): void => {
    setOpen(next);
    if (next) setView('list');
  }, []);

  const handleSelect = useCallback(
    (date: string, source: 'history_menu' | 'date_picker'): void => {
      onSelect(date, source);
      setOpen(false);
    },
    [onSelect],
  );

  const content = useMemo(() => {
    switch (view) {
      case 'list':
        return (
          <BriefListView
            history={history}
            selectedDate={selectedDate}
            onSelect={handleSelect}
            onBrowseDates={() => setView('calendar')}
          />
        );
      case 'calendar':
        return (
          <CalendarView
            availableDates={availableDates}
            selectedDate={selectedDate}
            onSelect={handleSelect}
            onBack={() => setView('list')}
          />
        );
    }
  }, [view, history, availableDates, selectedDate, handleSelect]);

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      side='bottom'
      align='end'
      sideOffset={8}
      collisionPadding={12}
      className='w-[276px] overflow-hidden rounded-[12px] border-border bg-popover p-1.5 shadow-lg'
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
      <motion.div
        className='~overflow-hidden'
        animate={{
          height: bounds.height,
          transition: {
            duration: 0.27,
            ease: [0.25, 1, 0.5, 1],
          },
        }}
      >
        <div ref={elementRef as Ref<HTMLDivElement> | undefined}>
          <AnimatePresence initial={false} mode='popLayout' custom={view}>
            <motion.div
              key={view}
              initial={{ opacity: 0, scale: 1 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1 }}
              transition={{ duration: 0.27, ease: [0.26, 0.08, 0.25, 1] }}
            >
              {content}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </Popover>
  );
}
