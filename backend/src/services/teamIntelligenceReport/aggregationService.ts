import { mailSchema } from '@xyne/vespa-ts';
import { googleMailSearchService } from '@/services/vespaSearch/providers/gmail';
import { fileSchema } from '@/vespa/src/types';
import vespaRuntimeConfig from '@/vespa/vespaConfig';
import { logger } from '@/utils/logger';
import type {
  TeamIntelligenceAggregationResult,
  TeamIntelligenceEmailDocument,
  TeamIntelligenceMember,
  TeamIntelligenceMemberContext,
  TeamIntelligenceOverlapSignal,
  TeamIntelligenceTranscriptDocument,
} from './types';

const aggregationLogger = logger.child({ module: 'team-intelligence-aggregation' });

const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_LIMIT_PER_USER = 12;
const MAX_LIMIT_PER_USER = 20;
const MAX_TEAM_MEMBERS = 12;
const MAX_TOPIC_QUERIES = 3;
const OVERLAP_RELEVANCE_THRESHOLD = 0.18;

type VespaSearchResponse<TFields> = {
  root?: {
    children?: Array<{
      id?: string;
      relevance?: number;
      fields?: TFields;
    }>;
  };
};

type MailSearchFields = {
  docId?: string;
  subject?: string;
  chunks?: string[];
  timestamp?: number;
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  entityPeople?: string[];
  entityProducts?: string[];
  entityMerchants?: string[];
};

type TranscriptSearchFields = {
  docId?: string;
  fileName?: string;
  description?: string;
  chunks?: string[];
  updatedAt?: number;
  conversationId?: string;
};

export interface AggregateTeamIntelligenceParams {
  orgId: string;
  members: TeamIntelligenceMember[];
  startTime?: string;
  endTime?: string;
  includeTranscripts?: boolean;
  limitPerUser?: number;
}

const escapeVespaString = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const quoteVespaString = (value: string): string => `"${escapeVespaString(value)}"`;

const buildDateRange = (params: {
  startTime?: string;
  endTime?: string;
}): { start: Date; end: Date } => {
  const end = params.endTime ? new Date(params.endTime) : new Date();
  const start = params.startTime
    ? new Date(params.startTime)
    : new Date(end.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid time range supplied');
  }

  if (start > end) {
    throw new Error('Invalid time range supplied: startTime must be before endTime');
  }

  return { start, end };
};

const compactArray = (values: string[] | undefined): string[] =>
  Array.from(new Set((values || []).map(value => value.trim()).filter(Boolean)));

const buildSnippet = (parts: Array<string | undefined>, maxLength: number = 400): string => {
  const combined = parts
    .flatMap(part => (part || '').split('\n'))
    .map(part => part.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (combined.length <= maxLength) {
    return combined;
  }

  return `${combined.slice(0, maxLength)}...`;
};

const normalizeSubjectForTopic = (subject: string): string => {
  return subject
    .replace(/^(re|fw|fwd)\s*:\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const rankValues = (values: string[]): string[] => {
  const counts = new Map<string, { count: number; raw: string }>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { count: 1, raw: normalized });
    }
  }

  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw))
    .map(item => item.raw);
};

const buildTopicQueries = (
  emails: TeamIntelligenceEmailDocument[],
  transcripts: TeamIntelligenceTranscriptDocument[]
): string[] => {
  const rankedEntityTags = rankValues([
    ...emails.flatMap(email => email.entityProducts),
    ...emails.flatMap(email => email.entityMerchants),
    ...emails.flatMap(email => email.entityPeople),
  ]);

  const rankedSubjects = emails
    .map(email => normalizeSubjectForTopic(email.subject))
    .filter(subject => subject.length >= 8);

  const rankedTranscriptNames = transcripts
    .map(transcript => transcript.fileName.trim())
    .filter(Boolean);

  const queries = compactArray([
    ...rankedEntityTags.slice(0, MAX_TOPIC_QUERIES),
    ...rankedSubjects.slice(0, MAX_TOPIC_QUERIES),
    ...rankedTranscriptNames.slice(0, 1),
  ]);

  return queries.slice(0, MAX_TOPIC_QUERIES);
};

