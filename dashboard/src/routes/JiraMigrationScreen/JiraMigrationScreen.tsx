import { type ChangeEvent, ReactElement, useEffect, useMemo, useState } from 'react';
import { useChannelsByProjectId } from '../../hooks/useChannels';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import {
  jiraMigrationService,
  type JiraMigrationExecuteRequest,
  type JiraMigrationExecuteResponse,
  type JiraMigrationFilters,
  type JiraMigrationHistoryItem,
  type JiraMigrationJobProgress,
  type JiraMigrationPreviewResponse,
} from '../../services/JiraMigration/jiraMigrationService';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import Dialog from '../../components/ui/Dialog';
import { toast } from 'sonner';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import { EntityMultiSelector } from '../../components/ui/EntitySelector/EntityMultiSelector';
import { FolderKanban, LayoutTemplate, Hash, User, Tag } from 'lucide-react';

const actionClassMap: Record<string, string> = {
  create_board_custom_field: 'bg-blue-100 text-blue-800',
  reuse_existing_board_custom_field: 'bg-emerald-100 text-emerald-800',
  store_in_metadata: 'bg-amber-100 text-amber-800',
};

const confidenceClassMap: Record<string, string> = {
  high: 'bg-emerald-100 text-emerald-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-rose-100 text-rose-800',
};

const issueStatusClassMap: Record<'completed' | 'partial' | 'failed', string> = {
  completed: 'bg-emerald-100 text-emerald-800',
  partial: 'bg-amber-100 text-amber-800',
  failed: 'bg-rose-100 text-rose-800',
};

const ACTIVE_JIRA_MIGRATION_STORAGE_KEY = 'jiraMigration.activeJob';
const PREVIEW_CUSTOM_FIELDS_PER_PAGE = 8;
const PREVIEW_ISSUE_SAMPLES_PER_PAGE = 8;
const ISSUE_EXECUTION_DETAILS_PER_PAGE = 10;

type TicketRange = 'all' | 'last_1_month' | 'last_6_months' | 'last_1_year';
type PreviewSection = 'overview' | 'fields' | 'issues';
type TicketStatusV2Option = 'TODO' | 'STARTED' | 'COMPLETED' | 'PAUSED' | 'CANCELLED';
type MigrationPhase = 'setup' | 'map-statuses' | 'migrate';

const TICKET_STATUS_V2_OPTIONS: TicketStatusV2Option[] = [
  'TODO',
  'STARTED',
  'COMPLETED',
  'PAUSED',
  'CANCELLED',
];

const normalizeStatusKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const ticketRangeLabelMap: Record<TicketRange, string> = {
  all: 'All Time',
  last_1_month: 'Last 1 Month',
  last_6_months: 'Last 6 Months',
  last_1_year: 'Last 1 Year',
};

type PersistedJiraMigrationJob = {
  jobId: string;
  jiraProjectKey: string;
  targetProjectId: string;
  targetBoardId: string;
  targetChannelId: string;
  ticketRange: TicketRange;
  dateFrom?: string;
  startedAt: string;
};

const readPersistedJiraMigrationJob = (): PersistedJiraMigrationJob | null => {
  if (typeof window === 'undefined') return null;

  try {
    const rawValue = window.localStorage.getItem(ACTIVE_JIRA_MIGRATION_STORAGE_KEY);
    if (!rawValue) return null;

    const parsedValue = JSON.parse(rawValue) as Partial<PersistedJiraMigrationJob>;
    if (
      typeof parsedValue.jobId !== 'string' ||
      typeof parsedValue.jiraProjectKey !== 'string' ||
      typeof parsedValue.targetProjectId !== 'string' ||
      typeof parsedValue.targetBoardId !== 'string' ||
      typeof parsedValue.targetChannelId !== 'string'
    ) {
      window.localStorage.removeItem(ACTIVE_JIRA_MIGRATION_STORAGE_KEY);
      return null;
    }

    return {
      jobId: parsedValue.jobId,
      jiraProjectKey: parsedValue.jiraProjectKey,
      targetProjectId: parsedValue.targetProjectId,
      targetBoardId: parsedValue.targetBoardId,
      targetChannelId: parsedValue.targetChannelId,
      ticketRange:
        parsedValue.ticketRange === 'last_1_month' ||
        parsedValue.ticketRange === 'last_6_months' ||
        parsedValue.ticketRange === 'last_1_year'
          ? parsedValue.ticketRange
          : 'all',
      ...(typeof parsedValue.dateFrom === 'string' ? { dateFrom: parsedValue.dateFrom } : {}),
      startedAt:
        typeof parsedValue.startedAt === 'string'
          ? parsedValue.startedAt
          : new Date().toISOString(),
    };
  } catch {
    window.localStorage.removeItem(ACTIVE_JIRA_MIGRATION_STORAGE_KEY);
    return null;
  }
};

const persistJiraMigrationJob = (job: PersistedJiraMigrationJob): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACTIVE_JIRA_MIGRATION_STORAGE_KEY, JSON.stringify(job));
};

const clearPersistedJiraMigrationJob = (): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACTIVE_JIRA_MIGRATION_STORAGE_KEY);
};

