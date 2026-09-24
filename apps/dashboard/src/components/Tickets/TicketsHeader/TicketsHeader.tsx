import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import {
  CheckTickSingle as Check,
  ChevronDown,
  ChevronRight,
  DownloadDown as Download,
  LayerTwo as Layers,
  PlusDefault as Plus,
  SearchDefault as Search,
  Star,
} from '@xyne/icons';
import { cn } from '../../../utils/classNames';
import { TURN_OFF_EXACT_SEARCH, TURN_ON_EXACT_SEARCH } from '../../../utils/exactSearch';
import Button from '../../ui/Button';
import { Popover } from '../../ui/Popover/Popover';
import { Tooltip } from '../../ui/Tooltip';
import { BoardsChip } from './BoardsChip';
import { CustomiseViewPopover } from './CustomiseViewPopover';
import { AddFilterChip } from './AddFilterChip';
import { FilterChip } from './FilterChip';
import { FilterValuePicker } from './FilterValuePicker';
import { ShareViewPopover } from './ShareViewPopover';
import {
  buildFilterChips,
  getFilterFields,
  hasAnyFilterChip,
  removeFilterField,
  resolveDynamicFields,
  type FilterFieldDef,
} from './filterChips';
import { groupByLabel, optionKey, splitGroupByChoices } from './groupBy';
import type { TicketsHeaderProps } from './TicketsHeader.types';

const rowPillClass =
  'flex h-[26px] shrink-0 items-center gap-[5px] whitespace-nowrap rounded-[7px] border px-2 text-[12px] font-medium transition-colors hover:bg-muted hover:text-foreground';

const menuClass =
  'z-[60] p-[5px] bg-background border border-border shadow-[0_16px_44px_rgba(20,22,26,0.18)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1';

const menuRowClass =
  'flex h-[31px] w-full items-center gap-2 rounded-[7px] px-[9px] text-left text-[12.5px] text-foreground/80 transition-colors hover:bg-muted hover:text-foreground';

