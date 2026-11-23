import { createCipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from 'crypto';
import type { Call } from '@prisma/client';
import { CallStatus, CallType, type CallEncryptionCredentials } from '@xyne/shared';
import { config } from '@/config/env';
import type { CallEncryptionState } from '@/database/repositories/callRepository';
import { getEncryptionProvider } from '@/services/encryption';
import type { TransitCaller } from '@/services/encryption/types';
import { logger } from '@/utils/logger';

/**
 * Server-managed keys for end-to-end encrypted calls.
 *
 * Every AUDIO/VIDEO call is encrypted. All participants encrypt media frames with
 * one shared call key that only the backend derives and only authenticated HTTPS
 * responses carry (initiate, join, guest join, and the transcription agent's
 * session fetch, sealed to the job's key). LiveKit forwards ciphertext it
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
 *
 * With CALL_E2EE_KEY_SOURCE=encryption-service, calls activate on SERVICE_KEY_VERSION
 * instead: the encryption service creates a random key per call (`generateKey`, kept wrapped
 * under the workspace's WORKSPACE_CALLS DEK) and `transformResponse` re-encrypts it to each
 * recipient's transit key, so the backend only relays ciphertext it can't open.
 */

const KEY_INFO_PREFIX = 'xyne-call-e2ee:v';
const KEY_LENGTH_BYTES = 32;
/** HKDF info for the key that wraps a call key on its way to the transcription agent. */
const AGENT_SEAL_INFO = 'xyne-agent-call-key:v1';

/** A call key encrypted to one agent job's X25519 public key (all fields base64). */
export type SealedCallKey = { ephemeralPublicKey: string; nonce: string; ciphertext: string };
/** Activated rows written before versions existed. */
const LEGACY_KEY_VERSION = 1;
/** Pinned version meaning "keyed by the encryption service" (derived versions start at 1). */
export const SERVICE_KEY_VERSION = 0;

/** Transit ciphertext (`ENC:v1|tk-N|…`): what a recipient can open. */
const TRANSIT_CIPHERTEXT_PREFIX = 'ENC:v1|tk-';

type KeyedCall = Pick<Call, 'id' | 'externalId' | 'metadata' | 'status' | 'workspaceId'>;

/** Who a call's E2EE key is released to. */
export type CallKeyRecipient =
  /** A signed-in user: the session's transit key (`transitCaller(req)`). */
  | ({ kind: 'user'; userId: string } & TransitCaller)
  /** A lobby guest or a transcription agent job: a one-off transit key sent with the join. */
  | { kind: 'guest' | 'agent'; clientKey: string };

const transitCallerOf = (recipient: CallKeyRecipient): TransitCaller => {
  if (recipient.kind !== 'user') return { clientKey: recipient.clientKey };
  const { kind: _kind, userId: _userId, ...caller } = recipient;
  return caller;
};

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
    if (config.livekit.e2eeKeySource === 'encryption-service') return SERVICE_KEY_VERSION;
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

  /**
   * Key for a join response, for `recipient`. A row not activated yet (a SCHEDULED call, or a
   * PENDING one written before /initiate pinned versions) has the current version pinned on it
   * now, so every participant and the later activation use one version even if the key source
   * or master key changes in between. `pinKeyVersion` writes only when no version is stored and
   * returns the stored one. It is passed in because the repository imports this module.
   */
  async credentialsForJoin(
    call: KeyedCall,
    pinKeyVersion: (callId: string, keyVersion: number) => Promise<number | null>,
    recipient: CallKeyRecipient,
  ): Promise<CallEncryptionCredentials | undefined> {
    const state = encryptionStateOf(call);
    if (state?.enabled !== true) return undefined;
    let keyVersion = state.keyVersion;
    if (keyVersion === undefined) {
      if (isNotYetActivated(call)) {
        const current = this.currentKeyVersion();
        keyVersion = (await pinKeyVersion(call.id, current)) ?? current;
      } else {
        keyVersion = LEGACY_KEY_VERSION;
      }
    }
    return this.credentials(call, keyVersion, recipient);
  }

  /** Same, for a call whose row is being written in the same request (not activated yet). */
  async credentialsForState(
    call: Pick<Call, 'externalId' | 'workspaceId'>,
    state: CallEncryptionState | undefined,
    recipient: CallKeyRecipient,
  ): Promise<CallEncryptionCredentials | undefined> {
    if (state?.enabled !== true) return undefined;
    return this.credentials(call, state.keyVersion ?? this.currentKeyVersion(), recipient);
  }

  /** Whether a call's key comes from the encryption service (vs. derived here). */
  isServiceKeyed(call: Pick<Call, 'metadata'>): boolean {
    return encryptionStateOf(call)?.keyVersion === SERVICE_KEY_VERSION;
  }

  /**
   * Encrypts a call key to the agent job's one-time X25519 public key, so the key
   * never crosses the in-cluster hop in clear. X25519 -> HKDF-SHA256 -> AES-256-GCM,
   * with the room name as AAD so a sealed key can't be replayed for another call.
   */
  /** A raw 32-byte X25519 key that isn't a small-order point (those force an all-zero secret). */
  isUsableAgentPublicKey(agentPublicKeyB64: string): boolean {
    try {
      this.agreeWithAgent(agentPublicKeyB64, generateKeyPairSync('x25519').privateKey);
      return true;
    } catch {
      return false;
    }
  }

  private agreeWithAgent(agentPublicKeyB64: string, privateKey: KeyObject): Buffer {
    const agentRaw = Buffer.from(agentPublicKeyB64, 'base64');
    if (agentRaw.length !== 32) throw new Error('agent public key must be 32 bytes (raw X25519)');
    const agentPublicKey = createPublicKey({
      key: { kty: 'OKP', crv: 'X25519', x: agentRaw.toString('base64url') },
      format: 'jwk',
    });
    const shared = diffieHellman({ privateKey, publicKey: agentPublicKey });
    if (shared.every((byte) => byte === 0)) throw new Error('agent public key is a small-order point');
    return shared;
  }

  sealKeyForAgent(roomName: string, key: string, agentPublicKeyB64: string): SealedCallKey {
    const ephemeral = generateKeyPairSync('x25519');
    const shared = this.agreeWithAgent(agentPublicKeyB64, ephemeral.privateKey);
    const wrapKey = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from(AGENT_SEAL_INFO, 'utf8'), 32));
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', wrapKey, nonce);
    cipher.setAAD(Buffer.from(roomName, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(key, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    const ephemeralX = ephemeral.publicKey.export({ format: 'jwk' }).x as string;
    return {
      ephemeralPublicKey: Buffer.from(ephemeralX, 'base64url').toString('base64'),
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  private async credentials(
    call: Pick<Call, 'externalId' | 'workspaceId'>,
    keyVersion: number,
    recipient: CallKeyRecipient,
  ): Promise<CallEncryptionCredentials> {
    const roomName = call.externalId;
    try {
      if (keyVersion !== SERVICE_KEY_VERSION) {
        return { key: this.deriveKey(roomName, keyVersion).toString('base64') };
      }
      const provider = getEncryptionProvider();
      const { wrappedKey } = await provider.generateKey({ keyType: 'CALL', workspaceId: call.workspaceId, keyValue: roomName });
      const { body } = await provider.transformResponse({ encryptedKey: wrappedKey }, transitCallerOf(recipient));
      // transformResponse is a no-op with API client encryption off; DEK ciphertext would leave the client silent.
      if (!body.encryptedKey.startsWith(TRANSIT_CIPHERTEXT_PREFIX)) throw new Error('Call key was not re-encrypted to the recipient');
      return { encryptedKey: body.encryptedKey };
    } catch (error) {
      // An encrypted call with no usable key would leave every client in silence; fail loudly.
      logger.error(`[${roomName}] e2ee_key_unavailable | key_version=${keyVersion}, recipient=${recipient.kind}`, error);
      throw error;
    }
  }
}

export const callEncryptionService = new CallEncryptionService();
