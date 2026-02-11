import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { keychain } from '../keychain';
import log from 'electron-log/main';
import { Logger } from './logger/Logger';
import { EnrollmentEvent } from './logger/enrollment-events';

export async function setupMTLS() {
    log.info('[mTLS] setupMTLS called - registering event handlers');

    // Certificate Selection Handler for mTLS (app-level)
    // This handles client certificate selection for requests from webContents
    app.on('certificate-error', (event, _webContents, _url, error, certificate, callback) => {
        log.info(`[mTLS] certificate-error event fired for ${_url}: ${error}`);
        if (error === 'net::ERR_CERT_AUTHORITY_INVALID') {
            try {
                const caPath = path.join(app.getAppPath(), 'certs', 'ca.cert');

                if (fs.existsSync(caPath)) {
                    const caContent = fs.readFileSync(caPath);
                    log.info('[mTLS] Loaded CA certificate for verification.', caContent);
                    const caCert = new crypto.X509Certificate(caContent);
                    const serverCert = new crypto.X509Certificate(certificate.data);

                    if (serverCert.verify(caCert.publicKey)) {
                        event.preventDefault();
                        log.info('[mTLS] Certificate verified successfully against our CA. Proceeding.');
                        callback(true);
                        return;
                    } else {
                        throw new Error('Certificate verification failed');
                    }
                } else {

                    throw new Error('CA certificate not found');
                }
            } catch (e) {
                log.error('Certificate verification failed:', e);
                Logger.logError(EnrollmentEvent.SSL_ERROR, e, { url: _url });
                callback(false);
                return;
            }
        }

        // For self-signed certs (e.g. simulation server), we might need to simulate trust
        // if the system doesn't trust the simulation Root CA yet.
        // However, usually we should let the OS handle trust.
        // If the server certificate is self-signed/untrusted, we might need to bypass:
        // event.preventDefault();
        // callback(true);
        // But for now, we assume the user has trusted the Root CA as per instructions.
        log.warn('[mTLS] Certificate error encountered. Relying on OS trust settings.', error);
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
        const caPath = path.join(app.getAppPath(), 'certs', 'ca.cert');

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