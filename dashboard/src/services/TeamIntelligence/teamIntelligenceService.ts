import { apiInstance } from '../clients/apiClient';

export interface OrgSummaryResponse {
  orgSummary: string[];
  prTotal: string[];
  aiUsages: {
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_spend: number;
    currency: string;
  };
}

export interface Contributor {
  role: string | null;
  userId: string;
  userName: string;
  userEmail: string;
  contributionNote: string;
}

export interface OrgHighlight {
  bulletId: string;
  teamName: string;
  bulletCat?: string;
  prIdsUsed: number[];
  repoNames: string[];
  bulletText: string;
  confidence: number;
  reportDate: string;
  bulletTitle?: string;
  contributors: Contributor[];
  sourceTeamBulletIds: string[];
}

export interface OrgHighlightResponse {
  from: string;
  to: string;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  bullets: OrgHighlight[];
}

export interface TeamPulse {
  teamId: string;
  teamName: string;
  summaryText: string[];
  prCount: number;
  commitCount: number;
}

export interface TeamPulseResponse {
  teams: TeamPulse[];
  from: string;
  to: string;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
}

export interface TeamsResponse {
  success: boolean;
  data: Team[];
}

export interface TeamHighlight {
  teamName: string;
  reportDate: string;
  bulletId: string;
  bulletCat?: string;
  bulletTitle?: string;
  prIdsUsed: number[];
  repoNames: string[];
  bulletText: string;
  confidence: number;
  contributors: Contributor[];
}

export interface TeamHighlightsResponse {
  teamName: string;
  from: string;
  to: string;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  bullets: TeamHighlight[];
}

export interface AIUsages {
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_spend: number;
  currency: string;
}

export interface TeamMetricsResponse {
  from: string;
  to: string;
  teamName: string;
  totalPrCount: number;
  totalCommitCount: number;
  aiUsages: AIUsages;
}

interface SoloCommit {
  commitId: string;
  timestamp: string;
  ingestionId: string;
  commitMessage: string;
  commitSummary: string;
}

interface AICost {
  amount: number;
  currency: string;
}

interface MemberAIUsages {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cost: AICost;
}

interface ProductivityMetrics {
  pullRequestCount: number;
  totalCommitCount: number;
  directCommitCount: number;
  openPullRequestCount: number;
  mergedPullRequestCount: number;
}

interface TeamInsights {
  keyFocusAreas: string[];
  items: {
    teamName: string;
    reportDate: string;
    insight: string;
  }[];
}

export interface TeamMember {
  about_me: string | null;
  assigned_emp_id: string;
  category: string | null;
  conversion: string | null;
  conversion_date: string | null;
  date_of_joining: string;
  deactivated_date: string | null;
  designation: string;
  email: string;
  employee_status: string;
  employment_type: string;
  gender: string;
  github_username: string | null;
  id: string;
  last_working_day: string | null;
  location: string;
  name: string;
  project_manager: string | null;
  role: string;
  slack_id: string;
  work_mode: string;
  team?: {
    id: string;
    name: string;
  };
}

export interface TeamMembersResponse {
  active_employee_count: number;
  description: string | null;
  employee_list: TeamMember[];
}

export interface UserProductivity {
  from: string;
  to: string;
  userEmail: string;
  soloCommits: SoloCommit[];
  aiUsages: MemberAIUsages;
  productivityMetrics: ProductivityMetrics;
  teamInsights: TeamInsights;
  tickets: Ticket[];
}

export interface OrgChannelRecap {
  id: string;
  channelId: string;
  channelName: string;
  recapDate: string;
  summary: string;
  userId: string;
}

export interface TicketMetrics {
  totalCount: number;
  solvedCount: number;
  todoCount: number;
  startedCount: number;
  pausedCount: number;
  cancelledCount: number;
  overdueCount: number;
}

export interface OrgTicketRecapsResponse {
  from: string;
  to: string;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  recaps: OrgChannelRecap[];
  ticketMetrics: TicketMetrics;
}

export interface MatchedTeamChannel {
  channelId: string;
  channelName: string;
  recapCount: number;
  lastRecapDate: string;
}

export interface OverdueTicket {
  id: string;
  title: string;
  description: string;
  channelId: string;
  statusV2: string;
  eta: string;
  createdAt: string;
  updatedAt: string;
  statusUpdatedAt: string | null;
  closedAt: string | null;
  firstRespondedAt: string | null;
}

export interface Ticket {
  id: string;
  xyneId?: string | null;
  title: string;
  description?: string | null;
  statusV2: string;
  priority?: string | null;
  createdBy?: string | null;
  assignedTo?: string | null;
  stageName?: string | null;
  boardId?: string | null;
  projectId?: string | null;
  channelId?: string | null;
  eta?: string | null;
  createdAt: string;
  updatedAt: string;
  statusUpdatedAt?: string | null;
  closedAt: string | null;
  firstRespondedAt?: string | null;
  lastEmailAt?: string | null;
}

export interface TeamTicketRecapsResponse {
  from: string;
  to: string;
  teamName: string;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  matchedChannels: MatchedTeamChannel[];
  totalMatchedChannels: number;
  recaps: OrgChannelRecap[];
  ticketMetrics: TicketMetrics;
  overdueTickets: Ticket[];
}

