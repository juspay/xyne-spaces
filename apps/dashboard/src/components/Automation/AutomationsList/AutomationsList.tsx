import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Archive } from 'lucide-react';
import {
  ChatDefault,
  ChevronLeft,
  ChevronRight,
  ChevronSortVertical,
  CopyDefault,
  DeleteDustbin01,
  EnvelopeDefault,
  LightningThunderElectricOn,
  LinkHorizontal,
  PencilEditBox,
  PencilEdit,
  PhoneDefault,
  PlusDefault,
  ReminderClockwise,
  SearchDefault,
  SendPlaneHorizontal,
  Spinner,
  Tag,
  ThreeDotsMenuHorizontal,
  TicketToken,
  Webhook,
} from '@xyne/icons';
import { toast } from 'sonner';
import { cn } from '../../../utils/classNames';
import { Button } from '../../ui/Button/Button';
import { Dialog } from '../../ui/Dialog/Dialog';
import Input from '../../ui/Input/Input';
import { Popover } from '../../ui/Popover/Popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/Select/Select';
import { Switch } from '../../ui/Switch';
import { Tooltip } from '../../ui/Tooltip';
import Avatar from '../../ui/Avatar/Avatar';
import { fetchTriggerCatalog } from '../../../api/automationsApi';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { useSelf, useUser } from '../../../hooks/useUsers';
import { useZero } from '../../../hooks/useZero';
import { useIsAutomationsAdmin } from '../useIsAutomationsAdmin';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import type { Automation } from '../Automation.types';
import { AutomationStatusValues, isLiveStatus } from '../Automation.types';
import { workflowToAutomation } from '../automation.adapter';
import type { AutomationsListProps } from './AutomationsList.types';
import {
  automationTriggerIconName,
  DEFAULT_AUTOMATION_SORT,
  formatRelative,
  sortAutomations,
  statusPillClasses,
  summarizeAutomation,
  type AutomationSort,
  type AutomationSortDirection,
  type AutomationSortField,
} from './AutomationsList.utils';
import { AutomationFiltersBar } from './AutomationFiltersBar/AutomationFiltersBar';
import {
  DEFAULT_AUTOMATION_FILTERS,
  filterAutomations,
  hasActiveFilters,
  isVisibleToUser,
  type AutomationFilters,
} from './AutomationFiltersBar/filters';

