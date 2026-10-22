/**
 * The governance hooks of one pi session, installed last so they wrap every other hook:
 * A wraps streamFn and checks that every message the model is about to read has a verdict,
 * B chains afterToolCall and scans each tool result as it lands,
 * C1 chains beforeToolCall and runs decide() on every tool call,
 * D checks the answer before it leaves the run.
 * Component modes decide whether a block is enforced; in shadow everything is recorded only.
 */
import { randomUUID } from "node:crypto";
import type { AfterToolCallContext, AfterToolCallResult, BeforeToolCallContext, BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import {
  checkAnswer,
  componentMode,
  criticNeeded,
  decide,
  JUDGE_LIMITS,
  resolveToolDescriptor,
  scanText,
  sha256Hex,
  type Channel,
  type ConversationState,
  type ContentKind,
  type CriticLevel,
  type CriticVerdict,
  type DecisionKind,
  type Grant,
  type ParserResult,
  type RiskLevel,
  type ToolRisk,
  type Verdict,
} from "xyne-claw-shared/governance";
import { SERVER } from "./config.js";
import { createLogger } from "./logger.js";
import { flushGovernance, queueGovernance, recordGovernanceNow, type GovernanceEvent, type GovernanceFinding } from "./governance-client.js";
import { criticEnabled, criticFor, dropCritic, preclassify, type CriticCallInput, type CriticDeps } from "./governance-critic.js";

const log = createLogger("governance");

export interface ToolMetaEntry {
  name: string;
  serverType?: string | undefined;
  mcpToolName?: string | undefined;
  isWriteTool?: boolean | undefined;
  permission?: string | undefined;
}

/** Reads the fields claw's MCP loader stamps on a tool definition; a local tool has none. */
export function toolMetaOf(tool: { name: string } & Record<string, unknown>): ToolMetaEntry {
  const key = typeof tool["serverToolKey"] === "string" ? tool["serverToolKey"] : undefined;
  const serverType = key?.split("__")[0];
  return {
    name: tool.name,
    ...(serverType ? { serverType } : {}),
    ...(typeof tool["mcpToolName"] === "string" ? { mcpToolName: tool["mcpToolName"] } : {}),
    ...(typeof tool["isWriteTool"] === "boolean" ? { isWriteTool: tool["isWriteTool"] } : {}),
  };
}

export interface RunGovernanceOptions {
  sessionId: string;
  userId: string;
  conversationId?: string | undefined;
  agentSlug?: string | undefined;
  channel?: Channel | undefined;
  /** Every custom tool the session holds, so C1 can tell an MCP tool from a local one. */
  toolMeta?: readonly ToolMetaEntry[] | undefined;
  /** "parent" registers the run for D; a subagent shares its parent's conversation state. */
  role?: "parent" | "subagent" | undefined;
  parent?: RunGovernance | undefined;
  /** The run's request and whether a person typed it; the critic treats anything else as authorising nothing. */
  request?: { text: string; typedByPerson: boolean } | undefined;
  critic?: CriticDeps | undefined;
}

type BeforeHook = (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
type AfterHook = (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
type StreamFn = (model: unknown, context: unknown, options?: unknown) => unknown;

export interface GovernedAgent {
  streamFn?: unknown;
  beforeToolCall?: BeforeHook | undefined;
  afterToolCall?: AfterHook | undefined;
}

/** What C1 decided, sent along with the MCP call so C2 verifies instead of deciding again. */
export interface C1Decision {
  decisionId: string;
  decision: DecisionKind;
  reasonCode: string;
  risk: RiskLevel;
  privateData: boolean;
  pendingVerdicts: number;
  toolCallId: string;
  criticStatus?: CriticVerdict["status"] | undefined;
  criticLevel?: CriticLevel | undefined;
  criticSource?: ToolRisk["source"] | undefined;
  criticCategories?: string[] | undefined;
  criticReasons?: string[] | undefined;
  judgeMs?: number | undefined;
}

export interface RunGovernanceStats {
  scanned: number;
  coverageMisses: number;
  findings: number;
  decisions: number;
  blocks: number;
  auditFailures: number;
}

export interface RunGovernance {
  readonly state: ConversationState;
  readonly stats: RunGovernanceStats;
  install(agent: GovernedAgent): void;
  /** D: the parser plus the link check on the final answer. */
  inspectAnswer(text: string): { verdict: Verdict; removed: number; text: string };
  finish(): Promise<void>;
}

const SCAN_BUDGET_MS = 200;
const ARGS_BUDGET_MS = 50;
const SCANNED_CAP = 5_000;
const decisions = new Map<string, C1Decision>();
const started = new Map<string, number>();
const byRun = new Map<string, RunGovernance>();

export const governanceDecisionFor = (toolCallId: string): C1Decision | undefined => decisions.get(toolCallId);
export const governanceForRun = (sessionId: string): RunGovernance | undefined => byRun.get(sessionId);

const riskOf = (verdict: Verdict): RiskLevel => (verdict === "injection" ? "high" : verdict === "clean" ? "none" : "elevated");
const RISK_RANK: Record<RiskLevel, number> = { none: 0, elevated: 1, high: 2 };
const grantOf = (p: unknown): Grant | undefined => (p === "allow" || p === "ask" || p === "deny" ? p : undefined);

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && typeof c === "object" && (c as { type?: unknown }).type === "text" ? String((c as { text?: unknown }).text ?? "") : ""))
    .filter((t) => t.length > 0)
    .join("\n");
}

