/**
 * Manage User Skill Tool
 * Allows the agent to create or update user skills programmatically
 * Supports both direct parameters and skill.md file parsing
 */

import { z } from 'zod';
import { type Tool } from '@juspay-jaf/jaf';
import { db } from '../../../database/client.js';
import { getContextOrNull } from '../../../database/tenant/context.js';
import { logger } from '../../../utils/logger.js';
import type { XyneAIAgentContext } from './types.js';
import { getDescription } from './helpers.js';

// ============================================================================
// Constants
// ============================================================================

const MAX_SKILLS_PER_USER = 20;
const MAX_NAME_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_INSTRUCTIONS_LENGTH = 10000;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse a skill.md file content with YAML frontmatter
 * Format:
 * ---
 * name: skill-name
 * description: Skill description
 * ---
 * Markdown instructions here...
 */
function parseSkillFile(content: string): { name: string; description: string; instructions: string } {
  const trimmedContent = content.trim();

  // Check for YAML frontmatter
  const frontmatterMatch = trimmedContent.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    // No frontmatter - treat entire content as instructions, extract name from first line
    const lines = trimmedContent.split('\n');
    const firstLine = lines[0].trim();

    // Try to extract a name from the first line (remove markdown headings)
    const nameMatch = firstLine.match(/^(?:#+\s*)?(.*?)(?:\s*-\s*|$)/);
    const name = nameMatch ? nameMatch[1].trim().slice(0, MAX_NAME_LENGTH) : 'Untitled Skill';

    // Use first non-heading line as description
    const description = lines
      .slice(1)
      .find(line => line.trim() && !line.startsWith('#'))
      ?.trim()
      .slice(0, MAX_DESCRIPTION_LENGTH) || 'Custom user skill';

    return {
      name,
      description,
      instructions: trimmedContent.slice(0, MAX_INSTRUCTIONS_LENGTH),
    };
  }

  const [, frontmatter, instructions] = frontmatterMatch;

  // Parse YAML frontmatter
  const yamlLines = frontmatter.split('\n');
  let name = '';
  let description = '';

  for (const line of yamlLines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      if (key === 'name') name = value.trim();
      if (key === 'description') description = value.trim();
    }
  }

  // Fallbacks
  if (!name) {
    // Try to extract from first line of instructions
    const firstLine = instructions.trim().split('\n')[0];
    const nameMatch = firstLine.match(/^(?:#+\s*)?(.*?)(?:\s*-\s*|$)/);
    name = nameMatch ? nameMatch[1].trim().slice(0, MAX_NAME_LENGTH) : 'Untitled Skill';
  }

  if (!description) {
    const lines = instructions.split('\n');
    description = lines
      .find(line => line.trim() && !line.startsWith('#'))
      ?.trim()
      .slice(0, MAX_DESCRIPTION_LENGTH) || 'Custom user skill';
  }

  return {
    name: name.slice(0, MAX_NAME_LENGTH),
    description: description.slice(0, MAX_DESCRIPTION_LENGTH),
    instructions: instructions.trim().slice(0, MAX_INSTRUCTIONS_LENGTH),
  };
}

/**
 * Sanitize skill name for database storage
 * Removes special characters and limits length
 */
function sanitizeSkillName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9\s-_]/g, '') // Remove special characters except spaces, hyphens, underscores
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .slice(0, MAX_NAME_LENGTH);
}

/**
 * Check if a skill exists for the user
 */
async function skillExists(userId: string, name: string): Promise<boolean> {
  const count = await db.userSkill.count({
    where: {
      userId,
      name: {
        equals: name,
        mode: 'insensitive',
      },
    },
  });
  return count > 0;
}

/**
 * Get existing skill by name
 */
async function getExistingSkill(userId: string, name: string) {
  return db.userSkill.findFirst({
    where: {
      userId,
      name: {
        equals: name,
        mode: 'insensitive',
      },
    },
  });
}

/**
 * Count user's skills
 */
async function countUserSkills(userId: string): Promise<number> {
  return db.userSkill.count({
    where: { userId },
  });
}

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create manage_user_skill tool
 * Allows the agent to create or update user skills programmatically
 * Supports both direct field input and parsing skill.md file content
 */
export function createManageUserSkillTool(): Tool<
  {
    name?: string;
    description?: string;
    instructions?: string;
    file_content?: string;
    operation: 'create' | 'update';
  },
  XyneAIAgentContext
