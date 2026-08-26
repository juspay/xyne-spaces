import {
  getMemberDetails,
  getLeadershipSection,
  getOrgLeadershipSnapshots,
  getTeamLeadershipSnapshots,
  getTeamGoalGroups,
  getTeamMembers,
  getTeams,
  getUserLeadershipSnapshots,
  OrgLeadershipSnapshotsResponse,
  TeamLeadershipSnapshotsResponse,
  TeamGoalGroupsResponse,
  TeamMember,
  TeamMembersResponse,
  TeamsResponse,
  UserLeadershipSnapshotsResponse,
  LeadershipItem,
  LeadershipSectionParams,
  LeadershipSectionResponse,
} from '@/services/TeamIntelligence/teamIntelligenceService';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

const TEAM_INTELLIGENCE_STALE_TIME_MS = 5 * 60 * 1000;

const teamIntelligenceQueryOptions = {
  staleTime: TEAM_INTELLIGENCE_STALE_TIME_MS,
} as const;

export function useOrgLeadershipSnapshots({
  params,
}: {
  params: {
    from: string;
    to: string;
  };
}): UseQueryResult<OrgLeadershipSnapshotsResponse> {
  return useQuery<OrgLeadershipSnapshotsResponse>({
    queryKey: ['team-intelligence', 'org-leadership-snapshots', params],
    queryFn: () => getOrgLeadershipSnapshots(params),
    ...teamIntelligenceQueryOptions,
  });
}

export function useTeams(): UseQueryResult<TeamsResponse> {
  return useQuery<TeamsResponse>({
    queryKey: ['team-intelligence', 'teams'],
    queryFn: getTeams,
    ...teamIntelligenceQueryOptions,
  });
}

export function useTeamGoalGroups(): UseQueryResult<TeamGoalGroupsResponse> {
  return useQuery<TeamGoalGroupsResponse>({
    queryKey: ['team-intelligence', 'team-goal-groups', 'all-evidence', 'v3'],
    queryFn: getTeamGoalGroups,
    ...teamIntelligenceQueryOptions,
  });
}

export function useTeamLeadershipSnapshots(
  teamId: string,
  params: { from: string; to: string },
): UseQueryResult<TeamLeadershipSnapshotsResponse> {
  return useQuery<TeamLeadershipSnapshotsResponse>({
    queryKey: ['team-intelligence', 'team-leadership-snapshots', teamId, params],
    queryFn: () => getTeamLeadershipSnapshots(teamId, params),
    enabled: !!teamId,
    ...teamIntelligenceQueryOptions,
  });
}

export function useTeamMembers(teamId: string, page = 1): UseQueryResult<TeamMembersResponse> {
  return useQuery<TeamMembersResponse>({
    queryKey: ['team-intelligence', 'mettle-team-members', teamId, page],
    queryFn: () => getTeamMembers(teamId, page),
    enabled: !!teamId,
    ...teamIntelligenceQueryOptions,
  });
}

export function useLeadershipSection<T = LeadershipItem>(
  params: LeadershipSectionParams,
): UseQueryResult<LeadershipSectionResponse<T>> {
  return useQuery<LeadershipSectionResponse<T>>({
    queryKey: ['team-intelligence', 'leadership-section', params],
    queryFn: () => getLeadershipSection<T>(params),
    enabled:
      !!params.section &&
      (params.scope === 'org' ||
        (params.scope === 'team' && !!params.teamId) ||
        (params.scope === 'user' && !!params.userEmail)),
    placeholderData: previous => previous,
    ...teamIntelligenceQueryOptions,
  });
}

export function useUserLeadershipSnapshots(
  email: string,
  params: { from: string; to: string },
): UseQueryResult<UserLeadershipSnapshotsResponse> {
  return useQuery<UserLeadershipSnapshotsResponse>({
    queryKey: ['team-intelligence', 'user-leadership-snapshots', email, params],
    queryFn: () => getUserLeadershipSnapshots(email, params),
    enabled: !!email,
    ...teamIntelligenceQueryOptions,
  });
}

export function useMemberDetails(email: string): UseQueryResult<TeamMember> {
  return useQuery<TeamMember>({
    queryKey: ['team-intelligence', 'member-details', email],
    queryFn: () => getMemberDetails(email),
    enabled: !!email,
    ...teamIntelligenceQueryOptions,
  });
}
