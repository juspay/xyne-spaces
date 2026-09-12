import type { ExperimentFinding, ExperimentReview, ExperimentRun } from "@prisma/client";
import { errMsg } from "./errors.js";
import { CONFIG } from "../config.js";
import { experimentRepository, agentRepository } from "../repositories/index.js";
import { setSession, type SessionContext } from "./session-context.js";
import { parseFrontierItems, normalizeFocus } from "./experiment-text.js";
import { registerRunRecovery } from "../queue/run-recovery-worker.js";
import { createTraceId, createLogger } from "../logger.js";
import { decryptStoredField, spacesAppFetch } from "../surfaces/spaces/client.js";

const log = createLogger("experiment");

const MAX_DURATION_MS = Number(
  process.env["EXPERIMENT_MAX_DURATION_MS"] ?? String(30 * 24 * 60 * 60 * 1000),
);
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

export type ExperimentCommand =
  | { sub: "start"; durationMs: number; focus?: string; provider?: string; model?: string; invalidProvider?: string; kind?: "understanding" | "framework" | "security" | "repo-history"; droppedFocus?: string }
  | { sub: "status" }
  | { sub: "stop" }
  | { sub: "findings"; id?: string }
  | { sub: "list" }
  | { sub: "unknown"; token: string };

/** Providers a /experiment run may pin (must stay a subset of the /internal/run
 *  proxy's OVERRIDABLE set — personal-cred providers still require the
 *  requester's own key, enforced by the proxy at dispatch time). */
export const EXPERIMENT_PROVIDERS = new Set(["spaces", "litellm", "claude", "codex", "copilot"]);

const LEADING_MENTIONS = /^(?:@[\w.\-]+(?:\s+[\w.\-]+)*\s*)+/;

export function parseExperimentCommand(text: string | undefined | null): ExperimentCommand | null {
  if (!text) return null;
  const trimmed = text.trim().replace(LEADING_MENTIONS, "");
  const lower = trimmed.toLowerCase();
  // /understanding is /experiment's coverage-gated sibling: identical epoch loop
  // and subcommands, but the run is tagged so end-experiment stays locked until
  // the open-conjecture frontier is exhausted (the epoch runtime keys off the
  // dispatch payload's `kind`). Everything below is shared parsing.
  const commandWord = lower.startsWith("/understanding")
    ? "/understanding"
    : lower.startsWith("/framework")
      ? "/framework"
      : lower.startsWith("/security-scan")
        ? "/security-scan"
        : lower.startsWith("/repo-history")
          ? "/repo-history"
          : lower.startsWith("/experiment")
            ? "/experiment"
            : null;
  if (!commandWord) return null;
  const kind =
    commandWord === "/understanding" ? ("understanding" as const) :
    commandWord === "/framework" ? ("framework" as const) :
    commandWord === "/security-scan" ? ("security" as const) :
    commandWord === "/repo-history" ? ("repo-history" as const) :
    undefined;
  const rest = trimmed.slice(commandWord.length).trim();
  if (!rest) return { sub: "start", durationMs: DEFAULT_DURATION_MS, ...(kind ? { kind } : {}) };
  const [first, ...tail] = rest.split(/\s+/);
  const firstLower = first?.toLowerCase() ?? "";
  if (firstLower === "status") return { sub: "status" };
  if (firstLower === "stop") return { sub: "stop" };
  if (firstLower === "findings") return { sub: "findings", ...(tail[0] ? { id: tail[0] } : {}) };
  if (firstLower === "list" || firstLower === "runs") return { sub: "list" };

  let durationMs = DEFAULT_DURATION_MS;
  let focusParts = rest.split(/\s+/);
  const durationMatch = /^(\d+)(m|h|d)$/i.exec(firstLower);
  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = durationMatch[2]!.toLowerCase();
    durationMs =
      unit === "d" ? amount * 24 * 60 * 60 * 1000
      : unit === "h" ? amount * 60 * 60 * 1000
      : amount * 60 * 1000;
    focusParts = tail;
  } else if (focusParts.length === 1 && !/^(?:focus|provider|model)=/i.test(firstLower)) {
    return { sub: "unknown", token: first! };
  }
  durationMs = Math.min(Math.max(durationMs, 1), MAX_DURATION_MS);
  const { focusParts: cleanedFocusParts, provider, model, invalidProvider } = extractProviderOverride(focusParts);
  const { focus, dropped: droppedFocus } = normalizeFocus(cleanedFocusParts.join(" "));
  const resolvedProvider = invalidProvider === undefined
    ? provider ?? (model ? "spaces" : undefined)
    : undefined;
  return {
    sub: "start",
    durationMs,
    ...(focus ? { focus } : {}),
    ...(resolvedProvider ? { provider: resolvedProvider } : {}),
    ...(model ? { model } : {}),
    ...(invalidProvider !== undefined ? { invalidProvider } : {}),
    ...(droppedFocus ? { droppedFocus } : {}),
    ...(kind ? { kind } : {}),
  };
}

