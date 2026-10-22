/**
 * Where agent messages reach a person: Spaces, WhatsApp, Teams, in the order
 * they chose (XYNE-66911).
 *
 * One resolver for every flow that speaks to someone who did not just ask —
 * proactive nudges, scheduled-job results and failure notices, the
 * "message me" tool, approval prompts for scheduled work. Given a user and
 * org it returns the surfaces to try, in order, each already checked to be
 * usable; the flow sends to the first and falls through on failure.
 *
 * The rules:
 *  - A person who never chose has no row, and every flow keeps exactly the
 *    routing it had before this existed (`legacy`).
 *  - A chosen order is tried as given, with Spaces always last if they left
 *    it out: it is the one surface every Claw user has.
 *  - A messaging surface is usable only when the person's link to it is
 *    verified (a one-time code, UserSurfaceIdentity.verifiedAt) and its
 *    account is running — see findNotifyTarget.
 *  - Approval prompts are stricter: only a number proven by code, never the
 *    own-device fallback, and never anything unverified.
 *  - "teams" is accepted and stored, and skipped as unavailable until the
 *    Teams channel exists in this deployment.
 */
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import { findNotifyTarget, type NotifyTarget } from "../surfaces/messaging/agent-tools.js";
import { WHATSAPP_REPLY_MODE } from "../surfaces/messaging/const.js";

const log = createLogger("delivery-preference");

export const DELIVERY_SURFACES = ["spaces", "whatsapp", "teams"] as const;
export type DeliverySurface = (typeof DELIVERY_SURFACES)[number];

/** The last resort, appended to every chosen order that leaves it out. */
export const FALLBACK_SURFACE: DeliverySurface = "spaces";

export function isDeliverySurface(value: unknown): value is DeliverySurface {
  return typeof value === "string" && (DELIVERY_SURFACES as readonly string[]).includes(value);
}

/** Generous: the list has three members; anything longer is not a real UI. */
const MAX_INPUT_ENTRIES = 20;

/**
 * A submitted order, validated: an array of known surface keys (case and
 * surrounding space forgiven), duplicates dropped keeping the first, Spaces
 * appended when absent. Unknown keys are rejected, not dropped — a typo must
 * not silently change where someone's messages go.
 */
export function normalizeDeliveryOrder(
  input: unknown,
): { ok: true; order: DeliverySurface[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "order must be an array of surfaces" };
  if (input.length > MAX_INPUT_ENTRIES) return { ok: false, error: `order has more than ${MAX_INPUT_ENTRIES} entries` };
  const order: DeliverySurface[] = [];
  for (const raw of input) {
    const key = typeof raw === "string" ? raw.trim().toLowerCase() : raw;
    if (!isDeliverySurface(key)) {
      return { ok: false, error: `unknown surface ${JSON.stringify(raw)}; expected one of ${DELIVERY_SURFACES.join(", ")}` };
    }
    if (!order.includes(key)) order.push(key);
  }
  if (!order.includes(FALLBACK_SURFACE)) order.push(FALLBACK_SURFACE);
  return { ok: true, order };
}

/** A stored row back to an order. Lenient where the API is strict: a row
 *  written by an older or newer build keeps what this build understands. */
export function parseStoredOrder(raw: unknown): DeliverySurface[] | null {
  if (!Array.isArray(raw)) return null;
  const order: DeliverySurface[] = [];
  for (const key of raw) if (isDeliverySurface(key) && !order.includes(key)) order.push(key);
  if (!order.includes(FALLBACK_SURFACE)) order.push(FALLBACK_SURFACE);
  return order;
}

/**
 * The surfaces to try, in order. No preference → the flow's own legacy order,
 * returned as-is so behaviour cannot drift for people who never chose.
 */
export function deliveryPlan(preference: DeliverySurface[] | null, legacy: DeliverySurface[]): DeliverySurface[] {
  if (!preference) return legacy;
  return parseStoredOrder(preference) ?? legacy;
}

/** Whether a flow that only exists on one surface may use it. No preference
 *  allows everything (today's behaviour); a chosen order allows what it lists. */
export function allowsSurface(preference: DeliverySurface[] | null, surface: DeliverySurface): boolean {
  return preference === null || preference.includes(surface);
}

/** The person's chosen order in this org, or null when they never chose. A
 *  read failure is null too: routing then falls back to the legacy path rather
 *  than dropping the message. */
export async function loadDeliveryPreference(
  userId: string | null | undefined,
  orgId: string | null | undefined,
): Promise<DeliverySurface[] | null> {
  if (!userId || !orgId) return null;
  try {
    const row = await prisma.deliveryPreference.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { order: true },
    });
    return row ? parseStoredOrder(row.order) : null;
  } catch (err) {
    log.warn(`[delivery-preference] read failed user=${userId}: ${errMsg(err)} — using legacy routing`);
    return null;
  }
}

