import { CLAW_API_BASE, ClawApiError, clawApiRequest } from '../../../services/claw/clawRequest';
import { xyneAIStreamManager } from '../../../services/XyneAI/XyneAIStreamManager';
import {
  executePageTool,
  hasWorkspacePages,
  subscribeToWorkspacePages,
  type PageToolResult,
} from './workspaceBrowserTools';

/** How often a server without the stream is asked for the next call. */
const POLL_MS = 1000;
/** How soon a stream that ended is opened again. */
const STREAM_RETRY_MS = 3000;
const UNSUPPORTED_BACKOFF_MS = 5 * 60 * 1000;

interface PagePanelCall {
  id: string;
  toolName: string;
  args?: Record<string, unknown>;
}

/** How serving a set of runs ended. */
type Outcome = 'ended' | 'unsupported' | 'refused';

/** Who hears that a conversation's artifacts changed; null for any conversation's. */
const artifactListeners = new Set<(conversationId: string | null) => void>();
const artifactsChanged = (conversationId: string | null): void =>
  artifactListeners.forEach(listener => listener(conversationId));

/** Hears the server say a conversation's artifacts changed — null after the stream
 *  (re)opens, as anything said while it was down is gone. */
export function subscribeToArtifactChanges(
  listener: (conversationId: string | null) => void,
): () => void {
  artifactListeners.add(listener);
  return () => artifactListeners.delete(listener);
}

export function streamingRunIds(): string[] {
  const ids = new Set<string>();
  for (const state of xyneAIStreamManager.getAllActiveStreams().values()) {
    if (state.status !== 'streaming') continue;
    const runId = state.traceId?.trim();
    if (runId) ids.add(runId);
  }
  return Array.from(ids);
}

function callFrom(value: unknown): PagePanelCall | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, toolName, args } = value as Record<string, unknown>;
  if (typeof id !== 'string' || typeof toolName !== 'string') return null;
  return {
    id,
    toolName,
    ...(typeof args === 'object' && args !== null && { args: args as Record<string, unknown> }),
  };
}

async function runCall(call: PagePanelCall): Promise<PageToolResult> {
  if (!call.toolName.startsWith('page-'))
    return { ok: false, content: `Unknown page tool: ${call.toolName}` };
  return executePageTool(call.toolName, call.args ?? {}).catch(() => ({
    ok: false,
    content: 'Tool failed',
  }));
}

async function answer(call: PagePanelCall): Promise<void> {
  const result = await runCall(call);
  await clawApiRequest(`/surface/page-calls/${encodeURIComponent(call.id)}/result`, {
    method: 'POST',
    body: JSON.stringify(result),
  }).catch(() => undefined);
}

const runsQuery = (runIds: readonly string[]): string =>
  `runIds=${encodeURIComponent(runIds.join(','))}`;

/**
 * Takes what the server says about these runs over one stream, until it ends or
 * `signal` aborts: the agent's page calls, and that a conversation's artifacts
 * changed. Its being open, with `panel`, tells the server the browser panel is.
 */
function parsed(data: readonly string[]): unknown {
  try {
    return JSON.parse(data.join('\n'));
  } catch {
    return null;
  }
}

async function stream(
  runIds: readonly string[],
  panel: boolean,
  signal: AbortSignal,
): Promise<Outcome> {
  // SSE: fetch for a readable body, as the conversation's live stream does.
  // eslint-disable-next-line local-rules/no-fetch-use-axios
  const res = await fetch(
    `${CLAW_API_BASE}/api/v1/surface/page-calls/stream?${runsQuery(runIds)}&panel=${panel ? 1 : 0}`,
    { credentials: 'include', headers: { Accept: 'text/event-stream' }, signal },
  );
  if (res.status === 404) return 'unsupported';
  if (res.status === 401 || res.status === 403) return 'refused';
  if (!res.ok || !res.body) return 'ended';

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return 'ended';
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length === 0) continue;
      const body = parsed(data);
      if (event === 'ready') {
        // A server that says when artifacts change; fetched once now, for whatever
        // changed while no stream was open.
        if (typeof body === 'object' && body !== null && 'artifacts' in body && body.artifacts) {
          artifactsChanged(null);
        }
      } else if (event === 'artifacts') {
        const conversationId =
          typeof body === 'object' && body !== null && 'conversationId' in body
            ? body.conversationId
            : null;
        if (typeof conversationId === 'string') artifactsChanged(conversationId);
      } else if (event === 'call') {
        const call = callFrom(body);
        // Answered beside the stream, so a slow page doesn't hold up the next call.
        if (call) void answer(call);
      }
    }
  }
}

