/** Where migrated channel content lands and how to attribute it. Shared by the links + canvases migrators. */
export interface MigrationTarget {
  xyneChannelId: string;
  workspaceId: string;
  /** Slack user id → Xyne user id (undefined if unresolvable). */
  resolveUser: (slackUserId: string | undefined) => Promise<string | undefined>;
  /** Author used when a Slack user can't be resolved (e.g. channel creator / job owner). */
  fallbackUserId: string;
}
