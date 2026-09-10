import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileSpreadsheet } from 'lucide-react';
import {
  AlertCircle,
  ArrowLeft,
  DownloadDown as Download,
  Spinner as Loader2,
  RotateLeft as RotateCcw,
  FilterHorizontal as SlidersHorizontal,
} from '@xyne/icons';
import {
  ticketReportsApi,
  type TicketExportFilters,
  type TicketExportStatus,
} from '../../api/ticketReportsApi';
import { AccessType, FormEntityType, UserStatus } from '@xyne/shared';
import { useAuthContextValues } from '../../hooks/useAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { Button } from '../../components/ui/Button';
import { MultiSelect } from '../../components/ui/MultiSelect';
import { Switch } from '../../components/ui/Switch';

interface TicketReportsScreenProps {
  embedded?: boolean;
  lockedProjectId?: string;
  sourceChannelId?: string;
  onClose?: () => void;
}

const STATUS_STYLES: Record<TicketExportStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  IN_PROGRESS: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  READY: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  EXPIRED: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  CANCELED: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};
const STALE_EXPORT_TIMEOUT_MS = 15 * 60 * 1000;

function isRetryableExport(status: string, updatedAt: number | null | undefined): boolean {
  if (status === 'FAILED') return true;
  if ((status !== 'PENDING' && status !== 'IN_PROGRESS') || !updatedAt) return false;
  return updatedAt < Date.now() - STALE_EXPORT_TIMEOUT_MS;
}

function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString();
}

