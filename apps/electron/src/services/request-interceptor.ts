import log from 'electron-log/main';
import { session, BrowserWindow, app } from 'electron';
import { config } from '../app/config';
import { clearAllCookies } from './cookies';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import Logger from 'electron-log';
import { EnrollmentEvent } from './logger/enrollment-events';
import { showScreenPicker } from './screen-picker';
import Store from 'electron-store';

let mainWindow: BrowserWindow | null = null;
const store = new Store();

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

let cachedUserEmail: string | null = null;

/**
 * Called from the IPC handler when the user logs in (covers fresh-login path).
 */
export function setCachedUser(email: string): void {
  cachedUserEmail = email;
}

/**
 * Called once at startup. Reads the persisted JWT cookie so the email is
 * available even when the user never re-logs in after an app update/restart.
 */
export async function hydrateCachedUserFromCookies(): Promise<void> {
  try {
    const workspaceCookies = await session.defaultSession.cookies.get({ name: 'xyne_last_workspace' });
    const workspaceId = workspaceCookies[0]?.value;
    if (!workspaceId) return;

    const tokenCookies = await session.defaultSession.cookies.get({ name: `xyne_ws_${workspaceId}_token` });
    const token = tokenCookies[0]?.value;
    if (!token) return;

    // Decode JWT payload (no verification needed — trusted main process)
    const payloadB64 = token.split('.')[1];
    if (!payloadB64) return;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof payload.email === 'string' && payload.email) {
      cachedUserEmail = payload.email;
      Logger.info('[RequestInterceptor] Hydrated user email from JWT cookie');
    }
  } catch (err) {
    Logger.warn('[RequestInterceptor] Could not hydrate user from cookies', { error: String(err) });
  }
}

/**
 * Sets up the download handler to prevent unwanted "Save As" dialogs
 * This fixes an Electron bug where reload or parallel downloads trigger the dialog
 * even when saveAs is set to false.
 * See: https://github.com/electron/electron/issues/23273
 */
function setupDownloadHandler(): void {
  session.defaultSession.on('will-download', (_event, item, _webContents) => {
    const downloadsPath = app.getPath('downloads');
    if (!existsSync(downloadsPath)) {
      mkdirSync(downloadsPath, { recursive: true });
    }    
    const originalFilename = item.getFilename();
    let filePath = path.join(downloadsPath, originalFilename);
    
    let counter = 1;
    const ext = path.extname(originalFilename);
    const baseName = path.basename(originalFilename, ext);
    while (existsSync(filePath)) {
      filePath = path.join(downloadsPath, `${baseName} (${counter})${ext}`);
      counter++;
    }
    item.setSavePath(filePath);

    log.info(`[Download] Saving file to: ${filePath}`);
  });
}

/**
 * Sets up a User-Agent rewrite on the `persist:xyne-spaces` partition — the
 * session used by Xyne-internal tabs inside the browser panel.
 *
 * Why: `authV2Controller.detectPlatform` classifies a request as `electron`
 * when the UA contains "electron". If auth ever has to run inside this
 * partition (cookie sync missed a refresh, manual logout, etc.), stripping
 * the "Electron/x.y.z" token flips the backend to the web branch so
 * Set-Cookie + redirect completes inside the panel instead of bouncing
 * through `/launch` → `xyne-spaces://` and hijacking the main window.
 *
 * External sites live in `persist:browser-tabs` — they are untouched.
 *
 * Contract: do NOT attach an `X-Platform: electron` header to this
 * session — that would bypass the UA strip and reintroduce the hijack.
 */
