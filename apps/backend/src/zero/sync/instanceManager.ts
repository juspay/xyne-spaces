import { createHash } from 'crypto';
import { logger } from '@/utils/logger';
import { hashOfNameAndArgs } from './protocol';
import { PackConnection, type PackConnectionOptions } from './tapConnection';
import { RedisStreamStore, type FenceGuard } from './redisStore';
import { buildClientSchema, allPkFields } from './clientSchema';
import { queryMetaFor, type QueryMeta } from './queryMeta';
import { SHARED_BASE_QUERIES } from './baseQueries';
import { isGrantQuery } from './grantQueries';
import { isRowLevelQuery } from './rowLevelQueries';
import { ownership, assertOwnershipSafeRedis } from './ownership';
import { obsEmit } from './obs';

const QUERY_TTL_MS = 60_000;
const IDLE_GRACE_MS = 30_000;
/** Grant instances are PER-USER — refcount hits 0 the instant U disconnects (only U references
 *  them), unlike shared per-channel data instances. A longer grace keeps U's grants WARM across
 *  reconnects (tab reloads, network blips) and, critically, across a reconnect STORM (mass CVR
 *  wipe / redeploy), so the fleet doesn't re-hydrate every user's grants from cold at once
 *  (ratification finding #2). Small + cheap to hold; the window just trades a little idle memory
 *  for storm resilience. */
const GRANT_IDLE_GRACE_MS = 300_000;
/** Owner heartbeat: refresh owned group leases + re-stamp interest well inside their TTLs
 *  (LEASE_TTL_MS 10s, INTEREST_TTL_MS 15s). Also re-acquires a lost-but-still-wanted group. */
const HEARTBEAT_MS = 2_000;
/** An owned group whose tap is DISCONNECTED and has had no poke for this long is a candidate wedged
 *  owner (healthy lease, dead tap) — warn so it is not invisible. Idle-but-connected never trips. */
const STALE_OWNER_MS = 120_000;
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
  isConnected(): boolean;
  msSinceLastPoke(): number;
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
  grantGraceMs?: number;
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
  /** Grant instances get a longer idle grace (kept warm across reconnects) — see GRANT_IDLE_GRACE_MS. */
  isGrant: boolean;
}

/**
 * Demand-driven registry. Instances of the same query-type are DISJOINT (partitioned
 * by their key), so many share one client group (one connection) — assigned by
 * hash(partitionValue) % GROUPS_PER_TYPE, so connection count is bounded and each
 * instance lands in a stable group across restarts. ACL and data queries are different
 * query-types → always different groups.
 *
 * MULTI-POD (`deps.multiPod`, default OFF): materialization of a group runs on exactly
 * ONE pod, guarded by a per-group Redis lease + fence (ownership.ts). A subscribing pod
 * registers per-instance INTEREST and only materializes locally if it wins the group lease;
 * every tap write carries the fence token so a zombie ex-owner can't corrupt Redis. OFF
 * (the prod topology: one sync-engine replica) runs none of that — the pod is the sole
 * unfenced owner. The machinery stays test-injectable via `deps.multiPod`; there is no env
 * toggle (a second replica is a deliberate, code-reviewed change, not a config flip).
 */
export class InstanceManager {
  readonly #groups = new Map<string, Group>();
  readonly #instances = new Map<string, Instance>();
  readonly #store = new RedisStreamStore();
  readonly #pkFields = allPkFields();
  readonly #zeroCacheUrl: string;

  readonly #ownership: OwnershipApi;
  readonly #createConnection: (opts: PackConnectionOptions) => PackConnectionLike;
  readonly #multiPod: boolean;
  /** Set when the Redis-safety assertion fails: refuse ALL materialization (fan-out only). */
  #materializeDisabled = false;
  /** Set by stopAll — an in-flight heartbeat/reconcile must not write to Redis after shutdown. */
  #stopped = false;
  #heartbeat: NodeJS.Timeout | null = null;
  readonly #graceMs: number;
  readonly #grantGraceMs: number;
  readonly #heartbeatMs: number;
  /** Resolves once the Redis-safety assertion has passed — no lease is acquired before then. */
  readonly #ready: Promise<void>;

