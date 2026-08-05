import {
  getMemberDetails,
  getOrgLeadershipSnapshots,
  getTeamLeadershipSnapshots,
  getTeamMembers,
  getTeams,
  getUserLeadershipSnapshots,
  OrgLeadershipSnapshotsResponse,
  TeamLeadershipSnapshotsResponse,
  TeamMember,
  TeamMembersResponse,
  TeamsResponse,
  UserLeadershipSnapshotsResponse,
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

export function useTeamMembers(teamId: string): UseQueryResult<TeamMembersResponse> {
  return useQuery<TeamMembersResponse>({
    queryKey: ['team-intelligence', 'mettle-team-members', teamId],
    queryFn: () => getTeamMembers(teamId),
    enabled: !!teamId,
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
