import { createHash } from "node:crypto";

export type SubagentModelArm = "fast" | "standard";

export interface SubagentModelPick {
  model: string;
  arm: SubagentModelArm;
}

export function splitBucket(key: string): number {
  return createHash("sha256").update(key).digest().readUInt32BE(0) % 100;
}

export function clampPercent(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (raw === undefined || raw.trim() === "" || !Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function pickSubagentLitellmModel(opts: {
  key: string | undefined;
  fastModel: string;
  standardModel: string;
  fastPercent: number;
  random?: () => number;
}): SubagentModelPick {
  const standard: SubagentModelPick = { model: opts.standardModel, arm: "standard" };
  if (opts.fastModel === opts.standardModel || opts.fastPercent <= 0) return standard;
  const fast: SubagentModelPick = { model: opts.fastModel, arm: "fast" };
  if (opts.fastPercent >= 100) return fast;
  const bucket = opts.key ? splitBucket(opts.key) : Math.floor((opts.random ?? Math.random)() * 100);
  return bucket < opts.fastPercent ? fast : standard;
}
