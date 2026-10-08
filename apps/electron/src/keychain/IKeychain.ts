export interface IKeychain {
    generateKeyPair(label: string): Promise<void>;
    generateCSR(commonName: string): Promise<string>;
    importCertificate(certPem: string): Promise<void>;
    installRootCA(pem: string): Promise<void>;
    deleteIdentity(commonName: string): Promise<void>;
    checkIdentity(commonName: string): Promise<boolean>;
    /**
     * Verifies the external tools this platform's keychain depends on, throwing
     * KeychainToolingError when one is missing so the caller can tell the user what to install.
     *
     * Only implemented where the platform needs out-of-process binaries (Linux/NSS); macOS and
     * Windows talk to their OS keystores through APIs that ship with the system.
     */
    ensureToolingAvailable?(): Promise<void>;
}
