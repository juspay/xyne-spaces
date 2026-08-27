import { type ChangeEvent, type ReactElement, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CloudUpload,
  Eye,
  FileArchive,
  Hash,
  LoaderCircle,
  Trash2,
  User,
  Users,
  XCircle,
} from 'lucide-react';
import axios from 'axios';
import { ChannelScopeType } from '@xyne/shared';
import { toast } from 'sonner';
import { useAllChannels } from '../../hooks/useChannels';
import { useUsers } from '../../hooks/useUsers';
import { useAuthContextValues } from '../../hooks/useAuth';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { getDMParticipantIdsToFetch } from '../../components/Chat/ChatDirectory/ChatDirectory.utils';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { channelService } from '../../services/Chat/channelService';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import Textarea from '../../components/ui/Textarea/Textarea';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../components/ui/EntitySelector/EntitySelector.types';
import {
  whatsAppMigrationService,
  type WhatsAppBulkStartedJob,
  type WhatsAppBulkStagedFile,
  type WhatsAppBulkValidationResult,
  type WhatsAppImportSourceSummary,
  type WhatsAppMigrationJobProgress,
  type WhatsAppPurgeImportResponse,
} from '../../services/WhatsAppMigration/whatsAppMigrationService';

type MappingEntry = {
  whatsappName: string;
  email: string;
};

type WhatsAppBulkTab = 'import' | 'delete';

type BulkRow = {
  stagedFileId: string;
  originalName: string;
  gcsPath: string;
  size: number;
  targetValue: string;
  targetChannelId: string;
  validation: WhatsAppBulkValidationResult['preview'] | null;
};

const CHANNEL_TARGET_PREFIX = 'channel:';
const USER_TARGET_PREFIX = 'user:';

const parseMappings = (rawValue: string): MappingEntry[] =>
  rawValue
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [whatsappName, email] = line.split(',').map(part => part.trim());
      return { whatsappName: whatsappName || '', email: email || '' };
    })
    .filter(entry => Boolean(entry.whatsappName) && Boolean(entry.email));

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const getTargetChannelLabel = (
  channel: {
    id: string;
    name: string;
    scopeType: ChannelScopeType;
  },
  currentUserId: string,
  allUsers: { id: string; name?: string | null; email?: string | null }[],
): string => {
  if (channel.scopeType === ChannelScopeType.DEFAULT) return channel.name;

  const participantNames = getDMParticipantIdsToFetch(channel, currentUserId)
    .map(id => allUsers.find(user => user.id === id))
    .filter((user): user is (typeof allUsers)[number] => Boolean(user))
    .map(user => getUserDisplayName(user))
    .filter(Boolean);

  return participantNames.length > 0 ? participantNames.join(', ') : channel.name;
};

const getTargetChannelValue = (channelId: string): string => `${CHANNEL_TARGET_PREFIX}${channelId}`;
const getTargetUserValue = (userId: string): string => `${USER_TARGET_PREFIX}${userId}`;

const parseTargetValue = (
  value: string | null,
): { type: 'channel' | 'user'; id: string } | null => {
  if (!value) return null;
  if (value.startsWith(CHANNEL_TARGET_PREFIX)) {
    return { type: 'channel', id: value.slice(CHANNEL_TARGET_PREFIX.length) };
  }
  if (value.startsWith(USER_TARGET_PREFIX)) {
    return { type: 'user', id: value.slice(USER_TARGET_PREFIX.length) };
  }
  return { type: 'channel', id: value };
};

