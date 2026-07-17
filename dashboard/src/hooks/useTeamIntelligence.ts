import {
  getMemberDetails,
  getMemberInsights,
  getOrgHighlights,
  getOrgSummary,
  getOrgTicketRecaps,
  getTeamChannelTickets,
  getTeamHighlights,
  getTeamMembers,
  getTeamMetrics,
  getTeamPulses,
  getTeams,
  getTeamTicketRecaps,
  OrgHighlightResponse,
  OrgSummaryResponse,
  OrgTicketRecapsResponse,
  TeamChannelTicketsResponse,
  TeamHighlightsResponse,
  TeamMember,
  TeamMembersResponse,
  TeamMetricsResponse,
  TeamPulseResponse,
  TeamsResponse,
  TeamTicketRecapsResponse,
  UserProductivity,
} from '@/services/TeamIntelligence/teamIntelligenceService';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

const TEAM_INTELLIGENCE_STALE_TIME_MS = 5 * 60 * 1000;

const teamIntelligenceQueryOptions = {
  staleTime: TEAM_INTELLIGENCE_STALE_TIME_MS,
} as const;

export function useOrgSummary({
  params,
}: {
  params: {
    from: string;
    to: string;
  };
}): UseQueryResult<OrgSummaryResponse> {
  return useQuery<OrgSummaryResponse>({
    queryKey: ['team-intelligence', 'org-summary', params],
    queryFn: () => getOrgSummary(params),
    ...teamIntelligenceQueryOptions,
  });
}

export function useOrgHighlights({
  params,
}: {
  params: {
    from: string;
    to: string;
    page: number;
    limit?: number;
  };
}): UseQueryResult<OrgHighlightResponse> {
  return useQuery<OrgHighlightResponse>({
    queryKey: ['team-intelligence', 'org-highlights', params],
    queryFn: () =>
      getOrgHighlights({
        from: params.from,
        to: params.to,
        page: params.page,
        limit: params.limit ?? 20,
      }),
    ...teamIntelligenceQueryOptions,
  });
}

export function useTeamPulse({
  params,
}: {
  params: {
    from: string;
    to: string;
  };
}): UseQueryResult<TeamPulseResponse> {
  return useQuery<TeamPulseResponse>({
    queryKey: ['team-intelligence', 'team-pulse', params],
    queryFn: () => getTeamPulses(params),
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

export function useTeamHighlights(
  teamId: string,
  params: { from: string; to: string; page: number; limit?: number },
): UseQueryResult<TeamHighlightsResponse> {
  return useQuery<TeamHighlightsResponse>({
    queryKey: ['team-intelligence', 'team-highlights', teamId, params],
    queryFn: () =>
      getTeamHighlights(teamId, {
        from: params.from,
        to: params.to,
        page: params.page,
        limit: params.limit ?? 20,
      }),
    enabled: !!teamId,
    ...teamIntelligenceQueryOptions,
  });
}

export function useTeamMetrics(
  teamId: string,
  params: { from: string; to: string },
): UseQueryResult<TeamMetricsResponse> {
  return useQuery<TeamMetricsResponse>({
    queryKey: ['team-intelligence', 'team-metrics', teamId, params],
    queryFn: () => getTeamMetrics(teamId, params),
    enabled: !!teamId,
    ...teamIntelligenceQueryOptions,
  });
}

export function useTeamMembers(teamId: string): UseQueryResult<TeamMembersResponse> {
  return useQuery<TeamMembersResponse>({
    queryKey: ['team-intelligence', 'team-members', teamId],
    queryFn: () => getTeamMembers(teamId),
    enabled: !!teamId,
    ...teamIntelligenceQueryOptions,
  });
}

export function useMemberInsights(
  email: string,
  params: { from: string; to: string },
): UseQueryResult<UserProductivity> {
  return useQuery<UserProductivity>({
    queryKey: ['team-intelligence', 'member-insights', email, params],
    queryFn: () => getMemberInsights(email, params),
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

export function useOrgTicketRecaps(params: {
  from: string;
  to: string;
  page: number;
  limit?: number;
}): UseQueryResult<OrgTicketRecapsResponse> {
  return useQuery<OrgTicketRecapsResponse>({
    queryKey: ['team-intelligence', 'org-ticket-recaps', params],
    queryFn: () =>
      getOrgTicketRecaps({
        from: params.from,
        to: params.to,
        page: params.page,
        limit: params.limit ?? 10,
      }),
    ...teamIntelligenceQueryOptions,
  });
}

export function useTeamTicketRecaps(
  teamId: string,
  params: {
    from: string;
    to: string;
    page: number;
    limit?: number;
  },
): UseQueryResult<TeamTicketRecapsResponse> {
  return useQuery<TeamTicketRecapsResponse>({
    queryKey: ['team-intelligence', 'team-ticket-recaps', teamId, params],
    queryFn: () =>
      getTeamTicketRecaps(teamId, {
        from: params.from,
        to: params.to,
        page: params.page,
        limit: params.limit ?? 10,
      }),
    enabled: !!teamId,
    ...teamIntelligenceQueryOptions,
  });
}

export function useTeamChannelTickets(
  teamId: string,
  params: {
    from: string;
    to: string;
    page: number;
    limit?: number;
  },
): UseQueryResult<TeamChannelTicketsResponse> {
  return useQuery<TeamChannelTicketsResponse>({
    queryKey: ['team-intelligence', 'team-channel-tickets', teamId, params],
    queryFn: () =>
      getTeamChannelTickets(teamId, {
        from: params.from,
        to: params.to,
        page: params.page,
        limit: params.limit ?? 10,
      }),
    enabled: !!teamId,
    ...teamIntelligenceQueryOptions,
  });
}
