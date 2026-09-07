/**
 * Run lifecycle capture: the guaranteed-write header dance, and the stream hook.
 *
 * Two responsibilities that share one theme — *never lose the evidence*:
 *
 * 1. `startCapture` writes a `status: "running"` header the instant a run
 *    begins, so a pod killed mid-turn still leaves a discoverable artifact.
 *    `finish` then does header → v1 materialization → close, each step in its
 *    own try/catch, because a failure in one must not cost us the others.
 * 2. `installStreamCapture` wraps `agent.streamFn`, which is the ONLY place the
 *    prompt the model actually receives is visible. Everything upstream sees
 *    the persona prompt; pi assembles the real one (`<available_skills>` and
 *    all) on its way to the provider. Capturing it here is the whole point of
 *    the v2 rewrite.
 *
 * GCS upload deliberately lives outside this module: importing storage.ts would
 * drag HTTP into every unit test. The caller injects `onStart`/`onFinish`.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { createLogger } from "../logger.js";
import { metric } from "../metrics.js";
import { hashContent } from "./blobs.js";
import { toV1Events, toV1Snapshot } from "./materialize.js";
import type { Recorder } from "./recorder.js";
import { readRun, type RunStore } from "./store.js";
import {
  isCaptureLevel,
  type CaptureLevel,
  type LatencyMetrics,
  type RunHeader,
  type RunStatus,
  type TokenUsage,
} from "./types.js";

const log = createLogger("debug");

export interface StartCaptureOpts {
  store: RunStore | null;
  recorder: Recorder;
  header: RunHeader;
  /** Extra conversation ids to index this run under (review-room runs index under the parent thread too). */
  alsoIndexUnder?: string[];
  /**
   * Write the session-level v1 compat artifacts (`debug-session.json` +
   * `debug-events.json`) at finish. Defaults to true.
   *
   * A subagent run shares its parent's debug dir, and those two files are named
   * per SESSION, not per run — so a child finishing mid-parent-run would
   * overwrite the parent's snapshot with its own. Child runs pass false: their
   * own append-only trio is still written, and the parent still materializes
   * the session when it finishes.
   */
  materializeV1?: boolean;
  /**
   * Fire-and-forget side effects (GCS index marker at start, upload at finish).
   * They receive the header only; a caller that also needs `alsoIndexUnder`
   * closes over the same opts object it built.
   */
  onStart?: (h: RunHeader) => void;
  onFinish?: (h: RunHeader) => void;
}

export interface CaptureHandles {
  readonly recorder: Recorder;
  readonly finished: boolean;
  finish(status: RunStatus, final: { text: string; tokenUsage: TokenUsage; latency: LatencyMetrics }): Promise<void>;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Hooks are caller-supplied; a throw in one must not derail the lifecycle. */
function fire(hook: ((h: RunHeader) => void) | undefined, header: RunHeader): void {
  if (!hook) return;
  try {
    hook(header);
  } catch (err) {
    log.warn("debug: capture hook threw", { error: errText(err), runId: header.runId });
  }
}

/** Atomic enough for a file a reader may be polling: write beside, then rename. */
async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  // No pretty-printing: indenting a 20 MB trace burns CPU and bytes for a file
  // only ever read by a parser.
  await fs.writeFile(tmp, JSON.stringify(value), "utf8");
  await fs.rename(tmp, file);
}

