import type { JsonValue } from '@openfeature/server-sdk';
import { config } from '@/config/env';
import { superpositionClient } from '@/services/superpositionClient';

/** Superposition key: per-workspace Slack migration settings, keyed by Xyne workspaceId. */
export const SLACK_MIGRATION_WORKSPACES_KEY = 'SlackMigrationWorkspaces';
export const FINAL_MESSAGE_LINK_PLACEHOLDER = '{link}';

export interface MigrationWorkspaceConfig {
  app_creator_email?: string;      // existing user in that workspace who owns the bot/app rows created during ingestion
  final_message?: string;          // Slack message posted after a channel migrates; `{link}` → the Xyne channel
  dashboard_announcement?: string; // banner on the dashboard migration page; empty = none
}

export async function getMigrationWorkspaceConfig(workspaceId: string): Promise<MigrationWorkspaceConfig> {
  const all = await superpositionClient.getObjectValue(SLACK_MIGRATION_WORKSPACES_KEY, {} as unknown as JsonValue);
  if (workspaceId && all && typeof all === 'object' && !Array.isArray(all)) {
    const entry = (all as Record<string, MigrationWorkspaceConfig>)[workspaceId];
    if (entry && typeof entry === 'object') return entry;
  }
  return {};
}

/** The workspace's app creator from Superposition; falls back to the global MIGRATION_APP_CREATOR_EMAIL. */
export async function getAppCreatorEmail(workspaceId: string): Promise<string> {
  const { app_creator_email } = await getMigrationWorkspaceConfig(workspaceId);
  return app_creator_email?.trim() || config.slackMigration.appCreatorEmail;
}
