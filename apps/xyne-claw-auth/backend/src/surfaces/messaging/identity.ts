/**
 * Sender → claw user for a channel account, both directions.
 *
 * A messenger hands us only an opaque sender id (a phone JID, a numeric user
 * id) — no verified email to auto-link on like Slack — so the mapping has to
 * be stated somewhere. It is stated by the person themself: they sign in to
 * Claw, add their number, and type back the one-time code we send to it
 * (number-verification.ts). Everyone who can use a Claw agent already has a
 * Spaces login, so there is nobody who needs vouching for, which is why there
 * is no approval step — but the number has to answer for itself, because a
 * link decides whose data a message from it runs against.
 */
import type { AgentAuditEvent } from "@prisma/client";
import { createLogger } from "../../logger.js";
import { prisma } from "../../db.js";
import { writeAuditLog } from "../../lib/audit.js";
import { errMsg } from "../../lib/errors.js";
import {
  checkCode,
  findCodeSender,
  issueCode,
  sendCode,
  withdrawCode,
  type NumberClaim,
} from "./number-verification.js";
import { normalizePhoneDigits } from "./phone.js";
import { listChannels, type AnyChannelPlugin } from "./plugin.js";
import { getSurface, isLinkedToAnotherUser, linkVerifiedSender, listOrgAccounts, toChannelAccount } from "./store.js";

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

