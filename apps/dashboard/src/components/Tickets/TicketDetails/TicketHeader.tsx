import React, { useRef, useState } from 'react';
import { TicketPriority, TicketStatusV2 } from '@xyne/shared';
import {
  AlertCircle,
  CheckTickSingle as Check,
  ChevronDown,
  ChevronUp,
  CopyDefault,
  ThreeDotsMenuHorizontal,
} from '@xyne/icons';
import { Popover } from '../../ui/Popover/Popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import Tooltip from '../../ui/Tooltip';
import { cn } from '../../../utils/classNames';
import { getPriorityIcon } from '../TicketCard/TicketCard.utils';
import { formatETADisplay } from '../utils';
import { useBoardTicketNav } from '../../../hooks/useBoardTicketNav';
import { AddToStreamMenuItem } from '../../Streams/components/AddToStreamMenu/AddToStreamMenu';
import { useAddToStream } from '../../Streams/hooks/useAddToStream';
import type { ColumnSource } from '../../Streams/components/Streams/Streams.types';

interface HeaderStage {
  name: string;
  defaultTicketStatusV2?: string | null;
}

const PIE_CIRCUMFERENCE = 2 * Math.PI * 4.25;

const stageStatusOf = (
  stages: readonly HeaderStage[],
  stageName: string | null | undefined,
  fallbackStatus?: string | null,
): string | null | undefined =>
  stages.find(s => s.name === stageName)?.defaultTicketStatusV2 ?? fallbackStatus;

const stageFractionOf = (
  stages: readonly HeaderStage[],
  stageName: string | null | undefined,
  isNonLinearBoard: boolean,
): number => {
  const active = isNonLinearBoard
    ? []
    : stages.filter(
        s =>
          s.defaultTicketStatusV2 !== TicketStatusV2.TODO &&
          s.defaultTicketStatusV2 !== TicketStatusV2.CANCELLED,
      );
  const index = active.findIndex(s => s.name === stageName);
  return index >= 0 ? (index + 1) / active.length : 0.5;
};

