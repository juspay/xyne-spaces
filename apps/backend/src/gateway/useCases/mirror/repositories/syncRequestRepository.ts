import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import { createRedisClient } from '../../../re-exports';
import type { SyncRequest, SyncRequestStatus } from '../types';

export type NewSyncRequest = Pick<
  SyncRequest,
  'workspaceId' | 'connectionId' | 'externalId' | 'externalName' | 'spacesId' | 'requestedBy'
>;

export interface SyncRequestFilters {
  statuses?: SyncRequestStatus[];
  from?: number;
  to?: number;
  requestedBy?: string;
}

// The newest requests a list reads before filtering, like self-serve migration's admin list.
const LIST_LIMIT = 500;

let client: Redis | undefined;
const redis = (): Redis => (client ??= createRedisClient('mirror-sync-requests'));

function encode(request: SyncRequest): Record<string, string> {
  return {
    ...request,
    requestedAt: String(request.requestedAt.getTime()),
    decidedBy: request.decidedBy ?? '',
    decidedAt: request.decidedAt ? String(request.decidedAt.getTime()) : '',
    reason: request.reason ?? '',
  };
}

function decode(hash: Record<string, string>): SyncRequest {
  return {
    id: hash.id,
    workspaceId: hash.workspaceId,
    connectionId: hash.connectionId,
    externalId: hash.externalId,
    externalName: hash.externalName,
    spacesId: hash.spacesId,
    requestedBy: hash.requestedBy,
    requestedAt: new Date(Number(hash.requestedAt)),
    status: hash.status as SyncRequestStatus,
    decidedBy: hash.decidedBy || null,
    decidedAt: hash.decidedAt ? new Date(Number(hash.decidedAt)) : null,
    reason: hash.reason || null,
  };
}

/**
 * Channel admins' sync requests, kept in Redis with no expiry like self-serve migration's jobs: a hash per
 * request, an index per workspace, and a lock on the Spaces and the provider channel while one is pending.
 */
export class SyncRequestRepository {
  /** Null when a pending request already holds either resource. */
  async create(data: NewSyncRequest): Promise<SyncRequest | null> {
    const request: SyncRequest = {
      ...data,
      id: randomUUID(),
      requestedAt: new Date(),
      status: 'PENDING',
      decidedBy: null,
      decidedAt: null,
      reason: null,
    };
    const [spacesLock, externalLock] = this.locksOf(request);
    if (!(await redis().set(spacesLock, request.id, 'NX'))) return null;
    if (!(await redis().set(externalLock, request.id, 'NX'))) {
      await redis().del(spacesLock);
      return null;
    }
    await redis()
      .multi()
      .hset(this.key(request.id), encode(request))
      .zadd(this.indexKey(request.workspaceId), request.requestedAt.getTime(), request.id)
      .set(this.latestKey(request.workspaceId, request.spacesId), request.id)
      .exec();
    return request;
  }

  async findById(id: string): Promise<SyncRequest | null> {
    const hash = await redis().hgetall(this.key(id));
    return Object.keys(hash).length > 0 ? decode(hash) : null;
  }

  /** The newest request for a Spaces resource, whatever its status. */
  async findLatestBySpacesId(workspaceId: string, spacesId: string): Promise<SyncRequest | null> {
    const id = await redis().get(this.latestKey(workspaceId, spacesId));
    return id ? await this.findById(id) : null;
  }

  /** Which of these external resources a pending request holds. */
  async findPendingExternalIds(workspaceId: string, externalIds: string[]): Promise<Set<string>> {
    if (externalIds.length === 0) return new Set();
    const held = await redis().mget(
      externalIds.map((externalId) => this.lockKey(workspaceId, 'external', externalId))
    );
    return new Set(externalIds.filter((_, index) => held[index]));
  }

  /** Newest first. */
  async list(workspaceId: string, filters: SyncRequestFilters = {}): Promise<SyncRequest[]> {
    const ids = await redis().zrevrangebyscore(
      this.indexKey(workspaceId),
      filters.to ?? '+inf',
      filters.from ?? '-inf',
      'LIMIT',
      0,
      LIST_LIMIT
    );
    if (ids.length === 0) return [];
    const pipeline = redis().pipeline();
    for (const id of ids) pipeline.hgetall(this.key(id));
    const results = (await pipeline.exec()) ?? [];
    return results
      .map(([, hash]) => hash as Record<string, string>)
      .filter((hash) => hash && Object.keys(hash).length > 0)
      .map(decode)
      .filter(
        (request) =>
          (!filters.statuses?.length || filters.statuses.includes(request.status)) &&
          (!filters.requestedBy || request.requestedBy === filters.requestedBy)
      );
  }

  /** Closes a pending request and frees both resources for new requests. */
  async close(
    request: SyncRequest,
    status: Exclude<SyncRequestStatus, 'PENDING'>,
    decidedBy: string,
    reason: string | null = null
  ): Promise<SyncRequest> {
    const closed: SyncRequest = { ...request, status, decidedBy, decidedAt: new Date(), reason };
    await redis().hset(this.key(request.id), encode(closed));
    for (const lock of this.locksOf(request)) {
      if ((await redis().get(lock)) === request.id) await redis().del(lock);
    }
    return closed;
  }

  private locksOf(request: SyncRequest): [string, string] {
    return [
      this.lockKey(request.workspaceId, 'spaces', request.spacesId),
      this.lockKey(request.workspaceId, 'external', request.externalId),
    ];
  }

  private key(id: string): string {
    return `mirror:request:${id}`;
  }

  private indexKey(workspaceId: string): string {
    return `mirror:requests:${workspaceId}`;
  }

  private latestKey(workspaceId: string, spacesId: string): string {
    return `mirror:request-latest:${workspaceId}:${spacesId}`;
  }

  private lockKey(workspaceId: string, side: 'spaces' | 'external', id: string): string {
    return `mirror:request-lock:${workspaceId}:${side}:${id}`;
  }
}
