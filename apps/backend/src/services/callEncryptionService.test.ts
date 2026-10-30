const mockConfig = { livekit: { e2eeMasterKey: '' } };
const mockGetObjectValue = jest.fn();

jest.mock('@/config/env', () => ({ config: mockConfig }));
jest.mock('@/services/superpositionClient', () => ({
  superpositionClient: { getObjectValue: (...args: unknown[]) => mockGetObjectValue(...args) },
}));
jest.mock('@/database/repositories/callRepository', () => ({
  getCallEncryptionState: (call: { metadata: { e2ee?: unknown } | null }) => call.metadata?.e2ee,
}));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } }));
// The bare package resolves to its ESM dist, which jest cannot parse; the service only needs the enum.
jest.mock('@xyne/shared', () => ({ CallType: { AUDIO: 'AUDIO', VIDEO: 'VIDEO', HEADLESS: 'HEADLESS' } }));

import { CallType } from '@xyne/shared';
import { callEncryptionService, CALL_E2EE_CONFIG_KEY } from './callEncryptionService';

const MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
const encryptedCall = (externalId: string, keyIndex = 0) => ({
  externalId,
  metadata: { e2ee: { enabled: true, keyIndex } },
});

describe('callEncryptionService', () => {
  beforeEach(() => {
    mockConfig.livekit.e2eeMasterKey = MASTER_KEY;
    mockGetObjectValue.mockReset();
    mockGetObjectValue.mockResolvedValue({ enabled: true });
  });

  describe('without a master key', () => {
    beforeEach(() => {
      mockConfig.livekit.e2eeMasterKey = '';
    });

    it('never enables encryption for a new call', async () => {
      await expect(
        callEncryptionService.stateForNewCall({ callType: CallType.AUDIO, workspaceId: 'ws' }),
      ).resolves.toBeUndefined();
      expect(mockGetObjectValue).not.toHaveBeenCalled();
    });

    it('refuses to derive a key', () => {
      expect(() => callEncryptionService.deriveKey('room', 0)).toThrow(/CALL_E2EE_MASTER_KEY/);
    });
  });

  describe('stateForNewCall', () => {
    it('enables encryption when the workspace flag is on', async () => {
      await expect(
        callEncryptionService.stateForNewCall({ callType: CallType.VIDEO, workspaceId: 'ws-1' }),
      ).resolves.toEqual({ enabled: true, keyIndex: 0 });
      expect(mockGetObjectValue).toHaveBeenCalledWith(
        CALL_E2EE_CONFIG_KEY,
        { enabled: false },
        { workspaceId: 'ws-1' },
      );
    });

    it('leaves the call unencrypted when the flag is off or malformed', async () => {
      mockGetObjectValue.mockResolvedValueOnce({ enabled: false });
      await expect(
        callEncryptionService.stateForNewCall({ callType: CallType.AUDIO, workspaceId: 'ws' }),
      ).resolves.toBeUndefined();

      mockGetObjectValue.mockResolvedValueOnce('yes');
      await expect(
        callEncryptionService.stateForNewCall({ callType: CallType.AUDIO, workspaceId: 'ws' }),
      ).resolves.toBeUndefined();
    });

    it('never encrypts HEADLESS note-taker recordings', async () => {
      await expect(
        callEncryptionService.stateForNewCall({ callType: CallType.HEADLESS, workspaceId: 'ws' }),
      ).resolves.toBeUndefined();
      expect(mockGetObjectValue).not.toHaveBeenCalled();
    });
  });

  describe('deriveKey', () => {
    it('is deterministic and 32 bytes long', () => {
      const a = callEncryptionService.deriveKey('room-a', 0);
      const b = callEncryptionService.deriveKey('room-a', 0);
      expect(a.length).toBe(32);
      expect(a.equals(b)).toBe(true);
    });

    it('separates rooms and key indexes', () => {
      const base = callEncryptionService.deriveKey('room-a', 0);
      expect(callEncryptionService.deriveKey('room-b', 0).equals(base)).toBe(false);
      expect(callEncryptionService.deriveKey('room-a', 1).equals(base)).toBe(false);
    });

    it('changes with the master key', () => {
      const first = callEncryptionService.deriveKey('room-a', 0);
      mockConfig.livekit.e2eeMasterKey = Buffer.alloc(32, 9).toString('base64');
      expect(callEncryptionService.deriveKey('room-a', 0).equals(first)).toBe(false);
    });
  });

  describe('credentialsFor', () => {
    it('returns nothing for an unencrypted call', () => {
      expect(callEncryptionService.isCallEncrypted({ metadata: null })).toBe(false);
      expect(callEncryptionService.credentialsFor({ externalId: 'room', metadata: null })).toBeUndefined();
      expect(
        callEncryptionService.credentialsFor({ externalId: 'room', metadata: { e2ee: { enabled: false, keyIndex: 0 } } }),
      ).toBeUndefined();
    });

    it("returns the call's current key, base64 encoded, with its index", () => {
      const credentials = callEncryptionService.credentialsFor(encryptedCall('room-a', 2));
      expect(credentials).toEqual({
        key: callEncryptionService.deriveKey('room-a', 2).toString('base64'),
        keyIndex: 2,
      });
    });

    it('honours an explicit key index', () => {
      const credentials = callEncryptionService.credentialsFor(encryptedCall('room-a', 2), 1);
      expect(credentials?.keyIndex).toBe(1);
      expect(credentials?.key).toBe(callEncryptionService.deriveKey('room-a', 1).toString('base64'));
    });

    it('matches credentialsForState for a row being written in the same request', () => {
      expect(callEncryptionService.credentialsForState('room-a', { enabled: true, keyIndex: 0 })).toEqual(
        callEncryptionService.credentialsFor(encryptedCall('room-a')),
      );
      expect(callEncryptionService.credentialsForState('room-a', undefined)).toBeUndefined();
    });
  });
});
