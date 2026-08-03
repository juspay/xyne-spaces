/**
 * Skill Trigger Dispatcher
 *
 * Centralises the resolution, matching and formatting of agent-configured
 * skill triggers. Used by both the main agent loop and the subagent factory.
 *
 * A trigger deterministically loads a skill when a named tool is invoked:
 *   - "before" — skill content is injected into the conversation context on
 *                the next turn, after the tool has been called but before the
 *                LLM reasons about its result.
 *   - "after"  — skill content is appended to the tool result text.
 */

export type SkillTriggerWhen = "before" | "after";
export type SkillTriggerMatchMode = "exact" | "suffix" | "prefix" | "contains";

export interface SkillTrigger {
  /** Tool name (or pattern) to match. */
  toolName: string;
  /** Slug of the skill to inject. */
  skillSlug: string;
  /** Resolved markdown content of the skill. */
  skillContent: string;
  /** Lifecycle hook. */
  when: SkillTriggerWhen;
  /** How toolName should be matched against the actual tool name. */
  matchMode: SkillTriggerMatchMode;
  /** Optional framing instruction prepended to the skill content. */
  prompt?: string | undefined;
}

/** Raw shape received from agentConfig.skillTriggers (content not yet resolved). */
export interface RawSkillTrigger {
  toolName: string;
  skillSlug: string;
  when: string;
  matchMode?: string | undefined;
  prompt?: string | undefined;
}

const MATCH_MODE_PRECEDENCE: Record<SkillTriggerMatchMode, number> = {
  exact: 0,
  prefix: 1,
  suffix: 2,
  contains: 3,
};

export function normalizeMatchMode(value: string | undefined): SkillTriggerMatchMode {
  switch (value) {
    case "exact":
    case "prefix":
    case "contains":
      return value;
    case "suffix":
    default:
      // Legacy triggers did not specify matchMode and relied on suffix matching
      // (event.toolName.endsWith(t.toolName)). Preserve that default.
      return "suffix";
  }
}

/**
 * Resolve raw trigger entries against the agent's attached skills.
 * Triggers referencing a missing skill are dropped with a warning.
 */
export function resolveTriggers(
  raw: RawSkillTrigger[],
  skills: Array<{ name: string; content: string }> | undefined,
  options?: { log?: (message: string) => void },
): SkillTrigger[] {
  if (!raw.length) return [];

  return raw
    .filter((t) => t.toolName && t.skillSlug)
    .map((t) => {
      const skill = skills?.find((s) => s.name === t.skillSlug);
      if (!skill) {
        options?.log?.(`[skill-trigger] Dropping trigger for ${t.toolName}: skill ${t.skillSlug} not found`);
        return null;
      }
      return {
        toolName: t.toolName,
        skillSlug: t.skillSlug,
        skillContent: skill.content,
        when: t.when === "before" ? "before" : "after",
        matchMode: normalizeMatchMode(t.matchMode),
        ...(t.prompt ? { prompt: t.prompt } : {}),
      } as SkillTrigger;
    })
    .filter((t): t is SkillTrigger => t !== null);
}

/**
 * Test whether a trigger matches a concrete tool name.
 */
export function matchTrigger(toolName: string, trigger: SkillTrigger): boolean {
  switch (trigger.matchMode) {
    case "exact":
      return toolName === trigger.toolName;
    case "prefix":
      return toolName.startsWith(trigger.toolName);
    case "contains":
      return toolName.includes(trigger.toolName);
    case "suffix":
    default:
      return toolName.endsWith(trigger.toolName);
  }
}

/**
 * Sort triggers for deterministic application.
 * More specific match modes win; ties broken by original config order (stable).
 */
export function sortTriggers(triggers: SkillTrigger[]): SkillTrigger[] {
  return [...triggers].sort((a, b) => {
    const prec = MATCH_MODE_PRECEDENCE[a.matchMode] - MATCH_MODE_PRECEDENCE[b.matchMode];
    if (prec !== 0) return prec;
    return 0; // stable sort preserves config order
  });
}

/**
 * Format a single skill injection block.
 */
export function formatSkillInjection(trigger: SkillTrigger): string {
  return [
    `---`,
    `**[Skill Injected: ${trigger.skillSlug}]** _(configured by user in agent settings)_`,
    trigger.prompt ? `Instruction: ${trigger.prompt}` : "",
    "",
    trigger.skillContent,
    `---`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Given a list of triggers that have fired for one or more pending tools,
 * deduplicate by skill slug and format the combined injection text.
 */
export function formatCombinedInjection(triggers: SkillTrigger[]): string {
  const unique = Array.from(new Map(triggers.map((t) => [t.skillSlug, t])).values());
  if (unique.length === 0) return "";
  if (unique.length === 1) return formatSkillInjection(unique[0]!);
  return unique.map(formatSkillInjection).join("\n\n");
}
