import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

/**
 * Get all activity aliases
 */
export async function getAllAliases(_req: Request, res: Response): Promise<void> {
  try {
    const aliases = await db.activityAlias.findMany({
      orderBy: { createdAt: 'desc' },
    });

    res.json({ aliases });
  } catch (error) {
    logger.error('[ACTIVITY-ALIASES] Error fetching aliases:', error);
    res.status(500).json({ error: 'Failed to fetch aliases' });
  }
}

/**
 * Create a new activity alias
 */
export async function createAlias(req: Request, res: Response): Promise<void> {
  try {
    const {
      eventName,
      eventCategory,
      aliasEventName,
      aliasEventCategory,
      isBlacklisted = false,
    } = req.body;

    // Validate required fields
    if (!eventName || !eventCategory) {
      res.status(400).json({ error: 'eventName and eventCategory are required' });
      return;
    }

    // If not blacklisted, alias names are required
    if (!isBlacklisted && (!aliasEventName || !aliasEventCategory)) {
      res.status(400).json({ error: 'aliasEventName and aliasEventCategory are required when not blacklisted' });
      return;
    }

    // Check if alias already exists for this key
    const existingAlias = await db.activityAlias.findUnique({
      where: {
        eventName_eventCategory: {
          eventName,
          eventCategory,
        },
      },
    });

    if (existingAlias) {
      res.status(409).json({ error: 'Alias already exists for this event. Use PUT to update.' });
      return;
    }

    // Create the alias (preserve alias values even when blacklisting)
    const alias = await db.activityAlias.create({
      data: {
        eventName,
        eventCategory,
        aliasEventName: aliasEventName ?? '',
        aliasEventCategory: aliasEventCategory ?? '',
        isBlacklisted,
        createdAt: new Date(),
      },
    });

    logger.info(`[ACTIVITY-ALIASES] Created alias: ${eventName} -> ${aliasEventName}`);
    res.json({ alias });
  } catch (error) {
    logger.error('[ACTIVITY-ALIASES] Error creating alias:', error);
    res.status(500).json({ error: 'Failed to create alias' });
  }
}

/**
 * Update an existing activity alias
 */
export async function updateAlias(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const {
      aliasEventName,
      aliasEventCategory,
      isBlacklisted,
    } = req.body;

    // Find existing alias
    const existingAlias = await db.activityAlias.findUnique({
      where: { id },
    });

    if (!existingAlias) {
      res.status(404).json({ error: 'Alias not found' });
      return;
    }

    // Validate: if not blacklisted, alias names are required
    const newIsBlacklisted = isBlacklisted ?? existingAlias.isBlacklisted;
    if (!newIsBlacklisted && (!aliasEventName || !aliasEventCategory)) {
      res.status(400).json({ error: 'aliasEventName and aliasEventCategory are required when not blacklisted' });
      return;
    }

    // Update the alias - keep alias values even when blacklisting
    const updatedAlias = await db.activityAlias.update({
      where: { id },
      data: {
        aliasEventName: aliasEventName ?? existingAlias.aliasEventName,
        aliasEventCategory: aliasEventCategory ?? existingAlias.aliasEventCategory,
        isBlacklisted: newIsBlacklisted,
      },
    });

    logger.info(`[ACTIVITY-ALIASES] Updated alias: ${existingAlias.eventName}`);
    res.json({ alias: updatedAlias });
  } catch (error) {
    logger.error('[ACTIVITY-ALIASES] Error updating alias:', error);
    res.status(500).json({ error: 'Failed to update alias' });
  }
}

/**
 * Delete an activity alias
 */
export async function deleteAlias(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    // Find existing alias
    const existingAlias = await db.activityAlias.findUnique({
      where: { id },
    });

    if (!existingAlias) {
      res.status(404).json({ error: 'Alias not found' });
      return;
    }

    // Delete the alias
    await db.activityAlias.delete({
      where: { id },
    });

    logger.info(`[ACTIVITY-ALIASES] Deleted alias: ${existingAlias.eventName}`);
    res.status(204).send();
  } catch (error) {
    logger.error('[ACTIVITY-ALIASES] Error deleting alias:', error);
    res.status(500).json({ error: 'Failed to delete alias' });
  }
}
