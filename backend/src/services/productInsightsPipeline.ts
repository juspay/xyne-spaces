import { logger } from '@/utils/logger';
import { productInsightsService } from './productInsightsService';
import {
  generateSingleClusterThemeWithLlm,
  generateSingleMetaThemeWithLlm,
  type RawClusterInput,
  type ClusterTheme,
  type MetaTheme,
  type ClusterThemeTicketInput,
  type SingleMetaThemeClusterInput,
} from '@/agents/ticket-cleaning-and-themes';
import { buildTicketClusters, type MetaTheme as ClusterMetaTheme } from './productInsightsClustering/fullRecluster';

const THEME_GENERATION_MAX_ATTEMPTS = 3;
const THEME_GENERATION_CONCURRENCY = 3;
const THEME_GENERATION_TIMEOUT_MS = 120_000;
const MAX_TICKETS_PER_CLUSTER_FOR_LLM = 40;
const MAX_TICKET_TITLE_CHARS = 240;
const MAX_TICKET_DESCRIPTION_CHARS = 1200;

export interface ProductInsightsData {
  cluster_themes: Record<string, ClusterTheme>;
  meta_themes: MetaTheme[];
  cluster_details: RawClusterInput;
}

export interface ReclusteringFlowParams {
  projectId: string;
  fromTs: number;
  toTs: number;
  insightsPath?: string;
}

export interface ReclusteringClusterResult {
  cluster_details: RawClusterInput;
  meta_themes: Array<{ impacted_clusters: string[] }>;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

class TimeoutError extends Error {
  code = 'ETIMEDOUT' as const;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new TimeoutError(`[ProductInsightsPipeline] Timed out after ${timeoutMs}ms: ${operation}`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function trimValue(value: string | undefined, maxLength: number): string {
  return (value ?? '').trim().slice(0, maxLength);
}

async function runWithRetry<T>(
  operation: string,
  runner: () => Promise<T>,
  maxAttempts: number = THEME_GENERATION_MAX_ATTEMPTS,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runner();
    } catch (error) {
      lastError = normalizeError(error);
      logger.warn('[ProductInsightsPipeline] LLM operation attempt failed', {
        operation,
        attempt,
        maxAttempts,
        error: lastError.message,
      });
    }
  }

