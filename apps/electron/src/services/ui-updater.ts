import { app, BrowserWindow, net } from 'electron';
import { createWriteStream, existsSync, mkdirSync, rmSync, renameSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { pipeline } from 'stream/promises';
import { createHash } from 'crypto';
import path from 'path';
import log from 'electron-log/main';
import {config} from '../app/config';

// Track if there's a staged update waiting to be applied when window loses focus
let hasStagedUpdatePending = false;
// Store blur listener cleanup function
let blurListenerCleanup: (() => void) | null = null;

export interface ReleaseConfig {
  version: string; // Config schema version
  config: {
    boot_timeout: number;
    release_config_timeout: number;
    version: string; // UUID - unique release identifier
    properties: {
      zip_version: string;
      [key: string]: unknown;
    };
  };
  package: {
    name: string;
    version: string;
    index: {
      file_path: string;
      url: string;
      checksum: string; 
    };
    properties: Record<string, unknown>;
    resources: unknown[];
  };
}

interface LocalReleaseConfig extends ReleaseConfig {
  downloadedAt: string;
}


export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  releaseNotes?: string;
}

const getUIDataDir = () => path.join(app.getPath('userData'), 'ui-data');
const getUIActivePath = () => path.join(getUIDataDir(), 'ui-active');
const getUIStagingPath = () => path.join(getUIDataDir(), 'ui-staging');
const getReleaseConfigPath = () => path.join(getUIDataDir(), 'release-config.json');
const getStagingConfigPath = () => path.join(getUIDataDir(), 'staging-config.json');

function getBundledUIPath(): string {
  if (app.isPackaged) {
    // Production: UI is bundled inside the app resources
    const bundledPath = path.join(process.resourcesPath, 'app.asar', 'ui-active');
    log.info('[UIUpdater] getBundledUIPath (packaged):', bundledPath);
    log.info('[UIUpdater] process.resourcesPath:', process.resourcesPath);
    return bundledPath;
  } else {
    // Development: UI is in the electron/ui-active folder
    const bundledPath = path.join(app.getAppPath(), 'ui-active');
    log.info('[UIUpdater] getBundledUIPath (dev):', bundledPath);
    return bundledPath;
  }
}

/**
 * Recursively copy a directory, supporting asar archives
 * Uses individual file operations which work with Electron's asar support
 */
function copyDirRecursive(src: string, dest: string): void {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src);
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    
    const stats = statSync(srcPath);
    
    if (stats.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      const content = readFileSync(srcPath);
      writeFileSync(destPath, content);
    }
  }
}

/**
 * Copy bundled UI to Application Support on first launch
 */
function copyBundledUIToActive(): void {
  const bundledPath = getBundledUIPath();
  const activePath = getUIActivePath();
  
  log.info('[UIUpdater] Copying bundled UI from:', bundledPath);
  log.info('[UIUpdater] Copying bundled UI to:', activePath);
  
  if (!existsSync(bundledPath)) {
    log.error('[UIUpdater] Bundled UI not found at:', bundledPath);
    // List contents of resourcesPath to debug
    try {
      const resourcesPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
      log.info('[UIUpdater] Listing resourcesPath:', resourcesPath);
      const contents = readdirSync(resourcesPath);
      log.info('[UIUpdater] Contents of resourcesPath:', contents);
    } catch (e) {
      log.error('[UIUpdater] Failed to list resourcesPath:', e);
    }
    return;
  }
  
  const bundledIndexPath = path.join(bundledPath, 'index.html');
  log.info('[UIUpdater] Checking for bundled index.html at:', bundledIndexPath);
  log.info('[UIUpdater] Bundled index.html exists:', existsSync(bundledIndexPath));
  
  const parentDir = path.dirname(activePath);
  if (!existsSync(parentDir)) {
    log.info('[UIUpdater] Creating parent directory:', parentDir);
    mkdirSync(parentDir, { recursive: true });
  }
  
  try {
    log.info('[UIUpdater] Starting recursive copy from asar...');
    copyDirRecursive(bundledPath, activePath);
    log.info('[UIUpdater] Bundled UI copied to active successfully');
    
    const activeIndexPath = path.join(activePath, 'index.html');
    log.info('[UIUpdater] Verifying active index.html at:', activeIndexPath);
    log.info('[UIUpdater] Active index.html exists:', existsSync(activeIndexPath));
  } catch (copyError) {
    log.error('[UIUpdater] Failed to copy bundled UI:', copyError);
  }
}