export const StageGlyph = ({
  status,
  fraction,
  size = 16,
  inverted = false,
}: {
  status: string | null | undefined;
  fraction: number;
  size?: number;
  inverted?: boolean;
}): React.ReactElement => {
  const svg = {
    width: size,
    height: size,
    viewBox: '0 0 20 20',
    className: 'block shrink-0',
    'aria-hidden': true,
  } as const;

  if (status === TicketStatusV2.PAUSED) {
    const ink = inverted ? 'currentColor' : 'var(--status-paused)';
    return (
      <svg {...svg} fill='none' stroke={ink} strokeWidth={1.9} strokeLinecap='round'>
        <circle cx={10} cy={10} r={7.2} />
        <path d='M8.3 7.7v4.6M11.7 7.7v4.6' />
      </svg>
    );
  }

  if (status === TicketStatusV2.CANCELLED) {
    if (inverted) {
      return (
        <svg {...svg} fill='none' stroke='currentColor' strokeWidth={1.9} strokeLinecap='round'>
          <circle cx={10} cy={10} r={8.2} />
          <path d='M7.4 7.4 12.6 12.6M12.6 7.4 7.4 12.6' />
        </svg>
      );
    }
    return (
      <svg {...svg}>
        <circle cx={10} cy={10} r={8.2} fill='var(--status-failure)' />
        <path
          d='M7.4 7.4 12.6 12.6M12.6 7.4 7.4 12.6'
          fill='none'
          stroke='#fff'
          strokeWidth={2}
          strokeLinecap='round'
        />
      </svg>
    );
  }

  if (status === TicketStatusV2.COMPLETED) {
    return (
      <svg {...svg}>
        <circle
          cx={10}
          cy={10}
          r={8.2}
          fill={inverted ? 'currentColor' : 'var(--status-success)'}
        />
        <path
          d='M6.4 10.2 8.9 12.7 13.7 7.2'
          fill='none'
          stroke={inverted ? 'hsl(var(--foreground))' : '#fff'}
          strokeWidth={2.2}
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }

  if (status === TicketStatusV2.STARTED) {
    const ink = inverted ? 'currentColor' : 'var(--status-scheduled)';
    const filled = Math.max(0.1, Math.min(1, fraction)) * PIE_CIRCUMFERENCE;
    return (
      <svg {...svg} fill='none'>
        <circle cx={10} cy={10} r={7.9} stroke={ink} strokeWidth={1.9} />
        <circle
          cx={10}
          cy={10}
          r={4.25}
          stroke={ink}
          strokeWidth={8.5}
          strokeDasharray={`${filled.toFixed(2)} ${PIE_CIRCUMFERENCE.toFixed(2)}`}
          transform='rotate(-90 10 10)'
        />
      </svg>
    );
  }

  return (
    <svg
      {...svg}
      fill='none'
      stroke={inverted ? 'currentColor' : 'var(--status-new)'}
      strokeWidth={1.9}
      strokeLinecap='round'
      strokeDasharray='2.6 2.6'
    >
      <circle cx={10} cy={10} r={7.2} />
    </svg>
  );
};

interface ListboxOption {
  value: string;
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  trailing?: React.ReactNode;
}

const focusSelectedOption = (list: HTMLUListElement | null): void => {
  const target =
    list?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ??
    list?.querySelector<HTMLElement>('[role="option"]');
  target?.focus();
};

const moveListFocus = (event: React.KeyboardEvent<HTMLUListElement>): void => {
  const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
  if (options.length === 0) return;
  const current = options.indexOf(document.activeElement as HTMLElement);
  const focusAt = (index: number): void => {
    event.preventDefault();
    options[(index + options.length) % options.length]?.focus();
  };
  if (event.key === 'ArrowDown') focusAt(current + 1);
  else if (event.key === 'ArrowUp') focusAt(current < 0 ? -1 : current - 1);
  else if (event.key === 'Home') focusAt(0);
  else if (event.key === 'End') focusAt(-1);
};

const ValueListbox = ({
  open,
  onOpenChange,
  trigger,
  label,
  options,
  onPick,
  className,
  optionClassName,
  trackName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  label: string;
  options: ListboxOption[];
  onPick: (value: string) => void;
  className: string;
  optionClassName: string;
  trackName: string;
}): React.ReactElement => {
  const listRef = useRef<HTMLUListElement>(null);
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      align='start'
      sideOffset={6}
      collisionPadding={12}
      onOpenAutoFocus={event => {
        event.preventDefault();
        focusSelectedOption(listRef.current);
      }}
      className={cn(
        'rounded-xl border-border bg-background p-1.5 shadow-[0_16px_44px_rgba(20,22,26,0.2)]',
        className,
      )}
    >
      <ul
        ref={listRef}
        role='listbox'
        aria-label={label}
        onKeyDown={moveListFocus}
        data-theme-tokens=''
      >
        {options.map(option => (
          <li
            key={option.value}
            role='option'
            aria-selected={option.selected}
            tabIndex={-1}
            data-theme-tokens=''
            onClick={() => onPick(option.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.currentTarget.click();
            }}
            data-track-category='Tickets'
            data-track-name={trackName}
            className={cn(
              'flex cursor-pointer select-none items-center rounded-[7px] outline-none transition-colors duration-100 hover:bg-muted focus-visible:bg-muted',
              option.selected && 'bg-muted',
              optionClassName,
            )}
          >
            {option.icon}
            <span className='min-w-0 flex-1 truncate'>{option.label}</span>
            {option.trailing}
          </li>
        ))}
      </ul>
    </Popover>
  );
};

const statusPillClass =
  'inline-flex h-[29px] min-w-0 max-w-full shrink items-center gap-[7px] whitespace-nowrap rounded-[9px] bg-foreground pl-2 pr-2.5 text-background shadow-[0_1px_2px_rgba(20,22,26,0.14)]';

const Caret = (): React.ReactElement => (
  <svg width='8' height='8' viewBox='0 0 8 8' aria-hidden className='shrink-0 opacity-70'>
    <path d='M1.4 2.8h5.2L4 5.6z' fill='currentColor' />
  </svg>
);

