import { prisma } from "../../db.js";
import { isClawAdmin } from "../../middleware/agent-acl.js";
import { createLogger } from "../../logger.js";
import { normalizeError } from "./fleet-stats.js";

const log = createLogger("agent-diagnostics");

const ORPHANED = "interrupted (orphaned run)";
const STUCK_MS = 3 * 3_600_000;
const PAGE = 20;

export interface Cause {
  category: string;
  hint: string;
}

const RULES: Array<{ test: RegExp; category: string; hint: string }> = [
  { test: /^session_locked$|already processing/i, category: "session-lock", hint: "A second message arrived while a run held the conversation lock. Platform-level: queue or merge follow-ups instead of failing; per agent, look for automations or users posting repeatedly into one thread." },
  { test: /ended without emitting a result|silent early-return/i, category: "no-result", hint: "The run returned nothing — usually a lock or an early return. Check the session's claw logs; if it repeats, treat as a platform bug." },
  { test: /model stopped responding|stopped before completion/i, category: "model-stall", hint: "The model stalled after a tool call (often a slow or failed one). Shorten/limit the slow tool, or add a timeout and a retry instruction." },
  { test: /\btool\b.*\(\{.*not found|<\/arg_value>|arg_key/i, category: "tool-call-format", hint: "The model put the arguments inside the tool name (malformed tool-call output). Model/parser bug: switch this agent's model or fix the tool-call parser for it." },
  { test: /Tool [\w.-]+ not found/i, category: "unknown-tool", hint: "The model called a tool it does not have (stale prompt reference or hallucinated name). Remove the name from the prompt/skills or grant the tool." },
  { test: /Validation failed for tool|must have required propert|Invalid (content_query )?regex|invalid regular expression|is not a valid filter/i, category: "bad-arguments", hint: "Malformed tool arguments (missing required field, invalid regex or filter). Add a correct example call to the prompt or skill; make the tool description state the required fields." },
  { test: /No connection found for user/i, category: "missing-connection", hint: "The asking user has not connected this integration. Tell users to connect it, or enable an admin/global credential for the server." },
  { test: /forbids access via a personal access token|Bad credentials|authentication_error|token has been revoked|Not logged in|Authentication Failed|\b401\b/i, category: "credentials", hint: "The integration credential is invalid, revoked or the wrong kind (e.g. an org forbids classic PATs). Rotate it / use a fine-grained token or app." },
  { test: /Permission denied|\b403\b|forbidden/i, category: "permissions", hint: "The credential lacks access to that repo/resource. Grant access or stop the agent from querying it." },
  { test: /not found in .* on branch|Not found: listing|File '.*' not found|not a directory|ENOENT|Path not found|Wiki page not found/i, category: "wrong-path", hint: "The agent guessed a path, branch or page that does not exist. Make it list/search first (directory listing, search_code) and state the default branch and repo layout in its prompt or skill." },
  { test: /circuit breaker is open/i, category: "upstream-down", hint: "The upstream service's circuit breaker was open. Upstream reliability issue — fail fast and tell the user instead of retrying." },
  { test: /timeout|timed out|ReadTimeout|aborted due to timeout|ETIMEDOUT/i, category: "timeout", hint: "Upstream call timed out. Narrow the query (smaller time window, fewer fields), raise the tool timeout only if results are worth it, or fix the upstream." },
  { test: /rate limit|max_parallel|\b429\b|overloaded|server_is_overloaded/i, category: "rate-limit", hint: "Provider or API rate limit. Spread automations, cut parallel calls, or move the agent to a less loaded provider/key." },
  { test: /websocket closed|terminated|sse stream broken|connection error|fetch failed|socket hang up|upstream c/i, category: "connection", hint: "Transport dropped mid-call (provider or proxy). Usually transient; if frequent for one provider, move the agent or fix that path." },
  { test: /schema_validation_failed|Bad Request|beyond end of file/i, category: "bad-arguments", hint: "Malformed tool arguments or query rejected by the API. Add a correct example call to the prompt or skill; make the tool description state the accepted format." },
  { test: /Request failed with status code|Vespa search \d|HTTP \d{3}|status code \d{3}/i, category: "upstream-error", hint: "The upstream API returned an error status. Check whether it repeats for one repo/query (bad input) or across calls (upstream outage)." },
  { test: /"status":\s*"blocked"|\bblocked\b/i, category: "blocked-by-policy", hint: "The tool refused the action by policy. Expected for unsafe actions; if frequent, teach the agent which actions are allowed." },
  { test: /Maximum call stack size exceeded|is not a function|Cannot read properties of/i, category: "tool-crash", hint: "The tool itself crashed. Code bug in the tool — file it with the sample input." },
  { test: /(^|\s)No result\s*$/i, category: "empty-result", hint: "The tool returned nothing. Often a too-narrow query or wrong time window; check the arguments in a sample session." },
  { test: /^(I'll|I've|I will|I can|Here is|Here's|Verification passed|Done|#{1,3} )/, category: "output-recorded-as-error", hint: "The run's final answer was stored as its error and the run marked failed. Platform bug in result handling, not an agent problem." },
  { test: /cancelled by user/i, category: "user-cancel", hint: "Users stopped the run — often because it was slow or going the wrong way. Look at what the run was doing when cancelled." },
  { test: /run_timed_out|did not finish within/i, category: "run-timeout", hint: "The run hit the wall-clock limit. Reduce work per run (fewer tool calls, smaller scope) or split it." },
  { test: /empty_result|without producing|could not be generated/i, category: "empty-output", hint: "The run finished without the expected output. Check the prompt's output contract and the last turns of a failing session." },
];

export function classify(text: string): Cause {
  for (const r of RULES) if (r.test.test(text)) return { category: r.category, hint: r.hint };
  return { category: "other", hint: "Unclassified — read one failing session to find the cause." };
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = sorted[Math.floor(position)]!;
  const upper = sorted[Math.ceil(position)]!;
  return Math.round(lower + (upper - lower) * (position - Math.floor(position)));
}

const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const nums = (v: Array<number | null | undefined>): number[] => v.filter((x): x is number => typeof x === "number" && Number.isFinite(x));

function top<T extends string>(values: Array<T | null | undefined>, n: number): Array<{ value: T; count: number }> {
  const m = new Map<T, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }));
}

export interface DiagRun {
  sessionId: string;
  status: string;
  provider: string | null;
  model: string | null;
  triggerSource: string;
  startedAt: Date;
  completedAt: Date | null;
  totalMs: number | null;
  llmTotalMs: number | null;
  toolMs: number | null;
  llmTurns: number | null;
  llmRetries: number | null;
  lastRetryReason: string | null;
  error: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensCacheRead: number | null;
  rating: string | null;
  ratingComment: string | null;
  toolsUsed: string[];
  parentSessionId: string | null;
}

export interface ToolAgg {
  calls: number;
  errors: number;
  durations: number[];
  kinds: Map<string, { count: number; sample: string; hint: string }>;
}

export function accumulateInvocations(into: Map<string, ToolAgg>, invocations: unknown): void {
  if (!Array.isArray(invocations)) return;
  for (const inv of invocations) {
    if (!inv || typeof inv !== "object") continue;
    const o = inv as Record<string, unknown>;
    const name = typeof o["toolName"] === "string" ? o["toolName"] : typeof o["name"] === "string" ? o["name"] : null;
    if (!name) continue;
    const t: ToolAgg = into.get(name) ?? { calls: 0, errors: 0, durations: [], kinds: new Map() };
    t.calls += 1;
    if (typeof o["durationMs"] === "number" && Number.isFinite(o["durationMs"])) t.durations.push(o["durationMs"] as number);
    if (o["isError"] === true) {
      t.errors += 1;
      const raw = typeof o["result"] === "string" ? o["result"] : JSON.stringify(o["result"] ?? "");
      const text = `${name} ${raw}`;
      const c = classify(text);
      const k = t.kinds.get(c.category) ?? { count: 0, sample: normalizeError(raw.replace(/\\"/g, '"')).slice(0, 220), hint: c.hint };
      k.count += 1;
      t.kinds.set(c.category, k);
    }
    into.set(name, t);
  }
}

export function buildAgentDiagnostics(input: {
  agentSlug: string;
  days: number;
  now: Date;
  runs: DiagRun[];
  tools: Map<string, ToolAgg>;
  sampledRuns: number;
}): Record<string, unknown> {
  const runs = input.runs.filter((r) => r.error !== ORPHANED);
  const completed = runs.filter((r) => r.status === "completed" && r.completedAt);
  const dur = (r: DiagRun) => (r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null);
  const durations = nums(completed.map(dur));
  const telemetered = completed.filter((r) => r.totalMs != null);
  const totalTel = telemetered.reduce((a, r) => a + (r.totalMs ?? 0), 0);
  const llm = telemetered.reduce((a, r) => a + (r.llmTotalMs ?? 0), 0);
  const tool = telemetered.reduce((a, r) => a + (r.toolMs ?? 0), 0);
  const failedOrCancelled = runs.filter((r) => (r.status === "failed" || r.status === "cancelled") && r.error);
  const errGroups = new Map<string, { count: number; cause: Cause; sessions: string[] }>();
  for (const r of failedOrCancelled) {
    const msg = normalizeError(r.error!);
    const g = errGroups.get(msg) ?? { count: 0, cause: classify(r.error!), sessions: [] };
    g.count += 1;
    if (g.sessions.length < 3) g.sessions.push(r.sessionId);
    errGroups.set(msg, g);
  }
  const toolRows = [...input.tools].map(([name, t]) => ({
    tool: name,
    calls: t.calls,
    errors: t.errors,
    errorPct: pct(t.errors, t.calls),
    p50Ms: percentile(t.durations, 0.5),
    p95Ms: percentile(t.durations, 0.95),
    errorKinds: [...t.kinds].sort((a, b) => b[1].count - a[1].count).map(([category, k]) => ({ category, count: k.count, sample: k.sample, hint: k.hint })),
  }));
  const causeTotals = new Map<string, number>();
  for (const g of errGroups.values()) causeTotals.set(g.cause.category, (causeTotals.get(g.cause.category) ?? 0) + g.count);
  for (const t of toolRows) for (const k of t.errorKinds) causeTotals.set(`tool:${k.category}`, (causeTotals.get(`tool:${k.category}`) ?? 0) + k.count);
  const toolCalls = toolRows.reduce((a, t) => a + t.calls, 0);
  const describe = (r: DiagRun) => ({
    sessionId: r.sessionId,
    status: r.status,
    trigger: r.triggerSource,
    seconds: dur(r) === null ? null : Math.round(dur(r)! / 1000),
    turns: r.llmTurns,
    toolsUsed: r.toolsUsed.length,
    tokensIn: r.tokensIn,
    startedAt: r.startedAt.toISOString(),
  });
  return {
    agentSlug: input.agentSlug,
    windowDays: input.days,
    runs: {
      total: runs.length,
      completed: completed.length,
      failed: runs.filter((r) => r.status === "failed").length,
      cancelled: runs.filter((r) => r.status === "cancelled").length,
      stuckRunning: runs.filter((r) => r.status === "running" && input.now.getTime() - r.startedAt.getTime() > STUCK_MS).length,
      asSubagent: runs.filter((r) => r.parentSessionId).length,
      byTrigger: top(runs.map((r) => r.triggerSource), 5),
      providers: top(runs.map((r) => `${r.provider ?? "unknown"}/${r.model ?? "unknown"}`), 5),
    },
    latency: {
      p50S: durations.length ? Math.round(percentile(durations, 0.5)! / 1000) : null,
      p95S: durations.length ? Math.round(percentile(durations, 0.95)! / 1000) : null,
      maxS: durations.length ? Math.round(Math.max(...durations) / 1000) : null,
      missingTimingPct: pct(completed.length - telemetered.length, completed.length),
      llmPct: pct(llm, totalTel),
      toolPct: pct(tool, totalTel),
      otherPct: totalTel > 0 ? Math.max(0, Math.round((100 - pct(llm, totalTel) - pct(tool, totalTel)) * 10) / 10) : null,
    },
    effort: {
      turnsP50: percentile(nums(completed.map((r) => r.llmTurns)), 0.5),
      turnsP95: percentile(nums(completed.map((r) => r.llmTurns)), 0.95),
      tokensInP50: percentile(nums(completed.map((r) => r.tokensIn)), 0.5),
      tokensInP95: percentile(nums(completed.map((r) => r.tokensIn)), 0.95),
      tokensOutP50: percentile(nums(completed.map((r) => r.tokensOut)), 0.5),
      cacheReadPct: pct(completed.reduce((a, r) => a + (r.tokensCacheRead ?? 0), 0), completed.reduce((a, r) => a + (r.tokensCacheRead ?? 0) + (r.tokensIn ?? 0), 0)),
      toolCallsPerRun: input.sampledRuns ? Math.round((toolCalls / input.sampledRuns) * 10) / 10 : null,
      llmRetries: runs.reduce((a, r) => a + (r.llmRetries ?? 0), 0),
      retryReasons: top(runs.map((r) => (r.lastRetryReason ? normalizeError(r.lastRetryReason).slice(0, 140) : null)), 4),
    },
    runErrors: [...errGroups].sort((a, b) => b[1].count - a[1].count).slice(0, 10).map(([message, g]) => ({ message, count: g.count, category: g.cause.category, hint: g.cause.hint, exampleSessions: g.sessions })),
    tools: {
      sampledRuns: input.sampledRuns,
      failing: toolRows.filter((t) => t.errors > 0).sort((a, b) => b.errors - a.errors).slice(0, 10),
      slowest: toolRows.filter((t) => t.calls >= 3 && t.p95Ms !== null).sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0)).slice(0, 5).map(({ errorKinds: _k, ...t }) => t),
      mostUsed: toolRows.sort((a, b) => b.calls - a.calls).slice(0, 8).map((t) => ({ tool: t.tool, calls: t.calls, errorPct: t.errorPct })),
    },
    causeTotals: [...causeTotals].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count })),
    ratings: {
      up: runs.filter((r) => r.rating === "up").length,
      down: runs.filter((r) => r.rating === "down").length,
      comments: runs.filter((r) => r.ratingComment).slice(0, 5).map((r) => ({ rating: r.rating, comment: String(r.ratingComment).slice(0, 200), sessionId: r.sessionId })),
    },
    slowestSessions: [...completed].sort((a, b) => (dur(b) ?? 0) - (dur(a) ?? 0)).slice(0, 3).map(describe),
    heaviestContextSessions: [...completed].sort((a, b) => (b.tokensIn ?? 0) - (a.tokensIn ?? 0)).slice(0, 3).map(describe),
    notes: [
      "Tool statistics come from the most recent sampledRuns runs (toolInvocations); run statistics cover the whole window.",
      "category/hint are heuristic classifications of the error text — confirm with one example session before acting.",
      "missingTimingPct = completed runs with no recorded timing; their time cannot be split into LLM/tool.",
    ],
  };
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && raw !== undefined && raw !== null && raw !== "" ? Math.min(Math.max(n, min), max) : fallback;
}