export function startCapture(o: StartCaptureOpts): CaptureHandles {
  const { store, recorder } = o;

  // The guarantee: an in-flight run is already discoverable. finishedAt tracks
  // startedAt until the real finish lands, so readers can spot a crashed run by
  // `status === "running"` alone.
  const running: RunHeader = { ...o.header, status: "running", finishedAt: o.header.startedAt };
  try {
    store?.writeHeader(running);
    metric.count("debug_artifact_write", { result: "ok", stage: "start" });
  } catch (err) {
    metric.count("debug_artifact_write", { result: "fail", stage: "start" });
    log.warn("debug: start header write failed", { error: errText(err), runId: running.runId });
  }
  fire(o.onStart, running);

  let finished = false;

  return {
    recorder,
    get finished(): boolean {
      return finished;
    },
    async finish(status, final): Promise<void> {
      if (finished) return;
      finished = true;

      let header = running;

      // 1. Durable, append-only data first. Everything else is derived from it,
      //    so a crash after this point still leaves a complete v2 run.
      try {
        const textRef = recorder.internText(final.text);
        header = {
          ...running,
          status,
          finishedAt: new Date().toISOString(),
          counts: {
            events: recorder.eventCount,
            blobs: recorder.blobCount,
            messages: recorder.messageCount,
            toolCalls: recorder.toolCallCount,
          },
          tokenUsage: final.tokenUsage,
          latency: final.latency,
          ...(textRef !== undefined ? { lastAssistantTextRef: textRef } : {}),
        };
        store?.writeHeader(header);
        await store?.flush();
        metric.count("debug_artifact_write", { result: "ok", stage: "header" });
      } catch (err) {
        metric.count("debug_artifact_write", { result: "fail", stage: "header" });
        log.warn("debug: final header write failed", { error: errText(err), runId: header.runId });
      }

      // 2. v1 compat artifacts, read back from what step 1 just persisted so the
      //    snapshot resolves blob refs exactly the way a remote reader would.
      //    Skipped for a child run: those files belong to the session, and this
      //    run only owns part of it.
      try {
        if (store && o.materializeV1 !== false) {
          const run = await readRun(store.runDir);
          if (run) {
            await writeJsonAtomic(path.join(store.debugDir, "debug-session.json"), toV1Snapshot(run));
            await writeJsonAtomic(path.join(store.debugDir, "debug-events.json"), toV1Events(run));
            metric.count("debug_artifact_write", { result: "ok", stage: "materialize" });
          } else {
            metric.count("debug_artifact_write", { result: "fail", stage: "materialize" });
            log.warn("debug: run unreadable, v1 artifacts skipped", { runId: header.runId });
          }
        }
      } catch (err) {
        metric.count("debug_artifact_write", { result: "fail", stage: "materialize" });
        log.warn("debug: v1 materialization failed", { error: errText(err), runId: header.runId });
      }

      try {
        await store?.close();
        metric.count("debug_artifact_write", { result: "ok", stage: "close" });
      } catch (err) {
        metric.count("debug_artifact_write", { result: "fail", stage: "close" });
        log.warn("debug: store close failed", { error: errText(err), runId: header.runId });
      }

      fire(o.onFinish, header);
    },
  };
}

// ── Stream hook ─────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function isThenable(v: unknown): v is Promise<unknown> {
  return isRecord(v) && typeof (v as { then?: unknown }).then === "function";
}

/** Providers disagree on where the model id lives; take the first plausible one. */
function modelIdOf(model: unknown): string | undefined {
  if (typeof model === "string") return model;
  if (!isRecord(model)) return undefined;
  return str(model["id"]) ?? str(model["modelId"]) ?? str(model["model"]) ?? str(model["name"]);
}

export interface AvailableSkill {
  name: string;
  description?: string;
  location?: string;
}

const SKILLS_BLOCK_RE = /<available_skills>([\s\S]*?)<\/available_skills>/i;
const SKILL_RE = /<skill>([\s\S]*?)<\/skill>/gi;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    // &amp; last, so `&amp;lt;` decodes to the literal `&lt;` rather than `<`.
    .replace(/&amp;/g, "&");
}

function innerTag(body: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i").exec(body);
  const raw = m?.[1];
  if (raw === undefined) return undefined;
  const value = decodeEntities(raw).trim();
  return value.length > 0 ? value : undefined;
}

/**
 * Pull the skill catalog back out of the assembled system prompt.
 *
 * This is the only record of what the model could see: the catalog is built by
 * pi at prompt-assembly time and never passes through our own config objects.
 */