  constructor(zeroCacheUrl: string, deps: InstanceManagerDeps = {}) {
    this.#zeroCacheUrl = zeroCacheUrl;
    this.#ownership = deps.ownership ?? ownership;
    this.#createConnection = deps.createConnection ?? ((opts) => new PackConnection(opts));
    this.#multiPod = deps.multiPod ?? false;
    this.#graceMs = deps.graceMs ?? IDLE_GRACE_MS;
    this.#grantGraceMs = deps.grantGraceMs ?? GRANT_IDLE_GRACE_MS;
    this.#heartbeatMs = deps.heartbeatMs ?? HEARTBEAT_MS;

    if (this.#multiPod) {
      const assertSafe = deps.assertRedisSafe ?? assertOwnershipSafeRedis;
      // An `allkeys-*` Redis can evict the fence, voiding fencing. We CANNOT know whether we're
      // the only replica, and the flag being on means the operator says we aren't — so we must
      // NOT fall back to an unfenced owner (that would make every pod an unfenced writer racing
      // the same snapshot). Degrade to FAN-OUT ONLY: refuse all materialization, FATAL-log, and
      // let a pod with safe Redis (or an ops fix) own it. Clients still read whatever is in Redis.
      this.#ready = assertSafe().catch((error) => {
        this.#materializeDisabled = true;
        this.#stopHeartbeat();
        logger.error('sync_ownership_unsafe_redis_fanout_only', { error });
      });
      this.#heartbeat = setInterval(() => void this.#onHeartbeat(), this.#heartbeatMs);
    } else {
      this.#ready = Promise.resolve();
    }
  }

  /** Register interest in `query(args)`; returns its instanceKey, or null if not shareable. */
  subscribe(queryName: string, queryArgs: readonly unknown[], subscriberId: string): string | null {
    if (!SHARED_BASE_QUERIES.has(queryName) && !isGrantQuery(queryName) && !isRowLevelQuery(queryName)) return null;
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
      instance = { groupKey: clientGroupID, partitionValue, args: queryArgs, subscribers: new Set(), idleTimer: null, isGrant: isGrantQuery(queryName) };
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

    if (this.#multiPod) {
      // Stamp interest BEFORE announcing the descriptor: the owner treats a registry entry with no
      // live interest as dead and prunes it, so the entry must never be visible before its interest.
      void (async () => {
        await this.#ownership.addInterest(instanceKey);
        await this.#store.registerInstance(clientGroupID, instanceKey, JSON.stringify({ args: queryArgs, partitionValue }));
      })().catch((error) => logger.error('sync_register_instance_failed', { instanceKey, error }));
    }
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
    if (this.#stopped || this.#materializeDisabled) return; // shut down, or fan-out only (unsafe Redis)
    if (this.#multiPod && !group.owned) {
      if (group.acquiring) return;
      group.acquiring = true;
      try {
        await this.#ready; // never acquire before the Redis-safety gate has passed
        if (this.#stopped || this.#materializeDisabled) return; // stopped/gate-failed while we awaited
        const token = await this.#ownership.acquireGroup(group.clientGroupID);
        if (token == null) return; // owned elsewhere — a reconcile there materializes the members
        if (this.#stopped) {
          await this.#ownership.releaseGroup(group.clientGroupID); // stopAll raced our acquire — give it back
          return;
        }
        group.owned = true;
        group.token = token;
      } finally {
        group.acquiring = false;
      }
    }
    // A concurrent teardown/shutdown may have emptied/removed the group while we awaited the acquire.
    if (this.#stopped || !this.#groups.has(group.clientGroupID)) return;

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
      // Per-user grant instances stay warm longer than shared data instances (finding #2): a
      // reconnect within the window reuses the hydrated grant instead of a cold re-materialize.
      const grace = instance.isGrant ? this.#grantGraceMs : this.#graceMs;
      instance.idleTimer = setTimeout(() => void this.#teardownInstance(instanceKey), grace);
    }
  }

  async #teardownInstance(instanceKey: string): Promise<void> {
    const instance = this.#instances.get(instanceKey);
    if (!instance || instance.subscribers.size > 0) return;
    instance.idleTimer = null; // grace consumed
    const group = this.#groups.get(instance.groupKey);

    if (this.#multiPod) {
      await this.#ownership.removeInterest(instanceKey);
      // Redis reclamation is OWNER-ONLY. A non-owner DELeting the snapshot/stream would race the
      // live owner's fenced writes → a snapshot rebuilt from only post-DEL diffs (torn). A pod
      // without the group token does LOCAL cleanup and stops; reclaiming an instance whose owner
      // is gone belongs to the item-3 reconcile, which will hold the fresh lease when it does it.
      if (!group?.owned) {
        group?.connection?.removeInstance(instanceKey, instance.partitionValue);
        this.#instances.delete(instanceKey);
        group?.members.delete(instanceKey);
        obsEmit('tap', { action: 'instance-close', instanceKey, clientGroupID: instance.groupKey });
        return;
      }
      // Owner: only reclaim if NO pod still wants it; else keep materializing for the remote pod.
      if ((await this.#ownership.liveInterest(instanceKey)) > 0) return;
    }

    // Demote-before-delete: stop materializing (removeInstance) BEFORE deleting the snapshot/stream.
    group?.connection?.removeInstance(instanceKey, instance.partitionValue);
    this.#instances.delete(instanceKey);
    group?.members.delete(instanceKey);
    obsEmit('tap', { action: 'instance-close', instanceKey, clientGroupID: instance.groupKey });

    // Under multi-pod the destructive ops MUST carry the group's fence token (owner-only, checked
    // above). Refuse an unfenced destructive op rather than risk racing another owner. Single-pod
    // (token null) is the only legitimate unfenced path — it is the sole owner by construction.
    const guard = group ? this.#guardFor(group) : undefined;
    if (this.#multiPod && !guard) {
      logger.error('sync_teardown_refused_no_fence', { instanceKey, clientGroupID: instance.groupKey });
      return;
    }
    try {
      // A `stale` here means the lease was lost between the interest check and the DEL. Safe by
      // construction (the fenced Lua refused; Redis passes intact to the new owner; releaseGroup
      // no-ops on the podId check) but worth a breadcrumb for observability.
      if ((await this.#store.teardownInstance(instanceKey, guard)) === 'stale') {
        logger.debug('sync_teardown_instance_stale', { instanceKey, clientGroupID: instance.groupKey });
      }
      if (this.#multiPod) await this.#store.deregisterInstance(instance.groupKey, instanceKey, guard);
      if (group) await this.#closeGroupIfEmpty(group);
    } catch (error) {
      logger.error('sync_instance_teardown_failed', { instanceKey, error });
    }
  }

  /** Stop + drop a group whose connection has no instances left: release the lease and drop the
   *  resume cursor + registry (fenced). Owner-only Redis effects; no-op while still materializing. */
  async #closeGroupIfEmpty(group: Group): Promise<void> {
    if (!group.connection || group.connection.size() > 0) return;
    group.connection.stop();
    this.#groups.delete(group.clientGroupID);
    if ((await this.#store.teardownGroup(group.clientGroupID, this.#guardFor(group))) === 'stale') {
      logger.debug('sync_teardown_group_stale', { clientGroupID: group.clientGroupID });
    }
    if (this.#multiPod && group.owned) await this.#ownership.releaseGroup(group.clientGroupID);
    logger.info('sync_group_closed', { clientGroupID: group.clientGroupID });
    obsEmit('tap', { action: 'group-close', clientGroupID: group.clientGroupID });
  }

  /**
   * Owner-side reconcile of a group against the fleet subscription registry (`sync:ginst`). The
   * owner serves the WHOLE group, so it must materialize every registered instance with live
   * interest — including ones only a REMOTE pod subscribed to, that never hit this pod's subscribe
   * — and tear down (fenced) + deregister those whose interest has drained (the parked-owner sweep
   * the local grace-timer can't reach once its last local subscriber is gone). Owner-only.
   */
  async #reconcileOwned(group: Group): Promise<void> {
    const conn = group.connection;
    const guard = this.#guardFor(group);
    if (!conn || !guard) return;
    // Wedged-owner staleness signal: healthy lease but the tap is down and silent for a long time.
    if (!conn.isConnected() && conn.msSinceLastPoke() > STALE_OWNER_MS) {
      logger.warn('sync_owner_stream_stale', { clientGroupID: group.clientGroupID, msSincePoke: conn.msSinceLastPoke() });
      obsEmit('tap', { action: 'owner-stale', clientGroupID: group.clientGroupID, msSincePoke: conn.msSinceLastPoke() });
    }
    const registry = await this.#store.groupInstances(group.clientGroupID);
    for (const [ik, descJSON] of Object.entries(registry)) {
      if (this.#stopped) return;
      let desc: { args: readonly unknown[]; partitionValue: string };
      try {
        desc = JSON.parse(descJSON) as { args: readonly unknown[]; partitionValue: string };
      } catch {
        await this.#store.deregisterInstance(group.clientGroupID, ik, guard); // prune corrupt entry (owner-only)
        continue;
      }
      if ((await this.#ownership.liveInterest(ik)) > 0) {
        conn.addInstance(ik, desc.args, ik, desc.partitionValue); // idempotent; covers remote-only
      } else {
        conn.removeInstance(ik, desc.partitionValue);
        const teardown = await this.#store.teardownInstance(ik, guard);
        await this.#store.deregisterInstance(group.clientGroupID, ik, guard);
        if (teardown === 'stale') logger.debug('sync_reconcile_teardown_stale', { instanceKey: ik, clientGroupID: group.clientGroupID });
        const local = this.#instances.get(ik); // drop any parked local record + its grace timer
        if (local?.idleTimer) clearTimeout(local.idleTimer);
        this.#instances.delete(ik);
        group.members.delete(ik);
        obsEmit('tap', { action: 'instance-close', instanceKey: ik, clientGroupID: group.clientGroupID });
      }
    }
    await this.#closeGroupIfEmpty(group);
  }

  /**
   * Owner heartbeat + reconcile (multi-pod, every ~2s). For each group: if owned, refresh the
   * lease (demote on loss) then reconcile its materialized set against the fleet registry
   * (materialize remote-only interest, sweep drained instances); if not owned but wanted, try to
   * (re)acquire — this is also the cross-pod TAKEOVER path: once a dead owner's lease TTL-expires,
   * a pod with members here wins the SET NX and materializes. Finally re-stamp interest for
   * instances a local subscriber still wants.
   */
  async #onHeartbeat(): Promise<void> {
    if (this.#stopped) return;
    for (const group of this.#groups.values()) {
      if (this.#stopped) return; // shutdown mid-cycle — do not write after stopAll
      try {
        if (group.owned) {
          if (!(await this.#ownership.refreshGroup(group.clientGroupID))) {
            this.#demoteGroup(group);
          } else {
            await this.#reconcileOwned(group);
          }
        } else if (group.members.size > 0) {
          void this.#ensureMaterialized(group);
        }
      } catch (error) {
        // A Redis blip on one group's refresh must not abort the others or spray unhandled
        // rejections from setInterval; log and retry next cycle (a truly lost lease re-demotes).
        logger.error('sync_heartbeat_group_failed', { clientGroupID: group.clientGroupID, error });
      }
    }
    // Re-stamp interest AND re-announce the registry descriptor for every instance a local
    // subscriber still wants (or within the idle grace). Interest healing alone is not enough: the
    // registry is written once at subscribe, so a sweep during a remote pod's stall (or a
    // register-time blip) deletes the entry while interest later heals — leaving interest live but
    // no descriptor, so NO owner ever re-materializes it and the client sits stale forever. Both
    // are idempotent; re-announcing keeps the owner's reconcile work-list self-healing. Only skip a
    // zero-subscriber instance — stamping that would resurrect the interest its teardown removed.
    try {
      for (const [instanceKey, inst] of this.#instances) {
        if (this.#stopped) return;
        if (inst.subscribers.size > 0 || inst.idleTimer != null) {
          await this.#ownership.addInterest(instanceKey);
          await this.#store.registerInstance(inst.groupKey, instanceKey, JSON.stringify({ args: inst.args, partitionValue: inst.partitionValue }));
        }
      }
    } catch (error) {
      logger.error('sync_heartbeat_interest_failed', { error });
    }
  }

  #stopHeartbeat(): void {
    if (this.#heartbeat) {
      clearInterval(this.#heartbeat);
      this.#heartbeat = null;
    }
  }

  async stopAll(): Promise<void> {
    this.#stopped = true;
    this.#stopHeartbeat();
    for (const instance of this.#instances.values()) {
      if (instance.idleTimer) clearTimeout(instance.idleTimer);
    }
    // Stop the taps FIRST (no more fenced writes under our lease), THEN release the leases —
    // a graceful rolling deploy hands each owned group to the next heartbeat (~2s) instead of
    // paying the full LEASE_TTL lapse (~10s) per group. Best-effort (allSettled): a failed
    // release just degrades to the TTL path the crash smoke already proved; the app shutdown
    // awaits this before closing Redis, so releases actually land.
    const owned = this.#multiPod
      ? [...this.#groups.values()].filter((g) => g.owned).map((g) => g.clientGroupID)
      : [];
    for (const group of this.#groups.values()) group.connection?.stop();
    if (owned.length > 0) {
      await Promise.allSettled(owned.map((g) => this.#ownership.releaseGroup(g)));
    }
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
