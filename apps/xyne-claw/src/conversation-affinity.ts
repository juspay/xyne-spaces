import { ownershipClient, podName, podAliveKey } from "./run-ownership.js";

export const CONV_AFFINITY_ENABLED = process.env["CLAW_CONV_AFFINITY"] === "true";

const KEY_PREFIX = "claw:conv-affinity:";
const CAP_KEY_PREFIX = "claw:pod-free:";
const TTL_SECONDS = Number(process.env["CLAW_CONV_AFFINITY_TTL_S"] ?? Number(process.env["SESSION_TTL_HOURS"] ?? 6) * 3600);
const CAP_TTL_SECONDS = Number(process.env["CLAW_CONV_AFFINITY_CAP_TTL_S"] ?? 8);
const MAX_WAIT_MS = Number(process.env["CLAW_CONV_AFFINITY_MAX_WAIT_MS"] ?? 1500);
export const AFFINITY_DEFER_MS = Number(process.env["CLAW_CONV_AFFINITY_DEFER_MS"] ?? 250);

export type AffinityDecision = "proceed" | "defer";

function keyFor(conversationId: string): string {
  return `${KEY_PREFIX}${conversationId}`;
}

function capacityKey(pod: string): string {
  return `${CAP_KEY_PREFIX}${pod}`;
}

export async function inspectAffinity(conversationId: string, waitedMs: number): Promise<AffinityDecision> {
  if (!CONV_AFFINITY_ENABLED) return "proceed";
  const c = ownershipClient();
  if (!c) return "proceed";
  try {
    const owner = await c.get(keyFor(conversationId));
    if (!owner || owner === podName()) return "proceed";
    if (waitedMs >= MAX_WAIT_MS) return "proceed";
    const [alive, free] = await Promise.all([c.exists(podAliveKey(owner)), c.exists(capacityKey(owner))]);
    return Number(alive) > 0 && Number(free) > 0 ? "defer" : "proceed";
  } catch {
    return "proceed";
  }
}

export async function publishPodCapacity(hasCapacity: boolean): Promise<void> {
  if (!CONV_AFFINITY_ENABLED) return;
  const c = ownershipClient();
  if (!c) return;
  try {
    if (hasCapacity) await c.set(capacityKey(podName()), "1", "EX", CAP_TTL_SECONDS);
    else await c.del(capacityKey(podName()));
  } catch {
    /* best effort */
  }
}

export async function recordAffinity(conversationId: string): Promise<void> {
  if (!CONV_AFFINITY_ENABLED) return;
  const c = ownershipClient();
  if (!c) return;
  try {
    await c.set(keyFor(conversationId), podName(), "EX", TTL_SECONDS);
  } catch {
    /* best effort */
  }
}
