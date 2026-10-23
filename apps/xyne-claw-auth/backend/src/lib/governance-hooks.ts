/**
 * Governance extension points. The governance implementation is private: it lives under
 * src/extensions/ (loaded by http/extension.ts) and registers itself here when it loads. Without it
 * every hook is a no-op: calls are allowed, nothing is recorded, skills load as stored and no kill
 * switch exists. Public code calls `governance.*` and never imports the implementation.
 */
export type GateSite = "mcp_call" | "actions_sign" | "approval_executor" | "write_action" | "app_callback";
export type ComponentMode = "off" | "shadow" | "enforce";
export type DecisionKind = "allow" | "ask" | "block";

export interface ToolAnnotations {
  readOnlyHint?: boolean | undefined;
  destructiveHint?: boolean | undefined;
  openWorldHint?: boolean | undefined;
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
  /** The listing's description of the tool; its opening verb classifies a name that has none. */
  description?: string | undefined;
  annotations?: ToolAnnotations | undefined;
  c1?: C1Handoff | undefined;
}

export interface GateResult {
  decision: DecisionKind;
  reasonCode: string;
  reasonText: string;
  policyVersion: string;
  mode: ComponentMode;
  /** True when the gate enforces, or a kill switch decided the call; the caller then acts on block or ask. */
  enforce: boolean;
  effect: string;
  destinationKind: string;
  recorded: boolean;
}

export interface KillSwitchMatch {
  scopeKind: string;
  scopeId: string;
  mode: string;
  reason?: string | null | undefined;
}

export interface SkillBundleFile {
  relativePath: string;
  content: string;
  contentType?: string | null | undefined;
}
export interface SkillRow {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  description: string;
  content: string;
  scope: string;
  files?: SkillBundleFile[] | undefined;
}
export interface SkillWrite {
  writtenBy: string;
  userId?: string | undefined;
  agentId?: string | undefined;
  conversationId?: string | undefined;
  approvedVia?: string | undefined;
  baselineIfFirst?: boolean | undefined;
}
export interface RunSkill {
  slug: string;
  name: string;
  description: string;
  content: string;
  files?: SkillBundleFile[] | undefined;
  versionId?: string | undefined;
  contentSha256?: string | undefined;
}
export interface SkillVersionSummary {
  approvalStatus: string;
  parserVerdict?: string | null | undefined;
}
export interface GovernanceEventInput {
  orgId: string;
  eventType: string;
  [field: string]: unknown;
}

export interface GovernanceHooks {
  /** off | shadow | enforce for one component (A, B, C1, C2, D, registry, kill); off when not installed. */
  componentMode(component: string): ComponentMode;
  /** C2: decides one tool call before its side effect. */
  gateCall(input: GateInput): Promise<GateResult>;
  killSwitchForTool(serverType: string, tool: string): KillSwitchMatch | null;
  killForAdmission(scopes: { orgId: string; agentSlug?: string | undefined; userId?: string | undefined }): KillSwitchMatch | null;
  /** The registry's loader: serves each skill's approved bytes, or the skills unchanged when not installed. */
  resolveRunSkills(skills: readonly SkillRow[], runId?: string | undefined): Promise<{ skills: RunSkill[] }>;
  commitSkillVersion(skill: SkillRow, write: SkillWrite): Promise<unknown>;
  currentSkillVersion(skill: SkillRow): Promise<SkillVersionSummary | null>;
  queueGovernanceEvent(event: GovernanceEventInput): void;
  flushGovernanceEvents(): Promise<number>;
}

const stripSkill = (s: SkillRow): RunSkill => ({ slug: s.slug, name: s.name, description: s.description ?? "", content: s.content, ...(s.files && s.files.length > 0 ? { files: s.files } : {}) });

const notInstalled: GovernanceHooks = {
  componentMode: () => "off",
  gateCall: async () => ({ decision: "allow", reasonCode: "GOV-ALLOW", reasonText: "Governance is not installed.", policyVersion: "", mode: "off", enforce: false, effect: "unknown", destinationKind: "unknown", recorded: false }),
  killSwitchForTool: () => null,
  killForAdmission: () => null,
  resolveRunSkills: async (skills) => ({ skills: skills.map(stripSkill) }),
  commitSkillVersion: async () => null,
  currentSkillVersion: async () => null,
  queueGovernanceEvent: () => undefined,
  flushGovernanceEvents: async () => 0,
};

export const governance: GovernanceHooks = { ...notInstalled };

/** The private implementation calls this once when it loads. */
export function registerGovernanceHooks(impl: Partial<GovernanceHooks>): void {
  Object.assign(governance, impl);
}

/** A deny grant stays a deny; a forced ask (a write tool) only tightens an allow. */
export function effectiveGrant(permission: string | undefined, forceAsk: boolean): "allow" | "ask" | "deny" {
  if (permission === "deny") return "deny";
  if (forceAsk) return "ask";
  return permission === "ask" ? "ask" : "allow";
}

export function blockedToolResultText(gate: Pick<GateResult, "reasonCode" | "reasonText">): string {
  return `Blocked by policy (${gate.reasonCode}): ${gate.reasonText} Do not retry; tell the user.`;
}
