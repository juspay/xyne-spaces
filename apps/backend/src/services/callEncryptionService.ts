import { hkdfSync } from 'crypto';
import type { Call } from '@prisma/client';
import { CallType, type CallEncryptionCredentials } from '@xyne/shared';
import { config } from '@/config/env';
import { superpositionClient } from '@/services/superpositionClient';
import type { CallEncryptionState } from '@/database/repositories/callRepository';
import { logger } from '@/utils/logger';

/**
 * Server-managed keys for end-to-end encrypted calls.
 *
 * Every participant encrypts media frames with one shared call key that only the
 * backend derives and only authenticated HTTPS responses carry (initiate, join,
 * guest join, the key endpoint). LiveKit forwards ciphertext it cannot read, so
 * the key must never be placed in anything LiveKit sees: room or participant
 * metadata, token claims, data messages, dispatch metadata or egress requests.
 *
 * Keys are derived, never stored: HKDF(master, salt = room name, info = key index).
 * The index is fixed at 0 today; rotation (a later change) only increments it, and
 * LiveKit frames already carry the index, so no format changes are needed.
 */

export const CALL_E2EE_CONFIG_KEY = 'call_e2ee_config';
const KEY_INFO_PREFIX = 'xyne-call-e2ee:';
const KEY_LENGTH_BYTES = 32;

/** Shape of the Superposition value; off until every client platform has shipped encryption. */
const DEFAULT_CONFIG = { enabled: false };

export type { CallEncryptionCredentials };

// Type-only import above: the repository stamps state through this service at every
// Call creation, so this module must not need the repository at runtime.
const encryptionStateOf = (call: Pick<Call, 'metadata'>): CallEncryptionState | undefined =>
  (call.metadata as { e2ee?: CallEncryptionState } | null)?.e2ee;

class CallEncryptionService {
  private masterKey(): Buffer | null {
    const raw = config.livekit.e2eeMasterKey;
    if (!raw) return null;
    const buffer = Buffer.from(raw, 'base64');
    return buffer.length === KEY_LENGTH_BYTES ? buffer : null;
  }

  isConfigured(): boolean {
    return this.masterKey() !== null;
  }

  /**
   * Encryption state for a call being created, decided once when its row is written
   * (every creator in callRepository, the automation transaction and the Zero mutator
   * call this). Undefined means the call runs unencrypted and no key is ever issued. HEADLESS recordings stay clear:
   * their only participants are the recorder and the agent, neither of which
   * holds a key yet.
   */
  async stateForNewCall(params: {
    callType: CallType;
    workspaceId: string | undefined;
  }): Promise<CallEncryptionState | undefined> {
    if (params.callType === CallType.HEADLESS) return undefined;
    if (!this.isConfigured()) return undefined;

    const raw = await superpositionClient.getObjectValue(
      CALL_E2EE_CONFIG_KEY,
      DEFAULT_CONFIG,
      params.workspaceId ? { workspaceId: params.workspaceId } : {},
    );
    const enabled =
      raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).enabled === true;
    return enabled ? { enabled: true, keyIndex: 0 } : undefined;
  }

  isCallEncrypted(call: Pick<Call, 'metadata'>): boolean {
    return encryptionStateOf(call)?.enabled === true;
  }

  currentKeyIndex(call: Pick<Call, 'metadata'>): number {
    return encryptionStateOf(call)?.keyIndex ?? 0;
  }

  deriveKey(roomName: string, keyIndex: number): Buffer {
    const master = this.masterKey();
    if (!master) {
      throw new Error('CALL_E2EE_MASTER_KEY is not configured');
    }
    return Buffer.from(
      hkdfSync('sha256', master, Buffer.from(roomName, 'utf8'), Buffer.from(`${KEY_INFO_PREFIX}${keyIndex}`, 'utf8'), KEY_LENGTH_BYTES),
    );
  }

  /** The key material a join response carries, or undefined for an unencrypted call. */
  credentialsFor(call: Pick<Call, 'externalId' | 'metadata'>, keyIndex?: number): CallEncryptionCredentials | undefined {
    return this.credentialsForState(call.externalId, encryptionStateOf(call), keyIndex);
  }

  /** Same, for a call whose row is being written in the same request. */
  credentialsForState(
    roomName: string,
    state: CallEncryptionState | undefined,
    keyIndex?: number,
  ): CallEncryptionCredentials | undefined {
    if (state?.enabled !== true) return undefined;
    const index = keyIndex ?? state.keyIndex;
    try {
      return { key: this.deriveKey(roomName, index).toString('base64'), keyIndex: index };
    } catch (error) {
      // An encrypted call with no master key would leave every client in silence; fail loudly.
      logger.error(`[${roomName}] e2ee_key_derivation_failed | key_index=${index}`, error);
      throw error;
    }
  }
}

export const callEncryptionService = new CallEncryptionService();
