/**
 * Skills Tool
 * Allows the agent to fetch skill instructions at runtime
 */

import { z } from 'zod';
import { type Tool } from '@xynehq/jaf';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import type { XyneAIAgentContext } from './types.js';
import { getDescription } from './helpers.js';

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create fetch_skill_instructions tool
 * Allows the agent to fetch skill instructions by name at runtime
 */
export function createFetchSkillInstructionsTool(): Tool<{ skillName: string }, XyneAIAgentContext> {
  return {
    schema: {
      name: 'fetch_skill_instructions',
      description: getDescription('fetch_skill_instructions'),
      parameters: z.object({
        skillName: z.string()
          .min(1, "Skill name cannot be empty")
          .max(50, "Skill name too long")
          .describe('The name of the skill to fetch instructions for'),
      }),
    },
    execute: async (args, context) => {
      const { skillName } = args;

      logger.info(`[Tool] fetch_skill_instructions: skillName="${skillName}", userId=${context.userId}`);

      try {
        // Fetch enabled skills from UserSkill table
        const skills = await db.userSkill.findMany({
          where: { userId: context.userId, enabled: true },
          select: {
            name: true,
            description: true,
            instructions: true,
            enabled: true,
          },
        });

        if (!skills || skills.length === 0) {
          return `Error: No skills found. Please create a skill first using the settings.`;
        }

        // Find the skill by name (case-insensitive)
        const skill = skills.find(
          (s) => s.name.toLowerCase() === skillName.toLowerCase()
        );

        if (!skill) {
          const availableSkills = skills
            .map((s) => `"${s.name}"`)
            .join(', ');

          return `Error: Skill "${skillName}" not found or not enabled. Available enabled skills: ${availableSkills}. Please create the skill first using the settings if you need it.`;
        }

        // Return the skill instructions
        return `Skill: ${skill.name}\n\nDescription: ${skill.description}\n\nInstructions:\n${skill.instructions}`;

      } catch (error) {
        logger.error('[Tool] fetch_skill_instructions error:', error);
        return `Error: ${error instanceof Error ? error.message : 'Unknown error occurred while fetching skill instructions.'}`;
      }
    },
  };
}

/**
 * Get fetch_skill_instructions tool
 * MUST call initializeTools() before using
 */
export function getFetchSkillInstructionsTool() {
  return createFetchSkillInstructionsTool();
}