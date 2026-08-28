import { app, net, session, BrowserWindow, IncomingMessage } from 'electron';
import path from 'path';
import { config } from '../app/config';
import { setCookiesFromHeaders } from './cookies';
import { forwardAuthEventToClawOverlay } from './claw-overlay-window';
import log from 'electron-log/main';
import { Logger } from './logger/Logger';
import { EnrollmentEvent } from './logger/enrollment-events';
import ElectronEvent from './logger/electron-events';
import {
  isHexToken,
  sanitizeAskAiText,
  normalizeAskAiUrl,
  normalizeAskAiDomain,
} from '../utils/validation';

let mainWindow: BrowserWindow | null = null;

/**
 * A xyne-spaces:// deep link is externally triggerable (any web page can set
 * location.href = 'xyne-spaces://...') and its path is forwarded to the renderer's
 * router via 'navigate-to'. Only plain in-app route paths are allowed — anything with
 * an embedded scheme, a protocol-relative '//', backslashes, or path traversal (raw or
 * percent-encoded) is rejected.
 */
/**
 * Route prefixes a deep link may open, matched against the first path segment.
 *
 * Empty means "allow any well-formed in-app path", which is the current behaviour. Add the
 * app's top-level routes here to narrow it — for example 'chat', 'canvas', 'tickets' — and
 * anything outside the list stops being reachable from a link. Keep it in step with the
 * renderer's router when routes are added or renamed.
 */
const DEEP_LINK_ROUTE_ALLOWLIST: readonly string[] = [];

function isAllowedDeepLinkRoute(pathStr: string): boolean {
  if (DEEP_LINK_ROUTE_ALLOWLIST.length === 0) return true;
  const [firstSegment] = pathStr.replace(/^\//, '').split(/[/?#]/);
  return DEEP_LINK_ROUTE_ALLOWLIST.includes(firstSegment);
}

function isSafeDeepLinkPath(pathStr: string): boolean {
  if (typeof pathStr !== 'string' || !pathStr.startsWith('/') || pathStr.startsWith('//')) {
    return false;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathStr);
  } catch {
    return false;
  }
  for (const c of [pathStr, decoded]) {
    if (c.includes('\\')) return false;                        // backslash
    if (c.includes('..')) return false;                        // path traversal
    if (c.includes('//')) return false;                        // protocol-relative / external
    if (/[\u0000-\u001F\u007F]/.test(c)) return false;     // control chars
    if (/[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(c)) return false;     // embedded scheme (http:, javascript:, data:)
  }
  // Conservative in-app route charset (path + query only).
  if (!/^\/[A-Za-z0-9\-._~/?=&%]*$/.test(pathStr)) return false;
  return isAllowedDeepLinkRoute(pathStr);
}

/** Parse JSON body from an Electron IncomingMessage stream */
function parseResponseBody(response: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (err) {
        reject(err);
      }
    });
    response.on('error', reject);
  });
}

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

/**
 * Registers deep link protocol and sets up handlers
 */
export function setupDeepLinks(createWindowFn: () => void): boolean {
  // Register protocol
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(config.DEEP_LINK_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(config.DEEP_LINK_PROTOCOL);
  }

  // Handle open-url on macOS
  app.on('open-url', (event, url) => {
    event.preventDefault();
    Logger.info(EnrollmentEvent.DEEP_LINK_OPENED, { 
      url,
      origin: 'open-url'
    });
    void handleDeepLink(url);
  });

  // Single instance lock
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return false;
  }

  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      createWindowFn();
    }

    const url = commandLine.find(arg => arg.startsWith(`${config.DEEP_LINK_PROTOCOL}://`));
    if (url) {
      Logger.info(EnrollmentEvent.DEEP_LINK_OPENED, { 
        url,
        origin: 'second-instance'
      });
      void handleDeepLink(url);
    }
  });

  // Handle Windows startup deep link
  if (process.platform === 'win32' && process.argv.length > 1) {
    const url = process.argv.find(arg => arg.startsWith(`${config.DEEP_LINK_PROTOCOL}://`));
    if (url){
      Logger.info(EnrollmentEvent.DEEP_LINK_OPENED, { 
        url,
        origin: 'windows-startup'
      });
      void handleDeepLink(url);
    } 
  }

  return true;
}

