import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';

/** A file one of the in-app browsers downloads, as the desktop app reports it. */
export interface BrowserDownload {
  id: string;
  filename: string;
  received: number;
  /** Bytes in all; 0 when the site doesn't say. */
  total: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  paused: boolean;
  /** False for a file that runs something — an app, an installer, a script — which
   *  is shown in Finder instead, where the system checks it before it runs. */
  canOpen: boolean;
}

export type DownloadAction = 'open' | 'show' | 'cancel' | 'pause' | 'resume';

/** The most a list keeps; the oldest finished ones go first. */
const MAX_LISTED = 30;
const STATES: readonly string[] = ['progressing', 'completed', 'cancelled', 'interrupted'];

let downloads: readonly BrowserDownload[] = [];
const listeners = new Set<() => void>();
const changed = (): void => listeners.forEach(listener => listener());

/** A report from the desktop app, taken only in the shape it should have. */
function readDownload(value: unknown): BrowserDownload | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { id, filename, received, total, state, paused, canOpen } = record;
  if (typeof id !== 'string' || typeof filename !== 'string') return null;
  if (typeof state !== 'string' || !STATES.includes(state)) return null;
  return {
    id,
    filename,
    received: typeof received === 'number' ? received : 0,
    total: typeof total === 'number' ? total : 0,
    state: state as BrowserDownload['state'],
    paused: paused === true,
    canOpen: canOpen === true,
  };
}

export function actOnDownload(id: string, action: DownloadAction): void {
  void window.electronAPI?.browserDownloadAction?.(id, action).catch(() => undefined);
}

/** Takes finished downloads off the list; the files stay where they are. */
export function clearFinishedDownloads(): void {
  downloads = downloads.filter(download => download.state === 'progressing');
  changed();
}

/**
 * Listens for the in-app browsers' downloads — which is what has the desktop app
 * save them to Downloads — and says when each is done, wherever it came from.
 */
export function keepDownloads(): () => void {
  const api = window.electronAPI;
  if (!api?.onBrowserDownload) return () => undefined;
  return api.onBrowserDownload(report => {
    const download = readDownload(report);
    if (!download) return;
    const before = downloads.find(existing => existing.id === download.id);
    downloads = [download, ...downloads.filter(existing => existing.id !== download.id)].slice(
      0,
      MAX_LISTED,
    );
    changed();
    if (before?.state === 'progressing' && download.state === 'completed') {
      toast.success(`Downloaded ${download.filename}`, {
        description: 'Saved to Downloads',
        action: download.canOpen
          ? { label: 'Open', onClick: () => actOnDownload(download.id, 'open') }
          : { label: 'Show in Finder', onClick: () => actOnDownload(download.id, 'show') },
      });
    } else if (before?.state === 'progressing' && download.state === 'interrupted') {
      toast.error(`Couldn't download ${download.filename}`);
    }
  });
}

/** Hears the list change. */
export function subscribeToDownloads(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The window's downloads, newest first. */
export function useBrowserDownloads(): readonly BrowserDownload[] {
  return useSyncExternalStore(subscribeToDownloads, () => downloads);
}
