/**
 * Runs channel accounts on this pod.
 *
 * Every SWEEP_MS each pod lists the runnable accounts and tries to lease the
 * ones nobody owns; a won lease means "start it here" (connection plugins get
 * startAccount, webhook plugins just an open client handle). Owned accounts
 * keep their lease renewed; a failed renewal stops the account locally so the
 * winner of the next sweep can take over. The manager also drains the owned
 * accounts' outboxes (delivery.ts) on one blocking Redis connection, and
 * persists transport state the plugin reports via ctx.setState.
 */
import type { Redis } from "ioredis";
import { redisService } from "../../redis.js";
import { createLogger } from "../../logger.js";
import { errMsg } from "../../lib/errors.js";
import { LEASE_RENEW_MS, LEASE_TTL_MS, LOGIN_ARTIFACT_TTL_S, OUTBOX_POP_TIMEOUT_S, REDIS_PREFIX, SWEEP_MS } from "./const.js";
import { outboxKey, PartialSendError, postOutboxReply, sendOutbound, type OutboxRequest } from "./delivery.js";
import { runSerialized } from "./serialize.js";
import { handleInbound } from "./inbound.js";
import {
  acquireLease,
  publishControl,
  releaseLease,
  renewLease,
  subscribeControl,
  type ControlMessage,
} from "./placement.js";
import {
  getChannel,
  listChannels,
  type AccountRuntimeContext,
  type AccountStatePatch,
  type AnyChannelPlugin,
  type ChannelAccount,
  type ClosedInfo,
  type StopReason,
} from "./plugin.js";
import { listRunnableAccounts, authStateFor, updateAccountConfig } from "./store.js";

const log = createLogger("channel-accounts");

interface Runtime {
  account: ChannelAccount;
  plugin: AnyChannelPlugin;
  handle: unknown;
  renewTimer: NodeJS.Timeout | null;
  stopping: boolean;
  /** When the lease was last renewed successfully. A single failed renewal is
   *  not proof the lease is gone — Redis blips — so ownership is judged by
   *  this clock instead. */
  lastRenewOk: number;
}

const MAX_SEND_ATTEMPTS = 3;

function loginArtifactKey(accountId: string): string {
  return `${REDIS_PREFIX}:login:${accountId}`;
}

export async function getLoginArtifact(accountId: string): Promise<string | null> {
  try {
    return await redisService.getConnection().get(loginArtifactKey(accountId));
  } catch {
    return null;
  }
}

