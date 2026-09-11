import { apiInstance } from '../clients/apiClient';

export type LeadershipConfidence = string;
export type LeadershipPriority = string;

export interface LeadershipReference {
  reason?: string;
  evidenceId?: string;
  signalId?: string;
  teamSummaryId?: string;
  userIngestionId?: string;
  sourceType?: string;
}

export interface LeadershipItem {
  id?: string;
  title?: string;
  text?: string;
  description?: string;
  assessment?: string;
  capability?: string;
  context?: string;
  decision?: string;
  implication?: string;
  impact?: string;
  initiative?: string;
  recommendedAction?: string;
  action?: string;
  why?: string;
  whyCritical?: string;
  reason?: string;
  progressDescription?: string;
  signal?: string;
  expectedOutcome?: string;
  summary?: string;
  goalId?: string;
  track?: string | null;
  visibility?: string | null;
  matchStrength?: string;
  isTeamWorkingTowardsGoal?: boolean;
  matchedSignals?: string[];
  evidenceSourceTypes?: string[];
  priority?: LeadershipPriority;
  severity?: LeadershipPriority;
  riskLevel?: LeadershipPriority;
  importance?: LeadershipPriority;
  deadlockRisk?: LeadershipPriority;
  status?: string;
  movement?: string;
  currentMovement?: string;
  momentum?: string;
  timeHorizon?: string;
  suggestedOwner?: string | null;
  affectedTeamIds?: string[];
  ownerUserIds?: string[];
  contributorUserIds?: string[];
  dependencies?: string[];
  requiredNextSteps?: string[];
  teamSignalRefs?: LeadershipReference[];
  memberSignalRefs?: LeadershipReference[];
  evidenceRefs?: LeadershipReference[];
  [key: string]: unknown;
}

export interface LeadershipBullet {
  id: string;
  title: string;
  text: string;
  category?: string;
  contributorTeamIds?: string[];
  contributorUserIds?: string[];
  teamSignalRefs?: LeadershipReference[];
  memberSignalRefs?: LeadershipReference[];
}

export interface LeadershipExecutiveSummary {
  narrative: string;
  momentum: string;
  topBets?: string[];
  topSignals?: string[];
  topBlockers?: string[];
  topRisks?: string[];
  immediateLeadershipActions?: string[];
}

export interface LeadershipMomentumDirection {
  momentum: string;
  direction: string;
  assessment: string;
  progressMade?: string[];
  concerns?: string[];
  progressingWorkstreamIds?: string[];
  stalledWorkstreamIds?: string[];
  progressingInitiativeIds?: string[];
  stalledInitiativeIds?: string[];
  busyButNotClearlyDirectional?: string[];
}

export interface LeadershipDecisionAgenda {
  alignmentStatus?: string;
  decisions?: LeadershipItem[];
  conflictingDecisions?: LeadershipItem[];
  conflicts?: string[];
  openQuestions?: string[];
  alignmentConcerns?: string[];
}

export interface TeamLeadershipSummary {
  schemaVersion: '1.0';
  scope: 'TEAM_LEADERSHIP_SNAPSHOT';
  batchId: string;
  reportDate: string;
  team: {
    id: string;
    name: string;
  };
  managerSummaryBullets: LeadershipBullet[];
  executiveSummary: LeadershipExecutiveSummary;
  operationalSnapshot: {
    whoIsDoingWhat: LeadershipItem[];
    needsUnblocking: LeadershipItem[];
    criticalAndMoving: LeadershipItem[];
    momentumAndDirection: LeadershipMomentumDirection;
    decisionsAndAlignment: LeadershipDecisionAgenda;
    peopleLoadFocusAndGaps: {
      overloadedMembers?: LeadershipItem[];
      lightOrInsufficientlyVisibleMembers?: LeadershipItem[];
      contextSwitchingRisks?: LeadershipItem[];
      singlePointsOfFailure?: LeadershipItem[];
      ownershipGaps?: LeadershipItem[];
      supportGaps?: LeadershipItem[];
    };
    upcomingAndAtRisk: LeadershipItem[];
  };
  leadershipSnapshot: {
    directionalBet?: LeadershipItem & {
      statedBet?: string | null;
      inferredBet?: string | null;
      technicalWaves?: string[];
      businessWaves?: string[];
      smallThingThatCanBecomeBig?: LeadershipItem[];
      alignmentAssessment?: string;
      confidence?: LeadershipConfidence;
    };
    capabilityMix?: {
      observedStrengths?: LeadershipItem[];
      developingCapabilities?: LeadershipItem[];
      missingCapabilities?: LeadershipItem[];
      singlePersonDependencies?: LeadershipItem[];
      projectPhaseFit?: LeadershipItem[];
      assessment?: string;
      confidence?: LeadershipConfidence;
    };
    leadershipTouch?: {
      currentObservedMode?: string;
      recommendedMode?: string;
      reasons?: string[];
      interventionTriggers?: string[];
      delegationSignals?: string[];
      confidence?: LeadershipConfidence;
    };
    bottlenecks?: {
      peopleOrOwnership?: LeadershipItem[];
      process?: LeadershipItem[];
      platform?: LeadershipItem[];
    };
    leadershipLeverage?: Record<string, LeadershipItem[] | undefined>;
    nextLeap?: {
      whatNext?: string;
      whatIsWrong?: string;
      theLeap?: string;
      peopleChanges?: string[];
      processChanges?: string[];
      platformChanges?: string[];
      successSignals?: string[];
    };
  };
  team10xGoal?: LeadershipItem[];
  recommendedActions: LeadershipItem[];
  processingCoverage: {
    expectedMembers: number;
    completedUserSummaries: number;
    failedUserSummaries: number;
    missingMembers: Array<{ userEmail: string; reason: string }>;
  };
  dataGaps: Array<{ gap: string; impact: string }>;
  overallConfidence: LeadershipConfidence;
}

