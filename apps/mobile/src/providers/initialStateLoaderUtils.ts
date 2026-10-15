import type { QueryResultType } from '@rocicorp/zero';

import type { User } from '@/src/machines/appStateMachine';

type Queries = typeof import('@/src/zero/queries').queries;

export interface PermissionsApiResponse {
  success: boolean;
  permissions: { resourceName: string; accessType: 'READ' | 'WRITE' | 'ADMIN' }[];
}

export type QueryDetailsType = 'complete' | 'unknown' | 'error';
export type AllChannelRow = QueryResultType<Queries['userAllChannels']>[number];
type VisibleChannelStatusRows = QueryResultType<Queries['userVisibleChannelsV2']>;

export type StartupReadiness = {
  hasRequiredStartupContext: boolean;
  hasSplashHidden: boolean;
  isChannelsStartupReady: boolean;
  isProtectedStartupReady: boolean;
  isUserStartupReady: boolean;
  isVisibleChannelsStartupReady: boolean;
};

type PersistedStartupContext = {
  userId: string | null;
  schemaVersion: string | null;
  workspaceId: string | null;
};

export const areQueryTypesCompleted = (types: readonly QueryDetailsType[]): boolean =>
  types.every(type => type === 'complete');

export const computeUsersWatermark = (users: User[]): number =>
  users.reduce((max, user) => Math.max(max, user.updatedAt ?? 0), 0);

export const computeChannelsWatermark = (channels: AllChannelRow[]): number =>
  channels.reduce((max, channel) => Math.max(max, channel.updatedAt ?? 0), 0);

const channelMatchesWorkspace = (
  channel: { workspaceId?: string | null } | null | undefined,
  workspaceId: string | null | undefined,
): boolean => Boolean(workspaceId) && channel?.workspaceId === workspaceId;

export const filterUsersForWorkspace = (
  rows: readonly User[] | undefined,
  workspaceId: string | null | undefined,
): User[] => {
  if (!rows || !workspaceId) {
    return [];
  }
  return rows.filter(user => user.workspaceId === workspaceId);
};

export const filterAllChannelsForWorkspace = (
  rows: readonly AllChannelRow[] | undefined,
  workspaceId: string | null | undefined,
): AllChannelRow[] => {
  if (!rows || !workspaceId) {
    return [];
  }
  return rows.filter(channel => channelMatchesWorkspace(channel, workspaceId));
};

export const filterVisibleChannelRowsForWorkspace = (
  rows: VisibleChannelStatusRows | undefined,
  workspaceId: string | null | undefined,
): VisibleChannelStatusRows | undefined => {
  if (!rows) {
    return rows;
  }
  if (!workspaceId) {
    return [];
  }
  return rows.filter(row => channelMatchesWorkspace(row.channel, workspaceId));
};

/**
 * `userVisibleChannelsV2` is a full-set query: closed, deleted, or left
 * channels are omitted from the next result rather than returned as
 * tombstones. Publish that snapshot as-is. Never union it with earlier rows
 * by id — that would keep inaccessible channels in the shell/header.
 */
export const takeLatestVisibleChannelStatusRows = <T>(latest: readonly T[] | undefined): T[] =>
  latest ? [...latest] : [];

export const getStartupReadinessProgress = ({
  hasRequiredStartupContext,
  hasSplashHidden,
  isChannelsStartupReady,
  isProtectedStartupReady,
  isUserStartupReady,
  isVisibleChannelsStartupReady,
}: StartupReadiness): number => {
  if (isProtectedStartupReady) {
    return 1;
  }

  const readinessGates = [
    hasSplashHidden,
    hasRequiredStartupContext,
    isUserStartupReady,
    isChannelsStartupReady,
    isVisibleChannelsStartupReady,
  ];

  return readinessGates.filter(Boolean).length / readinessGates.length;
};

export const getStartupLabel = ({
  hasRequiredStartupContext,
  hasSplashHidden,
  isChannelsStartupReady,
  isUserStartupReady,
  isVisibleChannelsStartupReady,
}: StartupReadiness): string => {
  if (!hasSplashHidden) return 'Starting your workspace';
  if (!hasRequiredStartupContext) return 'Preparing your workspace';
  if (!isUserStartupReady) return 'Setting up your workspace';
  if (!isChannelsStartupReady || !isVisibleChannelsStartupReady) return 'Loading channels';
  return 'Opening your workspace';
};

export const persistedContextMatchesSession = (
  persistedContext: PersistedStartupContext,
  userId: string,
  schemaVersion: string,
  workspaceId: string | null,
): boolean =>
  persistedContext.userId === userId &&
  persistedContext.schemaVersion === schemaVersion &&
  persistedContext.workspaceId === workspaceId;

export const canUseReturningSessionFastPath = (
  hasPersistedStartupContext: boolean,
  isWorkspaceSwitchStartup: boolean,
): boolean => hasPersistedStartupContext && !isWorkspaceSwitchStartup;

/** Native `launchCause` is sticky for the process. Only this launch counts. */
export const NOTIFICATION_COLD_LAUNCH_WINDOW_MS = 20_000;

/**
 * Process age from `appUptimeMs`. Missing uptime is unknown, not zero —
 * zero would look like a cold launch and skip the returning-session delay.
 * Activity uptime is not a substitute: it resets when the Activity is
 * recreated on a process that is already warm.
 */
export const resolveNotificationProcessAgeMs = (
  nowUptimeMs: number,
  appUptimeMs: number | undefined,
): number | null => {
  if (!Number.isFinite(nowUptimeMs) || appUptimeMs === undefined || !Number.isFinite(appUptimeMs)) {
    return null;
  }

  return Math.max(0, nowUptimeMs - appUptimeMs);
};

export const isNotificationColdLaunch = (input: {
  launchCause?: string | undefined;
  processAgeMs: number | null;
  coldWindowMs?: number;
}): boolean => {
  if (input.launchCause !== 'notification' || input.processAgeMs === null) {
    return false;
  }

  return input.processAgeMs <= (input.coldWindowMs ?? NOTIFICATION_COLD_LAUNCH_WINDOW_MS);
};

export const shouldDeferReturningStartupRefresh = (input: {
  canUseReturningSessionFastPath: boolean;
  isWorkspaceSwitchStartup: boolean;
  isNotificationLaunch: boolean;
}): boolean =>
  input.canUseReturningSessionFastPath &&
  !input.isWorkspaceSwitchStartup &&
  !input.isNotificationLaunch;

export const getRetryDelay = (retryCount: number): number =>
  Math.min(1000 * Math.pow(2, retryCount), 10_000);