export const StatusPill = ({
  stages,
  options,
  stageName,
  fallbackStatus,
  isNonLinearBoard,
  ringLabel,
  readOnly,
  pendingApproval,
  onSelect,
  trackMetadata,
  className,
}: {
  stages: readonly HeaderStage[];
  options: readonly HeaderStage[];
  stageName: string | null | undefined;
  fallbackStatus: string | null | undefined;
  isNonLinearBoard: boolean;
  ringLabel: string;
  readOnly: boolean;
  pendingApproval: boolean;
  onSelect: (stageName: string) => void;
  trackMetadata: string;
  className?: string;
}): React.ReactElement => {
  const [open, setOpen] = useState(false);
  const content = (
    <>
      <StageGlyph
        status={stageStatusOf(stages, stageName, fallbackStatus)}
        fraction={stageFractionOf(stages, stageName, isNonLinearBoard)}
        size={15}
        inverted
      />
      <span className='min-w-0 truncate text-[10.5px] font-semibold uppercase tracking-[0.3px]'>
        {stageName || 'No stage'}
      </span>
      {ringLabel && (
        <span className='shrink-0 font-mono text-[10.5px] tabular-nums opacity-[0.55]'>
          {ringLabel}
        </span>
      )}
      {pendingApproval && (
        <span title='Pending status approval' className='flex shrink-0'>
          <AlertCircle size={13} className='text-amber-400' />
        </span>
      )}
    </>
  );

  if (readOnly) {
    return (
      <span className={cn(statusPillClass, className)} data-testid='ticket-detail-status-selector'>
        {content}
      </span>
    );
  }

  return (
    <ValueListbox
      open={open}
      onOpenChange={setOpen}
      label='Change stage'
      trackName='SelectStage'
      className='w-[262px]'
      optionClassName='h-8 gap-[9px] px-[9px] text-[11.5px] font-medium uppercase tracking-[0.2px] text-foreground'
      options={options.map(stage => {
        const current = stage.name === stageName;
        return {
          value: stage.name,
          label: stage.name,
          selected: current,
          icon: (
            <StageGlyph
              status={stageStatusOf(stages, stage.name)}
              fraction={stageFractionOf(stages, stage.name, isNonLinearBoard)}
            />
          ),
          trailing: current ? (
            <span className='shrink-0 text-[10.5px] font-normal normal-case tracking-normal text-muted-foreground/70'>
              current
            </span>
          ) : null,
        };
      })}
      onPick={name => {
        setOpen(false);
        if (name !== stageName) onSelect(name);
      }}
      trigger={
        <button
          type='button'
          title='Change stage'
          className={cn(
            statusPillClass,
            'transition-[opacity,transform] duration-150 ease-out hover:opacity-[0.88] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:active:scale-100',
            className,
          )}
          data-testid='ticket-detail-status-selector'
          data-track-event='SELECTOR_CHANGE'
          data-track-category='Tickets'
          data-track-name='CHANGE_STATUS'
          data-track-metadata={trackMetadata}
        >
          {content}
          <Caret />
        </button>
      }
    />
  );
};

const PRIORITY_ORDER: readonly TicketPriority[] = [
  TicketPriority.LOW,
  TicketPriority.MEDIUM,
  TicketPriority.HIGH,
  TicketPriority.CRITICAL,
];

const priorityLabel = (priority: string): string =>
  priority.charAt(0) + priority.slice(1).toLowerCase();

export const PriorityGlyph = ({
  priority,
  className,
}: {
  priority: TicketPriority;
  className: string;
}): React.ReactElement => (
  <span
    className={cn(
      'flex shrink-0 items-center justify-center [&>svg]:w-auto',
      priority === TicketPriority.CRITICAL && 'text-destructive',
      className,
    )}
  >
    {getPriorityIcon(priority)}
  </span>
);

