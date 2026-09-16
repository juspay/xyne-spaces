import { CONFIG } from "../../config.js";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";
import { errMsg } from "../../lib/errors.js";
import { getFile, upsertFile } from "../agentMemoryFiles.js";
import {
  ensureAgentIndexBank,
  hashContent,
  hashTag,
  listAllBankEntries,
  memory,
  readAgentTag,
  readKindTag,
  tagsFor,
} from "../agent-index/index.js";
import { extractCorpus } from "./extract.js";
import { redactCorpus } from "./redact.js";
import { renderUsageFile } from "./render.js";
import type {
  DistilledPattern,
  PatternKind,
  SkipReason,
  SynthesisOutcome,
  UsageCorpus,
  UsagePattern,
  UsagePatternFile,
  UsageSample,
  UsageWindow,
} from "./types.js";

/**
 * Synthesis stage: corpus → redaction → distiller → thresholds → storage.
 *
 * The model is the only part of this that can be wrong in an interesting way,
 * so it is given the least authority: it names the shapes, and everything that
 * decides whether a shape is written down happens after it returns, against
 * counts taken from the corpus rather than from its answer.
 */

const log = createLogger("usage-patterns");

export const FILE_NAME = "usage-patterns.md";
export const UPDATED_BY = "synthesizer";
/** A human edit is permanent protection — the synthesizer never clobbers it. */
const HUMAN = "user";

/**
 * A mistyped threshold must not silently disable the gate it names. `Number("")`
 * and `Number("three")` are 0 and NaN, and every comparison against NaN is
 * false — which would publish every pattern the model proposes into a shared,
 * org-visible file. Fall back to the default instead.
 */
function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = Number(raw);
  if (raw !== undefined && !(Number.isFinite(n) && n > 0)) {
    log.warn(`[usage-patterns] ${name}="${raw}" is not a positive number; using ${fallback}`);
    return fallback;
  }
  return raw === undefined ? fallback : n;
}

/** A pattern behind fewer runs than this is an incident, not a pattern. */
const MIN_RUNS = positiveInt("USAGE_PATTERNS_MIN_RUNS", 3);
/** …and behind one person it is that person's habit, not the agent's use. */
const MIN_DISTINCT_USERS = positiveInt("USAGE_PATTERNS_MIN_DISTINCT_USERS", 2);

const CLAW_URL = CONFIG.xyneClawUrl.replace(/\/+$/, "");
const TIMEOUT_MS = positiveInt("USAGE_PATTERNS_TIMEOUT_MS", 90_000);
/** The curator route on claw. Overridable so the two services can be rolled
 *  independently if the path ever moves. */
const DISTILL_PATH = process.env["USAGE_PATTERNS_DISTILL_PATH"] ?? "/internal/usage-pattern-curator/distill";

const PATTERN_KINDS: readonly PatternKind[] = ["demand", "gap"];
const MIN_SUMMARY_CHARS = 12;
const MAX_PATTERNS = 12;

/**
 * Counts are recomputed from our own corpus rather than read from the response.
 *
 * When the distiller cites run refs, the arithmetic is entirely ours: unknown
 * refs are dropped first, so a pattern invented out of nothing collapses to zero
 * runs and fails the threshold by construction. When it does not cite — the
 * curator on claw emits a share and a user count instead — its figures are
 * clamped to what the corpus can support before they are believed, so a
 * confident overstatement cannot buy a pattern past the threshold.
 *
 * A "does not deliver" claim is held to the stricter test: the runs behind it
 * must actually contain failures. That section is the reason the file is a
 * routing artifact rather than a brochure, and an unevidenced entry in it would
 * steer work away from an agent that handles the shape perfectly well.
 */
