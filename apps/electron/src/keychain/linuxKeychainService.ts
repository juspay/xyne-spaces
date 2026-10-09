import log from 'electron-log/main';
import { execFile } from 'child_process';
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
import { KeychainToolingError } from './errors';

// Shell-free throughout: every argument below (nicknames derived from certificate CommonNames,
// temp paths, passphrases) is passed as an argv entry, never interpolated into /bin/sh.
const execFileAsync = promisify(execFile);
const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);
const mkdirAsync = promisify(fs.mkdir);

const OPENSSL = 'openssl';
const CERTUTIL = 'certutil';
const PK12UTIL = 'pk12util';

/**
 * Directories searched for the NSS tools in addition to PATH.
 *
 * A desktop launcher (.desktop entry, app menu, autostart) starts the app with a far thinner
 * environment than a login shell — on some Debian setups PATH is only `/usr/bin:/bin`, and under
 * Flatpak/Snap it is narrower still. Resolving the binaries ourselves means a working host is
 * never reported as "tool not found" purely because of how the app was launched.
 */
const TOOL_SEARCH_DIRS = [
    '/usr/bin',
    '/bin',
    '/usr/local/bin',
    '/usr/sbin',
    '/usr/local/sbin',
    '/snap/bin',
    '/var/lib/snapd/snap/bin',
];

const INSTALL_HINT =
    'Install the NSS certificate tools: Debian/Ubuntu `sudo apt install libnss3-tools`, '
    + 'Fedora/RHEL `sudo dnf install nss-tools`, Arch `sudo pacman -S nss`.';

/**
 * Linux Keychain Service using NSS database (used by Electron/Chromium on Linux).
 *
 * Chromium on Linux reads client certificates from the NSS database at ~/.pki/nssdb.
 * We use `certutil` and `pk12util` (from libnss3-tools) to manage certificates,
 * and `openssl` for key generation and CSR creation.
 *
 * Every operation here depends on those external binaries, so they are resolved and verified up
 * front via ensureToolingAvailable(). A missing binary raises KeychainToolingError rather than
 * degrading into a silent "no certificate" answer.
 */
class LinuxKeychainService implements IKeychain {
    private privateKeyPem: string | null = null;
    private label: string = "SimulationClient";
    private toolPathCache = new Map<string, string | null>();

    /**
     * Resolves a tool to an absolute path, searching TOOL_SEARCH_DIRS first and then PATH.
     * Returns null when the tool is nowhere to be found. Results are cached for the process
     * lifetime; a tool the user installs mid-session is picked up after a restart.
     */
    private resolveTool(tool: string): string | null {
        const cached = this.toolPathCache.get(tool);
        if (cached !== undefined) {
            return cached;
        }

        const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
        let resolved: string | null = null;

        for (const dir of [...TOOL_SEARCH_DIRS, ...pathDirs]) {
            const candidate = path.join(dir, tool);
            try {
                fs.accessSync(candidate, fs.constants.X_OK);
                resolved = candidate;
                break;
            } catch {
                // Not here (or not executable) — keep looking.
            }
        }

        this.toolPathCache.set(tool, resolved);
        return resolved;
    }

    /**
     * Verifies every external binary this service needs. Throws KeychainToolingError naming the
     * missing ones so the caller can show the user an actionable install command instead of
     * wiping their certificate and looping through enrollment.
     */
    async ensureToolingAvailable(): Promise<void> {
        const missing = [OPENSSL, CERTUTIL, PK12UTIL].filter(tool => this.resolveTool(tool) === null);

        if (missing.length > 0) {
            Logger.warn(EnrollmentEvent.KEYCHAIN_TOOLING_MISSING, {
                missing_tools: missing.join(','),
                searched_path: process.env.PATH ?? '',
            });
            throw new KeychainToolingError(missing, INSTALL_HINT);
        }
    }

