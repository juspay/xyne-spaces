/**
 * awakeningBounds — the knobs that govern an "awakened" agent, one that wakes
 * and acts without anybody triggering it.
 *
 * SINGLE SOURCE OF TRUTH for the CLIENT. Keep in sync with the runtime
 * authority in xyne-claw-auth/backend/src/awakening/config.ts
 * (AWAKENING_BOUNDS + resolveAwakeningConfig) and the API-layer validator in
 * lib/agent-config-validation.ts (validateAwakeningConfig).
 *
 * The server re-clamps everything it is sent and rejects out-of-range values
 * with a 400, so these constants only shape what the editor offers — the UI
 * can never widen a real bound.
 */

export const AWAKENING_KINDS = ["heartbeat", "reflex", "both"] as const;
export type AwakeningKindValue = (typeof AWAKENING_KINDS)[number];

export const WRITE_POLICIES = ["observe", "reply", "act"] as const;
export type WritePolicyValue = (typeof WRITE_POLICIES)[number];

export const KIND_LABELS: Record<AwakeningKindValue, { label: string; hint: string }> = {
  heartbeat: { label: "Heartbeat only", hint: "Wakes on a timer and reviews the whole period." },
  reflex: { label: "Reflex only", hint: "Wakes when enough activity piles up. Fast and shallow." },
  both: { label: "Heartbeat + reflex", hint: "Reacts quickly, and reviews the period on a timer." },
};

export const WRITE_POLICY_LABELS: Record<WritePolicyValue, { label: string; hint: string }> = {
  observe: { label: "Observe", hint: "Reads and reasons. Posts nothing at all." },
  reply: { label: "Reply in threads", hint: "May reply where a conversation is already happening." },
  act: { label: "Act", hint: "May also start new threads in the channel." },
};

export const AWAKENING_BOUNDS = {
  periodMs: { MIN: 5 * 60_000, MAX: 24 * 60 * 60_000, DEFAULT: 30 * 60_000 },
  maxChannels: { MIN: 1, MAX: 100, DEFAULT: 25 },
  minHumanEvents: { MIN: 0, MAX: 1_000, DEFAULT: 1 },
  forceRunEveryNSkips: { MIN: 0, MAX: 100, DEFAULT: 0 },
  maxEvents: { MIN: 10, MAX: 5_000, DEFAULT: 1_500 },
  maxRunsPerHour: { MIN: 1, MAX: 60, DEFAULT: 4 },
  reflexCheckIntervalMs: { MIN: 15_000, MAX: 3_600_000, DEFAULT: 60_000 },
  reflexThreshold: { MIN: 1, MAX: 1_000, DEFAULT: 25 },
  reflexMinIntervalMs: { MIN: 0, MAX: 24 * 60 * 60_000, DEFAULT: 300_000 },
  injectThreshold: { MIN: 1, MAX: 1_000, DEFAULT: 10 },
  maxInjectionsPerSession: { MIN: 0, MAX: 20, DEFAULT: 3 },
  injectMinIntervalMs: { MIN: 0, MAX: 3_600_000, DEFAULT: 60_000 },
  instructionsLength: { MIN: 0, MAX: 10_000, DEFAULT: 0 },
  replicaSafetyMs: { MIN: 0, MAX: 300_000, DEFAULT: 30_000 },
} as const;

/** Discrete choices offered for duration knobs, in milliseconds. */
export const PERIOD_OPTIONS: readonly number[] = [
  5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000, 2 * 60 * 60_000,
  4 * 60 * 60_000, 8 * 60 * 60_000, 24 * 60 * 60_000,
];

export const REFLEX_CHECK_OPTIONS: readonly number[] = [
  15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
];

export const REFLEX_MIN_INTERVAL_OPTIONS: readonly number[] = [
  0, 60_000, 300_000, 600_000, 1_800_000, 3_600_000,
];

