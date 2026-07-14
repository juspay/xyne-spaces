import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  listScheduledJobsForAgent,
  listScheduledJobRuns,
  updateScheduledJob,
  deleteScheduledJob,
  type ScheduledJob,
  type ScheduledJobPatch,
  type ScheduledJobRun,
} from '../services/claw/clawScheduledJobsService';

/** Scheduled jobs attached to an agent, scoped by the current user unless the backend grants admin access. */
export const useClawScheduledJobs = (
  agentSlug: string | undefined,
): UseQueryResult<ScheduledJob[], Error> => {
  const { user } = useAuth();
  const userId = user?.id;
  return useQuery({
    queryKey: ['claw-scheduled-jobs', agentSlug, userId],
    queryFn: () => listScheduledJobsForAgent(agentSlug!, userId),
    enabled: !!agentSlug && !!userId,
    staleTime: 60 * 1000,
  });
};

export const useClawScheduledJobRuns = (
  agentSlug: string | undefined,
): UseQueryResult<ScheduledJobRun[], Error> =>
  useQuery({
    queryKey: ['claw-scheduled-job-runs', agentSlug],
    queryFn: () => listScheduledJobRuns(agentSlug!),
    enabled: !!agentSlug,
    staleTime: 30 * 1000,
  });

export const useClawScheduledJobMutations = (agentSlug: string) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const jobsKey = ['claw-scheduled-jobs', agentSlug, user?.id];
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: jobsKey });
    void queryClient.invalidateQueries({ queryKey: ['claw-scheduled-job-runs', agentSlug] });
  };
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ScheduledJobPatch }) =>
      updateScheduledJob(id, patch),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: deleteScheduledJob,
    onSuccess: invalidate,
  });
  return { update, remove };
};
