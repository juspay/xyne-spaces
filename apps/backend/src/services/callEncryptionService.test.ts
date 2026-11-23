const KEY_V1 = Buffer.alloc(32, 1).toString('base64');
const KEY_V2 = Buffer.alloc(32, 2).toString('base64');

const livekit = {
  e2eeMasterKey: KEY_V2,
  e2eeMasterKeyVersion: 2,
  e2eePreviousMasterKeys: { '1': KEY_V1 } as Record<string, string>,
  e2eeKeySource: 'derived' as 'derived' | 'encryption-service',
};

const generateKey = jest.fn();
const transformResponse = jest.fn();

jest.mock('@/config/env', () => ({ config: { livekit } }));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
jest.mock('@/services/encryption', () => ({ getEncryptionProvider: () => ({ generateKey, transformResponse }) }));
// @xyne/shared ships ESM that jest's transform ignores — stub the enums used.
jest.mock('@xyne/shared', () => ({
  CallStatus: { PENDING: 'PENDING', SCHEDULED: 'SCHEDULED', ACTIVE: 'ACTIVE', ENDED: 'ENDED', CANCELLED: 'CANCELLED' },
  CallType: { AUDIO: 'AUDIO', VIDEO: 'VIDEO', HEADLESS: 'HEADLESS' },
}));

import { createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, type KeyObject } from 'crypto';
import { callEncryptionService, SERVICE_KEY_VERSION, type CallKeyRecipient } from './callEncryptionService';

const user: CallKeyRecipient = { kind: 'user', userId: 'u1', authToken: 'jwt' };
const row = (status: string, e2ee?: Record<string, boolean | number>) => ({
  id: 'call-1',
  externalId: 'room-1',
  workspaceId: 'ws-1',
  status,
  metadata: e2ee ? { e2ee } : {},
});
const keyAt = (version: number) => callEncryptionService.deriveKey('room-1', version).toString('base64');
const noPin = jest.fn(async () => null);

afterEach(() => {
  livekit.e2eeKeySource = 'derived';
  jest.clearAllMocks();
});

describe('callEncryptionService key ring', () => {
  it('derives a stable key per room and version', () => {
    const a = callEncryptionService.deriveKey('room-1', 2);
    expect(a.length).toBe(32);
    expect(callEncryptionService.deriveKey('room-1', 2).equals(a)).toBe(true);
    expect(callEncryptionService.deriveKey('room-2', 2).equals(a)).toBe(false);
    expect(callEncryptionService.deriveKey('room-1', 1).equals(a)).toBe(false);
  });

  it('refuses a version that is no longer in the ring', () => {
    expect(() => callEncryptionService.deriveKey('room-1', 3)).toThrow(/version 3/);
  });

  it('pins the current version at activation and keeps an earlier pin', () => {
    expect(callEncryptionService.stateAtActivation({ enabled: true })).toEqual({ enabled: true, keyVersion: 2 });
    const pinned = { enabled: true, keyVersion: 1 };
    expect(callEncryptionService.stateAtActivation(pinned)).toBe(pinned);
    expect(callEncryptionService.stateAtActivation(undefined)).toBeUndefined();
    expect(callEncryptionService.stateForNewCall({ callType: 'VIDEO' as never })).toEqual({ enabled: true });
    expect(callEncryptionService.stateForNewCall({ callType: 'HEADLESS' as never })).toBeUndefined();
  });

  it('hands an activated row its pinned version and a new call the current one', async () => {
    await expect(callEncryptionService.credentialsForState(row('PENDING'), { enabled: true }, user)).resolves.toEqual({ key: keyAt(2) });
    await expect(callEncryptionService.credentialsForJoin(row('ACTIVE', { enabled: true, keyVersion: 1 }), noPin, user)).resolves.toEqual({ key: keyAt(1) });
    await expect(callEncryptionService.credentialsForJoin(row('ENDED', { enabled: true, keyVersion: 2 }), noPin, user)).resolves.toEqual({ key: keyAt(2) });
  });

  it('treats an activated row without a version as version 1', async () => {
    await expect(callEncryptionService.credentialsForJoin(row('ACTIVE', { enabled: true }), noPin, user)).resolves.toEqual({ key: keyAt(1) });
  });

  it('returns nothing for unencrypted calls', async () => {
    await expect(callEncryptionService.credentialsForJoin(row('ACTIVE'), noPin, user)).resolves.toBeUndefined();
    await expect(callEncryptionService.credentialsForJoin(row('ACTIVE', { enabled: false }), noPin, user)).resolves.toBeUndefined();
    expect(callEncryptionService.isCallEncrypted(row('ACTIVE', { enabled: true }))).toBe(true);
    expect(callEncryptionService.isCallEncrypted(row('ACTIVE'))).toBe(false);
  });
});

