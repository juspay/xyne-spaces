import {
  JUDGE_LIMITS,
  POLICY_VERSION,
  STATIC_CONTENT_KINDS,
  type Approver,
  type ChangeClass,
  type CheckPlan,
  type DetonatorPlan,
  type DynamicContentKind,
  type DynamicPlanInput,
  type JudgePlan,
  type ParserPlan,
  type PlanInput,
  type StaticPlanInput,
} from "./types.js";

type Steps = readonly [parser: ParserPlan, judge: JudgePlan, detonator: DetonatorPlan, approver: Approver];

const STRICTEST_STATIC: Steps = ["whole", "whole", "if_executable", "claw_admin"];
const STRICTEST_DYNAMIC: Steps = ["whole", "always", "skip", "nobody"];

const STATIC: Readonly<Record<ChangeClass, Steps>> = {
  hash_approved: ["skip", "skip", "skip", "nobody"],
  hash_scanned_same_profile: ["reuse", "reuse", "reuse", "as_reused"],
  text_edit_by_person: ["whole", "whole", "skip", "owner_or_claw_admin"],
  written_by_agent: ["whole", "whole", "if_executable", "owner"],
  executable_changed: ["whole", "whole", "always", "claw_admin"],
  new_reach: ["whole", "whole", "if_executable", "claw_admin"],
  promotion_or_new_server: ["whole", "whole", "if_executable", "claw_admin"],
  rule_pack_change: ["rescan_approved", "where_parser_changed", "skip", "hold_and_alert"],
  judge_change: ["skip", "rejudge_passed", "skip", "hold_and_alert"],
  admin_override: ["record_only", "skip", "skip", "admin_with_reason"],
};

const DYNAMIC_JUDGE: Readonly<Record<DynamicContentKind, JudgePlan>> = {
  user_message: "xor_if_side_effect_tool",
  thread_text: "xor_if_side_effect_tool",
  tool_result: "xor_if_side_effect_tool",
  subagent_result: "xor_if_side_effect_tool",
  compaction_summary: "xor_if_side_effect_tool",
  agent_written_text: "always",
  agent_answer: "skip",
};

const own = <T>(table: Readonly<Record<string, T>>, key: unknown): T | undefined =>
  typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined;

function staticSteps(input: StaticPlanInput): Steps {
  const row = own(STATIC, input?.change);
  if (!row || !(STATIC_CONTENT_KINDS as readonly string[]).includes(input.kind)) return STRICTEST_STATIC;
  const [parser, judge, detonator, approver] = row;
  const personal = input.scope === "personal";
  switch (input.change) {
    case "text_edit_by_person": {
      const diffable = input.kind === "skill" || input.kind === "mcp_tool_definition";
      return [parser, diffable ? "changed" : "whole", detonator, personal ? "automatic_if_clean" : approver];
    }
    case "written_by_agent":
      return [parser, judge, detonator, input.writingRunReadOnlyTypedText === true ? "automatic_if_clean" : approver];
    case "executable_changed":
      return [parser, judge, detonator, personal ? "owner" : approver];
    default:
      return row;
  }
}

function dynamicSteps(input: DynamicPlanInput): Steps {
  const judge = own(DYNAMIC_JUDGE, input.kind);
  if (!judge) return STRICTEST_DYNAMIC;
  const summary = input.kind === "subagent_result" || input.kind === "compaction_summary";
  if (summary && input.sourceHadFinding === true) return STRICTEST_DYNAMIC;
  if (judge === "xor_if_side_effect_tool" && input.agentHoldsSideEffectTool !== true) return ["whole", "if_unsure", "skip", "nobody"];
  return ["whole", judge, "skip", "nobody"];
}

export function planChecks(input: PlanInput): CheckPlan {
  const [parser, judge, detonator, approver] = input?.mode === "dynamic" ? dynamicSteps(input) : staticSteps(input);
  return {
    parser,
    judge,
    detonator,
    approver,
    maxJudgeChunks: JUDGE_LIMITS.maxChunksPerResult,
    judgeWaitMs: JUDGE_LIMITS.gateWaitMs,
    policyVersion: POLICY_VERSION,
  };
}