const buildMemberProfileQuery = (memberContext: TeamIntelligenceMemberContext): string | null => {
  const query = memberContext.topicQueries.slice(0, 2).join(' ').trim();
  return query.length >= 4 ? query : null;
};

export class TeamIntelligenceAggregationService {
  async aggregate(
    params: AggregateTeamIntelligenceParams
  ): Promise<TeamIntelligenceAggregationResult> {
    if (params.members.length === 0) {
      throw new Error('No team members found for the requested scope');
    }

    if (params.members.length > MAX_TEAM_MEMBERS) {
      throw new Error(
        `Team report currently supports up to ${MAX_TEAM_MEMBERS} members per request. Narrow the scope and retry.`
      );
    }

    const range = buildDateRange(params);
    const perUserLimit = Math.min(
      Math.max(params.limitPerUser || DEFAULT_LIMIT_PER_USER, 1),
      MAX_LIMIT_PER_USER
    );

    const members = await Promise.all(
      params.members.map(member =>
        this.buildMemberContext(
          member,
          range.start,
          range.end,
          perUserLimit,
          Boolean(params.includeTranscripts)
        )
      )
    );

    const overlaps = await this.detectOverlaps(members, range.start, range.end);

    return {
      orgId: params.orgId,
      members,
      overlaps,
      timeRange: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      includeTranscripts: Boolean(params.includeTranscripts),
      meta: {
        totalMembers: members.length,
        totalEmails: members.reduce((sum, member) => sum + member.emails.length, 0),
        totalTranscripts: members.reduce((sum, member) => sum + member.transcripts.length, 0),
        perUserLimit,
      },
    };
  }

  private async buildMemberContext(
    member: TeamIntelligenceMember,
    start: Date,
    end: Date,
    limitPerUser: number,
    includeTranscripts: boolean
  ): Promise<TeamIntelligenceMemberContext> {
    const [emails, transcripts] = await Promise.all([
      this.fetchRecentEmails(member.email, start, end, limitPerUser),
      includeTranscripts
        ? this.fetchRecentTranscripts(member.userId, start, end, Math.max(4, Math.floor(limitPerUser / 2)))
        : Promise.resolve([]),
    ]);

    const topicQueries = buildTopicQueries(emails, transcripts);

    return {
      member,
      emails,
      transcripts,
      topicQueries,
      stats: {
        emailCount: emails.length,
        transcriptCount: transcripts.length,
        peopleTags: rankValues(emails.flatMap(email => email.entityPeople)).slice(0, 5),
        productTags: rankValues(emails.flatMap(email => email.entityProducts)).slice(0, 5),
        merchantTags: rankValues(emails.flatMap(email => email.entityMerchants)).slice(0, 5),
      },
    };
  }

  private async fetchRecentEmails(
    email: string,
    start: Date,
    end: Date,
    limit: number
  ): Promise<TeamIntelligenceEmailDocument[]> {
    const response = await this.queryVespa<MailSearchFields>({
      yql: `select docId, subject, chunks, timestamp, "from", to, cc, bcc, entityPeople, entityProducts, entityMerchants from ${mailSchema} where permissions contains ${quoteVespaString(email.trim().toLowerCase())} and timestamp >= ${start.getTime()} and timestamp <= ${end.getTime()} order by timestamp desc limit ${limit};`,
      hits: limit,
      'ranking.profile': 'unranked',
      timeout: '30s',
    });

    return (response.root?.children || [])
      .map(hit => hit.fields || {})
      .map(fields => ({
        docId: fields.docId || '',
        subject: fields.subject || '(no subject)',
        snippet: buildSnippet([
          fields.subject,
          ...(fields.chunks || []).slice(0, 2),
        ]),
        timestamp: fields.timestamp || 0,
        from: fields.from || '',
        to: compactArray(fields.to),
        cc: compactArray(fields.cc),
        bcc: compactArray(fields.bcc),
        entityPeople: compactArray(fields.entityPeople),
        entityProducts: compactArray(fields.entityProducts),
        entityMerchants: compactArray(fields.entityMerchants),
      }))
      .filter(doc => Boolean(doc.docId));
  }