export async function cancelRunSession(sessionId: string, userId: string): Promise<void> {
  const cancelRes = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run/${encodeURIComponent(sessionId)}/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      "x-user-id": userId,
    },
  });
  if (!cancelRes.ok) {
    const body = (await cancelRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Cancel failed: HTTP ${cancelRes.status}`);
  }
}

function extractProviderOverride(parts: string[]): {
  focusParts: string[];
  provider?: string;
  model?: string;
  invalidProvider?: string;
} {
  let provider: string | undefined;
  let model: string | undefined;
  let invalidProvider: string | undefined;
  const focusParts: string[] = [];

  for (const part of parts) {
    const match = /^([^=]+)=(.*)$/.exec(part);
    const key = match?.[1]?.toLowerCase();
    if (key === "provider") {
      const rawProvider = match?.[2] ?? "";
      const normalizedProvider = rawProvider.toLowerCase();
      if (EXPERIMENT_PROVIDERS.has(normalizedProvider)) {
        provider = normalizedProvider;
      } else {
        invalidProvider = rawProvider;
      }
      continue;
    }
    if (key === "model") {
      const rawModel = match?.[2] ?? "";
      if (rawModel) model = rawModel;
      continue;
    }
    focusParts.push(part);
  }

  return {
    focusParts,
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(invalidProvider !== undefined ? { invalidProvider } : {}),
  };
}

function formatRemaining(deadlineAt: Date): string {
  const ms = Math.max(0, deadlineAt.getTime() - Date.now());
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 48) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

export function buildLedgerMarkdown(
  run: ExperimentRun,
  findings: ExperimentFinding[],
  reviews: ExperimentReview[] = [],
): string {
  // Latest verdict per finding. Surfaced inline so the next epoch reads the
  // checker's objection at the point it would otherwise build on the finding.
  const verdictByFinding = new Map<string, ExperimentReview>();
  for (const review of reviews) verdictByFinding.set(review.findingId, review);
  const groups = {
    conjecture: findings.filter((f) => f.status === "conjecture"),
    proved: findings.filter((f) => f.status === "proved"),
    refuted: findings.filter((f) => f.status === "refuted"),
  };
  const lines = [
    `# /experiment ledger`,
    ``,
    `- Epoch: ${run.epoch}`,
    `- Deadline: ${run.deadlineAt.toISOString()}`,
    `- Remaining: ${formatRemaining(run.deadlineAt)}`,
    `- Focus: ${run.focus?.trim() || "(none)"}`,
    ``,
  ];
  // Cap what each group renders: this markdown is injected into EVERY later
  // epoch's task, so unbounded growth compounds over an 8h run. Newest entries
  // win (they carry the freshest context); older ones stay in the DB and the
  // status/report paths, just not in the per-epoch prompt.
  const MAX_PER_GROUP = 20;
  const appendGroup = (heading: string, rows: ExperimentFinding[]) => {
    lines.push(`## ${heading}`);
    if (rows.length === 0) {
      lines.push(`- (none)`, ``);
      return;
    }
    const shown = rows.slice(-MAX_PER_GROUP);
    if (rows.length > shown.length) {
      lines.push(`- (… ${rows.length - shown.length} older entr${rows.length - shown.length === 1 ? "y" : "ies"} omitted — full ledger is in the database)`);
    }
    for (const f of shown) {
      lines.push(`- [epoch ${f.epoch}] ${f.title}`);
      lines.push(`  Hypothesis: ${f.hypothesis}`);
      if (f.note?.trim()) lines.push(`  Note: ${f.note.trim()}`);
      if (f.proofArtifactPath?.trim()) lines.push(`  Proof: ${f.proofArtifactPath.trim()}`);
      const verdict = verdictByFinding.get(f.id);
      if (verdict && verdict.verdict !== "confirms") {
        lines.push(`  ⚠️ CHECKER (epoch ${verdict.epoch}) says ${verdict.verdict.toUpperCase()}: ${verdict.reason}`);
      }
    }
    lines.push(``);
  };
  appendGroup("Open conjectures", groups.conjecture);
  appendGroup("Proved", groups.proved);
  appendGroup("Refuted", groups.refuted);
  if (run.finalReport?.trim()) {
    lines.push(`## Final report`, ``, run.finalReport.trim(), ``);
  }
  return lines.join("\n").trimEnd();
}

