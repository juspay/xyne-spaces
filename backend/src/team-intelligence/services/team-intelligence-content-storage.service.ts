import { createHash } from 'crypto';
import { getStorageService } from '@/services/storage';
import { logger } from '@/utils/logger';

export interface TeamIntelligenceStoredContentPointer {
  contentUrl: string;
  contentSize: number;
  contentChecksum: string;
}

type TeamIntelligenceContentEntity =
  | 'batch'
  | 'user'
  | 'user-summary'
  | 'team-summary'
  | 'org-summary';

interface StoreJsonPayloadInput {
  entityType: TeamIntelligenceContentEntity;
  entityId: string;
  contentType:
    | 'request-payload'
    | 'raw-payload'
    | 'pull-requests'
    | 'solo-commits'
    | 'employee-summary'
    | 'summary-metadata'
    | 'summary-text'
    | 'provenance';
  payload: unknown;
}

function buildChecksum(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const storageService = getStorageService();

function parseStorageLocator(contentUrl: string): { path: string; uriBucket?: string } | null {
  if (!contentUrl) {
    return null;
  }

  // Backward/forward compatible: accept both gs://bucket/path and raw object paths.
  if (!contentUrl.startsWith('gs://')) {
    return { path: contentUrl };
  }

  const withoutPrefix = contentUrl.slice('gs://'.length);
  const slashIndex = withoutPrefix.indexOf('/');
  if (slashIndex <= 0) {
    return null;
  }

  const uriBucket = withoutPrefix.slice(0, slashIndex);
  const path = withoutPrefix.slice(slashIndex + 1);
  if (!path) {
    return null;
  }

  return { path, uriBucket };
}

function shouldHydrateFromUrl(value: unknown): boolean {
  return value === null || value === undefined;
}

class TeamIntelligenceContentStorageService {
  async storeJsonPayload(input: StoreJsonPayloadInput): Promise<TeamIntelligenceStoredContentPointer> {
    const serialized = JSON.stringify(input.payload ?? null);
    const checksum = buildChecksum(serialized);
    const timestamp = Date.now();
    const path = [
      'team-intelligence',
      input.entityType,
      input.entityId,
      `${input.contentType}-${timestamp}-${checksum.slice(0, 12)}.json`,
    ].join('/');

    const upload = await storageService.uploadFileV2(Buffer.from(serialized, 'utf8'), {
      path,
      contentType: 'application/json',
      metadata: {
        checksum,
        entityType: input.entityType,
        entityId: input.entityId,
        contentType: input.contentType,
      },
    });

    return {
      contentUrl: storageService.buildStorageUri(upload.path),
      contentSize: upload.size,
      contentChecksum: checksum,
    };
  }

  async loadJsonPayload<T>(contentUrl: string): Promise<T> {
    const parsed = parseStorageLocator(contentUrl);
    if (!parsed) {
      throw new Error(`Invalid storage locator: ${contentUrl}`);
    }

    if (parsed.uriBucket) {
      const expectedPrefix = storageService.buildStorageUri('');
      const expectedBucket = expectedPrefix.startsWith('gs://')
        ? expectedPrefix.slice('gs://'.length).replace(/\/$/, '')
        : undefined;

      if (expectedBucket && parsed.uriBucket !== expectedBucket) {
        logger.warn('[TeamIntelligenceContentStorage] Reading content from non-default bucket URI', {
          requestedBucket: parsed.uriBucket,
          configuredBucket: expectedBucket,
          contentUrl,
        });
      }
    }

    const buffer = await storageService.getFileBuffer(parsed.path);
    return JSON.parse(buffer.toString('utf8')) as T;
  }

  async hydrateJsonPayload<T>(inlineValue: unknown, contentUrl: string | null | undefined): Promise<T | null> {
    if (!shouldHydrateFromUrl(inlineValue)) {
      return inlineValue as T;
    }

    if (!contentUrl) {
      return null;
    }

    try {
      return await this.loadJsonPayload<T>(contentUrl);
    } catch (error) {
      logger.error('[TeamIntelligenceContentStorage] Failed to hydrate payload from GCS', {
        contentUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

export const teamIntelligenceContentStorageService = new TeamIntelligenceContentStorageService();
