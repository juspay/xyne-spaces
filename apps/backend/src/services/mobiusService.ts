// Mobius outbound API client: fetches release state (enrichment) and event
// history (backfill). No-ops when not configured so callers degrade gracefully.

import axios from 'axios';
import { config as appConfig } from '@/config/env';
import { logger } from '@/utils/logger';

// GET /api/v2/release/{id}. Permissive: we only rely on status/staggerPercent.
export interface MobiusReleaseState {
  status?: string;
  staggerPercent?: number;
  releaseAction?: string;
  product?: string;
  newVersion?: string;
  [key: string]: unknown;
}

// One entry from the Mobius event log.
export interface MobiusReleaseHistoryEvent {
  id?: string;
  event_name?: string;
  release_id?: string;
  result?: unknown;
  date_created?: string;
  last_updated?: string;
  [key: string]: unknown;
}

class MobiusService {
  // Backstop against an API that never returns an empty page.
  private static readonly EVENT_LOG_PAGE_CAP = 50;

  private get baseUrl(): string {
    return appConfig.mobius.apiBaseUrl || '';
  }

  private get apiKey(): string {
    return appConfig.mobius.apiKey || '';
  }

  private get apiCookie(): string {
    return appConfig.mobius.apiCookie || '';
  }

  get isConfigured(): boolean {
    return this.baseUrl.trim().length > 0 && (this.apiKey.trim().length > 0 || this.apiCookie.trim().length > 0);
  }

  private ready(mobiusReleaseId: string, action: string): string | null {
    const releaseId = mobiusReleaseId?.trim();
    if (!releaseId) {
      logger.warn(`[Mobius] ${action} called without a mobiusReleaseId`);
      return null;
    }
    if (!this.isConfigured) {
      logger.warn(`[Mobius] outbound API not configured, skipping ${action}`);
      return null;
    }
    return releaseId;
  }

  private async authGet<T>(url: string, releaseId: string, action: string): Promise<T | null> {
    try {
      logger.info(`[Mobius] ${action}`, { releaseId, url });
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.apiKey) headers['x-api-key'] = this.apiKey;
      if (this.apiCookie) headers['cookie'] = this.apiCookie;
      const response = await axios.get<T>(url, { headers, timeout: 10000 });
      return response.data;
    } catch (error) {
      logger.error(`[Mobius] ${action} failed`, { releaseId, error });
      return null;
    }
  }

  private releaseUrl(releaseId: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}/api/v2/release/${encodeURIComponent(releaseId)}`;
  }

  async getReleaseState(mobiusReleaseId: string): Promise<MobiusReleaseState | null> {
    const releaseId = this.ready(mobiusReleaseId, 'release-state fetch');
    if (!releaseId) return null;

    const state = await this.authGet<MobiusReleaseState>(
      this.releaseUrl(releaseId),
      releaseId,
      'Fetch release state',
    );
    if (state) {
      logger.info('[Mobius] Fetched release state', {
        releaseId,
        status: state.status,
        staggerPercent: state.staggerPercent,
      });
    }
    return state;
  }

  // Fetch the full event log (oldest→newest). Walks pages until `count` is
  // reached or a page is empty. Returns null only if the first page fails.
  async getReleaseHistory(mobiusReleaseId: string): Promise<MobiusReleaseHistoryEvent[] | null> {
    const releaseId = this.ready(mobiusReleaseId, 'event-log fetch');
    if (!releaseId) return null;

    const all: MobiusReleaseHistoryEvent[] = [];
    let offset = 0;

    for (let page = 0; page < MobiusService.EVENT_LOG_PAGE_CAP; page++) {
      const data = await this.authGet<unknown>(
        this.eventLogUrl(releaseId, offset),
        releaseId,
        `Fetch event log (offset ${offset})`,
      );
      if (!data) {
        if (page === 0) return null; // first page failed → signal failure
        break; // later page failed → keep partial
      }
      const events = this.extractEvents(data);
      if (events.length === 0) break;
      all.push(...events);
      const total = this.extractCount(data);
      if (total !== null && all.length >= total) break;
      offset += events.length;
    }

    const ordered = all.sort((a, b) => (a.date_created ?? '').localeCompare(b.date_created ?? ''));
    logger.info('[Mobius] Fetched event log', { releaseId, events: ordered.length });
    return ordered;
  }

  private eventLogUrl(releaseId: string, offset: number): string {
    return `${this.baseUrl.replace(/\/$/, '')}/api/v1/eventLog/${encodeURIComponent(releaseId)}?offset=${offset}`;
  }

  // Mobius returns `{ count, results }`; also accept a bare array or common keys.
  private extractEvents(data: unknown): MobiusReleaseHistoryEvent[] {
    if (Array.isArray(data)) return data as MobiusReleaseHistoryEvent[];
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      for (const key of ['results', 'data', 'events', 'eventLog', 'event_log']) {
        if (Array.isArray(obj[key])) return obj[key] as MobiusReleaseHistoryEvent[];
      }
    }
    return [];
  }

  private extractCount(data: unknown): number | null {
    if (data && typeof data === 'object') {
      const count = (data as Record<string, unknown>).count;
      if (typeof count === 'number') return count;
    }
    return null;
  }
}

export const mobiusService = new MobiusService();
