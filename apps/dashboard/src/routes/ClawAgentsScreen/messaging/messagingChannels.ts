// Pure logic behind the Settings → Messaging channels section. Behaviour is
// ported from the claw v3 panels (xyne-claw-auth/frontend/src/v3/components/
// LinkNumberPanel.tsx and MessagingChannelsCard.tsx).
import { ClawApiError } from '../../../services/claw/clawRequest';
import type {
  ChannelAccountView,
  ChannelConnState,
  LinkedChannelNumber,
  MessagingChannelKey,
} from '../../../services/claw/clawMessagingTypes';

/**
 * Channels a person's WhatsApp number can be linked on, in the order a code is
 * requested. An org may run a business number, personal numbers, or both; the
 * person has one number either way, so one confirmed code links it everywhere.
 */
export const WHATSAPP_LINK_CHANNELS: MessagingChannelKey[] = ['whatsapp-cloud', 'whatsapp'];

/** WhatsApp channels whose accounts are listed per agent. */
export const WHATSAPP_ACCOUNT_CHANNELS: MessagingChannelKey[] = ['whatsapp-cloud', 'whatsapp'];

/* eslint-disable @typescript-eslint/naming-convention */
export const CHANNEL_NAMES: Record<MessagingChannelKey, string> = {
  whatsapp: 'WhatsApp (linked device)',
  'whatsapp-cloud': 'WhatsApp Business API',
  teams: 'Microsoft Teams',
};
/* eslint-enable @typescript-eslint/naming-convention */

/** `+<digits>` for display; the server stores each channel's own format. */
export const formatNumber = (senderId: string): string => {
  const digits = senderId.replace(/\D/g, '');
  return digits ? `+${digits}` : senderId;
};

/** One number the person has linked, and the channels it is linked on. */
export interface MyNumber {
  display: string;
  entries: Array<{ channel: MessagingChannelKey; senderId: string }>;
  /** False while any channel still holds a link made before verification. */
  verified: boolean;
}

/** The same number is stored once per channel; the person sees it once. */
export const mergeMyNumbers = (
  perChannel: Array<{ channel: MessagingChannelKey; numbers: LinkedChannelNumber[] }>,
): MyNumber[] => {
  const byDisplay = new Map<string, MyNumber>();
  for (const { channel, numbers } of perChannel) {
    for (const row of numbers) {
      const display = formatNumber(row.senderId);
      const mine = byDisplay.get(display) ?? { display, entries: [], verified: true };
      mine.entries.push({ channel, senderId: row.senderId });
      mine.verified = mine.verified && row.verified;
      byDisplay.set(display, mine);
    }
  }
  return [...byDisplay.values()];
};

/**
 * What the caller can see of one channel's accounts:
 * - `ok`: the accounts (possibly none),
 * - `forbidden`: the channel exists but its accounts are org-admin only,
 * - `unavailable`: this deployment does not run the channel (404).
 */
export type ChannelAccess =
  | { kind: 'ok'; channel: MessagingChannelKey; accounts: ChannelAccountView[] }
  | { kind: 'forbidden'; channel: MessagingChannelKey }
  | { kind: 'unavailable'; channel: MessagingChannelKey };

/** Maps an expected refusal to a ChannelAccess; anything else is rethrown so it reads as a load failure, never as "none". */
export const channelAccessFromError = (
  channel: MessagingChannelKey,
  error: unknown,
): ChannelAccess => {
  if (error instanceof ClawApiError && error.status === 404) {
    return { kind: 'unavailable', channel };
  }
  if (error instanceof ClawApiError && error.status === 403) {
    return { kind: 'forbidden', channel };
  }
  throw error;
};

export interface AgentChannels {
  /** null groups accounts with no default agent bound. */
  agent: { slug: string; name: string } | null;
  accounts: ChannelAccountView[];
}

/** Accounts grouped by their default agent, agents sorted by name, unbound last. */
export const groupAccountsByAgent = (accounts: ChannelAccountView[]): AgentChannels[] => {
  const groups = new Map<string, AgentChannels>();
  for (const account of accounts) {
    const key = account.agent?.slug ?? '';
    const group = groups.get(key) ?? { agent: account.agent, accounts: [] };
    group.accounts.push(account);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.agent) {
      return 1;
    }
    if (!b.agent) {
      return -1;
    }
    return a.agent.name.localeCompare(b.agent.name);
  });
};

export const connStateLabel = (state: ChannelConnState): string => {
  switch (state) {
    case 'connected':
      return 'Connected';
    case 'pending_login':
      return 'Waiting for login';
    case 'logged_out':
      return 'Logged out';
    default:
      return 'Disconnected';
  }
};

type LinkStep = 'send' | 'confirm';

/* eslint-disable @typescript-eslint/naming-convention */
const FALLBACK_BY_STATUS: Record<number, string> = {
  400: 'That doesn’t look right. Check it and try again.',
  409: 'That number is already linked to someone else, or your organization has no WhatsApp business number to send a code from.',
  410: 'That code has expired or was already used. Send a new one.',
  429: 'Too many attempts. Try again later.',
  502: 'Couldn’t deliver the code on WhatsApp. Check the number and try again.',
  503: 'Couldn’t send a code right now. Try again in a minute.',
};
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * User-facing copy for a failed link step. claw-auth already writes readable
 * messages for every refusal (wrong code with tries left, rate limits, …), so
 * those are shown as-is; the status fallback only covers a body with no
 * message (e.g. a proxy error page).
 */
export const linkErrorText = (error: unknown, step: LinkStep): string => {
  const generic =
    step === 'send'
      ? 'Could not send a code. Please try again.'
      : 'Could not verify this code. Please try again.';
  if (!(error instanceof Error)) {
    return generic;
  }
  const bare = !error.message || error.message.startsWith('Request failed:');
  if (error instanceof ClawApiError && bare) {
    return FALLBACK_BY_STATUS[error.status] ?? generic;
  }
  return error.message || generic;
};

/**
 * After a failed confirm, whether the code step is still worth showing. A 409
 * means the number was claimed by someone else in the meantime: no new code
 * will help, so the person goes back to entering a number. Everything else
 * (wrong code, expired/used, locked) is fixed by typing again or resending.
 */
export const keepCodeStepAfter = (error: unknown): boolean =>
  !(error instanceof ClawApiError && error.status === 409);

/** A typed code is ready to submit once it is 6 digits, ignoring spaces. */
export const isCompleteCode = (code: string): boolean => /^\d{6}$/.test(code.replace(/\s/g, ''));
