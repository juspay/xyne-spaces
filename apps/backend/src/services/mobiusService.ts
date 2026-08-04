// Mobius outbound API client.
// Fetches the current release state (status / stagger percent) to enrich a live
// release-update activity, and the full event history to backfill a ticket when
// its mobiusReleaseId is linked after events have already happened.
//
// Confirmed with the Mobius team (Eakanath):
//   - Auth: shared key in the `x-api-key` header (changes per environment).
//   - Current release state: GET /api/v2/release/{mobiusReleaseId}
//       response contains `status` and `staggerPercent` (plus much more).
//   - Event log (paginated): GET /api/v1/eventLog/{mobiusReleaseId}?offset=N
//   - Base URL is environment-specific and comes from config (MOBIUS_API_BASE_URL),
//     not hard-coded. Prod is reached via a dedicated external ingress (Xyne runs
//     on GCP and can't hit the pomerium-fronted internal hosts); envs differ.

import axios from 'axios';
import { config as appConfig } from '@/config/env';
import { logger } from '@/utils/logger';

/**
 * Current release state from GET /api/v2/release/{mobiusReleaseId}.
 * Kept permissive: Mobius returns a large object; we only rely on `status` and
 * `staggerPercent`, everything else is passthrough.
 */
export interface MobiusReleaseState {
  status?: string;
  staggerPercent?: number;
  releaseAction?: string;
  product?: string;
  newVersion?: string;
  [key: string]: unknown;
}

/**
 * One entry from the Mobius event log / history. Shape mirrors the samples the
 * Mobius team shared: { event_name, id, release_id, result, date_created, ... }.
 */
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
  // Max event-log pages to walk before giving up — a backstop against an API
  // that never returns an empty page. 50 is far beyond any real release's log.
  private static readonly EVENT_LOG_PAGE_CAP = 50;

  private get baseUrl(): string {
    return appConfig.mobius.apiBaseUrl || '';
  }

  private get apiKey(): string {
    return appConfig.mobius.apiKey || '';
  }

  // Optional raw Cookie header — lets us reach a cookie-fronted (Pomerium SSO)
  // Mobius ingress where x-api-key isn't the gateway auth (e.g. local testing).
  private get apiCookie(): string {
    return appConfig.mobius.apiCookie || '';
  }

  get isConfigured(): boolean {
    // A base URL plus at least one credential (app key OR gateway cookie).
    return this.baseUrl.trim().length > 0 && (this.apiKey.trim().length > 0 || this.apiCookie.trim().length > 0);
  }

  /**
   * Validate + normalize a release id and confirm the client is configured.
   * Returns the trimmed id, or null (with a warning) when we can't/shouldn't call.
   */
  private ready(mobiusReleaseId: string, action: string): string | null {
    const releaseId = mobiusReleaseId?.trim();
    if (!releaseId) {
      logger.warn(`[Mobius] ${action} called without a mobiusReleaseId`);
      return null;
    }
    if (!this.isConfigured) {
      logger.warn(`[Mobius] MOBIUS_API_BASE_URL / MOBIUS_API_KEY not configured, skipping ${action}`);
      return null;
    }
    return releaseId;
  }

  /** Authenticated GET against the Mobius API. Returns null on any failure. */
  private async authGet<T>(url: string, releaseId: string, action: string): Promise<T | null> {
    try {
      logger.info(`[Mobius] ${action}`, { releaseId, url });
      // Send whichever credential(s) are configured: the app-level x-api-key
      // (prod ingress) and/or a raw Cookie for a gateway-fronted ingress.
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

  /**
   * Fetch the current release state for a mobiusReleaseId. Returns null if the
   * client is not configured or the call fails, so callers can degrade gracefully.
   */
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

  /**
   * Fetch the full event log for a release, oldest→newest. Used to backfill a
   * ticket's activity feed when a mobiusReleaseId is linked *after* events have
   * already occurred.
   *
   * Endpoint (confirmed with Mobius): GET /api/v1/eventLog/{id}?offset=N. The
   * response is `{ count, results: [...] }` where `count` is the total event
   * count and each page holds up to 20 events. We walk pages (advancing the
   * offset by the events returned) until we've collected `count` of them — or a
   * page comes back empty, as a fallback if `count` is ever absent — then return
   * the merged, chronologically-ordered list. Returns null only when the very
   * first page fails; a mid-walk failure keeps whatever was gathered so backfill
   * still surfaces the earlier events.
   */
  async getReleaseHistory(mobiusReleaseId: string): Promise<MobiusReleaseHistoryEvent[] | null> {
    const releaseId = this.ready(mobiusReleaseId, 'event-log fetch');
    if (!releaseId) return null;

    const all: MobiusReleaseHistoryEvent[] = [];
    let offset = 0;
    let firstPageOk = false;

    for (let page = 0; page < MobiusService.EVENT_LOG_PAGE_CAP; page++) {
      const data = await this.authGet<unknown>(
        this.eventLogUrl(releaseId, offset),
        releaseId,
        `Fetch event log (offset ${offset})`,
      );
      if (!data) {
        // First page failed → signal failure; a later page failed → keep partial.
        if (page === 0) return null;
        break;
      }
      firstPageOk = true;
      const events = this.extractEvents(data);
      if (events.length === 0) break; // reached the end of the log
      all.push(...events);
      // Stop once we've pulled the whole log. The envelope's `count` is the
      // authoritative total; the empty-page break above covers a missing count.
      const total = this.extractCount(data);
      if (total !== null && all.length >= total) break;
      offset += events.length; // offset is a record offset
    }

    // Order oldest→newest so the activity feed reads chronologically.
    const ordered = all.sort((a, b) => (a.date_created ?? '').localeCompare(b.date_created ?? ''));
    logger.info('[Mobius] Fetched event log', { releaseId, events: ordered.length });
    return firstPageOk ? ordered : null;
  }

  /** Build the paginated event-log URL: /api/v1/eventLog/{id}?offset=N. */
  private eventLogUrl(releaseId: string, offset: number): string {
    return `${this.baseUrl.replace(/\/$/, '')}/api/v1/eventLog/${encodeURIComponent(releaseId)}?offset=${offset}`;
  }

  /**
   * Pull the event array out of an event-log page. Mobius returns
   * `{ count, results: [...] }`; we also accept a bare array or a couple of
   * other common wrapper keys defensively. An unrecognized shape yields an empty
   * page, which safely terminates pagination.
   */
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

  /** Total event count from the envelope (`{ count, results }`), or null. */
  private extractCount(data: unknown): number | null {
    if (data && typeof data === 'object') {
      const count = (data as Record<string, unknown>).count;
      if (typeof count === 'number') return count;
    }
    return null;
  }
}

export const mobiusService = new MobiusService();
