import { createHash } from 'crypto';
import { logger } from '@/utils/logger';
import { hashOfNameAndArgs } from './protocol';
import { PackConnection } from './tapConnection';
import { RedisStreamStore } from './redisStore';
import { buildClientSchema, allPkFields } from './clientSchema';
import { queryMetaFor } from './queryMeta';
import { SHARED_BASE_QUERIES } from './baseQueries';
import { isGrantQuery } from './grantQueries';

const QUERY_TTL_MS = 60_000;
const IDLE_GRACE_MS = 30_000;
/** Pack groups per query-type. Instances spread across these by hash(partition) → bounded connections. */
const GROUPS_PER_TYPE = 8;

const schemaTag = (tables: string[]): string =>
  createHash('sha1').update([...tables].sort().join(',')).digest('hex').slice(0, 8);

const groupIndexOf = (partitionValue: string): number =>
  createHash('sha1').update(partitionValue).digest().readUInt32BE(0) % GROUPS_PER_TYPE;

interface Group {
  connection: PackConnection;
}

interface Instance {
  groupKey: string;
  partitionValue: string;
  subscribers: Set<string>;
  idleTimer: NodeJS.Timeout | null;
}

/**
 * Demand-driven registry. Instances of the same query-type are DISJOINT (partitioned
 * by their key), so many share one client group (one connection) — assigned by
 * hash(partitionValue) % GROUPS_PER_TYPE, so connection count is bounded and each
 * instance lands in a stable group across restarts. ACL and data queries are different
 * query-types → always different groups.
 */
export class InstanceManager {
  readonly #groups = new Map<string, Group>();
  readonly #instances = new Map<string, Instance>();
  readonly #store = new RedisStreamStore();
  readonly #pkFields = allPkFields();
  readonly #zeroCacheUrl: string;

  constructor(zeroCacheUrl: string) {
    this.#zeroCacheUrl = zeroCacheUrl;
  }

  /** Register interest in `query(args)`; returns its instanceKey, or null if not shareable. */
  subscribe(queryName: string, queryArgs: readonly unknown[], subscriberId: string): string | null {
    if (!SHARED_BASE_QUERIES.has(queryName) && !isGrantQuery(queryName)) return null;
    const meta = queryMetaFor(queryName, queryArgs[0]);
    if (!meta) return null;
    const partitionValue = String((queryArgs[0] as Record<string, unknown>)[meta.partitionColumn]);
    const instanceKey = hashOfNameAndArgs(queryName, queryArgs);
    const clientGroupID = `syncgrp-${queryName}-${schemaTag(meta.tables)}-${groupIndexOf(partitionValue)}`;

    let group = this.#groups.get(clientGroupID);
    if (!group) {
      const connection = new PackConnection({
        zeroCacheUrl: this.#zeroCacheUrl,
        clientGroupID,
        queryName,
        meta,
        clientSchema: buildClientSchema(meta.tables),
        pkFields: this.#pkFields,
        ttlMs: QUERY_TTL_MS,
        store: this.#store,
      });
      void connection.start();
      group = { connection };
      this.#groups.set(clientGroupID, group);
      logger.info('sync_group_open', { clientGroupID, queryName });
    }

    let instance = this.#instances.get(instanceKey);
    if (!instance) {
      group.connection.addInstance(instanceKey, queryArgs, instanceKey, partitionValue);
      instance = { groupKey: clientGroupID, partitionValue, subscribers: new Set(), idleTimer: null };
      this.#instances.set(instanceKey, instance);
    }
    if (instance.idleTimer) {
      clearTimeout(instance.idleTimer);
      instance.idleTimer = null;
    }
    instance.subscribers.add(subscriberId);
    return instanceKey;
  }

  unsubscribe(instanceKey: string, subscriberId: string): void {
    const instance = this.#instances.get(instanceKey);
    if (!instance) return;
    instance.subscribers.delete(subscriberId);
    if (instance.subscribers.size === 0 && !instance.idleTimer) {
      instance.idleTimer = setTimeout(() => void this.#teardownInstance(instanceKey), IDLE_GRACE_MS);
    }
  }

  async #teardownInstance(instanceKey: string): Promise<void> {
    const instance = this.#instances.get(instanceKey);
    if (!instance || instance.subscribers.size > 0) return;
    const group = this.#groups.get(instance.groupKey);
    group?.connection.removeInstance(instanceKey, instance.partitionValue);
    this.#instances.delete(instanceKey);
    try {
      await this.#store.teardownInstance(instanceKey);
      if (group && group.connection.size() === 0) {
        group.connection.stop();
        this.#groups.delete(instance.groupKey);
        await this.#store.teardownGroup(instance.groupKey);
        logger.info('sync_group_closed', { clientGroupID: instance.groupKey });
      }
    } catch (error) {
      logger.error('sync_instance_teardown_failed', { instanceKey, error });
    }
  }

  stopAll(): void {
    for (const instance of this.#instances.values()) {
      if (instance.idleTimer) clearTimeout(instance.idleTimer);
    }
    for (const group of this.#groups.values()) group.connection.stop();
    this.#groups.clear();
    this.#instances.clear();
  }

  activeInstances(): number {
    return this.#instances.size;
  }

  activeGroups(): number {
    return this.#groups.size;
  }
}