export const INJECT_MIN_INTERVAL_OPTIONS: readonly number[] = [0, 30_000, 60_000, 300_000, 600_000];

/**
 * Replica safety margin. 0 is offered because a single-writer / no-replica
 * Spaces has nothing to lag behind, and it is the only way to make live updates
 * reach a short run — but it is not the default, because on a replicated
 * deployment it silently drops events that had not replicated when the window
 * sealed.
 */
export const REPLICA_SAFETY_OPTIONS: readonly number[] = [0, 5_000, 10_000, 30_000, 60_000, 120_000];

type Bound = { MIN: number; MAX: number; DEFAULT: number };

export function clampToBound(raw: unknown, bound: Bound): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return bound.DEFAULT;
  return Math.min(bound.MAX, Math.max(bound.MIN, Math.floor(raw)));
}

/** Human label for a millisecond duration, e.g. "30m", "2h", "45s". */
export function formatDuration(ms: number): string {
  if (ms === 0) return "no minimum";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = mins / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${(mins / 60).toFixed(1)}h`;
}

export interface AwakeningSettings {
  enabled: boolean;
  kind: AwakeningKindValue;
  shadow: boolean;
  writePolicy: WritePolicyValue;
  /** Free-text guidance appended to every awakened run's operating contract. */
  instructions: string;
  periodMs: number;
  channels: {
    include: string[];
    includePattern: string[];
    exclude: string[];
    excludePattern: string[];
    maxChannels: number;
  };
  gate: { minHumanEvents: number; forceRunEveryNSkips: number };
  limits: { maxEvents: number; maxRunsPerHour: number };
  cursor: { replicaSafetyMs: number };
  reflex: {
    checkIntervalMs: number;
    threshold: number;
    minIntervalMs: number;
    injectEnabled: boolean;
    injectThreshold: number;
    maxInjectionsPerSession: number;
    injectMinIntervalMs: number;
  };
}

export const AWAKENING_DEFAULTS: AwakeningSettings = {
  // Off, shadowed and thread-only: a newly awakened agent must not be able to
  // post to a channel before a human has looked at what it would have said.
  enabled: false,
  kind: "heartbeat",
  shadow: true,
  writePolicy: "reply",
  instructions: "",
  periodMs: AWAKENING_BOUNDS.periodMs.DEFAULT,
  channels: {
    include: [],
    includePattern: [],
    exclude: [],
    excludePattern: [],
    maxChannels: AWAKENING_BOUNDS.maxChannels.DEFAULT,
  },
  gate: {
    minHumanEvents: AWAKENING_BOUNDS.minHumanEvents.DEFAULT,
    forceRunEveryNSkips: AWAKENING_BOUNDS.forceRunEveryNSkips.DEFAULT,
  },
  limits: {
    maxEvents: AWAKENING_BOUNDS.maxEvents.DEFAULT,
    maxRunsPerHour: AWAKENING_BOUNDS.maxRunsPerHour.DEFAULT,
  },
  cursor: { replicaSafetyMs: AWAKENING_BOUNDS.replicaSafetyMs.DEFAULT },
  reflex: {
    checkIntervalMs: AWAKENING_BOUNDS.reflexCheckIntervalMs.DEFAULT,
    threshold: AWAKENING_BOUNDS.reflexThreshold.DEFAULT,
    minIntervalMs: AWAKENING_BOUNDS.reflexMinIntervalMs.DEFAULT,
    injectEnabled: true,
    injectThreshold: AWAKENING_BOUNDS.injectThreshold.DEFAULT,
    maxInjectionsPerSession: AWAKENING_BOUNDS.maxInjectionsPerSession.DEFAULT,
    injectMinIntervalMs: AWAKENING_BOUNDS.injectMinIntervalMs.DEFAULT,
  },
};

function stringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
}

function pick<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** Read the awakening block out of an agent config, filling every gap with a default. */
export function readAwakening(config: Record<string, unknown> | undefined): AwakeningSettings {
  const raw = config?.["awakening"] as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return structuredClone(AWAKENING_DEFAULTS);

  const ch = (raw["channels"] ?? {}) as Record<string, unknown>;
  const gate = (raw["gate"] ?? {}) as Record<string, unknown>;
  const limits = (raw["limits"] ?? {}) as Record<string, unknown>;
  const reflex = (raw["reflex"] ?? {}) as Record<string, unknown>;
  const cursor = (raw["cursor"] ?? {}) as Record<string, unknown>;
  const D = AWAKENING_DEFAULTS;

  return {
    enabled: typeof raw["enabled"] === "boolean" ? raw["enabled"] : D.enabled,
    kind: pick(raw["kind"], AWAKENING_KINDS, D.kind),
    shadow: typeof raw["shadow"] === "boolean" ? raw["shadow"] : D.shadow,
    writePolicy: pick(raw["writePolicy"], WRITE_POLICIES, D.writePolicy),
    instructions:
      typeof raw["instructions"] === "string"
        ? raw["instructions"].slice(0, AWAKENING_BOUNDS.instructionsLength.MAX)
        : D.instructions,
    periodMs: clampToBound(raw["periodMs"], AWAKENING_BOUNDS.periodMs),
    channels: {
      include: stringArray(ch["include"]),
      includePattern: stringArray(ch["includePattern"]),
      exclude: stringArray(ch["exclude"]),
      excludePattern: stringArray(ch["excludePattern"]),
      maxChannels: clampToBound(ch["maxChannels"], AWAKENING_BOUNDS.maxChannels),
    },
    gate: {
      minHumanEvents: clampToBound(gate["minHumanEvents"], AWAKENING_BOUNDS.minHumanEvents),
      forceRunEveryNSkips: clampToBound(gate["forceRunEveryNSkips"], AWAKENING_BOUNDS.forceRunEveryNSkips),
    },
    limits: {
      maxEvents: clampToBound(limits["maxEvents"], AWAKENING_BOUNDS.maxEvents),
      maxRunsPerHour: clampToBound(limits["maxRunsPerHour"], AWAKENING_BOUNDS.maxRunsPerHour),
    },
    cursor: { replicaSafetyMs: clampToBound(cursor["replicaSafetyMs"], AWAKENING_BOUNDS.replicaSafetyMs) },
    reflex: {
      checkIntervalMs: clampToBound(reflex["checkIntervalMs"], AWAKENING_BOUNDS.reflexCheckIntervalMs),
      threshold: clampToBound(reflex["threshold"], AWAKENING_BOUNDS.reflexThreshold),
      minIntervalMs: clampToBound(reflex["minIntervalMs"], AWAKENING_BOUNDS.reflexMinIntervalMs),
      injectEnabled: typeof reflex["injectEnabled"] === "boolean" ? reflex["injectEnabled"] : D.reflex.injectEnabled,
      injectThreshold: clampToBound(reflex["injectThreshold"], AWAKENING_BOUNDS.injectThreshold),
      maxInjectionsPerSession: clampToBound(
        reflex["maxInjectionsPerSession"],
        AWAKENING_BOUNDS.maxInjectionsPerSession,
      ),
      injectMinIntervalMs: clampToBound(reflex["injectMinIntervalMs"], AWAKENING_BOUNDS.injectMinIntervalMs),
    },
  };
}

/** One-line status for the dashboard card. */
export function summarize(s: AwakeningSettings): string {
  if (!s.enabled) return "Off";
  const parts: string[] = [];
  if (s.kind !== "reflex") parts.push(`every ${formatDuration(s.periodMs)}`);
  if (s.kind !== "heartbeat") parts.push(`reflex at ${s.reflex.threshold} events`);
  parts.push(s.shadow ? "shadow" : WRITE_POLICY_LABELS[s.writePolicy].label.toLowerCase());
  return parts.join(" · ");
}
