declare module '@google-cloud/kms' {
  type CryptoKey = {
    name?: string | null;
    purpose?: 'ENCRYPT_DECRYPT' | number | null;
    versionTemplate?: {
      algorithm?: 'GOOGLE_SYMMETRIC_ENCRYPTION' | number | null;
      protectionLevel?: 'SOFTWARE' | 'HSM' | number | null;
    } | null;
    labels?: Record<string, string> | null;
  };

  export class KeyManagementServiceClient {
    cryptoKeyPath(project: string, location: string, keyRing: string, cryptoKey: string): string;

    keyRingPath(project: string, location: string, keyRing: string): string;

    getCryptoKey(request: {
      name: string;
    }): Promise<Array<CryptoKey>>;

    createCryptoKey(request: {
      parent: string;
      cryptoKeyId: string;
      cryptoKey: CryptoKey;
      skipInitialVersionCreation?: boolean;
    }): Promise<Array<CryptoKey>>;

    encrypt(request: {
      name: string;
      plaintext: Uint8Array | Buffer;
    }): Promise<Array<{ ciphertext?: Uint8Array | Buffer | string | null }>>;

    decrypt(request: {
      name: string;
      ciphertext: Uint8Array | Buffer;
    }): Promise<Array<{ plaintext?: Uint8Array | Buffer | string | null }>>;
  }
}
