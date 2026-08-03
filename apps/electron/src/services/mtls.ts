import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { keychain } from '../keychain';
import log from 'electron-log/main';
import { Logger } from './logger/Logger';
import { EnrollmentEvent } from './logger/enrollment-events';
import { config } from '../app/config';

export function normalizeCertificateRequestHostname(target: string): string | null {
    const value = target.trim();
    if (!value) {
        return null;
    }

    const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value);

    try {
        const parsed = new URL(hasScheme ? value : `https://${value}`);
        if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.hostname) {
            return null;
        }
        return parsed.hostname.toLowerCase();
    } catch {
        return null;
    }
}

export function certificateRequestIsAllowed(target: string, allowedHosts: ReadonlySet<string>): boolean {
    const hostname = normalizeCertificateRequestHostname(target);
    return hostname !== null && allowedHosts.has(hostname);
}

export function selectClientCertificate<T>(
    target: string,
    allowedHosts: ReadonlySet<string>,
    certificates: readonly T[],
): T | undefined {
    if (!certificateRequestIsAllowed(target, allowedHosts)) {
        return undefined;
    }
    return certificates[0];
}

// The device identity client certificate must only be presented to the Xyne backend/auth hosts —
// never to an arbitrary server that requests one, which would leak the device identity to a foreign
// origin (secops #345). The allowlist is derived from the mTLS-protected endpoints in config.
function allowedMtlsHosts(): Set<string> {
    const hosts = new Set<string>();
    for (const u of [config.BACKEND_URL, config.MTLS_BACKEND_URL, config.MTLS_FRONTEND_URL, config.FRONTEND_URL]) {
        try {
            if (u) {
                const hostname = normalizeCertificateRequestHostname(u);
                if (hostname) {
                    hosts.add(hostname);
                }
            }
        } catch {
            // ignore malformed config entries
        }
    }
    return hosts;
}

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

        // Only present the device identity certificate to allowlisted Xyne hosts (secops #345).
        const allowlist = allowedMtlsHosts();
        const requestHost = normalizeCertificateRequestHostname(url);
        if (!requestHost || !allowlist.has(requestHost)) {
            log.warn(`[mTLS] Refusing client certificate to non-allowlisted host: ${requestHost || url}`);
            Logger.warn(EnrollmentEvent.CERTIFICATE_INVALID, { url, error: 'host_not_allowlisted' });
            event.preventDefault();
            callback(undefined); // present NO certificate to foreign hosts
            return;
        }

        log.info(`[mTLS] Candidates found: ${list.length}`);

        // INVARIANT: only first-party hosts reach this point — the allowedMtlsHosts()
        // gate at the top of this handler has already declined (preventDefault +
        // callback(undefined)) every non-allowlisted host, and selectClientCertificate()
        // below re-checks the allowlist. Do not add a selection path here that bypasses
        // either check.
        event.preventDefault();

        if (list.length > 0) {
            const cert = selectClientCertificate(url, allowlist, list);
            if (!cert) {
                callback(undefined);
                return;
            }
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
