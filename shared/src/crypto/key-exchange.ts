import { API_BASE_URL } from '../config.js';

export interface EncryptionConfig {
  encryptedFields: Record<string, { fields: string[]; enforceClientEncryption: boolean }>;
  clientEncryptionEnabled: boolean;
  apiClientEncryptionEnabled: boolean;
}

export async function fetchEncryptionConfig(): Promise<
  EncryptionConfig & { publicKey: string; sessionFingerprint?: string }
> {
  const response = await fetch(`${API_BASE_URL}/encryption/public-key`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Encryption configuration request failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    publicKey?: string;
    sessionFingerprint?: string;
    encryptedFields?: Record<string, { fields: string[]; enforceClientEncryption: boolean }>;
    clientEncryptionEnabled?: boolean;
    apiClientEncryptionEnabled?: boolean;
  };

  const { publicKey, sessionFingerprint, encryptedFields, clientEncryptionEnabled, apiClientEncryptionEnabled } = data;

  return {
    publicKey: publicKey ?? '',
    sessionFingerprint,
    encryptedFields: encryptedFields ?? {},
    clientEncryptionEnabled: clientEncryptionEnabled ?? false,
    apiClientEncryptionEnabled: apiClientEncryptionEnabled ?? false,
  };
}

async function importRsaPublicKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '');

  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'spki',
    binaryDer.buffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['wrapKey'],
  );
}

export async function registerClientKey(
  publicKeyPem: string,
): Promise<{ key: CryptoKey; sessionFingerprint: string }> {
  const rsaPublicKey = await importRsaPublicKey(publicKeyPem);

    const aesKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );

    const wrappedKeyBuffer = await crypto.subtle.wrapKey('raw', aesKey, rsaPublicKey, {
      name: 'RSA-OAEP',
    });

    const wrappedKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(wrappedKeyBuffer)));

    const response = await fetch(`${API_BASE_URL}/encryption/register-client-key`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wrappedKey: wrappedKeyBase64,
      }),
    });

  if (!response.ok) {
    throw new Error(`Encryption key registration failed with status ${response.status}`);
  }

    const result = (await response.json()) as { sessionFingerprint?: string };

  if (!result.sessionFingerprint) {
    throw new Error('Encryption key registration response is missing a session fingerprint');
  }

  return { key: aesKey, sessionFingerprint: result.sessionFingerprint };
}
