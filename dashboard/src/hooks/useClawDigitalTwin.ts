import { useEffect, useRef, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { clawErrorText } from '@/services/claw/clawRequest';
import {
  approveDigitalTwinCluster,
  disableDigitalTwin,
  enableDigitalTwin,
  getDigitalTwinCluster,
  getDigitalTwinEstimate,
  getDigitalTwinMetrics,
  getDigitalTwinStatus,
  listDigitalTwinClusters,
  patchDigitalTwinCandidate,
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
  DigitalTwinMetrics,
  DigitalTwinStatus,
  DigitalTwinSubsystemEdge,
  DigitalTwinSubsystemNode,
  MemoryBankMemory,
  MemoryBankStats,
  MemoryRange,
  RecallResult,
} from '@/services/claw/digitalTwinTypes';

export interface DigitalTwinProposalGroup {
  subsystem: string;
  candidates: DigitalTwinCandidate[];
}

// ── Query keys ────────────────────────────────────────────────────────────────

const statusKey = (userId?: string) => ['claw-dt-status', userId] as const;
const memoriesKey = (userId?: string, subsystem?: string | null) =>
  ['claw-dt-memories', userId, subsystem ?? null] as const;
const statsKey = (userId?: string, range?: MemoryRange) =>
  ['claw-dt-stats', userId, range] as const;
const proposalsKey = (userId?: string) => ['claw-dt-proposals', userId] as const;
const graphKey = (userId?: string) => ['claw-dt-graph', userId] as const;
const metricsKey = (userId?: string, days?: number | null) =>
  ['claw-dt-metrics', userId, days ?? null] as const;
const estimateKey = (userId?: string, from?: string, to?: string) =>
  ['claw-dt-estimate', userId, from, to] as const;

const backfillRunning = (status: DigitalTwinStatus | undefined): boolean =>
  !!status?.backfillState && Object.values(status.backfillState).some(s => !s.complete);

// ── Status (with polling + stall detection) ───────────────────────────────────

/** Stringify cursor values for non-complete sources so we can detect movement. */
function cursorSnapshot(status: DigitalTwinStatus | undefined): string {
  if (!status?.backfillState) return '';
  return Object.entries(status.backfillState)
    .filter(([, entry]) => !entry.complete)
    .map(([key, entry]) => `${key}:${entry.cursor ?? ''}`)
    .sort()
    .join('|');
}

/**
 * Ported from the reference `useDigitalTwin` stall detector: true once the
 * backfill has run for ≥3 consecutive polls (~30s) with no cursor movement on
 * any non-complete source. Recomputed each time react-query refetches (keyed on
 * `dataUpdatedAt`). Only counts after a cursor has moved at least once, so the
 * initial "" → "source:cursor" transition never counts as a stall.
 */
function useBackfillStall(status: DigitalTwinStatus | undefined, dataUpdatedAt: number): boolean {
  const stalledPollsRef = useRef(0);
  const lastSnapshotRef = useRef('');
  const hasSeenMovementRef = useRef(false);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (!status) return;
    const snap = cursorSnapshot(status);
    const hasNonComplete = status.backfillState
      ? Object.values(status.backfillState).some(e => !e.complete)
      : false;

    if (!hasNonComplete) {
      stalledPollsRef.current = 0;
      lastSnapshotRef.current = '';
      hasSeenMovementRef.current = false;
      setStalled(false);
    } else if (snap !== lastSnapshotRef.current) {
      stalledPollsRef.current = 0;
      if (lastSnapshotRef.current !== '') hasSeenMovementRef.current = true;
      lastSnapshotRef.current = snap;
      setStalled(false);
    } else if (hasSeenMovementRef.current) {
      stalledPollsRef.current += 1;
      if (stalledPollsRef.current >= 3) setStalled(true);
    }
    // dataUpdatedAt changes on every (even unchanged) refetch, so a frozen
    // cursor still advances the stall counter each poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUpdatedAt]);

  return stalled;
}

export type UseClawDigitalTwinStatusResult = UseQueryResult<DigitalTwinStatus, Error> & {
  backfillStalled: boolean;
};

export const useClawDigitalTwinStatus = (): UseClawDigitalTwinStatusResult => {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: statusKey(user?.id),
    queryFn: () => getDigitalTwinStatus(user!.id),
    enabled: !!user?.id,
    // Poll every 10s while a backfill is in progress; idle otherwise.
    refetchInterval: q => (backfillRunning(q.state.data) ? 10_000 : false),
  });
  const backfillStalled = useBackfillStall(query.data, query.dataUpdatedAt);
  return { ...query, backfillStalled };
};