  throw lastError || new Error(`[ProductInsightsPipeline] LLM operation failed: ${operation}`);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function buildClusterPromptTickets(clusterId: string, tickets: ClusterThemeTicketInput[]): ClusterThemeTicketInput[] {
  if (!Array.isArray(tickets) || tickets.length === 0) {
    throw new Error(`[ProductInsightsPipeline] No tickets found for clusterId=${clusterId}`);
  }

  const sortedTickets = [...tickets].sort((a, b) => a.docId.localeCompare(b.docId));
  const limitedTickets = sortedTickets.slice(0, MAX_TICKETS_PER_CLUSTER_FOR_LLM);

  if (sortedTickets.length > limitedTickets.length) {
    logger.info('[ProductInsightsPipeline] Trimming cluster tickets for LLM context', {
      clusterId,
      originalCount: sortedTickets.length,
      usedCount: limitedTickets.length,
      maxTicketsPerCluster: MAX_TICKETS_PER_CLUSTER_FOR_LLM,
    });
  }

  return limitedTickets.map(ticket => {
    const cleanedTitle = trimValue(ticket.title, MAX_TICKET_TITLE_CHARS);
    const cleanedDescription = trimValue(ticket.description, MAX_TICKET_DESCRIPTION_CHARS);

    return {
      docId: ticket.docId,
      title: cleanedTitle || 'Untitled ticket',
      description: cleanedDescription || undefined,
    };
  });
}

function assertClusterThemesComplete(clusterThemes: Record<string, ClusterTheme>, clusterIds: string[]): void {
  for (const clusterId of clusterIds) {
    const theme = clusterThemes[clusterId];
    if (!theme?.theme_title?.trim() || !theme?.theme_description?.trim()) {
      throw new Error(`[ProductInsightsPipeline] Missing cluster theme from LLM for clusterId=${clusterId}`);
    }
  }
}

function buildImpactedClusterThemes(
  impactedClusters: string[],
  clusterThemes: Record<string, ClusterTheme>,
): SingleMetaThemeClusterInput[] {
  return impactedClusters.map(clusterId => {
    const clusterTheme = clusterThemes[clusterId];
    if (!clusterTheme?.theme_title?.trim() || !clusterTheme?.theme_description?.trim()) {
      throw new Error(
        `[ProductInsightsPipeline] Missing cluster theme context for meta-theme generation: clusterId=${clusterId}`,
      );
    }

    return {
      cluster_id: clusterId,
      theme_title: clusterTheme.theme_title,
      theme_description: clusterTheme.theme_description,
    };
  });
}

async function generateClusterThemesStage(clusterDetails: RawClusterInput): Promise<Record<string, ClusterTheme>> {
  const clusterIds = Object.keys(clusterDetails);

  logger.info('[ProductInsightsPipeline] Generating cluster themes', {
    clusterCount: clusterIds.length,
    concurrency: THEME_GENERATION_CONCURRENCY,
  });

  const generated = await mapWithConcurrency(
    clusterIds,
    THEME_GENERATION_CONCURRENCY,
    async (clusterId: string) => {
      const tickets = buildClusterPromptTickets(clusterId, clusterDetails[clusterId] ?? []);

      const clusterTheme = await runWithRetry(
        `cluster-theme:${clusterId}`,
        () =>
          withTimeout(
            generateSingleClusterThemeWithLlm({
              cluster_id: clusterId,
              tickets,
            }),
            THEME_GENERATION_TIMEOUT_MS,
            `cluster-theme:${clusterId}`,
          ),
        THEME_GENERATION_MAX_ATTEMPTS,
      );

      const themeTitle = clusterTheme.theme_title.trim();
      const themeDescription = clusterTheme.theme_description.trim();

      if (!themeTitle || !themeDescription) {
        throw new Error(`[ProductInsightsPipeline] Empty cluster theme fields from LLM for clusterId=${clusterId}`);
      }

      return {
        clusterId,
        theme: {
          theme_title: themeTitle,
          theme_description: themeDescription,
        },
      };
    },
  );

  const clusterThemes: Record<string, ClusterTheme> = {};
  for (const item of generated) {
    clusterThemes[item.clusterId] = item.theme;
  }

  assertClusterThemesComplete(clusterThemes, clusterIds);

  logger.info('[ProductInsightsPipeline] Cluster theme generation completed', {
    generatedCount: Object.keys(clusterThemes).length,
  });

  return clusterThemes;
}

async function generateMetaThemesStage(
  groups: Array<{ impacted_clusters: string[] }>,
  clusterThemes: Record<string, ClusterTheme>,
): Promise<MetaTheme[]> {
  if (groups.length === 0) {
    return [];
  }

  logger.info('[ProductInsightsPipeline] Generating meta themes', {
    groupCount: groups.length,
    concurrency: THEME_GENERATION_CONCURRENCY,
  });

  const metaThemes = await mapWithConcurrency(
    groups,
    THEME_GENERATION_CONCURRENCY,
    async (group, index) => {
      const impactedClusters = Array.isArray(group.impacted_clusters) ? [...group.impacted_clusters] : [];
      if (impactedClusters.length === 0) {
        throw new Error(`[ProductInsightsPipeline] Empty impacted_clusters for meta theme index=${index}`);
      }

      const impactedClusterThemes = buildImpactedClusterThemes(impactedClusters, clusterThemes);

      logger.info('[ProductInsightsPipeline] Generating meta theme', {
        index,
        impactedClusterCount: impactedClusters.length,
      });

      const generatedMetaTheme = await runWithRetry(
        `meta-theme:${index}`,
        () =>
          withTimeout(
            generateSingleMetaThemeWithLlm({
              impacted_clusters: impactedClusters,
              impacted_cluster_themes: impactedClusterThemes,
            }),
            THEME_GENERATION_TIMEOUT_MS,
            `meta-theme:${index}`,
          ),
        THEME_GENERATION_MAX_ATTEMPTS,
      );

      const metaThemeName = generatedMetaTheme.meta_theme.trim();
      const metaThemeDescription = generatedMetaTheme.description.trim();

      if (!metaThemeName || !metaThemeDescription) {
        throw new Error(`[ProductInsightsPipeline] Empty meta theme fields from LLM at index=${index}`);
      }

      logger.info('[ProductInsightsPipeline] Meta theme generated', {
        index,
      });

      return {
        meta_theme: metaThemeName,
        description: metaThemeDescription,
        impacted_clusters: impactedClusters,
      };
    },
  );

  logger.info('[ProductInsightsPipeline] Meta theme generation completed', {
    generatedCount: metaThemes.length,
  });

  return metaThemes;
}

export async function reclusterFullWindow(params: {
  projectId: string;
  fromTs: number;
  toTs: number;
}): Promise<ReclusteringClusterResult> {
  const result = await buildTicketClusters(params.projectId, params.fromTs, params.toTs);
  const metaGroups = result.meta_themes.map((theme: ClusterMetaTheme) => ({
    impacted_clusters: theme.impacted_clusters,
  }));

  return {
    cluster_details: result.cluster_details,
    meta_themes: metaGroups,
  };
}

export async function runReclusteringFlow(
  params: ReclusteringFlowParams,
): Promise<ProductInsightsData | null> {
  const insightsPath = params.insightsPath ?? productInsightsService.getFilePath(params.projectId);
  const startedAt = Date.now();
  logger.info('[ProductInsightsPipeline] Reclustering flow started', {
    projectId: params.projectId,
    fromTs: params.fromTs,
    toTs: params.toTs,
    insightsPath,
  });
  try {
    const reclustered = await reclusterFullWindow({
      projectId: params.projectId,
      fromTs: params.fromTs,
      toTs: params.toTs,
    });

    if (!reclustered.cluster_details || Object.keys(reclustered.cluster_details).length === 0) {
      logger.warn('[ProductInsightsPipeline] Re-cluster produced empty clusters; skipping upload', {
        projectId: params.projectId,
        durationMs: Date.now() - startedAt,
      });
      return null;
    }

    const clusterThemes = await generateClusterThemesStage(reclustered.cluster_details);
    const metaThemes = await generateMetaThemesStage(reclustered.meta_themes, clusterThemes);

    const finalInsights: ProductInsightsData = {
      cluster_details: reclustered.cluster_details,
      cluster_themes: clusterThemes,
      meta_themes: metaThemes,
    };

    logger.info('[ProductInsightsPipeline] Uploading product insights JSON', {
      projectId: params.projectId,
      insightsPath,
      clusterCount: Object.keys(reclustered.cluster_details).length,
      clusterThemeCount: clusterThemes.length,
      metaThemeCount: metaThemes.length,
    });
    await productInsightsService.uploadJsonToPath(insightsPath, finalInsights);

    logger.info('[ProductInsightsPipeline] Reclustering flow completed', {
      projectId: params.projectId,
      insightsPath,
      durationMs: Date.now() - startedAt,
    });
    return finalInsights;
  } catch (error) {
    logger.error('[ProductInsightsPipeline] Reclustering flow failed; skipping upload', {
      projectId: params.projectId,
      insightsPath,
      error: error,
      durationMs: Date.now() - startedAt,
    });
    return null;
  }
}