  private async fetchRecentTranscripts(
    userId: string,
    start: Date,
    end: Date,
    limit: number
  ): Promise<TeamIntelligenceTranscriptDocument[]> {
    const response = await this.queryVespa<TranscriptSearchFields>({
      yql: `select docId, fileName, description, chunks, updatedAt, conversationId from ${fileSchema} where subApp contains "transcript" and permissions contains ${quoteVespaString(userId)} and updatedAt >= ${start.getTime()} and updatedAt <= ${end.getTime()} order by updatedAt desc limit ${limit};`,
      hits: limit,
      'ranking.profile': 'unranked',
      timeout: '30s',
    });

    return (response.root?.children || [])
      .map(hit => hit.fields || {})
      .map(fields => ({
        docId: fields.docId || '',
        fileName: fields.fileName || 'Transcript',
        snippet: buildSnippet([
          fields.fileName,
          fields.description,
          ...(fields.chunks || []).slice(0, 2),
        ]),
        updatedAt: fields.updatedAt || 0,
        conversationId: fields.conversationId,
      }))
      .filter(doc => Boolean(doc.docId));
  }

  private async detectOverlaps(
    members: TeamIntelligenceMemberContext[],
    start: Date,
    end: Date
  ): Promise<TeamIntelligenceOverlapSignal[]> {
    const overlapMap = new Map<string, TeamIntelligenceOverlapSignal>();

    for (let leftIndex = 0; leftIndex < members.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < members.length; rightIndex += 1) {
        const left = members[leftIndex];
        const right = members[rightIndex];

        const pairSignals = await Promise.all([
          this.searchOverlapCandidate(left, right, start, end),
          this.searchOverlapCandidate(right, left, start, end),
        ]);

        const signal = pairSignals
          .filter((candidate): candidate is TeamIntelligenceOverlapSignal => Boolean(candidate))
          .sort((a, b) => b.relevanceScore - a.relevanceScore)[0];

        if (!signal) {
          continue;
        }

        const key = [left.member.userId, right.member.userId]
          .sort()
          .join(':');
        overlapMap.set(key, signal);
      }
    }

    return Array.from(overlapMap.values()).sort(
      (a, b) => b.relevanceScore - a.relevanceScore
    );
  }

  private async searchOverlapCandidate(
    source: TeamIntelligenceMemberContext,
    target: TeamIntelligenceMemberContext,
    start: Date,
    end: Date
  ): Promise<TeamIntelligenceOverlapSignal | null> {
    const profileQuery = buildMemberProfileQuery(source);
    if (!profileQuery) {
      return null;
    }

    const sourceDoc = source.emails[0];
    if (!sourceDoc) {
      return null;
    }

    const result = await googleMailSearchService.search({
      email: target.member.email,
      query: profileQuery,
      documentType: 'messages',
      limit: 1,
      offset: 0,
      timeRange: {
        startTime: start.getTime(),
        endTime: end.getTime(),
      },
    });

    const bestHit = result.results[0];
    if (!bestHit || bestHit.relevanceScore < OVERLAP_RELEVANCE_THRESHOLD) {
      return null;
    }

    return {
      sourceUserId: source.member.userId,
      sourceUserName: source.member.name,
      targetUserId: target.member.userId,
      targetUserName: target.member.name,
      query: profileQuery,
      sourceSubject: sourceDoc.subject,
      matchedSubject: bestHit.title,
      matchedDocId: bestHit.id,
      sourceDocId: sourceDoc.docId,
      relevanceScore: bestHit.relevanceScore,
      reason: `Semantic overlap detected by searching ${target.member.name}'s mailbox with a topic profile from ${source.member.name}.`,
    };
  }

  private async queryVespa<TFields>(
    payload: Record<string, unknown>
  ): Promise<VespaSearchResponse<TFields>> {
    const response = await fetch(`${vespaRuntimeConfig.vespaEndpoint.queryEndpoint}/search/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      aggregationLogger.error('[TEAM_INTELLIGENCE] Vespa query failed', {
        status: response.status,
        errorBody,
      });
      throw new Error(`Vespa query failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<VespaSearchResponse<TFields>>;
  }
}

export const teamIntelligenceAggregationService =
  new TeamIntelligenceAggregationService();