export interface OrgLeadershipSummary {
  schemaVersion: '1.0';
  scope: 'ORG_LEADERSHIP_SNAPSHOT';
  batchId: string;
  reportDate: string;
  organization: {
    id: string;
    name: string;
    teamCount: number;
    memberCount: number;
  };
  managerSummaryBullets: LeadershipBullet[];
  executiveSummary: LeadershipExecutiveSummary;
  operationalSnapshot: {
    whoIsDoingWhat: LeadershipItem[];
    needsUnblocking: LeadershipItem[];
    criticalAndMoving: LeadershipItem[];
    momentumAndDirection: LeadershipMomentumDirection;
    decisionsAndAlignment: LeadershipDecisionAgenda;
    loadFocusAndGaps: {
      overloadedTeams?: LeadershipItem[];
      teamsNeedingSupport?: LeadershipItem[];
      capabilityGaps?: LeadershipItem[];
      ownershipConcentrationRisks?: LeadershipItem[];
      resourceImbalances?: LeadershipItem[];
    };
    upcomingAndAtRisk: LeadershipItem[];
  };
  founderSnapshot: {
    portfolioOfBets?: LeadershipItem[];
    organizationCapabilityMix?: {
      strongCapabilities?: LeadershipItem[];
      developingCapabilities?: LeadershipItem[];
      missingCapabilities?: LeadershipItem[];
      capabilitiesConcentratedInOneTeam?: LeadershipItem[];
      capabilitiesConcentratedInOnePerson?: LeadershipItem[];
      capabilityMovementOpportunities?: LeadershipItem[];
      hiringOrUpskillingNeeds?: LeadershipItem[];
      assessment?: string;
    };
    teamTouchPortfolio?: {
      highTouch?: LeadershipItem[];
      mediumTouch?: LeadershipItem[];
      lowTouch?: LeadershipItem[];
      insufficientEvidence?: LeadershipItem[];
    };
    cannotDeadlock?: LeadershipItem[];
    organizationBottlenecks?: Record<string, LeadershipItem[] | undefined>;
    decisionAgenda?: Record<string, LeadershipItem[] | undefined>;
    leadershipLeverage?: Record<string, LeadershipItem[] | undefined>;
    organizationNextLeap?: {
      whatNext?: string;
      whatIsWrong?: string;
      theLeap?: string;
      peopleMoves?: string[];
      problemShapingChanges?: string[];
      processChanges?: string[];
      platformChanges?: string[];
      connectionsNeeded?: string[];
      successSignals?: string[];
    };
  };
  recommendedActions: LeadershipItem[];
  processingCoverage: {
    expectedTeams: number;
    completedTeamSummaries: number;
    failedTeamSummaries: number;
    missingTeams: Array<{ teamId: string; teamName: string; reason: string }>;
  };
  dataGaps: Array<{ gap: string; impact: string }>;
  overallConfidence: LeadershipConfidence;
}

export interface UserLeadershipSummary {
  schemaVersion: '1.0';
  scope: 'USER_DAILY_SUMMARY';
  batchId: string;
  userIngestionId: string;
  reportDate: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string | null;
    teamId: string | null;
    teamName: string | null;
  };
  executiveSummary: string;
  managerSummaryBullets: string[];
  whoIsDoingWhat: LeadershipItem[];
  needsUnblocking: LeadershipItem[];
  criticalAndMoving: LeadershipItem[];
  momentumAndDirection: LeadershipMomentumDirection;
  decisionsAndAlignment: LeadershipDecisionAgenda;
  peopleLoadFocusAndGaps: {
    loadAssessment: string;
    focusAssessment: string;
    primaryFocus: string[];
    secondaryFocus: string[];
    contextSwitchingRisk: string;
    assessment: string;
    gaps: LeadershipItem[];
  };
  upcomingAndAtRisk: LeadershipItem[];
  managerAttention: LeadershipItem[];
  teamSignals: {
    directionalSignals: LeadershipItem[];
    capabilitySignals: LeadershipItem[];
    dependencies: LeadershipItem[];
  };
  unknowns: Array<{ id: string; question: string; reason: string }>;
  overallConfidence: LeadershipConfidence;
}

