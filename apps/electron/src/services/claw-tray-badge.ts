import { BrowserWindow, nativeImage, type NativeImage } from 'electron';
import path from 'path';
import log from 'electron-log/main';

const BADGE_HEIGHT = 16;
const BADGE_WIDTH = 25;
const FRAME_RATE = 15;

let win: BrowserWindow | null = null;
let loaded: Promise<void> | null = null;
let frameHandler: ((image: NativeImage) => void) | null = null;
let lastWaiting: boolean | null = null;
let lastDark: boolean | null = null;

function createWindow(): BrowserWindow {
  const offscreen = new BrowserWindow({
    width: BADGE_WIDTH,
    height: BADGE_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  offscreen.webContents.setFrameRate(FRAME_RATE);

  offscreen.webContents.on('paint', (_details, _dirty, image) => {
    if (!frameHandler) return;
    const size = image.getSize();
    if (size.width === 0 || size.height === 0) return;

    const scaleFactor = size.height / BADGE_HEIGHT;
    frameHandler(
      nativeImage.createFromBitmap(image.toBitmap(), {
        width: size.width,
        height: size.height,
        scaleFactor,
      }),
    );
  });

  return offscreen;
}

async function ensureLoaded(): Promise<void> {
  if (win && !win.isDestroyed() && loaded) return loaded;

  win = createWindow();
  const target = win;

  loaded = new Promise<void>((resolve, reject) => {
    target.webContents.once('did-finish-load', () => resolve());
    target.webContents.once('did-fail-load', (_e, code, desc) =>
      reject(new Error(`claw-tray-badge.html failed to load (${code}): ${desc}`)),
    );
  });

  const badgeHtml = path.join(__dirname, '..', '..', 'assets', 'claw-tray-badge.html');
  target.loadFile(badgeHtml).catch((error) => {
    log.error('[ClawTrayBadge] Failed to load badge HTML:', error);
  });

  await loaded;
  target.webContents.setZoomFactor(1);
  return loaded;
}

export function startClawBadgeRenderer(onFrame: (image: NativeImage) => void): void {
  frameHandler = onFrame;
}

export async function updateClawBadge(waiting: boolean, dark: boolean): Promise<void> {
  try {
    await ensureLoaded();
    if (!win || win.isDestroyed()) return;

    const wc = win.webContents;
    await wc.executeJavaScript('window.__ready()');

    if (waiting !== lastWaiting || dark !== lastDark) {
      lastWaiting = waiting;
      lastDark = dark;
      await wc.executeJavaScript(`window.__setState(${waiting}, ${dark})`);
    }
    wc.invalidate();
  } catch (error) {
    log.error('[ClawTrayBadge] Failed to update badge:', error);
  }
}

export function repaintClawBadge(): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.invalidate();
}

export function stopClawBadgeRenderer(): void {
  frameHandler = null;
  lastWaiting = null;
  lastDark = null;
  loaded = null;
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}
