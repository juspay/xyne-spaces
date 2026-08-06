/**
 * `external_sources` holds three shapes, told apart by which parent column is set:
 * channelId → channel-bound (app-desk, slack-desk, a /connect Gmail desk, a DL
 * backfill); ownerUserId → user-bound (calendar watches); neither → workspace-level
 * (the shared mailbox, the Slack bot, ozonetel).
 *
 * Workspace-level and channel-bound rows share the same `sourceType` ('google',
 * 'slack', ...), so sourceType alone cannot distinguish them. Spread this into the
 * `where` of any query that means "the workspace's connector" — omitting it is
 * silent, and returns a channel's desk source instead.
 */
export const WORKSPACE_LEVEL = {
  channelId: null,
  ownerUserId: null,
} as const;