class AccountManager {
  private readonly runtimes = new Map<string, Runtime>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => Promise<void>) | null = null;
  private outboxConn: Redis | null = null;
  private stopped = true;
  private sweeping = false;

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const channels = listChannels().map((plugin) => plugin.key);
    log.info(`[channels] account manager started (channels: ${channels.join(", ") || "none"})`);
    this.unsubscribe = subscribeControl((message) => void this.onControl(message));
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.sweepTimer.unref();
    void this.sweep();
    void this.drainLoop();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    await Promise.all([...this.runtimes.keys()].map((id) => this.stopRuntime(id, "shutdown")));
    if (this.unsubscribe) await this.unsubscribe();
    this.unsubscribe = null;
    if (this.outboxConn) {
      // Interrupts a pending BRPOP.
      await this.outboxConn.quit().catch(() => undefined);
      this.outboxConn = null;
    }
    log.info("[channels] account manager stopped");
  }

  owns(accountId: string): boolean {
    return this.runtimes.has(accountId);
  }

  /**
   * The groups this account is in, for the admin UI's allowlist picker.
   *
   * Only the pod holding the account's lease has the live socket to ask, so
   * this returns null elsewhere and the caller says "try again" rather than
   * pretending the account is in no groups.
   */
  async listGroups(accountId: string): Promise<Array<{ id: string; name: string; participants: number }> | null> {
    const runtime = this.runtimes.get(accountId);
    if (!runtime?.handle || !runtime.plugin.listGroups) return null;
    return runtime.plugin.listGroups(runtime.handle);
  }

  /** Re-evaluate one account now (admin login/logout/rebind). */
  async wake(accountId: string): Promise<void> {
    await publishControl({ op: "wake", accountId });
    await this.sweep();
  }

  private async onControl(message: ControlMessage): Promise<void> {
    if (this.stopped) return;
    if (message.op === "logout" && this.runtimes.has(message.accountId)) {
      await this.stopRuntime(message.accountId, "logout");
      return;
    }
    await this.sweep();
  }

  private async sweep(): Promise<void> {
    if (this.stopped || this.sweeping) return;
    this.sweeping = true;
    try {
      const channels = listChannels().map((plugin) => plugin.key);
      const runnable = await listRunnableAccounts(channels);
      const runnableIds = new Set(runnable.map((account) => account.id));

      // Accounts we run that should no longer run anywhere.
      for (const [id, runtime] of this.runtimes) {
        if (runnableIds.has(id)) {
          const fresh = runnable.find((account) => account.id === id);
          if (fresh) runtime.account = fresh;
          continue;
        }
        // Always a plain stop, never an unlink. Pausing an account (desiredState
        // "stopped") must keep its stored credentials so it can resume without
        // re-scanning; only the explicit logout control unlinks the device.
        await this.stopRuntime(id, "shutdown");
      }

      // Unowned runnable accounts: try to become the owner.
      for (const account of runnable) {
        if (this.stopped || this.runtimes.has(account.id)) continue;
        if (!(await acquireLease(account.id))) continue;
        await this.startRuntime(account);
      }
    } catch (err) {
      log.error(`[channels] sweep failed: ${errMsg(err)}`);
    } finally {
      this.sweeping = false;
    }
  }

  private async startRuntime(account: ChannelAccount): Promise<void> {
    const plugin = getChannel(account.channel);
    if (!plugin) {
      await releaseLease(account.id);
      return;
    }
    const authState = authStateFor(account.id);
    const runtime: Runtime = { account, plugin, handle: null, renewTimer: null, stopping: false, lastRenewOk: Date.now() };
    this.runtimes.set(account.id, runtime);

    const ctx: AccountRuntimeContext = {
      // A getter, not the snapshot `account` bound at connect time: a plugin
      // reads its config on every message (selfChat, markOnline), and the sweep
      // refreshes runtime.account. Binding the snapshot froze every plugin-side
      // setting until the socket reconnected.
      get account() {
        return runtime.account;
      },
      onInbound: (msg) =>
        handleInbound({ account: runtime.account, plugin }, msg).catch((err) => {
          log.error(`[channels] inbound failed account=${account.id}: ${errMsg(err)}`);
        }),
      setState: (patch) => this.applyState(runtime, patch),
      onClosed: (info) => void this.onPluginClosed(runtime, info),
      authState,
      logger: log,
    };

    try {
      runtime.handle =
        plugin.transport === "connection"
          ? await plugin.startAccount!(ctx)
          : await plugin.openHandle!(account, authState);
      if (plugin.transport === "webhook") {
        const described = plugin.describeHandle
          ? await plugin.describeHandle(runtime.handle).catch((err) => {
              log.warn(`[channels] describeHandle failed account=${account.id}: ${errMsg(err)}`);
              return undefined;
            })
          : undefined;
        await this.applyState(runtime, { connState: "connected", ...described });
      }
    } catch (err) {
      log.error(`[channels] start failed account=${account.id} channel=${account.channel}: ${errMsg(err)}`);
      this.runtimes.delete(account.id);
      await updateAccountConfig(account.id, {
        connState: "disconnected",
        lastDisconnect: { reason: errMsg(err).slice(0, 200), at: new Date().toISOString() },
      }).catch(() => undefined);
      await releaseLease(account.id);
      return;
    }

    runtime.renewTimer = setInterval(() => {
      void renewLease(account.id).then((outcome) => {
        if (runtime.stopping) return;
        if (outcome === "renewed") {
          runtime.lastRenewOk = Date.now();
          return;
        }
        if (outcome === "lost") {
          // Redis answered: somebody else owns this account now. Waiting out
          // the TTL here would mean two pods holding a socket for the same
          // number, which WhatsApp resolves by closing one of them.
          log.warn(`[channels] lease taken over for account=${account.id}; stopping locally`);
          void this.stopRuntime(account.id, "lease_lost");
          return;
        }
        // Could not reach Redis, which says nothing about who holds the lease.
        // Give up only once our key must have expired anyway: stopping on the
        // first failure caused a self-inflicted outage, because we dropped a
        // healthy socket while our own still-valid key blocked the re-acquire.
        const staleFor = Date.now() - runtime.lastRenewOk;
        if (staleFor < LEASE_TTL_MS) {
          log.warn(`[channels] lease renewal unreachable for account=${account.id} (stale ${staleFor}ms); retrying`);
          return;
        }
        log.warn(`[channels] lease presumed lost for account=${account.id} (stale ${staleFor}ms); stopping locally`);
        void this.stopRuntime(account.id, "lease_lost");
      });
    }, LEASE_RENEW_MS);
    runtime.renewTimer.unref();
    log.info(`[channels] running account=${account.id} channel=${account.channel} label="${account.config.label}"`);
  }

  private async stopRuntime(accountId: string, reason: StopReason): Promise<void> {
    const runtime = this.runtimes.get(accountId);
    if (!runtime || runtime.stopping) return;
    runtime.stopping = true;
    if (runtime.renewTimer) clearInterval(runtime.renewTimer);
    runtime.renewTimer = null;
    try {
      if (runtime.plugin.transport === "connection" && runtime.handle !== null) {
        await runtime.plugin.stopAccount!(runtime.handle, reason);
      }
    } catch (err) {
      log.warn(`[channels] stop failed account=${accountId}: ${errMsg(err)}`);
    }
    this.runtimes.delete(accountId);
    if (reason !== "lease_lost") await releaseLease(accountId);
    if (reason === "logout" || reason === "shutdown") {
      // A pod shutting down leaves connState alone (another pod picks the
      // account up), but an account the admin paused or logged out is really
      // offline and must not keep reading "connected" in the UI.
      const offline = reason === "logout" || runtime.account.config.desiredState === "stopped";
      await updateAccountConfig(accountId, {
        connState: offline ? "disconnected" : runtime.account.config.connState,
      }).catch(() => undefined);
      await redisService.getConnection().del(loginArtifactKey(accountId)).catch(() => undefined);
    }
    log.info(`[channels] stopped account=${accountId} reason=${reason}`);
  }

  private async onPluginClosed(runtime: Runtime, info: ClosedInfo): Promise<void> {
    const accountId = runtime.account.id;
    if (info.loggedOut) {
      log.warn(`[channels] account=${accountId} logged out by the messenger (${info.reason ?? "no reason"})`);
      await updateAccountConfig(accountId, {
        connState: "logged_out",
        desiredState: "stopped",
        lastDisconnect: { ...(info.code !== undefined ? { code: info.code } : {}), ...(info.reason ? { reason: info.reason } : {}), at: new Date().toISOString() },
      }).catch(() => undefined);
      await this.stopRuntime(accountId, "logout");
      return;
    }
    const config = await updateAccountConfig(accountId, {
      connState: "disconnected",
      ...(info.stop ? { desiredState: "stopped" as const } : {}),
      lastDisconnect: { ...(info.code !== undefined ? { code: info.code } : {}), ...(info.reason ? { reason: info.reason } : {}), at: new Date().toISOString() },
    }).catch(() => undefined);
    // stopRuntime writes connState back from runtime.account, so it must see
    // this write rather than the pre-close snapshot.
    if (config) runtime.account = { ...runtime.account, config, channelConfig: config.channel ?? null };
    await this.stopRuntime(accountId, "shutdown");
  }

  private async applyState(runtime: Runtime, patch: AccountStatePatch): Promise<void> {
    const accountId = runtime.account.id;
    const { loginArtifact, ...rest } = patch;
    if (loginArtifact !== undefined) {
      const redis = redisService.getConnection();
      if (loginArtifact === null) await redis.del(loginArtifactKey(accountId)).catch(() => undefined);
      else await redis.set(loginArtifactKey(accountId), loginArtifact, "EX", LOGIN_ARTIFACT_TTL_S).catch(() => undefined);
    }
    const dbPatch: Record<string, unknown> = { ...rest };
    if (rest.connState === "connected") dbPatch["lastConnectedAt"] = new Date().toISOString();
    if (Object.keys(dbPatch).length > 0) {
      const config = await updateAccountConfig(accountId, dbPatch);
      runtime.account = { ...runtime.account, config, channelConfig: config.channel ?? null };
    }
  }

  // ── outbox ──

  private async drainLoop(): Promise<void> {
    this.outboxConn = redisService.getConnection().duplicate();
    this.outboxConn.on("error", (err: Error) => log.warn(`[channels] outbox connection error: ${err.message}`));
    while (!this.stopped) {
      const keys = [...this.runtimes.keys()].map(outboxKey);
      if (keys.length === 0) {
        await sleep(1000);
        continue;
      }
      let popped: [string, string] | null = null;
      try {
        popped = await this.outboxConn.brpop(...keys, OUTBOX_POP_TIMEOUT_S);
      } catch (err) {
        if (this.stopped) break;
        log.warn(`[channels] outbox pop failed: ${errMsg(err)}`);
        await sleep(1000);
        continue;
      }
      if (!popped) continue;
      const [key, payload] = popped;
      const accountId = key.slice(`${REDIS_PREFIX}:outbox:`.length);
      let item: OutboxRequest | null = null;
      try {
        item = JSON.parse(payload) as OutboxRequest;
      } catch {
        log.warn(`[channels] dropping malformed outbox item account=${accountId}`);
        continue;
      }
      // Dispatch without blocking the pop. One loop serves every account on
      // this pod, so sending inline means a 64 MB upload — or a retry sleep —
      // stalls every other account's replies behind it. Per-account chains
      // keep each account's own items strictly in order.
      void runSerialized(`outbox:${accountId}`, () => this.deliver(accountId, key, payload, item!));
    }
  }

  /**
   * Retries stay inside the account's chain: re-queueing a failed item would
   * put it behind everything already popped, so a reply could land after the
   * approval card that follows it. Hand-backs use the shared connection —
   * outboxConn is parked in BRPOP and would hold a push for up to its timeout.
   */
  private async deliver(accountId: string, key: string, payload: string, item: OutboxRequest): Promise<void> {
    let progress = item.__progress;
    for (let attempt = 1; ; attempt++) {
      const runtime = this.runtimes.get(accountId);
      if (!runtime || runtime.stopping) {
        // Lost ownership: hand it back for the new owner, carrying how far the
        // send got so it resumes rather than repeating delivered chunks.
        const handBack = progress ? JSON.stringify({ ...item, __progress: progress }) : payload;
        await redisService.getConnection().rpush(key, handBack).catch(() => undefined);
        return;
      }
      try {
        const reply = await sendOutbound(runtime.plugin, runtime.handle, item, progress);
        log.info(`[channels] sent kind=${item.kind} account=${accountId}${"chatId" in item ? ` chat=${item.chatId}` : ""} ok=${reply.ok}`);
        if (item.replyKey) await postOutboxReply(item.replyKey, reply).catch(() => undefined);
        return;
      } catch (err) {
        log.warn(`[channels] send failed account=${accountId} kind=${item.kind} attempt=${attempt}: ${errMsg(err)}`);
        if (item.replyKey) {
          // A waiting caller gets the failure now rather than a silent retry.
          await postOutboxReply(item.replyKey, { ok: false, error: errMsg(err) }).catch(() => undefined);
          return;
        }
        if (attempt >= MAX_SEND_ATTEMPTS) return;
        if (err instanceof PartialSendError) progress = err.progress;
        await sleep(500 * attempt);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const accountManager = new AccountManager();
