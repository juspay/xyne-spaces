/**
 * One-time codes that prove a person controls a phone number before it is
 * linked to them (identity.ts).
 *
 * A link decides whose connectors and data a WhatsApp message runs against.
 * Taken at face value, anyone in an org could type a colleague's number and
 * have that colleague's messages run as themselves, so the number has to
 * answer for itself first: we send it a code, and only whoever reads that
 * phone can type it back.
 *
 * A challenge lives in Redis and is:
 *  - bound to (org, signed-in user, number), so a code is useless to any
 *    session but the one that asked for it;
 *  - stored as an HMAC, never as the code;
 *  - short-lived (CODE_TTL_S) and single-use: the first right answer deletes it;
 *  - burned after MAX_ATTEMPTS wrong answers;
 *  - replaced when a new code is asked for, so only the newest one works.
 *
 * Issuing is rate-limited per number (nobody floods a phone with codes) and
 * per user (nobody walks the number space). Unlike the awakening cap this
 * FAILS CLOSED: with Redis down there is nowhere to keep a challenge, so the
 * error reaches the caller and no code is sent.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { CONFIG } from "../../config.js";
import { redisService } from "../../redis.js";
import { isRunning } from "./agent-tools.js";
import { REDIS_PREFIX } from "./const.js";
import { enqueueAndWait } from "./delivery.js";
import { listChannels, type AnyChannelPlugin, type ChannelAccount, type MessageTemplate } from "./plugin.js";
import { listOrgAccounts, toChannelAccount } from "./store.js";

export const CODE_TTL_S = 10 * 60;
export const MAX_ATTEMPTS = 5;
const CODE_LENGTH = 6;
/** Fixed windows, like the awakening cap: an hour's imprecision at the
 *  boundary costs nothing here and keeps each check to one INCR. */
export const CODES_PER_NUMBER = { max: 3, windowS: 60 * 60 };
export const CODES_PER_USER = { max: 5, windowS: 60 * 60 };

/** Who is claiming which number, in which org. `digits` are full
 *  international digits (normalizePhoneDigits). */
export interface NumberClaim {
  orgId: string;
  userId: string;
  digits: string;
}

function hmac(value: string): string {
  return createHmac("sha256", CONFIG.numberVerificationKey).update(value).digest("hex");
}

/** Keys carry a hash of the number rather than the number itself. */
function numberRef(digits: string): string {
  return hmac(`number:${digits}`).slice(0, 32);
}

function challengeKey(claim: NumberClaim): string {
  return `${REDIS_PREFIX}:verify:${claim.orgId}:${claim.userId}:${numberRef(claim.digits)}`;
}

function codeHash(claim: NumberClaim, code: string): string {
  return hmac(`code:${claim.orgId}:${claim.userId}:${claim.digits}:${code}`);
}

function redis() {
  return redisService.getConnection();
}

async function overLimit(key: string, limit: { max: number; windowS: number }): Promise<boolean> {
  const used = await redis().incr(key);
  if (used === 1) await redis().expire(key, limit.windowS);
  return used > limit.max;
}

export type IssueResult =
  | { ok: true; code: string; expiresAt: Date }
  | { ok: false; reason: "rate_limited"; scope: "number" | "user" };

/** A fresh code for this claim, replacing any earlier one. The caller sends
 *  it; the plaintext is never stored. */
export async function issueCode(claim: NumberClaim): Promise<IssueResult> {
  // The user's budget first, so someone who has run out cannot also spend
  // the number's — that would let them lock its real owner out.
  if (await overLimit(`${REDIS_PREFIX}:verify:rate:user:${claim.userId}`, CODES_PER_USER)) {
    return { ok: false, reason: "rate_limited", scope: "user" };
  }
  if (await overLimit(`${REDIS_PREFIX}:verify:rate:number:${numberRef(claim.digits)}`, CODES_PER_NUMBER)) {
    return { ok: false, reason: "rate_limited", scope: "number" };
  }
  const code = randomInt(0, 10 ** CODE_LENGTH)
    .toString()
    .padStart(CODE_LENGTH, "0");
  const key = challengeKey(claim);
  await redis()
    .multi()
    .del(key)
    .hset(key, { hash: codeHash(claim, code), attempts: "0" })
    .expire(key, CODE_TTL_S)
    .exec();
  return { ok: true, code, expiresAt: new Date(Date.now() + CODE_TTL_S * 1000) };
}