function countsByStatus(findings: ExperimentFinding[]): { conjecture: number; proved: number; refuted: number } {
  return {
    conjecture: findings.filter((f) => f.status === "conjecture").length,
    proved: findings.filter((f) => f.status === "proved").length,
    refuted: findings.filter((f) => f.status === "refuted").length,
  };
}

export function buildFindingsMarkdown(
  run: ExperimentRun,
  findings: ExperimentFinding[],
  reviews: ExperimentReview[] = [],
): string {
  const counts = countsByStatus(findings);
  // The checker's verdict travels WITH the finding into triage. A finding a
  // second agent contradicted must never reach a human looking identical to
  // one it confirmed.
  const verdictByFinding = new Map<string, ExperimentReview>();
  for (const review of reviews) verdictByFinding.set(review.findingId, review);
  const model = run.provider?.trim()
    ? `${run.provider.trim()}${run.modelId?.trim() ? `/${run.modelId.trim()}` : " (default)"}`
    : "(agent default)";
  const appendGroup = (lines: string[], heading: string, rows: ExperimentFinding[]) => {
    lines.push(`## ${heading}`);
    if (rows.length === 0) {
      lines.push(``, `(none)`, ``);
      return;
    }
    for (const f of rows) {
      lines.push(``, `### ${f.title}`, ``);
      lines.push(`- Epoch: ${f.epoch}`);
      lines.push(`- Hypothesis: ${f.hypothesis}`);
      lines.push(`- Note: ${f.note?.trim() || "(none)"}`);
      lines.push(`- Proof artifact path: ${f.proofArtifactPath?.trim() || "(none)"}`);
      const verdict = verdictByFinding.get(f.id);
      lines.push(verdict
        ? `- Checker verdict: **${verdict.verdict}** (epoch ${verdict.epoch}) — ${verdict.reason}${verdict.duplicateOf ? ` [duplicate of ${verdict.duplicateOf}]` : ""}`
        : `- Checker verdict: (not reviewed)`);
    }
    lines.push(``);
  };

  const lines = [
    `# /experiment findings for ${run.agentSlug} - ${run.createdAt.toISOString().slice(0, 10)}`,
    ``,
    `- Experiment id: ${run.id}`,
    `- Agent: ${run.agentSlug}`,
    `- Model: ${model}`,
    `- Focus: ${run.focus?.trim() || "(none)"}`,
    `- Duration: ${run.createdAt.toISOString()} -> ${run.deadlineAt.toISOString()} (${formatDuration(run.deadlineAt.getTime() - run.createdAt.getTime())})`,
    `- Status: ${run.status}`,
    `- Epochs completed: ${Math.max(0, run.epoch - (run.status === "running" ? 1 : 0))}`,
    `- Counts by status: ${counts.proved} proved, ${counts.conjecture} conjecture, ${counts.refuted} refuted`,
    ``,
  ];
  appendGroup(lines, "Confirmed / Proved", findings.filter((f) => f.status === "proved"));
  appendGroup(lines, "Open conjectures", findings.filter((f) => f.status === "conjecture"));
  appendGroup(lines, "Refuted", findings.filter((f) => f.status === "refuted"));
  if (run.finalReport?.trim()) {
    lines.push(`## Final report`, ``, run.finalReport.trim(), ``);
  }
  return lines.join("\n").trimEnd();
}

