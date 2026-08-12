import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { clawErrorText } from '@/services/claw/clawRequest';
import { isDigitalTwinDemoMode } from '@/services/claw/digitalTwinDemo';
import {
  approveDigitalTwinCluster,
  deleteDigitalTwinMemories,
  deleteDigitalTwinMemoryFile,
  disableDigitalTwin,
  enableDigitalTwin,
  getDigitalTwinCluster,
  getDigitalTwinEstimate,
  getDigitalTwinMetrics,
  getDigitalTwinPipelineEvent,
  getDigitalTwinStatus,
  listDigitalTwinClusters,
  listDigitalTwinMemoryFiles,
  listDigitalTwinPipelineEvents,
  patchDigitalTwinCandidate,
  pauseDigitalTwinBackfill,
  resumeDigitalTwinBackfill,
  saveDigitalTwinMemoryFile,
  setDigitalTwinMemoryFileLoad,
  synthesizeDigitalTwin,
  updateDigitalTwinSettings,
  uploadDigitalTwinMd,
} from '@/services/claw/digitalTwinService';
import {
  deleteDigitalTwinMemory,
  getDigitalTwinStats,
  getDigitalTwinSubsystemGraph,
  listDigitalTwinMemories,
  recallDigitalTwinMemory,
} from '@/services/claw/digitalTwinMemoryService';
import type {
  DigitalTwinCandidate,
  DigitalTwinEstimate,
  DigitalTwinMemoryFile,
  DigitalTwinMemoryFilesResponse,
  DigitalTwinMetrics,
  DigitalTwinStatus,
  DigitalTwinSubsystemEdge,
  DigitalTwinSubsystemNode,
  MemoryBankMemory,
  MemoryBankStats,
  MemoryRange,
  PipelineEventDetail,
  PipelineEventFilters,
  PipelineEventsPage,
  RecallResult,
} from '@/services/claw/digitalTwinTypes';

export interface DigitalTwinProposalGroup {
  subsystem: string;
  candidates: DigitalTwinCandidate[];
}

export interface DigitalTwinProposalResult {
  groups: DigitalTwinProposalGroup[];
  failedSubsystems: string[];
}

export interface DigitalTwinMemoryQuery {
  limit?: number;
  offset?: number;
  subsystem?: string;
  search?: string;
}

// ── Query keys ────────────────────────────────────────────────────────────────

const dataMode = (): 'demo' | 'live' => (isDigitalTwinDemoMode() ? 'demo' : 'live');
const statusKey = (userId?: string) => ['claw-dt-status', userId, dataMode()] as const;
const memoriesKey = (userId?: string, opts: DigitalTwinMemoryQuery = {}) =>
  [
    'claw-dt-memories',
    userId,
    opts.limit ?? null,
    opts.offset ?? null,
    opts.subsystem ?? null,
    opts.search ?? '',
    dataMode(),
  ] as const;
const infiniteMemoriesKey = (userId?: string, opts: Omit<DigitalTwinMemoryQuery, 'offset'> = {}) =>
  [
    'claw-dt-memories',
    userId,
    'infinite',
    opts.limit ?? null,
    opts.subsystem ?? null,
    opts.search ?? '',
    dataMode(),
  ] as const;
const statsKey = (userId?: string, range?: MemoryRange) =>
  ['claw-dt-stats', userId, range, dataMode()] as const;
const proposalsKey = (userId?: string) => ['claw-dt-proposals', userId, dataMode()] as const;
const graphKey = (userId?: string) => ['claw-dt-graph', userId, dataMode()] as const;
const metricsKey = (userId?: string, days?: number | null) =>
  ['claw-dt-metrics', userId, days ?? null, dataMode()] as const;
const estimateKey = (userId?: string, from?: string, to?: string) =>
  ['claw-dt-estimate', userId, from, to, dataMode()] as const;
