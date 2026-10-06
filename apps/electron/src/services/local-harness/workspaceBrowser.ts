import { ipcMain } from 'electron';
import { randomUUID } from 'crypto';
import log from 'electron-log/main';
import { getMainWindow } from '../../window/manager';

const REQUEST_CHANNEL = 'local-harness:page-tool';
const RESULT_CHANNEL = 'local-harness:page-tool-result';
const RESPONSE_TIMEOUT_MS = 30000;

export interface WorkspacePageToolResult {
  ok: boolean;
  content: string;
  image?: { data: string; mimeType: string };
}

function readImage(value: unknown): { data: string; mimeType: string } | undefined {
  const image = value as { data?: unknown; mimeType?: unknown } | null | undefined;
  if (!image || typeof image.data !== 'string' || !image.data || typeof image.mimeType !== 'string') return undefined;
  if (!/^image\/(png|jpeg|webp)$/.test(image.mimeType) || image.data.length > 12 * 1024 * 1024) return undefined;
  return { data: image.data, mimeType: image.mimeType };
}

interface PendingCall {
  resolve: (result: WorkspacePageToolResult) => void;
  timer: NodeJS.Timeout;
}

class WorkspaceBrowserBridge {
  private readonly pending = new Map<string, PendingCall>();
  private listenerRegistered = false;

  private ensureListener(): void {
    if (this.listenerRegistered) return;
    this.listenerRegistered = true;
    ipcMain.on(RESULT_CHANNEL, (_event, payload: unknown) => {
      const reply = payload as { id?: unknown; result?: unknown } | null;
      const id = typeof reply?.id === 'string' ? reply.id : null;
      if (!id) return;
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      const result = reply?.result as { ok?: unknown; content?: unknown; image?: unknown } | undefined;
      const image = readImage(result?.image);
      entry.resolve({
        ok: result?.ok === true,
        content: typeof result?.content === 'string' ? result.content : '',
        ...(image ? { image } : {}),
      });
    });
  }

  async call(toolName: string, args: Record<string, unknown>): Promise<WorkspacePageToolResult> {
    this.ensureListener();

    const win = getMainWindow();
    if (!win || win.isDestroyed()) {
      return { ok: false, content: 'The Xyne window is not open' };
    }

    const id = randomUUID();
    return new Promise<WorkspacePageToolResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        log.warn(`[LocalHarness] workspace browser tool ${toolName} timed out`);
        resolve({
          ok: false,
          content: `The Xyne window did not answer ${toolName} in time. It may be busy or on a screen without that surface.`,
        });
      }, RESPONSE_TIMEOUT_MS);

      this.pending.set(id, { resolve, timer });

      try {
        win.webContents.send(REQUEST_CHANNEL, { id, toolName, args });
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        log.warn(`[LocalHarness] workspace browser tool ${toolName} dispatch failed:`, err);
        resolve({ ok: false, content: 'The Xyne window is not open' });
      }
    });
  }
}

export const workspaceBrowserBridge = new WorkspaceBrowserBridge();

export function isWorkspacePageTool(toolName: string): boolean {
  return toolName.startsWith('page-');
}
