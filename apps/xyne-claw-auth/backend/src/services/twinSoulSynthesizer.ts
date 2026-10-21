/**
 * Digital Twin soul synthesizer (Memory v2, Phase 4) — claw-auth side.
 *
 * Compiles the twin's file-based persona (soul.md, people.md, …) from the
 * user's APPROVED facts. claw-auth owns the facts (Hindsight) + the file store;
 * claw runs the LLM (LLM-on-claw invariant), so this pulls the approved facts,
 * groups them by subsystem, and calls POST /internal/user-memory/synthesize-file
 * once per file. Never overwrites a file the user hand-edited (preserveEdits).
 *
 * Triggered: nightly (digitalTwinDailyCron) + on demand (POST /digital-twin/synthesize).
 */

import type { MemoryUpdateCheck, SynthesizeFileRequest, SynthesizeFileTrace } from "xyne-claw-shared";
import { errMsg } from "../lib/errors.js";
import { CONFIG } from "../config.js";
import { createLogger, createTraceId } from "../logger.js";
import {
  TWIN_AGENT_SLUG,
  MAX_FILE_CHARS,
  DEFAULT_TWIN_FILES,
  getFile,
  upsertFile,
} from "./agentMemoryFiles.js";
import {
  startSynthesisEvent,
  finishSynthesisEvent,
  type SynthFileResult,
} from "./digitalTwinPipelineEvents.js";
import { listUserTwinMemories, subsystemOfTags } from "./twinMemoryBank.js";

const logger = createLogger("twin-soul-synthesizer", createTraceId());

const SYNTH_TIMEOUT_MS = Number(process.env["TWIN_SYNTH_CLIENT_TIMEOUT_MS"] ?? 130_000);
const MAX_FACTS_PER_USER = 500;

/** Approved facts for this user, grouped by subsystem. */
async function fetchApprovedFactsBySubsystem(userId: string): Promise<Map<string, string[]>> {
  const bySub = new Map<string, string[]>();
  try {
    for (const m of await listUserTwinMemories(userId, MAX_FACTS_PER_USER)) {
      const sub = subsystemOfTags(m.tags);
      if (!sub) continue;
      const text = (m.content ?? "").trim();
      if (!text) continue;
      const arr = bySub.get(sub) ?? [];
      arr.push(text);
      bySub.set(sub, arr);
    }
  } catch (err) {
    logger.warn("[soul-synth] fetch approved facts failed", {
      userId,
      err: errMsg(err),
    });
  }
  return bySub;
}

async function synthesizeViaClaw(
  req: SynthesizeFileRequest,
): Promise<{ content: string | null; error?: string; trace?: SynthesizeFileTrace; check?: MemoryUpdateCheck }> {
  if (!CONFIG.xyneClawS2sKey) return { content: null, error: "no-s2s-key" };
  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/internal/user-memory/synthesize-file`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": CONFIG.xyneClawS2sKey },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(SYNTH_TIMEOUT_MS),
    });
    if (!res.ok) return { content: null, error: `http-${res.status}` };
    const data = (await res.json()) as { content?: string | null; error?: string; trace?: SynthesizeFileTrace; check?: MemoryUpdateCheck };
    return {
      content: data.content ?? null,
      ...(data.error ? { error: data.error } : {}),
      ...(data.trace ? { trace: data.trace } : {}),
      ...(data.check ? { check: data.check } : {}),
    };
  } catch (err) {
    return { content: null, error: errMsg(err) };
  }
}

/**
 * Regenerate the twin's persona files for one user from their approved facts.
 * Idempotent. Skips files with no facts and files the user hand-edited (the
 * claw side preserves those). Returns which files changed.
 */
export async function synthesizeSoulFilesForUser(
  userId: string,
  trigger: "daily" | "manual" = "manual",
): Promise<{ updated: string[]; skipped: string[] }> {
  const startedAt = Date.now();
  // Record a "running" event up-front so the activity panel shows the run
  // immediately and it survives a reload (item: synthesizer is no longer a
  // black box).
  const eventId = await startSynthesisEvent(userId, trigger);

  const factsBySub = await fetchApprovedFactsBySubsystem(userId);
  const updated: string[] = [];
  const skipped: string[] = [];
  const fileResults: SynthFileResult[] = [];
  const skip = (result: SynthFileResult) => {
    skipped.push(result.name);
    fileResults.push(result);
  };

  for (const spec of DEFAULT_TWIN_FILES) {
    const facts = spec.subsystems.flatMap((s) => factsBySub.get(s) ?? []);
    if (facts.length === 0) {
      skip({ name: spec.name, factsUsed: 0, action: "skipped" });
      continue;
    }
    const current = await getFile(TWIN_AGENT_SLUG, userId, spec.name);
    const userEdited = current?.updatedBy === "user";
    const { content, error, trace, check } = await synthesizeViaClaw({
      fileName: spec.name,
      description: spec.description,
      facts,
      maxChars: MAX_FILE_CHARS,
      ...(current?.content ? { currentContent: current.content } : {}),
      ...(userEdited ? { preserveEdits: true } : {}),
      // Only the nightly run is scored; manual re-synthesis writes as before.
      ...(trigger === "daily" ? { check: true } : {}),
    });
    const base = { name: spec.name, ...(trace ?? {}), factsUsed: trace?.factsUsed ?? facts.length };
    if (!content) {
      skip({ ...base, action: error ? "error" : "skipped", ...(error ? { error } : {}) });
      if (error) logger.info("[soul-synth] file skipped", { userId, file: spec.name, error });
      continue;
    }
    // R10: only an explicit "reject" holds the rewrite back (old file kept).
    // "review" still writes — holding on "unsure" would freeze a file forever,
    // since the same synthesis reruns every night.
    if (check && check.verdict === "reject") {
      skip({ ...base, action: "held", chars: content.length, check });
      logger.info("[soul-synth] rewrite held by update check — old file kept", {
        userId,
        file: spec.name,
        verdict: check.verdict,
        keepsOld: check.keepsOld,
        supported: check.supported,
      });
      continue;
    }
    // upsert only changes content + updatedBy on an existing file, so the user's
    // loadInPrompt toggle + order are preserved. loadInPrompt/sortOrder here only
    // apply if the file didn't exist yet.
    await upsertFile({
      agentSlug: TWIN_AGENT_SLUG,
      owner: userId,
      name: spec.name,
      content,
      updatedBy: "synthesizer",
      loadInPrompt: spec.loadInPrompt,
      sortOrder: spec.sortOrder,
    });
    updated.push(spec.name);
    fileResults.push({ ...base, action: "updated", chars: content.length, ...(check ? { check } : {}) });
  }

  if (eventId) {
    await finishSynthesisEvent(eventId, trigger, {
      files: fileResults,
      durationMs: Date.now() - startedAt,
    });
  }

  logger.info("[soul-synth] complete", { userId, updated, skipped });
  return { updated, skipped };
}
