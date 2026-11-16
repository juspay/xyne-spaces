import { hkdfSync } from 'crypto';
import type { Call } from '@prisma/client';
import { CallStatus, CallType, type CallEncryptionCredentials } from '@xyne/shared';
import { config } from '@/config/env';
import type { CallEncryptionState } from '@/database/repositories/callRepository';
import { logger } from '@/utils/logger';

/**
 * Server-managed keys for end-to-end encrypted calls.
 *
 * Every AUDIO/VIDEO call is encrypted. All participants encrypt media frames with
 * one shared call key that only the backend derives and only authenticated HTTPS
 * responses carry (initiate, join, guest join). LiveKit forwards ciphertext it
 * cannot read, so the key must never be placed in anything LiveKit sees: room or
 * participant metadata, token claims, data messages, dispatch metadata or egress
 * requests.
 *
 * Keys are derived, never stored: HKDF(master[version], salt = room name, info =
 * 'xyne-call-e2ee:v<version>'). The master key is a ring: CALL_E2EE_MASTER_KEY is
 * the current version (CALL_E2EE_MASTER_KEY_VERSION), CALL_E2EE_PREVIOUS_MASTER_KEYS
 * keeps the versions that calls still in progress were activated with. A call pins
 * its version when it is activated (first participant_joined), not when its row is
 * written, so a scheduled or recurring call never carries a retired version.
 */

const KEY_INFO_PREFIX = 'xyne-call-e2ee:v';
const KEY_LENGTH_BYTES = 32;
/** Activated rows written before versions existed. */
const LEGACY_KEY_VERSION = 1;

export type { CallEncryptionCredentials };

type KeyRing = { currentVersion: number; keys: Map<number, Buffer> };

// Type-only import above: the repository stamps state through this service at every
// Call creation, so this module must not need the repository at runtime.
const encryptionStateOf = (call: Pick<Call, 'metadata'>): CallEncryptionState | undefined =>
  (call.metadata as { e2ee?: CallEncryptionState } | null)?.e2ee;

const isNotYetActivated = (call: Pick<Call, 'status'>): boolean =>
  call.status === CallStatus.PENDING || call.status === CallStatus.SCHEDULED;

const decodeMasterKey = (value: string, label: string): Buffer => {
  const buffer = Buffer.from(value, 'base64');
  if (buffer.length !== KEY_LENGTH_BYTES) {
    throw new Error(`${label} must be 32 random bytes, base64 encoded`);
  }
  return buffer;
};

class CallEncryptionService {
  private ring: KeyRing | undefined;

  private keyRing(): KeyRing {
    if (this.ring) return this.ring;
    const { e2eeMasterKey, e2eeMasterKeyVersion, e2eePreviousMasterKeys } = config.livekit;
    const keys = new Map<number, Buffer>();
    for (const [version, value] of Object.entries(e2eePreviousMasterKeys)) {
      keys.set(Number(version), decodeMasterKey(value, `CALL_E2EE_PREVIOUS_MASTER_KEYS[${version}]`));
    }
    keys.set(e2eeMasterKeyVersion, decodeMasterKey(e2eeMasterKey, 'CALL_E2EE_MASTER_KEY'));
    this.ring = { currentVersion: e2eeMasterKeyVersion, keys };
    return this.ring;
  }

  currentKeyVersion(): number {
    return this.keyRing().currentVersion;
  }

  /**
   * Encryption state for a call being created, decided once when its row is written
   * (every creator in callRepository, the automation transaction and the Zero mutator
   * call this). HEADLESS recordings stay clear: their only participants are the
   * recorder and the agent, neither of which holds a key. Rows written before this
   * shipped have no state and run unencrypted, so in-flight calls survive a deploy.
   */
  stateForNewCall(params: { callType: CallType }): CallEncryptionState | undefined {
    return params.callType === CallType.HEADLESS ? undefined : { enabled: true };
  }

  /**
   * State to write when a row becomes ACTIVE: pins the current key version unless an
   * earlier activation already did. Every transition to ACTIVE goes through this.
   */
  stateAtActivation(state: CallEncryptionState | undefined): CallEncryptionState | undefined {
    if (state?.enabled !== true || state.keyVersion !== undefined) return state;
    return { ...state, keyVersion: this.currentKeyVersion() };
  }

  isCallEncrypted(call: Pick<Call, 'metadata'>): boolean {
    return encryptionStateOf(call)?.enabled === true;
  }

  deriveKey(roomName: string, keyVersion: number): Buffer {
    const masterKey = this.keyRing().keys.get(keyVersion);
    if (!masterKey) {
      throw new Error(`No master key for call key version ${keyVersion}; add it to CALL_E2EE_PREVIOUS_MASTER_KEYS`);
    }
    return Buffer.from(
      hkdfSync(
        'sha256',
        masterKey,
        Buffer.from(roomName, 'utf8'),
        Buffer.from(`${KEY_INFO_PREFIX}${keyVersion}`, 'utf8'),
        KEY_LENGTH_BYTES,
      ),
    );
  }

  /** The key material a join response carries, or undefined for an unencrypted call. */
  credentialsFor(call: Pick<Call, 'externalId' | 'metadata' | 'status'>): CallEncryptionCredentials | undefined {
    const state = encryptionStateOf(call);
    // Not activated yet: the version activation will pin is the current one. An
    // activated row with no version predates versioning.
    return this.credentials(call.externalId, state, isNotYetActivated(call) ? undefined : LEGACY_KEY_VERSION);
  }

  /**
   * Key for a join response. A row not activated yet (a SCHEDULED call, or a PENDING one
   * written before /initiate pinned versions) has the current version pinned on it now, so
   * every participant and the later activation use one version even if the master key
   * rotates in between. `pinKeyVersion` writes only when no version is stored and returns
   * the stored one. It is passed in because the repository imports this module.
   */
  async credentialsForJoin(
    call: Pick<Call, 'id' | 'externalId' | 'metadata' | 'status'>,
    pinKeyVersion: (callId: string, keyVersion: number) => Promise<number | null>,
  ): Promise<CallEncryptionCredentials | undefined> {
    const state = encryptionStateOf(call);
    if (state?.enabled !== true) return undefined;
    if (state.keyVersion === undefined && isNotYetActivated(call)) {
      const current = this.currentKeyVersion();
      const pinned = (await pinKeyVersion(call.id, current)) ?? current;
      return this.credentials(call.externalId, { ...state, keyVersion: pinned }, undefined);
    }
    return this.credentialsFor(call);
  }

  /** Same, for a call whose row is being written in the same request (not activated yet). */
  credentialsForState(roomName: string, state: CallEncryptionState | undefined): CallEncryptionCredentials | undefined {
    return this.credentials(roomName, state, undefined);
  }

  private credentials(
    roomName: string,
    state: CallEncryptionState | undefined,
    fallbackVersion: number | undefined,
  ): CallEncryptionCredentials | undefined {
    if (state?.enabled !== true) return undefined;
    try {
      const keyVersion = state.keyVersion ?? fallbackVersion ?? this.currentKeyVersion();
      return { key: this.deriveKey(roomName, keyVersion).toString('base64') };
    } catch (error) {
      // An encrypted call with no usable master key would leave every client in silence; fail loudly.
      logger.error(`[${roomName}] e2ee_key_derivation_failed`, error);
      throw error;
    }
  }
}

export const callEncryptionService = new CallEncryptionService();
