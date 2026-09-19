import { ReactElement, ReactNode, useState } from 'react';
import { startOfDay, subDays, subMonths, subWeeks } from 'date-fns';
import { CalendarDays, ChevronRight, History } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { Calendar } from '../../ui/Calendar';

/**
 * Where a jump should land.
 * - `date`      → the first conversation at or after the start of that local day.
 * - `channel-start` → the oldest conversation in the channel.
 */
export type JumpTarget = { type: 'date'; timestamp: number } | { type: 'channel-start' };

export interface JumpToDateMenuProps {
  /** Date of the divider this menu hangs off — seeds the calendar's visible month. */
  anchorDate?: Date | undefined;
  onJump: (target: JumpTarget) => void;
  /** Trigger element (the date pill itself). */
  children: ReactNode;
  disabled?: boolean;
}

const dayStart = (date: Date): number => startOfDay(date).getTime();

/**
 * Slack-style "jump to date" menu anchored on a date divider: quick presets plus a
 * calendar sub-menu for an exact date. The menu only emits a target; the chat list
 * owns fetching the window and scrolling to it.
 */
export const JumpToDateMenu = ({
  anchorDate,
  onJump,
  children,
  disabled = false,
}: JumpToDateMenuProps): ReactElement => {
  const [open, setOpen] = useState(false);
  const today = new Date();

  const jumpTo = (target: JumpTarget): void => {
    setOpen(false);
    onJump(target);
  };

  const presets: { label: string; timestamp: number }[] = [
    { label: 'Today', timestamp: dayStart(today) },
    { label: 'Yesterday', timestamp: dayStart(subDays(today, 1)) },
    { label: 'Last week', timestamp: dayStart(subWeeks(today, 1)) },
    { label: 'Last month', timestamp: dayStart(subMonths(today, 1)) },
  ];

  return (
    // modal={false}: the chat list must keep scrolling while the menu is open, and
    // Radix's modal mode would lock the body scroll and steal pointer events.
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align='center' className='w-56'>
        <DropdownMenuLabel>Jump to</DropdownMenuLabel>
        {presets.map(preset => (
          <DropdownMenuItem
            key={preset.label}
            data-track-category='CHAT_LIST'
            data-track-name='JUMP_TO_DATE_PRESET'
            onSelect={() => jumpTo({ type: 'date', timestamp: preset.timestamp })}
          >
            {preset.label}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className='cursor-pointer'>
            <CalendarDays className='w-4 h-4' />
            <span>Specific date…</span>
            <ChevronRight className='w-4 h-4 ml-auto opacity-60' />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className='p-0 w-[17rem]'>
            {/* Stop key events at the boundary: the menu's typeahead/arrow handling
                would otherwise swallow the calendar's own keyboard navigation. */}
            <div role='presentation' onKeyDown={event => event.stopPropagation()}>
              <Calendar
                mode='single'
                defaultMonth={anchorDate ?? today}
                selected={anchorDate}
                disabled={{ after: today }}
                onSelect={date => {
                  if (!date) return;
                  jumpTo({ type: 'date', timestamp: dayStart(date) });
                }}
              />
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-track-category='CHAT_LIST'
          data-track-name='JUMP_TO_CHANNEL_START'
          onSelect={() => jumpTo({ type: 'channel-start' })}
        >
          <History className='w-4 h-4' />
          <span>The very beginning</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
