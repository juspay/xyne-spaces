import { Request, Response } from 'express';
import { db } from '../database/client';
import { logger } from '../utils/logger';

/**
 * Get custom instruction for the authenticated user
 */
export async function getCustomInstruction(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userPreference = await db.userPreference.findUnique({
      where: { userId },
      select: {
        askai_custom_instruction: true,
        updatedAt: true,
      },
    });

    if (!userPreference) {
      return res.json({ instruction: null });
    }

    return res.json({ 
      instruction: userPreference.askai_custom_instruction,
      updatedAt: userPreference.updatedAt 
    });
  } catch (error) {
    logger.error('[CustomInstruction] Error fetching custom instruction:', error);
    return res.status(500).json({ error: 'Failed to fetch custom instruction' });
  }
}

/**
 * Save or update custom instruction for the authenticated user
 */
export async function saveCustomInstruction(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { instruction } = req.body;

    // Validation
    if (instruction !== null && instruction !== undefined && typeof instruction !== 'string') {
      return res.status(400).json({ error: 'Instruction must be a string or null' });
    }

    // Upsert user preference
    const userPreference = await db.userPreference.upsert({
      where: { userId },
      update: {
        askai_custom_instruction: instruction ?? null,
      },
      create: {
        userId,
        askai_custom_instruction: instruction ?? null,
      },
      select: {
        askai_custom_instruction: true,
        updatedAt: true,
      },
    });

    logger.info(`[CustomInstruction] Saved custom instruction for user ${userId}`);
    return res.json({ 
      instruction: userPreference.askai_custom_instruction,
      updatedAt: userPreference.updatedAt 
    });
  } catch (error) {
    logger.error('[CustomInstruction] Error saving custom instruction:', error);
    return res.status(500).json({ error: 'Failed to save custom instruction' });
  }
}

/**
 * Delete custom instruction for the authenticated user
 */
export async function deleteCustomInstruction(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Set to null instead of deleting the record
    await db.userPreference.update({
      where: { userId },
      data: {
        askai_custom_instruction: null,
      },
    });

    logger.info(`[CustomInstruction] Cleared custom instruction for user ${userId}`);
    return res.json({ success: true });
  } catch (error) {
    // If record doesn't exist, that's fine
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
      return res.json({ success: true });
    }

    logger.error('[CustomInstruction] Error clearing custom instruction:', error);
    return res.status(500).json({ error: 'Failed to clear custom instruction' });
  }
}
