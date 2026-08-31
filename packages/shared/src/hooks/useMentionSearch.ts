import { useState, useCallback, useMemo, useEffect } from "react";
import { ChannelScopeType } from "../zero/schema.js";
import { queries } from "../zero/queries.js";
import type { MentionResult } from "../types/mention.js";
import type { User } from "../machines/stateMachine.js";
import {
  DEFAULT_MENTION_RANKING_CAC_CONFIG,
  MENTION_RANKING_CAC_KEY,
  type MentionRankingCacConfig,
} from "../config/mentionRankingCacConfig.js";
import {
  eligibleSpecials,
  isPrefixMatch,
  normalizeAffinity,
  rankCandidates,
  type RankableCandidate,
  type SpecialMentionDescriptor,
} from "../utils/mentionRanking.js";
import {
  getMentionDisplayName,
  userToMentionResult,
} from "../utils/mentionUser.js";
import { useChannel } from "./useChannels.js";
import { useActiveUsers, useActiveUserSearch } from "./useUsers.js";
import { useUserGroupSearch } from "./useUserGroupSearch.js";
import { useChannelRecentSenders } from "./useChannelRecentSenders.js";
import { useVespaChannelParticipants } from "./useVespaChannelParticipants.js";
import { useDmAffinityRank } from "./useDmAffinityRank.js";
import { useCacConfig } from "./useCacConfig.js";
import { useAffinityService } from "./useAffinityService.js";
import { useCachedQuery } from "./useCachedQuery.js";

export interface UseMentionSearchResult {
  results: MentionResult[];
  users: MentionResult[];
  allUsers: MentionResult[];
  isLoading: boolean;
  error: string | null;
  searchMentions: (query: string) => void;
  clearResults: () => void;
}

export interface UseMentionSearchOptions {
  includeSpecialMentions?: boolean;
  excludeSelf?: boolean;
}

function emailLocalPart(email: string | null | undefined): string {
  if (!email) return "";
  const at = email.indexOf("@");
  return at >= 0 ? email.slice(0, at) : email;
}

function specialToMentionResult(s: SpecialMentionDescriptor): MentionResult {
  return {
    id: s.id,
    name: s.literal,
    type: s.literal,
    isSpecial: true,
    description: s.description,
  };
}

interface UserCandidateCtx {
  currentUserId: string | undefined;
  participantsLoaded: boolean;
  channelParticipantIds: Set<string>;
  recentInChannelIds: Set<string>;
  affinityById: Map<string, number>;
  isOneToOneDm?: boolean;
  threadParticipantIds?: ReadonlySet<string>;
}

function buildUserCandidate(u: User, ctx: UserCandidateCtx): RankableCandidate {
  const isMember =
    ctx.participantsLoaded && ctx.channelParticipantIds.has(u.id);
  const displayName = getMentionDisplayName(u);
  const isEngagedInContext =
    ctx.recentInChannelIds.has(u.id) ||
    (ctx.threadParticipantIds?.has(u.id) ?? false);
  // A 1:1/self DM isn't a "channel" — never surface the "Not in channel" pill there.
  const membershipFlag = ctx.isOneToOneDm
    ? undefined
    : ctx.participantsLoaded
      ? isMember
      : undefined;
  return {
    // Match on BOTH the (possibly-nickname) displayName AND the raw name, so a full-name query finds
    // a user whose displayName is a short nickname. matchKind already covers prefix/substring/tokens.
    matchFields: [displayName, u.name, emailLocalPart(u.email)],
    scoreInputs: {
      isChannelMember: isMember,
      isEngagedInContext,
      affinityScore: ctx.affinityById.get(u.id) ?? 0,
      isSpecialMention: false,
      isGroupMatchingName: false,
    },
    result: userToMentionResult(u, u.id === ctx.currentUserId, membershipFlag),
    tieKey: displayName.toLowerCase(),
  };
}

function buildGroupCandidate(
  g: {
    id: string;
    name: string;
    alias?: string | null;
    description?: string | null;
    isActive?: boolean | null;
  },
  query: string,
): RankableCandidate {
  return {
    matchFields: [g.name, g.alias ?? null],
    scoreInputs: {
      isChannelMember: false,
      isEngagedInContext: false,
      affinityScore: 0,
      isSpecialMention: false,
      isGroupMatchingName: isPrefixMatch([g.name, g.alias ?? null], query),
    },
    result: {
      id: g.id,
      name: g.name,
      type: "group" as const,
      ...(g.alias && { alias: g.alias }),
      ...(g.description && { description: g.description }),
      memberCount: 0,
      isDeactivated: g.isActive === false,
    },
    tieKey: (g.alias || g.name).toLowerCase(),
  };
}

