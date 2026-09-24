import log from 'electron-log/main';
import { BrowserWindow, net } from 'electron';
import { getMainWindow } from '../../window/manager';
import { isAppControlTool } from './appControl';
import { workspaceBrowserBridge } from './workspaceBrowser';

const POLL_IDLE_MS = 1500;
const POLL_ERROR_MS = 5000;
const FOCUS_REPORT_MS = 30_000;

interface PendingSurfaceCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}

export class SurfaceCallWatcher {
  private running = false;
  private stopped = false;
  private lastFocusReport = 0;

  constructor(
    private readonly baseUrl: () => string,
    private readonly deviceToken: () => string | null,
  ) {}

  start(): void {
    if (this.running) return;
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
  }

  private async loop(): Promise<void> {
    this.running = true;
    try {
      while (!this.stopped) {
        const token = this.deviceToken();
        if (!token) break;

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
    const result = isAppControlTool(call.toolName)
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
