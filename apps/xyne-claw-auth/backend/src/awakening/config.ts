/**
 * The `agents.config.awakening` block — every knob that governs an awakened
 * agent, plus its default and its clamp.
 *
 * Config lives in the agent's JSON config rather than in dedicated columns so
 * the existing PUT /agents/:slug path, its ACL and its audit diff keep working
 * untouched. Scheduling STATE (nextDueAt, watermark, failure counters) lives
 * in agent_awakening_state instead, because the tick loop has to index-scan it
 * and Postgres cannot index JSON.
 *
 * Every read goes through resolveAwakeningConfig(), which clamps as it reads.
 * A value that was valid when written but is out of bounds today (a lowered
 * ceiling, a hand-edited row, a rolled-back deploy) degrades to the nearest
 * legal value instead of throwing on the wake path. The API-layer validator in
 * lib/agent-config-validation.ts rejects bad input at write time; this module
 * is the runtime backstop that keeps the tick loop from ever crashing on
 * malformed config.
 */

/** Which wake kinds an agent participates in. */
export const AWAKENING_KINDS = ["heartbeat", "reflex", "both"] as const;
export type AwakeningKind = (typeof AWAKENING_KINDS)[number];

/**
 * What the agent is permitted to DO once awake.
 *   observe — reason and write memory; no outbound Spaces writes at all.
 *   reply   — may reply inside existing threads it was given.
 *   act     — may also start new threads and post to a channel.
 * Enforced at runtime in xyne-claw, not just by tool-set assembly: the app
 * identity's post tool is ungated by design, so assembly alone is not a bound.
 */
export const WRITE_POLICIES = ["observe", "reply", "act"] as const;
export type WritePolicy = (typeof WRITE_POLICIES)[number];

export interface AwakeningChannelRules {
  /** Explicit Spaces channel ids. Always intersected with the bot's memberships. */
  include: string[];
  /** Case-insensitive regex sources matched against Channel.name. */
  includePattern: string[];
  exclude: string[];
  excludePattern: string[];
  /** Hard cap after resolution; least-recently-active channels drop first. */
  maxChannels: number;
}

export interface AwakeningConfig {
  enabled: boolean;
  kind: AwakeningKind;
  /**
   * Which Spaces workspace to read and act in. Optional: an org with exactly
   * one linked workspace resolves automatically. Required when the org has
   * several — guessing between tenants must never happen silently.
   */
  workspaceId?: string;
  /** Heartbeat period. The floor exists so a typo cannot make an agent wake every second. */
  periodMs: number;
  channels: AwakeningChannelRules;
  writePolicy: WritePolicy;
  /**
   * Shadow mode: run the agent and record what it WOULD have done, but strip
   * every outbound write tool. The safe first rollout for any agent.
   */
  shadow: boolean;
  /**
   * Free-text guidance the agent owner writes for awakened runs — tone, what
   * is worth reacting to, what to leave alone. Appended to the operating
   * contract as its own labelled block.
   *
   * Deliberately advisory: it shapes JUDGEMENT, never mechanics. The contract's
   * delivery rules and the Bounds below it are appended AFTER this block and
   * are not overridable from config, so a careless instruction cannot make a
   * run mute, make it answer its own messages, or bypass the write policy.
   */
  instructions: string;
  gate: {
    /** Below this many human events the window is not worth a run. */
    minHumanEvents: number;
    /** Wake regardless of the gate every Nth consecutive skip (0 = never). */
    forceRunEveryNSkips: number;
  };
  limits: {
    maxEvents: number;
    maxActiveThreads: number;
    maxRunsPerHour: number;
  };
  /**
   * Reflex: the fast, shallow wake driven by how many events have piled up
   * rather than by the clock. Checked cheaply (a COUNT) far more often than a
   * heartbeat, and fires only once `threshold` events have accumulated.
   */
  reflex: {
    /** How often the accumulated-event count is checked. */
    checkIntervalMs: number;
    /** Events since the reflex watermark that trigger a wake. */
    threshold: number;
    /** Floor on the gap between two reflex runs, whatever the event rate. */
    minIntervalMs: number;
    /**
     * Live injection: while a reflex run is in flight, keep collecting. Once
     * `injectThreshold` NEW events have arrived, hand them to the running
     * session so it can adapt mid-task instead of finishing on stale input.
     */
    injectEnabled: boolean;
    injectThreshold: number;
    /** Hard cap on injections per session — a run must still converge. */
    maxInjectionsPerSession: number;
    /** Floor on the gap between two injections into the same session. */
    injectMinIntervalMs: number;
  };
  cursor: {
    /**
     * How far behind "now" a window closes. Spaces reads hit a read replica;
     * sealing right up to now() would miss rows that had not replicated yet,
     * and the watermark would step past them forever.
     */
    replicaSafetyMs: number;
    /** Re-scan band below the watermark, de-duplicated against a seen-set. */
    overlapMs: number;
    /** Cap on catch-up windows after an outage before the gap guard jumps forward. */
    maxCatchupWindows: number;
  };
}

