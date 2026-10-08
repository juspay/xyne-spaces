/**
 * Runtime recovery from a device certificate that stops working while the app is open.
 *
 * Before this, the certificate was only validated during loadApp(). A certificate that expired or
 * was rejected mid-session left the window on a dashboard whose every request failed with
 * ERR_BAD_SSL_CLIENT_AUTH_CERT, and the only way out was to quit and reopen the app. Two paths
 * close that gap:
 *
 *  - proactive: the issued certificate's notAfter is persisted at enrollment time and checked on a
 *    timer, on resume from sleep and on window focus, so an expiry is caught before the user sees
 *    a single failed request;
 *  - reactive: client-auth TLS failures against our own hosts are reported here and, past a small
 *    threshold, trigger the same recovery — this covers revocation and server-side rejection,
 *    which no local clock check can predict.
 *
 * Both end in one place: record why, drop the dead identity, and navigate to enrollment.
 */

import { BrowserWindow, powerMonitor, app } from 'electron';
import { X509Certificate } from 'crypto';
import Store from 'electron-store';
import log from 'electron-log/main';

import { config } from '../app/config';
import { keychain } from '../keychain';
import { Logger } from './logger/Logger';
import { EnrollmentEvent } from './logger/enrollment-events';
import {
    EnrollmentReason,
    type EnrollmentReasonType,
    setEnrollmentReason,
} from './enrollment-reason';

const CERT_NOT_AFTER_KEY = 'mtls.certificateNotAfter';
const CERT_SERIAL_KEY = 'mtls.certificateSerial';

/** How often the stored notAfter is re-checked while the app is open. */
const EXPIRY_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Treat the certificate as dead slightly before notAfter. Clock skew between device and backend
 * means the backend can start rejecting it a little early; recovering first is strictly better
 * than letting the user hit a wall of failed requests.
 */
const EXPIRY_SKEW_MS = 2 * 60 * 1000;

/**
 * Consecutive client-auth TLS failures needed before the reactive path fires. One is not enough:
 * a flaky network or a single racing request would otherwise wipe a healthy certificate.
 */
const FAILURE_THRESHOLD = 3;

/** Failures older than this are forgotten, so unrelated blips never accumulate into recovery. */
const FAILURE_WINDOW_MS = 60 * 1000;

const store = new Store();

let failureTimestamps: number[] = [];
let recoveryInFlight = false;
let expiryTimer: NodeJS.Timeout | null = null;

/**
 * TLS errors that mean "the client certificate we presented is not acceptable". Server-trust
 * errors are deliberately excluded — those are a server/CA problem and deleting the device
 * identity would not help.
 */
const CLIENT_AUTH_ERROR_CODES = [
    'ERR_BAD_SSL_CLIENT_AUTH_CERT',
    'ERR_SSL_CLIENT_AUTH_SIGNATURE_FAILED',
    'ERR_SSL_CLIENT_AUTH_CERT_NEEDED',
    'ERR_SSL_CLIENT_AUTH_NO_COMMON_ALGORITHMS',
];

export function isClientAuthFailure(errorText: string | undefined | null): boolean {
    if (!errorText) return false;
    const upper = errorText.toUpperCase();
    return CLIENT_AUTH_ERROR_CODES.some(code => upper.includes(code));
}

/**
 * Persists the validity window of a freshly enrolled certificate.
 *
 * Parsed in-process with node's X509 reader rather than by shelling out, so it works identically
 * on all three platforms and needs none of the external tooling the Linux keystore depends on.
 */
export function recordIssuedCertificate(certPem: string): void {
    try {
        const cert = new X509Certificate(certPem);
        const notAfter = new Date(cert.validTo);
        if (Number.isNaN(notAfter.getTime())) {
            throw new Error(`Unparseable notAfter: ${cert.validTo}`);
        }
        store.set(CERT_NOT_AFTER_KEY, notAfter.toISOString());
        store.set(CERT_SERIAL_KEY, cert.serialNumber);
        log.info('[mTLSRecovery] Stored certificate validity until', notAfter.toISOString());
    } catch (error) {
        // Not fatal: without the stored date the proactive check is skipped and the reactive
        // path still recovers the user.
        log.warn('[mTLSRecovery] Could not read notAfter from issued certificate:', error);
    }
}