// ── Reads ─────────────────────────────────────────────────────────────────────

export const useClawDigitalTwinMemories = (
  opts: { limit?: number; offset?: number; subsystem?: string } = {},
): UseQueryResult<{ memories: MemoryBankMemory[]; total: number }, Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: memoriesKey(user?.id, opts.subsystem),
    queryFn: () => listDigitalTwinMemories(user!.id, opts),
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

export const useClawDigitalTwinProposals = (): UseQueryResult<
  DigitalTwinProposalGroup[],
  Error
> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: proposalsKey(user?.id),
    queryFn: async () => {
      const userId = user!.id;
      const { clusters } = await listDigitalTwinClusters(userId);
      const withPending = clusters.filter(c => c.pending > 0);
      const results = await Promise.all(
        withPending.map(cl =>
          getDigitalTwinCluster(userId, cl.subsystem)
            .then(data => ({
              subsystem: cl.subsystem,
              candidates: data.candidates.filter(c => c.status === 'pending'),
            }))
            .catch(() => ({ subsystem: cl.subsystem, candidates: [] as DigitalTwinCandidate[] })),
        ),
      );
      return results.filter(r => r.candidates.length > 0);
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

// ── Mutations ───────────────────────────────────────────────────────────────

export const useEnableDigitalTwin = (): UseMutationResult<
  { enabled: boolean; enabledAt: string; backfillJobIds: string[] },
  Error,
  { backfill: { from: string; to: string } | null }
> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ backfill }) => enableDigitalTwin(user!.id, backfill),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: statusKey(user?.id) });
    },
    onError: err => toast.error(clawErrorText(err, 'Failed to enable Digital Twin')),
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
      [
        'claw-dt-status',
        'claw-dt-memories',
        'claw-dt-proposals',
        'claw-dt-graph',
        'claw-dt-stats',
        'claw-dt-metrics',
      ].forEach(k => void qc.invalidateQueries({ queryKey: [k, user?.id] }));
      toast.success('Digital Twin disabled');
    },
    onError: err => toast.error(clawErrorText(err, 'Failed to disable Digital Twin')),
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
    onSuccess: () => {
      ['claw-dt-proposals', 'claw-dt-status', 'claw-dt-memories'].forEach(
        k => void qc.invalidateQueries({ queryKey: [k, user?.id] }),
      );
    },
    onError: err => toast.error(clawErrorText(err, 'Failed to approve')),
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
    onSuccess: () => {
      ['claw-dt-proposals', 'claw-dt-status', 'claw-dt-memories'].forEach(
        k => void qc.invalidateQueries({ queryKey: [k, user?.id] }),
      );
    },
    onError: err => toast.error(clawErrorText(err, 'Action failed')),
  });
};

export const useUpdateDigitalTwinSettings = (): UseMutationResult<
  { responseSuffix: string; memoryApprovalMode: string; memoryAutoApproveMinScore: number },
  Error,
  {
    responseSuffix?: string | null;
    memoryApprovalMode?: 'manual' | 'auto';
    memoryAutoApproveMinScore?: number;
  }
> => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: patch => updateDigitalTwinSettings(user!.id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: statusKey(user?.id) });
    },
    onError: err => toast.error(clawErrorText(err, 'Failed to save settings')),
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
    onSuccess: () => {
      ['claw-dt-status', 'claw-dt-proposals'].forEach(
        k => void qc.invalidateQueries({ queryKey: [k, user?.id] }),
      );
    },
    onError: err => toast.error(clawErrorText(err, 'Upload failed')),
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
      ['claw-dt-memories', 'claw-dt-stats', 'claw-dt-graph', 'claw-dt-status'].forEach(
        k => void qc.invalidateQueries({ queryKey: [k, user?.id] }),
      );
      toast.success('Memory deleted');
    },
    onError: err => toast.error(clawErrorText(err, 'Failed to delete memory')),
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
    onError: err => toast.error(clawErrorText(err, 'Recall failed')),
  });
};