export function parseAvailableSkills(systemPrompt: string): AvailableSkill[] {
  if (typeof systemPrompt !== "string") return [];
  const block = SKILLS_BLOCK_RE.exec(systemPrompt)?.[1];
  if (!block) return [];
  const out: AvailableSkill[] = [];
  SKILL_RE.lastIndex = 0;
  for (let m = SKILL_RE.exec(block); m !== null; m = SKILL_RE.exec(block)) {
    const body = m[1] ?? "";
    const name = innerTag(body, "name");
    if (!name) continue;
    const description = innerTag(body, "description");
    const location = innerTag(body, "location");
    out.push({
      name,
      ...(description !== undefined ? { description } : {}),
      ...(location !== undefined ? { location } : {}),
    });
  }
  return out;
}

export function paletteDiff(
  prev: readonly string[],
  next: readonly string[],
): { added: string[]; removed: string[] } {
  const before = new Set(prev);
  const after = new Set(next);
  return {
    added: next.filter((n) => !before.has(n)),
    removed: prev.filter((p) => !after.has(p)),
  };
}

export function resolveCaptureLevel(): CaptureLevel {
  const raw = process.env["DEBUG_CAPTURE"]?.trim().toLowerCase();
  return isCaptureLevel(raw) ? raw : "full";
}

interface StreamCaptureOpts {
  agent: { streamFn: (model: unknown, context: unknown, options?: unknown) => unknown };
  recorder: Recorder;
  fastMode?: boolean;
  provider?: string;
}

/** Bounded so a run that rewrites its prompt every turn can't grow the cache. */
const SKILL_CACHE_LIMIT = 16;

const WRAPPED = Symbol.for("xyne.debug.streamCapture");

