import { ReactElement, useMemo, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import {
  CheckTickSingle as Check,
  ChevronLeft,
  ChevronRight,
  FilterHorizontal as Sliders,
  MultipleCrossCancelDefault as Cross,
  SearchDefault as Search,
} from '@xyne/icons';
import { cn } from '../../../utils/classNames';
import { Tooltip } from '../../ui/Tooltip';
import { groupByChoices, groupByLabel, optionKey } from './groupBy';
import type { HeaderLayoutView, TicketsHeaderProps } from './TicketsHeader.types';

type CustomiseViewPopoverProps = Pick<
  TicketsHeaderProps,
  | 'layoutView'
  | 'onLayoutChange'
  | 'showLayoutPicker'
  | 'showCalendarLayout'
  | 'groupBy'
  | 'groupingOptions'
  | 'onGroupByChange'
  | 'columns'
  | 'visibleColumns'
  | 'onColumnVisibilityChange'
  | 'onResetColumns'
  | 'isComfortView'
  | 'onComfortViewChange'
  | 'savedFilters'
> & {
  showGroupBy: boolean;
};

const rowClass =
  'flex h-[31px] w-full items-center rounded-[7px] px-[9px] text-left text-[12.5px] text-foreground/80 transition-colors hover:bg-muted';

const LAYOUT_TRACK_NAMES: Record<HeaderLayoutView, string> = {
  kanban: 'SetKanbanView',
  table: 'SetTableView',
  calendar: 'SetCalendarView',
  flow: 'SetFlowView',
};

const Toggle = ({ on }: { on: boolean }): ReactElement => (
  <span
    className={cn(
      'relative inline-block h-[15px] w-[26px] shrink-0 rounded-full transition-colors',
      on ? 'bg-foreground' : 'bg-foreground/15',
    )}
  >
    <span
      className={cn(
        'absolute top-[2px] size-[11px] rounded-full bg-background shadow-[0_1px_2px_rgba(20,22,26,0.2)] transition-[left]',
        on ? 'left-[13px]' : 'left-[2px]',
      )}
    />
  </span>
);

const LayoutCard = ({
  id,
  label,
  selected,
  onClick,
  children,
}: {
  id: HeaderLayoutView;
  label: string;
  selected: boolean;
  onClick: () => void;
  children: ReactElement;
}): ReactElement => (
  <button
    type='button'
    onClick={onClick}
    className={cn(
      'flex flex-1 flex-col gap-[7px] rounded-[10px] border p-[9px] text-left transition-colors hover:border-muted-foreground/40',
      selected ? 'border-[1.5px] border-foreground' : 'border-border',
    )}
    data-testid={`${id}-view-btn`}
    data-track-category='Tickets'
    data-track-name={LAYOUT_TRACK_NAMES[id]}
  >
    {children}
    <span
      className={cn(
        'text-[11.5px]',
        selected ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
      )}
    >
      {label}
    </span>
  </button>
);

export const CustomiseViewPopover = (props: CustomiseViewPopoverProps): ReactElement => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'main' | 'columns'>('main');
  const [groupOpen, setGroupOpen] = useState(false);
  const [columnQuery, setColumnQuery] = useState('');

  const shownColumns = useMemo(() => {
    const q = columnQuery.trim().toLowerCase();
    return q ? props.columns.filter(c => c.label.toLowerCase().includes(q)) : props.columns;
  }, [props.columns, columnQuery]);
  const shownCount = useMemo(
    () => props.columns.filter(c => props.visibleColumns.has(c.key)).length,
    [props.columns, props.visibleColumns],
  );
  const columnsLabel = props.layoutView === 'table' ? 'Columns' : 'Card fields';

  const groupLabel = groupByLabel(props.groupBy, props.groupingOptions);
  const groupChoices = groupByChoices(props.groupingOptions);
  const activeGroupKey = optionKey(props.groupBy);

  const layouts: { id: HeaderLayoutView; label: string; thumb: ReactElement }[] = useMemo(
    () => [
      {
        id: 'table',
        label: 'List',
        thumb: (
          <span className='flex flex-col gap-[3px]'>
            <span className='h-[5px] rounded-[3px] bg-muted-foreground/40' />
            <span className='h-[5px] rounded-[3px] bg-muted' />
            <span className='h-[5px] rounded-[3px] bg-muted' />
            <span className='h-[5px] rounded-[3px] bg-muted' />
          </span>
        ),
      },
      {
        id: 'kanban',
        label: 'Board',
        thumb: (
          <span className='flex items-start gap-[3px]'>
            <span className='h-[23px] flex-1 rounded-[3px] bg-muted' />
            <span className='h-4 flex-1 rounded-[3px] bg-muted' />
            <span className='h-[11px] flex-1 rounded-[3px] bg-muted' />
          </span>
        ),
      },
      ...(props.showCalendarLayout
        ? [
            {
              id: 'calendar' as const,
              label: 'Calendar',
              thumb: (
                <span className='grid grid-cols-4 gap-[3px]'>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        'h-[10px] rounded-[3px]',
                        i === 5 ? 'bg-muted-foreground/40' : 'bg-muted',
                      )}
                    />
                  ))}
                </span>
              ),
            },
          ]
        : []),
    ],
    [props.showCalendarLayout],
  );

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) {
          setStep('main');
          setGroupOpen(false);
          setColumnQuery('');
        }
      }}
    >
      <Tooltip content='Customise view' side='bottom'>
        <PopoverPrimitive.Trigger asChild>
          <button
            type='button'
            aria-label='Customise view'
            title='Customise view'
            className={cn(
              'flex size-[30px] shrink-0 items-center justify-center rounded-lg border transition-colors hover:border-muted-foreground/40 hover:text-foreground',
              open
                ? 'border-muted-foreground/40 bg-muted text-foreground'
                : 'border-border bg-transparent text-muted-foreground',
            )}
            data-testid='customise-view-btn'
            data-track-category='Tickets'
            data-track-name='OpenCustomizeView'
          >
            <Sliders className='size-[15px]' />
          </button>
        </PopoverPrimitive.Trigger>
      </Tooltip>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side='bottom'
          align='end'
          sideOffset={6}
          onFocusOutside={e => e.preventDefault()}
          className='z-[60] w-[300px] overflow-hidden rounded-[12px] border border-border bg-background shadow-[0_16px_44px_rgba(20,22,26,0.18)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1'
        >
          {step === 'main' ? (
            <div>
              {props.showLayoutPicker && (
                <div className='flex gap-2 px-3 pb-[10px] pt-3'>
                  {layouts.map(layout => (
                    <LayoutCard
                      key={layout.id}
                      id={layout.id}
                      label={layout.label}
                      selected={props.layoutView === layout.id}
                      onClick={() => props.onLayoutChange(layout.id)}
                    >
                      {layout.thumb}
                    </LayoutCard>
                  ))}
                </div>
              )}
              <div className='px-[5px] pb-[5px] pt-[2px]'>
                {props.showGroupBy && (
                  <>
                    <button
                      type='button'
                      onClick={() => setGroupOpen(prev => !prev)}
                      className={rowClass}
                      data-testid='group-by-dropdown'
                      data-track-category='Tickets'
                      data-track-name='ToggleGroupByRow'
                    >
                      Group by
                      <span className='flex-1' />
                      <span className='text-[12px] font-medium text-foreground'>{groupLabel}</span>
                      <ChevronRight
                        className={cn(
                          'ml-[5px] size-[11px] text-muted-foreground/60 transition-transform',
                          groupOpen && 'rotate-90',
                        )}
                      />
                    </button>
                    {groupOpen &&
                      groupChoices.map(choice => {
                        const active = choice.key === activeGroupKey;
                        return (
                          <button
                            key={choice.key}
                            type='button'
                            onClick={() => props.onGroupByChange(choice.value)}
                            className={cn(
                              'flex h-7 w-full items-center rounded-[7px] pl-5 pr-[9px] text-left text-[12.5px] text-foreground/80 transition-colors hover:bg-muted',
                              active && 'bg-muted',
                            )}
                            data-testid={`group-by-${choice.testId}`}
                            data-track-category='Tickets'
                            data-track-name='SetGroupBy'
                          >
                            {choice.label}
                            <span className='flex-1' />
                            {active && <Check className='size-3 text-foreground' />}
                          </button>
                        );
                      })}
                  </>
                )}
                <button
                  type='button'
                  onClick={() => setStep('columns')}
                  className={rowClass}
                  data-track-category='Tickets'
                  data-track-name='OpenColumnsStep'
                >
                  {columnsLabel}
                  <span className='flex-1' />
                  <span className='font-mono text-[11.5px] text-muted-foreground/80'>
                    {shownCount} of {props.columns.length}
                  </span>
                  <ChevronRight className='ml-[5px] size-[11px] text-muted-foreground/60' />
                </button>
                {props.layoutView === 'table' && (
                  <button
                    type='button'
                    onClick={() => props.onComfortViewChange(!props.isComfortView)}
                    className={rowClass}
                    data-track-event='BUTTON_CLICK'
                    data-track-category='Tickets'
                    data-track-name={
                      props.isComfortView ? 'KANBAN_VIEW_COMPACT' : 'KANBAN_VIEW_COMFORTABLE'
                    }
                  >
                    Comfortable rows
                    <span className='flex-1' />
                    <Toggle on={props.isComfortView} />
                  </button>
                )}
              </div>
              {props.savedFilters && props.savedFilters.items.length > 0 && (
                <div className='border-t border-border/60 px-[5px] pb-[5px]'>
                  <div className='px-[9px] pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.5px] text-muted-foreground/60'>
                    Saved filters
                  </div>
                  {props.savedFilters.items.map(item => {
                    const active = props.savedFilters?.activeId === item.id;
                    return (
                      <div
                        key={item.id}
                        className='group flex h-[31px] items-center rounded-[7px] px-[9px] text-[12.5px] text-foreground/80 transition-colors hover:bg-muted'
                      >
                        <button
                          type='button'
                          onClick={() => {
                            if (active) props.savedFilters?.onDismiss();
                            else props.savedFilters?.onApply(item.id);
                            setOpen(false);
                          }}
                          className='flex h-full min-w-0 flex-1 items-center gap-2 text-left'
                          data-track-category='saved-views'
                          data-track-name={active ? 'dismiss-active-view' : 'apply-saved-view'}
                        >
                          <span className='truncate'>{item.name}</span>
                          {item.isPrivate && (
                            <span className='text-[11px] text-muted-foreground/60'>Private</span>
                          )}
                          <span className='flex-1' />
                          {active && <Check className='size-3 text-foreground' />}
                        </button>
                        {item.isOwn && (
                          <button
                            type='button'
                            title='Delete saved filter'
                            onClick={() => props.savedFilters?.onDelete(item)}
                            className='ml-1 hidden size-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-foreground/10 hover:text-foreground group-hover:flex'
                            data-track-category='saved-views'
                            data-track-name='delete-saved-view'
                          >
                            <Cross className='size-3' />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className='flex h-[38px] items-center gap-2 border-b border-border/60 px-[10px]'>
                <button
                  type='button'
                  title='Back'
                  onClick={() => setStep('main')}
                  className='flex size-6 items-center justify-center rounded-md text-foreground/80 hover:bg-muted hover:text-foreground'
                  data-track-category='Tickets'
                  data-track-name='CloseColumnsStep'
                >
                  <ChevronLeft className='size-4' />
                </button>
                <span className='text-[12.5px] font-semibold text-foreground'>{columnsLabel}</span>
                <span className='flex-1' />
                <span className='font-mono text-[11px] text-muted-foreground/80'>
                  {shownCount} of {props.columns.length}
                </span>
              </div>
              <div className='flex h-[42px] items-center gap-2.5 border-b border-border/60 px-[13px]'>
                <Search className='size-[17px] shrink-0 text-muted-foreground/80' />
                <input
                  autoFocus
                  value={columnQuery}
                  onChange={e => setColumnQuery(e.target.value)}
                  placeholder='Search fields'
                  className='min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground/60'
                  data-track-category='Tickets'
                  data-track-name='SearchColumns'
                />
              </div>
              <div className='max-h-[234px] overflow-y-auto py-1'>
                {shownColumns.length === 0 ? (
                  <div className='px-[14px] py-3 text-[12px] text-muted-foreground'>
                    No field matches
                  </div>
                ) : (
                  shownColumns.map(column => {
                    const on = props.visibleColumns.has(column.key);
                    return (
                      <button
                        key={column.key}
                        type='button'
                        onClick={() => props.onColumnVisibilityChange(column.key, !on)}
                        className='flex h-[38px] w-full items-center gap-2.5 px-[14px] text-left text-[13.5px] text-foreground transition-colors hover:bg-muted/60'
                        data-track-category='Tickets'
                        data-track-name='ToggleColumnVisibility'
                        data-track-metadata={JSON.stringify({ column: column.key, visible: !on })}
                      >
                        <span
                          className={cn(
                            'flex size-4 shrink-0 items-center justify-center rounded-[4px] border-[1.5px]',
                            on
                              ? 'border-foreground bg-foreground text-background'
                              : 'border-muted-foreground/40',
                          )}
                        >
                          {on && <Check className='size-[10px]' strokeWidth={2.6} />}
                        </span>
                        <span className='text-muted-foreground [&_svg]:size-4'>{column.icon}</span>
                        <span className='min-w-0 flex-1 truncate'>{column.label}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
          <div className='flex items-center justify-between border-t border-border/60 px-3 py-[9px]'>
            <button
              type='button'
              onClick={() => {
                props.onResetColumns();
                props.onGroupByChange('none');
              }}
              className='text-[12px] font-medium text-muted-foreground hover:text-foreground'
              data-track-category='Tickets'
              data-track-name='ResetCustomizeView'
            >
              Reset
            </button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
};