export async function postExperimentNotice(run: ExperimentRun): Promise<void> {
  if (!run.orgId) return;
  const agent = await agentRepository.findBySlug(run.agentSlug, run.orgId);
  if (!agent?.spacesAppToken || !agent.spacesAppUserId) return;
  const appToken = decryptStoredField(agent.spacesAppToken);
  const [findings, reviews] = await Promise.all([
    experimentRepository.listFindings(run.id),
    experimentRepository.listReviews(run.id),
  ]);
  await spacesAppFetch("/chat/postMessage", {
    channelId: run.channelId,
    conversationId: run.conversationId,
    markdownText: `**/experiment ended**\\n\\n${buildLedgerMarkdown(run, findings, reviews)}`,
    userId: agent.spacesAppUserId,
    metadata: { contentFormat: "markdown" },
  }, appToken);
}

export function buildEpochTask(run: ExperimentRun, ledgerMarkdown: string): string {
  const remaining = formatRemaining(run.deadlineAt);
  const sandboxId = /(?:^|\\s)sandboxId=([^\\s]+)/.exec(run.sandboxNote ?? "")?.[1];
  // The sandbox is ephemeral and WILL recycle across a multi-hour run, taking
  // every generated file with it. The one durable record of what already exists
  // is the delivered-artifact list — surface it so a fresh sandbox rehydrates
  // the right files by name instead of rebuilding blind (or, worse, emitting a
  // new fragment each epoch). Cap the echo so a long run's list can't crowd out
  // the ledger.
  const delivered = run.deliveredArtifacts ?? [];
  const deliveredLine = delivered.length > 0
    ? `ALREADY DELIVERED (recoverable from the thread with spaces-thread-attachments -> spaces-fetch-attachment, newest wins on a name clash): ${delivered.slice(-40).join(", ")}. Do NOT rebuild one of these from scratch — fetch it and extend it.`
    : "";
  const sandboxInstruction = sandboxId
    ? `YOUR SANDBOX: ${sandboxId}. This experiment has ONE machine. Reuse this sandbox for every command — do NOT create a new one. Only create a new sandbox if this one is provably unreachable, and if you do, immediately record the new id with experiment-ledger action=sandbox-note.`
    : "";
  const finalInstruction = run.status === "finishing"
    ? "\\n\\nDeadline reached - call end-experiment with your final report now. First deliver (sandbox-deliver-files) any proof artifact that has not yet been attached to this thread."
    : "";
  // EXIT RULE — must match what end-experiment actually enforces for this run's
  // kind. It did not: every epoch was told the time-boxed rule, so an
  // understanding run whose frontier had closed kept looping to the safety cap
  // instead of ending. The agent was obeying the prompt, not being refused —
  // observed live over 8 wasted epochs with 0 open conjectures and 60 closed.
  const exitInstruction = run.kind === "security"
    ? `EXIT: this run is TIME-BOXED — end-experiment refuses until the deadline. Attack surface cannot be exhausted the way a code-path frontier can: there is always one more endpoint, so "I have checked everything" would be a false claim of completeness. Use the whole window. When you run out of leads in one area, move to a different surface rather than restating findings you already closed, and keep the report current every epoch so a run that ends at the deadline still delivers everything it found.`
    : run.kind === "framework"
    ? `EXIT: this is a framework run — it ends when the candidate list is EXHAUSTED, not on the clock. Enumerate the STRUCTURAL candidates in scope as open conjectures (convention drift, missing paved paths, change-amplification, boilerplate, duplication — not just copy-paste), then close each (proved = a real, tagged opportunity with evidence and a named consequence; refuted = it is incidental or taste). When ZERO remain open and the markdown report is delivered, call end-experiment. Do NOT keep looping to the safety cap re-describing opportunities you already closed.`
    : run.kind === "understanding"
    ? `EXIT: this is an understanding run — it ends when the code-path frontier is EXHAUSTED, not on the clock. The moment the ledger shows ZERO open conjectures (with the scope genuinely enumerated and the .html delivered), call end-experiment with your final report. Do NOT keep looping to the safety cap: re-verifying already-closed paths adds nothing. The deadline below is only a hard cap in case the frontier never closes.`
    : run.kind === "repo-history"
    ? `EXIT: this is a repo-history run — it is PROGRESS-gated: it ends when the commit walk reaches HEAD, not on the clock. The frontier is the commits from the initial sha to HEAD, walked OLDEST→NEWEST in batches. Each epoch advances the cursor forward and records the coding DECISIONS each batch establishes. You are done only when the newest batch you distilled ends at HEAD (record HEAD's sha in the ledger) AND the .html decision-log is delivered — then call end-experiment. Do NOT stop early with commits still ahead of the cursor, and do NOT loop re-reading batches already behind it. This run is COMMIT-bound, NOT time-bound: it keeps chaining epochs until the walk reaches HEAD, so the deadline shown below does NOT end it — only reaching HEAD does. Every commit must be checked.`
    : `You cannot end before the deadline - end-experiment will refuse until the deadline has been reached.`;
  return [
    `You are in /experiment mode, epoch ${run.epoch}.`,
    sandboxInstruction,
    `Deadline: ${run.deadlineAt.toISOString()} (${remaining} remaining).`,
    ``,
    // A framework run hunts DUPLICATION, not defects, so the generic
    // "gather PROOF" line is the wrong instruction — the evidence here is a
    // count and a file list, not a failing test. The failure mode is a taste
    // claim ("this could be abstracted") with nothing behind it, so the rule is
    // that an opportunity without occurrences is not an opportunity.
    // A security run's failure mode is measured, not hypothetical: the first
    // three live runs produced 67 "proved" findings of which 8 survived
    // testing, because a script asserting that a vulnerable PATTERN exists in
    // source was being recorded as proof. So this prompt separates the two
    // tiers explicitly and the ledger refuses `proved` without an observation.
    run.kind === "security"
      ? `Read the ledger below before doing anything. You are hunting exploitable defects, and there are TWO tiers — keep them apart or the report is worthless.\n\nLEAD (status=conjecture): you read the code and the defect looks real. Cite file:line. This is where most findings belong.\nCONFIRMED (status=proved): you EXECUTED it and captured what came back — the request you sent, the status code or output you observed, and where you verified the effect (a row that changed, a document returned, a measured timing). A script that greps source and asserts a pattern is present is NOT a confirmation; it proves the code says what you already read.\n\nBefore proposing a fix, check whether a CORRECT implementation already exists nearby — the same call done safely elsewhere in the repo. Across earlier runs that was the single most common shape: the safe sibling existed and was simply not used. Name it, because it is also the cheapest fix.\n\nDEFENDED is a first-class result. If you try it and a guard stops you, close it as refuted with what stopped you. A finding you cannot execute stays a conjecture — never promote it because it looks obvious.\n\nDeliver ONE markdown report with a STABLE filename, extended each epoch, with the two tiers in separate sections and the exact reproduction for every CONFIRMED entry.`
      : run.kind === "framework"
      ? `Read the ledger below before doing anything. You are looking for FRAMEWORK OPPORTUNITIES: STRUCTURAL gaps that make this codebase harder to extend safely than it should be — convention drift (one concept done several inconsistent ways), missing paved paths (a common need solved ad-hoc everywhere), change-amplification (adding one feature touches N files for lack of a seam), boilerplate, and plain duplication. Duplication is only one shape — do NOT reduce this to finding copy-paste. Pick or advance ONE candidate per epoch.\n\nTAG every opportunity with your OWN word for its shape (kebab-case), reusing a tag already in the ledger if it fits. A candidate is only proved when its note carries: a \\`Tag:\\` line; at least one \\`file.ext:LINE\\` where the gap lives; and a \\`Prevents:\\` line naming the concrete bug, drift, or change-amplification the framework would have stopped. The ledger enforces all three. The \\`Prevents:\\` line is the real bar — if you cannot name what it prevents, it is taste; refute it. A VARYING pattern (five different auth checks) is a valid convention-drift opportunity even though the code is not identical — do not refute it for that.\n\nRefuting is real progress: a wrong extraction is more expensive than the duplication it replaces.\n\nDeliver ONE markdown report, GROUPED BY TAG: each opportunity with its file:line evidence, the proposed abstraction, its Prevents, and the migration cost. The report MUST also include a Tag Index table summarizing every tag used: tag name, finding count, affected areas, proposed paved path/framework abstraction, and migration cost. Extend the same file each epoch rather than starting a new one.`
      : run.kind === "repo-history"
      ? `Read the ledger below before doing anything. You are reconstructing the coding SPEC of this repo — the rules and decisions someone would need to rebuild it — by walking git history OLDEST→NEWEST.\n\nCURSOR: the ledger records how far you have walked. Establish the frontier with \\`git log <initial-sha>..HEAD --reverse --oneline\\` (oldest first). Each epoch, take the NEXT BATCH of commits after the cursor (a sensible chunk — ~20-50 ordinary commits, or a SINGLE squash/merge commit on its own since it is one decision), read their diffs, and advance the cursor. A squash-merge is one big diff with no granular commits — pull the PR discussion for its WHY rather than parsing the whole diff blind.\n\nEXTRACT DECISIONS, NOT DIFFS. For each batch record the coding RULE it establishes (the convention, invariant, or "always/never do X"), not a changelog of what changed. TAG each by theme (kebab-case: error-handling, provider-fallback, security, naming, …), reusing an existing tag when it fits. An entry is only proved when its note carries: a \\`Rule:\\` line (the durable instruction); the \\`sha\\` it derives from; and its theme \\`Tag:\\`.\n\nRECONCILE AGAINST HEAD — this is the correctness bar. History is full of dead ends: a rule set at an early commit is often REVERSED or REWRITTEN later (a "fix" commit, not always a revert). When a later batch overturns a rule already in the ledger, AMEND the existing entry — do not append a second contradictory one. Superseded rules move to a GRAVEYARD section with a \\`Supersedes:\\`/why-it-died line; only rules still live in the current code stay in Current Rules. The final doc must not contain a rule that HEAD contradicts.\n\nDeliver ONE self-contained .html decision-log (no network, no JavaScript — it must render offline) with a STABLE filename, extended every epoch, three sections: CURRENT RULES (reconciled to HEAD, grouped by tag) / LINEAGE (which sha introduced/changed each) / GRAVEYARD (tried-and-abandoned, with why). Send it with sandbox-deliver-files.`
      : `Read the ledger below before doing anything. Do NOT re-test refuted hypotheses. Pick or advance ONE hypothesis. Use your sandbox tools to gather PROOF: a failing test, benchmark, profile, trace, log, or other concrete artifact. Record every conjecture/proof/refutation via the experiment-ledger tool.`,
    `PROOF DURABILITY: the sandbox is temporary. Any artifact that exists only inside the sandbox is LOST when it recycles. In the SAME epoch you create a proof artifact you MUST call sandbox-deliver-files to attach it to the thread, and record the DELIVERED filename in the ledger's proofArtifactPath. A finding whose proof was never delivered does not count as proved.`,
    `RECOVERY: previously delivered proof attachments can be restored instead of rebuilt: use spaces-thread-attachments to find them, then spaces-fetch-attachment to fetch them into a fresh workspace/sandbox.`,
    deliveredLine,
    exitInstruction,
    run.sandboxNote?.trim() ? `\\nSandbox note:\\n${run.sandboxNote.trim()}` : "",
    finalInstruction,
    ``,
    ledgerMarkdown,
  ].filter((part) => part !== "").join("\n");
}