function errorMessage(error: unknown, fallback: string): string {
  const apiError = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  if (typeof apiError === 'string') {
    // eslint-disable-next-line no-control-regex
    const cleanMessage = apiError.replace(/\u001b\[[0-9;]*m/g, '');
    if (cleanMessage.includes('ticket_exports') && cleanMessage.includes('does not exist')) {
      return 'Ticket export storage is not initialized. Apply the ticket export database migration and try again.';
    }
    return cleanMessage;
  }
  if (Array.isArray(apiError)) {
    return apiError
      .map(item => {
        if (!item || typeof item !== 'object') return '';
        const record = item as Record<string, unknown>;
        return typeof record['message'] === 'string' ? record['message'] : '';
      })
      .filter(Boolean)
      .join(', ');
  }
  return error instanceof Error ? error.message : fallback;
}

const TicketReportsScreen = ({
  embedded = false,
  lockedProjectId,
  sourceChannelId,
  onClose,
}: TicketReportsScreenProps): React.ReactElement => {
  const { workspaceId } = useAuthContextValues();
  const permissions = usePermissions();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const fromListProjects = searchParams.get('from') === 'listProjects';
  const routeLockedProjectId =
    searchParams.get('lockProject') === '1'
      ? (searchParams.get('projectId') ?? undefined)
      : undefined;
  const effectiveLockedProjectId = lockedProjectId ?? routeLockedProjectId;

  const [projectId, setProjectId] = useState(
    effectiveLockedProjectId ?? searchParams.get('projectId') ?? '',
  );
  const [boardIds, setBoardIds] = useState<string[]>(
    searchParams.get('boardId') ? [searchParams.get('boardId')!] : [],
  );
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [columnsByBoard, setColumnsByBoard] = useState<Record<string, string[]>>({});
  const [includeArchived, setIncludeArchived] = useState(false);
  const [includeLinkedTickets, setIncludeLinkedTickets] = useState(true);
  const [includeLinkedTicketDetails, setIncludeLinkedTicketDetails] = useState(false);
  const [includeActivity, setIncludeActivity] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [requestPending, setRequestPending] = useState(false);

  const [projectRows, projectQueryDetails] = useCachedQuery(queries.getAllProjects());
  const [userRows, userQueryDetails] = useCachedQuery(queries.getUsersV2());
  const allBoardIds = useMemo(
    () => (projectRows ?? []).flatMap(project => (project.boards ?? []).map(board => board.id)),
    [projectRows],
  );
  const [stageRows, stageQueryDetails] = useCachedQuery(
    queries.getStagesByBoardIds({ boardIds: allBoardIds }),
  );
  const [formRows, formQueryDetails] = useCachedQuery(queries.getAllForms());
  const [projectTagRows] = useCachedQuery(queries.projectTagsByProjectId({ projectId }), {
    enabled: Boolean(projectId),
  });
  const [exportRows, exportQueryDetails] = useCachedQuery(queries.ticketExportsForCurrentUser());
  const scopeLoading =
    projectQueryDetails.type !== 'complete' ||
    userQueryDetails.type !== 'complete' ||
    stageQueryDetails.type !== 'complete' ||
    formQueryDetails.type !== 'complete';
  const exportsLoading = exportQueryDetails.type !== 'complete';
  const exportPermission = permissions.find(
    permission => permission.resourceName === 'TICKET-REPORTS',
  );
  const requiresProject = exportPermission?.accessType === AccessType.WRITE;
  const standardColumns = useMemo(
    () =>
      [
        ['ticketKey', 'Ticket Key'],
        ['title', 'Title'],
        ['workspace', 'Workspace'],
        ['project', 'Project'],
        ['board', 'Board'],
        ['channel', 'Channel'],
        ['status', 'Status'],
        ['stage', 'Stage'],
        ['priority', 'Priority'],
        ['archived', 'Archived'],
        ['createdBy', 'Created By'],
        ['assignedTo', 'Assigned To'],
        ['updatedBy', 'Updated By'],
        ['group', 'Group'],
        ['createdAt', 'Created At'],
        ['updatedAt', 'Updated At'],
        ['eta', 'ETA'],
        ['closedAt', 'Closed At'],
        ['tags', 'Tags'],
      ].map(([key, label]) => ({ key: key!, label: label!, kind: 'STANDARD' as const })),
    [],
  );
  const customColumnsByContext = useMemo(() => {
    const columnsByContext = new Map<
      string,
      Map<string, { key: string; label: string; kind: 'CUSTOM'; fieldType?: string }>
    >();
    for (const form of formRows ?? []) {
      for (const mapping of form.formContextMappings ?? []) {
        if (mapping.entityType !== FormEntityType.TICKET) continue;
        const columns =
          columnsByContext.get(mapping.contextId) ??
          new Map<string, { key: string; label: string; kind: 'CUSTOM'; fieldType?: string }>();
        for (const field of form.formFields ?? []) {
          const label = field.globalField?.fieldName ?? field.fieldName;
          const fieldType = field.globalField?.fieldType ?? field.fieldType;
          if (!label || !fieldType) continue;
          columns.set(`custom:${label}`, {
            key: `custom:${label}`,
            label,
            kind: 'CUSTOM',
            fieldType,
          });
        }
        columnsByContext.set(mapping.contextId, columns);
      }
    }
    return columnsByContext;
  }, [formRows]);
  const stageIdsByBoard = useMemo(() => {
    const idsByBoard = new Map<string, string[]>();
    for (const stage of stageRows ?? []) {
      const stageIds = idsByBoard.get(stage.boardId) ?? [];
      stageIds.push(stage.id);
      idsByBoard.set(stage.boardId, stageIds);
    }
    return idsByBoard;
  }, [stageRows]);
  const projects = useMemo(
    () =>
      (projectRows ?? [])
        .map(project => ({
          id: project.id,
          name: project.name,
          code: project.code,
          boards: (project.boards ?? [])
            .map(board => {
              const contextIds = [board.id, ...(stageIdsByBoard.get(board.id) ?? [])];
              const customColumns = new Map<
                string,
                { key: string; label: string; kind: 'CUSTOM'; fieldType?: string }
              >();
              for (const contextId of contextIds) {
                for (const [key, column] of customColumnsByContext.get(contextId) ?? []) {
                  customColumns.set(key, column);
                }
              }
              return {
                id: board.id,
                name: board.name,
                projectId: board.projectId,
                columns: [...standardColumns, ...customColumns.values()],
              };
            })
            .sort((left, right) => left.name.localeCompare(right.name)),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [customColumnsByContext, projectRows, stageIdsByBoard, standardColumns],
  );
  const users = (userRows ?? [])
    .filter(user => user.status === UserStatus.ACTIVE && !user.leftAt)
    .map(user => ({
      id: user.id,
      name: user.displayName || user.name || user.email,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const selectedProject = projects.find(project => project.id === projectId);
  const availableBoards = projectId
    ? (selectedProject?.boards ?? [])
    : projects.flatMap(project => project.boards);
  const availableTags = projectId ? (projectTagRows ?? []) : [];
  const boardOptions = availableBoards.map(board => ({ value: board.id, label: board.name }));
  const statusOptions = ['TODO', 'STARTED', 'PAUSED', 'CANCELLED', 'COMPLETED'].map(status => ({
    value: status,
    label: status
      .replaceAll('_', ' ')
      .toLowerCase()
      .replace(/\b\w/g, letter => letter.toUpperCase()),
  }));
  const priorityOptions = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(priority => ({
    value: priority,
    label: priority.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase()),
  }));
  const assigneeOptions = users.map(user => ({ value: user.id, label: user.name }));
  const tagOptions = availableTags.map(tag => ({ value: tag.id, label: tag.name }));
  const configurableBoards =
    boardIds.length > 0
      ? availableBoards.filter(board => boardIds.includes(board.id))
      : availableBoards;

  const payload = useMemo((): { filters: TicketExportFilters } => {
    const filters: TicketExportFilters = {
      includeArchived,
      includeLinkedTickets,
      includeLinkedTicketDetails: includeLinkedTickets && includeLinkedTicketDetails,
      includeActivity,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      ...(Object.keys(columnsByBoard).length > 0 ? { columnsByBoard } : {}),
      ...(projectId ? { projectId } : {}),
      ...(sourceChannelId ? { sourceChannelId } : {}),
      ...(boardIds.length ? { boardIds } : {}),
      ...(statuses.length ? { statuses } : {}),
      ...(priorities.length ? { priorities } : {}),
      ...(assignees.length ? { assignees } : {}),
      ...(tags.length ? { tags } : {}),
    };
    if (fromDate || toDate) {
      filters.dateRange = {};
      if (fromDate) filters.dateRange.from = new Date(`${fromDate}T00:00:00`).toISOString();
      if (toDate) filters.dateRange.to = new Date(`${toDate}T23:59:59.999`).toISOString();
    }
    return { filters };
  }, [
    assignees,
    boardIds,
    columnsByBoard,
    fromDate,
    includeActivity,
    includeArchived,
    includeLinkedTicketDetails,
    includeLinkedTickets,
    priorities,
    projectId,
    statuses,
    sourceChannelId,
    tags,
    toDate,
  ]);

  useEffect(() => {
    setBoardIds(current => current.filter(id => availableBoards.some(board => board.id === id)));
    setTags(current => current.filter(id => availableTags.some(tag => tag.id === id)));
    setColumnsByBoard(current =>
      Object.fromEntries(
        Object.entries(current).filter(([boardId]) =>
          availableBoards.some(board => board.id === boardId),
        ),
      ),
    );
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRequest = async (): Promise<void> => {
    setRequestPending(true);
    setFormError(null);
    try {
      const { blob, fileName } = await ticketReportsApi.downloadExport({
        workspaceId,
        filters: payload.filters,
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setFormError(errorMessage(error, 'Failed to request export'));
    } finally {
      setRequestPending(false);
    }
  };

  const handleDownload = async (record: { id: string }): Promise<void> => {
    setDownloadingId(record.id);
    try {
      const { blob, fileName } = await ticketReportsApi.downloadExport({
        exportId: record.id,
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setFormError(errorMessage(error, 'Failed to download export'));
    } finally {
      setDownloadingId(null);
    }
  };

  const items = exportRows ?? [];
  const inputClass =
    'h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20';
  const resetFilters = (): void => {
    if (!requiresProject && !effectiveLockedProjectId) setProjectId('');
    setBoardIds([]);
    setStatuses([]);
    setPriorities([]);
    setAssignees([]);
    setTags([]);
    setColumnsByBoard({});
    setFromDate('');
    setToDate('');
    setIncludeArchived(false);
    setIncludeLinkedTickets(true);
    setIncludeLinkedTicketDetails(false);
    setIncludeActivity(false);
    setFormError(null);
  };
  const toggleBoardColumn = (boardId: string, allKeys: string[], key: string): void => {
    setColumnsByBoard(current => {
      const selected = current[boardId] ?? allKeys;
      const next = selected.includes(key)
        ? selected.filter(columnKey => columnKey !== key)
        : [...selected, key];
      if (next.length === 0) return current;
      if (next.length === allKeys.length) {
        const { [boardId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [boardId]: next };
    });
  };
  const selectAllBoardColumns = (boardId: string): void => {
    setColumnsByBoard(current => {
      const { [boardId]: _removed, ...rest } = current;
      return rest;
    });
  };
  const selectCoreBoardColumns = (boardId: string): void => {
    setColumnsByBoard(current => ({
      ...current,
      [boardId]: ['ticketKey', 'title', 'status', 'priority', 'assignedTo', 'updatedAt'],
    }));
  };

  return (
    <div
      className={`flex h-full flex-col overflow-y-auto ${embedded ? 'bg-muted' : 'bg-muted/40'}`}
    >
      <div className={`mx-auto w-full max-w-7xl ${embedded ? 'p-4' : 'p-4 md:p-6'}`}>
        {(!embedded || onClose) && (
          <button
            type='button'
            onClick={() => {
              if (embedded && onClose) {
                onClose();
                return;
              }
              if (fromListProjects) {
                void navigate(`${workspaceId ? `/${workspaceId}` : ''}/listProjects`);
                return;
              }
              void navigate(-1);
            }}
            className='mb-6 flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground'
            data-track-category='TicketReports'
            data-track-name='Back'
          >
            <ArrowLeft size={20} />
            <span>{fromListProjects ? 'Back to Projects' : 'Back'}</span>
          </button>
        )}

        <div className='mb-6 flex items-start gap-3'>
          <div className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
            <FileSpreadsheet className='size-5' />
          </div>
          <div>
            <h1 className='text-2xl font-semibold tracking-tight text-foreground'>
              Ticket reports
            </h1>
            <p className='mt-1 text-sm text-muted-foreground'>
              Build and download an XLSX report from the tickets you are allowed to access.
            </p>
          </div>
        </div>

        <section className='mb-6 overflow-visible rounded-xl border border-border bg-background shadow-sm'>
          <div className='flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4'>
            <div className='flex items-center gap-2'>
              <SlidersHorizontal className='size-4 text-muted-foreground' />
              <div>
                <h2 className='text-sm font-semibold text-foreground'>Configure report</h2>
                <p className='text-xs text-muted-foreground'>
                  Empty optional filters include every available value.
                </p>
              </div>
            </div>
            <Button type='button' variant='ghost' size='sm' onClick={resetFilters}>
              <RotateCcw className='size-4' />
              Reset filters
            </Button>
          </div>

          <div className='p-5'>
            {scopeLoading ? (
              <div className='flex min-h-40 items-center justify-center'>
                <Loader2 className='size-5 animate-spin text-muted-foreground' />
              </div>
            ) : (
              <>
                <div className='grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-3'>
                  <div className='flex flex-col gap-1'>
                    <span className='text-sm font-medium leading-none text-foreground'>
                      Project {requiresProject && <span className='text-destructive'>*</span>}
                    </span>
                    {effectiveLockedProjectId ? (
                      <div className={`${inputClass} flex items-center bg-muted/40`}>
                        {selectedProject
                          ? `${selectedProject.name} (${selectedProject.code})`
                          : 'Channel project'}
                      </div>
                    ) : (
                      <select
                        value={projectId}
                        onChange={event => setProjectId(event.target.value)}
                        className={inputClass}
                        data-track-category='TicketReports'
                        data-track-name='SelectProject'
                      >
                        {!requiresProject && <option value=''>All projects</option>}
                        {requiresProject && <option value=''>Select a project</option>}
                        {projects.map(project => (
                          <option key={project.id} value={project.id}>
                            {project.name} ({project.code})
                          </option>
                        ))}
                      </select>
                    )}
                    <span className='text-xs font-normal text-muted-foreground'>
                      {effectiveLockedProjectId
                        ? 'Reports opened from a channel are restricted to its linked project.'
                        : requiresProject
                          ? 'A project is required for your access level.'
                          : 'All projects is the default.'}
                    </span>
                  </div>

                  <MultiSelect
                    label='Boards'
                    options={boardOptions}
                    selectedValues={boardIds}
                    onChange={setBoardIds}
                    placeholder='All boards'
                    helperText='No selection includes all boards.'
                    disabled={requiresProject && !projectId}
                  />
                  <MultiSelect
                    label='Statuses'
                    options={statusOptions}
                    selectedValues={statuses}
                    onChange={setStatuses}
                    placeholder='All statuses'
                    helperText='No selection includes all statuses.'
                  />
                  <MultiSelect
                    label='Priorities'
                    options={priorityOptions}
                    selectedValues={priorities}
                    onChange={setPriorities}
                    placeholder='All priorities'
                    helperText='No selection includes all priorities.'
                  />
                  <MultiSelect
                    label='Assignees'
                    options={assigneeOptions}
                    selectedValues={assignees}
                    onChange={setAssignees}
                    placeholder='All assignees'
                    helperText='No selection includes assigned and unassigned tickets.'
                  />
                  <MultiSelect
                    label='Tags'
                    options={tagOptions}
                    selectedValues={tags}
                    onChange={setTags}
                    placeholder='All tags'
                    helperText='No selection includes tickets with any or no tag.'
                    disabled={requiresProject && !projectId}
                  />

                  <label className='flex flex-col gap-1.5 text-sm font-medium text-foreground'>
                    Created from
                    <input
                      type='date'
                      value={fromDate}
                      onChange={event => setFromDate(event.target.value)}
                      className={inputClass}
                      data-track-category='TicketReports'
                      data-track-name='CreatedFrom'
                    />
                    <span className='text-xs font-normal text-muted-foreground'>
                      Optional start date.
                    </span>
                  </label>
                  <label className='flex flex-col gap-1.5 text-sm font-medium text-foreground'>
                    Created to
                    <input
                      type='date'
                      value={toDate}
                      min={fromDate || undefined}
                      onChange={event => setToDate(event.target.value)}
                      className={inputClass}
                      data-track-category='TicketReports'
                      data-track-name='CreatedTo'
                    />
                    <span className='text-xs font-normal text-muted-foreground'>
                      Includes the full selected day.
                    </span>
                  </label>
                </div>

                <div className='mt-6 rounded-lg border border-border bg-muted/30 p-4'>
                  <div className='mb-3'>
                    <h3 className='text-sm font-semibold text-foreground'>Columns by board</h3>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      Each board worksheet can have a different set of columns. Boards left
                      unchanged include every standard and custom field.
                    </p>
                  </div>
                  {configurableBoards.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>
                      Select a project to configure its board columns.
                    </p>
                  ) : (
                    <div className='space-y-2'>
                      {configurableBoards.map(board => {
                        const allKeys = board.columns.map(column => column.key);
                        const selectedKeys = columnsByBoard[board.id] ?? allKeys;
                        const customFieldCount = board.columns.filter(
                          column => column.kind === 'CUSTOM',
                        ).length;
                        return (
                          <details
                            key={board.id}
                            className='group rounded-lg border border-border bg-background'
                          >
                            <summary className='flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3'>
                              <div className='min-w-0'>
                                <div className='truncate text-sm font-medium text-foreground'>
                                  {board.name}
                                </div>
                                <div className='text-xs text-muted-foreground'>
                                  {selectedKeys.length} of {allKeys.length} columns
                                  {customFieldCount > 0
                                    ? ` · ${customFieldCount} custom fields`
                                    : ' · no custom fields'}
                                </div>
                              </div>
                              <span className='text-xs font-medium text-primary group-open:hidden'>
                                Configure
                              </span>
                              <span className='hidden text-xs font-medium text-muted-foreground group-open:inline'>
                                Close
                              </span>
                            </summary>
                            <div className='border-t border-border px-4 py-3'>
                              <div className='mb-3 flex flex-wrap gap-2'>
                                <Button
                                  type='button'
                                  variant='outline'
                                  size='sm'
                                  onClick={() => selectAllBoardColumns(board.id)}
                                  data-track-category='TicketReports'
                                  data-track-name='SelectAllBoardColumns'
                                >
                                  Select all
                                </Button>
                                <Button
                                  type='button'
                                  variant='ghost'
                                  size='sm'
                                  onClick={() => selectCoreBoardColumns(board.id)}
                                  data-track-category='TicketReports'
                                  data-track-name='SelectCoreBoardColumns'
                                >
                                  Core columns
                                </Button>
                              </div>
                              <div className='grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3'>
                                {board.columns.map(column => (
                                  <label
                                    key={column.key}
                                    className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted'
                                  >
                                    <input
                                      type='checkbox'
                                      checked={selectedKeys.includes(column.key)}
                                      onChange={() =>
                                        toggleBoardColumn(board.id, allKeys, column.key)
                                      }
                                      className='size-4 accent-primary'
                                      data-track-category='TicketReports'
                                      data-track-name='ToggleBoardColumn'
                                    />
                                    <span className='min-w-0 truncate'>{column.label}</span>
                                    {column.kind === 'CUSTOM' && (
                                      <span className='ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary'>
                                        Custom
                                      </span>
                                    )}
                                  </label>
                                ))}
                              </div>
                              <p className='mt-3 text-xs text-muted-foreground'>
                                At least one column must remain selected for each board.
                              </p>
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className='mt-6 rounded-lg border border-border bg-muted/30 p-4'>
                  <h3 className='mb-3 text-sm font-semibold text-foreground'>Report contents</h3>
                  <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                    <Switch
                      checked={includeArchived}
                      onCheckedChange={setIncludeArchived}
                      label='Include archived tickets'
                    />
                    <Switch
                      checked={includeLinkedTickets}
                      onCheckedChange={setIncludeLinkedTickets}
                      label='Include linked-ticket references'
                    />
                    <Switch
                      checked={includeLinkedTicketDetails}
                      onCheckedChange={setIncludeLinkedTicketDetails}
                      label='Include linked-ticket detail sheets'
                      disabled={!includeLinkedTickets}
                    />
                    <Switch
                      checked={includeActivity}
                      onCheckedChange={setIncludeActivity}
                      label='Include activity history'
                    />
                  </div>
                </div>
              </>
            )}

            {formError && (
              <div className='mt-4 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive'>
                <AlertCircle className='mt-0.5 size-4 shrink-0' />
                <span className='break-words'>{formError}</span>
              </div>
            )}

            <div className='mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-5'>
              <Button
                type='button'
                onClick={() => {
                  void handleRequest();
                }}
                disabled={requestPending || (requiresProject && !projectId)}
                loading={requestPending}
                data-track-category='TicketReports'
                data-track-name='GenerateExport'
              >
                <FileSpreadsheet className='size-4' />
                Download report
              </Button>
              <span className='text-xs text-muted-foreground'>
                The report is generated directly and its configuration is saved in history.
              </span>
            </div>
          </div>
        </section>

        <section className='overflow-hidden rounded-xl border border-border bg-background shadow-sm'>
          <div className='flex items-center justify-between border-b border-border px-5 py-4'>
            <div>
              <h2 className='text-sm font-semibold text-foreground'>Generated reports</h2>
              <p className='text-xs text-muted-foreground'>
                Files are generated when you click download and are not stored.
              </p>
            </div>
            <span className='text-xs text-muted-foreground'>Live updates</span>
          </div>

          <div className='overflow-x-auto'>
            <table className='w-full text-left text-sm'>
              <thead className='bg-muted/50 text-xs uppercase text-muted-foreground'>
                <tr>
                  <th className='px-4 py-3'>Status</th>
                  <th className='px-4 py-3'>Requested by</th>
                  <th className='px-4 py-3'>Created</th>
                  <th className='px-4 py-3 text-right'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {exportsLoading && (
                  <tr>
                    <td colSpan={4} className='px-4 py-8 text-center'>
                      <Loader2 className='mx-auto h-5 w-5 animate-spin' />
                    </td>
                  </tr>
                )}
                {!exportsLoading && items.length === 0 && (
                  <tr>
                    <td colSpan={4} className='px-4 py-10 text-center text-muted-foreground'>
                      No reports generated yet.
                    </td>
                  </tr>
                )}
                {items.map(record => (
                  <tr key={record.id} className='border-t border-border'>
                    <td className='px-4 py-3'>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[record.status as TicketExportStatus]}`}
                      >
                        {record.status}
                      </span>
                    </td>
                    <td className='px-4 py-3'>You</td>
                    <td className='px-4 py-3'>{formatDate(record.createdAt)}</td>
                    <td className='px-4 py-3 text-right'>
                      {(record.status === 'READY' ||
                        isRetryableExport(record.status, record.updatedAt)) && (
                        <button
                          type='button'
                          onClick={() => {
                            void handleDownload(record);
                          }}
                          disabled={downloadingId === record.id}
                          className='inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent'
                          data-track-category='TicketReports'
                          data-track-name='DownloadExport'
                        >
                          {downloadingId === record.id ? (
                            <Loader2 className='h-3.5 w-3.5 animate-spin' />
                          ) : record.status !== 'READY' ? (
                            <RotateCcw className='h-3.5 w-3.5' />
                          ) : (
                            <Download className='h-3.5 w-3.5' />
                          )}
                          {record.status !== 'READY' ? 'Retry' : 'Download'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};

TicketReportsScreen.displayName = 'TicketReportsScreen';

export default TicketReportsScreen;
