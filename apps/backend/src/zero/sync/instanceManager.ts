import { createHash } from 'crypto';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { hashOfNameAndArgs } from './protocol';
import { PackConnection, type PackConnectionOptions } from './tapConnection';
import { RedisStreamStore, type FenceGuard } from './redisStore';
import { buildClientSchema, allPkFields } from './clientSchema';
import { queryMetaFor, type QueryMeta } from './queryMeta';
import { SHARED_BASE_QUERIES } from './baseQueries';
import { isGrantQuery } from './grantQueries';
import { ownership, assertOwnershipSafeRedis } from './ownership';
import { obsEmit } from './obs';

const QUERY_TTL_MS = 60_000;
const IDLE_GRACE_MS = 30_000;
/** Owner heartbeat: refresh owned group leases + re-stamp interest well inside their TTLs
 *  (LEASE_TTL_MS 10s, INTEREST_TTL_MS 15s). Also re-acquires a lost-but-still-wanted group. */
const HEARTBEAT_MS = 2_000;
/** Pack groups per query-type. Instances spread across these by hash(partition) → bounded connections. */
const GROUPS_PER_TYPE = 8;

const schemaTag = (tables: string[]): string =>
  createHash('sha1').update([...tables].sort().join(',')).digest('hex').slice(0, 8);

const groupIndexOf = (partitionValue: string): number =>
  createHash('sha1').update(partitionValue).digest().readUInt32BE(0) % GROUPS_PER_TYPE;

/** The subset of `PackConnection` the manager drives — an injection seam for tests. */
export interface PackConnectionLike {
  start(): Promise<void>;
  stop(): void;
  addInstance(instanceKey: string, args: readonly unknown[], hash: string, partitionValue: string): void;
  removeInstance(instanceKey: string, partitionValue: string): void;
  size(): number;
}

/** The subset of `ownership` the manager drives — an injection seam for tests. */
export interface OwnershipApi {
  acquireGroup(g: string): Promise<number | null>;
  refreshGroup(g: string): Promise<boolean>;
  releaseGroup(g: string): Promise<void>;
  addInterest(i: string): Promise<void>;
  removeInterest(i: string): Promise<void>;
  liveInterest(i: string): Promise<number>;
}

export interface InstanceManagerDeps {
  ownership?: OwnershipApi;
  createConnection?: (opts: PackConnectionOptions) => PackConnectionLike;
  multiPod?: boolean;
  assertRedisSafe?: () => Promise<void>;
  graceMs?: number;
  heartbeatMs?: number;
}

interface Group {
  clientGroupID: string;
  queryName: string;
  meta: QueryMeta;
  /** The instances assigned to this group that some local subscriber wants (drives materialization). */
  members: Set<string>;
  connection: PackConnectionLike | null;
  /** Fence token while THIS pod owns the group (null = not owned; single-pod mode leaves it null). */
  token: number | null;
  owned: boolean;
  /** An acquire is in flight — guards against double-acquire from concurrent subscribes. */
  acquiring: boolean;
}

interface Instance {
  groupKey: string;
  partitionValue: string;
  args: readonly unknown[];
  subscribers: Set<string>;
  idleTimer: NodeJS.Timeout | null;
}

/**
 * Demand-driven registry. Instances of the same query-type are DISJOINT (partitioned
 * by their key), so many share one client group (one connection) — assigned by
 * hash(partitionValue) % GROUPS_PER_TYPE, so connection count is bounded and each
 * instance lands in a stable group across restarts. ACL and data queries are different
 * query-types → always different groups.
 *
 * MULTI-POD (config.enableSyncEngineMultiPod): materialization of a group runs on exactly
 * ONE pod, guarded by a per-group Redis lease + fence (ownership.ts). A subscribing pod
 * registers per-instance INTEREST and only materializes locally if it wins the group lease;
 * every tap write carries the fence token so a zombie ex-owner can't corrupt Redis. With the
 * flag OFF (default) none of that runs — the pod is the sole unfenced owner, correct for a
 * single replica and byte-identical to the pre-multi-pod behavior.
 */
export class InstanceManager {
  readonly #groups = new Map<string, Group>();
  readonly #instances = new Map<string, Instance>();
  readonly #store = new RedisStreamStore();
  readonly #pkFields = allPkFields();
  readonly #zeroCacheUrl: string;

