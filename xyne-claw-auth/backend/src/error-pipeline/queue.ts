import type { Redis } from "ioredis";
import { redisService } from "../redis.js";
import { ERROR_PIPELINE } from "../config.js";
import { createLogger } from "../logger.js";
import type { WorkItem } from "./types.js";

const log = createLogger("error-pipeline");

/**
 * Durable bucket queues for the error pipeline — Redis Streams on claw-auth's
 * EXISTING redis (redisService, the same instance behind BullMQ/pubsub; keys
 * namespaced errpipe:*). One stream per domain bucket + consumer group
 * `workers`. This buys, natively:
 *   - durability across deploys/restarts (stream entries persist)
 *   - crash-safe in-flight tracking (the group's pending-entries list)
 *   - timeout→retry (XAUTOCLAIM reclaims entries idle > itemTimeoutMs)
 *   - retry cap → dead-letter (delivery count > maxAttempts → needs-human)
 *   - multi-pod coordination (one group, distinct consumers)
 */

export interface ClaimedItem {
  bucket: string;
  id: string;
  item: WorkItem;
  deliveries: number;
}

export interface QueueStats {
  queued: number;
  pending: number;
}

const GROUP = "workers";
const STREAM = (bucket: string) => `errpipe:${bucket}`;
const SEEN = (errorKey: string) => `errpipe:seen:${errorKey}`;
const DEAD_STREAM = "errpipe:needs-human";

class ErrorQueue {
  private groupsEnsured = new Set<string>();

  private get redis(): Redis {
    return redisService.getConnection();
  }

