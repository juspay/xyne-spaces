import { ClawApiError, clawApiRequest } from '../../../services/claw/clawRequest';
import { xyneAIStreamManager } from '../../../services/XyneAI/XyneAIStreamManager';
import { executePageTool, getWorkspaceWebview, type PageToolResult } from './workspaceBrowserTools';

const POLL_MS = 1000;
const UNSUPPORTED_BACKOFF_MS = 5 * 60 * 1000;

interface PagePanelCall {
  id: string;
  toolName: string;
  args?: Record<string, unknown>;
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

async function runCall(call: PagePanelCall): Promise<PageToolResult> {
  if (!call.toolName.startsWith('page-'))
    return { ok: false, content: `Unknown page tool: ${call.toolName}` };
  return executePageTool(call.toolName, call.args ?? {}).catch(() => ({
    ok: false,
    content: 'Tool failed',
  }));
}

export function startPagePanelPoller(): () => void {
  let stopped = false;
  let timer: number | undefined;
  let pausedUntil = 0;

  const schedule = (ms: number): void => {
    if (!stopped) timer = window.setTimeout(() => void tick(), ms);
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    let next = POLL_MS;
    const runIds = streamingRunIds();
    if (runIds.length > 0 && getWorkspaceWebview() && Date.now() >= pausedUntil) {
      try {
        const data = await clawApiRequest<{ call: PagePanelCall | null }>(
          `/surface/page-calls/next?runIds=${encodeURIComponent(runIds.join(','))}`,
        );
        const call = data?.call;
        if (call && typeof call.id === 'string' && typeof call.toolName === 'string') {
          const result = await runCall(call);
          await clawApiRequest(`/surface/page-calls/${encodeURIComponent(call.id)}/result`, {
            method: 'POST',
            body: JSON.stringify(result),
          }).catch(() => undefined);
          next = 0;
        }
      } catch (err) {
        if (err instanceof ClawApiError && [401, 403, 404].includes(err.status)) {
          pausedUntil = Date.now() + UNSUPPORTED_BACKOFF_MS;
        }
      }
    }
    schedule(next);
  };

  schedule(POLL_MS);
  return () => {
    stopped = true;
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
