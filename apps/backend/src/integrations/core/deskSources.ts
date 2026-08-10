export const DESK_SOURCE_PREFIXES = {
  APP: 'app-desk-',
  SLACK: 'slack-desk-',
} as const;

export const buildAppDeskSourceName = (channelId: string): string =>
  `${DESK_SOURCE_PREFIXES.APP}${channelId}`;

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