const filesKey = (userId?: string) => ['claw-dt-files', userId, dataMode()] as const;
const activityKey = (userId?: string, filters: PipelineEventFilters = {}) =>
  [
    'claw-dt-activity',
    userId,
    filters.runType ?? '',
    filters.status ?? '',
    filters.sourceKind ?? '',
    dataMode(),
  ] as const;
const activityDetailKey = (userId?: string, id?: string | null) =>
  ['claw-dt-activity-detail', userId, id ?? null, dataMode()] as const;

const backgroundWorkRunning = (status: DigitalTwinStatus | undefined): boolean => {
  if (status?.memoryDeleteInProgress) return true;
  return !!status?.backfill?.overall.running;
};

const invalidateDigitalTwin = (
  qc: ReturnType<typeof useQueryClient>,
  userId: string | undefined,
  keys: string[],
): void => {
  keys.forEach(key => void qc.invalidateQueries({ queryKey: [key, userId] }));
};

// ── Reads ─────────────────────────────────────────────────────────────────────

export type UseClawDigitalTwinStatusResult = UseQueryResult<DigitalTwinStatus, Error> & {
  backfillStalled: boolean;
};

export const useClawDigitalTwinStatus = (): UseClawDigitalTwinStatusResult => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const previouslyRunning = useRef(false);
  const query = useQuery({
    queryKey: statusKey(user?.id),
    queryFn: () => getDigitalTwinStatus(user!.id),
    enabled: !!user?.id,
    refetchInterval: q => (backgroundWorkRunning(q.state.data) ? 2_000 : false),
  });
  const running = backgroundWorkRunning(query.data);

  useEffect((): void => {
    if (previouslyRunning.current && !running) {
      invalidateDigitalTwin(qc, user?.id, [
        'claw-dt-status',
        'claw-dt-files',
        'claw-dt-memories',
        'claw-dt-activity',
      ]);
    }
    previouslyRunning.current = running;
  }, [qc, running, user?.id]);

  return {
    ...query,
    backfillStalled: query.data?.backfill?.overall.stalled ?? false,
  };
};

export const useClawDigitalTwinMemories = (
  opts: DigitalTwinMemoryQuery = {},
): UseQueryResult<{ memories: MemoryBankMemory[]; total: number }, Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: memoriesKey(user?.id, opts),
    queryFn: () => listDigitalTwinMemories(user!.id, opts),
    enabled: !!user?.id,
    placeholderData: previous => previous,
    staleTime: 30 * 1000,
  });
};

export const useInfiniteClawDigitalTwinMemories = (
  opts: Omit<DigitalTwinMemoryQuery, 'offset'> = {},
): UseInfiniteQueryResult<InfiniteData<{ memories: MemoryBankMemory[]; total: number }>, Error> => {
  const { user } = useAuth();
  const limit = opts.limit ?? 50;
  return useInfiniteQuery({
    queryKey: infiniteMemoriesKey(user?.id, { ...opts, limit }),
    queryFn: ({ pageParam }) =>
      listDigitalTwinMemories(user!.id, {
        ...opts,
        limit,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((count, page) => count + page.memories.length, 0);
      return lastPage.memories.length > 0 && loaded < lastPage.total ? loaded : undefined;
    },
    enabled: !!user?.id,
    staleTime: 30 * 1000,
  });
};

export const useClawDigitalTwinStats = (
  range: MemoryRange,
): UseQueryResult<MemoryBankStats, Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: statsKey(user?.id, range),
    queryFn: () => getDigitalTwinStats(user!.id, range),
    enabled: !!user?.id,
    staleTime: 30 * 1000,
  });
};

