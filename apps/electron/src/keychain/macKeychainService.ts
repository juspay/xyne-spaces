import log from 'electron-log/main';
import { exec, execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { Logger } from '../services/logger/Logger';
import { EnrollmentEvent } from '../services/logger/enrollment-events';
import { devicePasswordPopup } from '../services/enrollmentMetrics';
import { safeRecordMetric } from '../services/telemetry';
import { app } from 'electron';
import { IKeychain } from './IKeychain';
import { X509Certificate } from 'crypto';
import { config } from '../app/config';
import { deviceCaCommonName, deviceIdentityDisplayName, isIssuedByDeviceCa } from './deviceCa';

const execAsync = promisify(exec);
// Shell-free variant (argument array, no /bin/sh) for commands that must handle values parsed
// out of an untrusted certificate — the CommonName below can contain shell metacharacters that
// `openssl -nameopt` does NOT escape ($(), backticks, ...), so it must never reach a shell.
const execFileAsync = promisify(execFile);
const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);
const SECURITY = '/usr/bin/security';
const OPENSSL = '/usr/bin/openssl';

// `security` reports a missing keychain item with a "not be found" message on stderr.
// Single source of truth so the delete-identity paths classify it identically.
function isNotFoundError(e: any): boolean {
    return Boolean(e?.stderr?.includes("not be found"));
}

// Sets keychain labels (native/keychain-label), which `security` cannot do.
function keychainLabelPath(): string {
    const base = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : app.getAppPath();
    return path.join(base, 'native', 'keychain-label', 'keychain-label');
}

class MacKeychainService implements IKeychain {
    // Store private key PEM in memory for the duration of the session
    // In a real app, you might want to persist these securely until enrollment is complete
    private privateKeyPem: string | null = null;
    private label: string = config.MTLS_IDENTITY_LABEL;

    /**
     * SHA-1 hashes of the certificates in the keychain search list issued by the device CA.
     */
    private async findDeviceCertificates(): Promise<Set<string>> {
        const { stdout } = await execFileAsync(SECURITY, ['find-certificate', '-a', '-Z', '-p'], {
            maxBuffer: 64 * 1024 * 1024,
        });
        const hashes = new Set<string>();
        for (const block of stdout.split(/(?=SHA-256 hash:)/)) {
            const sha1 = block.match(/SHA-1 hash:\s*([0-9A-F]+)/i)?.[1];
            const pem = block.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
            if (sha1 && pem && isIssuedByDeviceCa(pem)) {
                hashes.add(sha1.toUpperCase());
            }
        }
        return hashes;
    }

    /**
     * Generates a EC P-384 KeyPair in memory.
     */
    async generateKeyPair(label: string): Promise<void> {
        this.label = label;
        Logger.info(EnrollmentEvent.KEY_GENERATION_START, { label });

        // openssl ecparam -name secp384r1 -genkey -noout
        try {
            const { stdout } = await execAsync(`${OPENSSL} ecparam -name secp384r1 -genkey -noout`);
            this.privateKeyPem = stdout;
            Logger.info(EnrollmentEvent.KEY_GENERATION_SUCCESS, { label });
        } catch (e: any) {
            Logger.logError(EnrollmentEvent.KEY_GENERATION_FAILED, e);
            throw new Error(`KeyPair Generation Failed: ${e.message}`);
        }
    }

    /**
     * Generates a CSR (PKCS#10) using the in-memory keys.
     */
    async generateCSR(commonName: string): Promise<string> {
        if (!this.privateKeyPem) {
            throw new Error("No keys generated. Please generate keys first.");
        }

        log.info(`Generating CSR for ${commonName}...`);

        const keyPath = path.join(os.tmpdir(), `key_${Date.now()}.pem`);
        await writeFileAsync(keyPath, this.privateKeyPem);

        try {
            // openssl req -new -key key.pem -subj "/CN=..." -sha384
            const cmd = `${OPENSSL} req -new -key "${keyPath}" -subj "/CN=${commonName}" -sha384`;
            const { stdout } = await execAsync(cmd);
            return stdout;
        } catch (error) {
            throw error;
        } finally {
            try { await unlinkAsync(keyPath); } catch { }
        }
    }

