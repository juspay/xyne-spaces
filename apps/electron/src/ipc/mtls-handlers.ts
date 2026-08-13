import { app, ipcMain, IpcMainInvokeEvent } from 'electron';
import * as os from 'os';
import log from 'electron-log/main';

import { keychain } from '../keychain';
import { config } from '../app/config';
import { getBundledUIUrl } from '../services/custom-protocol';
import { getMainWindow, showLoadingOverlay, showWindowError } from '../window/manager';
import { Logger } from '../services/logger/Logger';
import { EnrollmentEvent } from '../services/logger/enrollment-events';
import { safeRecordMetric } from '../services/telemetry';
import { dashboardLoad, enrollmentDone } from '../services/enrollmentMetrics';

const MAX_RETRIES = 3;

interface MainWindowLike {
    isDestroyed(): boolean;
    webContents: {
        mainFrame: unknown;
    };
}

/**
 * Loads a URL with retry logic to handle mTLS timeout issues
 * Retries once if loading fails (typically due to user not approving keychain popup)
 * Shows error page if all retries are exhausted
 */
async function urlLoadWithRetry(fn: () => Promise<void>, attempts = 0): Promise<void> {
    try {
        await fn();
        safeRecordMetric(() => {
            dashboardLoad.add(1, {
                success: 'true',
                buildVersion: app.getVersion(),
            });
        });
    } catch (error) {
        const mainWindow = getMainWindow();

        if(!mainWindow || mainWindow.isDestroyed()){
            log.error('Main window not available for URL load retry');
            throw error;
        }
        await showLoadingOverlay(mainWindow);
        Logger.logError(EnrollmentEvent.URL_LOAD_FAILED, error);
        // If we haven't exceeded max retries, try again
        if (attempts < MAX_RETRIES) {
            Logger.info(EnrollmentEvent.LOAD_URL_RETRY, { retry_attempt: attempts + 1 });
            return await urlLoadWithRetry(fn, attempts + 1);
        }
        else {
            // Max retries exceeded - show error page
            Logger.logError(EnrollmentEvent.URL_LOAD_FAILED, error);
            safeRecordMetric(() => {
                dashboardLoad.add(1, {
                    success: 'false',
                    error: 'max_retries_exceeded',
                    buildVersion: app.getVersion(),
                });
            });
            
            // Load error page with helpful message about system popup approval
            await showWindowError(mainWindow, 'timeout-error.html');
        }
    }
}

/**
 * Gate for the privileged mTLS/keychain IPC handlers. Only the top-level frame of the main
 * application window may invoke them — this blocks renderer-injected content (an XSS'd sub-frame
 * or `<iframe srcdoc>`) from silently driving certificate/keychain operations.
 *
 * The legitimate device-enrollment flow (generate-keys -> generate-csr -> store-certificate) runs
 * in the main window's top frame, so it passes this gate unchanged; only nested/foreign frames are
 * rejected. If enrollment is ever moved into a child frame or a dedicated window, update this check
 * to reference that window's webContents rather than loosening it.
 *
 * Validate both the owning WebContents and the exact current main frame. Identity comparison also
 * rejects iframes and stale frames retained across a navigation.
 */
export function isCurrentMainFrameSender(
    sender: unknown,
    senderFrame: unknown,
    mainWindow: MainWindowLike | null | undefined,
): boolean {
    return Boolean(
        mainWindow
        && !mainWindow.isDestroyed()
        && senderFrame
        && sender === mainWindow.webContents
        && senderFrame === mainWindow.webContents.mainFrame,
    );
}

function assertMainWindowSender(event: IpcMainInvokeEvent): void {
    if (!isCurrentMainFrameSender(event.sender, event.senderFrame, getMainWindow())) {
        log.error('[mTLS] Rejected privileged keychain IPC from a non-main-window sender');
        throw new Error('Unauthorized: mTLS/keychain IPC is restricted to the main application window');
    }
}

export function setupMTLSIpcHandlers(): void {

    // mtls start
    // Privileged mTLS identity operations are restricted to the main window's top frame.
    ipcMain.handle('generate-keys', async (event) => {
        assertMainWindowSender(event);
        Logger.info(EnrollmentEvent.FIRST_TIME_SIGNUP_START);
        return await keychain.generateKeyPair(config.MTLS_IDENTITY_NAME);
    });

    ipcMain.handle('generate-csr', async (event) => {
        assertMainWindowSender(event);
        try {
            const result = await keychain.generateCSR(config.MTLS_IDENTITY_NAME);
            Logger.info(EnrollmentEvent.CSR_GENERATION_SUCCESS);
            return result;
        } catch (error) {
            Logger.logError(EnrollmentEvent.CSR_GENERATION_FAILED, error);
            throw error;
        }
    });

    ipcMain.handle('store-certificate', async (event, pem: string) => {
        assertMainWindowSender(event);
        try {
            await keychain.importCertificate(pem);
            Logger.info(EnrollmentEvent.ENROLLMENT_SUCCESS, { 
                certificate_imported: true,
                next_step: 'loading_frontend'
            });
            
            const bundledUrl = getBundledUIUrl();
            const frontendUrl = config.useBundledUI ? bundledUrl : config.FRONTEND_URL;
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                await showLoadingOverlay(mainWindow);
                await urlLoadWithRetry(async () => {
                    Logger.info(EnrollmentEvent.LOAD_URL, { url: frontendUrl });
                    await mainWindow.loadURL(frontendUrl);
                });
            } else {
                // Fallback: reload the sender with bundled UI
                Logger.info(EnrollmentEvent.LOAD_URL, { fallback: true });
                void event.sender.loadURL(frontendUrl);
            }
            safeRecordMetric(() => {
                enrollmentDone.add(1, {
                    success: 'true',
                    buildVersion: app.getVersion(),
                });
            });
            // Switch logger to use protected URL
            Logger.enablePostEnrollmentLogging();
        } catch (error) {
            Logger.logError(EnrollmentEvent.CERTIFICATE_STORAGE_FAILED, error);
            throw error;
        }
    });

    ipcMain.handle('delete-keys', async (event) => {
        assertMainWindowSender(event);
        return await keychain.deleteIdentity(config.MTLS_IDENTITY_NAME);
    });

    ipcMain.handle('check-keys', async (event) => {
        assertMainWindowSender(event);
        return await keychain.checkIdentity(config.MTLS_IDENTITY_NAME);
    });

    ipcMain.handle('get-device-info', async (event) => {
        assertMainWindowSender(event);
        Logger.info(EnrollmentEvent.DEVICE_INFO_REQUESTED);
        return {
            name: os.hostname(),
            type: os.type(),
            version: os.release()
        };
    });

    // mtls end
}
