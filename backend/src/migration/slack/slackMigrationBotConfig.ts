/**
 * Per-workspace Slack bot configuration resolver.
 *
 * Set MIGRATION_SLACK_BOT_CONFIGS as a JSON string keyed by Xyne workspaceId:
 *
 * MIGRATION_SLACK_BOT_CONFIGS='{
 *   "<xyne-workspace-id>": {
 *     "slackTeamId": "T0AB12345",
 *     "slackBotToken": "xoxb-...",
 *     "slackSigningSecret": "abc...",
 *     "slackMigrationLogChannelId": "C0B312E4RNV",
 *     "notificationsEnabled": true,
 *     "migrationApprovals": ["U123", "U456"],
 *     "migrationFinalMessage": "<base64-encoded-string>"
 *   }
 * }'
 *
 * Falls back to the existing flat env vars when MIGRATION_SLACK_BOT_CONFIGS
 * is empty or a matching workspace is not found, so single-workspace
 * deployments need zero changes.
 */

import { config } from '../../config/env';
import { logger } from '../../utils/logger';

export interface SlackMigrationBotConfig {
  slackBotToken: string;
  slackSigningSecret: string;
  slackMigrationLogChannelId: string;
  notificationsEnabled: boolean;
  migrationApprovals: string[];
  migrationFinalMessage: string;
}

interface BotConfigEntry extends SlackMigrationBotConfig {
  /** Slack's T-prefixed team ID — used for early resolution before workspaceId is known */
  slackTeamId?: string;
}

type BotConfigMap = Record<string, BotConfigEntry>; // keyed by Xyne workspaceId

let _parsed: BotConfigMap | null = null;

function getParsedConfigs(): BotConfigMap {
  if (_parsed) return _parsed;

  const raw = process.env.MIGRATION_SLACK_BOT_CONFIGS || '{}';
  try {
    const parsed = JSON.parse(raw) as BotConfigMap;

    // Normalise each entry
    for (const entry of Object.values(parsed)) {
      // Decode base64 migrationFinalMessage if present
      if (entry.migrationFinalMessage) {
        try {
          entry.migrationFinalMessage = Buffer.from(
            entry.migrationFinalMessage,
            'base64'
          ).toString('utf-8');
        } catch {
          // keep as-is if not valid base64
        }
      }
      // Ensure arrays are arrays
      if (!Array.isArray(entry.migrationApprovals)) {
        entry.migrationApprovals = [];
      }
    }

    _parsed = parsed;
  } catch (err) {
    logger.error('[SlackMigrationBotConfig] Failed to parse MIGRATION_SLACK_BOT_CONFIGS', { err });
    _parsed = {};
  }

  return _parsed;
}

function getDefaultConfig(): SlackMigrationBotConfig {
  return {
    slackBotToken: config.slackBotToken,
    slackSigningSecret: config.slackSigningSecret,
    slackMigrationLogChannelId: config.slackMigrationLogChannelId,
    notificationsEnabled: config.slackMigrationNotificationsEnabled,
    migrationApprovals: config.slackMigrationApprovals,
    migrationFinalMessage: config.slackMigrationFinalMessage,
  };
}

/**
 * Resolve config by Xyne workspaceId.
 * Used in service functions after the workspaceId is available from a DB lookup.
 */
export function getBotConfigByWorkspaceId(workspaceId: string): SlackMigrationBotConfig {
  if (workspaceId) {
    const entry = getParsedConfigs()[workspaceId];
    if (entry) return entry;
  }
  return getDefaultConfig();
}

/**
 * Resolve config by Slack team_id (T-prefixed).
 * Used in command handlers and the verify middleware before workspaceId is known.
 */
export function getBotConfigByTeamId(teamId: string): SlackMigrationBotConfig {
  if (teamId) {
    for (const entry of Object.values(getParsedConfigs())) {
      if (entry.slackTeamId === teamId) return entry;
    }
  }
  return getDefaultConfig();
}

/**
 * Resolve the Xyne workspaceId for a given Slack team_id.
 * Returns config.defaultWorkspaceId as fallback.
 */
export function getWorkspaceIdByTeamId(teamId: string): string {
  if (teamId) {
    for (const [workspaceId, entry] of Object.entries(getParsedConfigs())) {
      if (entry.slackTeamId === teamId) return workspaceId;
    }
  }
  return config.defaultWorkspaceId || '';
}
