import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Archive,
  Check,
  History,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../../utils/classNames';
import { Button } from '../../ui/Button/Button';
import { Dialog } from '../../ui/Dialog/Dialog';
import Input from '../../ui/Input/Input';
import { Popover } from '../../ui/Popover/Popover';
import { Switch } from '../../ui/Switch';
import { Tooltip } from '../../ui/Tooltip';
import Avatar from '../../ui/Avatar/Avatar';
import { fetchStepCatalog, fetchTriggerCatalog } from '../../../api/automationsApi';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useSelf, useUser } from '../../../hooks/useUsers';
import { useZero } from '../../../hooks/useZero';
import { useIsAutomationsAdmin } from '../useIsAutomationsAdmin';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import type { Automation } from '../Automation.types';
import { AutomationStatusValues, isLiveStatus, isProposalStatus } from '../Automation.types';
import { workflowToAutomation } from '../automation.adapter';
import type { AutomationsListProps } from './AutomationsList.types';
import {
  categoryForTrigger,
  filterAutomations,
  formatRelative,
  LIST_CATEGORIES,
  LIST_CATEGORY_DESCRIPTIONS,
  LIST_CATEGORY_LABELS,
  statusPillClasses,
  summarizeAutomation,
  type ListCategory,
} from './AutomationsList.utils';

function isHistoryRow(a: Automation): boolean {
  return (
    a.status === AutomationStatusValues.ARCHIVED ||
    a.status === AutomationStatusValues.REJECTED ||
    a.status === AutomationStatusValues.REVOKED ||
    a.status === AutomationStatusValues.AUTO_REVOKED
  );
}