export const useClawDigitalTwinProposals = (): UseQueryResult<DigitalTwinProposalResult, Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: proposalsKey(user?.id),
    queryFn: async () => {
      const userId = user!.id;
      const { clusters } = await listDigitalTwinClusters(userId);
      const withPending = clusters.filter(cluster => cluster.pending > 0);
      const settled = await Promise.allSettled(
        withPending.map(cluster => getDigitalTwinCluster(userId, cluster.subsystem)),
      );
      const failedSubsystems: string[] = [];
      const groups: DigitalTwinProposalGroup[] = [];
      settled.forEach((result, index) => {
        const subsystem = withPending[index]?.subsystem;
        if (!subsystem) return;
        if (result.status === 'rejected') {
          failedSubsystems.push(subsystem);
          return;
        }
        const candidates = result.value.candidates.filter(
          candidate => candidate.status === 'pending',
        );
        if (candidates.length > 0) groups.push({ subsystem, candidates });
      });
      return { groups, failedSubsystems };
    },
    enabled: !!user?.id,
  });
};

export const useClawDigitalTwinGraph = (): UseQueryResult<
  { subsystems: DigitalTwinSubsystemNode[]; edges: DigitalTwinSubsystemEdge[] },
  Error
> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: graphKey(user?.id),
    queryFn: () => getDigitalTwinSubsystemGraph(user!.id),
    enabled: !!user?.id,
    staleTime: 30 * 1000,
  });
};

export const useClawDigitalTwinMetrics = (
  days: number | null,
): UseQueryResult<DigitalTwinMetrics, Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: metricsKey(user?.id, days),
    queryFn: () => getDigitalTwinMetrics(user!.id, days ?? undefined),
    enabled: !!user?.id,
    staleTime: 30 * 1000,
  });
};

export const useClawDigitalTwinEstimate = (
  from: string,
  to: string,
  enabled: boolean,
): UseQueryResult<DigitalTwinEstimate, Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: estimateKey(user?.id, from, to),
    queryFn: () => getDigitalTwinEstimate(user!.id, from, to),
    enabled: !!user?.id && !!from && !!to && enabled,
    staleTime: 60 * 1000,
  });
};

export const useClawDigitalTwinMemoryFiles = (): UseQueryResult<
  DigitalTwinMemoryFilesResponse,
  Error
> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: filesKey(user?.id),
    queryFn: () => listDigitalTwinMemoryFiles(user!.id),
    enabled: !!user?.id,
  });
};

export const useClawDigitalTwinPipelineEvents = (
  filters: Omit<PipelineEventFilters, 'before'>,
  live: boolean,
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<PipelineEventsPage>, Error> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const previouslyRunning = useRef(false);
  const query = useInfiniteQuery({
    queryKey: activityKey(user?.id, filters),
    queryFn: ({ pageParam }) =>
      listDigitalTwinPipelineEvents(user!.id, {
        ...filters,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: lastPage => lastPage.nextBefore ?? undefined,
    enabled: !!user?.id && enabled,
    refetchInterval: result => {
      const eventRunning =
        result.state.data?.pages.some(page =>
          page.events.some(event => event.status === 'running' || event.status === 'retry'),
        ) ?? false;
      return live || eventRunning ? 2_000 : false;
    },
  });
  const eventRunning =
    query.data?.pages.some(page =>
      page.events.some(event => event.status === 'running' || event.status === 'retry'),
    ) ?? false;

  useEffect((): void => {
    if (previouslyRunning.current && !eventRunning) {
      invalidateDigitalTwin(qc, user?.id, [
        'claw-dt-status',
        'claw-dt-files',
        'claw-dt-memories',
        'claw-dt-activity',
      ]);
    }
    previouslyRunning.current = eventRunning;
  }, [eventRunning, qc, user?.id]);

  return query;
};

export const useClawDigitalTwinPipelineEvent = (
  id: string | null,
): UseQueryResult<PipelineEventDetail, Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: activityDetailKey(user?.id, id),
    queryFn: () => getDigitalTwinPipelineEvent(user!.id, id!),
    enabled: !!user?.id && !!id,
  });
};

// ── Mutations ─────────────────────────────────────────────────────────────────