function buildSpecialCandidate(s: SpecialMentionDescriptor): RankableCandidate {
  return {
    matchFields: [s.literal],
    scoreInputs: {
      isChannelMember: false,
      isEngagedInContext: false,
      affinityScore: 0,
      isSpecialMention: true,
      isGroupMatchingName: false,
    },
    result: specialToMentionResult(s),
    tieKey: s.literal,
  };
}

export const useMentionSearch = (
  channelId: string | undefined,
  currentUserId: string | undefined,
  threadParticipantIds?: ReadonlySet<string>,
  options: UseMentionSearchOptions = {},
): UseMentionSearchResult => {
  const { includeSpecialMentions = true, excludeSelf = true } = options;
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  // Gates the Vespa membership fetch — fires only after the picker has been
  // interacted with, avoiding a network call on every channel open.
  const [isMentionRequested, setIsMentionRequested] = useState<boolean>(false);
  const shouldSearch = searchQuery.trim().length > 0;

  const { config: rankingConfig } = useCacConfig<MentionRankingCacConfig>({
    key: MENTION_RANKING_CAC_KEY,
    fallbackConfig: DEFAULT_MENTION_RANKING_CAC_CONFIG,
  });

  const affinityService = useAffinityService();

  // Bumped when async affinity weights finish loading, so the ranking memos
  // recompute with the real scores (getUserWeight is otherwise non-reactive).
  const [affinityVersion, setAffinityVersion] = useState(0);
  useEffect(() => {
    if (!isMentionRequested) return;
    let cancelled = false;
    affinityService
      .prefetch()
      .then(() => {
        if (!cancelled) setAffinityVersion((v) => v + 1);
      })
      .catch(() => {});
    return (): void => {
      cancelled = true;
    };
  }, [isMentionRequested, affinityService]);

  // Active users in the workspace – drives the empty-state picker (recent DM
  // partners / channel members). Deactivated users are excluded here too.
  const allWorkspaceUsers = useActiveUsers();
  const usersData = useActiveUserSearch(searchQuery, 100);
  const userGroupsData = useUserGroupSearch(searchQuery, 10);

  const channel = useChannel(channelId || "");
  const isOneToOneDm = channel?.scopeType === ChannelScopeType.DM;
  const isGroupDm = channel?.scopeType === ChannelScopeType.GROUP_DM;
  // DM + group DM know their members locally (channel.name = participant ids),
  // so they skip Vespa; regular channels fetch membership from Vespa.
  const usesLocalParticipants = isOneToOneDm || isGroupDm;
  const channelDataReady = channel && channel.id === channelId;

  const localParticipantIds = useMemo(
    () =>
      usesLocalParticipants && channel?.name ? channel.name.split(",") : null,
    [usesLocalParticipants, channel?.name],
  );
  const isSelfDm =
    !!localParticipantIds &&
    localParticipantIds.length === 1 &&
    localParticipantIds[0] === currentUserId;

  // Channel membership via Vespa (channels only, lazy on picker open). `null`
  // means "not fetched yet" — distinct from "fetched and empty".
  const vespaParticipantIds = useVespaChannelParticipants(
    !usesLocalParticipants ? channel?.id : undefined,
    isMentionRequested,
  );

  const vespaEmpty =
    !usesLocalParticipants &&
    isMentionRequested &&
    vespaParticipantIds !== null &&
    vespaParticipantIds.length === 0;
  const [dbParticipantRows] = useCachedQuery(
    queries.channelParticipants({
      channelId: vespaEmpty ? (channel?.id ?? "") : "",
    }),
    { enabled: vespaEmpty },
  );
  const dbParticipantIds = useMemo(
    () => (dbParticipantRows ? dbParticipantRows.map((p) => p.userId) : null),
    [dbParticipantRows],
  );
  const channelMemberIds =
    vespaParticipantIds && vespaParticipantIds.length > 0
      ? vespaParticipantIds
      : dbParticipantIds;

  // Unified member set: local participants for DM/group-DM, Vespa→DB fallback for channels.
  const memberIds = useMemo(
    () =>
      new Set(
        usesLocalParticipants
          ? (localParticipantIds ?? [])
          : (channelMemberIds ?? []),
      ),
    [usesLocalParticipants, localParticipantIds, channelMemberIds],
  );
  const membersLoaded = usesLocalParticipants
    ? true
    : channelMemberIds !== null;

  // DM-recency rank — used as the secondary affinity signal when MFU is empty.
  const dmRank = useDmAffinityRank(currentUserId);
  const dmRankAffinity = useMemo(() => normalizeAffinity(dmRank), [dmRank]);

  // Distinct senders in this channel within trailing window (channels only).
  const recentInChannelIds = useChannelRecentSenders(
    !usesLocalParticipants ? channelId : undefined,
    rankingConfig.recentInChannelWindowDays,
  );

  const allUsers = useMemo<MentionResult[]>(() => {
    if (allWorkspaceUsers.length === 0) return [];
    return allWorkspaceUsers.map((u) =>
      userToMentionResult(u, false, undefined),
    );
  }, [allWorkspaceUsers]);

  const eligibleUsers = useMemo<User[]>(() => {
    const src: User[] = shouldSearch
      ? (usersData ?? [])
      : usesLocalParticipants
        ? allWorkspaceUsers.filter(
            (u) => memberIds.has(u.id) || dmRankAffinity.has(u.id),
          )
        : membersLoaded
          ? allWorkspaceUsers.filter((u) => memberIds.has(u.id))
          : allWorkspaceUsers.filter((u) => dmRankAffinity.has(u.id));
    // Keep yourself only in a self-DM (or when the caller opted out of this
    // chat-specific default, e.g. the automation composer); otherwise you're
    // never a mention candidate.
    return src.filter((u) =>
      isSelfDm || !excludeSelf ? true : u.id !== currentUserId,
    );
  }, [
    shouldSearch,
    usersData,
    usesLocalParticipants,
    membersLoaded,
    allWorkspaceUsers,
    memberIds,
    dmRankAffinity,
    isSelfDm,
    currentUserId,
    excludeSelf,
  ]);

  const candidateIdsKey = useMemo(
    () => eligibleUsers.map((u) => u.id).join(","),
    [eligibleUsers],
  );

  const mfuAffinity = useMemo(() => {
    if (!currentUserId) return new Map<string, number>();

    const raw = new Map<string, number>();
    let max = 0;
    for (const u of eligibleUsers) {
      const w = affinityService.getUserWeight(u.id);
      if (w > 0) {
        raw.set(u.id, w);
        if (w > max) max = w;
      }
    }
    if (max === 0) return new Map<string, number>();

    const normalized = new Map<string, number>();
    for (const [id, w] of raw) {
      normalized.set(id, w / max);
    }
    return normalized;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, candidateIdsKey, affinityVersion]);

  const results = useMemo<MentionResult[]>(() => {
    if (!channelDataReady) return [];

    const affinityById = mfuAffinity.size > 0 ? mfuAffinity : dmRankAffinity;

    const ctx: UserCandidateCtx = {
      currentUserId,
      participantsLoaded: membersLoaded,
      channelParticipantIds: memberIds,
      recentInChannelIds,
      affinityById,
      isOneToOneDm,
      ...(threadParticipantIds && { threadParticipantIds }),
    };

    const userCandidates = eligibleUsers.map((u) => buildUserCandidate(u, ctx));

    // Groups & special mentions are channel / group-DM concepts; a 1:1 DM is not a channel.
    const groupCandidates = (
      !isOneToOneDm && shouldSearch ? (userGroupsData ?? []) : []
    ).map((g) => buildGroupCandidate(g, searchQuery));
    const specialCandidates = includeSpecialMentions
      ? eligibleSpecials({
          isDMChannel: isOneToOneDm,
          shouldSearch,
        }).map(buildSpecialCandidate)
      : [];

    const cap = shouldSearch
      ? rankingConfig.queryStateCap
      : rankingConfig.zeroStateCap;
    return rankCandidates(
      [...userCandidates, ...groupCandidates, ...specialCandidates],
      searchQuery,
      cap,
      rankingConfig,
    );
  }, [
    channelDataReady,
    isOneToOneDm,
    shouldSearch,
    searchQuery,
    userGroupsData,
    eligibleUsers,
    memberIds,
    membersLoaded,
    recentInChannelIds,
    mfuAffinity,
    dmRankAffinity,
    threadParticipantIds,
    currentUserId,
    rankingConfig,
    includeSpecialMentions,
  ]);

  const users = useMemo(
    () => results.filter((r) => r.type === "user"),
    [results],
  );

  const searchMentions = useCallback((query: string) => {
    setError(null);
    setSearchQuery(query);
    setIsMentionRequested(true);
  }, []);

  const clearResults = useCallback(() => {
    setSearchQuery("");
    setError(null);
    setIsMentionRequested(false);
  }, []);

  return {
    results,
    users,
    allUsers,
    isLoading: false,
    error,
    searchMentions,
    clearResults,
  };
};
