/**
 * Who can see a connector (an McpServer row).
 *
 * `GET /servers` is the reference: a global connector is visible to everyone, a
 * personal one only to its owner. Lives here rather than in routes/servers.ts
 * so other surfaces (the Slack/webhook picker, the app-connectors bridge) apply
 * the same rule without importing a router module.
 */

export type ConnectorScope = "personal" | "global";
export type PublishStatus = "draft" | "pending" | "approved" | "rejected";

export type ConnectorMeta = {
  ownerType?: string;
  ownerUserId?: string;
  scope?: ConnectorScope;
  publishStatus?: PublishStatus;
  publishRequestedAt?: string;
  publishReviewedAt?: string;
  publishReviewedBy?: string;
  publishReviewNote?: string;
  mode?: string;
};

export function parseConnectorMeta(value: unknown): ConnectorMeta {
  return !!value && typeof value === "object" && !Array.isArray(value) ? (value as ConnectorMeta) : {};
}

export function isVisibleToUser(meta: ConnectorMeta, requesterId?: string): boolean {
  const scope = meta.scope ?? "global";
  if (scope === "global") return true;
  return Boolean(requesterId && meta.ownerUserId === requesterId);
}

/** Visible to `userId` AND switched on — what a caller may actually use. */
export function isUsableByUser(
  server: { enabled: boolean; connectorMeta: unknown },
  userId: string,
): boolean {
  return server.enabled && isVisibleToUser(parseConnectorMeta(server.connectorMeta), userId);
}