describe('callEncryptionService.credentialsForJoin', () => {
  it('pins the current version on a row that is not activated yet and uses it', async () => {
    const pin = jest.fn(async (_callId: string, version: number) => version);
    await expect(callEncryptionService.credentialsForJoin(row('SCHEDULED', { enabled: true }), pin, user)).resolves.toEqual({ key: keyAt(2) });
    await expect(callEncryptionService.credentialsForJoin(row('PENDING', { enabled: true }), pin, user)).resolves.toEqual({ key: keyAt(2) });
    expect(pin).toHaveBeenCalledWith('call-1', 2);
  });

  it('uses the version already stored when another join pinned first', async () => {
    const pin = jest.fn(async () => 1);
    await expect(callEncryptionService.credentialsForJoin(row('SCHEDULED', { enabled: true }), pin, user)).resolves.toEqual({ key: keyAt(1) });
  });

  it('does not write for pinned, activated or unencrypted rows', async () => {
    const pin = jest.fn(async () => 2);
    await expect(callEncryptionService.credentialsForJoin(row('SCHEDULED', { enabled: true, keyVersion: 1 }), pin, user)).resolves.toEqual({ key: keyAt(1) });
    await expect(callEncryptionService.credentialsForJoin(row('ACTIVE', { enabled: true }), pin, user)).resolves.toEqual({ key: keyAt(1) });
    await expect(callEncryptionService.credentialsForJoin(row('ACTIVE'), pin, user)).resolves.toBeUndefined();
    expect(pin).not.toHaveBeenCalled();
  });
});

describe('callEncryptionService with keys from the encryption service', () => {
  beforeEach(() => {
    livekit.e2eeKeySource = 'encryption-service';
    generateKey.mockResolvedValue({ wrappedKey: 'ENC:v1|dek-1|wrapped' });
    transformResponse.mockResolvedValue({ body: { encryptedKey: 'ENC:v1|tk-1|abc' } });
  });

  it('pins the service version at activation and on a first join', async () => {
    expect(callEncryptionService.stateAtActivation({ enabled: true })).toEqual({ enabled: true, keyVersion: SERVICE_KEY_VERSION });
    const pin = jest.fn(async (_callId: string, version: number) => version);
    await expect(callEncryptionService.credentialsForJoin(row('SCHEDULED', { enabled: true }), pin, user)).resolves.toEqual({
      encryptedKey: 'ENC:v1|tk-1|abc',
    });
    expect(pin).toHaveBeenCalledWith('call-1', SERVICE_KEY_VERSION);
  });

  it('generates the call key by room name and workspace, then re-encrypts it to the recipient', async () => {
    const guest: CallKeyRecipient = { kind: 'guest', clientKey: 'BA==' };
    await callEncryptionService.credentialsForJoin(row('ACTIVE', { enabled: true, keyVersion: SERVICE_KEY_VERSION }), noPin, guest);
    expect(generateKey).toHaveBeenCalledWith({ keyType: 'CALL', workspaceId: 'ws-1', keyValue: 'room-1' });
    expect(transformResponse).toHaveBeenCalledWith({ encryptedKey: 'ENC:v1|dek-1|wrapped' }, { clientKey: 'BA==' });
    await callEncryptionService.credentialsForJoin(row('ACTIVE', { enabled: true, keyVersion: SERVICE_KEY_VERSION }), noPin, user);
    expect(transformResponse).toHaveBeenLastCalledWith({ encryptedKey: 'ENC:v1|dek-1|wrapped' }, { authToken: 'jwt' });
  });

  it('fails the join when the key comes back still under the DEK (API client encryption off)', async () => {
    transformResponse.mockResolvedValue({ body: { encryptedKey: 'ENC:v1|dek-1|wrapped' } });
    await expect(callEncryptionService.credentialsForJoin(row('ACTIVE', { enabled: true, keyVersion: SERVICE_KEY_VERSION }), noPin, user)).rejects.toThrow(/re-encrypted/);
  });

  it('keeps calls pinned to a derived version on the derived key during the cutover', async () => {
    await expect(callEncryptionService.credentialsForJoin(row('ACTIVE', { enabled: true, keyVersion: 1 }), noPin, user)).resolves.toEqual({ key: keyAt(1) });
    expect(generateKey).not.toHaveBeenCalled();
  });

  it('fails the join when the service cannot generate the key', async () => {
    generateKey.mockRejectedValue(new Error('unavailable'));
    await expect(callEncryptionService.credentialsForJoin(row('ACTIVE', { enabled: true, keyVersion: SERVICE_KEY_VERSION }), noPin, user)).rejects.toThrow('unavailable');
  });
});