export const useEnableDigitalTwin = (): UseMutationResult<
  { enabled: boolean; enabledAt: string; backfillJobIds: string[] },
  Error,
  { backfill: { from: string; to: string } | null }
> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ backfill }) => enableDigitalTwin(user!.id, backfill),
    onSuccess: () => void qc.invalidateQueries({ queryKey: statusKey(user?.id) }),
    onError: error => toast.error(clawErrorText(error, 'Failed to enable Digital Twin')),
  });
};

export const useDisableDigitalTwin = (): UseMutationResult<
  unknown,
  Error,
  { deleteMemories: boolean }
> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deleteMemories }) => disableDigitalTwin(user!.id, deleteMemories),
    onSuccess: () => {
      invalidateDigitalTwin(qc, user?.id, [
        'claw-dt-status',
        'claw-dt-memories',
        'claw-dt-proposals',
        'claw-dt-graph',
        'claw-dt-stats',
        'claw-dt-metrics',
        'claw-dt-files',
        'claw-dt-activity',
      ]);
      toast.success('Digital Twin disabled');
    },
    onError: error => toast.error(clawErrorText(error, 'Failed to disable Digital Twin')),
  });
};

export const usePauseDigitalTwinBackfill = (): UseMutationResult<
  { paused: boolean; pausedSources: number; cancelledJobs: number },
  Error,
  void
> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => pauseDigitalTwinBackfill(user!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: statusKey(user?.id) });
      toast.success('Backfill paused');
    },
    onError: (error: Error) => toast.error(clawErrorText(error, 'Could not pause backfill')),
  });
};

export const useResumeDigitalTwinBackfill = (): UseMutationResult<
  { resumed: number; jobIds: string[] },
  Error,
  void
> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => resumeDigitalTwinBackfill(user!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: statusKey(user?.id) });
      toast.success('Backfill resumed');
    },
    onError: (error: Error) => toast.error(clawErrorText(error, 'Could not resume backfill')),
  });
};

export const useDeleteDigitalTwinMemories = (): UseMutationResult<
  { deleting: boolean; mode?: string },
  Error,
  { mode: 'all' | 'range'; from?: string; to?: string }
> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: { mode: 'all' | 'range'; from?: string; to?: string }) =>
      deleteDigitalTwinMemories(user!.id, opts),
    onSuccess: () => {
      invalidateDigitalTwin(qc, user?.id, [
        'claw-dt-status',
        'claw-dt-memories',
        'claw-dt-stats',
        'claw-dt-graph',
        'claw-dt-activity',
      ]);
      toast.success('Memory deletion started');
    },
    onError: (error: Error) => toast.error(clawErrorText(error, 'Could not delete memories')),
  });
};

export const useApproveDigitalTwinCluster = (): UseMutationResult<
  { processing?: boolean; count?: number },
  Error,
  { subsystem: string; candidateIds?: string[] }
> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ subsystem, candidateIds }) =>
      approveDigitalTwinCluster(user!.id, subsystem, candidateIds),
    onSuccess: () =>
      invalidateDigitalTwin(qc, user?.id, [
        'claw-dt-proposals',
        'claw-dt-status',
        'claw-dt-memories',
      ]),
    onError: error => toast.error(clawErrorText(error, 'Failed to approve')),
  });
};

export const usePatchDigitalTwinCandidate = (): UseMutationResult<
  { id: string; status: string },
  Error,
  { id: string; patch: { editedText?: string; status?: 'approved' | 'rejected' } }
> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => patchDigitalTwinCandidate(user!.id, id, patch),
    onSuccess: () =>
      invalidateDigitalTwin(qc, user?.id, [
        'claw-dt-proposals',
        'claw-dt-status',
        'claw-dt-memories',
      ]),
    onError: error => toast.error(clawErrorText(error, 'Action failed')),
  });
};

