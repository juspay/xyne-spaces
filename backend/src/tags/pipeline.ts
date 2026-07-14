import Bull from 'bull';
import { EventEmitter } from 'node:events';
import { config as appConfig } from '@/config/env';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { tagRepository } from '@/database/repositories/tagRepository';
import { generateLlmTags } from './generators/llm';
import { TagsConfigShapeSchema } from './schema';
import { tagService } from './service';
import { DESK_EMAIL_SOURCE_TYPE, DEFAULT_DESK_EMAIL_CONFIG } from './deskEmail';
import type {
  CategoryConfig,
  ContextBuilderFn,
  GeneratedTag,
  GeneratorFn,
  TagGenerationError,
  TagGenerationJobData,
  TagGenerationResult,
  TagsConfigShape,
} from './types';

export type GeneratorMethod = 'llm';

// Config is the same for every email in a channel — cache it per worker job cycle
// to avoid hitting Postgres once per email during bulk ingestion.
const CONFIG_CACHE_TTL_SECONDS = 120;
const configCacheKey = (key: string) => `tag-config:${key}`;

function getDefaultConfig(sourceType: string): TagsConfigShape | null {
  if (sourceType === DESK_EMAIL_SOURCE_TYPE) return DEFAULT_DESK_EMAIL_CONFIG;
  return null;
}

export async function invalidateTagConfigCache(configKey: string): Promise<void> {
  try {
    await redisService.del(configCacheKey(configKey));
  } catch (err) {
    logger.warn(`[TAG][PIPELINE] Failed to invalidate config cache for "${configKey}":`, err);
  }
}

// Checks whether there is an active, non-empty config for the given configKey.
// Also warms the Redis cache so the first worker job reads from cache rather
// than hitting the DB. Returns false (and caches 'null') for opted-out channels
// so the caller can skip enqueuing entirely.
async function hasActiveConfig(configKey: string, sourceType: string): Promise<boolean> {
  try {
    const cached = await redisService.get(configCacheKey(configKey));
    if (cached === 'null') return false;
    if (cached) {
      const parsed = TagsConfigShapeSchema.safeParse(JSON.parse(cached));
      if (parsed.success) {
        return true;
      }
    }
  } catch (err) {
    logger.warn(`[TAG][PIPELINE] Redis cache read failed for "${configKey}", falling through to DB:`, err);
  }

  const configRow = await tagRepository.getActiveConfigByKey(configKey);
  if (configRow) {
    const parsed = TagsConfigShapeSchema.safeParse(configRow.config);
    if (parsed.success && Object.values(parsed.data.categories).some(c => c.method !== 'manual')) {
      try {
        await redisService.set(configCacheKey(configKey), JSON.stringify(parsed.data), CONFIG_CACHE_TTL_SECONDS);
      } catch (err) {
        logger.warn(`[TAG][PIPELINE] Failed to cache config for "${configKey}":`, err);
      }
      return true;
    }
    // Row exists but empty, all-manual, or corrupted — treat as opted out, cache sentinel.
    try {
      await redisService.set(configCacheKey(configKey), 'null', CONFIG_CACHE_TTL_SECONDS);
    } catch (err) {
      logger.warn(`[TAG][PIPELINE] Failed to cache sentinel for "${configKey}":`, err);
    }
    return false;
  }

  const defaultConfig = getDefaultConfig(sourceType);
  if (defaultConfig) {
    // No DB row but source type has a default — warm cache with default so the worker reads it from Redis.
    try {
      await redisService.set(configCacheKey(configKey), JSON.stringify(defaultConfig), CONFIG_CACHE_TTL_SECONDS);
    } catch (err) {
      logger.warn(`[TAG][PIPELINE] Failed to cache default config for "${configKey}":`, err);
    }
    return true;
  }

  try {
    await redisService.set(configCacheKey(configKey), 'null', CONFIG_CACHE_TTL_SECONDS);
  } catch (err) {
    logger.warn(`[TAG][PIPELINE] Failed to cache sentinel for "${configKey}":`, err);
  }
  return false;
}

export class TagGenerationPipeline extends EventEmitter {
  private queue: Bull.Queue<TagGenerationJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;
  private contextBuilders = new Map<string, ContextBuilderFn>();
  private generators = new Map<GeneratorMethod, GeneratorFn>();