function ensureDirectories(): void {
  const dirs = [getUIDataDir(), getUIActivePath(), getUIStagingPath()];
  dirs.forEach(dir => {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  });
}

/**
 * Read active release config (currently applied version)
 */
function getActiveReleaseConfig(): LocalReleaseConfig | null {
  try {
    const configFile = getReleaseConfigPath();
    if (existsSync(configFile)) {
      const content = readFileSync(configFile, 'utf-8');
      return JSON.parse(content) as LocalReleaseConfig;
    }
  } catch (error) {
    log.error('[UIUpdater] Failed to read active release config:', error);
  }
  return null;
}

/**
 * Read staging release config (pending update)
 */
function getStagingReleaseConfig(): ReleaseConfig | null {
  try {
    const configFile = getStagingConfigPath();
    if (existsSync(configFile)) {
      const content = readFileSync(configFile, 'utf-8');
      return JSON.parse(content) as ReleaseConfig;
    }
  } catch (error) {
    log.error('[UIUpdater] Failed to read staging release config:', error);
  }
  return null;
}

/**
 * Save staging release config (for pending update)
 */
function saveStagingReleaseConfig(remoteConfig: ReleaseConfig): void {
  writeFileSync(getStagingConfigPath(), JSON.stringify(remoteConfig, null, 2));
}

/**
 * Save active release config (after applying update)
 */
function saveActiveReleaseConfig(config: ReleaseConfig): void {
  const localConfig: LocalReleaseConfig = {
    ...config,
    downloadedAt: new Date().toISOString(),
  };
  writeFileSync(getReleaseConfigPath(), JSON.stringify(localConfig, null, 2));
}

export function hasPendingUpdate(): boolean {
  const stagingPath = getUIStagingPath();
  const indexPath = path.join(stagingPath, 'index.html');
  return existsSync(indexPath) && getStagingReleaseConfig() !== null;
}

/**
 * Apply pending update from staging to active
 */
export function applyPendingUpdate(): boolean {
  try {
    const stagingPath = getUIStagingPath();
    const activePath = getUIActivePath();
    const stagingConfig = getStagingReleaseConfig();
    
    if (!hasPendingUpdate() || !stagingConfig) {
      log.info('[UIUpdater] No pending update to apply');
      return false;
    }
    
    log.info('[UIUpdater] Applying pending update...');
    
    // Remove current active
    if (existsSync(activePath)) {
      rmSync(activePath, { recursive: true, force: true });
    }
    
    // Move staging to active
    renameSync(stagingPath, activePath);
    
    // Remove staging config
    const stagingConfigPath = getStagingConfigPath();
    if (existsSync(stagingConfigPath)) {
      rmSync(stagingConfigPath);
    }
    
    // Recreate empty staging directory
    mkdirSync(stagingPath, { recursive: true });
    
    log.info('[UIUpdater] Update applied successfully:', stagingConfig.package.version);
    return true;
  } catch (error) {
    log.error('[UIUpdater] Failed to apply update:', error);
    return false;
  }
}


export function getActiveUIPath(): string {
  const activePath = getUIActivePath();
  const indexPath = path.join(activePath, 'index.html');
  
  log.info('[UIUpdater] getActiveUIPath called');
  log.info('[UIUpdater] activePath:', activePath);
  log.info('[UIUpdater] indexPath:', indexPath);
  log.info('[UIUpdater] index.html exists:', existsSync(indexPath));
  
  // If ui-active doesn't exist or is invalid, copy from bundled
  if (!existsSync(indexPath)) {
    log.info('[UIUpdater] ui-active not found, copying bundled UI...');
    copyBundledUIToActive();
  }
  
  return activePath;
}

