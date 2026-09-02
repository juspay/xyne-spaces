import type WebSocket from 'ws';
import Redis, { type RedisOptions } from 'ioredis';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { RedisStreamStore } from './redisStore';
import type { AclGate } from './aclGate';

const streamKey = (instanceKey: string): string => `sync:stream:${instanceKey}`;
const instanceOfStream = (key: string): string => key.slice('sync:stream:'.length);
const BLOCK_MS = 1_000;

interface ClientSub {
  id: string;
  socket: WebSocket;
  userId: string;
  workspaceId: string;
  /** Root-scope binding for the gate, e.g. `{ channelId: C }`. */
  scope: Record<string, unknown>;
  gate: AclGate;
  dataInstanceKey: string;
  /** grant table → its materialized instanceKey (for gate snapshots + re-gate). */
  grantByTable: Map<string, string>;
  admitted: boolean;
}

/**
 * Fans a materialized instance's Redis op-stream out to admitted client sockets.
 * One multi-stream `XREAD BLOCK` loop tails every active data + grant stream:
 *   - a DATA delta → pushed to that instance's admitted clients;
 *   - a GRANT delta → re-evaluates the ACL gate for clients on that channel (live
 *     admit/revoke). Admission = `gate.evaluate` against the grant snapshots.
 */
export class Fanout {
  readonly #store = new RedisStreamStore();
  readonly #dataSubs = new Map<string, Set<ClientSub>>();
  readonly #grantToData = new Map<string, Set<string>>();
  readonly #cursors = new Map<string, string>();

  #tail: Redis | null = null;
  #stopped = false;

  start(): void {
    this.#stopped = false;
    this.#tail = new Redis(redisService.getRedisConfig() as RedisOptions);
    void this.#loop();
  }

  stop(): void {
    this.#stopped = true;
    this.#tail?.disconnect();
    this.#tail = null;
  }

  async addClient(sub: Omit<ClientSub, 'admitted'>): Promise<void> {
    const client: ClientSub = { ...sub, admitted: false };
    this.#setAdd(this.#dataSubs, client.dataInstanceKey, client);
    await this.#ensureCursorHead(client.dataInstanceKey);
    for (const grantKey of client.grantByTable.values()) {
      this.#setAdd(this.#grantToData, grantKey, client.dataInstanceKey);
      await this.#ensureCursorHead(grantKey);
    }
    await this.#regate(client);
  }

  removeClient(clientId: string, dataInstanceKey: string): void {
    const subs = this.#dataSubs.get(dataInstanceKey);
    if (!subs) return;
    for (const s of subs) if (s.id === clientId) subs.delete(s);
    if (subs.size === 0) this.#dataSubs.delete(dataInstanceKey);
  }

  #setAdd<T>(map: Map<string, Set<T>>, key: string, value: T): void {
    const set = map.get(key);
    if (set) set.add(value);
    else map.set(key, new Set([value]));
  }

  async #ensureCursorHead(instanceKey: string): Promise<void> {
    const key = streamKey(instanceKey);
    if (!this.#cursors.has(key)) this.#cursors.set(key, await this.#store.head(instanceKey));
  }

  /** Re-evaluate the gate for one client and admit (send snapshot) / revoke as needed. */
  async #regate(client: ClientSub): Promise<void> {
    const grantRows = new Map<string, Record<string, unknown>[]>();
    for (const [table, grantKey] of client.grantByTable) {
      grantRows.set(table, await this.#store.snapshot(grantKey).then((r) => r.map((c) => c.row)));
    }
    const admitted = client.gate.evaluate(
      client.scope,
      client.userId,
      client.workspaceId,
      (table) => grantRows.get(table) ?? [],
    );
    if (admitted && !client.admitted) {
      client.admitted = true;
      const rows = await this.#store.snapshot(client.dataInstanceKey);
      this.#send(client, { type: 'snapshot', instanceKey: client.dataInstanceKey, rows });
    } else if (!admitted && client.admitted) {
      client.admitted = false;
      this.#send(client, { type: 'revoke', instanceKey: client.dataInstanceKey });
    }
  }

  #send(client: ClientSub, msg: unknown): void {
    if (client.socket.readyState === client.socket.OPEN) {
      client.socket.send(JSON.stringify(msg));
    }
  }

  async #loop(): Promise<void> {
    while (!this.#stopped && this.#tail) {
      const streams = [...this.#cursors.keys()];
      if (streams.length === 0) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      const ids = streams.map((s) => this.#cursors.get(s) as string);
      let res: [string, [string, string[]][]][] | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const xread = this.#tail.xread.bind(this.#tail) as (...a: unknown[]) => Promise<any>;
        res = (await xread('BLOCK', BLOCK_MS, 'COUNT', 200, 'STREAMS', ...streams, ...ids)) as
          | [string, [string, string[]][]][]
          | null;
      } catch (error) {
        if (this.#stopped) break;
        logger.error('sync_fanout_xread_error', { error });
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      if (!res) continue;
      for (const [key, entries] of res) {
        for (const [id, fields] of entries) {
          this.#cursors.set(key, id);
          void this.#dispatch(key, fields);
        }
      }
    }
  }

  async #dispatch(key: string, fields: string[]): Promise<void> {
    const diffIdx = fields.indexOf('diff');
    const diff = diffIdx >= 0 ? JSON.parse(fields[diffIdx + 1]) : undefined;
    const instanceKey = instanceOfStream(key);

    const dataSubs = this.#dataSubs.get(instanceKey);
    if (dataSubs) {
      for (const client of dataSubs) {
        if (client.admitted) this.#send(client, { type: 'delta', instanceKey, diff });
      }
    }

    const affected = this.#grantToData.get(instanceKey);
    if (affected) {
      for (const dataKey of affected) {
        const subs = this.#dataSubs.get(dataKey);
        if (subs) for (const client of subs) await this.#regate(client);
      }
    }
  }
}

export const fanout = new Fanout();
export type { ClientSub };
