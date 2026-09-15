import { type ChangeEvent, ReactElement, useEffect, useMemo, useState } from 'react';
import { FolderKanban, FileText, FolderOpen, AlertTriangle, UserRound, Hash } from 'lucide-react';
import { ChannelScopeType } from '@xyne/shared';
import { toast } from 'sonner';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import Dialog from '../../components/ui/Dialog';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import { useAllChannels } from '../../hooks/useChannels';
import {
  confluenceMigrationService,
  type ConfluenceMigrationExecuteRequest,
  type ConfluenceMigrationHistoryItem,
  type ConfluenceMigrationJobProgress,
  type ConfluenceMigrationPreviewRequest,
  type ConfluenceMigrationPreviewResponse,
  type ConfluenceMigrationSummary,
} from '../../services/ConfluenceMigration/confluenceMigrationService';

const ACTIVE_CONFLUENCE_MIGRATION_STORAGE_KEY = 'confluenceMigration.activeJob';
const PAGE_RESULTS_PER_VIEW = 12;
const HISTORY_ITEMS_PER_VIEW = 12;

type MigrationPhase = 'setup' | 'preview' | 'migrate';

type PersistedConfluenceMigrationJob = {
  jobId: string;
  spaceKey: string;
  targetProjectId?: string;
  targetChannelId?: string;
  startedAt: string;
};

const readPersistedConfluenceMigrationJob = (): PersistedConfluenceMigrationJob | null => {
  if (typeof window === 'undefined') return null;

  try {
    const rawValue = window.localStorage.getItem(ACTIVE_CONFLUENCE_MIGRATION_STORAGE_KEY);
    if (!rawValue) return null;

    const parsedValue = JSON.parse(rawValue) as Partial<PersistedConfluenceMigrationJob>;
    if (typeof parsedValue.jobId !== 'string' || typeof parsedValue.spaceKey !== 'string') {
      window.localStorage.removeItem(ACTIVE_CONFLUENCE_MIGRATION_STORAGE_KEY);
      return null;
    }

    return {
      jobId: parsedValue.jobId,
      spaceKey: parsedValue.spaceKey,
      ...(typeof parsedValue.targetProjectId === 'string'
        ? { targetProjectId: parsedValue.targetProjectId }
        : {}),
      ...(typeof parsedValue.targetChannelId === 'string'
        ? { targetChannelId: parsedValue.targetChannelId }
        : {}),
      startedAt:
        typeof parsedValue.startedAt === 'string'
          ? parsedValue.startedAt
          : new Date().toISOString(),
    };
  } catch {
    window.localStorage.removeItem(ACTIVE_CONFLUENCE_MIGRATION_STORAGE_KEY);
    return null;
  }
};

const persistConfluenceMigrationJob = (job: PersistedConfluenceMigrationJob): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACTIVE_CONFLUENCE_MIGRATION_STORAGE_KEY, JSON.stringify(job));
};

const clearPersistedConfluenceMigrationJob = (): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACTIVE_CONFLUENCE_MIGRATION_STORAGE_KEY);
};

const statusClassMap: Record<string, string> = {
  created: 'bg-emerald-100 text-emerald-800',
  updated: 'bg-sky-100 text-sky-800',
  partial: 'bg-amber-100 text-amber-800',
  failed: 'bg-rose-100 text-rose-800',
};

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return 'n/a';
  return new Date(value).toLocaleString();
};

