/**
 * Keychain error types shared by the platform keychain services.
 *
 * These exist so callers can tell "the device has no certificate" (a normal state that should
 * send the user to enrollment) apart from "we could not look" (a broken host, which must NOT
 * trigger a destructive re-enrollment). Conflating the two is what caused the Linux
 * re-enrollment loop: `certutil` was missing, the lookup threw, and the caller read the
 * swallowed failure as "no certificate".
 */

/**
 * The platform keychain cannot be used at all because a required external tool is missing.
 * Recoverable only by the user installing the tool, so it carries an install hint to show them.
 */
export class KeychainToolingError extends Error {
    readonly missingTools: readonly string[];
    readonly installHint: string;

    constructor(missingTools: readonly string[], installHint: string) {
        super(
            `Required certificate tool(s) not found: ${missingTools.join(', ')}. ${installHint}`,
        );
        this.name = 'KeychainToolingError';
        this.missingTools = [...missingTools];
        this.installHint = installHint;
    }
}

export function isKeychainToolingError(error: unknown): error is KeychainToolingError {
    return error instanceof KeychainToolingError;
}
