import { app, net, session, BrowserWindow, IncomingMessage } from 'electron';
import path from 'path';
import { config } from '../app/config';
import { setCookiesFromHeaders } from './cookies';
import log from 'electron-log/main';
import { Logger } from './logger/Logger';
import { EnrollmentEvent } from './logger/enrollment-events';
import ElectronEvent from './logger/electron-events';

let mainWindow: BrowserWindow | null = null;

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

  // 1. Auth Callback Case
  if (url.startsWith(`${config.DEEP_LINK_PROTOCOL}://auth/callback`)) {
    try {
      const urlObj = new URL(url);
      const code = urlObj.searchParams.get('code');
      const state = urlObj.searchParams.get('state');
      const invitationId = urlObj.searchParams.get('invitationId');

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
      const text = urlObj.searchParams.get('text') || '';
      const sourceUrl = urlObj.searchParams.get('url') || '';
      const domain = urlObj.searchParams.get('domain') || '';
      const title = urlObj.searchParams.get('title') || '';

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
      const invitationId = urlObj.searchParams.get('invitationId');

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
      
      // Set invitationId in localStorage BEFORE navigation
      // This ensures it's available even if auth redirect happens
      if (invitationId) {
        window.webContents.executeJavaScript(`
          localStorage.setItem('pending_invitation_id', '${invitationId}');
        `);
      }
      
      // Navigate to invite page with params
      const pathStr = invitationId 
        ? `/invite?workspaceId=${workspaceId}&invitationId=${invitationId}`
        : `/invite?workspaceId=${workspaceId}`;
      
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

    log.info('Navigating to deep link route:', pathStr);

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
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

            // If this was a calendar re-auth, navigate straight to the calls page
            // without triggering the full auth:success flow (user is already logged in).
            // Use window.location.href (full reload) instead of 'navigate-to' IPC because
            // the new session cookies set above cause authMachine to briefly reset, which
            // unmounts NotificationHandler (the navigate-to listener) before it fires.
            if (responseBody.connectCalendar && responseBody.workspaceId) {
              const callsPath = `/${responseBody.workspaceId}/calls?tab=upcoming&syncCalendar=true`;
              log.info('[exchangeAuthCode] connectCalendar — navigating to calls page:', callsPath);
              mainWindow?.show();
              mainWindow?.webContents.executeJavaScript(
                `window.location.href = ${JSON.stringify(callsPath)}`
              ).catch((err: Error) => {
                log.error('[exchangeAuthCode] Failed to navigate to calls page:', err);
              });
              resolve();
              return;
            }

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
              mainWindow?.show();
              resolve();
            }, 500);
          } catch (parseError) {
            log.error('[exchangeAuthCode] Failed to parse exchange response:', parseError);
            Logger.info(EnrollmentEvent.AUTH_EXCHANGE_SUCCESS);
            setTimeout(() => {
              mainWindow?.webContents.send('auth:success');
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