const ConfluenceMigrationScreen = (): ReactElement => {
  const [projects] = useCachedQuery(queries.getAllProjects());
  const allChannels = useAllChannels();
  const [spaceKey, setSpaceKey] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [targetChannelId, setTargetChannelId] = useState('');
  const [migrateAttachments, setMigrateAttachments] = useState(true);
  const [preview, setPreview] = useState<ConfluenceMigrationPreviewResponse | null>(null);
  const [result, setResult] = useState<ConfluenceMigrationSummary | null>(null);
  const [history, setHistory] = useState<ConfluenceMigrationHistoryItem[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [migrationProgress, setMigrationProgress] = useState<ConfluenceMigrationJobProgress | null>(
    null,
  );
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isImportLoading, setIsImportLoading] = useState(false);
  const [migrationPhase, setMigrationPhase] = useState<MigrationPhase>('setup');
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  const selectedProject = useMemo(
    () => projects?.find(project => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const targetChannelOptions = useMemo(
    () =>
      allChannels
        .filter(
          channel =>
            channel.scopeType === ChannelScopeType.DEFAULT &&
            !channel.isArchived &&
            (!selectedProjectId || channel.projectId === selectedProjectId),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allChannels, selectedProjectId],
  );

  const selectedTargetChannel = useMemo(
    () => allChannels.find(channel => channel.id === targetChannelId) || null,
    [allChannels, targetChannelId],
  );

  const visiblePageResults = useMemo(() => {
    const source = result?.pageResults || migrationProgress?.pageResults || [];
    return source.slice(0, PAGE_RESULTS_PER_VIEW);
  }, [migrationProgress?.pageResults, result?.pageResults]);

  const migrationProgressPercent = useMemo(() => {
    if (!migrationProgress) return 0;
    if (migrationProgress.status === 'completed') return 100;
    if (!migrationProgress.totalPages) return 8;

    return Math.min(
      100,
      Math.max(
        8,
        Math.round((migrationProgress.processedPages / migrationProgress.totalPages) * 100),
      ),
    );
  }, [migrationProgress]);

  const canPreview = spaceKey.trim() !== '';

  const buildPreviewPayload = (): ConfluenceMigrationPreviewRequest => ({
    spaceKey: spaceKey.trim().toUpperCase(),
    ...(selectedProjectId ? { targetProjectId: selectedProjectId } : {}),
    ...(targetChannelId ? { targetChannelId } : {}),
  });

  const buildExecutePayload = (): ConfluenceMigrationExecuteRequest => ({
    ...buildPreviewPayload(),
    ...(preview?.spaceName ? { projectName: preview.spaceName } : {}),
    defaultDestination: 'channelFolder',
    createProjectIfMissing: true,
    createDefaultChannel: true,
    migrateAttachments,
    ...(typeof window !== 'undefined' ? { frontendBaseUrl: window.location.origin } : {}),
  });

  const loadHistory = async (): Promise<void> => {
    try {
      const historyResult = await confluenceMigrationService.getMigrationHistory();
      setHistory(historyResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load migration history';
      toast.error('History load failed', { description: message });
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    const persistedJob = readPersistedConfluenceMigrationJob();
    if (!persistedJob) return;

    setSpaceKey(persistedJob.spaceKey);
    setSelectedProjectId(persistedJob.targetProjectId || '');
    setTargetChannelId(persistedJob.targetChannelId || '');
    setIsImportLoading(true);
    setActiveJobId(persistedJob.jobId);
    toast.info('Recovered active Confluence migration job', {
      description: `${persistedJob.spaceKey} migration is resuming from the backend job tracker.`,
    });
  }, []);

  useEffect(() => {
    if (!activeJobId) return undefined;

    let cancelled = false;

    const pollStatus = async (): Promise<void> => {
      try {
        const status = await confluenceMigrationService.getMigrationStatus(activeJobId);
        if (cancelled) return;

        persistConfluenceMigrationJob({
          jobId: status.jobId,
          spaceKey: status.spaceKey,
          ...(status.targetProjectId ? { targetProjectId: status.targetProjectId } : {}),
          ...(status.targetChannelId ? { targetChannelId: status.targetChannelId } : {}),
          startedAt: status.startedAt,
        });

        setMigrationProgress(status);

        if (status.status === 'completed') {
          clearPersistedConfluenceMigrationJob();
          setIsImportLoading(false);
          setActiveJobId(null);
          if (status.result) {
            setResult(status.result);
          }
          void loadHistory();
          toast.success('Confluence migration completed');
          return;
        }

        if (status.status === 'failed') {
          clearPersistedConfluenceMigrationJob();
          setIsImportLoading(false);
          setActiveJobId(null);
          toast.error('Import failed', {
            description: status.errorMessage || 'Confluence migration failed',
          });
        }
      } catch (error) {
        if (cancelled) return;
        clearPersistedConfluenceMigrationJob();
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

    return (): void => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeJobId]);

  const handlePreview = async (): Promise<void> => {
    if (!canPreview) {
      toast.error('Please enter a Confluence space key');
      return;
    }

    setIsPreviewLoading(true);
    try {
      const previewResult =
        await confluenceMigrationService.previewMigration(buildPreviewPayload());
      setPreview(previewResult);
      setResult(null);
      setMigrationPhase('preview');
      toast.success('Confluence preview loaded');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to preview migration';
      toast.error('Preview failed', { description: message });
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleImport = async (): Promise<void> => {
    if (!preview) {
      toast.error('Preview is required before migration');
      return;
    }

    setIsImportLoading(true);
    setResult(null);
    setMigrationProgress(null);

    try {
      const payload = buildExecutePayload();
      const startResult = await confluenceMigrationService.startMigration(payload);
      persistConfluenceMigrationJob({
        jobId: startResult.jobId,
        spaceKey: payload.spaceKey,
        ...(payload.targetProjectId ? { targetProjectId: payload.targetProjectId } : {}),
        ...(payload.targetChannelId ? { targetChannelId: payload.targetChannelId } : {}),
        startedAt: new Date().toISOString(),
      });
      setActiveJobId(startResult.jobId);
      toast.success('Confluence migration started');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start migration';
      setIsImportLoading(false);
      toast.error('Import failed', { description: message });
    }
  };

  return (
    <div className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'>
      <div className='h-full overflow-y-auto'>
        <div className='border-b border-border bg-[linear-gradient(135deg,rgba(37,99,235,0.08),rgba(20,184,166,0.05),transparent)] p-6'>
          <div className='flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between'>
            <div>
              <div className='inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-sky-800'>
                Admin Migration Console
              </div>
              <h2 className='mt-3 text-xl font-bold tracking-tight text-foreground'>
                Confluence Migration Planner
              </h2>
              <p className='mt-2 max-w-2xl text-sm text-muted-foreground'>
                Preview a Confluence space, create or reuse the Xyne project, and run a resumable
                import into the project general channel.
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
                <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>Shape</p>
                <p className='mt-1 text-sm font-semibold text-foreground'>
                  Project general channel
                </p>
                <p className='mt-1 text-xs text-muted-foreground'>Folders and canvases preserved</p>
              </div>
            </div>
          </div>
        </div>

        <div className='p-6 space-y-6'>
          <section className='overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm'>
            <div className='border-b border-border/70 bg-muted/20 px-5 py-4'>
              <div className='flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between'>
                <div>
                  <h3 className='text-sm font-semibold text-foreground'>Migration Inputs</h3>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Target channel is optional. If selected, migration resolves the project from
                    that channel and imports there.
                  </p>
                </div>
                <span className='rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-800'>
                  Space {'->'} Channel Folders
                </span>
              </div>
            </div>

            <div className='grid grid-cols-1 gap-4 p-5 xl:grid-cols-3'>
              <div className='rounded-2xl border border-border/70 bg-background p-4 shadow-sm'>
                <label
                  htmlFor='confluence-space-key'
                  className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                >
                  Confluence Space Key
                </label>
                <Input
                  id='confluence-space-key'
                  value={spaceKey}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setSpaceKey(event.target.value.toUpperCase());
                    setPreview(null);
                    setResult(null);
                    setMigrationProgress(null);
                    setMigrationPhase('setup');
                  }}
                  placeholder='JR'
                />
                <p className='mt-2 text-xs text-muted-foreground'>
                  Example: `JR` for the Hyperswitch Confluence space.
                </p>
              </div>

              <div className='rounded-2xl border border-border/70 bg-background p-4 shadow-sm'>
                <label
                  htmlFor='confluence-target-project'
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
                    if (targetChannelId) {
                      const selectedChannel = allChannels.find(
                        channel => channel.id === targetChannelId,
                      );
                      if (selectedChannel && selectedChannel.projectId !== value) {
                        setTargetChannelId('');
                      }
                    }
                    setPreview(null);
                    setResult(null);
                    setMigrationProgress(null);
                    setMigrationPhase('setup');
                  }}
                  placeholder='Auto resolve by space name'
                  searchPlaceholder='Search projects...'
                  width='100%'
                  showClearButton
                  testId='confluence-target-project'
                />
                <p className='mt-2 text-xs text-muted-foreground'>
                  Selecting a channel below also selects its project.
                </p>
              </div>

              <div className='rounded-2xl border border-border/70 bg-background p-4 shadow-sm'>
                <label
                  htmlFor='confluence-target-channel'
                  className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                >
                  Target Channel
                </label>
                <EntitySelector
                  options={targetChannelOptions.map(channel => ({
                    value: channel.id,
                    label: channel.name,
                    icon: <Hash className='w-4 h-4 text-muted-foreground' />,
                  }))}
                  selectedValue={targetChannelId || null}
                  onSelect={value => {
                    const nextChannelId = value ?? '';
                    setTargetChannelId(nextChannelId);
                    const selectedChannel = allChannels.find(
                      channel => channel.id === nextChannelId,
                    );
                    if (selectedChannel) {
                      setSelectedProjectId(selectedChannel.projectId);
                    }
                    setPreview(null);
                    setResult(null);
                    setMigrationProgress(null);
                    setMigrationPhase('setup');
                  }}
                  placeholder='Select channel'
                  searchPlaceholder='Search channels...'
                  width='100%'
                  showClearButton
                  testId='confluence-target-channel'
                />
                <p className='mt-2 text-xs text-muted-foreground'>
                  Example: Fastag-issuance keeps imported folders and canvases in that channel.
                </p>
              </div>

              <div className='rounded-2xl border border-border/70 bg-background p-4 shadow-sm'>
                <div className='flex items-start justify-between gap-3'>
                  <div>
                    <p className='text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Attachments
                    </p>
                    <p className='mt-2 text-sm font-medium text-foreground'>
                      Migrate images and files when storage is available
                    </p>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      Import continues even if some attachment uploads fail.
                    </p>
                  </div>
                  <input
                    type='checkbox'
                    data-track-category='confluence_migration'
                    data-track-name='toggle_attachment_migration'
                    checked={migrateAttachments}
                    onChange={event => setMigrateAttachments(event.target.checked)}
                    className='h-4 w-4 rounded border-border text-sky-600 focus:ring-sky-500'
                  />
                </div>
              </div>
            </div>

            <div className='border-t border-border/70 px-5 py-4'>
              <div className='flex flex-wrap items-center gap-2'>
                <Button
                  onClick={() => void handlePreview()}
                  data-track-category='confluence_migration'
                  data-track-name='PREVIEW_MIGRATION'
                  disabled={!canPreview || isPreviewLoading}
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
                  data-track-category='confluence_migration'
                  data-track-name='OPEN_MIGRATION_HISTORY'
                  disabled={history.length === 0}
                >
                  View Imported Canvases
                </Button>
              </div>
            </div>
          </section>

          {preview && (
            <section className='overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm'>
              <div className='border-b border-border/70 bg-muted/20 px-5 py-4'>
                <div className='flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between'>
                  <div>
                    <div className='inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-emerald-800'>
                      Preview
                    </div>
                    <h3 className='mt-2 text-sm font-semibold text-foreground'>
                      {preview.spaceName} ({preview.spaceKey})
                    </h3>
                  </div>
                  <span className='text-xs text-muted-foreground'>
                    {preview.expectedCanvasPages ?? preview.leafPages} canvases from{' '}
                    {preview.totalPages} Confluence pages
                  </span>
                </div>
              </div>

              <div className='grid grid-cols-2 gap-3 p-5 md:grid-cols-4 xl:grid-cols-6'>
                <MetricCard
                  label='Expected canvases'
                  value={String(preview.expectedCanvasPages ?? preview.leafPages)}
                />
                <MetricCard label='Leaf pages' value={String(preview.leafPages)} />
                <MetricCard label='Container pages' value={String(preview.containerPages)} />
                <MetricCard
                  label='Contentful containers'
                  value={String(preview.containerPagesWithContent ?? 0)}
                />
                <MetricCard label='Sections' value={String(preview.sections.length)} />
                <MetricCard
                  label='Public canvases'
                  value={String(preview.visibilitySummary?.publicCanvases ?? 0)}
                />
                <MetricCard
                  label='Private canvases'
                  value={String(preview.visibilitySummary?.privateCanvases ?? 0)}
                />
                <MetricCard
                  label='Target'
                  value={
                    selectedTargetChannel?.name ||
                    preview.targetChannel?.name ||
                    selectedProject?.name ||
                    preview.targetProject?.name ||
                    preview.spaceName
                  }
                />
              </div>

              {preview.warnings.length > 0 && (
                <div className='mx-5 mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4'>
                  <div className='flex items-start gap-2'>
                    <AlertTriangle className='mt-0.5 h-4 w-4 text-amber-700' />
                    <div>
                      <p className='text-sm font-semibold text-amber-900'>Preview warnings</p>
                      <ul className='mt-2 space-y-1 text-xs text-amber-800'>
                        {preview.warnings.map(warning => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              <div className='grid grid-cols-1 gap-5 px-5 pb-5 xl:grid-cols-2'>
                <div className='rounded-2xl border border-border/70 bg-background p-4'>
                  <div className='mb-3 flex items-center gap-2'>
                    <FolderOpen className='h-4 w-4 text-muted-foreground' />
                    <h4 className='text-sm font-semibold text-foreground'>Detected Sections</h4>
                  </div>
                  <div className='space-y-2'>
                    {preview.sections.slice(0, 12).map(section => (
                      <div
                        key={section.id}
                        className='flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm'
                      >
                        <span className='truncate font-medium text-foreground'>
                          {section.title}
                        </span>
                        <span className='shrink-0 text-xs text-muted-foreground'>
                          {section.childPages} children
                        </span>
                      </div>
                    ))}
                    {preview.sections.length > 12 && (
                      <p className='text-xs text-muted-foreground'>
                        +{preview.sections.length - 12} more sections
                      </p>
                    )}
                  </div>
                </div>

                <div className='rounded-2xl border border-border/70 bg-background p-4'>
                  <div className='mb-3 flex items-center gap-2'>
                    <UserRound className='h-4 w-4 text-muted-foreground' />
                    <h4 className='text-sm font-semibold text-foreground'>Author Samples</h4>
                  </div>
                  <div className='space-y-2'>
                    {preview.pageAuthorSamples.slice(0, 8).map(page => (
                      <div key={page.id} className='rounded-lg border border-border/60 px-3 py-2'>
                        <div className='flex items-center justify-between gap-3'>
                          <p className='truncate text-sm font-medium text-foreground'>
                            {page.title}
                          </p>
                          <span className='shrink-0 text-[11px] text-muted-foreground'>
                            {page.isLeafPage ? page.xyneVisibility || 'leaf' : 'container'}
                          </span>
                        </div>
                        <p className='mt-1 text-xs text-muted-foreground'>
                          {page.createdBy?.displayName || 'Unknown creator'} ·{' '}
                          {formatDateTime(page.createdDate)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className='border-t border-border/70 px-5 py-4'>
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <p className='text-xs text-muted-foreground'>
                    Migration will create/reuse `{preview.spaceName} General`, create folders for
                    container sections, and import leaf pages plus contentful container pages as
                    canvases.
                  </p>
                  <Button
                    onClick={() => {
                      setMigrationPhase('migrate');
                      void handleImport();
                    }}
                    data-track-category='confluence_migration'
                    data-track-name='START_MIGRATION'
                    disabled={isImportLoading}
                  >
                    {isImportLoading ? 'Migrating...' : 'Migrate Space'}
                  </Button>
                </div>
              </div>
            </section>
          )}

          {migrationProgress && (
            <section className='rounded-2xl border border-sky-200 bg-sky-50/60 p-5 shadow-sm'>
              <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
                <div>
                  <h3 className='text-sm font-semibold text-foreground'>Live Migration Progress</h3>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    {migrationProgress.status} · {migrationProgress.currentStep || 'working'}
                    {migrationProgress.currentPageTitle
                      ? ` · ${migrationProgress.currentPageTitle}`
                      : ''}
                  </p>
                </div>
                <span className='text-xs text-muted-foreground'>
                  {migrationProgress.processedPages} canvases from{' '}
                  {migrationProgress.totalPages ?? '?'} Confluence pages
                </span>
              </div>
              <div className='mt-4 h-2 overflow-hidden rounded-full bg-background'>
                <div
                  className='h-full bg-sky-600 transition-all'
                  style={{ width: `${migrationProgressPercent}%` }}
                />
              </div>
              <div className='mt-4 grid grid-cols-2 gap-3 md:grid-cols-4'>
                <MetricCard label='Created' value={String(migrationProgress.createdCanvases)} />
                <MetricCard label='Updated' value={String(migrationProgress.updatedCanvases)} />
                <MetricCard label='Folders' value={String(migrationProgress.createdFolders)} />
                <MetricCard
                  label='Attachments'
                  value={String(migrationProgress.migratedAttachments)}
                />
              </div>
            </section>
          )}

          {(result || visiblePageResults.length > 0) && (
            <section className='overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm'>
              <div className='border-b border-border/70 bg-muted/20 px-5 py-4'>
                <h3 className='text-sm font-semibold text-foreground'>Import Results</h3>
                <p className='mt-1 text-xs text-muted-foreground'>
                  Showing latest {visiblePageResults.length} page results.
                </p>
              </div>
              <div className='space-y-2 p-5'>
                {visiblePageResults.map(page => (
                  <div
                    key={page.confluencePageId}
                    className='flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2'
                  >
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-medium text-foreground'>{page.title}</p>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        {page.destination?.type || 'unknown'} ·{' '}
                        {page.canvasId || page.error || page.confluencePageId}
                      </p>
                      {(page.failedStep || page.errors?.length) && (
                        <p className='mt-1 truncate text-xs text-amber-700'>
                          {page.failedStep ? `Failed step: ${page.failedStep}` : 'Warning'}{' '}
                          {page.errors?.[0] ? `· ${page.errors[0]}` : ''}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${statusClassMap[page.status] || 'bg-muted text-muted-foreground'}`}
                    >
                      {page.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {migrationPhase === 'setup' && !preview && (
            <section className='rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground'>
              Enter a Confluence space key, optionally select a target project, then load preview.
            </section>
          )}
        </div>
      </div>

      <Dialog
        open={isHistoryModalOpen}
        onOpenChange={setIsHistoryModalOpen}
        title='Imported Confluence Canvases'
      >
        <div className='max-h-[70vh] overflow-y-auto space-y-2'>
          {history.slice(0, HISTORY_ITEMS_PER_VIEW).map(item => (
            <div key={item.canvasId} className='rounded-xl border border-border p-3'>
              <div className='flex items-start gap-2'>
                <FileText className='mt-0.5 h-4 w-4 text-muted-foreground' />
                <div className='min-w-0'>
                  <p className='truncate text-sm font-medium text-foreground'>{item.title}</p>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    {item.spaceKey || 'unknown'} · {item.confluencePageId || item.canvasId}
                  </p>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Imported {formatDateTime(item.lastImportedAt || item.updatedAt)}
                  </p>
                </div>
              </div>
            </div>
          ))}
          {history.length > HISTORY_ITEMS_PER_VIEW && (
            <p className='text-xs text-muted-foreground'>
              +{history.length - HISTORY_ITEMS_PER_VIEW} more imported canvases
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
};

const MetricCard = ({ label, value }: { label: string; value: string }): ReactElement => (
  <div className='rounded-xl border border-border/70 bg-background p-3 shadow-sm'>
    <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>{label}</p>
    <p className='mt-1 truncate text-sm font-semibold text-foreground'>{value}</p>
  </div>
);

export default ConfluenceMigrationScreen;
