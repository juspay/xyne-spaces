import { describe, it, expect } from "vitest";
import { planChecks } from "./policy.js";
import {
  POLICY_VERSION,
  type Approver,
  type ChangeClass,
  type DetonatorPlan,
  type DynamicContentKind,
  type DynamicPlanInput,
  type JudgePlan,
  type ParserPlan,
  type PlanInput,
  type StaticPlanInput,
} from "./types.js";

type Steps = [ParserPlan, JudgePlan, DetonatorPlan, Approver];
const st = (p: Partial<StaticPlanInput> = {}): StaticPlanInput => ({
  mode: "static",
  kind: "skill",
  change: "text_edit_by_person",
  writtenBy: "person",
  scope: "org",
  executable: false,
  ...p,
});
const dy = (p: Partial<DynamicPlanInput> = {}): DynamicPlanInput => ({ mode: "dynamic", kind: "tool_result", agentHoldsSideEffectTool: true, ...p });
const expectPlan = (input: PlanInput, [parser, judge, detonator, approver]: Steps) =>
  expect(planChecks(input)).toEqual({ parser, judge, detonator, approver, maxJudgeChunks: 16, judgeWaitMs: 2000, policyVersion: POLICY_VERSION });

describe("planChecks static", () => {
  const agent: Partial<StaticPlanInput> = { change: "written_by_agent", writtenBy: "agent", kind: "memory_file" };
  const cases: Array<[string, Partial<StaticPlanInput>, Steps]> = [
    ["hash_approved loads", { change: "hash_approved" }, ["skip", "skip", "skip", "nobody"]],
    ["hash_scanned_same_profile reuses", { change: "hash_scanned_same_profile" }, ["reuse", "reuse", "reuse", "as_reused"]],
    ["person edits an org skill", {}, ["whole", "changed", "skip", "owner_or_claw_admin"]],
    ["person edits a personal skill", { scope: "personal" }, ["whole", "changed", "skip", "automatic_if_clean"]],
    ["person edits a tool description", { kind: "mcp_tool_definition" }, ["whole", "changed", "skip", "owner_or_claw_admin"]],
    ["person edits a global prompt layer", { kind: "prompt_layer", scope: "global" }, ["whole", "whole", "skip", "owner_or_claw_admin"]],
    ["agent writes memory", agent, ["whole", "whole", "if_executable", "owner"]],
    ["agent writes memory from typed text only", { ...agent, writingRunReadOnlyTypedText: true }, ["whole", "whole", "if_executable", "automatic_if_clean"]],
    ["executable changed in org scope", { change: "executable_changed", executable: true }, ["whole", "whole", "always", "claw_admin"]],
    ["executable changed in personal scope", { change: "executable_changed", executable: true, scope: "personal" }, ["whole", "whole", "always", "owner"]],
    ["new reach", { change: "new_reach", scope: "personal" }, ["whole", "whole", "if_executable", "claw_admin"]],
    ["promotion or new server", { change: "promotion_or_new_server", kind: "mcp_server_package" }, ["whole", "whole", "if_executable", "claw_admin"]],
    ["rule pack change", { change: "rule_pack_change" }, ["rescan_approved", "where_parser_changed", "skip", "hold_and_alert"]],
    ["judge change", { change: "judge_change" }, ["skip", "rejudge_passed", "skip", "hold_and_alert"]],
    ["admin override", { change: "admin_override", writtenBy: "admin" }, ["record_only", "skip", "skip", "admin_with_reason"]],
    ["unknown change is strictest", { change: "bogus" as ChangeClass }, ["whole", "whole", "if_executable", "claw_admin"]],
  ];
  it.each(cases)("%s", (_name, patch, steps) => expectPlan(st(patch), steps));
});

describe("planChecks dynamic", () => {
  const cases: Array<[string, Partial<DynamicPlanInput>, Steps]> = [
    ["user message with a side-effect tool", { kind: "user_message" }, ["whole", "xor_if_side_effect_tool", "skip", "nobody"]],
    ["thread text without a side-effect tool", { kind: "thread_text", agentHoldsSideEffectTool: false }, ["whole", "if_unsure", "skip", "nobody"]],
    ["tool result with a side-effect tool", {}, ["whole", "xor_if_side_effect_tool", "skip", "nobody"]],
    ["tool result without a side-effect tool", { agentHoldsSideEffectTool: false }, ["whole", "if_unsure", "skip", "nobody"]],
    ["subagent result whose source had a finding", { kind: "subagent_result", sourceHadFinding: true }, ["whole", "always", "skip", "nobody"]],
    ["compaction summary with a clean source", { kind: "compaction_summary", sourceHadFinding: false }, ["whole", "xor_if_side_effect_tool", "skip", "nobody"]],
    ["agent-written text", { kind: "agent_written_text", agentHoldsSideEffectTool: false }, ["whole", "always", "skip", "nobody"]],
    ["agent answer", { kind: "agent_answer" }, ["whole", "skip", "skip", "nobody"]],
    ["unknown kind is strictest", { kind: "bogus" as DynamicContentKind }, ["whole", "always", "skip", "nobody"]],
  ];
  it.each(cases)("%s", (_name, patch, steps) => expectPlan(dy(patch), steps));
});

describe("planChecks totality", () => {
  it.each([
    null,
    undefined,
    0,
    "static",
    [],
    {},
    { mode: "static", change: "constructor", kind: "skill" },
    { mode: "static", change: "__proto__", kind: "skill", scope: "personal" },
    { mode: "dynamic", kind: "toString" },
    { mode: "dynamic", kind: "constructor", agentHoldsSideEffectTool: "yes" },
  ])("returns the strictest plan for %j", (input) => {
    const dynamic = (input as { mode?: unknown } | null)?.mode === "dynamic";
    expectPlan(input as unknown as PlanInput, dynamic ? ["whole", "always", "skip", "nobody"] : ["whole", "whole", "if_executable", "claw_admin"]);
  });
});
