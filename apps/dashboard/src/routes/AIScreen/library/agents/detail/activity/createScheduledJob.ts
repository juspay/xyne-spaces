import { clawApiRequest } from '@/services/claw/clawRequest';
import type { ScheduledJob } from '@/services/claw/clawScheduledJobsService';

export interface NewScheduledJob {
  agentSlug: string;
  task: string;
  type: 'once' | 'cron';
  delayMs?: number;
  cronExpression?: string;
  label?: string;
}

export function createScheduledJob(userId: string, job: NewScheduledJob): Promise<ScheduledJob> {
  return clawApiRequest<ScheduledJob>('/scheduled-jobs', {
    method: 'POST',
    userId,
    body: JSON.stringify({ userId, ...job }),
  });
}

export const MINUTE_MS = 60 * 1000;