> {
  return {
    schema: {
      name: 'manage_user_skill',
      description: getDescription('manage_user_skill'),
      parameters: z.object({
        name: z.string()
          .max(MAX_NAME_LENGTH, `Skill name must be ${MAX_NAME_LENGTH} characters or less`)
          .optional()
          .describe('The name of the skill to create or update (required if not using file_content)'),
        description: z.string()
          .max(MAX_DESCRIPTION_LENGTH, `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less`)
          .optional()
          .describe('A brief description of what this skill does (required if not using file_content)'),
        instructions: z.string()
          .max(MAX_INSTRUCTIONS_LENGTH, `Instructions must be ${MAX_INSTRUCTIONS_LENGTH} characters or less`)
          .optional()
          .describe('The full instructions for the AI agent when using this skill (required if not using file_content)'),
        file_content: z.string()
          .optional()
          .describe('Raw content of a skill.md file with optional YAML frontmatter. If provided, name/description/instructions will be extracted from this content.'),
        operation: z.enum(['create', 'update'])
          .describe('Whether to create a new skill or update an existing one'),
      }).refine(
        (data) => {
          // Either file_content is provided, or all three fields are provided
          if (data.file_content) return true;
          return !!(data.name && data.description && data.instructions);
        },
        {
          message: 'Either provide file_content to parse, or provide name, description, and instructions directly',
        }
      ),
    },
    execute: async (args, context): Promise<string> => {
      const { operation, file_content } = args;

      logger.info(`[Tool] manage_user_skill: operation=${operation}, userId=${context.userId}${file_content ? ', file_content provided' : ''}`);

      try {
        // Parse skill details from file or use direct parameters
        let skillName: string;
        let skillDescription: string;
        let skillInstructions: string;

        if (file_content) {
          // Parse the skill.md file content
          const parsed = parseSkillFile(file_content);
          skillName = parsed.name;
          skillDescription = parsed.description;
          skillInstructions = parsed.instructions;
          logger.info(`[Tool] manage_user_skill: Parsed skill file - name="${skillName}"`);
        } else {
          // Use direct parameters
          skillName = args.name!;
          skillDescription = args.description!;
          skillInstructions = args.instructions!;
        }

        // Validate required fields
        if (!skillName || !skillName.trim()) {
          return `Error: Skill name is required. Provide it directly or in the file content frontmatter.`;
        }

        const sanitizedName = sanitizeSkillName(skillName);

        if (operation === 'create') {
          // Check if skill already exists
          const exists = await skillExists(context.userId, sanitizedName);
          if (exists) {
            return `Error: A skill named "${sanitizedName}" already exists. Use operation "update" to modify it.`;
          }

          // Check skill limit
          const skillCount = await countUserSkills(context.userId);
          if (skillCount >= MAX_SKILLS_PER_USER) {
            return `Error: Maximum limit of ${MAX_SKILLS_PER_USER} skills reached. Please delete an existing skill first.`;
          }

          // Denormalized tenant key sourced from the ambient tenant context.
          const ws = getContextOrNull()?.workspaceId;
          if (!ws) {
            throw new Error('workspaceId required: no tenant context');
          }

          // Create the skill
          const skill = await db.userSkill.create({
            data: {
              workspaceId: ws,
              userId: context.userId,
              name: sanitizedName,
              description: skillDescription.trim(),
              instructions: skillInstructions.trim(),
              enabled: true,
            },
          });

          logger.info(`[Tool] manage_user_skill: Created skill '${skill.name}' for user ${context.userId}`);

          return `Successfully created skill "${skill.name}"\n\nDescription: ${skill.description}\n\nThe skill is now enabled and ready to use.`;
        } else {
          // Update operation
          const existingSkill = await getExistingSkill(context.userId, sanitizedName);

          if (!existingSkill) {
            return `Error: Skill "${sanitizedName}" not found. Use operation "create" to create a new skill.`;
          }

          // Update the skill using composite key
          const skill = await db.userSkill.update({
            where: {
              userId_name: {
                userId: context.userId,
                name: existingSkill.name, // Use exact name from DB
              },
            },
            data: {
              description: skillDescription.trim(),
              instructions: skillInstructions.trim(),
            },
          });

          logger.info(`[Tool] manage_user_skill: Updated skill '${skill.name}' for user ${context.userId}`);

          return `Successfully updated skill "${skill.name}"\n\nDescription: ${skill.description}\n\nThe skill has been updated with the new instructions.`;
        }
      } catch (error) {
        logger.error('[Tool] manage_user_skill error:', error);

        // Handle unique constraint violation
        if ((error as any).code === 'P2002') {
          return `Error: A skill with that name already exists.`;
        }

        return `Error: Failed to ${operation} skill: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    },
  };
}

/**
 * Get manage_user_skill tool
 * MUST call initializeTools() before using
 */
export function getManageUserSkillTool() {
  return createManageUserSkillTool();
}