export function installStreamCapture(o: StreamCaptureOpts): void {
  const { agent, recorder } = o;
  const base = agent.streamFn;
  if (typeof base !== "function") return;
  // Re-installing (provider fallback rebuilds the session) must not double-record.
  if ((base as unknown as Record<symbol, unknown>)[WRAPPED] === true) return;

  let prevToolNames: string[] = [];
  let llmCall = 0;
  const skillCache = new Map<string, AvailableSkill[]>();

  const skillsFor = (systemPrompt: string): AvailableSkill[] => {
    // A ~20 KB regex parse per turn is pure waste when the prompt rarely moves.
    const key = hashContent(systemPrompt);
    const hit = skillCache.get(key);
    if (hit) return hit;
    const parsed = parseAvailableSkills(systemPrompt);
    if (skillCache.size >= SKILL_CACHE_LIMIT) {
      const oldest = skillCache.keys().next();
      if (!oldest.done) skillCache.delete(oldest.value);
    }
    skillCache.set(key, parsed);
    return parsed;
  };

  const recordRequest = (model: unknown, context: unknown, options: unknown, call: number): void => {
    const ctx = isRecord(context) ? context : {};
    const opt = isRecord(options) ? options : {};

    const rawMessages = ctx["messages"];
    const messages = Array.isArray(rawMessages) ? (rawMessages as unknown[]) : [];
    // `from` is where this request's *new* messages start; the request itself
    // covers [0, to). Both are indices into the run's transcript log.
    const messagesFrom = recorder.messageCount;
    recorder.recordTranscript(messages);
    const messagesTo = recorder.messageCount;

    const systemPrompt = typeof ctx["systemPrompt"] === "string" ? (ctx["systemPrompt"] as string) : "";
    const rawTools = ctx["tools"];
    const tools = (Array.isArray(rawTools) ? (rawTools as unknown[]) : []).filter(isRecord).map((t) => {
      const name = str(t["name"]) ?? "";
      const description = str(t["description"]) ?? str(t["label"]);
      return {
        name,
        ...(description !== undefined ? { description } : {}),
        ...(t["parameters"] !== undefined ? { parameters: t["parameters"] } : {}),
      };
    });
    const toolNames = tools.map((t) => t.name).filter((n) => n.length > 0);

    const first = call === 1;
    const { added, removed } = paletteDiff(prevToolNames, toolNames);
    prevToolNames = toolNames;

    const modelId = modelIdOf(model);
    const provider = o.provider ?? (isRecord(model) ? str(model["provider"]) : undefined);
    const thinkingLevel =
      str(opt["thinkingLevel"]) ??
      (isRecord(opt["thinking"]) ? str((opt["thinking"] as Record<string, unknown>)["level"]) : undefined) ??
      str(opt["thinking"]);
    const maxTokens = num(opt["maxTokens"]) ?? num(opt["max_tokens"]) ?? num(opt["maxOutputTokens"]);
    const temperature = num(opt["temperature"]);

    recorder.record(
      "llm_request",
      {
        ...(modelId !== undefined ? { model: modelId } : {}),
        ...(provider !== undefined ? { provider } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
        fastMode: o.fastMode === true,
        toolCount: tools.length,
        systemPrompt,
        tools,
        toolNames,
        availableSkills: skillsFor(systemPrompt),
        // The first call has nothing to differ against — its palette is the
        // baseline, reported by the `initial` tool_palette_change below.
        paletteAdded: first ? [] : added,
        paletteRemoved: first ? [] : removed,
        messagesFrom,
        messagesTo,
      },
      { llmCall: call },
    );

    if (added.length > 0 || removed.length > 0) {
      recorder.record(
        "tool_palette_change",
        {
          // The first call establishes the palette; a later change is pi having
          // materialized lazily-loaded tools mid-run.
          source: first ? "initial" : "load-tools",
          added,
          removed,
          activeCount: toolNames.length,
        },
        { llmCall: call },
      );
    }
  };

  const recordResponse = (call: number, startedAt: number, value: unknown, err?: unknown): void => {
    const v = isRecord(value) ? value : {};
    const usage = isRecord(v["usage"]) ? v["usage"] : undefined;
    // TTFT is measured by installLlmCallMetrics, which owns the iterator; we
    // surface it only if the provider result carries it.
    const ttftMs = num(v["ttftMs"]) ?? num(v["timeToFirstTokenMs"]);
    recorder.record(
      "llm_response",
      {
        ...(err !== undefined ? { errorMessage: errText(err) } : {}),
        ...(str(v["stopReason"]) !== undefined ? { stopReason: str(v["stopReason"]) } : {}),
        ...(ttftMs !== undefined ? { ttftMs } : {}),
        ...(usage !== undefined ? { usage } : {}),
        totalMs: Date.now() - startedAt,
      },
      { llmCall: call },
    );
  };

  /**
   * Observe the terminal outcome without touching the token stream —
   * installLlmCallMetrics already wraps the iterator, and a second wrapper
   * doubles per-token overhead for no new signal.
   */
  const observe = (result: unknown, call: number, startedAt: number): void => {
    if (isThenable(result)) {
      result.then(
        (resolved) => observe(resolved, call, startedAt),
        (err: unknown) => recordResponse(call, startedAt, undefined, err),
      );
      return;
    }
    if (!isRecord(result)) return;
    const holder = result["result"];
    const promise = typeof holder === "function" ? (holder as () => unknown).call(result) : holder;
    if (!isThenable(promise)) return;
    promise.then(
      (value) => recordResponse(call, startedAt, value),
      (err: unknown) => recordResponse(call, startedAt, undefined, err),
    );
  };

  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    const call = ++llmCall;
    const startedAt = Date.now();
    // A debug failure must never break an LLM call; every field access above is
    // guarded, and this is the backstop for the shapes we didn't anticipate.
    try {
      recordRequest(args[0], args[1], args[2], call);
    } catch (err) {
      metric.count("debug_stream_capture_error", { stage: "request" });
      log.warn("debug: llm_request capture failed", { error: errText(err) });
    }

    let result: unknown;
    try {
      result = (base as (...a: unknown[]) => unknown).apply(this, args);
    } catch (err) {
      recordResponse(call, startedAt, undefined, err);
      throw err;
    }

    try {
      observe(result, call, startedAt);
    } catch (err) {
      metric.count("debug_stream_capture_error", { stage: "response" });
      log.warn("debug: llm_response capture failed", { error: errText(err) });
    }
    return result;
  };

  (wrapped as unknown as Record<symbol, unknown>)[WRAPPED] = true;
  agent.streamFn = wrapped as StreamCaptureOpts["agent"]["streamFn"];
}