export function getStoredCertificateExpiry(): Date | null {
    const raw = store.get(CERT_NOT_AFTER_KEY);
    if (typeof raw !== 'string') return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clearStoredCertificateMetadata(): void {
    try {
        store.delete(CERT_NOT_AFTER_KEY as never);
        store.delete(CERT_SERIAL_KEY as never);
    } catch (error) {
        log.warn('[mTLSRecovery] Could not clear stored certificate metadata:', error);
    }
}

/**
 * True when the stored certificate is past (notAfter - skew). Unknown expiry returns false:
 * a device enrolled before this field existed must not be treated as expired.
 */
export function isStoredCertificateExpired(now: number = Date.now()): boolean {
    const notAfter = getStoredCertificateExpiry();
    if (!notAfter) return false;
    return now >= notAfter.getTime() - EXPIRY_SKEW_MS;
}

/**
 * Called whenever a request to one of our hosts fails TLS client authentication. Recovery only
 * runs once FAILURE_THRESHOLD failures land inside FAILURE_WINDOW_MS.
 */
export function reportClientAuthFailure(context: { url?: string; errorCode?: string }): void {
    const now = Date.now();
    failureTimestamps = failureTimestamps.filter(ts => now - ts < FAILURE_WINDOW_MS);
    failureTimestamps.push(now);

    log.warn(
        `[mTLSRecovery] Client-auth failure ${failureTimestamps.length}/${FAILURE_THRESHOLD}`,
        context,
    );

    if (failureTimestamps.length < FAILURE_THRESHOLD) {
        return;
    }

    // An expired local certificate and a server-side rejection look identical at this layer;
    // the stored notAfter is what tells them apart for the user-facing message.
    const reason: EnrollmentReasonType = isStoredCertificateExpired()
        ? EnrollmentReason.CERTIFICATE_EXPIRED
        : EnrollmentReason.CERTIFICATE_REJECTED;

    void recoverFromDeadCertificate(reason, {
        detail: context.errorCode,
        trigger: 'client_auth_failures',
    });
}

/**
 * Checks the stored expiry and recovers if it has passed. Safe to call often.
 */
export async function checkCertificateExpiry(trigger: string): Promise<void> {
    if (!config.enableMtls) return;

    const notAfter = getStoredCertificateExpiry();
    if (!notAfter) return;

    const msRemaining = notAfter.getTime() - Date.now();
    Logger.info(EnrollmentEvent.CERTIFICATE_EXPIRY_CHECK, {
        trigger,
        not_after: notAfter.toISOString(),
        days_remaining: Math.floor(msRemaining / 86_400_000),
    });

    if (!isStoredCertificateExpired()) return;

    Logger.warn(EnrollmentEvent.CERTIFICATE_EXPIRED, {
        trigger,
        not_after: notAfter.toISOString(),
    });

    await recoverFromDeadCertificate(EnrollmentReason.CERTIFICATE_EXPIRED, {
        certificateExpiredAt: notAfter.toISOString(),
        trigger,
    });
}

/**
 * The single recovery path: record the reason, remove the unusable identity, send the window to
 * enrollment. Latched so concurrent triggers (a timer tick racing a burst of failed requests)
 * produce one recovery, not several competing navigations.
 */
export async function recoverFromDeadCertificate(
    reason: EnrollmentReasonType,
    options: { certificateExpiredAt?: string; detail?: string; trigger?: string } = {},
): Promise<void> {
    if (recoveryInFlight) {
        log.info('[mTLSRecovery] Recovery already in progress — ignoring duplicate trigger');
        return;
    }
    recoveryInFlight = true;
    failureTimestamps = [];

    const certificateExpiredAt =
        options.certificateExpiredAt ?? getStoredCertificateExpiry()?.toISOString();

    Logger.warn(EnrollmentEvent.CERTIFICATE_RECOVERY_STARTED, {
        reason,
        trigger: options.trigger,
        detail: options.detail,
    });

    // Recorded before anything destructive so the enrollment screen can explain itself even if
    // the app is killed between here and the navigation below.
    setEnrollmentReason(reason, {
        ...(certificateExpiredAt ? { certificateExpiredAt } : {}),
        ...(options.detail ? { detail: options.detail } : {}),
    });

    const mainWindow = BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) ?? null;

    // Stop the dead page first: a dashboard mid-reconnect keeps firing requests that all fail
    // client auth, which is exactly the noise the user described as "all calls fail".
    try {
        mainWindow?.webContents.stop();
    } catch (error) {
        log.warn('[mTLSRecovery] Could not stop current page load:', error);
    }

    try {
        await keychain.deleteIdentity(config.MTLS_IDENTITY_NAME);
    } catch (error) {
        // Must not abort: enrollment is the only recovery action available to the user, so we
        // continue there even when the old identity could not be removed.
        log.error('[mTLSRecovery] Failed to delete dead identity; continuing to enrollment:', error);
        Logger.logError(EnrollmentEvent.IDENTITY_DELETE_FAILED, error, { reason });
    }

    clearStoredCertificateMetadata();

    try {
        await navigateToEnrollment(mainWindow);
        Logger.info(EnrollmentEvent.CERTIFICATE_RECOVERY_REDIRECTED, {
            reason,
            url: config.MTLS_FRONTEND_URL,
        });
    } catch (error) {
        Logger.logError(EnrollmentEvent.MTLS_FRONTEND_LOAD_FAILED, error, { reason });
        log.error('[mTLSRecovery] Failed to load enrollment page:', error);
    } finally {
        // Released only after the navigation settles, so the next genuine failure can recover
        // again (e.g. the replacement certificate is also rejected).
        recoveryInFlight = false;
    }
}

