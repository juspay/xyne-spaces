/**
 * XChat (X's end-to-end encrypted chat) for a connected brand account.
 *
 * Built on X's chat-xdk (`@xdevplatform/chat-xdk-server`), live-verified 2026-11-20:
 * - Enabling: the tenant enters the account's XChat passcode once. We unlock the account's keys
 *   from X's key backup (Juicebox) and export them; the passcode is discarded, the exported keys
 *   are stored in the source's encrypted credentials.
 * - Receiving: `chat.received` carries `encoded_event` (+ `conversation_key_change_event` when the
 *   key rotated); both go into one decrypt batch.
 * - Sending: encrypt with the conversation key (cached from decrypting, or loaded from the
 *   conversation's history) and POST /2/chat/conversations/{id}/messages.
 *
 * Secrets: the passcode, the exported keys and decrypted text are never logged.
 */
import { createHash } from 'node:crypto';
import type { ServerChat, PublicKeyRecords } from '@xdevplatform/chat-xdk-server';
import { logger } from '@/utils/logger';
import { xApiClient, type XApiClient, type XChatPublicKeyRecord } from './client';
import { oneToOneDmConversationId } from './normalizer';
import type { XChatKeys } from './types';

const TAG = '[XChat]';
const PUBLIC_KEY_TTL_MS = 5 * 60_000;

type Xdk = typeof import('@xdevplatform/chat-xdk-server');
let xdkModule: Promise<Xdk> | undefined;
/** Loaded on first use: the WASM module is only needed by sources with XChat enabled. */
const loadXdk = () => (xdkModule ??= import('@xdevplatform/chat-xdk-server'));

export type XChatUnlockErrorCode = 'xchat_not_set_up' | 'xchat_invalid_passcode' | 'xchat_unlock_failed';

export class XChatUnlockError extends Error {
  constructor(
    readonly code: XChatUnlockErrorCode,
    message: string,
    /** X's remaining passcode attempts (shared with the account's own XChat apps). */
    readonly guessesRemaining: number | null = null,
  ) {
    super(message);
    this.name = 'XChatUnlockError';
  }
}

/** A decrypted one-to-one XChat message. */
export interface XChatMessage {
  id: string;
  /** The XChat conversation id, as XChat signs it ("<low>:<high>"). */
  chatConversationId: string;
  /** The DM-thread form ("<low>-<high>"), shared with legacy DMs of the same pair. */
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: Date;
}

/**
 * XChat conversation id → DM conversation id, so a customer's legacy DMs and XChat messages land in
 * one thread. Groups ("g…") return undefined: not supported yet.
 */
export function dmConversationIdFromChat(chatConversationId: string): string | undefined {
  const parts = chatConversationId.split(/[:-]/);
  if (parts.length !== 2 || !parts.every((p) => /^\d+$/.test(p))) return undefined;
  return oneToOneDmConversationId(parts[0], parts[1]);
}

/** DM conversation id ("<low>-<high>") → the form XChat signs messages with ("<low>:<high>"). */
export const chatConversationIdFromDm = (dmConversationId: string) => dmConversationId.replace('-', ':');

/** XChat message ids are UUIDs; legacy DM event ids are numeric. */
export const isXChatMessageId = (id: string) => !/^\d+$/.test(id);

const fingerprint = (keys: XChatKeys) => createHash('sha256').update(keys.keys).update(keys.signingKeyVersion).digest('hex').slice(0, 16);

const latestRecord = (records: XChatPublicKeyRecord[]) =>
  records.reduce<XChatPublicKeyRecord | undefined>(
    (best, r) => (!best || Number(r.public_key_version ?? 0) >= Number(best.public_key_version ?? 0) ? r : best),
    undefined,
  );

function invalidPasscode(error: unknown): { guessesRemaining: number | null } | null {
  const e = error as { kind?: string; guessesRemaining?: number | null; message?: string };
  if (e?.guessesRemaining !== undefined && e.guessesRemaining !== null) return { guessesRemaining: e.guessesRemaining };
  if (/invalid pin/i.test(e?.message ?? '')) return { guessesRemaining: null };
  return null;
}

