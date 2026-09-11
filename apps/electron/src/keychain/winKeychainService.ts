import log from 'electron-log/main';
import { spawn } from 'child_process';
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

const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);
const readFileAsync = promisify(fs.readFile);

/**
 * Windows Certificate Manager using PowerShell and certreq
 * Manages certificates in Windows Certificate Store (Cert:\CurrentUser\)
 */
class WinKeychainService implements IKeychain {


    private label: string = "SimulationClient";

    /**
     * Executes a PowerShell command securely via Stdin.
     * This prevents command-line arguments from being visible in Task Manager.
     */
    private runPowerShellCommand(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const ps = spawn('powershell', [
                '-NoProfile',              // Faster startup (skips user profile)
                '-ExecutionPolicy', 'Bypass', // Allow script execution
                '-Command', '-'            // READ FROM STDIN
            ]);

            let stdout = '';
            let stderr = '';

            ps.stdout.on('data', (data) => { stdout += data.toString(); });
            ps.stderr.on('data', (data) => { stderr += data.toString(); });

            ps.on('close', (code) => {
                const output = stdout.trim();
                const errorOutput = stderr.trim();

                if (code === 0) {
                    resolve(output);
                } else {
                    // Windows errors are messy. We try to detect specific cancellation codes.
                    // 0x800704C7 = The operation was cancelled by the user.
                    const fullError = errorOutput || output; // sometimes errors go to stdout
                    
                    if (fullError.includes('cancelled') || fullError.includes('800704C7')) {
                        reject(new Error('USER_CANCELLED'));
                    } else if (fullError.includes('already exists')) {
                        resolve(output); // Treat "already exists" as success if needed
                    } else {
                        reject(new Error(`PowerShell Error (Exit Code ${code}): ${fullError}`));
                    }
                }
            });

            ps.on('error', (err) => {
                reject(new Error(`Failed to spawn PowerShell: ${err.message}`));
            });

            // Write the command to the process securely
            ps.stdin.write(command);
            ps.stdin.end();
        });
    }

    async generateKeyPair(_label: string): Promise<void> {
        log.info("Not needed on Windows - CSR generation creates the key pair automatically.");
        return;
    }

    /**
     * Generates a KeyPair AND a CSR in one operation using certreq.
     * Windows creates the Private Key in the 'Request' store automatically.
     */
    async generateCSR(commonName: string): Promise<string> {
        this.label = commonName;
        Logger.info(EnrollmentEvent.CSR_GENERATION_SUCCESS, { label: commonName });

        const timestamp = Date.now();
        const infPath = path.join(os.tmpdir(), `req_${timestamp}.inf`);
        const csrPath = path.join(os.tmpdir(), `req_${timestamp}.csr`);

        // INF Template for Windows Certificate Request
        // Note: 'FriendlyName' helps us identify this cert later easily
        const infContent = `
            [Version]
            Signature="$Windows NT$"

            [NewRequest]
            Subject = "CN=${commonName}"
            KeyLength = 384
            KeyAlgorithm = ECDSA_P384
            HashAlgorithm = SHA384
            Exportable = TRUE
            MachineKeySet = FALSE
            SMIME = FALSE
            PrivateKeyArchive = FALSE
            UseExistingKeySet = FALSE
            ProviderName = "Microsoft Software Key Storage Provider"
            RequestType = PKCS10
            KeyUsage = 0xA0 ; DigitalSignature, KeyEncipherment
            FriendlyName = "${commonName}"

            [EnhancedKeyUsageExtension]
            OID=1.3.6.1.5.5.7.3.2 ; Client Authentication
            `;

        try {
            await writeFileAsync(infPath, infContent);

            // Run certreq to generate key and CSR
            // -q = quiet (suppress some UI)
            const cmd = `certreq -new -q "${infPath}" "${csrPath}"`;
            await this.runPowerShellCommand(cmd);

            // Read the generated CSR
            let csrContent = await readFileAsync(csrPath, 'utf8');

            // Normalize Windows certreq PEM headers to standard format
            // certreq produces "BEGIN NEW CERTIFICATE REQUEST" but standard PEM uses "BEGIN CERTIFICATE REQUEST"
            csrContent = csrContent
                .replace('BEGIN NEW CERTIFICATE REQUEST', 'BEGIN CERTIFICATE REQUEST')
                .replace('END NEW CERTIFICATE REQUEST', 'END CERTIFICATE REQUEST');
            
            Logger.info(EnrollmentEvent.KEY_GENERATION_SUCCESS, { label: commonName }); // Log success for both
            return csrContent;

        } catch (error: any) {
            Logger.logError(EnrollmentEvent.CSR_GENERATION_FAILED, error);
            throw new Error(`CSR Generation Failed: ${error.message}`);
        } finally {
            // Cleanup temp files
            try { await unlinkAsync(infPath); } catch { }
            try { await unlinkAsync(csrPath); } catch { }
        }
    }

    /**
     * Imports the signed certificate.
     * Uses 'certreq -accept' to pair the signed cert with the pending private key.
     */
    async importCertificate(certPem: string): Promise<void> {
        Logger.info(EnrollmentEvent.CERTIFICATE_IMPORT_START, { label: this.label });
        
        const certPath = path.join(os.tmpdir(), `cert_${Date.now()}.cer`);
        await writeFileAsync(certPath, certPem);

        try {
            // 1. Import blindly and repair the private key link
            // This bypasses the strict chain validation that certreq -accept enforces.
            const acceptCmd = `
                try {
                    # Import the certificate directly into the CurrentUser Personal store
                    $cert = Import-Certificate -FilePath "${certPath}" -CertStoreLocation Cert:\\CurrentUser\\My -ErrorAction Stop
                    
                    # Stitch the pending private key back to this certificate
                    # certutil will output text, so we redirect it to Out-Null to avoid clutter
                    certutil -user -repairstore my $($cert.Thumbprint) | Out-Null
                    
                    Write-Output $cert.Thumbprint
                } catch {
                    throw $_.Exception.Message
                }
            `;
            
            let thumbprint: string = '';
            try {
                // We can capture the thumbprint directly from this command now
                thumbprint = await this.runPowerShellCommand(acceptCmd);
                thumbprint = thumbprint.trim();
            } catch (e: any) {
                if (!e.message.includes('already exists')) {
                    throw e;
                }
                // If it already exists, fallback to the search logic to get the thumbprint
            }

            // 2. Verify import and get Thumbprint (Fallback / Validation)
            if (!thumbprint) {
                const findCertCmd = `
                    $cert = Get-ChildItem Cert:\\CurrentUser\\My | 
                    Where-Object { $_.FriendlyName -eq "${this.label}" -or $_.Subject -match "CN=${this.label}" } | 
                    Sort-Object NotBefore -Descending | 
                    Select-Object -First 1;
                    
                    if ($cert) { 
                        Write-Output $cert.Thumbprint 
                    } else {
                        throw "Certificate not found in store after import"
                    }
                `;
                thumbprint = await this.runPowerShellCommand(findCertCmd);
                thumbprint = thumbprint.trim();
            }

            if (!thumbprint) throw new Error('Certificate was not found after import');

            safeRecordMetric(() => {
                devicePasswordPopup.add(1, { 
                    success: 'true',
                    reason: 'certificate_import',
                    buildVersion: app.getVersion(),
                });
            });
            
            Logger.info(EnrollmentEvent.CERTIFICATE_IMPORT_SUCCESS, { 
                label: this.label,
                thumbprint: thumbprint 
            });

        } catch (e: any) {
            safeRecordMetric(() => {
                devicePasswordPopup.add(1, { 
                    success: 'false',
                    reason: 'certificate_import_failure',
                    buildVersion: app.getVersion(),
                });
            });
            
            Logger.logError(EnrollmentEvent.CERTIFICATE_STORAGE_FAILED, e);
            throw new Error(`Certificate Import Failed: ${e.message}`);
        } finally {
            try { await unlinkAsync(certPath); } catch { }
        }
    }

    /**
     * Installs Root CA certificate to Windows Trusted Root store.
     * WARNING: This triggers a visible Windows Security Prompt.
     */
    async installRootCA(pem: string): Promise<void> {
        Logger.info(EnrollmentEvent.ROOT_CA_INSTALL_START);
        
        const tmpPath = path.join(os.tmpdir(), `root_ca_${Date.now()}.cer`);
        await writeFileAsync(tmpPath, pem);

        try {
            // 1. Check if already installed (Subject match)
            // We load the file into a temporary object to get the exact Subject string
            const checkCmd = `
                $fileCert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2("${tmpPath}");
                $existing = Get-ChildItem Cert:\\CurrentUser\\Root | Where-Object { $_.Subject -eq $fileCert.Subject } | Select-Object -First 1;
                if ($existing) { Write-Output "EXISTS" }
            `;

            const checkResult = await this.runPowerShellCommand(checkCmd);

            if (checkResult.includes("EXISTS")) {
                Logger.info(EnrollmentEvent.ROOT_CA_INSTALL_SUCCESS, {
                    exists_in_keychain: true,
                    skipped_installation: true,
                });
                return;
            }

            // 2. Install (Will trigger UI Prompt)
            log.info("Installing Root CA...");
            const importCmd = `Import-Certificate -FilePath "${tmpPath}" -CertStoreLocation Cert:\\CurrentUser\\Root`;
            await this.runPowerShellCommand(importCmd);
            
            Logger.info(EnrollmentEvent.ROOT_CA_INSTALL_SUCCESS, {
                exists_in_keychain: false,
                skipped_installation: false,
            });

        } catch (e: any) {
            if (e.message === 'USER_CANCELLED') {
                Logger.warn(EnrollmentEvent.USER_CANCELLED_ENROLLMENT, {
                    operation: 'root_ca_install',
                    reason: 'uac_cancelled'
                });
                throw e; // Propagate cancellation
            }
            
            Logger.logError(EnrollmentEvent.ROOT_CA_INSTALL_FAILED, e);
            throw new Error(`Failed to install CA: ${e.message}`);
        } finally {
            try { await unlinkAsync(tmpPath); } catch { }
        }
    }

    /**
     * Deletes a certificate identity from Windows Certificate Store
     */
    async deleteIdentity(commonName: string): Promise<void> {
        log.info(`Deleting identity for "${commonName}"...`);

        try {
            // Remove by FriendlyName OR Subject to be thorough
            const cmd = `
                Get-ChildItem Cert:\\CurrentUser\\My | 
                Where-Object { $_.FriendlyName -eq "${commonName}" -or $_.Subject -match "CN=${commonName}" } | 
                Remove-Item
            `;
            await this.runPowerShellCommand(cmd);
            
            Logger.info(EnrollmentEvent.IDENTITY_DELETED, { common_name: commonName });
        } catch (e: any) {
            // PowerShell throws if it can't find items to delete; we can ignore that safely
            Logger.info(EnrollmentEvent.IDENTITY_NOT_FOUND, { common_name: commonName });
        }
    }

    /**
     * Checks if a certificate identity exists and has a private key
     */
    async checkIdentity(commonName: string): Promise<boolean> {
        try {
            // Must have Private Key to be valid
            const cmd = `
                $cert = Get-ChildItem Cert:\\CurrentUser\\My | 
                Where-Object { ($_.FriendlyName -eq "${commonName}" -or $_.Subject -match "CN=${commonName}") -and $_.HasPrivateKey -eq $true } | 
                Select-Object -First 1;
                
                if ($cert) { Write-Output $cert.Thumbprint }
            `;
            
            const thumbprint = await this.runPowerShellCommand(cmd);

            if (thumbprint && thumbprint.length > 0) {
                Logger.info(EnrollmentEvent.IDENTITY_CHECK, { 
                    common_name: commonName, 
                    found: true,
                    thumbprint: thumbprint 
                });
                return true;
            }

            Logger.info(EnrollmentEvent.IDENTITY_CHECK, { 
                common_name: commonName, 
                found: false,
            });

            return false;
        } catch (e) {
            Logger.error(EnrollmentEvent.UNKNOWN_ERROR, {
                operation: 'check_identity',
                error: e instanceof Error ? e.message : String(e),
            });
            return false;
        }
    }
}

export const winKeychainService = new WinKeychainService();