export const useUpdateDigitalTwinSettings = (): UseMutationResult<
  {
    responseSuffix: string;
    memoryApprovalMode: string;
    memoryAutoApproveMinScore: number;
    respondPolicy?: string;
  },
  Error,
  {
    responseSuffix?: string | null;
    memoryApprovalMode?: 'manual' | 'auto';
    memoryAutoApproveMinScore?: number;
    respondPolicy?: 'always' | 'learned';
  }
> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: patch => updateDigitalTwinSettings(user!.id, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: statusKey(user?.id) }),
    onError: error => toast.error(clawErrorText(error, 'Failed to save settings')),
  });
};

export const useUploadDigitalTwinMd = (): UseMutationResult<
  { filename: string; candidatesCreated: number },
  Error,
  { filename: string; content: string }
> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ filename, content }) => uploadDigitalTwinMd(user!.id, filename, content),
    onSuccess: () =>
      invalidateDigitalTwin(qc, user?.id, [
        'claw-dt-status',
        'claw-dt-proposals',
        'claw-dt-activity',
      ]),
    onError: error => toast.error(clawErrorText(error, 'Upload failed')),
  });
};

export const useDeleteDigitalTwinMemory = (): UseMutationResult<
  void,
  Error,
  { hindsightMemoryId: string }
> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hindsightMemoryId }) => deleteDigitalTwinMemory(user!.id, hindsightMemoryId),
    onSuccess: () => {
      invalidateDigitalTwin(qc, user?.id, [
        'claw-dt-memories',
        'claw-dt-stats',
        'claw-dt-graph',
        'claw-dt-status',
      ]);
      toast.success('Memory deleted');
    },
    onError: error => toast.error(clawErrorText(error, 'Failed to delete memory')),
  });
};

export const useSaveDigitalTwinMemoryFile = (): UseMutationResult<
  { file: DigitalTwinMemoryFile; truncated: boolean; maxChars: number },
  Error,
  { name: string; content: string }
> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      saveDigitalTwinMemoryFile(user!.id, name, content),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: filesKey(user?.id) });
      toast.success('Persona file saved');
    },
    onError: (error: Error) => toast.error(clawErrorText(error, 'Could not save persona file')),
  });
};

export const useSetDigitalTwinMemoryFileLoad = (): UseMutationResult<
  { file: DigitalTwinMemoryFile },
  Error,
  { file: DigitalTwinMemoryFile; load: boolean }
> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, load }: { file: DigitalTwinMemoryFile; load: boolean }) =>
      setDigitalTwinMemoryFileLoad(user!.id, file.name, load),
    onSuccess: () => void qc.invalidateQueries({ queryKey: filesKey(user?.id) }),
    onError: (error: Error) => toast.error(clawErrorText(error, 'Could not update prompt files')),
  });
};

export const useDeleteDigitalTwinMemoryFile = (): UseMutationResult<
  { deleted: boolean },
  Error,
  { name: string }
> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name }: { name: string }) => deleteDigitalTwinMemoryFile(user!.id, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: filesKey(user?.id) });
      toast.success('Persona file deleted');
    },
    onError: (error: Error) => toast.error(clawErrorText(error, 'Could not delete persona file')),
  });
};

export const useSynthesizeDigitalTwin = (): UseMutationResult<{ status: string }, Error, void> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => synthesizeDigitalTwin(user!.id),
    onSuccess: () => {
      invalidateDigitalTwin(qc, user?.id, ['claw-dt-files', 'claw-dt-activity']);
      toast.success('Persona rebuild started');
    },
    onError: (error: Error) => toast.error(clawErrorText(error, 'Could not rebuild persona')),
  });
};

export const useRecallDigitalTwin = (): UseMutationResult<
  RecallResult[],
  Error,
  { query: string; budget?: 'low' | 'mid' | 'high' }
> => {
  const { user } = useAuth();
  return useMutation({
    mutationFn: ({ query, budget }) => recallDigitalTwinMemory(user!.id, query, budget),
    onError: error => toast.error(clawErrorText(error, 'Recall failed')),
  });
};
