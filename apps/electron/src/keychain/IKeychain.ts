export interface IKeychain {
    generateKeyPair(label: string): Promise<void>;
    generateCSR(commonName: string): Promise<string>;
    importCertificate(certPem: string): Promise<void>;
    installRootCA(pem: string): Promise<void>;
    /** Removes every certificate issued by the device CA (see deviceCa.ts). */
    deleteIdentity(): Promise<void>;
    /** Whether a certificate issued by the device CA is present with its private key. */
    checkIdentity(): Promise<boolean>;
}