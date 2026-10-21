import type { ReasonCode } from "./reason-codes.js";

export const POLICY_VERSION = "2026-10-21.1";
export const PARSER_VERSION = "1";

export const STATIC_CONTENT_KINDS = [
  "skill",
  "prompt_layer",
  "memory_file",
  "user_instruction",
  "agent_config_text",
  "mcp_tool_definition",
  "mcp_server_package",
  "code_constant",
] as const;
export type StaticContentKind = (typeof STATIC_CONTENT_KINDS)[number];

export const DYNAMIC_CONTENT_KINDS = [
  "user_message",
  "thread_text",
  "tool_result",
  "subagent_result",
  "compaction_summary",
  "agent_written_text",
  "agent_answer",
] as const;
export type DynamicContentKind = (typeof DYNAMIC_CONTENT_KINDS)[number];

export const CONTENT_KINDS = [...STATIC_CONTENT_KINDS, ...DYNAMIC_CONTENT_KINDS] as const;
export type ContentKind = StaticContentKind | DynamicContentKind;

export type TrustTier = "untrusted" | "reviewed" | "trusted";

export interface Channel {
  kind: "surface" | "tool" | "mcp_server" | "subagent" | "system";
  name: string;
  trustTier?: TrustTier;
}

export const VERDICTS = ["clean", "unsure", "unverified", "suspicious", "injection"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const VERDICT_ORDER: Readonly<Record<Verdict, number>> = {
  clean: 0,
  unsure: 1,
  unverified: 2,
  suspicious: 3,
  injection: 4,
};
export function worstVerdict(first: Verdict, ...rest: Verdict[]): Verdict {
  let worst = first;
  for (const v of rest) if (VERDICT_ORDER[v] > VERDICT_ORDER[worst]) worst = v;
  return worst;
}

export const EFFECT_CLASSES = ["read", "write", "publish", "send", "delete", "execute", "persist", "admin"] as const;
export type EffectClass = (typeof EFFECT_CLASSES)[number];
export function isSideEffect(effect: EffectClass | "unknown"): boolean {
  return effect !== "read";
}

export type RiskLevel = "none" | "elevated" | "high";
export type CriticLevel = "low" | "medium" | "high" | "critical";
export type CheckKind = "parser" | "xor_judge" | "llm_judge" | "detonator";
export type ComponentMode = "off" | "shadow" | "enforce";

export const RULE_FAMILIES = [
  "hidden_unicode",
  "secrets",
  "role_forgery",
  "framework_imitation",
  "exfiltration",
  "fake_tool_markup",
  "judge_addressing",
  "sensitive_paths",
  "concealment",
  "persistence",
  "tool_poisoning",
  "instruction_override",
  "runtime_fetch",
  "shell_pipe",
  "eval_decoded",
  "encoded_blob",
  "binary_artifact",
] as const;
export type RuleFamily = (typeof RULE_FAMILIES)[number];

export interface Rule {
  id: string;
  family: RuleFamily;
  reasonCode: ReasonCode;
  /** 0..1; combined across rules as 1 - prod(1 - w). */
  weight: number;
  /** Lowercase literals, matched on the folded text. */
  phrases?: readonly string[];
  /** Regex source in a linear-time shape; every rule passes recheck in CI. */
  pattern?: string;
  flags?: string;
  /** A match decides alone: verdict injection. */
  hard?: boolean;
  judgeCannotClear?: boolean;
  kinds?: readonly ContentKind[];
  excludeKinds?: readonly ContentKind[];
  outboundOnly?: boolean;
}

export interface RulePack {
  id: string;
  version: string;
  rules: readonly Rule[];
  attribution?: string;
}

export interface ProfileSettings {
  kind: ContentKind;
  phraseMultiplier: number;
  regexMultiplier: number;
  familyMultipliers?: Partial<Record<RuleFamily, number>>;
  disabledFamilies?: readonly RuleFamily[];
  /** score >= unsureAt is unsure, >= flagAt is suspicious. */
  unsureAt: number;
  flagAt: number;
  maxBytes: number;
}

export type ProfileOverrides = Partial<Omit<ProfileSettings, "kind">>;

export const SIGNAL_KINDS = [
  "oversize",
  "ansi_escape",
  "control_bytes",
  "unicode_tags",
  "bidi_control",
  "zero_width",
  "variation_selectors",
  "confusables",
  "decoded_base64",
  "decoded_hex",
  "decoded_percent",
  "decoded_entities",
  "letter_spacing",
  "decoder_capped",
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export interface Signal {
  kind: SignalKind;
  count: number;
  weight: number;
}

/** Offsets into the original text, [start, end). */
export interface Span {
  start: number;
  end: number;
}

export type FindingSource = "text" | "hidden_payload" | "decoded";

export interface Finding {
  ruleId: string;
  family: RuleFamily;
  reasonCode: ReasonCode;
  verdict: Verdict;
  score: number;
  span: Span;
  excerpt: string;
  source: FindingSource;
  foundByCheck: CheckKind;
}

export interface ScanInput {
  text: string;
  kind: ContentKind;
  channel?: Channel;
  /** The text is a tool argument leaving the org. */
  outbound?: boolean;
}

export interface ScanOptions {
  packs?: readonly RulePack[];
  profile?: ProfileOverrides;
  /** Absolute time in the units of `now`, checked between views and rules; past it the result is unverified. */
  deadlineMs?: number;
  now?: () => number;
}

export interface ParserResult {
  verdict: Verdict;
  score: number;
  findings: Finding[];
  signals: Signal[];
  scannerVersion: string;
  kind: ContentKind;
  truncated: boolean;
  budgetExceeded: boolean;
  hiddenPayload?: string;
}

export interface Chunk {
  index: number;
  text: string;
  span: Span;
  sha256: string;
  tokens: number;
}

export interface ChunkOptions {
  targetTokens?: number;
  minTokens?: number;
  maxTokens?: number;
  /** Fraction of the target carried into the next chunk, 0.10 to 0.15. */
  overlap?: number;
  maxChunks?: number;
}

export const KILL_SCOPE_KINDS = ["run", "agent", "user", "mcp_server", "tool", "org", "platform"] as const;
export type KillScopeKind = (typeof KILL_SCOPE_KINDS)[number];
export type KillMode = "stop" | "read_only" | "ask_all";

export interface KillSwitch {
  scopeKind: KillScopeKind;
  scopeId: string;
  mode: KillMode;
  epoch: number;
  reason?: string;
  expiresAtMs?: number;
}

export interface KillSnapshot {
  epoch: number;
  takenAtMs: number;
  switches: readonly KillSwitch[];
}

/** The ids this call runs under; platform is "*". */
export type CallScopes = Partial<Record<KillScopeKind, string>>;

export const KILL_SNAPSHOT_MAX_AGE_MS = 10_000;

export type DestinationKind = "internal" | "external" | "untrusted_mcp" | "unknown";

export interface CallFacts {
  toolName: string;
  mcpServerId?: string;
  effect: EffectClass | "unknown";
  destination: { kind: DestinationKind; host?: string };
  secretInArguments?: boolean;
  decoyInArguments?: boolean;
  governanceAction?: boolean;
  onOrgBlockList?: boolean;
  onCriticalList?: boolean;
}

export interface ConversationState {
  risk: RiskLevel;
  privateData: boolean;
  privateSource?: string;
  pendingVerdicts: number;
  /** The conversation read anything a person in it did not type. */
  readUntypedContent: boolean;
}

export interface CriticVerdict {
  status: "not_needed" | "unavailable" | "decided";
  level?: CriticLevel;
}

export type Grant = "allow" | "ask" | "deny";

export interface PolicyInput {
  grant?: Grant;
  /** Sent by the caller; can only tighten. */
  permissionHint?: Grant;
  criticalBlockMode?: "block" | "ask";
  judgeAvailable: boolean;
  auditAvailable?: boolean;
}

export interface DecideInput {
  call: CallFacts;
  kill: { snapshot: KillSnapshot | null; scopes: CallScopes; nowMs: number };
  conversation: ConversationState;
  critic: CriticVerdict;
  policy: PolicyInput;
}

export type DecisionKind = "allow" | "ask" | "block";

export interface Decision {
  decision: DecisionKind;
  reasonCode: ReasonCode;
  reasonText: string;
  policyVersion: string;
  killSwitch?: KillSwitch;
}

export const CHANGE_CLASSES = [
  "hash_approved",
  "hash_scanned_same_profile",
  "text_edit_by_person",
  "written_by_agent",
  "executable_changed",
  "new_reach",
  "promotion_or_new_server",
  "rule_pack_change",
  "judge_change",
  "admin_override",
] as const;
export type ChangeClass = (typeof CHANGE_CLASSES)[number];

export type WrittenBy = "person" | "agent" | "synthesizer" | "seed" | "mcp_server" | "admin" | "build";
export type ItemScope = "personal" | "org" | "global";

export interface StaticPlanInput {
  mode: "static";
  kind: StaticContentKind;
  change: ChangeClass;
  writtenBy: WrittenBy;
  scope: ItemScope;
  executable: boolean;
  /** The writing run read nothing but its user's typed messages. */
  writingRunReadOnlyTypedText?: boolean;
}

export interface DynamicPlanInput {
  mode: "dynamic";
  kind: DynamicContentKind;
  agentHoldsSideEffectTool: boolean;
  parserVerdict?: Verdict;
  /** For summaries: the history it was made from had a finding. */
  sourceHadFinding?: boolean;
}

export type PlanInput = StaticPlanInput | DynamicPlanInput;

export type ParserPlan = "skip" | "reuse" | "whole" | "changed" | "record_only" | "rescan_approved";
export type JudgePlan =
  | "skip"
  | "reuse"
  | "whole"
  | "changed"
  | "if_unsure"
  | "xor_if_side_effect_tool"
  | "always"
  | "rejudge_passed"
  | "where_parser_changed";
export type DetonatorPlan = "skip" | "reuse" | "if_executable" | "always";
export type Approver =
  | "nobody"
  | "as_reused"
  | "automatic_if_clean"
  | "owner"
  | "owner_or_claw_admin"
  | "claw_admin"
  | "admin_with_reason"
  | "hold_and_alert";

export interface CheckPlan {
  parser: ParserPlan;
  judge: JudgePlan;
  detonator: DetonatorPlan;
  approver: Approver;
  maxJudgeChunks: number;
  judgeWaitMs: number;
  policyVersion: string;
}

export type JudgeLabel = "clean" | "suspicious" | "injection";

export interface JudgeChunkInput {
  key: string;
  text: string;
}

export interface JudgeControl {
  text: string;
  expected: "clean" | "injection";
}

export interface JudgeBatchItem {
  id: string;
  key: string | null;
  text: string;
  control?: "clean" | "injection";
}

export interface JudgeBatchState {
  nonce: string;
  codes: Readonly<Record<JudgeLabel, string>>;
  items: readonly JudgeBatchItem[];
}

export interface JudgeBatch {
  state: JudgeBatchState;
  instruction: string;
  body: string;
}

export interface JudgeAnswerItem {
  id: string;
  verdict: string;
  score: number;
  category?: string;
  quote?: string;
}

export type JudgeFailureKind =
  | "missing_id"
  | "duplicate_id"
  | "unknown_id"
  | "bad_code"
  | "bad_score"
  | "control_failed"
  | "quote_missing"
  | "quote_not_found";

export interface JudgeFailure {
  kind: JudgeFailureKind;
  id?: string;
}

export interface JudgeChunkVerdict {
  verdict: JudgeLabel;
  score: number;
  category?: string;
  quote?: string;
}

export interface JudgeCheck {
  ok: boolean;
  failures: JudgeFailure[];
  /** By caller key, only when ok. */
  verdicts: Record<string, JudgeChunkVerdict>;
}

export interface JudgeBuildOptions {
  controls: readonly JudgeControl[];
  randomBytes?: (n: number) => Uint8Array;
  maxChunks?: number;
}

export interface SplitBudget {
  callsLeft: number;
  budgetLeftMs: number;
}

export interface SplitPlan {
  batches: JudgeChunkInput[][];
  /** Chunks that failed alone: the caller marks them injection. */
  failed: JudgeChunkInput[];
  /** Chunks the budget could not cover: unverified. */
  leftovers: JudgeChunkInput[];
  budget: SplitBudget;
}

export const JUDGE_LIMITS = {
  maxChunksPerBatch: 12,
  maxChunksPerResult: 16,
  maxSplitCalls: 16,
  splitBudgetMs: 5_000,
  gateWaitMs: 2_000,
} as const;