export function AutomationsList({
  onCreate,
  onOpen,
  onShowRuns,
  initialChannelIds,
  onClone,
  onEditFork,
}: AutomationsListProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<AutomationFilters>(() =>
    initialChannelIds?.length
      ? { ...DEFAULT_AUTOMATION_FILTERS, channelIds: initialChannelIds }
      : DEFAULT_AUTOMATION_FILTERS,
  );
  const [sort, setSort] = useState<AutomationSort>(DEFAULT_AUTOMATION_SORT);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null);
  const [pendingDisable, setPendingDisable] = useState<Automation | null>(null);
  const me = useSelf();
  const zero = useZero();
  const navigate = useNavigate();
  const isAutomationsAdmin = useIsAutomationsAdmin();
  const { workspaceId } = useAuthContextValues();

  const triggerCatalogQuery = useQuery({
    queryKey: ['automations', 'schema', 'triggers'],
    queryFn: fetchTriggerCatalog,
    staleTime: 5 * 60 * 1000,
  });
  const triggerCatalog = triggerCatalogQuery.data ?? [];

  const [rows, rowsMeta] = useCachedQuery(queries.automationsList({ workspaceId }));
  const isLoading = !rows || rowsMeta?.type !== 'complete';
  const adapted: Automation[] = useMemo(() => (rows ?? []).map(workflowToAutomation), [rows]);

  const visibleItems: Automation[] = useMemo(() => {
    const meId = me?.id ?? null;
    return adapted.filter(a => isVisibleToUser(a, meId));
  }, [adapted, me]);

  // Authors of any version that went live (current or superseded) may toggle it.
  const lineageAuthorIds = useMemo(() => {
    const bySeries = new Map<string, Set<string>>();
    for (const a of adapted) {
      if (!isLiveStatus(a.status) && a.status !== AutomationStatusValues.ARCHIVED) continue;
      const seriesId = a.automationSeriesId ?? a.id;
      const set = bySeries.get(seriesId) ?? new Set<string>();
      set.add(a.createdById);
      bySeries.set(seriesId, set);
    }
    return bySeries;
  }, [adapted]);
  const isLineageAuthor = (item: Automation): boolean =>
    !!me && (lineageAuthorIds.get(item.automationSeriesId ?? item.id)?.has(me.id) ?? false);

  const deleteMutation = useMutation({
    mutationFn: (id: string): Promise<void> => {
      zero.mutate(mutators.automations.delete({ id }));
      return Promise.resolve();
    },
    onSuccess: () => {
      toast.success('Automation deleted');
    },
    onError: err => {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: string): Promise<void> => {
      zero.mutate(mutators.automations.activate({ id, timestamp: Date.now() }));
      toast.success('Automation activated');
      return Promise.resolve();
    },
    onError: err => {
      toast.error(err instanceof Error ? err.message : 'Activation failed');
    },
  });
  const disableMutation = useMutation({
    mutationFn: ({ id, cancelQueued }: { id: string; cancelQueued: boolean }): Promise<void> => {
      zero.mutate(mutators.automations.disable({ id, timestamp: Date.now(), cancelQueued }));
      toast.success(
        cancelQueued ? 'Automation disabled, queued runs will not fire' : 'Automation disabled',
      );
      return Promise.resolve();
    },
    onError: err => {
      toast.error(err instanceof Error ? err.message : 'Disable failed');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string): Promise<void> => {
      zero.mutate(mutators.automations.archive({ id, timestamp: Date.now() }));
      toast.success('Automation archived');
      return Promise.resolve();
    },
    onError: err => {
      toast.error(err instanceof Error ? err.message : 'Archive failed');
    },
  });

  const handleClone = (item: Automation): void => {
    if (onClone) {
      onClone(item);
      return;
    }
    void navigate(`/automations/new?fork=${item.id}&clone=1`);
  };

  const handleEdit = (item: Automation): void => {
    if (item.status === AutomationStatusValues.DRAFT) {
      onOpen(item);
      return;
    }
    if (onEditFork) {
      onEditFork(item);
      return;
    }
    void navigate(`/automations/new?fork=${item.id}`);
  };
  const filtered = useMemo(
    () => sortAutomations(filterAutomations(visibleItems, query, filters), sort),
    [visibleItems, query, filters, sort],
  );

  useEffect(() => setPage(1), [query, filters, sort]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  const hasAnyFilter = hasActiveFilters(query, filters);

  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <header className='sticky top-0 z-10 flex flex-col gap-4 border-b border-border bg-background px-6 pt-5 pb-4'>
        <div className='flex items-center gap-5'>
          <div className='flex min-w-0 flex-1 flex-col gap-1'>
            <h1 className='text-2xl font-semibold leading-[1.2] tracking-[-0.24px] text-foreground'>
              Automations
            </h1>
            <p className='text-[15px] leading-[1.2] text-muted-foreground'>
              Create and manage workflows that react to events across your workspace.
            </p>
          </div>
          <Button
            onClick={onCreate}
            data-track-category='automations-list'
            data-track-name='CREATE_AUTOMATION'
            className='shrink-0 font-semibold'
          >
            <PlusDefault className='size-4' />
            New automation
          </Button>
        </div>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <div className='relative w-56 max-w-full'>
              <SearchDefault
                aria-hidden='true'
                className='pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground'
              />
              <Input
                type='search'
                aria-label='Search automations'
                placeholder='Search automations…'
                value={query}
                onChange={e => setQuery(e.target.value)}
                className='h-8 rounded-md pl-8 text-xs'
              />
            </div>
            <AutomationFiltersBar
              query={query}
              filters={filters}
              onChange={setFilters}
              onClearQuery={() => setQuery('')}
              items={visibleItems}
            />
          </div>
          <SortDropdown value={sort} onChange={setSort} />
        </div>
      </header>

      <div className='flex-1 overflow-y-auto bg-muted/30'>
        <div className='mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-6'>
          {!isLoading && filtered.length > 0 && (
            <p className='text-xs text-muted-foreground'>
              {filtered.length === visibleItems.length
                ? `${filtered.length} ${filtered.length === 1 ? 'automation' : 'automations'}`
                : `${filtered.length} of ${visibleItems.length} automations`}
            </p>
          )}
          {isLoading && visibleItems.length === 0 ? (
            <div className='flex items-center justify-center py-12 text-sm text-muted-foreground'>
              <Spinner className='mr-2 size-4 animate-spin' />
              Loading automations…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState hasFilter={hasAnyFilter} onCreate={onCreate} />
          ) : (
            <ul className='flex flex-col gap-3'>
              {pageItems.map(item => (
                <AutomationRow
                  key={item.id}
                  automation={item}
                  summary={summarizeAutomation(item, triggerCatalog)}
                  triggerIconName={automationTriggerIconName(item, triggerCatalog)}
                  onOpen={() => onOpen(item)}
                  onEdit={() => handleEdit(item)}
                  onShowRuns={onShowRuns ? () => onShowRuns(item) : undefined}
                  onClone={() => handleClone(item)}
                  onDelete={() => setPendingDelete(item)}
                  onArchive={
                    isAutomationsAdmin && item.status === AutomationStatusValues.DISABLED
                      ? () => archiveMutation.mutate(item.id)
                      : undefined
                  }
                  onToggleActive={
                    isLiveStatus(item.status) &&
                    (item.status === AutomationStatusValues.DISABLED ||
                      (item.status === AutomationStatusValues.ACTIVE &&
                        (isAutomationsAdmin || isLineageAuthor(item))))
                      ? next => (next ? activateMutation.mutate(item.id) : setPendingDisable(item))
                      : undefined
                  }
                  toggleLoading={
                    (activateMutation.isPending && activateMutation.variables === item.id) ||
                    (disableMutation.isPending && disableMutation.variables?.id === item.id)
                  }
                />
              ))}
            </ul>
          )}
          {filtered.length > 0 && (
            <PaginationBar
              page={page}
              pageSize={pageSize}
              totalPages={totalPages}
              onPageChange={setPage}
              onPageSizeChange={size => {
                setPageSize(size);
                setPage(1);
              }}
            />
          )}
        </div>
      </div>

      <Dialog
        open={pendingDisable !== null}
        onOpenChange={open => {
          if (!open) setPendingDisable(null);
        }}
        title='Disable automation?'
        className='sm:max-w-md'
      >
        <div className='flex flex-col gap-2 px-5 py-4 text-sm'>
          <p className='text-base font-semibold text-foreground'>
            Disable {pendingDisable?.name || 'this automation'}?
          </p>
          <p className='text-muted-foreground'>What should happen to the runs already queued?</p>
          <div className='flex flex-wrap items-center justify-end gap-2 pt-4'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setPendingDisable(null)}
              data-track-category='automations-list'
              data-track-name='disable-cancel'
            >
              Cancel
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={disableMutation.isPending}
              onClick={() => {
                if (pendingDisable) {
                  disableMutation.mutate({ id: pendingDisable.id, cancelQueued: false });
                  setPendingDisable(null);
                }
              }}
              data-track-category='automations-list'
              data-track-name='disable-keep-queued'
            >
              Let them finish
            </Button>
            <Button
              variant='destructive'
              size='sm'
              disabled={disableMutation.isPending}
              loading={disableMutation.isPending}
              onClick={() => {
                if (pendingDisable) {
                  disableMutation.mutate({ id: pendingDisable.id, cancelQueued: true });
                  setPendingDisable(null);
                }
              }}
              data-track-category='automations-list'
              data-track-name='disable-cancel-queued'
            >
              Stop them
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={open => {
          if (!open) setPendingDelete(null);
        }}
        title='Delete automation?'
        className='sm:max-w-md'
      >
        <div className='flex flex-col gap-4 px-5 py-4 text-sm text-foreground'>
          <p>
            Delete <strong>{pendingDelete?.name || 'this automation'}</strong>? This can&apos;t be
            undone.
          </p>
          <div className='flex justify-end gap-2 pt-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setPendingDelete(null)}
              data-track-category='automations-list'
              data-track-name='delete-cancel'
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              size='sm'
              disabled={deleteMutation.isPending}
              loading={deleteMutation.isPending}
              onClick={() => {
                if (pendingDelete) {
                  deleteMutation.mutate(pendingDelete.id);
                  setPendingDelete(null);
                }
              }}
              data-track-category='automations-list'
              data-track-name='delete-confirm'
            >
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