export function enforceThresholds(
  distilled: DistilledPattern[],
  corpus: UsageCorpus,
  limits: { minRuns: number; minUsers: number } = { minRuns: MIN_RUNS, minUsers: MIN_DISTINCT_USERS },
): UsagePattern[] {
  const bySample = new Map(corpus.samples.map((s) => [s.ref, s]));

  const patterns: UsagePattern[] = [];
  for (const pattern of distilled) {
    const cited = [...new Set(pattern.refs)].filter((ref) => bySample.has(ref));
    const counted = cited.length > 0 ? fromRefs(cited, bySample, corpus) : fromClaims(pattern, corpus);
    if (counted.runs < limits.minRuns || counted.users < limits.minUsers) continue;
    if (pattern.kind === "gap" && !hasFailureEvidence(counted.failureRate, corpus, limits.minRuns)) continue;

    patterns.push({
      kind: pattern.kind,
      summary: pattern.summary.trim(),
      refs: cited,
      ...counted,
    });
  }
  return patterns.sort((a, b) => b.runs - a.runs);
}

function isFailure(sample: UsageSample): boolean {
  return sample.status === "failed" || sample.status === "cancelled" || sample.rating === "down";
}

/** Cited patterns are checked against their own runs; uncited ones against the
 *  window, which is the most we can verify without knowing which runs they mean. */
function hasFailureEvidence(failureRate: number | null, corpus: UsageCorpus, minRuns: number): boolean {
  if (failureRate !== null) return failureRate > 0;
  return corpus.samples.filter(isFailure).length >= minRuns;
}

function fromRefs(
  cited: string[],
  bySample: Map<string, UsageSample>,
  corpus: UsageCorpus,
): { runs: number; users: number; share: number; failureRate: number | null } {
  const samples = cited.map((ref) => bySample.get(ref)!);
  const failed = samples.filter(isFailure);
  return {
    runs: samples.length,
    users: new Set(samples.map((s) => s.userRef)).size,
    share: corpus.runCount > 0 ? samples.length / corpus.runCount : 0,
    failureRate: failed.length / samples.length,
  };
}

/** Every claimed figure is bounded by a corpus fact: a share cannot exceed 1,
 *  a run count cannot exceed the corpus, and a pattern cannot be backed by more
 *  people than the whole window had. */
function fromClaims(
  pattern: DistilledPattern,
  corpus: UsageCorpus,
): { runs: number; users: number; share: number; failureRate: number | null } {
  const share = Math.min(Math.max(pattern.claimedShare ?? 0, 0), 1);
  return {
    runs: Math.min(Math.round(share * corpus.runCount), corpus.runCount),
    users: Math.min(Math.max(pattern.claimedUsers ?? 0, 0), corpus.distinctUsers),
    share,
    failureRate: null,
  };
}

/**
 * Normalizes one entry of the distiller's response.
 *
 * Two shapes are accepted: `{kind, summary, refs}` — patterns that cite the runs
 * they rest on — and the curator's `{summary, runShare, distinctUsers, outcome}`.
 * Both land as a DistilledPattern; which one arrived decides only how the counts
 * are derived, never whether they are checked.
 */
function toDistilled(raw: unknown): DistilledPattern | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;

  const summary = typeof p["summary"] === "string" ? p["summary"].trim() : "";
  if (summary.length < MIN_SUMMARY_CHARS) return null;

  const refs = Array.isArray(p["refs"]) ? p["refs"].filter((r): r is string => typeof r === "string") : [];
  const kind = PATTERN_KINDS.includes(p["kind"] as PatternKind)
    ? (p["kind"] as PatternKind)
    : p["outcome"] === "fails"
      ? "gap"
      : "demand";

  return {
    kind,
    summary,
    refs,
    ...(typeof p["runShare"] === "number" ? { claimedShare: p["runShare"] } : {}),
    ...(typeof p["distinctUsers"] === "number" ? { claimedUsers: p["distinctUsers"] } : {}),
  };
}

/**
 * The distiller lives on claw because the LiteLLM call does. Returns null when
 * it could not be reached and [] when it was reached and proposed nothing —
 * those are different outcomes: the first leaves yesterday's file in place, the
 * second is a real statement that nothing recurs.
 *
 * `userRef` is stripped here: distinct-user thresholds are enforced on this
 * side, so the model has no use for identity at all, not even hashed. The
 * returned `markdown` is ignored on purpose — the file is rendered from numbers
 * this side computed, not from numbers the model wrote into prose.
 */
