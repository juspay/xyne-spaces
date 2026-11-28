import { api } from '@xyne/shared';
import { ContractError, controller } from '@/framework/api';
import { getDailyBriefConfig, getDailyBriefSettings, saveDailyBriefConfig, saveDailyBriefSettings } from '@/services/clawAgentService';
import type { AuthenticatedUser } from '@/types/express';
import { logger } from '@/utils/logger';

/** Unwrap claw-auth's { success, data } envelope for the dashboard. */
function unwrap(result: unknown): unknown {
  if (result && typeof result === 'object' && 'data' in (result as Record<string, unknown>)) {
    return (result as { data: unknown }).data;
  }
  return result;
}

function userIdOf(user: AuthenticatedUser | undefined): string {
  if (!user?.id) throw new ContractError(401, { error: 'Unauthorized' });
  return user.id;
}

function failure(error: unknown, logMessage: string, message: string): ContractError {
  if (error instanceof ContractError) return error;
  logger.error(logMessage, error);
  return new ContractError(500, { error: message });
}

/** GET /daily-brief/config: enable flag and the user's instructions. */
export const getConfig = controller(api.dailyBrief.config, async (input) => {
  const userId = userIdOf(input.user);
  try {
    return unwrap(await getDailyBriefConfig(input, userId));
  } catch (error) {
    throw failure(error, '[DailyBrief] Error fetching config:', 'Failed to load daily brief config');
  }
});

/** PUT /daily-brief/config */
export const saveConfig = controller(api.dailyBrief.configSet, async (input) => {
  const userId = userIdOf(input.user);
  try {
    const { enabled, instructions, instructionsEnabled } = input.body;
    return unwrap(await saveDailyBriefConfig(input, userId, { enabled, instructions, instructionsEnabled }));
  } catch (error) {
    throw failure(error, '[DailyBrief] Error saving config:', 'Failed to save daily brief config');
  }
});

/** GET /daily-brief/settings: which agent runs the brief, and the agents to pick from. */
export const getSettings = controller(api.dailyBrief.settings, async (input) => {
  const userId = userIdOf(input.user);
  try {
    return unwrap(await getDailyBriefSettings(input, userId));
  } catch (error) {
    throw failure(error, '[DailyBrief] Error fetching settings:', 'Failed to load daily brief settings');
  }
});

/** PUT /daily-brief/settings: set the org's brief agent. claw-auth's status is passed through (403 not admin, 400 bad agent). */
export const saveSettings = controller(api.dailyBrief.settingsSet, async (input) => {
  const userId = userIdOf(input.user);
  try {
    const { status, json } = await saveDailyBriefSettings(input, userId, { agentSlug: input.body.agentSlug });
    const payload = json && typeof json === 'object' && 'data' in (json as Record<string, unknown>) ? (json as { data: unknown }).data : json;
    if (status >= 400) throw new ContractError(status, payload as { error: string });
    return payload;
  } catch (error) {
    throw failure(error, '[DailyBrief] Error saving settings:', 'Failed to save daily brief settings');
  }
});