import {
  createDefaultConfig,
  createVespaService,
  GoogleApps,
  mailAttachmentSchema,
  mailSchema,
} from '@xyne/vespa-ts';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import {
  transformVespaResults,
  type TransformedSearchResult,
} from '@/services/vespaSearch/resultTransform';
import type { VespaSearchHit } from '@/vespa/src/types';
import vespaRuntimeConfig, {
  CLUSTER,
  NAMESPACE,
  vespaBaseHost,
} from '@/vespa/vespaConfig';
import { parseDateToTimestamp, parseTimeKeyword } from '@/vespa/src/utils/dateParser';

export type GoogleMailParticipantFilters = {
  from?: string[];
  to?: string[];
  cc?: string[];
  bcc?: string[];
};

export type GoogleMailTimeRange = {
  startTime: number;
  endTime: number;
};

export interface GoogleMailSearchParams {
  email: string;
  query?: string;
  offset?: number;
  limit?: number;
  sortBy?: 'asc' | 'desc';
  documentType?: 'messages' | 'attachments';
  labels?: string[];
  participants?: GoogleMailParticipantFilters;
  timeRange?: GoogleMailTimeRange;
}

export interface GoogleMailSearchResult {
  grouped: false;
  results: TransformedSearchResult[];
  totalCount: number;
  offset: number;
  limit: number;
}

type GmailEntityTagSearchResponse = {
  root?: {
    children?: VespaSearchHit[];
    fields?: {
      totalCount?: number | string;
    };
  };
};

type GmailSearchDocumentType = 'messages' | 'attachments' | undefined;

const googleMailSearchConfig = createDefaultConfig({
  vespaBaseHost,
  page: vespaRuntimeConfig.VespaPageSize,
  isDebugMode: vespaRuntimeConfig.isDebugMode,
  namespace: NAMESPACE,
  cluster: CLUSTER,
  vespaMaxRetryAttempts: vespaRuntimeConfig.vespaMaxRetryAttempts,
  vespaRetryDelay: vespaRuntimeConfig.vespaRetryDelay,
  feedEndpoint: vespaRuntimeConfig.vespaEndpoint.feedEndpoint,
  queryEndpoint: vespaRuntimeConfig.vespaEndpoint.queryEndpoint,
});

const createGoogleMailSearchVespa = (
  sourceSchemas:
    | [typeof mailSchema]
    | [typeof mailAttachmentSchema]
    | [typeof mailSchema, typeof mailAttachmentSchema]
) =>
  createVespaService({
    logger: logger.child({ module: 'google-mail-search' }) as any,
    config: googleMailSearchConfig,
    sourceSchemas,
  });

const googleMailSearchVespa = createGoogleMailSearchVespa([mailSchema, mailAttachmentSchema]);
const googleMailMessageSearchVespa = createGoogleMailSearchVespa([mailSchema]);
const googleMailAttachmentSearchVespa = createGoogleMailSearchVespa([mailAttachmentSchema]);

const compactParticipantFilters = (
  participants?: GoogleMailParticipantFilters
): GoogleMailParticipantFilters | undefined => {
  if (!participants) {
    return undefined;
  }

  const nextParticipants: GoogleMailParticipantFilters = {};

  if (participants.from?.length) {
    nextParticipants.from = participants.from;
  }
  if (participants.to?.length) {
    nextParticipants.to = participants.to;
  }
  if (participants.cc?.length) {
    nextParticipants.cc = participants.cc;
  }
  if (participants.bcc?.length) {
    nextParticipants.bcc = participants.bcc;
  }

  return Object.keys(nextParticipants).length > 0 ? nextParticipants : undefined;
};

const escapeVespaString = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const quoteVespaString = (value: string): string => `"${escapeVespaString(value)}"`;

const buildParticipantConditions = (
  participants?: GoogleMailParticipantFilters
): string[] => {
  if (!participants) {
    return [];
  }

  const participantFields: Record<keyof GoogleMailParticipantFilters, string> = {
    from: '"from"',
    to: 'to',
    cc: 'cc',
    bcc: 'bcc',
  };

  return (Object.keys(participantFields) as Array<keyof GoogleMailParticipantFilters>).flatMap(
    field => {
      const values = participants[field] || [];
      if (values.length === 0) {
        return [];
      }

      const conditions = values
        .map(value => value.trim())
        .filter(Boolean)
        .map(value =>
          value.includes('@')
            ? `${participantFields[field]} contains ${quoteVespaString(value)}`
            : `${participantFields[field]} matches ${quoteVespaString(value)}`
        );

      return conditions.length > 0 ? [`(${conditions.join(' or ')})`] : [];
    }
  );
};