async function fetchReleaseConfig(): Promise<ReleaseConfig | null> {
  try {
    log.info('[UIUpdater] Fetching release config from:', config.RELEASE_CONFIG_URL);
    
    const response = await net.fetch(config.RELEASE_CONFIG_URL, {
      headers: {
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      log.error('[UIUpdater] Release config fetch failed:', response.status);
      return null;
    }
    
    return await response.json() as ReleaseConfig;
  } catch (error) {
    log.error('[UIUpdater] Failed to fetch release config:', error);
    return null;
  }
}

/**
 * Check if update is needed by comparing zip_version from config.properties
 * The zip_version is a semantic version for each release
 */
function needsUpdate(local: LocalReleaseConfig | null, remote: ReleaseConfig): boolean {
  if (!local) return true;
  // Compare the zip_version from properties - this changes with each new release
  return local.config.properties.zip_version !== remote.config.properties.zip_version;
}

export async function checkForUIUpdate(): Promise<UpdateCheckResult> {
  try {
    const activeConfig = getActiveReleaseConfig();
    const remoteConfig = await fetchReleaseConfig();
    
    if (!remoteConfig) {
      return {
        updateAvailable: false,
        currentVersion: activeConfig?.package.version || null,
        latestVersion: null,
      };
    }
    
    const updateAvailable = needsUpdate(activeConfig, remoteConfig);
    
    return {
      updateAvailable,
      currentVersion: activeConfig?.package.version || null,
      latestVersion: remoteConfig.package.version,
    };
  } catch (error) {
    log.error('[UIUpdater] Check failed:', error);
    return {
      updateAvailable: false,
      currentVersion: null,
      latestVersion: null,
    };
  }
}

/**
 * Verify the extracted OTA bundle against the signed release manifest.
 *
 * The Airborne manifest pins a raw SHA-256 (hex) of the bundle's index file at
 * `package.index.checksum` / `package.index.file_path`. We recompute it over the extracted
 * file and reject on any mismatch — an unverifiable or tampered bundle must never be staged.
 * Throws (aborting the update) on a missing checksum, missing/escaping index file, or mismatch.
 */
function verifyBundleChecksum(bundlePath: string, remoteConfig: ReleaseConfig): void {
  const expected = remoteConfig.package.index.checksum?.trim().toLowerCase();
  const indexRelPath = remoteConfig.package.index.file_path?.trim();

  if (!expected || !indexRelPath) {
    throw new Error('Release manifest is missing an index checksum/path; refusing unverifiable update');
  }

  // The file_path comes from a remote manifest — resolve it and confirm it stays inside the
  // bundle so a crafted "../.." path cannot point the hash at an arbitrary file.
  const bundleRoot = path.resolve(bundlePath);
  const indexAbsPath = path.resolve(bundleRoot, indexRelPath);
  if (indexAbsPath !== bundleRoot && !indexAbsPath.startsWith(bundleRoot + path.sep)) {
    throw new Error(`Manifest index file_path escapes the bundle directory: ${indexRelPath}`);
  }
  if (!existsSync(indexAbsPath)) {
    throw new Error(`UI bundle is missing its index file (${indexRelPath}); cannot verify integrity`);
  }

  const actual = createHash('sha256').update(readFileSync(indexAbsPath)).digest('hex');
  if (actual !== expected) {
    throw new Error(
      `UI bundle checksum mismatch for ${indexRelPath}: expected ${expected}, got ${actual}`,
    );
  }

  log.info('[UIUpdater] Bundle checksum verified:', indexRelPath);
}

/**
 * Download UI update to staging directory
 */
export async function downloadUIUpdate(): Promise<boolean> {
  ensureDirectories();
  
  try {
    const remoteConfig = await fetchReleaseConfig();
    if (!remoteConfig) {
      log.error('[UIUpdater] Failed to fetch release config');
      return false;
    }
    
    const stagingPath = getUIStagingPath();
    const tempDownloadPath = path.join(getUIDataDir(), 'temp-download');
    const zipPath = path.join(tempDownloadPath, 'ui-update.zip');
    
    // Clean temp download directory
    if (existsSync(tempDownloadPath)) {
      rmSync(tempDownloadPath, { recursive: true, force: true });
    }
    mkdirSync(tempDownloadPath, { recursive: true });
    
    // Clean staging directory
    if (existsSync(stagingPath)) {
      rmSync(stagingPath, { recursive: true, force: true });
    }
    mkdirSync(stagingPath, { recursive: true });
    
    // Download the zip file from configured URL (dashboard.zip served by nginx)
    const downloadUrl = config.UI_ZIP_URL;
    log.info('[UIUpdater] Downloading from:', downloadUrl);
    
    const response = await net.fetch(downloadUrl);
    if (!response.ok || !response.body) {
      throw new Error(`Download failed: ${response.status}`);
    }
    
    const fileStream = createWriteStream(zipPath);
    // Convert web ReadableStream to Node.js readable stream
    const reader = response.body.getReader();
    const nodeStream = new (await import('stream')).Readable({
      async read() {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
        } else {
          this.push(Buffer.from(value));
        }
      }
    });
    
    await pipeline(nodeStream, fileStream);
    
    log.info('[UIUpdater] Download complete');
    
    
    // Extract the zip
    log.info('[UIUpdater] Extracting...');
    
    const extractPath = path.join(tempDownloadPath, 'extracted');
    mkdirSync(extractPath, { recursive: true });
    
    // Dynamic import for extract-zip (ESM module)
    const { default: extract } = await import('extract-zip');
    await extract(zipPath, { dir: extractPath });
    
    // Find the directory containing index.html (may be nested in a subfolder)
    let uiBundlePath = extractPath;
    const directIndexPath = path.join(extractPath, 'index.html');
    
    if (!existsSync(directIndexPath)) {
      // Check if index.html is in a subdirectory (common ZIP structure)
      const { readdirSync } = await import('fs');
      const entries = readdirSync(extractPath, { withFileTypes: true });
      const subDirs = entries.filter(e => e.isDirectory());
      
      let found = false;
      for (const dir of subDirs) {
        const nestedIndexPath = path.join(extractPath, dir.name, 'index.html');
        if (existsSync(nestedIndexPath)) {
          uiBundlePath = path.join(extractPath, dir.name);
          found = true;
          log.info('[UIUpdater] Found UI bundle in subdirectory:', dir.name);
          break;
        }
      }
      
      if (!found) {
        throw new Error('Invalid UI bundle: index.html not found');
      }
    }
    
    // Integrity gate: verify the downloaded bundle against the signed release manifest
    // BEFORE staging it. The manifest pins a SHA-256 of the bundle's index file
    // (package.index.file_path, e.g. .vite/manifest.json). A mismatch means the bytes we
    // fetched are not the release the manifest describes — tampered CDN, MITM, or a
    // truncated download — so we refuse the update rather than run untrusted UI code.
    verifyBundleChecksum(uiBundlePath, remoteConfig);

    // Move UI bundle to staging
    renameSync(uiBundlePath, stagingPath);
    
    // Save staging config (marks pending update)
    saveStagingReleaseConfig(remoteConfig);
    
    // Clean up temp download
    rmSync(tempDownloadPath, { recursive: true, force: true });
    
    log.info('[UIUpdater] Update downloaded to staging:', remoteConfig.package.version);
    
    // Check if window is visible - if visible, wait for blur; if not visible, apply immediately
    // Note: isFocused() can return false even when the user is looking at the window
    // (e.g., if they clicked on the desktop or another app momentarily)
    // isVisible() is more reliable for determining if the user can see the window
    const mainWindow = BrowserWindow.getAllWindows()[0];
   
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      const isFocused = mainWindow.isFocused();
      const isVisible = mainWindow.isVisible();
      const isFullScreen = mainWindow.isFullScreen();
      log.info('[UIUpdater] Checking window state - isFocused:', isFocused, 'isVisible:', isVisible, 'isFullScreen:', isFullScreen);
      
      if (isVisible) {
        // User can see the window, wait until they switch away
        hasStagedUpdatePending = true;
        setupBlurListener(mainWindow, remoteConfig);
      } else {
        log.info('[UIUpdater] Window NOT visible, applying update immediately...');
        void applyAndReload(mainWindow, remoteConfig);
      }
    } else {
      log.info('[UIUpdater] No valid window found, skipping update application');
    }
    
    return true;
  } catch (error) {
    log.error('[UIUpdater] Update failed:', error);
    return false;
  }
}


