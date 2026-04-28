export { SharedAuthProvider, useSharedAuthContext } from './context.js';
export type { SharedAuthContext } from './context.js';

export {
  searchUsers,
  useUsers,
  useUser,
  useSelf,
  useUserSearch,
  useActiveUsers,
  useActiveUserSearch,
} from './useUsers.js';

export {
  searchChannels,
  useAllChannels,
  useAllVisibleChannels,
  useChannel,
  useVisibleChannel,
  useChannelByName,
  useChannelSearch,
  useBrowsableChannels,
  useMigratedChannels,
  useEmailChannels,
  useChannelsByProjectId,
  useUserChannelStatuses,
  useGetChannelUserStatus,
  useGetChannelConversations,
  useGetLatestConversation,
} from './useChannels.js';
export type { VisibleChannel } from './useChannels.js';

export {
  usePermissions,
  useHasAdminAccess,
  useCanCreateTicket,
  useCanReadTicket,
  useCanViewAnalytics,
  useHasResourceAccess,
  useCanManageUserActivity,
} from './usePermissions.js';

export { useZero, InstrumentationProvider, useInstrumentation } from './useZero.js';
export type { Instrumentation } from './useZero.js';

export { useQuery, useRawQuery } from './useQuery.js';

export { useCachedQuery } from './useCachedQuery.js';
export type { UseCachedQueryOptions } from './useCachedQuery.js';

export { ZeroFallbackProvider, useZeroFallbackConfig } from './ZeroFallbackContext.js';
export type { ZeroFallbackConfig, FallbackPlatformServices } from './ZeroFallbackContext.js';

export { useFallbackQuery, FallbackExecutorProvider } from './useFallbackQuery.js';
export type { FallbackQueryExecutor } from './useFallbackQuery.js';

export { useZeroConnectionInfo } from './useZeroConnectionState.js';
export type { ZeroConnectionInfo } from './useZeroConnectionState.js';

export { useZeroOfflineState } from './useZeroOfflineState.js';

export { wasInterrupted, recordConnectionChange, recordConnectionConnected } from './metricValidity.js';
