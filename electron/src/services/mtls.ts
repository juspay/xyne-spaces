import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { keychain } from '../keychain';
import log from 'electron-log/main';
import { Logger } from './logger/Logger';
import { EnrollmentEvent } from './logger/enrollment-events';
import { config } from '../app/config';

export async function setupMTLS() {
    log.info('[mTLS] setupMTLS called - registering event handlers');

    // Certificate Selection Handler for mTLS (app-level)
    // This handles client certificate selection for requests from webContents
    app.on('certificate-error', (_event, _webContents, url, error, _certificate, callback) => {
        Logger.logError(EnrollmentEvent.SSL_ERROR, error, { url });
        callback(false);
    });

    app.on('select-client-certificate', (event, _webContents, url, list, callback) => {
        log.info(`[mTLS] Server requested client certificate for ${url}`);
        log.info(`[mTLS] Candidates found: ${list.length}`);

        // Always handle certificate selection (both app.spaces and auth.spaces require mTLS)
        event.preventDefault();

        if (list.length > 0) {
            const cert = list[0];
            log.info(`[mTLS] Selecting certificate: Subject: ${cert.subjectName}, Issuer: ${cert.issuerName}, Serial: ${cert.serialNumber}`);
            callback(cert);
        } else {
            log.warn('[mTLS] No client certificates found matching the server request.');
            log.warn('[mTLS] Please install a valid client certificate in your OS Keychain (macOS) or Certificate Store.');
            Logger.warn(EnrollmentEvent.CERTIFICATE_INVALID, {
                url,
                error: 'no_client_certificate_found',
            });
            callback(undefined);
        }
    });

    // Try to install Root CA if it exists

    try {
        const caCertName = config.USER_DATA_SUFFIX === '-sandbox' ? 'ca.sbx.cert' : 'ca.cert';
        const caPath = path.join(app.getAppPath(), 'certs', caCertName);

        if (fs.existsSync(caPath)) {
            const caContent = fs.readFileSync(caPath, 'utf8');
            // We don't want to prompt for password every time, so maybe we should check if it's already trusted?
            // But keychain.installRootCA uses `security add-trusted-cert` which might prompt.
            // For now, let's just try to install it.
            // Note: This will likely prompt the user for their password on every launch if not handled carefully.
            // Ideally, we should check if it's already in the keychain.
            // But per request, we are calling it.
            log.info('Attempting to install Root CA from:', caPath);
            await keychain.installRootCA(caContent);
        } else {
            log.warn('Root CA not found at:', caPath);
        }
    } catch (error) {
        log.error('Failed to install Root CA:', error);
    }
}