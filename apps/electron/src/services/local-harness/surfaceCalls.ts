import log from 'electron-log/main';
import { BrowserWindow, net } from 'electron';
import { getMainWindow } from '../../window/manager';
import { isAppControlTool } from './appControl';
import { isWorkspacePageTool, workspaceBrowserBridge } from './workspaceBrowser';

const POLL_IDLE_MS = 1500;
const POLL_ERROR_MS = 5000;
const FOCUS_REPORT_MS = 30_000;
const FOCUS_TICK_MS = 5000;
const STREAM_RETRY_MS = 5000;
const STREAM_UNSUPPORTED_RETRY_MS = 10 * 60 * 1000;
const STREAM_CAPABILITIES = 'page-tools,open-url';
const OPEN_URL_TOOL = 'open-url';

export function isAnswerableSurfaceTool(toolName: string): boolean {
  return isAppControlTool(toolName) || isWorkspacePageTool(toolName) || toolName === OPEN_URL_TOOL;
}

export function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  return data.length > 0 ? { event, data: data.join('\n') } : null;
}

export function parseSurfaceCall(raw: string): PendingSurfaceCall | null {
  try {
    const call = JSON.parse(raw) as Partial<PendingSurfaceCall> | null;
    if (!call || typeof call.id !== 'string' || typeof call.toolName !== 'string') return null;
    const args = call.args && typeof call.args === 'object' ? call.args : {};
    return { id: call.id, toolName: call.toolName, args };
  } catch {
    return null;
  }
}

type StreamOutcome = 'closed' | 'unsupported' | 'error';

interface PendingSurfaceCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}

export class SurfaceCallWatcher {
  private running = false;
  private stopped = false;
  private lastFocusReport = 0;
  private streamUnsupportedUntil = 0;
  private streamAbort: AbortController | null = null;
  private focusTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly baseUrl: () => string,
    private readonly deviceToken: () => string | null,
  ) {}

  start(): void {
    if (this.running) return;
    this.stopped = false;
    this.focusTimer = setInterval(() => {
      const token = this.deviceToken();
      if (token) void this.reportFocus(token).catch(() => undefined);
    }, FOCUS_TICK_MS);
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.streamAbort?.abort();
    if (this.focusTimer) clearInterval(this.focusTimer);
    this.focusTimer = null;
  }

  private async loop(): Promise<void> {
    this.running = true;
    try {
      while (!this.stopped) {
        const token = this.deviceToken();
        if (!token) break;

        if (Date.now() >= this.streamUnsupportedUntil) {
          const outcome = await this.stream(token);
          if (this.stopped) break;
          if (outcome === 'unsupported') {
            this.streamUnsupportedUntil = Date.now() + STREAM_UNSUPPORTED_RETRY_MS;
            log.info('[LocalHarness] surface stream not supported by server, polling instead');
          } else {
            await this.wait(STREAM_RETRY_MS);
          }
          continue;
        }

        try {
          await this.reportFocus(token);
          const call = await this.next(token);
          if (!call) {
            await this.wait(POLL_IDLE_MS);
            continue;
          }
          await this.answer(token, call);
        } catch (err) {
          log.warn(`[LocalHarness] surface poll error: ${err instanceof Error ? err.message : String(err)}`);
          await this.wait(POLL_ERROR_MS);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async stream(token: string): Promise<StreamOutcome> {
    const abort = new AbortController();
    this.streamAbort = abort;
    try {
      const res = await net.fetch(
        `${this.baseUrl()}/local-harness-bridge/surface-calls/stream?capabilities=${STREAM_CAPABILITIES}`,
        {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: abort.signal,
        },
      );
      if (res.status === 404) return 'unsupported';
      if (!res.ok || !res.body) return 'error';
      log.info('[LocalHarness] surface stream connected');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return 'closed';
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const message = parseSseBlock(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          if (message?.event === 'call') {
            const call = parseSurfaceCall(message.data);
            if (call) void this.answer(token, call).catch(() => undefined);
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch (err) {
      if (!this.stopped) {
        log.warn(`[LocalHarness] surface stream error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return 'error';
    } finally {
      if (this.streamAbort === abort) this.streamAbort = null;
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async next(token: string): Promise<PendingSurfaceCall | null> {
    const res = await net.fetch(`${this.baseUrl()}/local-harness-bridge/surface-calls/next`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { call?: PendingSurfaceCall | null } };
    const call = body.data?.call;
    if (!call || typeof call.id !== 'string' || typeof call.toolName !== 'string') return null;
    return { id: call.id, toolName: call.toolName, args: call.args ?? {} };
  }

  private async answer(token: string, call: PendingSurfaceCall): Promise<void> {
    const result = isAnswerableSurfaceTool(call.toolName)
      ? await workspaceBrowserBridge.call(call.toolName, call.args)
      : { ok: false, content: `Unknown app tool: ${call.toolName}` };

    await net.fetch(
      `${this.baseUrl()}/local-harness-bridge/surface-calls/${encodeURIComponent(call.id)}/result`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(result),
      },
    ).catch(() => undefined);
  }

  private async reportFocus(token: string): Promise<void> {
    const now = Date.now();
    const win = getMainWindow();
    const focused = !!win && !win.isDestroyed() && win.isFocused();
    if (!focused && now - this.lastFocusReport < FOCUS_REPORT_MS) return;
    if (focused && now - this.lastFocusReport < 5000) return;
    this.lastFocusReport = now;

    await net.fetch(`${this.baseUrl()}/local-harness-bridge/devices/focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ focused, windows: BrowserWindow.getAllWindows().length }),
    }).catch(() => undefined);
  }
}
