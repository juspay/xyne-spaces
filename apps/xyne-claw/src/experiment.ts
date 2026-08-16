import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { SERVER } from "./config.js";

export interface ExperimentContext {
  id: string;
  epoch: number;
  deadlineAt: string;
  focus?: string;
  /** "review" = this run is the CHECKER verifying the last epoch's findings.
   *  It gets the review tool and read-only ledger access, and deliberately
   *  NOT end-experiment or the ledger write path — a checker must not be able
   *  to end the experiment or edit the work it is judging. */
  mode?: "review";
  /** "understanding" = a coverage-gated run: the exit condition is an EXHAUSTED
   *  code-path frontier (zero open conjectures) rather than an elapsed deadline.
   *  Each unexplored path is recorded as an open conjecture; closing every one of
   *  them (proved/refuted, with evidence) is the exit. The deadline still applies
   *  as a hard safety cap so the loop stays bounded. */
  kind?: "understanding";
}

/** Minimum closed paths before an "exhausted" frontier is believed. Guards the
 *  degenerate understanding run: record one conjecture, close it, exit. */
const MIN_CLOSED_PATHS = 5;

/** `path/to/file.ext:LINE` — the evidence shape an understanding close must
 *  carry. Mirrors hasResolvableCitation in claw-auth's experiments-internal.ts,
 *  which enforces the same rule server-side; this copy exists so the agent is
 *  told BEFORE the round trip, not after a silent downgrade. */
const CITATION_RE = /[\w./-]+\.[A-Za-z][\w]*:\d+/;

type FindingStatus = "conjecture" | "proved" | "refuted";

interface ExperimentEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface LedgerData {
  markdown: string;
  counts: { conjecture: number; proved: number; refuted: number };
  deadlineAt: string;
  epoch: number;
  /** Filenames delivered to the thread via sandbox-deliver-files. The
   *  understanding deliverable (a .html document) is enforced against this. */
  deliveredArtifacts?: string[];
}

const BASE_PATH = "/claw/api/v1/internal/experiments";

function experimentUrl(id: string, suffix: string): string {
  return `${SERVER.authServiceUrl.replace(/\/+$/, "")}${BASE_PATH}/${encodeURIComponent(id)}${suffix}`;
}

