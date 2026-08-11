import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
} from 'crypto';
import {
  encryptSandboxCredentialEnvelope,
  parseSandboxPublicKey,
  type SandboxCredentialEnvelope,
} from '../../../src/sdlc/vcs/sandboxCredentialEnvelope';

function decrypt(envelope: SandboxCredentialEnvelope, privateKeyDer: Buffer): string {
  const privateKey = createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey({
    key: Buffer.from(envelope.ephemeralPublicKey, 'base64'),
    format: 'der',
    type: 'spki',
  });
  const secret = diffieHellman({ privateKey, publicKey });
  const key = Buffer.from(
    hkdfSync('sha256', secret, Buffer.from(envelope.salt, 'base64'), Buffer.from(envelope.aad), 32)
  );
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(envelope.aad));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

describe('sandbox credential envelope', () => {
  const binding = {
    agentSlug: 'sdlc-agent' as const,
    workspaceId: 'workspace-1',
    repoId: 'repo-1',
    operation: 'PUSH',
    executionId: 'execution-1',
    sessionId: 'session-1',
    sandboxId: 'sandbox-1',
    credentialRevision: 4,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };

  it('decrypts only with sandbox private key and authenticated binding', () => {
    const sandbox = generateKeyPairSync('x25519');
    const publicKey = sandbox.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const privateKey = sandbox.privateKey.export({ format: 'der', type: 'pkcs8' });
    const envelope = encryptSandboxCredentialEnvelope(
      { username: 'x-access-token', password: 'github_pat_secret_123' },
      binding,
      parseSandboxPublicKey(publicKey)
    );

    expect(JSON.parse(decrypt(envelope, privateKey))).toEqual({
      username: 'x-access-token',
      password: 'github_pat_secret_123',
    });
    expect(JSON.stringify(envelope)).not.toContain('github_pat_secret_123');
    expect(JSON.parse(envelope.aad)).toMatchObject(binding);
  });

  it('rejects another sandbox key and tampered binding', () => {
    const sandbox = generateKeyPairSync('x25519');
    const otherSandbox = generateKeyPairSync('x25519');
    const envelope = encryptSandboxCredentialEnvelope(
      { username: 'x-access-token', password: 'github_pat_secret_123' },
      binding,
      sandbox.publicKey
    );
    expect(() =>
      decrypt(envelope, otherSandbox.privateKey.export({ format: 'der', type: 'pkcs8' }))
    ).toThrow();
    expect(() =>
      decrypt(
        { ...envelope, aad: envelope.aad.replace('sandbox-1', 'sandbox-2') },
        sandbox.privateKey.export({ format: 'der', type: 'pkcs8' })
      )
    ).toThrow();
  });
});
