/**
 * Mid-turn compaction adapter — the one place that reaches into pi's private
 * internals, so the coupling is contained and version-guarded instead of
 * scattered inline through runTask.
 *
 * Why this exists: pi v0.75 compacts AFTER an assistant message (using its
 * usage), but does not check the tool_result that JUST landed and will be in
 * the NEXT prompt. A turn that returns large tool output therefore inflates the
 * next call past the context window before native compaction runs. (With the
 * tool-output spill-to-file in place a single huge result can't land, but many
 * medium results in one turn still can.) This adapter adds the missing
 * mid-turn check, and supplies a token estimate for adapters — notably OpenAI
 * codex/responses — that don't surface `message.usage`.
 *
 * Coupling is isolated to {@link PiCompactionInternals}. If a pi upgrade renames
 * or removes any of these privates, {@link ensureInternals} fails LOUDLY (warn +
 * `compaction_patch_unavailable` metric) and compaction degrades to pi-native
 * instead of silently breaking — the failure is observable, not a mystery weeks
 * later.
 */

import { shouldCompact, calculateContextTokens, estimateTokens } from "@earendil-works/pi-coding-agent";
import { estimateContextTokens } from "@earendil-works/pi-agent-core";
import { metric } from "./metrics.js";

import { createLogger } from "./logger.js";
const log = createLogger("mid-turn-compaction");

type CompactionSettings = Parameters<typeof shouldCompact>[2] & { enabled: boolean };

interface ShouldStopCtx {
  message: { stopReason?: string; usage?: unknown };
  toolResults?: unknown[];
}
interface LoopCfg {
  shouldStopAfterTurn?: (ctx: ShouldStopCtx) => boolean;
}

/** The exact set of pi privates this adapter depends on — the coupling surface. */
interface PiCompactionInternals {
  settingsManager: { getCompactionSettings: () => CompactionSettings };
  _checkCompaction: (msg: { stopReason?: string; usage?: unknown }, skipAbortedCheck?: boolean) => Promise<boolean>;
  _runAutoCompaction: (reason: string, willRetry: boolean) => Promise<boolean>;
  messages?: unknown[];
  agent: {
    createLoopConfig: (opts?: unknown) => LoopCfg;
    state: { model?: { contextWindow?: number } };
  };
}

/**
 * Verify every private we touch is present and the right type. Returns the
 * typed handle, or null (with a loud warning + metric) when pi's shape has
 * drifted — callers then fall back to pi-native behavior.
 */
function ensureInternals(session: object, where: string): PiCompactionInternals | null {
  const s = session as Partial<PiCompactionInternals>;
  const ok =
    typeof s._checkCompaction === "function" &&
    typeof s._runAutoCompaction === "function" &&
    typeof s.settingsManager?.getCompactionSettings === "function" &&
    typeof s.agent?.createLoopConfig === "function" &&
    typeof s.agent?.state === "object";
  if (!ok) {
    metric.count("compaction_patch_unavailable", { where });
    log.warn(`[mid-turn-compaction] pi internals missing/changed at ${where} — compaction degrades to pi-native. A pi upgrade likely moved _checkCompaction/createLoopConfig.`);
    return null;
  }
  return s as PiCompactionInternals;
}

/** Estimate current context tokens from the live session messages — used when
 *  the provider didn't surface usage. Reuses pi's own estimator. */
function estimateBaseTokens(internals: PiCompactionInternals): number {
  try {
    const msgs = internals.messages;
    if (!Array.isArray(msgs)) return 0;
    return estimateContextTokens(msgs as Parameters<typeof estimateContextTokens>[0]).tokens;
  } catch {
    return 0;
  }
}

/** True when the session's live message list ends with an assistant message —
 *  the one tail shape pi's `agent.continue()` cannot send (the provider rejects
 *  it with "Cannot continue from message role: assistant"). `internals.messages`
 *  is pi's own getter for `agent.state.messages`, which `_runAutoCompaction`
 *  rebuilds to the post-compaction context BEFORE returning, so this reads the
 *  tail pi's driver is about to continue from. See the guard in the
 *  `_checkCompaction` wrapper for why this matters. */
function lastMessageIsAssistant(internals: PiCompactionInternals): boolean {
  const msgs = internals.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return false;
  const last = msgs[msgs.length - 1] as { role?: unknown } | null;
  return !!last && typeof last === "object" && last.role === "assistant";
}

/**
 * Install the mid-turn compaction check on a freshly-created AgentSession.
 * Idempotent per session; safe no-op if pi internals have drifted.
 */