export interface OrgLeadershipSnapshotsResponse {
  from: string;
  to: string;
  snapshots: Array<{
    id: string;
    batchId: string;
    reportDate: string;
    source: string;
    completedAt: string | null;
    summary: OrgLeadershipSummary;
  }>;
}

export interface TeamLeadershipSnapshotsResponse {
  from: string;
  to: string;
  teamId: string;
  teamName: string;
  snapshots: Array<{
    id: string;
    batchId: string;
    reportDate: string;
    teamId: string | null;
    teamName: string;
    status: string;
    processingCoverage: {
      expectedMembers: number;
      completedUserSummaries: number;
      failedUserSummaries: number;
    };
    errorMessage: string | null;
    summary: TeamLeadershipSummary | null;
    summaryMetadata: Record<string, unknown> | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface UserLeadershipSnapshotsResponse {
  from: string;
  to: string;
  userEmail: string;
  snapshots: Array<{
    id: string;
    batchId: string;
    reportDate: string;
    source: string;
    completedAt: string | null;
    user: {
      email: string;
      name: string;
      teamId: string | null;
      teamName: string | null;
    };
    summary: UserLeadershipSummary;
    summaryMetadata: unknown;
  }>;
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

export type TeamGoalGroupKey = '10X' | '5X' | '2X' | 'READY_TO_ACCELERATE' | 'NO_GOAL_DATA';

export interface TeamGoalGroupTeam extends Team {
  highestTrack: '10X' | '5X' | '2X' | null;
  activeGoalCount: number;
  matchedGoalCount: number;
}

export interface TeamGoalGroupsResponse {
  totalTeams: number;
  groups: Record<TeamGoalGroupKey, TeamGoalGroupTeam[]>;
  warnings: Array<{
    code: 'GOAL_FETCH_FAILED';
    teamId: string;
    teamName: string;
  }>;
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
  active_employee_count?: number;
  description?: string | null;
  employee_list?: TeamMember[];
  pagination: LeadershipPagination;
}

export interface LeadershipPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type LeadershipScope = 'org' | 'team' | 'user';

export interface LeadershipSectionResponse<T = LeadershipItem> extends LeadershipPagination {
  snapshotId: string;
  section: string;
  items: T[];
}

export interface LeadershipSectionParams {
  scope: LeadershipScope;
  section: string;
  from: string;
  to: string;
  page: number;
  limit?: number;
  teamId?: string;
  userEmail?: string;
}

export const getOrgLeadershipSnapshots = async (params: {
  from: string;
  to: string;
}): Promise<OrgLeadershipSnapshotsResponse> => {
  const response = await apiInstance.get<OrgLeadershipSnapshotsResponse>(
    '/team-intelligence-dashboard/org/leadership-snapshots',
    {
      params: {
        from: params.from,
        to: params.to,
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

export const getTeamGoalGroups = async (): Promise<TeamGoalGroupsResponse> => {
  const response = await apiInstance.get<TeamGoalGroupsResponse>(
    '/team-intelligence-dashboard/org/team-goal-groups',
  );
  return response.data;
};

export const getTeamLeadershipSnapshots = async (
  teamId: string,
  params: { from: string; to: string },
): Promise<TeamLeadershipSnapshotsResponse> => {
  const response = await apiInstance.get<TeamLeadershipSnapshotsResponse>(
    '/team-intelligence-dashboard/team/leadership-snapshots',
    {
      params: {
        from: params.from,
        to: params.to,
        teamId,
      },
    },
  );
  return response.data;
};

export const getTeamMembers = async (
  teamId: string,
  page: number,
  limit = 12,
): Promise<TeamMembersResponse> => {
  const response = await apiInstance.get<TeamMembersResponse>('/mettle/team-members', {
    params: {
      teamId,
      page,
      limit,
    },
  });
  return response.data;
};

export const getLeadershipSection = async <T = LeadershipItem>({
  scope,
  section,
  ...params
}: LeadershipSectionParams): Promise<LeadershipSectionResponse<T>> => {
  const response = await apiInstance.get<LeadershipSectionResponse<T>>(
    `/team-intelligence-dashboard/${scope}/leadership-sections/${section}`,
    { params },
  );
  return response.data;
};

export const getUserLeadershipSnapshots = async (
  email: string,
  params: { from: string; to: string },
): Promise<UserLeadershipSnapshotsResponse> => {
  const response = await apiInstance.get<UserLeadershipSnapshotsResponse>(
    '/team-intelligence-dashboard/user/leadership-snapshots',
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
