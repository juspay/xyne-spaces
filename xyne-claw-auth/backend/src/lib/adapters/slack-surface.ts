import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { NormalizedInboundEvent, SurfaceAdapter } from "../surface-adapter.js";

const MAX_TIMESTAMP_SKEW_SECONDS = 300;

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function verifySignature(
  rawBody: Buffer | string,
  headers: IncomingHttpHeaders,
  secret: string,
): boolean {
  const timestampRaw = header(headers, "x-slack-request-timestamp");
  const receivedRaw = header(headers, "x-slack-signature");
  if (!timestampRaw || !/^\d+$/.test(timestampRaw) || !receivedRaw || !/^v0=[0-9a-f]{64}$/i.test(receivedRaw)) {
    return false;
  }

  const timestamp = Number(timestampRaw);
  if (!Number.isSafeInteger(timestamp)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  const expected = createHmac("sha256", secret)
    .update(`v0:${timestampRaw}:`)
    .update(body)
    .digest();
  const received = Buffer.from(receivedRaw.slice(3), "hex");

  return received.length === expected.length && timingSafeEqual(received, expected);
}

function parseInbound(payload: unknown): NormalizedInboundEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const envelope = payload as Record<string, unknown>;
  if (envelope["type"] !== "event_callback") return null;

  const surfaceTenantId = stringField(envelope["team_id"]);
  const eventId = stringField(envelope["event_id"]);
  const eventValue = envelope["event"];
  if (!surfaceTenantId || !eventId || !eventValue || typeof eventValue !== "object") return null;

  const event = eventValue as Record<string, unknown>;
  if (event["bot_id"] || event["subtype"] !== undefined) return null;

  const type = stringField(event["type"]);
  const surfaceUserId = stringField(event["user"]);
  const channelId = stringField(event["channel"]);
  const text = typeof event["text"] === "string" ? event["text"] : null;
  if (!surfaceUserId || !channelId || text === null) return null;

  let eventType: NormalizedInboundEvent["eventType"];
  if (type === "app_mention") {
    eventType = "APP_MENTIONED";
  } else if (type === "message" && event["channel_type"] === "im") {
    eventType = "DIRECT_MESSAGE";
  } else {
    return null;
  }

  const threadId = stringField(event["thread_ts"]);
  return {
    eventType,
    surfaceTenantId,
    surfaceUserId,
    channelId,
    ...(threadId ? { threadId } : {}),
    text,
    eventId,
    raw: payload,
  };
}

export const slackSurfaceAdapter: SurfaceAdapter = {
  key: "slack",
  verifySignature,
  parseInbound,
};