export function installMidTurnCompaction(session: object): void {
  const internals = ensureInternals(session, "install");
  if (!internals) return;

  const { agent } = internals;
  const origCreateLoopConfig = agent.createLoopConfig.bind(agent);

  // Connects Part 1 (set, in shouldStopAfterTurn) and Part 2 (consume, in the
  // _checkCompaction wrapper).
  let pendingTrailingTokens = 0;

  // Part 1 — halt the loop after a turn whose tool_results would push the NEXT
  // call over threshold. createLoopConfig lives on the inner Agent (v0.75).
  agent.createLoopConfig = (opts?: unknown): LoopCfg => {
    const cfg = origCreateLoopConfig(opts);
    cfg.shouldStopAfterTurn = (ctx): boolean => {
      const settings = internals.settingsManager.getCompactionSettings();
      if (!settings.enabled) return false;
      const { message } = ctx;
      if (message.stopReason === "error" || message.stopReason === "aborted") return false;
      const ctxWindow = agent.state.model?.contextWindow ?? 0;
      if (ctxWindow <= 0) return false;
      const baseTokens = message.usage
        ? calculateContextTokens(message.usage as Parameters<typeof calculateContextTokens>[0])
        : estimateBaseTokens(internals);
      if (baseTokens <= 0) return false;
      const toolResults = Array.isArray(ctx.toolResults) ? ctx.toolResults : [];
      let trailing = 0;
      for (const t of toolResults) {
        trailing += estimateTokens(t as Parameters<typeof estimateTokens>[0]);
      }
      const stop = shouldCompact(baseTokens + trailing, ctxWindow, settings);
      if (stop) {
        pendingTrailingTokens = trailing;
        metric.count("agent_compaction", { kind: "mid_turn_stop" });
        log.info(`[agent] Mid-turn stop: ${baseTokens} + ${trailing} trailing (window=${ctxWindow})`);
      }
      return stop;
    };
    return cfg;
  };

  // Part 2 — native compaction first; if it skipped but Part 1 stashed trailing
  // tokens, re-evaluate with the combined estimate and force compaction.
  //
  // CRITICAL — a mid-turn stop MUST resume the loop afterwards (return true).
  // pi's `_checkCompaction` return value is `_runAutoCompaction`'s, which for a
  // threshold compaction is `hasQueuedMessages()` — false in a normal agent run.
  // That return drives pi's post-run driver:
  //     while (await _handlePostAgentRun()) await agent.continue();
  // For NATIVE pi that's fine: threshold compaction only fires AFTER the
  // assistant's final message, so ending the loop is correct. But Part 1 stops
  // the loop MID-TURN (tool_results still unprocessed); returning false there
  // makes the agent silently abandon the turn right after "compaction completed".
  // So whenever Part 1 stopped us (`trailing > 0`), we return true to force one
  // more `agent.continue()` and resume on the compacted context.
  const origCheckCompaction = internals._checkCompaction.bind(internals);
  internals._checkCompaction = async (msg, skipAbortedCheck = true): Promise<boolean> => {
    const trailing = pendingTrailingTokens;
    pendingTrailingTokens = 0;
    const ranNative = await origCheckCompaction(msg, skipAbortedCheck);

    // Decide whether pi's post-run driver should resume the loop (its `true`
    // answer becomes an `agent.continue()`). Computed here, then gated by the
    // assistant-tail guard below before we hand it back.
    let resume: boolean;
    if (trailing <= 0) {
      // No mid-turn stop in play → defer entirely to pi-native semantics.
      if (ranNative) metric.count("agent_compaction", { kind: "native" });
      resume = ranNative;
    } else {
      // Mid-turn stop. If native didn't already compact, force it when the combined
      // base+trailing estimate is over threshold. The `!shouldCompact(base)` guard
      // mirrors native's own base-only trigger, so when native already fired (base
      // alone over threshold, but it returned a falsy hasQueuedMessages) we don't
      // compact a second time.
      if (!ranNative) {
        const settings = internals.settingsManager.getCompactionSettings();
        const ctxWindow = agent.state.model?.contextWindow ?? 0;
        const base =
          msg.stopReason === "error" || msg.stopReason === "aborted"
            ? 0
            : msg.usage
              ? calculateContextTokens(msg.usage as Parameters<typeof calculateContextTokens>[0])
              : estimateBaseTokens(internals);
        if (
          settings.enabled &&
          ctxWindow > 0 &&
          base > 0 &&
          !shouldCompact(base, ctxWindow, settings) &&
          shouldCompact(base + trailing, ctxWindow, settings)
        ) {
          metric.count("agent_compaction", { kind: "forced_threshold" });
          log.info(`[agent] Forcing compaction: ${base} + ${trailing} trailing`);
          await internals._runAutoCompaction("threshold", false);
        }
      } else {
        metric.count("agent_compaction", { kind: "native" });
      }
      // Resume the turn so the pending tool_results are processed (see header note).
      metric.count("agent_compaction", { kind: "mid_turn_resume" });
      resume = true;
    }

    // GUARD — never resume into a context whose last message is an assistant turn.
    // pi answers a `true` here with `agent.continue()`, and every provider rejects
    // a request whose final message is role:"assistant" ("Cannot continue from
    // message role: assistant"). This fires when pi's overflow recovery trips on a
    // SUCCESSFUL completion: isContextOverflow Case 2/3 (silent/length overflow)
    // flags a `stop` message whose usage.input exceeds the *configured* contextWindow
    // — common when that window is set below the model's real limit — and
    // _runAutoCompaction(reason:"overflow", willRetry:true) then rebuilds the context
    // and returns true to retry. pi only strips a trailing assistant when its
    // stopReason is "error", so a "stop"/"length" turn survives at the tail and the
    // forced continue crashes. The answer was already produced, so ending the loop
    // here is correct; a genuine error-overflow retry is unaffected (pi strips its
    // error turn first, leaving a tool_result/user tail).
    if (resume && lastMessageIsAssistant(internals)) {
      metric.count("agent_compaction", { kind: "resume_suppressed_assistant_tail" });
      log.warn(
        "[mid-turn-compaction] Post-compaction resume suppressed: context ends with an assistant " +
        "message — continuing would fail with \"Cannot continue from message role: assistant\". " +
        "Usual trigger: contextWindow set below the model's real limit (false overflow on a completed turn).",
      );
      return false;
    }
    return resume;
  };
}

/**
 * Force a compaction now (used before a fallback attempt that follows an empty
 * completion). Best-effort; never throws. Returns true if compaction ran.
 */
export async function forceCompaction(session: object, reason: string): Promise<boolean> {
  const internals = ensureInternals(session, "force");
  if (!internals) return false;
  try {
    const ran = await internals._runAutoCompaction(reason, false);
    metric.count("agent_compaction", { kind: "pre_fallback", ran });
    return ran;
  } catch (err) {
    log.warn(`[mid-turn-compaction] forceCompaction failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}
