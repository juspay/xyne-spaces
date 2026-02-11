import { app, ipcMain } from 'electron';
import * as os from 'os';
import * as path from 'path';
import log from 'electron-log/main';

import { keychain } from '../keychain';
import { config } from '../app/config';
import { getBundledUIUrl } from '../services/custom-protocol';
import { getMainWindow } from '../window/manager';
import { Logger } from '../services/logger/Logger';
import { EnrollmentEvent } from '../services/logger/enrollment-events';
import { safeRecordMetric } from '../services/telemetry';
import { dashboardLoad, enrollmentDone } from '../services/enrollmentMetrics';

const MAX_RETRIES = 3;

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
        const loading_page = path.join(__dirname, '..', '..', 'assets', 'loading.html');
        await mainWindow.loadFile(loading_page);
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
            const errorPage = path.join(__dirname, '..', '..', 'assets', 'timeout-error.html');
            await mainWindow.loadFile(errorPage);
        }
    }
}

export function setupMTLSIpcHandlers(): void {

    // mtls start
    ipcMain.handle('generate-keys', async (_event, label: string) => {
        Logger.info(EnrollmentEvent.FIRST_TIME_SIGNUP_START);
        return await keychain.generateKeyPair(label || 'SimulationClient');
    });

    ipcMain.handle('generate-csr', async (_event, label: string, subject: string) => {
        try {
            const result = await keychain.generateCSR(label || 'SimulationClient', subject);
            Logger.info(EnrollmentEvent.CSR_GENERATION_SUCCESS);
            return result;
        } catch (error) {
            Logger.logError(EnrollmentEvent.CSR_GENERATION_FAILED, error);
            throw error;
        }
    });

    ipcMain.handle('store-certificate', async (event, pem: string) => {
        try {
            const result = await keychain.importCertificate(pem);
            Logger.info(EnrollmentEvent.ENROLLMENT_SUCCESS, { 
                certificate_imported: true,
                next_step: 'loading_frontend'
            });
            
            const bundledUrl = getBundledUIUrl();
            const frontendUrl = config.useBundledUI ? bundledUrl : config.FRONTEND_URL;
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
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
            return result;
        } catch (error) {
            Logger.logError(EnrollmentEvent.CERTIFICATE_STORAGE_FAILED, error);
            throw error;
        }
    });

    ipcMain.handle('install-root-ca', async (_event, pem: string) => {
        return await keychain.installRootCA(pem);
    });

    ipcMain.handle('delete-keys', async (_event, commonName: string) => {
        // Default to our simulation name if not provided (though we expect it to be passed)
        return await keychain.deleteIdentity(commonName || config.MTLS_IDENTITY_NAME);
    });

    ipcMain.handle('check-keys', async (_event, commonName: string) => {
        return await keychain.checkIdentity(commonName || config.MTLS_IDENTITY_NAME);
    });

    ipcMain.handle('get-device-info', async () => {
        Logger.info(EnrollmentEvent.DEVICE_INFO_REQUESTED);
        return {
            name: os.hostname(),
            type: os.type(),
            version: os.release()
        };
    });

    // mtls end
}