export const buildGmailTimeRange = (params: {
  before?: string;
  after?: string;
  on?: string;
  range?: string;
}): GoogleMailTimeRange | undefined => {
  if (params.on) {
    const startTime = parseDateToTimestamp(params.on, 'start');
    const endTime = parseDateToTimestamp(params.on, 'end');
    if (startTime !== null && endTime !== null) {
      return { startTime, endTime };
    }
  }

  if (params.range) {
    const parsedRange = parseTimeKeyword(params.range);
    if (parsedRange) {
      return {
        startTime: parsedRange.from,
        endTime: parsedRange.to,
      };
    }
  }

  const startTime = params.after ? parseDateToTimestamp(params.after, 'start') : null;
  const endTime = params.before ? parseDateToTimestamp(params.before, 'end') : null;

  if (startTime !== null && endTime !== null) {
    return { startTime, endTime };
  }
  if (startTime !== null) {
    return { startTime, endTime: Date.now() };
  }
  if (endTime !== null) {
    return { startTime: 0, endTime };
  }

  return undefined;
};

export const mapSearchTypeToGmailDocumentType = (
  type?: string
): GmailSearchDocumentType => {
  if (type === 'messages') {
    return 'messages';
  }

  if (type === 'attachments' || type === 'files') {
    return 'attachments';
  }

  return undefined;
};

export const canSearchGmailForType = (type?: string): boolean => {
  return !type || type === 'messages' || type === 'attachments' || type === 'files';
};

class GoogleMailSearchService {
  private async searchEntityTagMatches(
    params: GoogleMailSearchParams,
    limit: number
  ): Promise<GmailEntityTagSearchResponse | null> {
    const query = params.query?.trim();
    if (!query || params.documentType === 'attachments' || params.offset) {
      return null;
    }

    const conditions = [
      `permissions contains ${quoteVespaString(params.email.trim().toLowerCase())}`,
      `(${[
        `entityPeople contains ${quoteVespaString(query)}`,
        `entityProducts contains ${quoteVespaString(query)}`,
        `entityMerchants contains ${quoteVespaString(query)}`,
      ].join(' or ')})`,
    ];

    if (params.labels?.length) {
      const labelConditions = params.labels
        .map(label => label.trim())
        .filter(Boolean)
        .map(label => `labels contains ${quoteVespaString(label)}`);

      if (labelConditions.length > 0) {
        conditions.push(`(${labelConditions.join(' or ')})`);
      }
    }

    const participantConditions = buildParticipantConditions(
      compactParticipantFilters(params.participants)
    );
    if (participantConditions.length > 0) {
      conditions.push(...participantConditions);
    }

    if (params.timeRange && (params.timeRange.startTime || params.timeRange.endTime)) {
      if (params.timeRange.startTime) {
        conditions.push(`timestamp >= ${params.timeRange.startTime}`);
      }
      if (params.timeRange.endTime) {
        conditions.push(`timestamp <= ${params.timeRange.endTime}`);
      }
    }

    const response = await fetch(`${googleMailSearchConfig.queryEndpoint}/search/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        yql: `select * from ${mailSchema} where ${conditions.join(' and ')};`,
        hits: limit,
        timeout: '30s',
        'ranking.profile': 'unranked',
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error('[GOOGLE_MAIL] Entity tag search failed', {
        status: response.status,
        errorBody,
      });
      throw new Error(`Entity tag search failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<GmailEntityTagSearchResponse>;
  }

  async search(params: GoogleMailSearchParams): Promise<GoogleMailSearchResult> {
    const offset = Math.max(params.offset || 0, 0);
    const limit = Math.min(Math.max(params.limit || 20, 1), 100);
    const vespaService =
      params.documentType === 'messages'
        ? googleMailMessageSearchVespa
        : params.documentType === 'attachments'
          ? googleMailAttachmentSearchVespa
          : googleMailSearchVespa;

    const response = await vespaService.searchGoogleApps({
      app: GoogleApps.Gmail,
      email: params.email,
      query: params.query,
      offset,
      limit,
      sortBy: params.sortBy || 'desc',
      labels: params.labels,
      participants: compactParticipantFilters(params.participants),
      timeRange: params.timeRange,
    });

    const primaryHits = (response.root?.children || []) as unknown as VespaSearchHit[];
    const entityTagResponse = await this.searchEntityTagMatches(params, limit).catch(error => {
      logger.warn('[GOOGLE_MAIL] Falling back to primary search after entity tag search failure', {
        email: params.email,
        query: params.query,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    });
    const entityTagHits = entityTagResponse?.root?.children || [];
    const mergedHits = Array.from(
      new Map([...entityTagHits, ...primaryHits].map(hit => [hit.id, hit] as const)).values()
    ).slice(0, limit);

    const totalCount =
      mergedHits.length > 0 ? mergedHits.length : Number(response.root?.fields?.totalCount || 0);
    const results = await transformVespaResults(mergedHits as any, db);

    return {
      grouped: false,
      results,
      totalCount,
      offset,
      limit,
    };
  }
}

export const googleMailSearchService = new GoogleMailSearchService();