/** Shared dispatch plumbing for both the epoch agent and the checker agent.
 *  `claimAsCurrent` is the important flag: only the epoch run may become the
 *  experiment's currentSessionId. A checker that claimed it would make
 *  continueExperimentAfterResult chain the next epoch off the CHECKER's
 *  completion, double-running the experiment. */
async function dispatchExperimentRun(
  run: ExperimentRun,
  opts: { task: string; mode?: "review"; claimAsCurrent: boolean; recover: boolean; silent?: boolean },
): Promise<{ sessionId: string }> {
  const traceId = createTraceId();
  const agent = run.orgId
    ? await agentRepository.findBySlug(run.agentSlug, run.orgId)
    : null;
  if (!agent) throw new Error(`Experiment dispatch missing agent ${run.agentSlug} org=${run.orgId ?? ""}`);
  if (!agent.spacesAppToken || !agent.spacesAppId || !agent.spacesAppUserId) {
    throw new Error(`Experiment dispatch agent ${run.agentSlug} missing Spaces app identity`);
  }
  const appToken = decryptStoredField(agent.spacesAppToken);

  const dispatchPayload = {
    userId: run.userId,
    task: opts.task,
    conversationId: run.conversationId,
    agentSlug: run.agentSlug,
    orgId: run.orgId ?? agent.orgId,
    eventType: "APP_MENTIONED",
    traceId,
    callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
    progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
    channelId: run.channelId,
    ...(run.provider
      ? { providerOverride: { provider: run.provider, ...(run.modelId ? { model: run.modelId } : {}) } }
      : {}),
    experiment: {
      id: run.id,
      epoch: run.epoch,
      deadlineAt: run.deadlineAt.toISOString(),
      ...(run.focus ? { focus: run.focus } : {}),
      ...(opts.mode ? { mode: opts.mode } : {}),
      // Understanding runs advertise their coverage-gated intent to the epoch
      // runtime, which keeps end-experiment locked until the frontier empties.
      ...(run.kind === "understanding" || run.kind === "framework" || run.kind === "security" || run.kind === "repo-history"
        ? { kind: run.kind as "understanding" | "framework" | "security" | "repo-history" }
        : {}),
    },
  };

  const res = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    body: JSON.stringify(dispatchPayload),
  });
  const body = await res.json() as { success?: boolean; sessionId?: string; error?: string };
  if (!res.ok || !body.success || !body.sessionId) {
    throw new Error(`Experiment dispatch failed: HTTP ${res.status} ${body.error ?? ""}`.trim());
  }

  const sessionContext: SessionContext = {
    mentionedUserId: agent.spacesAppUserId,
    targetUserId: run.userId,
    senderId: run.userId,
    senderName: run.userId,
    channelId: run.channelId,
    channelName: run.channelId,
    conversationId: run.conversationId,
    task: opts.task,
    agentId: agent.id,
    agentOrgId: run.orgId ?? agent.orgId,
    agentSlug: run.agentSlug,
    responseMode: "conversation",
    appToken,
    spacesAppId: agent.spacesAppId,
    spacesAppUserId: agent.spacesAppUserId,
    traceId,
    rootAgentSlug: run.agentSlug,
    // Suppresses the channel agent-chain on every epoch callback (see the field
    // doc). An experiment epoch is not a user turn to hand off.
    isExperiment: true,
    // Checker runs never speak in the thread — their verdicts live in the
    // ledger. Without this a checker finishing after the user's next message
    // reads as a reply to it.
    ...(opts.silent ? { suppressThreadReply: true } : {}),
  };
  await setSession(body.sessionId, sessionContext);
  if (opts.recover) {
    await registerRunRecovery({
      rootSessionId: body.sessionId,
      maxRetries: CONFIG.runRecoveryMaxRetries,
      timeoutMs: CONFIG.runRecoveryTimeoutMs,
      retryBackoffMs: CONFIG.runRecoveryBackoffMs,
      dispatchPayload,
      sessionContext,
    });
  }
  if (opts.claimAsCurrent) {
    await experimentRepository.update(run.id, {
      currentSessionId: body.sessionId,
      epoch: run.epoch,
    });
  }
  return { sessionId: body.sessionId };
}