    /**
     * Names the imported certificate after the device, so keychain and browser prompts show more
     * than the deviceId. `security import` cannot set the label, so the bundled helper does it.
     * Best effort: an unnamed identity still works.
     */
    private async labelIdentity(certPem: string): Promise<void> {
        const label = deviceIdentityDisplayName(certPem);
        const sha1 = new X509Certificate(certPem).fingerprint.replace(/:/g, '');
        try {
            await execFileAsync(keychainLabelPath(), [sha1, label]);
            log.info(`[mTLS] Device identity named "${label}"`);
        } catch (e: any) {
            Logger.warn('keychain.identity.label.failed', { error: e?.stderr || e?.message });
        }
    }

    async importCertificate(certPem: string): Promise<void> {
        if (!this.privateKeyPem) {
            throw new Error("No private key available to create Identity.");
        }

        Logger.info(EnrollmentEvent.CERTIFICATE_IMPORT_START, { label: this.label });
        
        const keyPath = path.join(os.tmpdir(), `key_${Date.now()}.pem`);
        const certPath = path.join(os.tmpdir(), `cert_${Date.now()}.pem`);
        const p12Path = path.join(os.tmpdir(), `identity_${Date.now()}.p12`);

        await writeFileAsync(keyPath, this.privateKeyPem);
        await writeFileAsync(certPath, certPem);

        try {
            // The bundle is a per-call temp file in os.tmpdir(), imported immediately and removed
            // in the finally below. The passphrase is fixed so the export and import agree; use a
            // random one per enrollment if the bundle is ever persisted or moved off-host.
            // openssl pkcs12 -export -in cert.pem -inkey key.pem -out identity.p12 -passout pass:changeit -name "label"
            const p12Cmd = `${OPENSSL} pkcs12 -export -in "${certPath}" -inkey "${keyPath}" -out "${p12Path}" -passout pass:changeit -name "${this.label}"`;
            await execAsync(p12Cmd);

            // Define list of applications to trust
            const appPaths = [
                process.execPath,
                "/Applications/Google Chrome.app",
                "/Applications/Safari.app",
                `/Applications/${config.APP_NAME}.app`,
                "/Applications/Brave Browser.app",
                "/Applications/Firefox.app",
                "/Applications/DuckDuckGo.app",
                "/Applications/Arc.app",
                "/Applications/Opera.app",
                "/Applications/Microsoft Edge.app",
                "/Applications/Vivaldi.app",
                "/Applications/Tor Browser.app",
                "/Applications/Waterfox.app",
                "/Applications/Pale Moon.app",
            ];

            /**
             * Returns true only if the app exists on disk AND passes codesign
             * verification. This prevents a corrupted (or partially-installed)
             * bundle from causing the `security import` command to fail.
             */
            const isAppValid = async (appPath: string): Promise<boolean> => {
                if (!fs.existsSync(appPath)) return false;
                try {
                    await execAsync(`/usr/bin/codesign --verify "${appPath}"`);
                    return true;
                } catch {
                    Logger.warn('keychain.codesign.verification.failed', { app_path: appPath });
                    return false;
                }
            };

            // Generate -T flags only for applications that exist and are not corrupted
            const validApps = (
                await Promise.all(appPaths.map(async (appPath) => ({ appPath, valid: await isAppValid(appPath) })))
            )
                .filter(({ valid }) => valid)
                .map(({ appPath }) => appPath);

            const trustFlags = validApps.map(appPath => `-T "${appPath}"`).join(' ');

            // Import into Keychain
            const importCmd = `${SECURITY} import "${p12Path}" -k "$(${SECURITY} login-keychain | xargs)" -f pkcs12 -P "changeit" -x ${trustFlags}`;
            await execAsync(importCmd);
            await this.labelIdentity(certPem);
            
            safeRecordMetric(() => {
                devicePasswordPopup.add(1, { 
                    success: 'true',
                    reason: 'certificate_import',
                    buildVersion: app.getVersion(),
                });
            });
            Logger.info(EnrollmentEvent.CERTIFICATE_IMPORT_SUCCESS, { label: this.label });

        } catch (e: any) {
            safeRecordMetric(() => {
                devicePasswordPopup.add(1, { 
                    success: 'false',
                    reason: 'certificate_import_failure',
                    buildVersion: app.getVersion(),
                });
            });
            throw new Error(`Keychain Import Failed: ${e.stderr || e.message}`);
        } finally {
            // Cleanup
            try { await unlinkAsync(keyPath); } catch { }
            try { await unlinkAsync(certPath); } catch { }
            try { await unlinkAsync(p12Path); } catch { }

            // Clear memory
            this.privateKeyPem = null;
        }
    }

