/**
 * Fallback System Skills for Xyne AI Agent
 *
 * These are used when Langfuse is not configured or a skill prompt is not found.
 * Format matches what Langfuse returns: frontmatter block followed by instructions.
 * Prompt name (key) must match the pattern: skill-{skillName}
 *
 * ─── HOW TO ADD A NEW SYSTEM SKILL ──────────────────────────────────────────
 *
 * 1. Create the skill prompt in Langfuse with name: skill-{skillName}
 *    (e.g. skill-chess, skill-sql-expert)
 *
 * 2. Add a fallback entry here in FALLBACK_SYSTEM_SKILLS:
 *
 *      const MY_SKILL_CONTENT = `---
 *      name: my-skill
 *      description: One-line description of what this skill does
 *      ---
 *
 *      # my-skill
 *
 *      Instructions for the AI agent...
 *
 *      ## Usage
 *      Describe when and how to use this skill.
 *
 *      ## Steps
 *      1. First step
 *      2. Second step
 *      `;
 *
 *      export const FALLBACK_SYSTEM_SKILLS: Record<string, string> = {
 *        'skill-my-skill': MY_SKILL_CONTENT,
 *      };
 *
 * 3. Add 'skill-my-skill' to SYSTEM_SKILL_PROMPT_NAMES below.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Map of Langfuse prompt names to their raw fallback content (frontmatter + instructions).
 * Empty until the first real system skill is added.
 */
export const FALLBACK_SYSTEM_SKILLS: Record<string, string> = {
  // 'skill-my-skill': MY_SKILL_CONTENT,
};

/**
 * Canonical list of system skill prompt names in Langfuse (skill-{name}).
 * Kept here (not in system-skills.ts) to avoid a circular import with prompts.ts.
 *
 * Add a new entry here when a new system skill is created in Langfuse.
 * Example: 'skill-chess', 'skill-sql-expert'
 */
export const SYSTEM_SKILL_PROMPT_NAMES: readonly string[] = [
  // 'skill-my-skill',
];

export type SystemSkillPromptName = (typeof SYSTEM_SKILL_PROMPT_NAMES)[number];

/**
 * Get raw fallback content for a system skill prompt by Langfuse prompt name
 */
export function getFallbackSystemSkill(promptName: string): string | null {
  return FALLBACK_SYSTEM_SKILLS[promptName] ?? null;
}
