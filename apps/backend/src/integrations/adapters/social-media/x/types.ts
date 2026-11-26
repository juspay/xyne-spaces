/**
 * X (Twitter) adapter types.
 *
 * Ownership model: each tenant registers their own X developer app and pays for its usage, so
 * every connected X account carries that app's keys alongside the account's OAuth 2.0 tokens.
 */

/** Keys from the tenant's own X developer app (Developer Console → Keys and tokens). */
export interface XAppCredentials {
  /** OAuth 2.0 client id — user authorization and token refresh. */
  clientId: string;
  /** OAuth 2.0 client secret — confidential-client token exchange and refresh. */
  clientSecret: string;
  /** API key (consumer key) — exchanged for the app-only Bearer that opens the activity stream. */
  consumerKey: string;
  /** API key secret (consumer secret). */
  consumerSecret: string;
}

/** OAuth 2.0 user-context tokens for the connected brand account. */
export interface XUserTokens {
  accessToken: string;
  /** Single-use: every refresh returns a new one and invalidates the old one. */
  refreshToken: string;
  /** Epoch ms. X access tokens live 2 hours. */
  expiresAt: number;
  scope?: string;
}

/** Decrypted shape of ExternalSource.credentials for an X source. */
export interface XCredentials {
  app: XAppCredentials;
  tokens: XUserTokens;
  /** The brand account's X user id (string — X ids exceed Number.MAX_SAFE_INTEGER). */
  xUserId: string;
  username: string;
  /** XChat private keys, present once the tenant has enabled encrypted-DM support. */
  xchat?: XChatKeys;
}

/**
 * The brand account's XChat private keys, exported from X's key backup (Juicebox) with the
 * account's XChat passcode. The passcode itself is never stored. Whoever holds these keys can read
 * the account's encrypted chats, so they live only inside the encrypted credentials.
 */
export interface XChatKeys {
  /** Base64 of chat-xdk `exportKeys()`. */
  keys: string;
  /** `public_key_version` of the registration these keys belong to. */
  signingKeyVersion: string;
}

export interface XUser {
  id: string;
  username: string;
  name?: string;
}

export interface XPost {
  id: string;
  text: string;
  author_id: string;
  conversation_id?: string;
  created_at?: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: Array<{ id: string; type: 'replied_to' | 'quoted' | 'retweeted' | string }>;
}

/** Envelope shared by the activity stream and webhooks: `{"data": XActivityEvent}`. */
export interface XActivityEvent {
  event_uuid: string;
  created_at: string;
  filter?: { user_id?: string };
  event_type: string;
  tag?: string;
  payload: unknown;
  includes?: { users?: XUser[]; tweets?: XPost[] };
}

/** `dm.received` payload: the legacy v1.1 Direct Message shape (observed live). */
export interface XLegacyDmPayload {
  direct_message_events?: Array<{
    type: string;
    /** String id. Always use this — never a numeric id field. */
    id: string;
    created_timestamp: string;
    message_create: {
      target: { recipient_id: string };
      sender_id: string;
      message_data: { text: string };
    };
  }>;
  /** Keyed by user id; observed values wrapped as `{data: {...}}`. */
  users?: Record<string, { data?: Partial<XUser> } & Partial<XUser>>;
}

/** `GET /2/dm_events` item (v2 shape, used by polling). Ids match the legacy event ids. */
export interface XV2DmEvent {
  id: string;
  event_type: string;
  text?: string;
  sender_id?: string;
  dm_conversation_id?: string;
  created_at?: string;
}

/** `chat.received` payload (XChat, end-to-end encrypted; observed live 2026-11-20). */
export interface XChatPayload {
  /** Message id (UUID). */
  id: string;
  sender_id: string;
  /** One-to-one: "<lowId>:<highId>"; groups start with "g". */
  conversation_id: string;
  created_at_msec: string;
  /** Base64 encrypted event — the only thing that carries the text. */
  encoded_event: string;
  conversation_key_version?: string;
  /** Present when the conversation key changed; must be decrypted before `encoded_event`. */
  conversation_key_change_event?: string;
}

/** Provider-neutral inbound item handed to `externalSourceCore.ingest` by the stream and pollers. */
export type XInboundItem =
  | { kind: 'post'; post: XPost; author?: XUser; eventType: string }
  | {
      kind: 'dm';
      id: string;
      conversationId: string;
      senderId: string;
      text: string;
      createdAt: Date;
      sender?: XUser;
      /** 'xchat' for decrypted XChat messages; replies then go back over XChat. */
      channel?: 'dm' | 'xchat';
    }
  /** Still-encrypted XChat message; the transformer decrypts it with the source's keys. */
  | { kind: 'xchat'; payload: XChatPayload };
