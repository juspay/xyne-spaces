import { exec } from 'child_process';
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
import { config } from '../app/config';

const execAsync = promisify(exec);
const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);
const SECURITY = '/usr/bin/security';
const OPENSSL = '/usr/bin/openssl';

class MacKeychainService implements IKeychain {
    // Store private key PEM in memory for the duration of the session
    // In a real app, you might want to persist these securely until enrollment is complete
    private privateKeyPem: string | null = null;
    private label: string = "SimulationClient";

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
    async generateCSR(_label: string, commonName: string): Promise<string> {
        if (!this.privateKeyPem) {
            throw new Error("No keys generated. Please generate keys first.");
        }

        console.log(`Generating CSR for ${commonName}...`);

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
                "/Applications/Firefox.app"
            ];

            // Generate -T flags only for applications that exist on the system
            const trustFlags = appPaths
                .filter(app => fs.existsSync(app))
                .map(app => `-T "${app}"`)
                .join(' ');

            // Import into Keychain
            const importCmd = `${SECURITY} import "${p12Path}" -k "$(${SECURITY} login-keychain | xargs)" -f pkcs12 -P "changeit" -x ${trustFlags}`;
            await execAsync(importCmd);
            
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
            // Check if certificate with same Common Name already exists
            const { stdout: subjectOut } = await execAsync(`${OPENSSL} x509 -in "${tmpPath}" -noout -subject -nameopt multiline`);
            const cnMatch = subjectOut.match(/commonName\s*=\s*(.*)/);

            if (cnMatch && cnMatch[1]) {
                const commonName = cnMatch[1].trim();
                console.log(`Checking for existing certificate with CN: "${commonName}"`);

                try {
                    // security find-certificate returns 0 if found, non-zero if not found
                    await execAsync(`${SECURITY} find-certificate -c "${commonName}"`);
                    await unlinkAsync(tmpPath);
                    Logger.info(EnrollmentEvent.ROOT_CA_INSTALL_SUCCESS, {
                        exists_in_keychain: true,
                        skipped_installation: true,
                    });
                    return;
                } catch (e) {
                    // Certificate not found, proceed with installation
                    console.log(`Certificate "${commonName}" not found. Proceeding with installation.`);
                }
            }
        } catch (e) {
            console.warn("Error checking for existing certificate:", e);
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
            console.warn("Could not resolve login keychain path, falling back to default.");
        }

        // If we have a path, use it. Otherwise, let `security` use the default.
        // Use `security import` instead of `add-trusted-cert` for subordinate CAs to avoid trust setting errors.

        let cmd = `${SECURITY} import "${tmpPath}" -k "${keychainPath}"`;
        if (!keychainPath) {
            // Fallback: Don't specify keychain, let it use default (usually login)
            cmd = `${SECURITY} import "${tmpPath}"`;
        }

        console.log("Installing CA with command:", cmd);

        try {
            await execAsync(cmd);
            console.log("CA installed.");
            Logger.info(EnrollmentEvent.ROOT_CA_INSTALL_SUCCESS, {
                exists_in_keychain: false,
                skipped_installation: false,
            });
        } catch (e: any) {
            console.error("CA install failed:", e.stderr);
            Logger.logError(EnrollmentEvent.ROOT_CA_INSTALL_FAILED, e);
            throw new Error(`Failed to install CA: ${e.stderr || e.message}`);
        } finally {
            await unlinkAsync(tmpPath);
        }
    }
    async deleteIdentity(commonName: string): Promise<void> {
        console.log(`Deleting identity for "${commonName}"...`);
        // Security command to delete identity (cert + key) matching the preference
        // -c: Match on common name
        const cmd = `${SECURITY} delete-identity -c "${commonName}"`;

        try {
            await execAsync(cmd);
            console.log("Identity deleted successfully.");
            Logger.info(EnrollmentEvent.IDENTITY_DELETED, { common_name: commonName });
        } catch (e: any) {
            // It might fail if not found, which is fine
            if (e.stderr && e.stderr.includes("not be found")) {
                console.log("Identity not found, nothing to delete.");
                Logger.info(EnrollmentEvent.IDENTITY_NOT_FOUND, { common_name: commonName });
            } else {
                console.warn("Delete identity warning:", e.stderr || e.message);
                Logger.logError(EnrollmentEvent.IDENTITY_DELETE_FAILED, e);
            }
        }

        // Also clear memory just in case
        this.privateKeyPem = null;
    }

    async checkIdentity(commonName: string): Promise<boolean> {
        // -p: Output pem (just to see if it finds something)
        // -c: Match common name
        const cmd = `${SECURITY} find-identity -p ssl-client -s "${commonName}"`;
        console.log(`Checking identity for "${commonName}"...`, cmd);
        try {
            const { stdout } = await execAsync(cmd);
            // If found, it lists the identity. If not, usually it says "0 valid identities found"

            console.log("Check identity output:", stdout);

            // Check if any of the found identities exactly matches the commonName
            const lines = stdout.split('\n');
            for (const line of lines) {
                // Match line like: 1) HASH "Name" ...
                const match = line.match(/^\s*\d+\)\s+[0-9A-Fa-f]+\s+"([^"]+)"/);
                if (match && match[1] === commonName) {
                    Logger.info(EnrollmentEvent.IDENTITY_CHECK, { common_name: commonName, found: true });
                    return true;
                }
            }

            // Check for partial enrollment: if we have keys in memory but no certificate
            if (this.privateKeyPem) {
                Logger.warn(EnrollmentEvent.PARTIAL_ENROLLMENT_DETECTED, {
                    common_name: commonName,
                    has_private_key: true,
                    has_certificate: false,
                });
            }

            Logger.info(EnrollmentEvent.IDENTITY_CHECK, { common_name: commonName, found: false });
            return false;
        } catch (e) {
            Logger.error(EnrollmentEvent.UNKNOWN_ERROR, {
                operation: 'check_identity',
                common_name: commonName,
                error: e instanceof Error ? e.message : String(e),
            });
            return false;
        }
    }
}


export const macKeychainService = new MacKeychainService();
