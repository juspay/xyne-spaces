import { Request, Response } from 'express';
import { db } from '../database/client';
import { logger } from '@/utils/logger';
import { getSystemSkills } from '../agents/xyne-ai/langfuse/system-skills';

const MAX_SKILLS_PER_USER = 20;

/**
 * Get all skills for the authenticated user
 */
export async function getUserSkills(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const [systemSkills, userSkills] = await Promise.all([
      getSystemSkills(),
      db.userSkill.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
    ]);

    const skills = [
      ...systemSkills.map(s => ({ ...s, enabled: true, isSystem: true })),
      ...userSkills.map(s => ({ ...s, isSystem: false })),
    ];

    return res.json({ skills });
  } catch (error) {
    logger.error('[UserSkills] Error fetching skills:', error);
    return res.status(500).json({ error: 'Failed to fetch skills' });
  }
}

/**
 * Create a new skill for the authenticated user
 */
export async function createSkill(req: Request, res: Response) {
  const { name, description, instructions } = req.body;
  
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Trim inputs
    const trimmedName = name?.trim() || '';
    const trimmedDescription = description?.trim() || '';
    const trimmedInstructions = instructions?.trim() || '';

    // Validation - all fields are mandatory
    if (!trimmedName) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (trimmedName.length > 50) {
      return res.status(400).json({ error: 'Name must be 50 characters or less' });
    }
    if (!trimmedDescription) {
      return res.status(400).json({ error: 'Description is required' });
    }
    if (trimmedDescription.length > 1000) {
      return res.status(400).json({ error: 'Description must be 1000 characters or less' });
    }
    if (!trimmedInstructions) {
      return res.status(400).json({ error: 'Instructions are required' });
    }
    if (trimmedInstructions.length > 10000) {
      return res.status(400).json({ error: 'Instructions must be 10000 characters or less' });
    }

    // Check maximum skill count and create skill atomically
    const skill = await db.$transaction(async (tx) => {
      const skillCount = await tx.userSkill.count({
        where: { userId },
      });

      if (skillCount >= MAX_SKILLS_PER_USER) {
        const limitError = new Error('MAX_SKILLS_REACHED');
        (limitError as any).code = 'MAX_SKILLS_REACHED';
        throw limitError;
      }

      return tx.userSkill.create({
        data: {
          userId,
          name: trimmedName,
          description: trimmedDescription,
          instructions: trimmedInstructions,
          enabled: true,
        },
      });
    });

    logger.info(`[UserSkills] Created skill '${skill.name}' for user ${userId}`);
    return res.status(201).json({ skill });
  } catch (error: any) {
    // Handle maximum skills limit reached
    if (error.code === 'MAX_SKILLS_REACHED') {
      return res.status(400).json({ 
        error: `Maximum limit of ${MAX_SKILLS_PER_USER} skills reached. Please delete an existing skill first.` 
      });
    }
    // Handle unique constraint violation
    if (error.code === 'P2002') {
      const skillNameForError = name?.trim() || name || 'unnamed';
      return res.status(409).json({ 
        error: `A skill with the name "${skillNameForError}" already exists. Please choose a different name.` 
      });
    }
    logger.error('[UserSkills] Error creating skill:', error);
    return res.status(500).json({ error: 'Failed to create skill' });
  }
}

/**
 * Update an existing skill for the authenticated user
 */
export async function updateSkill(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const { skillName } = req.params;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { description, instructions } = req.body;

    // Trim inputs
    const trimmedDescription = description?.trim() || '';
    const trimmedInstructions = instructions?.trim() || '';

    // Validation - all fields are mandatory (name is not editable)
    if (!trimmedDescription) {
      return res.status(400).json({ error: 'Description is required' });
    }
    if (trimmedDescription.length > 1000) {
      return res.status(400).json({ error: 'Description must be 1000 characters or less' });
    }
    if (!trimmedInstructions) {
      return res.status(400).json({ error: 'Instructions are required' });
    }
    if (trimmedInstructions.length > 10000) {
      return res.status(400).json({ error: 'Instructions must be 10000 characters or less' });
    }

    // Update skill using composite key
    const skill = await db.userSkill.update({
      where: {
        userId_name: {
          userId,
          name: skillName,
        },
      },
      data: {
        description: trimmedDescription,
        instructions: trimmedInstructions,
      },
    });

    logger.info(`[UserSkills] Updated skill '${skill.name}' for user ${userId}`);
    return res.json({ skill });
  } catch (error: any) {
    // Handle not found
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Skill not found' });
    }
    logger.error('[UserSkills] Error updating skill:', error);
    return res.status(500).json({ error: 'Failed to update skill' });
  }
}

/**
 * Delete a skill for the authenticated user
 */
export async function deleteSkill(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const { skillName } = req.params;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Delete skill using composite key
    await db.userSkill.delete({
      where: {
        userId_name: {
          userId,
          name: skillName,
        },
      },
    });

    logger.info(`[UserSkills] Deleted skill '${skillName}' for user ${userId}`);
    return res.json({ success: true });
  } catch (error: any) {
    // Handle not found
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Skill not found' });
    }
    logger.error('[UserSkills] Error deleting skill:', error);
    return res.status(500).json({ error: 'Failed to delete skill' });
  }
}

/**
 * Toggle skill enabled status
 */
export async function toggleSkillEnabled(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const { skillName } = req.params;
    const { enabled } = req.body;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Enabled must be a boolean' });
    }

    // Update skill using composite key
    const skill = await db.userSkill.update({
      where: {
        userId_name: {
          userId,
          name: skillName,
        },
      },
      data: { enabled },
    });

    logger.info(`[UserSkills] ${enabled ? 'Enabled' : 'Disabled'} skill '${skillName}' for user ${userId}`);
    return res.json({ skill });
  } catch (error: any) {
    // Handle not found
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Skill not found' });
    }
    logger.error('[UserSkills] Error toggling skill:', error);
    return res.status(500).json({ error: 'Failed to update skill' });
  }
}