export const PriorityChip = ({
  priority,
  onSelect,
  trackMetadata,
  chipClassName,
}: {
  priority: string | null | undefined;
  onSelect: (priority: TicketPriority) => void;
  trackMetadata: string;
  chipClassName: string;
}): React.ReactElement => {
  const [open, setOpen] = useState(false);
  const current = priority as TicketPriority | null | undefined;
  const critical = current === TicketPriority.CRITICAL;
  return (
    <ValueListbox
      open={open}
      onOpenChange={setOpen}
      label='Change priority'
      trackName='SelectPriority'
      className='w-[186px]'
      optionClassName='h-8 gap-[9px] px-[9px] text-[12.5px] text-foreground'
      options={PRIORITY_ORDER.map(option => ({
        value: option,
        label: priorityLabel(option),
        selected: option === current,
        icon: <PriorityGlyph priority={option} className='w-[18px] [&>svg]:h-[14px]' />,
        trailing:
          option === current ? (
            <Check size={14} className='shrink-0 text-muted-foreground' />
          ) : null,
      }))}
      onPick={value => {
        setOpen(false);
        if (value !== priority) onSelect(value as TicketPriority);
      }}
      trigger={
        <button
          type='button'
          title='Priority'
          className={cn(chipClassName, 'gap-[7px] pl-2 pr-[10px]', open && 'bg-muted')}
          data-testid='ticket-detail-priority-selector'
          data-track-event='SELECTOR_CHANGE'
          data-track-category='Tickets'
          data-track-name='CHANGE_PRIORITY'
          data-track-metadata={trackMetadata}
        >
          {current ? (
            <>
              <PriorityGlyph priority={current} className='[&>svg]:h-[15px]' />
              <span className={critical ? 'text-destructive' : 'text-foreground'}>
                {priorityLabel(current)}
              </span>
            </>
          ) : (
            <span className='text-muted-foreground'>Priority</span>
          )}
        </button>
      }
    />
  );
};

export const DuplicatesPill = ({
  count,
  possible,
  onClick,
}: {
  count: number;
  possible: boolean;
  onClick?: () => void;
}): React.ReactElement => {
  const className =
    'inline-flex h-[25px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-500/35 bg-amber-500/[0.08] pl-2 pr-2.5 text-[12.5px] font-medium text-amber-700 [[data-theme=midnight]_&]:text-amber-400';
  const label = (
    <>
      <CopyDefault size={14} className='shrink-0' />
      {count} {possible ? 'possible ' : ''}duplicate{count === 1 ? '' : 's'}
    </>
  );
  if (!onClick) return <span className={className}>{label}</span>;
  return (
    <button
      type='button'
      onClick={onClick}
      title='Show in Relationships'
      className={cn(
        className,
        'transition-[background-color,border-color,transform] duration-150 ease-out hover:border-amber-500/55 hover:bg-amber-500/[0.14] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 motion-reduce:active:scale-100',
      )}
      data-track-category='Tickets'
      data-track-name='ShowPossibleDuplicates'
    >
      {label}
    </button>
  );
};

export interface TicketMenuItem {
  label: string;
  icon: React.ReactElement;
  trackName: string;
  onSelect: () => void;
  disabled?: boolean;
  shortcut?: string;
  separatorBefore?: boolean;
  trackMetadata?: string;
}

const menuItemClass = 'h-9 gap-[11px] rounded-lg px-[9px] text-[13px] text-foreground';

const renderMenuItem = (item: TicketMenuItem): React.ReactElement => (
  <React.Fragment key={item.label}>
    {item.separatorBefore && <DropdownMenuSeparator className='mx-0.5 my-1' />}
    <DropdownMenuItem
      className={menuItemClass}
      disabled={item.disabled ?? false}
      onSelect={item.onSelect}
      data-track-category='Tickets'
      data-track-name={item.trackName}
      data-track-metadata={item.trackMetadata}
    >
      <span className='flex w-[22px] shrink-0 items-center justify-center text-muted-foreground'>
        {item.icon}
      </span>
      <span className='flex-1'>{item.label}</span>
      {item.shortcut && (
        <kbd className='font-mono text-[11px] font-medium text-muted-foreground/70'>
          {item.shortcut}
        </kbd>
      )}
    </DropdownMenuItem>
  </React.Fragment>
);

