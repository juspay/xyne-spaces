import { apiInstance } from './clients/apiClient';

interface FallbackQueryRequest {
  queries: { name: string; args?: unknown }[];
}

interface FallbackQueryResponse {
  results: Array<{
    name: string;
    data: unknown;
  }>;
}

export async function executeFallbackQueries(
  queries: { name: string; args?: unknown }[],
): Promise<FallbackQueryResponse> {
  const response = await apiInstance.post<FallbackQueryResponse>('/zero/query-fallback', {
    queries,
  } as FallbackQueryRequest);

  return response.data;
}

interface PendingFallbackQuery {
  name: string;
  args: unknown;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

// The endpoint takes a list of queries per request, so callers landing in the
// same tick — React effects in one commit do — share a single request.
let pendingQueries: PendingFallbackQuery[] = [];
let flushScheduled = false;

/** Resolve one caller from its slot in the batch response. */
function settle(
  pending: PendingFallbackQuery,
  index: number,
  response: FallbackQueryResponse,
): void {
  // The server answers in request order; the name match covers a short or
  // reordered response.
  const result =
    response.results[index]?.name === pending.name
      ? response.results[index]
      : response.results.find(r => r.name === pending.name);

  if (!result) {
    pending.reject(new Error(`Query result not found for: ${pending.name}`));
    return;
  }

  pending.resolve(result.data ?? null);
}

async function runSingle(pending: PendingFallbackQuery): Promise<void> {
  try {
    const response = await executeFallbackQueries([{ name: pending.name, args: pending.args }]);
    settle(pending, 0, response);
  } catch (error) {
    pending.reject(error);
  }
}

function flushPendingQueries(): void {
  const batch = pendingQueries;
  pendingQueries = [];
  flushScheduled = false;

  if (batch.length === 0) return;

  void executeFallbackQueries(batch.map(({ name, args }) => ({ name, args })))
    .then(response => {
      batch.forEach((pending, index) => settle(pending, index, response));
    })
    .catch(error => {
      if (batch.length === 1) {
        batch[0]!.reject(error);
        return;
      }
      // The endpoint fails the whole request if any single query in it fails,
      // so retry one at a time to isolate the one that broke.
      void Promise.all(batch.map(runSingle));
    });
}

export function executeFallbackQuery(name: string, args: unknown): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    pendingQueries.push({ name, args, resolve, reject });

    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flushPendingQueries);
    }
  });
}
