// Types for claw-auth's messaging channels API (/api/v1/surfaces/:channel).
// Mirrors xyne-claw-auth/frontend/src/lib/api.ts — only the fields the
// dashboard reads are declared.

/**
 * Channels this UI knows about. `teams` is registered by claw-auth only when
 * its Teams plugin is enabled (XYNE-66904); otherwise every route for it
 * answers 404 "Unknown channel".
 */
export type MessagingChannelKey = 'whatsapp' | 'whatsapp-cloud' | 'teams';

export type ChannelConnState = 'pending_login' | 'connected' | 'disconnected' | 'logged_out';

export interface ChannelAccountView {
  id: string;
  channel: MessagingChannelKey;
  label: string;
  connState: ChannelConnState;
  /** The number (or bot id) the account answers on, once it has logged in. */
  displayId?: string;
  agent: { slug: string; name: string } | null;
  /** "org": one shared account (business number, Teams bot). "user": one person's own number. */
  scope: 'org' | 'user';
}

export interface LinkedChannelNumber {
  senderId: string;
  linkedAt: string;
  lastSeenAt: string | null;
  /** False for a link made before numbers were verified: it does nothing until confirmed. */
  verified: boolean;
}

export interface ChannelNumberLink {
  senderId: string;
  /** The number to message, when the org has exactly one to offer. */
  sendTo: string | null;
  linkedAt: string;
}

export interface NumberVerification {
  expiresAt: string;
}
