import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 2;
const KEY_VERSION = 'workspace-v1';

export interface CredentialEnvelope {
  encryptedPayload: string;
  encryptionAlgorithm: 'AES-256-GCM';
  encryptionVersion: number;
  keyVersion: string;
  iv: string;
  authTag: string;
}

function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY not found in environment variables');
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  return key;
}

function aad(workspaceId: string, provider: string, version = VERSION): Buffer {
  return Buffer.from(`sdlc-vcs:${version}:${workspaceId}:${provider}`, 'utf8');
}

export function encryptCredentialPayload(
  plaintext: string,
  context: { workspaceId: string; provider: string },
): CredentialEnvelope {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  cipher.setAAD(aad(context.workspaceId, context.provider));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    encryptedPayload: ciphertext.toString('base64'),
    encryptionAlgorithm: 'AES-256-GCM',
    encryptionVersion: VERSION,
    keyVersion: KEY_VERSION,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptCredentialPayload(
  envelope: CredentialEnvelope,
  context: { workspaceId: string; provider: string },
): string {
  if (
    envelope.encryptionAlgorithm !== 'AES-256-GCM' ||
    envelope.encryptionVersion !== VERSION ||
    envelope.keyVersion !== KEY_VERSION
  ) {
    throw new Error('Unsupported SDLC credential envelope');
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAAD(aad(context.workspaceId, context.provider));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.encryptedPayload, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function credentialFingerprint(token: string): string {
  return crypto.createHmac('sha256', encryptionKey()).update(token).digest('hex').slice(0, 12);
}
