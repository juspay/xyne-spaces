/**
 * Sender → claw user for a channel account, both directions.
 *
 * A messenger hands us only an opaque sender id (a phone JID, a numeric user
 * id) — no verified email to auto-link on like Slack — so the mapping has to
 * be stated somewhere. It is stated by the person themself: they sign in to
 * Claw and add their number. Everyone who can use a Claw agent already has a
 * Spaces login, so there is nobody who needs vouching for, which is why there
 * is no approval step and no pending-request state to keep.
 */
import { createLogger } from "../../logger.js";
import { prisma } from "../../db.js";
import type { AnyChannelPlugin, ChannelAccount } from "./plugin.js";
import { findIdentityBySender, linkSenderToUser } from "./store.js";

const log = createLogger("channel-identity");

export async function resolveIdentity(input: {
  surfaceId: string;
  accountKey: string;
  senderId: string;
  orgId: string;
}): Promise<string | null> {
  const identity = await prisma.userSurfaceIdentity.findUnique({
    where: {
      surfaceId_surfaceWorkspaceId_surfaceUserId: {
        surfaceId: input.surfaceId,
        surfaceWorkspaceId: input.accountKey,
        surfaceUserId: input.senderId,
      },
    },
    select: { id: true, userId: true, orgId: true, status: true },
  });
  if (!identity?.userId || identity.orgId !== input.orgId || identity.status !== "ACTIVE") return null;
  void prisma.userSurfaceIdentity
    .update({ where: { id: identity.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);
  return identity.userId;
}

export class LinkError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface LinkedNumber {
  senderId: string;
  accountId: string;
  accountLabel: string;
  /** The number to message, once the account knows its own. */
  sendTo: string | null;
  linkedAt: Date;
}

/**
 * "This number is mine." The signed-in session says who the caller is; the
 * number they type says which sender id that identity answers to. Nothing is
 * asked of the phone, so a typed number is taken at face value — the one
 * thing refused is a number already linked to somebody else, which keeps an
 * existing link from being taken over and leaves unlinking to an admin.
 */
export async function linkNumber(input: {
  account: ChannelAccount;
  plugin: AnyChannelPlugin;
  phone: string;
  userId: string;
}): Promise<LinkedNumber> {
  const senderId = input.plugin.senderIdFromPhone?.(input.phone) ?? null;
  if (!senderId) {
    throw new LinkError(400, "That doesn't look like a phone number this channel can reach.");
  }

  const existing = await findIdentityBySender({
    surfaceId: input.account.surfaceId,
    accountKey: input.account.accountKey,
    senderId,
  });
  if (existing?.status === "ACTIVE" && existing.userId !== input.userId) {
    // Deliberately does not say to whom.
    throw new LinkError(409, "That number is already linked to someone else. An admin has to unlink it first.");
  }

  const linkedAt = await linkSenderToUser({
    surfaceId: input.account.surfaceId,
    accountKey: input.account.accountKey,
    senderId,
    orgId: input.account.orgId,
    userId: input.userId,
  });
  log.info(`[identity] number linked account=${input.account.id} sender=${senderId} user=${input.userId}`);

  return {
    senderId,
    accountId: input.account.id,
    accountLabel: input.account.config.label,
    sendTo: input.account.config.displayId ?? null,
    linkedAt,
  };
}
