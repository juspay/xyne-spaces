import { net } from 'electron';
import log from 'electron-log/main';
import { config } from '../app/config';
import { getMainWindow } from '../window/manager';

interface VersionInfo {
  version: string;
  buildTime?: number;
}

let versionCheckInterval: NodeJS.Timeout | null = null;
const VERSION_CHECK_INTERVAL_MS = 600000; // Check every 10 minute
const VERSION_FETCH_TIMEOUT_MS = 10000; // 10 second timeout for fetching version

/**
 * Fetch the latest version from the frontend server
 */
async function fetchLatestVersion(): Promise<VersionInfo | null> {
  const versionUrl = `${config.FRONTEND_URL}/version.json`;
  
  return new Promise((resolve) => {
    const request = net.request(versionUrl);
    let data = '';
    let resolved = false;

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        log.warn('[VersionChecker] Request timed out fetching version.json');
        request.abort();
        resolve(null);
      }
    }, VERSION_FETCH_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeoutId);
    };

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        cleanup();
        if (!resolved) {
          resolved = true;
          log.warn(`[VersionChecker] Failed to fetch version.json: HTTP ${response.statusCode}`);
          resolve(null);
        }
        return;
      }

      response.on('data', (chunk) => {
        data += chunk.toString();
      });

      response.on('end', () => {
        cleanup();
        if (!resolved) {
          resolved = true;
          try {
            const versionInfo = JSON.parse(data) as VersionInfo;
            resolve(versionInfo);
          } catch (error) {
            log.error('[VersionChecker] Failed to parse version.json:', error);
            resolve(null);
          }
        }
      });
    });

    request.on('error', (error) => {
      cleanup();
      if (!resolved) {
        resolved = true;
        log.error('[VersionChecker] Failed to fetch version.json:', error);
        resolve(null);
      }
    });

    request.end();
  });
}

/**
 * Get the current version loaded in the webview
 */
async function getCurrentLoadedVersion(): Promise<string | null> {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    return null;
  }

  try {
    const version = await mainWindow.webContents.executeJavaScript('window.__APP_VERSION__');
    return version || null;
  } catch (error) {
    log.error('[VersionChecker] Failed to get current loaded version:', error);
    return null;
  }
}

/**
 * Notify the frontend that an update is available
 */
function notifyUpdateAvailable(currentVersion: string, latestVersion: string): void {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    log.warn('[VersionChecker] Cannot notify - main window not available');
    return;
  }

  log.info('[VersionChecker] Notifying frontend about available update');
  mainWindow.webContents.send('app-update-available', {
    currentVersion,
    latestVersion,
    loadType: 'manual',
  });
}

/**
 * Perform a hard reload of the main window without cache (called when user clicks update button or on auto-update)
 * Clears network cache before reloading for a fresh start
 */
export async function performHardReload(): Promise<void> {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    log.warn('[VersionChecker] Cannot reload - main window not available');
    return;
  }

  log.info('[VersionChecker] Performing hard reload of main window (clearing cache)...');
  
  try {
    const session = mainWindow.webContents.session;
    
    // Clear network cache (where bundles and assets are cached)
    await session.clearCache();
    log.info('[VersionChecker] Network cache cleared');
    
    // Reload ignoring any remaining cache
    mainWindow.webContents.reloadIgnoringCache();
    log.info('[VersionChecker] Hard reload initiated');
  } catch (error) {
    log.error('[VersionChecker] Error during hard reload:', error);
    // Fallback to simple reload if cache clearing fails
    mainWindow.webContents.reloadIgnoringCache();
  }
}

/**
 * Check for version mismatch and reload if necessary
 */
async function checkVersionAndReload(): Promise<void> {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    log.debug('[VersionChecker] Skipping check - main window not available');
    return;
  }
  if (mainWindow.isFocused()) {
    log.debug('[VersionChecker] Skipping check - window is focused');
    return;
  }
  let [latestVersionInfo, currentVersion] = await Promise.all([
    fetchLatestVersion(),
    getCurrentLoadedVersion(),
  ]);

  if (!latestVersionInfo) {
    log.debug('[VersionChecker] Could not fetch latest version');
    return;
  }

  if (!currentVersion) {
    log.debug('[VersionChecker] Could not get current loaded version');
    currentVersion = "unknown"
  }

  log.info(`[VersionChecker] Current version: ${currentVersion}, Latest version: ${latestVersionInfo.version}`);

  if (latestVersionInfo.version && currentVersion !== latestVersionInfo.version) {
   
    log.info(`[VersionChecker] Version mismatch detected! Notifying frontend...`);
    notifyUpdateAvailable(currentVersion, latestVersionInfo.version);
     
    
  }
}

/**
 * Start the version checker service
 */
export function startVersionChecker(): void {
  if (versionCheckInterval) {
    log.warn('[VersionChecker] Version checker already running');
    return;
  }

  log.info('[VersionChecker] Starting version checker service');
  
  // Initial check after a short delay to let the app fully load
  setTimeout(() => {
    void checkVersionAndReload();
  }, 10000); // Wait 10 seconds before first check

  // Set up periodic checks
  versionCheckInterval = setInterval(() => {
    void checkVersionAndReload();
  }, VERSION_CHECK_INTERVAL_MS);
}

/**
 * Stop the version checker service
 */
export function stopVersionChecker(): void {
  if (versionCheckInterval) {
    clearInterval(versionCheckInterval);
    versionCheckInterval = null;
    log.info('[VersionChecker] Version checker stopped');
  }
}
