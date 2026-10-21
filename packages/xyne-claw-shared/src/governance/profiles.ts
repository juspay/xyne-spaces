import type { ContentKind, ProfileOverrides, ProfileSettings, RuleFamily } from "./types.js";
import { RULE_FAMILIES } from "./types.js";

type Families = Partial<Record<RuleFamily, number>>;

function profile(kind: ContentKind, phrase: number, regex: number, families: Families): ProfileSettings {
  return { kind, phraseMultiplier: phrase, regexMultiplier: regex, familyMultipliers: families, unsureAt: 0.3, flagAt: 0.6, maxBytes: 131072 };
}

const PLAIN: Families = { sensitive_paths: 0.7 };
const INSTRUCTIONS_EXPECTED: Families = { instruction_override: 0.5, sensitive_paths: 0.7 };
// An answer is the model's own text: only what could carry data out or forge a role keeps full weight.
const ANSWER: Families = Object.fromEntries(
  RULE_FAMILIES.map((f) => [f, f === "exfiltration" || f === "role_forgery" || f === "framework_imitation" ? 1 : 0.5]),
);

export const PROFILES: Record<ContentKind, ProfileSettings> = {
  skill: profile("skill", 1, 1, INSTRUCTIONS_EXPECTED),
  prompt_layer: profile("prompt_layer", 1, 1, PLAIN),
  memory_file: profile("memory_file", 1, 1, PLAIN),
  user_instruction: profile("user_instruction", 1, 1, PLAIN),
  agent_config_text: profile("agent_config_text", 1, 1, PLAIN),
  mcp_tool_definition: profile("mcp_tool_definition", 1.5, 1.5, { sensitive_paths: 1 }),
  mcp_server_package: profile("mcp_server_package", 1, 1, PLAIN),
  code_constant: profile("code_constant", 1, 1, INSTRUCTIONS_EXPECTED),
  // People discuss prompt injection, so phrase rules weigh less in what a person typed.
  user_message: profile("user_message", 0.3, 1, {}),
  thread_text: profile("thread_text", 1, 1, PLAIN),
  tool_result: profile("tool_result", 1, 1, PLAIN),
  subagent_result: profile("subagent_result", 1, 1, PLAIN),
  compaction_summary: profile("compaction_summary", 1, 1, PLAIN),
  agent_written_text: profile("agent_written_text", 1, 1, PLAIN),
  agent_answer: profile("agent_answer", 1, 1, ANSWER),
};

export function resolveProfile(kind: ContentKind, overrides?: ProfileOverrides): ProfileSettings {
  const base = PROFILES[kind] ?? PROFILES.tool_result;
  if (!overrides) return base;
  const given = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined && !Number.isNaN(v)));
  return { ...base, ...given, familyMultipliers: { ...base.familyMultipliers, ...overrides.familyMultipliers } };
}