  private async ensureGroup(stream: string): Promise<void> {
    if (this.groupsEnsured.has(stream)) return;
    try {
      await this.redis.xgroup("CREATE", stream, GROUP, "0", "MKSTREAM");
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("BUSYGROUP"))) throw err;
    }
    this.groupsEnsured.add(stream);
  }

  async enqueue(bucket: string, item: WorkItem): Promise<boolean> {
    const fresh = await this.redis.set(SEEN(item.errorKey), bucket, "EX", ERROR_PIPELINE.dedupTtlSeconds, "NX");
    if (fresh === null) return false;

    try {
      const stream = STREAM(bucket);
      await this.ensureGroup(stream);
      await this.redis.xadd(stream, "MAXLEN", "~", ERROR_PIPELINE.maxStreamLen, "*", "errorKey", item.errorKey, "item", JSON.stringify(item));
      return true;
    } catch (err) {
      await this.redis.del(SEEN(item.errorKey)).catch(() => {});
      throw err;
    }
  }

  async claimNext(bucket: string, consumer: string): Promise<ClaimedItem | null> {
    const stream = STREAM(bucket);
    await this.ensureGroup(stream);
    try {
      return await this.claimNextInner(bucket, stream, consumer);
    } catch (err) {
      // Self-heal: if the stream/group was deleted externally (manual redis
      // flush), our in-memory groupsEnsured cache lies — recreate and retry.
      if (err instanceof Error && err.message.includes("NOGROUP")) {
        this.groupsEnsured.delete(stream);
        await this.ensureGroup(stream);
        return this.claimNextInner(bucket, stream, consumer);
      }
      throw err;
    }
  }

  private async claimNextInner(bucket: string, stream: string, consumer: string): Promise<ClaimedItem | null> {

    // 1. Stuck items first: idle past the timeout → retry (or dead-letter).
    for (;;) {
      const res = (await this.redis.xautoclaim(
        stream, GROUP, consumer, ERROR_PIPELINE.itemTimeoutMs, "0", "COUNT", 1,
      )) as [string, Array<[string, string[]] | null>];
      const entries = (res?.[1] ?? []).filter((e): e is [string, string[]] => e !== null);
      if (entries.length === 0) break;

      const [id, fields] = entries[0]!;
      const claimed = await this.toClaimed(bucket, id, fields);
      if (!claimed) continue; // tombstone/corrupt — ack'd inside toClaimed

      if (claimed.deliveries > ERROR_PIPELINE.maxAttempts) {
        await this.deadLetter(claimed, `exceeded ${ERROR_PIPELINE.maxAttempts} attempts (timeout/crash)`);
        continue;
      }
      log.warn(`[queue] reclaimed stuck item ${claimed.item.errorKey} (attempt ${claimed.deliveries})`);
      return claimed;
    }

    // 2. Otherwise the next new entry.
    const read = (await this.redis.xreadgroup(
      "GROUP", GROUP, consumer, "COUNT", 1, "STREAMS", stream, ">",
    )) as Array<[string, Array<[string, string[]]>]> | null;
    const entry = read?.[0]?.[1]?.[0];
    if (!entry) return null;
    return this.toClaimed(bucket, entry[0], entry[1]);
  }

  private async toClaimed(bucket: string, id: string, fields: string[]): Promise<ClaimedItem | null> {
    const map = new Map<string, string>();
    for (let i = 0; i + 1 < fields.length; i += 2) map.set(fields[i]!, fields[i + 1]!);
    const raw = map.get("item");
    if (!raw) {
      await this.redis.xack(STREAM(bucket), GROUP, id);
      await this.redis.xdel(STREAM(bucket), id);
      return null;
    }
    let item: WorkItem;
    try {
      item = JSON.parse(raw) as WorkItem;
    } catch {
      log.error(`[queue] dropping corrupt entry ${id} in ${bucket}`);
      await this.redis.xack(STREAM(bucket), GROUP, id);
      await this.redis.xdel(STREAM(bucket), id);
      return null;
    }
    // Delivery count lives in the group's pending-entries list.
    const pending = (await this.redis.xpending(STREAM(bucket), GROUP, id, id, 1)) as Array<[string, string, number, number]>;
    const deliveries = pending?.[0]?.[3] ?? 1;
    return { bucket, id, item, deliveries };
  }

  /**
   * Remove an item from the stream. By default the dedup marker is DELETED so a
   * later occurrence of the same error re-enqueues. Pass `keepDedupForSeconds`
   * to instead HOLD the marker for that long — used after a successful fix so
   * Grafana's re-fires of the now-worked error are dropped at INGEST (the SETNX
   * in enqueue) for the cooldown window, instead of re-enqueuing every time just
   * to be cooldown-skipped (that churn inflated "In queue" and spammed
   * "completed recently — ack, skip").
   */
  async ack(claimed: ClaimedItem, opts?: { keepDedupForSeconds?: number }): Promise<void> {
    const stream = STREAM(claimed.bucket);
    await this.redis.xack(stream, GROUP, claimed.id);
    await this.redis.xdel(stream, claimed.id);
    const keep = opts?.keepDedupForSeconds;
    if (keep && keep > 0) {
      await this.redis.set(SEEN(claimed.item.errorKey), claimed.bucket, "EX", Math.ceil(keep));
    } else {
      await this.redis.del(SEEN(claimed.item.errorKey));
    }
  }

  async deadLetter(claimed: ClaimedItem, reason: string): Promise<void> {
    try {
      const { saveFixRecord } = await import("./runner/store.js");
      await saveFixRecord({
        errorKey: claimed.item.errorKey,
        bucket: claimed.bucket,
        status: "failed",
        message: claimed.item.error.message.slice(0, 20_000),
        summary: `dead-lettered: ${reason}`,
        attempts: claimed.deliveries,
        updatedAt: 0,
      });
    } catch { /* record best-effort — parking the item matters more */ }
    await this.redis.xadd(
      DEAD_STREAM, "MAXLEN", "~", ERROR_PIPELINE.maxStreamLen, "*",
      "bucket", claimed.bucket,
      "errorKey", claimed.item.errorKey,
      "reason", reason,
      "deliveries", String(claimed.deliveries),
      "item", JSON.stringify(claimed.item),
    );
    const stream = STREAM(claimed.bucket);
    await this.redis.xack(stream, GROUP, claimed.id);
    await this.redis.xdel(stream, claimed.id);
    // Dedup marker intentionally NOT deleted: while it lives, re-fires of this
    // error don't re-enqueue a known-unfixable item. TTL expiry retries later.
    log.warn(`[queue] dead-lettered ${claimed.item.errorKey} from ${claimed.bucket}: ${reason}`);
  }

  async stats(buckets: string[]): Promise<Record<string, QueueStats>> {
    const out: Record<string, QueueStats> = {};
    for (const bucket of buckets) {
      const stream = STREAM(bucket);
      const queued = await this.redis.xlen(stream);
      let pending = 0;
      try {
        const p = (await this.redis.xpending(stream, GROUP)) as [number, ...unknown[]] | null;
        pending = p?.[0] ?? 0;
      } catch {
        /* group may not exist yet */
      }
      out[bucket] = { queued, pending };
    }
    out["needs-human"] = { queued: await this.redis.xlen(DEAD_STREAM), pending: 0 };
    return out;
  }

  /**
   * Drop a lane's entire queue — deletes the stream (queued + claimed/pending
   * entries) and releases the per-item dedup markers so those shapes can be
   * re-ingested fresh. Admin escape hatch for a lane flooded with junk (e.g.
   * scanner noise) without needing redis-cli. Returns how many entries were
   * dropped. The consumer group is recreated lazily on the next claim.
   */
  async flushBucket(bucket: string): Promise<number> {
    const stream = bucket === "needs-human" ? DEAD_STREAM : STREAM(bucket);
    const entries = (await this.redis.xrange(stream, "-", "+")) as Array<[string, string[]]>;
    // Release each entry's dedup marker so re-fires aren't suppressed.
    const seenKeys: string[] = [];
    for (const [, fields] of entries) {
      for (let i = 0; i + 1 < fields.length; i += 2) {
        if (fields[i] === "errorKey" && fields[i + 1]) seenKeys.push(SEEN(fields[i + 1]!));
      }
    }
    if (seenKeys.length) await this.redis.del(...seenKeys);
    await this.redis.del(stream);
    this.groupsEnsured.delete(stream);
    log.warn(`[queue] flushed bucket "${bucket}": ${entries.length} entries + ${seenKeys.length} markers`);
    return entries.length;
  }

  async peekItems(bucket: string, limit: number): Promise<WorkItem[]> {
    const stream = bucket === "needs-human" ? DEAD_STREAM : STREAM(bucket);
    const entries = (await this.redis.xrange(stream, "-", "+", "COUNT", limit)) as Array<[string, string[]]>;
    const items: WorkItem[] = [];
    for (const [, fields] of entries) {
      for (let i = 0; i + 1 < fields.length; i += 2) {
        if (fields[i] === "item") {
          try {
            items.push(JSON.parse(fields[i + 1]!) as WorkItem);
          } catch {
            /* skip corrupt */
          }
        }
      }
    }
    return items;
  }
}

let queue: ErrorQueue | null = null;

export function getQueue(): ErrorQueue {
  if (!queue) queue = new ErrorQueue();
  return queue;
}
