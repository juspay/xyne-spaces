const KEY_V1 = Buffer.alloc(32, 1).toString('base64');
const KEY_V2 = Buffer.alloc(32, 2).toString('base64');

const livekit = {
  e2eeMasterKey: KEY_V2,
  e2eeMasterKeyVersion: 2,
  e2eePreviousMasterKeys: { '1': KEY_V1 } as Record<string, string>,
};

jest.mock('@/config/env', () => ({ config: { livekit } }));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
// @xyne/shared ships ESM that jest's transform ignores — stub the enums used.
jest.mock('@xyne/shared', () => ({
  CallStatus: { PENDING: 'PENDING', SCHEDULED: 'SCHEDULED', ACTIVE: 'ACTIVE', ENDED: 'ENDED', CANCELLED: 'CANCELLED' },
  CallType: { AUDIO: 'AUDIO', VIDEO: 'VIDEO', HEADLESS: 'HEADLESS' },
}));

import type { Call } from '@prisma/client';
import { callEncryptionService } from './callEncryptionService';

const row = (status: string, e2ee?: Record<string, boolean | number>): Pick<Call, 'externalId' | 'metadata' | 'status'> => ({
  externalId: 'room-1',
  status,
  metadata: e2ee ? { e2ee } : {},
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

  it('hands a not-yet-activated call the current version and an activated row its pinned one', () => {
    const current = callEncryptionService.deriveKey('room-1', 2).toString('base64');
    const v1 = callEncryptionService.deriveKey('room-1', 1).toString('base64');
    expect(callEncryptionService.credentialsFor(row('PENDING', { enabled: true }))).toEqual({ key: current });
    expect(callEncryptionService.credentialsFor(row('SCHEDULED', { enabled: true }))).toEqual({ key: current });
    expect(callEncryptionService.credentialsForState('room-1', { enabled: true })).toEqual({ key: current });
    expect(callEncryptionService.credentialsFor(row('ACTIVE', { enabled: true, keyVersion: 1 }))).toEqual({ key: v1 });
    expect(callEncryptionService.credentialsFor(row('ENDED', { enabled: true, keyVersion: 2 }))).toEqual({ key: current });
  });

  it('treats an activated row without a version as version 1', () => {
    const v1 = callEncryptionService.deriveKey('room-1', 1).toString('base64');
    expect(callEncryptionService.credentialsFor(row('ACTIVE', { enabled: true }))).toEqual({ key: v1 });
  });

  it('returns nothing for unencrypted calls', () => {
    expect(callEncryptionService.credentialsFor(row('ACTIVE'))).toBeUndefined();
    expect(callEncryptionService.credentialsFor(row('ACTIVE', { enabled: false }))).toBeUndefined();
    expect(callEncryptionService.isCallEncrypted(row('ACTIVE', { enabled: true }))).toBe(true);
    expect(callEncryptionService.isCallEncrypted(row('ACTIVE'))).toBe(false);
  });
});

describe('callEncryptionService.credentialsForJoin', () => {
  const joinRow = (status: string, e2ee?: Record<string, boolean | number>) => ({ id: 'call-1', ...row(status, e2ee) });
  const keyAt = (version: number) => callEncryptionService.deriveKey('room-1', version).toString('base64');

  it('pins the current version on a row that is not activated yet and uses it', async () => {
    const pin = jest.fn(async (_callId: string, version: number) => version);
    await expect(callEncryptionService.credentialsForJoin(joinRow('SCHEDULED', { enabled: true }), pin)).resolves.toEqual({ key: keyAt(2) });
    await expect(callEncryptionService.credentialsForJoin(joinRow('PENDING', { enabled: true }), pin)).resolves.toEqual({ key: keyAt(2) });
    expect(pin).toHaveBeenCalledWith('call-1', 2);
  });

  it('uses the version already stored when another join pinned first', async () => {
    const pin = jest.fn(async () => 1);
    await expect(callEncryptionService.credentialsForJoin(joinRow('SCHEDULED', { enabled: true }), pin)).resolves.toEqual({ key: keyAt(1) });
  });

  it('does not write for pinned, activated or unencrypted rows', async () => {
    const pin = jest.fn(async () => 2);
    await expect(callEncryptionService.credentialsForJoin(joinRow('SCHEDULED', { enabled: true, keyVersion: 1 }), pin)).resolves.toEqual({ key: keyAt(1) });
    await expect(callEncryptionService.credentialsForJoin(joinRow('ACTIVE', { enabled: true }), pin)).resolves.toEqual({ key: keyAt(1) });
    await expect(callEncryptionService.credentialsForJoin(joinRow('ACTIVE'), pin)).resolves.toBeUndefined();
    expect(pin).not.toHaveBeenCalled();
  });
});
