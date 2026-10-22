// claw-auth messaging channels (WhatsApp, Teams): account listing and
// self-service number linking. These routes answer `{ success, accounts }` /
// `{ success, numbers }` rather than the `{ success, data }` envelope, so they
// go through `clawRequest` directly. Auth is the Spaces session cookie
// (requireUserAuth on the claw-auth side); no x-user-id header is needed.
import { clawRequest } from './clawRequest';
import type {
  ChannelAccountView,
  ChannelNumberLink,
  LinkedChannelNumber,
  MessagingChannelKey,
  NumberVerification,
} from './clawMessagingTypes';

const channelBase = (channel: MessagingChannelKey): string =>
  `/api/v1/surfaces/${encodeURIComponent(channel)}`;

/**
 * Accounts on a channel the caller may see: their own for a user-scoped
 * channel, the org's for an org-scoped one (org admins only — others get 403).
 */
export async function listChannelAccounts(
  channel: MessagingChannelKey,
): Promise<ChannelAccountView[]> {
  const body = await clawRequest<{ success: boolean; accounts: ChannelAccountView[] }>(
    `${channelBase(channel)}/accounts`,
  );
  return body.accounts;
}

/** The caller's own linked numbers on a channel. */
export async function listMyChannelNumbers(
  channel: MessagingChannelKey,
): Promise<LinkedChannelNumber[]> {
  const body = await clawRequest<{ success: boolean; numbers: LinkedChannelNumber[] }>(
    `${channelBase(channel)}/my-numbers`,
  );
  return body.numbers;
}

/** Step one of linking: sends a one-time code to the number. Nothing is linked yet. */
export async function requestChannelNumberCode(
  channel: MessagingChannelKey,
  phone: string,
): Promise<NumberVerification> {
  const body = await clawRequest<{ success: boolean; verification: NumberVerification }>(
    `${channelBase(channel)}/my-numbers`,
    { method: 'POST', body: JSON.stringify({ phone }) },
  );
  return body.verification;
}

/** Step two: the code typed back. Links the number on every channel that can see it. */
export async function confirmChannelNumber(
  channel: MessagingChannelKey,
  phone: string,
  code: string,
): Promise<ChannelNumberLink> {
  const body = await clawRequest<{ success: boolean; linked: ChannelNumberLink }>(
    `${channelBase(channel)}/my-numbers/confirm`,
    { method: 'POST', body: JSON.stringify({ phone, code }) },
  );
  return body.linked;
}

export async function unlinkMyChannelNumber(
  channel: MessagingChannelKey,
  senderId: string,
): Promise<void> {
  await clawRequest<{ success: boolean }>(
    `${channelBase(channel)}/my-numbers/${encodeURIComponent(senderId)}`,
    { method: 'DELETE' },
  );
}