  // ─── Registration ────────────────────────────────────────────────────────────

  registerContextBuilder(sourceType: string, fn: ContextBuilderFn): void {
    if (this.contextBuilders.has(sourceType)) {
      throw new Error(`[TAG][PIPELINE] Context builder already registered for sourceType "${sourceType}"`);
    }
    this.contextBuilders.set(sourceType, fn);
  }

  getContextBuilder(sourceType: string): ContextBuilderFn | undefined {
    return this.contextBuilders.get(sourceType);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  private createQueue(): Bull.Queue<TagGenerationJobData> {
    return new Bull<TagGenerationJobData>('tag-generation', {
      redis: {
        ...redisService.getRedisConfig(),
        lazyConnect: false,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: { count: 100 },
      },
      settings: {
        lockDuration: 5 * 60 * 1000,
        stalledInterval: 60 * 1000,
        maxStalledCount: 1,
      },
    });
  }

  async connectQueue(): Promise<void> {
    if (this.queue) return;
    this.queue = this.createQueue();
    logger.info('[TAG][PIPELINE] Queue connected (submit-only)');
  }

  async initialize(): Promise<void> {
    if (!appConfig.enableTagGenerationPipeline) {
      logger.info('[TAG][PIPELINE] Disabled by ENABLE_TAG_GENERATION_PIPELINE=false');
      return;
    }

    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      if (!this.queue) {
        this.queue = this.createQueue();
      }

      this.registerDefaultGenerators();

      this.queue.process('generate-tags', async (job) => this.processGenerateTagsJob(job));

      this.queue.on('completed', (job, result) => {
        if (!job) return;
        this.handleJobCompleted(job, result as TagGenerationResult);
      });

      this.queue.on('failed', (job, err) => {
        if (!job) return;
        this.handleJobFailed(job, err);
      });

      this.queue.on('error', (err) => {
        logger.error('[TAG][PIPELINE] Queue error:', err);
      });

      this.isInitialized = true;
      logger.info('[TAG][PIPELINE] Initialized');
    } catch (error) {
      logger.error('[TAG][PIPELINE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
    }
  }

  // ─── Job submission ──────────────────────────────────────────────────────────

  async addGenerationJob(
    data: { sourceId: string; sourceType: string; workspaceId: string; configKey: string },
    priority = 5,
  ): Promise<string> {
    if (!appConfig.enableTagGenerationPipeline) {
      throw new Error('[TAG][PIPELINE] Disabled by ENABLE_TAG_GENERATION_PIPELINE=false');
    }
    if (!this.queue) {
      throw new Error('[TAG][PIPELINE] Queue not initialized — call initialize() first');
    }
    if (!this.contextBuilders.has(data.sourceType)) {
      throw new Error(`[TAG][PIPELINE] No context builder registered for sourceType "${data.sourceType}"`);
    }

    if (!(await hasActiveConfig(data.configKey, data.sourceType))) {
      logger.info(`[TAG][PIPELINE] Skipping job — no active config for "${data.configKey}"`);
      return '';
    }

    const jobId = `tag-gen-${data.sourceType}-${data.sourceId}-${data.configKey}`;
    await this.queue.add('generate-tags', { jobId, ...data }, { jobId, priority });

    return jobId;
  }

  // Bulk submission for refetch ingestion paths (one thread at a time from the fetch worker).
  // Uses addBulk so all jobs in a thread are sent in a single Redis pipeline call
  // instead of N individual round-trips. Priority 10 keeps these below live inbound
  // emails (priority 1) so real-time emails always jump ahead.
  async addGenerationJobs(
    items: Array<{ sourceId: string; sourceType: string; workspaceId: string; configKey: string }>,
    priority = 10,
  ): Promise<number> {
    if (!appConfig.enableTagGenerationPipeline) {
      throw new Error('[TAG][PIPELINE] Disabled by ENABLE_TAG_GENERATION_PIPELINE=false');
    }
    if (!this.queue) {
      throw new Error('[TAG][PIPELINE] Queue not initialized — call initialize() first');
    }

    // All items in a bulk call share the same channel/configKey — check once before
    // building the job list to avoid enqueueing when the channel is opted out.
    const firstItem = items[0];
    if (firstItem && !(await hasActiveConfig(firstItem.configKey, firstItem.sourceType))) {
      logger.info(`[TAG][PIPELINE] Skipping bulk jobs — no active config for "${firstItem.configKey}"`);
      return 0;
    }

    const bulkJobs = items
      .filter(item => {
        if (!this.contextBuilders.has(item.sourceType)) {
          logger.warn(`[TAG][PIPELINE] Skipping bulk job — no context builder for sourceType "${item.sourceType}"`);
          return false;
        }
        return true;
      })
      .map(item => {
        const jobId = `tag-gen-${item.sourceType}-${item.sourceId}-${item.configKey}`;
        return {
          name: 'generate-tags',
          data: { jobId, ...item } as TagGenerationJobData,
          opts: { jobId, priority },
        };
      });

    if (bulkJobs.length === 0) return 0;

    await this.queue.addBulk(bulkJobs);
    return bulkJobs.length;
  }

  // ─── Events ──────────────────────────────────────────────────────────────────

  onCompleted(sourceType: string, handler: (result: TagGenerationResult) => void): void {
    this.on(`generation:completed:${sourceType}`, handler);
  }

  onFailed(sourceType: string, handler: (error: TagGenerationError) => void): void {
    this.on(`generation:failed:${sourceType}`, handler);
  }

  // ─── Status ──────────────────────────────────────────────────────────────────

  async getStatus(): Promise<{
    initialized: boolean;
    registeredContextBuilders: string[];
    registeredGenerators: GeneratorMethod[];
    queue: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    } | null;
  }> {
    const queueCounts = this.queue ? await this.queue.getJobCounts() : null;

    return {
      initialized: this.isInitialized,
      registeredContextBuilders: Array.from(this.contextBuilders.keys()),
      registeredGenerators: Array.from(this.generators.keys()),
      queue: queueCounts
        ? {
            waiting: queueCounts.waiting,
            active: queueCounts.active,
            completed: queueCounts.completed,
            failed: queueCounts.failed,
            delayed: queueCounts.delayed,
          }
        : null,
      };
  }

