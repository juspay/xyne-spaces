import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import {
  SDLC_FRAME_MESSAGE,
  parseSdlcFrameMessage,
  type SdlcDownloadRequest,
} from '../../routes/SdlcScreen/sdlcFrameMessages';
import { canHostEmbedPages } from '../../routes/SdlcScreen/useSdlcFrameBridge';

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

/** Whether this window reaches the desktop app's downloads itself. */
const fromDesktop = (): boolean => typeof window.electronAPI?.browserDownloadAction === 'function';

/** A folder's frame, which can't reach the desktop app: its window keeps the list. */
const viaWindow = (): boolean => !fromDesktop() && canHostEmbedPages();

function askWindow(request: SdlcDownloadRequest, id?: string): void {
  window.parent.postMessage(
    { type: SDLC_FRAME_MESSAGE.downloadsRequest, request, ...(id && { id }) },
    window.location.origin,
  );
}

let listeningToWindow = false;

/** In a folder's frame: the window's list, as it sends it, asked for once to start. */
function listenToWindow(): void {
  if (listeningToWindow || !viaWindow()) return;
  listeningToWindow = true;
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    const message = parseSdlcFrameMessage(event.data);
    if (message?.type !== SDLC_FRAME_MESSAGE.downloads) return;
    downloads = message.downloads;
    changed();
  });
  askWindow('sync');
}

export function actOnDownload(id: string, action: DownloadAction): void {
  if (viaWindow()) {
    askWindow(action, id);
    return;
  }
  void window.electronAPI?.browserDownloadAction?.(id, action).catch(() => undefined);
}

/** Takes finished downloads off the list; the files stay where they are. */
export function clearFinishedDownloads(): void {
  if (viaWindow()) {
    askWindow('clear');
    return;
  }
  downloads = downloads.filter(download => download.state === 'progressing');
  changed();
}

/** The downloads now, newest first: for a window passing them on to a folder's frame. */
export function currentDownloads(): readonly BrowserDownload[] {
  return downloads;
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

/** The downloads, newest first — the window's own, or in a folder's frame its window's. */
export function useBrowserDownloads(): readonly BrowserDownload[] {
  listenToWindow();
  return useSyncExternalStore(subscribeToDownloads, () => downloads);
}