export const AWAKENING_BOUNDS = {
  periodMs: { min: 5 * 60_000, max: 24 * 60 * 60_000, default: 30 * 60_000 },
  maxChannels: { min: 1, max: 100, default: 25 },
  minHumanEvents: { min: 0, max: 1_000, default: 1 },
  forceRunEveryNSkips: { min: 0, max: 100, default: 0 },
  maxEvents: { min: 10, max: 5_000, default: 1_500 },
  maxActiveThreads: { min: 5, max: 1_000, default: 400 },
  maxRunsPerHour: { min: 1, max: 60, default: 4 },
  replicaSafetyMs: { min: 0, max: 300_000, default: 30_000 },
  overlapMs: { min: 0, max: 900_000, default: 120_000 },
  maxCatchupWindows: { min: 1, max: 50, default: 4 },
  reflexCheckIntervalMs: { min: 15_000, max: 3_600_000, default: 60_000 },
  reflexThreshold: { min: 1, max: 1_000, default: 25 },
  reflexMinIntervalMs: { min: 0, max: 24 * 60 * 60_000, default: 300_000 },
  injectThreshold: { min: 1, max: 1_000, default: 10 },
  maxInjectionsPerSession: { min: 0, max: 20, default: 3 },
  injectMinIntervalMs: { min: 0, max: 3_600_000, default: 60_000 },
  /** Cap on owner-written run guidance — long enough for real direction,
   *  short enough that it cannot crowd out the window itself. */
  instructionsLength: { max: 10_000 },
  /** Guards against a pathological or hostile channel-name pattern. */
  patternLength: { max: 200 },
  patternCount: { max: 10 },
} as const;

export const AWAKENING_DEFAULTS: AwakeningConfig = {
  enabled: false,
  kind: "heartbeat",
  periodMs: AWAKENING_BOUNDS.periodMs.default,
  channels: {
    include: [],
    includePattern: [],
    exclude: [],
    excludePattern: [],
    maxChannels: AWAKENING_BOUNDS.maxChannels.default,
  },
  writePolicy: "reply",
  shadow: true,
  instructions: "",
  gate: {
    minHumanEvents: AWAKENING_BOUNDS.minHumanEvents.default,
    forceRunEveryNSkips: AWAKENING_BOUNDS.forceRunEveryNSkips.default,
  },
  limits: {
    maxEvents: AWAKENING_BOUNDS.maxEvents.default,
    maxActiveThreads: AWAKENING_BOUNDS.maxActiveThreads.default,
    maxRunsPerHour: AWAKENING_BOUNDS.maxRunsPerHour.default,
  },
  reflex: {
    checkIntervalMs: AWAKENING_BOUNDS.reflexCheckIntervalMs.default,
    threshold: AWAKENING_BOUNDS.reflexThreshold.default,
    minIntervalMs: AWAKENING_BOUNDS.reflexMinIntervalMs.default,
    injectEnabled: true,
    injectThreshold: AWAKENING_BOUNDS.injectThreshold.default,
    maxInjectionsPerSession: AWAKENING_BOUNDS.maxInjectionsPerSession.default,
    injectMinIntervalMs: AWAKENING_BOUNDS.injectMinIntervalMs.default,
  },
  cursor: {
    replicaSafetyMs: AWAKENING_BOUNDS.replicaSafetyMs.default,
    overlapMs: AWAKENING_BOUNDS.overlapMs.default,
    maxCatchupWindows: AWAKENING_BOUNDS.maxCatchupWindows.default,
  },
};

type Bound = { min: number; max: number; default: number };

function clampNumber(raw: unknown, bound: Bound): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return bound.default;
  return Math.min(bound.max, Math.max(bound.min, Math.floor(raw)));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Non-empty trimmed strings only, de-duplicated, capped at `max` entries. */