/**
 * Handles incoming deep links
 */
async function handleDeepLink(url: string): Promise<void> {
  log.info('Handling deep link URL:', url);

  // Ensure app is ready and services (like mTLS) are initialized
  await app.whenReady();

  const INVITATION_ID_BYTE_SIZE = 16;

  // 1. Auth Callback Case
  if (url.startsWith(`${config.DEEP_LINK_PROTOCOL}://auth/callback`)) {
    try {
      const urlObj = new URL(url);
      const code = urlObj.searchParams.get('code');
      const state = urlObj.searchParams.get('state');
      const rawInvitationId = urlObj.searchParams.get('invitationId');
      const invitationId = isHexToken(rawInvitationId, INVITATION_ID_BYTE_SIZE)
        ? rawInvitationId
        : null;
      if (rawInvitationId !== null && invitationId === null) {
        Logger.error(ElectronEvent.DEEP_LINK_INVITATION_REJECTED, {
          value: rawInvitationId,
        });
      }

      log.info('[DeepLinks] Auth callback received:', { code: !!code, state: !!state, invitationId });

      if (!code || !state) return;

      const isMTLS = url.includes("mtls");

      if (isMTLS) {
        await exchangeMTLSAuthCode(code, state, invitationId);
        return;
      }

      await exchangeAuthCode(code, state, invitationId);
    } catch (error) {
      Logger.logError(EnrollmentEvent.DEEP_LINK_HANDLING_FAILED, error);
      log.error('Failed to handle deep link:', error);
    }
    return;
  }

  // 2. Ask AI Context Case (from Chrome extension)
  // e.g. xyne-spaces://ask-ai?text=...&url=...&domain=...&title=...
  if (url.startsWith(`${config.DEEP_LINK_PROTOCOL}://ask-ai`)) {
    try {
      const urlObj = new URL(url);

      // PY-JP-019: ask-ai params are attacker-controllable (any web page can invoke
      // this protocol) and are forwarded verbatim to the privileged renderer, where
      // they land in an AI prompt / DOM. Validate & sanitize every param against its
      // expected format before forwarding; log and drop anything that fails.
      const rawText = urlObj.searchParams.get('text') || '';
      const rawUrl = urlObj.searchParams.get('url') || '';
      const rawDomain = urlObj.searchParams.get('domain') || '';
      const rawTitle = urlObj.searchParams.get('title') || '';

      const text = sanitizeAskAiText(rawText, 8000);
      const sourceUrl = normalizeAskAiUrl(rawUrl);
      const domain = normalizeAskAiDomain(rawDomain);
      const title = sanitizeAskAiText(rawTitle, 512);

      if (rawUrl && !sourceUrl) {
        Logger.error(ElectronEvent.DEEP_LINK_PARAM_REJECTED, { param: 'url', value: rawUrl.slice(0, 128) });
        log.warn('[DeepLinks] Rejected invalid ask-ai url param');
      }
      if (rawDomain && !domain) {
        Logger.error(ElectronEvent.DEEP_LINK_PARAM_REJECTED, { param: 'domain', value: rawDomain.slice(0, 128) });
        log.warn('[DeepLinks] Rejected invalid ask-ai domain param');
      }

      log.info('[DeepLinks] Ask AI context received:', { text: text.slice(0, 50), domain, title });

      // Wait for mainWindow to be available (app might be launching)
      const waitForWindow = async (): Promise<BrowserWindow | null> => {
        if (mainWindow) return mainWindow;
        
        // Wait up to 10 seconds for window to be created
        for (let i = 0; i < 100; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (mainWindow) return mainWindow;
        }
        return null;
      };

      const window = await waitForWindow();

      if (window) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();

        // Wait for window to be ready before sending IPC
        if (!window.webContents.isLoading()) {
          window.webContents.send('open-xyne-ai-with-context', {
            text,
            url: sourceUrl,
            domain,
            title,
            timestamp: Date.now(),
          });
        } else {
          // Wait for page to finish loading
          window.webContents.once('did-finish-load', () => {
            window.webContents.send('open-xyne-ai-with-context', {
              text,
              url: sourceUrl,
              domain,
              title,
              timestamp: Date.now(),
            });
          });
        }

        Logger.info(EnrollmentEvent.DEEP_LINK_OPENED, {
          url: 'ask-ai',
          origin: 'chrome-extension',
          hasText: !!text,
          domain,
        });
      } else {
        log.error('[DeepLinks] No window available after timeout');
      }
    } catch (error) {
      Logger.logError(EnrollmentEvent.DEEP_LINK_HANDLING_FAILED, error, {
        type: 'ask-ai',
      });
      log.error('Failed to handle ask-ai deep link:', error);
    }
    return;
  }

  // 3. Invite Deep Link Case
  // e.g. xyne-spaces://invite?workspaceId=xxx&invitationId=yyy
  if (url.startsWith(`${config.DEEP_LINK_PROTOCOL}://invite`)) {
    try {
      const urlObj = new URL(url);
      const workspaceId = urlObj.searchParams.get('workspaceId');
      const rawInvitationId = urlObj.searchParams.get('invitationId');
      const invitationId = isHexToken(rawInvitationId, INVITATION_ID_BYTE_SIZE)
        ? rawInvitationId
        : null;
      if (rawInvitationId !== null && invitationId === null) {
        Logger.error(ElectronEvent.DEEP_LINK_INVITATION_REJECTED, {
          value: rawInvitationId,
        });
      }

      log.info('[DeepLinks] Invite deep link received:', { workspaceId, invitationId });

      // Wait for mainWindow to be available (app might be launching)
        const waitForWindow = async (): Promise<BrowserWindow | null> => {
        if (mainWindow) return mainWindow;
        
        // Wait up to 10 seconds for window to be created
        for (let i = 0; i < 100; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (mainWindow) return mainWindow;
        }
        return null;
      };

      const window = await waitForWindow();

      if (!window) {
        log.error('[DeepLinks] No window available after timeout for invite deep link');
        return;
      }

      if (invitationId) {
        // Set the invitation cookie directly in Electron
        const cookie = {
          url: config.BACKEND_URL,
          name: 'pending_invitation_id',
          value: invitationId,
          httpOnly: false,
          secure: false,
          sameSite: 'lax' as const,
          expirationDate: Math.floor(Date.now() / 1000) + 600, // 10 minutes
        };
        Logger.info(ElectronEvent.SET_PENDING_INVITATION_COOKIE, {
          invitationId,
        });

        try {
          await session.defaultSession.cookies.set(cookie);
          log.info('[DeepLinks] Set pending_invitation_id cookie successfully:', cookie);
          
          // Verify the cookie was set
          const cookies = await session.defaultSession.cookies.get({
            url: config.BACKEND_URL,
            name: 'pending_invitation_id'
          });
          log.info('[DeepLinks] Verified cookies:', cookies.map(c => c.name));
          log.info('[DeepLinks] Cookie details:', cookies)
        } catch (cookieError) {
          log.error('[DeepLinks] Failed to set cookie:', cookieError);
        }
      }

      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      
      // Set invitationId in localStorage BEFORE navigation so it survives auth
      // redirect. invitationId is validated as hex above, safe to interpolate.
      if (invitationId) {
        window.webContents.executeJavaScript(
          `localStorage.setItem('pending_invitation_id', '${invitationId}');`,
        );
      }

      // URLSearchParams encodes the values (no query/route injection).
      const inviteParams = new URLSearchParams();
      if (workspaceId) inviteParams.set('workspaceId', workspaceId);
      if (invitationId) inviteParams.set('invitationId', invitationId);
      const pathStr = `/invite?${inviteParams.toString()}`;

      log.info('[DeepLinks] Navigating to:', pathStr);
      window.webContents.send('navigate-to', pathStr);
      
      Logger.info(EnrollmentEvent.DEEP_LINK_OPENED, {
        url: 'invite',
        workspaceId,
        hasInvitationId: !!invitationId,
      });
    } catch (error) {
      Logger.logError(EnrollmentEvent.DEEP_LINK_HANDLING_FAILED, error, {
        type: 'invite',
      });
      log.error('[DeepLinks] Failed to handle invite deep link:', error);
    }
    return;
  }

  // 4. Generic Navigation Case
  // e.g. xyne-spaces://chat/123 or xyne-spaces:///chat/123
  if (url.startsWith(`${config.DEEP_LINK_PROTOCOL}://`)) {
    // Strip protocol
    let pathStr = url.slice(`${config.DEEP_LINK_PROTOCOL}://`.length);

    // Handle cases like xyne-spaces://chat/123 vs xyne-spaces:///chat/123
    // If it starts with a slash, keep it. If not, add it.
    // But wait, "pathStr" might be "chat/123" or "/chat/123".
    // We want "/chat/123".

    if (!pathStr.startsWith('/')) {
      pathStr = '/' + pathStr;
    }

    // Only well-formed in-app route paths are forwarded: protocol-relative prefixes,
    // backslashes, traversal and non-route character sets are all rejected.
    if (!isSafeDeepLinkPath(pathStr)) {
      log.warn('[DeepLinks] Rejected unsafe deep-link navigation path:', pathStr);
      return;
    }

    log.info('Navigating to deep link route:', pathStr);

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('navigate-to', pathStr);
    }
  }
}

