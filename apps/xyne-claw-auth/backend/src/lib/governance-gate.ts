/**
 * C2: the one claw-auth function that decides a tool call, called from /mcp/call, /actions/sign,
 * every approval executor and runner.callTool. It gathers the inputs, runs the pure decide(), writes
 * the tool_call event (before the call when it has a side effect) and tells the caller whether the
 * component mode lets it act on the answer. In shadow it only records and never throws.
 */
import {
  componentMode,
  decide,
  resolveToolDescriptor,
  scanText,
  type ComponentMode,
  type ConversationState,
  type DecisionKind,
  type Grant,
  type KillSwitch,
  type RiskLevel,
  type CriticVerdict,
  type ToolAnnotations,
} from "xyne-claw-shared/governance";
import { prisma } from "../db.js";
import { orgIdForUser } from "./audit.js";
import { queueGovernanceEvent, recordGovernanceEvent, type GovernanceEventInput } from "./governance-audit.js";
import { currentKillSnapshot, killForTool } from "./governance-kill.js";
import { createLogger } from "../logger.js";

const log = createLogger("governance-gate");

export type GateSite = "mcp_call" | "actions_sign" | "approval_executor" | "write_action" | "app_callback";

/** A deny grant stays a deny; a forced ask (a write tool) only tightens an allow. */
export function effectiveGrant(permission: string | undefined, forceAsk: boolean): "allow" | "ask" | "deny" {
  if (permission === "deny") return "deny";
  if (forceAsk) return "ask";
  return permission === "ask" ? "ask" : "allow";
}

/** What claw's C1 sends along with an MCP call. */
export interface C1Handoff {
  decisionId?: string | undefined;
  decision?: string | undefined;
  reasonCode?: string | undefined;
  risk?: string | undefined;
  privateData?: boolean | undefined;
  pendingVerdicts?: number | undefined;
  toolCallId?: string | undefined;
  criticStatus?: string | undefined;
  criticLevel?: string | undefined;
  criticSource?: string | undefined;
  criticCategories?: string[] | undefined;
  criticReasons?: string[] | undefined;
  judgeMs?: number | undefined;
}

export interface GateInput {
  site: GateSite;
  userId: string;
  orgId?: string | undefined;
  agentSlug?: string | undefined;
  /** The run's session id (claw's sessionId); resolves the run, org and conversation. */
  sessionId?: string | undefined;
  conversationId?: string | undefined;
  serverType: string;
  tool: string;
  params?: Record<string, unknown> | undefined;
  /** The agent's own grant for the tool, before any forced ask; a deny here always blocks. */
  grant?: string | undefined;
  /** The permission the caller sent; it can only tighten. */
  permissionHint?: string | undefined;
  writeTool?: boolean | undefined;
  annotations?: ToolAnnotations | undefined;
  c1?: C1Handoff | undefined;
}

export interface GateResult {
  decision: DecisionKind;
  reasonCode: string;
  reasonText: string;
  policyVersion: string;
  mode: ComponentMode;
  /** True when C2 enforces, or a kill switch decided the call and the kill component enforces; the caller then acts on block or ask. */
  enforce: boolean;
  effect: string;
  destinationKind: string;
  recorded: boolean;
}

export interface RunContext {
  runId?: string | undefined;
  orgId?: string | undefined;
  userId?: string | undefined;
  agentSlug?: string | undefined;
  conversationId?: string | undefined;
}

const RUN_TTL_MS = 10 * 60_000;
const runs = new Map<string, { at: number; ctx: RunContext }>();

/** The run behind a session id, cached: events from claw carry the session id, not the org. */
export async function runContextForSession(sessionId: string | undefined): Promise<RunContext> {
  if (!sessionId) return {};
  const hit = runs.get(sessionId);
  if (hit && Date.now() - hit.at < RUN_TTL_MS) return hit.ctx;
  const run = await prisma.agentRun.findUnique({ where: { sessionId }, select: { id: true, orgId: true, userId: true, agentSlug: true, conversationId: true } });
  const ctx: RunContext = run ? { runId: run.id, orgId: run.orgId, userId: run.userId, agentSlug: run.agentSlug, conversationId: run.conversationId ?? undefined } : {};
  if (runs.size > 5_000) runs.clear();
  runs.set(sessionId, { at: Date.now(), ctx });
  return ctx;
}

