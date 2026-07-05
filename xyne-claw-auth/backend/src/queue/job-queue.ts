/**
 * Generic BullMQ job-queue factory.
 *
 * The eval import/run/judge queues are the same machine with different type
 * params: state in Redis (job.data + updateProgress), a cancel flag the worker
 * polls between work units, and a status snapshot the UI polls. This factory is
 * that machine once; each queue module is a thin typed wrapper around it.
 */
import { Queue } from "bullmq";
import { redisService } from "../redis.js";

export interface JobStatus<TProgress> {
  jobId: string;
  state: string; // waiting | active | completed | failed | delayed | unknown
  progress: TProgress | null;
  failedReason?: string;
}

export interface JobQueue<TData, TProgress> {
  enqueue: (data: TData) => Promise<string>;
  getStatus: (jobId: string) => Promise<JobStatus<TProgress> | null>;
  cancel: (jobId: string) => Promise<boolean>;
  isCancelRequested: (jobId: string) => Promise<boolean>;
  clearCancel: (jobId: string) => Promise<void>;
}

export function makeJobQueue<TData, TProgress extends object>(
  queueName: string,
  opts?: { attempts?: number },
): JobQueue<TData, TProgress> {
  const cancelKey = (jobId: string) => `${queueName}:cancel:${jobId}`;
  let queue: Queue<TData, unknown, string> | undefined;

  const getQueue = (): Queue<TData, unknown, string> => {
    if (!queue) {
      queue = new Queue<TData, unknown, string>(queueName, {
        connection: redisService.getConnection(),
        defaultJobOptions: {
          attempts: opts?.attempts ?? 2,
          backoff: { type: "exponential", delay: 30_000 },
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      });
    }
    return queue;
  };

  return {
    enqueue: async (data) => {
      // bullmq's ExtractNameType can't resolve against an unconstrained TData;
      // the queue is typed Queue<TData, unknown, string>, so this is safe.
      const job = await getQueue().add(queueName as never, data as never);
      return job.id!;
    },

    getStatus: async (jobId) => {
      const job = await getQueue().getJob(jobId);
      if (!job) return null;
      const state = await job.getState().catch(() => "unknown");
      const progress = job.progress && typeof job.progress === "object" ? (job.progress as TProgress) : null;
      return { jobId, state, progress, ...(job.failedReason ? { failedReason: job.failedReason } : {}) };
    },

    cancel: async (jobId) => {
      const job = await getQueue().getJob(jobId);
      if (!job) return false;
      await redisService.getConnection().set(cancelKey(jobId), "1", "EX", 3600);
      const state = await job.getState().catch(() => "unknown");
      if (state === "waiting" || state === "delayed") await job.remove().catch(() => {});
      return true;
    },

    isCancelRequested: async (jobId) => (await redisService.getConnection().get(cancelKey(jobId))) === "1",

    clearCancel: async (jobId) => {
      await redisService.getConnection().del(cancelKey(jobId)).catch(() => {});
    },
  };
}
