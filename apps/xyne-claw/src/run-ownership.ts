/**
 * Run ownership registry — claw's second deliberate Redis use (owner-approved,
 * scoped to the XYNE_RUN_QUEUE worker path only).
 *
 * BullMQ redelivers a stalled job after lockDuration. The previous pod may be
 * alive-but-choked rather than dead: when it un-chokes, its callback, its GCS
 * session flush and its progress posts would clobber the new runner's newer
 * state. Ownership beats arrival order — a run holds `claw:run-owner:<sessionId>`
 * with a heartbeated 120s TTL, and the moment the key is held by ANOTHER runner
 * every output channel goes silent (see the fenced-session set below). A missing
 * key is re-claimed by the heartbeat, never treated as a loss — a claim that
 * failed open (Redis briefly unreachable) must not fence its own run.
 *
 * The 120s TTL matches lockDuration: a dead pod's key expires around the same
 * time BullMQ redelivers, so a real takeover may defer a few 15s hops until the
 * key lapses; an alive-choked pod keeps its key refreshed and is never stolen from.
 *
 * Fail-open on every Redis error: a registry outage must never block execution.
 */

import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { createLogger } from "./logger.js";

const clog = createLogger("run-ownership");

export const OWNERSHIP_TTL_SECONDS = 120;
export const OWNERSHIP_REFRESH_INTERVAL_MS = 15_000;

let client: Redis | null = null;
let disabled = false;
let warnedOnce = false;

function keyFor(sessionId: string): string {
  return `claw:run-owner:${sessionId}`;
}

function warnFailOpen(op: string, err: unknown): void {
  if (warnedOnce) return;
  warnedOnce = true;
  clog.warn(
    `[run-ownership] ${op} failed — failing open (ownership fencing disabled until Redis recovers): ${err instanceof Error ? err.message : String(err)}`,
  );
}

function getClient(): Redis | null {
  if (disabled) return null;
  const host = process.env["REDIS_HOST"];
  if (!host) {
    disabled = true;
    clog.warn("[run-ownership] REDIS_HOST not set — ownership fencing disabled");
    return null;
  }
  if (!client) {
    client = new Redis({
      host,
      port: Number(process.env["REDIS_PORT"] ?? 6379),
      ...(process.env["REDIS_PASSWORD"] ? { password: process.env["REDIS_PASSWORD"] } : {}),
      ...(process.env["REDIS_TLS"] ? { tls: { rejectUnauthorized: false } } : {}),
      connectTimeout: 3_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    client.on("error", (err: Error) => {
      clog.warn(`[run-ownership] connection error: ${err.message}`);
    });
  }
  return client;
}

export function __setOwnershipClientForTests(stub: Redis | null): void {
  client = stub;
  disabled = false;
  warnedOnce = false;
}

export function createOwnerToken(): string {
  return `${process.env["POD_ID"] ?? hostname()}:${randomUUID()}`;
}

export async function claimOwnership(sessionId: string, ownerToken: string): Promise<boolean> {
  const c = getClient();
  if (!c) return true;
  try {
    await c.set(keyFor(sessionId), ownerToken, "EX", OWNERSHIP_TTL_SECONDS);
    return true;
  } catch (err) {
    warnFailOpen("claim", err);
    return true;
  }
}

const REFRESH_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current == false or current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return 1
end
return 0`;

export async function refreshOwnership(sessionId: string, ownerToken: string): Promise<boolean> {
  const c = getClient();
  if (!c) return true;
  try {
    const res = await c.eval(REFRESH_SCRIPT, 1, keyFor(sessionId), ownerToken, String(OWNERSHIP_TTL_SECONDS));
    return Number(res) === 1;
  } catch (err) {
    warnFailOpen("refresh", err);
    return true;
  }
}

export async function isOwnedByOther(sessionId: string, ownerToken: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    const current = await c.get(keyFor(sessionId));
    return typeof current === "string" && current.length > 0 && current !== ownerToken;
  } catch (err) {
    warnFailOpen("lookup", err);
    return false;
  }
}

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

export async function releaseOwnership(sessionId: string, ownerToken: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    const res = await c.eval(RELEASE_SCRIPT, 1, keyFor(sessionId), ownerToken);
    return Number(res) === 1;
  } catch (err) {
    warnFailOpen("release", err);
    return false;
  }
}


interface OwnedSession {
  ownerToken: string;
  onLost: () => void;
}

const ownedSessions = new Map<string, OwnedSession>();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function heartbeatTick(): Promise<void> {
  const c = getClient();
  if (!c || ownedSessions.size === 0) return;
  const entries = [...ownedSessions.entries()];
  try {
    const pipeline = c.pipeline();
    for (const [sessionId, owned] of entries) {
      pipeline.eval(REFRESH_SCRIPT, 1, keyFor(sessionId), owned.ownerToken, String(OWNERSHIP_TTL_SECONDS));
    }
    const results = await pipeline.exec();
    if (!results) return;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const result = results[i];
      if (!entry || !result) continue;
      const [sessionId, owned] = entry;
      const [err, value] = result;
      if (err) continue;
      if (Number(value) !== 1 && ownedSessions.get(sessionId) === owned) {
        ownedSessions.delete(sessionId);
        owned.onLost();
      }
    }
  } catch (err) {
    warnFailOpen("heartbeat", err);
  }
}

export function registerOwnedSession(sessionId: string, ownerToken: string, onLost: () => void): void {
  ownedSessions.set(sessionId, { ownerToken, onLost });
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => { void heartbeatTick(); }, OWNERSHIP_REFRESH_INTERVAL_MS);
    heartbeatTimer.unref?.();
  }
}

export function unregisterOwnedSession(sessionId: string): void {
  ownedSessions.delete(sessionId);
  if (ownedSessions.size === 0 && heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

const fencedSessions = new Set<string>();

export function fenceSession(sessionId: string): void {
  if (sessionId) fencedSessions.add(sessionId);
}

export function unfenceSession(sessionId: string): void {
  fencedSessions.delete(sessionId);
}

export function isFencedSession(sessionId: string | undefined | null): boolean {
  if (!sessionId || fencedSessions.size === 0) return false;
  return fencedSessions.has(sessionId);
}