function exchangeAuthCode(code: string, state: string, invitationId: string | null): Promise<void> {
  Logger.info(EnrollmentEvent.AUTH_EXCHANGE_START);
  log.info('[exchangeAuthCode] Starting with invitationId:', invitationId);
  
  return new Promise(async (resolve) => {    
    const url = `${config.BACKEND_URL}/api/auth/exchange-electron`;
    try {
      if (!mainWindow) {
        log.error('[DeepLinks] No mainWindow available for auth exchange');
        resolve();
        return;
      }
      const warmupScript = `
        fetch('${config.BACKEND_URL}/api/health', { credentials: 'include' })
          .then(r => r.ok)
          .catch(() => false)
      `;
      await mainWindow.webContents.executeJavaScript(warmupScript).catch(() => {});      
      const request = net.request({
        method: 'POST',
        url: url,
        session: session.defaultSession,
      });

      request.setHeader('Content-Type', 'application/json');

      request.on('response', async (response) => {
        if (response.headers['set-cookie']) {
          await setCookiesFromHeaders(response.headers['set-cookie'], config.BACKEND_URL);
        }

        log.info('Auth exchange response status:', response.statusCode);

        if (response.statusCode === 200) {
          try {
            const responseBody = await parseResponseBody(response);
            Logger.info(EnrollmentEvent.AUTH_EXCHANGE_SUCCESS);

            // If the backend signals a pending invitation, navigate the renderer to the
            // in-app accept page. The accept page calls acceptInvitation + loginWorkspace
            // which sets JWT cookies; the subsequent full-page reload completes auth normally.
            if (responseBody.hasInvitation) {
              const invitePath = `/invite?loginComplete=true&invitationId=${encodeURIComponent(responseBody.invitationId)}&loggedInEmail=${encodeURIComponent(responseBody.loggedInEmail)}`;
              log.info('[exchangeAuthCode] Invitation flow — navigating renderer to:', invitePath);
              // Use executeJavaScript to set window.location.href directly.
              // We cannot use 'navigate-to' IPC here because NotificationHandler (which handles it)
              // is only mounted inside ProtectedRoute and is unavailable during 'authenticating' state.
              // A full-page reload cleanly resets authMachine to unauthenticated, after which
              // React Router renders /invite?loginComplete=true and AcceptInvitation takes over.
              mainWindow?.show();
              mainWindow?.webContents.executeJavaScript(
                `window.location.href = ${JSON.stringify(invitePath)}`
              ).catch((err: Error) => {
                log.error('[exchangeAuthCode] Failed to navigate to invite page:', err);
              });
              resolve();
              return;
            }

            log.info('[exchangeAuthCode] Auth exchange successful, notifying main window with workspace data.');
            setTimeout(() => {
              mainWindow?.webContents.send('auth:success', {
                workspaces: responseBody.workspaces || [],
                email: responseBody.email,
                name: responseBody.name,
                picture: responseBody.picture,
                userExistsButRemoved: responseBody.userExistsButRemoved || false,
              });
              forwardAuthEventToClawOverlay('auth:success');
              mainWindow?.show();
              resolve();
            }, 500);
          } catch (parseError) {
            log.error('[exchangeAuthCode] Failed to parse exchange response:', parseError);
            Logger.info(EnrollmentEvent.AUTH_EXCHANGE_SUCCESS);
            setTimeout(() => {
              mainWindow?.webContents.send('auth:success');
              forwardAuthEventToClawOverlay('auth:success');
              mainWindow?.show();
              resolve();
            }, 500);
          }
        } else {
          Logger.error(EnrollmentEvent.AUTH_EXCHANGE_FAILED, {
            statusCode: response.statusCode,
          });
          
          log.warn('[exchangeAuthCode] Auth exchange failed with status:', response.statusCode);
          resolve();
        }
      });

      request.on('error', (error) => {
        log.error('Auth exchange request error', error);
        Logger.logError(EnrollmentEvent.AUTH_EXCHANGE_FAILED, error);
        resolve();
      });

      request.write(JSON.stringify({ code, state, invitationId }));
      request.end();
      
    } catch (error) {
      log.error('Auth exchange request error', error);
      Logger.logError(EnrollmentEvent.AUTH_EXCHANGE_FAILED, error);
      resolve();
    }
  });
}