export async function saveDeliveryPreference(userId: string, orgId: string, order: DeliverySurface[]): Promise<void> {
  await prisma.deliveryPreference.upsert({
    where: { userId_orgId: { userId, orgId } },
    create: { userId, orgId, order },
    update: { order },
  });
}

/** Back to "never chose": every flow returns to its legacy routing. */
export async function clearDeliveryPreference(userId: string, orgId: string): Promise<void> {
  await prisma.deliveryPreference.deleteMany({ where: { userId, orgId } });
}

/** "message": a result, notice or nudge. "approval": a prompt to approve a
 *  write as this person — verified identity only. */
export type DeliveryPurpose = "message" | "approval";

export type DeliveryTarget = { surface: "spaces" } | { surface: "whatsapp"; whatsapp: NotifyTarget };

export interface SkippedSurface {
  surface: DeliverySurface;
  /** not_linked: no verified link with a running account. unavailable: the
   *  surface has no channel in this deployment yet (Teams). */
  reason: "not_linked" | "unavailable";
}

/**
 * The usable targets for this person, in the order to try them. Spaces is
 * always usable here — each flow knows its own Spaces destination (a thread,
 * a DM) and reports a failure there like any other.
 */
export async function resolveDeliveryTargets(input: {
  userId: string;
  orgId: string;
  purpose: DeliveryPurpose;
  /** What this flow did before preferences existed; used when there is none. */
  legacy: DeliverySurface[];
  /** Pass when already loaded, to save the read. */
  preference?: DeliverySurface[] | null;
}): Promise<{ explicit: boolean; targets: DeliveryTarget[]; skipped: SkippedSurface[] }> {
  const preference =
    input.preference !== undefined ? input.preference : await loadDeliveryPreference(input.userId, input.orgId);
  const targets: DeliveryTarget[] = [];
  const skipped: SkippedSurface[] = [];
  for (const surface of deliveryPlan(preference, input.legacy)) {
    if (surface === "spaces") {
      targets.push({ surface });
    } else if (surface === "whatsapp") {
      const whatsapp = await findNotifyTarget(input.userId, input.orgId, {
        verifiedIdentityOnly: input.purpose === "approval",
      }).catch(() => null);
      if (whatsapp) targets.push({ surface, whatsapp });
      else skipped.push({ surface, reason: "not_linked" });
    } else {
      // Teams: stored, not reachable yet. Its finder goes here once the
      // channel exists (XYNE-66904), held to the same verified-link rule.
      skipped.push({ surface, reason: "unavailable" });
    }
  }
  return { explicit: preference !== null, targets, skipped };
}

/** A scheduled job addressed to a shared Spaces channel rather than a person. */
export function isChannelBroadcast(row: { replyMode: string; targetChannelId: string | null; channelId: string | null }): boolean {
  return row.replyMode === "channel" && !!(row.targetChannelId || row.channelId);
}

/**
 * Where a scheduled job's result or failure notice goes, in order. Without a
 * chosen order it is exactly the old routing: the WhatsApp chat the job was
 * set up from, else Spaces. A channel broadcast is never rerouted — it is
 * addressed to a shared channel, not to the person.
 */
export function scheduledDeliveryTargets(row: {
  userId: string;
  orgId: string;
  replyMode: string;
  targetChannelId: string | null;
  channelId: string | null;
}): ReturnType<typeof resolveDeliveryTargets> {
  return resolveDeliveryTargets({
    userId: row.userId,
    orgId: row.orgId,
    purpose: "message",
    legacy: [row.replyMode === WHATSAPP_REPLY_MODE ? "whatsapp" : "spaces"],
    ...(isChannelBroadcast(row) ? { preference: null } : {}),
  });
}

export type SendOutcome ={ ok: true } | { ok: false; error: string };

export interface DeliveryAttempt {
  surface: DeliverySurface;
  error: string;
}

/**
 * Try each target in turn until one sends. A thrown send counts as a failed
 * one: the next surface still gets its chance, which is the whole point.
 */
export async function deliverInOrder<T extends { surface: DeliverySurface }>(
  targets: readonly T[],
  send: (target: T) => Promise<SendOutcome>,
): Promise<{ ok: true; surface: DeliverySurface; failed: DeliveryAttempt[] } | { ok: false; failed: DeliveryAttempt[] }> {
  const failed: DeliveryAttempt[] = [];
  for (const target of targets) {
    let outcome: SendOutcome;
    try {
      outcome = await send(target);
    } catch (err) {
      outcome = { ok: false, error: errMsg(err) };
    }
    if (outcome.ok) return { ok: true, surface: target.surface, failed };
    failed.push({ surface: target.surface, error: outcome.error });
  }
  return { ok: false, failed };
}
