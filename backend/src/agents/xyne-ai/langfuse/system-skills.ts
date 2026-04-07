/**
 * System Skills — fetched from Langfuse (prompt name: skill-{name})
 * Falls back to hardcoded content when Langfuse is unavailable.
 */

import { logger } from '../../../utils/logger.js';
import { getPromptFromLangfuse } from './prompts.js';
import { getFallbackSystemSkill, SYSTEM_SKILL_PROMPT_NAMES } from './fallback-skills.js';

export { SYSTEM_SKILL_PROMPT_NAMES };
export type { SystemSkillPromptName } from './fallback-skills.js';

export interface SystemSkill {
  name: string;
  description: string;
  instructions: string;
}

// ============================================================================
// Frontmatter Parser
// ============================================================================

/**
 * Parse a skill document in frontmatter format:
 *
 *   ---
 *   name: skill-name
 *   description: Brief description
 *   ---
 *
 *   # skill-name
 *   Instructions...
 */
function parseFrontmatter(content: string): SystemSkill | null {
  // Match opening ---, frontmatter block, closing ---, then rest as instructions
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    logger.warn('[SystemSkills] Failed to parse frontmatter — unexpected format');
    return null;
  }

  const frontmatterBlock = match[1];
  const instructions = match[2].trim();

  let name = '';
  let description = '';

  for (const line of frontmatterBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key === 'name') name = value;
    else if (key === 'description') description = value;
  }

  if (!name || !description) {
    logger.warn('[SystemSkills] Frontmatter missing name or description');
    return null;
  }

  return { name, description, instructions };
}

// ============================================================================
// Fetchers
// ============================================================================

async function fetchAndParse(promptName: string): Promise<SystemSkill | null> {
  // getPromptFromLangfuse handles: Langfuse enabled/disabled, caching, and
  // compileFallbackPrompt (for regular prompts). For skill prompts not in
  // FALLBACK_PROMPTS it returns null, so we apply our own fallback after.
  let content = await getPromptFromLangfuse(promptName);

  if (!content) {
    content = getFallbackSystemSkill(promptName);
  }

  if (!content) {
    logger.debug(`[SystemSkills] No content found for prompt: ${promptName}`);
    return null;
  }

  return parseFrontmatter(content);
}

/**
 * Fetch all system skills (used to populate enabled_skills template variable and UI listing).
 */
export async function getSystemSkills(): Promise<SystemSkill[]> {
  const results = await Promise.allSettled(
    SYSTEM_SKILL_PROMPT_NAMES.map(fetchAndParse)
  );

  const skills: SystemSkill[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value !== null) {
      skills.push(result.value);
    }
  }

  return skills;
}

/**
 * Fetch a single system skill by its skill name (not the Langfuse prompt name).
 * e.g. skillName = "chess" → fetches prompt "skill-chess"
 */
export async function getSystemSkillByName(skillName: string): Promise<SystemSkill | null> {
  const promptName = `skill-${skillName.toLowerCase().replace(/\s+/g, '-')}`;
  return fetchAndParse(promptName);
}