    /**
     * Runs one of the external tools, resolved to an absolute path.
     */
    private async run(tool: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
        const binary = this.resolveTool(tool);
        if (!binary) {
            throw new KeychainToolingError([tool], INSTALL_HINT);
        }
        return await execFileAsync(binary, args, { maxBuffer: 8 * 1024 * 1024 });
    }

    private getNssDbDir(): string {
        return path.join(os.homedir(), '.pki', 'nssdb');
    }

    /**
     * Returns paths to all NSS databases: ~/.pki/nssdb (Chrome) + Firefox profiles.
     *
     * Index 0 is always the Chromium database — the only one Electron itself reads, and therefore
     * the only one whose import has to succeed. The Firefox profiles are a convenience so the
     * same device certificate works in the browser; failures there are not fatal.
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
            await this.run(CERTUTIL, ['-d', `sql:${nssDir}`, '-N', '--empty-password']);
        }
    }

    /**
     * Generates an EC P-384 KeyPair in memory using openssl.
     */
    async generateKeyPair(label: string): Promise<void> {
        this.label = label;
        Logger.info(EnrollmentEvent.KEY_GENERATION_START, { label });

        try {
            await this.ensureToolingAvailable();
            const { stdout } = await this.run(OPENSSL, ['ecparam', '-name', 'secp384r1', '-genkey', '-noout']);
            this.privateKeyPem = stdout;
            Logger.info(EnrollmentEvent.KEY_GENERATION_SUCCESS, { label });
        } catch (e: any) {
            Logger.logError(EnrollmentEvent.KEY_GENERATION_FAILED, e);
            throw e instanceof KeychainToolingError
                ? e
                : new Error(`KeyPair Generation Failed: ${e.message}`);
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
        await writeFileAsync(keyPath, this.privateKeyPem, { mode: 0o600 });

        try {
            const { stdout } = await this.run(OPENSSL, [
                'req', '-new', '-key', keyPath, '-subj', `/CN=${commonName}`, '-sha384',
            ]);
            return stdout;
        } finally {
            try { await unlinkAsync(keyPath); } catch { }
        }
    }

    /**
     * Imports the signed certificate into the NSS database.
     * Creates a PKCS#12 bundle from key + cert, then imports via pk12util.
     *
     * The Chromium database (~/.pki/nssdb) import must succeed: it is the store Electron presents
     * client certificates from, so reporting success without it would hand the user an
     * "enrollment complete" screen followed by ERR_BAD_SSL_CLIENT_AUTH_CERT on every request.
     */
    async importCertificate(certPem: string): Promise<void> {
        if (!this.privateKeyPem) {
            throw new Error("No private key available to create Identity.");
        }

        Logger.info(EnrollmentEvent.CERTIFICATE_IMPORT_START, { label: this.label });

        await this.ensureToolingAvailable();
        await this.ensureNssDb();

        const keyPath = path.join(os.tmpdir(), `key_${Date.now()}.pem`);
        const certPath = path.join(os.tmpdir(), `cert_${Date.now()}.pem`);
        const p12Path = path.join(os.tmpdir(), `identity_${Date.now()}.p12`);

        await writeFileAsync(keyPath, this.privateKeyPem, { mode: 0o600 });
        await writeFileAsync(certPath, certPem, { mode: 0o600 });

        try {
            // The bundle is a per-call temp file, imported immediately and removed in the finally
            // below. The passphrase is fixed so the export and import agree.
            // Create PKCS#12 bundle
            await this.run(OPENSSL, [
                'pkcs12', '-export',
                '-in', certPath,
                '-inkey', keyPath,
                '-out', p12Path,
                '-passout', 'pass:changeit',
                '-name', this.label,
            ]);

            // Import PKCS#12 into all NSS databases (Chrome + Firefox)
            const [primaryNssDir, ...secondaryNssDirs] = this.getAllNssDbDirs();

            try {
                await this.run(PK12UTIL, ['-d', `sql:${primaryNssDir}`, '-i', p12Path, '-W', 'changeit']);
                log.info(`Certificate imported into NSS DB: ${primaryNssDir}`);
            } catch (e: any) {
                // Fatal: without this database Electron has no client certificate to present.
                const detail = (e.stderr || e.message || '').trim();
                Logger.logError(EnrollmentEvent.CERTIFICATE_STORAGE_FAILED, e, {
                    nss_db: primaryNssDir,
                    stage: 'primary_nss_import',
                });
                throw new Error(`Certificate Import Failed for ${primaryNssDir}: ${detail}`);
            }

            for (const dir of secondaryNssDirs) {
                try {
                    await this.run(PK12UTIL, ['-d', `sql:${dir}`, '-i', p12Path, '-W', 'changeit']);
                    log.info(`Certificate imported into NSS DB: ${dir}`);
                } catch (e: any) {
                    // Best effort — Firefox profiles are a convenience, not the app's trust store.
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
            throw e instanceof KeychainToolingError
                ? e
                : new Error(`Certificate Import Failed: ${e.stderr || e.message}`);
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

        await this.ensureToolingAvailable();
        await this.ensureNssDb();

        const tmpPath = path.join(os.tmpdir(), `root_ca_${Date.now()}.pem`);
        const nssDir = this.getNssDbDir();
        await writeFileAsync(tmpPath, pem, { mode: 0o600 });

        try {
            // Extract Common Name to use as nickname. The CN comes from an untrusted certificate,
            // so it is passed as an argv entry and never interpolated into a shell command.
            const { stdout: subjectOut } = await this.run(OPENSSL, [
                'x509', '-in', tmpPath, '-noout', '-subject', '-nameopt', 'multiline',
            ]);
            const cnMatch = subjectOut.match(/commonName\s*=\s*(.*)/);
            const rawNickname = cnMatch ? cnMatch[1].trim() : `XyneRootCA_${Date.now()}`;
            // Restrict the nickname to a safe charset: it is used both as a certutil -n value and as a
            // filename under /usr/local/share/ca-certificates below, so it must not carry shell
            // Rejects shell metacharacters, path separators and traversal.
            const nickname = rawNickname.replace(/[^A-Za-z0-9._@ -]/g, '_').slice(0, 128) || `XyneRootCA_${Date.now()}`;

            // Check if certificate with same nickname already exists
            try {
                await this.run(CERTUTIL, ['-d', `sql:${nssDir}`, '-L', '-n', nickname]);
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
                    await this.run(CERTUTIL, ['-d', `sql:${dir}`, '-A', '-t', 'CT,,', '-n', nickname, '-i', tmpPath]);
                    log.info(`CA installed into NSS DB: ${dir}`);
                } catch (e: any) {
                    log.warn(`Failed to install CA into ${dir}:`, e.stderr || e.message);
                }
            }

            // Also try the system trust store so other applications trust it. `sudo -n` keeps this
            // non-interactive: the app has no TTY, so a password prompt would hang startup. When
            // passwordless sudo is not configured this fails immediately and we move on — NSS
            // already holds what Electron needs.
            await this.installRootCAIntoSystemStore(tmpPath, nickname);

            log.info("CA installed.");
            Logger.info(EnrollmentEvent.ROOT_CA_INSTALL_SUCCESS, {
                exists_in_keychain: false,
                skipped_installation: false,
            });
        } catch (e: any) {
            log.error("CA install failed:", e.stderr);
            Logger.logError(EnrollmentEvent.ROOT_CA_INSTALL_FAILED, e);
            throw e instanceof KeychainToolingError
                ? e
                : new Error(`Failed to install CA: ${e.stderr || e.message}`);
        } finally {
            try { await unlinkAsync(tmpPath); } catch { }
        }
    }

    private async installRootCAIntoSystemStore(pemPath: string, nickname: string): Promise<void> {
        const targets: Array<{ dir: string; refresh: string }> = [
            { dir: '/usr/local/share/ca-certificates', refresh: 'update-ca-certificates' },
            { dir: '/etc/pki/ca-trust/source/anchors', refresh: 'update-ca-trust' },
        ];

        for (const target of targets) {
            if (!fs.existsSync(target.dir)) continue;
            try {
                await execFileAsync('sudo', ['-n', 'cp', pemPath, path.join(target.dir, `${nickname}.crt`)]);
                await execFileAsync('sudo', ['-n', target.refresh]);
                log.info(`CA installed into system trust store via ${target.refresh}.`);
                return;
            } catch (e: any) {
                log.warn(`Could not install CA via ${target.refresh}:`, e.stderr || e.message);
            }
        }
    }

    /**
     * Deletes a certificate identity from the NSS database.
     */
    async deleteIdentity(commonName: string): Promise<void> {
        log.info(`Deleting identity for "${commonName}"...`);

        await this.ensureToolingAvailable();

        let deletedCount = 0;

        // Delete the certificate from all NSS databases (Chrome + Firefox)
        const allNssDirs = this.getAllNssDbDirs();
        for (const dir of allNssDirs) {
            try {
                await this.run(CERTUTIL, ['-d', `sql:${dir}`, '-D', '-n', commonName]);
                deletedCount++;
                log.info(`Identity deleted from NSS DB: ${dir}`);
            } catch (e: any) {
                const stderr = String(e.stderr ?? '');
                if (stderr.includes('not found') || stderr.includes('could not find')) {
                    // Not in this DB, skip
                } else {
                    log.warn(`Delete identity warning for ${dir}:`, e.stderr || e.message);
                }
            }
        }

        Logger.info(EnrollmentEvent.IDENTITY_DELETED, {
            common_name: commonName,
            deleted_from_db_count: deletedCount,
        });

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
     *
     * Returns false only when the database was read successfully and holds no matching identity.
     * A database that cannot be read at all throws, so callers never mistake an unreadable host
     * for an unenrolled one and re-enroll over a certificate that is actually there.
     */
    async checkIdentity(commonName: string): Promise<boolean> {
        const nssDir = this.getNssDbDir();
        log.info(`Checking identity for "${commonName}"...`);

        await this.ensureToolingAvailable();

        let listing: string;
        try {
            const { stdout } = await this.run(CERTUTIL, ['-d', `sql:${nssDir}`, '-L']);
            listing = stdout;
        } catch (e: any) {
            // An empty, freshly initialised database is a legitimate "no identity" answer;
            // certutil reports it with this message rather than an empty listing.
            const detail = String(e.stderr ?? e.message ?? '');
            if (/SEC_ERROR_LEGACY_DATABASE|No certificates found|database.*not.*exist/i.test(detail)) {
                Logger.info(EnrollmentEvent.IDENTITY_CHECK, { common_name: commonName, found: false });
                return false;
            }

            Logger.error(EnrollmentEvent.UNKNOWN_ERROR, {
                operation: 'check_identity',
                common_name: commonName,
                error: detail || String(e),
            });
            throw new Error(`Unable to read NSS database at ${nssDir}: ${detail || String(e)}`);
        }

        // First check: nickname matches directly
        for (const line of listing.split('\n')) {
            if (line.includes(commonName)) {
                Logger.info(EnrollmentEvent.IDENTITY_CHECK, { common_name: commonName, found: true });
                return true;
            }
        }

        // Second check: examine each cert's subject CN (handles nickname != CN mismatch)
        const nicknames = this.parseNicknames(listing);
        for (const nickname of nicknames) {
            try {
                const { stdout: certPem } = await this.run(CERTUTIL, [
                    '-d', `sql:${nssDir}`, '-L', '-n', nickname, '-a',
                ]);
                const tmpCert = path.join(os.tmpdir(), `check_cert_${Date.now()}.pem`);
                await writeFileAsync(tmpCert, certPem, { mode: 0o600 });
                try {
                    const { stdout: subjectOut } = await this.run(OPENSSL, [
                        'x509', '-in', tmpCert, '-noout', '-subject', '-nameopt', 'multiline',
                    ]);
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
    }
}

export const linuxKeychainService = new LinuxKeychainService();
