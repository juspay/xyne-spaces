import log from 'electron-log/main';
import { exec, execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { app } from 'electron';
import { Logger } from '../services/logger/Logger';
import { EnrollmentEvent } from '../services/logger/enrollment-events';
import { devicePasswordPopup } from '../services/enrollmentMetrics';
import { safeRecordMetric } from '../services/telemetry';
import { IKeychain } from './IKeychain';

const execAsync = promisify(exec);
// Shell-free variant (argument array, no /bin/sh) for commands that handle a value parsed out of
// an untrusted certificate (the CommonName-derived nickname below), which must never reach a shell.
const execFileAsync = promisify(execFile);
const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);
const mkdirAsync = promisify(fs.mkdir);

const OPENSSL = 'openssl';

/**
 * Linux Keychain Service using NSS database (used by Electron/Chromium on Linux).
 *
 * Chromium on Linux reads client certificates from the NSS database at ~/.pki/nssdb.
 * We use `certutil` and `pk12util` (from libnss3-tools) to manage certificates,
 * and `openssl` for key generation and CSR creation.
 */
class LinuxKeychainService implements IKeychain {
    private privateKeyPem: string | null = null;
    private label: string = "SimulationClient";

    private getNssDbDir(): string {
        return path.join(os.homedir(), '.pki', 'nssdb');
    }

    /**
     * Returns paths to all NSS databases: ~/.pki/nssdb (Chrome) + Firefox profiles.
     */
    private getAllNssDbDirs(): string[] {
        const dirs: string[] = [this.getNssDbDir()];

        // Find Firefox profile NSS databases
        const firefoxDir = path.join(os.homedir(), '.mozilla', 'firefox');
        if (fs.existsSync(firefoxDir)) {
            try {
                const entries = fs.readdirSync(firefoxDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const profileNssDb = path.join(firefoxDir, entry.name);
                        // Check if this directory has an NSS database (cert9.db or cert8.db)
                        if (fs.existsSync(path.join(profileNssDb, 'cert9.db')) ||
                            fs.existsSync(path.join(profileNssDb, 'cert8.db'))) {
                            dirs.push(profileNssDb);
                        }
                    }
                }
            } catch {
                // Firefox not installed or no access — skip
            }
        }

