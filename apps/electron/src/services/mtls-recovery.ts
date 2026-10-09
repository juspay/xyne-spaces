/**
 * Runtime recovery from a device certificate the backend will not accept any more.
 *
 * The certificate used to be checked only during loadApp(), so one that expired or was revoked
 * mid-session left the window on a dashboard whose every request failed with
 * ERR_BAD_SSL_CLIENT_AUTH_CERT, with no way out but quitting and reopening the app.
 *
 * The signal is the TLS error itself. Nothing here tracks when the certificate is due to expire:
 * expiry, revocation and a server-side rejection are indistinguishable at this layer and all
 * three surface the same way, as a refused handshake against one of our own hosts. A handful of
 * requests fail first, which is an acceptable price for having one trigger instead of a clock to
 * keep in sync.
 */

import { BrowserWindow } from 'electron';
import log from 'electron-log/main';

import { config } from '../app/config';
import { keychain } from '../keychain';
// Cycle with window/manager is fine: the binding is only read inside a function body, long after
// both modules have finished loading.
import { getMainWindow } from '../window/manager';
import { Logger } from './logger/Logger';
import { EnrollmentEvent } from './logger/enrollment-events';
import { EnrollmentReason, setEnrollmentReason } from './enrollment-reason';

/**
 * Client-auth failures needed before the threshold path fires. One is not enough: a flaky network
 * or a single racing request would otherwise wipe a healthy certificate.
 */
const FAILURE_THRESHOLD = 3;

/** Failures older than this are forgotten, so unrelated blips never accumulate into recovery. */
const FAILURE_WINDOW_MS = 60 * 1000;

let failureTimestamps: number[] = [];
let recoveryInFlight = false;

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
 * Called whenever a subresource or XHR to one of our hosts fails TLS client authentication.
 * Recovery runs once FAILURE_THRESHOLD failures land inside FAILURE_WINDOW_MS.
 */
export function reportClientAuthFailure(context: { url?: string; errorCode?: string }): void {
    const now = Date.now();
    failureTimestamps = failureTimestamps.filter(ts => now - ts < FAILURE_WINDOW_MS);
    failureTimestamps.push(now);

    log.warn(
        `[mTLSRecovery] Client-auth failure ${failureTimestamps.length}/${FAILURE_THRESHOLD}`,
        context,
    );

    if (failureTimestamps.length < FAILURE_THRESHOLD) return;

    void recoverFromDeadCertificate({
        detail: context.errorCode,
        trigger: 'client_auth_failures',
    });
}

/**
 * Recovers immediately, with no threshold.
 *
 * Used where one failure is already conclusive: a top-level navigation to one of our own hosts
 * that the server refused on client-auth grounds. There is nothing to debounce — the user is
 * looking at a page that did not load, and retrying with the same certificate cannot help.
 */
export async function recoverFromClientAuthFailure(
    context: { url?: string; errorCode?: string; trigger: string },
): Promise<void> {
    await recoverFromDeadCertificate({
        detail: context.errorCode,
        trigger: context.trigger,
    });
}

/**
 * The single recovery path: record why, remove the unusable identity, send the main window to
 * enrollment. Latched so concurrent triggers produce one recovery, not several competing
 * navigations.
 *
 * The reason is always "rejected". The backend refusing our certificate is all we observe, and
 * claiming to know it had expired would mean keeping a copy of its notAfter in sync with the
 * keystore — the thing this path exists to avoid.
 */
export async function recoverFromDeadCertificate(
    options: { detail?: string; trigger?: string } = {},
): Promise<void> {
    if (recoveryInFlight) {
        log.info('[mTLSRecovery] Recovery already in progress — ignoring duplicate trigger');
        return;
    }
    recoveryInFlight = true;
    failureTimestamps = [];

    const reason = EnrollmentReason.CERTIFICATE_REJECTED;

    Logger.warn(EnrollmentEvent.CERTIFICATE_RECOVERY_STARTED, {
        reason,
        trigger: options.trigger,
        detail: options.detail,
    });

    // Recorded before anything destructive so the enrollment screen can explain itself even if
    // the app is killed between here and the navigation below.
    setEnrollmentReason(reason, {
        ...(options.detail ? { detail: options.detail } : {}),
    });

    // Must be the main window by identity, never "whatever BrowserWindow comes first".
    //
    // The app keeps several small always-on-top windows alive — the recording pill, the tray
    // renderer, the claw overlay — and picking by array position navigated one of those to the
    // enrollment page instead: a 156x162 panel pinned to the screen edge, showing the enrollment
    // flow on top of whatever the user was doing, and never restored to its own content.
    const mainWindow = getMainWindow();

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
        // No main window — the app is running in the tray with nothing to navigate. Conjuring a
        // window here would interrupt the user; the reason is already persisted, so the next
        // launch opens on enrollment and explains itself.
        log.warn('[mTLSRecovery] No main window to show enrollment; deferring to next launch');
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

/** Test seam: clears the failure window and recovery latch between cases. */
export function resetRecoveryStateForTests(): void {
    failureTimestamps = [];
    recoveryInFlight = false;
}