async function distill(corpus: UsageCorpus, agentDescription: string | null): Promise<DistilledPattern[] | null> {
  const payload = {
    agentSlug: corpus.slug,
    ...(agentDescription ? { agentDescription } : {}),
    windowStart: corpus.window.start,
    windowEnd: corpus.window.end,
    runCount: corpus.runCount,
    distinctUsers: corpus.distinctUsers,
    toolFrequency: corpus.toolUsage.map((t) => ({ tool: t.tool, count: t.runs })),
    samples: corpus.samples.map((s) => ({
      ref: s.ref,
      task: s.task,
      status: s.status,
      rating: s.rating,
      toolsUsed: s.toolsUsed,
      totalMs: s.totalMs,
      delegated: s.delegated,
    })),
  };

  try {
    const res = await fetch(`${CLAW_URL}${DISTILL_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": CONFIG.xyneClawS2sKey ?? "" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn(`[usage-patterns] claw responded ${res.status} for ${corpus.slug}`);
      return null;
    }
    const json = (await res.json()) as { ok?: unknown; patterns?: unknown };
    // The curator answers 200 with an empty result both when it ran and found
    // nothing and when LiteLLM refused it, so `ok` is the only thing separating
    // "nothing recurs here" from "we never asked". Without it a 403 on the
    // automation key would publish as a finding about the agent.
    if (json.ok === false) {
      log.warn(`[usage-patterns] curator could not distill ${corpus.slug}`);
      return null;
    }
    if (!Array.isArray(json.patterns)) return null;
    return json.patterns
      .map(toDistilled)
      .filter((p): p is DistilledPattern => p !== null)
      .slice(0, MAX_PATTERNS);
  } catch (err) {
    log.warn(`[usage-patterns] distill failed for ${corpus.slug}: ${errMsg(err)}`);
    return null;
  }
}

/**
 * Mirror the file into the agent index as `kind:usage`, so the orchestrator can
 * search what an agent is used for and not only what it claims to do.
 *
 * Retain appends, so the kind is swept first; the write waits for the index or
 * an immediate read-back would miss it.
 */
async function writeUsageBlob(
  orgId: string,
  slug: string,
  agentId: string,
  text: string,
  now: Date,
): Promise<void> {
  const bankId = await ensureAgentIndexBank(orgId);
  const provider = memory();

  const doomed = (await listAllBankEntries(bankId)).filter(
    (m) => readAgentTag(m.tags) === slug && readKindTag(m.tags) === "usage",
  );
  for (const m of doomed) {
    await provider.deleteMemory(bankId, m.id).catch((e) => log.warn(`[usage-patterns] sweep failed id=${m.id}: ${errMsg(e)}`));
  }

  const contentHash = hashContent(text);
  await provider.retain(
    bankId,
    [
      {
        content: text,
        tags: [...tagsFor(slug, "usage"), hashTag(contentHash)],
        // agentId matches what renderAgentBlobs writes, so a usage chunk winning
        // the rank still resolves to a delegation target rather than to null.
        metadata: { agentId, slug, orgId, kind: "usage", contentHash, synthesizedAt: now.toISOString() },
        timestamp: now.toISOString(),
      },
    ],
    { waitForIndex: true },
  );
}

function outcome(
  corpus: Pick<UsageCorpus, "slug" | "runCount" | "distinctUsers">,
  patternsWritten: number,
  chars: number,
  skipped?: SkipReason,
): SynthesisOutcome {
  return {
    slug: corpus.slug,
    runCount: corpus.runCount,
    distinctUsers: corpus.distinctUsers,
    patternsWritten,
    chars,
    ...(skipped ? { skipped } : {}),
  };
}

/**
 * Synthesize one agent's usage-pattern file for one window.
 *
 * Writes nothing rather than something thin: below the corpus thresholds, with
 * no surviving pattern, or against a human-edited file, it reports the skip and
 * leaves whatever is there alone. An empty or padded file would be read as
 * "this agent is not used for much", which is a routing claim we have not
 * earned.
 */
export async function synthesizeUsagePatterns(
  orgId: string,
  agentSlug: string,
  window: UsageWindow,
): Promise<SynthesisOutcome> {
  const corpus = await extractCorpus(orgId, agentSlug, window);

  if (corpus.runCount === 0) return outcome(corpus, 0, 0, "no-runs");
  if (corpus.runCount < MIN_RUNS || corpus.distinctUsers < MIN_DISTINCT_USERS) {
    return outcome(corpus, 0, 0, "insufficient-corpus");
  }

  // Checked before the LLM call, not after — a protected file makes the whole
  // pass pointless, and the tokens are not free.
  const existing = await getFile(agentSlug, { orgId }, FILE_NAME);
  if (existing?.updatedBy === HUMAN) {
    log.info(`[usage-patterns] ${agentSlug}: file is human-edited, skipping`);
    return outcome(corpus, 0, existing.content.length, "human-edited");
  }

  const agent = await prisma.agent.findFirst({
    where: { orgId, slug: agentSlug },
    select: { id: true, description: true },
  });
  const distilled = await distill(redactCorpus(corpus), agent?.description ?? null);
  if (distilled === null) return outcome(corpus, 0, 0, "distill-failed");

  const patterns = enforceThresholds(distilled, corpus);
  if (patterns.length === 0) {
    log.info(`[usage-patterns] ${agentSlug}: ${distilled.length} patterns proposed, none met the thresholds`);
    return outcome(corpus, 0, 0, "no-patterns");
  }

  const now = new Date();
  const text = renderUsageFile(corpus, patterns, now);

  await upsertFile({
    agentSlug,
    owner: { orgId },
    name: FILE_NAME,
    content: text,
    updatedBy: UPDATED_BY,
    loadInPrompt: false,
    sortOrder: 50,
  });

  if (agent) {
    await writeUsageBlob(orgId, agentSlug, agent.id, text, now).catch((e) =>
      log.warn(`[usage-patterns] index write failed for ${agentSlug}: ${errMsg(e)}`),
    );
  }

  log.info(`[usage-patterns] ${agentSlug}: wrote ${patterns.length} patterns, ${text.length} chars from ${corpus.runCount} runs`);
  return outcome(corpus, patterns.length, text.length);
}

/**
 * The stored file, org-scoped twice over.
 *
 * The agent lookup answers "does this org have such an agent at all", so an
 * unknown slug reads as absent rather than as an empty file; the read itself is
 * scoped by org, so a slug two tenants happen to share cannot cross over.
 */
export async function getUsagePatternFile(orgId: string, agentSlug: string): Promise<UsagePatternFile | null> {
  const agent = await prisma.agent.findFirst({ where: { orgId, slug: agentSlug }, select: { id: true } });
  if (!agent) return null;

  const file = await getFile(agentSlug, { orgId }, FILE_NAME);
  if (!file) return null;

  return {
    slug: agentSlug,
    name: file.name,
    content: file.content,
    chars: file.content.length,
    updatedBy: file.updatedBy,
    updatedAt: file.updatedAt,
    humanEdited: file.updatedBy === HUMAN,
  };
}

/**
 * Replace the file by hand, marking it human-written.
 *
 * That mark is permanent by design: `synthesizeUsagePatterns` skips a file whose
 * `updatedBy` is HUMAN, so a correction is never silently undone by the next
 * scheduled pass. The index copy is refreshed alongside it, or the orchestrator
 * would keep searching the superseded text.
 */
export async function writeUsagePatternFile(
  orgId: string,
  agentSlug: string,
  content: string,
): Promise<UsagePatternFile | null> {
  const agent = await prisma.agent.findFirst({ where: { orgId, slug: agentSlug }, select: { id: true } });
  if (!agent) return null;

  await upsertFile({ agentSlug, owner: { orgId }, name: FILE_NAME, content, updatedBy: HUMAN });
  await writeUsageBlob(orgId, agentSlug, agent.id, content, new Date()).catch((e) =>
    log.warn(`[usage-patterns] ${agentSlug}: index refresh after manual edit failed: ${errMsg(e)}`),
  );

  return getUsagePatternFile(orgId, agentSlug);
}

/** Request-path wrapper: a synthesis pass must never fail the caller. */
export function synthesizeUsagePatternsBestEffort(orgId: string, agentSlug: string, window: UsageWindow): void {
  void synthesizeUsagePatterns(orgId, agentSlug, window).catch((e) =>
    log.warn(`[usage-patterns] synthesis failed for ${agentSlug}: ${errMsg(e)}`),
  );
}