const RISKS: readonly RiskLevel[] = ["none", "elevated", "high"];
const stricter = (a: RiskLevel, b: RiskLevel): RiskLevel => (RISKS.indexOf(a) >= RISKS.indexOf(b) ? a : b);
const grantOf = (p: unknown): Grant | undefined => (p === "allow" || p === "ask" || p === "deny" ? p : undefined);

/** A call that arrives without C1's state is treated as elevated with private data, never as risk none. */
function conversationFrom(c1: C1Handoff | undefined): ConversationState {
  if (!c1 || !RISKS.includes(c1.risk as RiskLevel)) return { risk: "elevated", privateData: true, pendingVerdicts: 0, readUntypedContent: true };
  return {
    risk: stricter(c1.risk as RiskLevel, "none"),
    privateData: c1.privateData === true,
    pendingVerdicts: typeof c1.pendingVerdicts === "number" ? c1.pendingVerdicts : 0,
    readUntypedContent: true,
  };
}

/** Server and tool switches, checked inside runner.callTool as well. Kill switches arrive with PR-12. */
export function killSwitchForTool(serverType: string, tool: string): KillSwitch | null {
  return killForTool(serverType, tool);
}

export function blockedToolResultText(gate: Pick<GateResult, "reasonCode" | "reasonText">): string {
  return `Blocked by policy (${gate.reasonCode}): ${gate.reasonText} Do not retry; tell the user.`;
}