const JiraMigrationScreen = (): ReactElement => {
  const [projects] = useCachedQuery(queries.getAllProjects());
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [targetChannelId, setTargetChannelId] = useState('');
  const [jiraProjectKey, setJiraProjectKey] = useState('');
  const [ticketRange, setTicketRange] = useState<TicketRange>('all');
  const [filters, setFilters] = useState<JiraMigrationFilters>({});
  const [isFilterEnabled, setIsFilterEnabled] = useState(false);
  const [preview, setPreview] = useState<JiraMigrationPreviewResponse | null>(null);
  const [result, setResult] = useState<JiraMigrationExecuteResponse | null>(null);
  const [migrationHistory, setMigrationHistory] = useState<JiraMigrationHistoryItem[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [migrationProgress, setMigrationProgress] = useState<JiraMigrationJobProgress | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isImportLoading, setIsImportLoading] = useState(false);
  const [pageTokens, setPageTokens] = useState<Array<string | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [previewSection, setPreviewSection] = useState<PreviewSection>('overview');
  const [customFieldPage, setCustomFieldPage] = useState(0);
  const [issueSamplePage, setIssueSamplePage] = useState(0);
  const [issueResultPage, setIssueResultPage] = useState(0);
  const [statusV2Mappings, setStatusV2Mappings] = useState<Record<string, string>>({});
  const [skippedCustomFieldIds, setSkippedCustomFieldIds] = useState<Record<string, boolean>>({});
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [migrationPhase, setMigrationPhase] = useState<MigrationPhase>('setup');
  const channels = useChannelsByProjectId(selectedProjectId || undefined);

  const [boards] = useCachedQuery(
    queries.boardsListByProject({ projectId: selectedProjectId || 'placeholder' }),
    { enabled: !!selectedProjectId },
  );

  const selectedProject = useMemo(
    () => projects?.find(project => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const selectedBoard = useMemo(
    () => boards?.find(board => board.id === selectedBoardId) || null,
    [boards, selectedBoardId],
  );

  const selectedChannel = useMemo(
    () => channels.find(channel => channel.id === targetChannelId) || null,
    [channels, targetChannelId],
  );

  const previewActionCounts = useMemo(() => {
    if (!preview) {
      return {
        create: 0,
        reuse: 0,
        metadata: 0,
        fieldsPageCount: 0,
        issuePageCount: 0,
      };
    }

    return {
      create: preview.customFieldMappings.filter(
        item => item.action === 'create_board_custom_field',
      ).length,
      reuse: preview.customFieldMappings.filter(
        item => item.action === 'reuse_existing_board_custom_field',
      ).length,
      metadata: preview.customFieldMappings.filter(item => item.action === 'store_in_metadata')
        .length,
      fieldsPageCount: Math.max(
        1,
        Math.ceil(preview.customFieldMappings.length / PREVIEW_CUSTOM_FIELDS_PER_PAGE),
      ),
      issuePageCount: Math.max(
        1,
        Math.ceil(preview.issueSamples.length / PREVIEW_ISSUE_SAMPLES_PER_PAGE),
      ),
    };
  }, [preview]);

  const paginatedCustomFieldMappings = useMemo(() => {
    if (!preview) return [];
    const start = customFieldPage * PREVIEW_CUSTOM_FIELDS_PER_PAGE;
    return preview.customFieldMappings.slice(start, start + PREVIEW_CUSTOM_FIELDS_PER_PAGE);
  }, [customFieldPage, preview]);

  const paginatedIssueSamples = useMemo(() => {
    if (!preview) return [];
    const start = issueSamplePage * PREVIEW_ISSUE_SAMPLES_PER_PAGE;
    return preview.issueSamples.slice(start, start + PREVIEW_ISSUE_SAMPLES_PER_PAGE);
  }, [issueSamplePage, preview]);

  const paginatedIssueResults = useMemo(() => {
    if (!result) return [];
    const start = issueResultPage * ISSUE_EXECUTION_DETAILS_PER_PAGE;
    return result.issueResults.slice(start, start + ISSUE_EXECUTION_DETAILS_PER_PAGE);
  }, [issueResultPage, result]);

  const issueResultPageCount = useMemo(() => {
    if (!result) return 1;
    return Math.max(1, Math.ceil(result.issueResults.length / ISSUE_EXECUTION_DETAILS_PER_PAGE));
  }, [result]);

  const statusesMissingV2Mapping = useMemo(() => {
    if (!preview) return [];

    return preview.statusMappings
      .map(mapping => mapping.jiraStatus)
      .filter(
        status =>
          !TICKET_STATUS_V2_OPTIONS.includes(statusV2Mappings[status] as TicketStatusV2Option),
      );
  }, [preview, statusV2Mappings]);

  const hasCompleteStatusV2Mappings = Boolean(preview) && statusesMissingV2Mapping.length === 0;

  const mappedStatusMappings = useMemo(() => {
    if (!preview) return [];

    return preview.statusMappings.filter(mapping =>
      TICKET_STATUS_V2_OPTIONS.includes(
        statusV2Mappings[mapping.jiraStatus] as TicketStatusV2Option,
      ),
    );
  }, [preview, statusV2Mappings]);

  const newStatusMappings = useMemo(() => {
    if (!preview) return [];

    return preview.statusMappings.filter(
      mapping =>
        !TICKET_STATUS_V2_OPTIONS.includes(
          statusV2Mappings[mapping.jiraStatus] as TicketStatusV2Option,
        ),
    );
  }, [preview, statusV2Mappings]);

  const loadMigrationHistory = async (): Promise<void> => {
    try {
      const history = await jiraMigrationService.getMigrationHistory();
      setMigrationHistory(history);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load migration history';
      toast.error('History load failed', { description: message });
    }
  };

  useEffect(() => {
    void loadMigrationHistory();
  }, []);

  useEffect(() => {
    const persistedJob = readPersistedJiraMigrationJob();
    if (!persistedJob) return;

    setJiraProjectKey(persistedJob.jiraProjectKey);
    setSelectedProjectId(persistedJob.targetProjectId);
    setSelectedBoardId(persistedJob.targetBoardId);
    setTargetChannelId(persistedJob.targetChannelId);
    setTicketRange(persistedJob.ticketRange);
    setIsImportLoading(true);
    setActiveJobId(persistedJob.jobId);
    toast.info('Recovered active Jira migration job', {
      description: `${persistedJob.jiraProjectKey} migration is resuming from the backend job tracker.`,
    });
  }, []);

  const resolvedDateFrom = useMemo(() => {
    if (ticketRange === 'all') return undefined;

    const date = new Date();
    if (ticketRange === 'last_1_year') {
      date.setFullYear(date.getFullYear() - 1);
    } else if (ticketRange === 'last_6_months') {
      date.setMonth(date.getMonth() - 6);
    } else {
      date.setMonth(date.getMonth() - 1);
    }
    return date.toISOString().slice(0, 10);
  }, [ticketRange]);

  useEffect(() => {
    if (!activeJobId) return undefined;

    let cancelled = false;

    const pollStatus = async (): Promise<void> => {
      try {
        const status = await jiraMigrationService.getMigrationStatus(activeJobId);
        if (cancelled) return;

        persistJiraMigrationJob({
          jobId: status.jobId,
          jiraProjectKey: status.jiraProjectKey,
          targetProjectId: status.targetProjectId,
          targetBoardId: status.targetBoardId,
          targetChannelId: status.targetChannelId,
          ticketRange,
          ...(resolvedDateFrom ? { dateFrom: resolvedDateFrom } : {}),
          startedAt: status.startedAt,
        });

        setMigrationProgress(status);

        if (status.status === 'completed') {
          clearPersistedJiraMigrationJob();
          setIsImportLoading(false);
          setActiveJobId(null);
          if (status.result) {
            setResult(status.result);
            setIssueResultPage(0);
          }
          void loadMigrationHistory();
          toast.success('Jira migration completed');
          return;
        }

        if (status.status === 'failed') {
          clearPersistedJiraMigrationJob();
          setIsImportLoading(false);
          setActiveJobId(null);
          toast.error('Import failed', {
            description: status.errorMessage || 'Jira migration failed',
          });
        }
      } catch (error) {
        if (cancelled) return;
        clearPersistedJiraMigrationJob();
        setIsImportLoading(false);
        setActiveJobId(null);
        const message = error instanceof Error ? error.message : 'Failed to fetch migration status';
        toast.error('Status check failed', { description: message });
      }
    };

    void pollStatus();
    const intervalId = window.setInterval(() => {
      void pollStatus();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeJobId, resolvedDateFrom, ticketRange]);

  const canPreview =
    jiraProjectKey.trim() !== '' &&
    selectedProjectId.trim() !== '' &&
    selectedBoardId.trim() !== '' &&
    targetChannelId.trim() !== '';

  const buildPayload = (nextPageToken?: string) => ({
    jiraProjectKey: jiraProjectKey.trim().toUpperCase(),
    targetProjectId: selectedProjectId,
    targetBoardId: selectedBoardId,
    targetChannelId: targetChannelId.trim(),
    maxResults: 25,
    ...(resolvedDateFrom ? { dateFrom: resolvedDateFrom } : {}),
    ...(isFilterEnabled ? { loadFilterOptions: true } : {}),
    ...(isFilterEnabled &&
    (filters.reporterAccountIds?.length ||
      filters.creatorAccountIds?.length ||
      filters.assigneeAccountIds?.length ||
      filters.labels?.length)
      ? { filters }
      : {}),
    ...(nextPageToken ? { nextPageToken } : {}),
  });

  const handlePreview = async (nextPageToken?: string): Promise<void> => {
    if (!canPreview) {
      toast.error('Please fill Jira project key, target project, board, and channel ID');
      return;
    }

    setIsPreviewLoading(true);
    try {
      const previewResult = await jiraMigrationService.previewMigration(
        buildPayload(nextPageToken),
      );

      const boardStatusByNormalizedStageName = new Map<string, string>(
        previewResult.target.stages.map(stage => [
          normalizeStatusKey(stage.name),
          stage.defaultTicketStatusV2,
        ]),
      );

      setPreview(previewResult);
      setStatusV2Mappings(previous =>
        Object.fromEntries(
          previewResult.statusMappings.map(mapping => [
            mapping.jiraStatus,
            previous[mapping.jiraStatus] ||
              (TICKET_STATUS_V2_OPTIONS.includes(
                boardStatusByNormalizedStageName.get(
                  normalizeStatusKey(mapping.jiraStatus),
                ) as TicketStatusV2Option,
              )
                ? boardStatusByNormalizedStageName.get(normalizeStatusKey(mapping.jiraStatus))
                : '') ||
              '',
          ]),
        ),
      );
      setSkippedCustomFieldIds(previous =>
        Object.fromEntries(
          previewResult.customFieldMappings.map(mapping => [
            mapping.jiraFieldId,
            previous[mapping.jiraFieldId] || false,
          ]),
        ),
      );
      setResult(null);
      setIssueResultPage(0);
      setPreviewSection('overview');
      setCustomFieldPage(0);
      setIssueSamplePage(0);
      setMigrationPhase(prev => (prev === 'setup' ? 'map-statuses' : prev));
      toast.success('Jira migration preview loaded');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to preview migration';
      toast.error('Preview failed', { description: message });
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleImport = async (): Promise<void> => {
    if (!canPreview) {
      toast.error('Please fill Jira project key, target project, board, and channel ID');
      return;
    }

    if (!preview) {
      toast.error('Preview is required before migration');
      return;
    }

    if (!hasCompleteStatusV2Mappings) {
      toast.error('Map all Jira statuses to StatusV2 before migration');
      return;
    }

    const strictStatusV2Mappings = Object.fromEntries(
      preview.statusMappings.map(({ jiraStatus }) => [
        jiraStatus,
        statusV2Mappings[jiraStatus]?.trim() || '',
      ]),
    );
    const selectedSkipCustomFieldIds = preview.customFieldMappings
      .filter(
        mapping =>
          mapping.action === 'create_board_custom_field' &&
          skippedCustomFieldIds[mapping.jiraFieldId],
      )
      .map(mapping => mapping.jiraFieldId);

    setIsImportLoading(true);
    setResult(null);
    setMigrationProgress(null);

    try {
      const payload: JiraMigrationExecuteRequest = {
        ...buildPayload(),
        statusV2Mappings: strictStatusV2Mappings,
        skipCustomFieldIds: selectedSkipCustomFieldIds,
      };

      const startResult = await jiraMigrationService.startMigration(payload);
      persistJiraMigrationJob({
        jobId: startResult.jobId,
        jiraProjectKey: payload.jiraProjectKey,
        targetProjectId: payload.targetProjectId,
        targetBoardId: payload.targetBoardId,
        targetChannelId: payload.targetChannelId,
        ticketRange,
        ...(resolvedDateFrom ? { dateFrom: resolvedDateFrom } : {}),
        startedAt: new Date().toISOString(),
      });
      setActiveJobId(startResult.jobId);
      toast.success('Jira migration started');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start migration';
      setIsImportLoading(false);
      toast.error('Import failed', { description: message });
    }
  };

  const handleNextPage = async (): Promise<void> => {
    if (!preview?.pagination.nextPageToken) return;
    const nextToken = preview.pagination.nextPageToken;
    const existingIndex = pageTokens.findIndex(token => token === nextToken);
    const newTokens =
      existingIndex === -1 ? [...pageTokens.slice(0, pageIndex + 1), nextToken] : pageTokens;
    const newPageIndex = existingIndex === -1 ? pageIndex + 1 : existingIndex;

    setPageTokens(newTokens);
    setPageIndex(newPageIndex);
    await handlePreview(nextToken);
  };

  const handlePreviousPage = async (): Promise<void> => {
    if (pageIndex === 0) return;
    const previousPageIndex = pageIndex - 1;
    const previousToken = pageTokens[previousPageIndex];
    setPageIndex(previousPageIndex);
    await handlePreview(previousToken);
  };

  return (
    <div className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'>
      <div className='h-full overflow-y-auto'>
        <div className='border-b border-border bg-[linear-gradient(135deg,rgba(15,118,110,0.08),rgba(14,165,233,0.04),transparent)] p-6'>
          <div className='flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between'>
            <div>
              <div className='inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-emerald-800'>
                Admin Migration Console
              </div>
              <h2 className='mt-3 text-xl font-bold tracking-tight text-foreground'>
                Jira Migration Planner
              </h2>
              <p className='mt-2 max-w-2xl text-sm text-muted-foreground'>
                Preview Jira issue mappings, validate board fit, and run a resumable import into the
                selected Xyne project, board, and channel.
              </p>
            </div>
            <div className='grid grid-cols-2 gap-3 text-left lg:min-w-[320px]'>
              <div className='rounded-xl border border-border bg-background/80 p-3 shadow-sm'>
                <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>
                  Execution
                </p>
                <p className='mt-1 text-sm font-semibold text-foreground'>Async backend job</p>
                <p className='mt-1 text-xs text-muted-foreground'>Progress tracked in Redis</p>
              </div>
              <div className='rounded-xl border border-border bg-background/80 p-3 shadow-sm'>
                <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>
                  Recovery
                </p>
                <p className='mt-1 text-sm font-semibold text-foreground'>Refresh-safe UI</p>
                <p className='mt-1 text-xs text-muted-foreground'>
                  Active jobs resume automatically
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className='p-6 space-y-6'>
          <section className='overflow-hidden rounded-3xl border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-sm'>
            <div className='border-b border-border/70 bg-[linear-gradient(135deg,rgba(15,118,110,0.08),rgba(14,165,233,0.05),transparent)] px-5 py-4'>
              <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
                <div>
                  <h3 className='text-sm font-semibold text-foreground'>Migration Inputs</h3>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Choose the Jira scope and the exact Xyne destination before previewing the
                    import.
                  </p>
                </div>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-800'>
                    Project → Board → Channel
                  </span>
                  <span className='rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-800'>
                    {ticketRangeLabelMap[ticketRange]}
                  </span>
                </div>
              </div>
            </div>

            <div className='p-5'>
              <div className='grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr,0.9fr]'>
                <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <label
                      htmlFor='jira-project-key'
                      className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                    >
                      Jira Project Key
                    </label>
                    <Input
                      id='jira-project-key'
                      value={jiraProjectKey}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        setJiraProjectKey(e.target.value.toUpperCase());
                        setStatusV2Mappings({});
                        setSkippedCustomFieldIds({});
                        setMigrationPhase('setup');
                        setFilters({});
                        setIsFilterEnabled(false);
                        setPreview(null);
                        setResult(null);
                        setPageTokens([undefined]);
                        setPageIndex(0);
                      }}
                      placeholder='EUL'
                    />
                    <p className='mt-2 text-xs text-muted-foreground'>
                      Short Jira project identifier, for example `EUL`.
                    </p>
                  </div>

                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <label
                      htmlFor='jira-target-project'
                      className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                    >
                      Target Project
                    </label>
                    <EntitySelector
                      options={(projects || []).map(project => ({
                        value: project.id,
                        label: project.name,
                        icon: <FolderKanban className='w-4 h-4 text-muted-foreground' />,
                      }))}
                      selectedValue={selectedProjectId || null}
                      onSelect={value => {
                        setSelectedProjectId(value ?? '');
                        setSelectedBoardId('');
                        setTargetChannelId('');
                        setStatusV2Mappings({});
                        setSkippedCustomFieldIds({});
                        setMigrationPhase('setup');
                        setFilters({});
                        setIsFilterEnabled(false);
                        setPreview(null);
                        setResult(null);
                        setPageTokens([undefined]);
                        setPageIndex(0);
                      }}
                      placeholder='Select project'
                      searchPlaceholder='Search projects...'
                      width='100%'
                      testId='jira-target-project'
                    />
                  </div>

                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <label
                      htmlFor='jira-target-board'
                      className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                    >
                      Target Board
                    </label>
                    <EntitySelector
                      options={(boards || []).map(board => ({
                        value: board.id,
                        label: board.name,
                        icon: <LayoutTemplate className='w-4 h-4 text-muted-foreground' />,
                      }))}
                      selectedValue={selectedBoardId || null}
                      onSelect={value => {
                        setSelectedBoardId(value ?? '');
                        setStatusV2Mappings({});
                        setSkippedCustomFieldIds({});
                        setMigrationPhase('setup');
                        setFilters({});
                        setIsFilterEnabled(false);
                        setPreview(null);
                        setResult(null);
                        setPageTokens([undefined]);
                        setPageIndex(0);
                      }}
                      placeholder='Select board'
                      searchPlaceholder='Search boards...'
                      width='100%'
                      testId='jira-target-board'
                    />
                  </div>

                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <label
                      htmlFor='jira-target-channel'
                      className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                    >
                      Target Channel
                    </label>
                    <EntitySelector
                      options={channels.map(channel => ({
                        value: channel.id,
                        label: channel.name,
                        icon: <Hash className='w-4 h-4 text-muted-foreground' />,
                      }))}
                      selectedValue={targetChannelId || null}
                      onSelect={value => {
                        setTargetChannelId(value ?? '');
                        setStatusV2Mappings({});
                        setSkippedCustomFieldIds({});
                        setMigrationPhase('setup');
                        setFilters({});
                        setIsFilterEnabled(false);
                        setPreview(null);
                        setResult(null);
                        setPageTokens([undefined]);
                        setPageIndex(0);
                      }}
                      placeholder='Select channel'
                      searchPlaceholder='Search channels...'
                      width='100%'
                      testId='jira-target-channel'
                    />
                  </div>
                </div>

                <div className='rounded-2xl border border-border/70 bg-slate-50/80 p-4 shadow-sm'>
                  <label
                    htmlFor='jira-ticket-range'
                    className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                  >
                    Ticket Range
                  </label>
                  <select
                    id='jira-ticket-range'
                    data-track-category='jira_migration'
                    data-track-name='select_ticket_range'
                    value={ticketRange}
                    onChange={e => {
                      setTicketRange(e.target.value as TicketRange);
                      setStatusV2Mappings({});
                      setSkippedCustomFieldIds({});
                      setMigrationPhase('setup');
                      setFilters({});
                      setIsFilterEnabled(false);
                      setPreview(null);
                      setResult(null);
                      setPageTokens([undefined]);
                      setPageIndex(0);
                    }}
                    className='w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground shadow-sm'
                  >
                    <option value='all'>All Time</option>
                    <option value='last_1_month'>Last 1 Month</option>
                    <option value='last_6_months'>Last 6 Months</option>
                    <option value='last_1_year'>Last 1 Year</option>
                  </select>

                  <div className='mt-4 rounded-2xl border border-border/70 bg-background p-4'>
                    <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>
                      Target Context
                    </p>
                    <p className='mt-2 text-sm font-medium text-foreground'>
                      {selectedProject && selectedBoard
                        ? `${selectedProject.name} / ${selectedBoard.name}${selectedChannel ? ` / ${selectedChannel.name}` : ''}`
                        : 'Select project, board, and channel'}
                    </p>
                    <p className='mt-2 text-xs text-muted-foreground'>
                      Range: {ticketRangeLabelMap[ticketRange]}
                      {resolvedDateFrom ? ` • Since ${resolvedDateFrom}` : ''}
                    </p>
                  </div>

                  <div className='mt-4 rounded-2xl border border-border/70 bg-background p-4'>
                    <div className='flex items-start justify-between gap-3'>
                      <div>
                        <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>
                          Ticket Filters
                        </p>
                        <p className='mt-2 text-sm font-medium text-foreground'>
                          Apply assignee, reporter, creator, and label filters only when needed.
                        </p>
                        <p className='mt-1 text-xs text-muted-foreground'>
                          Filters are optional. If disabled, preview uses the standard Jira flow and
                          does not load filter metadata.
                        </p>
                      </div>
                      {preview && isFilterEnabled && (
                        <span className='rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-800'>
                          {preview.filteredIssueCount} matching issues
                        </span>
                      )}
                    </div>

                    <div className='mt-4 flex items-center justify-between rounded-xl border border-border bg-muted/10 px-4 py-3'>
                      <div>
                        <p className='text-sm font-medium text-foreground'>Enable Filters</p>
                        <p className='mt-1 text-xs text-muted-foreground'>
                          Turn this on only if you want to filter by assignee, reporter, creator, or
                          labels.
                        </p>
                      </div>
                      <input
                        type='checkbox'
                        data-track-category='jira_migration'
                        data-track-name='toggle_filters'
                        checked={isFilterEnabled}
                        onChange={event => {
                          const checked = event.target.checked;
                          setIsFilterEnabled(checked);
                          setFilters({});
                          setPreview(null);
                          setResult(null);
                          setPageTokens([undefined]);
                          setPageIndex(0);
                        }}
                        className='h-4 w-4 rounded border-border text-emerald-600 focus:ring-emerald-500'
                      />
                    </div>

                    {isFilterEnabled ? (
                      preview ? (
                        <div className='mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4'>
                          <div>
                            <p className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                              Assignee
                            </p>
                            <EntityMultiSelector
                              options={preview.filterOptions.assignees.map(user => ({
                                value: user.accountId,
                                label: user.displayName,
                                ...(user.emailAddress ? { subtitle: user.emailAddress } : {}),
                                icon: <User className='w-4 h-4 text-muted-foreground' />,
                              }))}
                              selectedValues={filters.assigneeAccountIds || []}
                              onMultiSelect={values =>
                                setFilters(previous => ({
                                  ...previous,
                                  assigneeAccountIds: values,
                                }))
                              }
                              placeholder='Search assignees...'
                              searchPlaceholder='Search assignees...'
                              width='100%'
                              inputClassName='w-full min-h-10 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm'
                            />
                          </div>
                          <div>
                            <p className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                              Reporter
                            </p>
                            <EntityMultiSelector
                              options={preview.filterOptions.reporters.map(user => ({
                                value: user.accountId,
                                label: user.displayName,
                                ...(user.emailAddress ? { subtitle: user.emailAddress } : {}),
                                icon: <User className='w-4 h-4 text-muted-foreground' />,
                              }))}
                              selectedValues={filters.reporterAccountIds || []}
                              onMultiSelect={values =>
                                setFilters(previous => ({
                                  ...previous,
                                  reporterAccountIds: values,
                                }))
                              }
                              placeholder='Search reporters...'
                              searchPlaceholder='Search reporters...'
                              width='100%'
                              inputClassName='w-full min-h-10 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm'
                            />
                          </div>
                          <div>
                            <p className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                              Creator
                            </p>
                            <EntityMultiSelector
                              options={preview.filterOptions.creators.map(user => ({
                                value: user.accountId,
                                label: user.displayName,
                                ...(user.emailAddress ? { subtitle: user.emailAddress } : {}),
                                icon: <User className='w-4 h-4 text-muted-foreground' />,
                              }))}
                              selectedValues={filters.creatorAccountIds || []}
                              onMultiSelect={values =>
                                setFilters(previous => ({ ...previous, creatorAccountIds: values }))
                              }
                              placeholder='Search creators...'
                              searchPlaceholder='Search creators...'
                              width='100%'
                              inputClassName='w-full min-h-10 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm'
                            />
                          </div>
                          <div>
                            <p className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                              Labels
                            </p>
                            <EntityMultiSelector
                              options={preview.filterOptions.labels.map(label => ({
                                value: label,
                                label,
                                icon: <Tag className='w-4 h-4 text-muted-foreground' />,
                              }))}
                              selectedValues={filters.labels || []}
                              onMultiSelect={values =>
                                setFilters(previous => ({ ...previous, labels: values }))
                              }
                              placeholder='Search labels...'
                              searchPlaceholder='Search labels...'
                              width='100%'
                              inputClassName='w-full min-h-10 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm'
                            />
                          </div>
                        </div>
                      ) : (
                        <div className='mt-4 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground'>
                          Click Load Preview after enabling filters to fetch assignee, reporter,
                          creator, and label options for this Jira project.
                        </div>
                      )
                    ) : (
                      <div className='mt-4 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground'>
                        Filters are off. Preview and migration will include the normal Jira scope
                        without loading filter option data.
                      </div>
                    )}
                  </div>

                  <div className='mt-4 flex flex-wrap gap-2'>
                    <Button
                      onClick={() => {
                        setPageTokens([undefined]);
                        setPageIndex(0);
                        void handlePreview();
                      }}
                      disabled={isPreviewLoading || isImportLoading || !canPreview}
                    >
                      {isPreviewLoading
                        ? 'Loading Preview...'
                        : preview
                          ? 'Refresh Preview'
                          : 'Load Preview'}
                    </Button>
                    <Button
                      variant='outline'
                      onClick={() => setIsHistoryModalOpen(true)}
                      disabled={migrationHistory.length === 0}
                    >
                      View Migrated Projects
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Step Indicator */}
          {migrationPhase !== 'setup' && (
            <nav className='flex flex-wrap items-center gap-2 px-1'>
              {[
                { phase: 'setup' as MigrationPhase, label: '1. Configure' },
                { phase: 'map-statuses' as MigrationPhase, label: '2. Map Statuses' },
                { phase: 'migrate' as MigrationPhase, label: '3. Migrate Tickets' },
              ].map(({ phase, label }, idx) => {
                const phaseOrder: MigrationPhase[] = ['setup', 'map-statuses', 'migrate'];
                const isCompleted = phaseOrder.indexOf(phase) < phaseOrder.indexOf(migrationPhase);
                const isCurrent = phase === migrationPhase;
                return (
                  <span key={phase} className='flex items-center gap-2'>
                    {idx > 0 && <span className='text-muted-foreground text-xs'>›</span>}
                    <span
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                        isCompleted
                          ? 'bg-emerald-100 text-emerald-800'
                          : isCurrent
                            ? 'bg-sky-100 text-sky-800 ring-1 ring-sky-300'
                            : 'bg-muted/30 text-muted-foreground'
                      }`}
                    >
                      {isCompleted ? `✓ ${label}` : label}
                    </span>
                  </span>
                );
              })}
            </nav>
          )}

          {/* Step 2: Map Statuses */}
          {preview && migrationPhase === 'map-statuses' && (
            <section className='overflow-hidden rounded-3xl border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-sm'>
              <div className='border-b border-border/70 bg-[linear-gradient(135deg,rgba(15,118,110,0.08),rgba(14,165,233,0.05),transparent)] px-5 py-4'>
                <div className='flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between'>
                  <div>
                    <div className='inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-sky-800'>
                      Step 2 of 3
                    </div>
                    <h3 className='mt-2 text-sm font-semibold text-foreground'>
                      Map Jira Statuses to StatusV2
                    </h3>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      Assign a StatusV2 category to each Jira status. Xyne stages will be
                      auto-created using the exact Jira status names.
                    </p>
                  </div>
                  <span className='text-xs text-muted-foreground'>
                    {preview.jiraProject.totalIssues} total issues · {preview.statusMappings.length}{' '}
                    project-wide statuses (fetched from Jira project config, not just preview page)
                  </span>
                </div>
              </div>
              <div className='p-5'>
                {statusesMissingV2Mapping.length > 0 ? (
                  <div className='mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800'>
                    {statusesMissingV2Mapping.length}{' '}
                    {statusesMissingV2Mapping.length === 1 ? 'new status' : 'new statuses'} still
                    need a StatusV2 mapping.
                  </div>
                ) : (
                  <div className='mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800'>
                    All Jira statuses mapped — you can proceed to migration.
                  </div>
                )}
                {mappedStatusMappings.length > 0 && (
                  <div className='mb-5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4'>
                    <div className='flex items-center justify-between gap-2'>
                      <h4 className='text-xs font-semibold uppercase tracking-[0.08em] text-emerald-900'>
                        Already Mapped
                      </h4>
                      <span className='text-xs text-emerald-800'>
                        {mappedStatusMappings.length} mapped
                      </span>
                    </div>
                    <div className='mt-3 flex flex-wrap gap-2'>
                      {mappedStatusMappings.map(mapping => (
                        <div
                          key={`mapped-${mapping.jiraStatus}`}
                          className='inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs text-foreground'
                        >
                          <span className='font-medium'>{mapping.jiraStatus}</span>
                          <span className='text-muted-foreground'>→</span>
                          <span className='font-semibold text-emerald-700'>
                            {statusV2Mappings[mapping.jiraStatus]}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
                  {newStatusMappings.map(mapping => (
                    <div
                      key={mapping.jiraStatus}
                      className='rounded-lg border border-border bg-muted/10 p-3'
                    >
                      <div className='flex items-start justify-between gap-2'>
                        <p className='text-sm font-medium text-foreground'>{mapping.jiraStatus}</p>
                        <span
                          className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${confidenceClassMap[mapping.confidence]}`}
                        >
                          {mapping.confidence}
                        </span>
                      </div>
                      <div className='mt-3'>
                        <label
                          htmlFor={`status-v2-${mapping.jiraStatus}`}
                          className='text-xs text-muted-foreground'
                        >
                          StatusV2
                        </label>
                        <select
                          id={`status-v2-${mapping.jiraStatus}`}
                          data-track-category='jira_migration'
                          data-track-name='select_status_v2_mapping'
                          value={statusV2Mappings[mapping.jiraStatus] || ''}
                          onChange={event => {
                            const selectedStatusV2 = event.target.value;
                            setStatusV2Mappings(previous => ({
                              ...previous,
                              [mapping.jiraStatus]: selectedStatusV2,
                            }));
                          }}
                          className='mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm'
                        >
                          <option value=''>Select StatusV2</option>
                          {TICKET_STATUS_V2_OPTIONS.map(statusV2 => (
                            <option key={statusV2} value={statusV2}>
                              {statusV2}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
                <div className='mt-6 flex flex-wrap items-center gap-3 border-t border-border/60 pt-5'>
                  <Button variant='outline' onClick={() => setMigrationPhase('setup')}>
                    ← Back to Configure
                  </Button>
                  <Button
                    onClick={() => setMigrationPhase('migrate')}
                    disabled={!hasCompleteStatusV2Mappings}
                  >
                    Proceed to Migration →
                  </Button>
                </div>
              </div>
            </section>
          )}

          {/* Step 3: Migrate action bar */}
          {preview && migrationPhase === 'migrate' && (
            <section className='overflow-hidden rounded-3xl border border-emerald-200/60 bg-[linear-gradient(135deg,rgba(16,185,129,0.06),rgba(255,255,255,0.96))] shadow-sm'>
              <div className='flex flex-wrap items-center justify-between gap-3 px-5 py-4'>
                <div>
                  <div className='inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-emerald-800'>
                    Step 3 of 3
                  </div>
                  <h3 className='mt-2 text-sm font-semibold text-foreground'>Ready to Migrate</h3>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    All {preview.statusMappings.length} Jira statuses are mapped. Review the preview
                    below and run the migration when ready.
                  </p>
                </div>
                <div className='flex flex-wrap items-center gap-2'>
                  <Button
                    variant='outline'
                    onClick={() => setMigrationPhase('map-statuses')}
                    disabled={isImportLoading}
                  >
                    ← Edit Status Mappings
                  </Button>
                  <Button
                    onClick={() => void handleImport()}
                    disabled={isImportLoading || !hasCompleteStatusV2Mappings}
                  >
                    {isImportLoading ? 'Migrating...' : 'Migrate Tickets'}
                  </Button>
                </div>
              </div>
            </section>
          )}

          {migrationProgress && (
            <section className='rounded-2xl border border-emerald-200 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(255,255,255,0.92))] p-5 shadow-sm'>
              <div className='flex items-start justify-between gap-4'>
                <div>
                  <h3 className='text-sm font-semibold text-foreground'>Live Migration Progress</h3>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Redis-backed execution status for the active Jira migration job.
                  </p>
                </div>
                <div className='text-right text-xs text-muted-foreground'>
                  <p>Job ID</p>
                  <p className='mt-1 font-medium text-foreground'>{migrationProgress.jobId}</p>
                </div>
              </div>

              {(() => {
                const totalIssues = migrationProgress.totalIssues ?? 0;
                const progressWidth =
                  totalIssues > 0
                    ? Math.min(100, (migrationProgress.processedIssues / totalIssues) * 100)
                    : 0;

                return (
                  <>
                    <div className='mt-4 h-2 w-full overflow-hidden rounded-full bg-emerald-100'>
                      <div
                        className='h-full rounded-full bg-emerald-600 transition-all'
                        style={{ width: `${progressWidth}%` }}
                      />
                    </div>

                    <div className='mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6'>
                      <div className='rounded-lg bg-card/70 p-3'>
                        <p className='text-[11px] text-muted-foreground'>Status</p>
                        <p className='mt-1 text-lg font-semibold text-foreground capitalize'>
                          {migrationProgress.status}
                        </p>
                      </div>
                      <div className='rounded-lg bg-card/70 p-3'>
                        <p className='text-[11px] text-muted-foreground'>Processed Issues</p>
                        <p className='mt-1 text-lg font-semibold text-foreground'>
                          {migrationProgress.processedIssues}
                        </p>
                      </div>
                      <div className='rounded-lg bg-card/70 p-3'>
                        <p className='text-[11px] text-muted-foreground'>Imported Tickets</p>
                        <p className='mt-1 text-lg font-semibold text-foreground'>
                          {migrationProgress.importedTickets}
                        </p>
                      </div>
                      <div className='rounded-lg bg-card/70 p-3'>
                        <p className='text-[11px] text-muted-foreground'>Imported Comments</p>
                        <p className='mt-1 text-lg font-semibold text-foreground'>
                          {migrationProgress.importedComments}
                        </p>
                      </div>
                      <div className='rounded-lg bg-card/70 p-3'>
                        <p className='text-[11px] text-muted-foreground'>Imported Attachments</p>
                        <p className='mt-1 text-lg font-semibold text-foreground'>
                          {migrationProgress.importedAttachments}
                        </p>
                      </div>
                      <div className='rounded-lg bg-card/70 p-3'>
                        <p className='text-[11px] text-muted-foreground'>Current Step</p>
                        <p className='mt-1 text-lg font-semibold text-foreground'>
                          {migrationProgress.currentStep || 'Waiting'}
                        </p>
                      </div>
                    </div>

                    <div className='mt-4 rounded-lg border border-emerald-200 bg-card/70 p-3'>
                      <p className='text-xs text-muted-foreground'>Current Issue</p>
                      <p className='mt-1 text-sm font-medium text-foreground'>
                        {migrationProgress.currentIssueKey ||
                          (migrationProgress.status === 'completed'
                            ? 'Completed'
                            : migrationProgress.status === 'failed'
                              ? 'Stopped'
                              : 'Waiting to start')}
                      </p>
                    </div>
                  </>
                );
              })()}

              {migrationProgress.errorMessage && (
                <div className='mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3'>
                  <p className='text-xs font-semibold text-rose-900'>Job Error</p>
                  <p className='mt-1 text-xs text-rose-900'>{migrationProgress.errorMessage}</p>
                </div>
              )}
            </section>
          )}

          {result && (
            <section className='rounded-2xl border border-border bg-background p-5 shadow-sm'>
              <div className='flex items-start justify-between gap-4'>
                <div>
                  <h3 className='text-sm font-semibold text-foreground'>Last Import Result</h3>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Jira project {result.jiraProjectKey} imported into the selected Xyne target.
                  </p>
                </div>
                <div className='text-right text-xs text-muted-foreground'>
                  <p>External Source</p>
                  <p className='mt-1 font-medium text-foreground'>
                    {result.externalSourceId || 'Not created'}
                  </p>
                  {targetChannelId && (
                    <a
                      href={`/chat/dir/${targetChannelId}`}
                      className='mt-2 inline-flex text-xs font-medium text-sky-700 hover:underline'
                    >
                      Open Channel
                    </a>
                  )}
                </div>
              </div>

              <div className='mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6'>
                <div className='rounded-lg bg-muted/30 p-3'>
                  <p className='text-[11px] text-muted-foreground'>Imported Tickets</p>
                  <p className='mt-1 text-lg font-semibold text-foreground'>
                    {result.importedTickets}
                  </p>
                </div>
                <div className='rounded-lg bg-muted/30 p-3'>
                  <p className='text-[11px] text-muted-foreground'>Skipped Tickets</p>
                  <p className='mt-1 text-lg font-semibold text-foreground'>
                    {result.skippedTickets}
                  </p>
                </div>
                <div className='rounded-lg bg-muted/30 p-3'>
                  <p className='text-[11px] text-muted-foreground'>Imported Comments</p>
                  <p className='mt-1 text-lg font-semibold text-foreground'>
                    {result.importedComments}
                  </p>
                </div>
                <div className='rounded-lg bg-muted/30 p-3'>
                  <p className='text-[11px] text-muted-foreground'>Imported Attachments</p>
                  <p className='mt-1 text-lg font-semibold text-foreground'>
                    {result.importedAttachments}
                  </p>
                </div>
                <div className='rounded-lg bg-muted/30 p-3'>
                  <p className='text-[11px] text-muted-foreground'>Created Custom Fields</p>
                  <p className='mt-1 text-lg font-semibold text-foreground'>
                    {result.createdBoardCustomFields}
                  </p>
                </div>
                <div className='rounded-lg bg-muted/30 p-3'>
                  <p className='text-[11px] text-muted-foreground'>Linked Tickets</p>
                  <p className='mt-1 text-lg font-semibold text-foreground'>
                    {result.linkedTickets}
                  </p>
                </div>
                <div className='rounded-lg bg-muted/30 p-3'>
                  <p className='text-[11px] text-muted-foreground'>Created Subtickets</p>
                  <p className='mt-1 text-lg font-semibold text-foreground'>
                    {result.createdSubTickets}
                  </p>
                </div>
              </div>

              {result.warnings.length > 0 && (
                <div className='mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4'>
                  <h4 className='text-xs font-semibold text-amber-900'>Warnings</h4>
                  <div className='mt-2 space-y-2'>
                    {result.warnings.map((warning, index) => (
                      <p key={`${warning}-${index}`} className='text-xs text-amber-900'>
                        {warning}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {result.unresolvedUsers.length > 0 && (
                <div className='mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4'>
                  <h4 className='text-xs font-semibold text-rose-900'>Unresolved Jira Users</h4>
                  <div className='mt-2 space-y-3'>
                    {result.unresolvedUsers.map((user, index) => (
                      <div
                        key={`${user.accountId || user.displayName || 'unknown'}-${index}`}
                        className='rounded-md border border-rose-200 bg-card/70 p-3'
                      >
                        <p className='text-xs font-medium text-rose-900'>
                          {user.displayName || 'Unknown Jira user'}
                        </p>
                        <p className='mt-1 text-xs text-rose-900'>
                          Account ID: {user.accountId || '—'}
                        </p>
                        <p className='mt-1 text-xs text-rose-900'>
                          Suggested emails:{' '}
                          {user.suggestedEmails.length > 0 ? user.suggestedEmails.join(', ') : '—'}
                        </p>
                        <p className='mt-1 text-xs text-rose-900'>
                          Tickets: {user.issueKeys.length > 0 ? user.issueKeys.join(', ') : '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.issueResults.length > 0 && (
                <div className='mt-4 rounded-lg border border-border bg-muted/10 p-4'>
                  <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
                    <div>
                      <h4 className='text-xs font-semibold text-foreground'>
                        Issue Execution Details
                      </h4>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        Per-ticket execution status with failed step and detailed errors.
                      </p>
                    </div>
                    <div className='flex items-center gap-2 text-right text-xs text-muted-foreground'>
                      <span>{result.issueResults.length} issues tracked</span>
                      <span>•</span>
                      <span>
                        Page {issueResultPage + 1} of {issueResultPageCount}
                      </span>
                    </div>
                  </div>
                  <div className='mt-3 flex items-center justify-end gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => setIssueResultPage(page => Math.max(0, page - 1))}
                      disabled={issueResultPage === 0}
                    >
                      Previous
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() =>
                        setIssueResultPage(page => Math.min(issueResultPageCount - 1, page + 1))
                      }
                      disabled={issueResultPage >= issueResultPageCount - 1}
                    >
                      Next
                    </Button>
                  </div>
                  <div className='mt-3 space-y-3'>
                    {paginatedIssueResults.map(issue => (
                      <div
                        key={issue.issueKey}
                        className='rounded-md border border-border bg-card/70 p-3'
                      >
                        <div className='flex items-start justify-between gap-3'>
                          <div>
                            <p className='text-sm font-medium text-foreground'>{issue.issueKey}</p>
                            <p className='mt-1 text-xs text-muted-foreground'>{issue.summary}</p>
                          </div>
                          <div className='text-right'>
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${issueStatusClassMap[issue.status]}`}
                            >
                              {issue.status}
                            </span>
                            <p className='mt-1 text-xs text-muted-foreground'>
                              Failed step: {issue.failedStep || '—'}
                            </p>
                          </div>
                        </div>
                        {issue.errors.length > 0 && (
                          <div className='mt-3 space-y-2'>
                            {issue.errors.map((error, index) => (
                              <p
                                key={`${issue.issueKey}-${index}`}
                                className='text-xs text-rose-900'
                              >
                                {error}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <Dialog
            open={isHistoryModalOpen}
            onOpenChange={setIsHistoryModalOpen}
            title='Migrated Jira Projects'
            description='Persisted Jira migration sources already imported into Xyne.'
            className='max-w-4xl'
          >
            <div className='rounded-2xl bg-background p-5 shadow-sm'>
              <div className='flex items-start justify-between gap-4 border-b border-border pb-4'>
                <div>
                  <h3 className='text-sm font-semibold text-foreground'>Migrated Jira Projects</h3>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Persisted Jira migration sources already imported into Xyne.
                  </p>
                </div>
                <div className='text-right text-xs text-muted-foreground'>
                  <p>{migrationHistory.length} sources</p>
                </div>
              </div>
              <div className='mt-4 max-h-[70vh] overflow-y-auto pr-1'>
                <div className='grid grid-cols-1 gap-3 xl:grid-cols-2'>
                  {migrationHistory.map(item => (
                    <div
                      key={item.externalSourceId}
                      className='rounded-lg border border-border bg-muted/10 p-4'
                    >
                      <div className='flex items-start justify-between gap-3'>
                        <div>
                          <p className='text-sm font-medium text-foreground'>
                            {item.jiraProjectKey}
                          </p>
                          <p className='mt-1 text-xs text-muted-foreground'>{item.displayName}</p>
                        </div>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            item.isActive
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {item.isActive ? 'active' : 'inactive'}
                        </span>
                      </div>
                      <div className='mt-3 grid grid-cols-2 gap-3'>
                        <div>
                          <p className='text-[11px] text-muted-foreground'>Board ID</p>
                          <p className='mt-1 text-sm text-foreground'>
                            {item.targetBoardId || '—'}
                          </p>
                        </div>
                        <div>
                          <p className='text-[11px] text-muted-foreground'>Channel ID</p>
                          <p className='mt-1 text-sm text-foreground'>{item.targetChannelId}</p>
                        </div>
                      </div>
                      <div className='mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground'>
                        <span>Created {new Date(item.createdAt).toLocaleString()}</span>
                        <span>Updated {new Date(item.updatedAt).toLocaleString()}</span>
                      </div>
                      <div className='mt-3'>
                        <a
                          href={`/chat/dir/${item.targetChannelId}`}
                          className='inline-flex text-xs font-medium text-sky-700 hover:underline'
                        >
                          Open Channel
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Dialog>

          {migrationPhase === 'setup' && !preview && (
            <section className='rounded-2xl border border-dashed border-border bg-muted/10 p-10 text-center'>
              <h3 className='text-sm font-semibold text-foreground'>No preview yet</h3>
              <p className='mt-2 text-xs text-muted-foreground'>
                Fill in your Jira project key, target project, board, and channel, then click
                &ldquo;Start Migration&rdquo; to load statuses and begin mapping.
              </p>
            </section>
          )}

          {preview && migrationPhase === 'migrate' && (
            <>
              <section className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4'>
                <div className='rounded-2xl border border-border bg-[linear-gradient(135deg,rgba(15,118,110,0.08),rgba(255,255,255,0.96))] p-5 shadow-sm'>
                  <p className='text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
                    Jira Scope
                  </p>
                  <h3 className='mt-2 text-lg font-semibold text-foreground'>
                    {preview.jiraProject.key}
                  </h3>
                  <p className='mt-1 text-sm text-muted-foreground'>
                    {preview.jiraProject.totalIssues} issues in project
                  </p>
                </div>
                <div className='rounded-2xl border border-border bg-background p-5 shadow-sm'>
                  <p className='text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
                    Target
                  </p>
                  <h3 className='mt-2 text-lg font-semibold text-foreground'>
                    {preview.target.boardName}
                  </h3>
                  <p className='mt-1 text-sm text-muted-foreground'>{preview.target.projectName}</p>
                </div>
                <div className='rounded-2xl border border-border bg-background p-5 shadow-sm'>
                  <p className='text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
                    Custom Fields
                  </p>
                  <h3 className='mt-2 text-lg font-semibold text-foreground'>
                    {preview.customFieldMappings.length}
                  </h3>
                  <p className='mt-1 text-sm text-muted-foreground'>
                    Create {previewActionCounts.create} • Reuse {previewActionCounts.reuse}
                  </p>
                </div>
                <div className='rounded-2xl border border-border bg-background p-5 shadow-sm'>
                  <p className='text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
                    Preview Page
                  </p>
                  <h3 className='mt-2 text-lg font-semibold text-foreground'>{pageIndex + 1}</h3>
                  <p className='mt-1 text-sm text-muted-foreground'>
                    {preview.pagination.currentPageIssueCount} issues shown
                  </p>
                </div>
              </section>

              <section className='rounded-2xl border border-border bg-background p-5 shadow-sm'>
                <div className='flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
                  <div>
                    <h3 className='text-sm font-semibold text-foreground'>Preview Workspace</h3>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      Focus on one area at a time instead of scanning the full migration report.
                    </p>
                  </div>
                  <div className='flex flex-wrap items-center gap-2'>
                    {(
                      [
                        ['overview', 'Overview'],
                        ['fields', `Custom Fields (${preview.customFieldMappings.length})`],
                        ['issues', `Issue Samples (${preview.issueSamples.length})`],
                      ] as Array<[PreviewSection, string]>
                    ).map(([sectionKey, label]) => (
                      <button
                        key={sectionKey}
                        type='button'
                        data-track-category='jira_migration'
                        data-track-name={`preview_section_${sectionKey}`}
                        onClick={() => setPreviewSection(sectionKey)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                          previewSection === sectionKey
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className='mt-4 flex flex-col gap-3 rounded-xl border border-border bg-muted/10 p-4 lg:flex-row lg:items-center lg:justify-between'>
                  <div>
                    <p className='text-xs font-medium text-foreground'>Jira page navigation</p>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      Page {pageIndex + 1} • {preview.pagination.currentPageIssueCount} issues in
                      this preview slice
                    </p>
                  </div>
                  <div className='flex items-center gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => void handlePreviousPage()}
                      disabled={isPreviewLoading || pageIndex === 0}
                    >
                      Previous Page
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => void handleNextPage()}
                      disabled={isPreviewLoading || !preview.pagination.hasNextPage}
                    >
                      Next Page
                    </Button>
                  </div>
                </div>

                {previewSection === 'overview' && (
                  <div className='mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.15fr,0.85fr]'>
                    <div className='rounded-xl border border-border p-4'>
                      <div className='flex items-center justify-between gap-3'>
                        <div>
                          <h4 className='text-sm font-semibold text-foreground'>
                            Migration Summary
                          </h4>
                          <p className='mt-1 text-xs text-muted-foreground'>
                            High-signal view of what this import will create, reuse, or preserve.
                          </p>
                        </div>
                      </div>
                      <div className='mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3'>
                        <div className='rounded-lg border border-blue-200 bg-blue-50 p-3'>
                          <p className='text-[11px] uppercase tracking-wide text-blue-700'>
                            Create
                          </p>
                          <p className='mt-1 text-2xl font-semibold text-blue-900'>
                            {previewActionCounts.create}
                          </p>
                          <p className='mt-1 text-xs text-blue-800'>New board custom fields</p>
                        </div>
                        <div className='rounded-lg border border-emerald-200 bg-emerald-50 p-3'>
                          <p className='text-[11px] uppercase tracking-wide text-emerald-700'>
                            Reuse
                          </p>
                          <p className='mt-1 text-2xl font-semibold text-emerald-900'>
                            {previewActionCounts.reuse}
                          </p>
                          <p className='mt-1 text-xs text-emerald-800'>Existing board fields</p>
                        </div>
                        <div className='rounded-lg border border-amber-200 bg-amber-50 p-3'>
                          <p className='text-[11px] uppercase tracking-wide text-amber-700'>
                            Metadata
                          </p>
                          <p className='mt-1 text-2xl font-semibold text-amber-900'>
                            {previewActionCounts.metadata}
                          </p>
                          <p className='mt-1 text-xs text-amber-800'>Stored without board fields</p>
                        </div>
                      </div>

                      <div className='mt-5 rounded-lg border border-border bg-background p-4'>
                        <div className='flex items-center justify-between gap-3'>
                          <div>
                            <h5 className='text-sm font-semibold text-foreground'>
                              Core Field Mapping
                            </h5>
                            <p className='mt-1 text-xs text-muted-foreground'>
                              Stable mappings that will apply to every imported issue.
                            </p>
                          </div>
                          <span className='text-xs text-muted-foreground'>
                            {preview.coreMappings.length} mappings
                          </span>
                        </div>
                        <div className='mt-3 space-y-2'>
                          {preview.coreMappings.map(mapping => (
                            <div
                              key={mapping.jiraField}
                              className='flex flex-col gap-1 rounded-lg border border-border/80 bg-muted/10 p-3 sm:flex-row sm:items-start sm:justify-between'
                            >
                              <div>
                                <p className='text-sm font-medium text-foreground'>
                                  {mapping.jiraField}
                                </p>
                                <p className='mt-1 text-xs text-muted-foreground'>
                                  {mapping.notes ||
                                    'Mapped directly into the target workflow model.'}
                                </p>
                              </div>
                              <p className='text-xs font-medium text-foreground sm:text-right'>
                                {mapping.targetField}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className='rounded-xl border border-border p-4'>
                      <div className='flex items-center justify-between gap-3'>
                        <div>
                          <h4 className='text-sm font-semibold text-foreground'>Status Mappings</h4>
                          <p className='mt-1 text-xs text-muted-foreground'>
                            StatusV2 assigned in Step 2.
                          </p>
                        </div>
                        <button
                          type='button'
                          data-track-category='jira_migration'
                          data-track-name='click_edit_status_mappings'
                          onClick={() => setMigrationPhase('map-statuses')}
                          className='text-xs font-medium text-sky-700 hover:underline'
                        >
                          Edit
                        </button>
                      </div>
                      <div className='mt-4 space-y-2'>
                        {preview.statusMappings.map(mapping => (
                          <div
                            key={mapping.jiraStatus}
                            className='flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/10 px-3 py-2'
                          >
                            <p className='text-sm text-foreground'>{mapping.jiraStatus}</p>
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                statusV2Mappings[mapping.jiraStatus]
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {statusV2Mappings[mapping.jiraStatus] || 'Unmapped'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {previewSection === 'fields' && (
                  <div className='mt-5 rounded-xl border border-border p-4'>
                    <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                      <div>
                        <h4 className='text-sm font-semibold text-foreground'>Custom Field Plan</h4>
                        <p className='mt-1 text-xs text-muted-foreground'>
                          Review only a small set at a time instead of scrolling through the full
                          list.
                        </p>
                      </div>
                      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                        <span>
                          Page {customFieldPage + 1} of {previewActionCounts.fieldsPageCount}
                        </span>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => setCustomFieldPage(page => Math.max(0, page - 1))}
                          disabled={customFieldPage === 0}
                        >
                          Previous
                        </Button>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() =>
                            setCustomFieldPage(page =>
                              Math.min(previewActionCounts.fieldsPageCount - 1, page + 1),
                            )
                          }
                          disabled={customFieldPage >= previewActionCounts.fieldsPageCount - 1}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                    <div className='mt-4 space-y-3'>
                      {paginatedCustomFieldMappings.map(mapping => (
                        <div
                          key={mapping.jiraFieldId}
                          className='rounded-xl border border-border bg-muted/10 p-4'
                        >
                          <div className='flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between'>
                            <div>
                              <p className='text-sm font-semibold text-foreground'>
                                {mapping.jiraFieldName}
                              </p>
                              <p className='mt-1 text-xs text-muted-foreground'>
                                {mapping.jiraFieldId}
                              </p>
                            </div>
                            <div className='flex flex-col items-start gap-2 lg:items-end'>
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${actionClassMap[mapping.action]}`}
                              >
                                {mapping.action.replaceAll('_', ' ')}
                              </span>
                              {mapping.action === 'create_board_custom_field' && (
                                <label className='inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground'>
                                  <input
                                    type='checkbox'
                                    data-track-category='jira_migration'
                                    data-track-name='toggle_skip_custom_field'
                                    checked={Boolean(skippedCustomFieldIds[mapping.jiraFieldId])}
                                    onChange={event => {
                                      const checked = event.target.checked;
                                      setSkippedCustomFieldIds(previous => ({
                                        ...previous,
                                        [mapping.jiraFieldId]: checked,
                                      }));
                                    }}
                                  />
                                  Skip this field in import
                                </label>
                              )}
                            </div>
                          </div>
                          <div className='mt-4 grid grid-cols-1 gap-3 md:grid-cols-3'>
                            <div>
                              <p className='text-[11px] text-muted-foreground'>
                                Suggested Xyne Field
                              </p>
                              <p className='mt-1 text-sm text-foreground'>
                                {mapping.suggestedXyneFieldName}
                              </p>
                              {mapping.matchedExistingFieldId && (
                                <p className='mt-1 text-xs text-muted-foreground'>
                                  Existing field: {mapping.matchedExistingFieldId}
                                </p>
                              )}
                            </div>
                            <div>
                              <p className='text-[11px] text-muted-foreground'>Type Mapping</p>
                              <p className='mt-1 text-sm text-foreground'>
                                {mapping.jiraFieldType} → {mapping.suggestedXyneFieldType}
                              </p>
                            </div>
                            <div>
                              <p className='text-[11px] text-muted-foreground'>Coverage</p>
                              <p className='mt-1 text-sm text-foreground'>
                                {mapping.issueCoverageCount} issues
                              </p>
                            </div>
                          </div>
                          <p className='mt-4 text-xs text-muted-foreground'>{mapping.reason}</p>
                          {mapping.sampleValues.length > 0 && (
                            <div className='mt-4 flex flex-wrap gap-2'>
                              {mapping.sampleValues.map(sample => (
                                <span
                                  key={`${mapping.jiraFieldId}-${sample}`}
                                  className='rounded-full bg-background px-2.5 py-1 text-[11px] text-muted-foreground border border-border'
                                >
                                  {sample}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {previewSection === 'issues' && (
                  <div className='mt-5 rounded-xl border border-border p-4'>
                    <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                      <div>
                        <h4 className='text-sm font-semibold text-foreground'>Issue Samples</h4>
                        <p className='mt-1 text-xs text-muted-foreground'>
                          Representative issues from the current Jira page to validate type,
                          ownership, and load.
                        </p>
                      </div>
                      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                        <span>
                          Page {issueSamplePage + 1} of {previewActionCounts.issuePageCount}
                        </span>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => setIssueSamplePage(page => Math.max(0, page - 1))}
                          disabled={issueSamplePage === 0}
                        >
                          Previous
                        </Button>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() =>
                            setIssueSamplePage(page =>
                              Math.min(previewActionCounts.issuePageCount - 1, page + 1),
                            )
                          }
                          disabled={issueSamplePage >= previewActionCounts.issuePageCount - 1}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                    <div className='mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2'>
                      {paginatedIssueSamples.map(issue => (
                        <div
                          key={issue.id}
                          className='rounded-xl border border-border bg-muted/10 p-4'
                        >
                          <div className='flex items-start justify-between gap-3'>
                            <div>
                              <p className='text-sm font-semibold text-foreground'>{issue.key}</p>
                              <p className='mt-1 text-sm text-foreground'>{issue.summary}</p>
                            </div>
                            <div className='text-right'>
                              <p className='text-[11px] text-muted-foreground'>Status</p>
                              <p className='mt-1 text-sm font-medium text-foreground'>
                                {issue.status}
                              </p>
                            </div>
                          </div>
                          <div className='mt-4 grid grid-cols-2 gap-3 text-sm'>
                            <div>
                              <p className='text-[11px] text-muted-foreground'>Type</p>
                              <p className='mt-1 text-foreground'>{issue.issueType}</p>
                            </div>
                            <div>
                              <p className='text-[11px] text-muted-foreground'>Reporter</p>
                              <p className='mt-1 text-foreground'>{issue.reporter || '—'}</p>
                            </div>
                            <div>
                              <p className='text-[11px] text-muted-foreground'>Creator</p>
                              <p className='mt-1 text-foreground'>{issue.creator || '—'}</p>
                            </div>
                            <div>
                              <p className='text-[11px] text-muted-foreground'>Assignee</p>
                              <p className='mt-1 text-foreground'>{issue.assignee || '—'}</p>
                            </div>
                            <div>
                              <p className='text-[11px] text-muted-foreground'>Labels</p>
                              <p className='mt-1 text-foreground'>
                                {issue.labels.length > 0 ? issue.labels.join(', ') : '—'}
                              </p>
                            </div>
                            <div className='col-span-2'>
                              <p className='text-[11px] text-muted-foreground'>Load</p>
                              <p className='mt-1 text-foreground'>
                                {issue.commentCount} comments • {issue.attachmentCount} attachments
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default JiraMigrationScreen;
