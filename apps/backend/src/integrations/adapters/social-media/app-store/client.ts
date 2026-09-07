import jwt from 'jsonwebtoken';
import type { ExternalSource } from '@prisma/client';
import { decrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import {
  APP_STORE_API_BASE,
  APP_STORE_JWT_AUDIENCE,
  APP_STORE_PAGE_LIMIT,
  APP_STORE_REQUEST_TIMEOUT_MS,
  APP_STORE_TOKEN_REFRESH_MARGIN_SECONDS,
  APP_STORE_TOKEN_TTL_SECONDS,
} from './constants';

const TAG = '[AppStoreClient]';

export interface AppStoreCredentials {
  issuerId: string;
  keyId: string;
  privateKey: string;
}

export type AppStoreResponseState = 'PUBLISHED' | 'PENDING_PUBLISH';

export interface NormalizedAppStoreReview {
  reviewId: string;
  reviewerNickname?: string;
  title?: string;
  body: string;
  rating?: number;
  territory?: string;
  /** Apple's createdDate. IMMUTABLE — never treat this as a modification time. */
  occurredAt: Date;
  developerResponse?: {
    body: string;
    occurredAt: Date;
    state: AppStoreResponseState;
  };
}

export interface ListReviewsResult {
  reviews: NormalizedAppStoreReview[];
  /** True when the page budget ran out before the window was provably covered. */
  truncated: boolean;
  oldestFetchedAt: Date | null;
  pagesFetched: number;
}

export class AppStoreApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'AppStoreApiError';
  }
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

interface AppleResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id: string; type: string } | null }>;
}

