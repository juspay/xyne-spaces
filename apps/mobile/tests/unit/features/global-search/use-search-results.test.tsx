/**
 * The real `useSearchResults` and request builder over a mocked HTTP layer, so what
 * is asserted is the signal and URL that `apiGet` actually receives.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';

import { useSearchResults } from '@/src/features/global-search/hooks/use-search-results';
import {
  buildSearchRequest,
  type SearchRequest,
} from '@/src/features/global-search/utils/search-request';
import type { GlobalSearchTab } from '@/src/features/global-search/utils/search-tabs';
import { apiGet } from '@/src/services/apiClient';

jest.mock('@/src/services/apiClient', () => ({ apiGet: jest.fn() }));

type Call = {
  path: string;
  signal: AbortSignal;
  respond: (titles: string[]) => void;
  fail: (error: unknown) => void;
};

const mockedApiGet = apiGet as jest.MockedFunction<typeof apiGet>;
let calls: Call[] = [];

function requestFor(query: string, tab: GlobalSearchTab = 'messages'): SearchRequest {
  const request = buildSearchRequest({ tab, query, chips: [], onlyMyChannels: false, scope: null });
  if (!request) throw new Error('expected a request');
  return request;
}

function callFor(query: string): Call {
  const call = calls.find(candidate => candidate.path.includes(`q=${query}&`));
  if (!call) throw new Error(`no request was sent for "${query}"`);
  return call;
}

function renderSearch(initial: SearchRequest | null) {
  // A fresh client per test, so nothing is served from an earlier test's cache.
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  return renderHook(({ request }: { request: SearchRequest | null }) => useSearchResults(request), {
    wrapper,
    initialProps: { request: initial },
  });
}

function titles(result: { current: ReturnType<typeof useSearchResults> }): string[] {
  return result.current.data.map(row => row.title);
}

beforeEach(() => {
  calls = [];
  const respondWith = (path: string, options?: { signal?: AbortSignal }): Promise<unknown> =>
    new Promise<unknown>((resolve, reject) => {
      calls.push({
        path,
        signal: options?.signal as AbortSignal,
        respond: rows =>
          resolve({
            success: true,
            data: {
              results: rows.map(title => ({ id: title, title })),
              totalCount: rows.length,
              offset: 0,
              limit: 25,
            },
          }),
        fail: reject,
      });
    });
  mockedApiGet.mockImplementation(respondWith as typeof apiGet);
});

describe('useSearchResults', () => {
  describe('stale requests', () => {
    it('aborts the request a newer query supersedes', async () => {
      const { rerender } = renderSearch(requestFor('alpha'));
      await waitFor(() => expect(calls).toHaveLength(1));

      rerender({ request: requestFor('beta') });
      await waitFor(() => expect(calls).toHaveLength(2));

      expect(callFor('alpha').signal.aborted).toBe(true);
      expect(callFor('beta').signal.aborted).toBe(false);
    });

    it('aborts the request when the search is cleared', async () => {
      const { rerender } = renderSearch(requestFor('alpha'));
      await waitFor(() => expect(calls).toHaveLength(1));

      rerender({ request: null });

      await waitFor(() => expect(callFor('alpha').signal.aborted).toBe(true));
    });

    it('aborts the request when the screen goes away', async () => {
      const { unmount } = renderSearch(requestFor('alpha'));
      await waitFor(() => expect(calls).toHaveLength(1));

      unmount();

      await waitFor(() => expect(callFor('alpha').signal.aborted).toBe(true));
    });

    it('never shows a late response for a query that was replaced', async () => {
      const { result, rerender } = renderSearch(requestFor('alpha'));
      await waitFor(() => expect(calls).toHaveLength(1));

      rerender({ request: requestFor('beta') });
      await waitFor(() => expect(calls).toHaveLength(2));

      await act(async () => {
        callFor('alpha').respond(['alpha result']);
      });

      expect(titles(result)).toEqual([]);
      expect(result.current.status).toBe('loading');

      await act(async () => {
        callFor('beta').respond(['beta result']);
      });

      await waitFor(() => expect(result.current.status).toBe('success'));
      expect(titles(result)).toEqual(['beta result']);
    });

    it('does not report a superseded request as an error', async () => {
      const { result, rerender } = renderSearch(requestFor('alpha'));
      await waitFor(() => expect(calls).toHaveLength(1));

      rerender({ request: requestFor('beta') });
      await waitFor(() => expect(calls).toHaveLength(2));

      await act(async () => {
        callFor('alpha').fail(new Error('Request aborted'));
      });

      expect(result.current.status).toBe('loading');
      expect(result.current.error).toBeNull();
    });
  });

  describe('previous results', () => {
    it('stay on screen while the next query loads', async () => {
      const { result, rerender } = renderSearch(requestFor('alpha'));
      await waitFor(() => expect(calls).toHaveLength(1));
      await act(async () => {
        callFor('alpha').respond(['alpha result']);
      });
      await waitFor(() => expect(result.current.status).toBe('success'));

      rerender({ request: requestFor('beta') });

      expect(result.current.status).toBe('loading');
      expect(titles(result)).toEqual(['alpha result']);
    });

    it('are dropped when the search is cleared', async () => {
      const { result, rerender } = renderSearch(requestFor('alpha'));
      await waitFor(() => expect(calls).toHaveLength(1));
      await act(async () => {
        callFor('alpha').respond(['alpha result']);
      });
      await waitFor(() => expect(result.current.status).toBe('success'));

      rerender({ request: null });

      expect(result.current.status).toBe('idle');
      expect(titles(result)).toEqual([]);
    });

    it('are not carried into another category', async () => {
      const { result, rerender } = renderSearch(requestFor('alpha', 'messages'));
      await waitFor(() => expect(calls).toHaveLength(1));
      await act(async () => {
        callFor('alpha').respond(['a message']);
      });
      await waitFor(() => expect(result.current.status).toBe('success'));

      rerender({ request: requestFor('alpha', 'tickets') });

      expect(result.current.status).toBe('loading');
      expect(titles(result)).toEqual([]);
    });
  });

  describe('idle', () => {
    it('sends nothing when there is no request', () => {
      const { result } = renderSearch(null);

      expect(result.current.status).toBe('idle');
      expect(calls).toHaveLength(0);
    });
  });

  describe('failures', () => {
    it('surfaces the error instead of an empty list', async () => {
      const { result } = renderSearch(requestFor('alpha'));
      await waitFor(() => expect(calls).toHaveLength(1));

      await act(async () => {
        callFor('alpha').fail(Object.assign(new Error('boom'), { statusCode: 503 }));
      });

      await waitFor(() => expect(result.current.status).toBe('error'));
      expect(result.current.error).toMatchObject({ kind: 'server', retryable: true });
      // No silent retries — the error state offers one.
      expect(calls).toHaveLength(1);
    });

    it('sends the same query again on retry', async () => {
      const { result } = renderSearch(requestFor('alpha'));
      await waitFor(() => expect(calls).toHaveLength(1));
      await act(async () => {
        callFor('alpha').fail(Object.assign(new Error('timed out'), { code: 'MTLS_TIMEOUT' }));
      });
      await waitFor(() => expect(result.current.error?.kind).toBe('timeout'));

      act(() => result.current.retry());
      await waitFor(() => expect(calls).toHaveLength(2));
      await act(async () => {
        calls[1]?.respond(['alpha result']);
      });

      await waitFor(() => expect(result.current.status).toBe('success'));
      expect(titles(result)).toEqual(['alpha result']);
    });
  });
});