function stringList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || out.includes(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Regex sources that survive `new RegExp(src, "i")`. An invalid or oversized
 * pattern is dropped rather than thrown: a bad pattern must never be able to
 * take the tick loop down, and channel resolution simply matches less.
 */
function patternList(raw: unknown): string[] {
  const candidates = stringList(raw, AWAKENING_BOUNDS.patternCount.max);
  return candidates.filter((src) => {
    if (src.length > AWAKENING_BOUNDS.patternLength.max) return false;
    try {
      new RegExp(src, "i");
      return true;
    } catch {
      return false;
    }
  });
}

function oneOf<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/**
 * Owner-written free text. Trimmed, truncated to the bound and stripped of
 * control characters — never rejected, because resolveAwakeningConfig must not
 * be able to throw on a stored config (a bad string would otherwise disable an
 * agent that was previously working).
 */
function boundedText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

function bool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

/**
 * Read `agent.config.awakening` into a fully-populated, in-bounds config.
 * Never throws — a missing, malformed or hostile block yields defaults.
 */
export function resolveAwakeningConfig(agentConfig: unknown): AwakeningConfig {
  const raw = isPlainObject(agentConfig) ? agentConfig["awakening"] : undefined;
  if (!isPlainObject(raw)) return { ...AWAKENING_DEFAULTS };

  const channels = isPlainObject(raw["channels"]) ? raw["channels"] : {};
  const gate = isPlainObject(raw["gate"]) ? raw["gate"] : {};
  const limits = isPlainObject(raw["limits"]) ? raw["limits"] : {};
  const cursor = isPlainObject(raw["cursor"]) ? raw["cursor"] : {};
  const reflex = isPlainObject(raw["reflex"]) ? raw["reflex"] : {};
  const idCap = AWAKENING_BOUNDS.maxChannels.max;

  return {
    enabled: bool(raw["enabled"], AWAKENING_DEFAULTS.enabled),
    kind: oneOf(raw["kind"], AWAKENING_KINDS, AWAKENING_DEFAULTS.kind),
    ...(typeof raw["workspaceId"] === "string" && raw["workspaceId"].trim()
      ? { workspaceId: raw["workspaceId"].trim() }
      : {}),
    periodMs: clampNumber(raw["periodMs"], AWAKENING_BOUNDS.periodMs),
    channels: {
      include: stringList(channels["include"], idCap),
      includePattern: patternList(channels["includePattern"]),
      exclude: stringList(channels["exclude"], idCap),
      excludePattern: patternList(channels["excludePattern"]),
      maxChannels: clampNumber(channels["maxChannels"], AWAKENING_BOUNDS.maxChannels),
    },
    writePolicy: oneOf(raw["writePolicy"], WRITE_POLICIES, AWAKENING_DEFAULTS.writePolicy),
    shadow: bool(raw["shadow"], AWAKENING_DEFAULTS.shadow),
    instructions: boundedText(raw["instructions"], AWAKENING_BOUNDS.instructionsLength.max),
    gate: {
      minHumanEvents: clampNumber(gate["minHumanEvents"], AWAKENING_BOUNDS.minHumanEvents),
      forceRunEveryNSkips: clampNumber(gate["forceRunEveryNSkips"], AWAKENING_BOUNDS.forceRunEveryNSkips),
    },
    limits: {
      maxEvents: clampNumber(limits["maxEvents"], AWAKENING_BOUNDS.maxEvents),
      maxActiveThreads: clampNumber(limits["maxActiveThreads"], AWAKENING_BOUNDS.maxActiveThreads),
      maxRunsPerHour: clampNumber(limits["maxRunsPerHour"], AWAKENING_BOUNDS.maxRunsPerHour),
    },
    reflex: {
      checkIntervalMs: clampNumber(reflex["checkIntervalMs"], AWAKENING_BOUNDS.reflexCheckIntervalMs),
      threshold: clampNumber(reflex["threshold"], AWAKENING_BOUNDS.reflexThreshold),
      minIntervalMs: clampNumber(reflex["minIntervalMs"], AWAKENING_BOUNDS.reflexMinIntervalMs),
      injectEnabled: bool(reflex["injectEnabled"], AWAKENING_DEFAULTS.reflex.injectEnabled),
      injectThreshold: clampNumber(reflex["injectThreshold"], AWAKENING_BOUNDS.injectThreshold),
      maxInjectionsPerSession: clampNumber(
        reflex["maxInjectionsPerSession"],
        AWAKENING_BOUNDS.maxInjectionsPerSession,
      ),
      injectMinIntervalMs: clampNumber(reflex["injectMinIntervalMs"], AWAKENING_BOUNDS.injectMinIntervalMs),
    },
    cursor: {
      replicaSafetyMs: clampNumber(cursor["replicaSafetyMs"], AWAKENING_BOUNDS.replicaSafetyMs),
      overlapMs: clampNumber(cursor["overlapMs"], AWAKENING_BOUNDS.overlapMs),
      maxCatchupWindows: clampNumber(cursor["maxCatchupWindows"], AWAKENING_BOUNDS.maxCatchupWindows),
    },
  };
}

/**
 * Stable fingerprint of the channel rules. Used as part of the resolved-channel
 * cache key so editing the rules invalidates the cache with no explicit bust.
 */
export function hashChannelRules(rules: AwakeningChannelRules): string {
  const canonical = JSON.stringify([
    [...rules.include].sort(),
    [...rules.includePattern].sort(),
    [...rules.exclude].sort(),
    [...rules.excludePattern].sort(),
    rules.maxChannels,
  ]);
  let hash = 5381;
  for (let i = 0; i < canonical.length; i++) {
    hash = ((hash << 5) + hash + canonical.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** True when the agent's config makes it eligible for the given wake kind. */
export function participatesIn(config: AwakeningConfig, kind: "heartbeat" | "reflex"): boolean {
  return config.kind === "both" || config.kind === kind;
}
