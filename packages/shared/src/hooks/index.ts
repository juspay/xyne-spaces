export { SharedAuthProvider, useSharedAuthContext } from "./context.js";
export type { SharedAuthContext } from "./context.js";

export {
  HttpClientProvider,
  useHttpClient,
  useOptionalHttpClient,
} from "./HttpClientContext.js";
export type { HttpClient } from "./HttpClientContext.js";

export {
  useAffinityService,
  AffinityServiceProvider,
} from "./useAffinityService.js";
export { AffinityService } from "../services/affinityService.js";
export type { AffinityWeights } from "../services/affinityService.js";

export { useCacConfig, useOptionalCacConfig } from "./useCacConfig.js";

export { useChannelRecentSenders } from "./useChannelRecentSenders.js";
export { useDmAffinityRank } from "./useDmAffinityRank.js";
export {
  useVespaChannelParticipants,
  ChannelServiceProvider,
} from "./useVespaChannelParticipants.js";
export type { FetchVespaChannelParticipants } from "./useVespaChannelParticipants.js";

export { useUserGroupSearch } from "./useUserGroupSearch.js";
export type { UserGroupLike } from "./useUserGroupSearch.js";

export { useMentionSearch } from "./useMentionSearch.js";
export type {
  UseMentionSearchResult,
  UseMentionSearchOptions,
} from "./useMentionSearch.js";
export type { MentionResult } from "../types/mention.js";

export {
  searchUsers,
  useUsers,
  useUsersById,
  useUser,
  useSelf,
  useUserSearch,
  useActiveUsers,
  useActiveUserSearch,
  invalidateUsersMapCache,
} from "./useUsers.js";

export {
  searchChannels,
  searchChannelsWithScores,
  useAllChannels,
  useAllVisibleChannels,
  useVisibleProjects,
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
  useChannelParticipation,
  useGetChannelConversations,
  getChannelConversationsSnapshot,
  useGetLatestConversation,
} from "./useChannels.js";
export type { VisibleChannel, VisibleProject } from "./useChannels.js";

export {
  usePermissions,
  useHasAdminAccess,
  useCanCreateTicket,
  useCanReadTicket,
  useCanViewAnalytics,
  useHasResourceAccess,
  useCanManageUserActivity,
} from "./usePermissions.js";

export {
  useZero,
  InstrumentationProvider,
  useInstrumentation,
} from "./useZero.js";
export type { Instrumentation } from "./useZero.js";
export {
  getPendingMutationCount,
  subscribePendingMutations,
} from "./pendingMutations.js";

export { useQuery, useRawQuery } from "./useQuery.js";

export { useCachedQuery } from "./useCachedQuery.js";
export type { UseCachedQueryOptions } from "./useCachedQuery.js";

export { useCurrentUserRoleIds } from "./useRoles.js";
export type { Role } from "./useRoles.js";

export {
  ZeroFallbackProvider,
  useZeroFallbackConfig,
  ZeroFallbackContext,
  DEFAULT_ZERO_FALLBACK_CONFIG,
} from "./ZeroFallbackContext.js";
export type {
  ZeroFallbackConfig,
  FallbackPlatformServices,
} from "./ZeroFallbackContext.js";

export {
  useFallbackQuery,
  FallbackExecutorProvider,
  useFallbackExecutor,
} from "./useFallbackQuery.js";
export type { FallbackQueryExecutor } from "./useFallbackQuery.js";
export { useEncryptionConfig } from "./useEncryptionConfig.js";
export type {
  EncryptionConfig,
  EncryptionContextData,
} from "./useEncryptionConfig.js";
export {
  useEncryptionBootstrap,
  useEncryptionBootstrapInit,
  EncryptionBootstrapProvider,
  resetGlobalEncryptionBootstrap,
} from "./useEncryptionBootstrap.js";
export type {
  EncryptionBootstrapState,
  EncryptionBootstrapContextValue,
} from "./useEncryptionBootstrap.js";
export { setCryptoLogger } from "../crypto/crypto-logger.js";

export { useFallbackHydratedQuery } from "./useFallbackHydratedQuery.js";

export { useZeroConnectionInfo } from "./useZeroConnectionState.js";
export type { ZeroConnectionInfo } from "./useZeroConnectionState.js";

export { useZeroOfflineState } from "./useZeroOfflineState.js";

export {
  wasInterrupted,
  recordConnectionChange,
  recordConnectionConnected,
} from "./metricValidity.js";
