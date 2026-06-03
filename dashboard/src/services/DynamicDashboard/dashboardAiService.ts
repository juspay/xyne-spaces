import { DashboardAiEventSchema, type DashboardAiEvent, type DashboardPlan } from '@xyne/shared';
import { BASE_URL } from '../clients/apiClient';

export interface StreamHandle {
  abort: () => void;
  done: Promise<void>;
}

export interface StreamArgs {
  prompt: string;
  dataSourceId: string;
  currentPlan?: DashboardPlan | undefined;
  sessionId?: string | undefined;
  lastError?: string;
  onEvent: (event: DashboardAiEvent) => void;
  onError?: (err: Error) => void;
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
          ...(args.currentPlan ? { currentPlan: args.currentPlan } : {}),
          ...(args.sessionId ? { sessionId: args.sessionId } : {}),
          ...(args.lastError ? { lastError: args.lastError } : {}),
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

function parseSseBlock(raw: string, onEvent: (event: DashboardAiEvent) => void): void {
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const parsed = DashboardAiEventSchema.safeParse(JSON.parse(payload));
      if (parsed.success) {
        onEvent(parsed.data);
      } else {
        // eslint-disable-next-line no-console
        console.warn('[dashboardAi] dropped malformed event', parsed.error.issues);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[dashboardAi] failed to parse event', e);
    }
  }
}