/** Durable trace of every change to who a number runs as. Never throws. */
export function auditNumberLink(input: {
  event: Extract<AgentAuditEvent, "CHANNEL_NUMBER_LINKED" | "CHANNEL_NUMBER_UNLINKED">;
  actorUserId: string;
  channel: string;
  orgId: string;
  senderId: string;
  description: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  return writeAuditLog({
    actorUserId: input.actorUserId,
    eventType: input.event,
    targetId: input.senderId,
    description: input.description,
    metadata: { channel: input.channel, orgId: input.orgId, ...input.metadata },
  });
}

/** The typed number as this channel's sender id and as plain digits, or a 400. */
function parsePhone(plugin: AnyChannelPlugin, phone: string): { senderId: string; digits: string } {
  const senderId = plugin.senderIdFromPhone?.(phone) ?? null;
  const digits = normalizePhoneDigits(phone);
  if (!senderId || !digits) {
    throw new LinkError(400, "That doesn't look like a phone number this channel can reach.");
  }
  return { senderId, digits };
}

/**
 * "This number is mine" — step one. Sends a one-time code to the number from
 * the org's business number; nothing is linked until it comes back
 * (confirmNumber). Refused up front when the number is already linked to
 * someone else, which keeps an existing link from being taken over and leaves
 * unlinking to an admin.
 */
export async function requestNumberCode(input: {
  plugin: AnyChannelPlugin;
  surfaceId: string;
  orgId: string;
  phone: string;
  userId: string;
}): Promise<{ expiresAt: Date }> {
  const { senderId, digits } = parsePhone(input.plugin, input.phone);

  if (await isLinkedToAnotherUser({ surfaceId: input.surfaceId, senderId, orgId: input.orgId, userId: input.userId })) {
    // Deliberately does not say to whom.
    throw new LinkError(409, "That number is already linked to someone else. An admin has to unlink it first.");
  }

  const sender = await findCodeSender(input.orgId);
  if (!sender) {
    throw new LinkError(
      409,
      "Your organization has no WhatsApp business number connected to send a verification code from. Ask an admin to connect one.",
    );
  }

  const claim: NumberClaim = { orgId: input.orgId, userId: input.userId, digits };
  let issued: Awaited<ReturnType<typeof issueCode>>;
  try {
    issued = await issueCode(claim);
  } catch (err) {
    log.error(`[identity] could not issue a code user=${input.userId}: ${errMsg(err)}`);
    throw new LinkError(503, "Couldn't send a code right now. Try again in a minute.");
  }
  if (!issued.ok) {
    throw new LinkError(
      429,
      issued.scope === "number"
        ? "Too many codes have been sent to that number. Try again in an hour."
        : "You've asked for too many codes. Try again in an hour.",
    );
  }

  const sent = await sendCode(sender, digits, issued.code).catch((err: unknown) => ({ ok: false as const, error: errMsg(err) }));
  if (!sent.ok) {
    await withdrawCode(claim);
    log.warn(`[identity] code not delivered account=${sender.account.id} user=${input.userId}: ${sent.error}`);
    const windowClosed = /24|window|re-engagement/i.test(sent.error);
    throw new LinkError(
      502,
      windowClosed
        ? "WhatsApp won't deliver the code: this number hasn't messaged the business number recently, and no notification template is set up for it. Message the business number once, then try again."
        : "Couldn't send a code to that number on WhatsApp. Check the number and try again.",
    );
  }
  log.info(`[identity] verification code sent channel=${input.plugin.key} sender=${senderId} user=${input.userId}`);
  return { expiresAt: issued.expiresAt };
}

/**
 * "This number is mine" — step two. Checks the code and, if it is right,
 * links the number to the caller on every channel that can see it: the
 * person proved they hold the phone, not one channel's view of it, and the
 * code is single-use so a second channel could not check it again anyway.
 */
export async function confirmNumber(input: {
  plugin: AnyChannelPlugin;
  orgId: string;
  phone: string;
  code: string;
  userId: string;
}): Promise<LinkedNumber> {
  const { digits } = parsePhone(input.plugin, input.phone);
  const claim: NumberClaim = { orgId: input.orgId, userId: input.userId, digits };

  const check = await checkCode(claim, input.code);
  switch (check.outcome) {
    case "expired":
      throw new LinkError(410, "That code has expired or was already used. Send a new one.");
    case "locked":
      throw new LinkError(429, "Too many wrong codes. Send a new one.");
    case "wrong":
      throw new LinkError(
        400,
        `That code isn't right. ${check.attemptsLeft} ${check.attemptsLeft === 1 ? "try" : "tries"} left.`,
      );
    case "ok":
      break;
  }

  let ours: LinkedNumber | null = null;
  let refused = false;
  for (const plugin of listChannels()) {
    const senderId = plugin.senderIdFromPhone?.(input.phone) ?? null;
    if (!senderId) continue;
    const surface = await getSurface(plugin.key);
    if (!surface || surface.status !== "ACTIVE") continue;

    const link = await linkVerifiedSender({ surfaceId: surface.id, senderId, orgId: input.orgId, userId: input.userId });
    if (!link.ok) {
      log.warn(`[identity] number already linked to someone else channel=${plugin.key} sender=${senderId} user=${input.userId}`);
      if (plugin.key === input.plugin.key) refused = true;
      continue;
    }
    log.info(`[identity] number verified and linked channel=${plugin.key} sender=${senderId} user=${input.userId}`);
    await auditNumberLink({
      event: "CHANNEL_NUMBER_LINKED",
      actorUserId: input.userId,
      channel: plugin.key,
      orgId: input.orgId,
      senderId,
      description: `Verified and linked a ${plugin.displayName} number`,
    });
    if (plugin.key === input.plugin.key) ours = { senderId, sendTo: null, linkedAt: link.linkedAt };
  }
  if (refused || !ours) {
    // Deliberately does not say to whom.
    throw new LinkError(409, "That number is already linked to someone else. An admin has to unlink it first.");
  }

  // A business number is one everybody messages, so say which; a personal
  // number is somebody else's phone and is never handed out.
  if (input.plugin.accountScope === "org") {
    const numbers = (await listOrgAccounts(input.plugin.key, input.orgId))
      .map((row) => toChannelAccount(row).config.displayId)
      .filter((id): id is string => !!id);
    if (numbers.length === 1) ours.sendTo = numbers[0]!;
  }
  return ours;
}