function messageText(m: unknown): { role: "user" | "toolResult" | "other"; text: string } {
  const msg = m as { role?: unknown; content?: unknown } | null;
  const role = msg?.role === "user" ? "user" : msg?.role === "toolResult" ? "toolResult" : "other";
  return { role, text: role === "other" ? "" : textOf(msg?.content) };
}

function safeJson(value: unknown, max: number): string {
  try {
    return (JSON.stringify(value) ?? "").slice(0, max);
  } catch {
    return "";
  }
}

const allowedRenderHosts = (): string[] => {
  const hosts = (process.env["GOVERNANCE_RENDER_ALLOWLIST"] ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  try {
    hosts.push(new URL(SERVER.authServiceUrl).hostname);
  } catch {
    /* no host */
  }
  return hosts;
};

export function createRunGovernance(opts: RunGovernanceOptions): RunGovernance {
  const { sessionId, userId, conversationId, agentSlug } = opts;
  const state: ConversationState = opts.parent?.state ?? { risk: "none", privateData: false, pendingVerdicts: 0, readUntypedContent: false };
  const stats: RunGovernanceStats = { scanned: 0, coverageMisses: 0, findings: 0, decisions: 0, blocks: 0, auditFailures: 0 };
  const toolMeta = new Map((opts.toolMeta ?? []).map((t) => [t.name, t]));
  const scanned = new Set<string>();
  const seen = (text: string): boolean => {
    const h = sha256Hex(text);
    if (scanned.has(h)) return true;
    if (scanned.size >= SCANNED_CAP) scanned.clear();
    scanned.add(h);
    return false;
  };
  const base = (): GovernanceEvent => ({
    eventType: "run_started",
    sessionId,
    userId,
    ...(conversationId ? { conversationId } : {}),
    actorKind: "agent",
    ...(agentSlug ? { actorId: agentSlug } : {}),
    onBehalfOfUserId: userId,
  });

  const raise = (verdict: Verdict): void => {
    const r = riskOf(verdict);
    if (RISK_RANK[r] > RISK_RANK[state.risk]) state.risk = r;
  };

  /** Files the findings of one scan and raises the conversation's risk. */
  const record = (scan: ParserResult, where: { foundIn: string; toolCallId?: string | undefined }, text: string): void => {
    stats.scanned++;
    const rows: GovernanceFinding[] = scan.findings
      .filter((f) => f.verdict !== "clean")
      .map((f) => ({
        sessionId,
        userId,
        foundIn: where.foundIn,
        ...(conversationId ? { conversationId } : {}),
        ...(where.toolCallId ? { toolCallId: where.toolCallId } : {}),
        chunkSha256: sha256Hex(text),
        foundByCheck: "parser",
        verdict: f.verdict,
        ruleId: f.ruleId,
        ruleFamily: f.family,
        score: f.score,
        startOffset: f.span.start,
        endOffset: f.span.end,
        redactedExcerpt: f.excerpt.slice(0, 200),
        scanProfile: scan.kind,
        scannerVersion: scan.scannerVersion,
      }));
    // Unverified content is kept as a finding row too, so the risk it carries can clear later.
    if (scan.verdict === "unverified" && rows.length === 0) {
      rows.push({ sessionId, userId, foundIn: where.foundIn, ...(conversationId ? { conversationId } : {}), chunkSha256: sha256Hex(text), foundByCheck: "parser", verdict: "unverified", ruleId: "scan.unverified", score: 0, startOffset: 0, endOffset: 0, redactedExcerpt: "", scanProfile: scan.kind, scannerVersion: scan.scannerVersion });
    }
    for (const row of rows) queueGovernance(undefined, row);
    stats.findings += rows.length;
    raise(scan.verdict);
  };

  const scan = (text: string, kind: ContentKind, deadlineMs: number): ParserResult => scanText({ text, kind }, { deadlineMs });

  // A: nothing reaches the model without a verdict; a miss means a code path skipped B.
  const inspectContext = (context: unknown): void => {
    const ctx = context as { messages?: unknown; systemPrompt?: unknown } | null;
    const deadline = Date.now() + SCAN_BUDGET_MS;
    if (typeof ctx?.systemPrompt === "string" && ctx.systemPrompt && !seen(ctx.systemPrompt)) {
      const r = scan(ctx.systemPrompt, "prompt_layer", deadline);
      stats.scanned++;
      if (r.findings.length > 0) log.info(`[governance] system prompt scan session=${sessionId} verdict=${r.verdict} rules=${r.findings.map((f) => f.ruleId).join(",")}`);
    }
    for (const m of Array.isArray(ctx?.messages) ? ctx.messages : []) {
      const { role, text } = messageText(m);
      if (!text || seen(text)) continue;
      if (role === "toolResult") stats.coverageMisses++;
      record(scan(text, role === "user" ? "user_message" : "tool_result", deadline), { foundIn: role === "user" ? "user_message" : "tool_result" }, text);
      if (role === "toolResult") state.readUntypedContent = true;
    }
  };

  // B: scan the result the moment it exists, after pi's own hook has shaped it.
  const afterTool = (ctx: AfterToolCallContext, override: AfterToolCallResult | undefined): void => {
    const text = textOf(override?.content ?? (ctx.result as { content?: unknown } | undefined)?.content);
    decisions.delete(ctx.toolCall.id);
    dropCritic(ctx.toolCall.id);
    const meta = toolMeta.get(ctx.toolCall.name);
    const t0 = started.get(ctx.toolCall.id);
    started.delete(ctx.toolCall.id);
    const outcome = override?.isError ?? ctx.isError ? "error" : "executed";
    queueGovernance({ ...base(), eventType: "tool_outcome", toolCallId: ctx.toolCall.id, toolName: meta?.mcpToolName ?? ctx.toolCall.name, ...(meta?.serverType ? { mcpServerId: meta.serverType } : {}), outcome, reasonText: t0 ? `${outcome} in ${Date.now() - t0} ms` : outcome });
    if (!text || seen(text)) return;
    const descriptor = resolveToolDescriptor({ toolName: meta?.mcpToolName ?? ctx.toolCall.name, serverType: meta?.serverType });
    state.readUntypedContent = true;
    if (descriptor.returnsPrivateData) {
      state.privateData = true;
      state.privateSource = meta?.serverType ?? ctx.toolCall.name;
    }
    record(scan(text, "tool_result", Date.now() + SCAN_BUDGET_MS), { foundIn: "tool_result", toolCallId: ctx.toolCall.id }, text);
  };

  // C1: one decision per call, recorded before a side effect runs.
  const criticCall = (id: string, toolName: string, args: unknown): CriticCallInput | null => {
    const meta = toolMeta.get(toolName);
    const d = resolveToolDescriptor({ toolName: meta?.mcpToolName ?? toolName, serverType: meta?.serverType, writeTool: meta?.isWriteTool, args });
    if (!criticNeeded(d.effect, state.readUntypedContent)) return null;
    const argsText = safeJson(args, 65_536);
    const scan = scanText({ text: argsText, kind: "agent_written_text", outbound: true }, { deadlineMs: Date.now() + ARGS_BUDGET_MS });
    return { toolCallId: id, toolName, effect: d.effect, destination: d.destination, argsText, judgeAddressedInArgs: scan.findings.some((f) => f.family === "judge_addressing") };
  };
  /** Every tool call in the assistant message starts its critic together; this call then waits for its own. */
  const criticVerdict = async (ctx: BeforeToolCallContext, current: CriticCallInput): Promise<{ verdict: CriticVerdict; risk?: ToolRisk; ms?: number }> => {
    const blocks = Array.isArray((ctx.assistantMessage as { content?: unknown })?.content) ? ((ctx.assistantMessage as { content: unknown[] }).content) : [];
    const siblings = blocks
      .map((b) => b as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown })
      .filter((b) => b?.type === "toolCall" && typeof b.id === "string" && typeof b.name === "string" && b.id !== current.toolCallId)
      .map((b) => criticCall(b.id as string, b.name as string, b.arguments))
      .filter((c): c is CriticCallInput => c !== null);
    preclassify([current, ...siblings], { request: opts.request?.text, typedByPerson: opts.request?.typedByPerson ?? false, risk: state.risk }, opts.critic);
    const r = await criticFor(current.toolCallId, JUDGE_LIMITS.gateWaitMs);
    if (!r) return { verdict: { status: "not_needed" } };
    return { verdict: r.status === "decided" ? { status: "decided", level: r.risk.level } : { status: "unavailable" }, risk: r.risk, ms: r.ms };
  };

  const criticTags = (risk: ToolRisk): string[] => [`critic.${risk.source}.${risk.level}`, ...risk.categories.map((c) => `critic.${c}`)];

  const gate = async (ctx: BeforeToolCallContext, mode: "shadow" | "enforce"): Promise<BeforeToolCallResult | undefined> => {
    const t0 = performance.now();
    const name = ctx.toolCall.name;
    const meta = toolMeta.get(name);
    const descriptor = resolveToolDescriptor({ toolName: meta?.mcpToolName ?? name, serverType: meta?.serverType, writeTool: meta?.isWriteTool, args: ctx.args });
    const argsText = safeJson(ctx.args, 65_536);
    const argScan = scanText({ text: argsText, kind: "agent_written_text", outbound: true }, { deadlineMs: Date.now() + ARGS_BUDGET_MS });
    const secretInArguments = argScan.findings.some((f) => f.family === "secrets" && f.verdict === "injection");
    const current = criticNeeded(descriptor.effect, state.readUntypedContent)
      ? { toolCallId: ctx.toolCall.id, toolName: name, effect: descriptor.effect, destination: descriptor.destination, argsText, judgeAddressedInArgs: argScan.findings.some((f) => f.family === "judge_addressing") }
      : null;
    // Enforce waits for the critic because it decides the call; shadow lets the call go and records the critic's verdict when it arrives.
    const critic = current && mode === "enforce" ? await criticVerdict(ctx, current) : { verdict: { status: "not_needed" } as CriticVerdict };
    const nowMs = Date.now();
    const hint = grantOf(meta?.permission);
    const decideWith = (c: CriticVerdict) => decide({
      call: { toolName: name, ...(meta?.serverType ? { mcpServerId: meta.serverType } : {}), effect: descriptor.effect, destination: descriptor.destination, secretInArguments },
      // Kill switches arrive with PR-12; until then every snapshot is fresh and empty.
      kill: { snapshot: { epoch: 0, takenAtMs: nowMs, switches: [] }, scopes: { run: sessionId, user: userId, ...(agentSlug ? { agent: agentSlug } : {}), ...(meta?.serverType ? { mcp_server: meta.serverType } : {}), tool: name }, nowMs },
      conversation: state,
      critic: c,
      policy: { ...(hint ? { permissionHint: hint } : {}), judgeAvailable: criticEnabled(opts.critic), auditAvailable: true },
    });
    const verdict = decideWith(critic.verdict);
    const decision: C1Decision = {
      decisionId: randomUUID(), decision: verdict.decision, reasonCode: verdict.reasonCode, risk: state.risk, privateData: state.privateData, pendingVerdicts: state.pendingVerdicts, toolCallId: ctx.toolCall.id,
      criticStatus: critic.verdict.status,
      ...(critic.verdict.level ? { criticLevel: critic.verdict.level } : {}),
      ...(critic.risk ? { criticSource: critic.risk.source, criticCategories: critic.risk.categories, criticReasons: critic.risk.reasons } : {}),
      ...(critic.ms !== undefined ? { judgeMs: critic.ms } : {}),
    };
    if (current && mode !== "enforce") {
      void criticVerdict(ctx, current).then((r) => {
        if (!r.risk) return;
        const would = decideWith(r.verdict);
        queueGovernance({ ...base(), eventType: "critic_verdict", toolCallId: ctx.toolCall.id, toolName: name, ...(meta?.serverType ? { mcpServerId: meta.serverType } : {}), subjectKind: "c1", subjectId: decision.decisionId, decision: would.decision, reasonCode: would.reasonCode, reasonText: `shadow: would decide ${would.decision} (${would.reasonCode}); critic ${r.risk.source} ${r.risk.level}${r.risk.reasons.length > 0 ? `: ${r.risk.reasons.join("; ")}` : ""}`.slice(0, 1_900), checkTierReached: r.risk.source === "xor" ? "xor_judge" : "parser", ...(r.ms !== undefined ? { judgeMs: r.ms } : {}), matchedRuleIds: criticTags(r.risk) });
      }).catch((err) => log.warn(`[governance] critic failed session=${sessionId}: ${err instanceof Error ? err.message : String(err)}`));
    }
    decisions.set(ctx.toolCall.id, decision);
    stats.decisions++;
    const event: GovernanceEvent = {
      ...base(),
      eventType: "tool_call",
      toolCallId: ctx.toolCall.id,
      toolName: name,
      ...(meta?.serverType ? { mcpServerId: meta.serverType } : {}),
      decision: verdict.decision,
      reasonCode: verdict.reasonCode,
      reasonText: verdict.reasonText,
      policyVersion: verdict.policyVersion,
      scannerVersion: argScan.scannerVersion,
      toolEffect: descriptor.effect,
      destinationKind: descriptor.destination.kind,
      ...(descriptor.destination.host ? { destinationHost: descriptor.destination.host } : {}),
      riskLevelAtCall: state.risk,
      carriedPrivateData: state.privateData,
      argumentsRedacted: secretInArguments ? "[redacted: secret in arguments]" : argsText.slice(0, 2_048),
      checkTierReached: critic.risk?.source === "xor" ? "xor_judge" : "parser",
      ...(critic.ms !== undefined ? { judgeMs: critic.ms } : {}),
      ...(critic.risk ? { matchedRuleIds: criticTags(critic.risk) } : {}),
      ...(critic.risk && critic.risk.reasons.length > 0 ? { reasonText: `${verdict.reasonText} Critic: ${critic.risk.reasons.join("; ")}`.slice(0, 1_900) } : {}),
      gateMs: Math.round(performance.now() - t0),
      subjectKind: "c1",
      subjectId: decision.decisionId,
    };
    // An MCP call is recorded once, by C2 in claw-auth, which receives this decision with the call; a call C1
    // stops here never reaches claw-auth, so C1 records that one itself.
    if (meta?.serverType) {
      if (verdict.decision === "block" && mode === "enforce" && !(await recordGovernanceNow(event))) stats.auditFailures++;
    } else if (descriptor.effect !== "read") {
      const recorded = await recordGovernanceNow(event);
      if (!recorded) {
        stats.auditFailures++;
        if (mode === "enforce") return { block: true, reason: "Blocked by policy (GOV-AUDIT-UNAVAILABLE): the audit log is unavailable, so no side effect can run. Do not retry; tell the user." };
      }
    } else {
      queueGovernance(event);
    }
    if (verdict.decision === "block") {
      stats.blocks++;
      log.info(`[governance] C1 ${mode} block session=${sessionId} tool=${name} ${verdict.reasonCode}`);
      if (mode === "enforce") return { block: true, reason: `Blocked by policy (${verdict.reasonCode}): ${verdict.reasonText} Do not retry; tell the user.` };
    }
    // The outcome's duration counts from here, after the decision and its record.
    started.set(ctx.toolCall.id, Date.now());
    return undefined;
  };

  const run: RunGovernance = {
    state,
    stats,
    install(agent) {
      const baseStream = agent.streamFn as StreamFn | undefined;
      if (typeof baseStream === "function") {
        agent.streamFn = (model: unknown, context: unknown, options?: unknown) => {
          if (componentMode("A") !== "off") {
            try {
              inspectContext(context);
            } catch (err) {
              log.warn(`[governance] A failed session=${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          return baseStream(model, context, options);
        };
      }
      const baseAfter = agent.afterToolCall;
      agent.afterToolCall = async (ctx, signal) => {
        const override = baseAfter ? await baseAfter(ctx, signal) : undefined;
        if (componentMode("B") !== "off") {
          try {
            afterTool(ctx, override);
          } catch (err) {
            log.warn(`[governance] B failed session=${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return override;
      };
      const baseBefore = agent.beforeToolCall;
      agent.beforeToolCall = async (ctx, signal) => {
        const mode = componentMode("C1");
        if (mode !== "off") {
          try {
            const blocked = await gate(ctx, mode);
            if (blocked) return blocked;
          } catch (err) {
            log.warn(`[governance] C1 failed session=${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return baseBefore ? baseBefore(ctx, signal) : undefined;
      };
      if (opts.role !== "subagent") {
        byRun.set(sessionId, run);
        queueGovernance({ ...base(), loadedVersionIds: [] });
      }
    },
    inspectAnswer(text) {
      if (componentMode("D") === "off" || !text) return { verdict: "clean", removed: 0, text };
      const r = scan(text, "agent_answer", Date.now() + SCAN_BUDGET_MS);
      record(r, { foundIn: "agent_answer" }, text);
      const check = checkAnswer(text, { allowedHosts: allowedRenderHosts(), privateData: state.privateData });
      for (const link of check.links) {
        queueGovernance(undefined, { sessionId, userId, foundIn: "agent_answer", ...(conversationId ? { conversationId } : {}), chunkSha256: sha256Hex(text), foundByCheck: "parser", verdict: "suspicious", ruleId: `output.${link.reason}`, ruleFamily: "exfiltration", score: 0.8, startOffset: 0, endOffset: 0, redactedExcerpt: link.host, scanProfile: "agent_answer", scannerVersion: "output-check-1" });
        stats.findings++;
      }
      if (check.links.length > 0) log.info(`[governance] D ${componentMode("D")} session=${sessionId} would remove ${check.links.length} link(s): ${check.links.map((l) => `${l.host}(${l.reason})`).join(", ")}`);
      return { verdict: r.verdict, removed: check.links.length, text: componentMode("D") === "enforce" ? check.text : text };
    },
    async finish() {
      if (opts.role !== "subagent") byRun.delete(sessionId);
      log.info(`[governance] session=${sessionId} risk=${state.risk} private=${state.privateData} scanned=${stats.scanned} misses=${stats.coverageMisses} findings=${stats.findings} decisions=${stats.decisions} blocks=${stats.blocks} auditFailures=${stats.auditFailures}`);
      await flushGovernance();
    },
  };
  return run;
}