/**
 * Sends the main window to the enrollment host. Enrollment is served over the non-mTLS auth
 * origin, so it loads even though the device no longer has a usable certificate.
 */
async function navigateToEnrollment(mainWindow: BrowserWindow | null): Promise<void> {
    if (!mainWindow || mainWindow.isDestroyed()) {
        log.error('[mTLSRecovery] No window available to show enrollment');
        return;
    }

    if (!mainWindow.isVisible()) {
        mainWindow.show();
    }
    mainWindow.focus();

    Logger.info(EnrollmentEvent.MTLS_FRONTEND_LOAD, {
        url: config.MTLS_FRONTEND_URL,
        has_certificate: false,
        trigger: 'runtime_recovery',
    });
    await mainWindow.loadURL(config.MTLS_FRONTEND_URL);
}

/**
 * Starts the proactive expiry watch. Idempotent.
 *
 * A plain interval is not enough on its own: a laptop asleep past notAfter wakes with a stale
 * timer, so resume and window focus are also checked.
 */
export function startCertificateExpiryWatcher(): void {
    if (!config.enableMtls || expiryTimer) return;

    expiryTimer = setInterval(() => {
        void checkCertificateExpiry('interval');
    }, EXPIRY_CHECK_INTERVAL_MS);

    powerMonitor.on('resume', () => {
        void checkCertificateExpiry('power_resume');
    });

    app.on('browser-window-focus', () => {
        void checkCertificateExpiry('window_focus');
    });

    app.once('will-quit', stopCertificateExpiryWatcher);

    log.info('[mTLSRecovery] Certificate expiry watcher started');
}

export function stopCertificateExpiryWatcher(): void {
    if (expiryTimer) {
        clearInterval(expiryTimer);
        expiryTimer = null;
    }
}

/** Test seam: clears the failure window and recovery latch between cases. */
export function resetRecoveryStateForTests(): void {
    failureTimestamps = [];
    recoveryInFlight = false;
}
