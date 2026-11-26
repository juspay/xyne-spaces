import { type RouteBody } from '@xyne/shared';
import type { activityAliasesCreate, activityAliasesUpdate } from '@xyne/shared';
import { db } from '@/database/client';
import { ContractError } from '@/framework/api';
import { logger } from '@/utils/logger';
import { internal } from '../settings.helpers';

// ─── Activity aliases ───────────────────────────────────────────────────────

/** GET /activity-aliases */
export async function listAliases() {
  try {
    return { aliases: await db.activityAlias.findMany({ orderBy: { createdAt: 'desc' } }) };
  } catch (error) {
    throw internal(error, '[ACTIVITY-ALIASES] Error fetching aliases:', { error: 'Failed to fetch aliases' });
  }
}

/** POST /activity-aliases */
export async function createAlias(input: { body: RouteBody<typeof activityAliasesCreate> }) {
  try {
    const { eventName, eventCategory, aliasEventName, aliasEventCategory, isBlacklisted } = input.body;
    const existingAlias = await db.activityAlias.findUnique({ where: { eventName_eventCategory: { eventName, eventCategory } } });
    if (existingAlias) throw new ContractError(409, { error: 'Alias already exists for this event. Use PUT to update.' });

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
    return { alias };
  } catch (error) {
    throw internal(error, '[ACTIVITY-ALIASES] Error creating alias:', { error: 'Failed to create alias' });
  }
}

/** PUT /activity-aliases/:id */
export async function updateAlias(input: { params: { id: string }; body: RouteBody<typeof activityAliasesUpdate> }) {
  try {
    const { id } = input.params;
    const { aliasEventName, aliasEventCategory, isBlacklisted } = input.body;
    const existingAlias = await db.activityAlias.findUnique({ where: { id } });
    if (!existingAlias) throw new ContractError(404, { error: 'Alias not found' });

    // If not blacklisted, alias names are required
    const newIsBlacklisted = isBlacklisted ?? existingAlias.isBlacklisted;
    if (!newIsBlacklisted && (!aliasEventName || !aliasEventCategory)) {
      throw new ContractError(400, { error: 'aliasEventName and aliasEventCategory are required when not blacklisted' });
    }
    // Keep alias values even when blacklisting
    const alias = await db.activityAlias.update({
      where: { id },
      data: {
        aliasEventName: aliasEventName ?? existingAlias.aliasEventName,
        aliasEventCategory: aliasEventCategory ?? existingAlias.aliasEventCategory,
        isBlacklisted: newIsBlacklisted,
      },
    });
    logger.info(`[ACTIVITY-ALIASES] Updated alias: ${existingAlias.eventName}`);
    return { alias };
  } catch (error) {
    throw internal(error, '[ACTIVITY-ALIASES] Error updating alias:', { error: 'Failed to update alias' });
  }
}

/** DELETE /activity-aliases/:id: answers 204 with no body. */
export async function deleteAlias(input: { params: { id: string } }) {
  try {
    const { id } = input.params;
    const existingAlias = await db.activityAlias.findUnique({ where: { id } });
    if (!existingAlias) throw new ContractError(404, { error: 'Alias not found' });
    await db.activityAlias.delete({ where: { id } });
    logger.info(`[ACTIVITY-ALIASES] Deleted alias: ${existingAlias.eventName}`);
    return null;
  } catch (error) {
    throw internal(error, '[ACTIVITY-ALIASES] Error deleting alias:', { error: 'Failed to delete alias' });
  }
}