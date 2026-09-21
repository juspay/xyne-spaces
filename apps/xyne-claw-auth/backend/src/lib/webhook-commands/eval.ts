import { randomUUID } from "node:crypto";
import { errMsg } from "../errors.js";
import { agentRepository } from "../../repositories/index.js";
import {
  EVAL_DEADLINE_MS,
  dispatchEvalRun,
  readEvalResults,
  saveEvalState,
  resolveEvalTargets,
  armKey,
  armLabel,
  type EvalDispatch,
  type EvalResult,
  type EvalState,
} from "../eval-run.js";
import { postGeneratedMarkdownFile } from "../spaces-generated-file.js";
import { gcsService } from "../../services/storageService.js";
import {
  buildTraceParts,
  traceTiming,
  TRACE_STYLE,
  type DebugTraceRun,
  type TraceTiming,
} from "../debug-trace-html.js";
import type { WebhookCommandCtx } from "./context.js";

const REPLY_LABEL = "Failed to post /eval reply";

function ms(value: number | null): string {
  if (value === null) return "—";
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`;
}

function num(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

function esc(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}


const DEBUG_RUN_PREFIX = "claw-debug-runs";

export interface EvalTrace {
  run: DebugTraceRun;
  timing: TraceTiming | null;
}

/**
 * Newest checkpoint for one eval arm. Each arm runs under its own pi session
 * (`sessionKey`), so its traces live in their own store — the arms never share
 * a debug prefix even though they answer in one thread.
 */
async function loadArmTrace(result: EvalResult, agentSlug: string): Promise<EvalTrace | null> {
  const prefix = `${DEBUG_RUN_PREFIX}/${result.sessionKey}_${agentSlug}/`;
  let names: string[];
  try {
    names = (await gcsService.listFiles(prefix))
      .map((path) => (path.startsWith(prefix) ? path.slice(prefix.length) : path))
      .filter((name) => name.startsWith("debug-run-") && name.endsWith(".json"));
  } catch {
    return null;
  }
  const safeSession = result.sessionId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const epochOf = (name: string): number => Number(/^debug-run-(\d+)-/.exec(name)?.[1] ?? 0);
  const matching = names.filter((name) => name.includes(safeSession));
  const newest = (matching.length > 0 ? matching : names).sort((a, b) => epochOf(b) - epochOf(a))[0];
  if (!newest) return null;
  try {
    const buffer = await gcsService.getFileBuffer(`${prefix}${newest}`);
    const run = JSON.parse(buffer.toString("utf8")) as DebugTraceRun;
    return { run, timing: traceTiming(run) };
  } catch {
    return null;
  }
}

export async function loadEvalTraces(
  results: EvalResult[],
  agentSlug: string,
): Promise<Map<string, EvalTrace>> {
  const traces = new Map<string, EvalTrace>();
  const loaded = await Promise.all(results.map((r) => loadArmTrace(r, agentSlug).catch(() => null)));
  loaded.forEach((trace, i) => {
    const key = results[i]?.sessionId;
    if (trace && key) traces.set(key, trace);
  });
  return traces;
}


interface JudgeStats {
  backend: string;
  calls: number;
  failed: number;
  questions: number;
  totalMs: number;
  shadows: Array<{ shadow: string; questions: number; agreed: number; meanAbsDiff: number; shadowMs: number; primaryMs: number }>;
}

function judgeStats(trace: EvalTrace | undefined): JudgeStats | null {
  const raw = (trace?.run as unknown as Record<string, unknown> | undefined)?.["judge"];
  if (!raw || typeof raw !== "object") return null;
  const j = raw as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    backend: typeof j["backend"] === "string" ? j["backend"] : "?",
    calls: n(j["calls"]),
    failed: n(j["failed"]),
    questions: n(j["questions"]),
    totalMs: n(j["totalMs"]),
    shadows: Array.isArray(j["shadows"])
      ? (j["shadows"] as Array<Record<string, unknown>>).map((x) => ({
          shadow: typeof x["shadow"] === "string" ? x["shadow"] : "?",
          questions: n(x["questions"]),
          agreed: n(x["agreed"]),
          meanAbsDiff: n(x["meanAbsDiff"]),
          shadowMs: n(x["shadowMs"]),
          primaryMs: n(x["primaryMs"]),
        }))
      : [],
  };
}

function judgeCell(r: EvalResult, trace: EvalTrace | undefined): string {
  const stats = judgeStats(trace);
  if (!stats) return r.judge ? `${esc(r.judge)}<div class="m">no judge calls recorded</div>` : "—";
  const drift = r.judge && stats.backend !== r.judge ? ` · asked ${esc(r.judge)}` : "";
  return `${esc(stats.backend)}${drift}<div class="m">${stats.calls} calls · ${stats.questions} q · ${ms(stats.totalMs)}${stats.failed ? ` · ${stats.failed} failed` : ""}</div>`;
}

function shadowBlock(trace: EvalTrace | undefined): string {
  const stats = judgeStats(trace);
  if (!stats || stats.shadows.length === 0) return "";
  const by = new Map<string, { q: number; agreed: number; diff: number; ms: number; primaryMs: number; n: number }>();
  for (const sh of stats.shadows) {
    const slot = by.get(sh.shadow) ?? { q: 0, agreed: 0, diff: 0, ms: 0, primaryMs: 0, n: 0 };
    slot.q += sh.questions;
    slot.agreed += sh.agreed;
    slot.diff += sh.meanAbsDiff * sh.questions;
    slot.ms += sh.shadowMs;
    slot.primaryMs += sh.primaryMs;
    slot.n += 1;
    by.set(sh.shadow, slot);
  }
  const rows = [...by.entries()]
    .map(([name, v]) => `<tr><td>${esc(name)}</td><td class="n">${v.q}</td><td class="n">${v.q ? Math.round((v.agreed / v.q) * 100) : 0}%</td><td class="n">${v.q ? (v.diff / v.q).toFixed(3) : "—"}</td><td class="n">${ms(Math.round(v.ms / v.n))}</td><td class="n">${ms(Math.round(v.primaryMs / v.n))}</td></tr>`)
    .join("");
  return `<h2>Judge agreement (shadow, same questions)</h2><table class="cmp"><thead><tr><th>Shadow judge</th><th class="n">Questions</th><th class="n">Agrees with ${esc(stats.backend)}</th><th class="n">Mean |Δ|</th><th class="n">Avg ms</th><th class="n">${esc(stats.backend)} avg ms</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderEvalHtml(
  question: string,
  results: EvalResult[],
  startedAt: Date,
  traces: Map<string, EvalTrace> = new Map(),
  agentSlug = "agent",
): string {
  const done = results.filter((r) => r.status === "completed" && r.totalMs !== null);
  const fastest = done.length > 0 ? Math.min(...done.map((r) => r.totalMs ?? 0)) : null;
  const slowest = done.length > 0 ? Math.max(...done.map((r) => r.totalMs ?? 0)) : null;
  const scale = slowest && slowest > 0 ? slowest : 1;

  const ordered = [...results].sort(
    (a, b) => (a.totalMs ?? Number.MAX_SAFE_INTEGER) - (b.totalMs ?? Number.MAX_SAFE_INTEGER),
  );

  // Tool time on the run row is a SUM over invocations, so concurrent fan-out
  // inflates it past the run's own wall clock. When the arm's trace is
  // available we show merged wall-clock instead and keep the sum as a note.
  const toolCell = (r: EvalResult): string => {
    const timing = traces.get(r.sessionId)?.timing;
    if (!timing) return ms(r.toolMs);
    const inflated = timing.toolSumMs > timing.toolWallMs * 1.15 && timing.peakToolConcurrency > 1;
    return inflated
      ? `${ms(timing.toolWallMs)}<div class="m">${ms(timing.toolSumMs)} across ${timing.toolCalls} calls · up to ${timing.peakToolConcurrency} at once</div>`
      : ms(timing.toolWallMs);
  };

  const rows = ordered
    .map((r) => {
      const width = r.totalMs ? Math.max(2, Math.round((r.totalMs / scale) * 100)) : 0;
      const badge =
        r.status === "completed" ? "ok" : r.status === "pending" ? "pending" : "fail";
      const win = r.totalMs !== null && r.totalMs === fastest && r.status === "completed";
      return `<tr>
  <td class="p"><a href="#arm-${esc(r.sessionId)}">${esc(armLabel(r))}</a>${win ? ' <span class="win">fastest</span>' : ""}<div class="m">${esc(r.model ?? "default")}${r.requested ? ` · fell back from ${esc(r.requested)}` : ""}${r.useOverride ? "" : " · agent default"}</div></td>
  <td><span class="b ${badge}">${esc(r.status)}</span></td>
  <td class="n bar"><div class="track"><span style="width:${width}%"></span></div>${ms(r.totalMs)}</td>
  <td class="n">${ms(r.llmTotalMs)}</td>
  <td class="n">${toolCell(r)}</td>
  <td class="n">${judgeCell(r, traces.get(r.sessionId))}</td>
  <td class="n">${ms(r.ttftMs)}</td>
  <td class="n">${num(r.tokensIn)}</td>
  <td class="n">${num(r.tokensOut)}</td>
  <td class="n">${num(r.tokensPerSec)}</td>
</tr>${r.error ? `<tr class="err"><td colspan="10">${esc(r.error.slice(0, 400))}</td></tr>` : ""}`;
    })
    .join("\n");

  // One full session per provider: the answer it gave, then its complete
  // execution trace — run table, per-tool stats, waterfall and event timeline,
  // the same view /debug renders for a single run.
  const sections = ordered
    .map((r, index) => {
      const trace = traces.get(r.sessionId);
      const parts = trace ? buildTraceParts(trace.run) : null;
      const answer = r.answer?.trim();
      const head =
        `<span class="arm-p">Provider: ${esc(armLabel(r))}</span>` +
        `<span class="sub">${esc(r.model ?? "default")}${r.requested ? ` · fell back from ${esc(r.requested)}` : ""} · ${ms(r.totalMs)} · ${esc(r.status)}</span>`;
      const body = [
        answer
          ? `<h2>Answer</h2><pre class="ans">${esc(answer)}</pre>`
          : `<p class="notice">No answer recorded for this arm${r.error ? " — see the error above" : ""}.</p>`,
        shadowBlock(trace),
        parts
          ? parts.inner
          : `<p class="notice">No execution trace was checkpointed for this arm, so its timeline is unavailable.</p>`,
      ].join("\n");
      return `<details class="sess" id="arm-${esc(r.sessionId)}"${index === 0 ? " open" : ""}>
<summary>${head}</summary>
${body}
</details>`;
    })
    .join("\n");

  const spread = fastest && slowest && fastest > 0 ? (slowest / fastest).toFixed(1) : null;
  const missing = ordered.filter((r) => !traces.has(r.sessionId)).length;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Provider eval — ${esc(agentSlug)}</title>
<style>
${TRACE_STYLE}
:root{--mut:#5b6472;--card:#fff;--ok:#0f8a70;--fail:#b4451f;--pend:#9a7b16;--bar:#4f5bd5}
@media(prefers-color-scheme:dark){:root{--mut:#98a2b2;--card:#161b22;--ok:#3fc0b0;--fail:#e2704a;--pend:#d9ab3c;--bar:#8f97ec}}
body{padding:32px 20px 56px}
.w{max-width:1100px;margin:0 auto}
h1{font-size:22px;margin:0 0 6px;letter-spacing:-.01em}
.q{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--bar);border-radius:8px;padding:12px 14px;margin:14px 0 20px;white-space:pre-wrap}
.top{color:var(--mut);font-size:12.5px;margin-bottom:18px}
table.cmp{width:100%;max-width:none;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}
table.cmp th{text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);font-weight:600;padding:10px;border-bottom:1px solid var(--line)}
table.cmp td{padding:11px 10px;border-bottom:1px solid var(--line);vertical-align:top}
table.cmp tr:last-child td{border-bottom:0}
.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.p{font-weight:600}
.p a{color:inherit;text-decoration:none;border-bottom:1px dotted var(--mut)}
.m{font-weight:400;color:var(--mut);font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.b{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid currentColor;text-transform:uppercase;letter-spacing:.05em}
.b.ok{color:var(--ok)}.b.fail{color:var(--fail)}.b.pending{color:var(--pend)}
.bar{min-width:150px}
.track{height:5px;background:var(--line);border-radius:3px;margin-bottom:5px}
.track span{display:block;height:100%;border-radius:3px;background:var(--bar)}
.win{font-size:10.5px;color:var(--ok);border:1px solid currentColor;border-radius:999px;padding:1px 6px;margin-left:6px;text-transform:uppercase;letter-spacing:.05em}
.err td{color:var(--fail);font-family:ui-monospace,monospace;font-size:12px;padding-top:0}
.arm-p{font-weight:700}
.ans{max-height:420px;overflow:auto}
footer{color:var(--mut);font-size:12px;margin-top:18px}
@media(max-width:620px){table.cmp{display:block;overflow-x:auto}}
</style></head><body>
<div class="w">
<h1>Provider eval — ${esc(agentSlug)}</h1>
<div class="top">${results.length} provider${results.length === 1 ? "" : "s"} · started ${esc(startedAt.toISOString())}${spread ? ` · slowest was ${spread}× the fastest` : ""}</div>
<div class="q">${esc(question)}</div>
<table class="cmp">
<thead><tr><th>Provider</th><th>Status</th><th class="n">Total</th><th class="n">LLM</th><th class="n">Tools</th><th class="n">Judge</th><th class="n">TTFT</th><th class="n">Tok in</th><th class="n">Tok out</th><th class="n">Tok/s</th></tr></thead>
<tbody>
${rows}
</tbody></table>
<h2>Full sessions</h2>
<p class="top">Every provider's answer and complete execution trace — tool calls, model turns, compactions and where the wall clock went. Click a provider to expand.${missing > 0 ? ` ${missing} arm${missing === 1 ? " has" : "s have"} no checkpointed trace.` : ""}</p>
${sections}
<footer>Timings come from agent_runs; tool time is merged wall clock from the trace where available, because concurrent tool calls make the stored sum exceed the run's own duration. Identical question, identical agent, one run each.</footer>
</div>
</body></html>`;
}

export async function handleEval(
  ctx: WebhookCommandCtx,
  question: string,
  requested: string[],
  judges: string[] = [],
  opts: string[] = [],
): Promise<void> {
  const trimmed = question.trim();
  if (!trimmed) {
    await ctx.reply("`/eval <question>` — runs the question on every configured provider and posts a comparison. Add `opts=none|all` to A/B the optimization switches, or `judges=llm,jev,ournormaljev,ourtrainedjev` to compare judge backends, on one provider.", REPLY_LABEL);
    return;
  }

  const conversationId = ctx.payload.conversationId;
  const channelId = ctx.payload.channelId;
  if (!conversationId || !channelId) {
    await ctx.reply("/eval needs a thread to run in.", REPLY_LABEL);
    return;
  }

  const agentRow = await agentRepository.findBySlug(ctx.agent.slug, ctx.agent.orgId).catch(() => null);
  const targets = await resolveEvalTargets({
    userId: ctx.payload.userId,
    agent: { id: ctx.agent.id, orgId: ctx.agent.orgId, slug: ctx.agent.slug },
    agentRow,
    conversationId,
    ...(requested.length ? { requested } : {}),
    ...(judges.length ? { judges } : {}),
    ...(opts.length ? { opts } : {}),
  });

  if (targets.length === 0) {
    await ctx.reply("No providers are configured for this agent, so there is nothing to compare.", REPLY_LABEL);
    return;
  }

  const startedAt = new Date();
  const traceId = randomUUID().slice(0, 8);
  const settled = await Promise.allSettled(
    targets.map((target) =>
      dispatchEvalRun({
        target,
        task: trimmed,
        userId: ctx.payload.userId,
        conversationId,
        channelId,
        agentSlug: ctx.agent.slug,
        orgId: ctx.agent.orgId,
        agentId: ctx.agent.id,
        spacesAppToken: ctx.agent.appToken,
        spacesAppId: ctx.agent.spacesAppId,
        spacesAppUserId: ctx.agent.spacesAppUserId,
        traceId: `${traceId}-${armKey(target)}`,
      }),
    ),
  );

  const dispatched: EvalDispatch[] = [];
  const failed: string[] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") {
      dispatched.push(outcome.value);
      return;
    }
    const provider = targets[i] ? armLabel(targets[i]) : "unknown";
    const reason = errMsg(outcome.reason);
    const short = /no .* credentials/i.test(reason)
      ? "not connected"
      : reason.slice(reason.lastIndexOf(":") + 1).trim().slice(0, 60) || "dispatch failed";
    failed.push(`${provider} (${short})`);
    ctx.log.warn("/eval dispatch failed", { provider, error: reason });
  });

  if (dispatched.length === 0) {
    await ctx.reply(`⚖️ **Eval** — every provider failed to start (${failed.join(", ")}).`, REPLY_LABEL);
    return;
  }

  await ctx.reply(
    `⚖️ **Eval** — running on ${dispatched.length} provider${dispatched.length === 1 ? "" : "s"}: ` +
    `${dispatched.map((d) => `\`${armLabel(d)}\``).join(", ")}` +
    `${failed.length ? ` · could not start: ${failed.join(", ")}` : ""}` +
    `\nEach answers in this thread; the comparison lands here when they finish.`,
    REPLY_LABEL,
  );

  await saveEvalState({
    id: traceId,
    question: trimmed,
    startedAt: startedAt.toISOString(),
    deadlineAt: new Date(startedAt.getTime() + EVAL_DEADLINE_MS).toISOString(),
    channelId,
    conversationId,
    agentSlug: ctx.agent.slug,
    spacesAppUserId: ctx.agent.spacesAppUserId,
    appToken: ctx.agent.appToken,
    dispatches: dispatched,
  });
}

/**
 * Post the comparison for one eval. Runs from the sweeper, not the request, so
 * a deploy mid-eval cannot lose the report — the earlier detached-promise
 * version died with whichever pod happened to serve the command.
 */
export async function finalizeEval(state: EvalState, log: WebhookCommandCtx["log"]): Promise<void> {
  const results = await readEvalResults(state.dispatches);
  const traces = await loadEvalTraces(results, state.agentSlug).catch(() => new Map<string, EvalTrace>());
  const html = renderEvalHtml(
    state.question,
    results,
    new Date(state.startedAt),
    traces,
    state.agentSlug,
  );
  const fastest = results
    .filter((r) => r.status === "completed" && r.totalMs !== null)
    .sort((a, b) => (a.totalMs ?? 0) - (b.totalMs ?? 0))[0];
  const unfinished = results.filter((r) => r.status !== "completed").length;

  const summary =
    `⚖️ **Eval comparison** — ${results.length} provider${results.length === 1 ? "" : "s"}` +
    `${fastest ? ` · fastest \`${fastest.provider}\` at ${ms(fastest.totalMs)}` : ""}` +
    `${unfinished ? ` · ${unfinished} did not complete` : ""}` +
    `\nThe file has each provider's answer and its full execution trace.`;

  await postGeneratedMarkdownFile({
    channelId: state.channelId,
    conversationId: state.conversationId,
    userId: state.spacesAppUserId,
    appToken: state.appToken,
    filename: `eval-${state.agentSlug}-${state.id}.html`,
    markdown: html,
    mimeType: "text/html",
    summary,
  });
  log.info("/eval comparison posted", { eval: state.id, providers: results.length });
}
