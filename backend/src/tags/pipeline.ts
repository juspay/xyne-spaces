import Bull from 'bull';
import { EventEmitter } from 'node:events';
import { config as appConfig } from '@/config/env';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { tagRepository } from '@/database/repositories/tagRepository';
import { generateLlmTags } from './generators/llm';
import { TagsConfigShapeSchema } from './schema';
import { tagService } from './service';
import type {
  CategoryConfig,
  ContextBuilderFn,
  GeneratedTag,
  GeneratorFn,
  TagGenerationError,
  TagGenerationJobData,
  TagGenerationResult,
} from './types';

export type GeneratorMethod = 'llm';

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

  async addGenerationJob(data: {
    sourceId: string;
    sourceType: string;
    workspaceId: string;
    configKey: string;
  }): Promise<string> {
    if (!appConfig.enableTagGenerationPipeline) {
      throw new Error('[TAG][PIPELINE] Disabled by ENABLE_TAG_GENERATION_PIPELINE=false');
    }
    if (!this.queue) {
      throw new Error('[TAG][PIPELINE] Queue not initialized — call initialize() first');
    }
    if (!this.contextBuilders.has(data.sourceType)) {
      throw new Error(`[TAG][PIPELINE] No context builder registered for sourceType "${data.sourceType}"`);
    }

    const jobId = `tag-gen-${data.sourceType}-${data.sourceId}-${data.configKey}`;
    await this.queue.add('generate-tags', { jobId, ...data }, { jobId });

    return jobId;
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

    const configRow = await tagRepository.getActiveConfigByKey(configKey);
    if (!configRow) {
      throw new Error(`[TAG][PIPELINE] No active TagsConfig found for configKey "${configKey}"`);
    }

    const parsedConfig = TagsConfigShapeSchema.safeParse(configRow.config);
    if (!parsedConfig.success) {
      throw new Error(`[TAG][PIPELINE] Invalid TagsConfig for configKey "${configKey}"`);
    }

    const { categories } = parsedConfig.data;

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
      await tagService.updateConfig(
        configKey,
        {
          ...parsedConfig.data,
          categories: mergedCategories,
        },
        undefined,
      );
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