export async function dispatchExperimentEpoch(run: ExperimentRun): Promise<{ sessionId: string }> {
  const [findings, reviews] = await Promise.all([
    experimentRepository.listFindings(run.id),
    experimentRepository.listReviews(run.id),
  ]);
  const task = buildEpochTask(run, buildLedgerMarkdown(run, findings, reviews));
  const result = await dispatchExperimentRun(run, { task, claimAsCurrent: true, recover: true });
  log.info(`[experiment] dispatched epoch=${run.epoch} id=${run.id} session=${result.sessionId}`);
  return result;
}

/** Second-agent pass over the findings the epoch that just ended recorded.
 *  Advisory: it writes verdicts, never statuses. Best-effort — a checker that
 *  fails must never block the next epoch. */
export async function dispatchExperimentChecker(run: ExperimentRun, epoch: number): Promise<void> {
  const findings = await experimentRepository.listFindingsByEpoch(run.id, epoch);
  if (findings.length === 0) return;
  const task = buildCheckerTask(run, epoch, findings);
  try {
    const result = await dispatchExperimentRun(run, {
      task,
      mode: "review",
      claimAsCurrent: false,
      recover: false,
      silent: true,
    });
    // Recorded so `/experiment stop` can cancel a checker that is still running.
    await experimentRepository.addCheckerSession(run.id, result.sessionId).catch(() => undefined);
    log.info(`[experiment] dispatched checker epoch=${epoch} id=${run.id} findings=${findings.length} session=${result.sessionId}`);
  } catch (err) {
    log.warn(`[experiment] checker dispatch failed id=${run.id} epoch=${epoch}: ${errMsg(err)}`);
  }
}