const SORT_OPTIONS: {
  value: string;
  field: AutomationSortField;
  direction: AutomationSortDirection;
  label: string;
}[] = [
  {
    value: 'updatedAt-desc',
    field: 'updatedAt',
    direction: 'desc',
    label: 'Last updated (newest)',
  },
  { value: 'updatedAt-asc', field: 'updatedAt', direction: 'asc', label: 'Last updated (oldest)' },
  { value: 'createdAt-desc', field: 'createdAt', direction: 'desc', label: 'Created (newest)' },
  { value: 'createdAt-asc', field: 'createdAt', direction: 'asc', label: 'Created (oldest)' },
  { value: 'name-asc', field: 'name', direction: 'asc', label: 'Name (A–Z)' },
  { value: 'name-desc', field: 'name', direction: 'desc', label: 'Name (Z–A)' },
  { value: 'status-asc', field: 'status', direction: 'asc', label: 'Status' },
];

function SortDropdown({
  value,
  onChange,
}: {
  value: AutomationSort;
  onChange: (next: AutomationSort) => void;
}): React.ReactElement {
  const current = `${value.field}-${value.direction}`;
  return (
    <Select
      value={current}
      onValueChange={next => {
        const opt = SORT_OPTIONS.find(o => o.value === next);
        if (opt) onChange({ field: opt.field, direction: opt.direction });
      }}
    >
      <SelectTrigger
        size='sm'
        className='h-8 flex-shrink-0 gap-1.5 text-xs'
        aria-label='Sort automations'
      >
        <ChevronSortVertical className='size-3.5' aria-hidden='true' />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align='end'>
        {SORT_OPTIONS.map(opt => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const PAGE_SIZE_OPTIONS = [50, 100, 250, 500];

function PaginationBar({
  page,
  pageSize,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}): React.ReactElement {
  return (
    <div className='flex flex-shrink-0 items-center justify-between border-t border-border pt-3'>
      <div className='flex items-center gap-2'>
        <span className='text-xs text-muted-foreground'>Rows per page</span>
        <Select value={String(pageSize)} onValueChange={v => onPageSizeChange(Number(v))}>
          <SelectTrigger size='sm' className='h-8 w-[68px] text-xs' aria-label='Rows per page'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align='start'>
            {PAGE_SIZE_OPTIONS.map(size => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className='flex items-center gap-3'>
        <span className='text-xs text-muted-foreground'>
          Page {page} of {totalPages}
        </span>
        <Button
          variant='outline'
          size='iconSm'
          disabled={page <= 1}
          aria-label='Previous page'
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className='size-4' />
        </Button>
        <Button
          variant='outline'
          size='iconSm'
          disabled={page >= totalPages}
          aria-label='Next page'
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className='size-4' />
        </Button>
      </div>
    </div>
  );
}

function EmptyState({
  hasFilter,
  onCreate,
}: {
  hasFilter: boolean;
  onCreate: () => void;
}): React.ReactElement {
  if (hasFilter) {
    return (
      <div className='py-12 text-center text-sm text-muted-foreground'>
        No automations match your search.
      </div>
    );
  }
  return (
    <div className='mx-auto max-w-md py-16 text-center'>
      <div className='mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400'>
        <LightningThunderElectricOn className='size-6' />
      </div>
      <h2 className='mb-1 text-base font-medium text-foreground'>No automations yet</h2>
      <p className='mb-4 text-sm text-muted-foreground'>
        Build a no-code workflow that runs on a trigger — a schedule, a manual click, or an event
        from your workspace.
      </p>
      <Button
        size='sm'
        onClick={onCreate}
        data-track-category='automations-list'
        data-track-name='CREATE_AUTOMATION'
      >
        <PlusDefault className='size-4' />
        Create your first automation
      </Button>
    </div>
  );
}

/** Maps each trigger's backend-assigned icon name (see `automationTriggerIconName`) to its @xyne/icons equivalent, so the row icon actually reflects what the automation fires on. */
const TRIGGER_ICON_BY_NAME: Record<string, typeof LightningThunderElectricOn> = {
  Phone: PhoneDefault,
  Mail: EnvelopeDefault,
  Send: SendPlaneHorizontal,
  Tag,
  MessageSquare: ChatDefault,
  Ticket: TicketToken,
  PenSquare: PencilEditBox,
  Webhook,
};

interface AutomationRowProps {
  automation: Automation;
  summary: string;
  triggerIconName: string | undefined;
  onOpen: () => void;
  onEdit: () => void;
  onShowRuns?: (() => void) | undefined;
  onClone: () => void;
  onDelete: () => void;
  onArchive?: (() => void) | undefined;
  onToggleActive?: ((next: boolean) => void) | undefined;
  toggleLoading: boolean;
}

function AutomationRow({
  automation,
  summary,
  triggerIconName,
  onOpen,
  onEdit,
  onShowRuns,
  onClone,
  onDelete,
  onArchive,
  onToggleActive,
  toggleLoading,
}: AutomationRowProps): React.ReactElement {
  const TriggerIcon =
    (triggerIconName && TRIGGER_ICON_BY_NAME[triggerIconName]) || LightningThunderElectricOn;
  const [menuOpen, setMenuOpen] = useState(false);
  const isActive = automation.status === 'ACTIVE';
  const creator = useUser(automation.createdById);
  const shareableOrigin = useShareableOrigin();

  const handleCopyLink = (): void => {
    void navigator.clipboard
      .writeText(`${shareableOrigin}/automations/${automation.id}`)
      .then(() => toast.success('Link copied'))
      .catch(() => toast.error('Could not copy link'));
  };

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-row-stop]')) return;
    onOpen();
  };

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  };

  return (
    <li>
      <div
        role='button'
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
        data-track-category='automations-list'
        data-track-name='row-open'
        className={cn(
          'group flex cursor-pointer flex-col gap-2 rounded-xl border border-border bg-background px-4 py-3 transition-colors',
          'hover:border-foreground/20 hover:bg-muted/40',
          'focus-visible:outline-none focus-visible:bg-muted/40',
        )}
      >
        <div className='flex items-start gap-3'>
          <div
            aria-hidden='true'
            className='flex size-9 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400'
          >
            <TriggerIcon className='size-4' />
          </div>
          <button
            type='button'
            onClick={e => {
              e.stopPropagation();
              onOpen();
            }}
            aria-label={`${automation.name}, ${automation.status.toLowerCase()}. ${summary}. Press Enter to edit.`}
            data-track-category='automations-list'
            data-track-name='row-title-open'
            className={cn(
              'flex flex-1 flex-col gap-1 min-w-0 cursor-pointer text-left',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 rounded-md',
            )}
          >
            <div className='flex flex-wrap items-center gap-2'>
              <span
                className='truncate text-sm font-semibold text-foreground'
                title={automation.name}
              >
                {automation.name}
              </span>
              <span
                className={cn(
                  'rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  statusPillClasses(automation.status),
                )}
              >
                {automation.status}
              </span>
            </div>
            <p className='line-clamp-2 text-xs text-muted-foreground' title={summary}>
              {summary}
            </p>
            {automation.description && (
              <p
                className='line-clamp-1 text-xs italic text-muted-foreground/80'
                title={automation.description}
              >
                {automation.description}
              </p>
            )}
          </button>

          <div data-row-stop className='flex items-center gap-2'>
            {onToggleActive ? (
              <Tooltip content={isActive ? 'Disable' : 'Activate'} side='top'>
                <Switch
                  checked={isActive}
                  disabled={toggleLoading}
                  aria-label={
                    isActive
                      ? `Disable automation ${automation.name}`
                      : `Activate automation ${automation.name}`
                  }
                  onCheckedChange={onToggleActive}
                />
              </Tooltip>
            ) : null}
            <Popover
              open={menuOpen}
              onOpenChange={setMenuOpen}
              align='end'
              side='bottom'
              sideOffset={4}
              className='w-[180px] rounded-md p-1'
              trigger={
                <button
                  type='button'
                  aria-label={`Actions for ${automation.name}`}
                  aria-haspopup='menu'
                  aria-expanded={menuOpen}
                  title='More actions'
                  data-track-category='automations-list'
                  data-track-name='row-menu-open'
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground',
                    'hover:text-foreground hover:bg-accent/40',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
                  )}
                >
                  <ThreeDotsMenuHorizontal className='size-4' aria-hidden='true' />
                </button>
              }
            >
              {/* Editable from any status except one that's actively under
                  review — matches the builder's canEdit. Non-draft rows fork a
                  new proposal. */}
              {automation.status !== AutomationStatusValues.PENDING_APPROVAL && (
                <RowMenuButton
                  label='Edit'
                  icon={<PencilEdit className='size-4' />}
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit();
                  }}
                />
              )}
              <RowMenuButton
                label='Clone'
                icon={<CopyDefault className='size-4' />}
                onClick={() => {
                  setMenuOpen(false);
                  onClone();
                }}
              />
              <RowMenuButton
                label='Copy link'
                icon={<LinkHorizontal className='size-4' />}
                onClick={() => {
                  setMenuOpen(false);
                  handleCopyLink();
                }}
              />
              {onShowRuns && (
                <RowMenuButton
                  label='Run history'
                  icon={<ReminderClockwise className='size-4' />}
                  onClick={() => {
                    setMenuOpen(false);
                    onShowRuns();
                  }}
                />
              )}
              {/* Admin-only: permanently retire a live automation. */}
              {onArchive && (
                <RowMenuButton
                  label='Archive'
                  icon={<Archive className='size-4' />}
                  onClick={() => {
                    setMenuOpen(false);
                    onArchive();
                  }}
                />
              )}
              {/* Delete is permitted only for DRAFT proposals — anything past
                  DRAFT (PENDING, LIVE, ARCHIVED, terminal) is kept as audit
                  history. */}
              {automation.status === AutomationStatusValues.DRAFT ? (
                <>
                  <div role='separator' className='my-1 h-px bg-border' />
                  <RowMenuButton
                    label='Delete'
                    danger
                    icon={<DeleteDustbin01 className='size-4' />}
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                  />
                </>
              ) : null}
            </Popover>
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-x-3 gap-y-1 pl-12 text-[11px] text-muted-foreground'>
          {automation.createdById && (
            <span className='inline-flex items-center gap-1.5'>
              <Avatar userId={automation.createdById} size='xs' />
              <span>by {creator?.name ?? creator?.email ?? 'unknown'}</span>
            </span>
          )}
          <span aria-hidden='true' className='text-muted-foreground/40'>
            ·
          </span>
          <span>
            {automation.config?.steps?.length ?? 0}{' '}
            {automation.config?.steps?.length === 1 ? 'action' : 'actions'}
          </span>
          <span aria-hidden='true' className='text-muted-foreground/40'>
            ·
          </span>
          <span>Updated {formatRelative(automation.updatedAt)}</span>
        </div>
      </div>
    </li>
  );
}

function RowMenuButton({
  label,
  icon,
  onClick,
  danger,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}): React.ReactElement {
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    onClick();
  };
  return (
    <button
      type='button'
      onClick={handleClick}
      data-track-category='automations-list'
      data-track-name={`row-menu-${label.toLowerCase().replace(/\s+/g, '-')}`}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
        danger ? 'text-red-600 hover:bg-red-500/10' : 'text-foreground hover:bg-accent/40',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
