import { randomUUID } from "node:crypto";
import { errMsg } from "../errors.js";
import { agentRepository } from "../../repositories/index.js";
import {
  awaitEvalResults,
  dispatchEvalRun,
  resolveEvalTargets,
  type EvalDispatch,
  type EvalResult,
} from "../eval-run.js";
import { postGeneratedMarkdownFile } from "../spaces-generated-file.js";
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

export function renderEvalHtml(question: string, results: EvalResult[], startedAt: Date): string {
  const done = results.filter((r) => r.status === "completed" && r.totalMs !== null);
  const fastest = done.length > 0 ? Math.min(...done.map((r) => r.totalMs ?? 0)) : null;
  const slowest = done.length > 0 ? Math.max(...done.map((r) => r.totalMs ?? 0)) : null;
  const scale = slowest && slowest > 0 ? slowest : 1;

  const rows = [...results]
    .sort((a, b) => (a.totalMs ?? Number.MAX_SAFE_INTEGER) - (b.totalMs ?? Number.MAX_SAFE_INTEGER))
    .map((r) => {
      const width = r.totalMs ? Math.max(2, Math.round((r.totalMs / scale) * 100)) : 0;
      const badge =
        r.status === "completed" ? "ok" : r.status === "pending" ? "pending" : "fail";
      const win = r.totalMs !== null && r.totalMs === fastest && r.status === "completed";
      return `<tr>
  <td class="p">${esc(r.provider)}${win ? ' <span class="win">fastest</span>' : ""}<div class="m">${esc(r.model ?? "default")}${r.useOverride ? "" : " · agent default"}</div></td>
  <td><span class="b ${badge}">${esc(r.status)}</span></td>
  <td class="n bar"><div class="track"><span style="width:${width}%"></span></div>${ms(r.totalMs)}</td>
  <td class="n">${ms(r.llmTotalMs)}</td>
  <td class="n">${ms(r.toolMs)}</td>
  <td class="n">${ms(r.ttftMs)}</td>
  <td class="n">${num(r.tokensIn)}</td>
  <td class="n">${num(r.tokensOut)}</td>
  <td class="n">${num(r.tokensPerSec)}</td>
</tr>${r.error ? `<tr class="err"><td colspan="9">${esc(r.error.slice(0, 400))}</td></tr>` : ""}`;
    })
    .join("\n");

  const spread = fastest && slowest && fastest > 0 ? (slowest / fastest).toFixed(1) : null;

  return `<!doctype html><meta charset="utf-8"><title>Provider eval</title>
<style>
:root{color-scheme:light dark;--bg:#fbfbfc;--fg:#16181d;--mut:#5b6472;--line:#e3e6ec;--card:#fff;--ok:#0f8a70;--fail:#b4451f;--pend:#9a7b16;--bar:#4f5bd5}
@media(prefers-color-scheme:dark){:root{--bg:#0f1217;--fg:#eef1f6;--mut:#98a2b2;--line:#252c37;--card:#161b22;--ok:#3fc0b0;--fail:#e2704a;--pend:#d9ab3c;--bar:#8f97ec}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;padding:32px 20px 56px}
.w{max-width:1040px;margin:0 auto}
h1{font-size:22px;margin:0 0 6px;letter-spacing:-.01em}
.q{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--bar);border-radius:8px;padding:12px 14px;margin:14px 0 20px;white-space:pre-wrap}
.meta{color:var(--mut);font-size:12.5px;margin-bottom:18px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}
th{text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);font-weight:600;padding:10px;border-bottom:1px solid var(--line)}
td{padding:11px 10px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.p{font-weight:600}
.m{font-weight:400;color:var(--mut);font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.b{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid currentColor;text-transform:uppercase;letter-spacing:.05em}
.b.ok{color:var(--ok)}.b.fail{color:var(--fail)}.b.pending{color:var(--pend)}
.bar{min-width:150px}
.track{height:5px;background:var(--line);border-radius:3px;margin-bottom:5px}
.track span{display:block;height:100%;border-radius:3px;background:var(--bar)}
.win{font-size:10.5px;color:var(--ok);border:1px solid currentColor;border-radius:999px;padding:1px 6px;margin-left:6px;text-transform:uppercase;letter-spacing:.05em}
.err td{color:var(--fail);font-family:ui-monospace,monospace;font-size:12px;padding-top:0}
footer{color:var(--mut);font-size:12px;margin-top:18px}
@media(max-width:620px){table{display:block;overflow-x:auto}}
</style>
<div class="w">
<h1>Provider eval</h1>
<div class="meta">${results.length} provider${results.length === 1 ? "" : "s"} · started ${esc(startedAt.toISOString())}${spread ? ` · slowest was ${spread}× the fastest` : ""}</div>
<div class="q">${esc(question)}</div>
<table>
<thead><tr><th>Provider</th><th>Status</th><th class="n">Total</th><th class="n">LLM</th><th class="n">Tools</th><th class="n">TTFT</th><th class="n">Tok in</th><th class="n">Tok out</th><th class="n">Tok/s</th></tr></thead>
<tbody>
${rows}
</tbody></table>
<footer>Each provider answered in the thread. Timings come from agent_runs; identical question, identical agent, one run each.</footer>
</div>`;
}

export async function handleEval(ctx: WebhookCommandCtx, question: string, requested: string[]): Promise<void> {
  const trimmed = question.trim();
  if (!trimmed) {
    await ctx.reply("`/eval <question>` — runs the question on every configured provider and posts a comparison.", REPLY_LABEL);
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
        traceId: `${traceId}-${target.provider}`,
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
    const provider = targets[i]?.provider ?? "unknown";
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
    `${dispatched.map((d) => `\`${d.provider}\``).join(", ")}` +
    `${failed.length ? ` · could not start: ${failed.join(", ")}` : ""}` +
    `\nEach answers in this thread; the comparison lands here when they finish.`,
    REPLY_LABEL,
  );

  void (async () => {
  const results = await awaitEvalResults(dispatched);
  const html = renderEvalHtml(trimmed, results, startedAt);
  const fastest = results
    .filter((r) => r.status === "completed" && r.totalMs !== null)
    .sort((a, b) => (a.totalMs ?? 0) - (b.totalMs ?? 0))[0];

  const summary =
    `⚖️ **Eval comparison** — ${results.length} provider${results.length === 1 ? "" : "s"}` +
    `${fastest ? ` · fastest \`${fastest.provider}\` at ${ms(fastest.totalMs)}` : ""}` +
    `${results.some((r) => r.status !== "completed") ? ` · ${results.filter((r) => r.status !== "completed").length} did not complete` : ""}`;

  try {
    await postGeneratedMarkdownFile({
      channelId,
      conversationId,
      userId: ctx.agent.spacesAppUserId,
      appToken: ctx.agent.appToken,
      filename: `eval-${ctx.agent.slug}-${traceId}.html`,
      markdown: html,
      mimeType: "text/html",
      summary,
    });
  } catch (err) {
    ctx.log.warn("/eval comparison upload failed", { error: errMsg(err) });
    await ctx.reply(`${summary}\n\n⚠️ _Couldn't attach the comparison (upload failed)._`, REPLY_LABEL);
  }
  })().catch((err: unknown) => {
    ctx.log.warn("/eval collection failed", { error: errMsg(err) });
  });
}