export const getOrgSummary = async (params: {
  from: string;
  to: string;
}): Promise<OrgSummaryResponse> => {
  const response = await apiInstance.get<OrgSummaryResponse>(
    '/team-intelligence-dashboard/org/summary',
    {
      params: {
        from: params.from,
        to: params.to,
      },
    },
  );
  return response.data;
};

export const getOrgHighlights = async (params: {
  from: string;
  to: string;
}): Promise<OrgHighlightResponse> => {
  const response = await apiInstance.get<OrgHighlightResponse>(
    '/team-intelligence-dashboard/org/bullets',
    {
      params: {
        from: params.from,
        to: params.to,
        page: 1,
        limit: 20,
      },
    },
  );
  return response.data;
};

export const getTeamPulses = async (params: {
  from: string;
  to: string;
}): Promise<TeamPulseResponse> => {
  // GET /api/team-intelligence-dashboard/org/teams?from=2026-05-18&to=2026-05-20
  const response = await apiInstance.get<TeamPulseResponse>(
    '/team-intelligence-dashboard/org/teams',
    {
      params: {
        from: params.from,
        to: params.to,
        page: 1,
        limit: 20,
      },
    },
  );
  return response.data;
};

export const getTeams = async (): Promise<TeamsResponse> => {
  // GET /api/team-intelligence-dashboard/org/mettle-teams
  const response = await apiInstance.get<TeamsResponse>(
    '/team-intelligence-dashboard/org/mettle-teams',
  );
  return response.data;
};

export const getTeamHighlights = async (
  teamId: string,
  params: { from: string; to: string; page?: number; limit?: number },
): Promise<TeamHighlightsResponse> => {
  // GET/api/team-intelligence-dashboard/team/bullets?from=2026-05-18&to=2026-05-20&teamId=Core%20Platform&page=1&limit=2
  const response = await apiInstance.get<TeamHighlightsResponse>(
    '/team-intelligence-dashboard/team/bullets',
    {
      params: {
        from: params.from,
        to: params.to,
        teamId: teamId,
        page: params.page ?? 1,
        limit: params.limit ?? 20,
      },
    },
  );
  return response.data;
};

export const getTeamMetrics = async (
  teamId: string,
  params: { from: string; to: string },
): Promise<TeamMetricsResponse> => {
  // GET /api/team-intelligence-dashboard/team/usage?from=YYYY-MM-DD&to=YYYY-MM-DD&teamId=Core%20Platform
  const response = await apiInstance.get<TeamMetricsResponse>(
    '/team-intelligence-dashboard/team/usage',
    {
      params: {
        from: params.from,
        to: params.to,
        teamId: teamId,
      },
    },
  );
  return response.data;
};

export const getTeamMembers = async (teamId: string): Promise<TeamMembersResponse> => {
  // GET /api/mettle/team-members?teamId=Data%20Engineering
  const response = await apiInstance.get<TeamMembersResponse>('/mettle/team-members', {
    params: {
      teamId: teamId,
    },
  });
  return response.data;
};

export const getMemberInsights = async (
  email: string,
  params: { from: string; to: string },
): Promise<UserProductivity> => {
  // GET /api/team-intelligence-dashboard/user/overview?from=2026-05-01&to=2026-05-20&userEmail=john.doe@gmail.com"
  const response = await apiInstance.get<UserProductivity>(
    '/team-intelligence-dashboard/user/overview',
    {
      params: {
        from: params.from,
        to: params.to,
        userEmail: email,
      },
    },
  );
  return response.data;
};

export const getMemberDetails = async (email: string): Promise<TeamMember> => {
  // GET /api/team-intelligence-dashboard/user/mettle-extended-info
  const response = await apiInstance.get<TeamMember>(
    '/team-intelligence-dashboard/user/mettle-extended-info',
    {
      params: {
        email: email,
      },
    },
  );
  return response.data;
};

export const getOrgTicketRecaps = async (params: {
  from: string;
  to: string;
  page?: number;
  limit?: number;
}): Promise<OrgTicketRecapsResponse> => {
  // GET /api/team-intelligence-dashboard/org/channel-recaps?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=10
  const response = await apiInstance.get<OrgTicketRecapsResponse>(
    '/team-intelligence-dashboard/org/channel-recaps',
    {
      params: {
        from: params.from,
        to: params.to,
        page: params.page ?? 1,
        limit: params.limit ?? 10,
      },
    },
  );
  return response.data;
};

export const getTeamTicketRecaps = async (
  teamId: string,
  params: {
    from: string;
    to: string;
    page?: number;
    limit?: number;
  },
): Promise<TeamTicketRecapsResponse> => {
  const response = await apiInstance.get<TeamTicketRecapsResponse>(
    '/team-intelligence-dashboard/team/channel-recaps',
    {
      params: {
        from: params.from,
        to: params.to,
        teamId: teamId,
        page: params.page ?? 1,
        limit: params.limit ?? 10,
      },
    },
  );

  return response.data;
};
