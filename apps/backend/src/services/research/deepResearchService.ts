/**
 * Deep Research client — talks to the xyne-ai-extended gateway's LangGraph
 * `open_deep_research` graph and returns the final markdown report.
 *
 * Sync (poll) model: create thread → start a background run → poll the run until
 * terminal → read `final_report` from thread state. Polling keeps each HTTP
 * request short, so total research time isn't bound by the gateway's
 * per-request timeout — only by the caller's deadline or the job expiry.
 *
 * Ported from xyne-search (`server/app/services/research/deep-research.ts`) so
 * both stacks drive the same gateway.
 */
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

/** The xyne-ai-extended gateway. Set per deployment; there is no sensible default. */
function baseUrl(): string {
  const url = config.deepResearchBaseUrl;
  if (!url) {
    throw new DeepResearchError(
      'DEEP_RESEARCH_BASE_URL is not set — point it at the deep-research gateway.'
    );
  }
  return url.replace(/\/$/, '');
}

const TIMEOUT_MS = 3_600_000;
/** Gap between run-status polls. */
const POLL_INTERVAL_MS = 4_000;
/** Per-HTTP-request timeout (create/run/poll/state are all quick calls). */
const REQUEST_TIMEOUT_MS = 30_000;
/** LangGraph graph/assistant id — the graph name from langgraph.json. */
const GRAPH_ID = 'Deep Researcher';

/** Thrown for any deep-research failure; the step turns it into a readable error. */
export class DeepResearchError extends Error {
  override readonly name = 'DeepResearchError';
}

export interface DeepResearchOptions {
  /** Caller abort signal — composed with the internal deadline. */
  signal?: AbortSignal;
  /** Override the graph's research-round budget. */
  maxIterations?: number;
}

export interface DeepResearchResult {
  report: string;
  threadId: string;
}

/** Terminal LangGraph run statuses. */
const TERMINAL = new Set(['success', 'error', 'timeout', 'interrupted']);

/** One JSON fetch with a per-request timeout, composed with the caller signal. */
async function jsonFetch<T>(url: string, init: RequestInit, outerSignal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = (): void => controller.abort();
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort();
    else outerSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new DeepResearchError(
        `${init.method ?? 'GET'} ${url} → ${String(res.status)}: ${body.slice(0, 300)}`
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DeepResearchError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new DeepResearchError(`Request to ${url} aborted (timeout or cancellation)`);
    }
    throw new DeepResearchError(err instanceof Error ? err.message : 'Unknown deep-research error');
  } finally {
    clearTimeout(timer);
    if (outerSignal) outerSignal.removeEventListener('abort', onAbort);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = (): void => {
        clearTimeout(t);
        reject(new DeepResearchError('Deep research cancelled'));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/** Run a deep-research query end to end and return its final report. */
export async function deepResearch(
  query: string,
  opts: DeepResearchOptions = {}
): Promise<DeepResearchResult> {
  const q = query.trim();
  if (!q) throw new DeepResearchError('query is required');

  const root = baseUrl();
  const deadline = Date.now() + TIMEOUT_MS;
  const { signal } = opts;

  const configurable: Record<string, unknown> = { allow_clarification: false };
  if (opts.maxIterations !== undefined) {
    configurable['max_researcher_iterations'] = opts.maxIterations;
  }

  // 1. Create thread
  const thread = await jsonFetch<{ thread_id: string }>(
    `${root}/threads`,
    { method: 'POST', body: JSON.stringify({}) },
    signal
  );
  const threadId = thread.thread_id;
  if (!threadId) throw new DeepResearchError('create thread: missing thread_id in response');

  // 2. Start a background run
  const run = await jsonFetch<{ run_id: string; status?: string }>(
    `${root}/threads/${threadId}/runs`,
    {
      method: 'POST',
      body: JSON.stringify({
        assistant_id: GRAPH_ID,
        input: { messages: [{ role: 'user', content: q }] },
        config: { configurable },
      }),
    },
    signal
  );
  const runId = run.run_id;
  if (!runId) throw new DeepResearchError('start run: missing run_id in response');

  // 3. Poll until terminal (or deadline)
  let status = run.status ?? 'pending';
  while (!TERMINAL.has(status)) {
    if (Date.now() > deadline) {
      throw new DeepResearchError(
        `Deep research timed out after ${String(TIMEOUT_MS)}ms (thread ${threadId})`
      );
    }
    await sleep(POLL_INTERVAL_MS, signal);
    const polled = await jsonFetch<{ status: string }>(
      `${root}/threads/${threadId}/runs/${runId}`,
      { method: 'GET' },
      signal
    );
    status = polled.status;
  }
  if (status !== 'success') {
    throw new DeepResearchError(
      `Deep research run ended with status "${status}" (thread ${threadId})`
    );
  }

  // 4. Read the final report from thread state
  const state = await jsonFetch<{ values?: { final_report?: string } }>(
    `${root}/threads/${threadId}/state`,
    { method: 'GET' },
    signal
  );
  const report = state.values?.final_report ?? '';
  if (!report.trim()) {
    throw new DeepResearchError(`Deep research produced no final_report (thread ${threadId})`);
  }

  logger.info('[deepResearch] report ready', { threadId, chars: report.length });
  return { report, threadId };
}
