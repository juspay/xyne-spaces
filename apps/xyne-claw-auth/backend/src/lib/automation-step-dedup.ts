export const STEP_DEDUP_TTL_SECONDS = 900;

export interface StepDedupRedis {
  set(key: string, value: string, ex: "EX", seconds: number, nx: "NX"): Promise<string | null>;
  set(key: string, value: string, ex: "EX", seconds: number): Promise<string | null>;
  get(key: string): Promise<string | null>;
}

export type StepDedupDecision =
  | { kind: "run" }
  | { kind: "run-new-attempt"; stepBaseId: string; previous: string }
  | { kind: "absorb"; stepBaseId: string; holder: string };

const RETRY_SUFFIX = /:retry-(\d+)$/;

function attemptOf(sessionId: string): number {
  const match = RETRY_SUFFIX.exec(sessionId);
  return match ? Number(match[1]) : 0;
}

export async function claimAutomationStep(
  redis: StepDedupRedis,
  agentSlug: string,
  sessionId: string,
): Promise<StepDedupDecision> {
  const stepBaseId = sessionId.replace(RETRY_SUFFIX, "");
  const key = `automation-step-dedup:${agentSlug}:${stepBaseId}`;
  if ((await redis.set(key, sessionId, "EX", STEP_DEDUP_TTL_SECONDS, "NX")) === "OK") return { kind: "run" };
  const holder = await redis.get(key);
  if (!holder || holder === sessionId) return { kind: "run" };
  if (attemptOf(sessionId) > attemptOf(holder)) {
    await redis.set(key, sessionId, "EX", STEP_DEDUP_TTL_SECONDS);
    return { kind: "run-new-attempt", stepBaseId, previous: holder };
  }
  return { kind: "absorb", stepBaseId, holder };
}
