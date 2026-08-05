import { KeyManagementServiceClient } from '@google-cloud/kms';
import crypto from 'crypto';
import type { KmsContext, KmsProvider } from '@/encryption/kms';

const NOT_FOUND_CODE = 5;
const ALREADY_EXISTS_CODE = 6;

type KeyRingPathParts = {
  project: string;
  location: string;
  keyRing: string;
};

function toBuffer(value: Uint8Array | Buffer | string | null | undefined, field: string): Buffer {
  if (!value) {
    throw new Error(`KMS response missing ${field}`);
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  return Buffer.from(value, 'base64');
}

function toOrgCryptoKeyId(orgId: string): string {
  const normalized = orgId.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
  const hash = crypto.createHash('sha256').update(orgId).digest('hex').slice(0, 16);
  const prefix = normalized ? normalized.slice(0, 40) : 'unknown';
  return `org-${prefix}-${hash}`.slice(0, 63);
}

function getErrorCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Number((error as { code?: unknown }).code)
    : undefined;
}

function parseKeyRingPath(keyRingRef: string): KeyRingPathParts {
  const match = keyRingRef.match(/^projects\/([^/]+)\/locations\/([^/]+)\/keyRings\/([^/]+)$/);
  if (!match) {
    throw new Error(`Invalid GCP KMS key ring ref: ${keyRingRef}`);
  }

  return {
    project: match[1],
    location: match[2],
    keyRing: match[3],
  };
}

export class GcpKmsConnector implements KmsProvider {
  constructor(private readonly client = new KeyManagementServiceClient()) {}

  async getOrCreateOrgKeyRef(orgId: string, keyRingRef: string): Promise<string> {
    const { project, location, keyRing } = parseKeyRingPath(keyRingRef);
    const cryptoKeyId = toOrgCryptoKeyId(orgId);
    const name = this.client.cryptoKeyPath(project, location, keyRing, cryptoKeyId);

    try {
      const [existing] = await this.client.getCryptoKey({ name });
      return existing.name ?? name;
    } catch (error) {
      if (getErrorCode(error) !== NOT_FOUND_CODE) {
        throw error;
      }
    }

    const parent = this.client.keyRingPath(project, location, keyRing);
    try {
      const [created] = await this.client.createCryptoKey({
        parent,
        cryptoKeyId,
        cryptoKey: {
          purpose: 'ENCRYPT_DECRYPT',
          versionTemplate: {
            algorithm: 'GOOGLE_SYMMETRIC_ENCRYPTION',
          },
          labels: {
            app: 'xyne-spaces',
            scope: 'org-dek',
          },
        },
      });
      return created.name ?? name;
    } catch (error) {
      if (getErrorCode(error) === ALREADY_EXISTS_CODE) {
        return name;
      }
      throw error;
    }
  }

  async wrapKey(plaintextKey: Buffer, keyRef: string, _context?: KmsContext): Promise<Buffer> {
    const [response] = await this.client.encrypt({ name: keyRef, plaintext: plaintextKey });
    return toBuffer(response.ciphertext, 'ciphertext');
  }

  async unwrapKey(wrappedKey: Buffer, keyRef: string, _context?: KmsContext): Promise<Buffer> {
    const [response] = await this.client.decrypt({ name: keyRef, ciphertext: wrappedKey });
    return toBuffer(response.plaintext, 'plaintext');
  }
}