export async function gateCall(input: GateInput): Promise<GateResult> {
  const mode = componentMode("C2");
  const allow = (reasonCode: string, reasonText: string, extra: Partial<GateResult> = {}): GateResult => ({
    decision: "allow", reasonCode, reasonText, policyVersion: "", mode, enforce: false, effect: "unknown", destinationKind: "unknown", recorded: false, ...extra,
  });
  if (mode === "off") return allow("GOV-ALLOW", "Governance is off for C2.");
  try {
    const descriptor = resolveToolDescriptor({ toolName: input.tool, serverType: input.serverType, writeTool: input.writeTool, annotations: input.annotations, args: input.params });
    const argsText = JSON.stringify(input.params ?? {}).slice(0, 65_536);
    const argScan = scanText({ text: argsText, kind: "agent_written_text", outbound: true }, { deadlineMs: Date.now() + 50 });
    const secretInArguments = argScan.findings.some((f) => f.family === "secrets" && f.verdict === "injection");
    const conversation = conversationFrom(input.c1);
    const hint = grantOf(input.permissionHint);
    const own = grantOf(input.grant);
    const grant = own === "deny" ? "deny" : input.writeTool ? "ask" : own;
    const level = input.c1?.criticLevel;
    const critic: CriticVerdict = level === "low" || level === "medium" || level === "high" || level === "critical" ? { status: "decided", level } : input.c1?.criticStatus === "unavailable" ? { status: "unavailable" } : { status: "not_needed" };
    const run = await runContextForSession(input.sessionId);
    const orgId = input.orgId ?? run.orgId ?? (await orgIdForUser(input.userId));
    const nowMs = Date.now();
    const killMode = componentMode("kill");
    const verdict = decide({
      call: { toolName: input.tool, mcpServerId: input.serverType, effect: descriptor.effect, destination: descriptor.destination, secretInArguments },
      kill: { snapshot: killMode === "off" ? { epoch: 0, takenAtMs: nowMs, switches: [] } : currentKillSnapshot(), scopes: { user: input.userId, mcp_server: input.serverType, tool: input.tool, ...(input.agentSlug ? { agent: input.agentSlug } : {}), ...(input.sessionId ? { run: input.sessionId } : {}), ...(orgId ? { org: orgId } : {}) }, nowMs },
      conversation,
      critic,
      policy: { ...(grant ? { grant } : {}), ...(hint ? { permissionHint: hint } : {}), judgeAvailable: Boolean(input.c1), auditAvailable: true },
    });

    // A switch an admin set acts whenever the kill component enforces, whatever C2's own mode.
    const enforce = mode === "enforce" || (verdict.killSwitch !== undefined && killMode === "enforce");
    const result: GateResult = {
      decision: verdict.decision, reasonCode: verdict.reasonCode, reasonText: verdict.reasonText, policyVersion: verdict.policyVersion,
      mode, enforce, effect: descriptor.effect, destinationKind: descriptor.destination.kind, recorded: false,
    };
    if (!orgId) {
      log.warn(`[governance-gate] no org for user=${input.userId} site=${input.site}; decision not recorded`);
      return result;
    }
    if (verdict.killSwitch) {
      queueGovernanceEvent({ orgId, eventType: "kill_switch_enforced", actorKind: "system", subjectKind: `kill:${verdict.killSwitch.scopeKind}`, subjectId: verdict.killSwitch.scopeId, runId: run.runId ?? null, toolName: input.tool, mcpServerId: input.serverType, decision: verdict.decision, reasonCode: verdict.reasonCode, reasonText: enforce ? "enforced at C2" : "shadow: would enforce at C2" });
    }
    const event: GovernanceEventInput = {
      orgId,
      eventType: "tool_call",
      actorKind: "agent",
      actorId: input.agentSlug ?? run.agentSlug ?? null,
      onBehalfOfUserId: input.userId,
      runId: run.runId ?? null,
      conversationId: input.conversationId ?? run.conversationId ?? null,
      toolCallId: input.c1?.toolCallId ?? null,
      mcpServerId: input.serverType,
      toolName: input.tool,
      decision: verdict.decision,
      reasonCode: verdict.reasonCode,
      reasonText: input.c1?.criticReasons?.length ? `${verdict.reasonText} Critic: ${input.c1.criticReasons.join("; ")}`.slice(0, 1_900) : verdict.reasonText,
      policyVersion: verdict.policyVersion,
      scannerVersion: argScan.scannerVersion,
      checkTierReached: input.c1?.criticSource === "xor" ? "xor_judge" : "parser",
      ...(typeof input.c1?.judgeMs === "number" ? { judgeMs: input.c1.judgeMs } : {}),
      toolEffect: descriptor.effect,
      destinationKind: descriptor.destination.kind,
      destinationHost: descriptor.destination.host ?? null,
      riskLevelAtCall: conversation.risk,
      ...(critic.status === "decided" ? { matchedRuleIds: [`critic.${input.c1?.criticSource ?? "c1"}.${critic.level}`, ...(input.c1?.criticCategories ?? []).map((c) => `critic.${c}`)] } : {}),
      carriedPrivateData: conversation.privateData,
      argumentsRedacted: secretInArguments ? "[redacted: secret in arguments]" : argsText.slice(0, 2_048),
      gateMs: Date.now() - nowMs,
      subjectKind: input.site,
      subjectId: input.c1?.decisionId ?? null,
    };
    if (descriptor.effect !== "read") {
      try {
        await recordGovernanceEvent(event);
        result.recorded = true;
      } catch (err) {
        log.error(`[governance-gate] side-effect decision not recorded site=${input.site} tool=${input.tool}:`, err instanceof Error ? err.message : err);
        if (mode === "enforce") return { ...result, decision: "block", reasonCode: "GOV-AUDIT-UNAVAILABLE", reasonText: "The audit log is unavailable, so no side effect can run." };
      }
    } else {
      queueGovernanceEvent(event);
      result.recorded = true;
    }
    if (verdict.decision !== "allow") log.info(`[governance-gate] ${mode} ${verdict.decision} site=${input.site} server=${input.serverType} tool=${input.tool} ${verdict.reasonCode}`);
    return result;
  } catch (err) {
    log.error(`[governance-gate] failed site=${input.site} tool=${input.tool}:`, err instanceof Error ? err.message : err);
    return allow("GOV-ALLOW", "Governance gate failed; recorded nothing.");
  }
}
