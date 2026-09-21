/**
 * OCR job ids, and which environment owns one.
 *
 * Prod and pre-prod run against SEPARATE Postgres databases but share one
 * Redis and one external OCR wrapper. The wrapper tracks its in-flight jobs in
 * a global sorted set keyed by our job id, and every environment's reaper
 * sweeps that set: an entry whose job id is not live in the reaper's own
 * database is treated as stale and removed. Without an owner marker on the job
 * id, pre-prod's reaper deletes prod's live entries (and vice versa), so the
 * wrapper's concurrency accounting under-counts and both environments
 * over-admit OCR work to it.
 *
 * So the job id carries the environment tag that minted it:
 *
 *   docling:<envTag>:<fileId>:part:<partIndex>:attempt:<token>   tagged
 *   docling:<fileId>:part:<partIndex>:attempt:<token>            untagged
 *
 * An untagged job id is owned by whoever finds it — that is the pre-isolation
 * format, and it keeps the tag a no-op until DEPLOY_ENV is set.
 * A job id tagged for another environment is never ours to reap.
 *
 * The wrapper treats the job id as opaque and echoes it back on the results
 * stream, so tagging needs no change on its side.
 */
import { config } from '@/config/env'

const SCHEDULER_JOB_ID = /^docling:(?:([^:]+):)?[^:]+:part:\d+:attempt:[^:]+$/

const envTag = () => config.doclingScheduler.envTag

/**
 * The `<envTag>:` segment to splice into a newly minted job id — empty when
 * this deployment has no tag, which reproduces the pre-isolation format.
 */
export const jobIdEnvSegment = (): string => {
  const tag = envTag()
  return tag ? `${tag}:` : ''
}

/** The environment tag carried by a job id, or null for untagged/unparseable. */
export const jobIdEnvTag = (jobId: string): string | null =>
  SCHEDULER_JOB_ID.exec(jobId)?.[1] ?? null

/**
 * Whether this deployment may act on a job id found in shared Redis state:
 * true for our own tag and for untagged ids, false for another environment's.
 */
export const isOwnSchedulerJobId = (jobId: string): boolean => {
  const match = SCHEDULER_JOB_ID.exec(jobId)
  if (!match) return false
  const tag = match[1]
  return !tag || tag === envTag()
}