export async function handleGetAgentDiagnostics(
  params: Record<string, unknown>,
  contextOrgId?: string,
  requestingUserId?: string,
): Promise<string> {
  if (!contextOrgId) return JSON.stringify({ error: "contextOrgId is required" });
  if (!requestingUserId || !(await isClawAdmin(requestingUserId))) {
    log.warn(`[agent-diagnostics] refused non-admin requester=${requestingUserId ?? "none"} orgId=${contextOrgId}`);
    return JSON.stringify({ error: "get_agent_diagnostics is restricted to claw admins (CLAW_ADMIN role)." });
  }
  const agentSlug = String(params["agentSlug"] ?? "").trim();
  if (!agentSlug) return JSON.stringify({ error: "`agentSlug` is required" });
  const agent = await prisma.agent.findUnique({ where: { orgId_slug: { orgId: contextOrgId, slug: agentSlug } }, select: { slug: true } });
  if (!agent) return JSON.stringify({ error: `No agent with slug "${agentSlug}"` });

  const days = clampInt(params["days"], 7, 1, 30);
  const sampleRuns = clampInt(params["sampleRuns"], 60, 10, 150);
  const now = new Date();
  const since = new Date(now.getTime() - days * 86_400_000);
  const where = { orgId: contextOrgId, agentSlug, startedAt: { gte: since } };

  const runs = await prisma.agentRun.findMany({
    where,
    select: {
      sessionId: true, status: true, provider: true, model: true, triggerSource: true, startedAt: true, completedAt: true,
      totalMs: true, llmTotalMs: true, toolMs: true, llmTurns: true, llmRetries: true, lastRetryReason: true, error: true,
      tokensIn: true, tokensOut: true, tokensCacheRead: true, rating: true, ratingComment: true, toolsUsed: true, parentSessionId: true,
    },
  });

  const tools = new Map<string, ToolAgg>();
  let sampled = 0;
  let cursor: string | undefined;
  while (sampled < sampleRuns) {
    const page = await prisma.agentRun.findMany({
      where,
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: Math.min(PAGE, sampleRuns - sampled),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, toolInvocations: true },
    });
    for (const r of page) accumulateInvocations(tools, r.toolInvocations);
    sampled += page.length;
    if (page.length < PAGE) break;
    cursor = page[page.length - 1]!.id;
  }

  return JSON.stringify(
    buildAgentDiagnostics({
      agentSlug,
      days,
      now,
      runs: runs.map((r) => ({ ...r, error: r.error?.slice(0, 600) ?? null, lastRetryReason: r.lastRetryReason?.slice(0, 300) ?? null, toolsUsed: r.toolsUsed ?? [] })),
      tools,
      sampledRuns: sampled,
    }),
  );
}
