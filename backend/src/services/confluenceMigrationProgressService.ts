import { redisService } from '@/services/redisService';
import type {
  ConfluenceImportConfig,
  ConfluenceImportSummary,
} from '@/services/confluence/confluenceImportService';

export type ConfluenceMigrationJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ConfluenceMigrationJobProgress {
  jobId: string;
  status: ConfluenceMigrationJobStatus;
  spaceKey: string;
  targetProjectId: string;
  targetChannelId?: string;
  totalPages: number | null;
  processedPages: number;
  createdCanvases: number;
  updatedCanvases: number;
  createdFolders: number;
  reusedFolders: number;
  migratedAttachments: number;
  reusedAttachments: number;
  failedAttachments: number;
  currentPageTitle: string | null;
  currentStep: string | null;
  warnings: string[];
  unresolvedUsers: ConfluenceImportSummary['unresolvedUsers'];
  pageResults: ConfluenceImportSummary['pageResults'];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  errorMessage?: string;
  result?: ConfluenceImportSummary;
}

const TTL_SECONDS = 60 * 60 * 24 * 7;
const STALE_RUNNING_JOB_MS = 30 * 60 * 1000;

const atomicPatchJobScript = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local patch = cjson.decode(ARGV[2])
local updatedAt = ARGV[3]
local current = redis.call('GET', key)
if not current then
  return nil
end
local job = cjson.decode(current)
for field, value in pairs(patch) do
  job[field] = value
end
job['updatedAt'] = updatedAt
local encoded = cjson.encode(job)
redis.call('SET', key, encoded, 'EX', ttl)
return encoded
`;

class ConfluenceMigrationProgressService {
  private buildKey(jobId: string): string {
    return `confluence:migration:job:${jobId}`;
  }

  private buildPageResultsKey(jobId: string): string {
    return `${this.buildKey(jobId)}:pages`;
  }

  private stripPageResultsFromSummary(
    summary: ConfluenceImportSummary,
  ): ConfluenceImportSummary {
    return {
      ...summary,
      pageResults: [],
    };
  }

  private stripPageResultsFromProgress(
    progress: ConfluenceMigrationJobProgress,
  ): ConfluenceMigrationJobProgress {
    return {
      ...progress,
      pageResults: [],
      ...(progress.result ? { result: this.stripPageResultsFromSummary(progress.result) } : {}),
    };
  }

  private async hydratePageResults(
    progress: ConfluenceMigrationJobProgress,
  ): Promise<ConfluenceMigrationJobProgress> {
    const values = await redisService.getClient().hvals(this.buildPageResultsKey(progress.jobId));
    const pageResults = values.map(
      value => JSON.parse(value) as ConfluenceImportSummary['pageResults'][number],
    );

    return {
      ...progress,
      pageResults,
      ...(progress.result ? { result: { ...progress.result, pageResults } } : {}),
    };
  }

  private isStaleActiveJob(progress: ConfluenceMigrationJobProgress): boolean {
    if (progress.status !== 'queued' && progress.status !== 'running') return false;

    const updatedAtMs = Date.parse(progress.updatedAt);
    return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs > STALE_RUNNING_JOB_MS;
  }

  async createJob(jobId: string, input: ConfluenceImportConfig): Promise<ConfluenceMigrationJobProgress> {
    const now = new Date().toISOString();
    const progress: ConfluenceMigrationJobProgress = {
      jobId,
      status: 'queued',
      spaceKey: input.spaceKey.trim(),
      targetProjectId: input.projectId || '',
      ...(input.targetChannelId ? { targetChannelId: input.targetChannelId } : {}),
      totalPages: null,
      processedPages: 0,
      createdCanvases: 0,
      updatedCanvases: 0,
      createdFolders: 0,
      reusedFolders: 0,
      migratedAttachments: 0,
      reusedAttachments: 0,
      failedAttachments: 0,
      currentPageTitle: null,
      currentStep: 'queued',
      warnings: [],
      unresolvedUsers: [],
      pageResults: [],
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    };

    await this.setProgress(progress);
    return progress;
  }

  async getJob(jobId: string): Promise<ConfluenceMigrationJobProgress | null> {
    const data = await redisService.getClient().get(this.buildKey(jobId));
    if (!data) return null;
    const progress = JSON.parse(data) as ConfluenceMigrationJobProgress;

    if (this.isStaleActiveJob(progress)) {
      const staleProgress = await this.patchJob(jobId, {
        status: 'failed',
        currentStep: 'failed',
        completedAt: new Date().toISOString(),
        errorMessage: 'Confluence migration job became stale and was marked failed. Restart the migration to continue.',
      });
      return staleProgress;
    }

    return this.hydratePageResults(progress);
  }

  async setProgress(progress: ConfluenceMigrationJobProgress): Promise<void> {
    const next = this.stripPageResultsFromProgress({
      ...progress,
      updatedAt: new Date().toISOString(),
    });

    await redisService
      .getClient()
      .set(this.buildKey(progress.jobId), JSON.stringify(next), 'EX', TTL_SECONDS);
  }

  async patchJob(
    jobId: string,
    patch: Partial<ConfluenceMigrationJobProgress>,
  ): Promise<ConfluenceMigrationJobProgress | null> {
    const { pageResults, result, ...mainPatch } = patch;
    if (pageResults) {
      await this.storePageResults(jobId, pageResults);
    }

    const sanitizedPatch = {
      ...mainPatch,
      ...(result ? { result: this.stripPageResultsFromSummary(result) } : {}),
    };

    const updatedAt = new Date().toISOString();
    const patched = await redisService.getClient().eval(
      atomicPatchJobScript,
      1,
      this.buildKey(jobId),
      String(TTL_SECONDS),
      JSON.stringify(sanitizedPatch),
      updatedAt,
    ) as string | null;

    if (!patched) return null;

    await redisService.getClient().expire(this.buildPageResultsKey(jobId), TTL_SECONDS);
    return this.hydratePageResults(JSON.parse(patched) as ConfluenceMigrationJobProgress);
  }

  async upsertPageResult(
    jobId: string,
    pageResult: ConfluenceImportSummary['pageResults'][number],
  ): Promise<ConfluenceMigrationJobProgress | null> {
    await redisService.getClient().hset(
      this.buildPageResultsKey(jobId),
      pageResult.confluencePageId,
      JSON.stringify(pageResult),
    );
    await redisService.getClient().expire(this.buildPageResultsKey(jobId), TTL_SECONDS);

    return this.getJob(jobId);
  }

  private async storePageResults(
    jobId: string,
    pageResults: ConfluenceImportSummary['pageResults'],
  ): Promise<void> {
    if (pageResults.length === 0) return;

    const args = pageResults.flatMap(pageResult => [
      pageResult.confluencePageId,
      JSON.stringify(pageResult),
    ]);
    await redisService.getClient().hset(this.buildPageResultsKey(jobId), ...args);
    await redisService.getClient().expire(this.buildPageResultsKey(jobId), TTL_SECONDS);
  }
}

export const confluenceMigrationProgressService = new ConfluenceMigrationProgressService();
