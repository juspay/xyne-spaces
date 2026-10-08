/**
 * Why the user is looking at the enrollment screen.
 *
 * When the app removes a device certificate on its own — it expired, the backend rejected it,
 * it was revoked — the user is dropped onto enrollment with no explanation and reasonably reads
 * it as the app losing their login. Recording the reason here lets the enrollment page say what
 * happened. It survives the app restart that a certificate failure usually triggers, so the
 * message still appears when the user reopens the app rather than only in the session that broke.
 */

import Store from 'electron-store';
import log from 'electron-log/main';
import { Logger } from './logger/Logger';
import { EnrollmentEvent } from './logger/enrollment-events';

const STORE_KEY = 'mtls.enrollmentReason';

export const EnrollmentReason = {
    /** The certificate's own notAfter had passed; the app deleted it. */
    CERTIFICATE_EXPIRED: 'certificate_expired',
    /** The backend rejected the certificate mid-session (bad client auth cert / signature). */
    CERTIFICATE_REJECTED: 'certificate_rejected',
    /** The certificate was revoked server-side. */
    CERTIFICATE_REVOKED: 'certificate_revoked',
    /** No identity was found in the OS store at startup — ordinary first-run enrollment. */
    CERTIFICATE_MISSING: 'certificate_missing',
} as const;

export type EnrollmentReasonType = (typeof EnrollmentReason)[keyof typeof EnrollmentReason];

export interface EnrollmentReasonRecord {
    reason: EnrollmentReasonType;
    /** ISO timestamp of when the app recorded the reason. */
    recordedAt: string;
    /** ISO timestamp of the certificate's notAfter, when it was known. */
    certificateExpiredAt?: string;
    /** Short technical detail (error code) for support, not for the user-facing sentence. */
    detail?: string;
}

const store = new Store();

/**
 * Records why enrollment is about to be shown. Called immediately before the app deletes an
 * identity or redirects to enrollment, so the record is already in place if the process dies.
 */
export function setEnrollmentReason(
    reason: EnrollmentReasonType,
    extra: { certificateExpiredAt?: string; detail?: string } = {},
): void {
    const record: EnrollmentReasonRecord = {
        reason,
        recordedAt: new Date().toISOString(),
        ...(extra.certificateExpiredAt ? { certificateExpiredAt: extra.certificateExpiredAt } : {}),
        ...(extra.detail ? { detail: extra.detail } : {}),
    };

    try {
        store.set(STORE_KEY, record);
        Logger.info(EnrollmentEvent.ENROLLMENT_REASON_RECORDED, { ...record });
    } catch (error) {
        log.error('[EnrollmentReason] Failed to persist enrollment reason:', error);
    }
}

/**
 * Records a reason only when none is stored yet.
 *
 * The startup path finds "no identity in the keystore" after a recovery has already deleted the
 * expired certificate and explained why; the generic first-run reason must not overwrite that
 * more specific one.
 */
export function setEnrollmentReasonIfAbsent(
    reason: EnrollmentReasonType,
    extra: { certificateExpiredAt?: string; detail?: string } = {},
): void {
    if (getEnrollmentReason()) return;
    setEnrollmentReason(reason, extra);
}

export function getEnrollmentReason(): EnrollmentReasonRecord | null {
    try {
        const record = store.get(STORE_KEY) as EnrollmentReasonRecord | undefined;
        if (!record || typeof record.reason !== 'string') {
            return null;
        }
        return record;
    } catch (error) {
        log.error('[EnrollmentReason] Failed to read enrollment reason:', error);
        return null;
    }
}

/**
 * Clears the record. Called once the enrollment page has shown the message, and
 * unconditionally on a successful enrollment so a stale reason can never resurface.
 */
export function clearEnrollmentReason(): void {
    try {
        store.delete(STORE_KEY as never);
    } catch (error) {
        log.error('[EnrollmentReason] Failed to clear enrollment reason:', error);
    }
}