const pause = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise(resolve => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** A server from before the stream: asked every second, as it was. */
async function poll(runIds: readonly string[], signal: AbortSignal): Promise<Outcome> {
  while (!signal.aborted) {
    try {
      const data = await clawApiRequest<{ call: unknown }>(
        `/surface/page-calls/next?${runsQuery(runIds)}`,
        { signal },
      );
      const call = callFrom(data?.call);
      if (call) {
        await answer(call);
        continue;
      }
    } catch (err) {
      if (signal.aborted) break;
      if (err instanceof ClawApiError && [401, 403, 404].includes(err.status)) return 'refused';
    }
    await pause(POLL_MS, signal);
  }
  return 'ended';
}

const untilAborted = (signal: AbortSignal): Promise<Outcome> =>
  new Promise(resolve => {
    if (signal.aborted) resolve('ended');
    else signal.addEventListener('abort', () => resolve('ended'), { once: true });
  });

/**
 * Hears the server about this window's Xyne AI runs while any streams: one stream
 * brings each browser-panel call a cloud run makes of the workspace's pages, as it
 * is made, and says when a run's conversation's artifacts change. The runs, or the
 * panel having pages, changing opens it afresh. A desktop app paired as a device
 * gets page calls through its own stream instead, and the server never queues them
 * here. A server from before the stream is asked every second, while there are pages.
 */
export function startPagePanelCalls(): () => void {
  let stopped = false;
  let serving: { key: string; abort: AbortController } | null = null;
  let streamUnsupportedUntil = 0;
  let pausedUntil = 0;
  let retryTimer: number | undefined;

  const serve = async (
    runIds: readonly string[],
    panel: boolean,
    signal: AbortSignal,
  ): Promise<Outcome> => {
    if (Date.now() >= streamUnsupportedUntil) {
      const outcome = await stream(runIds, panel, signal).catch((): Outcome => 'ended');
      if (outcome !== 'unsupported') return outcome;
      streamUnsupportedUntil = Date.now() + UNSUPPORTED_BACKOFF_MS;
    }
    // Asking for page calls with no page to answer them would turn the agent away
    // from its sandbox browser; without pages there is nothing to ask.
    return panel ? poll(runIds, signal) : untilAborted(signal);
  };

  const refresh = (): void => {
    if (stopped) return;
    const runs = Date.now() >= pausedUntil ? streamingRunIds().join(',') : '';
    const panel = hasWorkspacePages();
    const key = runs && `${runs}|${panel ? 1 : 0}`;
    if (serving?.key === key) return;
    serving?.abort.abort();
    serving = null;
    if (!key) return;
    const abort = new AbortController();
    serving = { key, abort };
    void serve(runs.split(','), panel, abort.signal).then(outcome => {
      // Replaced meanwhile, by other runs or none.
      if (serving?.abort !== abort) return;
      serving = null;
      if (outcome === 'refused') pausedUntil = Date.now() + UNSUPPORTED_BACKOFF_MS;
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(
        refresh,
        outcome === 'refused' ? UNSUPPORTED_BACKOFF_MS : STREAM_RETRY_MS,
      );
    });
  };

  // Changes in one go — a page view mounting again unregisters and registers its page
  // in the same commit — are looked at once, after them all, not one reconnect each.
  let refreshQueued = false;
  const refreshSoon = (): void => {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      refresh();
    });
  };

  const unsubscribeRuns = xyneAIStreamManager.subscribe(refreshSoon);
  const unsubscribePages = subscribeToWorkspacePages(refreshSoon);
  refresh();
  return () => {
    stopped = true;
    window.clearTimeout(retryTimer);
    serving?.abort.abort();
    unsubscribeRuns();
    unsubscribePages();
  };
}