export const TicketsHeader = (props: TicketsHeaderProps): ReactElement => {
  const {
    startSlot,
    title,
    ticketCount,
    isFiltered,
    star,
    searchValue,
    onSearchChange,
    isExactSearch,
    onExactSearchChange,
    share,
    onCreateTicket,
    createTicketMetadata,
    onLinkBoards,
    linkBoardsMetadata,
    showFilters,
    filters,
    onFiltersChange,
    pickerContext,
    names,
    workspaceView,
    hideAssigneeFilter,
    showFlagFilters,
    showOverdueOnly,
    onOverdueChange,
    onClearFilters,
    viewSave,
    onExport,
    onOpenTicketReport,
  } = props;

  const searchRef = useRef<HTMLInputElement>(null);
  const pendingCaretRef = useRef(false);
  useEffect(() => {
    if (!pendingCaretRef.current || searchValue !== '""') return;
    pendingCaretRef.current = false;
    searchRef.current?.focus();
    searchRef.current?.setSelectionRange(1, 1);
  }, [searchValue]);

  const [addOpen, setAddOpen] = useState(false);
  const [openChipId, setOpenChipId] = useState<string | null>(null);
  const [pendingField, setPendingField] = useState<FilterFieldDef | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupCustomOpen, setGroupCustomOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const dynamicFields = useMemo(
    () => resolveDynamicFields(pickerContext.formMappings),
    [pickerContext.formMappings],
  );
  const fields = useMemo(
    () =>
      getFilterFields(filters, pickerContext, {
        hideAssigneeFilter,
        showFlagFilters,
        dynamicFields,
      }),
    [filters, pickerContext, hideAssigneeFilter, showFlagFilters, dynamicFields],
  );
  const chips = useMemo(
    () => buildFilterChips(fields, filters, names, showOverdueOnly),
    [fields, filters, names, showOverdueOnly],
  );
  const inUse = useMemo(() => new Map(chips.map(chip => [chip.id, chip.value])), [chips]);
  const hasChips = hasAnyFilterChip(filters, showOverdueOnly);

  useEffect(() => {
    if (pendingField && inUse.has(pendingField.id)) setPendingField(null);
  }, [pendingField, inUse]);

  const handlePickField = (field: FilterFieldDef): void => {
    setAddOpen(false);
    if (field.isFlag) {
      if (field.id === 'overdue') onOverdueChange(true);
      else if (field.id === 'assigned')
        onFiltersChange({ ...filters, assigned: true, created: false });
      else if (field.id === 'created')
        onFiltersChange({ ...filters, created: true, assigned: false });
      return;
    }
    if (!inUse.has(field.id)) setPendingField(field);
    setOpenChipId(field.id);
    pickerContext.onFiltersDropdownOpenChange?.(true);
  };

  const handleChipOpenChange = (fieldId: string, open: boolean): void => {
    setOpenChipId(open ? fieldId : null);
    pickerContext.onFiltersDropdownOpenChange?.(open);
    if (fieldId === 'sourceChannels') pickerContext.onSourceChannelsOpenChange?.(open);
    if (pendingField && !(open && pendingField.id === fieldId)) setPendingField(null);
  };

  const removeChip = (field: FilterFieldDef): void => {
    if (openChipId === field.id || pendingField?.id === field.id) {
      handleChipOpenChange(field.id, false);
    }
    if (field.id === 'overdue') {
      onOverdueChange(false);
      return;
    }
    onFiltersChange(removeFilterField(field.id, filters, field.field?.id));
  };

  const renderedChips = [
    ...chips,
    ...(pendingField && !inUse.has(pendingField.id)
      ? [{ ...pendingField, operator: 'is', value: 'any' }]
      : []),
  ];

  const groupLabel = groupByLabel(props.groupBy, props.groupingOptions);
  const activeGroupKey = optionKey(props.groupBy);
  const {
    standard: standardGroupChoices,
    customFields: customGroupChoices,
    activeCustom: activeCustomGroup,
  } = useMemo(
    () => splitGroupByChoices(props.groupingOptions, activeGroupKey),
    [props.groupingOptions, activeGroupKey],
  );
  const showGroupPill = showFilters && props.layoutView === 'kanban';

  const countLabel =
    ticketCount === null ? null : `${ticketCount} ${ticketCount === 1 ? 'ticket' : 'tickets'}`;

  return (
    <div className='flex-shrink-0 border-b border-border/60 bg-background'>
      <div className='flex flex-wrap items-center justify-end gap-x-2.5 gap-y-2.5 px-5 pb-2.5 pt-3'>
        <div className='flex min-w-0 shrink items-center gap-2.5'>
          {startSlot}
          {star && (
            <Tooltip
              content={star.isStarred ? 'Remove from starred' : 'Add to starred'}
              side='bottom'
            >
              <button
                type='button'
                onClick={star.onToggle}
                aria-label={star.isStarred ? 'Remove from starred' : 'Add to starred'}
                className={cn(
                  'flex size-[26px] shrink-0 items-center justify-center rounded-[7px] transition-[opacity,background-color] hover:bg-muted hover:opacity-100',
                  star.isStarred
                    ? 'text-status-pending opacity-100'
                    : 'text-muted-foreground/80 opacity-60',
                )}
                data-track-category='Projects'
                data-track-name='StarView'
              >
                <Star className='size-[15px]' {...(star.isStarred ? { variant: 'Solid' } : {})} />
              </button>
            </Tooltip>
          )}
          <div className='flex min-w-0 items-baseline gap-2'>
            <span className='truncate text-[17px] font-semibold tracking-[-0.2px] text-foreground'>
              {title}
            </span>
            {countLabel && (
              <>
                <span className='text-[12.5px] text-muted-foreground/40'>·</span>
                <span
                  className={cn(
                    'whitespace-nowrap font-mono text-[12.5px]',
                    isFiltered ? 'text-muted-foreground' : 'text-muted-foreground/60',
                  )}
                  data-testid='tickets-header-count'
                >
                  {countLabel}
                </span>
              </>
            )}
          </div>
        </div>
        <div className='min-w-0 flex-1' />
        <div className='ml-auto flex min-w-0 flex-nowrap items-center gap-2'>
          <div
            className={cn(
              'flex h-[30px] min-w-[96px] max-w-[220px] flex-[0_1_220px] items-center gap-2 rounded-lg border px-2.5 text-muted-foreground/80 transition-colors focus-within:border-muted-foreground/40 hover:border-muted-foreground/40',
              searchValue ? 'border-muted-foreground/40' : 'border-border',
            )}
          >
            <Search className='size-[14px] shrink-0' />
            <input
              ref={searchRef}
              type='text'
              value={searchValue}
              onChange={e => onSearchChange(e.target.value)}
              placeholder='Search'
              aria-label='Search Tickets'
              className='min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/60'
              data-track-category='Tickets'
              data-track-name='SearchTickets'
            />
            {searchValue && (
              <button
                type='button'
                onClick={() => onSearchChange('')}
                aria-label='Clear search'
                data-track-category='Tickets'
                data-track-name='ClearTicketSearch'
                className='text-[13px] leading-none text-muted-foreground/60 hover:text-foreground'
              >
                ×
              </button>
            )}
            <Tooltip content={isExactSearch ? TURN_OFF_EXACT_SEARCH : TURN_ON_EXACT_SEARCH}>
              <button
                type='button'
                onClick={() => {
                  const next = !isExactSearch;
                  pendingCaretRef.current = next && !searchValue.trim();
                  onExactSearchChange(next);
                  searchRef.current?.focus();
                }}
                aria-pressed={isExactSearch}
                aria-label={isExactSearch ? TURN_OFF_EXACT_SEARCH : TURN_ON_EXACT_SEARCH}
                className={cn(
                  'shrink-0 rounded px-1 text-[11px] font-semibold leading-[18px] transition-colors',
                  isExactSearch
                    ? 'bg-[var(--desk-accent-badge-bg)] text-[var(--ticket-accent)]'
                    : 'text-muted-foreground/60 hover:text-foreground',
                )}
                data-track-category='Tickets'
                data-track-name='ToggleExactTicketSearch'
                data-track-metadata={JSON.stringify({ exact: !isExactSearch })}
              >
                &quot;ab&quot;
              </button>
            </Tooltip>
          </div>
          <CustomiseViewPopover
            layoutView={props.layoutView}
            onLayoutChange={props.onLayoutChange}
            showLayoutPicker={props.showLayoutPicker}
            showCalendarLayout={props.showCalendarLayout}
            groupBy={props.groupBy}
            groupingOptions={props.groupingOptions}
            onGroupByChange={props.onGroupByChange}
            columns={props.columns}
            visibleColumns={props.visibleColumns}
            onColumnVisibilityChange={props.onColumnVisibilityChange}
            onResetColumns={props.onResetColumns}
            isComfortView={props.isComfortView}
            onComfortViewChange={props.onComfortViewChange}
            savedFilters={props.savedFilters ?? null}
            showGroupBy={!showGroupPill}
          />
          <span className='mx-0.5 h-[18px] w-px shrink-0 bg-border' />
          {share && <ShareViewPopover viewId={share.viewId} viewName={share.viewName} />}
          {onLinkBoards && (
            <button
              type='button'
              onClick={onLinkBoards}
              data-testid='kanban-link-boards-button'
              data-track-event='BUTTON_CLICK'
              data-track-category='Channel'
              data-track-name='OPEN_LINK_BOARDS'
              data-track-metadata={linkBoardsMetadata}
              className='ml-0.5 flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted'
            >
              <Layers className='size-[14px]' strokeWidth={2} />
              Link boards
            </button>
          )}
          {onCreateTicket && (
            <button
              type='button'
              onClick={onCreateTicket}
              data-testid='kanban-create-ticket-button'
              data-track-event='BUTTON_CLICK'
              data-track-category='Tickets'
              data-track-name='CREATE_TICKET_KANBAN'
              data-track-metadata={createTicketMetadata}
              className='ml-0.5 flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-foreground px-3 text-[12.5px] font-semibold text-background transition-opacity hover:opacity-90'
            >
              <Plus className='size-[14px]' strokeWidth={2} />
              New ticket
            </button>
          )}
        </div>
      </div>

      {showFilters && (
        <div className='flex min-h-[40px] flex-wrap items-center gap-x-2 gap-y-[7px] bg-muted/50 px-5 py-[7px]'>
          <BoardsChip
            filters={filters}
            onFiltersChange={onFiltersChange}
            ctx={pickerContext}
            workspaceView={workspaceView}
          />
          {renderedChips.map(chip => {
            const Icon = chip.icon;
            return (
              <FilterChip
                key={chip.id}
                testId={`filter-chip-${chip.id}`}
                label={chip.label}
                icon={<Icon />}
                operator={chip.operator}
                value={chip.value}
                mono={chip.mono}
                onRemove={() => removeChip(chip)}
                {...(chip.isFlag
                  ? {}
                  : {
                      open: openChipId === chip.id,
                      onOpenChange: (open: boolean) => handleChipOpenChange(chip.id, open),
                      picker: (
                        <FilterValuePicker
                          field={chip}
                          filters={filters}
                          onFiltersChange={onFiltersChange}
                          ctx={pickerContext}
                          onClose={() => handleChipOpenChange(chip.id, false)}
                        />
                      ),
                    })}
              />
            );
          })}
          <AddFilterChip
            fields={fields}
            inUse={inUse}
            onPick={handlePickField}
            open={addOpen}
            onOpenChange={setAddOpen}
          />
          {hasChips && (
            <button
              type='button'
              onClick={onClearFilters}
              className='px-1 text-[12px] font-medium text-muted-foreground/80 hover:text-foreground'
              data-track-category='Tickets'
              data-track-name='ClearAllFiltersDropdown'
              data-testid='clear-filters-btn'
            >
              Clear
            </button>
          )}
          {viewSave && viewSave.isDirty && (
            <>
              <button
                type='button'
                onClick={viewSave.onReset}
                title='Back to the saved filters for this view'
                aria-label='Discard unsaved changes'
                className='flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-full border border-border px-2.5 text-[12px] font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground'
                data-track-category='Projects'
                data-track-name='ResetView'
              >
                Reset
              </button>
              {viewSave.canSaveInPlace ? (
                <button
                  type='button'
                  onClick={viewSave.onSave}
                  disabled={!viewSave.ready || viewSave.saving}
                  title='Save these filters to this view'
                  className='flex h-[26px] shrink-0 animate-in fade-in-0 items-center whitespace-nowrap rounded-full bg-foreground px-[11px] text-[12px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50'
                  data-track-category='Projects'
                  data-track-name='SaveView'
                >
                  Save
                </button>
              ) : (
                <Popover
                  open={viewSave.namePopoverOpen}
                  onOpenChange={viewSave.onNamePopoverOpenChange}
                  align='start'
                  className='w-64 p-3'
                  trigger={
                    <button
                      type='button'
                      disabled={!viewSave.ready || viewSave.saving}
                      className='flex h-[26px] shrink-0 animate-in fade-in-0 items-center whitespace-nowrap rounded-full bg-foreground px-[11px] text-[12px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50'
                      data-track-category='Projects'
                      data-track-name='SaveView'
                    >
                      Save view
                    </button>
                  }
                >
                  <div className='flex flex-col gap-2'>
                    <span className='text-[13px] font-medium text-foreground'>Name this view</span>
                    <input
                      autoFocus
                      value={viewSave.nameDraft}
                      onChange={e => viewSave.onNameDraftChange(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') viewSave.onConfirmSave();
                      }}
                      placeholder='e.g. My open PRs'
                      data-track-category='Projects'
                      data-track-name='SaveViewNameInput'
                      className={cn(
                        'h-8 px-2 rounded-md border border-input bg-background text-[13px]',
                        'text-foreground outline-none placeholder:text-muted-foreground',
                        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      )}
                    />
                    <div className='flex justify-end gap-2 pt-1'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => viewSave.onNamePopoverOpenChange(false)}
                        data-track-category='Tickets'
                        data-track-name='CANCEL_SAVE_WORKSPACE_VIEW'
                      >
                        Cancel
                      </Button>
                      <Button
                        size='sm'
                        onClick={viewSave.onConfirmSave}
                        data-track-category='Tickets'
                        data-track-name='CONFIRM_SAVE_WORKSPACE_VIEW'
                        disabled={!viewSave.nameDraft.trim() || viewSave.saving}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                </Popover>
              )}
            </>
          )}
          <div className='flex-1' />
          {showGroupPill && (
            <PopoverPrimitive.Root
              open={groupOpen}
              onOpenChange={next => {
                setGroupOpen(next);
                if (!next) setGroupCustomOpen(false);
              }}
            >
              <PopoverPrimitive.Trigger asChild>
                <button
                  type='button'
                  className={cn(
                    rowPillClass,
                    groupOpen
                      ? 'border-muted-foreground/40 text-foreground'
                      : 'border-transparent text-muted-foreground',
                  )}
                  data-testid='group-by-dropdown'
                  data-track-category='Tickets'
                  data-track-name='OpenGroupByMenu'
                >
                  Group: {groupLabel}
                  <ChevronDown className='size-[11px] opacity-70' />
                </button>
              </PopoverPrimitive.Trigger>
              <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                  side='bottom'
                  align='end'
                  sideOffset={6}
                  className={cn(menuClass, 'w-[196px] rounded-[9px]')}
                >
                  {standardGroupChoices.map(choice => {
                    const active = choice.key === activeGroupKey;
                    return (
                      <button
                        key={choice.key}
                        type='button'
                        onClick={() => {
                          props.onGroupByChange(choice.value);
                          setGroupOpen(false);
                          setGroupCustomOpen(false);
                        }}
                        className={cn(menuRowClass, active && 'font-semibold text-foreground')}
                        data-testid={`group-by-${choice.testId}`}
                        data-track-category='Tickets'
                        data-track-name='SetGroupBy'
                      >
                        <span className='min-w-0 flex-1 truncate'>{choice.label}</span>
                        {active && <Check className='size-[13px]' />}
                      </button>
                    );
                  })}
                  {customGroupChoices.length > 0 && (
                    <PopoverPrimitive.Root open={groupCustomOpen} onOpenChange={setGroupCustomOpen}>
                      <PopoverPrimitive.Trigger asChild>
                        <button
                          type='button'
                          className={cn(
                            menuRowClass,
                            (groupCustomOpen || activeCustomGroup) && 'text-foreground',
                            activeCustomGroup && 'font-semibold',
                          )}
                          data-testid='group-by-custom-fields'
                          data-track-category='Tickets'
                          data-track-name='OpenGroupByCustomFields'
                          data-track-metadata={JSON.stringify({
                            fieldCount: customGroupChoices.length,
                          })}
                        >
                          <span className='min-w-0 flex-1 truncate'>Custom fields</span>
                          {activeCustomGroup && (
                            <span className='max-w-[80px] truncate text-[11px] text-muted-foreground'>
                              {activeCustomGroup.label}
                            </span>
                          )}
                          <ChevronRight className='size-[11px] shrink-0 opacity-60' />
                        </button>
                      </PopoverPrimitive.Trigger>
                      <PopoverPrimitive.Portal>
                        <PopoverPrimitive.Content
                          side='left'
                          align='start'
                          sideOffset={6}
                          collisionPadding={12}
                          onOpenAutoFocus={e => e.preventDefault()}
                          // Opens left: this pill sits at the header's right edge.
                          className={cn(menuClass, 'z-[70] w-[196px] rounded-[9px]')}
                        >
                          <div className='max-h-[306px] overflow-y-auto'>
                            {customGroupChoices.map(choice => {
                              const active = choice.key === activeGroupKey;
                              return (
                                <button
                                  key={choice.key}
                                  type='button'
                                  onClick={() => {
                                    props.onGroupByChange(choice.value);
                                    setGroupCustomOpen(false);
                                    setGroupOpen(false);
                                  }}
                                  className={cn(
                                    menuRowClass,
                                    active && 'font-semibold text-foreground',
                                  )}
                                  data-testid={`group-by-${choice.testId}`}
                                  data-track-category='Tickets'
                                  data-track-name='SetGroupBy'
                                >
                                  <span className='min-w-0 flex-1 truncate'>{choice.label}</span>
                                  {active && <Check className='size-[13px]' />}
                                </button>
                              );
                            })}
                          </div>
                        </PopoverPrimitive.Content>
                      </PopoverPrimitive.Portal>
                    </PopoverPrimitive.Root>
                  )}
                </PopoverPrimitive.Content>
              </PopoverPrimitive.Portal>
            </PopoverPrimitive.Root>
          )}
          {(onExport || onOpenTicketReport) && (
            <PopoverPrimitive.Root open={exportOpen} onOpenChange={setExportOpen}>
              <PopoverPrimitive.Trigger asChild>
                <button
                  type='button'
                  className={cn(
                    rowPillClass,
                    exportOpen
                      ? 'border-muted-foreground/40 text-foreground'
                      : 'border-transparent text-muted-foreground',
                  )}
                  data-track-category='Tickets'
                  data-track-name='OpenTableExportMenu'
                >
                  <Download className='size-[14px]' />
                  Export
                  <ChevronDown className='size-[11px] opacity-70' />
                </button>
              </PopoverPrimitive.Trigger>
              <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                  side='bottom'
                  align='end'
                  sideOffset={6}
                  className={cn(menuClass, 'w-[232px] rounded-[11px]')}
                >
                  {onExport && (
                    <>
                      {(
                        [
                          ['download-csv', 'Download CSV', 'DownloadTicketsCsv'],
                          ['download-json', 'Download JSON', 'DownloadTicketsJson'],
                        ] as const
                      ).map(([action, label, track]) => (
                        <button
                          key={action}
                          type='button'
                          onClick={() => {
                            onExport(action);
                            setExportOpen(false);
                          }}
                          className={menuRowClass}
                          data-track-category='Tickets'
                          data-track-name={track}
                        >
                          {label}
                        </button>
                      ))}
                      <div className='my-1 h-px bg-border/60' />
                      {(
                        [
                          ['copy-csv', 'Copy to clipboard (CSV)', 'CopyTicketsCsv'],
                          ['copy-json', 'Copy to clipboard (JSON)', 'CopyTicketsJson'],
                        ] as const
                      ).map(([action, label, track]) => (
                        <button
                          key={action}
                          type='button'
                          onClick={() => {
                            onExport(action);
                            setExportOpen(false);
                          }}
                          className={menuRowClass}
                          data-track-category='Tickets'
                          data-track-name={track}
                        >
                          {label}
                        </button>
                      ))}
                    </>
                  )}
                  {onOpenTicketReport && (
                    <>
                      {onExport && <div className='my-1 h-px bg-border/60' />}
                      <button
                        type='button'
                        onClick={() => {
                          onOpenTicketReport();
                          setExportOpen(false);
                        }}
                        className={menuRowClass}
                        data-track-category='TicketReports'
                        data-track-name='OpenTicketReports'
                      >
                        Ticket report…
                      </button>
                    </>
                  )}
                </PopoverPrimitive.Content>
              </PopoverPrimitive.Portal>
            </PopoverPrimitive.Root>
          )}
        </div>
      )}
    </div>
  );
};