  readonly #ownership: OwnershipApi;
  readonly #createConnection: (opts: PackConnectionOptions) => PackConnectionLike;
  #multiPod: boolean;
  #heartbeat: NodeJS.Timeout | null = null;
  readonly #graceMs: number;
  readonly #heartbeatMs: number;
  /** Resolves once the Redis-safety assertion has passed — no lease is acquired before then. */
  readonly #ready: Promise<void>;

  constructor(zeroCacheUrl: string, deps: InstanceManagerDeps = {}) {
    this.#zeroCacheUrl = zeroCacheUrl;
    this.#ownership = deps.ownership ?? ownership;
    this.#createConnection = deps.createConnection ?? ((opts) => new PackConnection(opts));
    this.#multiPod = deps.multiPod ?? config.enableSyncEngineMultiPod;
    this.#graceMs = deps.graceMs ?? IDLE_GRACE_MS;
    this.#heartbeatMs = deps.heartbeatMs ?? HEARTBEAT_MS;

    if (this.#multiPod) {
      const assertSafe = deps.assertRedisSafe ?? assertOwnershipSafeRedis;
      // Refuse ownership on a Redis that would evict the fence. Degrade to single unfenced
      // owner (safe on ONE replica, on any Redis) with a FATAL log rather than run fencing
      // that silently doesn't fence — the operator must fix Redis before scaling out.
      this.#ready = assertSafe().catch((error) => {
        this.#multiPod = false;
        this.#stopHeartbeat();
        logger.error('sync_ownership_unsafe_redis_disabled_multipod', { error });
      });
      this.#heartbeat = setInterval(() => void this.#onHeartbeat(), this.#heartbeatMs);
    } else {
      this.#ready = Promise.resolve();
    }
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
      group = {
        clientGroupID,
        queryName,
        meta,
        members: new Set(),
        connection: null,
        token: null,
        owned: false,
        acquiring: false,
      };
      this.#groups.set(clientGroupID, group);
    }

    let instance = this.#instances.get(instanceKey);
    if (!instance) {
      instance = { groupKey: clientGroupID, partitionValue, args: queryArgs, subscribers: new Set(), idleTimer: null };
      this.#instances.set(instanceKey, instance);
      group.members.add(instanceKey);
      obsEmit('tap', {
        action: 'instance-open',
        instanceKey,
        queryName,
        partition: partitionValue,
        clientGroupID,
        grant: isGrantQuery(queryName),
      });
    }
    if (instance.idleTimer) {
      clearTimeout(instance.idleTimer);
      instance.idleTimer = null;
    }
    instance.subscribers.add(subscriberId);

    if (this.#multiPod) void this.#ownership.addInterest(instanceKey);
    void this.#ensureMaterialized(group);
    return instanceKey;
  }

  /**
   * Ensure this pod materializes the group iff it should: acquire the lease (multi-pod only;
   * skip if owned elsewhere — a reconcile on the owner will materialize the members there),
   * open the connection once owned, and (idempotently) desire every current member. Safe to
   * call repeatedly and concurrently; the `acquiring` guard prevents a double-acquire.
   */
  async #ensureMaterialized(group: Group): Promise<void> {
    if (this.#multiPod && !group.owned) {
      if (group.acquiring) return;
      group.acquiring = true;
      try {
        await this.#ready; // never acquire before the Redis-safety gate has passed
        if (this.#multiPod) {
          const token = await this.#ownership.acquireGroup(group.clientGroupID);
          if (token == null) return; // owned elsewhere — a reconcile there materializes the members
          group.owned = true;
          group.token = token;
        }
        // else: the assertion downgraded us to single unfenced owner → fall through, open unfenced
      } finally {
        group.acquiring = false;
      }
    }
    // A concurrent teardown may have emptied/removed the group while we awaited the acquire.
    if (!this.#groups.has(group.clientGroupID)) return;

    if (!group.connection) {
      group.connection = this.#createConnection({
        zeroCacheUrl: this.#zeroCacheUrl,
        clientGroupID: group.clientGroupID,
        queryName: group.queryName,
        meta: group.meta,
        clientSchema: buildClientSchema(group.meta.tables),
        pkFields: this.#pkFields,
        ttlMs: QUERY_TTL_MS,
        store: this.#store,
        guard: this.#guardFor(group),
        onFenceLost: () => this.#demoteGroup(group),
      });
      void group.connection.start();
      logger.info('sync_group_open', { clientGroupID: group.clientGroupID, queryName: group.queryName });
      obsEmit('tap', { action: 'group-open', clientGroupID: group.clientGroupID, queryName: group.queryName, tables: group.meta.tables });
    }
    for (const ik of group.members) {
      const inst = this.#instances.get(ik);
      if (inst) group.connection.addInstance(ik, inst.args, ik, inst.partitionValue);
    }
  }

  /** The fence guard for a group's tap writes — undefined unless this pod owns it under multi-pod. */
  #guardFor(group: Group): FenceGuard | undefined {
    return group.token != null ? { groupKey: group.clientGroupID, token: group.token } : undefined;
  }

  /**
   * We lost the group lease (a fenced write went stale, or a heartbeat refresh failed). DISCARD
   * the connection — it is single-use once fenced-out (stale token/cookie/state) — and mark the
   * group unowned. A later heartbeat re-acquires with a FRESH connection + token if members remain.
   */
  #demoteGroup(group: Group): void {
    group.connection?.stop();
    group.connection = null;
    group.owned = false;
    group.token = null;
    logger.warn('sync_group_demoted', { clientGroupID: group.clientGroupID });
    obsEmit('tap', { action: 'group-demote', clientGroupID: group.clientGroupID });
  }

  unsubscribe(instanceKey: string, subscriberId: string): void {
    const instance = this.#instances.get(instanceKey);
    if (!instance) return;
    instance.subscribers.delete(subscriberId);
    if (instance.subscribers.size === 0 && !instance.idleTimer) {
      instance.idleTimer = setTimeout(() => void this.#teardownInstance(instanceKey), this.#graceMs);
    }
  }

  async #teardownInstance(instanceKey: string): Promise<void> {
    const instance = this.#instances.get(instanceKey);
    if (!instance || instance.subscribers.size > 0) return;
    const group = this.#groups.get(instance.groupKey);

    if (this.#multiPod) {
      // Drop our interest, then only reclaim if NO pod still wants it. If another pod does, we
      // may be its materializing owner — leave everything in place and let a reconcile (item 3)
      // reclaim it once fleet interest finally drops. Never delete data another pod is tailing.
      await this.#ownership.removeInterest(instanceKey);
      if ((await this.#ownership.liveInterest(instanceKey)) > 0) return;
    }

    // Demote-before-delete: stop materializing (removeInstance) BEFORE deleting the snapshot/stream.
    group?.connection?.removeInstance(instanceKey, instance.partitionValue);
    this.#instances.delete(instanceKey);
    group?.members.delete(instanceKey);
    obsEmit('tap', { action: 'instance-close', instanceKey, clientGroupID: instance.groupKey });
    try {
      await this.#store.teardownInstance(instanceKey, group ? this.#guardFor(group) : undefined);
      if (group && group.connection && group.connection.size() === 0) {
        group.connection.stop();
        this.#groups.delete(instance.groupKey);
        await this.#store.teardownGroup(instance.groupKey, this.#guardFor(group));
        if (this.#multiPod && group.owned) await this.#ownership.releaseGroup(group.clientGroupID);
        logger.info('sync_group_closed', { clientGroupID: instance.groupKey });
        obsEmit('tap', { action: 'group-close', clientGroupID: instance.groupKey });
      }
    } catch (error) {
      logger.error('sync_instance_teardown_failed', { instanceKey, error });
    }
  }

  /**
   * Owner heartbeat (multi-pod). Keep owned leases alive and re-stamp interest for every locally
   * wanted instance; demote a group whose lease we lost; and (re)acquire a group we want but don't
   * own — a minimal self-heal after a transient stall drops a lease. Cross-pod takeover of OTHER
   * pods' dead leases + materializing remote-only interest is the item-3 reconcile loop.
   */
  async #onHeartbeat(): Promise<void> {
    for (const group of this.#groups.values()) {
      if (group.owned) {
        if (!(await this.#ownership.refreshGroup(group.clientGroupID))) {
          this.#demoteGroup(group);
        }
      }
      if (!group.owned && group.members.size > 0) {
        void this.#ensureMaterialized(group);
      }
    }
    for (const instanceKey of this.#instances.keys()) void this.#ownership.addInterest(instanceKey);
  }

  #stopHeartbeat(): void {
    if (this.#heartbeat) {
      clearInterval(this.#heartbeat);
      this.#heartbeat = null;
    }
  }

  stopAll(): void {
    this.#stopHeartbeat();
    for (const instance of this.#instances.values()) {
      if (instance.idleTimer) clearTimeout(instance.idleTimer);
    }
    for (const group of this.#groups.values()) group.connection?.stop();
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