export function setupXyneSpacesInterceptor(): void {
  const xyneSpacesSession = session.fromPartition('persist:xyne-spaces');

  const xyneOriginUrls = [
    config.BACKEND_URL,
    config.FRONTEND_URL,
    config.MTLS_BACKEND_URL,
    config.MTLS_FRONTEND_URL,
  ]
    .filter((url): url is string => typeof url === 'string' && url.length > 0)
    .flatMap((url) => [`${url}/*`, `${url.replace(/^https/, 'wss')}/*`]);

  if (xyneOriginUrls.length === 0) {
    return;
  }

  xyneSpacesSession.webRequest.onBeforeSendHeaders(
    { urls: xyneOriginUrls },
    (details, callback) => {
      const ua = (details.requestHeaders['User-Agent'] as string | undefined) ?? '';
      const cleanedUa = ua
        .replace(/\s?Electron\/\S+/i, '')
        .replace(/\s+/g, ' ')
        .trim();

      const headers: Record<string, string> = {
        ...details.requestHeaders,
        ...(cleanedUa !== ua ? { 'User-Agent': cleanedUa } : {}),
      };

      const preProdEnabled = store.get(config.preProdKey);
      if (preProdEnabled === true) {
        headers['x-route-env'] = 'playground';
      }

      callback({ requestHeaders: headers });
    }
  );
}

/**
 * XYNE-16859 Issue 24: deny screen/microphone capture web APIs
 * (`getUserMedia`, `getDisplayMedia`) for any webContents that is not the
 * top-level main application window. Without this, an XSS'd `<webview>` or
 * browser panel could bypass our error-report:* IPC gate entirely by calling
 * `navigator.mediaDevices.getUserMedia` / `getDisplayMedia` directly, since
 * macOS's app-level Screen-Recording + Microphone TCC grants would otherwise
 * auto-grant the child web-contents silently.
 *
 * Applied to every session the app uses. `display-capture` is also handled by
 * `setDisplayMediaRequestHandler` further down (in-app picker for calls); the
 * permission handler is the belt to that suspenders — the picker still shows
 * for the main window, embedded contents can't request at all.
 */
const RESTRICTED_MEDIA_PERMISSIONS = new Set(['media', 'display-capture', 'mediaKeySystem']);

// First-party Xyne content loaded outside the main window (e.g. in-app browser panel →
// persist:xyne-spaces) is allowed this narrow set of low-risk permissions — clipboard
// writes for "copy" buttons and fullscreen for the media/pptx/pdf viewers. Only this set,
// and only for first-party origins; all other permissions stay denied except the main window.
const FIRST_PARTY_NONMEDIA_PERMISSIONS = new Set([
  'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'pointerLock',
]);
const appOwnedWindows = new Set<BrowserWindow>();

export function registerAppOwnedWindow(window: BrowserWindow): void {
  appOwnedWindows.add(window);
  window.once('closed', () => appOwnedWindows.delete(window));
}

function isAppOwnedWindowContents(webContents: Electron.WebContents | undefined): boolean {
  if (!webContents) return false;
  const owner = BrowserWindow.fromWebContents(webContents);
  if (!owner || owner.isDestroyed()) return false;
  return owner.webContents === webContents && appOwnedWindows.has(owner);
}

