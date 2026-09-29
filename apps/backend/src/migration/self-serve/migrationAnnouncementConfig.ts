import type { JsonValue } from '@openfeature/server-sdk';
import { superpositionClient } from '@/services/superpositionClient';

export const SLACK_MIGRATION_ANNOUNCEMENTS_KEY = 'SlackMigrationAnnouncements';
export const FINAL_MESSAGE_LINK_PLACEHOLDER = '{link}';

export interface MigrationAnnouncement {
  final_message?: string;
  dashboard_announcement?: string;
}

export async function getMigrationAnnouncement(workspaceId: string): Promise<MigrationAnnouncement> {
  const all = await superpositionClient.getObjectValue(
    SLACK_MIGRATION_ANNOUNCEMENTS_KEY,
    {} as unknown as JsonValue,
  );
  if (workspaceId && all && typeof all === 'object' && !Array.isArray(all)) {
    const entry = (all as Record<string, MigrationAnnouncement>)[workspaceId];
    if (entry && typeof entry === 'object') return entry;
  }
  return {};
}