async function experimentFetch<T>(
  id: string,
  suffix: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(experimentUrl(id, suffix), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-s2s-key": SERVER.s2sKey,
      ...init?.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as ExperimentEnvelope<T>;
  if (!body.success || body.data === undefined) {
    throw new Error(body.error ?? `Experiment service error: ${res.status}`);
  }
  return body.data;
}

async function experimentPostNoData(
  id: string,
  suffix: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(experimentUrl(id, suffix), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-s2s-key": SERVER.s2sKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as ExperimentEnvelope<unknown>;
  if (!body.success) {
    throw new Error(body.error ?? `Experiment service error: ${res.status}`);
  }
}

async function readLedger(ctx: ExperimentContext): Promise<LedgerData> {
  return experimentFetch<LedgerData>(ctx.id, "/ledger", { method: "GET" });
}

function deadlineMs(ctx: ExperimentContext): number {
  const parsed = Date.parse(ctx.deadlineAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function humanDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

function timeInfo(
  ctx: ExperimentContext,
  startedAtMs: number,
): { elapsed: string; remaining: string; remainingMs: number; elapsedMs: number } {
  const now = Date.now();
  const deadline = deadlineMs(ctx);
  const durationMs = Math.max(0, deadline - now);
  const elapsedMs = Math.max(0, now - startedAtMs);
  return {
    elapsed: humanDuration(elapsedMs),
    remaining: humanDuration(durationMs),
    remainingMs: durationMs,
    elapsedMs,
  };
}

function textResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function asRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" ? params as Record<string, unknown> : {};
}

const REVIEW_VERDICTS = ["confirms", "contradicts", "stale", "duplicate", "unverifiable"] as const;

/** Tools for a CHECKER run: read the ledger, record a verdict per finding.
 *  No end-experiment and no ledger writes — see ExperimentContext.mode. */
export function buildExperimentReviewTools(ctx: ExperimentContext): ToolDefinition[] {
  return [
    {
      name: "experiment-ledger-read",
      label: "Experiment Ledger (read-only)",
      description: "Read the full experiment ledger, including findings from earlier epochs. Use it to spot duplicates.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        try {
          const ledger = await readLedger(ctx);
          return textResult(ledger.markdown, { counts: ledger.counts });
        } catch (err) {
          return textResult(
            `Ledger read failed: ${err instanceof Error ? err.message : String(err)}`,
            { error: true },
          );
        }
      },
    },
    {
      name: "experiment-review",
      label: "Experiment Review",
      description: [
        "Record your verdict on ONE finding. Call it once per finding you were given.",
        "Default to contradicts or unverifiable when unsure — confirming a wrong finding is more expensive than flagging a right one.",
        "Verdicts never change the finding's status; they are advisory and sit alongside it.",
      ].join(" "),
      parameters: Type.Object({
        findingId: Type.String({ description: "The findingId from the task list." }),
        verdict: Type.Unsafe<string>({
          type: "string",
          enum: [...REVIEW_VERDICTS],
          description: "confirms | contradicts | stale | duplicate | unverifiable",
        }),
        reason: Type.String({ description: "What you checked and what you found. Cite file:line." }),
        duplicateOf: Type.Optional(Type.String({ description: "Required when verdict=duplicate: the findingId it duplicates." })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const p = asRecord(params);
        const findingId = p["findingId"];
        const verdict = p["verdict"];
        const reason = p["reason"];
        if (typeof findingId !== "string" || typeof reason !== "string") {
          return textResult("Missing required findingId or reason.", { error: true });
        }
        if (typeof verdict !== "string" || !REVIEW_VERDICTS.includes(verdict as typeof REVIEW_VERDICTS[number])) {
          return textResult(`Invalid verdict. Use one of: ${REVIEW_VERDICTS.join(", ")}.`, { error: true });
        }
        if (verdict === "duplicate" && typeof p["duplicateOf"] !== "string") {
          return textResult("verdict=duplicate requires duplicateOf (the findingId it duplicates).", { error: true });
        }
        try {
          await experimentPostNoData(ctx.id, "/reviews", {
            findingId,
            epoch: ctx.epoch,
            verdict,
            reason,
            ...(typeof p["duplicateOf"] === "string" ? { duplicateOf: p["duplicateOf"] } : {}),
          });
          return textResult(`Verdict recorded: ${verdict}`);
        } catch (err) {
          return textResult(
            `Review failed: ${err instanceof Error ? err.message : String(err)}`,
            { error: true },
          );
        }
      },
    },
  ];
}

export function buildExperimentTools(
  ctx: ExperimentContext,
  abortRun?: () => void,
): ToolDefinition[] {
  if (ctx.mode === "review") return buildExperimentReviewTools(ctx);
  const startedAtMs = Date.now();
  return [
    {
      name: "experiment-clock",
      label: "Experiment Clock",
      description: "Check how much time remains in the experiment and ledger stats.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        const info = timeInfo(ctx, startedAtMs);
        try {
          const ledger = await readLedger(ctx);
          return textResult(
            [
              `Elapsed: ${info.elapsed}`,
              `Remaining: ${info.remaining}`,
              `Epoch: ${ctx.epoch}`,
              `Deadline: ${ctx.deadlineAt}`,
              `Ledger counts: conjecture=${ledger.counts.conjecture}, proved=${ledger.counts.proved}, refuted=${ledger.counts.refuted}`,
            ].join("\n"),
            { counts: ledger.counts, remainingMs: info.remainingMs, elapsedMs: info.elapsedMs },
          );
        } catch (err) {
          return textResult(
            [
              `Elapsed: ${info.elapsed}`,
              `Remaining: ${info.remaining}`,
              `Epoch: ${ctx.epoch}`,
              `Deadline: ${ctx.deadlineAt}`,
              `Ledger counts unavailable: ${err instanceof Error ? err.message : String(err)}`,
            ].join("\n"),
            { remainingMs: info.remainingMs, elapsedMs: info.elapsedMs, ledgerUnavailable: true },
          );
        }
      },
    },
    {
      name: "experiment-ledger",
      label: "Experiment Ledger",
      description: [
        "Read or update the experiment ledger. Record EVERY hypothesis when you start on it",
        "(action=hypothesis), then gather proof in the sandbox and record findings with",
        "proofArtifactPath. The same title updates the existing finding. For sandbox-note:",
        "Record your sandbox session id here the moment you create it, and REUSE that sandbox",
        "in later epochs instead of creating a new one; only create a fresh one if the old id no longer responds.",
        "ENFORCED: status=proved is REJECTED and downgraded to conjecture unless proofArtifactPath names a file you already sent with sandbox-deliver-files.",
        "A path that only exists inside the sandbox does not count — the sandbox is destroyed and the file is lost.",
        "So the order is always: create the proof file, deliver it, THEN record the finding with the delivered filename.",
      ].join(" "),
      // Deliberately FLAT schema — no discriminated union. A union (anyOf) at
      // the parameters root is valid JSON Schema but weaker function-calling
      // models (observed live: GLM) emit payloads that fail its validation, so
      // every ledger write bounced and the cross-epoch memory went dark. All
      // per-action requirements are enforced in execute() below instead.
      parameters: Type.Object({
        action: Type.Unsafe<string>({
          type: "string",
          enum: ["read", "record", "hypothesis", "sandbox-note"],
          description: "read = get the ledger; record = save a finding; hypothesis = declare what you're working on; sandbox-note = save sandbox reuse info.",
        }),
        status: Type.Optional(Type.Unsafe<string>({
          type: "string",
          enum: ["conjecture", "proved", "refuted"],
          description: "record only: the finding's state.",
        })),
        title: Type.Optional(Type.String({ description: "record only: short stable title (same title updates the finding)." })),
        hypothesis: Type.Optional(Type.String({ description: "record only: the hypothesis being tested." })),
        note: Type.Optional(Type.String({ description: "record: extra detail. sandbox-note: the note text." })),
        proofArtifactPath: Type.Optional(Type.String({ description: "record only: path to the repro/test/benchmark artifact." })),
        text: Type.Optional(Type.String({ description: "hypothesis only: what you are working on right now." })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const p = asRecord(params);
        try {
          if (p["action"] === "read") {
            const ledger = await readLedger(ctx);
            return textResult(ledger.markdown, { counts: ledger.counts });
          }
          if (p["action"] === "record") {
            const status = p["status"];
            const title = p["title"];
            const hypothesis = p["hypothesis"];
            if (
              status !== "conjecture" &&
              status !== "proved" &&
              status !== "refuted"
            ) return textResult("Invalid status. Use conjecture, proved, or refuted.", { error: true });
            if (typeof title !== "string" || typeof hypothesis !== "string") {
              return textResult("Missing required title or hypothesis.", { error: true });
            }
            // Understanding runs close a path by EXPLAINING it, and the failure
            // mode is a close that restates the identifier ("gateway_card_info
            // stores gateway card info"). A name-restatement cannot cite where
            // the behaviour lives, so requiring the citation shape up front is
            // what separates the two. claw-auth enforces the same rule; this
            // check just fails fast with an actionable message.
            if (ctx.kind === "understanding" && status === "proved") {
              const note = typeof p["note"] === "string" ? p["note"] : "";
              if (!CITATION_RE.test(note)) {
                return textResult(
                  "Cannot close this path: `note` needs at least one file:line citation (e.g. `src/foo/bar.ts:214`) showing where the behaviour actually lives, plus what the code does and why. A description that only restates the name does not close a path.",
                  { error: true, needsCitation: true },
                );
              }
            }
            const payload: {
              epoch: number;
              status: FindingStatus;
              title: string;
              hypothesis: string;
              note?: string;
              proofArtifactPath?: string;
            } = {
              epoch: ctx.epoch,
              status,
              title,
              hypothesis,
              ...(typeof p["note"] === "string" ? { note: p["note"] } : {}),
              ...(typeof p["proofArtifactPath"] === "string" ? { proofArtifactPath: p["proofArtifactPath"] } : {}),
            };
            const result = await experimentFetch<{ id: string; status?: string; warning?: string }>(ctx.id, "/findings", {
              method: "POST",
              body: JSON.stringify(payload),
            });
            // The server may DOWNGRADE a `proved` write to conjecture when the
            // proof was never delivered. Surface that verbatim — swallowing it
            // leaves the agent believing it banked a proof it did not.
            if (result.warning) {
              return textResult(`⚠️ ${result.warning}`, {
                id: result.id,
                status: result.status ?? "conjecture",
                downgraded: true,
              });
            }
            return textResult(
              `Finding recorded as ${result.status ?? status}: ${result.id}`,
              { id: result.id, status: result.status ?? status },
            );
          }
          if (p["action"] === "hypothesis") {
            if (typeof p["text"] !== "string") {
              return textResult("Missing required text.", { error: true });
            }
            await experimentPostNoData(ctx.id, "/hypothesis", {
              epoch: ctx.epoch,
              text: p["text"],
            });
            return textResult("Hypothesis recorded.");
          }
          if (p["action"] === "sandbox-note") {
            if (typeof p["note"] !== "string") {
              return textResult("Missing required note.", { error: true });
            }
            await experimentPostNoData(ctx.id, "/sandbox-note", { note: p["note"] });
            return textResult("Sandbox note recorded.");
          }
          return textResult("Invalid action. Use read, record, hypothesis, or sandbox-note.", { error: true });
        } catch (err) {
          return textResult(
            `Experiment ledger action failed: ${err instanceof Error ? err.message : String(err)}`,
            { error: true },
          );
        }
      },
    },
    {
      name: "end-experiment",
      label: "End Experiment",
      description: "Complete the run. For a time-boxed experiment this unlocks only AFTER the deadline; for an understanding run it unlocks only once the code-path frontier is exhausted (zero open conjectures, at least one path closed). Before ending, ensure every finding's artifact has been delivered to the thread.",
      parameters: Type.Object({
        report: Type.String(),
      }, { additionalProperties: false }),
      async execute(_toolCallId: string, params: unknown) {
        const p = asRecord(params);
        const report = typeof p["report"] === "string" ? p["report"] : "";
        const deadline = deadlineMs(ctx);
        const pastDeadline = Date.now() >= deadline;
        if (ctx.kind === "understanding") {
          // Coverage-gated exit: the run ends when the enumerated code-path
          // frontier is EXHAUSTED (open conjectures -> 0), not when the clock
          // runs out. The deadline is only a hard safety cap so the loop stays
          // bounded even if the frontier never fully closes.
          let open: number | undefined;
          let closed = 0;
          let deliveredArtifacts: string[] = [];
          let ledgerReadOk = false;
          try {
            const ledger = await readLedger(ctx);
            open = ledger.counts.conjecture;
            closed = ledger.counts.proved + ledger.counts.refuted;
            deliveredArtifacts = ledger.deliveredArtifacts ?? [];
            ledgerReadOk = true;
          } catch {
            // Ledger unreachable: we cannot prove exhaustion, so only the
            // deadline cap below can release the run.
          }
          // FLOOR. `open === 0 && closed > 0` alone is satisfiable by recording
          // one path and closing it — an exit in epoch 1 having explained a
          // single thing, which is weaker than the time-boxed loop it replaces.
          // The cheapest way to satisfy an exhaustion gate is to enumerate less,
          // so the gate has to require that enumeration happened at all.
          const frontierExhausted = open === 0 && closed >= MIN_CLOSED_PATHS;
          if (!pastDeadline && !frontierExhausted) {
            const openStr = open === undefined ? "unknown" : String(open);
            const why = open === 0 && closed < MIN_CLOSED_PATHS
              ? `Only ${closed} path(s) closed — an exhausted frontier means the scope was enumerated, not that one path was explained. Enumerate every reachable path in scope (at least ${MIN_CLOSED_PATHS}) before the frontier counts as empty.`
              : `Open paths: ${openStr}, closed: ${closed}. Enumerate every reachable path in scope as an open conjecture, then close each one with file:line evidence. Every new callee or branch you find is itself a new open path.`;
            return textResult(
              `❌ Cannot end: the code-path frontier is not exhausted (epoch ${ctx.epoch}). ${why} Exit unlocks only when open reaches 0. Your report was NOT accepted.`,
              { refused: true, open, closed },
            );
          }
          // DELIVERABLE GATE. The output of an understanding run is the HTML
          // document, not the ledger — an exhausted frontier means the work is
          // DONE, not DELIVERED. Enforce it against the real delivered-artifact
          // list so the run cannot end (even at the safety cap) until the doc
          // exists. Fail OPEN only when the ledger is unreachable: we cannot
          // strand a finished run on our own inability to check.
          const hasHtml = deliveredArtifacts.some((f) => f.toLowerCase().endsWith(".html"));
          if (ledgerReadOk && !hasHtml) {
            return textResult(
              `❌ Cannot end: the explanation document has not been delivered (epoch ${ctx.epoch}). Write ONE self-contained .html covering the scope you explained — grouped sections, inline-SVG diagrams (no <script>, no CDN), and a file:line citation for every claim — then send it with sandbox-deliver-files and end again. The frontier is closed; only the deliverable is missing. Your report was NOT accepted.`,
              { refused: true, reason: "missing-html-artifact" },
            );
          }
        } else if (!pastDeadline) {
          let open = "unknown";
          try {
            const ledger = await readLedger(ctx);
            open = String(ledger.counts.conjecture);
          } catch {
            // Keep the refusal path available even when the ledger is temporarily down.
          }
          return textResult(
            `❌ Cannot end: ${humanDuration(deadline - Date.now())} remain (epoch ${ctx.epoch}). Open conjectures: ${open}. Pick one and continue. Your report was NOT accepted.`,
            { refused: true },
          );
        }
        try {
          await experimentPostNoData(ctx.id, "/complete", { report });
          try {
            abortRun?.();
          } catch {
            // Never let abort wiring hide a successful completion.
          }
          return textResult("Experiment complete — report recorded.");
        } catch (err) {
          return textResult(
            `Experiment completion failed: ${err instanceof Error ? err.message : String(err)}`,
            { error: true },
          );
        }
      },
    },
  ];
}