    async installRootCA(pem: string): Promise<void> {
        Logger.info(EnrollmentEvent.ROOT_CA_INSTALL_START);
        
        const tmpPath = path.join(os.tmpdir(), `root_ca_${Date.now()}.pem`);
        await writeFileAsync(tmpPath, pem);

        try {
            // Check if certificate with same Common Name already exists.
            // execFile (no shell) — the CommonName is parsed out of an attacker-supplied cert and
            // Never interpolated into a shell command.
            const { stdout: subjectOut } = await execFileAsync(OPENSSL, ['x509', '-in', tmpPath, '-noout', '-subject', '-nameopt', 'multiline']);
            const cnMatch = subjectOut.match(/commonName\s*=\s*(.*)/);

            if (cnMatch && cnMatch[1]) {
                const commonName = cnMatch[1].trim();
                log.info(`Checking for existing certificate with CN: "${commonName}"`);

                try {
                    // security find-certificate returns 0 if found, non-zero if not found
                    await execFileAsync(SECURITY, ['find-certificate', '-c', commonName]);
                    await unlinkAsync(tmpPath);
                    Logger.info(EnrollmentEvent.ROOT_CA_INSTALL_SUCCESS, {
                        exists_in_keychain: true,
                        skipped_installation: true,
                    });
                    return;
                } catch {
                    // Certificate not found, proceed with installation
                    log.info(`Certificate "${commonName}" not found. Proceeding with installation.`);
                }
            }
        } catch (e) {
            log.warn("Error checking for existing certificate:", e);
            // Proceed with installation if check fails
        }


        // security add-trusted-cert
        // -d: Add to admin cert store (system-wide) - usually requires sudo, but we are running as user.
        // -r trustRoot: Trust this cert as a Root CA
        // -k: Keychain (login)
        // The user will be prompted for their password to modify Trust Settings.

        // NOTE: The error "SecTrustSettingsSetTrustSettings: One or more parameters passed to a function were not valid"
        // often happens when the keychain path is not correctly resolved or passed.
        // Instead of trying to resolve the keychain path dynamically in the subshell which might fail or return quotes,
        // let's try to target the login keychain implicitly or resolve it in Node first.

        // Attempt 1: Resolve keychain path in Node
        let keychainPath = "";
        try {
            const { stdout } = await execAsync(`${SECURITY} login-keychain | head -n 1 | xargs`);
            keychainPath = stdout.trim();
        } catch (e) {
            log.warn("Could not resolve login keychain path, falling back to default.");
        }

        // If we have a path, use it. Otherwise, let `security` use the default.
        // Use `security import` instead of `add-trusted-cert` for subordinate CAs to avoid trust setting errors.

        let cmd = `${SECURITY} import "${tmpPath}" -k "${keychainPath}"`;
        if (!keychainPath) {
            // Fallback: Don't specify keychain, let it use default (usually login)
            cmd = `${SECURITY} import "${tmpPath}"`;
        }

        log.info("Installing CA with command:", cmd);

        try {
            await execAsync(cmd);
            log.info("CA installed.");
            Logger.info(EnrollmentEvent.ROOT_CA_INSTALL_SUCCESS, {
                exists_in_keychain: false,
                skipped_installation: false,
            });
        } catch (e: any) {
            log.error("CA install failed:", e.stderr);
            Logger.logError(EnrollmentEvent.ROOT_CA_INSTALL_FAILED, e);
            throw new Error(`Failed to install CA: ${e.stderr || e.message}`);
        } finally {
            await unlinkAsync(tmpPath);
        }
    }
    async deleteIdentity(): Promise<void> {
        let issuer = '';
        const logIdentityNotFound = () => {
            log.info("Identity not found, nothing to delete.");
            Logger.info(EnrollmentEvent.IDENTITY_NOT_FOUND, { issuer });
        };
        try {
            issuer = deviceCaCommonName();
            log.info(`Deleting identities issued by "${issuer}"...`);
            const hashes = await this.findDeviceCertificates();

            if (hashes.size === 0) {
                logIdentityNotFound();
                return;
            }

            let deletedCount = 0;
            for (const hash of hashes) {
                // The same hash can exist in more than one keychain in the search list, and
                // `delete-identity -Z` removes only the first match, so loop until the keychain
                // reports the hash can no longer be found.
                while (true) {
                    try {
                        // Hash uniquely identifies one identity even when common names are duplicated.
                        await execFileAsync(SECURITY, ['delete-identity', '-Z', hash]);
                        deletedCount++;
                        continue;
                    } catch (identityError: any) {
                        if (!isNotFoundError(identityError)) {
                            throw identityError;
                        }
                    }

                    // No identity left for this hash; a partial enrollment may still have left a
                    // bare certificate without its private key. Swallow a not-found here so a
                    // concurrent removal (or an item outside the search list) does not abort
                    // deletion of the remaining hashes.
                    try {
                        await execFileAsync(SECURITY, ['delete-certificate', '-Z', hash]);
                        deletedCount++;
                    } catch (certError: any) {
                        if (!isNotFoundError(certError)) {
                            throw certError;
                        }
                        break;
                    }
                }
            }

            log.info(`Deleted ${deletedCount} identity certificate(s) successfully.`);
            Logger.info(EnrollmentEvent.IDENTITY_DELETED, {
                issuer,
                deleted_count: deletedCount,
            });
        } catch (e: any) {
            if (isNotFoundError(e)) {
                logIdentityNotFound();
            } else {
                log.error("Delete identity failed:", e.stderr || e.message);
                Logger.logError(EnrollmentEvent.IDENTITY_DELETE_FAILED, e);
                throw e;
            }
        } finally {
            // Also clear memory just in case
            this.privateKeyPem = null;
        }
    }