function exchangeMTLSAuthCode(code: string, state: string, invitationId: string | null): Promise<void> {
  log.info('Exchanging MTLS auth code:', { code: !!code, state: !!state, invitationId });
  Logger.info(EnrollmentEvent.AUTH_EXCHANGE_START, {
    type: 'mtls',
  });

  return new Promise((resolve) => {

    const request = net.request({
      method: 'POST',
      url: `${config.MTLS_BACKEND_URL}/api/auth/exchange-electron`,
      session: session.defaultSession,
    });

    request.setHeader('Content-Type', 'application/json');

    request.on('response', async (response) => {

      if (response.headers['set-cookie']) {
        await setCookiesFromHeaders(response.headers['set-cookie'], config.MTLS_BACKEND_URL);
      }

      log.info('MTLS exchange response status:', response.statusCode);

      if (response.statusCode === 200) {
        try {
          const responseBody = await parseResponseBody(response);
          Logger.info(EnrollmentEvent.AUTH_EXCHANGE_SUCCESS, {
            type: 'mtls',
          });

          // If the backend signals a pending invitation, navigate the renderer to the
          // in-app accept page (same as regular auth flow)
          if (responseBody.hasInvitation) {
            const invitePath = `/invite?loginComplete=true&invitationId=${encodeURIComponent(responseBody.invitationId)}&loggedInEmail=${encodeURIComponent(responseBody.loggedInEmail)}`;
            log.info('[exchangeMTLSAuthCode] Invitation flow — navigating renderer to:', invitePath);
            mainWindow?.show();
            mainWindow?.webContents.executeJavaScript(
              `window.location.href = ${JSON.stringify(invitePath)}`
            ).catch((err: Error) => {
              log.error('[exchangeMTLSAuthCode] Failed to navigate to invite page:', err);
            });
            resolve();
            return;
          }

          setTimeout(() => {
            mainWindow?.webContents.send('auth:mtls-success', {
              workspaces: responseBody.workspaces || [],
              email: responseBody.email,
              name: responseBody.name,
              picture: responseBody.picture,
              userExistsButRemoved: responseBody.userExistsButRemoved || false,
            });
            forwardAuthEventToClawOverlay('auth:mtls-success');
            mainWindow?.show();
            resolve();
          }, 500);
        } catch (parseError) {
          log.error('[exchangeMTLSAuthCode] Failed to parse exchange response:', parseError);
          Logger.info(EnrollmentEvent.AUTH_EXCHANGE_SUCCESS, {
            type: 'mtls',
          });
          setTimeout(() => {
            mainWindow?.webContents.send('auth:mtls-success');
            forwardAuthEventToClawOverlay('auth:mtls-success');
            mainWindow?.show();
            resolve();
          }, 500);
        }
      } else {
        Logger.error(EnrollmentEvent.AUTH_EXCHANGE_FAILED, {
          statusCode: response.statusCode,
          type: 'mtls',
        });

        resolve();
      }
    });

    request.on('error', (error) => {
      log.error('MTLS exchange request error', error);
      Logger.logError(EnrollmentEvent.AUTH_EXCHANGE_FAILED, error, {
        type: 'mtls',
      });
    });
    request.write(JSON.stringify({ code, state, invitationId }));
    request.end();
  });
}
