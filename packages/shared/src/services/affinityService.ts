import type { HttpClient } from '../hooks/HttpClientContext.js';

export interface AffinityWeights {
  channelWeights: Record<string, number>;
  userWeights: Record<string, number>;
}

// 1h5m: slightly longer than the 1h backend sync so weights are always fresh on read.
// The 5-minute buffer prevents a thundering herd if the sync job completes just before TTL expires.
const CACHE_TTL_MS = 1 * 60 * 60 * 1000 + 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

export class AffinityService {
  private weights: AffinityWeights = { channelWeights: {}, userWeights: {} };
  private lastFetchedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(private readonly httpClient: HttpClient) {}

  private async fetch(): Promise<void> {
    try {
      const data = await this.httpClient.get<AffinityWeights>('/users/me/affinity', {
        timeout: FETCH_TIMEOUT_MS,
      });
      this.weights = data;
    } catch {
      // Graceful degradation — keep empty weights, Cmd+K falls back to text match
    } finally {
      // Always update lastFetchedAt so a Vespa outage doesn't cause a retry
      // storm on every keystroke — wait the full TTL before trying again.
      this.lastFetchedAt = Date.now();
      this.inflight = null;
    }
  }

  prefetch(): Promise<void> {
    const stale = Date.now() - this.lastFetchedAt > CACHE_TTL_MS;
    if (!stale) return Promise.resolve();
    if (this.inflight) return this.inflight;
    this.inflight = this.fetch();
    return this.inflight;
  }

  getChannelWeight(channelId: string): number {
    const stale = Date.now() - this.lastFetchedAt > CACHE_TTL_MS;
    if (stale && !this.inflight) {
      this.inflight = this.fetch();
    }
    return this.weights.channelWeights[channelId] ?? 0;
  }

  getUserWeight(userId: string): number {
    // Mirror getChannelWeight: refetch in the background once the cache is stale,
    // so @-mention (user) affinity refreshes on its own, not just on channel reads.
    const stale = Date.now() - this.lastFetchedAt > CACHE_TTL_MS;
    if (stale && !this.inflight) {
      this.inflight = this.fetch();
    }
    return this.weights.userWeights[userId] ?? 0;
  }
}