    async checkIdentity(): Promise<boolean> {
        let issuer = '';
        try {
            issuer = deviceCaCommonName();
            log.info(`Checking for an identity issued by "${issuer}"...`);
            const deviceCertificates = await this.findDeviceCertificates();

            // find-identity lists certificates that have a matching private key, by SHA-1 hash.
            // No -p policy: `-p ssl-client` evaluates the chain as an SSL server certificate
            // and hides identities whose EKU is clientAuth only.
            const { stdout } = await execFileAsync(SECURITY, ['find-identity']);
            const found = [...stdout.matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s/gim)]
                .some((match) => deviceCertificates.has(match[1].toUpperCase()));

            // Check for partial enrollment: if we have keys in memory but no certificate
            if (!found && this.privateKeyPem) {
                Logger.warn(EnrollmentEvent.PARTIAL_ENROLLMENT_DETECTED, {
                    issuer,
                    has_private_key: true,
                    has_certificate: false,
                });
            }

            Logger.info(EnrollmentEvent.IDENTITY_CHECK, {
                issuer,
                found,
                device_certificates: deviceCertificates.size,
            });
            return found;
        } catch (e) {
            Logger.error(EnrollmentEvent.UNKNOWN_ERROR, {
                operation: 'check_identity',
                issuer,
                error: e instanceof Error ? e.message : String(e),
            });
            return false;
        }
    }
}


export const macKeychainService = new MacKeychainService();
