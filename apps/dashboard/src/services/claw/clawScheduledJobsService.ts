import { clawRequest } from './clawRequest';

export interface ScheduledJob {
  readonly id: string;
  readonly userId: string | null;
  readonly agentSlug: string;
  readonly task: string;
  readonly context: string | null;
  readonly channelId: string | null;
  readonly conversationId: string | null;
  readonly targetChannelId?: string | null;
  readonly type: 'once' | 'cron';
  readonly delayMs: number | null;
  readonly cronExpression: string | null;
  readonly label: string | null;
  readonly maxRuns: number | null;
  readonly runCount?: number | null;
  readonly runsCount?: number | null;
  readonly replyMode?: string | null;
  readonly status: string;
  readonly nextRunAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScheduledJobRun {
  readonly id: string;
  readonly scheduledJobId: string;
  readonly sessionId: string | null;
  readonly status: string;
  readonly result: string | null;
  readonly error: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly scheduledJob?: {
    readonly label: string | null;
    readonly task: string;
    readonly cronExpression: string | null;
  };
}

export interface ScheduledJobPatch {
  replyMode?: 'thread' | 'channel';
  label?: string | null;
  targetChannelId?: string | null;
  cronExpression?: string;
  nextRunAt?: string;
}

interface SuccessEnvelope<T> {
  success: boolean;
  data: T;
}

/** Lists scheduled jobs for a single agent. The backend scopes browser users to themselves. */
export async function listScheduledJobsForAgent(
  agentSlug: string,
  userId: string | undefined,
): Promise<ScheduledJob[]> {
  const params = new URLSearchParams({ agentSlug });
  if (userId) params.set('userId', userId);
  const body = await clawRequest<SuccessEnvelope<ScheduledJob[]>>(
    `/api/v1/scheduled-jobs?${params.toString()}`,
  );
  return body.data;
}

export async function updateScheduledJob(
  id: string,
  patch: ScheduledJobPatch,
): Promise<ScheduledJob> {
  const body = await clawRequest<SuccessEnvelope<ScheduledJob>>(
    `/api/v1/scheduled-jobs/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return body.data;
}

export async function deleteScheduledJob(id: string): Promise<void> {
  await clawRequest<unknown>(`/api/v1/scheduled-jobs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function listScheduledJobRuns(agentSlug: string): Promise<ScheduledJobRun[]> {
  const body = await clawRequest<SuccessEnvelope<ScheduledJobRun[]>>(
    `/api/v1/scheduled-jobs/runs?agentSlug=${encodeURIComponent(agentSlug)}`,
  );
  return body.data;
}
