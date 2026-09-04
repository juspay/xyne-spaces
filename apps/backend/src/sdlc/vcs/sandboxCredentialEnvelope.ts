import { SDLC_AGENT_SLUG } from '@xyne/shared';
import {
  createCipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'crypto';

export interface SandboxCredentialBinding {
  agentSlug: typeof SDLC_AGENT_SLUG;
  workspaceId: string;
  repoId: string;
  operation: string;
  executionId?: string;
  sessionId?: string;
  conversationId?: string;
  sandboxId: string;
  credentialRevision: number;
  expiresAt: string;
}

export interface SandboxCredentialEnvelope {
  version: 1;
  algorithm: 'X25519-HKDF-SHA256-AES-256-GCM';
  ephemeralPublicKey: string;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  aad: string;
  expiresAt: string;
}

export function parseSandboxPublicKey(encoded: string): KeyObject {
  try {
    const key = createPublicKey({ key: Buffer.from(encoded, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'x25519') throw new Error('wrong key type');
    return key;
  } catch {
    throw new Error('Invalid sandbox public key');
  }
}

export function encryptSandboxCredentialEnvelope(
  authentication: { username: string; password: string },
  binding: SandboxCredentialBinding,
  sandboxPublicKey: KeyObject,
): SandboxCredentialEnvelope {
  const ephemeral = generateKeyPairSync('x25519');
  const ephemeralPublicKey = ephemeral.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const aad = JSON.stringify({ version: 1, ...binding });
  const sharedSecret = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: sandboxPublicKey });
  const key = Buffer.from(hkdfSync('sha256', sharedSecret, salt, Buffer.from(aad), 32));
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const plaintext = Buffer.from(JSON.stringify(authentication));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  plaintext.fill(0);
  key.fill(0);
  sharedSecret.fill(0);
  return {
    version: 1,
    algorithm: 'X25519-HKDF-SHA256-AES-256-GCM',
    ephemeralPublicKey,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    aad,
    expiresAt: binding.expiresAt,
  };
}
