/**
 * Per-hub selection rules and confidence thresholds (stage E).
 * The implementation lives in xyne-claw-shared so xyne-claw's streamed agent
 * draft applies the same rules; this module keeps the local import path.
 */
export {
  SHORTLIST_TOP_K,
  SUGGEST_BUDGET_MS,
  SELECTION_THRESHOLDS,
  BUILTIN_RULE_TABLE,
  selectionThreshold,
  namedItemConfidence,
  applySkillThresholds,
  applyKnowledgeThresholds,
  applySubagentThresholds,
  applyBuiltinThresholds,
  applyMcpThresholds,
} from "xyne-claw-shared";
export type {
  HubPickKind,
  JudgedPick,
  HubJudgement,
  AppliedHubResult,
} from "xyne-claw-shared";
