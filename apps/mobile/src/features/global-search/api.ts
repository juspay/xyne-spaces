import { apiGet } from '@/src/services/apiClient';
import type { VespaSearchResponse, VespaSearchResultsPage } from '@/src/types/search';
import { normalizeVespaSearchResponseData } from '@/src/utils/search';
import { toSearchParams, type SearchRequest } from './utils/search-request';

const SEARCH_TIMEOUT_MS = 15_000;

/** One page of Vespa hits. The signal reaches the native socket on abort. */
export async function fetchSearchResultsPage(
  request: SearchRequest,
  offset: number,
  signal: AbortSignal,
): Promise<VespaSearchResultsPage> {
  const queryString = new URLSearchParams(toSearchParams(request, { offset })).toString();

  const response = await apiGet<VespaSearchResponse>(`/vespaSearch?${queryString}`, {
    signal,
    timeoutMs: SEARCH_TIMEOUT_MS,
  });

  if (!response.success || !response.data) {
    throw new Error(response.error || 'Search request failed');
  }

  return normalizeVespaSearchResponseData(response.data);
}

/** Convenience for single-page callers / tests. */
export async function fetchSearchResults(
  request: SearchRequest,
  signal: AbortSignal,
): Promise<VespaSearchResultsPage['results']> {
  const page = await fetchSearchResultsPage(request, 0, signal);
  return page.results;
}

export type SearchErrorKind =
  /** Request did not answer inside the deadline. */
  | 'timeout'
  /** Transport failed — offline, DNS, TLS, socket. */
  | 'network'
  /** The device's own request queue is saturated — nothing reached the network. */
  | 'busy'
  /** Server answered with a non-2xx. */
  | 'server'
  | 'unknown';

export type SearchError = {
  kind: SearchErrorKind;
  /** Safe to show a user. */
  message: string;
  statusCode?: number;
  /** True when trying the same query again is worth offering. */
  retryable: boolean;
};

export function toSearchError(error: unknown): SearchError {
  const code = readField(error, 'code');

  if (
    (error instanceof Error && error.name === 'RequestTimeoutError') ||
    code === 'MTLS_TIMEOUT' ||
    code === 'ECONNABORTED'
  ) {
    return { kind: 'timeout', message: 'Search took too long to respond.', retryable: true };
  }

  if (code === 'MTLS_BUSY') {
    return { kind: 'busy', message: 'Too many requests at once. Try again.', retryable: true };
  }

  const statusCode = readField(error, 'statusCode');
  if (typeof statusCode === 'number' && statusCode > 0) {
    if (statusCode >= 500) {
      return {
        kind: 'server',
        message: 'Search is temporarily unavailable.',
        statusCode,
        retryable: true,
      };
    }
    const forbidden = statusCode === 401 || statusCode === 403;
    return {
      kind: 'server',
      message: forbidden ? 'You are not allowed to search this.' : 'Search request was rejected.',
      statusCode,
      retryable: false,
    };
  }

  if (error instanceof Error && NETWORK_MESSAGE.test(error.message)) {
    return { kind: 'network', message: 'No connection. Check your network.', retryable: true };
  }

  return { kind: 'unknown', message: 'Something went wrong while searching.', retryable: true };
}

const NETWORK_MESSAGE = /network|offline|connection|before receiving an http response/i;

function readField(error: unknown, field: 'code' | 'statusCode'): unknown {
  return typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)[field]
    : undefined;
}