/** One brand account's XChat context: who it is, how to get a user token, and its keys. */
export interface XChatAccount {
  sourceId: string;
  xUserId: string;
  keys: XChatKeys;
  /** Runs `fn` with a valid user token for the account (refreshing as needed). */
  withToken<T>(fn: (token: string) => Promise<T>): Promise<T>;
}

export class XChatService {
  /** One chat per source, rebuilt when its keys change. Holds that source's conversation keys. */
  private readonly chats = new Map<string, { fingerprint: string; chat: Promise<ServerChat> }>();
  /** Other users' public keys, shared by every source in the process. */
  private readonly publicKeys = new Map<string, { expires: number; records: Promise<XChatPublicKeyRecord[] | null> }>();

  constructor(private readonly client: XApiClient = xApiClient) {}

  /**
   * Unlocks the account's XChat keys with its passcode and exports them. Tries the passcode exactly
   * once: X's attempt budget is shared with the account's own XChat apps.
   */
  async unlockKeys(userToken: string, xUserId: string, passcode: string): Promise<XChatKeys> {
    const record = latestRecord(await this.client.getChatPublicKeys(userToken, xUserId));
    if (!record?.juicebox_config || record.public_key_version === undefined) {
      throw new XChatUnlockError('xchat_not_set_up', 'XChat is not set up on this X account — open Chat in the X app and create a passcode first');
    }
    const realmTokens = new Map<string, string>();
    for (const entry of record.juicebox_config.token_map ?? []) {
      if (entry?.key && entry.value?.token) realmTokens.set(entry.key.toLowerCase(), entry.value.token);
    }

    const { createChat } = await loadXdk();
    const chat = await createChat({
      juiceboxConfig: JSON.stringify(record.juicebox_config),
      getAuthToken: async (realmId: string) => realmTokens.get(String(realmId).toLowerCase()) ?? '',
    });
    try {
      await chat.unlock(passcode);
    } catch (error) {
      const bad = invalidPasscode(error);
      if (bad) {
        throw new XChatUnlockError('xchat_invalid_passcode', 'X rejected the XChat passcode', bad.guessesRemaining);
      }
      logger.warn(`${TAG} XChat unlock failed`, { xUserId, kind: (error as { kind?: string })?.kind });
      throw new XChatUnlockError('xchat_unlock_failed', 'Could not unlock XChat keys — try again shortly');
    }
    try {
      const exported = chat.exportKeys();
      const keys = { keys: Buffer.from(exported).toString('base64'), signingKeyVersion: String(record.public_key_version) };
      exported.fill(0);
      return keys;
    } finally {
      chat.free?.();
    }
  }

  /** Forgets a source's chat (keys removed or replaced, or source disconnected). */
  forget(sourceId: string): void {
    const entry = this.chats.get(sourceId);
    this.chats.delete(sourceId);
    void entry?.chat.then((c) => c.free?.()).catch(() => undefined);
  }

  /** Drops cached chats of every source not in `sourceIds` (disconnected or XChat turned off). */
  retainOnly(sourceIds: Set<string>): void {
    for (const id of [...this.chats.keys()]) if (!sourceIds.has(id)) this.forget(id);
  }

  /**
   * Decrypts `chat.received` (or history) events. Key-change events must come before the
   * messages they unlock. Returns the one-to-one text messages from other users.
   */
  async decrypt(account: XChatAccount, events: string[]): Promise<XChatMessage[]> {
    const chat = await this.chatFor(account);
    const result = await chat.decryptEventsAsync({ events: events.filter(Boolean) });
    const failed = Object.keys(result.errors ?? {}).length;
    if (failed > 0) {
      // Messages only; no content. Some old events fail permanently ("event carries no signature").
      logger.warn(`${TAG} Some XChat events did not decrypt`, {
        sourceId: account.sourceId,
        failed,
        reasons: [...new Set(Object.values(result.errors).map((m) => String(m).slice(0, 120)))],
      });
    }
    const messages: XChatMessage[] = [];
    for (const { event } of result.events) {
      if (event.type !== 'message' || !event.id || !event.senderId || !event.conversationId) continue;
      if (event.senderId === account.xUserId) continue;
      const text = event.content?.text;
      const conversationId = dmConversationIdFromChat(event.conversationId);
      if (typeof text !== 'string' || !conversationId) continue;
      messages.push({
        id: event.id,
        chatConversationId: event.conversationId,
        conversationId,
        senderId: event.senderId,
        text,
        createdAt: event.createdAtMsec ? new Date(Number(event.createdAtMsec)) : new Date(),
      });
    }
    return messages;
  }

