import { BrowserWindow, nativeImage, type NativeImage } from 'electron';
import path from 'path';
import log from 'electron-log/main';

const PILL_HEIGHT = 24;
const FRAME_RATE = 15;
const INITIAL_WIDTH = 80;

let win: BrowserWindow | null = null;
let loaded: Promise<void> | null = null;
let frameHandler: ((image: NativeImage) => void) | null = null;
let pillWidth = 0;
let lastText: string | null = null;
let lastPaused: boolean | null = null;

function createWindow(): BrowserWindow {
  const offscreen = new BrowserWindow({
    width: INITIAL_WIDTH,
    height: PILL_HEIGHT,
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
    if (!frameHandler || pillWidth === 0) return;
    const size = image.getSize();
    if (size.width === 0 || size.height === 0) return;

    const scaleFactor = size.height / PILL_HEIGHT;

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
      reject(new Error(`tray-pill.html failed to load (${code}): ${desc}`)),
    );
  });

  const pillHtml = path.join(__dirname, '..', '..', 'assets', 'tray-pill.html');
  target.loadFile(pillHtml).catch((error) => {
    log.error('[TrayPill] Failed to load pill HTML:', error);
  });

  await loaded;
  target.webContents.setZoomFactor(1);
  return loaded;
}

export function startPillRenderer(onFrame: (image: NativeImage) => void): void {
  frameHandler = onFrame;
}

export async function updatePill(text: string, paused: boolean): Promise<void> {
  if (text === lastText && paused === lastPaused) return;
  lastText = text;
  lastPaused = paused;

  try {
    await ensureLoaded();
    if (!win || win.isDestroyed()) return;

    const wc = win.webContents;
    await wc.executeJavaScript(`window.__set(${JSON.stringify(text)}, ${paused})`);

    const measured = (await wc.executeJavaScript('window.__measure()')) as number;
    const next = Math.ceil(measured);
    if (next > 0 && next !== pillWidth) {
      pillWidth = next;
      win.setSize(pillWidth, PILL_HEIGHT);
      wc.invalidate();
    }
  } catch (error) {
    log.error('[TrayPill] Failed to update pill:', error);
  }
}

export function stopPillRenderer(): void {
  frameHandler = null;
  pillWidth = 0;
  lastText = null;
  lastPaused = null;
  loaded = null;
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}
