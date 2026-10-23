export type StallKind = "idle" | "first-token";

export interface StallState {
  now: number;
  lastActivityAt: number;
  awaitingFirstTokenSince: number | null;
  idleLimitMs: number;
  firstTokenLimitMs: number;
}

export function detectStall(state: StallState): { kind: StallKind; waitedMs: number } | null {
  const firstTokenWait = state.awaitingFirstTokenSince == null ? 0 : state.now - state.awaitingFirstTokenSince;
  if (state.firstTokenLimitMs > 0 && firstTokenWait > state.firstTokenLimitMs) return { kind: "first-token", waitedMs: firstTokenWait };
  const idle = state.now - state.lastActivityAt;
  if (state.idleLimitMs > 0 && idle > state.idleLimitMs) return { kind: "idle", waitedMs: idle };
  return null;
}

export function firstTokenLimitMs(provider: string | undefined, env: NodeJS.ProcessEnv = process.env): number {
  return provider === "claude" ? Number(env["AGENT_FIRST_TOKEN_STALL_MS"] ?? 45_000) : 0;
}