interface AppleListPayload {
  data?: AppleResource[];
  included?: AppleResource[];
  links?: { next?: string };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseDate(value: unknown): Date | null {
  const raw = asString(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

export class AppStoreClient {
  private tokenCache = new Map<string, CachedToken>();

  decryptCredentials(encryptedCredentials: string): AppStoreCredentials {
    if (!encryptedCredentials) {
      throw new Error('App Store credentials were removed when this desk was disconnected');
    }
    const parsed = JSON.parse(decrypt(encryptedCredentials)) as Partial<AppStoreCredentials>;
    if (!parsed.issuerId || !parsed.keyId || !parsed.privateKey) {
      throw new Error('App Store credentials are incomplete');
    }
    return parsed as AppStoreCredentials;
  }

  /** Team-key JWT. Individual keys use `sub` instead of `iss` and are not supported. */
  mintToken(credentials: AppStoreCredentials, cacheKey?: string): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (cacheKey) {
      const cached = this.tokenCache.get(cacheKey);
      if (cached && cached.expiresAtMs > Date.now()) return cached.token;
    }

    const token = jwt.sign(
      {
        iss: credentials.issuerId,
        iat: nowSeconds,
        exp: nowSeconds + APP_STORE_TOKEN_TTL_SECONDS,
        aud: APP_STORE_JWT_AUDIENCE,
      },
      credentials.privateKey,
      { algorithm: 'ES256', keyid: credentials.keyId },
    );

    if (cacheKey) {
      this.tokenCache.set(cacheKey, {
        token,
        expiresAtMs:
          Date.now() + (APP_STORE_TOKEN_TTL_SECONDS - APP_STORE_TOKEN_REFRESH_MARGIN_SECONDS) * 1000,
      });
    }
    return token;
  }

  forgetToken(cacheKey: string): void {
    this.tokenCache.delete(cacheKey);
  }

  private async request<T>(
    url: string,
    credentials: AppStoreCredentials,
    init?: { method?: string; body?: unknown; cacheKey?: string },
  ): Promise<T> {
    const response = await fetch(url.startsWith('http') ? url : `${APP_STORE_API_BASE}${url}`, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.mintToken(credentials, init?.cacheKey)}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(APP_STORE_REQUEST_TIMEOUT_MS),
    });

    this.logRateLimit(response.headers.get('x-rate-limit'));

    if (!response.ok) {
      // Surface Apple's own message: responseBody has no documented length cap, so its 4xx text is
      // the only authority on why a reply was rejected.
      const detail = await this.extractError(response);
      if (init?.cacheKey && response.status === 401) this.forgetToken(init.cacheKey);
      throw new AppStoreApiError(response.status, detail);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async extractError(response: Response): Promise<string> {
    try {
      const payload = (await response.json()) as {
        errors?: Array<{ detail?: string; title?: string }>;
      };
      const first = payload.errors?.[0];
      return first?.detail ?? first?.title ?? `App Store Connect returned ${response.status}`;
    } catch {
      return `App Store Connect returned ${response.status}`;
    }
  }

  /** Apple's documented limits are examples that vary, so read them rather than assuming a number. */
  private logRateLimit(header: string | null): void {
    if (!header) return;
    const limit = Number(/user-hour-lim:(\d+)/.exec(header)?.[1]);
    const remaining = Number(/user-hour-rem:(\d+)/.exec(header)?.[1]);
    if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return;
    if (remaining < limit * 0.2) {
      logger.warn(`${TAG} App Store Connect quota is running low`, { limit, remaining });
    }
  }

  /** Resolves a bundle id to Apple's numeric app id. Doubles as credential validation. */
  async resolveApp(
    credentials: AppStoreCredentials,
    bundleId: string,
  ): Promise<{ appId: string; name: string } | null> {
    const payload = await this.request<AppleListPayload>(
      `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=name,bundleId`,
      credentials,
    );
    const app = payload.data?.[0];
    if (!app) return null;
    return { appId: app.id, name: asString(app.attributes?.name) ?? bundleId };
  }

  /**
   * Pages newest-first over customerReviews. The filter key IS the sort key (createdDate), so
   * stopping once a whole page falls below the cutoff is sound. Stopping because the page budget
   * ran out is NOT — the caller must not treat that run as having covered the window.
   */
  async listReviews(
    source: ExternalSource,
    cutoff: Date | null,
    maxPages: number,
  ): Promise<ListReviewsResult> {
    const credentials = this.decryptCredentials(source.credentials);
    const appId = source.externalIdentifier;
    if (!appId) throw new Error('App Store source is missing its Apple app id');

    const reviews: NormalizedAppStoreReview[] = [];
    let url: string | undefined =
      `/v1/apps/${encodeURIComponent(appId)}/customerReviews` +
      `?sort=-createdDate&limit=${APP_STORE_PAGE_LIMIT}&include=response` +
      `&fields[customerReviews]=rating,title,body,reviewerNickname,createdDate,territory`;
    let pagesFetched = 0;
    let oldestFetchedAt: Date | null = null;
    // Coverage is only proven by reaching the cutoff or exhausting the list — never assumed.
    let reachedCutoff = false;

    while (url && pagesFetched < maxPages) {
      const payload: AppleListPayload = await this.request<AppleListPayload>(url, credentials, {
        cacheKey: source.id,
      });
      pagesFetched += 1;

      const responsesById = new Map<string, AppleResource>();
      for (const item of payload.included ?? []) {
        if (item.type === 'customerReviewResponses') responsesById.set(item.id, item);
      }

      let parsedOnPage = 0;
      let belowCutoffOnPage = 0;
      let unparsableOnPage = 0;
      for (const item of payload.data ?? []) {
        const review = this.normalizeReview(item, responsesById);
        if (!review) {
          unparsableOnPage += 1;
          continue;
        }
        parsedOnPage += 1;
        if (!oldestFetchedAt || review.occurredAt < oldestFetchedAt) {
          oldestFetchedAt = review.occurredAt;
        }
        if (cutoff && review.occurredAt.getTime() < cutoff.getTime()) {
          // Kept deliberately: the caller inspects below-cutoff items to detect publication lag
          // that exceeds the margin, which is otherwise silent and unrecoverable.
          belowCutoffOnPage += 1;
        }
        reviews.push(review);
      }

      if (unparsableOnPage > 0) {
        logger.warn(`${TAG} Skipped reviews that could not be parsed`, {
          sourceId: source.id,
          count: unparsableOnPage,
        });
      }

      // Coverage is proven only when every review we could actually read on this page fell below
      // the cutoff. Items we failed to parse prove nothing about how far back we have reached, so
      // they must never count toward that decision — treating them as "below cutoff" would end
      // paging early, advance the cursor over un-fetched reviews, and lose them permanently
      // (createdDate is immutable, so nothing below the cursor ever resurfaces).
      if (parsedOnPage > 0 && belowCutoffOnPage === parsedOnPage) {
        reachedCutoff = true;
        break;
      }
      url = payload.links?.next;
      if (!url) reachedCutoff = true;
    }

    return { reviews, truncated: !reachedCutoff, oldestFetchedAt, pagesFetched };
  }

  private normalizeReview(
    item: AppleResource,
    responsesById: Map<string, AppleResource>,
  ): NormalizedAppStoreReview | null {
    const createdAt = parseDate(item.attributes?.createdDate);
    // A review can carry a title and no body. Falling back keeps it a real ticket instead of a
    // silently dropped one, and keeps whole pages from looking unparsable.
    const rawBody = asString(item.attributes?.body);
    const title = asString(item.attributes?.title);
    const body = rawBody ?? title;
    if (!item.id || !createdAt || !body) return null;

    const responseId = item.relationships?.response?.data?.id;
    const responseResource = responseId ? responsesById.get(responseId) : undefined;
    const responseBody = asString(responseResource?.attributes?.responseBody);
    const responseAt = parseDate(responseResource?.attributes?.lastModifiedDate);

    const rating = Number(item.attributes?.rating);
    return {
      reviewId: item.id,
      reviewerNickname: asString(item.attributes?.reviewerNickname),
      // Cleared when it was promoted into the body, so the transformer does not print it twice.
      title: rawBody ? title : undefined,
      body,
      rating: Number.isFinite(rating) ? rating : undefined,
      territory: asString(item.attributes?.territory),
      occurredAt: createdAt,
      ...(responseBody && responseAt
        ? {
            developerResponse: {
              body: responseBody,
              occurredAt: responseAt,
              state:
                asString(responseResource?.attributes?.state) === 'PENDING_PUBLISH'
                  ? ('PENDING_PUBLISH' as const)
                  : ('PUBLISHED' as const),
            },
          }
        : {}),
    };
  }

  /** Current response for one review, used to reconcile PENDING_PUBLISH and to guard overwrites. */
  async getReviewResponse(
    source: ExternalSource,
    reviewId: string,
  ): Promise<{ body: string; occurredAt: Date; state: AppStoreResponseState } | null> {
    const credentials = this.decryptCredentials(source.credentials);
    try {
      const payload = await this.request<{ data?: AppleResource }>(
        `/v1/customerReviews/${encodeURIComponent(reviewId)}/response`,
        credentials,
        { cacheKey: source.id },
      );
      const body = asString(payload.data?.attributes?.responseBody);
      const occurredAt = parseDate(payload.data?.attributes?.lastModifiedDate);
      if (!body || !occurredAt) return null;
      return {
        body,
        occurredAt,
        state:
          asString(payload.data?.attributes?.state) === 'PENDING_PUBLISH'
            ? 'PENDING_PUBLISH'
            : 'PUBLISHED',
      };
    } catch (error) {
      if (error instanceof AppStoreApiError && error.status === 404) return null;
      throw error;
    }
  }

  /** Create-or-overwrite. Apple has no PATCH, and deleting first would drop the live response. */
  async reply(
    source: ExternalSource,
    reviewId: string,
    body: string,
  ): Promise<{ occurredAt: Date; state: AppStoreResponseState }> {
    const credentials = this.decryptCredentials(source.credentials);
    const payload = await this.request<{ data?: AppleResource }>(
      '/v1/customerReviewResponses',
      credentials,
      {
        method: 'POST',
        cacheKey: source.id,
        body: {
          data: {
            type: 'customerReviewResponses',
            attributes: { responseBody: body },
            relationships: {
              review: { data: { type: 'customerReviews', id: reviewId } },
            },
          },
        },
      },
    );
    return {
      occurredAt: parseDate(payload.data?.attributes?.lastModifiedDate) ?? new Date(),
      state:
        asString(payload.data?.attributes?.state) === 'PUBLISHED' ? 'PUBLISHED' : 'PENDING_PUBLISH',
    };
  }
}

export const appStoreClient = new AppStoreClient();
