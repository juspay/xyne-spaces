import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { SERVER } from "./config.js";

export interface ExperimentContext {
  id: string;
  epoch: number;
  deadlineAt: string;
  focus?: string;
}

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

export function buildExperimentTools(
  ctx: ExperimentContext,
  abortRun?: () => void,
): ToolDefinition[] {
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
      ].join(" "),
      parameters: Type.Union([
        Type.Object({ action: Type.Literal("read") }, { additionalProperties: false }),
        Type.Object({
          action: Type.Literal("record"),
          status: Type.Union([
            Type.Literal("conjecture"),
            Type.Literal("proved"),
            Type.Literal("refuted"),
          ]),
          title: Type.String(),
          hypothesis: Type.String(),
          note: Type.Optional(Type.String()),
          proofArtifactPath: Type.Optional(Type.String()),
        }, { additionalProperties: false }),
        Type.Object({
          action: Type.Literal("hypothesis"),
          text: Type.String(),
        }, { additionalProperties: false }),
        Type.Object({
          action: Type.Literal("sandbox-note"),
          note: Type.String(),
        }, { additionalProperties: false }),
      ]),
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
            const result = await experimentFetch<{ id: string }>(ctx.id, "/findings", {
              method: "POST",
              body: JSON.stringify(payload),
            });
            return textResult(`Finding recorded: ${result.id}`, { id: result.id });
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
      description: "Complete the experiment after the deadline. This is the ONLY exit.",
      parameters: Type.Object({
        report: Type.String(),
      }, { additionalProperties: false }),
      async execute(_toolCallId: string, params: unknown) {
        const p = asRecord(params);
        const report = typeof p["report"] === "string" ? p["report"] : "";
        const deadline = deadlineMs(ctx);
        if (Date.now() < deadline) {
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