const WhatsAppBulkMigrationScreen = (): ReactElement => {
  const [workspaceUsers] = useCachedQuery(queries.getUsersV2());
  const allChannels = useAllChannels();
  const hydratedUsers = useUsers();
  const allUsers = workspaceUsers.length > 0 ? workspaceUsers : hydratedUsers;
  const { userID } = useAuthContextValues();
  const [archiveFiles, setArchiveFiles] = useState<File[]>([]);
  const [mappingCsvFile, setMappingCsvFile] = useState<File | null>(null);
  const [mappingsInput, setMappingsInput] = useState('');
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [startedJobs, setStartedJobs] = useState<WhatsAppBulkStartedJob[]>([]);
  const [jobProgressMap, setJobProgressMap] = useState<
    Record<string, WhatsAppMigrationJobProgress>
  >({});
  const [activeTab, setActiveTab] = useState<WhatsAppBulkTab>('import');
  const [deleteTargetValue, setDeleteTargetValue] = useState('');
  const [deleteTargetChannelId, setDeleteTargetChannelId] = useState('');
  const [importSources, setImportSources] = useState<WhatsAppImportSourceSummary[]>([]);
  const [isSourcesLoading, setIsSourcesLoading] = useState(false);
  const [selectedPurgeSourceId, setSelectedPurgeSourceId] = useState('');
  const [purgePreview, setPurgePreview] = useState<WhatsAppPurgeImportResponse | null>(null);
  const [isPurgeLoading, setIsPurgeLoading] = useState(false);
  const [isStaging, setIsStaging] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [hasPreviewPassed, setHasPreviewPassed] = useState(false);

  const availableChannels = useMemo(
    () =>
      allChannels.filter(
        channel =>
          !channel.isArchived &&
          (channel.scopeType === ChannelScopeType.DEFAULT ||
            channel.scopeType === ChannelScopeType.DM ||
            channel.scopeType === ChannelScopeType.GROUP_DM),
      ),
    [allChannels],
  );

  const targetOptions = useMemo<SelectorOption[]>(
    () => [
      ...availableChannels
        .sort((a, b) =>
          getTargetChannelLabel(a, userID ?? '', allUsers).localeCompare(
            getTargetChannelLabel(b, userID ?? '', allUsers),
          ),
        )
        .map(channel => ({
          value: getTargetChannelValue(channel.id),
          label: getTargetChannelLabel(channel, userID ?? '', allUsers),
          icon: <Hash className='w-4 h-4 text-muted-foreground' />,
          subtitle:
            channel.scopeType === ChannelScopeType.DEFAULT ? 'Existing channel' : 'Existing DM',
        })),
      ...allUsers
        .sort((a, b) => getUserDisplayName(a).localeCompare(getUserDisplayName(b)))
        .map(user => ({
          value: getTargetUserValue(user.id),
          label:
            user.id === userID ? `${getUserDisplayName(user)} (you)` : getUserDisplayName(user),
          icon: <User className='w-4 h-4 text-muted-foreground' />,
          subtitle: user.email || 'Create or reuse personal DM',
        })),
    ],
    [availableChannels, allUsers, userID],
  );

  const resolveTargetChannelId = async (value: string | null): Promise<string> => {
    const parsed = parseTargetValue(value);
    if (!parsed) return '';
    if (parsed.type === 'channel') return parsed.id;

    const result = await channelService.createDm({ participantIds: [parsed.id] });
    return result.id;
  };

  const canStage = archiveFiles.length > 0 && !isStaging;
  const canStart =
    rows.length > 0 &&
    rows.every(row => row.targetChannelId) &&
    (parseMappings(mappingsInput).length > 0 || Boolean(mappingCsvFile)) &&
    hasPreviewPassed &&
    !isStarting;
  const canPreview =
    rows.length > 0 &&
    rows.every(row => row.targetChannelId) &&
    (parseMappings(mappingsInput).length > 0 || Boolean(mappingCsvFile)) &&
    !isPreviewing;

  useEffect(() => {
    if (startedJobs.length === 0) return undefined;

    let cancelled = false;
    let intervalId: number | null = null;

    const poll = async (): Promise<void> => {
      try {
        const nextStatuses = await Promise.all(
          startedJobs.map(async job => ({
            jobId: job.jobId,
            progress: await whatsAppMigrationService.getStatus(job.jobId),
          })),
        );

        if (cancelled) return;

        const nextMap: Record<string, WhatsAppMigrationJobProgress> = {};
        nextStatuses.forEach(({ jobId, progress }) => {
          nextMap[jobId] = progress;
        });
        setJobProgressMap(nextMap);

        const hasActiveJobs = nextStatuses.some(
          ({ progress }) => progress.status !== 'completed' && progress.status !== 'failed',
        );
        if (!hasActiveJobs && intervalId !== null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      } catch (error) {
        if (cancelled) return;
        toast.error(
          error instanceof Error ? error.message : 'Failed to fetch bulk migration status',
        );
      }
    };

    void poll();
    intervalId = window.setInterval(() => {
      void poll();
    }, 2000);

    return (): void => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [startedJobs]);

  useEffect(() => {
    setImportSources([]);
    setSelectedPurgeSourceId('');
    setPurgePreview(null);

    if (!deleteTargetChannelId) return;

    let cancelled = false;
    setIsSourcesLoading(true);

    void whatsAppMigrationService
      .listSources(deleteTargetChannelId)
      .then(result => {
        if (cancelled) return;
        setImportSources(result);
      })
      .catch(error => {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : 'Failed to load imported sources');
      })
      .finally(() => {
        if (!cancelled) setIsSourcesLoading(false);
      });

    return (): void => {
      cancelled = true;
    };
  }, [deleteTargetChannelId]);

  const handleStage = async (): Promise<void> => {
    if (!canStage) return;

    const payload = new FormData();
    archiveFiles.forEach(file => payload.append('archives', file));

    setIsStaging(true);
    try {
      const stagedFiles = await whatsAppMigrationService.stageBulkArchives(payload);
      setRows(
        stagedFiles.map((file: WhatsAppBulkStagedFile) => ({
          stagedFileId: file.stagedFileId,
          originalName: file.originalName,
          gcsPath: file.gcsPath,
          size: file.size,
          targetValue: '',
          targetChannelId: '',
          validation: null,
        })),
      );
      setStartedJobs([]);
      setJobProgressMap({});
      setHasPreviewPassed(false);
      toast.success(`Staged ${stagedFiles.length} WhatsApp zip file(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to stage WhatsApp archives');
    } finally {
      setIsStaging(false);
    }
  };

  const handlePreview = async (): Promise<void> => {
    if (!canPreview) return;

    const payload = new FormData();
    payload.append(
      'jobs',
      JSON.stringify(
        rows.map(row => ({
          stagedFileId: row.stagedFileId,
          targetChannelId: row.targetChannelId,
        })),
      ),
    );

    const mappings = parseMappings(mappingsInput);
    if (mappings.length > 0) {
      payload.append('mappingJson', JSON.stringify(mappings));
    }
    if (mappingCsvFile) {
      payload.append('mappingFile', mappingCsvFile);
    }

    setIsPreviewing(true);
    try {
      const validationResults = await whatsAppMigrationService.previewBulkMigration(payload);
      const validationById = new Map(
        validationResults.map(result => [result.stagedFileId, result.preview]),
      );
      const unresolved = validationResults.filter(
        result => result.preview.unresolvedNames.length > 0,
      );

      setRows(current =>
        current.map(row => ({
          ...row,
          validation: validationById.get(row.stagedFileId) || null,
        })),
      );

      if (unresolved.length > 0) {
        setHasPreviewPassed(false);
        const unresolvedSummary = unresolved
          .map(result => `${result.originalName}: ${result.preview.unresolvedNames.join(', ')}`)
          .join(' | ');
        toast.error('Bulk preview found unresolved participants', {
          description: unresolvedSummary,
        });
        return;
      }

      setHasPreviewPassed(true);
      toast.success('Bulk preview passed');
    } catch (error) {
      setHasPreviewPassed(false);
      toast.error(
        error instanceof Error ? error.message : 'Failed to preview WhatsApp bulk migration',
      );
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleStart = async (): Promise<void> => {
    if (!canStart) return;

    const payload = new FormData();
    payload.append(
      'jobs',
      JSON.stringify(
        rows.map(row => ({
          stagedFileId: row.stagedFileId,
          targetChannelId: row.targetChannelId,
        })),
      ),
    );

    const mappings = parseMappings(mappingsInput);
    if (mappings.length > 0) {
      payload.append('mappingJson', JSON.stringify(mappings));
    }
    if (mappingCsvFile) {
      payload.append('mappingFile', mappingCsvFile);
    }

    setIsStarting(true);
    try {
      const jobs = await whatsAppMigrationService.startBulkMigration(payload);
      setStartedJobs(jobs);
      setJobProgressMap({});
      toast.success('WhatsApp bulk migration started');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const validationResults = (
          error.response?.data as
            | { data?: { validationResults?: WhatsAppBulkValidationResult[] } }
            | undefined
        )?.data?.validationResults;

        if (validationResults && validationResults.length > 0) {
          const validationById = new Map(
            validationResults.map(result => [result.stagedFileId, result.preview]),
          );

          setRows(current =>
            current.map(row => ({
              ...row,
              validation: validationById.get(row.stagedFileId) || null,
            })),
          );
          setHasPreviewPassed(false);

          const unresolvedSummary = validationResults
            .filter(result => result.preview.unresolvedNames.length > 0)
            .map(result => `${result.originalName}: ${result.preview.unresolvedNames.join(', ')}`)
            .join(' | ');

          toast.error('Resolve WhatsApp participants before starting bulk migration', {
            description: unresolvedSummary,
          });
          return;
        }
      }
      toast.error(
        error instanceof Error ? error.message : 'Failed to start WhatsApp bulk migration',
      );
    } finally {
      setIsStarting(false);
    }
  };

  const refreshSources = async (): Promise<void> => {
    if (!deleteTargetChannelId) return;
    setIsSourcesLoading(true);
    try {
      const result = await whatsAppMigrationService.listSources(deleteTargetChannelId);
      setImportSources(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to refresh imported sources');
    } finally {
      setIsSourcesLoading(false);
    }
  };

  const handlePurgePreview = async (): Promise<void> => {
    if (!deleteTargetChannelId || !selectedPurgeSourceId) {
      toast.error('Select a target channel and imported source first');
      return;
    }

    setIsPurgeLoading(true);
    try {
      const result = await whatsAppMigrationService.purgeImport({
        targetChannelId: deleteTargetChannelId,
        externalSourceId: selectedPurgeSourceId,
        dryRun: true,
      });
      setPurgePreview(result);
      toast.success('Delete preview ready');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to preview delete');
    } finally {
      setIsPurgeLoading(false);
    }
  };

  const handlePurgeExecute = async (): Promise<void> => {
    if (!deleteTargetChannelId || !selectedPurgeSourceId) {
      toast.error('Select a target channel and imported source first');
      return;
    }
    if (
      !window.confirm('Delete imported WhatsApp messages for this source? This cannot be undone.')
    ) {
      return;
    }

    setIsPurgeLoading(true);
    try {
      const result = await whatsAppMigrationService.purgeImport({
        targetChannelId: deleteTargetChannelId,
        externalSourceId: selectedPurgeSourceId,
        dryRun: false,
      });
      setPurgePreview(result);
      setSelectedPurgeSourceId('');
      await refreshSources();
      toast.success('Imported WhatsApp messages deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete imported messages');
    } finally {
      setIsPurgeLoading(false);
    }
  };

  return (
    <div className='h-full w-full overflow-hidden rounded-2xl bg-background shadow-md'>
      <div className='h-full overflow-y-auto'>
        <div className='border-b border-border bg-[linear-gradient(135deg,rgba(14,165,233,0.08),rgba(34,197,94,0.08),transparent)] p-6'>
          <div className='flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between'>
            <div>
              <div className='inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-sky-800'>
                Separate Bulk Console
              </div>
              <h2 className='mt-3 text-xl font-bold tracking-tight text-foreground'>
                WhatsApp Bulk Migration
              </h2>
              <p className='mt-2 max-w-3xl text-sm text-muted-foreground'>
                Stage multiple WhatsApp export zips in GCS, map each zip to a target channel, then
                migrate them sequentially without changing the single-zip flow.
              </p>
            </div>
            <div className='grid grid-cols-2 gap-3 text-left lg:min-w-[360px]'>
              <div className='rounded-xl border border-border bg-background/80 p-3 shadow-sm'>
                <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>Staging</p>
                <p className='mt-1 text-sm font-semibold text-foreground'>GCS-backed zip storage</p>
                <p className='mt-1 text-xs text-muted-foreground'>
                  Uploads persist briefly for retries
                </p>
              </div>
              <div className='rounded-xl border border-border bg-background/80 p-3 shadow-sm'>
                <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>
                  Execution
                </p>
                <p className='mt-1 text-sm font-semibold text-foreground'>
                  Sequential background jobs
                </p>
                <p className='mt-1 text-xs text-muted-foreground'>
                  One zip downloaded and migrated at a time
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className='space-y-6 p-6'>
          <section className='overflow-hidden rounded-3xl border border-border/70 bg-card/80 shadow-sm'>
            <div className='border-b border-border/70 bg-background/90 px-5 py-4'>
              <div className='flex flex-wrap gap-2'>
                <button
                  type='button'
                  onClick={() => setActiveTab('import')}
                  data-track-category='whatsapp-migration'
                  data-track-name='open-bulk-import-tab'
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    activeTab === 'import'
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'border border-border/70 bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Bulk Import
                </button>
                <button
                  type='button'
                  onClick={() => setActiveTab('delete')}
                  data-track-category='whatsapp-migration'
                  data-track-name='open-bulk-delete-tab'
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    activeTab === 'delete'
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'border border-border/70 bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Delete Imported Messages
                </button>
              </div>
            </div>

            {activeTab === 'import' ? (
              <div className='space-y-6 p-5'>
                <section className='rounded-3xl border border-border/70 bg-card/80 p-5 shadow-sm'>
                  <div className='flex items-center gap-2 text-sm font-semibold text-foreground'>
                    <CloudUpload className='h-4 w-4 text-sky-600' />
                    Stage Zip Files
                  </div>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Upload all zips first. They will be staged to GCS and then reused for sequential
                    migration jobs.
                  </p>
                  <div className='mt-4 flex flex-col gap-3 xl:flex-row xl:items-end'>
                    <div className='flex-1'>
                      <label
                        htmlFor='whatsapp-bulk-zip-input'
                        className='mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                      >
                        <FileArchive className='h-3.5 w-3.5' />
                        WhatsApp Zip Files
                      </label>
                      <Input
                        id='whatsapp-bulk-zip-input'
                        type='file'
                        accept='.zip,application/zip'
                        multiple
                        onChange={(event: ChangeEvent<HTMLInputElement>) => {
                          setArchiveFiles(Array.from(event.target.files || []));
                          setRows([]);
                          setStartedJobs([]);
                          setJobProgressMap({});
                          setHasPreviewPassed(false);
                        }}
                      />
                    </div>
                    <Button
                      onClick={() => void handleStage()}
                      data-track-category='whatsapp-migration'
                      data-track-name='STAGE_MIGRATION'
                      disabled={!canStage}
                      loading={isStaging}
                    >
                      {isStaging ? 'Staging…' : 'Stage Archives'}
                    </Button>
                  </div>
                  {archiveFiles.length > 0 && (
                    <div className='mt-4 rounded-2xl border border-border/70 bg-background/70 p-3'>
                      <p className='text-xs font-medium text-foreground'>
                        Selected {archiveFiles.length} file(s)
                      </p>
                      <div className='mt-2 space-y-1 text-xs text-muted-foreground'>
                        {archiveFiles.map(file => (
                          <div
                            key={`${file.name}-${file.size}`}
                            className='flex items-center justify-between gap-3'
                          >
                            <span className='truncate'>{file.name}</span>
                            <span>{formatBytes(file.size)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>

                <section className='rounded-3xl border border-border/70 bg-card/80 p-5 shadow-sm'>
                  <div className='flex items-center gap-2 text-sm font-semibold text-foreground'>
                    <Users className='h-4 w-4 text-emerald-600' />
                    Shared Name to Email Mappings
                  </div>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    These mappings apply to the full batch. Use textarea, CSV, or both.
                  </p>
                  <div className='mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]'>
                    <Textarea
                      value={mappingsInput}
                      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                        setMappingsInput(event.target.value);
                        setHasPreviewPassed(false);
                        setRows(current =>
                          current.map(row => ({
                            ...row,
                            validation: null,
                          })),
                        );
                      }}
                      rows={8}
                      placeholder={'Alice Example,alice@company.com\nBob Example,bob@company.com'}
                    />
                    <div className='rounded-2xl border border-border/70 bg-background/70 p-4'>
                      <label
                        htmlFor='whatsapp-bulk-mapping-file'
                        className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                      >
                        Mapping CSV
                      </label>
                      <Input
                        id='whatsapp-bulk-mapping-file'
                        type='file'
                        accept='.csv,.txt,text/csv,text/plain'
                        onChange={(event: ChangeEvent<HTMLInputElement>) => {
                          setMappingCsvFile(event.target.files?.[0] || null);
                          setHasPreviewPassed(false);
                          setRows(current =>
                            current.map(row => ({
                              ...row,
                              validation: null,
                            })),
                          );
                        }}
                      />
                      <p className='mt-2 text-xs text-muted-foreground'>
                        Header format: <code>name,email</code>
                      </p>
                    </div>
                  </div>
                </section>

                <section className='rounded-3xl border border-border/70 bg-card/80 p-5 shadow-sm'>
                  <div className='flex items-center justify-between gap-3'>
                    <div>
                      <h3 className='text-sm font-semibold text-foreground'>
                        Zip to Channel Mapping
                      </h3>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        Each staged zip must be assigned to one existing regular channel or DM.
                      </p>
                    </div>
                    <div className='flex items-center gap-3'>
                      <Button
                        onClick={() => void handlePreview()}
                        data-track-category='whatsapp-migration'
                        data-track-name='PREVIEW_MIGRATION'
                        disabled={!canPreview}
                        loading={isPreviewing}
                        variant='secondary'
                      >
                        <Eye className='mr-2 h-4 w-4' />
                        {isPreviewing ? 'Previewing…' : 'Preview Batch'}
                      </Button>
                      <Button
                        onClick={() => void handleStart()}
                        data-track-category='whatsapp-migration'
                        data-track-name='START_MIGRATION'
                        disabled={!canStart}
                        loading={isStarting}
                      >
                        {isStarting ? 'Starting…' : 'Start Bulk Migration'}
                      </Button>
                    </div>
                  </div>
                  <div className='mt-3 text-xs text-muted-foreground'>
                    {hasPreviewPassed
                      ? 'Preview passed. You can start the sequential migration.'
                      : 'Run Preview Batch after changing mappings or target channels.'}
                  </div>

                  <div className='mt-4 space-y-4'>
                    {rows.length === 0 ? (
                      <div className='rounded-2xl border border-dashed border-border/70 bg-background/60 p-6 text-sm text-muted-foreground'>
                        Stage archives first to build the batch mapping table.
                      </div>
                    ) : (
                      rows.map(row => {
                        const startedJob = startedJobs.find(
                          job => job.stagedFileId === row.stagedFileId,
                        );
                        const progress = startedJob ? jobProgressMap[startedJob.jobId] : undefined;

                        return (
                          <div
                            key={row.stagedFileId}
                            className='rounded-2xl border border-border/70 bg-background/70 p-4'
                          >
                            <div className='flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between'>
                              <div className='min-w-0 flex-1'>
                                <div className='flex items-center gap-2 text-sm font-medium text-foreground'>
                                  <FileArchive className='h-4 w-4 text-sky-600' />
                                  <span className='truncate'>{row.originalName}</span>
                                </div>
                                <div className='mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground'>
                                  <span>{formatBytes(row.size)}</span>
                                  <span className='rounded-full bg-muted px-2 py-1'>
                                    {row.gcsPath}
                                  </span>
                                </div>
                                {progress && (
                                  <div className='mt-3 flex flex-wrap items-center gap-2 text-xs'>
                                    <span className='rounded-full bg-muted px-2 py-1 text-foreground'>
                                      {progress.status}
                                    </span>
                                    <span className='rounded-full bg-muted px-2 py-1 text-foreground'>
                                      {progress.phase}
                                    </span>
                                    {progress.status === 'completed' && (
                                      <span className='inline-flex items-center gap-1 text-emerald-700'>
                                        <CheckCircle2 className='h-3.5 w-3.5' />
                                        {progress.result?.importedMessages ?? 0} messages imported
                                      </span>
                                    )}
                                    {progress.status === 'failed' && (
                                      <span className='inline-flex items-center gap-1 text-rose-700'>
                                        <XCircle className='h-3.5 w-3.5' />
                                        {progress.errorMessage || 'Migration failed'}
                                      </span>
                                    )}
                                    {progress.status === 'running' && (
                                      <span className='inline-flex items-center gap-1 text-sky-700'>
                                        <LoaderCircle className='h-3.5 w-3.5 animate-spin' />
                                        {progress.importedMessages}/{progress.totalMessages ?? '?'}{' '}
                                        messages
                                      </span>
                                    )}
                                  </div>
                                )}
                                {row.validation && row.validation.unresolvedNames.length > 0 && (
                                  <div className='mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800'>
                                    Unresolved participants:{' '}
                                    {row.validation.unresolvedNames.join(', ')}
                                  </div>
                                )}
                              </div>

                              <div className='grid gap-3 xl:min-w-[520px]'>
                                <div>
                                  <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                                    Target Channel
                                  </p>
                                  <EntitySelector
                                    options={targetOptions}
                                    selectedValue={row.targetValue || null}
                                    onSelect={value => {
                                      setHasPreviewPassed(false);
                                      setRows(current =>
                                        current.map(currentRow =>
                                          currentRow.stagedFileId === row.stagedFileId
                                            ? {
                                                ...currentRow,
                                                targetValue: value ?? '',
                                                targetChannelId: '',
                                                validation: null,
                                              }
                                            : currentRow,
                                        ),
                                      );

                                      if (!value) {
                                        return;
                                      }

                                      void resolveTargetChannelId(value)
                                        .then(channelId => {
                                          setRows(current =>
                                            current.map(currentRow =>
                                              currentRow.stagedFileId === row.stagedFileId &&
                                              currentRow.targetValue === value
                                                ? {
                                                    ...currentRow,
                                                    targetChannelId: channelId,
                                                  }
                                                : currentRow,
                                            ),
                                          );
                                        })
                                        .catch(error => {
                                          setRows(current =>
                                            current.map(currentRow =>
                                              currentRow.stagedFileId === row.stagedFileId
                                                ? {
                                                    ...currentRow,
                                                    targetValue: '',
                                                    targetChannelId: '',
                                                  }
                                                : currentRow,
                                            ),
                                          );
                                          toast.error(
                                            error instanceof Error
                                              ? error.message
                                              : 'Failed to prepare DM target',
                                          );
                                        });
                                    }}
                                    placeholder='Select channel or user'
                                    searchPlaceholder='Search channels or users...'
                                    width='100%'
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              </div>
            ) : (
              <section className='rounded-3xl border border-border/70 bg-card/80 p-5 shadow-sm'>
                <div className='flex items-center gap-2 text-sm font-semibold text-foreground'>
                  <Trash2 className='h-4 w-4 text-rose-600' />
                  Delete Imported Messages
                </div>
                <p className='mt-1 text-xs text-muted-foreground'>
                  Remove previously imported WhatsApp messages for one source from a selected
                  channel or DM.
                </p>

                <div className='mt-4 grid gap-4 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]'>
                  <div className='rounded-2xl border border-border/70 bg-background/70 p-4'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Target Channel
                    </p>
                    <EntitySelector
                      options={targetOptions}
                      selectedValue={deleteTargetValue || null}
                      onSelect={value => {
                        setDeleteTargetValue(value ?? '');
                        setDeleteTargetChannelId('');
                        setSelectedPurgeSourceId('');
                        setPurgePreview(null);

                        if (!value) return;

                        void resolveTargetChannelId(value)
                          .then(channelId => {
                            setDeleteTargetChannelId(channelId);
                          })
                          .catch(error => {
                            setDeleteTargetValue('');
                            setDeleteTargetChannelId('');
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : 'Failed to prepare DM target',
                            );
                          });
                      }}
                      placeholder='Select channel or user'
                      searchPlaceholder='Search channels or users...'
                      width='100%'
                    />
                  </div>

                  <div className='rounded-2xl border border-border/70 bg-background/70 p-4'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Imported Sources In Channel
                    </p>
                    {deleteTargetChannelId ? (
                      isSourcesLoading ? (
                        <div className='text-sm text-muted-foreground'>
                          Loading imported sources…
                        </div>
                      ) : importSources.length ? (
                        <div className='space-y-2'>
                          {importSources.map(source => {
                            const isSelected = selectedPurgeSourceId === source.externalSourceId;
                            return (
                              <button
                                key={source.externalSourceId}
                                type='button'
                                onClick={() => {
                                  setSelectedPurgeSourceId(source.externalSourceId);
                                  setPurgePreview(null);
                                }}
                                data-track-category='whatsapp-migration'
                                data-track-name='select-delete-source'
                                className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                                  isSelected
                                    ? 'border-rose-300 bg-rose-50/80'
                                    : 'border-border/70 bg-background/70 hover:border-rose-200'
                                }`}
                              >
                                <div className='flex flex-wrap items-center justify-between gap-3'>
                                  <div>
                                    <div className='text-sm font-semibold text-foreground'>
                                      {source.chatName || source.displayName}
                                    </div>
                                    <div className='mt-1 text-xs text-muted-foreground'>
                                      Source ID: {source.externalSourceId}
                                    </div>
                                  </div>
                                  <div className='text-right text-xs text-muted-foreground'>
                                    <div>{source.importedMessageCount} messages</div>
                                    <div>{source.attachmentCount} attachments</div>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className='text-sm text-muted-foreground'>
                          No WhatsApp imports found for this channel.
                        </div>
                      )
                    ) : (
                      <div className='text-sm text-muted-foreground'>
                        Select a target channel to manage imported WhatsApp messages.
                      </div>
                    )}
                  </div>
                </div>

                <div className='mt-4 flex flex-wrap justify-end gap-3'>
                  <Button
                    variant='outline'
                    onClick={() => void handlePurgePreview()}
                    data-track-category='whatsapp-migration'
                    data-track-name='PREVIEW_PURGE'
                    disabled={isPurgeLoading || !selectedPurgeSourceId}
                  >
                    {isPurgeLoading ? 'Checking…' : 'Preview Delete'}
                  </Button>
                  <Button
                    variant='destructive'
                    onClick={() => void handlePurgeExecute()}
                    data-track-category='whatsapp-migration'
                    data-track-name='EXECUTE_PURGE'
                    disabled={isPurgeLoading || !selectedPurgeSourceId}
                  >
                    {isPurgeLoading ? 'Deleting…' : 'Delete Imported Messages'}
                  </Button>
                </div>

                {purgePreview ? (
                  <div className='mt-4 grid grid-cols-2 gap-3 md:grid-cols-4'>
                    <div className='rounded-2xl border border-border/70 bg-background/70 p-3'>
                      <div className='text-[11px] uppercase text-muted-foreground'>
                        Imported Messages
                      </div>
                      <div className='mt-1 text-sm font-semibold text-foreground'>
                        {purgePreview.stats.importedMessageCount}
                      </div>
                    </div>
                    <div className='rounded-2xl border border-border/70 bg-background/70 p-3'>
                      <div className='text-[11px] uppercase text-muted-foreground'>Attachments</div>
                      <div className='mt-1 text-sm font-semibold text-foreground'>
                        {purgePreview.stats.attachmentCount}
                      </div>
                    </div>
                    <div className='rounded-2xl border border-border/70 bg-background/70 p-3'>
                      <div className='text-[11px] uppercase text-muted-foreground'>
                        Conversations
                      </div>
                      <div className='mt-1 text-sm font-semibold text-foreground'>
                        {purgePreview.stats.conversationCount}
                      </div>
                    </div>
                    <div className='rounded-2xl border border-border/70 bg-background/70 p-3'>
                      <div className='text-[11px] uppercase text-muted-foreground'>Has Replies</div>
                      <div className='mt-1 text-sm font-semibold text-foreground'>
                        {purgePreview.stats.repliedConversationCount}
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default WhatsAppBulkMigrationScreen;
