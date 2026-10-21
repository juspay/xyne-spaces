/**
 * One business number shared by accounts in several orgs. Meta delivers the
 * number's webhooks to only one of them, so the receiving account hands each
 * message to the account in the org the sender is linked in. Linked in more
 * than one, the oldest account wins; unlinking the number there moves them on.
 */
import type { AnyChannelPlugin, ChannelAccount } from "./plugin.js";
import { findAccountOnNumberForSender } from "./store.js";

export async function accountForSender(
  ctx: { account: ChannelAccount; plugin: AnyChannelPlugin },
  senderId: string,
): Promise<ChannelAccount> {
  const { account, plugin } = ctx;
  const selfId = account.config.selfId;
  if (plugin.accountScope !== "org" || !selfId) return account;
  return (await findAccountOnNumberForSender({ surfaceId: account.surfaceId, selfId, senderId })) ?? account;
}
