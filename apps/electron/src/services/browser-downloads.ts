import { app, session, shell, type DownloadItem, type WebContents } from 'electron';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';
import log from 'electron-log/main';

const execFileAsync = promisify(execFile);

/**
 * Files the in-app browsers download, as a browser keeps them: saved to Downloads
 * without asking, their progress shown, and opened or found from the app.
 *
 * Only for windows whose app has said it shows downloads; an app from before it
 * could gets Electron's own handling, as it always did.
 */

const BROWSER_TABS_PARTITION = 'persist:browser-tabs';
/** How often progress is passed on while a file comes in. */
const PROGRESS_EVERY_MS = 250;

/**
 * Files that run something when opened — apps, installers, disk images, scripts,
 * shortcuts — as Chrome counts them dangerous. The app never opens these itself:
 * they are shown in Finder, where macOS checks them before they run.
 */
const RUNS_WHEN_OPENED = new Set([
  'app', 'pkg', 'mpkg', 'dmg', 'command', 'tool', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'fish',
  'terminal', 'scpt', 'scptd', 'applescript', 'workflow', 'action', 'jar', 'py', 'pyc', 'pl',
  'rb', 'php', 'js', 'jse', 'mjs', 'vbs', 'vbe', 'wsf', 'ws', 'exe', 'msi', 'msp', 'bat',
  'cmd', 'com', 'scr', 'ps1', 'psm1', 'reg', 'lnk', 'hta', 'cpl', 'inf', 'url', 'webloc',
  'inetloc', 'fileloc', 'desktop', 'appimage', 'deb', 'rpm', 'kext', 'plugin', 'prefpane',
  'saver', 'service', 'mobileconfig', 'xpi', 'crx',
]);

const opensSafely = (savePath: string): boolean =>
  !RUNS_WHEN_OPENED.has(path.extname(savePath).slice(1).toLowerCase());

/**
 * Marks a downloaded file as from the internet, as Safari and Chrome do, so the
 * system checks it before anything in it runs: Gatekeeper on a Mac, SmartScreen on
 * Windows. Electron doesn't mark them itself.
 */
async function markAsDownloaded(savePath: string, fromUrl: string): Promise<void> {
  try {
    if (process.platform === 'darwin') {
      const stamp = Math.floor(Date.now() / 1000).toString(16);
      const value = `0083;${stamp};${app.getName()};${randomUUID().toUpperCase()}`;
      await execFileAsync('/usr/bin/xattr', ['-w', 'com.apple.quarantine', value, savePath]);
    } else if (process.platform === 'win32') {
      let host = '';
      try {
        const parsed = new URL(fromUrl);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') host = parsed.origin;
      } catch {
        /* no address to name */
      }
      await fs.writeFile(
        `${savePath}:Zone.Identifier`,
        `[ZoneTransfer]\r\nZoneId=3\r\n${host ? `HostUrl=${host}\r\n` : ''}`,
      );
    }
  } catch (error) {
    log.warn('[BrowserDownloads] Could not mark a download as from the internet', error);
  }
}

export type DownloadState = 'progressing' | 'completed' | 'cancelled' | 'interrupted';

interface Download {
  item: DownloadItem;
  host: WebContents;
  savePath: string;
  sentAt: number;
}

const downloads = new Map<string, Download>();
/** The windows whose app shows downloads. */
const showingWindows = new Set<number>();

/** Notes that a window's app shows downloads, until it loads a new document. */
export function acceptBrowserDownloads(host: WebContents): void {
  if (showingWindows.has(host.id)) return;
  showingWindows.add(host.id);
  const forget = (): void => {
    showingWindows.delete(host.id);
    host.removeListener('did-navigate', forget);
  };
  host.on('did-navigate', forget);
  host.once('destroyed', forget);
}

/** A name in Downloads that isn't taken: report.pdf, then report (1).pdf. */
/** Paths given to downloads still coming in: not on disk yet, but taken. */
const reserved = new Set<string>();

/**
 * A free path in Downloads for a file of this name, held until its download ends:
 * two same-named downloads begun together get one each, not both the same.
 */
function freePath(name: string): string {
  const folder = app.getPath('downloads');
  const safe = path.basename(name) || 'download';
  const extension = path.extname(safe);
  const stem = safe.slice(0, safe.length - extension.length);
  let candidate = path.join(folder, safe);
  for (let copy = 1; reserved.has(candidate) || existsSync(candidate); copy += 1) {
    candidate = path.join(folder, `${stem} (${copy})${extension}`);
  }
  reserved.add(candidate);
  return candidate;
}

function report(id: string, download: Download, state: DownloadState): void {
  if (download.host.isDestroyed()) return;
  download.sentAt = Date.now();
  download.host.send('browser-download', {
    id,
    filename: path.basename(download.savePath),
    received: download.item.getReceivedBytes(),
    total: download.item.getTotalBytes(),
    state,
    paused: download.item.isPaused(),
    canOpen: opensSafely(download.savePath),
  });
}

/** Saves downloads from the in-app browsers' pages, for windows that show them. */
export function setupBrowserDownloads(): void {
  session.fromPartition(BROWSER_TABS_PARTITION).on('will-download', (_event, item, page) => {
    const host = page?.hostWebContents;
    if (!host || host.isDestroyed() || !showingWindows.has(host.id)) {
      log.info('[BrowserDownloads] Left to Electron', {
        fromPage: page?.getType() ?? 'none',
        hasHost: Boolean(host),
        hostShowsDownloads: host ? showingWindows.has(host.id) : false,
      });
      return;
    }
    const id = randomUUID();
    const savePath = freePath(item.getFilename());
    item.setSavePath(savePath);
    const download: Download = { item, host, savePath, sentAt: 0 };
    downloads.set(id, download);
    report(id, download, 'progressing');
    item.on('updated', (_updated, state) => {
      if (Date.now() - download.sentAt < PROGRESS_EVERY_MS && !item.isPaused()) return;
      report(id, download, state === 'interrupted' ? 'interrupted' : 'progressing');
    });
    item.once('done', (_done, state) => {
      reserved.delete(savePath);
      if (state !== 'completed') {
        report(id, download, state);
        downloads.delete(id);
        return;
      }
      // Marked before it is said to be done, so nothing can open it unmarked.
      void markAsDownloaded(savePath, item.getURL()).then(() => report(id, download, state));
    });
  });
}

export type DownloadAction = 'open' | 'show' | 'cancel' | 'pause' | 'resume';

/** Acts on a download, for the window it was shown in only. */
export async function actOnDownload(
  host: WebContents,
  id: string,
  action: DownloadAction,
): Promise<boolean> {
  const download = downloads.get(id);
  if (!download || download.host !== host) return false;
  const { item, savePath } = download;
  try {
    if (action === 'open') {
      // Only once it is all here, and never something that runs: that is shown in
      // Finder instead, where the system checks it.
      if (item.getState() !== 'completed' || !opensSafely(savePath)) return false;
      return (await shell.openPath(savePath)) === '';
    }
    if (action === 'show') shell.showItemInFolder(savePath);
    else if (action === 'cancel') item.cancel();
    else if (action === 'pause') item.pause();
    else if (action === 'resume' && item.canResume()) item.resume();
    return true;
  } catch (error) {
    log.warn('[BrowserDownloads] Could not act on a download', error);
    return false;
  }
}
