export const DESK_SOURCE_PREFIXES = {
  APP: 'app-desk-',
  SLACK: 'slack-desk-',
} as const;

export const buildAppDeskSourceName = (channelId: string): string =>
  `${DESK_SOURCE_PREFIXES.APP}${channelId}`;

export const buildChannelAppSourceName = (installedAppId: string, channelId: string): string =>
  `${DESK_SOURCE_PREFIXES.APP}${installedAppId}-${channelId}`;

/**
 * Namespace an app-supplied message id by its source before it becomes an
 * `Email.externalMessageId`.
 *
 * That column's uniqueness is `(externalMessageId, channelId)` — channel-scoped,
 * not source-scoped — while the id itself is chosen by the app. Two apps sharing
 * a channel routinely mint the same ids ("1", "evt-1"), and unprefixed the second
 * app's upsert silently adopts the first app's Email row (inbound) or hits P2002
 * mid-reply (outbound). Prefixing makes the existing constraint behave as if it
 * were scoped by source. `ExternalMessage.externalId` keeps the raw id — that
 * table is already keyed by (externalSourceId, externalId) and is the app-facing
 * dedup contract.
 */
export const scopeExternalMessageIdToSource = (
  externalSourceId: string,
  externalId: string,
): string => `${externalSourceId}:${externalId}`;

export const buildSlackDeskSourceName = (slackChannelId: string): string =>
  `${DESK_SOURCE_PREFIXES.SLACK}${slackChannelId}`;

export const resolveAppDeskInstalledAppId = (
  source: { externalIdentifier: string | null; name: string },
): string | null => {
  if (source.externalIdentifier) {
    return source.externalIdentifier;
  }
  if (!source.name.startsWith(DESK_SOURCE_PREFIXES.APP)) {
    return null;
  }
  const suffix = source.name.slice(DESK_SOURCE_PREFIXES.APP.length);
  if (!suffix) {
    return null;
  }
  // New shape: app-desk-<installedAppId>-<channelId>. Both ids are cuid()s and
  // never contain '-', so exactly two segments identifies the new shape.
  const segments = suffix.split('-');
  if (segments.length === 2 && segments[0] && segments[1]) {
    return segments[0];
  }
  // Legacy shape: app-desk-<channelId> (pre-externalIdentifier rows).
  return suffix;
};

export const extractSlackChannelId = (sourceName: string): string | null =>
  sourceName.startsWith(DESK_SOURCE_PREFIXES.SLACK)
    ? sourceName.slice(DESK_SOURCE_PREFIXES.SLACK.length) || null
    : null;