  // ─── Internals ───────────────────────────────────────────────────────────────

  private registerDefaultGenerators(): void {
    this.registerGenerator('llm', generateLlmTags);
  }

  private registerGenerator(method: GeneratorMethod, fn: GeneratorFn): void {
    this.generators.set(method, fn);
  }

  private getGenerator(method: GeneratorMethod): GeneratorFn | undefined {
    return this.generators.get(method);
  }

  private async processGenerateTagsJob(job: Bull.Job<TagGenerationJobData>): Promise<TagGenerationResult> {
    const { jobId, sourceId, sourceType, workspaceId, configKey } = job.data;

    const buildContext = this.getContextBuilder(sourceType);
    if (!buildContext) {
      throw new Error(`[TAG][PIPELINE] No context builder registered for sourceType "${sourceType}"`);
    }

    // During bulk ingestion every email in a channel shares the same config.
    // Read from Redis first to avoid N identical Postgres queries; fall through
    // to DB on a miss and repopulate the cache for the next job.
    const cacheKey = configCacheKey(configKey);
    let configShape: TagsConfigShape | null = null;

    try {
      const cached = await redisService.get(cacheKey);
      if (cached === 'null') {
        // Sentinel: channel opted out or has no generatable config — skip immediately.
        return { jobId, sourceId, sourceType, tags: [] };
      }
      if (cached) {
        const parsed = TagsConfigShapeSchema.safeParse(JSON.parse(cached));
        if (parsed.success) {
          configShape = parsed.data;
        }
      }
    } catch (err) {
      // Cache read failure is non-fatal — fall through to DB.
      logger.warn(`[TAG][PIPELINE] Config cache read failed for "${configKey}", falling back to DB:`, err);
    }

    if (!configShape) {
      const configRow = await tagRepository.getActiveConfigByKey(configKey);
      if (configRow) {
        const parsedConfig = TagsConfigShapeSchema.safeParse(configRow.config);
        if (!parsedConfig.success) {
          logger.warn(`[TAG][PIPELINE] Corrupted TagsConfig for configKey "${configKey}", skipping job`);
          return { jobId, sourceId, sourceType, tags: [] };
        }
        configShape = parsedConfig.data;
      } else {
        const defaultConfig = getDefaultConfig(sourceType);
        if (defaultConfig) {
          // No DB row but source type has a default — use it.
          configShape = defaultConfig;
        }
      }
      if (!configShape) {
        logger.warn(`[TAG][PIPELINE] No active TagsConfig found for configKey "${configKey}", skipping job`);
        return { jobId, sourceId, sourceType, tags: [] };
      }

      try {
        await redisService.set(cacheKey, JSON.stringify(configShape), CONFIG_CACHE_TTL_SECONDS);
      } catch (err) {
        logger.warn(`[TAG][PIPELINE] Failed to cache config for "${configKey}":`, err);
      }
    }

    const { categories } = configShape;

    // User opted out (saved empty categories) — nothing to generate.
    if (Object.keys(categories).length === 0) {
      return { jobId, sourceId, sourceType, tags: [] };
    }

    const context = await buildContext(sourceId, sourceType);
    const byMethod = this.groupCategoriesByMethod(categories);

    const generated: GeneratedTag[] = [];
    for (const [method, group] of Object.entries(byMethod)) {
      if (method === 'manual') continue;

      const generator = this.getGenerator(method as GeneratorMethod);
      if (!generator) {
        logger.warn(`[TAG][PIPELINE] No generator registered for method "${method}", skipping`);
        continue;
      }

      generated.push(...(await generator(context, group)));
    }

    // If an LLM generator returned a tag outside `tags` for a category with
    // is_new_tag_allowed=true, fold that new tag back into the config's vocabulary
    // so future generations/UI dropdowns are aware of it.
    const { categories: mergedCategories, changed } = this.mergeNewTagsIntoCategories(categories, generated);
    if (changed) {
      // upsertConfig handles both "no DB row yet" (default in use) and "existing row" cases.
      await tagService.upsertConfig(
        configKey,
        sourceType,
        workspaceId,
        { ...configShape, categories: mergedCategories },
        undefined,
      );
      // Config changed — evict cache so subsequent jobs read the updated vocabulary.
      await invalidateTagConfigCache(configKey);
    }

    const persisted = await tagService.replaceTagsForCategories(
      sourceId,
      sourceType,
      workspaceId,
      mergedCategories,
      generated,
      configKey,
    );

    return { jobId, sourceId, sourceType, tags: persisted };
  }