export function AutomationsList({
  onCreate,
  onOpen,
  onShowRuns,
  filterPredicate,
}: AutomationsListProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ListCategory>('all');
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null);
  const me = useSelf();
  const zero = useZero();
  const navigate = useNavigate();
  const isAutomationsAdmin = useIsAutomationsAdmin();
  const { workspaceId } = useAuthContextValues();
  const isArchivedTab = category === 'archived';

  const triggerCatalogQuery = useQuery({
    queryKey: ['automations', 'schema', 'triggers'],
    queryFn: fetchTriggerCatalog,
    staleTime: 5 * 60 * 1000,
  });
  const stepCatalogQuery = useQuery({
    queryKey: ['automations', 'schema', 'steps'],
    queryFn: fetchStepCatalog,
    staleTime: 5 * 60 * 1000,
  });
  const triggerCatalog = triggerCatalogQuery.data ?? [];
  const stepCatalog = stepCatalogQuery.data ?? [];

  const [rows, rowsMeta] = useCachedQuery(queries.automationsList({ workspaceId }));
  const isLoading = !rows || rowsMeta?.type !== 'complete';
  const adapted: Automation[] = useMemo(() => {
    const mapped = (rows ?? []).map(workflowToAutomation);
    return filterPredicate ? mapped.filter(filterPredicate) : mapped;
  }, [rows, filterPredicate]);

  const items: Automation[] = useMemo(() => {
    if (isArchivedTab) {
      return adapted.filter(isHistoryRow);
    }
    const meId = me?.id ?? null;
    return adapted.filter(
      a =>
        isLiveStatus(a.status) ||
        (isProposalStatus(a.status) && !isHistoryRow(a) && meId !== null && a.createdById === meId),
    );
  }, [adapted, me, isArchivedTab]);

  const archivedCount = useMemo(() => adapted.filter(isHistoryRow).length, [adapted]);

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
    mutationFn: (id: string): Promise<void> => {
      zero.mutate(mutators.automations.disable({ id, timestamp: Date.now() }));
      toast.success('Automation disabled');
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

  const handleEdit = (item: Automation): void => {
    if (item.status === AutomationStatusValues.DRAFT) {
      onOpen(item);
      return;
    }
    void navigate(`/automations/new?fork=${item.id}`);
  };
  const liveItems = useMemo(() => {
    const meId = me?.id ?? null;
    return adapted.filter(
      a =>
        isLiveStatus(a.status) ||
        (isProposalStatus(a.status) && !isHistoryRow(a) && meId !== null && a.createdById === meId),
    );
  }, [adapted, me]);

  const counts = useMemo(() => {
    const out: Record<ListCategory, number> = {
      all: liveItems.length,
      tickets: 0,
      email: 0,
      archived: archivedCount,
    };
    for (const item of liveItems) {
      const c = categoryForTrigger(item.config?.trigger?.type);
      if (c !== 'all') out[c] += 1;
    }
    return out;
  }, [liveItems, archivedCount]);

  const categoryFiltered =
    category === 'all' || category === 'archived'
      ? items
      : items.filter(item => categoryForTrigger(item.config?.trigger?.type) === category);
  const filtered = filterAutomations(categoryFiltered, query);

  const hasAnyFilter = !!query.trim() || category !== 'all';

  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <div className='flex flex-col gap-3 border-b border-border px-6 py-4'>
        <div className='flex items-center gap-3'>
          <div className='flex flex-1 items-center gap-2'>
            <Zap className='size-5 text-foreground' />
            <h1 className='text-base font-semibold text-foreground'>Automations</h1>
          </div>
          <div className='relative w-[280px]'>
            <Search
              aria-hidden='true'
              className='pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
            />
            <Input
              type='search'
              aria-label='Search automations'
              placeholder='Search automations…'
              value={query}
              onChange={e => setQuery(e.target.value)}
              className='pl-8'
            />
          </div>
          {/* Approvals inbox is readable by anyone — non-admins see the
              queue but the Approve / Reject buttons stay admin-gated. */}
          <Link to='/automations/approvals'>
            <Button variant='outline' className='font-semibold'>
              <Check className='size-4' />
              Approvals
            </Button>
          </Link>
          <Button onClick={onCreate} className='font-semibold'>
            <Plus className='size-4' />
            New automation
          </Button>
        </div>
        <CategoryTabs category={category} counts={counts} onChange={setCategory} />
      </div>

      <div className='flex-1 overflow-y-auto bg-muted/30'>
        <div className='mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-6'>
          <p className='text-xs text-muted-foreground'>{LIST_CATEGORY_DESCRIPTIONS[category]}</p>
          {isLoading && items.length === 0 ? (
            <div className='flex items-center justify-center py-12 text-sm text-muted-foreground'>
              <Loader2 className='mr-2 size-4 animate-spin' />
              Loading automations…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState hasFilter={hasAnyFilter} onCreate={onCreate} />
          ) : (
            <ul className='flex flex-col gap-2'>
              {filtered.map(item => (
                <AutomationRow
                  key={item.id}
                  automation={item}
                  summary={summarizeAutomation(item, triggerCatalog, stepCatalog)}
                  onOpen={() => onOpen(item)}
                  onEdit={() => handleEdit(item)}
                  onShowRuns={onShowRuns ? () => onShowRuns(item) : undefined}
                  onDelete={() => setPendingDelete(item)}
                  onArchive={
                    isAutomationsAdmin && isLiveStatus(item.status)
                      ? () => archiveMutation.mutate(item.id)
                      : undefined
                  }
                  onToggleActive={
                    isLiveStatus(item.status) &&
                    (item.status === AutomationStatusValues.DISABLED ||
                      (item.status === AutomationStatusValues.ACTIVE && isAutomationsAdmin))
                      ? next =>
                          next ? activateMutation.mutate(item.id) : disableMutation.mutate(item.id)
                      : undefined
                  }
                  toggleLoading={
                    (activateMutation.isPending && activateMutation.variables === item.id) ||
                    (disableMutation.isPending && disableMutation.variables === item.id)
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </div>

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

function CategoryTabs({
  category,
  counts,
  onChange,
}: {
  category: ListCategory;
  counts: Record<ListCategory, number>;
  onChange: (next: ListCategory) => void;
}): React.ReactElement {
  return (
    <div
      role='tablist'
      aria-label='Filter automations by trigger category'
      className='flex items-center gap-1'
    >
      {LIST_CATEGORIES.map(c => {
        const active = c === category;
        return (
          <button
            key={c}
            type='button'
            role='tab'
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            aria-label={`${LIST_CATEGORY_LABELS[c]}, ${counts[c]} ${counts[c] === 1 ? 'automation' : 'automations'}`}
            onClick={() => onChange(c)}
            data-track-category='automations-list'
            data-track-name={`category-tab-${c}`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
              active
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/40',
            )}
          >
            {LIST_CATEGORY_LABELS[c]}
            <span
              aria-hidden='true'
              className={cn(
                'rounded-full px-1.5 text-[10px] font-semibold tabular-nums',
                active ? 'bg-background/20 text-background' : 'bg-muted text-muted-foreground',
              )}
            >
              {counts[c]}
            </span>
          </button>
        );
      })}
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
        <Zap className='size-6' />
      </div>
      <h2 className='mb-1 text-base font-medium text-foreground'>No automations yet</h2>
      <p className='mb-4 text-sm text-muted-foreground'>
        Build a no-code workflow that runs on a trigger — a schedule, a manual click, or an event
        from your workspace.
      </p>
      <Button size='sm' onClick={onCreate}>
        <Plus className='size-4' />
        Create your first automation
      </Button>
    </div>
  );
}

interface AutomationRowProps {
  automation: Automation;
  summary: string;
  onOpen: () => void;
  onEdit: () => void;
  onShowRuns?: (() => void) | undefined;
  onDelete: () => void;
  onArchive?: (() => void) | undefined;
  onToggleActive?: ((next: boolean) => void) | undefined;
  toggleLoading: boolean;
}

function AutomationRow({
  automation,
  summary,
  onOpen,
  onEdit,
  onShowRuns,
  onDelete,
  onArchive,
  onToggleActive,
  toggleLoading,
}: AutomationRowProps): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const isActive = automation.status === 'ACTIVE';
  const creator = useUser(automation.createdById);

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
          'group flex cursor-pointer flex-col gap-2 border-b border-border bg-background px-6 py-3 transition-colors',
          'hover:bg-muted/40',
          'focus-visible:outline-none focus-visible:bg-muted/40',
        )}
      >
        <div className='flex items-start gap-3'>
          <div
            aria-hidden='true'
            className='flex size-9 flex-shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400'
          >
            <Zap className='size-4' />
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
                  'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
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
                  <MoreHorizontal className='size-4' aria-hidden='true' />
                </button>
              }
            >
              {/* Editable from any status except one that's actively under
                  review — matches the builder's canEdit. Non-draft rows fork a
                  new proposal. */}
              {automation.status !== AutomationStatusValues.PENDING_APPROVAL && (
                <RowMenuButton
                  label='Edit'
                  icon={<Pencil className='size-4' />}
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit();
                  }}
                />
              )}
              {onShowRuns && (
                <RowMenuButton
                  label='Run history'
                  icon={<History className='size-4' />}
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
                    icon={<Trash2 className='size-4' />}
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
