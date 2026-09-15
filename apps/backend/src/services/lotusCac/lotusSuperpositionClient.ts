import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import type { LotusCacContext, ResolvedLotusConfig } from './types';

type CacheEntry = {
  value: ResolvedLotusConfig;
  expiresAt: number;
};

/** In-process cache only — not configurable via env. */
const CACHE_TTL_MS = 30_000;

/**
 * Superposition HTTP client bound to the lotus workspace.
 * Reuses shared endpoint/token/org/timeout; only lotus workspace id differs.
 * No OpenFeature.
 */
export class LotusSuperpositionClient {
  private static instance: LotusSuperpositionClient | null = null;

  private readonly endpoint: string;
  private readonly token: string;
  private readonly orgId: string;
  private readonly workspaceId: string;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  private constructor() {
    const cfg = config.superposition;
    this.endpoint = cfg.endpoint.replace(/\/$/, '');
    this.token = cfg.token;
    this.orgId = cfg.orgId;
    this.workspaceId = cfg.lotusWorkspaceId;
    this.timeoutMs = cfg.timeout;
  }

  public static getInstance(): LotusSuperpositionClient {
    if (!LotusSuperpositionClient.instance) {
      LotusSuperpositionClient.instance = new LotusSuperpositionClient();
    }
    return LotusSuperpositionClient.instance;
  }

  public async resolveConfig(context: LotusCacContext = {}): Promise<ResolvedLotusConfig> {
    const cacheKey = this.buildCacheKey(context);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const resolveContext: LotusCacContext = {};
    for (const [key, value] of Object.entries(context)) {
      if (value === '') continue;
      resolveContext[key] = value;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.endpoint}/config/resolve`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
          'x-org-id': this.orgId,
          'x-workspace': this.workspaceId,
        },
        body: JSON.stringify({ context: resolveContext }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Superposition resolve failed (${response.status}): ${body.slice(0, 300)}`);
      }

      const data = (await response.json()) as ResolvedLotusConfig;
      this.cache.set(cacheKey, {
        value: data,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return data;
    } catch (error) {
      logger.error('[LotusSuperpositionClient] resolveConfig failed', {
        workspaceId: this.workspaceId,
        orgId: this.orgId,
        context,
        error,
      });

      if (cached) {
        logger.warn('[LotusSuperpositionClient] Returning stale cache after error');
        return cached.value;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  public clearCache(): void {
    this.cache.clear();
  }

  private buildCacheKey(context: LotusCacContext): string {
    return JSON.stringify(
      Object.entries(context)
        .filter(([, v]) => v !== '')
        .sort(([a], [b]) => a.localeCompare(b))
    );
  }
}

export const lotusSuperpositionClient = LotusSuperpositionClient.getInstance();