function setupBlurListener(mainWindow: BrowserWindow, releaseConfig: ReleaseConfig): void {
  if (blurListenerCleanup) {
    blurListenerCleanup();
    blurListenerCleanup = null;
  }
    
  const onBlur = () => {
    log.info('[UIUpdater] Blur event received, hasStagedUpdatePending:', hasStagedUpdatePending);
    if (hasStagedUpdatePending && !mainWindow.isDestroyed()) {
      log.info('[UIUpdater] Window lost focus, applying staged update...');
      void applyAndReload(mainWindow, releaseConfig);
    }
  };
  
  mainWindow.on('blur', onBlur);
  log.info('[UIUpdater] Blur listener attached successfully');
  // Store cleanup function
  blurListenerCleanup = () => {
    mainWindow.removeListener('blur', onBlur);
  };
}

/**
 * Apply the staged update and reload the window without cache
 */
async function applyAndReload(mainWindow: BrowserWindow, releaseConfig: ReleaseConfig): Promise<void> {
  // Clean up blur listener
  if (blurListenerCleanup) {
    blurListenerCleanup();
    blurListenerCleanup = null;
  }
  
  hasStagedUpdatePending = false;
  
  // Apply the update
  const applied = applyPendingUpdate();
  if (!applied) {
    log.error('[UIUpdater] Failed to apply pending update');
    return;
  }
  
  saveActiveReleaseConfig(releaseConfig);
  
  // Reload the window with new UI (clear cache first)
  if (!mainWindow.isDestroyed()) {
    log.info('[UIUpdater] Clearing network cache and reloading window with new UI...');
    
    try {
      const session = mainWindow.webContents.session;
      
      // Clear network cache (where bundles and assets are cached)
      await session.clearCache();
      log.info('[UIUpdater] Network cache cleared');
    } catch (error) {
      log.error('[UIUpdater] Error clearing cache:', error);
    }
    
    const bundledUrl = `${config.DEEP_LINK_PROTOCOL}://./`;
    void mainWindow.loadURL(bundledUrl);
  }
}

