import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { NormalizedInboundEvent, SurfaceAdapter } from "../../lib/surface-adapter.js";
import { MAX_TIMESTAMP_SKEW_SECONDS } from "./const.js";
import { eventEnvelopeSchema } from "./schema.js";

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * A Slack request timestamp is trustworthy only when it is digits-only, a safe
 * integer, and inside the replay window.
 *
 * Digits-only matters twice: the raw STRING is interpolated into the signed
 * base string (so extra delimiters must not be smuggled in), and a bare
 * Number() would otherwise coerce "0x10", " 12 " or "1e10" into a value that
 * sails through the skew check.
 *
 * The type predicate lets callers treat `timestampRaw` as a string afterwards.
 */
function verifyTimestamp(timestampRaw: string | undefined): timestampRaw is string {
  if (!timestampRaw || !/^\d+$/.test(timestampRaw)) return false;
  const timestamp = Number(timestampRaw);
  if (!Number.isSafeInteger(timestamp)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.abs(nowSeconds - timestamp) <= MAX_TIMESTAMP_SKEW_SECONDS;
}

function verifySignature(rawBody: Buffer | string, headers: IncomingHttpHeaders, secret: string): boolean {
  const timestampRaw = header(headers, "x-slack-request-timestamp");
  const receivedRaw = header(headers, "x-slack-signature");
  if (!verifyTimestamp(timestampRaw)) return false;
  if (!receivedRaw || !/^v0=[0-9a-f]{64}$/i.test(receivedRaw)) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  const expected = createHmac("sha256", secret).update(`v0:${timestampRaw}:`).update(body).digest();
  const received = Buffer.from(receivedRaw.slice(3), "hex");

  return received.length === expected.length && timingSafeEqual(received, expected);
}

function parseInbound(payload: unknown): NormalizedInboundEvent | null {
  // safeParse, never parse: this is untrusted network input, and an
  // unrecognised event must be ignored quietly, never throw into the route.
  const parsed = eventEnvelopeSchema.safeParse(payload);
  if (!parsed.success) return null;

  const { team_id: surfaceTenantId, event_id: eventId, event } = parsed.data;
  const eventType: NormalizedInboundEvent["eventType"] =
    event.type === "app_mention" ? "APP_MENTIONED" : "DIRECT_MESSAGE";
  const threadId = event.thread_ts;

  return {
    eventType,
    surfaceTenantId,
    surfaceUserId: event.user,
    channelId: event.channel,
    ...(threadId ? { threadId } : {}),
    text: event.text,
    eventId,
    // The untouched payload — downstream needs fields we deliberately do not model.
    raw: payload,
  };
}

export const slackSurfaceAdapter: SurfaceAdapter = {
  key: "slack",
  verifySignature,
  parseInbound,
};
