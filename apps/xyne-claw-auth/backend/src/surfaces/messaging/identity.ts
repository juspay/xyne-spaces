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
import type { AnyChannelPlugin } from "./plugin.js";
import { linkSenderToUser, listOrgAccounts, toChannelAccount } from "./store.js";

const log = createLogger("channel-identity");

export async function resolveIdentity(input: {
  surfaceId: string;
  senderId: string;
  orgId: string;
}): Promise<string | null> {
  // A number belongs to a person, not to one assistant: whichever account on
  // this channel they message, it is the same them. Rows written before that
  // (keyed to one account) still count.
  const identity = await prisma.userSurfaceIdentity.findFirst({
    where: {
      surfaceId: input.surfaceId,
      surfaceUserId: input.senderId,
      orgId: input.orgId,
      status: "ACTIVE",
      userId: { not: null },
    },
    orderBy: { linkedAt: "desc" },
    select: { id: true, userId: true },
  });
  if (!identity?.userId) return null;
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
  /** The number to message, when the org has exactly one to offer. */
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
  plugin: AnyChannelPlugin;
  surfaceId: string;
  orgId: string;
  phone: string;
  userId: string;
}): Promise<LinkedNumber> {
  const senderId = input.plugin.senderIdFromPhone?.(input.phone) ?? null;
  if (!senderId) {
    throw new LinkError(400, "That doesn't look like a phone number this channel can reach.");
  }

  const taken = await prisma.userSurfaceIdentity.findFirst({
    where: {
      surfaceId: input.surfaceId,
      surfaceUserId: senderId,
      orgId: input.orgId,
      status: "ACTIVE",
      userId: { not: input.userId },
    },
    select: { id: true },
  });
  if (taken) {
    // Deliberately does not say to whom.
    throw new LinkError(409, "That number is already linked to someone else. An admin has to unlink it first.");
  }

  const linkedAt = await linkSenderToUser({
    surfaceId: input.surfaceId,
    senderId,
    orgId: input.orgId,
    userId: input.userId,
  });
  log.info(`[identity] number linked channel=${input.plugin.key} sender=${senderId} user=${input.userId}`);

  // A business number is one everybody messages, so say which; a personal
  // number is somebody else's phone and is never handed out.
  let sendTo: string | null = null;
  if (input.plugin.accountScope === "org") {
    const numbers = (await listOrgAccounts(input.plugin.key, input.orgId))
      .map((row) => toChannelAccount(row).config.displayId)
      .filter((id): id is string => !!id);
    if (numbers.length === 1) sendTo = numbers[0]!;
  }
  return { senderId, sendTo, linkedAt };
}
