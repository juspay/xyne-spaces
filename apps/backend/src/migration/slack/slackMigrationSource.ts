/**
 * Naming for the `ExternalSource` rows created by the Slack channel migration.
 *
 * A Slack channel id (e.g. `C09DFM4S4F2`) is globally unique within one Slack
 * workspace, but the *same* channel may be migrated into several Xyne channels —
 * across different Xyne-spaces workspaces. Encoding the target Xyne channel id in
 * the source name keeps `ExternalSource.name` (which is globally `@unique`) unique
 * per (slackChannel, xyneChannel), so a second migration no longer collides with —
 * or silently reuses — the first one's row.
 *
 * Format: `slackMigration-<slackChannelId>-<xyneSpaceChannelId>`. When the target
 * Xyne channel is unknown (older callers), we fall back to the unsuffixed
 * `slackMigration-<slackChannelId>` so pre-existing rows in that shape still resolve.
 */
export const SLACK_MIGRATION_PREFIX = 'slackMigration-';

export const buildSlackMigrationSourceName = (
  slackChannelId: string,
  xyneSpaceChannelId?: string,
): string =>
  xyneSpaceChannelId
    ? `${SLACK_MIGRATION_PREFIX}${slackChannelId}-${xyneSpaceChannelId}`
    : `${SLACK_MIGRATION_PREFIX}${slackChannelId}`;
