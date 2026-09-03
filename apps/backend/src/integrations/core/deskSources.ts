export const DESK_SOURCE_PREFIXES = {
  APP: 'app-desk-',
  SLACK: 'slack-desk-',
} as const;

export const buildAppDeskSourceName = (channelId: string): string =>
  `${DESK_SOURCE_PREFIXES.APP}${channelId}`;

/**
 * Namespace an app-supplied message id by its source.
 *
 * `Email.externalMessageId` is unique per `(externalMessageId, channelId)` —
 * channel-scoped, not source-scoped — while the id itself is chosen by the app.
 * Two apps sharing a channel routinely mint the same ids ("1", "evt-1"), and
 * unprefixed the second app's upsert silently adopts the first app's Email row
 * (inbound) or hits P2002 mid-reply (outbound). Prefixing makes the existing
 * constraint behave as if it were scoped by source.
 *
 * The scoped id is written to BOTH `Email.externalMessageId` and the paired
 * `ExternalMessage.externalId`. Those two columns hold the same value everywhere
 * in this repo (`core.ts` writes `normalizedData.externalId` to both;
 * `emailService.ts` copies one into the other), and lookups join on that
 * equality — so the namespace applies to both sides or to neither. Callers
 * looking up by an app-supplied id must scope it first; the raw id is only ever
 * a legacy-read fallback for rows written before this prefix existed.
 */
export const scopeExternalMessageIdToSource = (
  externalSourceId: string,
  externalId: string,
): string => `${externalSourceId}:${externalId}`;

export const buildSlackDeskSourceName = (slackChannelId: string): string =>
  `${DESK_SOURCE_PREFIXES.SLACK}${slackChannelId}`;

export const resolveAppDeskInstalledAppId = (
  source: { externalIdentifier: string | null; name: string },
): string | null =>
  source.externalIdentifier ||
  (source.name.startsWith(DESK_SOURCE_PREFIXES.APP)
    ? source.name.slice(DESK_SOURCE_PREFIXES.APP.length) || null
    : null);

export const extractSlackChannelId = (sourceName: string): string | null =>
  sourceName.startsWith(DESK_SOURCE_PREFIXES.SLACK)
    ? sourceName.slice(DESK_SOURCE_PREFIXES.SLACK.length) || null
    : null;
