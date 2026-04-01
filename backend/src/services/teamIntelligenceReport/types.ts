export interface TeamIntelligenceMember {
  userId: string;
  name: string;
  email: string;
  orgRole: string;
}

export interface TeamIntelligenceEmailDocument {
  docId: string;
  subject: string;
  snippet: string;
  timestamp: number;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  entityPeople: string[];
  entityProducts: string[];
  entityMerchants: string[];
}

export interface TeamIntelligenceTranscriptDocument {
  docId: string;
  fileName: string;
  snippet: string;
  updatedAt: number;
  conversationId?: string;
}

export interface TeamIntelligenceMemberContext {
  member: TeamIntelligenceMember;
  emails: TeamIntelligenceEmailDocument[];
  transcripts: TeamIntelligenceTranscriptDocument[];
  topicQueries: string[];
  stats: {
    emailCount: number;
    transcriptCount: number;
    peopleTags: string[];
    productTags: string[];
    merchantTags: string[];
  };
}

export interface TeamIntelligenceOverlapSignal {
  sourceUserId: string;
  sourceUserName: string;
  targetUserId: string;
  targetUserName: string;
  query: string;
  sourceSubject: string;
  matchedSubject: string;
  matchedDocId: string;
  sourceDocId: string;
  relevanceScore: number;
  reason: string;
}

export interface TeamIntelligenceAggregationResult {
  orgId: string;
  members: TeamIntelligenceMemberContext[];
  overlaps: TeamIntelligenceOverlapSignal[];
  timeRange: {
    start: string;
    end: string;
  };
  includeTranscripts: boolean;
  meta: {
    totalMembers: number;
    totalEmails: number;
    totalTranscripts: number;
    perUserLimit: number;
  };
}

export interface CreateTeamIntelligenceReportInput {
  orgId: string;
  userIds?: string[];
  startTime?: string;
  endTime?: string;
  includeTranscripts?: boolean;
  limitPerUser?: number;
}

export interface TeamIntelligenceReportSourceSummary {
  totalMembers: number;
  totalEmails: number;
  totalTranscripts: number;
  perUserLimit: number;
}

export interface TeamIntelligenceSerializedReport {
  id: string;
  orgId: string;
  requestedByUserId: string;
  status: string;
  timeRangeStart: string;
  timeRangeEnd: string;
  includeTranscripts: boolean;
  teamMemberIds: string[];
  sourceSummary: unknown;
  report: unknown;
  markdown: string | null;
  error: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
