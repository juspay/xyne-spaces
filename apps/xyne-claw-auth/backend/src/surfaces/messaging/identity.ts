/**
 * Sender → claw user for a channel account, both directions.
 *
 * A messenger hands us only an opaque sender id (a phone JID, a numeric user
 * id) — no verified email to auto-link on like Slack — so the mapping has to
 * be stated somewhere. It is stated by the person themself: they sign in to
 * Claw and claim their number, then prove they hold it by sending the code
 * they were shown from that phone (claimNumber → redeemLinkCode). No admin
 * approval is needed, but a typed number alone never links anything.
 */
import { randomInt } from "node:crypto";
import { createLogger } from "../../logger.js";
import { prisma } from "../../db.js";
import { redisService } from "../../redis.js";
import { REDIS_PREFIX } from "./const.js";
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

export interface PendingNumberLink {
  senderId: string;
  /** The number to message, when the org has exactly one to offer. */
  sendTo: string | null;
  code: string;
  expiresAt: Date;
}

export const LINK_CODE_TTL_S = 10 * 60;
const LINK_CODE_RE = /^\s*link\s+(\d{6})\s*$/i;

interface LinkClaim {
  userId: string;
  digits: string;
  entries: Array<{ surfaceId: string; senderId: string }>;
}

const claimKey = (orgId: string, userId: string, digits: string): string =>
  `${REDIS_PREFIX}:link-claim:${orgId}:${userId}:${digits}`;
const codeKey = (orgId: string, code: string): string => `${REDIS_PREFIX}:link-code:${orgId}:${code}`;

function redis() {
  return redisService.getConnection();
}

export function parseLinkCode(text: string): string | null {
  return LINK_CODE_RE.exec(text)?.[1] ?? null;
}

async function numberTakenByOther(input: { surfaceId: string; senderId: string; orgId: string; userId: string }): Promise<boolean> {
  const taken = await prisma.userSurfaceIdentity.findFirst({
    where: {
      surfaceId: input.surfaceId,
      surfaceUserId: input.senderId,
      orgId: input.orgId,
      status: "ACTIVE",
      userId: { not: input.userId },
    },
    select: { id: true },
  });
  return taken !== null;
}

async function mintCode(orgId: string, claim: LinkClaim): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    if ((await redis().set(codeKey(orgId, code), JSON.stringify(claim), "EX", LINK_CODE_TTL_S, "NX")) === "OK") return code;
  }
  throw new LinkError(503, "Couldn't create a verification code right now. Please try again.");
}

export async function claimNumber(input: {
  plugin: AnyChannelPlugin;
  surfaceId: string;
  orgId: string;
  phone: string;
  userId: string;
}): Promise<PendingNumberLink> {
  const senderId = input.plugin.senderIdFromPhone?.(input.phone) ?? null;
  if (!senderId) {
    throw new LinkError(400, "That doesn't look like a phone number this channel can reach.");
  }
  if (await numberTakenByOther({ surfaceId: input.surfaceId, senderId, orgId: input.orgId, userId: input.userId })) {
    // Deliberately does not say to whom.
    throw new LinkError(409, "That number is already linked to someone else. An admin has to unlink it first.");
  }

  const digits = senderId.replace(/\D/g, "");
  const entry = { surfaceId: input.surfaceId, senderId };
  const existingCode = await redis().get(claimKey(input.orgId, input.userId, digits));
  const existingRaw = existingCode ? await redis().get(codeKey(input.orgId, existingCode)) : null;
  let code: string;
  if (existingCode && existingRaw) {
    const claim = JSON.parse(existingRaw) as LinkClaim;
    if (!claim.entries.some((e) => e.surfaceId === entry.surfaceId && e.senderId === entry.senderId)) claim.entries.push(entry);
    const ttl = await redis().ttl(codeKey(input.orgId, existingCode));
    await redis().set(codeKey(input.orgId, existingCode), JSON.stringify(claim), "EX", ttl > 0 ? ttl : LINK_CODE_TTL_S);
    code = existingCode;
  } else {
    code = await mintCode(input.orgId, { userId: input.userId, digits, entries: [entry] });
    await redis().set(claimKey(input.orgId, input.userId, digits), code, "EX", LINK_CODE_TTL_S);
  }
  const ttl = await redis().ttl(codeKey(input.orgId, code));
  log.info(`[identity] number claim pending channel=${input.plugin.key} sender=${senderId} user=${input.userId}`);

  // A business number is one everybody messages, so say which; a personal
  // number is somebody else's phone and is never handed out.
  let sendTo: string | null = null;
  if (input.plugin.accountScope === "org") {
    const numbers = (await listOrgAccounts(input.plugin.key, input.orgId))
      .map((row) => toChannelAccount(row).config.displayId)
      .filter((id): id is string => !!id);
    if (numbers.length === 1) sendTo = numbers[0]!;
  }
  return { senderId, sendTo, code, expiresAt: new Date(Date.now() + (ttl > 0 ? ttl : LINK_CODE_TTL_S) * 1000) };
}

export type LinkCodeOutcome =
  | { ok: true; linked: number }
  | { ok: false; reason: "invalid" | "taken" };

export async function redeemLinkCode(input: {
  surfaceId: string;
  orgId: string;
  senderId: string;
  code: string;
}): Promise<LinkCodeOutcome> {
  const raw = await redis().get(codeKey(input.orgId, input.code));
  if (!raw) return { ok: false, reason: "invalid" };
  const claim = JSON.parse(raw) as LinkClaim;
  if (!claim.entries.some((e) => e.surfaceId === input.surfaceId && e.senderId === input.senderId)) {
    log.warn(`[identity] link code sent from a number it was not issued for sender=${input.senderId}`);
    return { ok: false, reason: "invalid" };
  }
  let linked = 0;
  for (const entry of claim.entries) {
    if (await numberTakenByOther({ ...entry, orgId: input.orgId, userId: claim.userId })) continue;
    await linkSenderToUser({ surfaceId: entry.surfaceId, senderId: entry.senderId, orgId: input.orgId, userId: claim.userId });
    linked++;
  }
  await redis().del(codeKey(input.orgId, input.code), claimKey(input.orgId, claim.userId, claim.digits));
  if (linked === 0) return { ok: false, reason: "taken" };
  log.info(`[identity] number verified and linked sender=${input.senderId} user=${claim.userId} channels=${linked}`);
  return { ok: true, linked };
}