/** Drop a challenge whose code never reached the phone. */
export async function withdrawCode(claim: NumberClaim): Promise<void> {
  await redis()
    .del(challengeKey(claim))
    .catch(() => undefined);
}

export type CheckResult =
  | { outcome: "ok" }
  | { outcome: "expired" }
  | { outcome: "wrong"; attemptsLeft: number }
  | { outcome: "locked" };

/**
 * Is `code` the one sent for this claim? "ok" consumes the challenge.
 *
 * The attempt is counted before the code is compared, in one MULTI, so
 * parallel guesses cannot slip past the cap. A missing challenge (never
 * asked, expired, used, burned) is "expired"; the counter that call created
 * on the empty key is deleted again.
 */
export async function checkCode(claim: NumberClaim, code: string): Promise<CheckResult> {
  const key = challengeKey(claim);
  const replies = await redis().multi().hincrby(key, "attempts", 1).hget(key, "hash").exec();
  const attempts = Number(replies?.[0]?.[1] ?? Number.NaN);
  const stored = replies?.[1]?.[1];
  if (typeof stored !== "string" || !Number.isFinite(attempts)) {
    await redis().del(key);
    return { outcome: "expired" };
  }
  if (attempts > MAX_ATTEMPTS) {
    await redis().del(key);
    return { outcome: "locked" };
  }
  const expected = Buffer.from(stored);
  const given = Buffer.from(codeHash(claim, code));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    if (attempts >= MAX_ATTEMPTS) {
      await redis().del(key);
      return { outcome: "locked" };
    }
    return { outcome: "wrong", attemptsLeft: MAX_ATTEMPTS - attempts };
  }
  // Single use: of two requests racing in with the right code, only the one
  // whose delete actually removed the key gets to link.
  const removed = await redis().del(key);
  return removed === 1 ? { outcome: "ok" } : { outcome: "expired" };
}

export interface CodeSender {
  plugin: AnyChannelPlugin;
  account: ChannelAccount;
  template?: MessageTemplate;
}

/**
 * The account a code goes out from: a running org (business) number. Never a
 * personal number — its owner reads everything it sends, and may be the very
 * person trying to claim someone else's number.
 */
export async function findCodeSender(orgId: string): Promise<CodeSender | null> {
  for (const plugin of listChannels()) {
    if (plugin.accountScope !== "org" || !plugin.senderIdFromPhone) continue;
    const account = (await listOrgAccounts(plugin.key, orgId)).map(toChannelAccount).find(isRunning);
    if (!account) continue;
    // Someone claiming a number has usually never messaged the business
    // number, so Meta's reply window is shut and the template is the only way
    // a code gets through.
    const template = (account.channelConfig as { notificationTemplate?: MessageTemplate } | null)?.notificationTemplate;
    return { plugin, account, ...(template ? { template } : {}) };
  }
  return null;
}

export function codeMessage(code: string): string {
  return (
    `${code} is your Xyne Claw verification code. It expires in ${CODE_TTL_S / 60} minutes. ` +
    "Don't share it. Didn't ask for it? Ignore this message: your number can't be linked without it."
  );
}

/** Send the code and wait for the owning pod to say whether it went out. */
export async function sendCode(
  sender: CodeSender,
  digits: string,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const chatId = sender.plugin.senderIdFromPhone?.(`+${digits}`) ?? null;
  if (!chatId) return { ok: false, error: "That number can't be reached on WhatsApp." };
  const reply = await enqueueAndWait(sender.account.id, {
    kind: "text",
    chatId,
    text: codeMessage(code),
    markdown: false,
    ...(sender.template ? { template: sender.template } : {}),
  });
  return reply.ok ? { ok: true } : { ok: false, error: reply.error };
}
