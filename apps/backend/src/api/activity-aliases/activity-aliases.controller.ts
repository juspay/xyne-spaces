import { AccessType, api } from '@xyne/shared';
import { db } from '@/database/client';
import { ContractError, controller } from '@/framework/api';
import { resourceAccess } from '@/framework/dashboardAccess';
import { logger } from '@/utils/logger';
import { internal } from '../settings.helpers';

/** Changing aliases needs USER_ACTIVITY admin. */
const userActivityAdmin = { userActivity: resourceAccess('USER_ACTIVITY', AccessType.ADMIN) };

// ─── Activity aliases ───────────────────────────────────────────────────────

/** GET /activity-aliases */
export const listAliases = controller(api.activityAliases.list, async () => {
  try {
    return { aliases: await db.activityAlias.findMany({ orderBy: { createdAt: 'desc' } }) };
  } catch (error) {
    throw internal(error, '[ACTIVITY-ALIASES] Error fetching aliases:', { error: 'Failed to fetch aliases' });
  }
});

/** POST /activity-aliases */
export const createAlias = controller(api.activityAliases.create, { checks: userActivityAdmin }, async (input) => {
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
});

/** PUT /activity-aliases/:id */
export const updateAlias = controller(api.activityAliases.update, { checks: userActivityAdmin }, async (input) => {
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
});

/** DELETE /activity-aliases/:id: answers 204 with no body. */
export const deleteAlias = controller(api.activityAliases.delete, { checks: userActivityAdmin }, async (input, reply) => {
  reply.status(204);
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
});