describe('callEncryptionService.sealKeyForAgent', () => {
  const CALL_KEY = Buffer.alloc(32, 7).toString('base64');
  // Mirrors the agent's unseal (python-agent/infra/call_session.py).
  const unseal = (roomName: string, agentPrivateKey: KeyObject, sealed: { ephemeralPublicKey: string; nonce: string; ciphertext: string }) => {
    const ephemeral = createPublicKey({
      key: { kty: 'OKP', crv: 'X25519', x: Buffer.from(sealed.ephemeralPublicKey, 'base64').toString('base64url') },
      format: 'jwk',
    });
    const shared = diffieHellman({ privateKey: agentPrivateKey, publicKey: ephemeral });
    const wrapKey = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from('xyne-agent-call-key:v1'), 32));
    const blob = Buffer.from(sealed.ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', wrapKey, Buffer.from(sealed.nonce, 'base64'));
    decipher.setAAD(Buffer.from(roomName, 'utf8'));
    decipher.setAuthTag(blob.subarray(blob.length - 16));
    return Buffer.concat([decipher.update(blob.subarray(0, blob.length - 16)), decipher.final()]).toString('utf8');
  };
  const agentKeys = () => {
    const pair = generateKeyPairSync('x25519');
    const raw = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x as string, 'base64url').toString('base64');
    return { privateKey: pair.privateKey, publicKeyB64: raw };
  };

  it('only the job holding the private key can open it, and only for that room', () => {
    const agent = agentKeys();
    const sealed = callEncryptionService.sealKeyForAgent('room-1', CALL_KEY, agent.publicKeyB64);
    expect(sealed.ciphertext).not.toContain(CALL_KEY);
    expect(unseal('room-1', agent.privateKey, sealed)).toBe(CALL_KEY);
    expect(() => unseal('room-2', agent.privateKey, sealed)).toThrow();
    expect(() => unseal('room-1', agentKeys().privateKey, sealed)).toThrow();
  });

  it('uses a fresh ephemeral key and nonce every time', () => {
    const agent = agentKeys();
    const a = callEncryptionService.sealKeyForAgent('room-1', CALL_KEY, agent.publicKeyB64);
    const b = callEncryptionService.sealKeyForAgent('room-1', CALL_KEY, agent.publicKeyB64);
    expect(a.ephemeralPublicKey).not.toBe(b.ephemeralPublicKey);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('rejects small-order public keys, which would force an all-zero shared secret', () => {
    const zeroPoint = Buffer.alloc(32).toString('base64');
    const onePoint = Buffer.concat([Buffer.from([1]), Buffer.alloc(31)]).toString('base64');
    for (const weak of [zeroPoint, onePoint]) {
      expect(callEncryptionService.isUsableAgentPublicKey(weak)).toBe(false);
      expect(() => callEncryptionService.sealKeyForAgent('room-1', CALL_KEY, weak)).toThrow();
    }
    expect(callEncryptionService.isUsableAgentPublicKey(agentKeys().publicKeyB64)).toBe(true);
  });

  it('rejects a public key that is not 32 raw bytes', () => {
    expect(() => callEncryptionService.sealKeyForAgent('room-1', CALL_KEY, Buffer.alloc(31).toString('base64'))).toThrow(/32 bytes/);
  });
});