function isTopLevelMainWindow(webContents: Electron.WebContents | undefined): boolean {
  if (!webContents) return false;
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return webContents === mainWindow.webContents;
}
// Mirrors preload.ts isTrustedOrigin(), but evaluated main-side against a webContents URL.
function isFirstPartyUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const { protocol, hostname } = new URL(rawUrl);
    if (protocol.startsWith('xyne-spaces')) return true;              // bundled UI custom scheme
    if (protocol === 'file:') return true;                            // bundled local HTML
    if (protocol === 'https:' && (hostname === 'xyne.juspay.net' || hostname.endsWith('.xyne.juspay.net'))) return true;
    if ((protocol === 'http:' || protocol === 'https:') && (hostname === 'localhost' || hostname === '127.0.0.1')) return true;
    return false;
  } catch {
    return false;
  }
}
function installMediaPermissionGuard(targetSession: Electron.Session, label: string): void {
  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (RESTRICTED_MEDIA_PERMISSIONS.has(permission)) {
      const allowed =
        isTopLevelMainWindow(webContents) ||
        (isAppOwnedWindowContents(webContents) && isFirstPartyUrl(details?.requestingUrl));
      if (!allowed) {
        Logger.warn(
          `[permissions:${label}] denied ${permission} for non-main webContents (url=${webContents?.getURL() ?? 'n/a'})`,
        );
      }
      callback(allowed);
      return;
    }
    // Main window keeps permissive behaviour; first-party Xyne content outside it gets ONLY
    // the narrow clipboard/fullscreen set; every other session (in-app browser panel
    // `persist:browser-tabs`, the `preview` partition, embedded `<webview>`s) is denied.
    if (isTopLevelMainWindow(webContents)) {
      callback(true);
      return;
    }
    if (FIRST_PARTY_NONMEDIA_PERMISSIONS.has(permission) && isFirstPartyUrl(webContents?.getURL())) {
      callback(true);
      return;
    }
    Logger.warn(
      `[permissions:${label}] denied ${permission} for non-main webContents (url=${webContents?.getURL() ?? 'n/a'})`,
    );
    callback(false);
  });
  targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (RESTRICTED_MEDIA_PERMISSIONS.has(permission)) {
      return (
        isTopLevelMainWindow(webContents ?? undefined) ||
        (isAppOwnedWindowContents(webContents ?? undefined) && isFirstPartyUrl(requestingOrigin))
      );
    }
    // Non-media permission checks succeed for the first-party main window,
    // and for the narrow clipboard/fullscreen set on first-party content hosted outside
    // it (e.g. the in-app browser panel); untrusted embedded content is denied.
    if (isTopLevelMainWindow(webContents ?? undefined)) return true;
    return FIRST_PARTY_NONMEDIA_PERMISSIONS.has(permission) && isFirstPartyUrl(webContents?.getURL());
  });
}
function setupMediaPermissionGuard(): void {
  installMediaPermissionGuard(session.defaultSession, 'default');
  installMediaPermissionGuard(session.fromPartition('persist:xyne-spaces'), 'xyne-spaces');
  installMediaPermissionGuard(session.fromPartition('persist:browser-tabs'), 'browser-tabs');
  app.on('session-created', (createdSession) => {
    installMediaPermissionGuard(createdSession, 'dynamic');
  });
}

function installFrontendCsp(): void {
  const xyneHosts = 'https://*.xyne.juspay.net';
  const xyneWs = 'wss://*.xyne.juspay.net';
  const googleApis = 'https://apis.google.com https://accounts.google.com';
  const googleFontsCss = 'https://fonts.googleapis.com';
  const googleFontsFiles = 'https://fonts.gstatic.com';
  // Sandpack (agent-generated React artifacts in Ask AI) does NOT bundle
  // in-page: its preview is an iframe whose document is served by the
  // CodeSandbox bundler, and the client talks to that frame. Without both
  // frame-src and connect-src the preview silently never loads.
  // Revisit when the artifact data-bridge lands — at that point real workspace
  // data enters the frame and the bundler should be self-hosted on xyneHosts
  // (Sandpack's `bundlerURL` option) instead of allowlisting a third party.
  const sandpackBundler = 'https://*.codesandbox.io';
  const cspDirectives = [
    `default-src 'self' ${xyneHosts}`,
    `script-src 'self' ${xyneHosts} ${googleApis}`,
    `style-src 'self' 'unsafe-inline' ${xyneHosts} ${googleFontsCss}`,
    `img-src 'self' data: blob: https:`,
    `media-src 'self' blob: ${xyneHosts}`,
    `connect-src 'self' ${xyneHosts} ${xyneWs} https://o4507796893925376.ingest.us.sentry.io https://accounts.google.com https://*.googleapis.com ${sandpackBundler}`,
    `font-src 'self' data: ${xyneHosts} ${googleFontsFiles}`,
    `frame-src 'self' blob: ${xyneHosts} https://www.youtube.com https://player.vimeo.com https://www.loom.com https://accounts.google.com https://docs.google.com ${sandpackBundler}`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self' ${xyneHosts}`,
    `frame-ancestors 'none'`,
  ].join('; ');

  const cspTargets = [
    config.FRONTEND_URL,
    config.MTLS_FRONTEND_URL,
  ]
    .filter((url): url is string => typeof url === 'string' && url.length > 0)
    .map((url) => `${url}/*`);

  if (cspTargets.length === 0) return;

  session.defaultSession.webRequest.onHeadersReceived(
    { urls: cspTargets },
    (details, callback) => {
      const headers: Record<string, string[]> = { ...(details.responseHeaders ?? {}) };
      // Strip any weaker CSP the backend sent (case-insensitive) so ours wins.
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'content-security-policy') {
          delete headers[key];
        }
      }
      headers['Content-Security-Policy'] = [cspDirectives];
      callback({ responseHeaders: headers });
    },
  );
}