        return dirs;
    }

    /**
     * Ensures the NSS database directory exists and is initialized.
     */
    private async ensureNssDb(): Promise<void> {
        const nssDir = this.getNssDbDir();
        if (!fs.existsSync(nssDir)) {
            await mkdirAsync(nssDir, { recursive: true });
        }

        // Check if the NSS DB is already initialized by looking for cert9.db
        const cert9Path = path.join(nssDir, 'cert9.db');
        if (!fs.existsSync(cert9Path)) {
            // Initialize a new NSS database with an empty password
            await execAsync(`certutil -d sql:${nssDir} -N --empty-password`);
        }
    }

    /**
     * Generates an EC P-384 KeyPair in memory using openssl.
     */
    async generateKeyPair(label: string): Promise<void> {
        this.label = label;
        Logger.info(EnrollmentEvent.KEY_GENERATION_START, { label });

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
     * Generates a CSR (PKCS#10) using the in-memory private key.
     */
    async generateCSR(commonName: string): Promise<string> {
        if (!this.privateKeyPem) {
            throw new Error("No keys generated. Please generate keys first.");
        }

        log.info(`Generating CSR for ${commonName}...`);

        const keyPath = path.join(os.tmpdir(), `key_${Date.now()}.pem`);
        await writeFileAsync(keyPath, this.privateKeyPem);

        try {
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
     * Imports the signed certificate into the NSS database.
     * Creates a PKCS#12 bundle from key + cert, then imports via pk12util.
     */
    async importCertificate(certPem: string): Promise<void> {
        if (!this.privateKeyPem) {
            throw new Error("No private key available to create Identity.");
        }

        Logger.info(EnrollmentEvent.CERTIFICATE_IMPORT_START, { label: this.label });

        await this.ensureNssDb();

        const keyPath = path.join(os.tmpdir(), `key_${Date.now()}.pem`);
        const certPath = path.join(os.tmpdir(), `cert_${Date.now()}.pem`);
        const p12Path = path.join(os.tmpdir(), `identity_${Date.now()}.p12`);

        await writeFileAsync(keyPath, this.privateKeyPem);
        await writeFileAsync(certPath, certPem);

        try {
            // The bundle is a per-call temp file, imported immediately and removed in the finally
            // below. The passphrase is fixed so the export and import agree.
            // Create PKCS#12 bundle
            const p12Cmd = `${OPENSSL} pkcs12 -export -in "${certPath}" -inkey "${keyPath}" -out "${p12Path}" -passout pass:changeit -name "${this.label}"`;
            await execAsync(p12Cmd);

            // Import PKCS#12 into all NSS databases (Chrome + Firefox)
            const allNssDirs = this.getAllNssDbDirs();
            for (const dir of allNssDirs) {
                try {
                    const importCmd = `pk12util -d sql:${dir} -i "${p12Path}" -W changeit`;
                    await execAsync(importCmd);
                    log.info(`Certificate imported into NSS DB: ${dir}`);
                } catch (e: any) {
                    log.warn(`Failed to import certificate into ${dir}:`, e.stderr || e.message);
                }
            }

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
            throw new Error(`Certificate Import Failed: ${e.stderr || e.message}`);
        } finally {
            try { await unlinkAsync(keyPath); } catch { }
            try { await unlinkAsync(certPath); } catch { }
            try { await unlinkAsync(p12Path); } catch { }

            // Clear memory
            this.privateKeyPem = null;
        }
    }

    /**
     * Installs a Root CA certificate into the NSS database.
     */
    async installRootCA(pem: string): Promise<void> {
        Logger.info(EnrollmentEvent.ROOT_CA_INSTALL_START);

        await this.ensureNssDb();

        const tmpPath = path.join(os.tmpdir(), `root_ca_${Date.now()}.pem`);
        const nssDir = this.getNssDbDir();
        await writeFileAsync(tmpPath, pem);

        try {
            // Extract Common Name to use as nickname. execFile (no shell) — the CN comes from an
            // Comes from an untrusted certificate, so it is never interpolated into a shell command.
            const { stdout: subjectOut } = await execFileAsync(OPENSSL, ['x509', '-in', tmpPath, '-noout', '-subject', '-nameopt', 'multiline']);
            const cnMatch = subjectOut.match(/commonName\s*=\s*(.*)/);
            const rawNickname = cnMatch ? cnMatch[1].trim() : `XyneRootCA_${Date.now()}`;
            // Restrict the nickname to a safe charset: it is used both as a certutil -n value and as a
            // filename under /usr/local/share/ca-certificates below, so it must not carry shell
            // Rejects shell metacharacters, path separators and traversal.
            const nickname = rawNickname.replace(/[^A-Za-z0-9._@ -]/g, '_').slice(0, 128) || `XyneRootCA_${Date.now()}`;

            // Check if certificate with same nickname already exists
            try {
                await execFileAsync('certutil', ['-d', `sql:${nssDir}`, '-L', '-n', nickname]);
                // If no error, cert exists
                Logger.info(EnrollmentEvent.ROOT_CA_INSTALL_SUCCESS, {
                    exists_in_keychain: true,
                    skipped_installation: true,
                });
                return;
            } catch {
                // Certificate not found, proceed with installation
                log.info(`Certificate "${nickname}" not found. Proceeding with installation.`);
            }

            // Add the CA certificate to all NSS databases (Chrome + Firefox)
            const allNssDirs = this.getAllNssDbDirs();
            for (const dir of allNssDirs) {
                try {
                    const addCmd = `certutil -d sql:${dir} -A -t "CT,," -n "${nickname}" -i "${tmpPath}"`;
                    await execAsync(addCmd);
                    log.info(`CA installed into NSS DB: ${dir}`);
                } catch (e: any) {
                    log.warn(`Failed to install CA into ${dir}:`, e.stderr || e.message);
                }
            }

            // Also install into system trust store so all applications trust it
            try {
                // Copy cert to system CA directory and update trust
                const systemCertPath = `/usr/local/share/ca-certificates/${nickname}.crt`;
                await execAsync(`sudo cp "${tmpPath}" "${systemCertPath}" && sudo update-ca-certificates`);
                log.info("CA installed into system trust store.");
            } catch (e: any) {
                // Fallback: try RHEL/Fedora method
                try {
                    const systemCertPath = `/etc/pki/ca-trust/source/anchors/${nickname}.crt`;
                    await execAsync(`sudo cp "${tmpPath}" "${systemCertPath}" && sudo update-ca-trust`);
                    log.info("CA installed into system trust store (RHEL).");
                } catch {
                    log.warn("Could not install CA into system trust store:", e.stderr || e.message);
                }
            }

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
            try { await unlinkAsync(tmpPath); } catch { }
        }
    }

    /**
     * Deletes a certificate identity from the NSS database.
     */
    async deleteIdentity(commonName: string): Promise<void> {
        log.info(`Deleting identity for "${commonName}"...`);

        try {
            // Delete the certificate from all NSS databases (Chrome + Firefox)
            const allNssDirs = this.getAllNssDbDirs();
            for (const dir of allNssDirs) {
                try {
                    await execAsync(`certutil -d sql:${dir} -D -n "${commonName}"`);
                    log.info(`Identity deleted from NSS DB: ${dir}`);
                } catch (e: any) {
                    if (e.stderr && (e.stderr.includes('not found') || e.stderr.includes('could not find'))) {
                        // Not in this DB, skip
                    } else {
                        log.warn(`Delete identity warning for ${dir}:`, e.stderr || e.message);
                    }
                }
            }
            Logger.info(EnrollmentEvent.IDENTITY_DELETED, { common_name: commonName });
        } catch (e: any) {
            log.warn("Delete identity warning:", e.stderr || e.message);
            Logger.logError(EnrollmentEvent.IDENTITY_DELETE_FAILED, e);
        }

        // Clear memory just in case
        this.privateKeyPem = null;
    }

    /**
     * Extracts certificate nicknames from certutil -L output.
     * Output format: "nickname                   trust_flags"
     */
    private parseNicknames(certutilOutput: string): string[] {
        const nicknames: string[] = [];
        const lines = certutilOutput.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            // Skip empty lines, header lines
            if (!trimmed || trimmed.startsWith('Certificate Nickname') || trimmed.includes('SSL,S/MIME')) continue;
            // Extract nickname (everything before the trailing trust flags like "u,u,u" or "CT,,")
            const match = trimmed.match(/^(.+?)\s+[a-zA-Zp,]+\s*$/);
            if (match) {
                nicknames.push(match[1].trim());
            }
        }
        return nicknames;
    }

    /**
     * Checks if a certificate identity exists in the NSS database.
     * Searches by both nickname and certificate subject CN.
     */
    async checkIdentity(commonName: string): Promise<boolean> {
        const nssDir = this.getNssDbDir();
        log.info(`Checking identity for "${commonName}"...`);

        try {
            // List all certificates
            const { stdout } = await execAsync(`certutil -d sql:${nssDir} -L`);

            // First check: nickname matches directly
            const lines = stdout.split('\n');
            for (const line of lines) {
                if (line.includes(commonName)) {
                    Logger.info(EnrollmentEvent.IDENTITY_CHECK, { common_name: commonName, found: true });
                    return true;
                }
            }

            // Second check: examine each cert's subject CN (handles nickname != CN mismatch)
            const nicknames = this.parseNicknames(stdout);
            for (const nickname of nicknames) {
                try {
                    const tmpCert = path.join(os.tmpdir(), `check_cert_${Date.now()}.pem`);
                    await execAsync(`certutil -d sql:${nssDir} -L -n "${nickname}" -a > "${tmpCert}"`);
                    try {
                        const { stdout: subjectOut } = await execAsync(`${OPENSSL} x509 -in "${tmpCert}" -noout -subject -nameopt multiline`);
                        if (subjectOut.includes(commonName)) {
                            log.info(`Found identity "${commonName}" under nickname "${nickname}"`);
                            Logger.info(EnrollmentEvent.IDENTITY_CHECK, { common_name: commonName, found: true });
                            return true;
                        }
                    } finally {
                        try { await unlinkAsync(tmpCert); } catch { }
                    }
                } catch {
                    // Could not inspect this cert, skip
                }
            }

            // Check for partial enrollment
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

export const linuxKeychainService = new LinuxKeychainService();