  private handleJobCompleted(job: Bull.Job<TagGenerationJobData>, result: TagGenerationResult): void {
    const { sourceType } = job.data;
    this.emit(`generation:completed:${sourceType}`, result);
  }

  private handleJobFailed(job: Bull.Job<TagGenerationJobData>, err: Error): void {
    const { jobId, sourceId, sourceType } = job.data;
    const error: TagGenerationError = { jobId, sourceId, sourceType, error: err.message };

    logger.error(`[TAG][PIPELINE] Job ${jobId} failed for ${sourceType}/${sourceId}:`, err);

    this.emit(`generation:failed:${sourceType}`, error);
  }

  private mergeNewTagsIntoCategories(
    categories: Record<string, CategoryConfig>,
    generated: GeneratedTag[],
  ): { categories: Record<string, CategoryConfig>; changed: boolean } {
    let changed = false;
    const updated: Record<string, CategoryConfig> = { ...categories };

    for (const item of generated) {
      const categoryConfig = updated[item.category];
      if (!categoryConfig?.is_new_tag_allowed) continue;

      const existingTags = categoryConfig.tags ?? [];
      if (existingTags.includes(item.tag)) continue;

      updated[item.category] = { ...categoryConfig, tags: [...existingTags, item.tag] };
      changed = true;
    }

    return { categories: updated, changed };
  }

  private groupCategoriesByMethod(
    categories: Record<string, CategoryConfig>,
  ): Record<string, Record<string, CategoryConfig>> {
    const byMethod: Record<string, Record<string, CategoryConfig>> = {};
    for (const [category, categoryConfig] of Object.entries(categories)) {
      byMethod[categoryConfig.method] = byMethod[categoryConfig.method] ?? {};
      byMethod[categoryConfig.method][category] = categoryConfig;
    }
    return byMethod;
  }
}

export const tagGenerationPipeline = new TagGenerationPipeline();
