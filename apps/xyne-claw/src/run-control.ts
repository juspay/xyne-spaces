/**
 * Cross-pod run control — a Redis pub/sub fan-out that lets a cancel or a
 * graceful interrupt reach the pod that actually holds the run.
 *
 * Runs execute on whichever pod the BullMQ run-queue worker claimed the job on,
 * but `activeRuns` is per-pod memory and claw-auth's cancel hits the ClusterIP
 * Service, which load-balances to a random replica. Observed in prod: the
 * cancel landed on a pod that was not running the session, answered
 * `not_running`, and the run carried on for 40+ minutes with the user's
 * follow-up queued behind it.
 *
 * There is no per-pod addressing (no headless Service) and the Kubernetes API
 * is off the table, but Redis is already shared by every claw pod. Every pod
 * subscribes to `claw:run-control`; a message is broadcast to all of them and
 * applied only by the pod that has the session locally. The session's owner pod
 * is still consulted first (via the ownership registry) so a cancel for a
 * session nobody owns can keep answering `not_running` — that answer is
 * claw-auth's stale-row janitor signal.
 *
 * Fail-open everywhere: a control-plane outage must never throw into a route.
 */

import { Redis } from "ioredis";
import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";
import { ownershipClient, podName } from "./run-ownership.js";

const clog = createLogger("run-control");

export const RUN_CONTROL_CHANNEL = "claw:run-control";
export const RUN_CONTROL_MAX_AGE_MS = 60_000;

export type RunControlType = "cancel" | "interrupt";

export interface RunControlMessage {
  type: RunControlType;
  sessionId: string;
  userId?: string;
  requestedBy?: string;
  issuedAt: number;
  origin: string;
}

export interface RunControlRequest {
  type: RunControlType;
  sessionId: string;
  userId?: string;
  requestedBy?: string;
}

export function parseRunControlMessage(raw: string): RunControlMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  const type = candidate["type"];
  if (type !== "cancel" && type !== "interrupt") return null;
  const sessionId = candidate["sessionId"];
  if (typeof sessionId !== "string" || !sessionId) return null;
  const issuedAt = candidate["issuedAt"];
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) return null;
  const origin = candidate["origin"];
  if (typeof origin !== "string" || !origin) return null;
  const userId = candidate["userId"];
  const requestedBy = candidate["requestedBy"];
  return {
    type,
    sessionId,
    issuedAt,
    origin,
    ...(typeof userId === "string" && userId ? { userId } : {}),
    ...(typeof requestedBy === "string" && requestedBy ? { requestedBy } : {}),
  };
}

export function isFreshRunControlMessage(msg: RunControlMessage, nowMs = Date.now()): boolean {
  return nowMs - msg.issuedAt <= RUN_CONTROL_MAX_AGE_MS;
}

export type RunControlApplier = (msg: RunControlMessage) => boolean;

let applier: RunControlApplier | null = null;

export function registerRunControlApplier(fn: RunControlApplier | null): void {
  applier = fn;
}

export type RunControlOutcome = "invalid" | "stale" | "not_local" | "applied";

export function handleRunControlMessage(
  raw: string,
  deps: { apply?: RunControlApplier | null; now?: number } = {},
): RunControlOutcome {
  const msg = parseRunControlMessage(raw);
  if (!msg) {
    clog.warn(`[run-control] ignoring unparseable message: ${raw.slice(0, 200)}`);
    return "invalid";
  }
  if (!isFreshRunControlMessage(msg, deps.now ?? Date.now())) {
    clog.warn(`[run-control] ignoring stale ${msg.type} session=${msg.sessionId} from=${msg.origin}`);
    return "stale";
  }
  const apply = deps.apply === undefined ? applier : deps.apply;
  if (!apply || !apply(msg)) return "not_local";
  clog.info(`[run-control] applied ${msg.type} session=${msg.sessionId} from=${msg.origin}`);
  metric.count("run_control_applied", { type: msg.type, session: msg.sessionId });
  return "applied";
}

export async function publishRunControl(req: RunControlRequest): Promise<boolean> {
  const c = ownershipClient();
  if (!c) return false;
  const msg: RunControlMessage = {
    type: req.type,
    sessionId: req.sessionId,
    ...(req.userId ? { userId: req.userId } : {}),
    ...(req.requestedBy ? { requestedBy: req.requestedBy } : {}),
    issuedAt: Date.now(),
    origin: podName(),
  };
  try {
    await c.publish(RUN_CONTROL_CHANNEL, JSON.stringify(msg));
    return true;
  } catch (err) {
    clog.warn(
      `[run-control] publish ${req.type} failed for session=${req.sessionId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

export type RunControlDecision =
  | { action: "forwarded"; ownerPod: string }
  | { action: "not_running" };

export async function decideRunControl(
  req: RunControlRequest,
  deps: {
    currentOwnerPod: (sessionId: string) => Promise<string | null>;
    publish: (req: RunControlRequest) => Promise<boolean>;
  },
): Promise<RunControlDecision> {
  let ownerPod: string | null = null;
  try {
    ownerPod = await deps.currentOwnerPod(req.sessionId);
  } catch {
    ownerPod = null;
  }
  if (!ownerPod) return { action: "not_running" };
  const published = await deps.publish(req).catch(() => false);
  if (!published) return { action: "not_running" };
  return { action: "forwarded", ownerPod };
}

let subscriber: Redis | null = null;

export function startRunControlSubscriber(): Redis | null {
  if (subscriber) return subscriber;
  const host = process.env["REDIS_HOST"];
  if (!host) {
    clog.warn("[run-control] REDIS_HOST not set — cross-pod run control disabled");
    return null;
  }
  const conn = new Redis({
    host,
    port: Number(process.env["REDIS_PORT"] ?? 6379),
    ...(process.env["REDIS_PASSWORD"] ? { password: process.env["REDIS_PASSWORD"] } : {}),
    ...(process.env["REDIS_TLS"] ? { tls: { rejectUnauthorized: false } } : {}),
    connectTimeout: 3_000,
    maxRetriesPerRequest: null,
  });
  conn.on("error", (err: Error) => {
    clog.warn(`[run-control] subscriber connection error: ${err.message}`);
  });
  conn.on("message", (channel: string, raw: string) => {
    if (channel !== RUN_CONTROL_CHANNEL) return;
    try {
      handleRunControlMessage(raw);
    } catch (err) {
      clog.warn(`[run-control] apply failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  void conn.subscribe(RUN_CONTROL_CHANNEL).then(
    () => clog.info(`[run-control] subscribed pod=${podName()} channel=${RUN_CONTROL_CHANNEL}`),
    (err: Error) => clog.warn(`[run-control] subscribe failed: ${err.message}`),
  );
  subscriber = conn;
  return conn;
}

export async function stopRunControlSubscriber(): Promise<void> {
  const conn = subscriber;
  if (!conn) return;
  subscriber = null;
  try {
    await conn.quit();
  } catch {
    conn.disconnect();
  }
}
