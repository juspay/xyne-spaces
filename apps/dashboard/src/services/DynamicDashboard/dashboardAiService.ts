import { logger, Event as LogEvent } from '../../utils/logger';
import type { DashboardPlan } from '@xyne/shared';
import { apiInstance, BASE_URL } from '../clients/apiClient';

export interface StreamHandle {
  abort: () => void;
  done: Promise<void>;
}

export interface ClawStreamEvent {
  type: string;
  [key: string]: unknown;
}

export interface StreamArgs {
  prompt: string;
  dataSourceId: string;
  dashboardId?: string | undefined;
  currentPlan?: DashboardPlan | undefined;
  sessionId?: string | undefined;
  lastError?: string;
  focusedComponentId?: string | undefined;
  newThread?: boolean;
  onEvent: (event: ClawStreamEvent) => void;
  onError?: (err: Error) => void;
}

export async function cancelDashboardAi(runId: string): Promise<void> {
  await apiInstance.post(`/dashboard/ai/cancel/${encodeURIComponent(runId)}`);
}

export function streamDashboardAi(args: StreamArgs): StreamHandle {
  const controller = new AbortController();

  const done = (async () => {
    try {
      // eslint-disable-next-line local-rules/no-fetch-use-axios
      const response = await fetch(`${BASE_URL}/dashboard/ai/create`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: args.prompt,
          dataSourceId: args.dataSourceId,
          ...(args.dashboardId ? { dashboardId: args.dashboardId } : {}),
          ...(args.currentPlan ? { currentPlan: args.currentPlan } : {}),
          ...(args.sessionId ? { sessionId: args.sessionId } : {}),
          ...(args.lastError ? { lastError: args.lastError } : {}),
          ...(args.focusedComponentId ? { focusedComponentId: args.focusedComponentId } : {}),
          ...(args.newThread ? { newThread: true } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error(`Dashboard AI stream returned ${response.status}`);
      }
      if (!response.body) {
        throw new Error('Dashboard AI stream returned empty body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      const flushEvents = (final: boolean): void => {
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          parseSseBlock(raw, args.onEvent);
        }
        if (final && buf.trim().length > 0) {
          parseSseBlock(buf, args.onEvent);
          buf = '';
        }
      };

      for (;;) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) {
          buf += decoder.decode();
          flushEvents(true);
          break;
        }
        buf += decoder.decode(value, { stream: true });
        flushEvents(false);
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      args.onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return {
    abort: () => controller.abort(),
    done,
  };
}

// Frames the chat has no use for: keep-alive ping, attachment/debug events.
const IGNORED_EVENT_TYPES = new Set(['ping', 'attachment', 'debug_event', 'debug_artifacts_ready']);

function parseSseBlock(raw: string, onEvent: (event: ClawStreamEvent) => void): void {
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const json = JSON.parse(payload) as ClawStreamEvent;
      if (!json || typeof json.type !== 'string') continue;
      if (IGNORED_EVENT_TYPES.has(json.type)) continue;
      onEvent(json);
    } catch (e) {
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_warn',
        message: String('[dashboardAi] failed to parse event'),
        context: [e],
      });
    }
  }
}