/**
 * Initialize UI updater
 * - Checks for pending updates on startup and applies them
 * - Downloads updates in background
 * - Applies updates when window is not focused (user switched away)
 */
export async function initializeUIUpdater(): Promise<void> {
  log.info('[UIUpdater] Initializing...');
  ensureDirectories();
  
  const activeConfig = getActiveReleaseConfig();
  log.info('[UIUpdater] Current active version:', activeConfig?.package.version || 'none (using bundled)');
  
  // Check for pending update from previous session and apply it
  if (hasPendingUpdate()) {
    log.info('[UIUpdater] Found pending update, applying...');
    applyPendingUpdate();
  }
  
  // Check for updates in background (don't block app startup)
  setTimeout(async () => {
    const result = await checkForUIUpdate();
    if (result.updateAvailable && result.latestVersion) {
      log.info('[UIUpdater] Update available:', result.latestVersion);
      await downloadUIUpdate();
    }
  }, 30000); // Wait 30 seconds after app start

  setInterval(async () => {
    log.info('[UIUpdater] Periodic update check...');
    const result = await checkForUIUpdate();
    if (result.updateAvailable && result.latestVersion) {
      log.info('[UIUpdater] Update available:', result.latestVersion);
      await downloadUIUpdate();
    }
  }, config.uiUpdateCheckIntervalMs); 
}
