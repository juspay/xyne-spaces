import type { ExternalSource } from '@prisma/client';
import type { Request } from 'express';
import type { gmail_v1 } from 'googleapis';

export const DEFAULT_GOOGLE_MAIL_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
];

export type GoogleMailConnectionStatus =
  | 'pending_auth'
  | 'authenticated'
  | 'syncing'
  | 'connected'
  | 'error';

export type GoogleMailSyncMode = 'full' | 'incremental';

export interface GoogleMailProviderConfig {
  clientId?: string;
  clientSecret?: string;
  scopes: string[];
}

export interface GoogleMailTokenState {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string | null;
}

export interface GoogleMailMailboxState {
  emailAddress?: string;
  historyId?: string | null;
  lastSyncedAt?: string | null;
  syncProcessedMessages?: number | null;
  syncTotalMessages?: number | null;
  syncStartedAt?: string | null;
  syncMode?: GoogleMailSyncMode | null;
}

export interface GoogleMailSourceCredentials {
  provider: GoogleMailProviderConfig;
  tokens?: GoogleMailTokenState;
  mailbox?: GoogleMailMailboxState;
  status: GoogleMailConnectionStatus;
  lastError?: string | null;
}

export interface GoogleMailOAuthState {
  state: string;
  sourceId: string;
  userId: string;
  createdAt: number;
}

export interface GoogleMailResolvedProviderConfig {
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

export interface GoogleMailAuthorizedClient {
  source: ExternalSource;
  storedCredentials: GoogleMailSourceCredentials;
  mailboxEmail: string;
}

export interface GoogleMailSyncResult {
  mailboxEmail: string;
  historyId: string;
}

export interface GoogleMailRawPayload {
  message: gmail_v1.Schema$Message;
  mailboxEmail: string;
  gmail: gmail_v1.Gmail;
}

export interface GoogleMailSourceResponse {
  id: string;
  name: string;
  displayName: string;
  channelId: string | null;
  boardId: string | null;
  isActive: boolean;
  status: GoogleMailConnectionStatus;
  mailboxEmail?: string;
  lastSyncedAt?: string | null;
  syncProcessedMessages?: number | null;
  syncTotalMessages?: number | null;
  syncStartedAt?: string | null;
  syncMode?: GoogleMailSyncMode | null;
  lastError?: string | null;
  scopes: string[];
  hasRefreshToken: boolean;
  hasCustomProviderConfig: boolean;
  oauthStartUrl: string;
}

export interface ResolveBackendUrlOptions {
  req?: Request | null;
  callbackPath: string;
}
