export interface IKeychain {
    generateKeyPair(label: string): Promise<void>;
    generateCSR(commonName: string): Promise<string>;
    importCertificate(certPem: string): Promise<void>;
    installRootCA(pem: string): Promise<void>;
    deleteIdentity(commonName: string): Promise<void>;
    checkIdentity(commonName: string): Promise<boolean>;
}