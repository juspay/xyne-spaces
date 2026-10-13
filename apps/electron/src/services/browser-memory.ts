import { app, webContents, type WebContents } from 'electron';
import os from 'os';

/**
 * Watches how much memory the in-app browsers' pages use, and tells a window when
 * its pages use too much — as Chrome's Memory Saver does — so it lets go of the
 * ones out of sight early, rather than waiting for them to expire.
 *
 * Each page is a process of its own; their memory is summed per window. The budget
 * is a quarter of the computer's memory, at most 3 GB.
 */

const CHECK_EVERY_MS = 30_000;
const BUDGET_KB = Math.min(3 * 1024 * 1024, Math.round(os.totalmem() / 1024 / 4));

let timer: NodeJS.Timeout | null = null;

function check(): void {
  const pages = webContents
    .getAllWebContents()
    .filter(contents => !contents.isDestroyed() && contents.getType() === 'webview');
  if (pages.length === 0) {
    stop();
    return;
  }
  const memoryByPid = new Map(
    app.getAppMetrics().map(metric => [metric.pid, metric.memory.workingSetSize]),
  );
  const byHost = new Map<WebContents, number>();
  for (const page of pages) {
    const host = page.hostWebContents;
    if (!host || host.isDestroyed()) continue;
    const used = memoryByPid.get(page.getOSProcessId()) ?? 0;
    byHost.set(host, (byHost.get(host) ?? 0) + used);
  }
  for (const [host, used] of byHost) {
    if (used > BUDGET_KB) host.send('browser-pages:memory-pressure');
  }
}

function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Starts watching once a page exists; stops by itself when none are left. */
export function watchBrowserMemory(): void {
  if (timer) return;
  timer = setInterval(check, CHECK_EVERY_MS);
}