  /** Encrypts and sends a text message; returns its message id. */
  async send(account: XChatAccount, dmConversationId: string, text: string): Promise<string> {
    const chat = await this.chatFor(account);
    const conversationId = chatConversationIdFromDm(dmConversationId);
    const encrypt = () => chat.encryptMessage({ conversationId, text });

    let payload;
    try {
      payload = encrypt();
    } catch {
      // No conversation key cached yet (e.g. after a restart): load it from the history's key changes.
      await this.loadConversationKeys(account, chat, conversationId);
      payload = encrypt();
    }
    await account.withToken((token) =>
      this.client.sendChatMessage(token, conversationId, {
        message_id: payload.messageId,
        encoded_message_create_event: payload.encodedMessageCreateEvent,
        encoded_message_event_signature: payload.encodedMessageEventSignature,
        ...(payload.xdkVersion && { xdk_version: payload.xdkVersion }),
      }),
    );
    return payload.messageId;
  }

  private async loadConversationKeys(account: XChatAccount, chat: ServerChat, conversationId: string): Promise<void> {
    const page = await account.withToken((token) => this.client.getChatEvents(token, conversationId, { maxResults: 50 }));
    await chat.decryptEventsAsync({ events: page.meta?.conversation_key_events ?? [] });
  }

  private chatFor(account: XChatAccount): Promise<ServerChat> {
    const fp = fingerprint(account.keys);
    const cached = this.chats.get(account.sourceId);
    if (cached?.fingerprint === fp) return cached.chat;
    if (cached) this.forget(account.sourceId);

    const chat = (async () => {
      const { createChat } = await loadXdk();
      const c = await createChat({ resolvePublicKeys: (ids: string[]) => this.resolvePublicKeys(account, ids) });
      const bytes = new Uint8Array(Buffer.from(account.keys.keys, 'base64'));
      c.importKeys({ keys: bytes, signingKeyVersion: account.keys.signingKeyVersion });
      bytes.fill(0);
      c.setIdentity({ userId: account.xUserId, signingKeyVersion: account.keys.signingKeyVersion });
      c.setCacheKeys(true);
      return c;
    })();
    // A failed build is not cached, so the next call retries.
    chat.catch(() => {
      if (this.chats.get(account.sourceId)?.chat === chat) this.chats.delete(account.sourceId);
    });
    this.chats.set(account.sourceId, { fingerprint: fp, chat });
    return chat;
  }

  /** chat-xdk hook: public keys for the users whose signatures it must verify. */
  private async resolvePublicKeys(account: XChatAccount, ids: string[]): Promise<PublicKeyRecords> {
    const out: PublicKeyRecords = {};
    await Promise.all(
      ids.map(async (id) => {
        let entry = this.publicKeys.get(id);
        if (!entry || entry.expires <= Date.now()) {
          const fresh = {
            expires: Date.now() + PUBLIC_KEY_TTL_MS,
            records: account
              .withToken((token) => this.client.getChatPublicKeys(token, id))
              .then((records) => records.map(({ juicebox_config: _omit, ...rest }) => rest))
              .catch((error: unknown) => {
                logger.warn(`${TAG} Public key lookup failed`, { userId: id, error: String(error) });
                if (this.publicKeys.get(id) === fresh) this.publicKeys.delete(id);
                return null;
              }),
          };
          this.publicKeys.set(id, fresh);
          entry = fresh;
        }
        const records = await entry.records;
        if (records) out[id] = records as PublicKeyRecords[string];
      }),
    );
    return out;
  }
}

export const xchatService = new XChatService();