/**
 * Sets up request and response interception
 */
export function setupRequestInterceptor(): void {
  // Set up download handler first to prevent "Save As" dialog issues
  setupDownloadHandler();
  setupMediaPermissionGuard();
  installFrontendCsp();
  
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [
      `${config.BACKEND_URL}/*`,
      `${config.FRONTEND_URL}/*`,
      config.BACKEND_URL.replace(/^https/, 'wss') + '/*',
      ], 
    },
    (details, callback) => {
      details.requestHeaders['X-Platform'] = 'electron';
      const preProdEnabled = store.get(config.preProdKey);
      if (preProdEnabled === true) {
        details.requestHeaders['x-route-env'] = 'playground';
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  session.defaultSession.webRequest.onHeadersReceived(
    { urls: [`${config.BACKEND_URL}/*`] },
    (details, callback) => {
      if (details.statusCode === 401) {
        const contentType = details.responseHeaders?.['content-type']?.[0];
        if (contentType?.includes('application/json')) {
          void clearAllCookies();
          mainWindow?.webContents.send('auth:token-expired');
        }
      }

      if (details.url.includes('/logout') && details.statusCode === 200) {
        void clearAllCookies();
      }

      callback({ responseHeaders: details.responseHeaders });
    }
  );
  
  // Start with native OS picker by default — mat
  // Handle responses for auth-related actionsches the CAC default (customPickerEnabled: false).
  // CustomLiveKitRoom will call setCustomScreenPickerEnabled(true) if CAC enables the custom picker.
  setCustomScreenPickerEnabled(false);

  session.defaultSession.webRequest.onErrorOccurred(
    { urls: [`${config.BACKEND_URL}/*`] },
    (details) => {
      Logger.error(EnrollmentEvent.NETWORK_ERROR, {
        url: details.url,
        error: details.error,
      });
    }
  );
}

/**
 * Installs the custom display-media handler that shows the in-app screen picker.
 * Called on startup and re-called after a native OS picker fallback completes.
 */
function setupDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const safeCallback = (streams: Electron.Streams): void => {
      try {
        callback(streams);
      } catch (err) {
        // Electron throws "Video was requested, but no video stream was provided"
        // when callback({}) is called after user cancellation — suppress it.
        Logger.info('[ScreenShare] Cancelled or no stream provided:', String(err));
      }
    };
    showScreenPicker(safeCallback);
  });
}

/**
 * Switch between the custom in-app screen picker and the native macOS picker.
 * When disabled, re-registers the handler with useSystemPicker: true so Electron
 * delegates to the native OS picker instead of our custom UI.
 */
export function setCustomScreenPickerEnabled(enabled: boolean): void {
  if (enabled) {
    setupDisplayMediaHandler();
    Logger.info('[ScreenShare] Custom screen picker enabled');
  } else {
    // useSystemPicker: true tells Electron to use the native macOS picker.
    // The handler is still registered but never actually invoked when the
    // system picker is available — macOS handles the entire flow natively.
    session.defaultSession.setDisplayMediaRequestHandler(
      (_request, callback) => {
        callback({ video: true, audio: true, useSystemPicker: true } as unknown as Electron.Streams);
      },
      { useSystemPicker: true },
    );
    Logger.info('[ScreenShare] Custom screen picker disabled — using native OS picker');
  }
}
