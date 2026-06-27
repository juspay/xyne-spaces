export const DESK_SOURCE_PREFIXES = {
  APP: 'app-desk-',
  SLACK: 'slack-desk-',
} as const;

export const buildAppDeskSourceName = (installedAppId: string): string =>
  `${DESK_SOURCE_PREFIXES.APP}${installedAppId}`;

export const buildSlackDeskSourceName = (slackChannelId: string): string =>
  `${DESK_SOURCE_PREFIXES.SLACK}${slackChannelId}`;

export const extractInstalledAppId = (sourceName: string): string | null =>
  sourceName.startsWith(DESK_SOURCE_PREFIXES.APP)
    ? sourceName.slice(DESK_SOURCE_PREFIXES.APP.length) || null
    : null;

export const extractSlackChannelId = (sourceName: string): string | null =>
  sourceName.startsWith(DESK_SOURCE_PREFIXES.SLACK)
    ? sourceName.slice(DESK_SOURCE_PREFIXES.SLACK.length) || null
    : null;
