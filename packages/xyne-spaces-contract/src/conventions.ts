/**
 * Wire conventions shared by the API layer and the SDK.
 */

export const API_VERSION = 'v1';

export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 200;

/** Cap on `?ids=` batch reads, which map to the catalog's `*ByIds` queries. */
export const BATCH_IDS_MAX = 100;

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotent-Replayed';
export const REQUEST_ID_HEADER = 'X-Request-Id';

export interface PageInfo {
  /** Opaque cursor for the next page; absent when there are no more rows. */
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}

export interface ListResponse<T> {
  readonly data: readonly T[];
  readonly pageInfo: PageInfo;
}