export function buildCheckerTask(run: ExperimentRun, epoch: number, findings: ExperimentFinding[]): string {
  const rows = findings.map((f) => [
    `- findingId: ${f.id}`,
    `  status: ${f.status}`,
    `  title: ${f.title}`,
    `  hypothesis: ${f.hypothesis}`,
    ...(f.note?.trim() ? [`  note: ${f.note.trim()}`] : []),
    `  proof: ${f.proofArtifactPath?.trim() || "(none)"}`,
  ].join("\n")).join("\n");

  return [
    `You are the CHECKER for an /experiment. You are NOT hunting for new findings — do not start one.`,
    ``,
    `Another agent just finished epoch ${epoch} and recorded the ${findings.length} finding(s) below. Your only job is to independently verify each one against the CURRENT code, then record a verdict with the experiment-review tool.`,
    ``,
    `For each finding:`,
    `1. Open the cited file and line in the repo. Read the real code, not the hypothesis text.`,
    `2. If a proof artifact was delivered to this thread, fetch it (spaces-thread-attachments then spaces-fetch-attachment) and check that it actually demonstrates the claim.`,
    `3. Compare against every OTHER finding in this experiment — if it restates one already recorded, that is a duplicate even when the wording differs completely.`,
    ``,
    `Verdicts:`,
    `- confirms      — the mechanism exists in current code and the proof supports it.`,
    `- contradicts   — the code does not do what the finding says, or the proof does not show it.`,
    `- stale         — it was true once but the current code already handles it (guard added, bug fixed).`,
    `- duplicate     — same defect as an earlier finding; set duplicateOf to that findingId.`,
    `- unverifiable  — cannot be settled from code plus the delivered artifact (needs a running system, external service, or timing measurement).`,
    ``,
    `Default to contradicts or unverifiable when you are unsure. Confirming a wrong finding is far more expensive than flagging a right one, because these become tickets a human then has to disprove.`,
    ``,
    `Reply with ONE short line when done: how many you checked and the verdict counts. Nothing else — the detail belongs in the verdicts.`,
    ``,
    `## Findings recorded in epoch ${epoch}`,
    rows,
  ].join("\n");
}

/**
 * Write one open conjecture per named item. Best-effort: a seeding failure must
 * not strand the run, it just falls back to model-driven enumeration.
 * Returns how many paths were seeded.
 */
export async function seedUnderstandingFrontier(
  runId: string,
  focus: string | null | undefined,
): Promise<number> {
  const items = parseFrontierItems(focus);
  if (items.length === 0) return 0;
  let seeded = 0;
  for (const item of items) {
    try {
      await experimentRepository.addFinding({
        experimentId: runId,
        epoch: 1,
        status: "conjecture",
        title: item,
        hypothesis: `Unexplained path: ${item}. Close it by explaining what it is, who writes it, who reads it, and what breaks if it is wrong — with file:line evidence.`,
      });
      seeded += 1;
    } catch {
      // A duplicate title or a transient write must not abort the seed.
    }
  }
  return seeded;
}