export const TicketMoreMenu = ({
  items,
  extra,
  triggerClassName,
}: {
  items: TicketMenuItem[];
  extra?: React.ReactNode;
  triggerClassName?: string;
}): React.ReactElement => (
  <DropdownMenu modal={false}>
    <Tooltip content='More actions' side='bottom' sideOffset={6} className='pointer-events-none'>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          aria-label='More actions'
          className={cn(
            'flex shrink-0 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted data-[state=open]:text-foreground',
            triggerClassName,
          )}
          data-track-category='Tickets'
          data-track-name='OpenTicketMoreMenu'
        >
          <ThreeDotsMenuHorizontal className='size-[17px]' />
        </button>
      </DropdownMenuTrigger>
    </Tooltip>
    <DropdownMenuContent
      align='end'
      sideOffset={6}
      collisionPadding={12}
      className='w-[226px] rounded-xl border-border bg-background p-1.5 shadow-[0_16px_44px_rgba(20,22,26,0.2)]'
    >
      {extra}
      {items.map(renderMenuItem)}
    </DropdownMenuContent>
  </DropdownMenu>
);

const StreamMenuEntry = ({ source }: { source: ColumnSource }): React.ReactElement | null => {
  const { has } = useAddToStream();
  if (has(source)) return null;
  return (
    <AddToStreamMenuItem
      source={source}
      className={cn(
        menuItemClass,
        '[&>svg:first-child]:mx-[3px] [&>svg:first-child]:text-muted-foreground',
      )}
    />
  );
};

export const TicketHeaderMenu = ({
  ticketId,
  items,
  trailingItems,
  streamSource,
}: {
  ticketId: string;
  items: TicketMenuItem[];
  trailingItems: TicketMenuItem[];
  streamSource: ColumnSource;
}): React.ReactElement => {
  const nav = useBoardTicketNav(ticketId);
  const navItems: TicketMenuItem[] = nav.enabled
    ? [
        {
          label: 'Previous ticket',
          icon: <ChevronUp size={18} />,
          shortcut: 'K',
          trackName: 'PrevTicket',
          disabled: !nav.hasPrev,
          separatorBefore: true,
          onSelect: nav.goPrev,
        },
        {
          label: 'Next ticket',
          icon: <ChevronDown size={18} />,
          shortcut: 'J',
          trackName: 'NextTicket',
          disabled: !nav.hasNext,
          onSelect: nav.goNext,
        },
      ]
    : [];
  return (
    <TicketMoreMenu
      triggerClassName='size-[30px] rounded-lg'
      items={[...items, ...navItems, ...trailingItems]}
      extra={<StreamMenuEntry source={streamSource} />}
    />
  );
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const formatChipDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === new Date().getFullYear() ? base : `${base} ${date.getFullYear()}`;
};

export type EtaTone = 'danger' | 'warning' | 'neutral';

export const ETA_BREACHED_CHIP =
  'border-destructive/25 bg-destructive/[0.06] hover:border-destructive/45';

export const etaToneTextClass = (tone?: EtaTone): string =>
  tone === 'danger'
    ? 'text-destructive'
    : tone === 'warning'
      ? 'text-amber-700 [[data-theme=midnight]_&]:text-amber-400'
      : 'text-foreground';

export const etaToneIconClass = (tone?: EtaTone): string =>
  tone === 'danger'
    ? 'text-destructive'
    : tone === 'warning'
      ? 'text-amber-600 [[data-theme=midnight]_&]:text-amber-400'
      : 'text-muted-foreground';

const calendarDaysFromToday = (timestamp: number): number =>
  Math.round((new Date(timestamp).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);

export const formatEtaChip = (timestamp: number): string =>
  Math.abs(calendarDaysFromToday(timestamp)) <= 1
    ? formatETADisplay(timestamp)
    : formatChipDate(timestamp);

export const etaUrgency = (timestamp: number): { marker: string; tone: EtaTone } => {
  if (timestamp < Date.now()) return { marker: 'Breached', tone: 'danger' };
  const days = calendarDaysFromToday(timestamp);
  if (days === 0) return { marker: 'due today', tone: 'warning' };
  if (days === 1) return { marker: 'due tomorrow', tone: 'neutral' };
  return { marker: `in ${days} days`, tone: 'neutral' };
};
